"""Scan Gabungan: menyatukan hasil nyata sensor, prediksi LSTM 24 jam, dan klasifikasi CNN (port dari js/ml/scan.js).
Tidak ada nilai bawaan atau acak. Bagian yang tidak bisa dijalankan dilaporkan available:false beserta alasannya;
status keseluruhan = yang TERBURUK dari sensor saat ini, prediksi LSTM 24 jam, dan CNN (CNN tidak pasti maks "waspada")."""
from datetime import datetime, timezone

import config as C
from services import data_service as DS
from services import forecast_service as FS
from utils import status as R

HEALTH = ["Sehat", "Perlu perhatian", "Berisiko tinggi"]


def _iso(ms):
    return FS._iso(ms)


def sensor_part(base, th):
    r = DS.latest_reading(base)
    if not r:
        from config import MLError
        raise MLError("no_data", "Belum ada data sensor di Firebase.", status=404)
    online = r["age_s"] <= C.OFFLINE_AFTER_SECONDS
    return {"reading": {**r, "online": online, "time_iso": _iso(r["t"])},
            "assessment": R.assess_reading(r["suhu"], r["udara"], r["tanah"], th)}


def lstm_part(lstm_in, th, cur):
    """lstm_in: {available:false,error,message} atau {forecast(24 baris), actual, window_hours, last_data_hour, meta}."""
    if not lstm_in or not lstm_in.get("available", True) and not lstm_in.get("forecast"):
        return {"available": False, "error": (lstm_in or {}).get("error", "unavailable"), "message": (lstm_in or {}).get("message", "")}
    fc = lstm_in["forecast"]
    day = FS.aggregate_days(fc, th, 1)[0]
    last24 = lstm_in.get("actual", [])[-24:]
    trend = {p: round(day["params"][p]["mean"] - cur[p], 2) for p in R.PARAMS}
    meta = lstm_in.get("meta") or {}
    return {
        "available": True, "status": {"level": day["level"], "label": day["label"]},
        "historical": {"hours": len(last24), "stats": FS.stats_of(last24) if last24 else None,
                       "text": f"Berdasarkan {lstm_in.get('window_hours')} jam data terakhir (rata-rata per jam)."},
        "next_hour": FS.rows_for_json(fc[:1])[0], "next_24h": day["params"], "trend_vs_now": trend,
        "last_data_hour": _iso(lstm_in["last_data_hour"]),
        "model": {"trained_at": meta.get("trained_at"), "horizon24": meta.get("horizon24")},
    }


def cnn_part(cnn_in):
    if not cnn_in:
        return {"available": False, "error": "no_image", "message": "Belum ada gambar. Unggah foto atau ambil dari kamera."}
    if not cnn_in.get("available", True):
        return cnn_in
    level = cnn_in["status"]["level"]
    return {**cnn_in, "available": True, "effective_level": min(level, 1) if cnn_in.get("uncertain") else level}


def combine(base, thresholds, lstm_in, cnn_in):
    th = R.normalize(thresholds)
    sensor = sensor_part(base, th)
    cur = sensor["reading"]
    lstm = lstm_part(lstm_in, th, cur)
    cnn = cnn_part(cnn_in)
    factors, recs = [], []
    lv_sensor = sensor["assessment"]["level"]
    if not cur["online"]:
        lv_sensor = max(lv_sensor, 1)
        factors.append({"source": "sensor", "level": 1, "label": R.LEVELS[1],
                        "text": f"Perangkat IoT tidak mengirim data baru selama {round(cur['age_s'])} detik; nilai sensor mungkin sudah usang."})
        recs.append("Periksa daya dan koneksi WiFi ESP32 sensor.")
    for p in R.PARAMS:
        a = sensor["assessment"]["params"][p]
        if a["level"] > 0:
            factors.append({"source": "sensor", "level": a["level"], "label": a["label"], "text": a["message"]})
            recs.append(R.advice(p, cur[p], th))
    levels = [lv_sensor]
    if lstm["available"]:
        levels.append(lstm["status"]["level"])
        for p in R.PARAMS:
            v = lstm["next_24h"][p]
            if v["level"] > 0:
                factors.append({"source": "lstm", "level": v["level"], "label": v["label"],
                                "text": "Prediksi 24 jam: " + v["message"] + (" " + v["note"] if v["note"] else "")})
                recs.append(R.advice(p, v["mean"], th, "Antisipasi (prediksi 24 jam): "))
    if cnn["available"]:
        levels.append(cnn["effective_level"])
        conf = cnn.get("confidence", 0)
        if cnn.get("uncertain"):
            factors.append({"source": "cnn", "level": cnn["effective_level"], "label": R.LEVELS[cnn["effective_level"]],
                            "text": f"Hasil visual tidak pasti (confidence {R.fmt(conf * 100)}% < {R.fmt(C.CNN_UNCERTAIN_BELOW * 100)}%)."})
            recs.append("Ambil ulang foto dengan cahaya cukup dan daun terlihat jelas agar klasifikasi lebih yakin.")
        elif cnn["status"]["level"] > 0:
            factors.append({"source": "cnn", "level": cnn["status"]["level"], "label": R.LEVELS[cnn["status"]["level"]],
                            "text": f"Citra diklasifikasikan '{cnn['label']}' ({R.fmt(conf * 100)}%)."})
            recs.append(cnn.get("advice"))
            if lv_sensor == 0 and (not lstm["available"] or lstm["status"]["level"] == 0):
                recs.append(f"Sensor lingkungan normal tetapi citra menunjukkan '{cnn['label']}': penyebab kemungkinan bukan suhu/air (mis. hama, penyakit, atau nutrisi).")
        elif lv_sensor > 0:
            recs.append("Tanaman tampak sehat pada citra, tetapi kondisi lingkungan sudah di luar batas; koreksi sebelum berdampak.")
    level = max(levels)
    seen, uniq = set(), []
    for x in recs:
        if x and x not in seen:
            seen.add(x)
            uniq.append(x)
    recs = uniq
    if level == 0 and not recs:
        recs = ["Kondisi baik. Lanjutkan pemantauan rutin."]
    missing = [n for n, ok in (("Model LSTM", lstm["available"]), ("Model CNN", cnn["available"])) if not ok]
    basis = ["sensor"] + (["prediksi LSTM"] if lstm["available"] else []) + (["citra CNN"] if cnn["available"] else [])
    summary = [f"Berdasarkan {', '.join(basis)}: tidak ada faktor yang melewati batas normal.",
               "Ada faktor yang perlu diperhatikan; lakukan tindakan pencegahan.",
               "Ada faktor berbahaya yang perlu ditangani segera."][level]
    factors.sort(key=lambda f: -f["level"])
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "thresholds": th, "sensor": sensor, "lstm": lstm, "cnn": cnn,
        "combined": {
            "level": level, "label": R.LEVELS[level], "health": HEALTH[level], "summary": summary, "factors": factors,
            "recommendations": recs, "completeness": {"sensor": True, "lstm": lstm["available"], "cnn": cnn["available"]},
            "partial": bool(missing), "partial_note": f"Hasil belum lengkap, tidak termasuk: {', '.join(missing)}." if missing else None,
            "method": f"Status keseluruhan = yang terburuk dari sensor saat ini, prediksi LSTM 24 jam, dan klasifikasi CNN. "
                      f"CNN dengan confidence < {R.fmt(C.CNN_UNCERTAIN_BELOW * 100)}% dianggap tidak pasti.",
        },
    }
