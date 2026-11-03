# Antz Cuts

Website for **Antz Cuts**, Anthony Williams' barbershop: home, about, contact, a style finder, and an online booking page.

## Booking + PayPal deposits

`book.html` walks a client through 5 steps:

1. Choose a service
2. Pick a day
3. Pick a time (only open slots show)
4. Name + phone
5. **Pay a $5 deposit with PayPal** to hold the spot (no-show protection)

The booking is confirmed only after PayPal says the payment is `COMPLETED`.

### How the payment is kept safe

| Piece | Where it lives | Why |
|---|---|---|
| PayPal **client ID** | sent to the browser by `/api/config` | public by design |
| PayPal **secret** | `.env` on the server only | never in browser code or on GitHub (`.env` is in `.gitignore`) |
| Deposit amount | `server.js` (`DEPOSIT`) | the browser can't change what gets charged |

`server.js` creates the order (`POST /v2/checkout/orders`) and captures it (`POST /v2/checkout/orders/:id/capture`). Paid deposits are logged to `deposits.json` (also git-ignored).

## Run it

Needs [Node.js](https://nodejs.org) 18 or newer. No `npm install` needed.

```bash
cp .env.example .env      # Windows: copy .env.example .env
# paste your PayPal sandbox Client ID and Secret into .env
npm start
```

Open **http://localhost:3000/book.html**.

To test a payment, log in to the PayPal popup with a **sandbox personal (buyer) account** from developer.paypal.com → Testing Tools → Sandbox Accounts. No real money moves in sandbox.

> Opening the site with VS Code Live Server still works for the pages, but the deposit step needs `npm start`. Under Live Server it shows a "Book without deposit" fallback.

## Files

```
index.html  about.html  contact.html  style-finder.html  book.html
styles.css       shared styles
booking.js       booking page logic + PayPal buttons
server.js        static server + PayPal API (holds the secret)
.env.example     template for your keys
```
