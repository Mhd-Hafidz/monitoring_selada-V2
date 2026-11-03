# Smart Monitoring Selada Keriting — dashboard + Machine Learning (HTML · CSS · JavaScript + Python)

**Pengolahan data dikerjakan di Python (Flask + NumPy)**; dashboard tetap HTML/CSS/JS, dan model **LSTM** dan **CNN**
tetap dilatih serta dijalankan di browser memakai **TensorFlow.js**.

## Menjalankan
1. Jalankan server Python: `./run.sh` (Linux/macOS) atau `run.bat` (Windows). Atau manual:
   `cd backend && pip install -r requirements.txt && python app.py`
2. Buka **http://localhost:5000** (server yang sama melayani antarmuka web).
   Bila `index.html` dibuka langsung dari berkas, isi "Alamat server Python" di Pengaturan (bawaan: `http://localhost:5000`).
3. Login lama tetap berlaku. **Perlu internet**: TensorFlow.js dimuat dari CDN (`cdn.jsdelivr.net`) dan server Python membaca Firebase.
Kamera perangkat butuh https atau `http://localhost`.

Variabel lingkungan server: `PORT` (5000), `HOST` (127.0.0.1), `FIREBASE_URL` (bawaan bila browser tidak mengirim), `CACHE_DIR`.

## Pembagian tugas
```
index.html  style.css  script.js          dashboard lama (tetap utuh)
js/lib/    status charts xlsx mlui imageinput settings-ml
js/ml/     config api lstm forecast cnn scan        <- model di browser + klien API
js/pages/  realtime explore lstm (+ forecast, tab Prediksi 4 Hari) cnn scan
backend/   app.py config.py                          <- server Python
  services/ data_service  lstm_service  forecast_service  scan_service
  utils/    preprocessing evaluation status
  tests/    mock_firebase.py  test_api.py
```
| Pengolahan data | Dikerjakan di |
|---|---|
| Ambil data Firebase (REST), cache per jam, baca CSV | `backend/services/data_service.py` |
| Rata-rata per jam, interpolasi celah <= 3 jam, segmen, skala 0..1, jendela 24 jam, split kronologis, fitur sin/cos jam | `backend/utils/preprocessing.py` |
| Metrik MAE/MSE/RMSE/R2, pembanding persistensi, evaluasi 24 jam, precision/recall/F1 + confusion matrix | `backend/utils/evaluation.py`, `backend/services/lstm_service.py` |
| Aturan status normal/waspada/berbahaya + saran | `backend/utils/status.py` |
| Input prediksi terbaru, cek kesegaran data, kembali ke satuan asli | `backend/services/lstm_service.py` |
| Agregasi prediksi 4 hari + ringkasan | `backend/services/forecast_service.py` |
| Penggabungan sensor + LSTM + CNN (Scan) | `backend/services/scan_service.py` |
| **Tetap di browser (TensorFlow.js)** | bangun/latih/jalankan model LSTM dan CNN, MobileNet, penyimpanan model (IndexedDB) |

Endpoint: `GET /api/health`, `POST /api/sensor/latest`, `/api/status/assess`, `/api/lstm/dataset`, `/api/lstm/evaluate`,
`/api/lstm/forecast-input`, `/api/lstm/postprocess`, `/api/forecast/aggregate`, `/api/scan/combine`, `/api/evaluate/classification`, `/api/cache/reset`.

Alur latih LSTM: browser minta `/api/lstm/dataset` -> Python mengembalikan jendela terskala + split + scaler -> browser melatih ->
browser kirim prediksi data uji ke `/api/lstm/evaluate` -> Python menghitung metrik di satuan asli.
Model disimpan di **IndexedDB** browser, metadata di localStorage; cache data per jam disimpan server di `backend/cache/`.

## Pengujian server
```
cd backend
python tests/mock_firebase.py 9000 16 &     # Firebase palsu (data sintetis + celah)
FIREBASE_URL=http://localhost:9000/kelompok2.json python app.py &
python tests/test_api.py
```

## LSTM
**Model LSTM & Prediksi** (satu halaman, dua tab: "Prediksi 4 Hari" dan "Model & Evaluasi"). Latih lewat tab Model & Evaluasi -> Latih model. Sumber: Firebase (N hari terakhir, bawaan 14, diunduh server Python) atau CSV dari "Ekspor CSV" di Eksplorasi Data.
Data per detik dirata-ratakan per jam; celah <= 3 jam diinterpolasi, lebih panjang memutus data. Input 24 jam x (suhu, udara, tanah, sin/cos jam),
output jam berikutnya; prediksi 4 hari rekursif (96 langkah). Split kronologis; metrik MAE/MSE/RMSE/R2 plus pembanding "sama dengan jam sebelumnya".
Syarat: minimal 120 jendela (sekitar 6 hari data berurutan; disarankan 14 hari). Unduhan pertama cukup besar, lalu di-cache per jam di server.
Pelatihan model berjalan di tab ini, jadi biarkan terbuka (ada tombol Hentikan).

## CNN
**Model CNN -> Dataset & training**: pilih folder berisi sub-folder per kelas (sehat/, bercak_daun/, ...) atau tambah kelas manual.
Minimal 2 kelas, >= 10 foto per kelas (disarankan 100+). Split berstrata 70/15/15, data latih ditambah versi cermin.
- **MobileNetV2** (disarankan): bobot ImageNet diunduh sekali (sekitar 14 MB), kepala Dense dilatih di atasnya.
- **Custom**: CNN kecil dari nol, tanpa unduhan.
Status kelas (sehat/perhatian/berbahaya) dan saran dapat diedit di panel "Status & saran per kelas".
ESP32-CAM: browser mengambil `http://IP/capture` (satu jaringan, halaman tidak boleh https, kamera harus mengizinkan CORS); jika gagal, unggah foto manual.

