"""Metrik evaluasi (port dari js/ml/prep.js: regression, perParam, overall, classification)."""
import math

import numpy as np

from utils.preprocessing import FEATURES


def _fin(x):
    x = float(x)
    return x if math.isfinite(x) else None


def regression(yt, yp):
    yt, yp = np.asarray(yt, dtype=float), np.asarray(yp, dtype=float)
    n = yt.size
    if not n:
        return {"mae": None, "mse": None, "rmse": None, "r2": None, "n": 0}
    d = yt - yp
    mse = float(np.mean(d * d))
    sst = float(np.sum((yt - yt.mean()) ** 2))
    r2 = _fin(1 - float(np.sum(d * d)) / sst) if (yt.max() - yt.min()) > 1e-9 and sst > 0 else None
    return {"mae": _fin(np.mean(np.abs(d))), "mse": _fin(mse), "rmse": _fin(math.sqrt(mse)), "r2": r2, "n": int(n)}


def per_param(yt, yp):
    yt, yp = np.asarray(yt, dtype=float), np.asarray(yp, dtype=float)
    return {p: regression(yt[:, c], yp[:, c]) for c, p in enumerate(FEATURES)}


def overall(per):
    r2 = [per[p]["r2"] for p in FEATURES if per[p]["r2"] is not None]
    return {"r2_mean": sum(r2) / len(r2) if r2 else None}


def classification(yt, yp, names):
    """Precision/recall/F1 per kelas + confusion matrix."""
    k = len(names)
    cm = [[0] * k for _ in range(k)]
    ok = 0
    for a, b in zip(yt, yp):
        cm[int(a)][int(b)] += 1
        ok += int(a) == int(b)
    per = {}
    for a, c in enumerate(names):
        tp = cm[a][a]
        fp = sum(cm[b][a] for b in range(k) if b != a)
        fn = sum(cm[a][b] for b in range(k) if b != a)
        sup = sum(cm[a])
        p = tp / (tp + fp) if tp + fp else 0
        r = tp / (tp + fn) if tp + fn else 0
        per[c] = {"precision": p, "recall": r, "f1": 2 * p * r / (p + r) if p + r else 0, "support": sup}
    return {"accuracy": ok / len(yt) if len(yt) else None, "n": len(yt), "per_class": per,
            "confusion_matrix": cm, "classes": list(names)}
