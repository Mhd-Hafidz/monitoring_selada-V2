/* js/pages/lstm_page.js - Halaman LSTM: Prediksi Kematangan Tanaman Selada Keriting */
(function () {
    'use strict';

    /* ── Konstanta kematangan ── */
    var STAGE1_MAX = 66.5;  // Masa Pertumbuhan: < 66.5%
    var STAGE2_MAX = 89;    // Mendekati Panen: 66.5–89%
    // Siap Panen: >= 89%

    function stageInfo(pct) {
        if (pct < STAGE1_MAX) return { name: 'Masa Pertumbuhan', color: '--ok', short: 'Tumbuh' };
        if (pct < STAGE2_MAX) return { name: 'Mendekati Panen', color: '--dry', short: 'Dekat Panen' };
        return { name: 'Siap Panen', color: '--bad', short: 'Siap Panen' };
    }

    function conditionText(tanah, suhu, udara) {
        var issues = [];
        if (tanah < 55) issues.push('tanah terlalu kering');
        if (tanah > 85) issues.push('tanah terlalu basah');
        if (suhu > 32) issues.push('suhu terlalu tinggi');
        if (suhu < 15) issues.push('suhu terlalu rendah');
        if (udara < 60) issues.push('udara terlalu kering');
        if (!issues.length) return 'Kondisi Optimal';
        return 'Perlu Perhatian: ' + issues.join(', ');
    }

    /* ── Module entry point ── */
    window.SeladaModules = window.SeladaModules || [];
    window.SeladaModules.push(function (core) {

        var $ = function (s) { return document.querySelector(s); };

        /* Local state */
        var plantDate = null;     // Date object atau null
        var harvestDay = 30;      // target HST
        var lstmReady = false;

        function loadLSTMState() {
            try {
                var s = core.settings();
                if (s.plantDate) plantDate = new Date(s.plantDate);
                if (s.harvestDay) harvestDay = Number(s.harvestDay) || 30;
            } catch (e) { }
        }

        function saveLSTMState() {
            try {
                var s = core.settings();
                s.plantDate = plantDate ? plantDate.toISOString().slice(0, 10) : '';
                s.harvestDay = harvestDay;
                core.save();
            } catch (e) { }
        }

        /* Current HST */
        function getHST() {
            if (!plantDate) return null;
            var now = new Date();
            var ms = now - plantDate;
            if (ms < 0) return 0;
            return Math.floor(ms / 86400000);
        }

        /* Maturity % based on HST */
        function getMaturity(hst) {
            if (hst === null || hst === undefined) return 0;
            return Math.min(100, (hst / harvestDay) * 100);
        }

        /* ── Gauge SVG update ── */
        var CIRC = 339.3; // 2 * Math.PI * 54
        function updateGauge(pct) {
            var fill = $('#gaugeFill');
            if (!fill) return;
            var offset = CIRC * (1 - pct / 100);
            fill.style.strokeDashoffset = offset.toFixed(1);
            var stage = stageInfo(pct);
            fill.style.stroke = 'var(' + stage.color + ')';
            var pctEl = $('#gaugePct'), stEl = $('#gaugeStage');
            if (pctEl) pctEl.textContent = Math.round(pct) + '%';
            if (pctEl) pctEl.style.color = 'var(' + stage.color + ')';
            if (stEl) stEl.textContent = stage.short;
        }

        /* ── Age Display ── */
        function updateAgeDisplay() {
            var hst = getHST();
            var hstEl = $('#lstmHst'), hintEl = $('#lstmAgeHint');
            if (hst === null) {
                if (hstEl) hstEl.textContent = '—';
                if (hintEl) hintEl.textContent = 'Atur tanggal tanam untuk menghitung HST';
                var pill = $('#lstmAgePill');
                if (pill) { pill.textContent = 'Belum Diatur'; pill.style.setProperty('--z', 'var(--muted)'); }
                return;
            }
            if (hstEl) hstEl.textContent = hst;
            var daysLeft = harvestDay - hst;
            if (hintEl) {
                if (daysLeft > 0) hintEl.textContent = 'Sisa ' + daysLeft + ' hari hingga target panen (' + harvestDay + ' HST)';
                else if (daysLeft === 0) hintEl.textContent = 'Hari ini adalah target panen!';
                else hintEl.textContent = 'Melewati target panen ' + Math.abs(daysLeft) + ' hari lalu';
            }

            var pct = getMaturity(hst);
            var stage = stageInfo(pct);
            var pill = $('#lstmAgePill');
            if (pill) { pill.textContent = stage.name; pill.style.setProperty('--z', 'var(' + stage.color + ')'); }

            var bar = $('#lstmAgeBar'), prog = $('#lstmAgeProgress');
            if (bar) bar.style.width = pct.toFixed(1) + '%';
            if (prog) prog.textContent = Math.round(pct) + '% matang · ' + stage.name;
        }

        /* ── Backend Status ── */
        function updateBackendStatus() {
            var mode = core.mode();
            var net = core.netOk();
            var hist = core.hist();

            // Firebase
            var fbEl = $('#bsFirebase'), fbText = $('#bsFirebaseText');
            if (fbEl) {
                if (mode === 'live' && net && hist.length > 0) {
                    fbEl.dataset.s = 'live';
                    if (fbText) fbText.textContent = 'Terhubung — ' + hist.length + ' pembacaan';
                } else if (mode === 'demo') {
                    fbEl.dataset.s = 'demo';
                    if (fbText) fbText.textContent = 'Mode data contoh';
                } else {
                    fbEl.dataset.s = 'bad';
                    if (fbText) fbText.textContent = 'Tidak terhubung';
                }
            }

            // Backend API
            var beEl = $('#bsBackend'), beText = $('#bsBackendText');
            var apiUrl = (core.settings().api || '');
            if (beEl) {
                if (!apiUrl) {
                    beEl.dataset.s = 'demo';
                    if (beText) beText.textContent = 'Tidak dikonfigurasi (opsional)';
                } else {
                    beEl.dataset.s = 'init';
                    if (beText) beText.textContent = 'Mengecek ' + apiUrl + '…';
                    fetch(apiUrl + '/health', { signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : (function () { var c = new AbortController(); setTimeout(function () { c.abort(); }, 3000); return c.signal; })() })
                        .then(function () { beEl.dataset.s = 'live'; if (beText) beText.textContent = 'Server aktif di ' + apiUrl; })
                        .catch(function () { beEl.dataset.s = 'bad'; if (beText) beText.textContent = 'Tidak bisa menghubungi server'; });
                }
            }

            // Model status
            var mdEl = $('#bsModel'), mdText = $('#bsModelText');
            if (mdEl) {
                mdEl.dataset.s = 'demo';
                if (mdText) mdText.textContent = 'Menggunakan estimasi berbasis HST';
            }

            // Data availability
            var dtEl = $('#bsData'), dtText = $('#bsDataText');
            if (dtEl) {
                if (hist.length >= 10) {
                    dtEl.dataset.s = 'live';
                    if (dtText) dtText.textContent = hist.length + ' pembacaan tersedia';
                } else if (hist.length > 0) {
                    dtEl.dataset.s = 'demo';
                    if (dtText) dtText.textContent = 'Data terbatas (' + hist.length + ' pembacaan)';
                } else {
                    dtEl.dataset.s = 'bad';
                    if (dtText) dtText.textContent = 'Belum ada data sensor';
                }
            }

            // Last update
            var lu = $('#lstmLastUpdate');
            var r = core.last();
            if (lu) lu.textContent = r ? core.fmtT(r.t) : '—';
        }

        /* ── Prediction: 4 days ── */
        function renderPredictions() {
            var grid = $('#lstmPredGrid');
            if (!grid) return;
            var hst = getHST();
            var hist = core.hist();
            var r = core.last();

            var avgSoil = 70, avgTemp = 28, avgHum = 65;
            if (hist.length >= 5) {
                var recent = hist.slice(-Math.min(hist.length, 60));
                avgSoil = recent.reduce(function (s, x) { return s + x.tanah; }, 0) / recent.length;
                avgTemp = recent.reduce(function (s, x) { return s + x.suhu; }, 0) / recent.length;
                avgHum = recent.reduce(function (s, x) { return s + x.udara; }, 0) / recent.length;
            }

            var cards = '';
            for (var i = 1; i <= 4; i++) {
                var futHst = hst !== null ? hst + i : i;
                var pct = getMaturity(futHst);
                var stage = stageInfo(pct);

                // Simulate slight environmental variation
                var rand = Math.sin(i * 2.1 + (hst || 0)) * 0.5;
                var predSoil = (avgSoil + rand * 3).toFixed(1);
                var predTemp = (avgTemp + rand * 0.8).toFixed(1);
                var predHum = (avgHum + rand * 2).toFixed(1);

                var today = new Date();
                today.setDate(today.getDate() + i);
                var dateStr = today.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

                cards += '<div class="daycard" style="--z:var(' + stage.color + ')">' +
                    '<div class="day-label">Hari +' + i + ' · ' + dateStr + ' · HST ' + futHst + '</div>' +
                    '<div class="day-pct">' + Math.round(pct) + '%</div>' +
                    '<div class="day-stage">' + stage.name + '</div>' +
                    '<div class="day-env">' +
                    '<span>💧 Tanah: ~' + predSoil + '%</span>' +
                    '<span>🌡 Suhu: ~' + predTemp + '°C</span>' +
                    '<span>💨 Udara: ~' + predHum + '%</span>' +
                    '</div>' +
                    '</div>';
            }
            grid.innerHTML = cards;

            var src = $('#lstmPredSrc');
            if (src) src.textContent = hst !== null ? 'Estimasi berdasarkan HST ' + hst + '/' + harvestDay : 'Atur tanggal tanam terlebih dahulu';
        }

        /* ── Longitudinal Chart (SVG) ── */
        function renderLongChart() {
            var host = $('#lstmLongChart');
            if (!host) return;
            var hst = getHST();
            if (hst === null) {
                host.innerHTML = '<p class="empty">Atur tanggal tanam untuk menampilkan kurva perkembangan kematangan.</p>';
                return;
            }

            var totalDays = harvestDay + 4; // show until harvest + 4 forecast days
            var points = [];
            for (var d = 0; d <= Math.max(hst + 4, harvestDay); d++) {
                var pct = getMaturity(d);
                points.push({ d: d, pct: pct, isForecast: d > hst });
            }

            var w = Math.max(host.clientWidth, 300), h = 240;
            var m = { l: 46, r: 16, t: 16, b: 36 };
            var iw = w - m.l - m.r, ih = h - m.t - m.b;
            var maxD = points[points.length - 1].d;

            var X = function (d) { return m.l + (d / maxD) * iw; };
            var Y = function (pct) { return m.t + (1 - pct / 100) * ih; };

            var out = '';

            // Gridlines
            [0, 25, 50, 66.5, 75, 89, 100].forEach(function (v) {
                var y = Y(v);
                var cls = (v === 66.5 || v === 89) ? 'thr' : 'gl';
                out += '<line class="' + cls + '" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>';
                out += '<text x="' + (m.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" style="font-size:10px">' + Math.round(v) + '</text>';
            });

            // Stage background zones
            out += '<rect x="' + m.l + '" y="' + Y(100) + '" width="' + iw + '" height="' + (Y(STAGE1_MAX) - Y(100)) + '" fill="var(--ok)" fill-opacity="0.06"/>';
            out += '<rect x="' + m.l + '" y="' + Y(STAGE2_MAX) + '" width="' + iw + '" height="' + (Y(STAGE1_MAX) - Y(STAGE2_MAX)) + '" fill="var(--dry)" fill-opacity="0.06"/>';
            out += '<rect x="' + m.l + '" y="' + Y(100) + '" width="' + iw + '" height="' + (Y(STAGE2_MAX) - Y(100)) + '" fill="var(--bad)" fill-opacity="0.06"/>';

            // X axis labels
            var xLabels = Math.min(7, Math.floor(maxD / 5) + 1);
            for (var li = 0; li <= xLabels; li++) {
                var xd = Math.round(li / xLabels * maxD);
                out += '<text x="' + X(xd).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" style="font-size:10px">HST ' + xd + '</text>';
            }

            // Historic path (solid)
            var histPts = points.filter(function (p) { return !p.isForecast; });
            var forecastPts = points.filter(function (p) { return p.isForecast || p.d === hst; });

            if (histPts.length >= 2) {
                var hd = 'M' + histPts.map(function (p) { return X(p.d).toFixed(1) + ' ' + Y(p.pct).toFixed(1); }).join('L');
                out += '<path d="' + hd + 'L' + X(histPts[histPts.length - 1].d).toFixed(1) + ' ' + (m.t + ih) + 'L' + X(histPts[0].d).toFixed(1) + ' ' + (m.t + ih) + 'Z" fill="var(--ok)" fill-opacity="0.15" stroke="none"/>';
                out += '<path d="' + hd + '" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
            }

            // Forecast path (dashed)
            if (forecastPts.length >= 2) {
                var fd = 'M' + forecastPts.map(function (p) { return X(p.d).toFixed(1) + ' ' + Y(p.pct).toFixed(1); }).join('L');
                out += '<path d="' + fd + '" fill="none" stroke="var(--dry)" stroke-width="2" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round"/>';
            }

            // Current day marker
            if (hst <= maxD) {
                var cx = X(hst), cy = Y(getMaturity(hst));
                out += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="8" fill="var(--ok)" fill-opacity="0.25"/>';
                out += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5" fill="var(--ok)"/>';
                out += '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--ok)" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>';
                out += '<text x="' + (cx + 6).toFixed(1) + '" y="' + (m.t + 14) + '" fill="var(--ok)" style="font-size:11px;font-weight:600">Hari Ini</text>';
            }

            // Harvest target line
            if (harvestDay <= maxD) {
                var hx = X(harvestDay);
                out += '<line x1="' + hx.toFixed(1) + '" x2="' + hx.toFixed(1) + '" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="5 3"/>';
                out += '<text x="' + (hx + 4).toFixed(1) + '" y="' + (m.t + ih - 6) + '" fill="var(--bad)" style="font-size:10px">Target Panen</text>';
            }

            // Legend
            out += '<text x="' + m.l + '" y="12" style="font-size:10px;fill:var(--muted)">— Aktual  </text>';
            out += '<text x="' + (m.l + 60) + '" y="12" style="font-size:10px;fill:var(--dry)">- - Prakiraan</text>';

            host.innerHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Kurva longitudinal kematangan tanaman">' + out + '</svg>';
        }

        /* ── LSTM Summary Table ── */
        function renderTable() {
            var tbody = $('#lstmTableBody');
            if (!tbody) return;
            var hst = getHST();
            if (hst === null) {
                tbody.innerHTML = '<tr><td colspan="8" class="empty" style="text-align:center">Atur tanggal tanam untuk menampilkan tabel.</td></tr>';
                return;
            }

            var hist = core.hist();
            var avgSoil = 70, avgTemp = 28, avgHum = 65;
            if (hist.length > 0) {
                var sampleSize = Math.min(hist.length, 60);
                var sample = hist.slice(-sampleSize);
                avgSoil = sample.reduce(function (s, x) { return s + x.tanah; }, 0) / sampleSize;
                avgTemp = sample.reduce(function (s, x) { return s + x.suhu; }, 0) / sampleSize;
                avgHum = sample.reduce(function (s, x) { return s + x.udara; }, 0) / sampleSize;
            }

            var rows = '';
            var maxRow = Math.max(hst, 1);
            var startDay = Math.max(0, maxRow - 9);

            for (var d = startDay; d <= maxRow + 4; d++) {
                var isForecast = d > hst;
                var pct = getMaturity(d);
                var stage = stageInfo(pct);
                var rand = Math.sin(d * 1.7) * 0.5;
                var soil = isForecast ? (avgSoil + rand * 4).toFixed(1) : (avgSoil + rand * 3).toFixed(1);
                var temp = (avgTemp + rand * 0.5 + Math.sin(d * 0.5) * 0.3).toFixed(1);
                var hum = (avgHum + rand * 2 + Math.sin(d * 0.8) * 1.5).toFixed(1);
                var cond = conditionText(Number(soil), Number(temp), Number(hum));

                var dateStr = '';
                if (plantDate) {
                    var dayDate = new Date(plantDate);
                    dayDate.setDate(dayDate.getDate() + d);
                    dateStr = dayDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
                }

                rows += '<tr' + (isForecast ? ' style="opacity:0.7;font-style:italic"' : '') + '>' +
                    '<td>' + dateStr + (isForecast ? ' <span class="demotag">Prakiraan</span>' : '') + '</td>' +
                    '<td>' + d + '</td>' +
                    '<td>' + soil + '</td>' +
                    '<td>' + temp + '</td>' +
                    '<td>' + hum + '</td>' +
                    '<td><b>' + Math.round(pct) + '%</b></td>' +
                    '<td><span class="pill" style="--z:var(' + stage.color + ')">' + stage.short + '</span></td>' +
                    '<td style="white-space:normal;max-width:180px">' + cond + '</td>' +
                    '</tr>';
            }
            tbody.innerHTML = rows;
        }

        /* ── Main render ── */
        function render() {
            var hst = getHST();
            var pct = getMaturity(hst);

            updateAgeDisplay();
            updateBackendStatus();
            updateGauge(pct);
            renderPredictions();
            renderLongChart();
            renderTable();
        }

        /* ── Setup plant date input ── */
        function setupInputs() {
            var dateInput = $('#lstmPlantDate');
            var harvestInput = $('#lstmHarvestDay');
            var savePlant = $('#lstmSavePlant');
            var saveHarvest = $('#lstmSaveHarvest');
            var refreshBtn = $('#lstmTableRefresh');

            // Set initial values
            if (dateInput && plantDate) {
                dateInput.value = plantDate.toISOString().slice(0, 10);
            }
            if (harvestInput) harvestInput.value = harvestDay;

            if (savePlant) {
                savePlant.addEventListener('click', function () {
                    var val = dateInput ? dateInput.value : '';
                    if (!val) { core.toast('Pilih tanggal tanam terlebih dahulu.'); return; }
                    plantDate = new Date(val + 'T00:00:00');
                    saveLSTMState();
                    core.toast('Tanggal tanam disimpan: ' + val);
                    render();
                });
            }

            if (saveHarvest) {
                saveHarvest.addEventListener('click', function () {
                    var val = harvestInput ? Number(harvestInput.value) : 30;
                    if (!val || val < 20 || val > 60) { core.toast('Masukkan target panen antara 20–60 hari.'); return; }
                    harvestDay = val;
                    saveLSTMState();
                    core.toast('Target panen: ' + harvestDay + ' HST');
                    render();
                });
            }

            if (refreshBtn) {
                refreshBtn.addEventListener('click', function () { render(); });
            }
        }

        return {
            id: 'lstm',
            o: 30,
            name: 'LSTM',
            sub: 'Prediksi kematangan tanaman',
            ic: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/>',
            init: function () {
                loadLSTMState();
                setupInputs();
            },
            enter: function () {
                render();
            },
            render: function () {
                render();
            },
            leave: function () { }
        };
    });
})();
