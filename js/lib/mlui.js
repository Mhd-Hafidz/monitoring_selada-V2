/* Potongan UI bersama untuk halaman yang memakai backend Python. */
(function () {
    'use strict';
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    function f(v, d) { return v === null || v === undefined || !isFinite(v) ? '—' : Number(v).toFixed(d === undefined ? 3 : d); }
    /* Kotak penjelasan galat dari backend; tidak pernah menampilkan hasil pengganti. */
    function errorBox(e) {
        var d = (e && e.data) || {}, code = e && e.code, titles = { tf_missing: 'TensorFlow.js belum termuat', model_not_trained: 'Model belum dilatih', firebase_unreachable: 'Firebase tidak terbaca', backend_unreachable: 'Server Python tidak tersambung', dataset_expired: 'Data evaluasi hilang di server', stale_data: 'Data sensor sudah usang', not_enough_data: 'Data belum cukup', cancelled: 'Dihentikan' };
        var h = '<div class="mlerr"><b>' + esc(titles[code] || 'Tidak bisa diproses') + '</b><p>' + esc((e && e.message) || String(e)) + '</p>';
        if (code === 'backend_unreachable') h += '<ol><li>Jalankan <code>python backend/app.py</code> (lihat README).</li><li>Buka halaman dari <code>http://localhost:5000</code>, atau isi alamat server di Pengaturan.</li></ol>';
        if (code === 'tf_missing') h += '<ol><li>Pastikan perangkat terhubung ke internet (pustaka dimuat dari cdn.jsdelivr.net).</li><li>Muat ulang halaman.</li></ol>';
        if (d.requirements && d.requirements.text) h += '<p class="msg">' + esc(d.requirements.text) + '</p>';
        if (d.hint) h += '<p class="msg">' + esc(d.hint) + '</p>';
        if (code === 'not_enough_data' && d.have_windows !== undefined) h += '<p class="msg">Jendela saat ini: ' + esc(d.have_windows) + ' dari minimal ' + esc(d.min_windows) + '.</p>';
        return h + '</div>';
    }
    function dl(pairs) { return '<dl>' + pairs.map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>'; }
    function fmtDate(iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString('id-ID'); }
    window.SeladaUI = { esc: esc, f: f, errorBox: errorBox, dl: dl, fmtDate: fmtDate };
})();
