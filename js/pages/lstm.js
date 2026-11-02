/* Halaman Model LSTM: info model, evaluasi (MAE/MSE/RMSE/R²), aktual vs prediksi, prediksi jam ke depan, training. */
(window.SeladaModules = window.SeladaModules || []).push(function (core) {
    'use strict';
    var $ = function (s) { return document.querySelector(s); };
    var LSTM = window.SeladaLSTM, CH = window.SeladaCharts, U = window.SeladaUI, esc = U.esc, f = U.f;
    var INFO = null, PRED = null, lastW = 0, TR = { run: false, phase: '', epoch: 0, epochs: 0, loss: null, val_loss: null, done: 0, total: 0, msg: '', err: '', ok: '' };
    var P = [{ k: 'suhu', name: 'Suhu udara', unit: '°C', color: '--temp', dec: 1 }, { k: 'udara', name: 'Kelembapan udara', unit: '%', color: '--wet', dec: 1 }, { k: 'tanah', name: 'Kelembapan tanah', unit: '%', color: '--ok', dec: 1 }];
    var tf = function (t) { var d = new Date(t); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':00'; };

    function build() {
        $('#p-lstm').innerHTML = '<div class="col"><div class="toolbar"><div class="seg" id="ls-tabs" role="group" aria-label="Bagian halaman"><button type="button" data-t="fc" aria-pressed="true">Prediksi 4 Hari</button><button type="button" data-t="model" aria-pressed="false">Model &amp; Evaluasi</button></div></div>' +
            '<div id="ls-tab-fc"></div><div id="ls-tab-model" class="col" hidden>' +
            '<article class="panel"><div class="panel-head"><h2>Status model</h2><div class="toolbar"><button class="btn ghost small" type="button" id="ls-reload">Muat ulang</button><button class="btn ghost small" type="button" id="ls-del">Hapus model</button></div></div><div id="ls-status"></div></article>' +
            '<div id="ls-main"></div></div></div>';
        window.SeladaFcPage.init();
        $('#ls-tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) tab(b.dataset.t); });
        $('#ls-reload').addEventListener('click', load);
        $('#p-lstm').addEventListener('click', function (e) {
            if (e.target.id === 'ls-train') train();
            if (e.target.id === 'ls-stop') LSTM.cancelTraining();
            if (e.target.id === 'ls-del' && confirm('Hapus model LSTM yang tersimpan di browser ini?')) LSTM.deleteModel().then(function () { PRED = null; TR.ok = ''; window.SeladaFcPage.reset(); load(); });
            if (e.target.id === 'ls-pred') predict();
        });
    }

    function load() { INFO = LSTM.modelInfo(); paint(); }

    function trainBox(info) {
        var run = TR.run, pct = run && TR.epochs ? Math.round(TR.epoch / TR.epochs * 100) : (run && TR.total ? Math.round(TR.done / TR.total * 100) : 0);
        var days = window.SeladaML.days();
        return '<div class="trainbox"><div class="filters"><div><label class="label" for="ls-src">Sumber data latih</label><select id="ls-src"' + (run ? ' disabled' : '') + '><option value="firebase">Firebase (riwayat per jam)</option><option value="csv">Berkas CSV (ekspor Eksplorasi Data)</option></select></div>' +
            '<div id="ls-daybox"><label class="label" for="ls-days">Hari terakhir</label><input type="number" id="ls-days" value="' + days + '" min="3" max="60"' + (run ? ' disabled' : '') + '></div>' +
            '<div id="ls-filebox" hidden><label class="label" for="ls-file">Berkas CSV</label><input type="file" id="ls-file" accept=".csv,text/csv"></div>' +
            '<div><label class="label" for="ls-ep">Epoch maks.</label><input type="number" id="ls-ep" value="100" min="1" max="500"' + (run ? ' disabled' : '') + '></div>' +
            '<div class="fbtn"><button class="btn" type="button" id="ls-train"' + (run || !window.tf ? ' disabled' : '') + '>' + (run ? 'Sedang melatih…' : (info.status === 'trained' ? 'Latih ulang' : 'Latih model')) + '</button>' + (run ? ' <button class="btn ghost" type="button" id="ls-stop">Hentikan</button>' : '') + '</div></div>' +
            (!window.tf ? '<p class="msg err">TensorFlow.js belum termuat (butuh internet ke cdn.jsdelivr.net). Muat ulang halaman saat online.</p>' : '<p class="msg">Training berjalan di browser Anda (tab ini harus tetap terbuka). Data diambil langsung dari Firebase.</p>') +
            (run ? '<div class="progress" role="progressbar" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div><p class="msg">' + esc(TR.phase) + (TR.epochs ? ' · epoch ' + TR.epoch + '/' + TR.epochs : '') + (TR.total && !TR.epochs ? ' · ' + TR.done + '/' + TR.total + ' potongan' : '') + (TR.loss != null ? ' · loss ' + f(TR.loss, 5) : '') + (TR.val_loss != null ? ' · val_loss ' + f(TR.val_loss, 5) : '') + '</p>' : '') +
            (TR.err && !run ? '<p class="msg err">' + esc(TR.err) + '</p>' : '') + (TR.ok && !run ? '<p class="msg good">' + esc(TR.ok) + '</p>' : '') + '</div>';
    }
    function bindTrain() {
        var src = $('#ls-src'); if (!src) return;
        var sync = function () { $('#ls-daybox').hidden = src.value !== 'firebase'; $('#ls-filebox').hidden = src.value !== 'csv'; };
        src.addEventListener('change', sync); sync();
    }
    function refreshTrainBox() { var tb = document.querySelector('.trainbox'); if (!tb) return; var keep = $('#ls-src') && $('#ls-src').value; tb.outerHTML = trainBox(INFO); if (keep && $('#ls-src')) $('#ls-src').value = keep; bindTrain(); }

    function paint() {
        var i = INFO, trained = i.status === 'trained';
        $('#ls-status').innerHTML = '<div class="toolbar" style="margin-bottom:12px"><span class="pill" style="--z:var(' + (trained ? '--ok' : '--dry') + ')">' + (trained ? 'Model terlatih' : 'Belum dilatih') + '</span>' + (trained ? '<span class="msg">Dilatih ' + U.fmtDate(i.trained_at) + '</span>' : '') + '</div>' +
            (trained ? '' : '<div class="mlerr"><b>Model LSTM belum dilatih</b><p>' + esc((i.requirements || {}).text || i.message) + '</p><p class="msg">Tidak ada metrik atau prediksi yang ditampilkan sebelum model benar-benar dilatih dari data sensor Anda.</p></div>') + trainBox(i); bindTrain();
        if (!trained) { $('#ls-main').innerHTML = ''; return; }
        var m = i.metrics || {}, base = i.baseline_persistence_mae || {}, h24 = i.horizon24;
        var rows = P.map(function (p) { var x = m[p.k] || {}; return '<tr><td>' + p.name + '</td><td>' + f(x.mae) + '</td><td>' + f(x.mse) + '</td><td>' + f(x.rmse) + '</td><td>' + f(x.r2) + '</td><td>' + f(base[p.k]) + '</td></tr>'; }).join('');
        var rows24 = h24 ? P.map(function (p) { var x = h24[p.k] || {}; return '<tr><td>' + p.name + '</td><td>' + f(x.mae) + '</td><td>' + f(x.rmse) + '</td><td>' + f(x.r2) + '</td></tr>'; }).join('') : '';
        $('#ls-main').innerHTML =
            '<div class="grid"><div class="col">' +
            '<article class="panel"><div class="panel-head"><h2>Evaluasi pada data uji</h2><span class="msg">satuan asli (°C / %)</span></div><div class="tablewrap"><table><thead><tr><th>Parameter</th><th>MAE</th><th>MSE</th><th>RMSE</th><th>R²</th><th>MAE jam-sebelumnya*</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<p class="msg" style="margin-top:8px">*Pembanding sederhana: menebak nilai jam berikutnya = nilai jam ini. Model hanya berguna bila MAE-nya lebih kecil. Metrik di atas untuk prediksi 1 jam ke depan.</p>' +
            (h24 ? '<h3 class="sub3">Prediksi 24 jam ke depan (rekursif), ' + h24.n_forecasts + ' percobaan</h3><div class="tablewrap"><table><thead><tr><th>Parameter</th><th>MAE</th><th>RMSE</th><th>R²</th></tr></thead><tbody>' + rows24 + '</tbody></table></div>' : '') + '</article>' +
            '<article class="panel"><div class="panel-head"><h2>Data aktual vs prediksi</h2><span class="msg">data uji, 1 jam ke depan</span></div>' + P.map(function (p) { return '<div class="subchart"><span class="label">' + p.name + '</span><div class="chart" id="ls-ch-' + p.k + '"></div></div>'; }).join('') + '</article>' +
            '<article class="panel"><div class="panel-head"><h2>Prediksi ke depan</h2><div class="toolbar"><button class="btn" type="button" id="ls-pred">Prediksi 24 jam ke depan</button></div></div><div id="ls-pred-out"><p class="msg">Menggunakan 24 jam data sensor terbaru dari Firebase sebagai input model.</p></div></article></div>' +
            '<aside class="col"><article class="panel"><div class="panel-head"><h2>Informasi model</h2></div>' + U.dl([
                ['Arsitektur', esc(i.architecture)], ['Input', i.window_hours + ' jam × ' + esc((i.features_in || []).join(', '))], ['Output', esc((i.features_out || []).join(', ')) + ' (jam berikutnya)'], ['Resolusi data', esc(i.resolution)],
                ['Optimizer', esc(i.optimizer)], ['Mesin', esc(i.engine || 'TensorFlow.js')], ['Parameter', i.params || '—'], ['Rentang data', U.fmtDate(i.data_from) + ' – ' + U.fmtDate(i.data_to)], ['Jam data valid', i.valid_hours]]) + '</article>' +
            '<article class="panel"><div class="panel-head"><h2>Hasil training</h2></div>' + U.dl([
                ['Data training', i.n_train], ['Data validasi', i.n_val], ['Data testing', i.n_test], ['Epoch dijalankan', i.epochs_run + ' dari maks. ' + i.epochs_requested], ['Epoch terbaik', i.best_epoch],
                ['Loss (MSE)', f(i.loss, 5)], ['Val loss', f(i.val_loss, 5)], ['Status', '<span class="pill" style="--z:var(--ok)">Terlatih</span>']]) + '<p class="msg" style="margin-top:8px">' + esc(i.notes || '') + '</p></article>' +
            '<article class="panel"><div class="panel-head"><h2>Kurva loss</h2></div><div class="chart" id="ls-loss"></div></article></aside></div>';
        var ts = i.test_series || {};
        P.forEach(function (p) {
            CH.line($('#ls-ch-' + p.k), { series: [{ name: 'Aktual', color: p.color, data: (ts.t || []).map(function (t, j) { return [t, ts.actual[p.k][j]]; }) }, { name: 'Prediksi', color: '--fg', dash: true, data: (ts.t || []).map(function (t, j) { return [t, ts.pred[p.k][j]]; }) }], h: 190, dec: 1, unit: p.unit, xFmt: tf, tipTime: tf, minSpan: p.k === 'suhu' ? 2 : 6, label: 'Aktual vs prediksi ' + p.name });
        });
        var hs = i.history || {};
        CH.line($('#ls-loss'), { series: [{ name: 'Loss', color: '--ok', data: (hs.loss || []).map(function (v, j) { return [j + 1, v]; }) }, { name: 'Val loss', color: '--dry', data: (hs.val_loss || []).map(function (v, j) { return [j + 1, v]; }) }], h: 190, dec: 4, xFmt: function (t) { return 'ep ' + Math.round(t); }, tipTime: function (t) { return 'Epoch ' + Math.round(t); }, yMin: 0, label: 'Kurva loss' });
        if (PRED) paintPred();
    }

    async function train() {
        var src = $('#ls-src').value, ep = Number($('#ls-ep').value) || 100, days = Number($('#ls-days').value) || 14, file = $('#ls-file') && $('#ls-file').files[0];
        if (src === 'csv' && !file) { core.toast('Pilih berkas CSV terlebih dahulu.'); return; }
        if (src === 'firebase') window.SeladaML.setDays(days);
        TR = { run: true, phase: 'mulai', epoch: 0, epochs: 0, loss: null, val_loss: null, done: 0, total: 0, err: '', ok: '' }; refreshTrainBox();
        try {
            await LSTM.train({ source: src, file: file, days: days, epochs: ep, progress: function (i) {
                TR.phase = i.phase || TR.phase; if (i.epochs !== undefined) { TR.epochs = i.epochs; TR.epoch = i.epoch; } if (i.total) { TR.done = i.done; TR.total = i.total; TR.epochs = 0; }
                if (i.loss !== undefined) { TR.loss = i.loss; TR.val_loss = i.val_loss; } refreshTrainBox();
            } });
            TR.run = false; TR.ok = 'Model tersimpan di browser ini.'; PRED = null; core.toast('Training selesai.'); window.SeladaFcPage.reset(); load();
        } catch (e) { TR.run = false; TR.err = e.message || String(e); refreshTrainBox(); }
    }

    var curTab = 'fc', tabSet = false;
    function tab(t) {
        curTab = t; tabSet = true;
        document.querySelectorAll('#ls-tabs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.t === t)); });
        $('#ls-tab-fc').hidden = t !== 'fc'; $('#ls-tab-model').hidden = t !== 'model';
        if (t === 'fc') window.SeladaFcPage.enter(); else { lastW = 0; paint(); }
    }
    function enter() {
        load();
        if (!tabSet && INFO && INFO.status !== 'trained') { tab('model'); return; }   // belum ada model: arahkan ke training
        if (curTab === 'fc') window.SeladaFcPage.enter();
    }

    async function predict() {
        var out = $('#ls-pred-out'), b = $('#ls-pred'); b.disabled = true; out.innerHTML = '<p class="msg">Memprediksi…</p>';
        try { PRED = await LSTM.predictHours(24); paintPred(); }
        catch (e) { PRED = null; out.innerHTML = U.errorBox(e); }
        finally { b.disabled = false; }
    }
    function paintPred() {
        var r = PRED, nh = r.next_hour;
        $('#ls-pred-out').innerHTML = '<p class="msg">Prediksi mulai ' + tf(nh.t) + ' · data lengkap terakhir ' + U.fmtDate(r.last_data_hour) + (r.lag_hours ? ' (' + r.lag_hours + ' jam lalu)' : '') + '</p>' +
            '<div class="stats">' + P.map(function (p) { var s = r.summary[p.k]; return '<div class="stat"><span class="label">' + p.name + ' jam ini</span><b>' + nh[p.k].toFixed(1) + ' ' + p.unit + '</b><small>24 jam: rata-rata ' + s.mean.toFixed(1) + ' · ' + s.min.toFixed(1) + '–' + s.max.toFixed(1) + '</small></div>'; }).join('') + '</div>' +
            P.map(function (p) { return '<div class="subchart"><span class="label">' + p.name + '</span><div class="chart" id="lp-' + p.k + '"></div></div>'; }).join('') + '<p class="msg">' + esc(r.disclaimer) + '</p>';
        P.forEach(function (p) {
            CH.line($('#lp-' + p.k), { series: [{ name: 'Aktual (per jam)', color: p.color, data: r.actual_recent.map(function (x) { return [x.t, x[p.k]]; }) }, { name: 'Prediksi LSTM', color: '--fg', dash: true, data: r.predictions.map(function (x) { return [x.t, x[p.k]]; }) }], h: 180, dec: 1, unit: p.unit, xFmt: tf, tipTime: tf, minSpan: p.k === 'suhu' ? 2 : 6, vline: r.predictions[0].t, vlineLabel: 'prediksi', label: 'Prediksi ' + p.name });
        });
    }
    window.addEventListener('selada-ml-cleared', function () { PRED = null; TR.ok = ''; window.SeladaFcPage.reset(); if (INFO) load(); });
    return { id: 'lstm', o: 80, g: 'Machine Learning', name: 'Model LSTM & Prediksi', sub: 'Prediksi 4 hari ke depan, training, dan evaluasi model LSTM', init: build, enter: enter, leave: function () { },
        render: function () { /* data dimuat dari backend saat halaman dibuka; hanya digambar ulang bila lebar berubah */
            var w = $('#p-lstm').clientWidth;
            if (curTab === 'fc') window.SeladaFcPage.render();
            else if (INFO && INFO.status === 'trained' && w && w !== lastW) { lastW = w; paint(); }
        },
        ic: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 15l3-4 2 2 3-5"/>' };
});
