/* ==========================================================================
   booking.js — Antz Cuts booking page
   Powers book.html: pick a service -> pick a day -> pick a time -> details.

   Bookings are saved in this browser's localStorage (prototype only), so
   Anthony can't see them from his own phone. That's why the confirmation
   screen has a "Send to Anthony" button that opens a pre-filled email.
   ========================================================================== */

/* ---------- SETTINGS (edit these) ---------- */

const BARBER_EMAIL = "antscutz@gmail.com";
const SLOT_MINUTES = 30;
const DAYS_AHEAD = 60;            // how far ahead people can book

// Weekly hours. 0 = Sunday ... 6 = Saturday. null = closed.
const WEEKLY_HOURS = {
  0: { open: "08:30", close: "21:30" },
  1: { open: "08:35", close: "21:30" },
  2: { open: "16:35", close: "21:30" },
  3: { open: "14:35", close: "17:00" },
  4: { open: "16:35", close: "21:30" },
  5: { open: "14:35", close: "17:00" },
  6: null,
};

const SERVICES = [
  { id: "first",   name: "First Haircut (new clients)", price: "$5",     minutes: 30 },
  { id: "adult",   name: "Adult Haircut (12+)",         price: "$20",    minutes: 30 },
  { id: "kids",    name: "Kids Haircut (11 & under)",   price: "$15",    minutes: 25 },
  { id: "shave",   name: "Shave",                       price: "$10",    minutes: 20 },
  { id: "beard",   name: "Beard",                       price: "$5",     minutes: 5  },
  { id: "beardmu", name: "Beard & Mustache",            price: "$5",     minutes: 10 },
  { id: "mus",     name: "Mustache",                    price: "$5",     minutes: 5  },
  { id: "brows",   name: "Eyebrows",                    price: "$5",     minutes: 5  },
  { id: "house",   name: "House Call",                  price: "$45",    minutes: 60 },
];

const KEYS = {
  daysOff: "antz_days_off",
  blockedSlots: "antz_blocked",
  bookings: "antz_bookings",
  membership: "antz_membership",
};

// Haircut services the Unlimited Haircuts Membership covers.
const COVERED_SERVICES = ["first", "adult", "kids"];

/* ---------- STORAGE ---------- */

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}

/* ---------- MEMBERSHIP ---------- */

function activeMembership() {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(KEYS.membership)); } catch { }
  return m && new Date(m.expires) > new Date() ? m : null;
}
function saveMembership(m) {
  try { localStorage.setItem(KEYS.membership, JSON.stringify(m)); } catch { }
}
function memberCutsUsed(m) {
  return load(KEYS.bookings).filter(b => b.membershipId === m.orderId).length;
}

