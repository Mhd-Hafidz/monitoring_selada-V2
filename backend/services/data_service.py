"""Akses data sensor: Firebase Realtime Database (REST) atau berkas CSV.
Port dari js/ml/data.js. Data mentah (1/detik) diringkas menjadi rata-rata per jam dan disimpan
di cache berkas (backend/cache); pembaruan berikutnya hanya mengunduh jam yang belum ada.
"""
import csv
import hashlib
import io
import json
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests

import config as C
from config import MLError
from utils import preprocessing as PP

HOUR = PP.HOUR
_lock = threading.Lock()   # satu unduhan pada satu waktu (cache dipakai bersama)


def _num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return math.nan
    return v


def parse_firebase(payload, fallback_now=False):
    if not isinstance(payload, dict):
        return []
    items = [("", payload)] if "suhu" in payload else sorted(payload.items())
    out, now = [], time.time() * 1000
    for key, o in items:
        if not isinstance(o, dict):
            continue
        t = PP.push_time(key) or (now if (fallback_now or not key) else 0)
        suhu, udara, tanah = _num(o.get("suhu")), _num(o.get("kelembapan_udara")), _num(o.get("kelembapan_tanah"))
        if t and all(math.isfinite(v) for v in (suhu, udara, tanah)):
            out.append({"t": t, "suhu": suhu, "udara": udara, "tanah": tanah})
    return out


def _get_json(base, params, timeout=None):
    if not base:
        raise MLError("firebase_unreachable", "Alamat Firebase belum diatur di Pengaturan.", status=502)
    try:
        res = requests.get(base, params=params, timeout=timeout or C.FIREBASE_TIMEOUT, headers={"Cache-Control": "no-store"})
        res.raise_for_status()
        return res.json()
    except requests.Timeout:
        raise MLError("firebase_unreachable", "Server tidak bisa membaca Firebase: waktu habis.", status=502)
    except Exception as e:  # noqa: BLE001
        raise MLError("firebase_unreachable", f"Server tidak bisa membaca Firebase: {e}.", status=502)


def fetch_rows(base, start_ms=None, end_ms=None, limit_last=None, limit_first=None, fallback_now=False, timeout=None):
    """Baris berurutan waktu. Rentang memakai batas key push-ID ($key), disaring di server Firebase."""
    p = {"orderBy": '"$key"'}
    if start_ms is not None:
        p["startAt"] = json.dumps(PP.encode_push_time(start_ms))
    if end_ms is not None:
        p["endAt"] = json.dumps(PP.encode_push_time(end_ms) + "~")
    if limit_last:
        p["limitToLast"] = limit_last
    if limit_first:
        p["limitToFirst"] = limit_first
    rows = parse_firebase(_get_json(base, p, timeout), fallback_now)
    rows.sort(key=lambda r: r["t"])
    return [r for r in rows if (start_ms is None or r["t"] >= start_ms) and (end_ms is None or r["t"] <= end_ms)]


def latest_reading(base):
    rows = fetch_rows(base, limit_last=1, fallback_now=True, timeout=12)
    if not rows:
        return None
    r = rows[-1]
    return {"t": r["t"], "suhu": r["suhu"], "udara": r["udara"], "tanah": r["tanah"],
            "age_s": max(0.0, (time.time() * 1000 - r["t"]) / 1000)}


def first_time(base):
    rows = fetch_rows(base, limit_first=1, timeout=12)
    return rows[0]["t"] if rows else None


# ---------- cache per jam (berkas JSON per alamat Firebase) ----------
def _cache_path(base):
    return os.path.join(C.CACHE_DIR, "hourly-" + hashlib.sha1(base.encode()).hexdigest()[:12] + ".json")


def _nan(v):
    return math.nan if v is None else v


def read_cache(base):
    try:
        with open(_cache_path(base), encoding="utf-8") as f:
            o = json.load(f)
        o["rows"] = [{"h": r[0], "suhu": _nan(r[1]), "udara": _nan(r[2]), "tanah": _nan(r[3]), "n": r[4]} for r in o["rows"]]
        return o
    except Exception:  # noqa: BLE001
        return None


def write_cache(base, o):
    def n(v):
        return None if math.isnan(v) else round(v, 3)
    rows = [[r["h"], n(r["suhu"]), n(r["udara"]), n(r["tanah"]), r["n"]] for r in o["rows"]]
    try:
        os.makedirs(C.CACHE_DIR, exist_ok=True)
        tmp = _cache_path(base) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"url": base, "firstH": o["firstH"], "from": o["from"], "until": o["until"], "rows": rows}, f)
        os.replace(tmp, _cache_path(base))
    except OSError:
        pass   # tidak fatal: data diunduh ulang bila perlu


def reset_cache():
    n = 0
    if os.path.isdir(C.CACHE_DIR):
        for name in os.listdir(C.CACHE_DIR):
            if name.startswith("hourly-"):
                try:
                    os.remove(os.path.join(C.CACHE_DIR, name))
                    n += 1
                except OSError:
                    pass
    return n


