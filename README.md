# KAP Bildirim Mail — Rehber 9.8 açıklamaları

Her iş günü 09:30'da (İstanbul) KAP'ta **"Yatırım Fonlarına İlişkin Rehberin 9.8. maddesi gereğince yapılan açıklama"** başlığıyla yayımlanan, son gönderimden bu yana çıkmış **tüm bildirimleri** bulur, eklerini indirir ve tek bir mailde gönderir. Bildirim numarası her gün değiştiği için numaraya değil başlığa göre arar.

## Mail nasıl görünür
- Konu: `KAP | Rehber 9.8 açıklamaları — 16.10.2026 (5 bildirim)`
- Her bildirim için bir kart: fon kodu ve adı, portföy şirketi, yayın saati, KAP linki, açıklama metni.
- Excel ekleri mailin içinde tablo olarak da gösterilir (ilk 60 satır); tüm ekler dosya olarak mailde, `FONKODU_dosyaadi` şeklinde adlandırılmış.
- O gün yeni bildirim yoksa "yeni bildirim yok" diye kısa bir mail gider (`SEND_EMPTY=false` yaparsan hiç gitmez).
- Toplam ek 18 MB'ı geçerse fazlası eklenmez, KAP linkinden açılır.

## Nasıl çalışır
1. İlk çalışmada örnek bildirimden (1682456) bu başlığın KAP'taki konu kimliğini öğrenir ve saklar.
2. Her sabah son çalışmadan şu ana kadar o konudaki tüm fon bildirimlerini çeker. Pazartesi sabahı cuma 09:30'dan beri çıkanları kapsar.
3. Daha önce gönderilenleri tekrar göndermez.

## Kurulum (Node gerekmez, hepsi tarayıcıdan)
1. **GitHub:** Yeni bir repo aç (ör. `kap-bildirim-mail`), "Add file → Upload files" ile bu klasörün içeriğini yükle.
2. **Netlify:** Add new site → Import from Git → bu repoyu seç. Ayarlar `netlify.toml`'dan gelir.
3. **Gmail uygulama şifresi:** Google Hesabı → Güvenlik → 2 Adımlı Doğrulama açık → "Uygulama şifreleri" → 16 haneli şifre.
4. **Netlify → Site configuration → Environment variables:**

| Değişken | Örnek | Açıklama |
|---|---|---|
| `GMAIL_USER` | `ad@gmail.com` | Gönderen Gmail adresi |
| `GMAIL_APP_PASSWORD` | `abcd efgh ijkl mnop` | 3. adımdaki şifre |
| `RECIPIENTS` | `a@osmanli.com, b@osmanli.com` | Virgülle ayrılmış alıcılar |
| `ADMIN_KEY` | uzun rastgele bir metin | **Zorunlu**: sabah tetiklemesi ve test linkleri bununla çalışır |
| `USE_BCC` | `true` (varsayılan) | Alıcılar birbirini görmesin |
| `SEND_EMPTY` | `true` (varsayılan) | Yeni bildirim yoksa da kısa mail at |
| `SUBJECT_OID` | — | Konu kimliği otomatik bulunamazsa elle girilir |

Değişkenleri ekledikten sonra Deploys → "Trigger deploy".

## Kontrol
- **Deneme, mail atmaz:** `https://SITE.netlify.app/api/test?key=ADMIN_KEY`
- **Gidecek mailin görünümü:** `https://SITE.netlify.app/api/test?key=ADMIN_KEY&html=1`
- **Şimdi gönder:** `https://SITE.netlify.app/api/send-now?key=ADMIN_KEY`
- **Son çalışma kaydı:** `https://SITE.netlify.app/api/status?key=ADMIN_KEY`

## Saat / gün
`netlify/functions/daily.mjs` → `schedule: "30 6 * * 1-5"` (UTC 06:30 = İstanbul 09:30, hafta içi). Hafta sonu için `1-5` → `*`.

## Not
KAP'ın web sitesinin kullandığı API'ler resmi dokümante değil; değişirse `lib/kap.mjs` güncellenmeli. Günde birkaç istek atar.
