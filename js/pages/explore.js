/* Halaman Eksplorasi Data: data sensor tersimpan di Firebase, grafik historis, statistik, tabel, ekspor. */
(window.SeladaModules = window.SeladaModules || []).push(function (core) {
    'use strict';
    var $ = function (s) { return document.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
    var ST = window.SeladaStatus, CH = window.SeladaCharts;
    var ALPH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    var P = [
        { k: 'suhu', name: 'Suhu udara', color: '--temp', dec: 2 },
        { k: 'udara', name: 'Kelembapan udara', color: '--wet', dec: 1 },
        { k: 'tanah', name: 'Kelembapan tanah', color: '--ok', dec: 1 }
    ];
    var ALL = [], META = null, V = [], dirty = true, busy = false, lastSig = '';
    var F = { params: { suhu: true, udara: true, tanah: true }, agg: 0, search: '', from: '', to: '', tFrom: '', tTo: '' };
    var T = { k: 't', dir: -1, page: 1, size: 15 };

    function encodePush(ms) { var s = ''; for (var i = 0; i < 8; i++) { s = ALPH[ms % 64] + s; ms = Math.floor(ms / 64); } return s; }
    function pad(n) { return String(n).padStart(2, '0'); }
    function toLocal(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function fmtDT(t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + core.fmtT(t); }
    function tcv(r, k) { return k === 'suhu' ? core.tc(r.suhu) : r[k]; }

    function build() {
        var now = Date.now();
        $('#p-eksplorasi').innerHTML =
            '<div class="col">' +
            '<article class="panel"><div class="panel-head"><h2>Sumber data</h2><span class="msg" id="ex-meta"></span></div>' +
            '<div class="filters"><div><label class="label" for="ex-src">Sumber</label><select id="ex-src"><option value="fb">Firebase (data tersimpan)</option><option value="ses">Sesi ini (data yang sedang dibaca)</option></select></div>' +
            '<div><label class="label" for="ex-preset">Rentang cepat</label><select id="ex-preset"><option value="3600000">1 jam terakhir</option><option value="21600000">6 jam terakhir</option><option value="86400000" selected>24 jam terakhir</option><option value="604800000">7 hari terakhir</option><option value="0">Kustom</option></select></div>' +
            '<div><label class="label" for="ex-start">Mulai</label><input type="datetime-local" id="ex-start" value="' + toLocal(now - 86400000) + '"></div>' +
            '<div><label class="label" for="ex-end">Selesai</label><input type="datetime-local" id="ex-end" value="' + toLocal(now) + '"></div>' +
            '<div><label class="label" for="ex-max">Maks. baris</label><select id="ex-max"><option value="5000">5.000</option><option value="20000" selected>20.000</option><option value="50000">50.000</option><option value="100000">100.000</option></select></div>' +
            '<div class="fbtn"><button class="btn" type="button" id="ex-load">Muat data</button></div></div>' +
            '<p class="msg" id="ex-msg" role="status"></p></article>' +
            '<div id="ex-body" hidden><article class="panel"><div class="panel-head"><h2>Filter</h2><button class="btn ghost small" type="button" id="ex-reset">Atur ulang</button></div>' +
            '<div class="filters"><div><span class="label">Parameter</span><div class="checks" id="ex-params">' + P.map(function (p) { return '<label><input type="checkbox" data-k="' + p.k + '" checked> ' + p.name + '</label>'; }).join('') + '</div></div>' +
            '<div><label class="label" for="ex-from">Dari tanggal</label><input type="datetime-local" id="ex-from"></div>' +
            '<div><label class="label" for="ex-to">Sampai tanggal</label><input type="datetime-local" id="ex-to"></div>' +
            '<div><label class="label" for="ex-tf">Jam harian dari</label><input type="time" id="ex-tf"></div>' +
            '<div><label class="label" for="ex-tt">Jam harian sampai</label><input type="time" id="ex-tt"></div>' +
            '<div><label class="label" for="ex-agg">Ringkas data</label><select id="ex-agg"><option value="0">Per pembacaan</option><option value="60000">Rata-rata per menit</option><option value="3600000">Rata-rata per jam</option><option value="86400000">Rata-rata per hari</option></select></div></div></article>' +
            '<article class="panel"><div class="panel-head"><h2>Statistik</h2><span class="msg" id="ex-n"></span></div><div class="tablewrap"><table><thead><tr><th>Parameter</th><th>Jumlah</th><th>Minimum</th><th>Maksimum</th><th>Rata-rata</th><th>Median</th><th>Std. deviasi</th></tr></thead><tbody id="ex-stats"></tbody></table></div></article>' +
            '<div class="pair" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))">' +
            P.map(function (p) { return '<article class="panel" id="exc-' + p.k + '"><div class="panel-head"><h2>Grafik ' + p.name.toLowerCase() + '</h2></div><div class="chart" id="ex-ch-' + p.k + '"></div></article>'; }).join('') + '</div>' +
            '<article class="panel"><div class="panel-head"><h2>Perbandingan antarparameter</h2><span class="msg">Dinormalisasi 0–100% (min–maks tiap parameter) agar bisa dibandingkan.</span></div><div class="chart" id="ex-cmp"></div><div class="tablewrap" style="margin-top:12px"><table class="corr"><caption class="label">Korelasi Pearson (r)</caption><tbody id="ex-corr"></tbody></table></div></article>' +
            '<article class="panel"><div class="panel-head"><h2>Tabel data</h2><div class="toolbar"><input type="search" id="ex-q" placeholder="Cari waktu, nilai, status…" aria-label="Cari data" style="min-width:220px"></div></div>' +
            '<div class="tablewrap"><table><thead id="ex-thead"></thead><tbody id="ex-tbody"></tbody></table></div>' +
            '<div class="pager"><span class="msg" id="ex-pinfo"></span><div class="toolbar"><button class="btn ghost small" type="button" id="ex-prev">Sebelumnya</button><button class="btn ghost small" type="button" id="ex-next">Berikutnya</button></div></div>' +
            '<div class="toolbar" style="margin-top:14px"><button class="btn" type="button" id="ex-csv">Ekspor CSV</button><button class="btn ghost" type="button" id="ex-xlsx">Ekspor Excel (.xlsx)</button><span class="msg">Ekspor berisi semua baris sesuai filter dan pencarian, bukan hanya halaman ini. CSV ini juga bisa dipakai untuk melatih LSTM di halaman Model LSTM.</span></div></article></div></div>';
    }

    /* ---------- pemuatan ---------- */
    function parse(j) {
        var rows = [], skipped = 0;
        if (!j || typeof j !== 'object') return { rows: rows, skipped: 0 };
        Object.keys(j).sort().forEach(function (k) {
            var o = j[k]; if (!o || typeof o !== 'object') return;
            var t = core.pushTime(k), s = Number(o.suhu), u = Number(o.kelembapan_udara), h = Number(o.kelembapan_tanah);
            if (!t || !isFinite(s) || !isFinite(u) || !isFinite(h)) { skipped++; return; }
            rows.push({ t: t, suhu: s, udara: u, tanah: h });
        });
        return { rows: rows, skipped: skipped };
    }
    async function loadFirebase(a, b, max) {
        var url = core.settings().firebase + '?orderBy=' + encodeURIComponent('"$key"') + '&startAt=' + encodeURIComponent('"' + encodePush(a) + '"') +
            '&endAt=' + encodeURIComponent('"' + encodePush(b) + '~"') + '&limitToLast=' + max;
        var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, 90000);
        try {
            var res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return parse(await res.json());
        } finally { clearTimeout(to); }
    }
    async function load() {
        if (busy) return;
        var msg = $('#ex-msg'), src = $('#ex-src').value;
        var a = new Date($('#ex-start').value).getTime(), b = new Date($('#ex-end').value).getTime(), max = Number($('#ex-max').value);
        if (src === 'fb' && !(a < b)) { msg.className = 'msg err'; msg.textContent = 'Tanggal mulai harus lebih awal dari selesai.'; return; }
        busy = true; $('#ex-load').disabled = true; msg.className = 'msg'; msg.textContent = 'Memuat…';
        try {
            if (src === 'ses') {
                ALL = core.hist().map(function (r) { return { t: r.t, suhu: r.suhu, udara: r.udara, tanah: r.tanah }; });
                META = { source: core.mode() === 'demo' ? 'Sesi ini (DATA CONTOH, bukan sensor)' : 'Sesi ini (Firebase)', demo: core.mode() === 'demo', skipped: 0, truncated: false };
            } else {
                var r = await loadFirebase(a, b, max);
                ALL = r.rows;
                META = { source: 'Firebase', demo: false, skipped: r.skipped, truncated: r.rows.length >= max };
            }
            ALL.sort(function (x, y) { return x.t - y.t; });
            F.from = F.to = F.tFrom = F.tTo = ''; T.page = 1;
            ['#ex-from', '#ex-to', '#ex-tf', '#ex-tt'].forEach(function (s) { $(s).value = ''; });
            if (!ALL.length) { msg.className = 'msg err'; msg.textContent = 'Tidak ada data sensor pada rentang ini. Tidak ada data yang dikarang; coba rentang lain atau cek Firebase.'; $('#ex-body').hidden = true; }
            else {
                msg.className = 'msg good';
                msg.textContent = ALL.length.toLocaleString('id-ID') + ' baris dimuat' + (META.truncated ? ' (dipotong di batas maks.; sempitkan rentang untuk data lebih lengkap)' : '') + (META.skipped ? '. ' + META.skipped + ' baris dilewati karena waktu/nilai tidak valid' : '') + '.';
                $('#ex-body').hidden = false;
            }
            dirty = true; render();
        } catch (e) {
            msg.className = 'msg err';
            msg.textContent = (e && e.name === 'AbortError' ? 'Waktu habis.' : 'Tidak bisa membaca Firebase.') + ' Cek URL di Pengaturan, aturan baca Firebase, dan koneksi internet. Coba rentang lebih pendek.';
        } finally { busy = false; $('#ex-load').disabled = false; }
    }

    /* ---------- turunan data ---------- */
    function inDaily(t) {
        if (!F.tFrom && !F.tTo) return true;
        var d = new Date(t), m = d.getHours() * 60 + d.getMinutes();
        var a = F.tFrom ? Number(F.tFrom.slice(0, 2)) * 60 + Number(F.tFrom.slice(3)) : 0, b = F.tTo ? Number(F.tTo.slice(0, 2)) * 60 + Number(F.tTo.slice(3)) : 1439;
        return a <= b ? (m >= a && m <= b) : (m >= a || m <= b);
    }
    function recompute() {
        var a = F.from ? new Date(F.from).getTime() : -Infinity, b = F.to ? new Date(F.to).getTime() : Infinity;
        var rows = ALL.filter(function (r) { return r.t >= a && r.t <= b && inDaily(r.t); });
        if (F.agg) {
            var g = {};
            rows.forEach(function (r) { var k = Math.floor(r.t / F.agg); (g[k] = g[k] || []).push(r); });
            rows = Object.keys(g).map(Number).sort(function (x, y) { return x - y; }).map(function (k) {
                var arr = g[k], o = { t: k * F.agg, n: arr.length };
                P.forEach(function (p) { o[p.k] = core.avg(arr.map(function (x) { return x[p.k]; })); });
                return o;
            });
        }
        V = rows; dirty = false;
    }
    function status(r) { return ST.assess(r, ST.thresholds(core.settings())).overall; }
    function tableRows() {
        var q = F.search.trim().toLowerCase(), th = ST.thresholds(core.settings());
        var rows = V.map(function (r) { return { r: r, lv: ST.assess(r, th).overall }; });
        if (q) rows = rows.filter(function (x) {
            var hay = [fmtDT(x.r.t), x.r.suhu.toFixed(2), tcv(x.r, 'suhu').toFixed(2), x.r.udara.toFixed(1), x.r.tanah.toFixed(1), ST.LEVELS[x.lv]].join(' ').toLowerCase();
            return hay.indexOf(q) >= 0;
        });
        rows.sort(function (x, y) {
            var a = T.k === 'lv' ? x.lv : x.r[T.k], b = T.k === 'lv' ? y.lv : y.r[T.k];
            return (a - b) * T.dir;
        });
        return rows;
    }
    function std(a, mean) { return a.length > 1 ? Math.sqrt(a.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / (a.length - 1)) : 0; }
    function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    function pearson(x, y) {
        var mx = core.avg(x), my = core.avg(y), sxy = 0, sxx = 0, syy = 0;
        x.forEach(function (v, i) { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) * (v - mx); syy += (y[i] - my) * (y[i] - my); });
        return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
    }

    /* ---------- tampilan ---------- */
    function xf() {
        var span = V.length > 1 ? V[V.length - 1].t - V[0].t : 0;
        return function (t) { var d = new Date(t); return span > 86400000 * 2 ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + core.fmtT(t, true) : core.fmtT(t, span > 1800000); };
    }
    function draw() {
        if (!ALL.length) return;
        var sel = P.filter(function (p) { return F.params[p.k]; }), fx = xf();
        $('#ex-meta').innerHTML = META ? CH.esc(META.source) + (META.demo ? ' <b class="demotag">DATA CONTOH</b>' : '') : '';
        $('#ex-n').textContent = V.length.toLocaleString('id-ID') + ' baris' + (F.agg ? ' (ringkasan)' : '') + ' dalam filter';
        $('#ex-stats').innerHTML = sel.map(function (p) {
            var a = V.map(function (r) { return tcv(r, p.k); });
            if (!a.length) return '<tr><td>' + p.name + '</td><td colspan="6" class="empty">Tidak ada data</td></tr>';
            var m = core.avg(a), u = p.k === 'suhu' ? ' ' + core.tu() : ' %';
            return '<tr><td>' + p.name + '</td><td>' + a.length + '</td><td>' + Math.min.apply(null, a).toFixed(p.dec) + u + '</td><td>' + Math.max.apply(null, a).toFixed(p.dec) + u + '</td><td>' + m.toFixed(p.dec) + u + '</td><td>' + median(a).toFixed(p.dec) + u + '</td><td>' + std(a, m).toFixed(p.dec) + '</td></tr>';
        }).join('');
        P.forEach(function (p) {
            var card = $('#exc-' + p.k); card.hidden = !F.params[p.k];
            if (!F.params[p.k]) return;
            var u = p.k === 'suhu' ? core.tu() : '%';
            CH.line($('#ex-ch-' + p.k), { series: [{ name: p.name, color: p.color, data: CH.downsample(V.map(function (r) { return [r.t, tcv(r, p.k)]; }), 700) }], h: 220, dec: p.dec === 2 ? 1 : 0, unit: u, legend: false, minSpan: p.k === 'suhu' ? 2 : 6, xFmt: fx, tipTime: fmtDT, label: 'Grafik ' + p.name });
        });
        var cs = sel.map(function (p) {
            var a = V.map(function (r) { return tcv(r, p.k); }), lo = Math.min.apply(null, a), hi = Math.max.apply(null, a);
            return { name: p.name, color: p.color, data: CH.downsample(V.map(function (r, i) { return [r.t, hi > lo ? (a[i] - lo) / (hi - lo) * 100 : 50]; }), 700) };
        });
        CH.line($('#ex-cmp'), { series: cs, h: 240, dec: 0, unit: '%', yMin: 0, yMax: 100, xFmt: fx, tipTime: fmtDT, label: 'Perbandingan antarparameter' });
        var vals = {}; P.forEach(function (p) { vals[p.k] = V.map(function (r) { return tcv(r, p.k); }); });
        $('#ex-corr').innerHTML = '<tr><td></td>' + P.map(function (p) { return '<td class="label">' + p.name + '</td>'; }).join('') + '</tr>' + P.map(function (a) {
            return '<tr><td class="label">' + a.name + '</td>' + P.map(function (b) {
                var r = a.k === b.k ? 1 : pearson(vals[a.k], vals[b.k]);
                return '<td style="background:color-mix(in srgb,var(' + (r !== null && r < 0 ? '--temp' : '--ok') + ') ' + Math.round(Math.abs(r || 0) * 45) + '%,transparent)">' + (r === null ? '—' : r.toFixed(2)) + '</td>';
            }).join('') + '</tr>';
        }).join('');
        drawTable();
    }
    function drawTable() {
        var sel = P.filter(function (p) { return F.params[p.k]; }), rows = tableRows(), pages = Math.max(1, Math.ceil(rows.length / T.size));
        T.page = Math.min(T.page, pages);
        function th(k, label) { return '<th data-k="' + k + '"' + (T.k === k ? ' aria-sort="' + (T.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button">' + label + '</button></th>'; }
        $('#ex-thead').innerHTML = '<tr>' + th('t', 'Waktu') + sel.map(function (p) { return th(p.k, p.k === 'suhu' ? 'Suhu ' + core.tu() : p.k === 'udara' ? 'Udara' : 'Tanah'); }).join('') + th('lv', 'Status') + '</tr>';
        var slice = rows.slice((T.page - 1) * T.size, T.page * T.size);
        $('#ex-tbody').innerHTML = slice.length ? slice.map(function (x) {
            return '<tr><td>' + fmtDT(x.r.t) + '</td>' + sel.map(function (p) { return '<td>' + tcv(x.r, p.k).toFixed(p.dec === 2 ? 1 : 0 + (p.k === 'tanah' ? 0 : 0)) + (p.k === 'suhu' ? '' : ' %') + '</td>'; }).join('') + '<td>' + ST.pill(x.lv) + '</td></tr>';
        }).join('') : '<tr><td colspan="' + (sel.length + 2) + '" class="empty" style="text-align:center">Tidak ada data untuk filter ini.</td></tr>';
        $('#ex-pinfo').textContent = rows.length.toLocaleString('id-ID') + ' baris · halaman ' + T.page + ' dari ' + pages;
        $('#ex-prev').disabled = T.page <= 1; $('#ex-next').disabled = T.page >= pages;
    }
    function render() {
        if (!ALL.length) return;
        var w = $('#ex-cmp').clientWidth, sig = [core.settings().unit, core.settings().clock, core.settings().dry, core.settings().wet, w].join('|');
        if (!dirty && sig === lastSig) return;
        lastSig = sig;
        if (dirty) recompute();
        draw();
    }

    /* ---------- ekspor ---------- */
    function exportRows() {
        var sel = P.filter(function (p) { return F.params[p.k]; }), th = ST.thresholds(core.settings());
        var head = ['waktu'].concat(sel.map(function (p) { return p.k === 'suhu' ? 'suhu_c' : (p.k === 'udara' ? 'kelembapan_udara' : 'kelembapan_tanah'); }), ['status']);
        var data = tableRows().sort(function (a, b) { return a.r.t - b.r.t; }).map(function (x) {
            return [new Date(x.r.t).toISOString()].concat(sel.map(function (p) { return Number(x.r[p.k].toFixed(p.k === 'suhu' ? 2 : 1)); }), [ST.LEVELS[ST.assess(x.r, th).overall]]);
        });
        return [head].concat(data);
    }
    function exportCsv() {
        var txt = exportRows().map(function (r) { return r.join(','); }).join('\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = 'eksplorasi-selada.csv';
        document.body.appendChild(a); a.click(); a.remove();
    }

    function init() {
        build();
        $('#ex-load').addEventListener('click', load);
        $('#ex-src').addEventListener('change', function () { var s = this.value === 'ses'; ['#ex-preset', '#ex-start', '#ex-end', '#ex-max'].forEach(function (i) { $(i).disabled = s; }); });
        $('#ex-preset').addEventListener('change', function () {
            var ms = Number(this.value); if (!ms) return;
            $('#ex-end').value = toLocal(Date.now()); $('#ex-start').value = toLocal(Date.now() - ms);
        });
        ['#ex-start', '#ex-end'].forEach(function (s) { $(s).addEventListener('change', function () { $('#ex-preset').value = '0'; }); });
        function setF() { F.from = $('#ex-from').value; F.to = $('#ex-to').value; F.tFrom = $('#ex-tf').value; F.tTo = $('#ex-tt').value; F.agg = Number($('#ex-agg').value); T.page = 1; dirty = true; render(); }
        ['#ex-from', '#ex-to', '#ex-tf', '#ex-tt', '#ex-agg'].forEach(function (s) { $(s).addEventListener('change', setF); });
        $('#ex-params').addEventListener('change', function (e) {
            var k = e.target.dataset.k; if (!k) return;
            F.params[k] = e.target.checked;
            if (!P.some(function (p) { return F.params[p.k]; })) { F.params[k] = true; e.target.checked = true; core.toast('Pilih minimal satu parameter.'); }
            dirty = true; render();
        });
        $('#ex-q').addEventListener('input', function () { F.search = this.value; T.page = 1; drawTable(); });
        $('#ex-reset').addEventListener('click', function () {
            F = { params: { suhu: true, udara: true, tanah: true }, agg: 0, search: '', from: '', to: '', tFrom: '', tTo: '' }; T.page = 1;
            ['#ex-from', '#ex-to', '#ex-tf', '#ex-tt', '#ex-q'].forEach(function (s) { $(s).value = ''; }); $('#ex-agg').value = '0';
            $$('#ex-params input').forEach(function (c) { c.checked = true; });
            dirty = true; render();
        });
        $('#ex-thead').addEventListener('click', function (e) {
            var th = e.target.closest('th[data-k]'); if (!th) return;
            if (T.k === th.dataset.k) T.dir = -T.dir; else { T.k = th.dataset.k; T.dir = -1; }
            drawTable();
        });
        $('#ex-prev').addEventListener('click', function () { T.page--; drawTable(); });
        $('#ex-next').addEventListener('click', function () { T.page++; drawTable(); });
        $('#ex-csv').addEventListener('click', exportCsv);
        $('#ex-xlsx').addEventListener('click', function () { SeladaXlsx.download(SeladaXlsx.build(exportRows(), 'Data sensor'), 'eksplorasi-selada.xlsx'); });
    }
    return { id: 'eksplorasi', o: 70, g: 'Analitik', name: 'Eksplorasi Data', sub: 'Data sensor tersimpan, statistik, grafik historis, dan ekspor', init: init, render: render, enter: function () { dirty = true; },
        ic: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2M8 11h6M11 8v6"/>' };
});
