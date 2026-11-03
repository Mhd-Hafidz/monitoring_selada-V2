(function () {
    'use strict';
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

    /* ================= Pengaturan ================= */
    var KEY = 'selada-dash-v3';
    var DEF = {
        firebase: 'https://smart-farming-selada-default-rtdb.asia-southeast1.firebasedatabase.app/kelompok2.json',
        poll: 2000, fetchN: 300, unit: 'C', clock: '24', theme: 'system', forceDemo: false,
        ver: 3, dry: 65, wet: 78, camIp: '', portalIp: '192.168.4.1',
        plantDate: '', harvestDay: 30,
        rules: { dry: { on: true }, wet: { on: true }, tmax: { on: true, v: 32 }, tmin: { on: true, v: 15 }, hmin: { on: true, v: 60 }, off: { on: true, v: 15 } }
    };
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function load() {
        var s = clone(DEF);
        try {
            var raw = localStorage.getItem(KEY);
            if (raw) {
                var o = JSON.parse(raw);
                Object.keys(o).forEach(function (k) {
                    if (k === 'rules') Object.keys(o.rules || {}).forEach(function (r) { s.rules[r] = Object.assign({}, s.rules[r] || {}, o.rules[r]); });
                    else s[k] = o[k];
                });
            }
        } catch (e) { }
        return s;
    }
    var S = load();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }

    /* ================= Util ================= */
    var ZN = {
        dry: { name: 'Kering', v: '--dry' },
        ok: { name: 'Normal', v: '--ok' },
        wet: { name: 'Basah', v: '--wet' }
    };
    function zone(p) { return p <= S.dry ? 'dry' : (p >= S.wet ? 'wet' : 'ok'); }
    function hint(z) {
        if (z === 'dry') return 'Tanah kering (≤ ' + S.dry + '%). Pompa menyala.';
        if (z === 'ok') return 'Kondisi baik (' + S.dry + '–' + S.wet + '%). Pompa mati.';
        return 'Tanah basah (≥ ' + S.wet + '%). Pompa mati.';
    }
    function fmtT(t, short) {
        var d = new Date(t);
        if (S.clock === '12') return d.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: short ? undefined : '2-digit' });
        return d.toLocaleTimeString('en-GB', short ? { hour: '2-digit', minute: '2-digit' } : undefined);
    }
    function fmtDate(t) { return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }); }
    function tc(c) { return S.unit === 'F' ? c * 1.8 + 32 : c; }
    function tu() { return S.unit === 'F' ? '°F' : '°C'; }
    function num(v, d) { return Number(v).toFixed(d); }
    function dur(ms) { var s = Math.round(ms / 1000), m = Math.floor(s / 60); return m ? m + ' mnt ' + (s % 60) + ' dtk' : s + ' dtk'; }
    function pillHTML(z) { return '<span class="pill" style="--z:var(' + ZN[z].v + ')">' + ZN[z].name + '</span>'; }
    function toast(msg) {
        var d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
        $('#toasts').appendChild(d);
        setTimeout(function () { d.remove(); }, 5000);
    }
    function avg(a) { var s = 0; a.forEach(function (v) { s += v; }); return a.length ? s / a.length : 0; }

    /* ================= Data ================= */
    var hist = [], mode = 'init', net = true;
    function last() { return hist[hist.length - 1]; }
    function win(n) { return hist.slice(-n); }

    var ALPH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    function pushTime(id) {
        if (typeof id !== 'string' || id.length !== 20) return 0;
        var t = 0;
        for (var i = 0; i < 8; i++) { var k = ALPH.indexOf(id[i]); if (k < 0) return 0; t = t * 64 + k; }
        return t > 1.4e12 ? t : 0;
    }
    function pumpField(o) {
        var v = o.pompa !== undefined ? o.pompa : (o.pump !== undefined ? o.pump : o.relay);
        if (v === undefined || v === null) return undefined;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0;
        var t = String(v).trim().toLowerCase();
        if (/^(1|on|true|menyala|hidup|nyala)$/.test(t)) return true;
        if (/^(0|off|false|mati)$/.test(t)) return false;
        return undefined;
    }
    function norm(o, t) { var r = { t: t, suhu: Number(o.suhu), udara: Number(o.kelembapan_udara), tanah: Number(o.kelembapan_tanah) }, p = pumpField(o); if (p !== undefined) r.pump = p; return r; }
    function parse(j) {
        if (!j || typeof j !== 'object') return [];
        if (typeof j.suhu !== 'undefined') return [norm(j, Date.now())];
        return Object.keys(j).sort().filter(function (k) { return j[k] && typeof j[k] === 'object'; })
            .map(function (k) { return norm(j[k], pushTime(k) || Date.now()); })
            .filter(function (r) { return isFinite(r.tanah); });
    }
    async function fetchRows(url, n, signalMs) {
        var ctrl = new AbortController();
        var to = setTimeout(function () { ctrl.abort(); }, signalMs || 6000);
        try {
            var res = await fetch(url + '?orderBy=' + encodeURIComponent('"$key"') + '&limitToLast=' + n, { signal: ctrl.signal, cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return parse(await res.json());
        } finally { clearTimeout(to); }
    }

    /* demo data */
    var demo = { soil: 74, temp: 28.4, hum: 66, boost: 0 };
    function demoStep(t) {
        var pump = demo.soil <= S.dry;
        if (pump) { demo.soil += 0.8 + Math.random() * 0.4; demo.boost = 8; }
        else if (demo.boost > 0) { demo.soil += 0.5; demo.boost--; }
        else demo.soil -= 0.06 + Math.random() * 0.06;
        demo.soil = Math.max(20, Math.min(98, demo.soil));
        demo.temp += (Math.random() - 0.5) * 0.2 + (28.4 - demo.temp) * 0.03;
        demo.hum += (Math.random() - 0.5) * 0.5 + (66 - demo.hum) * 0.03;
        return { t: t, suhu: demo.temp, udara: demo.hum, tanah: demo.soil };
    }
    function demoRows(n) {
        var now = Date.now(), rows = [];
        for (var i = n - 1; i >= 0; i--) rows.push(demoStep(now - i * 1000));
        return rows;
    }
    function startDemo() {
        mode = 'demo'; hist = []; net = true;
        merge(demoRows(Math.min(S.fetchN, 600)));
        $('#notice').hidden = S.forceDemo;
    }

    function merge(rows) {
        var lt = hist.length ? last().t : 0, added = [];
        rows.forEach(function (r) { if (r.t > lt) { hist.push(r); added.push(r); lt = r.t; } });
        if (hist.length > 3600) hist.splice(0, hist.length - 3600);
    }

    async function poll() {
        if (mode === 'init' && S.forceDemo) startDemo();
        else if (mode === 'demo') merge(demoRows(Math.max(1, Math.round(S.poll / 1000))));
        else {
            try {
                var n = hist.length ? Math.min(600, Math.max(20, Math.ceil((Date.now() - last().t) / 1000) + 6)) : S.fetchN;
                merge(await fetchRows(S.firebase, n));
                mode = 'live'; net = true;
            } catch (e) {
                if (mode === 'init') startDemo(); else net = false;
            }
        }
        renderAll();
        setTimeout(poll, S.poll);
    }

    /* ================= Grafik ================= */
    function cfg(k) {
        if (k === 'tanah') return { key: k, label: 'Kelembapan tanah', unit: '%', color: '--ok', get: function (r) { return r.tanah; }, dec: 0, min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100], band: [S.dry, S.wet], thr: [S.dry, S.wet] };
        if (k === 'suhu') return { key: k, label: 'Suhu udara', unit: tu(), color: '--temp', get: function (r) { return tc(r.suhu); }, dec: 1, minSpan: S.unit === 'F' ? 4 : 2 };
        return { key: k, label: 'Kelembapan udara', unit: '%', color: '--wet', get: function (r) { return r.udara; }, dec: 0, minSpan: 6 };
    }
    function setReadout(el, r, o) {
        el.style.setProperty('--c', 'var(' + o.color + ')');
        el.innerHTML = r ? '<b>' + num(o.get(r), o.dec) + ' ' + o.unit + '</b><span class="label">' + o.label + ' · ' + fmtT(r.t) + '</span>' : '';
    }
    function lineChart(host, rows, o, roEl) {
        host.style.setProperty('--c', 'var(' + o.color + ')');
        if (rows.length < 2) { host.innerHTML = '<p class="empty">Menunggu data sensor…</p>'; if (roEl) setReadout(roEl, null, o); return; }
        var w = Math.max(host.clientWidth, 260), h = o.h || 180, m = { l: 42, r: 12, t: 12, b: 26 };
        var iw = w - m.l - m.r, ih = h - m.t - m.b;
        var vals = rows.map(o.get), a = o.min, b = o.max, ticks = o.ticks ? o.ticks.slice() : [];
        if (a === undefined) {
            var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
            var span = Math.max(hi - lo, o.minSpan || 2), mid = (hi + lo) / 2;
            a = Math.floor(mid - span * 0.75); b = Math.ceil(mid + span * 0.75);
            for (var i = 0; i <= 4; i++) ticks.push(a + i * (b - a) / 4);
        }
        var t0 = rows[0].t, t1 = rows[rows.length - 1].t;
        var X = function (t) { return m.l + (t - t0) / ((t1 - t0) || 1) * iw; };
        var Y = function (v) { return m.t + (1 - (v - a) / (b - a)) * ih; };
        var tdec = (ticks.length > 1 && (ticks[1] - ticks[0]) % 1) ? 1 : 0;
        var out = '';
        if (o.band) out += '<rect class="band" x="' + m.l + '" y="' + Y(o.band[1]).toFixed(1) + '" width="' + iw + '" height="' + (Y(o.band[0]) - Y(o.band[1])).toFixed(1) + '"/>';
        ticks.forEach(function (tv) {
            var y = Y(tv);
            out += '<line class="gl" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>';
            out += '<text x="' + (m.l - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + tv.toFixed(tdec) + '</text>';
        });
        var nx = w < 480 ? 3 : 4;
        for (var k = 0; k < nx; k++) {
            var f = k / (nx - 1), anchor = k === 0 ? 'start' : (k === nx - 1 ? 'end' : 'middle');
            out += '<text x="' + (m.l + f * iw).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="' + anchor + '">' + fmtT(t0 + f * (t1 - t0), true) + '</text>';
        }
        var pts = rows.map(function (r, i) { return [X(r.t), Y(vals[i])]; });
        var d = 'M' + pts.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('L');
        var e = pts[pts.length - 1];
        out += '<path class="area" d="' + d + 'L' + e[0].toFixed(1) + ' ' + Y(a) + 'L' + pts[0][0].toFixed(1) + ' ' + Y(a) + 'Z"/><path class="ln" d="' + d + '"/>';
        out += '<line class="guide" y1="' + m.t + '" y2="' + (m.t + ih) + '" visibility="hidden"/><circle class="gdot" r="4.5" visibility="hidden"/>';
        out += '<circle class="ring" cx="' + e[0].toFixed(1) + '" cy="' + e[1].toFixed(1) + '" r="7"/><circle class="end" cx="' + e[0].toFixed(1) + '" cy="' + e[1].toFixed(1) + '" r="4"/>';
        out += '<rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '" fill="none" pointer-events="all"/>';
        host.innerHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Grafik ' + o.label + '">' + out + '</svg>';
        if (roEl) setReadout(roEl, rows[rows.length - 1], o);
        var svg = host.querySelector('svg'), guide = svg.querySelector('.guide'), gdot = svg.querySelector('.gdot'), hit = svg.querySelector('.hit');
        function move(ev) {
            var x = ev.clientX - svg.getBoundingClientRect().left, best = 0, bd = Infinity;
            pts.forEach(function (q, i) { var dd = Math.abs(q[0] - x); if (dd < bd) { bd = dd; best = i; } });
            guide.setAttribute('x1', pts[best][0]); guide.setAttribute('x2', pts[best][0]);
            gdot.setAttribute('cx', pts[best][0]); gdot.setAttribute('cy', pts[best][1]);
            guide.setAttribute('visibility', 'visible'); gdot.setAttribute('visibility', 'visible');
            if (roEl) setReadout(roEl, rows[best], o);
        }
        function leave() { guide.setAttribute('visibility', 'hidden'); gdot.setAttribute('visibility', 'hidden'); if (roEl) setReadout(roEl, rows[rows.length - 1], o); }
        hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', leave);
    }
    function spark(host, vals, dec, rangeEl) {
        if (vals.length < 2) { host.innerHTML = ''; if (rangeEl) rangeEl.textContent = ''; return; }
        var w = Math.max(host.clientWidth, 80), h = 40, p = 4;
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        var span = Math.max(hi - lo, 0.5), a = lo - span * 0.15, b = hi + span * 0.15, n = vals.length;
        var pts = vals.map(function (v, i) { return [p + i / (n - 1) * (w - 2 * p), p + (1 - (v - a) / (b - a)) * (h - 2 * p)]; });
        var d = 'M' + pts.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('L'), e = pts[n - 1];
        host.innerHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path class="area" d="' + d + 'L' + e[0].toFixed(1) + ' ' + h + 'L' + pts[0][0].toFixed(1) + ' ' + h + 'Z"/><path class="ln" d="' + d + '"/><circle class="ring" cx="' + e[0] + '" cy="' + e[1] + '" r="6"/><circle class="end" cx="' + e[0] + '" cy="' + e[1] + '" r="3"/></svg>';
        if (rangeEl) rangeEl.textContent = 'min ' + num(lo, dec) + ' · maks ' + num(hi, dec);
    }

    /* ================= Pompa ================= */
    function rowOn(r) { return r.pump !== undefined ? r.pump : r.tanah <= S.dry; }
    function pumpStats(rows) {
        var cycles = 0, on = 0, prevOn = false;
        rows.forEach(function (r, i) {
            var d = rowOn(r);
            if (d && !prevOn) cycles++;
            if (i > 0 && prevOn) on += Math.min(r.t - rows[i - 1].t, 5000);
            prevOn = d;
        });
        return { cycles: cycles, on: on };
    }
    function pumpState() {
        var r = last();
        if (!r) return { known: false, on: false, text: 'Belum ada data', src: 'none', detail: 'Menunggu pembacaan sensor.' };
        var device = r.pump !== undefined, src = mode === 'demo' ? 'demo' : (device ? 'device' : 'inferred');
        var srcTxt = src === 'demo' ? 'Data contoh (bukan perangkat sungguhan)' : (device ? 'Dilaporkan perangkat' : 'Disimpulkan: tanah ' + (rowOn(r) ? 'pada/di bawah' : 'di atas') + ' batas kering ' + S.dry + '%');
        if (mode === 'live' && (Date.now() - r.t) / 1000 > S.rules.off.v)
            return { known: false, on: false, text: 'Tidak diketahui', src: src, detail: 'Perangkat offline; status terakhir tidak bisa dipastikan.', last: rowOn(r) };
        var on = rowOn(r), since = r.t;
        for (var i = hist.length - 2; i >= 0; i--) { if (rowOn(hist[i]) !== on) break; since = hist[i].t; }
        return { known: true, on: on, text: on ? 'Menyala' : 'Mati', src: src, detail: srcTxt, since: since, sinceMs: Date.now() - since };
    }
    function pumpHTML(ps) { return ps.known ? '<span class="pump' + (ps.on ? ' on' : '') + '">' + ps.text + '</span>' : '<span class="pump">' + ps.text + '</span>'; }

    /* ================= Rute ================= */
    var PAGES = [
        { o: 10, id: 'dashboard', name: 'Dashboard', sub: 'Pemantauan sensor realtime', ic: '<path d="M3 12h4l3-8 4 16 3-8h4"/>' },
        { o: 20, id: 'kamera', name: 'Kamera ESP-32 CAM', sub: 'Pantau tanaman langsung dari ESP32-CAM', ic: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>' },
        { o: 30, id: 'lstm', name: 'LSTM', sub: 'Prediksi kematangan tanaman', ic: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/>' },
        { o: 40, id: 'cnn', name: 'CNN', sub: 'Analisis gambar daun selada', ic: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/>' },
        { o: 50, id: 'pengaturan', name: 'Pengaturan', sub: 'Koneksi, satuan, dan tampilan', ic: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' }
    ];
    var page = 'dashboard', EXT = {};

    function buildNav() {
        var h = PAGES.map(function (p) {
            return '<a href="#' + p.id + '" data-p="' + p.id + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + p.ic + '</svg><span>' + p.name + '</span></a>';
        }).join('');
        $('#nav').innerHTML = h;
    }

    var NAVKEY = 'selada-nav-open-v3';
    var mq = window.matchMedia ? window.matchMedia('(max-width: 960px)') : { matches: false };
    function isMobile() { return mq.matches; }
    function setNav(open, remember) {
        document.body.classList.toggle('nav-open', open);
        $('#hamb').setAttribute('aria-expanded', String(open));
        if (remember && !isMobile()) { try { localStorage.setItem(NAVKEY, open ? '1' : '0'); } catch (e) { } }
        requestAnimationFrame(renderAll);
    }
    function initNav() {
        var open = true;
        if (isMobile()) open = false;
        else { try { if (localStorage.getItem(NAVKEY) === '0') open = false; } catch (e) { } }
        setNav(open, false);
        $('#hamb').addEventListener('click', function () {
            var open = !document.body.classList.contains('nav-open');
            setNav(open, true);
        });
        $('#sideclose').addEventListener('click', function () { setNav(false, false); $('#hamb').focus(); });
        $('#scrim').addEventListener('click', function () { setNav(false, false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isMobile() && document.body.classList.contains('nav-open')) { setNav(false, false); $('#hamb').focus(); }
        });
        $('#nav').addEventListener('click', function (e) { if (e.target.closest('a') && isMobile()) setNav(false, false); });
        var onMq = function () {
            if (isMobile()) setNav(false, false);
            else { var o = true; try { if (localStorage.getItem(NAVKEY) === '0') o = false; } catch (e) { } setNav(o, false); }
        };
        if (mq.addEventListener) mq.addEventListener('change', onMq);
    }

    function route(forced) {
        var id = typeof forced === 'string' ? forced : (location.hash || '').slice(1);
        if (!PAGES.some(function (p) { return p.id === id; })) id = 'dashboard';
        if (page === 'kamera' && id !== 'kamera') camLeave();
        if (page !== id && EXT[page] && EXT[page].leave) { try { EXT[page].leave(); } catch (e) { console.error(e); } }
        var prevPage = page;
        page = id;
        $$('.page').forEach(function (s) { s.hidden = s.id !== 'p-' + id; });
        var P = PAGES.filter(function (p) { return p.id === id; })[0];
        $('#ptitle').textContent = P.name; $('#psub').textContent = P.sub;
        document.title = P.name + ' · Selada Keriting · Kelompok 2';
        $$('#nav a').forEach(function (a) { if (a.dataset.p === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
        if (id === 'kamera') camEnter();
        if (id === 'pengaturan') fillSettings();
        if (EXT[id] && EXT[id].enter && prevPage !== id) { try { EXT[id].enter(); } catch (e) { console.error(e); } }
        renderAll();
        window.scrollTo(0, 0);
    }

    /* ================= Render Header ================= */
    function renderHeader() {
        var c = $('#conn'), r = last(), s = 'init', m = 'Menghubungkan…';
        if (mode === 'demo') { s = 'demo'; m = 'Data contoh'; }
        else if (mode === 'live') {
            if (!net) { s = 'bad'; m = 'Firebase tidak terbaca'; }
            else if (!r) { s = 'bad'; m = 'Belum ada data di Firebase'; }
            else if (Date.now() - r.t > S.rules.off.v * 1000) { s = 'bad'; m = 'Perangkat berhenti mengirim data'; }
            else { s = 'live'; m = 'Langsung dari Firebase'; }
        }
        c.dataset.s = s; $('#connText').textContent = m;
        $('#fresh').textContent = r ? Math.max(0, Math.round((Date.now() - r.t) / 1000)) + ' detik lalu' : '—';
    }

    /* ================= Render Dashboard ================= */
    var dbSeries = 'tanah';
    function renderDashboard() {
        var r = last();
        if (!r) return;

        var z = zone(r.tanah);
        var zColor = 'var(' + ZN[z].v + ')';

        // Status strip
        $('#dbSoil').textContent = num(r.tanah, 0) + ' %';
        $('#dbSoilStatus').textContent = ZN[z].name;
        $('#dbTemp').textContent = num(tc(r.suhu), 1) + ' ' + tu();
        $('#dbTempStatus').textContent = r.suhu > 32 ? 'Suhu tinggi' : (r.suhu < 15 ? 'Suhu rendah' : 'Normal');
        $('#dbHum').textContent = num(r.udara, 0) + ' %';
        $('#dbHumStatus').textContent = r.udara < 60 ? 'Udara kering' : 'Normal';
        var ps = pumpState();
        $('#dbPump').innerHTML = pumpHTML(ps);
        $('#dbPumpSince').textContent = ps.known ? (ps.on ? 'Menyala' : 'Mati') : 'Tidak diketahui';

        // Conn status strip
        var dbConn = $('#dbConn');
        if (dbConn) {
            var cs = mode === 'demo' ? 'demo' : (mode === 'live' && net ? 'live' : 'bad');
            dbConn.dataset.s = cs;
            $('#dbConnText').textContent = mode === 'demo' ? 'Data contoh' : (net ? 'Firebase' : 'Gagal');
        }

        // Cards
        $('#dbSoilBig').textContent = num(r.tanah, 0);
        var soilPill = $('#dbSoilPill');
        soilPill.textContent = ZN[z].name;
        soilPill.style.setProperty('--z', zColor);
        $('#dbSoilHint').textContent = hint(z);

        $('#dbTempBig').textContent = num(tc(r.suhu), 1);
        $('#dbTempU').textContent = tu();
        $('#dbHumBig').textContent = num(r.udara, 0);

        var w60 = win(60);
        spark($('#dbTempSpark'), w60.map(function (x) { return tc(x.suhu); }), 1, $('#dbTempRange'));
        spark($('#dbHumSpark'), w60.map(function (x) { return x.udara; }), 0, $('#dbHumRange'));

        // Charts
        lineChart($('#dbChSoil'), w60, cfg('tanah'));
        lineChart($('#dbChTemp'), w60, cfg('suhu'));
        lineChart($('#dbChHum'), w60, cfg('udara'));
        lineChart($('#dbChMain'), w60, cfg(dbSeries), $('#dbRo'));

        // Pump panel
        $('#dbPumpState').innerHTML = pumpHTML(ps);
        $('#dbPumpSinceDetail').textContent = ps.known ? (ps.on ? 'Menyala sejak ' : 'Mati sejak ') + fmtT(ps.since) + ' (' + dur(ps.sinceMs) + ')' : '—';
        $('#dbPumpDetail').textContent = ps.detail;

        // System
        $('#dbSysSrc').textContent = mode === 'demo' ? 'Data contoh' : 'Firebase';
        $('#dbSysLast').textContent = fmtT(r.t);
        $('#dbSysCount').textContent = hist.length;
        var pst = pumpStats(hist);
        $('#dbSysCycles').textContent = pst.cycles + ' kali';
        $('#dbSysOn').textContent = dur(pst.on);
    }

    /* ================= Render All ================= */
    function renderAll() {
        renderHeader();
        if (page === 'dashboard') renderDashboard();
        else if (EXT[page] && EXT[page].render) { try { EXT[page].render(); } catch (e) { console.error(e); } }
    }

    /* ================= Kamera ================= */
    var cam = { mode: 'stream', interval: 3000, run: false, want: false, timer: 0, lastFrame: null, retry: 0, pre: null, watch: 0, live: false };
    var camimg = $('#camimg'), camstate = $('#camstate');
    var CAMICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
    function camMsg(title, text) {
        camstate.hidden = false;
        camstate.innerHTML = CAMICON + '<b></b><p></p>';
        camstate.querySelector('b').textContent = title; camstate.querySelector('p').textContent = text;
    }
    function camIdle() { camMsg('Kamera belum terhubung', 'Masukkan IP kamera yang tampil di portal ESP32-CAM. IP portal (bawaan 192.168.4.1) diatur terpisah.'); }
    function cleanIp(v) { return v.trim().replace(/^https?:\/\//, '').replace(/[\/?#].*$/, ''); }
    function portalHost() { return S.portalIp || '192.168.4.1'; }
    function updatePortalLink() { var p = $('#portal'); p.href = 'http://' + portalHost() + '/'; p.textContent = 'Buka portal kamera (' + portalHost() + ')'; p.hidden = false; }
    function camUrl(path) { return 'http://' + S.camIp + path + (path.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(); }
    function camOk() { camimg.hidden = false; camstate.hidden = true; $('#livebadge').hidden = false; }
    function camFail() {
        if (cam.run && cam.retry < 6) {
            cam.retry++; clearTimeout(cam.timer);
            camMsg('Menyambung ulang…', 'Percobaan ' + cam.retry + ' dari 6.');
            cam.timer = setTimeout(function () { if (cam.run) camLoad(); }, 300);
            return;
        }
        cam.run = false; clearTimeout(cam.timer);
        camimg.hidden = true; $('#livebadge').hidden = true;
        camMsg('Video tidak bisa dimuat', location.protocol === 'https:'
            ? 'Halaman https tidak bisa memuat gambar http dari kamera. Buka dashboard dari file lokal, atau izinkan konten tidak aman untuk situs ini.'
            : 'Pastikan satu jaringan dengan kamera, IP benar, dan tidak ada tab lain yang sedang menonton stream.');
    }
    function camStop() {
        cam.run = false; clearTimeout(cam.timer); clearTimeout(cam.watch);
        if (cam.pre) { cam.pre.onload = null; cam.pre.onerror = null; cam.pre.src = ''; cam.pre = null; }
        camimg.onload = null; camimg.onerror = null;
        camimg.removeAttribute('src');
        camimg.hidden = true; $('#livebadge').hidden = true;
    }
    function camNextPhoto() {
        if (!cam.run) return;
        var im = new Image(); cam.pre = im;
        im.decoding = 'async';
        im.onload = function () {
            if (!cam.run || cam.pre !== im) return;
            camimg.src = im.src; cam.retry = 0; camOk();
            cam.timer = setTimeout(camNextPhoto, cam.interval);
        };
        im.onerror = camFail;
        im.src = camUrl('/capture');
    }
    function camLoad() {
        clearTimeout(cam.watch);
        if (cam.mode !== 'stream') { camimg.onerror = null; camimg.onload = null; camNextPhoto(); return; }
        var im = new Image(); cam.pre = im; im.decoding = 'async';
        function openStream() {
            if (!cam.run) return;
            camimg.onerror = camFail;
            cam.live = false;
            camimg.onload = function () { clearTimeout(cam.watch); cam.live = true; cam.retry = 0; camOk(); };
            camimg.decoding = 'async';
            camimg.src = camUrl('/stream');
            cam.watch = setTimeout(function () { if (cam.run && !cam.live) camFail(); }, 5000);
        }
        im.onload = function () { if (!cam.run || cam.pre !== im) return; camimg.src = im.src; camOk(); setTimeout(openStream, 60); };
        im.onerror = function () { if (cam.run && cam.pre === im) openStream(); };
        im.src = camUrl('/capture');
        cam.watch = setTimeout(function () { if (cam.run && cam.pre === im && !camimg.naturalWidth) { im.onload = null; im.onerror = null; im.src = ''; openStream(); } }, 2000);
    }
    function camStart() {
        if (!S.camIp) { camIdle(); return; }
        camStop(); cam.run = true; cam.want = true; cam.retry = 0; cam.live = false;
        camMsg('Menghubungkan kamera…', 'Memuat dari ' + S.camIp + '.');
        $('#camOff').hidden = false; updatePortalLink();
        camLoad();
    }
    function camEnter() { measureView(); $('#camip').value = S.camIp || ''; $('#portalip').value = S.portalIp || ''; updatePortalLink(); if (S.camIp && !cam.run && cam.want !== false) camStart(); else if (!cam.run) camIdle(); renderGallery(); }
    function camLeave() {
        exitFull();
        try {
            if (!camimg.hidden && camimg.naturalWidth) {
                var c = document.createElement('canvas'); c.width = camimg.naturalWidth; c.height = camimg.naturalHeight;
                c.getContext('2d').drawImage(camimg, 0, 0); cam.lastFrame = { c: c, t: Date.now() };
            }
        } catch (e) { }
        camStop();
    }
    var gallery = [];
    function renderGallery() {
        var g = $('#gallery'); g.innerHTML = '';
        gallery.forEach(function (it, i) {
            var f = document.createElement('figure'); f.appendChild(it.c);
            var cap = document.createElement('figcaption'); var sp = document.createElement('span'); sp.textContent = fmtT(it.t);
            var b = document.createElement('button'); b.className = 'btn ghost small'; b.type = 'button'; b.textContent = 'Hapus';
            b.addEventListener('click', function () { gallery.splice(i, 1); renderGallery(); });
            cap.appendChild(sp); cap.appendChild(b); f.appendChild(cap); g.appendChild(f);
        });
        $('#galEmpty').hidden = gallery.length > 0; $('#galClear').hidden = gallery.length === 0;
    }
    var V = { z: 1, x: 0, y: 0 };
    function isFull() { var v = $('#camview'); return document.fullscreenElement === v || v.classList.contains('pseudo-full'); }
    var viewW = 0, viewH = 0, viewQ = 0;
    function measureView() { var v = $('#camview'); viewW = v.clientWidth; viewH = v.clientHeight; }
    function clampPan() { var mx = (V.z - 1) * viewW / 2, my = (V.z - 1) * viewH / 2; V.x = Math.max(-mx, Math.min(mx, V.x)); V.y = Math.max(-my, Math.min(my, V.y)); }
    function applyView() {
        if (viewQ) return;
        viewQ = requestAnimationFrame(function () {
            viewQ = 0;
            if (!viewW) measureView();
            clampPan();
            var br = $('#vBr').value, ct = $('#vCt').value;
            camimg.style.filter = (br === '100' && ct === '100') ? '' : 'brightness(' + br + '%) contrast(' + ct + '%)';
            camimg.style.transform = 'translate3d(' + V.x.toFixed(1) + 'px,' + V.y.toFixed(1) + 'px,0) scale(' + V.z + ')' + ($('#vMir').checked ? ' scaleX(-1)' : '') + ($('#vRot').checked ? ' rotate(180deg)' : '');
            $('#zLvl').textContent = Math.round(V.z * 100) + '%';
            $('#vZm').value = Math.round(V.z * 100);
            $('#camview').classList.toggle('zoomed', V.z > 1);
        });
    }
    function zoomTo(nz, cx, cy) {
        nz = Math.max(1, Math.min(4, nz));
        var k = nz / V.z; cx = cx || 0; cy = cy || 0;
        V.x = cx - k * (cx - V.x); V.y = cy - k * (cy - V.y); V.z = nz;
        if (nz === 1) { V.x = 0; V.y = 0; }
        applyView();
    }
    function setFullUI() { var f = isFull(); $('#camview').classList.toggle('isfull', f); measureView(); $('#zFs').setAttribute('aria-label', f ? 'Keluar layar penuh' : 'Layar penuh'); $('#camFull').textContent = f ? 'Keluar layar penuh' : 'Layar penuh'; applyView(); }
    function exitFull() {
        var v = $('#camview');
        if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { } }
        v.classList.remove('pseudo-full'); document.documentElement.style.overflow = '';
        setFullUI();
    }
    function enterFull() {
        var v = $('#camview');
        function pseudo() { v.classList.add('pseudo-full'); document.documentElement.style.overflow = 'hidden'; setFullUI(); }
        if (v.requestFullscreen) { try { v.requestFullscreen().then(setFullUI, pseudo); } catch (e) { pseudo(); } } else pseudo();
    }
    function toggleFull() { if (isFull()) exitFull(); else enterFull(); }
    function initZoom() {
        var v = $('#camview'), ptrs = {}, pinch = null;
        function rel(x, y) { var r = v.getBoundingClientRect(); return [x - r.left - r.width / 2, y - r.top - r.height / 2]; }
        $('#zIn').addEventListener('click', function () { zoomTo(V.z * 1.3); });
        $('#zOut').addEventListener('click', function () { zoomTo(V.z / 1.3); });
        $('#zLvl').addEventListener('click', function () { zoomTo(1); });
        $('#zFs').addEventListener('click', toggleFull);
        $('#camFull').addEventListener('click', toggleFull);
        $('#vZm').addEventListener('input', function () { zoomTo(this.value / 100); });
        v.addEventListener('wheel', function (e) { if (camimg.hidden) return; e.preventDefault(); var p = rel(e.clientX, e.clientY); zoomTo(V.z * Math.exp(-e.deltaY * 0.0015), p[0], p[1]); }, { passive: false });
        v.addEventListener('dblclick', function (e) { if (camimg.hidden || e.target.closest('.camzoom')) return; var p = rel(e.clientX, e.clientY); if (V.z > 1) zoomTo(1); else zoomTo(2.5, p[0], p[1]); });
        v.addEventListener('pointerdown', function (e) {
            if (e.target.closest('.camzoom') || camimg.hidden) return;
            ptrs[e.pointerId] = [e.clientX, e.clientY];
            try { v.setPointerCapture(e.pointerId); } catch (x) { }
            var ids = Object.keys(ptrs);
            if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: V.z }; }
        });
        v.addEventListener('pointermove', function (e) {
            var prev = ptrs[e.pointerId]; if (!prev) return;
            ptrs[e.pointerId] = [e.clientX, e.clientY];
            var ids = Object.keys(ptrs);
            if (ids.length >= 2 && pinch) { var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = rel((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); zoomTo(pinch.z * d / pinch.d, m[0], m[1]); }
            else if (ids.length === 1 && V.z > 1) { V.x += e.clientX - prev[0]; V.y += e.clientY - prev[1]; applyView(); }
        });
        function end(e) { delete ptrs[e.pointerId]; pinch = null; }
        v.addEventListener('pointerup', end); v.addEventListener('pointercancel', end);
        document.addEventListener('fullscreenchange', setFullUI);
        window.addEventListener('resize', function () { measureView(); applyView(); });
        document.addEventListener('keydown', function (e) {
            var t = e.target && e.target.tagName;
            if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
            if (e.key === 'Escape' && v.classList.contains('pseudo-full')) { exitFull(); return; }
            if (page !== 'kamera' || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === '+' || e.key === '=') zoomTo(V.z * 1.3);
            else if (e.key === '-' || e.key === '_') zoomTo(V.z / 1.3);
            else if (e.key === '0') zoomTo(1);
            else if (e.key === 'f' || e.key === 'F') toggleFull();
        });
        applyView();
    }

    /* ================= Pengaturan ================= */
    function fillSettings() {
        $('#setUrl').value = S.firebase;
        $('#setPoll').value = String(S.poll);
        $('#setFetchN').value = String(S.fetchN);
        $('#setDemo').checked = S.forceDemo;
        $('#setDry').value = S.dry;
        $('#setWet').value = S.wet;
        $('#setUnit').value = S.unit;
        $('#setClock').value = S.clock;
        $('#setTheme').value = S.theme;
    }
    function applyTheme() {
        var r = document.documentElement;
        if (S.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme);
    }
    function restart() { mode = 'init'; hist = []; net = true; $('#notice').hidden = true; }

    /* ================= Bind Events ================= */
    function bind() {
        $('#retry').addEventListener('click', restart);

        // Dashboard series selector
        $('#dbSeg').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            dbSeries = b.dataset.s;
            $$('#dbSeg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            renderAll();
        });

        // Camera
        $('#camGo').addEventListener('click', function () { var ip = cleanIp($('#camip').value); if (!ip) return; S.camIp = ip; save(); camStart(); });
        $('#camip').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#camGo').click(); });
        $('#portalSave').addEventListener('click', function () {
            var ip = cleanIp($('#portalip').value) || '192.168.4.1';
            S.portalIp = ip; $('#portalip').value = ip; save(); updatePortalLink(); toast('IP portal disimpan: ' + ip);
        });
        $('#portalip').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#portalSave').click(); });
        $('#useAp').addEventListener('click', function () { $('#portalip').value = '192.168.4.1'; $('#portalSave').click(); });
        $('#camReload').addEventListener('click', function () { camStart(); });
        $('#camOff').addEventListener('click', function () { cam.want = false; camStop(); camIdle(); $('#camOff').hidden = true; });
        $('#camMode').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            cam.mode = b.dataset.m;
            $$('#camMode button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            $('#intRow').hidden = cam.mode !== 'foto';
            if (cam.run || cam.want) camStart();
        });
        $('#intRow').hidden = true;
        $('#camInt').addEventListener('change', function () { cam.interval = Number(this.value); });
        $('#camSnap').addEventListener('click', function () {
            if (camimg.hidden || !camimg.naturalWidth) { toast('Belum ada gambar untuk difoto.'); return; }
            var c = document.createElement('canvas'); c.width = camimg.naturalWidth; c.height = camimg.naturalHeight;
            try { c.getContext('2d').drawImage(camimg, 0, 0); } catch (e) { toast('Foto gagal diambil.'); return; }
            gallery.unshift({ c: c, t: Date.now() }); if (gallery.length > 12) gallery.pop();
            renderGallery(); toast('Foto tersimpan di galeri sesi ini.');
        });
        $('#galClear').addEventListener('click', function () { gallery = []; renderGallery(); });
        ['vBr', 'vCt', 'vMir', 'vRot'].forEach(function (id) { $('#' + id).addEventListener('input', applyView); });
        $('#viewReset').addEventListener('click', function () { $('#vBr').value = 100; $('#vCt').value = 100; V.z = 1; V.x = 0; V.y = 0; $('#vMir').checked = false; $('#vRot').checked = false; applyView(); });

        // Pengaturan
        $('#setUrl').addEventListener('change', function () { var v = this.value.trim(); if (!v) return; S.firebase = v; save(); restart(); });
        $('#setPoll').addEventListener('change', function () { S.poll = Number(this.value); save(); });
        $('#setFetchN').addEventListener('change', function () { S.fetchN = Number(this.value); save(); restart(); });
        $('#setDemo').addEventListener('change', function () { S.forceDemo = this.checked; save(); restart(); });
        $('#setUnit').addEventListener('change', function () { S.unit = this.value; save(); renderAll(); });
        $('#setClock').addEventListener('change', function () { S.clock = this.value; save(); renderAll(); });
        $('#setTheme').addEventListener('change', function () { S.theme = this.value; save(); applyTheme(); });
        function zoneSave() {
            var d = Number($('#setDry').value), w = Number($('#setWet').value), m = $('#zoneMsg');
            if (!(d >= 1 && w <= 99 && d < w)) { m.className = 'msg err'; m.textContent = 'Batas kering harus lebih kecil dari batas basah.'; return; }
            S.dry = d; S.wet = w; save(); renderAll();
            m.className = 'msg good'; m.textContent = 'Tersimpan. Pompa tetap mengikuti program di ESP32.';
        }
        $('#setDry').addEventListener('change', zoneSave); $('#setWet').addEventListener('change', zoneSave);
        $('#testBtn').addEventListener('click', async function () {
            var m = $('#testMsg'), url = $('#setUrl').value.trim(); m.className = 'msg'; m.textContent = 'Menguji…';
            try {
                var rows = await fetchRows(url, 1, 6000);
                m.className = 'msg good'; m.textContent = rows.length ? 'Tersambung. Data terbaru pukul ' + fmtT(rows[0].t) + '.' : 'Tersambung, tetapi belum ada data di alamat ini.';
            } catch (e) { m.className = 'msg err'; m.textContent = 'Tidak bisa membaca alamat ini. Cek URL, aturan baca Firebase, dan koneksi internet.'; }
        });
        $('#setReset').addEventListener('click', function () {
            var ip = S.camIp, pip = S.portalIp; S = clone(DEF); S.camIp = ip; S.portalIp = pip; save(); applyTheme(); fillSettings(); restart(); toast('Pengaturan dikembalikan ke bawaan.');
        });
    }

    /* ================= Core API ================= */
    var core = {
        settings: function () { return S; },
        hist: function () { return hist; },
        last: last,
        mode: function () { return mode; },
        netOk: function () { return net; },
        pump: pumpState,
        pumpHTML: pumpHTML,
        pumpOn: rowOn,
        pumpStats: pumpStats,
        fmtT: fmtT,
        fmtDate: fmtDate,
        tc: tc,
        tu: tu,
        num: num,
        dur: dur,
        avg: avg,
        toast: toast,
        zone: zone,
        ZN: ZN,
        pushTime: pushTime,
        save: save,
        lineChart: lineChart,
        spark: spark,
        cfg: cfg,
        win: win,
        rerender: function () { renderAll(); },
        current: function () { return page; },
        go: function (id) { location.hash = id; },
        camLastFrame: function () { return cam.lastFrame; }
    };

    // Load external modules
    (window.SeladaModules || []).forEach(function (f) {
        try {
            [].concat(f(core)).forEach(function (m) {
                if (m && m.id) {
                    EXT[m.id] = m;
                    // Replace existing stub in PAGES if same id, else push
                    var idx = PAGES.findIndex ? PAGES.findIndex(function(p){ return p.id === m.id; }) : -1;
                    if (idx < 0) { for (var _i=0;_i<PAGES.length;_i++) { if(PAGES[_i].id===m.id){idx=_i;break;} } }
                    if (idx >= 0) { PAGES[idx] = m; } else { PAGES.push(m); }
                }
            });
        } catch (e) { console.error('Modul gagal dimuat:', e); }
    });
    PAGES.sort(function (a, b) { return (a.o || 500) - (b.o || 500); });
    window.Selada = core;

    buildNav(); bind(); initZoom(); initNav();
    Object.keys(EXT).forEach(function (k) { if (EXT[k].init) { try { EXT[k].init(); } catch (e) { console.error(e); } } });
    if (S.theme !== 'system') applyTheme();

    window.addEventListener('hashchange', function () { route(); });
    document.addEventListener('click', function (e) {
        var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
        if (!a) return;
        var id = a.getAttribute('href').slice(1);
        if (!PAGES.some(function (p) { return p.id === id; })) return;
        e.preventDefault();
        try { history.pushState(null, '', '#' + id); } catch (err) { }
        route(id);
    });
    route();

    var lastW = 0;
    if (window.ResizeObserver) new ResizeObserver(function () {
        var w = $('.main').clientWidth;
        if (w !== lastW) { lastW = w; requestAnimationFrame(renderAll); }
    }).observe($('.main'));

    setInterval(function () { renderHeader(); }, 1000);

    /* ================= Login ================= */
    var AUTH = { email: 'admin@gmail.com', pass: 'admin123', key: 'selada-auth-v2' };
    var polling = false, fails = 0, lockUntil = 0;
    function authed() {
        try { if (sessionStorage.getItem(AUTH.key) === '1' || localStorage.getItem(AUTH.key) === '1') return true; } catch (e) { }
        return false;
    }
    function setAuth(on, remember) {
        try { sessionStorage.removeItem(AUTH.key); localStorage.removeItem(AUTH.key); } catch (e) { }
        if (!on) return;
        try { (remember ? localStorage : sessionStorage).setItem(AUTH.key, '1'); } catch (e) { }
    }
    function unlock() {
        document.body.classList.remove('locked'); $('#login').hidden = true;
        $('#uemail').textContent = AUTH.email;
        if (!polling) { polling = true; poll(); }
        requestAnimationFrame(renderAll);
    }
    function lock() {
        setAuth(false);
        try { history.pushState(null, '', '#dashboard'); } catch (e) { }
        route('dashboard');
        if (document.body.classList.contains('nav-open') && isMobile()) setNav(false, false);
        document.body.classList.add('locked'); $('#login').hidden = false;
        $('#loginPass').value = ''; $('#loginMsg').textContent = '';
        $('#loginEmail').focus();
    }
    $('#loginForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = $('#loginMsg'), now = Date.now();
        if (now < lockUntil) { msg.textContent = 'Terlalu banyak percobaan. Coba lagi dalam ' + Math.ceil((lockUntil - now) / 1000) + ' detik.'; return; }
        var em = $('#loginEmail').value.trim().toLowerCase(), pw = $('#loginPass').value;
        if (!em || !pw) { msg.textContent = 'Isi email dan kata sandi.'; return; }
        if (em === AUTH.email && pw === AUTH.pass) {
            fails = 0; msg.textContent = '';
            setAuth(true, $('#loginRemember').checked);
            $('#loginPass').value = '';
            unlock();
        } else {
            fails++;
            if (fails >= 5) { fails = 0; lockUntil = now + 30000; msg.textContent = 'Terlalu banyak percobaan. Coba lagi dalam 30 detik.'; }
            else msg.textContent = 'Email atau kata sandi salah.';
            $('#loginPass').focus(); $('#loginPass').select();
        }
    });
    $('#loginEye').addEventListener('click', function () {
        var i = $('#loginPass'), show = i.type === 'password';
        i.type = show ? 'text' : 'password';
        this.textContent = show ? 'Sembunyi' : 'Tampil';
        this.setAttribute('aria-pressed', String(show));
        this.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    });
    $('#logout').addEventListener('click', lock);
    if (authed()) unlock(); else $('#loginEmail').focus();
})();
