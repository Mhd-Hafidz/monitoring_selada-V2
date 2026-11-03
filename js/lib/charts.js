/* Grafik garis SVG multi-seri, interaktif (tooltip, legenda yang bisa dimatikan). Tanpa pustaka eksternal. */
(function () {
    'use strict';
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function nearest(arr, t) {            // indeks titik terdekat pada arr (terurut menurut t)
        var lo = 0, hi = arr.length - 1;
        while (hi - lo > 1) { var m = (lo + hi) >> 1; if (arr[m][0] < t) lo = m; else hi = m; }
        return Math.abs(arr[lo][0] - t) <= Math.abs(arr[hi][0] - t) ? lo : hi;
    }
    /* Rata-rata per ember agar grafik tetap ringan; titik pertama dan terakhir dipertahankan. */
    function downsample(pts, max) {
        if (pts.length <= max) return pts;
        var size = pts.length / max, out = [];
        for (var i = 0; i < max; i++) {
            var a = Math.floor(i * size), b = Math.max(a + 1, Math.floor((i + 1) * size)), st = 0, sv = 0, n = 0;
            for (var k = a; k < b && k < pts.length; k++) { st += pts[k][0]; sv += pts[k][1]; n++; }
            out.push([st / n, sv / n]);
        }
        out[0] = pts[0]; out[out.length - 1] = pts[pts.length - 1];
        return out;
    }
    function line(host, o) {
        var hidden = host._hid || (host._hid = {});
        var ser = (o.series || []).filter(function (s) { return (s.data && s.data.length) || (s.band && s.band.length); });
        if (!ser.length || !ser.some(function (s) { return (s.data || []).length > 1 || (s.band || []).length > 1; })) {
            host.innerHTML = '<p class="empty">' + esc(o.empty || 'Menunggu data…') + '</p>'; return;
        }
        var vis = ser.filter(function (s) { return !hidden[s.name]; });
        var w = Math.max(host.clientWidth, 260), h = o.h || 240, m = { l: o.ml || 44, r: 14, t: 12, b: 26 };
        var iw = w - m.l - m.r, ih = h - m.t - m.b;
        var t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
        ser.forEach(function (s) {
            (s.data || []).forEach(function (p) { if (p[0] < t0) t0 = p[0]; if (p[0] > t1) t1 = p[0]; });
            (s.band || []).forEach(function (p) { if (p[0] < t0) t0 = p[0]; if (p[0] > t1) t1 = p[0]; });
        });
        vis.forEach(function (s) {
            (s.data || []).forEach(function (p) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; });
            (s.band || []).forEach(function (p) { if (p[1] < lo) lo = p[1]; if (p[2] > hi) hi = p[2]; });
        });
        (o.bands || []).forEach(function (b) { if (o.includeBands) { lo = Math.min(lo, b.lo); hi = Math.max(hi, b.hi); } });
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        var a = o.yMin, b = o.yMax;
        if (a === undefined || b === undefined) {
            var span = Math.max(hi - lo, o.minSpan || 1), mid = (hi + lo) / 2;
            if (a === undefined) a = mid - span * 0.6; if (b === undefined) b = mid + span * 0.6;
        }
        var X = function (t) { return m.l + (t - t0) / ((t1 - t0) || 1) * iw; };
        var Y = function (v) { return m.t + (1 - (v - a) / (b - a)) * ih; };
        var dec = o.dec === undefined ? 1 : o.dec, out = '';
        (o.bands || []).forEach(function (bd) {
            var y1 = Y(Math.min(bd.hi, b)), y2 = Y(Math.max(bd.lo, a));
            if (y2 > y1) out += '<rect x="' + m.l + '" y="' + y1.toFixed(1) + '" width="' + iw + '" height="' + (y2 - y1).toFixed(1) + '" fill="var(' + (bd.color || '--ok') + ')" opacity=".10"/>';
        });
        for (var i = 0; i <= 4; i++) {
            var tv = a + i * (b - a) / 4, y = Y(tv);
            out += '<line class="gl" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text x="' + (m.l - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + (o.yFmt ? o.yFmt(tv) : tv.toFixed(dec)) + '</text>';
        }
        (o.lines || []).forEach(function (ln) {
            if (ln.v < a || ln.v > b) return;
            out += '<line class="thr" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + Y(ln.v).toFixed(1) + '" y2="' + Y(ln.v).toFixed(1) + '"/>';
        });
        var nx = w < 480 ? 3 : 5;
        for (var k = 0; k < nx; k++) {
            var f = k / (nx - 1), an = k === 0 ? 'start' : (k === nx - 1 ? 'end' : 'middle');
            out += '<text x="' + (m.l + f * iw).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="' + an + '">' + esc(o.xFmt ? o.xFmt(t0 + f * (t1 - t0)) : new Date(t0 + f * (t1 - t0)).toLocaleTimeString()) + '</text>';
        }
        if (o.vline !== undefined && o.vline > t0 && o.vline < t1) {
            out += '<line class="thr" x1="' + X(o.vline).toFixed(1) + '" x2="' + X(o.vline).toFixed(1) + '" y1="' + m.t + '" y2="' + (m.t + ih) + '"/><text x="' + (X(o.vline) + 4).toFixed(1) + '" y="' + (m.t + 10) + '">' + esc(o.vlineLabel || '') + '</text>';
        }
        vis.forEach(function (s) {
            var c = 'var(' + (s.color || '--ok') + ')';
            if (s.band && s.band.length > 1) {
                var up = s.band.map(function (p) { return X(p[0]).toFixed(1) + ' ' + Y(p[2]).toFixed(1); });
                var dn = s.band.slice().reverse().map(function (p) { return X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); });
                out += '<path d="M' + up.join('L') + 'L' + dn.join('L') + 'Z" fill="' + c + '" opacity=".16"/>';
            }
            if (s.data && s.data.length > 1) {
                var d = 'M' + s.data.map(function (p) { return X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join('L');
                out += '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + (s.width || 2) + '" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="6 4"' : '') + '/>';
                if (s.markers) s.data.forEach(function (p) { out += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="3.2" fill="' + c + '"/>'; });
            }
        });
        out += '<line class="guide" y1="' + m.t + '" y2="' + (m.t + ih) + '" visibility="hidden"/>';
        out += '<rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '" fill="none" pointer-events="all"/>';
        var legend = o.legend === false ? '' : '<div class="clegend">' + ser.filter(function (s) { return s.name; }).map(function (s) {
            return '<button type="button" data-n="' + esc(s.name) + '" aria-pressed="' + (!hidden[s.name]) + '" style="--k:var(' + (s.color || '--ok') + ')"><i' + (s.dash ? ' class="dash"' : '') + '></i>' + esc(s.name) + '</button>';
        }).join('') + '</div>';
        host.classList.add('cwrap');
        host.innerHTML = legend + '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label || 'Grafik') + '">' + out + '</svg><div class="ctip" hidden></div>';
        var svg = host.querySelector('svg'), tip = host.querySelector('.ctip'), guide = svg.querySelector('.guide'), hit = svg.querySelector('.hit');
        host.querySelectorAll('.clegend button').forEach(function (bt) {
            bt.addEventListener('click', function () { hidden[bt.dataset.n] = !hidden[bt.dataset.n]; line(host, o); });
        });
        function move(ev) {
            var bx = svg.getBoundingClientRect(), x = ev.clientX - bx.left, t = t0 + (x - m.l) / iw * (t1 - t0), rows = [], tt = null;
            vis.forEach(function (s) {
                if (!s.data || !s.data.length) return;
                var p = s.data[nearest(s.data, t)];
                if (tt === null || Math.abs(p[0] - t) < Math.abs(tt - t)) tt = p[0];
                rows.push([s, p]);
            });
            if (tt === null) return;
            guide.setAttribute('x1', X(tt)); guide.setAttribute('x2', X(tt)); guide.setAttribute('visibility', 'visible');
            tip.innerHTML = '<b>' + esc(o.tipTime ? o.tipTime(tt) : (o.xFmt ? o.xFmt(tt) : new Date(tt).toLocaleString())) + '</b>' + rows.map(function (r) {
                var bandTxt = '';
                if (r[0].band) { var bi = r[0].band[nearest(r[0].band, r[1][0])]; bandTxt = ' <small>(' + bi[1].toFixed(dec) + '–' + bi[2].toFixed(dec) + ')</small>'; }
                return '<div style="--k:var(' + (r[0].color || '--ok') + ')"><i></i>' + esc(r[0].name || '') + ' <strong>' + (o.yFmt ? o.yFmt(r[1][1]) : r[1][1].toFixed(dec)) + (o.unit ? ' ' + esc(o.unit) : '') + '</strong>' + bandTxt + '</div>';
            }).join('');
            tip.hidden = false;
            var hb = host.getBoundingClientRect(), left = X(tt) + (bx.left - hb.left) + 12;
            if (left + tip.offsetWidth > host.clientWidth) left -= tip.offsetWidth + 24;
            tip.style.left = Math.max(0, left) + 'px'; tip.style.top = (bx.top - hb.top + m.t + 4) + 'px';
        }
        function leave() { guide.setAttribute('visibility', 'hidden'); tip.hidden = true; }
        hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', leave);
    }
    window.SeladaCharts = { line: line, downsample: downsample, esc: esc };
})();
