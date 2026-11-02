"""Server pengolahan data Smart Monitoring Selada Keriting (Flask).
Menjalankan: python app.py  ->  http://localhost:5000  (juga melayani antarmuka web dari folder induk)."""
import math
import os
import time
from datetime import datetime, timezone

from flask import Flask, jsonify, request, send_from_directory

import config as C
from config import MLError
from services import data_service as DS
from services import forecast_service as FS
from services import lstm_service as LS
from services import scan_service as SS
from utils import evaluation as EV
from utils import status as R

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
app = Flask(__name__, static_folder=None)


def clean(o):
    """NaN/Infinity tidak valid di JSON -> null; tipe numpy -> tipe Python."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if hasattr(o, "item") and not isinstance(o, (str, bytes)):
        o = o.item()
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return o


def ok(payload, status=200):
    return jsonify(clean(payload)), status


@app.after_request
def cors(resp):   # halaman bisa dibuka dari file:// atau server statis lain
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.route("/api/<path:_>", methods=["OPTIONS"])
def preflight(_):
    return "", 204


@app.errorhandler(MLError)
def on_ml_error(e):
    return ok(e.to_dict(), e.status)


@app.errorhandler(Exception)
def on_error(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return ok({"error": {"code": "http_" + str(e.code), "message": e.description, "data": {}}}, e.code)
    app.logger.exception("galat tak terduga")
    return ok({"error": {"code": "server_error", "message": f"Galat di server Python: {e}", "data": {}}}, 500)


def body():
    return request.get_json(silent=True) or {}


def firebase_of(b):
    return (b.get("firebase_url") or C.DEFAULT_FIREBASE_URL).strip()


# ---------- API ----------
@app.get("/api/health")
def health():
    import numpy
    return ok({"status": "ok", "time": datetime.now(timezone.utc).isoformat(), "numpy": numpy.__version__,
               "default_firebase": C.DEFAULT_FIREBASE_URL, "config": {"window_hours": C.WINDOW_HOURS, "horizon_hours": C.HORIZON_HOURS}})


@app.post("/api/sensor/latest")
def sensor_latest():
    b = body()
    r = DS.latest_reading(firebase_of(b))
    if not r:
        raise MLError("no_data", "Belum ada data sensor di Firebase.", status=404)
    th = R.normalize(b.get("thresholds"))
    return ok({"reading": {**r, "online": r["age_s"] <= C.OFFLINE_AFTER_SECONDS}, "assessment": R.assess_reading(r["suhu"], r["udara"], r["tanah"], th)})


@app.post("/api/status/assess")
def status_assess():
    b = body()
    try:
        s, u, t = float(b["suhu"]), float(b["udara"]), float(b["tanah"])
    except (KeyError, TypeError, ValueError):
        raise MLError("bad_request", "Isi suhu, udara, dan tanah dengan angka.", status=400)
    return ok(R.assess_reading(s, u, t, b.get("thresholds")))


@app.post("/api/lstm/dataset")
def lstm_dataset():
    """Siapkan data latih. Form (multipart) atau JSON: source=firebase|csv, days, firebase_url, timezone, file (csv)."""
    f = request.form if request.form else body()
    tz = f.get("timezone") or C.DEFAULT_TZ
    source = f.get("source") or "firebase"
    if source == "csv":
        up = request.files.get("file")
        if up is None:
            raise MLError("csv_missing", "Pilih berkas CSV terlebih dahulu.", status=400)
        hourly = DS.csv_hourly(up.read(), tz)
    else:
        try:
            days = max(3, min(60, int(float(f.get("days") or C.DEFAULT_DAYS))))
        except ValueError:
            days = C.DEFAULT_DAYS
        hourly = DS.firebase_hourly((f.get("firebase_url") or C.DEFAULT_FIREBASE_URL).strip(), days)
    return ok(LS.build_dataset(hourly, tz, "csv" if source == "csv" else "firebase"))


@app.post("/api/lstm/evaluate")
def lstm_evaluate():
    return ok(LS.evaluate(body()))


@app.post("/api/lstm/forecast-input")
def lstm_forecast_input():
    b = body()
    b["firebase_url"] = firebase_of(b)
    return ok(LS.forecast_input(b))


@app.post("/api/lstm/postprocess")
def lstm_postprocess():
    """Prediksi terskala -> satuan asli. Opsional: thresholds + days -> agregasi harian dan ringkasan."""
    b = body()
    rows = LS.postprocess(b)
    out = {"forecast": FS.rows_for_json(rows), "summary": FS.stats_of(rows)}
    if b.get("days"):
        th = R.normalize(b.get("thresholds"))
        days = FS.aggregate_days(rows, th, int(b["days"]))
        out.update({"thresholds": th, "days": days, "forecast_summary": FS.summarize(days)})
    return ok(out)


@app.post("/api/forecast/aggregate")
def forecast_aggregate():
    b = body()
    th = R.normalize(b.get("thresholds"))
    rows = [{"t": r["t"], "suhu": float(r["suhu"]), "udara": float(r["udara"]), "tanah": float(r["tanah"])} for r in b.get("forecast", [])]
    days = FS.aggregate_days(rows, th, int(b.get("days") or C.HORIZON_DAYS))
    return ok({"thresholds": th, "days": days, "summary": FS.summarize(days)})


@app.post("/api/scan/combine")
def scan_combine():
    b = body()
    return ok(SS.combine(firebase_of(b), b.get("thresholds"), b.get("lstm"), b.get("cnn")))


@app.post("/api/evaluate/classification")
def evaluate_classification():
    b = body()
    names = b.get("names") or []
    yt, yp = b.get("y_true") or [], b.get("y_pred") or []
    if len(yt) != len(yp) or not names:
        raise MLError("bad_request", "y_true, y_pred, dan names harus ada dan sama panjang.", status=400)
    return ok(EV.classification(yt, yp, names))


@app.post("/api/cache/reset")
def cache_reset():
    return ok({"removed": DS.reset_cache()})


# ---------- antarmuka web (opsional; folder induk) ----------
@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:path>")
def static_files(path):
    if path.startswith(("api/", "backend/")) or path.startswith("."):
        return ok({"error": {"code": "not_found", "message": "Tidak ditemukan.", "data": {}}}, 404)
    return send_from_directory(ROOT, path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"Server pengolahan data siap di http://localhost:{port}  (Firebase: {C.DEFAULT_FIREBASE_URL})")
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, threaded=True)
