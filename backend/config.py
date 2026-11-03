"""Konfigurasi pengolahan data (port dari js/ml/config.js). Bisa ditimpa lewat variabel lingkungan."""
import os

WINDOW_HOURS = 24            # jumlah jam riwayat yang dilihat model
HORIZON_DAYS = 4
HORIZON_HOURS = 96
TEST_FRACTION = 0.20
VAL_FRACTION = 0.15
MIN_WINDOWS_REQUIRED = 120   # jendela latih minimum agar training bermakna
MAX_STALE_HOURS = 6          # prediksi ditolak bila jam lengkap terakhir lebih tua dari ini
MIN_SAMPLES_PER_HOUR = 10    # jam dengan pembacaan lebih sedikit dianggap tidak lengkap
MAX_GAP_HOURS = 3            # celah terpanjang yang boleh diisi interpolasi linear
FETCH_CHUNK_HOURS = 3
FETCH_CONCURRENCY = 4
OFFLINE_AFTER_SECONDS = 15
CNN_UNCERTAIN_BELOW = 0.60
DEFAULT_TZ = "Asia/Jakarta"
DEFAULT_DAYS = 14

DEFAULT_FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://smart-farming-selada-default-rtdb.asia-southeast1.firebasedatabase.app/kelompok2.json",
)
CACHE_DIR = os.environ.get("CACHE_DIR") or ("/tmp/selada-cache" if os.environ.get("VERCEL") else os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache"))
FIREBASE_TIMEOUT = float(os.environ.get("FIREBASE_TIMEOUT", "30"))


class MLError(Exception):
    """Galat terstruktur: kode + pesan + data; dikirim ke browser sebagai JSON."""

    def __init__(self, code, message, data=None, status=422):
        super().__init__(message)
        self.code, self.message, self.data, self.status = code, message, data or {}, status

    def to_dict(self):
        return {"error": {"code": self.code, "message": self.message, "data": self.data}}
