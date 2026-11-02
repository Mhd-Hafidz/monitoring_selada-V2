(function () {
    'use strict';
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

    /* ================= Pengaturan ================= */
    var KEY = 'selada-dash-v2';
    var DEF = {
        firebase: 'https://smart-farming-selada-default-rtdb.asia-southeast1.firebasedatabase.app/kelompok2.json',
        poll: 2000, fetchN: 300, unit: 'C', clock: '24', theme: 'system', forceDemo: false,
        ver: 2, dry: 65, wet: 78, camIp: '', portalIp: '192.168.4.1',
        rules: { dry: { on: true }, wet: { on: true }, tmax: { on: true, v: 32 }, tmin: { on: true, v: 15 }, hmin: { on: true, v: 60 }, off: { on: true, v: 15 } }
    };
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function load() {
        var s = clone(DEF);
        try {
            var raw = localStorage.getItem(KEY);
            if (raw) {
                var o = JSON.parse(raw);
                var old = o.ver !== DEF.ver;   // batas lama (60/80/40) diganti acuan baru: tanah 65–78 %, udara 60–80 %
                Object.keys(o).forEach(function (k) {
                    if (old && (k === 'dry' || k === 'wet')) return;
                    if (k === 'rules') Object.keys(o.rules).forEach(function (r) { var v = Object.assign({}, s.rules[r], o.rules[r]); if (old && r === 'hmin') v.v = s.rules.hmin.v; s.rules[r] = v; });
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
        if (z === 'ok') return 'Kondisi baik (' + S.dry + '–' + S.wet + '%, target 70–76%). Pompa mati.';
        return 'Tanah basah (≥ ' + S.wet + '%). Pompa mati.';
    }
    function fmtT(t, short) {
        var d = new Date(t);
        if (S.clock === '12') return d.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: short ? undefined : '2-digit' });
        return d.toLocaleTimeString('en-GB', short ? { hour: '2-digit', minute: '2-digit' } : undefined);
    }
    function tc(c) { return S.unit === 'F' ? c * 1.8 + 32 : c; }
    function tu() { return S.unit === 'F' ? '°F' : '°C'; }
    function num(v, d) { return Number(v).toFixed(d); }
    function sign(v, d) { return (v > 0 ? '+' : (v < 0 ? '−' : '')) + Math.abs(v).toFixed(d); }
    function dur(ms) { var s = Math.round(ms / 1000), m = Math.floor(s / 60); return m ? m + ' mnt ' + (s % 60) + ' dtk' : s + ' dtk'; }
    function pillHTML(z) { return '<span class="pill" style="--z:var(' + ZN[z].v + ')">' + ZN[z].name + '</span>'; }
    function toast(msg) {
        var d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
        $('#toasts').appendChild(d);
        setTimeout(function () { d.remove(); }, 5000);
    }
    function flash(btn, txt) { var o = btn.textContent; btn.textContent = txt; setTimeout(function () { btn.textContent = o; }, 1600); }
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
    /* Status pompa dari perangkat (opsional): kolom pompa / pump / relay di Firebase. Tanpa kolom ini, status disimpulkan dari batas kering. */
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

    /* data contoh */
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
        mode = 'demo';
        hist = []; alerts = []; RS = {};
        merge(demoRows(Math.min(S.fetchN, 600)));
        $('#notice').hidden = S.forceDemo;
    }

    function merge(rows) {
        var initial = hist.length === 0, lt = initial ? 0 : last().t, added = [];
        rows.forEach(function (r) { if (r.t > lt) { hist.push(r); added.push(r); lt = r.t; } });
        if (hist.length > 3600) hist.splice(0, hist.length - 3600);
        added.forEach(function (r) { evalRow(r, initial); });
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

    /* ================= Peringatan ================= */
    var alerts = [], RS = {}, aid = 0, alertHooks = [];
    var RULES = [
        { id: 'dry', name: 'Tanah kering', desc: 'Kelembapan tanah di bawah batas kering.', fixed: function () { return '< ' + S.dry + ' %'; } },
        { id: 'wet', name: 'Tanah terlalu basah', desc: 'Kelembapan tanah di atas batas basah.', fixed: function () { return '> ' + S.wet + ' %'; } },
        { id: 'tmax', name: 'Suhu tinggi', desc: 'Suhu udara di atas batas.', unit: '°C', step: 1 },
        { id: 'tmin', name: 'Suhu rendah', desc: 'Suhu udara di bawah batas.', unit: '°C', step: 1 },
        { id: 'hmin', name: 'Udara terlalu kering', desc: 'Kelembapan udara di bawah batas.', unit: '%', step: 1 },
        { id: 'off', name: 'Perangkat offline', desc: 'Tidak ada data baru selama batas waktu.', unit: 'detik', step: 5 }
    ];
    function addAlert(sev, rule, msg, t, silent) {
        alerts.unshift({ id: ++aid, t: t, sev: sev, rule: rule, msg: msg, read: !!silent && sev === 'info' });
        if (alerts.length > 100) alerts.pop();
        if (!silent) alertHooks.forEach(function (f) { try { f(alerts[0]); } catch (e) { console.error(e); } });
        if (!silent && sev !== 'info') toast(msg);
    }
    function edge(rule, active, sev, onMsg, offMsg, r, silent) {
        var prev = RS[rule];
        RS[rule] = active;
        if (active && !prev) addAlert(sev, rule, onMsg, r.t, silent);
        else if (!active && prev === true) addAlert('info', rule, offMsg, r.t, silent);
    }
    function evalRow(r, silent) {
        var R = S.rules;
        edge('dry', R.dry.on && r.tanah <= S.dry, 'warn', 'Tanah kering (' + num(r.tanah, 0) + '%). Pompa menyala.', 'Kelembapan tanah kembali ke ' + num(r.tanah, 0) + '%. Pompa mati.', r, silent);
        edge('wet', R.wet.on && r.tanah >= S.wet, 'warn', 'Tanah terlalu basah (' + num(r.tanah, 0) + '%).', 'Kelembapan tanah turun ke ' + num(r.tanah, 0) + '%.', r, silent);
        edge('tmax', R.tmax.on && r.suhu > R.tmax.v, 'crit', 'Suhu tinggi (' + num(tc(r.suhu), 1) + ' ' + tu() + ').', 'Suhu kembali ke ' + num(tc(r.suhu), 1) + ' ' + tu() + '.', r, silent);
        edge('tmin', R.tmin.on && r.suhu < R.tmin.v, 'warn', 'Suhu rendah (' + num(tc(r.suhu), 1) + ' ' + tu() + ').', 'Suhu kembali ke ' + num(tc(r.suhu), 1) + ' ' + tu() + '.', r, silent);
        edge('hmin', R.hmin.on && r.udara < R.hmin.v, 'warn', 'Udara terlalu kering (' + num(r.udara, 0) + '%).', 'Kelembapan udara kembali ke ' + num(r.udara, 0) + '%.', r, silent);
    }
    function checkOffline() {
        var r = last();
        if (mode !== 'live' || !r) return;
        var off = S.rules.off.on && (Date.now() - r.t > S.rules.off.v * 1000);
        var prev = RS.off;
        RS.off = off;
        if (off && !prev) addAlert('crit', 'off', 'Perangkat berhenti mengirim data.', Date.now(), false);
        else if (!off && prev === true) addAlert('info', 'off', 'Data kembali masuk.', Date.now(), false);
    }
    function unread() { return alerts.filter(function (a) { return !a.read && a.sev !== 'info'; }).length; }
    var SEV = { crit: { n: 'Penting', v: '--bad' }, warn: { n: 'Peringatan', v: '--dry' }, info: { n: 'Info', v: '--wet' } };
    function evHTML(list) {
        if (!list.length) return '<p class="empty">Belum ada kejadian.</p>';
        return list.map(function (a) {
            return '<div class="ev' + (a.read ? '' : ' unread') + '"><span class="sev" style="--z:var(' + SEV[a.sev].v + ')">' + SEV[a.sev].n + '</span><span class="m">' + a.msg + '</span><span class="time">' + fmtT(a.t) + '</span></div>';
        }).join('');
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
        var w = Math.max(host.clientWidth, 260), h = o.h || 240, m = { l: 42, r: 12, t: 12, b: 26 };
        var iw = w - m.l - m.r, ih = h - m.t - m.b;
        var vals = rows.map(o.get), a = o.min, b = o.max, ticks = o.ticks || [];
        if (a === undefined) {
            var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
            var span = Math.max(hi - lo, o.minSpan), mid = (hi + lo) / 2;
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
        (o.thr || []).forEach(function (tv) {
            var y = Y(tv);
            out += '<line class="thr" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>';
        });
        var nx = w < 480 ? 3 : 4;
        for (var k = 0; k < nx; k++) {
            var f = k / (nx - 1), anchor = k === 0 ? 'start' : (k === nx - 1 ? 'end' : 'middle');
            out += '<text x="' + (m.l + f * iw).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="' + anchor + '">' + fmtT(t0 + f * (t1 - t0)) + '</text>';
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
        function leave() {
            guide.setAttribute('visibility', 'hidden'); gdot.setAttribute('visibility', 'hidden');
            if (roEl) setReadout(roEl, rows[rows.length - 1], o);
        }
        hit.addEventListener('pointermove', move);
        hit.addEventListener('pointerdown', move);
        hit.addEventListener('pointerleave', leave);
    }
    function spark(host, vals, dec, rangeEl) {
        if (vals.length < 2) { host.innerHTML = ''; return; }
        var w = Math.max(host.clientWidth, 80), h = 40, p = 4;
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        var span = Math.max(hi - lo, 0.5), a = lo - span * 0.15, b = hi + span * 0.15, n = vals.length;
        var pts = vals.map(function (v, i) { return [p + i / (n - 1) * (w - 2 * p), p + (1 - (v - a) / (b - a)) * (h - 2 * p)]; });
        var d = 'M' + pts.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('L'), e = pts[n - 1];
        host.innerHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path class="area" d="' + d + 'L' + e[0].toFixed(1) + ' ' + h + 'L' + pts[0][0].toFixed(1) + ' ' + h + 'Z"/><path class="ln" d="' + d + '"/><circle class="ring" cx="' + e[0] + '" cy="' + e[1] + '" r="6"/><circle class="end" cx="' + e[0] + '" cy="' + e[1] + '" r="3"/></svg>';
        rangeEl.textContent = 'min ' + num(lo, dec) + ' · maks ' + num(hi, dec);
    }
    function scatter(host, rows) {
        if (rows.length < 3) { host.innerHTML = '<p class="empty">Menunggu data sensor…</p>'; $('#corr').textContent = ''; return; }
        var w = Math.max(host.clientWidth, 260), h = 230, m = { l: 40, r: 12, t: 16, b: 30 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
        var xs = rows.map(function (r) { return tc(r.suhu); }), ys = rows.map(function (r) { return r.udara; });
        function rng(v, minSpan) { var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), mid = (lo + hi) / 2, sp = Math.max(hi - lo, minSpan); return [mid - sp * 0.65, mid + sp * 0.65]; }
        var rx = rng(xs, S.unit === 'F' ? 3 : 1.5), ry = rng(ys, 5);
        var X = function (v) { return m.l + (v - rx[0]) / (rx[1] - rx[0]) * iw; }, Y = function (v) { return m.t + (1 - (v - ry[0]) / (ry[1] - ry[0])) * ih; };
        var out = '';
        for (var i = 0; i <= 3; i++) {
            var vy = ry[0] + i * (ry[1] - ry[0]) / 3, vx = rx[0] + i * (rx[1] - rx[0]) / 3;
            out += '<line class="gl" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + Y(vy).toFixed(1) + '" y2="' + Y(vy).toFixed(1) + '"/><text x="' + (m.l - 8) + '" y="' + (Y(vy) + 3.5).toFixed(1) + '" text-anchor="end">' + vy.toFixed(0) + '</text>';
            out += '<text x="' + X(vx).toFixed(1) + '" y="' + (h - 14) + '" text-anchor="middle">' + vx.toFixed(1) + '</text>';
        }
        out += '<text x="' + m.l + '" y="8" text-anchor="start">Udara (%)</text><text x="' + (w - m.r) + '" y="' + (h - 1) + '" text-anchor="end">Suhu (' + tu() + ')</text>';
        rows.forEach(function (r, i) { out += '<circle class="pt" cx="' + X(xs[i]).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="2.6"/>'; });
        var li = rows.length - 1;
        out += '<circle class="ring" cx="' + X(xs[li]).toFixed(1) + '" cy="' + Y(ys[li]).toFixed(1) + '" r="7"/><circle class="end" cx="' + X(xs[li]).toFixed(1) + '" cy="' + Y(ys[li]).toFixed(1) + '" r="4"/>';
        host.innerHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Sebaran suhu dan kelembapan udara">' + out + '</svg>';
        var mx = avg(xs), my = avg(ys), sxy = 0, sxx = 0, syy = 0;
        xs.forEach(function (x, i) { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); syy += (ys[i] - my) * (ys[i] - my); });
        $('#corr').textContent = sxx && syy ? 'r = ' + (sxy / Math.sqrt(sxx * syy)).toFixed(2) : '';
    }

    /* ================= Statistik ================= */
    function stats(vals, thr) {
        var n = vals.length;
        if (!n) return null;
        var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
        var k = Math.max(3, Math.floor(n * 0.2)), d = avg(vals.slice(-k)) - avg(vals.slice(0, k));
        return { cur: vals[n - 1], avg: avg(vals), min: min, max: max, d: d, tr: (n < 10 || Math.abs(d) < thr) ? 'Stabil' : (d > 0 ? 'Naik' : 'Turun') };
    }
    function statHTML(st, unit, dec) {
        if (!st) return '';
        function s(l, v, sub) { return '<div class="stat"><span class="label">' + l + '</span><b>' + v + '</b><small>' + (sub || '&nbsp;') + '</small></div>'; }
        return s('Sekarang', num(st.cur, dec), unit) + s('Rata-rata', num(st.avg, dec), unit) + s('Terendah', num(st.min, dec), unit) + s('Tertinggi', num(st.max, dec), unit) + s('Tren', st.tr, st.tr === 'Stabil' ? 'perubahan kecil' : sign(st.d, dec) + ' ' + unit);
    }
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
    /* Status pompa saat ini. Sumber: kolom pompa dari perangkat bila ada; jika tidak, disimpulkan (soil < batas kering). */
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
        { o: 10, g: 'Pemantauan', id: 'ringkasan', name: 'Ringkasan', sub: 'Kondisi kebun saat ini', ic: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
        { o: 20, g: 'Pemantauan', id: 'sensor', name: 'Sensor', sub: 'Detail dan tren tiap sensor', ic: '<path d="M3 12h4l3-8 4 16 3-8h4"/>' },
        { o: 30, g: 'Pemantauan', id: 'kamera', name: 'Kamera', sub: 'Pantau tanaman langsung dari ESP32-CAM', ic: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>' },
        { o: 40, g: 'Pemantauan', id: 'riwayat', name: 'Riwayat', sub: 'Semua pembacaan yang diterima di sesi ini', ic: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
        { o: 50, g: 'Pemantauan', id: 'peringatan', name: 'Peringatan', sub: 'Aturan dan kejadian yang terdeteksi', ic: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/>' },
        { o: 900, g: 'Sistem', id: 'pengaturan', name: 'Pengaturan', sub: 'Koneksi, satuan, dan tampilan', ic: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' },
        { o: 910, g: 'Sistem', id: 'panduan', name: 'Panduan', sub: 'Pemasangan dan pemecahan masalah', ic: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>' }
    ];
    var page = 'ringkasan', EXT = {};
    function buildNav() {
        var lastG = '';
        var h = PAGES.map(function (p) {
            var gh = p.g && p.g !== lastG ? '<span class="navgroup">' + p.g + '</span>' : '';
            lastG = p.g || lastG;
            return gh + '<a href="#' + p.id + '" data-p="' + p.id + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + p.ic + '</svg><span>' + p.name + '</span>' + (p.id === 'peringatan' ? '<span class="count" hidden></span>' : '') + '</a>';
        }).join('');
        $('#nav').innerHTML = h;
    }
    /* menu hamburger: tutup-buka di desktop, laci di layar sempit */
    var NAVKEY = 'selada-nav-open';
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
            if (open && isMobile()) { var a = $('#nav a'); if (a) a.focus(); }
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
        if (!PAGES.some(function (p) { return p.id === id; })) id = 'ringkasan';
        if (page === 'kamera' && id !== 'kamera') camLeave();
        if (page !== id && EXT[page] && EXT[page].leave) { try { EXT[page].leave(); } catch (e) { console.error(e); } }
        var prevPage = page;
        page = id;
        $$('.page').forEach(function (s) { s.hidden = s.id !== 'p-' + id; });
        var P = PAGES.filter(function (p) { return p.id === id; })[0];
        $('#ptitle').textContent = P.name; $('#psub').textContent = P.sub;
        document.title = P.name + ' · Selada Keriting Monitor';
        $$('#nav a').forEach(function (a) { if (a.dataset.p === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
        if (id === 'kamera') camEnter();
        if (id === 'pengaturan') fillSettings();
        if (id === 'peringatan') buildRules();
        if (EXT[id] && EXT[id].enter && prevPage !== id) { try { EXT[id].enter(); } catch (e) { console.error(e); } }
        renderAll();
        window.scrollTo(0, 0);
    }

    /* ================= Render ================= */
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
        var n = unread();
        $$('.count').forEach(function (el) { el.hidden = !n; el.textContent = n; });
    }

    function buildZones() {
        var d = S.dry, w = S.wet;
        $('#zones').innerHTML = '<div class="ticks"><span style="left:0">0</span><span style="left:' + d + '%">' + d + '</span><span style="left:' + w + '%">' + w + '</span><span style="left:100%">100</span></div>' +
            '<div class="track"><i style="width:' + d + '%"></i><i style="width:' + (w - d) + '%"></i><i style="width:' + (100 - w) + '%"></i></div><div class="marker" id="marker" style="left:0"></div>' +
            '<div class="zone-names"><span style="width:' + d + '%">Kering</span><span style="width:' + (w - d) + '%">Normal</span><span style="width:' + (100 - w) + '%">Basah</span></div>';
    }

    var ovSeries = 'tanah', WIN = 60;
    function renderRingkasan() {
        var r = last();
        if (r) {
            var z = zone(r.tanah);
            $('#soilVal').innerHTML = num(r.tanah, 0) + '<small>%</small>';
            var pill = $('#soilPill'); pill.textContent = ZN[z].name; pill.style.setProperty('--z', 'var(' + ZN[z].v + ')');
            $('#soilHint').textContent = hint(z);
            var mk = $('#marker'); if (mk) mk.style.left = Math.max(0, Math.min(100, r.tanah)) + '%';
            var pst = pumpState(); $('#sysPump').innerHTML = pumpHTML(pst);
            $('#pumpState').innerHTML = pumpHTML(pst); $('#pumpDetail').textContent = pst.detail;
            $('#pumpSince').textContent = pst.known ? (pst.on ? 'Menyala sejak ' : 'Mati sejak ') + fmtT(pst.since) + ' (' + dur(pst.sinceMs) + ')' : '—';
            $('#tempVal').innerHTML = num(tc(r.suhu), 1) + '<small>' + tu() + '</small>';
            $('#airVal').innerHTML = num(r.udara, 0) + '<small>%</small>';
            var w = win(60);
            spark($('#tempSpark'), w.map(function (x) { return tc(x.suhu); }), 1, $('#tempRange'));
            spark($('#airSpark'), w.map(function (x) { return x.udara; }), 0, $('#airRange'));
            $('#sysLast').textContent = fmtT(r.t);
            var ps = pumpStats(hist);
            $('#sysCycles').textContent = ps.cycles + ' kali'; $('#sysOn').textContent = dur(ps.on); $('#sysCount').textContent = hist.length;
        }
        $('#sysSrc').textContent = mode === 'demo' ? 'Data contoh' : 'Firebase';
        var o = cfg(ovSeries);
        lineChart($('#ch-ov'), win(60), o, $('#ro-ov'));
        $('#alMini').innerHTML = evHTML(alerts.slice(0, 3));
        renderCamSummary();
    }

    function renderSensor() {
        var rows = win(WIN);
        $('#winInfo').textContent = rows.length + ' pembacaan · ' + (rows.length > 1 ? dur(rows[rows.length - 1].t - rows[0].t) : '—');
        var defs = [['tanah', '%', 0, 1], ['suhu', tu(), 1, 0.3], ['udara', '%', 0, 1]];
        defs.forEach(function (d) {
            var o = cfg(d[0]);
            $('#st-' + d[0]).innerHTML = statHTML(stats(rows.map(o.get), d[3]), d[1], d[2]);
            lineChart($('#ch-' + d[0]), rows, Object.assign(o, { h: 200 }), $('#ro-' + d[0]));
        });
        var cnt = { dry: 0, ok: 0, wet: 0 }, total = 0;
        rows.forEach(function (r, i) { var dt = i ? Math.min(r.t - rows[i - 1].t, 5000) : 0; cnt[zone(r.tanah)] += dt; total += dt; });
        var ps = pumpStats(rows);
        if (!total) { $('#zoneShare').innerHTML = '<p class="empty">Menunggu data sensor…</p>'; }
        else {
            var keys = ['dry', 'ok', 'wet'];
            $('#zoneShare').innerHTML = '<div class="share" role="img" aria-label="Pembagian waktu per zona">' + keys.map(function (k) { return '<i style="width:' + (cnt[k] / total * 100) + '%;background:var(' + ZN[k].v + ')"></i>'; }).join('') + '</div>' +
                '<div class="legend">' + keys.map(function (k) { return '<div style="--k:var(' + ZN[k].v + ')"><span class="label">' + ZN[k].name + '</span><b>' + Math.round(cnt[k] / total * 100) + '%</b><small class="mono">' + dur(cnt[k]) + '</small></div>'; }).join('') + '</div>' +
                '<p class="hint" style="margin-top:12px">Pompa menyala ' + ps.cycles + ' kali dalam rentang ini, total ' + dur(ps.on) + '.</p>';
        }
        scatter($('#ch-scatter'), rows);
    }

    var H = { status: 'all', range: 0, agg: false, k: 't', dir: -1, page: 1, size: 12 };
    function histRows() {
        var rows = hist.slice();
        if (H.range) { var cut = Date.now() - H.range * 1000; rows = rows.filter(function (r) { return r.t >= cut; }); }
        if (H.agg) {
            var g = {};
            rows.forEach(function (r) { var k = Math.floor(r.t / 60000); (g[k] = g[k] || []).push(r); });
            rows = Object.keys(g).map(function (k) {
                var a = g[k];
                return { t: Number(k) * 60000, suhu: avg(a.map(function (x) { return x.suhu; })), udara: avg(a.map(function (x) { return x.udara; })), tanah: avg(a.map(function (x) { return x.tanah; })), n: a.length };
            });
        }
        if (H.status !== 'all') rows = rows.filter(function (r) { return zone(r.tanah) === H.status; });
        rows.sort(function (a, b) { return (a[H.k] - b[H.k]) * H.dir; });
        return rows;
    }
    function renderRiwayat() {
        var rows = histRows(), pages = Math.max(1, Math.ceil(rows.length / H.size));
        H.page = Math.min(H.page, pages);
        var slice = rows.slice((H.page - 1) * H.size, H.page * H.size);
        $('#thSuhu').textContent = 'Suhu ' + tu();
        $('#hbody').innerHTML = slice.length ? slice.map(function (r) {
            return '<tr><td>' + fmtT(r.t, H.agg) + '</td><td>' + num(tc(r.suhu), 1) + '</td><td>' + num(r.udara, 0) + ' %</td><td>' + num(r.tanah, 0) + ' %</td><td>' + pillHTML(zone(r.tanah)) + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="empty" style="text-align:center">Tidak ada data untuk filter ini.</td></tr>';
        $('#hinfo').textContent = rows.length + ' baris · halaman ' + H.page + ' dari ' + pages;
        $('#hPrev').disabled = H.page <= 1; $('#hNext').disabled = H.page >= pages;
        $$('#p-riwayat th[data-k]').forEach(function (th) { if (th.dataset.k === H.k) th.setAttribute('aria-sort', H.dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort'); });
        var t = rows.map(function (r) { return r.tanah; }), s = rows.map(function (r) { return tc(r.suhu); });
        $('#hsum').innerHTML = rows.length ? [
            ['Baris', rows.length, 'dalam filter'],
            ['Tanah rata-rata', num(avg(t), 1) + ' %', 'min ' + num(Math.min.apply(null, t), 0) + ' · maks ' + num(Math.max.apply(null, t), 0)],
            ['Suhu rata-rata', num(avg(s), 1) + ' ' + tu(), 'min ' + num(Math.min.apply(null, s), 1) + ' · maks ' + num(Math.max.apply(null, s), 1)]
        ].map(function (x) { return '<div class="stat"><span class="label">' + x[0] + '</span><b>' + x[1] + '</b><small>' + x[2] + '</small></div>'; }).join('') : '';
    }
    function csv() {
        return 'waktu,suhu_c,kelembapan_udara,kelembapan_tanah,status\n' + histRows().sort(function (a, b) { return a.t - b.t; }).map(function (r) {
            return [new Date(r.t).toISOString(), r.suhu.toFixed(2), r.udara.toFixed(1), r.tanah.toFixed(0), ZN[zone(r.tanah)].name].join(',');
        }).join('\n');
    }

    var alFilter = 'all';
    function renderPeringatan() {
        var list = alFilter === 'unread' ? alerts.filter(function (a) { return !a.read; }) : alerts;
        $('#alList').innerHTML = evHTML(list);
    }
    function buildRules() {
        $('#rules').innerHTML = RULES.map(function (R) {
            var cfgR = S.rules[R.id];
            var v = R.fixed ? '<span>' + R.fixed() + '</span>' : '<input type="number" data-r="' + R.id + '" value="' + cfgR.v + '" step="' + R.step + '" aria-label="Batas ' + R.name + '"><span>' + R.unit + '</span>';
            return '<div class="rule"><input class="sw" type="checkbox" data-t="' + R.id + '" aria-label="Aktifkan ' + R.name + '"' + (cfgR.on ? ' checked' : '') + '><b>' + R.name + '</b><span class="d">' + R.desc + '</span><div class="v">' + v + '</div></div>';
        }).join('');
    }

    function renderAll() {
        renderHeader();
        if (page === 'ringkasan') renderRingkasan();
        else if (page === 'sensor') renderSensor();
        else if (page === 'riwayat') renderRiwayat();
        else if (page === 'peringatan') renderPeringatan();
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
        /* Stream ESP32-CAM sering putus sesaat: coba sambung ulang otomatis sebelum menyerah. */
        if (cam.run && cam.retry < 6) {
            cam.retry++; clearTimeout(cam.timer);
            camMsg('Menyambung ulang…', 'Percobaan ' + cam.retry + ' dari 6.');
            cam.timer = setTimeout(function () { if (cam.run) camLoad(); }, 300);
            return;
        }
        cam.run = false; clearTimeout(cam.timer);
        camimg.hidden = true; $('#livebadge').hidden = true;
        camMsg('Video tidak bisa dimuat', location.protocol === 'https:'
            ? 'Halaman https tidak bisa memuat gambar http dari kamera. Buka dashboard dari file lokal, atau izinkan konten tidak aman untuk situs ini. Pastikan juga satu jaringan dengan kamera.'
            : 'Pastikan satu jaringan dengan kamera, IP benar, dan tidak ada tab lain yang sedang menonton stream.');
    }
    function camStop() {
        cam.run = false; clearTimeout(cam.timer); clearTimeout(cam.watch);
        if (cam.pre) { cam.pre.onload = null; cam.pre.onerror = null; cam.pre.src = ''; cam.pre = null; }
        camimg.onload = null; camimg.onerror = null;
        /* mengosongkan src menutup koneksi stream, supaya ESP32-CAM tidak tertahan */
        camimg.removeAttribute('src');
        camimg.hidden = true; $('#livebadge').hidden = true;
    }
    /* Mode foto: muat frame berikutnya di Image terpisah (double-buffer),
       baru ditukar setelah selesai. Tampilan tidak kosong/berkedip di antara foto. */
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
        /* 1) satu foto cepat dulu, supaya gambar langsung tampil selagi stream tersambung.
           2) lalu pindah ke stream. Gambar foto tetap terlihat sampai frame stream pertama datang. */
        var im = new Image(); cam.pre = im; im.decoding = 'async';
        function openStream() {
            if (!cam.run) return;
            camimg.onerror = camFail;
            cam.live = false;
            camimg.onload = function () { clearTimeout(cam.watch); cam.live = true; cam.retry = 0; camOk(); };
            camimg.decoding = 'async';
            camimg.src = camUrl('/stream');
            /* sambungan macet >5 detik: batalkan dan ulangi dengan koneksi baru */
            cam.watch = setTimeout(function () { if (cam.run && !cam.live) camFail(); }, 5000);
        }
        im.onload = function () {
            if (!cam.run || cam.pre !== im) return;
            camimg.src = im.src; camOk();
            setTimeout(openStream, 60);
        };
        im.onerror = function () { if (cam.run && cam.pre === im) openStream(); };
        im.src = camUrl('/capture');
        /* kalau foto cepat tidak datang dalam 2 detik, langsung buka stream */
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
    function renderCamSummary() {
        var th = $('#camThumb'), s = $('#camSum');
        if (cam.lastFrame) { th.innerHTML = ''; th.appendChild(cam.lastFrame.c); s.textContent = 'Gambar terakhir pukul ' + fmtT(cam.lastFrame.t) + ' · ' + S.camIp; }
        else { th.textContent = 'Kamera belum pernah dibuka di sesi ini.'; s.textContent = S.camIp ? 'IP tersimpan: ' + S.camIp : 'Belum terhubung'; }
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
    /* Zoom: V.z = skala (1–4), V.x/V.y = geseran dalam piksel */
    var V = { z: 1, x: 0, y: 0 };
    function isFull() { var v = $('#camview'); return document.fullscreenElement === v || v.classList.contains('pseudo-full'); }
    var viewW = 0, viewH = 0, viewQ = 0;
    function measureView() { var v = $('#camview'); viewW = v.clientWidth; viewH = v.clientHeight; }
    function clampPan() {
        var mx = (V.z - 1) * viewW / 2, my = (V.z - 1) * viewH / 2;
        V.x = Math.max(-mx, Math.min(mx, V.x)); V.y = Math.max(-my, Math.min(my, V.y));
    }
    /* Semua perubahan tampilan dikumpulkan jadi satu kali tulis per frame layar. */
    function applyView() {
        if (viewQ) return;
        viewQ = requestAnimationFrame(function () {
            viewQ = 0;
            if (!viewW) measureView();
            clampPan();
            var br = $('#vBr').value, ct = $('#vCt').value;
            /* filter CSS pada MJPEG memaksa render ulang tiap frame: pasang hanya jika diubah */
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
        V.x = cx - k * (cx - V.x); V.y = cy - k * (cy - V.y);
        V.z = nz;
        if (nz === 1) { V.x = 0; V.y = 0; }
        applyView();
    }
    function setFullUI() {
        var f = isFull();
        $('#camview').classList.toggle('isfull', f); measureView();
        $('#zFs').setAttribute('aria-label', f ? 'Keluar layar penuh' : 'Layar penuh');
        $('#camFull').textContent = f ? 'Keluar layar penuh' : 'Layar penuh';
        applyView();
    }
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
        v.addEventListener('wheel', function (e) {
            if (camimg.hidden) return;
            e.preventDefault();
            var p = rel(e.clientX, e.clientY);
            zoomTo(V.z * Math.exp(-e.deltaY * 0.0015), p[0], p[1]);
        }, { passive: false });
        v.addEventListener('dblclick', function (e) {
            if (camimg.hidden || e.target.closest('.camzoom')) return;
            var p = rel(e.clientX, e.clientY);
            if (V.z > 1) zoomTo(1); else zoomTo(2.5, p[0], p[1]);
        });
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
            if (ids.length >= 2 && pinch) {
                var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = rel((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
                zoomTo(pinch.z * d / pinch.d, m[0], m[1]);
            } else if (ids.length === 1 && V.z > 1) {
                V.x += e.clientX - prev[0]; V.y += e.clientY - prev[1]; applyView();
            }
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
        $('#setUrl').value = S.firebase; $('#setPoll').value = String(S.poll); $('#setFetchN').value = String(S.fetchN);
        $('#setDemo').checked = S.forceDemo; $('#setDry').value = S.dry; $('#setWet').value = S.wet;
        $('#setUnit').value = S.unit; $('#setClock').value = S.clock; $('#setTheme').value = S.theme;
    }
    function applyTheme() {
        var r = document.documentElement;
        if (S.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme);
    }
    function restart() { mode = 'init'; hist = []; alerts = []; RS = {}; net = true; $('#notice').hidden = true; }

    /* ================= Pemasangan event ================= */
    function bind() {
        $('#retry').addEventListener('click', restart);
        $('#ovSeg').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            ovSeries = b.dataset.s;
            $$('#ovSeg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            renderAll();
        });
        $('#winSeg').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            WIN = Number(b.dataset.n);
            $$('#winSeg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            renderAll();
        });

        /* kamera */
        $('#camGo').addEventListener('click', function () {
            var ip = cleanIp($('#camip').value); if (!ip) return;
            S.camIp = ip; save(); camStart();
        });
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

        /* riwayat */
        $('#fStatus').addEventListener('change', function () { H.status = this.value; H.page = 1; renderRiwayat(); });
        $('#fRange').addEventListener('change', function () { H.range = Number(this.value); H.page = 1; renderRiwayat(); });
        $('#fAgg').addEventListener('change', function () { H.agg = this.value === '1'; H.page = 1; renderRiwayat(); });
        $('#p-riwayat thead').addEventListener('click', function (e) {
            var th = e.target.closest('th[data-k]'); if (!th) return;
            if (H.k === th.dataset.k) H.dir = -H.dir; else { H.k = th.dataset.k; H.dir = -1; }
            renderRiwayat();
        });
        $('#hPrev').addEventListener('click', function () { H.page--; renderRiwayat(); });
        $('#hNext').addEventListener('click', function () { H.page++; renderRiwayat(); });
        $('#hClear').addEventListener('click', function () { var l = last(); hist = l ? [l] : []; H.page = 1; renderRiwayat(); toast('Riwayat sesi dihapus.'); });
        $('#csvCopy').addEventListener('click', function () {
            var btn = this, txt = csv(), box = $('#csvbox');
            function fb() { box.hidden = false; box.value = txt; box.focus(); box.select(); }
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { flash(btn, 'Tersalin'); }, fb); else fb();
        });
        $('#csvDl').addEventListener('click', async function () {
            var txt = csv(), d = null;
            try { if (window.claude && window.claude.use) d = await window.claude.use('downloads'); } catch (e) { }
            if (d) {
                try { await d.save({ filename: 'riwayat-selada.csv', data: txt }); toast('CSV disimpan.'); }
                catch (e) { if (!e || e.code !== 'declined') toast('Unduhan tidak bisa dilakukan di sini. Pakai "Salin CSV".'); }
                return;
            }
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = 'riwayat-selada.csv';
            document.body.appendChild(a); a.click(); a.remove();
        });

        /* peringatan */
        $('#alSeg').addEventListener('click', function (e) {
            var b = e.target.closest('button'); if (!b) return;
            alFilter = b.dataset.f;
            $$('#alSeg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            renderAll();
        });
        $('#alRead').addEventListener('click', function () { alerts.forEach(function (a) { a.read = true; }); renderAll(); });
        $('#alClear').addEventListener('click', function () { alerts = []; renderAll(); });
        $('#rules').addEventListener('change', function (e) {
            var t = e.target;
            if (t.dataset.t) { S.rules[t.dataset.t].on = t.checked; if (!t.checked) RS[t.dataset.t] = false; }
            if (t.dataset.r) { var v = Number(t.value); if (isFinite(v)) S.rules[t.dataset.r].v = v; }
            save();
        });

        /* pengaturan */
        $('#setUrl').addEventListener('change', function () { var v = this.value.trim(); if (!v) return; S.firebase = v; save(); restart(); });
        $('#setPoll').addEventListener('change', function () { S.poll = Number(this.value); save(); });
        $('#setFetchN').addEventListener('change', function () { S.fetchN = Number(this.value); save(); restart(); });
        $('#setDemo').addEventListener('change', function () { S.forceDemo = this.checked; save(); restart(); });
        $('#setUnit').addEventListener('change', function () { S.unit = this.value; save(); renderAll(); });
        $('#setClock').addEventListener('change', function () { S.clock = this.value; save(); renderAll(); });
        $('#setTheme').addEventListener('change', function () { S.theme = this.value; save(); applyTheme(); });
        function zoneSave() {
            var d = Number($('#setDry').value), w = Number($('#setWet').value), m = $('#zoneMsg');
            if (!(d >= 1 && w <= 99 && d < w)) { m.className = 'msg err'; m.textContent = 'Batas kering harus lebih kecil dari batas basah, di antara 1 dan 99.'; return; }
            S.dry = d; S.wet = w; save(); buildZones(); renderAll();
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
            var ip = S.camIp, pip = S.portalIp; S = clone(DEF); S.camIp = ip; S.portalIp = pip; save(); applyTheme(); fillSettings(); buildZones(); buildRules(); restart(); toast('Pengaturan dikembalikan ke bawaan.');
        });
    }

    /* ================= Mulai ================= */
    /* Modul fitur tambahan (js/pages/*.js) mendaftar lewat window.SeladaModules dan mendapat objek `core` ini. */
    var core = {
        settings: function () { return S; }, hist: function () { return hist; }, last: last, mode: function () { return mode; },
        netOk: function () { return net; }, alerts: function () { return alerts; }, onAlert: function (f) { alertHooks.push(f); },
        pump: pumpState, pumpHTML: pumpHTML, pumpOn: rowOn, pumpStats: pumpStats, fmtT: fmtT, tc: tc, tu: tu, num: num, dur: dur, avg: avg, toast: toast, zone: zone, pushTime: pushTime,
        rerender: function () { renderAll(); }, current: function () { return page; }, go: function (id) { location.hash = id; }
    };
    (window.SeladaModules || []).forEach(function (f) {
        try {
            [].concat(f(core)).forEach(function (m) { if (m && m.id) { EXT[m.id] = m; PAGES.push(m); } });
        } catch (e) { console.error('Modul gagal dimuat:', e); }
    });
    PAGES.sort(function (a, b) { return (a.o || 500) - (b.o || 500); });
    window.Selada = core;
    buildNav(); buildZones(); bind(); initZoom(); initNav();
    Object.keys(EXT).forEach(function (k) { if (EXT[k].init) { try { EXT[k].init(); } catch (e) { console.error(e); } } });
    if (S.theme !== 'system') applyTheme();
    window.addEventListener('hashchange', function () { route(); });
    /* Klik menu langsung membuka halaman, tanpa bergantung pada perubahan hash (hash bisa diblokir di preview/iframe) */
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
    setInterval(function () { checkOffline(); renderHeader(); }, 1000);
    /* ================= Login ================= */
    var AUTH = { email: 'admin@gmail.com', pass: 'admin123', key: 'selada-auth' };
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
        try { history.pushState(null, '', '#ringkasan'); } catch (e) { }
        route('ringkasan');
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
