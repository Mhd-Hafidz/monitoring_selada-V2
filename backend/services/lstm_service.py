"""Pengolahan data untuk model LSTM. Pelatihan dan inferensi model tetap berjalan di browser (TensorFlow.js);
bagian ini menyiapkan data latih (jendela + skala + split), mengevaluasi hasil, menyiapkan input prediksi,
dan mengembalikan hasil prediksi ke satuan asli. Port dari js/ml/lstm.js dan js/ml/prep.js."""
import time

import numpy as np

import config as C
from config import MLError
from services import data_service as DS
from services import forecast_service as FS
from utils import evaluation as EV
from utils import preprocessing as PP

F = PP.FEATURES
HOUR = PP.HOUR


def requirements(w=None):
    w = w or C.WINDOW_HOURS
    need = C.MIN_WINDOWS_REQUIRED + w
    return {"window_hours": w, "min_windows": C.MIN_WINDOWS_REQUIRED, "min_contiguous_hours": need, "recommended_days": 14,
            "text": f"Training butuh minimal {C.MIN_WINDOWS_REQUIRED} jendela ({need} jam ≈ {PP.round_half_up(need / 24)} hari data sensor "
                    f"yang berurutan, rata-rata per jam). Disarankan 14 hari atau lebih agar pola harian terlihat."}


def _flat(a, nd=6):
    return np.round(np.asarray(a, dtype=np.float64), nd).ravel().tolist()


def build_dataset(hourly, tz, source):
    w = C.WINDOW_HOURS
    series = PP.prepare_series(hourly)
    seg = series.segments
    pos = PP.target_positions(seg, w)
    n_win = len(pos)
    if n_win < C.MIN_WINDOWS_REQUIRED:
        valid_h = sum(b - a for a, b in seg)
        rq = requirements(w)
        raise MLError("not_enough_data",
                      f"Data belum cukup untuk training: {n_win} jendela (butuh minimal {C.MIN_WINDOWS_REQUIRED}); ada {valid_h} jam data valid. {rq['text']}",
                      {"have_windows": n_win, "min_windows": C.MIN_WINDOWS_REQUIRED, "requirements": rq})
    sp = PP.split_by_time(n_win, C.TEST_FRACTION, C.VAL_FRACTION)
    n_tr, n_va, n_te = sp["nTrain"], sp["nVal"], sp["nTest"]
    first_test_pos = pos[n_tr + n_va]
    scaler = PP.MinMax.fit(series.vals, first_test_pos)       # hanya data sebelum periode uji
    scaled = scaler.transform(series.vals)
    tfeat = PP.time_features(series.h0, series.n, tz)
    X, Y, pos = PP.make_windows(scaled, tfeat, seg, w)
    X_te, Y_te, pos_te = X[n_tr + n_va:], Y[n_tr + n_va:], pos[n_tr + n_va:]

    # Evaluasi 24 jam ke depan (rekursif) pada periode uji, awal prediksi tiap 6 jam.
    starts = [s for s in range(0, n_te - 24 + 1, 6) if pos_te[s + 23] - pos_te[s] == 23]
    h24 = None
    if starts:
        xb = np.stack([X_te[s] for s in starts])
        tfb = np.stack([tfeat[pos_te[s]:pos_te[s] + 24] for s in starts])
        yb = np.stack([Y_te[s:s + 24] for s in starts])
        h24 = {"starts": starts, "x": xb, "tf_future": tfb, "y_true": yb}

    keep = min(n_te, 336)
    ev = {"y_true": _flat(Y_te), "baseline": _flat(X_te[:, w - 1, :3]),
          "t": [(series.h0 + pos_te[q]) * HOUR for q in range(n_te - keep, n_te)],
          "h24_true": _flat(h24["y_true"]) if h24 else []}

    meta = {
        "n_train": n_tr, "n_val": n_va, "n_test": n_te, "window_hours": w, "timezone": tz, "source": source,
        "data_from": PP_iso(series.h0 * HOUR), "data_to": PP_iso((series.h0 + series.n - 1) * HOUR),
        "valid_hours": sum(b - a for a, b in seg),
    }
    return {
        "meta": meta, "eval": ev, "window_hours": w, "n_input": PP.N_INPUT, "scaler": scaler.to_json(),
        "n_train": n_tr, "n_val": n_va, "n_test": n_te,
        "x": _flat(X), "y": _flat(Y[:n_tr + n_va]),
        "h24": None if not h24 else {"n": len(starts), "steps": 24, "x": _flat(h24["x"]), "tf_future": _flat(h24["tf_future"])},
    }


def PP_iso(ms):
    return FS._iso(ms)


