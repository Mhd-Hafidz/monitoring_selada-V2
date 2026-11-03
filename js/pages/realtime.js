/* Halaman Monitoring Realtime: kondisi tanaman langsung dari Firebase (tanpa data karangan). */
(window.SeladaModules = window.SeladaModules || []).push(function (core) {
    'use strict';
    var $ = function (s) { return document.querySelector(s); };
    var ST = window.SeladaStatus, CH = window.SeladaCharts;
    var WIN = 300, paused = false, frozen = null, notif = false, NKEY = 'selada-notif';
    var DEFS = [
        { k: 'tanah', name: 'Kelembapan tanah', unit: '%', dec: 0, color: '--ok', get: function (r) { return r.tanah; } },
        { k: 'suhu', name: 'Suhu udara', dec: 1, color: '--temp', get: function (r) { return core.tc(r.suhu); } },
        { k: 'udara', name: 'Kelembapan udara', unit: '%', dec: 0, color: '--wet', get: function (r) { return r.udara; } }
    ];

    function build() {
        var cards = DEFS.map(function (d) {
            return '<article class="panel rt-card" id="rt-' + d.k + '" style="--c:var(' + d.color + ')"><div class="rt-top"><h2 class="label">' + d.name + '</h2><span id="rt-' + d.k + '-pill"></span></div>' +
                '<div class="rt-val"><b id="rt-' + d.k + '-v">—</b><small id="rt-' + d.k + '-u"></small></div><p class="msg" id="rt-' + d.k + '-r"></p><div class="chart" id="rt-' + d.k + '-ch"></div></article>';
        }).join('');
        $('#p-realtime').innerHTML =
            '<div class="col">' +
            '<div class="demobadge" id="rt-demo" hidden>DATA CONTOH: nilai di halaman ini bukan dari sensor. Matikan "Selalu pakai data contoh" di Pengaturan, atau pastikan Firebase terbaca.</div>' +
            '<article class="panel"><div class="statusstrip" id="rt-strip"></div></article>' +
            '<article class="panel"><div class="panel-head"><h2>Status pompa air</h2><span class="msg" id="rt-pump-src"></span></div><div class="grid" style="align-items:center"><div><div class="pumpbig" id="rt-pump-state" role="status">—</div><p class="msg" id="rt-pump-since">—</p></div><div><div class="stats" id="rt-pump-stats"></div></div></div><div class="pumpbar" id="rt-pump-bar" aria-label="Riwayat status pompa pada rentang grafik"></div><p class="msg" id="rt-pump-bar-l"></p></article>' +
            '<div class="toolbar"><div class="seg" id="rt-win" role="group" aria-label="Rentang grafik"><button type="button" data-n="60" aria-pressed="false">1 menit</button><button type="button" data-n="300" aria-pressed="true">5 menit</button><button type="button" data-n="900" aria-pressed="false">15 menit</button><button type="button" data-n="1800" aria-pressed="false">30 menit</button></div>' +
            '<button class="btn ghost small" type="button" id="rt-pause">Jeda grafik</button><button class="btn ghost small" type="button" id="rt-notif">Notifikasi browser: mati</button><span class="msg" id="rt-info"></span></div>' +
            '<div class="rt-cards">' + cards + '</div>' +
            '<div class="grid"><article class="panel"><div class="panel-head"><h2>Kondisi tanaman</h2></div><div id="rt-overall"></div></article>' +
            '<article class="panel"><div class="panel-head"><h2>Peringatan terbaru</h2><a class="link" href="#peringatan">Semua</a></div><div class="events" id="rt-al"></div></article></div></div>';
    }

    function rowsInWindow() {
        var src = paused && frozen ? frozen : core.hist();
        if (!src.length) return [];
        var end = src[src.length - 1].t, cut = end - WIN * 1000;
        return src.filter(function (r) { return r.t >= cut; });
    }

    function deviceState() {
        var S = core.settings(), r = core.last(), m = core.mode(), off = S.rules.off.v;
        if (m === 'init') return { s: 'init', text: 'Menghubungkan…', detail: 'Membaca Firebase' };
        if (m === 'demo') return { s: 'demo', text: 'Data contoh', detail: 'Bukan perangkat sungguhan' };
        if (!core.netOk()) return { s: 'bad', text: 'Firebase tidak terbaca', detail: 'Status perangkat tidak diketahui' };
        if (!r) return { s: 'bad', text: 'Belum ada data', detail: 'Firebase kosong' };
        var age = (Date.now() - r.t) / 1000;
        if (age > off) return { s: 'bad', text: 'Perangkat OFFLINE', detail: 'Tidak ada data baru selama ' + core.dur(age * 1000) };
        return { s: 'live', text: 'Perangkat ONLINE', detail: 'Data terakhir ' + Math.max(0, Math.round(age)) + ' detik lalu' };
    }

    function render() {
        var S = core.settings(), r = core.last(), th = ST.thresholds(S), dev = deviceState(), m = core.mode();
        $('#rt-demo').hidden = m !== 'demo';
        var hist = core.hist(), rate = 0;
        if (r) { var c = r.t - 60000; hist.forEach(function (x) { if (x.t >= c) rate++; }); }
        $('#rt-strip').innerHTML =
            '<div class="ss"><span class="label">Perangkat IoT</span><div class="conn" data-s="' + dev.s + '"><span class="dot"></span><b>' + dev.text + '</b></div><small>' + dev.detail + '</small></div>' +
            '<div class="ss"><span class="label">Koneksi Firebase</span><b>' + (m === 'live' ? (core.netOk() ? 'Tersambung' : 'Terputus') : (m === 'demo' ? 'Tidak dipakai' : '…')) + '</b><small>polling tiap ' + (S.poll / 1000) + ' dtk</small></div>' +
            '<div class="ss"><span class="label">Pembaruan terakhir</span><b>' + (r ? core.fmtT(r.t) : '—') + '</b><small>' + (r ? Math.max(0, Math.round((Date.now() - r.t) / 1000)) + ' detik lalu' : 'data belum tersedia') + '</small></div>' +
            '<div class="ss"><span class="label">Laju data</span><b>' + (r ? rate : '—') + '</b><small>pembacaan / menit</small></div>';
        var rows = rowsInWindow();
        var pst = core.pump(), pps = core.pumpStats(rows);
        $('#rt-pump-state').innerHTML = core.pumpHTML(pst); $('#rt-pump-src').textContent = pst.detail;
        $('#rt-pump-since').textContent = pst.known ? (pst.on ? 'Menyala sejak ' : 'Mati sejak ') + core.fmtT(pst.since) + ' (' + core.dur(pst.sinceMs) + ')' : (pst.last !== undefined ? 'Status terakhir yang diterima: ' + (pst.last ? 'menyala' : 'mati') : '');
        $('#rt-pump-stats').innerHTML = '<div class="stat"><span class="label">Siklus (rentang ini)</span><b>' + pps.cycles + '</b><small>kali menyala</small></div><div class="stat"><span class="label">Waktu menyala</span><b>' + core.dur(pps.on) + '</b><small>dalam rentang ini</small></div>';
        var bar = '';
        if (rows.length > 1) {
            var t0 = rows[0].t, tt = rows[rows.length - 1].t - t0 || 1;
            for (var i = 0; i < rows.length - 1; i++) { var w = (rows[i + 1].t - rows[i].t) / tt * 100; if (w > 0) bar += '<i class="' + (core.pumpOn(rows[i]) ? 'on' : '') + '" style="width:' + w.toFixed(3) + '%"></i>'; }
        }
        $('#rt-pump-bar').innerHTML = bar; $('#rt-pump-bar-l').textContent = rows.length > 1 ? 'Biru = pompa menyala, abu-abu = mati (' + core.fmtT(rows[0].t) + ' – ' + core.fmtT(rows[rows.length - 1].t) + ')' : 'Menunggu data…';
        $('#rt-info').textContent = (paused ? 'Dijeda · ' : '') + rows.length + ' pembacaan dalam rentang';
        var a = r ? ST.assess(r, th) : null;
        DEFS.forEach(function (d) {
            var unit = d.unit || core.tu();
            $('#rt-' + d.k + '-u').textContent = unit;
            if (!r) {
                $('#rt-' + d.k + '-v').textContent = '—'; $('#rt-' + d.k + '-pill').innerHTML = '<span class="pill">Belum ada data</span>';
                $('#rt-' + d.k + '-r').textContent = 'Data sensor belum tersedia.';
            } else {
                $('#rt-' + d.k + '-v').textContent = core.num(d.get(r), d.dec);
                $('#rt-' + d.k + '-pill').innerHTML = ST.pill(a[d.k]);
                $('#rt-' + d.k + '-r').textContent = 'Rentang normal: ' + ST.rangeText(d.k, th, core.tc);
            }
            var bands = [], lines = [];
            if (d.k === 'tanah') { bands = [{ lo: th.dry, hi: th.wet }]; lines = [{ v: th.dry }, { v: th.wet }]; }
            else if (d.k === 'suhu') { bands = [{ lo: core.tc(th.tmin), hi: core.tc(th.tmax) }]; lines = [{ v: core.tc(th.tmin) }, { v: core.tc(th.tmax) }]; }
            else { bands = [{ lo: th.hmin, hi: ST.margins.humMax }]; lines = [{ v: th.hmin }]; }
            CH.line($('#rt-' + d.k + '-ch'), {
                series: [{ name: d.name, color: d.color, data: CH.downsample(rows.map(function (x) { return [x.t, d.get(x)]; }), 400) }],
                h: 170, dec: d.dec, unit: unit, bands: bands, lines: lines, legend: false, minSpan: d.k === 'suhu' ? 2 : 6,
                yMin: d.k === 'tanah' ? 0 : undefined, yMax: d.k === 'tanah' ? 100 : undefined,
                xFmt: function (t) { return core.fmtT(t); }, tipTime: function (t) { return core.fmtT(t); }, label: 'Grafik realtime ' + d.name,
                empty: 'Menunggu data sensor… (tidak ada data yang dikarang)'
            });
        });
        var ov = $('#rt-overall');
        if (!r) ov.innerHTML = '<p class="empty">Data sensor belum tersedia, kondisi tanaman belum bisa dinilai.</p>';
        else {
            var notes = DEFS.filter(function (d) { return a[d.k] > 0; }).map(function (d) {
                return '<li>' + ST.pill(a[d.k]) + ' <span>' + ST.LABEL[d.k] + ' ' + core.num(d.get(r), d.dec) + ' ' + (d.unit || core.tu()) + ' di luar rentang normal (' + ST.rangeText(d.k, th, core.tc) + ')</span></li>';
            }).join('');
            ov.innerHTML = '<div class="overall" style="--z:var(' + ST.COLORS[a.overall] + ')"><b>' + ST.cap(a.overall) + '</b><span>' + ['Semua parameter dalam rentang normal.', 'Ada parameter di luar rentang normal. Pantau dan siapkan tindakan.', 'Ada parameter pada tingkat berbahaya. Perlu tindakan segera.'][a.overall] + '</span></div>' + (notes ? '<ul class="notes">' + notes + '</ul>' : '');
        }
        var al = core.alerts().slice(0, 6);
        $('#rt-al').innerHTML = al.length ? al.map(function (x) {
            var c = { crit: '--bad', warn: '--dry', info: '--wet' }[x.sev], n = { crit: 'Penting', warn: 'Peringatan', info: 'Info' }[x.sev];
            return '<div class="ev' + (x.read ? '' : ' unread') + '"><span class="sev" style="--z:var(' + c + ')">' + n + '</span><span class="m">' + CH.esc(x.msg) + '</span><span class="time">' + core.fmtT(x.t) + '</span></div>';
        }).join('') : '<p class="empty">Belum ada kejadian.</p>';
        var nb = $('#rt-notif');
        nb.textContent = 'Notifikasi browser: ' + (notif ? 'aktif' : 'mati');
        nb.hidden = typeof Notification === 'undefined';
        $('#rt-pause').textContent = paused ? 'Lanjutkan grafik' : 'Jeda grafik';
    }

    function init() {
        build();
        try { notif = localStorage.getItem(NKEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch (e) { }
        $('#rt-win').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            WIN = Number(b.dataset.n);
            document.querySelectorAll('#rt-win button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            render();
        });
        $('#rt-pause').addEventListener('click', function () { paused = !paused; frozen = paused ? core.hist().slice() : null; render(); });
        $('#rt-notif').addEventListener('click', async function () {
            if (notif) { notif = false; } else {
                var p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
                notif = p === 'granted';
                if (!notif) core.toast('Izin notifikasi browser ditolak.');
            }
            try { localStorage.setItem(NKEY, notif ? '1' : '0'); } catch (e) { }
            render();
        });
        /* Notifikasi saat parameter melewati batas (memakai aturan peringatan yang sudah ada). */
        core.onAlert(function (a) {
            if (!notif || a.sev === 'info' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            try { new Notification('Selada Keriting', { body: a.msg }); } catch (e) { }
        });
    }
    return { id: 'realtime', o: 60, g: 'Analitik', name: 'Monitoring Realtime', sub: 'Kondisi tanaman dan status perangkat IoT secara langsung', init: init, render: render,
        ic: '<path d="M2 12h4l2-6 4 12 3-9 2 3h5"/>' };
});