## Catatan
- **Status pompa**: tampil di Ringkasan dan Monitoring Realtime. Bila Firebase memuat kolom `pompa` (atau `pump`/`relay`, nilai ON/OFF, 1/0, true/false), nilainya dipakai; jika tidak, status disimpulkan dari batas kering tanah dan diberi label "Disimpulkan".
- Foto tidak dikirim ke server mana pun (CNN berjalan di browser); server Python hanya menerima angka sensor/prediksi dan membaca Firebase Anda.
- Login dashboard masih di sisi klien (email/sandi di script.js); cukup untuk penggunaan lokal.

## Perbaikan terbaru
- **CNN tetap tersimpan walau server Python gagal**: bila `/api/evaluate/classification` tidak bisa dipanggil (mis. galat "The method is not allowed for the requested URL"), akurasi dan confusion matrix dihitung di browser.
- **Unggah/seret-lepas**: dataset CNN kini punya zona "Seret folder dataset ke sini" (folder per kelas atau foto lepas dengan nama kelas terisi); halaman LSTM menerima CSV yang diseret; kursor tidak lagi berubah jadi simbol larang saat berkas diseret. Tombol Latih yang nonaktif kini disertai alasannya.
- **Halaman CNN**: dataset kini menampilkan pratinjau foto per kelas; tombol "Analisis dengan CNN" yang nonaktif kini disertai alasan (model belum dilatih).
- **Hasil CNN** bergaya referensi: kartu Tahap/Keyakinan/Indeks kesiapan panen, plus analisis visual daun (tutupan, menguning, kepekatan hijau; heuristik warna, bukan ukuran fisik). Panel lama (probabilitas, preprocessing, riwayat) tetap ada.
- Tab Prediksi 4 Hari: status keseluruhan, saran, grafik kelembapan udara, dan kolom kondisi sensor dikembalikan di bawah tampilan baru.
- **Tab Prediksi 4 Hari** kini bergaya dashboard pakcoy: kartu umur tanaman (isi tanggal tanam + umur panen), kartu ringkasan akhir, kartu Hari ke-N dengan tingkat kematangan, grafik kelembapan tanah/suhu, grafik kematangan, tabel "Ringkasan per hari", dan unduh CSV. Tingkat kematangan = umur ÷ umur panen (estimasi, bukan keluaran LSTM).
- **Mode latih sederhana** di halaman LSTM dan CNN: pilih *Otomatis* (disarankan), *Cepat*, *Teliti*, atau *Atur sendiri*. Kolom epoch hanya muncul pada mode "Atur sendiri"; early stopping tetap aktif di semua mode.
- **Pengolahan data dipindah ke Python** (backend/); `js/ml/prep.js`, `data.js`, `rules.js` diganti klien API `js/ml/api.js`.
- **CNN MobileNetV2**: training gagal karena fitur `[1,1280]` ditumpuk menjadi `[N,1,1280]`; kini diratakan ke `[N,1280]` sebelum masuk kepala Dense.
- Training LSTM/CNN yang gagal atau dihentikan kini melepas tensor dan model (tidak membocorkan memori GPU).
- Halaman CNN: pilihan arsitektur, epoch, dan nama kelas tidak lagi ter-reset saat menambah kelas atau folder.
- Tab "Prediksi 4 Hari" menampilkan petunjuk bila model belum dilatih (sebelumnya kosong).
- "Hapus model & cache" di Pengaturan kini langsung menyegarkan halaman LSTM dan CNN.

## Deploy ke Vercel
File yang dipakai: `vercel.json`, `api/index.py` (pintu masuk Flask), `requirements.txt`.
1. Taruh folder proyek (isi `WebInterface/`, bukan folder induknya) di repo GitHub, lalu di vercel.com: **Add New → Project → Import** repo itu.
   Framework Preset: **Other**; Build Command dan Output Directory dikosongkan. Klik **Deploy**.
   (Atau via CLI: `npm i -g vercel`, lalu `vercel` di dalam folder proyek, dan `vercel --prod`.)
2. Opsional: Settings → Environment Variables → `FIREBASE_URL` (alamat Firebase bawaan server).
3. Buka alamat `https://nama-proyek.vercel.app`. "Alamat server Python" di Pengaturan dibiarkan kosong (satu domain).
Catatan: fungsi serverless dibatasi waktu (`maxDuration` 60 dtk di vercel.json; paket gratis bisa lebih rendah), cache per jam
disimpan di `/tmp` sehingga hilang saat instance berganti, jadi unduhan 14 hari pertama kali bisa lambat. Bila timeout, kurangi
"Data latih LSTM (hari terakhir)" di Pengaturan (mis. 7 hari) lalu coba lagi.

## Batas kondisi (acuan Sutrisna 2022 + rekomendasi sistem)
| Parameter | Normal | Aksi/keterangan |
|---|---|---|
| Kelembapan tanah | 66–77 % (target 70–76 %) | ≤ 65 % tanah kering → pompa ON; ≥ 78 % tanah basah → pompa OFF |
| Kelembapan udara | 60–80 % | di luar rentang = waspada; > 15 poin di bawah atau > 5 di atas = berbahaya |
Batas bisa diubah di Pengaturan. Setelan lama (60/80 %, udara 40 %) otomatis diganti ke batas ini saat halaman dibuka (`ver: 2`).
Samakan firmware ESP32 (relay pompa) dengan ≤ 65 % ON dan ≥ 78 % OFF.
