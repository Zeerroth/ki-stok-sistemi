'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Veritabani dosyasi yolu (.env ile degistirilebilir, varsayilan: ./data/ki-stok.db)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'ki-stok.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA journal_mode = WAL;');
raw.exec('PRAGMA foreign_keys = ON;');

// ===== better-sqlite3 uyumlu ince sarmalayici =====
// (node:sqlite uzerine prepare/exec/pragma/transaction saglar)
const db = {
  prepare(sql) {
    return raw.prepare(sql);
  },
  exec(sql) {
    return raw.exec(sql);
  },
  pragma(str) {
    return raw.exec('PRAGMA ' + str + ';');
  },
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const sonuc = fn(...args);
        raw.exec('COMMIT');
        return sonuc;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    };
  },
};

// ===== SEMA =====
db.exec(`
  CREATE TABLE IF NOT EXISTS stoklar (
    barkod   TEXT PRIMARY KEY,
    urun     TEXT NOT NULL,
    kategori TEXT NOT NULL DEFAULT 'Genel',
    stok     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS calisanlar (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    calisan TEXT NOT NULL,
    barkod  TEXT NOT NULL,
    urun    TEXT NOT NULL,
    stok    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS islemler (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tarih      TEXT NOT NULL,
    barkod     TEXT NOT NULL,
    urun       TEXT NOT NULL,
    tip        TEXT NOT NULL,
    adet       INTEGER NOT NULL,
    not_metni  TEXT DEFAULT '',
    oncekiStok INTEGER NOT NULL,
    yeniStok   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ayarlar (
    anahtar TEXT PRIMARY KEY,
    deger   TEXT NOT NULL
  );
`);

// ===== BASLANGIC VERISI (sadece tablo bossa) =====
const stokSayisi = db.prepare('SELECT COUNT(*) AS c FROM stoklar').get().c;
if (stokSayisi === 0) {
  const seedStok = db.prepare(
    'INSERT INTO stoklar (barkod, urun, kategori, stok) VALUES (?, ?, ?, ?)'
  );
  const stoklar = [
    ['8685073100004', 'Ki Magnezyum ve Hayit Iceren Takviye Edici Gida 10 Sase', 'Takviye', 5919],
    ['8685073100011', 'Ki Genistein Iceren Takviye Edici Gida 30 Kapsul', 'Takviye', 6400],
    ['8685073100066', 'ki Intim Bakim Spreyi 100 mL', 'Bakim', 2000],
    ['8685073100028', 'ki Daily.care Intim Yikama Jeli 150 mL', 'Bakim', 2000],
    ['8685073100035', 'ki Sens.care Intim Yikama Jeli 150 mL', 'Bakim', 2000],
    ['8685073100042', 'ki 50+.care Intim Yikama Jeli 150 mL', 'Bakim', 2000],
    ['8685073100059', 'ki Flow.care Intim Yikama Jeli 150 mL', 'Bakim', 2000],
  ];
  const tx = db.transaction((rows) => rows.forEach((r) => seedStok.run(...r)));
  tx(stoklar);
}

const calisanSayisi = db.prepare('SELECT COUNT(*) AS c FROM calisanlar').get().c;
if (calisanSayisi === 0) {
  const seedCalisan = db.prepare(
    'INSERT INTO calisanlar (calisan, barkod, urun, stok) VALUES (?, ?, ?, ?)'
  );
  const calisanlar = [
    ['Cenk', '8685073100011', 'Ki Genistein Iceren Takviye Edici Gida 30 Kapsul', 16],
    ['Cenk', '8685073100004', 'Ki Magnezyum ve Hayit Iceren Takviye Edici Gida 10 Sase', 12],
    ['Berker', '8685073100011', 'Ki Genistein Iceren Takviye Edici Gida 30 Kapsul', 20],
    ['Berker', '8685073100004', 'Ki Magnezyum ve Hayit Iceren Takviye Edici Gida 10 Sase', 20],
  ];
  const tx = db.transaction((rows) => rows.forEach((r) => seedCalisan.run(...r)));
  tx(calisanlar);
}

module.exports = db;