def fetch_hours(base, a, b):
    """Unduh jam [a, b) per potongan beberapa jam secara paralel, langsung diringkas per jam."""
    spans = [(s, min(s + C.FETCH_CHUNK_HOURS, b)) for s in range(a, b, C.FETCH_CHUNK_HOURS)]

    def one(span):
        s, e = span
        rows = fetch_rows(base, s * HOUR, e * HOUR - 1)
        return [r for r in PP.hourly_from_rows(rows) if s <= r["h"] < e]

    with ThreadPoolExecutor(max_workers=C.FETCH_CONCURRENCY) as ex:
        parts = list(ex.map(one, spans))
    return [r for part in parts for r in part]


def firebase_hourly(base, days):
    """Rata-rata per jam dari `days` hari terakhir (jam yang sedang berjalan tidak ikut)."""
    with _lock:
        cur = int(time.time() * 1000 // HOUR)
        cache = read_cache(base)
        first_h = cache.get("firstH") if cache else None
        if first_h is None:
            ft = first_time(base)
            if ft is None:
                raise MLError("no_data", "Belum ada data sensor di Firebase.", status=404)
            first_h = int(ft // HOUR)
        need_from = max(cur - days * 24, first_h)
        ranges = []
        if not cache or not cache["rows"]:
            ranges.append((need_from, cur))
            frm, until, rows = need_from, cur, []
        else:
            frm, until, rows = cache["from"], cache["until"], cache["rows"]
            if need_from < frm:
                ranges.append((need_from, frm))
                frm = need_from
            if until < cur:
                ranges.append((until, cur))
                until = cur
        for a, b in ranges:
            rows = rows + fetch_hours(base, a, b)
        if ranges:
            dedup = {}
            for r in rows:       # nilai terbaru menimpa yang lama
                dedup[r["h"]] = r
            rows = [dedup[h] for h in sorted(dedup)]
            write_cache(base, {"firstH": first_h, "from": frm, "until": until, "rows": rows})
        return [r for r in rows if r["h"] >= need_from]


def recent_hourly(base, hours):
    return firebase_hourly(base, max(2, math.ceil(hours / 24) + 1))


# ---------- CSV (format ekspor halaman Eksplorasi Data) ----------
ALIAS = {
    "t": ["waktu", "time", "timestamp", "t", "datetime"],
    "suhu": ["suhu_c", "suhu", "temperature", "temp"],
    "udara": ["kelembapan_udara", "udara", "humidity"],
    "tanah": ["kelembapan_tanah", "tanah", "soil", "soil_moisture"],
}


def _parse_time(tv, tz=None):
    tv = tv.strip()
    if re.fullmatch(r"\d+(\.\d+)?", tv):
        t = float(tv)
    else:
        try:
            d = datetime.fromisoformat(tv.replace("Z", "+00:00").replace(" ", "T"))
        except ValueError:
            return math.nan
        if d.tzinfo is None:       # tanpa zona -> waktu lokal sesuai zona waktu pengaturan
            d = d.replace(tzinfo=PP._zone(tz))
        t = d.timestamp() * 1000
    if math.isfinite(t) and t < 1e12:
        t *= 1000
    return t


def parse_csv(text, tz=None):
    text = text.lstrip("﻿")
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < 2:
        raise MLError("csv_empty", "Berkas CSV kosong atau hanya berisi judul kolom.", status=400)
    delim = ";" if lines[0].count(";") > lines[0].count(",") else ","
    head = [c.strip().strip('"').lower() for c in next(csv.reader([lines[0]], delimiter=delim))]
    idx = {}
    for k, names in ALIAS.items():
        i = next((head.index(n) for n in names if n in head), -1)
        if i < 0:
            raise MLError("csv_columns", f"Kolom '{names[0]}' tidak ada di CSV. Kolom tersedia: {', '.join(head)}", status=400)
        idx[k] = i
    rows = []
    for c in csv.reader(lines[1:], delimiter=delim):
        c = [x.strip().strip('"') for x in c]
        if len(c) <= max(idx.values()):
            continue
        r = {"t": _parse_time(c[idx["t"]], tz), "suhu": _num(c[idx["suhu"]]), "udara": _num(c[idx["udara"]]), "tanah": _num(c[idx["tanah"]])}
        if math.isfinite(r["t"]) and r["t"] > 1.4e12 and all(math.isfinite(r[k]) for k in ("suhu", "udara", "tanah")):
            rows.append(r)
    rows.sort(key=lambda r: r["t"])
    if not rows:
        raise MLError("csv_empty", "Tidak ada baris valid di CSV (cek format waktu dan angka).", status=400)
    return rows


def csv_hourly(raw_bytes, tz=None):
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")
    return PP.hourly_from_rows(parse_csv(text, tz))
