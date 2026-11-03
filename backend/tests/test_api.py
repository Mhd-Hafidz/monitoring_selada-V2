"""Uji end-to-end API terhadap mock Firebase. Jalankan: python tests/test_api.py (mock di :9000, server di :5000)."""
import json
import sys

import numpy as np
import requests

B, FB = "http://localhost:5000", "http://localhost:9000/kelompok2.json"
ctx = {"firebase_url": FB, "timezone": "Asia/Jakarta"}


def post(path, body=None, **kw):
    r = requests.post(B + path, json=body, **kw) if "files" not in kw else requests.post(B + path, **kw)
    return r.status_code, r.json()


ok = True
def check(name, cond, info=""):
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name, info)


# 1) dataset
s, ds = post("/api/lstm/dataset", None, data={"source": "firebase", "days": "14", **ctx}, files={})
check("dataset 200", s == 200, ds.get("error") or "")
W, NI = ds["window_hours"], ds["n_input"]
nTr, nVa, nTe = ds["n_train"], ds["n_val"], ds["n_test"]
X = np.array(ds["x"]).reshape(-1, W, NI)
Y = np.array(ds["y"]).reshape(-1, 3)
check("bentuk X/Y", X.shape[0] == nTr + nVa + nTe and Y.shape[0] == nTr + nVa, f"X{X.shape} Y{Y.shape} split {nTr}/{nVa}/{nTe}")
check("skala 0..1 (latih)", X[:nTr, :, :3].min() >= -1e-6 and X[:nTr, :, :3].max() <= 1 + 1e-6)
check("sin/cos dalam [-1,1]", np.abs(X[:, :, 3:]).max() <= 1.0000001)
# jendela berikutnya bergeser 1 jam: kolom Y ke-i == X[i+1, W-1, :3] bila berurutan
cons = np.isclose(Y[:-1], X[1:nTr + nVa, W - 1, :3], atol=1e-5).all(axis=1).mean()
check("Y = jam terakhir jendela berikutnya (mayoritas)", cons > 0.9, f"{cons:.3f}")
check("meta valid_hours", ds["meta"]["valid_hours"] > 300, ds["meta"])
check("h24 ada", ds["h24"] and ds["h24"]["n"] > 0, ds["h24"] and ds["h24"]["n"])

# 2) evaluate dengan "model persistensi" -> MAE persistensi harus sama dengan baseline
XTe = X[nTr + nVa:]
y_pred = XTe[:, W - 1, :3]
h = ds["h24"]; hx = np.array(h["x"]).reshape(h["n"], W, NI)
h_pred = np.repeat(hx[:, W - 1:W, :3], 24, axis=1)
s, ev = post("/api/lstm/evaluate", {"scaler": ds["scaler"], "eval": ds["eval"], "y_pred": y_pred.ravel().tolist(), "h24_pred": h_pred.ravel().tolist()})
check("evaluate 200", s == 200, ev.get("error") or "")
for p in ("suhu", "udara", "tanah"):
    check(f"MAE persistensi == baseline [{p}]", abs(ev["metrics"][p]["mae"] - ev["baseline_persistence_mae"][p]) < 1e-3, ev["metrics"][p]["mae"])
check("suhu MAE masuk akal (satuan asli)", 0 < ev["metrics"]["suhu"]["mae"] < 3, ev["metrics"]["suhu"])
check("test_series", len(ev["test_series"]["t"]) == min(nTe, 336))
check("horizon24", ev["horizon24"] and ev["horizon24"]["n_forecasts"] == h["n"])
s, e = post("/api/lstm/evaluate", {"scaler": ds["scaler"], "eval": ds["eval"], "y_pred": [0.1]})
check("y_pred salah ukuran -> 400", s == 400)

# 3) forecast-input + postprocess (model persistensi)
sc = ds["scaler"]
s, fi = post("/api/lstm/forecast-input", {**ctx, "window_hours": W, "steps": 96, "scaler": sc})
check("forecast-input 200", s == 200, fi.get("error") or "")
x0 = np.array(fi["x0"]).reshape(W, NI)
check("input terakhir ~ jam terakhir", fi["lag_hours"] == 0 and x0.shape == (W, NI), f"lag={fi['lag_hours']}")
tf_ = np.array(fi["tf_future"]).reshape(-1, 2)
check("tf_future total", tf_.shape[0] == fi["total"] == 96)
pred = np.repeat(x0[-1:, :3], fi["total"], axis=0)
s, po = post("/api/lstm/postprocess", {"scaler": sc, "pred": pred.ravel().tolist(), "lag_hours": fi["lag_hours"], "steps": fi["steps"],
                                       "last_data_hour": fi["last_data_hour"], "days": 4, "thresholds": {"tmax": 20}})
