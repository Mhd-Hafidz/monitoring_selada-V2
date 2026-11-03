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
    /* ---- Kematangan tanaman (estimasi dari umur / HST) ---- */
    var STG = [{ k: 'grow', name: 'Masa Pertumbuhan', max: 66.5, color: '--wet' }, { k: 'near', name: 'Mendekati Panen', max: 89, color: '--temp' }, { k: 'ready', name: 'Siap Panen', max: 101, color: '--ok' }];
    function stage(m) { return STG.filter(function (s) { return m < s.max; })[0]; }
    function plantCfg() { var c = window.SeladaML.read(); return { date: c.plant_date || '', harvest: Math.max(20, Math.min(90, Number(c.harvest_days) || 45)) }; }
    function ageOf(date) { return date ? Math.max(1, Math.floor((Date.now() - new Date(date + 'T00:00:00').getTime()) / 864e5) + 1) : 0; }
    function mat(dap, harvest) { return Math.max(0, Math.min(100, dap / harvest * 100)); }
    function spill(s) { return '<span class="pill" style="--z:var(' + s.color + ')">' + s.name + '</span>'; }
    function ageCard() {
        var c = plantCfg(), age = ageOf(c.date);
        return '<article class="panel agecard"><div class="panel-head"><div><span class="label">Umur tanaman saat ini</span><h2 style="font-size:1.6em">' + (age ? 'Hari ke-' + age : 'Tanggal tanam belum diisi') + '</h2>' + (c.date ? '<p class="msg">Tanam pada: ' + new Date(c.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) + '</p>' : '') + '</div>' +
            '<div class="filters"><div><label class="label" for="fc-plant">Tanggal tanam</label><input type="date" id="fc-plant" value="' + c.date + '"></div><div><label class="label" for="fc-harv">Umur panen (HST)</label><input type="number" id="fc-harv" min="20" max="90" value="' + c.harvest + '"></div></div></div>' +
            '<p class="msg">Tingkat kematangan = umur tanaman ÷ umur panen (estimasi). Masa Pertumbuhan &lt; 66,5% · Mendekati Panen 66,5–89% · Siap Panen ≥ 89%.</p></article>';
    }
    function bindAge() {
        var save = function () { var o = window.SeladaML.read(); o.plant_date = $('#fc-plant').value; o.harvest_days = Number($('#fc-harv').value) || 45; window.SeladaML.write(o); paint(); };
        $('#fc-plant').addEventListener('change', save); $('#fc-harv').addEventListener('change', save);
    }
    function rows() {
        var c = plantCfg(), age = ageOf(c.date), r = R;
        return r.days.map(function (d, i) { var m = age ? mat(age + d.day, c.harvest) : null; return { day: d.day, tanah: d.params.tanah.mean, suhu: val('suhu', d.params.suhu.mean), udara: d.params.udara.mean, level: d.level, hst: age ? age + d.day : null, m: m, st: m == null ? null : stage(m) }; });
    }
    function csv() {
        var s = 'hari,hst,kelembapan_tanah,suhu,kelembapan_udara,kematangan_persen,tahap\n';
        rows().forEach(function (x) { s += ['+' + x.day, x.hst == null ? '' : x.hst, x.tanah.toFixed(1), x.suhu.toFixed(1), x.udara.toFixed(1), x.m == null ? '' : x.m.toFixed(1), x.st ? x.st.name : ''].join(',') + '\n'; });
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' })); a.download = 'prediksi_4_hari.csv'; document.body.appendChild(a); a.click(); a.remove();
    }
    function paint() {
        var r = R, th = ST.thresholds(core.settings()), c = plantCfg(), age = ageOf(c.date), X = rows(), last = X[X.length - 1];
        var cards = X.map(function (x) {
            return '<article class="panel daycard" style="--z:var(' + (x.st ? x.st.color : '--wet') + ')"><div class="panel-head"><h2>Hari ke-' + (x.hst || '+' + x.day) + '</h2>' + (x.st ? spill(x.st) : '') + '</div>' +
                '<p class="msg" style="font-size:1.8em;font-weight:700;margin:4px 0">' + (x.m == null ? '—' : x.m.toFixed(1) + '%') + '</p><div class="progress"><i style="width:' + (x.m || 0) + '%"></i></div>' +
                '<ul class="dayvals"><li><span class="label">Kelembapan tanah</span><b>' + x.tanah.toFixed(1) + ' %</b></li><li><span class="label">Suhu</span><b>' + x.suhu.toFixed(1) + ' ' + unit('suhu') + '</b></li></ul></article>';
        }).join('');
        var kpi = [['Kelembapan akhir', last.tanah.toFixed(0) + '%'], ['Suhu akhir', last.suhu.toFixed(1) + ' ' + unit('suhu')], ['Tingkat kematangan akhir', last.m == null ? '—' : last.m.toFixed(0) + '%'], ['Tahap di akhir 4 hari', last.st ? spill(last.st) : '—']].map(function (k) { return '<article class="panel"><span class="label">' + k[0] + '</span><h2 style="font-size:1.6em;margin-top:6px">' + k[1] + '</h2></article>'; }).join('');
        var tbl = X.map(function (x) { return '<tr><td>Hari +' + x.day + '</td><td>' + x.tanah.toFixed(1) + '</td><td>' + x.suhu.toFixed(1) + '</td><td>' + (x.m == null ? '—' : x.m.toFixed(1)) + '</td><td>' + (x.st ? spill(x.st) : '—') + '</td><td>' + ST.pill(x.level) + '</td></tr>'; }).join('');
        var overall = '<article class="panel"><div class="overall" style="--z:var(' + ST.COLORS[r.summary.level] + ')"><b>' + ST.cap(r.summary.level) + '</b><span>' + esc(r.summary.text) + '</span></div>' +
            (r.summary.notes.length ? '<ul class="notes">' + r.summary.notes.slice(0, 8).map(function (n) { return '<li><span>' + esc(n) + '</span></li>'; }).join('') + '</ul>' : '') +
            '<p class="msg" style="margin-top:8px">Dibuat ' + U.fmtDate(r.generated_at) + ' dari data lengkap terakhir ' + U.fmtDate(r.last_data_hour) + (r.lag_hours ? ' (' + r.lag_hours + ' jam lalu)' : '') + '. Hari ke-1 = 24 jam pertama dari jam ini.</p></article>';
        $('#fc-out').innerHTML = ageCard() + overall +
            '<div class="daygrid">' + kpi + '</div>' +
            '<article class="panel"><div class="panel-head"><h2>Prediksi pertumbuhan 4 hari ke depan</h2><span class="msg">hasil model LSTM + umur tanaman</span></div><div class="daygrid">' + cards + '</div></article>' +
            ['tanah', 'suhu', 'udara'].map(function (k) { var p = P.filter(function (q) { return q.k === k; })[0]; return '<article class="panel"><div class="panel-head"><h2>' + (k === 'tanah' ? 'Kelembapan tanah (%)' : k === 'udara' ? 'Kelembapan udara (%)' : 'Suhu (' + unit('suhu') + ')') + '</h2></div><div class="chart" id="fcc-' + k + '"></div></article>'; }).join('') +
            '<article class="panel"><div class="panel-head"><h2>Prediksi tingkat kematangan 4 hari ke depan</h2></div><div class="chart" id="fcc-mat"></div></article>' +
            '<article class="panel"><div class="panel-head"><h2>Ringkasan per hari</h2><button class="btn ghost small" type="button" id="fc-csv">Unduh prediksi (CSV)</button></div><div class="tablewrap"><table><thead><tr><th>Hari</th><th>Kelembapan tanah (%)</th><th>Suhu (' + unit('suhu') + ')</th><th>Tingkat kematangan (%)</th><th>Tahap</th><th>Kondisi sensor</th></tr></thead><tbody>' + tbl + '</tbody></table></div>' +
            '<p class="hint" style="margin-top:8px"><b>Catatan:</b> ' + esc(r.disclaimer) + ' Model dilatih ' + U.fmtDate(r.model.trained_at) + ' dengan ' + (r.model.n_train || '—') + ' sampel latih.</p></article>';
        bindAge(); $('#fc-csv').addEventListener('click', csv);
        ['tanah', 'suhu', 'udara'].forEach(function (k) {
            var p = P.filter(function (q) { return q.k === k; })[0], bands = k === 'udara' ? [{ lo: th.hmin, hi: ST.margins.humMax }] : k === 'tanah' ? [{ lo: th.dry, hi: th.wet }] : [{ lo: core.tc(th.tmin), hi: core.tc(th.tmax) }], lines = k === 'udara' ? [{ v: th.hmin }] : k === 'tanah' ? [{ v: th.dry }, { v: th.wet }] : [{ v: core.tc(th.tmin) }, { v: core.tc(th.tmax) }];
            CH.line($('#fcc-' + k), { series: [
                { name: 'Riwayat (48 jam)', color: p.color, data: r.actual_recent.map(function (x) { return [x.t, val(k, x[k])]; }) },
                { name: 'Prediksi LSTM', color: '--fg', dash: true, data: r.hourly.map(function (x) { return [x.t, val(k, x[k])]; }) }
            ], h: 230, dec: 1, unit: unit(k), bands: bands, lines: lines, includeBands: true, xFmt: tf, tipTime: tf, minSpan: k === 'suhu' ? 2 : 6, vline: r.hourly[0].t, vlineLabel: 'sekarang', label: p.name });
        });
        var mm = $('#fcc-mat');
        if (!age) { mm.innerHTML = '<p class="msg">Isi tanggal tanam di atas untuk melihat kematangan.</p>'; return; }
        var pts = [[0, mat(age, c.harvest)]].concat(X.map(function (x) { return [x.day, x.m]; }));
        CH.line(mm, { series: [{ name: 'Tingkat kematangan', color: '--ok', markers: true, data: pts }], h: 230, dec: 1, unit: '%', yMin: 0, yMax: 100, bands: [{ lo: 89, hi: 100 }], lines: [{ v: 66.5 }, { v: 89 }], includeBands: true, xFmt: function (t) { return t === 0 ? 'Sekarang' : 'Hari +' + Math.round(t); }, tipTime: function (t) { return t === 0 ? 'Sekarang' : 'Hari +' + Math.round(t); }, minSpan: 4, label: 'Prediksi tingkat kematangan' });
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
