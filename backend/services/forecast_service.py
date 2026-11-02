"""Prediksi 4 hari ke depan (port dari js/ml/forecast.js).
"Hari ke-k" = blok 24 jam ke-k mulai dari jam yang sedang berjalan; nilai harian = rata-rata jam prediksi.
Status harian memakai aturan yang sama dengan dashboard (utils/status.py)."""
from datetime import datetime, timezone

import config as C
from utils import status as R


def _iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def rows_for_json(rows):
    return [{"t": int(r["t"]), "iso": _iso(r["t"]), "suhu": round(r["suhu"], 2), "udara": round(r["udara"], 2),
             "tanah": round(r["tanah"], 2)} for r in rows]


def stats_of(rows):
    out = {}
    for p in R.PARAMS:
        v = [r[p] for r in rows]
        out[p] = {"mean": round(sum(v) / len(v), 2), "min": round(min(v), 2), "max": round(max(v), 2)}
    return out


def aggregate_days(pred, th, days=None):
    days = C.HORIZON_DAYS if days is None else days
    out = []
    for k in range(days):
        block = pred[k * 24:(k + 1) * 24]
        if len(block) < 24:
            break
        params, worst = {}, 0
        for p in R.PARAMS:
            col = [r[p] for r in block]
            m = sum(col) / len(col)
            a = R.assess_value(p, m, th)
            level = a["level"]
            hours_out = sum(1 for v in col if R.level_of(p, v, th) > 0)
            note = None
            if level == 0 and hours_out:
                level = 1
                note = f"Rata-rata normal, tetapi {hours_out} jam diprediksi melewati batas."
            params[p] = {"mean": round(m, 2), "min": round(min(col), 2), "max": round(max(col), 2), "level": level,
                         "label": R.LEVELS[level], "message": a["message"], "note": note, "hours_outside": hours_out}
            worst = max(worst, level)
        out.append({"day": k + 1, "start": _iso(block[0]["t"]), "end": _iso(block[23]["t"]), "level": worst,
                    "label": R.LEVELS[worst], "params": params})
    return out


def summarize(days):
    worst = max([d["level"] for d in days] or [0])
    notes = []
    for d in days:
        for p in R.PARAMS:
            v = d["params"][p]
            if v["level"] > 0:
                notes.append(f"Hari ke-{d['day']}: {v['message']}" + (f" {v['note']}" if v["note"] else ""))
    text = ("Seluruh parameter diprediksi tetap dalam rentang normal selama 4 hari." if worst == 0 else
            "Ada parameter yang diprediksi keluar dari rentang normal. Siapkan tindakan pencegahan." if worst == 1 else
            "Ada parameter yang diprediksi berada pada kondisi berbahaya. Perlu tindakan segera.")
    return {"level": worst, "label": R.LEVELS[worst], "text": text, "notes": notes}
