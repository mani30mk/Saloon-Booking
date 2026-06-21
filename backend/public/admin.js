let adminToken = localStorage.getItem("salon_admin_token") || null;
let view = adminToken ? "dashboard" : "login";
let bookings = [];
let authMsg = null;
let busy = false;

const API = window.location.protocol === "file:" ? "http://localhost:3000" : window.location.origin;

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (adminToken) headers.Authorization = "Bearer " + adminToken;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function render() {
  const app = document.getElementById("admin-app");
  app.innerHTML = `
    <header class="top">
      <div class="brand">
        <h1>SHARP&nbsp;&amp;&nbsp;FADE</h1>
        <span class="tag">Admin Dashboard</span>
      </div>
      ${adminToken ? `<button class="linklike" id="logoutBtn">log out</button>` : ``}
    </header>
    <div id="content"></div>
  `;
  const content = document.getElementById("content");
  content.innerHTML = adminToken ? renderDashboard() : renderLogin();
  bindEvents();
  if (adminToken && view === "dashboard") loadBookings();
}

function renderLogin() {
  const msg = authMsg ? `<div class="msg ${authMsg.type}">${authMsg.text}</div>` : "";
  return `
    <div class="card" style="max-width:420px;margin:30px auto;">
      <h2>Admin Login</h2>
      ${msg}
      <label>Admin Password</label>
      <input type="password" id="li-pass" placeholder="Enter admin password">
      <div class="row" style="margin-top:18px;">
        <button class="btn" id="loginBtn" ${busy ? "disabled" : ""}>${busy ? "Logging in…" : "Log In"}</button>
      </div>
    </div>`;
}

function renderDashboard() {
  if (bookings.length === 0) {
    return `<div class="card"><h2>All Bookings</h2><p class="empty">No bookings found.</p></div>`;
  }

  const msg = authMsg ? `<div class="msg ${authMsg.type}">${authMsg.text}</div>` : "";

  const items = bookings.map(b => {
    const dateLabel = new Date(b.date + "T00:00:00").toDateString();
    
    let badgeClass = "ok";
    let badgeText = "Confirmed";
    if (b.status === "cancelled") { badgeClass = "cancelled"; badgeText = "Cancelled"; }
    else if (b.status === "completed") { badgeClass = "completed"; badgeText = "Completed"; }

    let actionHtml = "";
    if (b.status === "confirmed") {
      actionHtml = `
        <div style="margin-top:10px; display:flex; gap:10px;">
          <input type="text" id="otp-${b.id}" placeholder="Enter OTP" style="width:120px; padding:8px;" />
          <button class="btn verify-btn" data-id="${b.id}">Verify OTP</button>
        </div>
      `;
    }

    return `
      <div class="booking-item" style="display:block;">
        <div class="meta" style="margin-bottom:10px;">
          <div class="date">${dateLabel} · ${b.time} <span class="badge ${badgeClass}">${badgeText}</span></div>
          <div style="font-size:14px;margin-top:4px;">Customer: <strong>${b.name}</strong> (${b.phone})</div>
        </div>
        ${actionHtml}
      </div>`;
  }).join("");

  return `<div class="card" style="max-width:800px;"><h2>All Bookings</h2>${msg}${items}</div>`;
}

async function doLogin() {
  const password = document.getElementById("li-pass").value;
  busy = true; render();
  try {
    const data = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
    adminToken = data.token;
    localStorage.setItem("salon_admin_token", adminToken);
    view = "dashboard"; authMsg = null;
  } catch (e) {
    authMsg = { type: "error", text: e.message };
  } finally {
    busy = false; render();
  }
}

function logout() {
  adminToken = null;
  localStorage.removeItem("salon_admin_token");
  view = "login";
  render();
}

async function loadBookings() {
  try {
    const data = await api("/api/admin/bookings");
    bookings = data.bookings;
  } catch (e) {
    authMsg = { type: "error", text: e.message };
  }
  renderDashboardContent();
}

function renderDashboardContent() {
  const content = document.getElementById("content");
  if(content) content.innerHTML = renderDashboard();
  bindDashboardEvents();
}

function bindEvents() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.onclick = logout;

  if (!adminToken) {
    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) loginBtn.onclick = doLogin;
  } else {
    bindDashboardEvents();
  }
}

function bindDashboardEvents() {
  document.querySelectorAll(".verify-btn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const otpInput = document.getElementById("otp-" + id);
      const otp = otpInput.value.trim();
      if (!otp) {
        authMsg = { type: "error", text: "Please enter the OTP." };
        renderDashboardContent();
        return;
      }
      
      btn.innerText = "Verifying...";
      btn.disabled = true;
      try {
        const res = await api("/api/admin/verify-otp", { method: "POST", body: JSON.stringify({ booking_id: id, otp }) });
        authMsg = { type: "success", text: res.message };
        await loadBookings();
      } catch (e) {
        authMsg = { type: "error", text: e.message };
        renderDashboardContent();
      }
    };
  });
}

render();
