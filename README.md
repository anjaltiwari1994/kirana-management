# Kirana Management 🫙

Ghar ka kirana stock, expiry alerts aur shopping list — iPhone aur Android dono pe app jaisa.

- **App** (`index.html`) — GitHub Pages pe chalti hai, "Add to Home Screen" karke full-screen app
- **Data** — tumhari Google Sheet (`Items` tab)
- **Backend + Telegram bot** (`apps-script/Code.gs`) — Sheet ke Apps Script mein
- **Alert** — roz 4:30 PM, Telegram group mein

## Alert kitne din pehle aata hai (auto)

| Item kitne din chalta hai | Alert |
|---|---|
| 7 din tak | 1 din pehle |
| 8 din – 1 mahina | 3 din pehle |
| 1 – 6 mahine | 1 hafta pehle |
| 6 mahine se zyada | 1 mahina pehle |

Har item ke liye app mein badal bhi sakte ho. Har item ka alert ek baar aata hai jab window shuru ho, ek baar aakhri din, aur ek baar expire hone pe.

## Telegram commands

| Likho | Kya hoga |
|---|---|
| `atta 5kg 20/12/2026` | item add |
| `doodh 1L 3din` | expiry 3 din baad (`2hafte`, `6mahine`, `1saal`, `20 dec` bhi chalega) |
| `list` | poora stock |
| `jaldi` | jo jaldi expire hoga |
| `khatam atta` | khatam → shopping list |
| `shopping` | kya lana hai |

Bot har minute naye messages check karta hai, isliye reply mein ~1 minute lag sakta hai.

## Setup (ek baar)

### 1. Google Sheet
1. Sheet kholo → **Extensions → Apps Script**
2. Jo code pehle se hai, sab hata do. `apps-script/Code.gs` ka poora code paste karo
3. Upar ki 2 lines bharo: `TELEGRAM_TOKEN` (BotFather wala) aur `APP_KEY` (apna family code)
4. **Save** (💾), phir upar function list mein `setup` chuno → **Run**
5. Permission maangega → **Review permissions** → apna account → **Advanced → Go to … (unsafe)** → **Allow**
   (ye tumhara khud ka code hai, isliye Google "unverified" bolta hai)
6. **Deploy → New deployment** → ⚙️ type **Web app** → Execute as: **Me** → Who has access: **Anyone** → **Deploy**
7. Jo **Web app URL** mile (`…/exec` pe khatam), use copy kar lo

### 2. Telegram
1. Bot ko family group mein add karo, aur use **admin** bana do (taaki saare messages padh sake)
2. Group mein `/start` bhejo — 1 minute mein bot "jud gaya" bolega

### 3. App
1. App ka link kholo, Web app URL + family code + apna naam daalo
2. Safari (iPhone): Share → **Add to Home Screen** · Chrome (Android): ⋮ → **Add to Home screen / Install app**
3. Settings (⚙️) → **Setup link share karo** → wife ko bhejo, unka phone seedha set ho jaayega

## Code badla toh
Apps Script mein code update kiya ho toh **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (URL wahi rahega).
