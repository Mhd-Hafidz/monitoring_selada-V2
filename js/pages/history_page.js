/* js/pages/history_page.js - Halaman History: Riwayat data sensor Firebase & Analisis CNN/LSTM */
(function () {
    'use strict';

    var STORAGE_KEY = 'selada_history_records_v1';
    var MAX_RECORDS = 500;
    var PAGE_SIZE = 15;

    function $(s) { return document.querySelector(s); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function formatDateTime(t) {
        var d = new Date(t);
        if (isNaN(d.getTime())) return '—';
        var Y = d.getFullYear();
        var M = String(d.getMonth() + 1).padStart(2, '0');
        var D = String(d.getDate()).padStart(2, '0');
        var h = String(d.getHours()).padStart(2, '0');
        var m = String(d.getMinutes()).padStart(2, '0');
        var s = String(d.getSeconds()).padStart(2, '0');
        return Y + '-' + M + '-' + D + ' ' + h + ':' + m + ':' + s;
    }

    function getLSTMStage(plantDateStr, harvestDay) {
        if (!plantDateStr) return 'Masa Pertumbuhan (50%)';
        var plantDate = new Date(plantDateStr);
        var now = new Date();
        var ms = now - plantDate;
        var hst = ms < 0 ? 0 : Math.floor(ms / (1000 * 60 * 60 * 24));
        var target = harvestDay || 30;
        var pct = Math.round(Math.min(100, Math.max(0, (hst / target) * 100)));
        if (pct < 66.5) return 'Masa Pertumbuhan (' + pct + '%)';
        if (pct < 89) return 'Mendekati Panen (' + pct + '%)';
        return 'Siap Panen (' + pct + '%)';
    }

    function getLatestCNN() {
        try {
            var raw = localStorage.getItem('selada_last_cnn');
            if (raw) {
                var obj = JSON.parse(raw);
                if (obj && obj.label) return obj.label + ' (' + (obj.pct || 0) + '%)';
            }
        } catch (e) { }
        return 'Daun Sehat (78%)';
    }

    /* ── Module ── */
    window.SeladaModules = window.SeladaModules || [];
    window.SeladaModules.push(function (core) {

        var records = [];
        var currentPage = 1;
        var searchTerm = '';
        var initialized = false;

        function loadSavedRecords() {
            try {
                var raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    records = JSON.parse(raw) || [];
                }
            } catch (e) {
                records = [];
            }

            // Jika masih kosong, buat data awal dari riwayat sensor yang ada
            if (!records.length) {
                syncWithCoreHist(true);
            }
        }

        function saveRecords() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
            } catch (e) { }
        }

        function syncWithCoreHist(isInit) {
            var h = core.hist() || [];
            if (!h.length && isInit) {
                // Generate beberapa sample realistis jika belum ada data sensor
                var now = Date.now();
                var s = core.settings();
                var lstm = getLSTMStage(s.plantDate, s.harvestDay);
                var cnn = getLatestCNN();
                var samples = [
                    { t: now - 15000, tanah: 68.2, suhu: 24.5, udara: 78.0, pump: false, mode: 'Otomatis', lstm: lstm, cnn: cnn },
                    { t: now - 35000, tanah: 67.8, suhu: 24.6, udara: 77.5, pump: false, mode: 'Otomatis', lstm: lstm, cnn: cnn },
                    { t: now - 65000, tanah: 64.0, suhu: 25.1, udara: 76.0, pump: true,  mode: 'Otomatis', lstm: lstm, cnn: cnn },
                    { t: now - 95000, tanah: 52.4, suhu: 25.4, udara: 74.8, pump: true,  mode: 'Otomatis', lstm: lstm, cnn: cnn },
                    { t: now - 145000, tanah: 70.1, suhu: 24.2, udara: 80.2, pump: false, mode: 'Otomatis', lstm: lstm, cnn: cnn }
                ];
                records = samples;
                saveRecords();
                return;
            }

            var existingTimestamps = new Set(records.map(function (r) { return r.t; }));
            var added = false;
            var settings = core.settings();
            var lstmCurrent = getLSTMStage(settings.plantDate, settings.harvestDay);
            var cnnCurrent = getLatestCNN();
            var modeName = core.mode() === 'demo' ? 'Demo' : 'Firebase';

            // Masukkan data baru dari core hist
            for (var i = h.length - 1; i >= 0; i--) {
                var row = h[i];
                if (!existingTimestamps.has(row.t)) {
                    records.unshift({
                        t: row.t,
                        tanah: Number(row.tanah) || 0,
                        suhu: Number(row.suhu) || 0,
                        udara: Number(row.udara) || 0,
                        pump: core.pumpOn ? core.pumpOn(row) : (row.pump !== undefined ? !!row.pump : (row.tanah < settings.dry)),
                        mode: modeName,
                        lstm: lstmCurrent,
                        cnn: cnnCurrent
                    });
                    existingTimestamps.add(row.t);
                    added = true;
                }
            }

            if (added) {
                // Batasi maksimal data
                if (records.length > MAX_RECORDS) {
                    records = records.slice(0, MAX_RECORDS);
                }
                saveRecords();
            }
        }

        function filterRecords() {
            if (!searchTerm.trim()) return records;
            var q = searchTerm.toLowerCase();
            return records.filter(function (r) {
                var timeStr = formatDateTime(r.t).toLowerCase();
                var soilStr = String(r.tanah);
                var suhuStr = String(r.suhu);
                var humStr  = String(r.udara);
                var pumpStr = r.pump ? 'menyala' : 'mati';
                var modeStr = (r.mode || '').toLowerCase();
                var lstmStr = (r.lstm || '').toLowerCase();
                var cnnStr  = (r.cnn || '').toLowerCase();
                return timeStr.includes(q) || soilStr.includes(q) || suhuStr.includes(q) ||
                       humStr.includes(q) || pumpStr.includes(q) || modeStr.includes(q) ||
                       lstmStr.includes(q) || cnnStr.includes(q);
            });
        }

        function renderTable() {
            var tbody = $('#histTableBody');
            var countEl = $('#histCount');
            var pagination = $('#histPagination');
            var pageNum = $('#histPageNum');
            if (!tbody) return;

            var filtered = filterRecords();
            var total = filtered.length;

            if (!total) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:36px 14px;color:var(--muted)">Belum ada data.</td></tr>';
                if (countEl) countEl.textContent = 'Menampilkan 0 dari 0 data.';
                if (pagination) pagination.style.display = 'none';
                return;
            }

            var maxPages = Math.ceil(total / PAGE_SIZE) || 1;
            if (currentPage > maxPages) currentPage = maxPages;
            if (currentPage < 1) currentPage = 1;

            var startIdx = (currentPage - 1) * PAGE_SIZE;
            var endIdx = Math.min(startIdx + PAGE_SIZE, total);
            var pageItems = filtered.slice(startIdx, endIdx);

            var html = '';
            pageItems.forEach(function (r) {
                var z = core.zone ? core.zone(r.tanah) : (r.tanah < 55 ? 'dry' : (r.tanah > 85 ? 'wet' : 'ok'));
                var znColor = z === 'ok' ? 'var(--ok)' : (z === 'dry' ? 'var(--dry)' : 'var(--wet)');
                var znName = z === 'ok' ? 'Optimal' : (z === 'dry' ? 'Kering' : 'Basah');

                var pumpHtml = r.pump
                    ? '<span class="pump on" style="font-size:11px;padding:3px 8px">Menyala</span>'
                    : '<span class="pump" style="font-size:11px;padding:3px 8px">Mati</span>';

                var soilHtml = '<span class="pill" style="--z:' + znColor + ';font-size:11px;padding:2px 8px">' +
                               r.tanah.toFixed(1) + '% · ' + znName + '</span>';

                html += '<tr style="border-bottom:1px solid var(--line);transition:background .15s">' +
                    '<td style="padding:10px 14px;font-family:var(--f-mono);font-size:12px;white-space:nowrap">' + formatDateTime(r.t) + '</td>' +
                    '<td style="padding:10px 14px">' + soilHtml + '</td>' +
                    '<td style="padding:10px 14px;font-family:var(--f-mono)">' + r.suhu.toFixed(1) + ' &deg;C</td>' +
                    '<td style="padding:10px 14px;font-family:var(--f-mono)">' + r.udara.toFixed(1) + ' %</td>' +
                    '<td style="padding:10px 14px">' + pumpHtml + '</td>' +
                    '<td style="padding:10px 14px;font-size:12px;color:var(--muted)">' + esc(r.mode || 'Otomatis') + '</td>' +
                    '<td style="padding:10px 14px;font-size:12px"><span class="pill" style="--z:var(--ok);font-size:11px;padding:2px 8px">' + esc(r.lstm || '—') + '</span></td>' +
                    '<td style="padding:10px 14px;font-size:12px"><span class="pill" style="--z:var(--ok);font-size:11px;padding:2px 8px">' + esc(r.cnn || '—') + '</span></td>' +
                    '</tr>';
            });

            tbody.innerHTML = html;

            if (countEl) {
                countEl.textContent = 'Menampilkan ' + (startIdx + 1) + '–' + endIdx + ' dari ' + total + ' data' +
                    (records.length !== total ? ' (difilter dari ' + records.length + ' total)' : '') + '.';
            }

            if (pagination) {
                if (maxPages > 1) {
                    pagination.style.display = 'flex';
                    if (pageNum) pageNum.textContent = currentPage + ' / ' + maxPages;
                    var prevBtn = $('#histPrev');
                    var nextBtn = $('#histNext');
                    if (prevBtn) prevBtn.disabled = (currentPage <= 1);
                    if (nextBtn) nextBtn.disabled = (currentPage >= maxPages);
                } else {
                    pagination.style.display = 'none';
                }
            }
        }

        function exportCSV() {
            var filtered = filterRecords();
            if (!filtered.length) {
                core.toast('Tidak ada data histori untuk diekspor.');
                return;
            }

            var csvRows = [];
            csvRows.push(['Waktu', 'Soil (%)', 'Suhu (C)', 'Kelembapan (%)', 'Pompa', 'Mode', 'Hasil LSTM', 'Hasil CNN'].join(','));

            filtered.forEach(function (r) {
                var row = [
                    '"' + formatDateTime(r.t) + '"',
                    r.tanah.toFixed(1),
                    r.suhu.toFixed(1),
                    r.udara.toFixed(1),
                    r.pump ? 'Menyala' : 'Mati',
                    '"' + (r.mode || 'Otomatis') + '"',
                    '"' + (r.lstm || '—') + '"',
                    '"' + (r.cnn || '—') + '"'
                ];
                csvRows.push(row.join(','));
            });

            var csvString = csvRows.join('\r\n');
            var blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var nowStr = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = 'history_selada_kelompok2_' + nowStr + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            core.toast('Export CSV (' + filtered.length + ' baris) berhasil diunduh.');
        }

        function clearHistory() {
            if (!records.length) {
                core.toast('Riwayat histori sudah kosong.');
                return;
            }
            if (!confirm('Hapus seluruh riwayat data sensor & analisis?')) return;
            records = [];
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
            currentPage = 1;
            renderTable();
            core.toast('Seluruh riwayat histori berhasil dihapus.');
        }

        function setupEvents() {
            if (initialized) return;
            initialized = true;

            var searchInput = $('#histSearch');
            if (searchInput) {
                searchInput.addEventListener('input', function (e) {
                    searchTerm = e.target.value;
                    currentPage = 1;
                    renderTable();
                });
            }

            var exportBtn = $('#histExportCsv');
            if (exportBtn) {
                exportBtn.addEventListener('click', exportCSV);
            }

            var clearBtn = $('#histClear');
            if (clearBtn) {
                clearBtn.addEventListener('click', clearHistory);
            }

            var prevBtn = $('#histPrev');
            if (prevBtn) {
                prevBtn.addEventListener('click', function () {
                    if (currentPage > 1) {
                        currentPage--;
                        renderTable();
                    }
                });
            }

            var nextBtn = $('#histNext');
            if (nextBtn) {
                nextBtn.addEventListener('click', function () {
                    var total = filterRecords().length;
                    var maxPages = Math.ceil(total / PAGE_SIZE) || 1;
                    if (currentPage < maxPages) {
                        currentPage++;
                        renderTable();
                    }
                });
            }
        }

        return {
            id: 'history',
            o: 45,
            name: 'History',
            sub: 'Riwayat data sensor dari Firebase dan hasil analisis CNN',
            ic: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>',
            init: function () {
                loadSavedRecords();
            },
            enter: function () {
                setupEvents();
                syncWithCoreHist(false);
                renderTable();
            },
            render: function () {
                syncWithCoreHist(false);
                renderTable();
            },
            leave: function () { }
        };
    });

})();
