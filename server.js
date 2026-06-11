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
// Varsayilan admin sifresi YOK: .env'de ADMIN_PASSWORD tanimlanmazsa admin girisi kapali kalir
// (repo'da gorunen bir varsayilan, canli sistemde herkesin bildigi bir admin sifresi olurdu)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');

// Giris yapildiginda dondurulen kalici token'lar (sifre + secret'tan turetilir)
const AUTH_TOKEN = crypto.createHmac('sha256', SECRET).update('normal:' + APP_PASSWORD).digest('hex');
const ADMIN_TOKEN = ADMIN_PASSWORD
  ? crypto.createHmac('sha256', SECRET).update('admin:' + ADMIN_PASSWORD).digest('hex')
  : null;

const DEPOLAR = ['izmir', 'istanbul'];

app.set('trust proxy', 1); // nginx arkasinda gercek istemci IP'si icin
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ===== GIRIS DENEME SINIRI (kaba kuvvet korumasi) =====
const girisDenemeleri = new Map(); // ip -> { sayi, baslangic }
const DENEME_LIMIT = 20;
const DENEME_PENCERE_MS = 15 * 60 * 1000;

function girisEngelli(ip) {
  const kayit = girisDenemeleri.get(ip);
  if (!kayit) return false;
  if (Date.now() - kayit.baslangic > DENEME_PENCERE_MS) {
    girisDenemeleri.delete(ip);
    return false;
  }
  return kayit.sayi >= DENEME_LIMIT;
}

function girisBasarisiz(ip) {
  const kayit = girisDenemeleri.get(ip);
  if (!kayit || Date.now() - kayit.baslangic > DENEME_PENCERE_MS) {
    girisDenemeleri.set(ip, { sayi: 1, baslangic: Date.now() });
  } else {
    kayit.sayi++;
  }
}

// ===== AUTH =====
// Iki tarafi da hash'le: uzunluklar daima esit olur, timingSafeEqual throw edemez
function tokenEsit(a, b) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest()
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token && ADMIN_TOKEN && tokenEsit(token, ADMIN_TOKEN)) { req.rol = 'admin'; return next(); }
  if (token && tokenEsit(token, AUTH_TOKEN)) { req.rol = 'normal'; return next(); }
  return res.status(401).json({ error: 'Yetkisiz' });
}

// Yalnizca admin sifresiyle alinan token kabul edilir
function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (req.rol !== 'admin') {
      return res.status(403).json({ error: 'Bu islem icin admin sifresiyle giris gerekli' });
    }
    next();
  });
}

app.post('/api/login', (req, res) => {
  const ip = req.ip || '';
  if (girisEngelli(ip)) {
    return res.status(429).json({ error: 'Cok fazla hatali deneme. 15 dakika sonra tekrar deneyin.' });
  }
  const { sifre } = req.body || {};
  if (typeof sifre === 'string' && sifre) {
    // Admin sifresi oncelikli: iki sifre ayni ise admin yetkisi verilir
    if (ADMIN_PASSWORD && sifre === ADMIN_PASSWORD) {
      girisDenemeleri.delete(ip);
      return res.json({ token: ADMIN_TOKEN, rol: 'admin' });
    }
    if (sifre === APP_PASSWORD) {
      girisDenemeleri.delete(ip);
      return res.json({ token: AUTH_TOKEN, rol: 'normal' });
    }
  }
  girisBasarisiz(ip);
  return res.status(401).json({ error: 'Sifre hatali' });
});

// ===== STOKLAR =====
const STOK_SECIMI = 'SELECT barkod, urun, kategori, stok_izmir, stok_istanbul FROM stoklar ORDER BY urun';

app.get('/api/stoklar', auth, (req, res) => {
  res.json(db.prepare(STOK_SECIMI).all());
});

// Excel import: stok listesini tamamen degistirir — urun ekleme/silme/mutlak stok
// yazmaya esdeger oldugu icin yalnizca admin yapabilir
app.post('/api/stoklar/import', adminAuth, (req, res) => {
  const liste = Array.isArray(req.body) ? req.body : req.body.stoklar;
  if (!Array.isArray(liste)) return res.status(400).json({ error: 'Liste bekleniyor' });

  const temizle = db.prepare('DELETE FROM stoklar');
  const ekle = db.prepare(
    'INSERT OR REPLACE INTO stoklar (barkod, urun, kategori, stok_izmir, stok_istanbul) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((rows) => {
    temizle.run();
    for (const r of rows) {
      const barkod = String(r.barkod || '').trim();
      if (!barkod) continue;
      // Eski tek-kolonlu dosyalarla uyum: yalniz 'stok' verilmisse Izmir'e yazilir.
      // Negatif/ondalik degerler normalize edilir (admin uclariyla ayni kural).
      const izmir = Math.max(0, Math.trunc(Number(r.stok_izmir != null ? r.stok_izmir : r.stok) || 0));
      const istanbul = Math.max(0, Math.trunc(Number(r.stok_istanbul) || 0));
      ekle.run(barkod, String(r.urun || ''), String(r.kategori || 'Genel'), izmir, istanbul);
    }
    // Import ani: bundan eski islemler geri alinamaz (stok sayimi sifirdan yazildi)
    db.prepare('INSERT OR REPLACE INTO ayarlar (anahtar, deger) VALUES (?, ?)')
      .run('son_import', new Date().toISOString());
  });
  tx(liste);

  const rows = db.prepare(STOK_SECIMI).all();
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
    .prepare('SELECT id, tarih, barkod, urun, tip, depo, adet, not_metni AS not_metni, oncekiStok, yeniStok FROM islemler ORDER BY id DESC')
    .all();
  res.json(rows);
});

