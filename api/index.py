"""Pintu masuk Vercel (Python serverless): memuat aplikasi Flask dari backend/app.py."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app import app  # noqa: E402,F401  (Vercel mencari variabel `app`)
