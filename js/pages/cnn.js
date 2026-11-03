/* Halaman Model CNN: dataset, training, dan klasifikasi gambar tanaman di browser (TensorFlow.js). */
(window.SeladaModules = window.SeladaModules || []).push(function (core) {
    'use strict';
    var $ = function (s) { return document.querySelector(s); };
    var CNN = window.SeladaCNN, ST = window.SeladaStatus, U = window.SeladaUI, esc = U.esc, f = U.f;
    var INFO = null, II = null, HKEY = 'selada-cnn-hist', busy = false, DS = {}, TR = { run: false, phase: '', epoch: 0, epochs: 0, done: 0, total: 0, loss: null, val_loss: null, accuracy: null, val_accuracy: null, err: '', ok: '' };
    var IMG = /\.(jpe?g|png|bmp|webp)$/i;
    function hist() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } }
    function saveHist(a) { try { localStorage.setItem(HKEY, JSON.stringify(a.slice(0, 30))); } catch (e) { core.toast('Riwayat tidak bisa disimpan di browser ini.'); } }

    function build() {
        $('#p-cnn').innerHTML = '<div class="grid"><div class="col">' +
            '<article class="panel"><div class="panel-head"><h2>Dataset &amp; training</h2><button class="btn ghost small" type="button" id="cn-dsclear">Kosongkan dataset</button></div><div id="cn-train"></div></article>' +
            '<article class="panel"><div class="panel-head"><h2>Analisis gambar tanaman</h2></div><div id="cn-input"></div><div class="toolbar" style="margin-top:12px"><button class="btn" type="button" id="cn-go" disabled>Analisis dengan CNN</button><span class="msg" id="cn-msg"></span></div></article>' +
            '<div id="cn-result"></div>' +
            '<article class="panel"><div class="panel-head"><h2>Riwayat klasifikasi</h2><button class="btn ghost small" type="button" id="cn-hclear">Hapus riwayat</button></div><div class="tablewrap"><table><thead><tr><th>Gambar</th><th>Waktu</th><th>Kelas</th><th>Confidence</th><th>Status</th></tr></thead><tbody id="cn-hist"></tbody></table></div></article></div>' +
            '<aside class="col"><article class="panel"><div class="panel-head"><h2>Status model</h2><button class="btn ghost small" type="button" id="cn-reload">Muat ulang</button></div><div id="cn-status"></div></article><article class="panel" id="cn-clspanel" hidden><div class="panel-head"><h2>Status &amp; saran per kelas</h2></div><div id="cn-cls"></div></article></aside></div>';
        II = SeladaImageInput.create($('#cn-input'), { toast: core.toast, camIp: function () { return core.settings().camIp; } });
        II.onChange(function () { sync(); });
        $('#cn-go').addEventListener('click', analyze);
        $('#cn-reload').addEventListener('click', load);
        $('#cn-dsclear').addEventListener('click', function () { if (!TR.run) { DS = {}; paintTrain(); } });
        $('#p-cnn').addEventListener('click', function (e) {
            var id = e.target.id;
            if (id === 'cn-fit') fit();
            if (id === 'cn-stop') CNN.cancelTraining();
            if (id === 'cn-del' && confirm('Hapus model CNN yang tersimpan di browser ini?')) CNN.deleteModel().then(function () { TR.ok = ''; load(); });
            if (id === 'cn-addcls') addManual();
            if (e.target.dataset && e.target.dataset.rm !== undefined && !TR.run) { delete DS[e.target.dataset.rm]; paintTrain(); }
        });
        $('#p-cnn').addEventListener('change', function (e) {
            if (e.target.id === 'cn-folder') { addFolder(e.target.files); e.target.value = ''; }
            if (e.target.dataset && e.target.dataset.cls) {
                var n = e.target.dataset.cls, cur = CNN.classInfo(n);
                if (e.target.dataset.f === 'status') CNN.setClassStatus(n, e.target.value, null); else CNN.setClassStatus(n, cur.status, e.target.value);
                if (e.target.dataset.f === 'status') paintClasses();
            }
        });
        var P = $('#p-cnn'), hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; };
        P.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; var z = e.target.closest && e.target.closest('.dropzone'); P.querySelectorAll('.dropzone.over').forEach(function (d) { if (d !== z) d.classList.remove('over'); }); if (z) z.classList.add('over'); });
        P.addEventListener('dragleave', function (e) { var z = e.target.closest && e.target.closest('.dropzone'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
        P.addEventListener('drop', function (e) {
            if (!hasFiles(e)) return; e.preventDefault(); P.querySelectorAll('.dropzone.over').forEach(function (d) { d.classList.remove('over'); });
            if (e.target.closest && e.target.closest('#cn-drop')) dropDataset(e.dataTransfer);   // zona gambar tunggal ditangani imageinput.js
        });
        paintTrain();
        $('#cn-hclear').addEventListener('click', function () { saveHist([]); paintHist(); });
        paintHist();
    }
    var NOMODEL = 'Model CNN belum dilatih. Latih dulu di panel "Dataset & training" (minimal 2 kelas), lalu gambar bisa dianalisis.';
    function sync() {
        var trained = !!(INFO && INFO.status === 'trained');
        $('#cn-go').disabled = busy || !II.has() || !trained;
        var m = $('#cn-msg'); if (busy) return;
        if (!trained) { m.className = 'msg err'; m.textContent = NOMODEL; }
        else if (m.textContent === NOMODEL) { m.className = 'msg'; m.textContent = ''; }
    }

    function load() { INFO = CNN.modelInfo(); paintStatus(); paintClasses(); sync(); }

    /* ---------- dataset & training ---------- */
    function addFolder(files) {
        var n = 0;
        Array.prototype.forEach.call(files, function (f) {
            if (!(IMG.test(f.name) || /^image\//.test(f.type))) return;
            var parts = (f.webkitRelativePath || '').split('/'), cls = parts.length >= 3 ? parts[parts.length - 2] : (parts.length === 2 ? parts[0] : '');
            if (!cls) return; (DS[cls] = DS[cls] || []).push(f); n++;
        });
        if (!n) core.toast('Tidak ada gambar dengan struktur folder-per-kelas. Pilih folder yang berisi sub-folder kelas, atau pakai "Tambah kelas".');
        paintTrain();
    }
    async function walk(entry, out) {
        if (entry.isFile) { await new Promise(function (r) { entry.file(function (f) { out.push({ f: f, path: entry.fullPath }); r(); }, r); }); }
        else if (entry.isDirectory) {
            var rd = entry.createReader(), all = [], b;
            do { b = await new Promise(function (r) { rd.readEntries(r, function () { r([]); }); }); all = all.concat(Array.prototype.slice.call(b)); } while (b.length);
            for (var i = 0; i < all.length; i++) await walk(all[i], out);
        }
    }
    async function dropDataset(dt) {
        if (TR.run) return;
        var items = Array.prototype.slice.call(dt.items || []), ents = items.map(function (i) { return i.webkitGetAsEntry && i.webkitGetAsEntry(); }).filter(Boolean), out = [];
        if (ents.length) { for (var i = 0; i < ents.length; i++) await walk(ents[i], out); }
        else Array.prototype.forEach.call(dt.files || [], function (f) { out.push({ f: f, path: '/' + f.name }); });
        var loose = ($('#cn-newname') && $('#cn-newname').value.trim().replace(/[\/]/g, '_')) || '', n = 0, skipped = 0;
        out.forEach(function (o) {
            if (!(IMG.test(o.f.name) || /^image\//.test(o.f.type))) return;
            var parts = o.path.split('/').filter(Boolean), cls = parts.length >= 2 ? parts[parts.length - 2] : loose;
            if (!cls) { skipped++; return; } (DS[cls] = DS[cls] || []).push(o.f); n++;
        });
        if (!n) core.toast(skipped ? 'Foto lepas butuh nama kelas: isi kolom "tambah satu kelas" dulu, atau seret folder per kelas.' : 'Tidak ada gambar yang terbaca. Seret folder yang berisi foto (JPG/PNG/WebP).');
        else core.toast(n + ' foto ditambahkan.');
        paintTrain();
    }
    function addManual() {
        var nm = $('#cn-newname').value.trim().replace(/[\/]/g, '_'), fl = $('#cn-newfiles').files;
        if (!nm || !fl.length) { core.toast('Isi nama kelas dan pilih foto-fotonya.'); return; }
        Array.prototype.forEach.call(fl, function (f) { if (IMG.test(f.name) || /^image\//.test(f.type)) (DS[nm] = DS[nm] || []).push(f); });
        paintTrain();
    }
    var THUMB = new WeakMap();
    function thumbOf(f) { var u = THUMB.get(f); if (!u) { u = URL.createObjectURL(f); THUMB.set(f, u); } return u; }
    function previews(n) {
        return '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">' + DS[n].slice(0, 6).map(function (f) { return '<img alt="" loading="lazy" src="' + thumbOf(f) + '" style="width:44px;height:44px;object-fit:cover;border-radius:6px">'; }).join('') + (DS[n].length > 6 ? '<span class="msg" style="align-self:center">+' + (DS[n].length - 6) + '</span>' : '') + '</div>';
    }
    function paintTrain() {
        var names = Object.keys(DS).sort(), ok = names.length >= 2 && names.every(function (n) { return DS[n].length >= window.SeladaML.C.CNN_MIN_IMAGES_PER_CLASS; });
        var rows = names.map(function (n) { return '<tr><td>' + esc(n) + previews(n) + '</td><td>' + DS[n].length + (DS[n].length < window.SeladaML.C.CNN_MIN_IMAGES_PER_CLASS ? ' <small>(kurang dari ' + window.SeladaML.C.CNN_MIN_IMAGES_PER_CLASS + ')</small>' : '') + '</td><td><button class="btn ghost small" type="button" data-rm="' + esc(n) + '"' + (TR.run ? ' disabled' : '') + '>Hapus</button></td></tr>'; }).join('');
        var pct = TR.run ? (TR.epochs ? Math.round(TR.epoch / TR.epochs * 100) : (TR.total ? Math.round(TR.done / TR.total * 100) : 0)) : 0;
        var dis = TR.run ? ' disabled' : '';
        var keepArch = $('#cn-arch') && $('#cn-arch').value, keepEp = $('#cn-ep') && $('#cn-ep').value, keepMode = $('#cn-mode') && $('#cn-mode').value, keepName = $('#cn-newname') && $('#cn-newname').value;   // jangan reset pilihan pengguna saat daftar kelas berubah
        $('#cn-train').innerHTML =
            '<p class="hint" style="margin-bottom:10px">Satu kelas = satu folder foto (mis. <code>sehat</code>, <code>bercak_daun</code>, <code>kekurangan_nutrisi</code>). Minimal 2 kelas, minimal ' + window.SeladaML.C.CNN_MIN_IMAGES_PER_CLASS + ' foto per kelas (disarankan 100+). Foto tidak dikirim ke mana pun; semua diproses di browser ini.</p>' +
            '<label class="dropzone" id="cn-drop" for="cn-folder" style="margin:0 0 10px"><b>Seret folder dataset ke sini</b><span>folder berisi sub-folder per kelas (mis. sehat/, bercak_daun/), atau klik untuk memilih</span></label>' +
            '<div class="filters"><div><label class="label" for="cn-folder">Pilih folder dataset (berisi sub-folder kelas)</label><input type="file" id="cn-folder" webkitdirectory multiple' + dis + '></div></div>' +
            '<div class="filters" style="margin-top:8px"><div><label class="label" for="cn-newname">…atau tambah satu kelas</label><input type="text" id="cn-newname" placeholder="nama_kelas"' + dis + '></div><div><label class="label" for="cn-newfiles">Foto kelas</label><input type="file" id="cn-newfiles" accept="image/*" multiple' + dis + '></div><div class="fbtn"><button class="btn ghost" type="button" id="cn-addcls"' + dis + '>Tambah kelas</button></div></div>' +
            (names.length ? '<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Kelas</th><th>Jumlah foto</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="msg" style="margin-top:10px">Dataset masih kosong.</p>') +
            '<div class="filters" style="margin-top:12px"><div><label class="label" for="cn-arch">Arsitektur</label><select id="cn-arch"' + dis + '><option value="mobilenet">MobileNetV2 (transfer learning, disarankan; unduh bobot sekali ± 14 MB)</option><option value="custom">CNN dari nol (tanpa unduhan, butuh data lebih banyak)</option></select></div>' +
            '<div><label class="label" for="cn-mode">Mode latih</label><select id="cn-mode"' + dis + '><option value="auto">Otomatis (disarankan)</option><option value="fast">Cepat (uji coba)</option><option value="deep">Teliti (lebih lama)</option><option value="manual">Atur sendiri</option></select></div>' +
            '<div id="cn-epbox" hidden><label class="label" for="cn-ep">Epoch maks.</label><input type="number" id="cn-ep" value="25" min="1" max="200"' + dis + '></div>' +
            '<div class="fbtn"><button class="btn" type="button" id="cn-fit"' + (TR.run || !ok || !window.tf ? ' disabled' : '') + '>' + (TR.run ? 'Sedang melatih…' : 'Latih model CNN') + '</button>' + (TR.run ? ' <button class="btn ghost" type="button" id="cn-stop">Hentikan</button>' : '') + '</div></div>' +
            (!TR.run && window.tf && !ok ? '<p class="msg err">' + (names.length < 2 ? 'Tombol Latih aktif setelah ada minimal 2 kelas berisi foto.' : 'Setiap kelas butuh minimal ' + window.SeladaML.C.CNN_MIN_IMAGES_PER_CLASS + ' foto.') + '</p>' : '') +
            (!window.tf ? '<p class="msg err">TensorFlow.js belum termuat (butuh internet ke cdn.jsdelivr.net). Muat ulang halaman saat online.</p>' : '') +
            (TR.run ? '<div class="progress" role="progressbar" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div><p class="msg">' + esc(TR.phase) + (TR.total && !TR.epochs ? ' · ' + TR.done + '/' + TR.total + ' gambar' : '') + (TR.epochs ? ' · epoch ' + TR.epoch + '/' + TR.epochs : '') + (TR.loss != null ? ' · loss ' + f(TR.loss, 4) : '') + (TR.val_accuracy != null ? ' · val acc ' + (TR.val_accuracy * 100).toFixed(1) + '%' : '') + '</p>' : '') +
            (TR.err && !TR.run ? '<p class="msg err">' + esc(TR.err) + '</p>' : '') + (TR.ok && !TR.run ? '<p class="msg good">' + esc(TR.ok) + '</p>' : '');
        if (keepArch) $('#cn-arch').value = keepArch;
        if (keepEp) $('#cn-ep').value = keepEp;
        if (keepMode) $('#cn-mode').value = keepMode;
        var syncMode = function () { $('#cn-epbox').hidden = $('#cn-mode').value !== 'manual'; };
        $('#cn-mode').addEventListener('change', syncMode); syncMode();
        if (keepName && !TR.run) $('#cn-newname').value = keepName;
    }
    async function fit() {
        var arch = $('#cn-arch').value, mode = $('#cn-mode').value, cu = arch === 'custom',
            ep = mode === 'manual' ? (Number($('#cn-ep').value) || 25) : ({ auto: cu ? 30 : 25, fast: cu ? 12 : 10, deep: cu ? 80 : 60 })[mode];
        TR = { run: true, phase: 'mulai', epoch: 0, epochs: 0, done: 0, total: 0, loss: null, val_loss: null, accuracy: null, val_accuracy: null, err: '', ok: '' }; paintTrain();
        try {
            await CNN.train(DS, { arch: arch, epochs: ep, progress: function (i) {
                TR.phase = i.phase || TR.phase;
                if (i.total) { TR.done = i.done; TR.total = i.total; TR.epochs = 0; }
                if (i.epochs) { TR.epochs = i.epochs; TR.epoch = i.epoch; }
                if (i.loss !== undefined) { TR.loss = i.loss; TR.val_loss = i.val_loss; TR.accuracy = i.accuracy; TR.val_accuracy = i.val_accuracy; }
                var keepSel = $('#cn-arch') && $('#cn-arch').value; paintTrain(); if (keepSel && $('#cn-arch')) $('#cn-arch').value = keepSel;
            } });
            TR.run = false; TR.ok = 'Model tersimpan di browser ini.'; core.toast('Training CNN selesai.'); load();
        } catch (e) { TR.run = false; TR.err = e.message || String(e); }
        paintTrain(); if (arch) $('#cn-arch').value = arch;
    }
    function paintClasses() {
        var i = INFO, box = $('#cn-cls'), pnl = $('#cn-clspanel');
        if (!i || i.status !== 'trained') { pnl.hidden = true; return; }
        pnl.hidden = false;
        box.innerHTML = '<p class="msg">Tentukan kelas mana yang termasuk sehat / perlu perhatian / berbahaya dan saran tindakannya. Dipakai di hasil klasifikasi dan Scan Gabungan.</p>' + i.class_names.map(function (c) {
            var ci = CNN.classInfo(c);
            return '<div class="field" style="padding:8px 0"><div class="t"><b>' + esc(c) + '</b></div><div class="ctl"><select data-cls="' + esc(c) + '" data-f="status" aria-label="Status ' + esc(c) + '">' + ['sehat', 'perhatian', 'berbahaya'].map(function (s) { return '<option value="' + s + '"' + (ci.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select><input type="text" data-cls="' + esc(c) + '" data-f="advice" value="' + esc(ci.advice) + '" aria-label="Saran ' + esc(c) + '"></div></div>';
        }).join('');
    }
    function paintStatus() {
        var i = INFO, box = $('#cn-status');
        if (i.status !== 'trained') {
            var r = i.requirements || {};
            box.innerHTML = '<span class="pill" style="--z:var(--dry)">Belum dilatih</span><div class="mlerr"><b>Model CNN belum dilatih</b><p>' + esc(r.text || i.message) + '</p></div>' +
                '<ol class="steps small"><li><div>Susun foto: <code>' + esc(r.layout) + '</code></div></li><li><div>Contoh kelas: ' + esc((r.example_classes || []).join(', ') + ' (nama kelas bebas)') + '</div></li><li><div>Pilih folder di bagian "Dataset &amp; training", lalu tekan "Latih model CNN".</div></li></ol>' +
                (i.tf_available === false ? '<p class="msg err">TensorFlow.js belum termuat.</p>' : '');
            return;
        }
        var t = i.test || {}, rows = Object.keys(t.per_class || {}).map(function (c) { var x = t.per_class[c]; return '<tr><td>' + esc(c) + '</td><td>' + f(x.precision, 2) + '</td><td>' + f(x.recall, 2) + '</td><td>' + f(x.f1, 2) + '</td><td>' + x.support + '</td></tr>'; }).join('');
        var cm = t.confusion_matrix || [], cls = t.classes || [];
        box.innerHTML = '<span class="pill" style="--z:var(--ok)">Terlatih</span>' + U.dl([['Arsitektur', esc(i.arch) + (i.pretrained_imagenet ? ' (ImageNet)' : '')], ['Ukuran input', i.img_size + '×' + i.img_size], ['Kelas', esc((i.class_names || []).join(', '))], ['Data latih / val / uji', i.n_train + ' / ' + i.n_val + ' / ' + i.n_test], ['Epoch', i.epochs_run], ['Akurasi uji', t.accuracy != null ? (t.accuracy * 100).toFixed(1) + ' %' : '—'], ['Dilatih', U.fmtDate(i.trained_at)], ['Mesin', esc(i.engine || 'TensorFlow.js')]]) + '<div class="toolbar" style="margin-top:8px"><button class="btn ghost small" type="button" id="cn-del">Hapus model</button></div>' +
            '<h3 class="sub3">Per kelas (data uji)</h3><div class="tablewrap"><table><thead><tr><th>Kelas</th><th>Presisi</th><th>Recall</th><th>F1</th><th>n</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<h3 class="sub3">Confusion matrix (baris = sebenarnya)</h3><div class="tablewrap"><table class="corr"><tbody><tr><td></td>' + cls.map(function (c) { return '<td class="label">' + esc(c) + '</td>'; }).join('') + '</tr>' + cm.map(function (r, a) { return '<tr><td class="label">' + esc(cls[a]) + '</td>' + r.map(function (v, b) { return '<td style="background:color-mix(in srgb,var(' + (a === b ? '--ok' : '--bad') + ') ' + (v ? 30 : 0) + '%,transparent)">' + v + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    }

    async function analyze() {
        if (busy || !II.has()) return;
        busy = true; sync(); $('#cn-msg').className = 'msg'; $('#cn-msg').textContent = 'Menganalisis…';
        try {
            var r = await CNN.classify(II.value());
            $('#cn-msg').textContent = ''; paintResult(r);
            var h = hist(); h.unshift({ t: Date.now(), label: r.label, conf: r.confidence, level: r.status.level, unc: r.uncertain, thumb: r.thumbnail }); saveHist(h); paintHist();
        } catch (e) { $('#cn-msg').textContent = ''; $('#cn-result').innerHTML = '<article class="panel">' + U.errorBox(e) + '</article>'; }
        finally { busy = false; sync(); }
    }
    function paintResult(r) {
        var cur = II.current(), pre = r.preprocessing || {};
        var lf = r.leaf || {}, pc = function (v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; };
        var kpi = [['Tahap (CNN)', esc(r.label)], ['Keyakinan', (r.confidence * 100).toFixed(0) + '%'], ['Indeks kesiapan panen', r.readiness == null ? '—' : r.readiness + '/100']].map(function (k) { return '<article class="panel"><span class="label">' + k[0] + '</span><h2 style="font-size:1.5em;margin-top:6px">' + k[1] + '</h2></article>'; }).join('');
        var vis = [['Tutupan daun pada foto', pc(lf.coverage), 'Persentase area foto berwarna hijau'], ['Tingkat daun menguning', pc(lf.yellow), 'Porsi area daun yang kekuningan'], ['Kepekatan warna hijau', pc(lf.greenness), 'Saturasi rata-rata area hijau']].map(function (k) { return '<article class="panel"><span class="label">' + k[0] + '</span><h2 style="font-size:1.5em;margin:6px 0">' + k[1] + '</h2><p class="msg">' + k[2] + '</p></article>'; }).join('');
        $('#cn-result').innerHTML = '<div class="daygrid">' + kpi + '</div><div class="daygrid">' + vis + '</div><article class="panel"><div class="panel-head"><h2>Hasil klasifikasi</h2>' + ST.pill(r.status.level, r.status.label) + '</div>' +
            '<div class="cnnres"><div class="imgs"><figure><img alt="Gambar asli" src="' + (cur && cur.url ? cur.url : r.thumbnail) + '"><figcaption class="label">Gambar asli</figcaption></figure><figure><img alt="Hasil preprocessing" src="' + pre.preview + '"><figcaption class="label">Setelah preprocessing</figcaption></figure></div>' +
            '<div><div class="bigres"><b>' + esc(r.label) + '</b><span>' + (r.confidence * 100).toFixed(1) + '%</span></div>' + (r.uncertain ? '<p class="msg err">Confidence di bawah 60%: hasil tidak pasti. Ambil ulang foto dengan cahaya cukup.</p>' : '') +
            '<div class="bars">' + r.probabilities.map(function (p) { return '<div class="bar"><span>' + esc(p.label) + '</span><i style="--w:' + (p.confidence * 100).toFixed(1) + '%"></i><em>' + (p.confidence * 100).toFixed(1) + '%</em></div>'; }).join('') + '</div></div></div>' +
            '<h3 class="sub3">Informasi hasil analisis</h3><p>' + esc(r.advice) + '</p><h3 class="sub3">Preprocessing</h3><ol class="plain">' + (pre.steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
            '<p class="hint" style="margin-top:10px">' + esc(r.disclaimer) + '</p></article>';
    }
    function paintHist() {
        var h = hist();
        $('#cn-hist').innerHTML = h.length ? h.map(function (x) { return '<tr><td><img class="hthumb" alt="" src="' + x.thumb + '"></td><td>' + new Date(x.t).toLocaleString('id-ID') + '</td><td>' + esc(x.label) + '</td><td>' + (x.conf * 100).toFixed(1) + ' %' + (x.unc ? ' <small>(tidak pasti)</small>' : '') + '</td><td>' + ST.pill(x.level) + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="empty" style="text-align:center">Belum ada riwayat.</td></tr>';
    }
    window.addEventListener('selada-ml-cleared', function () { if (INFO) load(); $('#cn-result').innerHTML = ''; });
    return { id: 'cnn', o: 100, g: 'Machine Learning', name: 'Model CNN', sub: 'Klasifikasi kondisi tanaman dari gambar', init: build, enter: load, leave: function () { if (II) II.stop(); }, render: function () { },
        ic: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>' };
});
