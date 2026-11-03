/* Penilaian kondisi tanaman (normal / waspada / berbahaya).
   HARUS sama dengan backend/utils/status.py (aturan tingkat yang sama). */
(function () {
    'use strict';
    var M = { soilLow: 15, soilHigh: 10, temp: 3, humLow: 15, humMax: 80, humHigh: 5 };
    var LEVELS = ['normal', 'waspada', 'berbahaya'];
    var COLORS = ['--ok', '--dry', '--bad'];
    var LABEL = { suhu: 'Suhu udara', udara: 'Kelembapan udara', tanah: 'Kelembapan tanah' };

    function thresholds(S) {
        return { dry: S.dry, wet: S.wet, tmax: S.rules.tmax.v, tmin: S.rules.tmin.v, hmin: S.rules.hmin.v };
    }
    function level(p, v, th) {
        if (p === 'tanah') {
            if (v < th.dry - M.soilLow || v > th.wet + M.soilHigh) return 2;
            return (v <= th.dry || v >= th.wet) ? 1 : 0;
        }
        if (p === 'suhu') {
            if (v < th.tmin - M.temp || v > th.tmax + M.temp) return 2;
            return (v < th.tmin || v > th.tmax) ? 1 : 0;
        }
        if (v < th.hmin - M.humLow || v > M.humMax + M.humHigh) return 2;
        return (v < th.hmin || v > M.humMax) ? 1 : 0;
    }
    /* Rentang "normal" sebagai teks, untuk ditampilkan di kartu. */
    function rangeText(p, th, unitFn) {
        if (p === 'tanah') return th.dry + '–' + th.wet + ' %';
        if (p === 'suhu') return unitFn(th.tmin).toFixed(0) + '–' + unitFn(th.tmax).toFixed(0) + ' ' + (unitFn(0) === 32 ? '°F' : '°C');
        return th.hmin + '–' + M.humMax + ' %';
    }
    function assess(row, th) {
        var o = { suhu: level('suhu', row.suhu, th), udara: level('udara', row.udara, th), tanah: level('tanah', row.tanah, th) };
        o.overall = Math.max(o.suhu, o.udara, o.tanah);
        return o;
    }
    function pill(lv, text) {
        return '<span class="pill" style="--z:var(' + COLORS[lv] + ')">' + (text || LEVELS[lv]) + '</span>';
    }
    /* nama tingkat dengan huruf kapital di awal */
    function cap(lv) { return LEVELS[lv].charAt(0).toUpperCase() + LEVELS[lv].slice(1); }
    window.SeladaStatus = { LEVELS: LEVELS, COLORS: COLORS, LABEL: LABEL, margins: M, thresholds: thresholds, level: level, assess: assess, pill: pill, cap: cap, rangeText: rangeText };
})();
