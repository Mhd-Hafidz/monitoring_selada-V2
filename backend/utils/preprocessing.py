"""Preprocessing data sensor untuk LSTM (port dari js/ml/prep.js, bagian data).

Alur: baris mentah (1/detik) -> rata-rata per jam -> isi celah pendek (interpolasi linear)
      -> segmen kontinu -> skala 0..1 -> jendela (24 jam -> jam berikutnya).
Jam yang datanya kurang TIDAK dikarang; celah panjang memutus data menjadi segmen terpisah.
"""
import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

import config as C

FEATURES = ["suhu", "udara", "tanah"]
NF = 3
N_INPUT = 5
HOUR = 3600000
VALID = {"suhu": (-10, 70), "udara": (0, 100), "tanah": (0, 100)}
ALPH = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"


def round_half_up(x):
    """Pembulatan seperti Math.round di JavaScript (0.5 -> naik)."""
    return int(math.floor(x + 0.5))


# ---------- push-ID Firebase ----------
def push_time(key):
    if not isinstance(key, str) or len(key) != 20:
        return 0
    t = 0
    for ch in key[:8]:
        k = ALPH.find(ch)
        if k < 0:
            return 0
        t = t * 64 + k
    return t if t > 1.4e12 else 0


def encode_push_time(ms):
    ms = int(ms)
    s = ""
    for _ in range(8):
        s = ALPH[ms % 64] + s
        ms //= 64
    return s


# ---------- baris mentah -> per jam ----------
def valid_row(r):
    if not math.isfinite(r["t"]):
        return False
    for p in FEATURES:
        v = r[p]
        if not math.isfinite(v) or v < VALID[p][0] or v > VALID[p][1]:
            return False
    return True


def hourly_from_rows(rows):
    """rows: [{t,suhu,udara,tanah}] -> [{h,suhu,udara,tanah,n}] terurut; jam kurang sampel -> NaN."""
    acc = {}
    for r in rows:
        if not valid_row(r):
            continue
        h = int(r["t"] // HOUR)
        a = acc.get(h)
        if a is None:
            a = acc[h] = [0.0, 0.0, 0.0, 0]
        a[0] += r["suhu"]
        a[1] += r["udara"]
        a[2] += r["tanah"]
        a[3] += 1
    out = []
    for h in sorted(acc):
        s, u, k, n = acc[h]
        ok = n >= C.MIN_SAMPLES_PER_HOUR
        out.append({"h": h, "suhu": s / n if ok else math.nan, "udara": u / n if ok else math.nan,
                    "tanah": k / n if ok else math.nan, "n": n})
    return out


# ---------- seri kontinu ----------
def fill_short_gaps(vals, max_gap):
    n = vals.shape[0]
    for c in range(NF):
        i = 0
        while i < n:
            if not np.isnan(vals[i, c]):
                i += 1
                continue
            j = i
            while j < n and np.isnan(vals[j, c]):
                j += 1
            length = j - i
            if i > 0 and j < n and length <= max_gap:   # hanya celah di dalam
                a, b = vals[i - 1, c], vals[j, c]
                for k in range(i, j):
                    vals[k, c] = a + (b - a) * (k - (i - 1)) / (length + 1)
            i = j


class Series:
    def __init__(self, h0, n, vals, segments):
        self.h0, self.n, self.vals, self.segments = h0, n, vals, segments


def prepare_series(hourly):
    if not hourly:
        return Series(0, 0, np.zeros((0, NF)), [])
    h0, h1 = hourly[0]["h"], hourly[-1]["h"]
    n = h1 - h0 + 1
    vals = np.full((n, NF), np.nan)
    for r in hourly:
        vals[r["h"] - h0] = [r["suhu"], r["udara"], r["tanah"]]
    fill_short_gaps(vals, C.MAX_GAP_HOURS)
    ok = ~np.isnan(vals).any(axis=1)
    seg, i = [], 0
    while i < n:
        if not ok[i]:
            i += 1
            continue
        j = i
        while j < n and ok[j]:
            j += 1
        seg.append((i, j))
        i = j
    return Series(h0, n, vals, seg)


# ---------- fitur waktu: sin/cos jam-dalam-hari (waktu lokal) ----------
def _zone(tz):
    try:
        return ZoneInfo(tz or C.DEFAULT_TZ)
    except Exception:
        return ZoneInfo(C.DEFAULT_TZ)


def hour_of_day(ms, tz):
    d = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).astimezone(_zone(tz))
    return d.hour + d.minute / 60.0


def time_features(h_start, n, tz):
    """Jam berurutan (indeks jam h_start ..) -> array (n, 2) [sin, cos]."""
    out = np.zeros((n, 2), dtype=np.float32)
    for i in range(n):
        a = 2 * math.pi * hour_of_day((h_start + i) * HOUR, tz) / 24
        out[i] = (math.sin(a), math.cos(a))
    return out


# ---------- skala 0..1 per kolom ----------
class MinMax:
    def __init__(self, lo, hi):
        self.lo = np.asarray(lo, dtype=float)
        self.hi = np.asarray(hi, dtype=float)

    @classmethod
    def fit(cls, vals, up_to_row):
        sub = vals[:up_to_row]
        lo, hi = np.full(NF, np.inf), np.full(NF, -np.inf)
        for c in range(NF):
            col = sub[:, c]
            col = col[~np.isnan(col)]
            if col.size:
                lo[c], hi[c] = col.min(), col.max()
        for k in range(NF):
            if hi[k] - lo[k] < 1e-9:
                hi[k] = lo[k] + 1
        return cls(lo, hi)

    def transform(self, vals):
        return (np.asarray(vals, dtype=float) - self.lo) / (self.hi - self.lo)

    def inverse(self, scaled):
        return np.asarray(scaled, dtype=float) * (self.hi - self.lo) + self.lo

    def to_json(self):
        return {"lo": self.lo.tolist(), "hi": self.hi.tolist()}

    @classmethod
    def from_json(cls, d):
        try:
            lo, hi = d["lo"], d["hi"]
            if len(lo) != NF or len(hi) != NF:
                raise ValueError
            return cls(lo, hi)
        except Exception:
            raise C.MLError("bad_scaler", "Skala (scaler) model tidak valid. Latih ulang model.", status=400)


# ---------- jendela ----------
def target_positions(segments, w):
    out = []
    for a, b in segments:
        if b - a > w:
            out.extend(range(a + w, b))
    return out


def make_windows(scaled, tfeat, segments, w):
    """scaled (n,3), tfeat (n,2) -> X (N,W,5) float32, Y (N,3) float32, pos list."""
    pos = target_positions(segments, w)
    N = len(pos)
    X = np.zeros((N, w, N_INPUT), dtype=np.float32)
    Y = np.zeros((N, NF), dtype=np.float32)
    for i, p in enumerate(pos):
        X[i, :, :3] = scaled[p - w:p]
        X[i, :, 3:] = tfeat[p - w:p]
        Y[i] = scaled[p]
    return X, Y, pos


def split_by_time(n, test_frac, val_frac, min_test=24):
    """Pembagian kronologis (latih, validasi, uji); tidak diacak agar uji tidak bocor."""
    nt = max(min_test, round_half_up(n * test_frac))
    nt = min(nt, max(1, n // 3))
    rest = n - nt
    nv = max(1, round_half_up(rest * val_frac))
    return {"nTrain": rest - nv, "nVal": nv, "nTest": nt}


def clip_row(row):
    return [min(VALID[FEATURES[c]][1], max(VALID[FEATURES[c]][0], float(v))) for c, v in enumerate(row)]
