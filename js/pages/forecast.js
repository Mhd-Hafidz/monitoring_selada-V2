/* Halaman Prediksi 4 Hari: hasil nyata dari model LSTM lewat backend (POST /api/predict/four-days). */
(window.SeladaModules = window.SeladaModules || []).push(function (core) {
    'use strict';
    var $ = function (s) { return document.querySelector(s); };
    var FC = window.SeladaForecast, CH = window.SeladaCharts, ST = window.SeladaStatus, U = window.SeladaUI, esc = U.esc;
    var R = null, busy = false, lastW = 0;
    var P = [{ k: 'suhu', name: 'Suhu udara', color: '--temp' }, { k: 'udara', name: 'Kelembapan udara', color: '--wet' }, { k: 'tanah', name: 'Kelembapan tanah', color: '--ok' }];
    function val(p, v) { return p === 'suhu' ? core.tc(v) : v; }
    function unit(p) { return p === 'suhu' ? core.tu() : '%'; }
    function dd(iso) { var d = new Date(iso); return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + String(d.getHours()).padStart(2, '0') + ':00'; }
    var tf = function (t) { var d = new Date(t); return d.getDate() + '/' + (d.getMonth() + 1) + ' ' + String(d.getHours()).padStart(2, '0') + ':00'; };

    var HOST = '#ls-tab-fc';
    function build() {
        $(HOST).innerHTML = '<div class="col"><div class="toolbar"><button class="btn" type="button" id="fc-go">Perbarui prediksi</button><span class="msg" id="fc-info"></span></div><div id="fc-out"></div></div>';
        $('#fc-go').addEventListener('click', run);
    }
    /* Belum ada model: jelaskan langkahnya, jangan biarkan tab kosong. */
    function hint() {
        $('#fc-out').innerHTML = '<article class="panel"><div class="mlerr"><b>Model LSTM belum dilatih</b><p>Prediksi 4 hari butuh model yang dilatih dari data sensor Anda. Buka tab "Model &amp; Evaluasi", lalu tekan "Latih model" (minimal sekitar 6 hari data berurutan, disarankan 14 hari).</p></div></article>';
    }
    async function run() {
        if (busy) return; busy = true; $('#fc-go').disabled = true; $('#fc-info').textContent = 'Memprediksi 96 jam ke depan…';
        try { R = await FC.fourDays(ST.thresholds(core.settings())); $('#fc-info').textContent = ''; paint(); }
        catch (e) { R = null; $('#fc-info').textContent = ''; $('#fc-out').innerHTML = '<article class="panel">' + U.errorBox(e) + '</article>'; }
        finally { busy = false; $('#fc-go').disabled = false; }
    }
    function paint() {
        var r = R, th = ST.thresholds(core.settings());
        var cards = r.days.map(function (d) {
            return '<article class="panel daycard" style="--z:var(' + ST.COLORS[d.level] + ')"><div class="panel-head"><h2>Hari ke-' + d.day + '</h2>' + ST.pill(d.level) + '</div><p class="msg">' + dd(d.start) + ' – ' + dd(d.end) + '</p><ul class="dayvals">' +
                P.map(function (p) { var x = d.params[p.k]; return '<li><span class="label">' + p.name + '</span><b>' + val(p.k, x.mean).toFixed(1) + ' ' + unit(p.k) + '</b>' + ST.pill(x.level) + '</li>'; }).join('') + '</ul></article>';
        }).join('');
        var tbl = r.days.map(function (d) {
            return '<tr><td>Hari ke-' + d.day + '</td><td>' + dd(d.start) + '</td>' + P.map(function (p) { var x = d.params[p.k]; return '<td>' + val(p.k, x.mean).toFixed(1) + ' <small>(' + val(p.k, x.min).toFixed(1) + '–' + val(p.k, x.max).toFixed(1) + ')</small></td>'; }).join('') + '<td>' + ST.pill(d.level) + '</td></tr>';
        }).join('');
        $('#fc-out').innerHTML =
            '<article class="panel"><div class="overall" style="--z:var(' + ST.COLORS[r.summary.level] + ')"><b>' + ST.cap(r.summary.level) + '</b><span>' + esc(r.summary.text) + '</span></div>' +
            (r.summary.notes.length ? '<ul class="notes">' + r.summary.notes.slice(0, 8).map(function (n) { return '<li><span>' + esc(n) + '</span></li>'; }).join('') + '</ul>' : '') +
            '<p class="msg" style="margin-top:8px">Dibuat ' + U.fmtDate(r.generated_at) + ' dari data lengkap terakhir ' + U.fmtDate(r.last_data_hour) + (r.lag_hours ? ' (' + r.lag_hours + ' jam lalu)' : '') + '. Hari ke-1 = 24 jam pertama dari jam ini.</p></article>' +
            '<div class="daygrid">' + cards + '</div>' +
            P.map(function (p) { return '<article class="panel"><div class="panel-head"><h2>Prediksi ' + p.name.toLowerCase() + ' · 4 hari</h2></div><div class="chart" id="fcc-' + p.k + '"></div></article>'; }).join('') +
            '<article class="panel"><div class="panel-head"><h2>Tabel prediksi harian</h2><span class="msg">rata-rata (min–maks per jam)</span></div><div class="tablewrap"><table><thead><tr><th>Hari</th><th>Mulai</th><th>Suhu ' + core.tu() + '</th><th>Udara %</th><th>Tanah %</th><th>Kondisi</th></tr></thead><tbody>' + tbl + '</tbody></table></div></article>' +
            '<article class="panel"><p class="hint"><b>Catatan:</b> ' + esc(r.disclaimer) + ' Model: dilatih ' + U.fmtDate(r.model.trained_at) + ' dengan ' + (r.model.n_train || '—') + ' sampel latih. Status memakai batas dari Pengaturan/Peringatan.</p></article>';
        P.forEach(function (p) {
            var bands = [], lines = [];
            if (p.k === 'tanah') { bands = [{ lo: th.dry, hi: th.wet }]; lines = [{ v: th.dry }, { v: th.wet }]; }
            else if (p.k === 'suhu') { bands = [{ lo: core.tc(th.tmin), hi: core.tc(th.tmax) }]; lines = [{ v: core.tc(th.tmin) }, { v: core.tc(th.tmax) }]; }
            else { bands = [{ lo: th.hmin, hi: ST.margins.humMax }]; lines = [{ v: th.hmin }]; }
            CH.line($('#fcc-' + p.k), { series: [
                { name: 'Aktual (48 jam)', color: p.color, data: r.actual_recent.map(function (x) { return [x.t, val(p.k, x[p.k])]; }) },
                { name: 'Prediksi per jam', color: '--fg', dash: true, data: r.hourly.map(function (x) { return [x.t, val(p.k, x[p.k])]; }) },
                { name: 'Rata-rata harian', color: p.color, markers: true, width: 1.5, data: r.days.map(function (d) { return [(new Date(d.start).getTime() + new Date(d.end).getTime()) / 2, val(p.k, d.params[p.k].mean)]; }) }
            ], h: 230, dec: 1, unit: unit(p.k), bands: bands, lines: lines, includeBands: true, xFmt: tf, tipTime: tf, minSpan: p.k === 'suhu' ? 2 : 6, vline: r.hourly[0].t, vlineLabel: 'prediksi', label: 'Prediksi ' + p.name });
        });
    }
    /* Bagian dari halaman "Model LSTM & Prediksi" (js/pages/lstm.js); tidak punya menu sendiri. */
    window.SeladaFcPage = {
        init: build,
        enter: function () {
            if (!window.SeladaLSTM.readMeta()) { hint(); return; }
            if (!R && !busy) run();
        },
        render: function () { var el = $(HOST), w = el && el.clientWidth; if (R && w && w !== lastW) { lastW = w; paint(); } },
        reset: function () { R = null; if (window.SeladaLSTM.readMeta()) $('#fc-out').innerHTML = ''; else hint(); }
    };
});
