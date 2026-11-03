/* js/pages/cnn_page.js - Halaman CNN: Analisis Gambar Daun Selada Keriting */
(function () {
    'use strict';

    /* ── Konstanta ── */
    var STAGE1_MAX = 66.5;
    var STAGE2_MAX = 89;

    /* Daftar hama & penyakit yang dideteksi (simulasi berbasis analisis warna) */
    var PESTS = [
        {
            id: 'caterpillar',
            name: 'Ulat Daun',
            desc: 'Ditandai bercak gelap/lubang tidak teratur',
            /* besar bila brightness rendah dan saturasi tidak merata */
            score: function (s) {
                return clamp(((1 - s.avgBrightness) * 0.6 + s.irregularity * 0.4) * 110, 0, 100);
            }
        },
        {
            id: 'aphid',
            name: 'Kutu Daun (Aphid)',
            desc: 'Ditandai warna pucat di permukaan daun',
            score: function (s) {
                return clamp(((1 - s.greenRatio) * 0.7 + s.yellowRatio * 0.3) * 90, 0, 100);
            }
        },
        {
            id: 'rootrot',
            name: 'Busuk Akar',
            desc: 'Ditandai warna kecoklatan di pangkal',
            score: function (s) {
                return clamp((s.brownRatio * 0.8 + (1 - s.leafCoverage) * 0.2) * 95, 0, 100);
            }
        },
        {
            id: 'ndeficit',
            name: 'Kekurangan Nitrogen',
            desc: 'Ditandai menguningnya daun',
            score: function (s) {
                return clamp((s.yellowRatio * 0.75 + (1 - s.greenRatio) * 0.25) * 105, 0, 100);
            }
        },
        {
            id: 'leafspot',
            name: 'Bercak Daun',
            desc: 'Ditandai bintik kuning/coklat tidak merata',
            score: function (s) {
                return clamp((s.yellowRatio * 0.5 + s.brownRatio * 0.3 + s.irregularity * 0.2) * 100, 0, 100);
            }
        }
    ];

    /* ── Helpers ── */
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function $(sel) { return document.querySelector(sel); }

    function stageInfo(pct) {
        if (pct < STAGE1_MAX) return { name: 'Masa Pertumbuhan', color: 'var(--ok)', short: 'Tumbuh' };
        if (pct < STAGE2_MAX) return { name: 'Mendekati Panen', color: 'var(--dry)', short: 'Dekat Panen' };
        return { name: 'Siap Panen', color: 'var(--bad)', short: 'Siap Panen' };
    }

    /* ── Analisis pixel gambar ── */
    function analyzePixels(ctx, w, h) {
        var data = ctx.getImageData(0, 0, w, h).data;
        var totalR = 0, totalG = 0, totalB = 0;
        var greenPx = 0, yellowPx = 0, brownPx = 0;
        var darkPx = 0, varSum = 0;
        var n = w * h;

        /* Pass 1: avg brightness + channel sums */
        for (var i = 0; i < data.length; i += 4) {
            var r = data[i], g = data[i + 1], b = data[i + 2];
            totalR += r; totalG += g; totalB += b;
        }
        var avgR = totalR / n, avgG = totalG / n, avgB = totalB / n;
        var avgBrightness = (avgR + avgG + avgB) / (3 * 255);

        /* Pass 2: classify pixels */
        for (var j = 0; j < data.length; j += 4) {
            var rr = data[j], gg = data[j + 1], bb = data[j + 2];
            var lum = (rr + gg + bb) / 3;
            /* green: G dominant, not too bright */
            if (gg > rr * 1.1 && gg > bb * 1.1 && lum < 230) greenPx++;
            /* yellow: R and G both high, B low */
            if (rr > 160 && gg > 140 && bb < 90) yellowPx++;
            /* brown: R > G > B, R moderate */
            if (rr > 80 && rr > gg && gg > bb && rr < 200 && (rr - bb) > 40) brownPx++;
            /* dark: low brightness → possible damage/shadow */
            if (lum < 60) darkPx++;
            /* variance for irregularity */
            var dg = gg - avgG;
            varSum += dg * dg;
        }

        var greenRatio    = greenPx  / n;
        var yellowRatio   = yellowPx / n;
        var brownRatio    = brownPx  / n;
        var leafCoverage  = greenRatio;
        var irregularity  = clamp(Math.sqrt(varSum / n) / 50, 0, 1);

        /* Maturity estimate: greener + more coverage = more mature */
        var rawMat = greenRatio * 0.55 + (avgG / 255) * 0.30 + (1 - yellowRatio) * 0.15;
        var maturityPct = clamp(rawMat * 120, 5, 99);

        return {
            avgBrightness: avgBrightness,
            avgR: avgR / 255, avgG: avgG / 255, avgB: avgB / 255,
            greenRatio: greenRatio,
            yellowRatio: yellowRatio,
            brownRatio: brownRatio,
            leafCoverage: leafCoverage,
            irregularity: irregularity,
            maturityPct: maturityPct
        };
    }

    /* ── Segmentasi kanal hijau pada canvas ── */
    function applyGreenSegmentation(ctx, w, h) {
        var imgData = ctx.getImageData(0, 0, w, h);
        var d = imgData.data;
        for (var i = 0; i < d.length; i += 4) {
            var r = d[i], g = d[i + 1], b = d[i + 2];
            /* Pixels that are "green-ish" are brightened, others dimmed/grayed */
            var isGreen = (g > r * 1.05 && g > b * 1.05);
            if (isGreen) {
                d[i]     = Math.round(r * 0.3);
                d[i + 1] = Math.min(255, Math.round(g * 1.4));
                d[i + 2] = Math.round(b * 0.3);
            } else {
                var gray = Math.round((r + g + b) / 3 * 0.55);
                d[i] = gray; d[i + 1] = gray; d[i + 2] = gray;
            }
        }
        ctx.putImageData(imgData, 0, 0);
    }

    /* ── Module ── */
    window.SeladaModules = window.SeladaModules || [];
    window.SeladaModules.push(function (core) {

        var initialized = false;
        var currentFile = null;
        var currentStats = null;

        /* ── DOM wiring (called on first enter) ── */
        function build() {
            if (initialized) return;
            initialized = true;

            var zone    = $('#cnnDropZone');
            var input   = $('#cnnFileInput');
            var camBtn  = $('#cnnCamCapture');
            var resetBtn = $('#cnnReset');

            /* Click zone → trigger file input */
            if (zone) {
                zone.addEventListener('click', function (e) {
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'LABEL') return;
                    if (input) input.click();
                });
                zone.addEventListener('dragover', function (e) {
                    e.preventDefault();
                    zone.classList.add('over');
                });
                zone.addEventListener('dragleave', function () {
                    zone.classList.remove('over');
                });
                zone.addEventListener('drop', function (e) {
                    e.preventDefault();
                    zone.classList.remove('over');
                    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                    if (f && f.type.startsWith('image/')) handleFile(f);
                    else if (f) core.toast('File harus berupa gambar (JPG, PNG, WEBP).');
                });
            }

            /* File input change */
            if (input) {
                input.addEventListener('change', function () {
                    if (input.files && input.files[0]) handleFile(input.files[0]);
                    input.value = '';
                });
            }

            /* Capture from ESP32-CAM */
            if (camBtn) {
                camBtn.addEventListener('click', function () {
                    var ip = core.settings().camIp;
                    if (!ip) {
                        core.toast('Konfigurasi IP kamera di halaman Pengaturan terlebih dahulu.');
                        return;
                    }
                    var url = 'http://' + ip + '/capture?t=' + Date.now();
                    setInfo('<p class="hint">⏳ Mengambil gambar dari kamera ESP32-CAM...</p>');
                    fetch(url)
                        .then(function (r) {
                            if (!r.ok) throw new Error('HTTP ' + r.status);
                            return r.blob();
                        })
                        .then(function (blob) {
                            var file = new File([blob], 'esp32cam_' + Date.now() + '.jpg', { type: 'image/jpeg' });
                            handleFile(file);
                        })
                        .catch(function (err) {
                            setInfo('<p class="hint" style="color:var(--bad)">❌ Gagal mengambil gambar: ' + err.message + '</p>');
                            core.toast('Gagal mengambil gambar dari kamera ESP32-CAM.');
                        });
                });
            }

            /* Reset button */
            if (resetBtn) {
                resetBtn.addEventListener('click', function () { resetAll(); });
            }
        }

        /* ── Handle uploaded/captured file ── */
        function handleFile(file) {
            currentFile = file;
            var sizeKB = (file.size / 1024).toFixed(1);

            /* Show name in preview */
            var preview = $('#cnnUploadPreview');
            var nameEl  = $('#cnnUploadName');
            if (preview) preview.style.display = 'block';
            if (nameEl)  nameEl.textContent = '📎 ' + file.name + ' (' + sizeKB + ' KB)';

            /* Load into Image then draw onto canvas for analysis */
            var reader = new FileReader();
            reader.onload = function (ev) {
                var img = new Image();
                img.onload = function () {
                    processImage(img, file, ev.target.result);
                };
                img.src = ev.target.result;

                /* Set original image */
                var origImg = $('#cnnOrigImg');
                if (origImg) origImg.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        }

        /* ── Draw, segment, and analyse ── */
        function processImage(imgEl, file, dataUrl) {
            var canvas = $('#cnnSegCanvas');
            if (!canvas) return;

            var W = imgEl.naturalWidth  || imgEl.width  || 300;
            var H = imgEl.naturalHeight || imgEl.height || 300;

            /* Clamp to reasonable size */
            var MAX = 600;
            if (W > MAX) { H = Math.round(H * MAX / W); W = MAX; }
            if (H > MAX) { W = Math.round(W * MAX / H); H = MAX; }

            canvas.width  = W;
            canvas.height = H;

            var ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0, W, H);

            /* Analyse BEFORE segmentation so we read original colours */
            var stats = analyzePixels(ctx, W, H);
            currentStats = stats;

            /* Now apply green segmentation (visual only) */
            applyGreenSegmentation(ctx, W, H);

            /* Show result panels */
            showPanel('cnnResultPanel');

            /* Update all sections */
            updateDescription(stats, file);
            updateMaturity(stats);
            updatePestDetection(stats);
            updateInfoPanel(file, stats, imgEl);
        }

        /* ── Helpers ── */
        function showPanel(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'block';
        }

        function setInfo(html) {
            var el = $('#cnnInfoContent');
            if (el) el.innerHTML = html;
        }

        function resetAll() {
            currentFile  = null;
            currentStats = null;
            /* Hide panels */
            ['cnnResultPanel','cnnDescPanel','cnnMatPanel','cnnPestPanel'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            /* Clear images */
            var orig = $('#cnnOrigImg');
            if (orig) orig.src = '';
            var canvas = $('#cnnSegCanvas');
            if (canvas) { var c = canvas.getContext('2d'); c.clearRect(0, 0, canvas.width, canvas.height); }
            var preview = $('#cnnUploadPreview');
            if (preview) preview.style.display = 'none';
            /* Reset info panel */
            setInfo('<p class="hint">Belum ada gambar yang diupload. Pilih atau seret gambar daun selada untuk memulai analisis CNN.</p>');
            core.toast('Analisis direset.');
        }

        /* ── Deskripsi Gambar ── */
        function updateDescription(stats, file) {
            showPanel('cnnDescPanel');

            var overall = $('#cnnOverall');
            var overallVal = $('#cnnOverallVal');
            var overallDesc = $('#cnnOverallDesc');
            var descEl = $('#cnnDesc');

            var mat = stats.maturityPct;
            var stage = stageInfo(mat);

            /* Overall condition */
            var conditionLabel, conditionColor, conditionDesc;
            if (stats.yellowRatio > 0.3) {
                conditionLabel = 'Perlu Perhatian'; conditionColor = 'var(--dry)';
                conditionDesc  = 'Terdeteksi proporsi kuning yang tinggi, kemungkinan kekurangan nutrisi atau stres.';
            } else if (stats.brownRatio > 0.25) {
                conditionLabel = 'Waspada'; conditionColor = 'var(--bad)';
                conditionDesc  = 'Terdeteksi warna kecoklatan yang cukup banyak, perlu pemeriksaan lebih lanjut.';
            } else if (stats.greenRatio > 0.35) {
                conditionLabel = 'Kondisi Baik'; conditionColor = 'var(--ok)';
                conditionDesc  = 'Daun didominasi warna hijau yang segar, kondisi tanaman tampak sehat.';
            } else {
                conditionLabel = 'Cukup'; conditionColor = 'var(--muted)';
                conditionDesc  = 'Kondisi tanaman dalam batas normal, perlu pemantauan rutin.';
            }

            if (overall) overall.style.borderLeft = '4px solid ' + conditionColor;
            if (overallVal) { overallVal.textContent = conditionLabel; overallVal.style.color = conditionColor; }
            if (overallDesc) overallDesc.textContent = conditionDesc;

            if (descEl) {
                var pct = Math.round(mat);
                var greenPct = Math.round(stats.greenRatio * 100);
                var yellowPct = Math.round(stats.yellowRatio * 100);
                var brownPct  = Math.round(stats.brownRatio * 100);
                descEl.textContent =
                    'Analisis berbasis kanal warna mendeteksi: cakupan daun hijau ' + greenPct + '%, ' +
                    'warna kuning ' + yellowPct + '%, kecoklatan ' + brownPct + '%. ' +
                    'Estimasi tingkat kematangan: ' + pct + '% (' + stage.name + '). ' +
                    'Catatan: hasil ini merupakan estimasi berbasis analisis warna (bukan model CNN terlatih).';
            }
        }

        /* ── Prediksi Kematangan ── */
        function updateMaturity(stats) {
            showPanel('cnnMatPanel');

            var pct   = Math.round(stats.maturityPct);
            var stage = stageInfo(stats.maturityPct);

            var pctEl   = $('#cnnMatPct');
            var stageEl = $('#cnnMatStage');
            var barEl   = $('#cnnMatBar');
            var hintEl  = $('#cnnMatHint');

            if (pctEl)   pctEl.textContent  = pct + '%';
            if (stageEl) { stageEl.textContent = stage.name; stageEl.style.color = stage.color; }
            if (barEl)   {
                barEl.style.width      = clamp(pct, 0, 100) + '%';
                barEl.style.background = stage.color;
            }

            var hints = {
                'Masa Pertumbuhan': 'Tanaman masih dalam fase pertumbuhan. Lanjutkan perawatan rutin: penyiraman, pemupukan, dan pemantauan harian.',
                'Mendekati Panen': 'Tanaman mendekati masa panen. Siapkan rencana pemanenan dan periksa kondisi fisik daun.',
                'Siap Panen': 'Tanaman diperkirakan siap panen. Lakukan panen segera untuk menjaga kualitas daun.'
            };
            if (hintEl) hintEl.textContent = (hints[stage.name] || '') + ' (Simulasi — bukan hasil model CNN terlatih)';
        }

        /* ── Deteksi Hama & Penyakit ── */
        function updatePestDetection(stats) {
            showPanel('cnnPestPanel');

            var barsEl = $('#cnnPestBars');
            if (!barsEl) return;

            var html = '';
            PESTS.forEach(function (pest) {
                var raw  = pest.score(stats);
                var conf = Math.round(clamp(raw, 0, 100));
                var detected = conf > 40;
                var labelColor = detected ? 'var(--dry)' : 'var(--ok)';
                var statusText = detected ? '⚠ ' + conf + '%' : '✓ ' + conf + '%';
                html +=
                    '<div style="margin-bottom:14px">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
                    '<span style="font-size:13px"><b>' + pest.name + '</b>' +
                    ' <small style="color:var(--muted);font-weight:normal">— ' + (detected ? 'Terdeteksi' : 'Tidak Terdeteksi') + '</small></span>' +
                    '<em style="font-style:normal;font-family:var(--f-mono);font-size:12px;color:' + labelColor + '">' + statusText + '</em>' +
                    '</div>' +
                    '<div style="height:8px;border-radius:99px;background:var(--surface-2);overflow:hidden">' +
                    '<div style="height:100%;width:' + conf + '%;background:' + labelColor + ';border-radius:99px;transition:width .4s"></div>' +
                    '</div>' +
                    '<p style="font-size:11px;color:var(--muted);margin:2px 0 0">' + pest.desc + '</p>' +
                    '</div>';
            });

            barsEl.innerHTML = html;
        }

        /* ── Info Panel (sidebar) ── */
        function updateInfoPanel(file, stats, imgEl) {
            var sizeKB = (file.size / 1024).toFixed(1);
            var W = imgEl.naturalWidth  || imgEl.width  || '?';
            var H = imgEl.naturalHeight || imgEl.height || '?';
            var ts = new Date().toLocaleString('id-ID');

            var html =
                '<dl>' +
                '<dt>Nama File</dt><dd style="word-break:break-all">' + file.name + '</dd>' +
                '<dt>Ukuran</dt><dd>' + sizeKB + ' KB</dd>' +
                '<dt>Dimensi</dt><dd>' + W + ' × ' + H + ' px</dd>' +
                '<dt>Tipe</dt><dd>' + file.type + '</dd>' +
                '<dt>Waktu Analisis</dt><dd>' + ts + '</dd>' +
                '</dl>' +
                '<hr style="margin:10px 0;border-color:var(--line)">' +
                '<dl>' +
                '<dt>Cakupan Hijau</dt><dd>' + Math.round(stats.greenRatio * 100) + '%</dd>' +
                '<dt>Proporsi Kuning</dt><dd>' + Math.round(stats.yellowRatio * 100) + '%</dd>' +
                '<dt>Proporsi Coklat</dt><dd>' + Math.round(stats.brownRatio * 100) + '%</dd>' +
                '<dt>Kecerahan Rata-rata</dt><dd>' + Math.round(stats.avgBrightness * 100) + '%</dd>' +
                '<dt>Irregularitas</dt><dd>' + Math.round(stats.irregularity * 100) + '%</dd>' +
                '<dt>Estimasi Kematangan</dt><dd><b>' + Math.round(stats.maturityPct) + '%</b></dd>' +
                '</dl>' +
                '<p class="hint" style="margin-top:10px">⚠️ Analisis ini menggunakan metode kanal warna (bukan model CNN terlatih). Hasilnya bersifat indikatif.</p>';

            setInfo(html);
        }

        /* ── Module lifecycle ── */
        return {
            id:   'cnn',
            o:    40,
            name: 'CNN',
            sub:  'Analisis gambar daun selada',
            ic:   '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
            init: function () {
                /* wiring deferred to first enter so DOM is ready */
            },
            enter: function () {
                build();
            },
            render: function () { /* no polling needed */ },
            leave: function () { }
        };
    });

})();
