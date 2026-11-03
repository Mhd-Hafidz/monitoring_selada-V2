/* Model CNN di browser (TensorFlow.js): klasifikasi kondisi tanaman dari gambar.
   Port dari backend/services/cnn_service.py. Kelas = nama folder/kelas yang Anda sediakan; tidak ada kategori karangan.
   Arsitektur:  "mobilenet" = MobileNetV2 (ImageNet, diunduh sekali) sebagai pengekstrak fitur + kepala Dense yang dilatih
                "custom"    = CNN kecil dari nol (tanpa unduhan, butuh data lebih banyak)
   Model tersimpan di IndexedDB, metadata di localStorage. */
(function () {
    'use strict';
    var ML = window.SeladaML, C = ML.C, E = ML.MLError;
    var MODEL_URL = 'indexeddb://selada-cnn', META_KEY = 'selada-cnn-meta', CLS_KEY = 'selada-cnn-classes';
    var LEVEL = { sehat: 0, perhatian: 1, berbahaya: 2 }, LEVEL_LABEL = ['Sehat', 'Perlu perhatian', 'Berbahaya'];
    var cache = { model: null, base: null, stamp: null }, TRAIN = { status: 'idle', cancel: false };

    function requirements() {
        return {
            layout: 'satu kelas = satu folder berisi foto (mis. sehat/, kekurangan_nutrisi/, bercak_daun/)',
            min_images_per_class: C.CNN_MIN_IMAGES_PER_CLASS, recommended_images_per_class: 100,
            example_classes: ['sehat', 'kekurangan_nutrisi', 'bercak_daun', 'layu'],
            text: 'Model CNN belum dilatih. Siapkan foto daun/tanaman selada yang sudah dilabeli per kelas (minimal ' + C.CNN_MIN_IMAGES_PER_CLASS + ' foto per kelas, disarankan 100+, minimal 2 kelas), lalu pilih folder/foto di bagian "Dataset & training".'
        };
    }
    function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (e) { return null; } }
    function modelInfo() {
        var m = readMeta(), tfOk = !!window.tf;
        if (!m) return { status: 'not_trained', tf_available: tfOk, requirements: requirements(), message: 'Model CNN belum dilatih. Belum ada hasil evaluasi.' };
        var o = Object.assign({}, m); o.tf_available = tfOk; return o;
    }

    /* ---------- status kelas (sehat/perhatian/berbahaya + saran), dapat diedit di UI ---------- */
    function defStatus(name) { return /sehat|healthy|normal|segar/i.test(name) ? 'sehat' : 'perhatian'; }
    function defAdvice(s) {
        return s === 'sehat' ? 'Tampilan tanaman tampak sehat. Lanjutkan pemantauan rutin.'
            : 'Periksa tanaman secara langsung (daun bagian atas dan bawah, batang, media tanam). Pisahkan tanaman yang terdampak bila perlu dan konsultasikan ke penyuluh pertanian.';
    }
    function readClassStatus() { try { return JSON.parse(localStorage.getItem(CLS_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function ensureClassStatus(names) {
        var d = readClassStatus(), ch = false;
        names.forEach(function (n) { if (!d[n]) { var s = defStatus(n); d[n] = { status: s, advice: defAdvice(s) }; ch = true; } });
        if (ch) { try { localStorage.setItem(CLS_KEY, JSON.stringify(d)); } catch (e) { } }
        return d;
    }
    function setClassStatus(name, status, advice) {
        var d = ensureClassStatus([name]);
        if (LEVEL[status] !== undefined) d[name].status = status;
        if (advice != null) d[name].advice = advice;
        try { localStorage.setItem(CLS_KEY, JSON.stringify(d)); } catch (e) { }
    }
    function classInfo(label) {
        var e = readClassStatus()[label] || { status: defStatus(label), advice: '' }, s = LEVEL[e.status] === undefined ? 'perhatian' : e.status;
        return { status: s, level: LEVEL[s], label: LEVEL_LABEL[LEVEL[s]], advice: e.advice || defAdvice(s) };
    }

    /* ---------- gambar ---------- */
    async function bitmapOf(blob) {
        if (blob.size > C.MAX_IMAGE_MB * 1048576) throw new E('image_too_large', 'Gambar terlalu besar (maks ' + C.MAX_IMAGE_MB + ' MB).');
        try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
        catch (e) { try { return await createImageBitmap(blob); } catch (e2) { throw new E('bad_image', 'Berkas bukan gambar yang valid (gunakan JPG, PNG, BMP, atau WebP).'); } }
    }
    /* Preprocessing identik untuk training dan inferensi: dekode RGB -> resize bilinear ke SxS (nilai 0..255). */
    function toTensor(bmp, S, flip) {
        var tf = ML.tf();
        return tf.tidy(function () {
            var t = tf.image.resizeBilinear(tf.browser.fromPixels(bmp).toFloat(), [S, S]);
            return flip ? tf.reverse(t, 1) : t;
        });
    }
    async function previewUrl(bmp, S, q) {
        var c = document.createElement('canvas'); c.width = S; c.height = S; c.getContext('2d').drawImage(bmp, 0, 0, S, S);
        return c.toDataURL('image/jpeg', q || 0.8);
    }
    function thumbUrl(bmp) {
        var k = 160 / Math.max(bmp.width, bmp.height, 1), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * Math.min(1, k))); c.height = Math.max(1, Math.round(bmp.height * Math.min(1, k)));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.7);
    }
    async function loadBase() {
        if (cache.base) return cache.base;
        if (!window.mobilenet) throw new E('tf_missing', 'Pustaka MobileNet belum termuat (butuh internet ke cdn.jsdelivr.net). Gunakan arsitektur "custom" atau periksa koneksi lalu muat ulang.');
        try { cache.base = await window.mobilenet.load({ version: 2, alpha: 1.0 }); }
        catch (e) { throw new E('mobilenet_download', 'Bobot MobileNetV2 gagal diunduh: ' + ((e && e.message) || e) + '. Periksa koneksi internet atau pakai arsitektur "custom".'); }
        return cache.base;
    }

    /* ---------- model ---------- */
    function buildHead(k) {
        var tf = ML.tf(), m = tf.sequential({ name: 'cnn_selada_head' });
        m.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [1280] }));
        m.add(tf.layers.dropout({ rate: 0.3 }));
        m.add(tf.layers.dense({ units: k, activation: 'softmax' }));
        m.compile({ optimizer: tf.train.adam(1e-3), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
        return m;
    }
    function buildCustom(k, S) {
        var tf = ML.tf(), L = tf.layers, m = tf.sequential({ name: 'cnn_selada_custom' });
        [32, 64, 128, 128].forEach(function (f, n) {
            m.add(L.conv2d(Object.assign({ filters: f, kernelSize: 3, padding: 'same', activation: 'relu' }, n === 0 ? { inputShape: [S, S, 3] } : {})));
            m.add(L.batchNormalization());
            m.add(L.maxPooling2d({ poolSize: 2 }));
        });
        m.add(L.globalAveragePooling2d({ dataFormat: 'channelsLast' }));
        m.add(L.dense({ units: 128, activation: 'relu' }));
        m.add(L.dropout({ rate: 0.4 }));
        m.add(L.dense({ units: k, activation: 'softmax' }));
        m.compile({ optimizer: tf.train.adam(1e-3), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
        return m;
    }
    function seededShuffle(arr, seed) {
        var a = arr.slice(), s = seed >>> 0;
        function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
        for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
    }
    /* Pembagian berstrata 70/15/15 -> {tr:[idx], va:[idx], te:[idx]} */
    function stratifiedSplit(labels, k) {
        var tr = [], va = [], te = [];
        for (var c = 0; c < k; c++) {
            var idx = seededShuffle(labels.map(function (l, i) { return l === c ? i : -1; }).filter(function (i) { return i >= 0; }), 42 + c);
            var nTe = Math.max(1, Math.round(idx.length * 0.15)), nVa = Math.max(1, Math.round(idx.length * 0.15));
            te = te.concat(idx.slice(0, nTe)); va = va.concat(idx.slice(nTe, nTe + nVa)); tr = tr.concat(idx.slice(nTe + nVa));
        }
        return { tr: seededShuffle(tr, 7), va: va, te: te };
    }
    function cancelTraining() { TRAIN.cancel = true; if (TRAIN.model) TRAIN.model.stopTraining = true; }

    /* Cadangan di browser: sama dengan backend/utils/evaluation.py classification(). */
    function localClassification(yt, yp, names) {
        var k = names.length, cm = [], ok = 0, per = {}, i, j;
        for (i = 0; i < k; i++) { cm.push(new Array(k).fill(0)); }
        for (i = 0; i < yt.length; i++) { cm[yt[i]][yp[i]]++; if (yt[i] === yp[i]) ok++; }
        names.forEach(function (c, a) {
            var tp = cm[a][a], fp = 0, fn = 0, sup = 0;
            for (j = 0; j < k; j++) { if (j !== a) { fp += cm[j][a]; fn += cm[a][j]; } sup += cm[a][j]; }
            var pr = tp + fp ? tp / (tp + fp) : 0, rc = tp + fn ? tp / (tp + fn) : 0;
            per[c] = { precision: pr, recall: rc, f1: pr + rc ? 2 * pr * rc / (pr + rc) : 0, support: sup };
        });
        return { accuracy: yt.length ? ok / yt.length : null, n: yt.length, per_class: per, confusion_matrix: cm, classes: names.slice() };
    }
    /* classes: {nama: [File,...]}; opt: {arch:'mobilenet'|'custom', epochs, batch, progress(info)} */
    async function train(classes, opt) {
        opt = opt || {};
        if (TRAIN.status === 'running') throw new E('busy', 'Training CNN sedang berjalan.');
        var tf = ML.tf(), say = opt.progress || function () { }, arch = opt.arch === 'custom' ? 'custom' : 'mobilenet';
        var names = Object.keys(classes).filter(function (n) { return classes[n].length; }).sort(), counts = {};
        names.forEach(function (n) { counts[n] = classes[n].length; });
        if (names.length < 2) throw new E('few_classes', 'Butuh minimal 2 kelas yang berisi gambar.', { requirements: requirements() });
        var small = names.filter(function (n) { return counts[n] < C.CNN_MIN_IMAGES_PER_CLASS; });
        if (small.length) throw new E('few_images', 'Kelas dengan gambar terlalu sedikit (minimal ' + C.CNN_MIN_IMAGES_PER_CLASS + '): ' + small.map(function (n) { return n + '=' + counts[n]; }).join(', '), { requirements: requirements() });
        var epochs = Math.max(1, Math.min(200, Math.round(Number(opt.epochs) || (arch === 'custom' ? 30 : 25)))), batch = opt.batch || 16;
        var S = arch === 'custom' ? 128 : 224, k = names.length;
        TRAIN.status = 'running'; TRAIN.cancel = false;
        var skipped = [], toDispose = [], live = [], trainedModel = null, saved = false;
        try {
            await ML.ready();
            var base = arch === 'mobilenet' ? (say({ phase: 'mengunduh MobileNetV2' }), await loadBase()) : null;
            // 1) muat semua gambar -> fitur (mobilenet) atau tensor (custom), asli + dibalik horizontal
            var files = [], labels = [];
            names.forEach(function (n, ci) { classes[n].forEach(function (f) { files.push(f); labels.push(ci); }); });
            var feat = new Array(files.length), featFlip = new Array(files.length), keep = [];
            for (var i = 0; i < files.length; i++) {
                if (TRAIN.cancel) throw new E('cancelled', 'Training dihentikan.');
                say({ phase: 'memproses gambar', epoch: 0, done: i, total: files.length });
                try {
                    var bmp = await bitmapOf(files[i]);
                    var t = toTensor(bmp, S, false), tfp = toTensor(bmp, S, true);
                    if (arch === 'mobilenet') {
                        // infer(..., true) mengembalikan [1,1280]; diratakan jadi [1280] agar tf.stack -> [N,1280] (sesuai input kepala Dense)
                        feat[i] = tf.tidy(function () { return base.infer(t, true).reshape([-1]); });
                        featFlip[i] = tf.tidy(function () { return base.infer(tfp, true).reshape([-1]); });
                        t.dispose(); tfp.dispose();
                    } else { feat[i] = tf.tidy(function () { return t.div(255); }); featFlip[i] = tf.tidy(function () { return tfp.div(255); }); t.dispose(); tfp.dispose(); }
                    if (bmp.close) bmp.close(); keep.push(i);
                } catch (e) { skipped.push(files[i].name || ('#' + i)); }
                if (i % 5 === 4) await tf.nextFrame();
            }
            var lab = keep.map(function (i) { return labels[i]; }), F0 = keep.map(function (i) { return feat[i]; }), F1 = keep.map(function (i) { return featFlip[i]; });
            toDispose = F0.concat(F1);
            counts = {}; names.forEach(function (n, ci) { counts[n] = lab.filter(function (l) { return l === ci; }).length; });
            if (names.some(function (n) { return counts[n] < C.CNN_MIN_IMAGES_PER_CLASS; })) throw new E('few_images', 'Setelah gambar rusak dibuang, ada kelas di bawah ' + C.CNN_MIN_IMAGES_PER_CLASS + ' gambar: ' + JSON.stringify(counts));
            // 2) split berstrata
            var sp = stratifiedSplit(lab, k);
            // latih: asli + dibalik, seimbangkan kelas dengan oversampling
            var maxN = Math.max.apply(null, names.map(function (n, ci) { return sp.tr.filter(function (i) { return lab[i] === ci; }).length; }));
            var trList = [];
            for (var c = 0; c < k; c++) {
                var ids = sp.tr.filter(function (i) { return lab[i] === c; }), pool = [];
                ids.forEach(function (i) { pool.push([i, 0]); pool.push([i, 1]); });
                for (var r = 0; r < maxN * 2; r++) trList.push(pool[r % pool.length]);
            }
            trList = seededShuffle(trList, 11);
            var stack = function (list, flipped) { return tf.stack(list.map(function (p) { return (flipped === undefined ? p[1] : flipped) ? F1[p[0]] : F0[p[0]]; })); };
            var xTr = stack(trList), yTr = tf.oneHot(tf.tensor1d(trList.map(function (p) { return lab[p[0]]; }), 'int32'), k).toFloat();
            var xVa = stack(sp.va.map(function (i) { return [i, 0]; })), yVa = tf.oneHot(tf.tensor1d(sp.va.map(function (i) { return lab[i]; }), 'int32'), k).toFloat();
            var xTe = stack(sp.te.map(function (i) { return [i, 0]; })), yTeIdx = sp.te.map(function (i) { return lab[i]; });
            live = [xTr, yTr, xVa, yVa, xTe];
            // 3) latih
            var model = arch === 'mobilenet' ? buildHead(k) : buildCustom(k, S); TRAIN.model = model; trainedModel = model;
            var hist = { loss: [], val_loss: [], accuracy: [], val_accuracy: [] }, best = Infinity, bestW = null, wait = 0;
            say({ phase: 'melatih', epoch: 0, epochs: epochs });
            await model.fit(xTr, yTr, {
                epochs: epochs, batchSize: batch, shuffle: true, validationData: [xVa, yVa], verbose: 0,
                callbacks: {
                    onEpochEnd: async function (ep, logs) {
                        var acc = logs.acc !== undefined ? logs.acc : logs.accuracy, vacc = logs.val_acc !== undefined ? logs.val_acc : logs.val_accuracy;
                        hist.loss.push(logs.loss); hist.val_loss.push(logs.val_loss); hist.accuracy.push(acc); hist.val_accuracy.push(vacc);
                        if (logs.val_loss < best) { best = logs.val_loss; wait = 0; if (bestW) bestW.forEach(function (w) { w.dispose(); }); bestW = model.getWeights().map(function (w) { return w.clone(); }); }
                        else if (++wait >= 5) model.stopTraining = true;
                        if (TRAIN.cancel) model.stopTraining = true;
                        say({ phase: 'melatih', epoch: ep + 1, epochs: epochs, loss: logs.loss, val_loss: logs.val_loss, accuracy: acc, val_accuracy: vacc });
                        await tf.nextFrame();
                    }
                }
            });
            [xTr, yTr, xVa, yVa].forEach(function (t) { t.dispose(); });
            if (TRAIN.cancel) { xTe.dispose(); model.dispose(); trainedModel = null; throw new E('cancelled', 'Training dihentikan. Model sebelumnya (jika ada) tidak diubah.'); }
            if (bestW) { model.setWeights(bestW); bestW.forEach(function (w) { w.dispose(); }); }
            say({ phase: 'evaluasi' });
            var probs = tf.tidy(function () { return model.predict(xTe).argMax(1).dataSync(); });
            xTe.dispose();
            var test;
            try { test = await window.SeladaAPI.post('/api/evaluate/classification', { y_true: Array.from(yTeIdx), y_pred: Array.from(probs), names: names }); }
            catch (apiErr) { test = localClassification(Array.from(yTeIdx), Array.from(probs), names); }   // server Python tidak bisa dihubungi / rute tidak ada: hitung di browser agar model tetap tersimpan
            try { await model.save(MODEL_URL); } catch (e) { throw new E('storage_failed', 'Model tidak bisa disimpan di browser (IndexedDB dinonaktifkan atau penuh): ' + ((e && e.message) || e)); }
            ensureClassStatus(names);
            var n = hist.loss.length, meta = {
                status: 'trained', trained_at: new Date().toISOString(), arch: arch, pretrained_imagenet: arch === 'mobilenet', img_size: S, class_names: names, images_per_class: counts,
                n_train: sp.tr.length, n_val: sp.va.length, n_test: sp.te.length, epochs_run: n, loss: hist.loss[n - 1], val_loss: hist.val_loss[n - 1], accuracy: hist.accuracy[n - 1], val_accuracy: hist.val_accuracy[n - 1],
                history: hist, test: test, skipped_unreadable: skipped, engine: 'TensorFlow.js (' + tf.getBackend() + ')',
                notes: 'Metrik uji dihitung pada 15% gambar yang tidak dipakai melatih (split berstrata). Data latih ditambah versi cermin horizontal.'
            };
            try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { throw new E('storage_full', 'Penyimpanan browser penuh; metadata model tidak bisa disimpan.'); }
            if (cache.model) { try { cache.model.dispose(); } catch (e) { } }
            cache.model = model; cache.stamp = meta.trained_at; saved = true;
            say({ phase: 'selesai' });
            return modelInfo();
        } finally {
            toDispose.forEach(function (t) { try { t.dispose(); } catch (e) { } });
            live.forEach(function (t) { try { if (!t.isDisposed) t.dispose(); } catch (e) { } });   // sisa tensor bila training gagal di tengah jalan
            if (trainedModel && !saved) { try { trainedModel.dispose(); } catch (e) { } }
            TRAIN.status = 'idle'; TRAIN.model = null;
        }
    }

    async function loadModel() {
        var meta = readMeta();
        if (!meta) throw new E('model_not_trained', 'Model CNN belum dilatih.', { requirements: requirements(), hint: 'Siapkan dataset gambar lalu latih dari halaman Model CNN.' });
        if (cache.model && cache.stamp === meta.trained_at) return { model: cache.model, meta: meta };
        var tf = ML.tf(); await ML.ready();
        try { cache.model = await tf.loadLayersModel(MODEL_URL); }
        catch (e) { throw new E('model_not_trained', 'Berkas model CNN tidak ditemukan di penyimpanan browser. Latih ulang.', { requirements: requirements() }); }
        cache.stamp = meta.trained_at; return { model: cache.model, meta: meta };
    }
    async function deleteModel() {
        try { localStorage.removeItem(META_KEY); } catch (e) { }
        if (cache.model) { try { cache.model.dispose(); } catch (e) { } }
        cache.model = null; cache.stamp = null;
        if (window.tf) { try { await window.tf.io.removeModel(MODEL_URL); } catch (e) { } }
    }

    /* ESP32-CAM: foto diambil langsung dari browser (/capture). Perlu CORS dari kamera dan halaman bukan https. */
    async function fetchCamera(ip) {
        var host = String(ip || '').trim().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '');
        if (!/^[\w.\-]+(:\d+)?$/.test(host)) throw new E('bad_camera_ip', 'IP kamera tidak valid (contoh 192.168.1.23).');
        if (location.protocol === 'https:') throw new E('mixed_content', 'Halaman dibuka lewat https sehingga browser memblokir permintaan ke kamera http. Buka dashboard dari file lokal atau http://localhost, atau unggah foto secara manual.');
        var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, 8000);
        try {
            var res = await fetch('http://' + host + '/capture', { signal: ctrl.signal, cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.blob();
        } catch (e) { throw new E('camera_unreachable', 'Browser tidak bisa mengambil foto dari kamera ' + host + ' (' + ((e && e.name === 'AbortError') ? 'waktu habis' : (e && e.message) || e) + '). Pastikan satu jaringan dan firmware kamera mengizinkan CORS; atau unduh foto lalu unggah manual.'); }
        finally { clearTimeout(to); }
    }

    /* image: Blob/File atau {ip}. Setara POST /api/cnn/classify */
    /* Analisis visual daun dari piksel (heuristik warna, bukan pengukuran fisik). */
    function leafStats(bmp) {
        var N = 128, c = document.createElement('canvas'); c.width = N; c.height = N; var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, N, N);
        var d = x.getImageData(0, 0, N, N).data, g = 0, y = 0, sat = 0, tot = N * N;
        for (var i = 0; i < d.length; i += 4) {
            var r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
            if (gg > r * 1.05 && gg > b * 1.1 && gg > 40) { g++; sat += mx ? (mx - mn) / mx : 0; }
            else if (r > 120 && gg > 100 && r >= gg * 0.85 && b < gg * 0.7) y++;
        }
        var leaf = g + y;
        return { coverage: g / tot, yellow: leaf ? y / leaf : 0, greenness: g ? sat / g : 0 };
    }
    function readiness(names, probs) {
        var W = [[/siap/i, 95], [/mendekati/i, 70], [/pertumbuhan|bibit|tumbuh/i, 30]], s = 0, w = 0;
        names.forEach(function (n, i) { var m = W.filter(function (q) { return q[0].test(n); })[0]; if (m) { s += probs[i] * m[1]; w += probs[i]; } });
        return w > 0.5 ? Math.round(s / w) : null;
    }
    async function classify(image) {
        var blob = image && image.ip ? await fetchCamera(image.ip) : image;
        var L = await loadModel(), meta = L.meta, S = meta.img_size, tf = ML.tf(), bmp = await bitmapOf(blob), t = toTensor(bmp, S, false), probs;
        try {
            if (meta.arch === 'mobilenet') {
                var base = await loadBase();
                probs = tf.tidy(function () { return L.model.predict(base.infer(t, true)).dataSync(); });
            } else probs = tf.tidy(function () { return L.model.predict(t.div(255).expandDims(0)).dataSync(); });
        } finally { t.dispose(); }
        var classes = meta.class_names, order = Array.from(probs).map(function (p, i) { return i; }).sort(function (a, b) { return probs[b] - probs[a]; });
        var top = order[0], label = classes[top], conf = probs[top], info = classInfo(label), unc = conf < C.CNN_UNCERTAIN_BELOW;
        var res = {
            label: label, confidence: Math.round(conf * 1e4) / 1e4, uncertain: unc,
            probabilities: order.map(function (i) { return { label: classes[i], confidence: Math.round(probs[i] * 1e4) / 1e4 }; }),
            status: { level: info.level, label: info.label, key: info.status }, advice: info.advice,
            preprocessing: {
                original_size: [bmp.width, bmp.height], model_input: [S, S],
                steps: ['Dekode gambar ke RGB (' + bmp.width + '×' + bmp.height + 'px, orientasi EXIF dikoreksi)', 'Resize bilinear ke ' + S + '×' + S + 'px',
                    meta.arch === 'mobilenet' ? 'Normalisasi piksel oleh MobileNetV2 (skala −1..1), lalu klasifikasi dengan kepala Dense hasil training' : 'Normalisasi piksel (dibagi 255, skala 0..1)'],
                preview: await previewUrl(bmp, Math.min(S, 224))
            },
            thumbnail: thumbUrl(bmp), leaf: leafStats(bmp), readiness: readiness(classes, probs),
            model: { arch: meta.arch, trained_at: meta.trained_at, test_accuracy: (meta.test || {}).accuracy, classes: classes },
            analyzed_at: new Date().toISOString(),
            disclaimer: 'Hasil klasifikasi bergantung pada kelas dan kualitas dataset latih; model tidak bisa mengenali masalah di luar kelasnya. Gambar non-tanaman tetap akan dipaksa masuk ke salah satu kelas.'
        };
        if (bmp.close) bmp.close();
        return res;
    }

    window.SeladaCNN = {
        requirements: requirements, modelInfo: modelInfo, readMeta: readMeta, train: train, cancelTraining: cancelTraining, loadModel: loadModel, deleteModel: deleteModel,
        classify: classify, classInfo: classInfo, readClassStatus: readClassStatus, ensureClassStatus: ensureClassStatus, setClassStatus: setClassStatus, stratifiedSplit: stratifiedSplit, fetchCamera: fetchCamera
    };
})();
