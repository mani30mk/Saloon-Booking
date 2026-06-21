/* ---------------- App state ---------------- */
let token = localStorage.getItem("salon_token") || null;
let currentUser = JSON.parse(localStorage.getItem("salon_user") || "null");
let view = token ? "book" : "login";
let authMsg = null;
let selectedDayOffset = 0;
let selectedSlot = null;
let slotsCache = [];
let myBookings = [];
let lastOtp = null;
let busy = false;

const API = window.location.protocol === "file:" ? "http://localhost:3000" : window.location.origin;

/* ---------------- API helpers ---------------- */
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

/* ---------------- Date helpers ---------------- */
function dateAtOffset(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
function isoDate(d) { return d.toISOString().slice(0, 10); }

/* ---------------- Render root ---------------- */
function render() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <header class="top">
      <div class="brand">
        <h1>SHARP&nbsp;&amp;&nbsp;FADE</h1>
        <span class="tag">Chair Booking</span>
      </div>
      ${currentUser ? `
        <div class="userbox">
          <div class="name">${escapeHtml(currentUser.name)}</div>
          <button class="linklike" id="logoutBtn">log out</button>
        </div>` : ``}
    </header>
    <div id="content"></div>
    <footer>Open daily 9:00 AM – 10:00 PM · Closed 12:00–1:00 PM for lunch · <a href="/admin.html" style="color:inherit;text-decoration:none;opacity:0.6;">Admin</a></footer>
  `;
  const content = document.getElementById("content");
  content.innerHTML = token ? renderAppShell() : renderAuth();
  bindEvents();
  if (token && view === "book") loadSlots();
  if (token && view === "mybookings") loadBookings();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Auth views ---------------- */
function renderAuth() {
  const msg = authMsg ? `<div class="msg ${authMsg.type}">${escapeHtml(authMsg.text)}</div>` : "";
  if (view === "signup") {
    return `
      <div class="card" style="max-width:420px;margin:30px auto;">
        <h2>Create Account</h2>
        ${msg}
        <label>Full name</label>
        <input type="text" id="su-name" placeholder="e.g. Arjun Mehta">
        <label>Phone number</label>
        <input type="tel" id="su-phone" placeholder="10-digit number">
        <label>Password</label>
        <input type="password" id="su-pass" placeholder="Min 4 characters">
        <div class="row" style="margin-top:18px;">
          <button class="btn" id="signupBtn" ${busy ? "disabled" : ""}>${busy ? "Creating…" : "Sign Up"}</button>
          <button class="btn secondary" id="toLoginBtn">Have an account? Log in</button>
        </div>
      </div>`;
  }
  return `
    <div class="card" style="max-width:420px;margin:30px auto;">
      <h2>Log In</h2>
      ${msg}
      <label>Phone number</label>
      <input type="tel" id="li-phone" placeholder="10-digit number">
      <label>Password</label>
      <input type="password" id="li-pass" placeholder="Your password">
      <div class="row" style="margin-top:18px;">
        <button class="btn" id="loginBtn" ${busy ? "disabled" : ""}>${busy ? "Logging in…" : "Log In"}</button>
        <button class="btn secondary" id="toSignupBtn">New here? Sign up</button>
      </div>
    </div>`;
}

async function doSignup() {
  const name = document.getElementById("su-name").value.trim();
  const phone = document.getElementById("su-phone").value.trim();
  const password = document.getElementById("su-pass").value;
  busy = true; render();
  try {
    const data = await api("/api/signup", { method: "POST", body: JSON.stringify({ name, phone, password }) });
    token = data.token; currentUser = data.user;
    localStorage.setItem("salon_token", token);
    localStorage.setItem("salon_user", JSON.stringify(currentUser));
    view = "book"; authMsg = null;
  } catch (e) {
    authMsg = { type: "error", text: e.message };
  } finally {
    busy = false; render();
  }
}

async function doLogin() {
  const phone = document.getElementById("li-phone").value.trim();
  const password = document.getElementById("li-pass").value;
  busy = true; render();
  try {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify({ phone, password }) });
    token = data.token; currentUser = data.user;
    localStorage.setItem("salon_token", token);
    localStorage.setItem("salon_user", JSON.stringify(currentUser));
    view = "book"; authMsg = null;
  } catch (e) {
    authMsg = { type: "error", text: e.message };
  } finally {
    busy = false; render();
  }
}

function logout() {
  token = null; currentUser = null;
  localStorage.removeItem("salon_token");
  localStorage.removeItem("salon_user");
  view = "login";
  render();
}

/* ---------------- App shell ---------------- */
function renderAppShell() {
  const tabs = `
    <div class="tabs">
      <button class="${view === 'book' ? 'active' : ''}" id="tabBook">Book a Slot</button>
      <button class="${view === 'mybookings' ? 'active' : ''}" id="tabMine">My Bookings</button>
    </div>`;
  return tabs + `<div id="viewArea"><div class="loading">Loading…</div></div>`;
}

function setView(v) {
  view = v; selectedSlot = null; authMsg = null; lastOtp = null;
  render();
}

/* ---------------- Booking view ---------------- */
async function loadSlots() {
  const viewArea = document.getElementById("viewArea");
  const dateObj = dateAtOffset(selectedDayOffset);
  const dateISO = isoDate(dateObj);
  try {
    const data = await api(`/api/slots?date=${dateISO}`);
    slotsCache = data.slots;
  } catch (e) {
    authMsg = { type: "error", text: e.message };
  }
  renderBookingView();
}

function renderBookingView() {
  const viewArea = document.getElementById("viewArea");
  if (!viewArea) return;

  const days = [];
  for (let i = 0; i < 20; i++) days.push(dateAtOffset(i));
  const dowNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const chips = days.map((d, i) => {
    const active = i === selectedDayOffset ? "active" : "";
    return `<div class="daychip ${active}" data-day="${i}">
      <div class="dow">${dowNames[d.getDay()]}</div>
      <div class="num">${d.getDate()}</div>
    </div>`;
  }).join("");

  const dateObj = dateAtOffset(selectedDayOffset);

  let slotsHtml = "";
  if (!slotsCache) {
    slotsHtml = `<div class="loading">Loading slots...</div>`;
  } else {
    slotsHtml = slotsCache.map(s => {
      let cls = "slot";
      let clickable = false;
      if (s.status === "lunch") cls += " lunch";
      else if (s.status === "taken") cls += " taken";
      else if (s.status === "past") cls += " past";
      else if (s.status === "holiday" || s.status === "leave") cls += " leave";
      else {
        clickable = true;
        if (selectedSlot === s.time) cls += " selected";
      }
      return `<div class="${cls}" ${clickable ? `data-slot="${s.time}"` : ""}>${s.time}</div>`;
    }).join("");
  }

  const msg = authMsg ? `<div class="msg ${authMsg.type}">${escapeHtml(authMsg.text)}</div>` : "";

  let confirmBtn = "";
  if (selectedSlot) {
    confirmBtn = `
      <div class="card" style="margin-top:18px;">
        <h2>Confirm Booking</h2>
        <p style="font-size:15px;"><strong>${dateObj.toDateString()}</strong> at <strong>${selectedSlot}</strong></p>
        <button class="btn" id="confirmBtn" ${busy ? "disabled" : ""}>${busy ? "Booking…" : "Confirm & Generate OTP"}</button>
        <button class="btn secondary" id="cancelSelectBtn">Cancel selection</button>
      </div>`;
  }

  let otpBox = "";
  if (lastOtp) {
    otpBox = `
      <div class="otp-box">
        <div class="label">Booking confirmed · Your OTP</div>
        <div class="code">${lastOtp}</div>
        <div style="font-size:12px;margin-top:6px;color:#cfc4ac;">Show this code at the counter on arrival</div>
      </div>`;
  }

  viewArea.innerHTML = `
    ${msg}
    <div class="card">
      <h2>Pick a Date</h2>
      <div class="datepick">${chips}</div>
      <h2>Available Times — ${dateObj.toDateString()}</h2>
      <div class="legend">
        <span><span class="sw" style="background:#fffefb;"></span>Open</span>
        <span><span class="sw" style="background:var(--rust);"></span>Selected</span>
        <span><span class="sw" style="background:#e3d6d6;"></span>Booked</span>
        <span><span class="sw" style="background:#e8dfc9;"></span>Lunch break</span>
        <span><span class="sw" style="background:#d6e3d6;"></span>Holiday/Leave</span>
      </div>
      <div class="slotgrid">${slotsHtml}</div>
    </div>
    ${confirmBtn}
    ${otpBox}
  `;
  bindBookingEvents();
}

function bindBookingEvents() {
  document.querySelectorAll(".daychip").forEach(el => {
    el.onclick = () => {
      const newOffset = parseInt(el.dataset.day, 10);
      if (selectedDayOffset === newOffset) return;
      selectedDayOffset = newOffset;
      selectedSlot = null; authMsg = null; lastOtp = null;
      slotsCache = null; // Mark as loading
      renderBookingView(); // Instant feedback
      loadSlots();
    };
  });
  document.querySelectorAll(".slot[data-slot]").forEach(el => {
    el.onclick = () => {
      selectedSlot = el.dataset.slot;
      authMsg = null;
      renderBookingView();
    };
  });
  const confirmBtn = document.getElementById("confirmBtn");
  if (confirmBtn) confirmBtn.onclick = confirmBooking;
  const cancelSelectBtn = document.getElementById("cancelSelectBtn");
  if (cancelSelectBtn) cancelSelectBtn.onclick = () => { selectedSlot = null; renderBookingView(); };
}

async function confirmBooking() {
  const dateISO = isoDate(dateAtOffset(selectedDayOffset));
  busy = true; renderBookingView();
  try {
    const data = await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ date: dateISO, time: selectedSlot })
    });
    lastOtp = data.booking.otp;
    authMsg = { type: "success", text: "Slot booked! Your OTP is shown below." };
    selectedSlot = null;
    await loadSlots(); // refresh availability
  } catch (e) {
    authMsg = { type: "error", text: e.message };
    selectedSlot = null;
    busy = false;
    renderBookingView();
    return;
  }
  busy = false;
  renderBookingView();
}

/* ---------------- My bookings view ---------------- */
async function loadBookings() {
  const viewArea = document.getElementById("viewArea");
  try {
    const data = await api("/api/bookings");
    myBookings = data.bookings;
  } catch (e) {
    authMsg = { type: "error", text: e.message };
  }
  renderMyBookingsView();
}

function renderMyBookingsView() {
  const viewArea = document.getElementById("viewArea");
  if (!viewArea) return;

  if (myBookings.length === 0) {
    viewArea.innerHTML = `<div class="card"><h2>My Bookings</h2><p class="empty">No bookings yet. Head to "Book a Slot" to grab a chair.</p></div>`;
    return;
  }

  const msg = authMsg ? `<div class="msg ${authMsg.type}">${escapeHtml(authMsg.text)}</div>` : "";

  const items = myBookings.map(b => {
    const dateLabel = new Date(b.date + "T00:00:00").toDateString();
    const slotDt = slotToDateClient(b.date, b.time);
    const msUntil = slotDt - new Date();
    const cancelled = b.status === "cancelled";
    const canCancel = !cancelled && msUntil >= 60 * 60 * 1000;
    const badge = cancelled
      ? `<span class="badge cancelled">Cancelled</span>`
      : `<span class="badge ok">Confirmed</span>`;
    const otpLine = !cancelled ? `<div style="font-size:13px;margin-top:4px;">OTP: <strong>${b.otp}</strong></div>` : "";
    const cancelBtn = !cancelled
      ? (canCancel
          ? `<button class="btn danger" data-cancel="${b.id}">Cancel</button>`
          : `<button class="btn" disabled title="Too close to start time">Can't cancel (&lt;1hr left)</button>`)
      : "";
    return `
      <div class="booking-item">
        <div class="meta">
          <div class="date">${dateLabel} · ${b.time} ${badge}</div>
          ${otpLine}
        </div>
        <div>${cancelBtn}</div>
      </div>`;
  }).join("");

  viewArea.innerHTML = `<div class="card"><h2>My Bookings</h2>${msg}${items}</div>`;

  document.querySelectorAll("[data-cancel]").forEach(el => {
    el.onclick = () => cancelBooking(el.dataset.cancel);
  });
}

