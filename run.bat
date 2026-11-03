@echo off
cd /d "%~dp0backend"
python -m pip install -q -r requirements.txt
python app.py
