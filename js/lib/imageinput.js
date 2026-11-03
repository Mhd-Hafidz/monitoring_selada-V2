/* Input gambar bersama (halaman CNN dan Scan Gabungan): unggah berkas, kamera perangkat, atau ESP32-CAM via backend. */
(function () {
    'use strict';
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var MAX = 10 * 1024 * 1024;

    function create(host, opt) {
        var id = 'ii' + Math.random().toString(36).slice(2, 7), cur = null, stream = null, mode = 'file', cbs = [];
        host.innerHTML =
            '<div class="seg" role="group" aria-label="Sumber gambar"><button type="button" data-m="file" aria-pressed="true">Unggah gambar</button><button type="button" data-m="cam" aria-pressed="false">Kamera perangkat</button><button type="button" data-m="esp" aria-pressed="false">ESP32-CAM</button></div>' +
            '<div class="ii-pane" data-p="file"><label class="dropzone" id="' + id + '-dz" for="' + id + '-f"><b>Seret gambar ke sini</b><span>atau klik untuk memilih (JPG, PNG, BMP, WebP · maks 10 MB)</span></label><input type="file" id="' + id + '-f" accept="image/*" hidden>' +
            '<div class="toolbar" style="margin-top:8px"><label class="btn ghost small" for="' + id + '-c">Foto dengan kamera HP</label><input type="file" id="' + id + '-c" accept="image/*" capture="environment" hidden></div></div>' +
            '<div class="ii-pane" data-p="cam" hidden><div class="camwrap"><video id="' + id + '-v" playsinline muted></video></div><div class="toolbar" style="margin-top:8px"><button class="btn ghost" type="button" id="' + id + '-on">Nyalakan kamera</button><button class="btn" type="button" id="' + id + '-snap" disabled>Ambil gambar</button></div><p class="msg" id="' + id + '-cm"></p></div>' +
            '<div class="ii-pane" data-p="esp" hidden><div class="field" style="border:0;padding-top:0"><div class="t"><b>IP ESP32-CAM</b><span>Browser mengambil foto dari <code>/capture</code> (satu jaringan dengan kamera; halaman jangan dibuka lewat https).</span></div><div class="ctl"><input type="text" id="' + id + '-ip" placeholder="192.168.1.23" inputmode="decimal" autocomplete="off"><button class="btn" type="button" id="' + id + '-use">Pakai kamera ini</button></div></div></div>' +
            '<div class="ii-prev" id="' + id + '-pv" hidden></div>';
        var $ = function (s) { return host.querySelector('#' + id + s); };
        function changed() { cbs.forEach(function (f) { f(cur); }); }
        function preview() {
            var pv = $('-pv'); pv.hidden = !cur;
            if (!cur) { pv.innerHTML = ''; return; }
            if (cur.type === 'blob') pv.innerHTML = '<img alt="Gambar yang akan dianalisis" src="' + cur.url + '"><button class="btn ghost small" type="button" id="' + id + '-x">Hapus gambar</button>';
            else pv.innerHTML = '<p class="msg">Foto akan diambil dari ESP32-CAM <b>' + esc(cur.ip) + '</b> oleh browser saat analisis dimulai.</p><button class="btn ghost small" type="button" id="' + id + '-x">Batalkan</button>';
            $('-x').addEventListener('click', function () { clear(); });
        }
        function setBlob(blob) {
            if (!/^image\//.test(blob.type || 'image/jpeg')) { opt.toast('Berkas harus berupa gambar.'); return; }
            if (blob.size > MAX) { opt.toast('Gambar terlalu besar (maks 10 MB).'); return; }
            if (cur && cur.url) URL.revokeObjectURL(cur.url);
            cur = { type: 'blob', blob: blob, url: URL.createObjectURL(blob), name: blob.name || 'foto.jpg' }; preview(); changed();
        }
        function clear() { if (cur && cur.url) URL.revokeObjectURL(cur.url); cur = null; preview(); changed(); }
        function stop() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } var v = $('-v'); if (v) v.srcObject = null; if ($('-snap')) $('-snap').disabled = true; if ($('-on')) $('-on').textContent = 'Nyalakan kamera'; }
        host.querySelector('.seg').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return; mode = b.dataset.m;
            host.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            host.querySelectorAll('.ii-pane').forEach(function (p) { p.hidden = p.dataset.p !== mode; });
            if (mode !== 'cam') stop();
            if (mode === 'esp' && !$('-ip').value) $('-ip').value = (opt.camIp && opt.camIp()) || '';
        });
        $('-f').addEventListener('change', function () { if (this.files[0]) setBlob(this.files[0]); this.value = ''; });
        $('-c').addEventListener('change', function () { if (this.files[0]) setBlob(this.files[0]); this.value = ''; });
        var dz = $('-dz');
        ['dragenter', 'dragover'].forEach(function (n) { dz.addEventListener(n, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
        ['dragleave', 'drop'].forEach(function (n) { dz.addEventListener(n, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
        dz.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) setBlob(f); });
        $('-on').addEventListener('click', async function () {
            if (stream) { stop(); return; }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('-cm').className = 'msg err'; $('-cm').textContent = 'Kamera perangkat butuh koneksi aman (https atau http://localhost) dan browser yang mendukung.'; return; }
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
                var v = $('-v'); v.srcObject = stream; await v.play(); $('-snap').disabled = false; this.textContent = 'Matikan kamera'; $('-cm').className = 'msg'; $('-cm').textContent = '';
            } catch (e) { $('-cm').className = 'msg err'; $('-cm').textContent = 'Kamera tidak bisa dibuka: ' + (e && e.name === 'NotAllowedError' ? 'izin ditolak.' : (e && e.message) || 'tidak tersedia.'); stop(); }
        });
        $('-snap').addEventListener('click', function () {
            var v = $('-v'); if (!v.videoWidth) return;
            var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
            c.toBlob(function (b) { if (b) { b.name = 'kamera.jpg'; setBlob(b); stop(); } }, 'image/jpeg', 0.92);
        });
        $('-use').addEventListener('click', function () {
            var ip = $('-ip').value.trim().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '');
            if (!ip) { opt.toast('Isi IP ESP32-CAM.'); return; }
            if (cur && cur.url) URL.revokeObjectURL(cur.url);
            cur = { type: 'esp', ip: ip }; preview(); changed();
        });
        return {
            has: function () { return !!cur; },
            /* Tambahkan gambar/IP terpilih ke FormData. */
            appendTo: function (fd) {
                if (!cur) return false;
                if (cur.type === 'blob') fd.append('image', cur.blob, cur.name || 'foto.jpg'); else fd.append('camera_ip', cur.ip);
                return true;
            },
            /* Blob/File gambar, atau {ip} untuk ESP32-CAM, atau null. */
            value: function () { return !cur ? null : (cur.type === 'blob' ? cur.blob : { ip: cur.ip }); },
            current: function () { return cur; }, clear: clear, stop: stop, onChange: function (f) { cbs.push(f); }
        };
    }
    window.SeladaImageInput = { create: create };
})();
