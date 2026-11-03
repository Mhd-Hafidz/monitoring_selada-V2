"""Firebase Realtime Database palsu untuk pengujian: data sintetis dengan push-ID, mendukung orderBy=$key,
startAt, endAt, limitToFirst, limitToLast. Jalankan: python mock_firebase.py [port] [hari]"""
import json
import math
import os
import random
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from utils import preprocessing as PP  # noqa: E402


def build(days=16, step_s=30, gaps=()):
    rnd = random.Random(7)
    end = int(time.time() * 1000) // 3600000 * 3600000   # sampai awal jam berjalan (jam lengkap terakhir = jam lalu)
    start = end - days * 24 * 3600000
    data = {}
    t = start
    while t < end:
        h = t / 3600000
        if not any(a <= (t - start) / 3600000 < b for a, b in gaps):
            hod = ((t / 3600000) + 7) % 24
            suhu = 27 + 4 * math.sin((hod - 9) / 24 * 2 * math.pi) + rnd.gauss(0, .2)
            udara = 70 - 12 * math.sin((hod - 9) / 24 * 2 * math.pi) + rnd.gauss(0, .5)
            tanah = 70 + 6 * math.sin(h / 30) + rnd.gauss(0, .4)
            key = PP.encode_push_time(t) + "".join(rnd.choice(PP.ALPH) for _ in range(12))
            data[key] = {"suhu": round(suhu, 2), "kelembapan_udara": round(udara, 1), "kelembapan_tanah": round(tanah, 1)}
        t += step_s * 1000
    return dict(sorted(data.items()))


class H(BaseHTTPRequestHandler):
    DATA = {}

    def log_message(self, *a):
        pass

    def do_GET(self):
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        keys = list(self.DATA)
        if "startAt" in q:
            s = json.loads(q["startAt"]); keys = [k for k in keys if k >= s]
        if "endAt" in q:
            e = json.loads(q["endAt"]); keys = [k for k in keys if k <= e]
        if "limitToFirst" in q:
            keys = keys[:int(q["limitToFirst"])]
        if "limitToLast" in q:
            keys = keys[-int(q["limitToLast"]):]
        body = json.dumps({k: self.DATA[k] for k in keys}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9000
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 16
    H.DATA = build(days, gaps=((100, 102), (200, 210)))
    print(f"mock firebase: {len(H.DATA)} baris di http://localhost:{port}/kelompok2.json", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
