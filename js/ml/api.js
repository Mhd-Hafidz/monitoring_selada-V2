/* Klien API ke server Python (backend/app.py). Seluruh pengolahan data sensor dikerjakan di Python:
   pengambilan Firebase, rata-rata per jam, interpolasi celah, jendela + skala, metrik evaluasi, aturan status,
   agregasi prediksi harian, dan penggabungan hasil scan. Browser hanya melatih/menjalankan model (TensorFlow.js). */
(function () {
    'use strict';
    var ML = window.SeladaML, E = ML.MLError, KEY = 'selada-api-base';

    function base() {
        var v = '';
        try { v = (localStorage.getItem(KEY) || '').trim(); } catch (e) { }
        v = v.replace(/\/+$/, '');
        if (v) return v;
        return location.protocol === 'file:' ? 'http://localhost:5000' : '';   // dibuka dari server Flask -> alamat yang sama
    }
    function setBase(v) { try { localStorage.setItem(KEY, String(v || '').trim()); } catch (e) { } }
    function where() { return base() || location.origin; }

    async function request(path, init, ms) {
        var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, ms || 180000), res, data;
        init = init || {}; init.signal = ctrl.signal; init.cache = 'no-store';
        try { res = await fetch(base() + path, init); }
        catch (e) {
            throw new E('backend_unreachable', 'Server Python tidak bisa dihubungi di ' + where() + (e && e.name === 'AbortError' ? ' (waktu habis)' : '') +
                '. Jalankan "python backend/app.py" lalu muat ulang halaman, atau atur alamat server di Pengaturan.');
        } finally { clearTimeout(to); }
        try { data = await res.json(); } catch (e) { data = null; }
        if (!res.ok || (data && data.error)) {
            var er = (data && data.error) || {};
            throw new E(er.code || 'http_' + res.status, er.message || ('Server Python membalas HTTP ' + res.status + '.'), er.data || {});
        }
        return data;
    }
    function post(path, body, ms) {
        return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, ms);
    }
    function postForm(path, form, ms) { return request(path, { method: 'POST', body: form }, ms); }
    function get(path, ms) { return request(path, { method: 'GET' }, ms || 15000); }

    /* Data umum yang dikirim ke setiap permintaan pengolahan data. */
    function ctx() { return { firebase_url: ML.firebaseUrl(), timezone: ML.tz() }; }
    function resetCache() { return post('/api/cache/reset', {}, 15000); }
    function health() { return get('/api/health'); }
    function round6(a) { var o = new Array(a.length); for (var i = 0; i < a.length; i++) o[i] = Math.round(a[i] * 1e6) / 1e6; return o; }

    window.SeladaAPI = { base: base, setBase: setBase, where: where, post: post, postForm: postForm, get: get, ctx: ctx, resetCache: resetCache, health: health, round6: round6 };
    /* Konstanta bentuk data (harus sama dengan backend/utils/preprocessing.py). */
    window.SeladaPrep = { FEATURES: ['suhu', 'udara', 'tanah'], N_INPUT: 5, HOUR: 3600000 };
})();
