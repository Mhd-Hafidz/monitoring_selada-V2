/* Scan Gabungan: menyatukan hasil nyata sensor, Model LSTM (prediksi 24 jam), dan Model CNN (gambar).
   Browser menjalankan kedua model; pembacaan sensor, penilaian status, dan penggabungan hasil dikerjakan server Python
   (backend/services/scan_service.py). Tidak ada nilai bawaan atau acak. Bagian yang tidak bisa dijalankan dilaporkan
   available:false beserta alasannya; status keseluruhan = yang TERBURUK dari sensor, prediksi LSTM 24 jam, dan CNN. */
(function () {
    'use strict';
    var ML = window.SeladaML, E = ML.MLError, API = window.SeladaAPI, LSTM = window.SeladaLSTM, CNN = window.SeladaCNN;
    var HEALTH = ['Sehat', 'Perlu perhatian', 'Berisiko tinggi'];
    var SOFT = ['model_not_trained', 'tf_missing', 'stale_data', 'not_enough_recent', 'no_recent_data', 'no_data', 'firebase_unreachable'];

    async function lstmPart() {
        var r;
        try { r = await LSTM.forecast(24); }
        catch (e) { if (e instanceof E && SOFT.indexOf(e.code) >= 0) return { available: false, error: e.code, message: e.message }; throw e; }
        return { available: true, forecast: r.forecast, actual: r.actual, window_hours: r.window_hours, last_data_hour: r.last_data_hour,
            meta: { trained_at: (r.meta || {}).trained_at, horizon24: (r.meta || {}).horizon24 } };
    }
    async function cnnPart(image) {
        if (!image) return null;
        try { return Object.assign({ available: true }, await CNN.classify(image)); }
        catch (e) { if (e instanceof E && (e.code === 'model_not_trained' || e.code === 'tf_missing')) return { available: false, error: e.code, message: e.message }; throw e; }
    }

    /* image: Blob/File | {ip} | null. Setara POST /api/scan/combine. */
    async function scan(image, thresholds) {
        var lstm = await lstmPart(), cnn = await cnnPart(image), cx = API.ctx();
        return API.post('/api/scan/combine', { firebase_url: cx.firebase_url, thresholds: thresholds, lstm: lstm, cnn: cnn });
    }
    window.SeladaScan = { scan: scan };
})();
