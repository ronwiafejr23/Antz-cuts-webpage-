/* ==========================================================================
   server.js — Antz Cuts local server + PayPal sandbox deposits

   Why a server? PayPal needs a SECRET key to create and capture payments.
   A secret can never live in browser code (anyone could read it), so this
   small Node server keeps it in .env and talks to PayPal for the page.

   Run:   npm start      then open http://localhost:3000
   Needs: Node 18+ (uses the built-in fetch), no npm packages.
   ========================================================================== */

const http = require("http");
const fs = require("fs");
const path = require("path");

/* ---------- load .env (tiny parser, so no dotenv package needed) ---------- */
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

// The deposit is set HERE on the server, never by the browser,
// so nobody can edit the page and pay $0.01 instead.
const DEPOSIT = "5.00";
const CURRENCY = "USD";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn("⚠  PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing. Copy .env.example to .env and fill them in.");
}

/* ---------- PayPal helpers ---------- */

async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed: ${data.error_description || res.status}`);
  return data.access_token;
}

async function paypal(method, endpoint, body) {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `PayPal error ${res.status}`);
  return data;
}

function createDepositOrder(booking) {
  const summary = `${booking.service || "Haircut"} - ${booking.date || ""} ${booking.time || ""}`.slice(0, 120);
  return paypal("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{
      description: `Antz Cuts deposit: ${summary}`.slice(0, 127),
      amount: { currency_code: CURRENCY, value: DEPOSIT },
    }],
  });
}

async function captureOrder(orderId, booking) {
  const data = await paypal("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  const paid = data.status === "COMPLETED" && capture?.amount?.value === DEPOSIT;

  if (paid) {
    // Keep a record of paid deposits so Anthony has a list on the server.
    const logFile = path.join(__dirname, "deposits.json");
    let log = [];
    try { log = JSON.parse(fs.readFileSync(logFile, "utf8")); } catch { }
    log.push({ orderId, captureId: capture.id, amount: DEPOSIT, payer: data.payer?.email_address, booking, paidAt: new Date().toISOString() });
    fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
  }
  return { paid, status: data.status, orderId, captureId: capture?.id, amount: capture?.amount?.value };
}

/* ---------- tiny static file server ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".ico": "image/x-icon",
};
// Never serve these over the web.
const PRIVATE = new Set([".env", ".env.example", "server.js", "package.json", "deposits.json"]);

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(__dirname, urlPath === "/" ? "index.html" : urlPath));
  const name = path.basename(file);
  if (!file.startsWith(__dirname) || PRIVATE.has(name) || name.startsWith(".")) {
    res.writeHead(404); return res.end("Not found");
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

function readJson(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/* ---------- routes ---------- */

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/config") {
      // The client ID is public by design; the secret never leaves this file.
      return sendJson(res, 200, { clientId: CLIENT_ID || null, deposit: DEPOSIT, currency: CURRENCY });
    }
    if (req.method === "POST" && req.url === "/api/orders") {
      const { booking = {} } = await readJson(req);
      const order = await createDepositOrder(booking);
      return sendJson(res, 200, { id: order.id });
    }
    const cap = req.url.match(/^\/api\/orders\/([A-Za-z0-9-]+)\/capture$/);
    if (req.method === "POST" && cap) {
      const { booking = {} } = await readJson(req);
      return sendJson(res, 200, await captureOrder(cap[1], booking));
    }
    if (req.method === "GET") return serveStatic(req, res);
    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`Antz Cuts running at http://localhost:${PORT}  (PayPal ${PAYPAL_API.includes("sandbox") ? "SANDBOX" : "LIVE"})`);
});