def evaluate(body):
    """Tanpa status (aman untuk serverless): body = {scaler, eval (dari /dataset), y_pred, h24_pred}; semuanya terskala."""
    scaler = PP.MinMax.from_json(body.get("scaler") or {})
    ev = body.get("eval") or {}
    y_true_s = np.asarray(ev.get("y_true", []), dtype=float).reshape(-1, 3)
    n_t = y_true_s.shape[0]
    y_pred = np.asarray(body.get("y_pred", []), dtype=float)
    if n_t == 0 or y_pred.size != n_t * 3:
        raise MLError("bad_request", f"y_pred harus berisi {n_t * 3} angka, diterima {y_pred.size}.", status=400)
    y_true = scaler.inverse(y_true_s)
    y_hat = scaler.inverse(y_pred.reshape(n_t, 3))
    per = EV.per_param(y_true, y_hat)
    base_rows = scaler.inverse(np.asarray(ev.get("baseline", []), dtype=float).reshape(-1, 3))   # persistensi: sama dengan jam sebelumnya
    if base_rows.shape[0] != n_t:
        raise MLError("bad_request", "baseline tidak sesuai jumlah data uji.", status=400)
    base_mae = {p: EV.regression(y_true[:, c], base_rows[:, c])["mae"] for c, p in enumerate(F)}

    horizon24 = None
    h24_true = np.asarray(ev.get("h24_true", []), dtype=float)
    if h24_true.size:
        hp = np.asarray(body.get("h24_pred", []), dtype=float)
        if hp.size != h24_true.size:
            raise MLError("bad_request", f"h24_pred harus berisi {h24_true.size} angka, diterima {hp.size}.", status=400)
        tr = scaler.inverse(h24_true.reshape(-1, 3))
        fc = scaler.inverse(hp.reshape(-1, 3))
        horizon24 = {"n_forecasts": h24_true.size // 72, **EV.per_param(tr, fc)}

    keep = len(ev.get("t", []))
    t0 = n_t - keep
    ts = {"t": list(ev.get("t", [])),
          "actual": {p: [round(float(y_true[q, c]), 3) for q in range(t0, n_t)] for c, p in enumerate(F)},
          "pred": {p: [round(float(y_hat[q, c]), 3) for q in range(t0, n_t)] for c, p in enumerate(F)}}
    return {"metrics": per, "overall": EV.overall(per), "baseline_persistence_mae": base_mae, "horizon24": horizon24, "test_series": ts}


def forecast_input(body):
    """Siapkan input prediksi rekursif dari data sensor terbaru. Butuh scaler model."""
    base = body.get("firebase_url") or C.DEFAULT_FIREBASE_URL
    tz = body.get("timezone") or C.DEFAULT_TZ
    wm = int(body.get("window_hours") or C.WINDOW_HOURS)
    steps = max(1, min(PP.round_half_up(float(body.get("steps") or 24)), C.HORIZON_HOURS))
    scaler = PP.MinMax.from_json(body.get("scaler") or {})
    now = float(body.get("now") or time.time() * 1000)

    hourly = DS.recent_hourly(base, wm + C.MAX_STALE_HOURS + 6)
    series = PP.prepare_series(hourly)
    if not series.segments:
        raise MLError("no_recent_data", "Belum ada data per jam yang lengkap di Firebase.", status=404)
    a, b = series.segments[-1]
    cur = int(now // HOUR)
    last_hour = series.h0 + b - 1
    lag = cur - last_hour - 1
    if lag > C.MAX_STALE_HOURS:
        when = FS._iso(last_hour * HOUR)
        raise MLError("stale_data", f"Data sensor terakhir yang lengkap pukul {when} ({lag} jam lalu). Prediksi butuh data terbaru "
                      f"(maks {C.MAX_STALE_HOURS} jam). Cek perangkat IoT.", {"last_data_hour": when, "lag_hours": lag}, status=409)
    if b - a < wm:
        raise MLError("not_enough_recent", f"Model butuh {wm} jam data berurutan terakhir, baru ada {b - a} jam tanpa celah panjang.",
                      {"have_hours": b - a, "need_hours": wm}, status=409)
    sc = scaler.transform(series.vals[b - wm:b])
    tw = PP.time_features(series.h0 + b - wm, wm, tz)
    x0 = np.concatenate([sc, tw], axis=1)
    total = lag + steps
    tfut = PP.time_features(last_hour + 1, total, tz)
    actual = [{"t": (series.h0 + j) * HOUR, "suhu": series.vals[j, 0], "udara": series.vals[j, 1], "tanah": series.vals[j, 2]}
              for j in range(max(a, b - 48), b)]
    return {"x0": _flat(x0), "tf_future": _flat(tfut), "window_hours": wm, "steps": steps, "total": total, "lag_hours": lag,
            "last_data_hour": last_hour * HOUR, "actual": FS.rows_for_json(actual)}


def postprocess(body):
    """Hasil prediksi terskala -> satuan asli (dipotong ke rentang valid), mulai dari jam yang sedang berjalan."""
    scaler = PP.MinMax.from_json(body.get("scaler") or {})
    lag, steps, last_hour = int(body["lag_hours"]), int(body["steps"]), int(body["last_data_hour"])
    total = lag + steps
    pred = np.asarray(body.get("pred", []), dtype=float)
    if pred.size != total * 3:
        raise MLError("bad_request", f"pred harus berisi {total * 3} angka, diterima {pred.size}.", status=400)
    inv = scaler.inverse(pred.reshape(total, 3))
    rows = []
    for k in range(lag, total):
        c = PP.clip_row(inv[k])
        rows.append({"t": last_hour + (1 + k) * HOUR, "suhu": c[0], "udara": c[1], "tanah": c[2]})
    return rows
