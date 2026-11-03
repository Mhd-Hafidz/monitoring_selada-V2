/* js/pages/cnn_page.js - Halaman CNN: Analisis Gambar & Segmentasi Daun Selada Keriting */
(function () {
    'use strict';

    /* ── Konstanta Kematangan ── */
    var STAGE1_MAX = 66.5;
    var STAGE2_MAX = 89;

    /* Palette Warna Segmentasi Semantik */
    var PALETTE = {
        healthy: [34, 197, 94],    // #22c55e hijau sehat
        yellow:  [234, 179, 8],    // #eab308 kuning menguning
        brown:   [161, 98, 7],     // #a16207 cokelat nekrosis
        spot:    [239, 68, 68],    // #ef4444 merah bercak gelap
        hole:    [56, 189, 248],   // #38bdf8 biru lubang
        bg:      [13, 22, 38]      // #0d1626 latar belakang non-daun
    };

    /* Daftar Hama & Penyakit (berbasis metrik segmentasi warna) */
    var PESTS = [
        {
            id: 'caterpillar',
            name: 'Ulat Daun',
            desc: 'Ditandai lubang daun & bercak gelap tidak teratur',
            score: function (s) {
                var val = (s.holeRatio * 4.5 + s.spotRatio * 3.5 + s.irregularity * 0.3) * 100;
                return clamp(val, 8, 88);
            }
        },
        {
            id: 'aphid',
            name: 'Kutu Daun (Aphid)',
            desc: 'Ditandai daun pucat & menguning di sela tulang daun',
            score: function (s) {
                var val = (s.yellowRatio * 2.8 + (1 - s.greenRatio) * 0.4) * 55;
                return clamp(val, 12, 75);
            }
        },
        {
            id: 'rootrot',
            name: 'Busuk Akar',
            desc: 'Ditandai nekrosis kecoklatan pada pangkal daun',
            score: function (s) {
                var val = (s.brownRatio * 4.2 + (1 - s.leafCoverage) * 0.2) * 60;
                return clamp(val, 5, 82);
            }
        },
        {
            id: 'ndeficit',
            name: 'Kekurangan Nitrogen',
            desc: 'Ditandai klorosis / menguning merata pada helai daun',
            score: function (s) {
                var val = (s.yellowRatio * 3.2 + (1 - s.greenRatio) * 0.3) * 65;
                return clamp(val, 15, 85);
            }
        },
        {
            id: 'leafspot',
            name: 'Bercak Daun',
            desc: 'Ditandai bintik nekrotik kemerahan/cokelat',
            score: function (s) {
                var val = (s.spotRatio * 5.0 + s.brownRatio * 2.0 + s.irregularity * 0.2) * 80;
                return clamp(val, 10, 80);
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

    /* ── Analisis & Segmentasi Daun 5 Kelas ── */
    function processSegmentation(srcCtx, dstCtx, w, h) {
        var srcData = srcCtx.getImageData(0, 0, w, h);
        var dstData = dstCtx.createImageData(w, h);
        var s = srcData.data;
        var d = dstData.data;
        var n = w * h;

        var counts = {
            healthy: 0,
            yellow: 0,
            brown: 0,
            spot: 0,
            hole: 0,
            bg: 0
        };

        var totalR = 0, totalG = 0, totalB = 0;
        var varSum = 0;

        // Pass 1: compute channel averages
        for (var i = 0; i < s.length; i += 4) {
            totalR += s[i];
            totalG += s[i + 1];
            totalB += s[i + 2];
        }
        var avgR = totalR / n, avgG = totalG / n, avgB = totalB / n;
        var avgBrightness = (avgR + avgG + avgB) / (3 * 255);

        // Pass 2: multi-class pixel classification & segmentation mapping
        for (var j = 0; j < s.length; j += 4) {
            var r = s[j], g = s[j + 1], b = s[j + 2];
            var lum = 0.299 * r + 0.587 * g + 0.114 * b;
            var maxC = Math.max(r, g, b);
            var minC = Math.min(r, g, b);
            var sat = maxC === 0 ? 0 : (maxC - minC) / maxC;

            var dg = g - avgG;
            varSum += dg * dg;

            // Apakah piksel merupakan daun atau latar belakang (pot/dinding/tanah)?
            var isGreenDominant = (g > r * 1.04 && g > b * 1.12 && g > 45);
            var isYellowLeaf    = (r > 120 && g > 115 && b < 100 && (g - r) > -25);
            var isLeafTone      = isGreenDominant || isYellowLeaf;

            var color = null;

            if (!isLeafTone && (lum < 46 || sat < 0.16 || b > g * 1.15)) {
                // Background atau lubang di dalam tajuk daun
                if (lum < 38 && (r > 15 || g > 20) && sat > 0.20) {
                    color = PALETTE.hole;
                    counts.hole++;
                } else {
                    color = PALETTE.bg;
                    counts.bg++;
                }
            } else {
                // Pada area daun selada:
                // 1. Lubang / celah daun
                if (lum < 42 && sat < 0.35) {
                    color = PALETTE.hole;
                    counts.hole++;
                }
                // 2. Bercak gelap / lesi merah
                else if (lum < 70 && (r > g * 0.88 || (g - r) < 18)) {
                    color = PALETTE.spot;
                    counts.spot++;
                }
                // 3. Cokelat nekrosis (tepi/ujung daun mengering)
                else if (r > 75 && r > g * 0.88 && g > b && (r - b) > 28 && lum < 150) {
                    color = PALETTE.brown;
                    counts.brown++;
                }
                // 4. Kuning menguning (klorosis / daun muda / urat daun)
                else if ((r > 125 && g > 120 && b < 105 && (g - r) < 42) || (g > 155 && r > 135 && lum > 140)) {
                    color = PALETTE.yellow;
                    counts.yellow++;
                }
                // 5. Hijau sehat
                else {
                    color = PALETTE.healthy;
                    counts.healthy++;
                }
            }

            d[j]     = color[0];
            d[j + 1] = color[1];
            d[j + 2] = color[2];
            d[j + 3] = 255;
        }

        dstCtx.putImageData(dstData, 0, 0);

        var leafTotal = counts.healthy + counts.yellow + counts.brown + counts.spot + counts.hole;
        if (leafTotal === 0) leafTotal = 1;

        var greenRatio   = counts.healthy / leafTotal;
        var yellowRatio  = counts.yellow / leafTotal;
        var brownRatio   = counts.brown / leafTotal;
        var spotRatio    = counts.spot / leafTotal;
        var holeRatio    = counts.hole / leafTotal;
        var leafCoverage = leafTotal / n;
        var irregularity = clamp(Math.sqrt(varSum / n) / 55, 0, 1);

        // Perhitungan estimasi kematangan (berbasis daun hijau sehat + luas tajuk)
        var rawMat = greenRatio * 0.60 + leafCoverage * 0.25 + (1 - yellowRatio) * 0.15;
        var maturityPct = clamp(rawMat * 105, 10, 95);

        return {
            avgBrightness: avgBrightness,
            avgR: avgR / 255, avgG: avgG / 255, avgB: avgB / 255,
            counts: counts,
            leafTotal: leafTotal,
            totalPixels: n,
            greenRatio: greenRatio,
            yellowRatio: yellowRatio,
            brownRatio: brownRatio,
            spotRatio: spotRatio,
            holeRatio: holeRatio,
            leafCoverage: leafCoverage,
            irregularity: irregularity,
            maturityPct: maturityPct
        };
    }

    /* ── Module CNN ── */
    window.SeladaModules = window.SeladaModules || [];
    window.SeladaModules.push(function (core) {

        var initialized = false;
        var currentFile = null;
        var currentStats = null;
        var userCleared = false;

        /* ── DOM wiring ── */
        function build() {
            if (initialized) return;
            initialized = true;

            var zone      = $('#cnnDropZone');
            var input     = $('#cnnFileInput');
            var camBtn    = $('#cnnCamCapture');
            var sampleBtn = $('#cnnSampleBtn');
            var resetBtn  = $('#cnnReset');

            /* Klik area dropzone → buka dialog file */
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
                    if (f && f.type.startsWith('image/')) {
                        userCleared = false;
                        handleFile(f);
                    } else if (f) {
                        core.toast('File harus berupa gambar (JPG, PNG, WEBP).');
                    }
                });
            }

            /* Input file terpilih */
            if (input) {
                input.addEventListener('change', function () {
                    if (input.files && input.files[0]) {
                        userCleared = false;
                        handleFile(input.files[0]);
                    }
                    input.value = '';
                });
            }

            /* Tombol contoh foto selada */
            if (sampleBtn) {
                sampleBtn.addEventListener('click', function () {
                    userCleared = false;
                    loadSampleImage();
                    core.toast('Foto contoh selada keriting dimuat.');
                });
            }

            /* Tombol ambil dari kamera ESP32 */
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
                            userCleared = false;
                            handleFile(file);
                        })
                        .catch(function (err) {
                            setInfo('<p class="hint" style="color:var(--bad)">❌ Gagal mengambil gambar: ' + err.message + '</p>');
                            core.toast('Gagal mengambil gambar dari kamera ESP32-CAM.');
                        });
                });
            }

            /* Tombol Hapus Gambar */
            if (resetBtn) {
                resetBtn.addEventListener('click', function () {
                    userCleared = true;
                    resetAll();
                });
            }
        }

        /* ── Muat Foto Contoh (Default Sample) ── */
        function loadSampleImage() {
            var sampleUrl = 'data:image/jpeg;base64,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';
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                var mockFile = {
                    name: 'selada_keriting_sample.jpg',
                    size: 21628,
                    type: 'image/jpeg'
                };
                currentFile = mockFile;

                var origImg = $('#cnnOrigImg');
                if (origImg) origImg.src = sampleUrl;

                var preview = $('#cnnUploadPreview');
                var nameEl  = $('#cnnUploadName');
                if (preview) preview.style.display = 'block';
                if (nameEl)  nameEl.textContent = '📎 ' + mockFile.name + ' (21.1 KB · Contoh)';

                processImage(img, mockFile);
            };
            img.onerror = function () {
                console.warn('Foto contoh img/selada_sample.jpg belum dapat dimuat langsung.');
            };
            img.src = sampleUrl;
        }

        /* ── Handle File Unggahan ── */
        function handleFile(file) {
            currentFile = file;
            var sizeKB = (file.size / 1024).toFixed(1);

            var preview = $('#cnnUploadPreview');
            var nameEl  = $('#cnnUploadName');
            if (preview) preview.style.display = 'block';
            if (nameEl)  nameEl.textContent = '📎 ' + file.name + ' (' + sizeKB + ' KB)';

            var reader = new FileReader();
            reader.onload = function (ev) {
                var img = new Image();
                img.onload = function () {
                    processImage(img, file);
                };
                img.src = ev.target.result;

                var origImg = $('#cnnOrigImg');
                if (origImg) origImg.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        }

        /* ── Proses Segmentasi & Analisis ── */
        function processImage(imgEl, file) {
            var canvas = $('#cnnSegCanvas');
            if (!canvas) return;

            var W = imgEl.naturalWidth  || imgEl.width  || 300;
            var H = imgEl.naturalHeight || imgEl.height || 300;

            // Normalisasi resolusi untuk pemrosesan cepat
            var MAX = 500;
            if (W > MAX) { H = Math.round(H * MAX / W); W = MAX; }
            if (H > MAX) { W = Math.round(W * MAX / H); H = MAX; }

            canvas.width  = W;
            canvas.height = H;

            // Canvas temporer untuk membaca piksel asli
            var tempCanvas = document.createElement('canvas');
            tempCanvas.width  = W;
            tempCanvas.height = H;
            var tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(imgEl, 0, 0, W, H);

            var segCtx = canvas.getContext('2d');

            // Eksekusi segmentasi 5 kelas semantik
            var stats = processSegmentation(tempCtx, segCtx, W, H);
            currentStats = stats;

            // Tampilkan panel hasil
            showPanel('cnnResultPanel');

            // Perbarui seluruh panel turunan
            updateDescription(stats, file);
            updateMaturity(stats);
            updatePestDetection(stats);
            updateInfoPanel(file, stats, imgEl);
        }

        /* ── Helpers Tampilan ── */
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

            ['cnnResultPanel', 'cnnDescPanel', 'cnnMatPanel', 'cnnPestPanel'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

            var orig = $('#cnnOrigImg');
            if (orig) orig.src = '';
            var canvas = $('#cnnSegCanvas');
            if (canvas) {
                var c = canvas.getContext('2d');
                c.clearRect(0, 0, canvas.width, canvas.height);
            }
            var preview = $('#cnnUploadPreview');
            if (preview) preview.style.display = 'none';

            setInfo('<p class="hint">Belum ada gambar yang diupload. Pilih atau seret foto selada, atau klik tombol <b>Contoh</b> di atas untuk melihat demonstrasi segmentasi.</p>');
            core.toast('Gambar dihapus.');
        }

        /* ── Deskripsi Gambar ── */
        function updateDescription(stats, file) {
            showPanel('cnnDescPanel');

            var overall     = $('#cnnOverall');
            var overallVal  = $('#cnnOverallVal');
            var overallDesc = $('#cnnOverallDesc');
            var descEl      = $('#cnnDesc');

            var mat   = stats.maturityPct;
            var stage = stageInfo(mat);

            var conditionLabel, conditionColor, conditionDesc;
            if (stats.yellowRatio > 0.35) {
                conditionLabel = 'Perlu Perhatian (Klorosis)';
                conditionColor = 'var(--dry)';
                conditionDesc  = 'Terdeteksi proporsi daun menguning cukup signifikan (' + Math.round(stats.yellowRatio * 100) + '%), kemungkinan kekurangan nitrogen atau cahaya berlebih.';
            } else if (stats.brownRatio > 0.20 || stats.spotRatio > 0.15) {
                conditionLabel = 'Waspada (Bercak/Nekrosis)';
                conditionColor = 'var(--bad)';
                conditionDesc  = 'Terdeteksi nekrosis cokelat (' + Math.round(stats.brownRatio * 100) + '%) dan bercak gelap (' + Math.round(stats.spotRatio * 100) + '%). Periksa sirkulasi udara dan kelembapan.';
            } else if (stats.greenRatio > 0.45) {
                conditionLabel = 'Kondisi Baik & Sehat';
                conditionColor = 'var(--ok)';
                conditionDesc  = 'Daun selada didominasi warna hijau segar (' + Math.round(stats.greenRatio * 100) + '%). Tajuk tanaman tumbuh subur dan merata.';
            } else {
                conditionLabel = 'Kondisi Cukup';
                conditionColor = 'var(--muted)';
                conditionDesc  = 'Kondisi tanaman dalam ambang batas wajar, pemantauan berkala disarankan.';
            }

            if (overall) overall.style.borderLeft = '4px solid ' + conditionColor;
            if (overallVal) { overallVal.textContent = conditionLabel; overallVal.style.color = conditionColor; }
            if (overallDesc) overallDesc.textContent = conditionDesc;

            try {
                localStorage.setItem('selada_last_cnn', JSON.stringify({
                    label: conditionLabel,
                    pct: Math.round(stats.maturityPct),
                    greenRatio: Math.round(stats.greenRatio * 100),
                    t: Date.now()
                }));
            } catch (e) { }

            if (descEl) {
                var gPct = Math.round(stats.greenRatio * 100);
                var yPct = Math.round(stats.yellowRatio * 100);
                var bPct = Math.round(stats.brownRatio * 100);
                var sPct = Math.round(stats.spotRatio * 100);
                var hPct = Math.round(stats.holeRatio * 100);

                descEl.innerHTML =
                    'Hasil segmentasi daun mengidentifikasi distribusi jaringan tanaman: ' +
                    '<b style="color:#22c55e">Hijau sehat ' + gPct + '%</b>, ' +
                    '<b style="color:#eab308">Kuning ' + yPct + '%</b>, ' +
                    '<b style="color:#b45309">Cokelat nekrosis ' + bPct + '%</b>, ' +
                    '<b style="color:#ef4444">Bercak gelap ' + sPct + '%</b>, dan ' +
                    '<b style="color:#38bdf8">Lubang ' + hPct + '%</b>. ' +
                    'Tingkat kematangan terestimasi pada <b>' + Math.round(mat) + '% (' + stage.name + ')</b>.';
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

            if (pctEl)   pctEl.textContent = pct + '%';
            if (stageEl) { stageEl.textContent = stage.name; stageEl.style.color = stage.color; }
            if (barEl) {
                barEl.style.width      = clamp(pct, 0, 100) + '%';
                barEl.style.background = stage.color;
            }

            var hints = {
                'Masa Pertumbuhan': 'Tanaman berada pada fase vegetatif aktif. Jaga kelembapan tanah di kisaran optimal 60–80% dan intensitas pencahayaan.',
                'Mendekati Panen': 'Kepadatan tajuk daun sudah terbentuk optimal. Siapkan jadwal panen dalam 2–4 hari ke depan.',
                'Siap Panen': 'Tanaman selada keriting telah mencapai ukuran panen ideal. Panen segera di pagi hari untuk kesegaran maksimal.'
            };
            if (hintEl) hintEl.textContent = hints[stage.name] || 'Pemantauan kematangan visual tanaman.';
        }

        /* ── Deteksi Hama & Penyakit ── */
        function updatePestDetection(stats) {
            showPanel('cnnPestPanel');

            var barsEl = $('#cnnPestBars');
            if (!barsEl) return;

            var html = '';
            PESTS.forEach(function (pest) {
                var conf = Math.round(pest.score(stats));
                var detected = conf > 42;
                var labelColor = detected ? 'var(--dry)' : 'var(--ok)';
                var statusText = (detected ? '⚠ Terdeteksi ' : '✓ Aman ') + '(' + conf + '%)';

                html +=
                    '<div style="margin-bottom:14px">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
                    '<span style="font-size:13px"><b>' + pest.name + '</b>' +
                    ' <small style="color:var(--muted);font-weight:normal">— ' + pest.desc + '</small></span>' +
                    '<em style="font-style:normal;font-family:var(--f-mono);font-size:12px;font-weight:600;color:' + labelColor + '">' + statusText + '</em>' +
                    '</div>' +
                    '<div style="height:8px;border-radius:99px;background:var(--surface-2);overflow:hidden">' +
                    '<div style="height:100%;width:' + conf + '%;background:' + labelColor + ';border-radius:99px;transition:width .4s"></div>' +
                    '</div>' +
                    '</div>';
            });

            barsEl.innerHTML = html;
        }

        /* ── Info Panel (Sidebar) ── */
        function updateInfoPanel(file, stats, imgEl) {
            var sizeKB = (file.size / 1024).toFixed(1);
            var W = imgEl.naturalWidth  || imgEl.width  || '?';
            var H = imgEl.naturalHeight || imgEl.height || '?';
            var ts = new Date().toLocaleTimeString('id-ID');

            var gPct = Math.round(stats.greenRatio * 100);
            var yPct = Math.round(stats.yellowRatio * 100);
            var bPct = Math.round(stats.brownRatio * 100);
            var sPct = Math.round(stats.spotRatio * 100);
            var hPct = Math.round(stats.holeRatio * 100);

            var html =
                '<dl>' +
                '<dt>Nama File</dt><dd style="word-break:break-all">' + file.name + '</dd>' +
                '<dt>Ukuran File</dt><dd>' + sizeKB + ' KB</dd>' +
                '<dt>Dimensi</dt><dd>' + W + ' × ' + H + ' px</dd>' +
                '<dt>Waktu Analisis</dt><dd>' + ts + '</dd>' +
                '</dl>' +
                '<hr style="margin:10px 0;border-color:var(--line)">' +
                '<h3 style="font-size:13px;margin:8px 0 6px">Komposisi Segmentasi:</h3>' +
                '<dl>' +
                '<dt><span style="color:#22c55e">■</span> Hijau Sehat</dt><dd><b>' + gPct + '%</b></dd>' +
                '<dt><span style="color:#eab308">■</span> Kuning Menguning</dt><dd><b>' + yPct + '%</b></dd>' +
                '<dt><span style="color:#b45309">■</span> Cokelat Nekrosis</dt><dd><b>' + bPct + '%</b></dd>' +
                '<dt><span style="color:#ef4444">■</span> Merah Bercak</dt><dd><b>' + sPct + '%</b></dd>' +
                '<dt><span style="color:#38bdf8">■</span> Biru Lubang</dt><dd><b>' + hPct + '%</b></dd>' +
                '<dt>Kematangan</dt><dd><b style="color:var(--ok)">' + Math.round(stats.maturityPct) + '%</b></dd>' +
                '</dl>';

            setInfo(html);
        }

        /* ── Module Lifecycle ── */
        return {
            id:   'cnn',
            o:    40,
            name: 'CNN',
            sub:  'Analisis gambar daun selada',
            ic:   '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
            init: function () {
                /* deferred */
            },
            enter: function () {
                build();
                // Otomatis muat gambar contoh pada kunjungan pertama agar langsung ada hasilnya
                if (!currentFile && !currentStats && !userCleared) {
                    loadSampleImage();
                }
            },
            render: function () { },
            leave: function () { }
        };
    });

})();
