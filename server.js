/* ==========================================================================
   server.js — Antz Cuts local server + PayPal sandbox deposits

   Why I added a server: PayPal needs a SECRET key to create and capture
   payments, and a secret can never live in browser code (anyone could read
   it). So I keep it in .env here and this small Node server talks to PayPal
   and Gemini for the page.

   Run:   npm start      then open http://localhost:3000
   Needs: Node 18+ (uses the built-in fetch), no npm packages.
   ========================================================================== */

const http = require("http");
const fs = require("fs");
const path = require("path");

/* ---------- load .env (I wrote a tiny parser so I don't need dotenv) ---------- */
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

// I set the prices HERE on the server, never in the browser,
// so nobody can edit the page and pay $0.01 instead.
const DEPOSIT = "5.00";
const MEMBERSHIP = "85.00";       // Unlimited Haircuts Membership, one-time 30-day pass
const MEMBERSHIP_DAYS = 30;
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

function appendLog(file, entry) {
  const logFile = path.join(__dirname, file);
  let log = [];
  try { log = JSON.parse(fs.readFileSync(logFile, "utf8")); } catch { }
  log.push(entry);
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
}

// I capture the approved order and check PayPal took exactly the amount I expect.
async function capture(orderId, expected) {
  const data = await paypal("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
  const cap = data.purchase_units?.[0]?.payments?.captures?.[0];
  const paid = data.status === "COMPLETED" && cap?.amount?.value === expected;
  return { data, cap, paid };
}

async function captureOrder(orderId, booking) {
  const { data, cap, paid } = await capture(orderId, DEPOSIT);
  if (paid) {
    // I keep a record of paid deposits so Anthony has a list on the server.
    appendLog("deposits.json", { orderId, captureId: cap.id, amount: DEPOSIT, payer: data.payer?.email_address, booking, paidAt: new Date().toISOString() });
  }
  return { paid, status: data.status, orderId, captureId: cap?.id, amount: cap?.amount?.value };
}

/* ---------- Unlimited Haircuts Membership ($85 / 30 days) ---------- */

function createMembershipOrder(member) {
  return paypal("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{
      description: `Antz Cuts Unlimited Haircuts Membership (${MEMBERSHIP_DAYS} days) - ${member.name || ""}`.slice(0, 127),
      amount: { currency_code: CURRENCY, value: MEMBERSHIP },
    }],
  });
}

async function captureMembership(orderId, member) {
  const { data, cap, paid } = await capture(orderId, MEMBERSHIP);
  let start, expires;
  if (paid) {
    start = new Date();
    expires = new Date(start.getTime() + MEMBERSHIP_DAYS * 24 * 60 * 60 * 1000);
    appendLog("memberships.json", {
      orderId, captureId: cap.id, amount: MEMBERSHIP, payer: data.payer?.email_address,
      name: member.name, phone: member.phone, start: start.toISOString(), expires: expires.toISOString(),
    });
  }
  return { paid, status: data.status, orderId, captureId: cap?.id, amount: cap?.amount?.value,
           start: start?.toISOString(), expires: expires?.toISOString() };
}

/* ---------- AI booking assistant (Google Gemini) ----------
   The customer types something like "fade for my son friday after 5".
   I have Gemini turn it into structured booking intent (service, day, time
   rule, name, phone) plus a short friendly reply. Then my browser code
   matches that intent against REAL open slots, so the AI can never
   double-book a chair. I always finish with a PayPal payment (deposit or
   membership). */

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const ASSISTANT_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply:     { type: "STRING", description: "1-3 short, friendly sentences to show the customer." },
    action:    { type: "STRING", enum: ["none", "book", "join_membership"] },
    serviceId: { type: "STRING", description: "One of the service ids, or empty." },
    date:      { type: "STRING", description: "YYYY-MM-DD, or empty if the customer didn't say a day." },
    time:      { type: "STRING", description: "HH:MM 24-hour, or empty." },
    timeRule:  { type: "STRING", enum: ["", "exact", "after", "before", "earliest", "latest"] },
    name:      { type: "STRING", description: "Customer's name if they gave it, else empty." },
    phone:     { type: "STRING", description: "Customer's phone if they gave it, else empty." },
  },
  required: ["reply", "action", "serviceId", "date", "time", "timeRule", "name", "phone"],
};