// Cikis islemi: secilen deponun stogundan dus + islem kaydet (atomik)
app.post('/api/islem', auth, (req, res) => {
  const { barkod, adet, tip, depo, not } = req.body || {};
  const miktar = parseInt(adet, 10) || 1;

  if (!barkod) return res.status(400).json({ error: 'Barkod gerekli' });
  if (!['hediye', 'satis', 'depo'].includes(tip)) return res.status(400).json({ error: 'Gecersiz tip' });
  if (!DEPOLAR.includes(depo)) return res.status(400).json({ error: 'Gecersiz depo' });
  if (miktar < 1) return res.status(400).json({ error: 'Adet en az 1 olmali' });

  const kolon = 'stok_' + depo; // DEPOLAR listesinden dogrulandi
  try {
    const sonuc = db.transaction(() => {
      const u = db.prepare('SELECT * FROM stoklar WHERE barkod = ?').get(barkod);
      if (!u) throw { code: 404, msg: 'Barkod bulunamadi!' };
      const mevcut = u[kolon];
      if (mevcut < miktar) throw { code: 400, msg: 'Bu depoda yetersiz stok! Mevcut: ' + mevcut };

      const yeniStok = mevcut - miktar;
      db.prepare('UPDATE stoklar SET ' + kolon + ' = ? WHERE barkod = ?').run(yeniStok, barkod);

      const tarih = new Date().toISOString();
      const info = db
        .prepare(
          'INSERT INTO islemler (tarih, barkod, urun, tip, depo, adet, not_metni, oncekiStok, yeniStok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(tarih, u.barkod, u.urun, tip, depo, miktar, String(not || ''), mevcut, yeniStok);

      return { id: info.lastInsertRowid, urun: u.urun, depo, oncekiStok: mevcut, yeniStok };
    })();
    res.json({ ok: true, ...sonuc });

    // Google Sheets'e yansit (arka planda): islemi ekle + guncel stogu yaz
    const islemKaydi = {
      tarih: new Date().toISOString(), tip, depo, barkod, urun: sonuc.urun,
      adet: miktar, oncekiStok: sonuc.oncekiStok, yeniStok: sonuc.yeniStok, not: not || '',
    };
    Promise.all([sheets.appendIslem(islemKaydi), sheets.syncStok()])
      .catch((e) => console.error('[Sheets] islem sync:', e.message));
  } catch (e) {
    if (e && typeof e.code === 'number') return res.status(e.code).json({ error: e.msg });
    console.error(e);
    res.status(500).json({ error: 'Sunucu hatasi' });
  }
});

// Islemi geri al: kaydi sil + dusulen adedi stoga iade et (atomik)
app.delete('/api/islemler/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Gecersiz islem id' });

  try {
    const sonuc = db.transaction(() => {
      const islem = db.prepare('SELECT * FROM islemler WHERE id = ?').get(id);
      if (!islem) throw { code: 404, msg: 'Islem bulunamadi (zaten geri alinmis olabilir)' };

      // Son Excel yuklemesinden veya bu urunun son admin duzeltmesinden onceki islemler
      // geri alinamaz: stok o anda mutlak degerle yazildi, iade sayimi saptirirdi
      const imp = db.prepare('SELECT deger FROM ayarlar WHERE anahtar = ?').get('son_import');
      if (imp && islem.tarih < imp.deger) {
        throw { code: 400, msg: 'Bu islem son Excel yuklemesinden once yapilmis, geri alinamaz' };
      }
      const duz = db.prepare('SELECT deger FROM ayarlar WHERE anahtar = ?').get('son_duzeltme:' + islem.barkod);
      if (duz && islem.tarih < duz.deger) {
        throw { code: 400, msg: 'Bu urunun stogu admin tarafindan elle duzeltildi; daha eski islemler geri alinamaz' };
      }

      const u = db.prepare('SELECT * FROM stoklar WHERE barkod = ?').get(islem.barkod);
      if (!u) throw { code: 404, msg: 'Urun stok listesinde yok, geri alinamadi' };

      // Iade, islemin yapildigi depoya yapilir
      const depo = DEPOLAR.includes(islem.depo) ? islem.depo : 'izmir';
      const kolon = 'stok_' + depo;
      const yeniStok = u[kolon] + islem.adet;
      db.prepare('UPDATE stoklar SET ' + kolon + ' = ? WHERE barkod = ?').run(yeniStok, islem.barkod);
      db.prepare('DELETE FROM islemler WHERE id = ?').run(id);

      return { barkod: islem.barkod, urun: islem.urun, adet: islem.adet, depo, yeniStok };
    })();
    res.json({ ok: true, ...sonuc });

    // Google Sheets'e yansit (arka planda): stok + islem listesini yeniden yaz
    Promise.all([sheets.syncStok(), sheets.syncIslemler()])
      .catch((e) => console.error('[Sheets] geri alma sync:', e.message));
  } catch (e) {
    if (e && typeof e.code === 'number') return res.status(e.code).json({ error: e.msg });
    console.error(e);
    res.status(500).json({ error: 'Sunucu hatasi' });
  }
});

