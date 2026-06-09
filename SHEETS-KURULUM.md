# Google Sheets Senkronizasyon Kurulumu

Bu adimlar tamamlaninca, uygulamadaki **Stok / Islemler / Calisan** verileri
otomatik olarak Google Sheets tablonuza yazilir (SQLite ana kaynak, Sheets canli ayna).

> Bu kurulum **opsiyoneldir**. Yapmazsaniz uygulama yine calisir, sadece Sheets
> senkronu kapali kalir.

Senkronize edilecek tablo:
`https://docs.google.com/spreadsheets/d/1ki977CyQC2TJMlGqb-cQ1WWE9WIyChQbDlAi7xjQuO0/edit`

---

## 1. Google Cloud projesi olustur

1. https://console.cloud.google.com/ adresine girin (Google hesabinizla).
2. Ust soldaki proje secicisinden **New Project** → bir isim verin (orn. `ki-stok`) → **Create**.

## 2. Google Sheets API'yi etkinlestir

1. Sol menu → **APIs & Services → Library**.
2. Arama kutusuna **Google Sheets API** yazin → tiklayin → **Enable**.

## 3. Service Account (servis hesabi) olustur

1. Sol menu → **APIs & Services → Credentials**.
2. Ust kisim → **Create Credentials → Service account**.
3. Isim verin (orn. `ki-stok-sync`) → **Create and Continue** → **Done**.

## 4. JSON anahtar dosyasini indir

1. **Credentials** sayfasinda olusturdugunuz service account'a tiklayin.
2. **Keys** sekmesi → **Add Key → Create new key** → tip **JSON** → **Create**.
3. Bilgisayariniza bir `.json` dosyasi iner. Bu dosya **gizlidir, kimseyle paylasmayin**.
4. Bu dosyayi proje klasorune kopyalayip adini **`google-credentials.json`** yapin.
   (Bu dosya `.gitignore` icindedir, repoya gonderilmez.)

## 5. Service account e-postasini tabloya yetkilendir

1. Indirdiginiz JSON dosyasini acin; icinde `"client_email": "...@....iam.gserviceaccount.com"`
   satirini bulun. Bu e-posta adresini kopyalayin.
2. Google Sheets tablonuzu acin → sag ustte **Share / Paylas**.
3. Kopyaladiginiz service account e-postasini yapistirin, yetki **Editor / Duzenleyici**
   secin → **Send / Gonder**.

> ⚠️ Bu adim atlanirsa "permission" / "caller does not have permission" hatasi alirsiniz.

## 6. .env ayarlarini yap

`.env` dosyasinda sunlarin dolu oldugundan emin olun:

```
GOOGLE_SHEET_ID=1ki977CyQC2TJMlGqb-cQ1WWE9WIyChQbDlAi7xjQuO0
GOOGLE_CREDENTIALS_PATH=./google-credentials.json
```

> `GOOGLE_SHEET_ID` zaten `.env.example` icinde dolu gelir. Dosya yolunu degistirdiyseniz
> `GOOGLE_CREDENTIALS_PATH` satirini guncelleyin.

## 7. Yeniden baslat ve test et

```bash
npm start
```

Aciliste su satiri gormelisiniz:

```
[Sheets] Senkronizasyon AKTIF (sheet: 1ki977...).
```

Uygulamada sag ustteki **🔄 Sheets** butonuna basin → tablonuzda
**Stok**, **Islemler**, **Calisan** sekmelerinin olusup dolduguunu gorun.

Bundan sonra her barkod cikisi ve Excel yuklemesi otomatik olarak tabloya yansir.

---

## VPS'te kullanim

1. `google-credentials.json` dosyasini sunucuya guvenli sekilde kopyalayin
   (kendi bilgisayarinizdan):

   ```powershell
   scp google-credentials.json kistok@SUNUCU_IP:/home/kistok/ki-stok-sistemi/
   ```

2. Sunucudaki `.env` icine `GOOGLE_SHEET_ID` ve gerekiyorsa `GOOGLE_CREDENTIALS_PATH`
   ekleyin.
3. `pm2 restart ki-stok` ile yeniden baslatin.

---

## Sorun Giderme

| Hata | Cozum |
|------|-------|
| `senkronizasyon KAPALI` | `.env` icinde `GOOGLE_SHEET_ID` bos ya da `google-credentials.json` yok |
| `caller does not have permission` | Tabloyu service account e-postasiyla **Editor** olarak paylasmadiniz (Adim 5) |
| `Google Sheets API has not been used` | Adim 2'de API'yi etkinlestirmediniz |
| `invalid_grant` / kimlik hatasi | JSON dosyasi bozuk; Adim 4'te yeni anahtar olusturup tekrar indirin |

---

## Nasil calisir? (kisa ozet)

- **SQLite** her zaman ana veri kaynagidir (hizli, guvenilir).
- Her stok cikisi / Excel yuklemesinde ilgili veriler **arka planda** Sheets'e yazilir;
  Sheets'e ulasilamazsa uygulama yine sorunsuz calisir (sadece o senkron atlanir).
- **🔄 Sheets** butonu tum tabloyu bastan yazarak elle tam senkron yapar.
- Yon: **Veritabani → Sheets** (tek yon). Sheets uzerinde elle yapilan degisiklikler
  veritabanina geri donmez; toplu stok degisikligi icin **📂 Excel Yukle** kullanin.
