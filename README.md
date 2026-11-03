<p align="center"><img src="icons/logo.png" width="140" alt="Antz Cuts logo"></p>

# Antz Cuts: AI booking + PayPal for a neighborhood barbershop

Book a cut by chatting. **Google Gemini** works out what you want ("fade for my son Friday after 5"), the site finds a **real open chair**, and **PayPal** holds it with a $5 no-show deposit, or with an **$85 Unlimited Haircuts Membership**. It installs to a phone's home screen like an app.

**▶ Live demo:** https://antz-cuts.onrender.com (free hosting sleeps when idle, so the first load can take ~30 seconds)
**▶ Video (under 3 min):** `ADD-YOUR-YOUTUBE-LINK-HERE`

---

## Try it as a judge (2 minutes)

1. Open the live demo and go to **Book Now**.
2. In **Book by chatting**, tap *Fade Friday after 5* or type your own request.
3. The assistant fills in the service, day and time with a real open slot. Add a name and 10-digit phone, then **Continue to Deposit**.
4. Pay the $5 deposit with the PayPal sandbox buyer below. The booking confirms with the PayPal order ID.
5. Tap the gold **Unlimited Haircuts Membership** card, pay $85 in sandbox, then book again: haircuts 1–4 skip the deposit, and the 5th is free when you bring someone.

**PayPal sandbox buyer (test account, fake money, no real charges):**
- Email: `sb-e5dzb53696369@personal.example.com`
- Password: `HH!J$Cq2`

## Features

| | |
|---|---|
| **AI booking assistant** | Gemini turns plain language into structured intent (service, date, time rule, name, phone) using JSON-schema output. The browser matches it against real availability, so the AI can't double-book or invent a time. It also answers questions about prices, hours and the membership. |
| **PayPal no-show deposits** | $5 deposit via PayPal Orders v2 (create + capture on the server). A booking confirms only after PayPal returns `COMPLETED` for the exact amount. |
| **Unlimited Haircuts Membership** | $85 one-time 30-day pass through PayPal. Members' haircuts skip the deposit; from the 5th cut on they stay free when bringing a guest. |
| **Installable app (PWA)** | Manifest, icons and an offline-friendly service worker. "Install app" button on Chrome/Edge/Android; Share → Add to Home Screen on iPhone. |
| **Secure by design** | PayPal secret and Gemini key live only on the server (`.env` / Render env vars). Prices are set server-side. The AI endpoint is rate-limited. |

## How it works

```
Customer ──chat──▶ book.html ──POST /api/assistant──▶ server.js ──▶ Google Gemini
                     │  ◀── intent JSON (service, date, time rule) ──┘
                     │  match intent to REAL open slots (booking.js)
                     ▼
              PayPal Buttons ──POST /api/orders──────────▶ server.js ──▶ PayPal Orders v2 (create)
                             ──POST /api/orders/:id/capture▶ server.js ──▶ PayPal (capture, verify amount)
                     ▼
              Booking confirmed + "Send to Anthony" email
```

## Run it locally

Needs **Node.js 18+**. There are no npm packages to install.

```bash
git clone https://github.com/ronwiafejr23/Ant-s-cuts-webpage-.git
cd Ant-s-cuts-webpage-
cp .env.example .env        # Windows: copy .env.example .env
```

Fill in `.env`:

| Key | Where to get it (free) |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → **Sandbox** → Create App |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API key |

```bash
npm start
```

Open **http://localhost:3000/book.html**. To pay, log in to the PayPal popup with a sandbox **personal** account (developer.paypal.com → Testing Tools → Sandbox Accounts).

On Windows you can also double-click `start-server.bat`.

## Deploy to Render

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint** → pick this repo. `render.yaml` sets everything up.
3. Paste `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `GEMINI_API_KEY` when Render asks.
4. Open the `https://antz-cuts-….onrender.com` URL. Free instances sleep after inactivity, so the first load can take ~30 seconds.

## Files

```
index.html  about.html  contact.html  style-finder.html  book.html   pages
styles.css                  shared styles
booking.js                  booking flow, AI chat, PayPal buttons, membership
server.js                   static server + PayPal Orders API + Gemini (holds the secrets)
app.js, sw.js, manifest.webmanifest, icons/   installable app
render.yaml                 one-click Render deploy
.env.example                template for your keys
```

## Built during the hackathon

The original Antz Cuts site was a static course project: pages plus a booking calendar that only saved to the browser. During the submission period it gained the Gemini booking assistant, the server, PayPal deposits, the PayPal membership, the installable app and the Render deploy.

## License

[MIT](LICENSE)
