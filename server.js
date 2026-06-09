'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const sheets = require('./sheets');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'ki2024';
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');

// Giris yapildiginda dondurulen kalici token (sifre + secret'tan turetilir)
const AUTH_TOKEN = crypto.createHmac('sha256', SECRET).update(APP_PASSWORD).digest('hex');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ===== AUTH =====
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(AUTH_TOKEN))) {
    return next();
  }
  return res.status(401).json({ error: 'Yetkisiz' });
}

app.post('/api/login', (req, res) => {
  const { sifre } = req.body || {};
  if (typeof sifre === 'string' && sifre === APP_PASSWORD) {
    return res.json({ token: AUTH_TOKEN });
  }
  return res.status(401).json({ error: 'Sifre hatali' });
});

// ===== STOKLAR =====
app.get('/api/stoklar', auth, (req, res) => {
  const rows = db.prepare('SELECT barkod, urun, kategori, stok FROM stoklar ORDER BY urun').all();
  res.json(rows);
});

// Excel import: stok listesini tamamen degistirir
app.post('/api/stoklar/import', auth, (req, res) => {
  const liste = Array.isArray(req.body) ? req.body : req.body.stoklar;
  if (!Array.isArray(liste)) return res.status(400).json({ error: 'Liste bekleniyor' });

  const temizle = db.prepare('DELETE FROM stoklar');
  const ekle = db.prepare(
    'INSERT OR REPLACE INTO stoklar (barkod, urun, kategori, stok) VALUES (?, ?, ?, ?)'
  );
  const tx = db.transaction((rows) => {
    temizle.run();
    for (const r of rows) {
      const barkod = String(r.barkod || '').trim();
      if (!barkod) continue;
      ekle.run(barkod, String(r.urun || ''), String(r.kategori || 'Genel'), Number(r.stok) || 0);
    }
  });
  tx(liste);

  const rows = db.prepare('SELECT barkod, urun, kategori, stok FROM stoklar ORDER BY urun').all();
  res.json({ ok: true, adet: rows.length, stoklar: rows });

  // Google Sheets'e yansit (arka planda)
  sheets.syncStok().catch((e) => console.error('[Sheets] stok sync:', e.message));
});

// ===== CALISANLAR =====
app.get('/api/calisanlar', auth, (req, res) => {
  const rows = db.prepare('SELECT id, calisan, barkod, urun, stok FROM calisanlar ORDER BY calisan').all();
  res.json(rows);
});

// ===== ISLEMLER =====
app.get('/api/islemler', auth, (req, res) => {
  const rows = db
    .prepare('SELECT id, tarih, barkod, urun, tip, adet, not_metni AS not_metni, oncekiStok, yeniStok FROM islemler ORDER BY id DESC')
    .all();
  res.json(rows);
});

// Cikis islemi: stok dus + islem kaydet (atomik)
app.post('/api/islem', auth, (req, res) => {
  const { barkod, adet, tip, not } = req.body || {};
  const miktar = parseInt(adet, 10) || 1;

  if (!barkod) return res.status(400).json({ error: 'Barkod gerekli' });
  if (!['hediye', 'satis', 'depo'].includes(tip)) return res.status(400).json({ error: 'Gecersiz tip' });
  if (miktar < 1) return res.status(400).json({ error: 'Adet en az 1 olmali' });

  try {
    const sonuc = db.transaction(() => {
      const u = db.prepare('SELECT * FROM stoklar WHERE barkod = ?').get(barkod);
      if (!u) throw { code: 404, msg: 'Barkod bulunamadi!' };
      if (u.stok < miktar) throw { code: 400, msg: 'Yetersiz stok! Mevcut: ' + u.stok };

      const yeniStok = u.stok - miktar;
      db.prepare('UPDATE stoklar SET stok = ? WHERE barkod = ?').run(yeniStok, barkod);

      const tarih = new Date().toISOString();
      const info = db
        .prepare(
          'INSERT INTO islemler (tarih, barkod, urun, tip, adet, not_metni, oncekiStok, yeniStok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(tarih, u.barkod, u.urun, tip, miktar, String(not || ''), u.stok, yeniStok);

      return { id: info.lastInsertRowid, urun: u.urun, oncekiStok: u.stok, yeniStok };
    })();
    res.json({ ok: true, ...sonuc });

    // Google Sheets'e yansit (arka planda): islemi ekle + guncel stogu yaz
    const islemKaydi = {
      tarih: new Date().toISOString(), tip, barkod, urun: sonuc.urun,
      adet: miktar, oncekiStok: sonuc.oncekiStok, yeniStok: sonuc.yeniStok, not: not || '',
    };
    Promise.all([sheets.appendIslem(islemKaydi), sheets.syncStok()])
      .catch((e) => console.error('[Sheets] islem sync:', e.message));
  } catch (e) {
    if (e && e.code) return res.status(e.code).json({ error: e.msg });
    console.error(e);
    res.status(500).json({ error: 'Sunucu hatasi' });
  }
});

// ===== MANUEL SENKRON =====
app.post('/api/sync', auth, async (req, res) => {
  if (!sheets.isAktif()) {
    return res.json({ ok: false, aktif: false, mesaj: 'Google Sheets senkronizasyonu yapilandirilmamis.' });
  }
  try {
    await sheets.syncAll();
    res.json({ ok: true, aktif: true, mesaj: 'Tum veriler Google Sheets ile senkronize edildi.' });
  } catch (e) {
    console.error('[Sheets] manuel sync:', e.message);
    res.status(500).json({ ok: false, aktif: true, mesaj: 'Senkron hatasi: ' + e.message });
  }
});

app.get('/api/sync/durum', auth, (req, res) => {
  res.json({ aktif: sheets.isAktif() });
});

// ===== STATIK FRONTEND =====
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Ki Stok Sistemi http://localhost:${PORT} adresinde calisiyor`);
  sheets.init();
});
