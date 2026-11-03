/* Konfigurasi Machine Learning di browser (pengganti backend/config.py).
   Semua pengaturan bisa diubah dari halaman Pengaturan; disimpan di localStorage. */
(function () {
    'use strict';
    var KEY = 'selada-ml-v2';
    var C = {
        WINDOW_HOURS: 24,            // jumlah jam riwayat yang dilihat model
        HORIZON_DAYS: 4,
        HORIZON_HOURS: 96,
        TEST_FRACTION: 0.20,
        VAL_FRACTION: 0.15,
        MIN_WINDOWS_REQUIRED: 120,   // jendela latih minimum agar training bermakna
        MAX_STALE_HOURS: 6,          // prediksi ditolak bila jam lengkap terakhir lebih tua dari ini
        MIN_SAMPLES_PER_HOUR: 10,    // jam dengan pembacaan lebih sedikit dianggap tidak lengkap
        MAX_GAP_HOURS: 3,            // celah terpanjang yang boleh diisi interpolasi linear
        FETCH_CHUNK_HOURS: 3,
        FETCH_CONCURRENCY: 4,
        OFFLINE_AFTER_SECONDS: 15,
        CNN_MIN_IMAGES_PER_CLASS: 10,
        CNN_UNCERTAIN_BELOW: 0.60,
        MAX_IMAGE_MB: 10,
        DEFAULT_TZ: 'Asia/Jakarta',
        DEFAULT_DAYS: 14
    };
    function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
    function write(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } }

    /* Galat terstruktur (sama bentuknya dengan galat backend lama, sehingga UI galat tetap dipakai). */
    function MLError(code, message, data) { this.code = code; this.message = message; this.data = data || {}; this.name = 'MLError'; }
    MLError.prototype = Object.create(Error.prototype);

    function tf() {
        if (!window.tf) throw new MLError('tf_missing', 'TensorFlow.js belum termuat. Pustaka diunduh dari internet (cdn.jsdelivr.net); periksa koneksi lalu muat ulang halaman.');
        return window.tf;
    }
    /* Pastikan backend tfjs siap (WebGL bila ada, jika tidak CPU). */
    var readyP = null;
    function ready() {
        if (!readyP) readyP = (async function () { var t = tf(); await t.ready(); return t.getBackend(); })();
        return readyP;
    }
    function tz() { return read().tz || C.DEFAULT_TZ; }
    function setTz(z) {
        try { new Intl.DateTimeFormat('en-GB', { timeZone: z }); } catch (e) { return false; }
        var o = read(); o.tz = z; write(o); return true;
    }
    function days() { return Math.max(3, Math.min(60, Number(read().days) || C.DEFAULT_DAYS)); }
    function setDays(n) { var o = read(); o.days = Math.max(3, Math.min(60, Math.round(Number(n)) || C.DEFAULT_DAYS)); write(o); return o.days; }
    function firebaseUrl() { return (window.Selada && window.Selada.settings().firebase) || ''; }

    window.SeladaML = { C: C, MLError: MLError, tf: tf, ready: ready, tz: tz, setTz: setTz, days: days, setDays: setDays, firebaseUrl: firebaseUrl, read: read, write: write };
})();