// ===== ADMIN: STOK DUZELTME =====
// Iki deponun miktarini elle ayarlar (mutlak deger yazilir)
app.post('/api/admin/stok-duzelt', adminAuth, (req, res) => {
  const { barkod, stok_izmir, stok_istanbul } = req.body || {};
  const izmir = parseInt(stok_izmir, 10);
  const istanbul = parseInt(stok_istanbul, 10);

  if (!barkod) return res.status(400).json({ error: 'Barkod gerekli' });
  if (!Number.isInteger(izmir) || izmir < 0 || !Number.isInteger(istanbul) || istanbul < 0) {
    return res.status(400).json({ error: 'Stok miktarlari 0 veya daha buyuk tam sayi olmali' });
  }

  const u = db.prepare('SELECT * FROM stoklar WHERE barkod = ?').get(barkod);
  if (!u) return res.status(404).json({ error: 'Urun bulunamadi' });

  db.transaction(() => {
    db.prepare('UPDATE stoklar SET stok_izmir = ?, stok_istanbul = ? WHERE barkod = ?')
      .run(izmir, istanbul, barkod);
    // Duzeltme ani: bu urunun daha eski islemleri artik geri alinamaz (sayim sapmasin)
    db.prepare('INSERT OR REPLACE INTO ayarlar (anahtar, deger) VALUES (?, ?)')
      .run('son_duzeltme:' + barkod, new Date().toISOString());
  })();

  res.json({ ok: true, barkod, urun: u.urun, stok_izmir: izmir, stok_istanbul: istanbul });
  sheets.syncStok().catch((e) => console.error('[Sheets] stok duzeltme sync:', e.message));
});

// ===== ADMIN: URUN EKLE =====
app.post('/api/admin/urun', adminAuth, (req, res) => {
  const { barkod, urun, kategori, stok_izmir, stok_istanbul } = req.body || {};
  const b = String(barkod || '').trim();
  const ad = String(urun || '').trim();
  const izmir = parseInt(stok_izmir, 10) || 0;
  const istanbul = parseInt(stok_istanbul, 10) || 0;

  if (!b) return res.status(400).json({ error: 'Barkod gerekli' });
  if (!ad) return res.status(400).json({ error: 'Urun adi gerekli' });
  if (izmir < 0 || istanbul < 0) return res.status(400).json({ error: 'Stok 0 veya daha buyuk olmali' });

  const mevcut = db.prepare('SELECT barkod FROM stoklar WHERE barkod = ?').get(b);
  if (mevcut) return res.status(409).json({ error: 'Bu barkod zaten kayitli: ' + b });

  db.transaction(() => {
    db.prepare('INSERT INTO stoklar (barkod, urun, kategori, stok_izmir, stok_istanbul) VALUES (?, ?, ?, ?, ?)')
      .run(b, ad, String(kategori || 'Genel').trim() || 'Genel', izmir, istanbul);
    // Ayni barkod daha once silinip yeniden eklendiyse, eski urunun islemleri
    // geri alinarak yeni girilen stok sisirilmesin
    db.prepare('INSERT OR REPLACE INTO ayarlar (anahtar, deger) VALUES (?, ?)')
      .run('son_duzeltme:' + b, new Date().toISOString());
  })();

  res.json({ ok: true, barkod: b, urun: ad });
  sheets.syncStok().catch((e) => console.error('[Sheets] urun ekleme sync:', e.message));
});

// ===== ADMIN: URUN SIL =====
app.delete('/api/admin/urun/:barkod', adminAuth, (req, res) => {
  const b = String(req.params.barkod || '').trim();
  if (!b) return res.status(400).json({ error: 'Barkod gerekli' });

  const u = db.prepare('SELECT * FROM stoklar WHERE barkod = ?').get(b);
  if (!u) return res.status(404).json({ error: 'Urun bulunamadi' });

  db.prepare('DELETE FROM stoklar WHERE barkod = ?').run(b);
  // Islem gecmisi silinmez (kayit olarak kalir); bu urune ait eski islemler artik geri alinamaz

  res.json({ ok: true, barkod: b, urun: u.urun });
  sheets.syncStok().catch((e) => console.error('[Sheets] urun silme sync:', e.message));
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
  if (!ADMIN_PASSWORD) {
    console.log('[Admin] ADMIN_PASSWORD tanimli degil — admin girisi KAPALI. Acmak icin .env dosyasina ekleyin.');
  }
  sheets.init();
});
