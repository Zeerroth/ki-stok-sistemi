'use strict';

// Google Sheets senkronizasyon modulu.
// SQLite ana veri kaynagidir; her degisiklik buradan Google Sheets'e yansitilir.
// Kimlik bilgisi (service account) yoksa sessizce devre disi kalir; uygulama calismaya devam eder.

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const db = require('./db');

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const CRED_PATH = process.env.GOOGLE_CREDENTIALS_PATH || path.join(__dirname, 'google-credentials.json');

let sheets = null;
let aktif = false;

const BASLIK_STOK = ['Barkod', 'Urun Adi', 'Kategori', 'Stok'];
const BASLIK_ISLEM = ['Tarih', 'Cikis Tipi', 'Barkod', 'Urun Adi', 'Adet', 'Onceki Stok', 'Yeni Stok', 'Not'];
const BASLIK_CALISAN = ['Calisan', 'Barkod', 'Urun', 'Stok'];

const TIP_ETIKET = { hediye: 'Hediye', satis: 'Satis', depo: 'Depo Satisi' };

async function init() {
  if (!SHEET_ID) {
    console.log('[Sheets] GOOGLE_SHEET_ID tanimli degil — senkronizasyon KAPALI.');
    return;
  }
  if (!fs.existsSync(CRED_PATH)) {
    console.log('[Sheets] Kimlik dosyasi yok (' + CRED_PATH + ') — senkronizasyon KAPALI.');
    return;
  }
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CRED_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: client });
    aktif = true;
    console.log('[Sheets] Senkronizasyon AKTIF (sheet: ' + SHEET_ID + ').');
    // Acilista bir kez tam senkron yap
    syncAll().catch((e) => console.error('[Sheets] Acilis senkronu hatasi:', e.message));
  } catch (e) {
    console.error('[Sheets] Baslatilamadi:', e.message);
  }
}

function isAktif() {
  return aktif;
}

// Sekme yoksa olustur
async function ensureSheet(title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const mevcut = meta.data.sheets.some((s) => s.properties.title === title);
  if (!mevcut) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
}

// Bir sekmeyi tamamen temizleyip basliklar + satirlarla yeniden yaz
async function yazTablo(title, basliklar, satirlar) {
  await ensureSheet(title);
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: title });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: title + '!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [basliklar, ...satirlar] },
  });
}

async function syncStok() {
  if (!aktif) return;
  const rows = db.prepare('SELECT barkod, urun, kategori, stok FROM stoklar ORDER BY urun').all();
  await yazTablo('Stok', BASLIK_STOK, rows.map((r) => [r.barkod, r.urun, r.kategori, r.stok]));
}

async function syncCalisanlar() {
  if (!aktif) return;
  const rows = db.prepare('SELECT calisan, barkod, urun, stok FROM calisanlar ORDER BY calisan').all();
  await yazTablo('Calisan', BASLIK_CALISAN, rows.map((r) => [r.calisan, r.barkod, r.urun, r.stok]));
}

async function syncIslemler() {
  if (!aktif) return;
  const rows = db
    .prepare('SELECT tarih, tip, barkod, urun, adet, oncekiStok, yeniStok, not_metni FROM islemler ORDER BY id ASC')
    .all();
  const satirlar = rows.map((r) => [
    yerelTarih(r.tarih),
    TIP_ETIKET[r.tip] || r.tip,
    r.barkod,
    r.urun,
    r.adet,
    r.oncekiStok,
    r.yeniStok,
    r.not_metni || '',
  ]);
  await yazTablo('Islemler', BASLIK_ISLEM, satirlar);
}

// Tek bir islemi 'Islemler' sekmesine ekle (verimli — tum tabloyu yeniden yazmaz)
async function appendIslem(i) {
  if (!aktif) return;
  await ensureSheet('Islemler');
  const mevcut = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Islemler!A1:H1' });
  if (!mevcut.data.values || !mevcut.data.values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Islemler!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [BASLIK_ISLEM] },
    });
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Islemler!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        yerelTarih(i.tarih),
        TIP_ETIKET[i.tip] || i.tip,
        i.barkod,
        i.urun,
        i.adet,
        i.oncekiStok,
        i.yeniStok,
        i.not || '',
      ]],
    },
  });
}

async function syncAll() {
  if (!aktif) return;
  await syncStok();
  await syncIslemler();
  await syncCalisanlar();
}

function yerelTarih(iso) {
  try {
    return new Date(iso).toLocaleString('tr-TR');
  } catch (e) {
    return String(iso);
  }
}

module.exports = { init, isAktif, syncStok, syncCalisanlar, syncIslemler, appendIslem, syncAll };
