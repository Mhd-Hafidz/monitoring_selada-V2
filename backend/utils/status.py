"""Penilaian kondisi tanaman (normal / waspada / berbahaya) lengkap dengan pesan dan saran.
Aturan tingkat sama dengan js/lib/status.js (dashboard).

  tanah : normal dry..wet (acuan 65–78%, target 70–76%; ≤ dry kering/pompa ON, ≥ wet basah) | waspada dry-15..dry atau wet..wet+10 | berbahaya di luar itu
  suhu  : normal tmin..tmax | waspada sampai 3 °C di luar batas | berbahaya lebih jauh
  udara : normal hmin..80 (acuan 60–80%) | waspada hmin-15..hmin atau 80..85 | berbahaya di luar itu
"""
import math

DEFAULTS = {"dry": 65, "wet": 78, "tmax": 32, "tmin": 15, "hmin": 60}
M = {"soilLow": 15, "soilHigh": 10, "temp": 3, "humLow": 15, "humMax": 80, "humHigh": 5}
LEVELS = ["normal", "waspada", "berbahaya"]
PARAMS = ["suhu", "udara", "tanah"]
LABEL = {"suhu": "Suhu udara", "udara": "Kelembapan udara", "tanah": "Kelembapan tanah"}
UNIT = {"suhu": "°C", "udara": "%", "tanah": "%"}


def fmt(v, d=0):
    """toFixed ala JavaScript (setengah dibulatkan ke atas)."""
    f = 10 ** d
    return f"{math.floor(v * f + 0.5) / f:.{d}f}"


def normalize(raw):
    th = dict(DEFAULTS)
    for key, val in (raw or {}).items():
        if key not in th:
            continue
        try:
            f = float(val)
        except (TypeError, ValueError):
            continue
        if math.isfinite(f):
            th[key] = f
    if not th["dry"] < th["wet"]:
        th["dry"], th["wet"] = DEFAULTS["dry"], DEFAULTS["wet"]
    if not th["tmin"] < th["tmax"]:
        th["tmin"], th["tmax"] = DEFAULTS["tmin"], DEFAULTS["tmax"]
    return th


def level_of(p, v, th):
    if p == "tanah":
        if v < th["dry"] - M["soilLow"] or v > th["wet"] + M["soilHigh"]:
            return 2
        return 1 if (v <= th["dry"] or v >= th["wet"]) else 0
    if p == "suhu":
        if v < th["tmin"] - M["temp"] or v > th["tmax"] + M["temp"]:
            return 2
        return 1 if (v < th["tmin"] or v > th["tmax"]) else 0
    if p == "udara":
        if v < th["hmin"] - M["humLow"] or v > M["humMax"] + M["humHigh"]:
            return 2
        return 1 if (v < th["hmin"] or v > M["humMax"]) else 0
    raise ValueError("parameter tidak dikenal: " + str(p))


def message_of(p, v, level, th):
    val = fmt(v, 1) + UNIT[p] if p == "suhu" else fmt(v, 0) + UNIT[p]
    if level == 0:
        return f"{LABEL[p]} {val}, dalam rentang normal."
    if p == "tanah":
        side = f"di bawah batas kering {fmt(th['dry'])}%" if v <= th["dry"] else f"di atas batas basah {fmt(th['wet'])}%"
    elif p == "suhu":
        side = f"di bawah batas {fmt(th['tmin'])} °C" if v < th["tmin"] else f"di atas batas {fmt(th['tmax'])} °C"
    else:
        side = f"di bawah batas {fmt(th['hmin'])}%" if v < th["hmin"] else f"di atas {fmt(M['humMax'])}%"
    return f"{LABEL[p]} {val}, {side}."


def assess_value(p, v, th):
    lv = level_of(p, v, th)
    return {"value": round(v, 2), "level": lv, "label": LEVELS[lv], "message": message_of(p, v, lv, th)}


def assess_reading(suhu, udara, tanah, th):
    th = normalize(th)
    vals = {"suhu": suhu, "udara": udara, "tanah": tanah}
    per, lv = {}, 0
    for p in PARAMS:
        per[p] = assess_value(p, vals[p], th)
        lv = max(lv, per[p]["level"])
    return {"level": lv, "label": LEVELS[lv], "params": per}


def advice(p, v, th, prefix=""):
    """Saran tindakan; None bila parameter masih normal."""
    if level_of(p, v, th) == 0:
        return None
    if p == "tanah":
        if v <= th["dry"]:
            return f"{prefix}Lakukan penyiraman dan periksa pompa/selang; kelembapan tanah {fmt(v)}% di bawah batas kering {fmt(th['dry'])}%."
        return f"{prefix}Kurangi atau hentikan penyiraman dan pastikan drainase; kelembapan tanah {fmt(v)}% di atas batas basah {fmt(th['wet'])}%."
    if p == "suhu":
        if v > th["tmax"]:
            return f"{prefix}Beri naungan atau tingkatkan ventilasi; suhu {fmt(v, 1)} °C di atas batas {fmt(th['tmax'])} °C."
        return f"{prefix}Lindungi tanaman dari suhu rendah; suhu {fmt(v, 1)} °C di bawah batas {fmt(th['tmin'])} °C."
    if v < th["hmin"]:
        return f"{prefix}Naikkan kelembapan udara (mis. kabut halus atau mulsa); kelembapan udara {fmt(v)}% di bawah batas {fmt(th['hmin'])}%."
    return f"{prefix}Tingkatkan sirkulasi udara untuk mencegah jamur; kelembapan udara {fmt(v)}% terlalu tinggi."
