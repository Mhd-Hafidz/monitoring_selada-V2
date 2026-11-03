/* Prediksi 4 hari ke depan dari model LSTM. "Hari ke-k" = blok 24 jam ke-k mulai dari jam yang sedang berjalan;
   nilai harian = rata-rata jam prediksi. Agregasi harian dan status dihitung di server Python
   (backend/services/forecast_service.py, aturan sama dengan dashboard); di sini hanya memanggil dan merangkai hasil. */
(function () {
    'use strict';
    var LSTM = window.SeladaLSTM, C = window.SeladaML.C;

    /* Setara POST /api/predict/four-days */
    async function fourDays(thresholds) {
        var r = await LSTM.forecast(C.HORIZON_HOURS, { thresholds: thresholds, days: C.HORIZON_DAYS }), meta = r.meta || {};
        return {
            generated_at: new Date().toISOString(), last_data_hour: new Date(r.last_data_hour).toISOString(), lag_hours: r.lag_hours, thresholds: r.thresholds, days: r.days,
            hourly: r.forecast, actual_recent: r.actual, summary: r.forecast_summary,
            model: { trained_at: meta.trained_at, n_train: meta.n_train, horizon24: meta.horizon24 },
            disclaimer: 'Hasil prediksi merupakan estimasi berdasarkan pola historis, bukan jaminan kondisi tanaman. Ketidakpastian membesar semakin jauh harinya karena prediksi dibuat bertahap (rekursif).'
        };
    }
    window.SeladaForecast = { fourDays: fourDays };
})();