/* ---------- DATE / TIME HELPERS ---------- */

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
function prettyTime(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
function prettyDate(key) {
  return parseKey(key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function getService(id) { return SERVICES.find(s => s.id === id); }
function todayKey() { return dateKey(new Date()); }

/* ---------- AVAILABILITY ---------- */

function allSlots(key) {
  const hours = WEEKLY_HOURS[parseKey(key).getDay()];
  if (!hours) return [];
  const slots = [];
  for (let t = toMinutes(hours.open); t + SLOT_MINUTES <= toMinutes(hours.close); t += SLOT_MINUTES) {
    slots.push(toHHMM(t));
  }
  return slots;
}

function slotsNeeded(serviceId) {
  const svc = getService(serviceId);
  return Math.max(1, Math.ceil((svc ? svc.minutes : SLOT_MINUTES) / SLOT_MINUTES));
}

function bookedSlots(key) {
  const taken = new Set();
  for (const b of load(KEYS.bookings)) {
    if (b.date !== key) continue;
    const start = toMinutes(b.time);
    for (let i = 0; i < slotsNeeded(b.serviceId); i++) taken.add(toHHMM(start + i * SLOT_MINUTES));
  }
  return taken;
}

function isDayOff(key) { return load(KEYS.daysOff).includes(key); }
function isBlocked(key, time) { return load(KEYS.blockedSlots).includes(`${key} ${time}`); }

function isPast(key, time) {
  const [h, m] = time.split(":").map(Number);
  const d = parseKey(key);
  d.setHours(h, m, 0, 0);
  return d <= new Date();
}

function availableTimes(key, serviceId) {
  if (isDayOff(key)) return [];
  const slots = allSlots(key);
  const taken = bookedSlots(key);
  const need = slotsNeeded(serviceId);
  return slots.filter((time, i) => {
    if (isPast(key, time)) return false;
    for (let j = 0; j < need; j++) {
      const s = slots[i + j];
      if (!s || taken.has(s) || isBlocked(key, s)) return false;
    }
    return true;
  });
}

function addBooking(booking) {
  if (!availableTimes(booking.date, booking.serviceId).includes(booking.time)) return false;
  const all = load(KEYS.bookings);
  all.push({ id: Date.now().toString(36), ...booking });
  save(KEYS.bookings, all);
  return true;
}

function cancelBooking(id) {
  save(KEYS.bookings, load(KEYS.bookings).filter(b => b.id !== id));
}

/* ==========================================================================
   BOOKING PAGE UI
   Only runs on a page that has #service-picker (book.html).
   ========================================================================== */

function initBookingPage() {
  // DOM selection: every lookup on this page goes through querySelector.
  // $("name") is short for document.querySelector("#name").
  const $ = id => document.querySelector("#" + id);
  const picker = $("service-picker");
  if (!picker) return;

  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + DAYS_AHEAD);

  const state = {
    serviceId: null,
    date: null,
    time: null,
    month: new Date(today.getFullYear(), today.getMonth(), 1),
  };

  /* Step 1: services */
  function renderServices() {
    picker.innerHTML = "";
    for (const svc of SERVICES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "svc" + (state.serviceId === svc.id ? " selected" : "");
      btn.setAttribute("aria-pressed", state.serviceId === svc.id);
      btn.innerHTML = `
        <span class="svc-name">${svc.name}</span>
        <span class="svc-meta"><b class="price">${svc.price}</b> · ${svc.minutes} min</span>`;
      btn.addEventListener("click", () => {
        state.serviceId = svc.id;
        state.time = null;
        // If the chosen day no longer fits this service, clear it.
        if (state.date && availableTimes(state.date, svc.id).length === 0) state.date = null;
        renderAll();
        $("step-date").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      picker.appendChild(btn);
    }
  }

  /* Step 2: calendar */
  function dayIsBookable(key) {
    const d = parseKey(key);
    if (d < parseKey(todayKey()) || d > lastDay) return false;
    if (state.serviceId) return availableTimes(key, state.serviceId).length > 0;
    return allSlots(key).some(t => !isPast(key, t)) && !isDayOff(key);
  }

  function renderCalendar() {
    const cal = $("calendar");
    const y = state.month.getFullYear();
    const m = state.month.getMonth();

    $("month-label").textContent = state.month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    $("prev").disabled = y === today.getFullYear() && m === today.getMonth();
    $("next").disabled = new Date(y, m + 1, 1) > lastDay;

    cal.innerHTML = "";
    for (const d of ["S", "M", "T", "W", "T", "F", "S"]) {
      const h = document.createElement("span");
      h.className = "cal-dow";
      h.textContent = d;
      cal.appendChild(h);
    }

    const firstWeekday = new Date(y, m, 1).getDay();
    for (let i = 0; i < firstWeekday; i++) cal.appendChild(document.createElement("span"));

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dateKey(new Date(y, m, day));
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day";
      btn.textContent = day;
      if (key === todayKey()) btn.classList.add("today");
      if (key === state.date) btn.classList.add("selected");
      btn.disabled = !dayIsBookable(key);
      btn.setAttribute("aria-label", prettyDate(key));
      btn.addEventListener("click", () => {
        state.date = key;
        state.time = null;
        renderAll();
        $("step-time").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      cal.appendChild(btn);
    }
  }

  /* Step 3: times */
  function renderTimes() {
    const box = $("times");
    const label = $("time-label");
    box.innerHTML = "";

    if (!state.serviceId) { label.textContent = "Choose a service first."; return; }
    if (!state.date) { label.textContent = "Choose a day first."; return; }

    const times = availableTimes(state.date, state.serviceId);
    label.textContent = times.length
      ? `Open times on ${prettyDate(state.date)}:`
      : "No open times left that day. Try another day.";

    for (const t of times) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "time" + (state.time === t ? " selected" : "");
      btn.textContent = prettyTime(t);
      btn.addEventListener("click", () => {
        state.time = t;
        renderTimes();
        updateSummary();
        $("step-details").scrollIntoView({ behavior: "smooth", block: "start" });
        $("name").focus({ preventScroll: true });
      });
      box.appendChild(btn);
    }
  }

  /* Step 4: summary + confirm button */
  function phoneOk() {
    return $("phone").value.replace(/\D/g, "").length >= 10;
  }

  function updateSummary() {
    const svc = getService(state.serviceId);
    $("summary").innerHTML = svc && state.date && state.time
      ? `<b>${svc.name}</b> (${svc.price}) on <b>${prettyDate(state.date)}</b> at <b>${prettyTime(state.time)}</b>`
      : "Choose a service, day and time.";

    $("confirm").disabled = !(svc && state.date && state.time && $("name").value.trim() && phoneOk());
  }

  function renderAll() {
    renderServices();
    renderCalendar();
    renderTimes();
    updateSummary();
  }

  /* Month buttons */
  $("prev").addEventListener("click", () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    renderCalendar();
  });
  $("next").addEventListener("click", () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    renderCalendar();
  });

  $("name").addEventListener("input", updateSummary);
  $("phone").addEventListener("input", () => {
    checkPhone();
    updateSummary();
  });

  /* Decision based on user input: is the phone number usable?
     Reads what the user typed (.value), decides with if / else if / else,
     and shows visible feedback under the form (.textContent). */
  function checkPhone() {
    const msg = $("phone-msg");
    const typed = $("phone").value.trim();
    const digits = typed.replace(/\D/g, "").length;

    if (typed === "") {
      msg.textContent = "";
      msg.className = "hint";
    } else if (digits < 10) {
      msg.textContent = `Phone number needs 10 digits (you have ${digits}).`;
      msg.className = "hint error";
    } else {
      msg.textContent = "Phone number looks good.";
      msg.className = "hint ok";
    }
  }

  /* Submit: details -> deposit step (or free cut for members) */
  function currentBooking() {
    return {
      serviceId: state.serviceId,
      date: state.date,
      time: state.time,
      name: $("name").value.trim(),
      phone: $("phone").value.trim(),
      created: new Date().toISOString(),
    };
  }

  // Show only the deposit step, or only steps 1-4.
  function showSteps(showPay) {
    document.querySelectorAll(".step").forEach(el => {
      el.hidden = showPay ? el.id !== "step-pay" : el.id === "step-pay";
    });
  }

  $("book-form").addEventListener("submit", e => {
    e.preventDefault();
    const booking = currentBooking();
    if (!availableTimes(booking.date, booking.serviceId).includes(booking.time)) {
      alert("Sorry, that time was just taken. Please pick another.");
      state.time = null;
      renderAll();
      return;
    }
    const svc = getService(booking.serviceId);
    $("pay-summary").innerHTML =
      `<b>${svc.name}</b> on <b>${prettyDate(booking.date)}</b> at <b>${prettyTime(booking.time)}</b>`;

    // Members: haircuts 1-4 are free right away; from the 5th cut on they're
    // free when the member brings someone, otherwise the normal deposit applies.
    const member = memberCovers(booking);
    $("member-perk").hidden = true;
    if (member) {
      const cutNumber = member.cutsUsed + 1;
      if (cutNumber < 5) {
        finishBooking(booking, { member: true, orderId: member.orderId, cutNumber });
        return;
      }
      $("member-perk-text").innerHTML =
        `<b>Member cut #${cutNumber}.</b> Your 5th cut and beyond are still free when you bring someone with you to your appointment.`;
      $("bring-guest").checked = false;
      $("member-confirm").disabled = true;
      $("member-perk").hidden = false;
    }

    showSteps(true);
    $("step-pay").scrollIntoView({ behavior: "smooth", block: "start" });
    startDeposit(booking);
  });

  $("bring-guest").addEventListener("change", () => {
    $("member-confirm").disabled = !$("bring-guest").checked;
  });
  $("member-confirm").addEventListener("click", () => {
    const member = memberCovers(activeBooking);
    if (!member || !$("bring-guest").checked) return;
    finishBooking(activeBooking, { member: true, orderId: member.orderId, cutNumber: member.cutsUsed + 1, guest: true });
  });

  $("pay-back").addEventListener("click", () => {
    showSteps(false);
    $("step-details").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function receiptLine(receipt) {
    if (!receipt) return "No deposit taken (online payments were offline).";
    if (receipt.member) {
      return `Free with your Unlimited Haircuts Membership · cut #${receipt.cutNumber}` +
             (receipt.guest ? " · bringing a guest" : "");
    }
    return `Deposit paid: $${receipt.amount} · PayPal order ${receipt.orderId}`;
  }

  /* Confirmation: runs after the deposit is captured (or a member cut is confirmed) */
  function finishBooking(booking, receipt) {
    const saved = { ...booking, deposit: receipt && !receipt.member ? receipt : null,
                    membershipId: receipt && receipt.member ? receipt.orderId : undefined,
                    guest: receipt && receipt.guest ? true : undefined };
    if (!addBooking(saved)) {
      $("pay-msg").textContent = receipt && !receipt.member
        ? "That time was taken while you paid. Your deposit went through, so contact Anthony and he'll fix your time."
        : "Sorry, that time was just taken. Please pick another.";
      $("pay-msg").className = "hint error";
      return;
    }
    const svc = getService(booking.serviceId);
    document.querySelectorAll(".step").forEach(el => (el.hidden = true));
    const confirmBox = $("confirmation");
    confirmBox.hidden = false;
    $("confirm-text").textContent =
      `${booking.name}, you're set for ${svc.name} on ${prettyDate(booking.date)} at ${prettyTime(booking.time)}.`;
    $("confirm-receipt").textContent = receiptLine(receipt);
    renderMembership();

    // Pre-filled email so Anthony actually gets the booking
    const subject = `Booking: ${svc.name} – ${prettyDate(booking.date)} ${prettyTime(booking.time)}`;
    const body =
      `Name: ${booking.name}\nPhone: ${booking.phone}\nService: ${svc.name} (${svc.price})\n` +
      `Date: ${prettyDate(booking.date)}\nTime: ${prettyTime(booking.time)}\n` +
      (!receipt ? "Deposit: none"
        : receipt.member ? `Membership: free cut #${receipt.cutNumber}${receipt.guest ? " (bringing a guest)" : ""} (PayPal order ${receipt.orderId})`
        : `Deposit: $${receipt.amount} paid (PayPal order ${receipt.orderId})`);
    const mail = document.createElement("a");
    mail.className = "btn btn-primary";
    mail.href = `mailto:${BARBER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    mail.textContent = "Send to Anthony";
    confirmBox.insertBefore(mail, confirmBox.querySelector(".btn-ghost"));

    confirmBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* PayPal
     The browser only ever sees the public client ID. Creating and capturing
     payments goes through server.js, which holds the secret key and sets
     the amounts ($5 deposit, $85 membership). */
  let paypalReady = null;    // promise: loads config + PayPal SDK once
  let activeBooking = null;  // the booking the deposit buttons are paying for
  let depositButtons = false;

  function loadPayPal() {
    if (paypalReady) return paypalReady;
    paypalReady = fetch("/api/config")
      .then(r => { if (!r.ok) throw new Error("no server"); return r.json(); })
      .then(cfg => {
        if (!cfg.clientId) throw new Error("no keys");
        $("deposit-amt").textContent = `$${cfg.deposit}`;
        const amt = $("member-amt");  // only shown while not a member
        if (cfg.membership && amt) amt.textContent = `$${Number(cfg.membership)}`;
        return new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}` +
                  `&currency=${cfg.currency}&intent=capture&components=buttons`;
          s.onload = resolve;
          s.onerror = () => reject(new Error("sdk"));
          document.head.appendChild(s);
        });
      });
    paypalReady.catch(() => { paypalReady = null; });  // allow a retry later
    return paypalReady;
  }

  function paypalErrorText(err, what) {
    return err.message === "no keys" ? "PayPal keys are missing. Add them to .env and restart the server." :
           err.message === "sdk"     ? "PayPal didn't accept the Client ID. Re-copy it into .env from developer.paypal.com and restart the server." :
           `Online ${what} need the site's server. Run "npm start" and open http://localhost:3000/book.html.`;
  }

  async function postJson(url, data) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || "Request failed");
    return json;
  }

  function bookingForServer(b) {
    const svc = getService(b.serviceId);
    return { service: svc.name, date: b.date, time: b.time, name: b.name, phone: b.phone };
  }

  function renderPayPalButtons() {
    const msg = $("pay-msg");
    return paypal.Buttons({
      style: { layout: "vertical", color: "gold", shape: "pill", label: "pay" },
      createOrder: async () => {
        msg.textContent = "";
        const order = await postJson("/api/orders", { booking: bookingForServer(activeBooking) });
        return order.id;
      },
      onApprove: async data => {
        msg.textContent = "Confirming your deposit…";
        msg.className = "hint";
        const result = await postJson(`/api/orders/${data.orderID}/capture`, { booking: bookingForServer(activeBooking) });
        if (result.paid) {
          finishBooking(activeBooking, { orderId: result.orderId, captureId: result.captureId, amount: result.amount });
        } else {
          msg.textContent = `Payment not completed (status: ${result.status}). Please try again.`;
          msg.className = "hint error";
        }
      },
      onCancel: () => {
        msg.textContent = "Payment cancelled. Your time isn't held until the deposit goes through.";
        msg.className = "hint error";
      },
      onError: err => {
        console.error(err);
        msg.textContent = "PayPal had a problem. Please try again.";
        msg.className = "hint error";
      },
    }).render("#paypal-buttons");
  }

  function startDeposit(booking) {
    activeBooking = booking;
    const msg = $("pay-msg");
    msg.textContent = "";
    msg.className = "hint";
    loadPayPal()
      .then(() => { if (!depositButtons) { depositButtons = true; return renderPayPalButtons(); } })
      .catch(err => {
        // Opened with Live Server (server.js not running) or keys missing.
        msg.className = "hint error";
        msg.textContent = paypalErrorText(err, "deposits");
        if (!$("skip-deposit")) {
          const skip = document.createElement("button");
          skip.type = "button";
          skip.id = "skip-deposit";
          skip.className = "btn btn-ghost";
          skip.textContent = "Book without deposit";
          skip.addEventListener("click", () => finishBooking(activeBooking, null));
          $("pay-back").before(skip);
        }
      });
  }

  /* ---------- Unlimited Haircuts Membership ---------- */
  let memberButtons = false;

  function memberCovers(booking) {
    const m = activeMembership();
    if (!m || !booking || !COVERED_SERVICES.includes(booking.serviceId)) return null;
    if (parseKey(booking.date) > new Date(m.expires)) return null;  // cut must fall inside the month
    return { ...m, cutsUsed: memberCutsUsed(m) };
  }

  function renderMembership() {
    const m = activeMembership();
    const status = $("member-status");
    if (m) {
      const until = new Date(m.expires).toLocaleDateString("en-US", { month: "long", day: "numeric" });
      const used = memberCutsUsed(m);
      status.innerHTML = `<b>✓ Active member</b>${m.name ? ` · ${m.name}` : ""} · through ${until} · ${used} cut${used === 1 ? "" : "s"} used`;
      status.hidden = false;
      $("member-open").classList.add("is-member");
      $("member-open").querySelector(".member-price").textContent = "You're a member · haircuts are on us";
      $("member-checkout").hidden = true;
      $("member-open").setAttribute("aria-expanded", "false");
    } else {
      status.hidden = true;
      $("member-open").classList.remove("is-member");
      $("member-open").querySelector(".member-price").innerHTML = '<b id="member-amt">$85</b> / month &middot; tap to join';
    }
  }

  function memberFormOk() {
    return $("member-name").value.trim() && $("member-phone").value.replace(/\D/g, "").length >= 10;
  }

  $("member-open").addEventListener("click", () => {
    if (activeMembership()) {
      $("membership").querySelector("details").open = true;  // members just see the policy
      return;
    }
    const box = $("member-checkout");
    box.hidden = !box.hidden;
    $("member-open").setAttribute("aria-expanded", String(!box.hidden));
    if (box.hidden) return;
    // Carry over anything already typed in step 4
    if (!$("member-name").value) $("member-name").value = $("name").value;
    if (!$("member-phone").value) $("member-phone").value = $("phone").value;
    const msg = $("member-msg");
    msg.textContent = "";
    msg.className = "hint";
    loadPayPal()
      .then(() => { if (!memberButtons) { memberButtons = true; return renderMemberButtons(); } })
      .catch(err => {
        msg.className = "hint error";
        msg.textContent = paypalErrorText(err, "memberships");
      });
  });

  function renderMemberButtons() {
    const msg = $("member-msg");
    const member = () => ({ name: $("member-name").value.trim(), phone: $("member-phone").value.trim() });
    return paypal.Buttons({
      style: { layout: "vertical", color: "gold", shape: "pill", label: "pay" },
      onClick: (data, actions) => {
        if (memberFormOk()) { msg.textContent = ""; return actions.resolve(); }
        msg.textContent = "Add your name and a 10-digit phone number first.";
        msg.className = "hint error";
        return actions.reject();
      },
      createOrder: async () => (await postJson("/api/membership/orders", { member: member() })).id,
      onApprove: async data => {
        msg.textContent = "Activating your membership…";
        msg.className = "hint";
        const r = await postJson(`/api/membership/orders/${data.orderID}/capture`, { member: member() });
        if (!r.paid) {
          msg.textContent = `Payment not completed (status: ${r.status}). Please try again.`;
          msg.className = "hint error";
          return;
        }
        saveMembership({ ...member(), orderId: r.orderId, start: r.start, expires: r.expires });
        renderMembership();
        // If they were in the middle of booking a haircut, apply the membership right away.
        if (!$("step-pay").hidden && memberCovers(activeBooking)) {
          $("book-form").requestSubmit();
        }
      },
      onCancel: () => {
        msg.textContent = "Payment cancelled. You haven't been charged.";
        msg.className = "hint error";
      },
      onError: err => {
        console.error(err);
        msg.textContent = "PayPal had a problem. Please try again.";
        msg.className = "hint error";
      },
    }).render("#member-paypal");
  }

  renderMembership();

  /* ---------- AI booking assistant ----------
     server.js asks Gemini to turn the message into intent (service, day,
     time rule, name, phone). Here we match that intent against the REAL
     open slots, fill in the form, and leave the PayPal step to the customer. */
  const chat = { history: [], busy: false };

  function say(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role === "user" ? "from-user" : "from-ai"}`;
    bubble.textContent = text;
    $("chat-log").appendChild(bubble);
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
    return bubble;
  }

  function assistantContext() {
    const now = new Date();
    return {
      today: `${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (${dateKey(now)})`,
      now: toHHMM(now.getHours() * 60 + now.getMinutes()),
      services: SERVICES.map(s => ({ ...s, covered: COVERED_SERVICES.includes(s.id) })),
      hours: WEEKLY_HOURS,
    };
  }

  // Choose a real open slot that fits what the customer asked for.
  function pickSlot(serviceId, intent) {
    const asked = /^\d{4}-\d{2}-\d{2}$/.test(intent.date || "") ? intent.date : null;
    const want = /^\d{2}:\d{2}$/.test(intent.time || "") ? intent.time : null;
    const rule = intent.timeRule || (want ? "exact" : "earliest");
    const start = asked && parseKey(asked) >= parseKey(todayKey()) ? parseKey(asked) : parseKey(todayKey());

    for (let i = 0; i <= 21; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (d > lastDay) break;
      const key = dateKey(d);
      let times = availableTimes(key, serviceId);
      if (want && rule === "after")  times = times.filter(t => t >= want);
      if (want && rule === "before") times = times.filter(t => t < want);
      if (want && rule === "exact") {
        const exact = times.find(t => t === want);
        if (exact) return { date: key, time: exact, onAskedDay: key === asked };
        // No exact match: offer the closest time that day instead.
        times = times.slice().sort((a, b) => Math.abs(toMinutes(a) - toMinutes(want)) - Math.abs(toMinutes(b) - toMinutes(want)));
      }
      if (times.length) {
        return { date: key, time: rule === "latest" ? times[times.length - 1] : times[0], onAskedDay: key === asked };
      }
    }
    return null;
  }

  function applyIntent(intent) {
    if (intent.name && !$("name").value.trim()) $("name").value = intent.name.slice(0, 60);
    if (intent.phone && !$("phone").value.trim()) { $("phone").value = intent.phone.slice(0, 20); checkPhone(); }

    if (intent.action === "join_membership") {
      if (!activeMembership() && $("member-checkout").hidden) $("member-open").click();
      $("membership").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (intent.action !== "book") { updateSummary(); return; }

    const serviceId = getService(intent.serviceId) ? intent.serviceId : state.serviceId;
    if (!serviceId) { say("ai", "Which service do you want? Tap one in step 1 or just tell me."); return; }

    const slot = pickSlot(serviceId, intent);
    if (!slot) {
      state.serviceId = serviceId;
      renderAll();
      say("ai", "I couldn't find an open chair that matches in the next 3 weeks. Want to try a different day or time?");
      return;
    }

    showSteps(false);
    state.serviceId = serviceId;
    state.date = slot.date;
    state.time = slot.time;
    state.month = new Date(parseKey(slot.date).getFullYear(), parseKey(slot.date).getMonth(), 1);
    renderAll();

    const svc = getService(serviceId);
    const asked = /^\d{4}-\d{2}-\d{2}$/.test(intent.date || "");
    const note = asked && !slot.onAskedDay ? "Nothing's open then, so here's the closest opening: " : "Found one: ";
    const member = memberCovers({ serviceId, date: slot.date });
    const pay = member && member.cutsUsed < 4
      ? "your membership covers it, so no deposit needed."
      : `hit "Continue to Deposit" to hold it with a $5 PayPal deposit.`;
    const needDetails = !$("name").value.trim() || $("phone").value.replace(/\D/g, "").length < 10;
    say("ai", `${note}${svc.name} on ${prettyDate(slot.date)} at ${prettyTime(slot.time)}. ` +
              (needDetails ? "Add your name and phone below, then " + pay : pay.charAt(0).toUpperCase() + pay.slice(1)));

    $("step-details").scrollIntoView({ behavior: "smooth", block: "start" });
    $("step-details").classList.add("flash");
    setTimeout(() => $("step-details").classList.remove("flash"), 1600);
    (needDetails ? (!$("name").value.trim() ? $("name") : $("phone")) : $("confirm")).focus({ preventScroll: true });
  }

  async function sendChat(text) {
    text = text.trim();
    if (!text || chat.busy) return;
    chat.busy = true;
    $("chat-send").disabled = true;
    $("chat-chips").hidden = true;
    say("user", text);
    $("chat-input").value = "";
    const typing = say("ai", "…");
    typing.classList.add("typing");
    try {
      let r;
      try {
        r = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history: chat.history, context: assistantContext() }),
        });
      } catch { throw new Error("no server"); }
      const intent = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 404 || r.status === 405 ? "no server" : intent.error || "Something went wrong.");
      typing.remove();
      chat.history.push({ role: "user", text }, { role: "model", text: JSON.stringify(intent) });
      if (intent.reply) say("ai", intent.reply);
      applyIntent(intent);
    } catch (err) {
      typing.remove();
      say("ai", err.message === "no server"
        ? 'The assistant needs the site\'s server. Run "npm start" and open http://localhost:3000/book.html.'
        : err.message);
    } finally {
      chat.busy = false;
      $("chat-send").disabled = false;
    }
  }

  $("chat-form").addEventListener("submit", e => { e.preventDefault(); sendChat($("chat-input").value); });
  $("chat-chips").addEventListener("click", e => { if (e.target.matches(".chip")) sendChat(e.target.textContent); });
  say("ai", "Hey! I'm the Antz Cuts booking assistant. What can I set up for you?");

  // Links from other pages can pre-pick a service: book.html?service=adult
  const fromLink = new URLSearchParams(location.search).get("service");
  if (getService(fromLink)) state.serviceId = fromLink;

  renderAll();
}

document.addEventListener("DOMContentLoaded", initBookingPage);