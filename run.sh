#!/bin/bash
# Menjalankan server Python (pengolahan data + antarmuka web) di http://localhost:5000
cd "$(dirname "$0")/backend" && python3 -m pip install -q -r requirements.txt && python3 app.py
