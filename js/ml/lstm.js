/* Model LSTM di browser (TensorFlow.js): hanya membangun, melatih, dan menjalankan model.
   Seluruh pengolahan data (ambil data, per jam, interpolasi, jendela, skala, metrik, kembali ke satuan asli)
   dikerjakan server Python lewat js/ml/api.js (backend/services/lstm_service.py).
   Model dibaca 24 jam terakhir (suhu, udara, tanah, sin/cos jam) dan memprediksi ketiga parameter jam berikutnya;
   prediksi lebih jauh dibuat rekursif. Model disimpan di IndexedDB browser, metadata di localStorage. */
(function () {
    'use strict';
    var ML = window.SeladaML, C = ML.C, E = ML.MLError, PP = window.SeladaPrep, API = window.SeladaAPI, HOUR = PP.HOUR;
    var F = PP.FEATURES, W = C.WINDOW_HOURS, NI = PP.N_INPUT;
    var MODEL_URL = 'indexeddb://selada-lstm', META_KEY = 'selada-lstm-meta';
    var cache = { model: null, scaler: null, stamp: null };
    var TRAIN = { status: 'idle', cancel: false };

    function requirements() {
        var need = C.MIN_WINDOWS_REQUIRED + W;
        return {
            window_hours: W, min_windows: C.MIN_WINDOWS_REQUIRED, min_contiguous_hours: need, recommended_days: 14,
            text: 'Training butuh minimal ' + C.MIN_WINDOWS_REQUIRED + ' jendela (' + need + ' jam ≈ ' + Math.round(need / 24) + ' hari data sensor yang berurutan, rata-rata per jam). Disarankan 14 hari atau lebih supaya pola harian dan hasil uji bermakna.'
        };
    }
    function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (e) { return null; } }
    function modelInfo() {
        var m = readMeta(), tfOk = !!window.tf;
        if (!m) return { status: 'not_trained', tf_available: tfOk, requirements: requirements(), message: 'Model LSTM belum dilatih. Belum ada hasil evaluasi.' };
        var o = {}; Object.keys(m).forEach(function (k) { if (k !== 'scaler') o[k] = m[k]; });
        o.tf_available = tfOk; return o;
    }

    function buildModel() {
        var tf = ML.tf(), m = tf.sequential({ name: 'lstm_selada' });
        m.add(tf.layers.lstm({ units: 64, returnSequences: true, inputShape: [W, NI] }));
        m.add(tf.layers.dropout({ rate: 0.2 }));
        m.add(tf.layers.lstm({ units: 32 }));
        m.add(tf.layers.dense({ units: 16, activation: 'relu' }));
        m.add(tf.layers.dense({ units: F.length }));
        m.compile({ optimizer: tf.train.adam(1e-3), loss: 'meanSquaredError', metrics: ['mae'] });
        return m;
    }
    /* predictFn(Float32Array B*W*5, B) -> Float32Array B*3 (terskala) */
    function makePredictFn(model) {
        var tf = ML.tf();
        return function (X, B) {
            var out = new Float32Array(B * F.length);
            for (var s = 0; s < B; s += 256) {
                var n = Math.min(256, B - s);
                var part = tf.tidy(function () { return model.predict(tf.tensor3d(X.subarray(s * W * NI, (s + n) * W * NI), [n, W, NI])).dataSync(); });
                out.set(part, s * F.length);
            }
            return out;
        };
    }
    /* X0: B*W*5, tfFuture: B*steps*2 -> Float32Array B*steps*3 (terskala) */
    function recursiveForecast(predictFn, X0, B, tfFuture, steps) {
        var X = new Float32Array(X0), out = new Float32Array(B * steps * 3), rowLen = W * NI;
        for (var h = 0; h < steps; h++) {
            var y = predictFn(X, B);
            for (var b = 0; b < B; b++) {
                var base = b * rowLen;
                X.copyWithin(base, base + NI, base + rowLen);
                var o = base + (W - 1) * NI, yo = b * 3, fo = (b * steps + h) * 2;
                X[o] = y[yo]; X[o + 1] = y[yo + 1]; X[o + 2] = y[yo + 2]; X[o + 3] = tfFuture[fo]; X[o + 4] = tfFuture[fo + 1];
                var oo = (b * steps + h) * 3; out[oo] = y[yo]; out[oo + 1] = y[yo + 1]; out[oo + 2] = y[yo + 2];
            }
        }
        return out;
    }

    function round(v, d) { return v == null ? v : Math.round(v * Math.pow(10, d)) / Math.pow(10, d); }

    function trainingStatus() { return { status: TRAIN.status, running: TRAIN.status === 'running' }; }
    function cancelTraining() { TRAIN.cancel = true; if (TRAIN.model) TRAIN.model.stopTraining = true; }

    /* Latih dari data per jam. opt: {source:'firebase'|'csv', file, days, epochs, batch, patience, progress(info)} */
    async function train(opt) {
        opt = opt || {};
        if (TRAIN.status === 'running') throw new E('busy', 'Training sedang berjalan.');
        var epochs = Math.round(Number(opt.epochs) || 100);
        if (epochs < 1 || epochs > 500) throw new E('bad_epochs', 'Jumlah epoch harus 1–500.');
        var say = opt.progress || function () { }, batch = opt.batch || 32, patience = opt.patience || 10;
        var tf = ML.tf(); TRAIN.status = 'running'; TRAIN.cancel = false;
        var live = [], trainedModel = null, saved = false;
        try {
            await ML.ready();
            say({ phase: 'menyiapkan data di server Python' });
            var form = new FormData(), cx = API.ctx();
            form.append('source', opt.source === 'csv' ? 'csv' : 'firebase'); form.append('days', String(opt.days || ML.days()));
            form.append('firebase_url', cx.firebase_url); form.append('timezone', cx.timezone);
            if (opt.source === 'csv') {
                if (!opt.file) throw new E('csv_missing', 'Pilih berkas CSV terlebih dahulu.');
                form.append('file', opt.file, opt.file.name || 'data.csv');
            }
            var ds = await API.postForm('/api/lstm/dataset', form, 600000);
            if (ds.window_hours !== W || ds.n_input !== NI) throw new E('config_mismatch', 'Konfigurasi jendela di server (' + ds.window_hours + ' jam) berbeda dengan browser (' + W + ' jam).');
            if (TRAIN.cancel) throw new E('cancelled', 'Training dihentikan. Model sebelumnya (jika ada) tidak diubah.');
            say({ phase: 'menyiapkan data' }); await tf.nextFrame();
            var nTr = ds.n_train, nVa = ds.n_val, nTe = ds.n_test, rl = W * NI;
            var X = Float32Array.from(ds.x), Y = Float32Array.from(ds.y), scaler = ds.scaler;
            var xTr = tf.tensor3d(X.subarray(0, nTr * rl), [nTr, W, NI]), yTr = tf.tensor2d(Y.subarray(0, nTr * 3), [nTr, 3]);
            var xVa = tf.tensor3d(X.subarray(nTr * rl, (nTr + nVa) * rl), [nVa, W, NI]), yVa = tf.tensor2d(Y.subarray(nTr * 3, (nTr + nVa) * 3), [nVa, 3]);
            live = [xTr, yTr, xVa, yVa];
            var XTe = X.subarray((nTr + nVa) * rl);

            var model = buildModel(); TRAIN.model = model; trainedModel = model;
            var hLoss = [], hVal = [], best = Infinity, bestEpoch = 0, bestW = null, wait = 0;
            say({ phase: 'melatih', epoch: 0, epochs: epochs });
            await model.fit(xTr, yTr, {
                epochs: epochs, batchSize: batch, shuffle: true, validationData: [xVa, yVa], verbose: 0,
                callbacks: {
                    onEpochEnd: async function (epoch, logs) {
                        hLoss.push(logs.loss); hVal.push(logs.val_loss);
                        if (logs.val_loss < best - 1e-12) {
                            best = logs.val_loss; bestEpoch = epoch + 1; wait = 0;
                            if (bestW) bestW.forEach(function (w) { w.dispose(); });
                            bestW = model.getWeights().map(function (w) { return w.clone(); });
                        } else if (++wait >= patience) model.stopTraining = true;
                        if (TRAIN.cancel) model.stopTraining = true;
                        say({ phase: 'melatih', epoch: epoch + 1, epochs: epochs, loss: logs.loss, val_loss: logs.val_loss });
                        await tf.nextFrame();
                    }
                }
            });
            xTr.dispose(); yTr.dispose(); xVa.dispose(); yVa.dispose();
            if (TRAIN.cancel) { if (bestW) bestW.forEach(function (w) { w.dispose(); }); model.dispose(); trainedModel = null; throw new E('cancelled', 'Training dihentikan. Model sebelumnya (jika ada) tidak diubah.'); }
            if (bestW) { model.setWeights(bestW); bestW.forEach(function (w) { w.dispose(); }); }

            say({ phase: 'evaluasi' }); await tf.nextFrame();
            var predict = makePredictFn(model), yPred = predict(XTe, nTe), h24Pred = [];
            if (ds.h24) h24Pred = recursiveForecast(predict, Float32Array.from(ds.h24.x), ds.h24.n, Float32Array.from(ds.h24.tf_future), ds.h24.steps);
            var ev = await API.post('/api/lstm/evaluate', { scaler: scaler, eval: ds.eval, y_pred: API.round6(yPred), h24_pred: API.round6(h24Pred) });
            var per = ev.metrics, dm = ds.meta;

            var meta = {
                status: 'trained', trained_at: new Date().toISOString(), source: opt.source === 'csv' ? 'csv' : 'firebase',
                architecture: 'LSTM(64, return_sequences) → Dropout(0.2) → LSTM(32) → Dense(16, relu) → Dense(3)',
                params: model.countParams(), engine: 'TensorFlow.js (' + tf.getBackend() + ') + pengolahan data Python',
                window_hours: W, features_in: F.concat(['sin_jam', 'cos_jam']), features_out: F.slice(), resolution: 'rata-rata per jam',
                timezone: dm.timezone, optimizer: 'Adam(lr=1e-3), loss=MSE', batch_size: batch, epochs_requested: epochs, epochs_run: hLoss.length,
                best_epoch: bestEpoch || hLoss.length, early_stopping_patience: patience, n_train: nTr, n_val: nVa, n_test: nTe,
                data_from: dm.data_from, data_to: dm.data_to, valid_hours: dm.valid_hours,
                loss: hLoss[(bestEpoch || hLoss.length) - 1], val_loss: hVal[(bestEpoch || hVal.length) - 1], final_loss: hLoss[hLoss.length - 1], final_val_loss: hVal[hVal.length - 1],
                history: { loss: hLoss, val_loss: hVal }, metrics: per, overall: ev.overall, baseline_persistence_mae: ev.baseline_persistence_mae, horizon24: ev.horizon24, test_series: ev.test_series,
                notes: 'Metrik dihitung pada data uji kronologis (20% data paling akhir) yang tidak dipakai melatih.',
                scaler: scaler
            };
            try { await model.save(MODEL_URL); }
            catch (e) { throw new E('storage_failed', 'Model tidak bisa disimpan di browser (IndexedDB dinonaktifkan atau penuh; mode privat dapat menyebabkan ini): ' + ((e && e.message) || e)); }
            try { localStorage.setItem(META_KEY, JSON.stringify(meta)); }
            catch (e) { throw new E('storage_full', 'Penyimpanan browser penuh; metadata model tidak bisa disimpan. Hapus data situs lain lalu coba lagi.'); }
            if (cache.model && cache.model !== model) cache.model.dispose();
            cache.model = model; cache.scaler = scaler; cache.stamp = meta.trained_at; saved = true;
            say({ phase: 'selesai' });
            return modelInfo();
        } finally {
            live.forEach(function (t) { try { if (!t.isDisposed) t.dispose(); } catch (e) { } });
            if (trainedModel && !saved) { try { trainedModel.dispose(); } catch (e) { } }
            TRAIN.status = 'idle'; TRAIN.model = null;
        }
    }

    async function loadModel() {
        var meta = readMeta();
        if (!meta) throw new E('model_not_trained', 'Model LSTM belum dilatih.', { requirements: requirements(), hint: 'Latih dari halaman Model LSTM (tombol "Latih model").' });
        if (cache.model && cache.stamp === meta.trained_at) return { model: cache.model, scaler: cache.scaler, meta: meta };
        var tf = ML.tf(); await ML.ready();
        try { cache.model = await tf.loadLayersModel(MODEL_URL); }
        catch (e) { throw new E('model_not_trained', 'Berkas model LSTM tidak ditemukan di penyimpanan browser (mungkin sudah dihapus). Latih ulang.', { requirements: requirements() }); }
        cache.scaler = meta.scaler; cache.stamp = meta.trained_at;
        return { model: cache.model, scaler: cache.scaler, meta: meta };
    }
    async function deleteModel() {
        var tf = window.tf;
        try { localStorage.removeItem(META_KEY); } catch (e) { }
        if (cache.model) { try { cache.model.dispose(); } catch (e) { } }
        cache = { model: null, scaler: null, stamp: null };
        if (tf) { try { await tf.io.removeModel(MODEL_URL); } catch (e) { } }
    }

    /* Prediksi per jam mulai dari jam yang sedang berjalan, sebanyak `steps` jam.
       Python menyiapkan input (data terbaru, cek kesegaran, skala) dan mengembalikan hasil ke satuan asli;
       browser hanya menjalankan model. opt: {thresholds, days} -> sekaligus agregasi harian dari Python. */
    async function forecast(steps, opt) {
        opt = opt || {};
        var L = await loadModel(), predict = makePredictFn(L.model), meta = L.meta, cx = API.ctx();
        var inp = await API.post('/api/lstm/forecast-input', { firebase_url: cx.firebase_url, timezone: cx.timezone, window_hours: meta.window_hours, steps: steps, scaler: L.scaler });
        var out = recursiveForecast(predict, Float32Array.from(inp.x0), 1, Float32Array.from(inp.tf_future), inp.total);
        var body = { scaler: L.scaler, pred: API.round6(out), lag_hours: inp.lag_hours, steps: inp.steps, last_data_hour: inp.last_data_hour };
        if (opt.days) { body.days = opt.days; body.thresholds = opt.thresholds; }
        var post = await API.post('/api/lstm/postprocess', body);
        return Object.assign({ actual: inp.actual, last_data_hour: inp.last_data_hour, lag_hours: inp.lag_hours, window_hours: inp.window_hours, meta: meta, steps: inp.steps }, post);
    }
    /* Setara POST /api/lstm/predict */
    async function predictHours(steps) {
        steps = Math.max(1, Math.min(Math.round(Number(steps) || 24), C.HORIZON_HOURS));
        var r = await forecast(steps), meta = r.meta || {};
        return {
            generated_at: new Date().toISOString(), last_data_hour: new Date(r.last_data_hour).toISOString(), lag_hours: r.lag_hours, steps: steps,
            next_hour: r.forecast[0], predictions: r.forecast, actual_recent: r.actual, summary: r.summary,
            model: { trained_at: meta.trained_at, window_hours: r.window_hours, metrics: meta.metrics, horizon24: meta.horizon24 },
            disclaimer: 'Estimasi berdasarkan pola historis, bukan jaminan kondisi tanaman.'
        };
    }

    window.SeladaLSTM = {
        requirements: requirements, modelInfo: modelInfo, readMeta: readMeta, train: train, cancelTraining: cancelTraining, trainingStatus: trainingStatus,
        loadModel: loadModel, deleteModel: deleteModel, forecast: forecast, predictHours: predictHours,
        recursiveForecast: recursiveForecast, makePredictFn: makePredictFn, buildModel: buildModel
    };
})();
