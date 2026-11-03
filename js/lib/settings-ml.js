/* Panel "Machine Learning" (model di browser, pengolahan data di server Python) di halaman Pengaturan. */
(function () {
    'use strict';
    var tz = document.getElementById('setTz'), days = document.getElementById('setMlDays'), test = document.getElementById('mlTest'), clr = document.getElementById('mlClear'), msg = document.getElementById('mlMsg');
    if (!tz || !test) return;
    var ML = window.SeladaML, API = window.SeladaAPI, api = document.getElementById('setApi');
    if (api) { api.value = API.base(); api.addEventListener('change', function () { API.setBase(api.value); api.value = API.base(); msg.className = 'msg good'; msg.textContent = 'Alamat server Python disimpan.'; }); }
    tz.value = ML.tz(); days.value = ML.days();
    tz.addEventListener('change', function () {
        if (ML.setTz(tz.value.trim() || ML.C.DEFAULT_TZ)) { msg.className = 'msg good'; msg.textContent = 'Zona waktu disimpan. Latih ulang LSTM bila zonanya berubah.'; }
        else { msg.className = 'msg err'; msg.textContent = 'Zona waktu tidak dikenal (contoh: Asia/Jakarta, Asia/Makassar).'; }
        tz.value = ML.tz();
    });
    days.addEventListener('change', function () { days.value = ML.setDays(days.value); });
    test.addEventListener('click', async function () {
        msg.className = 'msg'; msg.textContent = 'Menguji…';
        try {
            var b = await ML.ready();
            var tfMsg = 'TensorFlow.js ' + window.tf.version.tfjs + ' siap (mesin: ' + b + '). MobileNet: ' + (window.mobilenet ? 'termuat' : 'tidak termuat (hanya CNN "custom" yang bisa dipakai)') + '.', pyMsg;
            try { var h = await API.health(); pyMsg = ' Server Python tersambung (' + API.where() + ', numpy ' + h.numpy + ').'; }
            catch (e2) { msg.className = 'msg err'; msg.textContent = tfMsg + ' ' + e2.message; return; }
            msg.className = 'msg good'; msg.textContent = tfMsg + pyMsg;
        } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
    });
    clr.addEventListener('click', async function () {
        if (!confirm('Hapus model LSTM, model CNN (di browser ini) dan cache data per jam di server Python?')) return;
        try { await window.SeladaLSTM.deleteModel(); await window.SeladaCNN.deleteModel(); try { await API.resetCache(); } catch (e3) { /* server mati: cache server tidak terhapus */ } window.dispatchEvent(new Event('selada-ml-cleared')); msg.className = 'msg good'; msg.textContent = 'Model dan cache dihapus.'; }
        catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
    });
})();