function slotToDateClient(dateStr, time) {
  const match = time.match(/(\d+):(\d+)(AM|PM)/);
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3];
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(h, m, 0, 0);
  return d;
}

async function cancelBooking(id) {
  try {
    await api(`/api/bookings/${id}/cancel`, { method: "POST" });
    authMsg = { type: "success", text: "Booking cancelled." };
  } catch (e) {
    authMsg = { type: "error", text: e.message };
  }
  await loadBookings();
}

/* ---------------- Event binding ---------------- */
function bindEvents() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.onclick = logout;

  if (!token) {
    const signupBtn = document.getElementById("signupBtn");
    if (signupBtn) signupBtn.onclick = doSignup;
    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) loginBtn.onclick = doLogin;
    const toSignupBtn = document.getElementById("toSignupBtn");
    if (toSignupBtn) toSignupBtn.onclick = () => { view = "signup"; authMsg = null; render(); };
    const toLoginBtn = document.getElementById("toLoginBtn");
    if (toLoginBtn) toLoginBtn.onclick = () => { view = "login"; authMsg = null; render(); };
  } else {
    const tabBook = document.getElementById("tabBook");
    if (tabBook) tabBook.onclick = () => setView("book");
    const tabMine = document.getElementById("tabMine");
    if (tabMine) tabMine.onclick = () => setView("mybookings");
  }
}

render();