check("postprocess 200", s == 200, po.get("error") or "")
check("96 jam, 4 hari", len(po["forecast"]) == 96 and len(po["days"]) == 4)
check("t berurutan per jam", all(b["t"] - a["t"] == 3600000 for a, b in zip(po["forecast"], po["forecast"][1:])))
check("prediksi mulai jam berjalan", po["forecast"][0]["t"] == fi["last_data_hour"] + 3600000)
check("suhu > tmax=20 -> berbahaya", po["days"][0]["params"]["suhu"]["level"] == 2, po["days"][0]["params"]["suhu"]["message"])
check("ringkasan", po["forecast_summary"]["level"] == 2 and po["forecast_summary"]["notes"])

# 4) status & aggregate & latest
s, a = post("/api/status/assess", {"suhu": 35, "udara": 50, "tanah": 50})
check("assess: suhu 35 waspada, tanah 50 waspada", a["params"]["suhu"]["level"] == 1 and a["params"]["tanah"]["level"] == 1 and a["level"] == 1, a["params"]["tanah"]["message"])
s, l = post("/api/sensor/latest", ctx)
check("latest", s == 200 and l["reading"]["age_s"] > 0, l["reading"])

# 5) scan combine
lstm_in = {"available": True, "forecast": po["forecast"][:24], "actual": fi["actual"], "window_hours": W, "last_data_hour": fi["last_data_hour"], "meta": {"trained_at": "x"}}
cnn_in = {"available": True, "label": "bercak_daun", "confidence": 0.9, "uncertain": False, "status": {"level": 2}, "advice": "Pisahkan tanaman."}
s, sc_ = post("/api/scan/combine", {**ctx, "thresholds": {"tmax": 20}, "lstm": lstm_in, "cnn": cnn_in})
check("scan 200", s == 200, sc_.get("error") or "")
check("scan level 2 & sumber lengkap", sc_["combined"]["level"] == 2 and not sc_["combined"]["partial"], sc_["combined"]["summary"])
s, sc2 = post("/api/scan/combine", {**ctx, "lstm": {"available": False, "error": "model_not_trained", "message": "belum"}, "cnn": None})
check("scan parsial", sc2["combined"]["partial"] and not sc2["lstm"]["available"] and sc2["cnn"]["error"] == "no_image", sc2["combined"]["partial_note"])

# 6) klasifikasi
s, c = post("/api/evaluate/classification", {"y_true": [0, 0, 1, 1, 2], "y_pred": [0, 1, 1, 1, 2], "names": ["a", "b", "c"]})
check("klasifikasi", abs(c["accuracy"] - 0.8) < 1e-9 and c["confusion_matrix"] == [[1, 1, 0], [0, 2, 0], [0, 0, 1]])

# 7) CSV
import io
rows = ["waktu,suhu_c,kelembapan_udara,kelembapan_tanah,status"]
import datetime as dt
t0 = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)
for i in range(24 * 12):    # 12 hari x 24 jam x 12 sampel/jam
    for j in range(12):
        t = t0 + dt.timedelta(hours=i, minutes=5 * j)
        rows.append(f"{t.isoformat().replace('+00:00', 'Z')},{27 + (i % 24) / 6:.2f},65,70,normal")
s, d2 = post("/api/lstm/dataset", None, data={"source": "csv", "timezone": "Asia/Jakarta"}, files={"file": ("x.csv", "\n".join(rows))})
check("dataset CSV", s == 200 and d2["n_train"] > 100, d2.get("error") or d2["meta"])
s, d3 = post("/api/lstm/dataset", None, data={"source": "csv"}, files={"file": ("x.csv", "waktu,foo\n1,2")})
check("CSV kolom hilang -> 400", s == 400 and d3["error"]["code"] == "csv_columns", d3["error"]["message"][:60])
s, d4 = post("/api/lstm/dataset", None, data={"source": "csv"}, files={"file": ("x.csv", "\n".join(rows[:30]))})
check("data kurang -> not_enough_data", s == 422 and d4["error"]["code"] == "not_enough_data")
s, d5 = post("/api/lstm/dataset", None, data={"source": "firebase", "firebase_url": "http://localhost:1/x.json"}, files={})
check("Firebase mati -> 502", s == 502 and d5["error"]["code"] == "firebase_unreachable")

print("\nSEMUA LULUS" if ok else "\nADA YANG GAGAL")
sys.exit(0 if ok else 1)
