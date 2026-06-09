# Ki Stok Sistemi

Barkod tabanli depo / stok yonetim sistemi. Node.js + Express + SQLite backend ile kalici veri saklama.

## Ozellikler

- 📡 Barkod okutarak hizli cikis (Hediye / Satis / Depo Satisi)
- 📋 Tum cikis gecmisi, filtre ve arama
- 📦 Stok takibi (kritik stok uyarilari)
- 👤 Calisan bazli stok gorunumu
- 📂 Excel'den toplu stok yukleme
- ⬇ Excel rapor indirme (stok + islem gecmisi)
- 📷 Mobilde kamera ile barkod/QR okutma
- 🔄 Google Sheets senkronizasyonu (opsiyonel)
- 🔒 Sifre korumali giris
- 💾 SQLite ile kalici veritabani (sunucu yeniden baslasa da veriler korunur)

## Yerelde Calistirma

> Node.js **24+** gereklidir (yerlesik `node:sqlite` icin).

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# .env dosyasini duzenleyip APP_PASSWORD ve SECRET degerlerini ayarlayin
npm start
```

Tarayicidan `http://localhost:3000` adresine gidin.

## Teknoloji

- **Backend:** Node.js 24+ (Express)
- **Veritabani:** SQLite (yerlesik `node:sqlite` modulu — native bagimlilik yok)
- **Frontend:** Saf HTML/CSS/JS (public/index.html)

## Google Sheets Senkronizasyonu (opsiyonel)

Verileri canli olarak bir Google Sheets tablosuna yansitmak icin
`SHEETS-KURULUM.md` adimlarini izleyin. Yapilandirilmazsa uygulama
yalnizca SQLite ile sorunsuz calisir.

## VPS'e Kurulum

Adim adim kurulum talimati icin `VPS-KURULUM.md` dosyasina bakin
(bu dosya `.gitignore` icindedir, repoda yer almaz).

## API Uc Noktalari

| Metot | Yol | Aciklama |
|-------|-----|----------|
| POST | `/api/login` | Giris, token doner |
| GET  | `/api/stoklar` | Stok listesi |
| POST | `/api/stoklar/import` | Excel'den toplu stok yukleme |
| GET  | `/api/calisanlar` | Calisan stok listesi |
| GET  | `/api/islemler` | Islem gecmisi |
| POST | `/api/islem` | Stok cikisi yap |

> `/api/login` disindaki tum uc noktalar `Authorization: Bearer <token>` basligi gerektirir.
