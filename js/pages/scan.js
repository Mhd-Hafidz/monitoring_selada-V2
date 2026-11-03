/* Halaman Scan Gabungan: sensor Firebase + LSTM + CNN dianalisis backend, lalu digabung (POST /api/scan/combined). */
(window.SeladaModules = window.SeladaModules || []).push(function (core) {
    'use strict';
    var $ = function (s) { return document.querySelector(s); };
    var SC = window.SeladaScan, ST = window.SeladaStatus, U = window.SeladaUI, esc = U.esc;
    var II = null, busy = false;
    var P = [{ k: 'suhu', name: 'Suhu udara' }, { k: 'udara', name: 'Kelembapan udara' }, { k: 'tanah', name: 'Kelembapan tanah' }];
    function val(p, v) { return p === 'suhu' ? core.tc(v) : v; }
    function unit(p) { return p === 'suhu' ? core.tu() : '%'; }
    function section(title, body, pillHtml) { return '<article class="panel"><div class="panel-head"><h2>' + title + '</h2>' + (pillHtml || '') + '</div>' + body + '</article>'; }
    function unavailable(p, what) { return '<div class="mlerr soft"><b>' + what + ' tidak tersedia</b><p>' + esc(p.message) + '</p></div>'; }

    function build() {
        $('#p-scan').innerHTML = '<div class="col"><article class="panel"><div class="panel-head"><h2>Scan Gabungan</h2></div>' +
            '<p class="hint" style="margin-bottom:12px">Mengambil data sensor terbaru dari Firebase, menganalisisnya dengan LSTM, mengklasifikasikan gambar dengan CNN (semuanya berjalan di browser), lalu menggabungkan hasilnya. Gambar bersifat opsional; tanpa gambar, bagian CNN dilaporkan tidak tersedia.</p>' +
            '<div id="sc-input"></div><div class="toolbar" style="margin-top:12px"><button class="btn" type="button" id="sc-go">Mulai Scan Gabungan</button><span class="msg" id="sc-msg"></span></div></article><div id="sc-out"></div></div>';
        II = SeladaImageInput.create($('#sc-input'), { toast: core.toast, camIp: function () { return core.settings().camIp; } });
        $('#sc-go').addEventListener('click', run);
    }
    async function run() {
        if (busy) return; busy = true; $('#sc-go').disabled = true; $('#sc-msg').textContent = 'Memindai…';
        try { var r = await SC.scan(II.value(), ST.thresholds(core.settings())); $('#sc-msg').textContent = ''; paint(r); }
        catch (e) { $('#sc-msg').textContent = ''; $('#sc-out').innerHTML = '<article class="panel">' + U.errorBox(e) + '</article>'; }
        finally { busy = false; $('#sc-go').disabled = false; }
    }
    function paint(r) {
        var s = r.sensor, rd = s.reading, c = r.combined, l = r.lstm, n = r.cnn, cur = II.current();
        var sensorHtml = '<div class="stats">' + P.map(function (p) { var a = s.assessment.params[p.k]; return '<div class="stat"><span class="label">' + p.name + '</span><b>' + val(p.k, rd[p.k]).toFixed(1) + ' ' + unit(p.k) + '</b><small>' + ST.pill(a.level) + '</small></div>'; }).join('') + '</div>' +
            '<p class="msg">Pembacaan ' + U.fmtDate(rd.time_iso) + ' (' + Math.round(rd.age_s) + ' detik lalu) · perangkat ' + (rd.online ? '<b>online</b>' : '<b style="color:var(--bad)">offline</b>') + '</p>';
        var lstmHtml;
        if (!l.available) lstmHtml = unavailable(l, 'Analisis LSTM');
        else {
            lstmHtml = '<p class="msg">' + esc(l.historical.text) + '</p><div class="tablewrap"><table><thead><tr><th>Parameter</th><th>24 jam terakhir (rata-rata)</th><th>Prediksi jam depan</th><th>Prediksi 24 jam (rata-rata)</th><th>Selisih vs sekarang</th><th>Kondisi</th></tr></thead><tbody>' +
                P.map(function (p) { var h = l.historical.stats[p.k], d = l.next_24h[p.k], dv = l.trend_vs_now[p.k]; return '<tr><td>' + p.name + '</td><td>' + val(p.k, h.mean).toFixed(1) + '</td><td>' + val(p.k, l.next_hour[p.k]).toFixed(1) + '</td><td>' + val(p.k, d.mean).toFixed(1) + ' ' + unit(p.k) + '</td><td>' + (dv > 0 ? '+' : '') + (p.k === 'suhu' && core.settings().unit === 'F' ? dv * 1.8 : dv).toFixed(1) + '</td><td>' + ST.pill(d.level) + '</td></tr>'; }).join('') + '</tbody></table></div>';
        }
        var cnnHtml;
        if (!n.available) cnnHtml = unavailable(n, 'Analisis CNN');
        else cnnHtml = '<div class="cnnres"><div class="imgs"><figure><img alt="Gambar dipindai" src="' + (cur && cur.url ? cur.url : n.thumbnail) + '"></figure></div><div><div class="bigres"><b>' + esc(n.label) + '</b><span>' + (n.confidence * 100).toFixed(1) + '%</span></div>' + (n.uncertain ? '<p class="msg err">Hasil tidak pasti (confidence rendah).</p>' : '') +
            '<div class="bars">' + n.probabilities.slice(0, 5).map(function (p) { return '<div class="bar"><span>' + esc(p.label) + '</span><i style="--w:' + (p.confidence * 100).toFixed(1) + '%"></i><em>' + (p.confidence * 100).toFixed(1) + '%</em></div>'; }).join('') + '</div></div></div>';
        var sensorLv = s.assessment.level;
        $('#sc-out').innerHTML =
            '<article class="panel overallpanel" style="--z:var(' + ST.COLORS[c.level] + ')"><div class="overall"><b>' + esc(c.health) + '</b><span>' + esc(c.summary) + '</span></div>' + (c.partial ? '<p class="msg err" style="margin-top:8px">' + esc(c.partial_note) + '</p>' : '') + '<p class="msg" style="margin-top:6px">' + U.fmtDate(r.generated_at) + '</p></article>' +
            '<div class="pair" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))">' +
            section('Data sensor', sensorHtml, ST.pill(sensorLv)) +
            section('Hasil Model CNN', cnnHtml, n.available ? ST.pill(n.effective_level, n.status.label) : '<span class="pill">Tidak tersedia</span>') + '</div>' +
            section('Hasil Model LSTM', lstmHtml, l.available ? ST.pill(l.status.level) : '<span class="pill">Tidak tersedia</span>') +
            section('Hasil Scan Gabungan', '<h3 class="sub3" style="margin-top:0">Faktor yang perlu diperhatikan</h3>' + (c.factors.length ? '<ul class="notes">' + c.factors.map(function (f) { return '<li>' + ST.pill(f.level) + ' <span><b>' + { sensor: 'Sensor', lstm: 'LSTM', cnn: 'CNN' }[f.source] + ':</b> ' + esc(f.text) + '</span></li>'; }).join('') + '</ul>' : '<p class="msg">Tidak ada faktor yang melewati batas.</p>') +
                '<h3 class="sub3">Rekomendasi tindakan</h3><ol class="plain">' + c.recommendations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol><p class="hint" style="margin-top:10px">' + esc(c.method) + ' Rekomendasi berasal dari aturan tetap atas hasil di atas, bukan jaminan diagnosis.</p>', ST.pill(c.level, c.health));
    }
    return { id: 'scan', o: 110, g: 'Machine Learning', name: 'Scan Gabungan', sub: 'Sensor + LSTM + CNN dalam satu pemeriksaan tanaman', init: build, leave: function () { if (II) II.stop(); }, render: function () { },
        ic: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>' };
});