function assistantPrompt(ctx) {
  const services = (ctx.services || []).slice(0, 20)
    .map(s => `- ${s.id}: ${s.name}, ${s.price}, ${s.minutes} min${s.covered ? " (covered by membership)" : ""}`).join("\n");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const hours = days.map((d, i) => {
    const h = ctx.hours && ctx.hours[i];
    return `- ${d}: ${h ? `${h.open}-${h.close}` : "closed"}`;
  }).join("\n");
  return `You are the booking assistant for Antz Cuts, Anthony Williams' barbershop.
Today is ${String(ctx.today || "").slice(0, 40)} (customer's local time ${String(ctx.now || "").slice(0, 10)}).

Services (id: name, price, length):
${services}

Weekly hours:
${hours}

Payments (PayPal):
- Every booking is held with a $${DEPOSIT} PayPal deposit that comes off the cut. It protects against no-shows.
- Unlimited Haircuts Membership: $${Number(MEMBERSHIP)} paid once through PayPal for ${MEMBERSHIP_DAYS} days of unlimited haircuts.
  Members' haircuts skip the deposit. On the 5th cut it's still free when they bring someone with them to the appointment.

Rules:
- If the customer wants an appointment, set action "book". Pick the closest serviceId (kids = 11 and under, adult = 12+,
  "fade", "lineup", "trim" or a plain "haircut" = adult unless it's for a child; "first time" = first).
- Resolve relative days ("tomorrow", "friday", "next week") to a YYYY-MM-DD date on or after today.
  "this weekend" = the next open weekend day.
- Times: "after 5" -> time 17:00, timeRule "after". "at 6:30" -> 18:30 "exact". "morning" -> 12:00 "before".
  "evening" -> 17:00 "after". "asap"/"soonest"/no time -> timeRule "earliest". Leave time empty when not given.
- If they ask about joining, unlimited cuts or a membership, set action "join_membership" and briefly explain it.
- For questions (prices, hours, policy), answer with action "none". Never invent services, prices or hours.
- Don't promise a specific slot is free; the website checks real availability and will confirm.
- Keep replies short, warm and casual. No markdown.`;
}

// I added a small in-memory rate limit so a public demo can't burn my API key.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), windowMs = 10 * 60 * 1000, max = 40;
  const list = (hits.get(ip) || []).filter(t => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

async function askAssistant({ message, history = [], context = {} }) {
  if (!GEMINI_KEY) throw Object.assign(new Error("The AI assistant isn't set up yet (GEMINI_API_KEY missing)."), { status: 503 });
  const text = String(message || "").trim().slice(0, 500);
  if (!text) throw Object.assign(new Error("Empty message"), { status: 400 });

  const contents = history.slice(-8)
    .filter(h => h && (h.role === "user" || h.role === "model") && h.text)
    .map(h => ({ role: h.role, parts: [{ text: String(h.text).slice(0, 600) }] }));
  contents.push({ role: "user", parts: [{ text }] });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: assistantPrompt(context) }] },
      contents,
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: ASSISTANT_SCHEMA },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Gemini error:", data.error || res.status);
    throw Object.assign(new Error("The AI assistant is busy right now. Try again in a moment."), { status: 502 });
  }
  const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "{}";
  let out;
  try { out = JSON.parse(raw); } catch { out = { reply: raw, action: "none" }; }
  return out;
}

/* ---------- tiny static file server ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
// I never serve these over the web.
const PRIVATE = new Set([".env", ".env.example", "server.js", "package.json", "deposits.json", "memberships.json", "start-server.bat", "render.yaml"]);

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
      // The client ID is public by design; I never let the secret leave this file.
      return sendJson(res, 200, { clientId: CLIENT_ID || null, deposit: DEPOSIT, membership: MEMBERSHIP, membershipDays: MEMBERSHIP_DAYS, currency: CURRENCY, assistant: Boolean(GEMINI_KEY) });
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
    if (req.method === "POST" && req.url === "/api/membership/orders") {
      const { member = {} } = await readJson(req);
      const order = await createMembershipOrder(member);
      return sendJson(res, 200, { id: order.id });
    }
    const mem = req.url.match(/^\/api\/membership\/orders\/([A-Za-z0-9-]+)\/capture$/);
    if (req.method === "POST" && mem) {
      const { member = {} } = await readJson(req);
      return sendJson(res, 200, await captureMembership(mem[1], member));
    }
    if (req.method === "POST" && req.url === "/api/assistant") {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
      if (rateLimited(ip)) return sendJson(res, 429, { error: "Too many messages. Take a breather and try again in a few minutes." });
      return sendJson(res, 200, await askAssistant(await readJson(req)));
    }
    if (req.method === "GET") return serveStatic(req, res);
    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    sendJson(res, err.status || 500, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`Antz Cuts running at http://localhost:${PORT}  (PayPal ${PAYPAL_API.includes("sandbox") ? "SANDBOX" : "LIVE"}, AI ${GEMINI_KEY ? GEMINI_MODEL : "off - add GEMINI_API_KEY to .env"})`);
});
