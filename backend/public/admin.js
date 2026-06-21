let adminToken = localStorage.getItem("salon_admin_token") || null;
let view = adminToken ? "dashboard" : "login";
let bookings = [];
let leaves = [];
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
      <div class="brand" style="display:flex; align-items:center; gap:15px;">
        <img src="/logo.png" alt="Mirror & Magic Logo" style="height: 80px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
        <h1 style="display:none;">MIRROR&nbsp;&amp;&nbsp;MAGIC</h1>
        <span class="tag" style="margin-top: 0;">Admin Dashboard</span>
      </div>
      ${adminToken ? `
        <div style="display:flex;gap:15px;align-items:center;">
          <button class="linklike" id="tabDash" style="${view==='dashboard'?'text-decoration:underline;font-weight:bold;':'text-decoration:none;'}">Bookings</button>
          <button class="linklike" id="tabLeaves" style="${view==='leaves'?'text-decoration:underline;font-weight:bold;':'text-decoration:none;'}">Leaves</button>
          <button class="linklike" id="logoutBtn">log out</button>
        </div>` : ``}
    </header>
    <div id="content"></div>
  `;
  const content = document.getElementById("content");
  if (!adminToken) content.innerHTML = renderLogin();
  else if (view === "dashboard") content.innerHTML = renderDashboard();
  else if (view === "leaves") content.innerHTML = renderLeaves();
  bindEvents();
  if (adminToken && view === "dashboard") loadBookings();
  if (adminToken && view === "leaves") loadLeaves();
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
  const msg = authMsg ? `<div class="msg ${authMsg.type}">${authMsg.text}</div>` : "";

  const pending = bookings.filter(b => b.status === "confirmed");
  const completed = bookings.filter(b => b.status === "completed");
  const cancelled = bookings.filter(b => b.status === "cancelled");

  const renderItem = (b) => {
    const dateLabel = new Date(b.date + "T00:00:00").toDateString();
    
    let badgeClass = "ok";
    let badgeText = "Pending";
    if (b.status === "cancelled") { badgeClass = "cancelled"; badgeText = "Cancelled"; }
    else if (b.status === "completed") { badgeClass = "completed"; badgeText = "Completed"; }

    let actionHtml = "";
    if (b.status === "confirmed") {
      actionHtml = `
        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
          <input type="text" id="otp-${b.id}" placeholder="Enter OTP" style="flex:1; min-width:120px; padding:10px; font-size:16px;" />
          <button class="btn verify-btn" data-id="${b.id}" style="margin:0; flex-shrink:0;">Verify OTP</button>
          <button class="btn danger admin-cancel-btn" data-id="${b.id}" style="margin:0; flex-shrink:0;">Cancel Slot</button>
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
  };

  const renderSection = (title, list) => {
    const itemsHtml = list.length > 0 ? list.map(renderItem).join("") : `<p class="empty" style="margin-bottom:0;">No bookings found.</p>`;
    return `<div class="card" style="margin-bottom:20px;"><h2>${title}</h2>${itemsHtml}</div>`;
  };

  return `
    <div style="max-width:800px;">
      ${msg}
      ${renderSection("Pending Bookings", pending)}
      ${renderSection("Completed Bookings", completed)}
      ${renderSection("Cancelled Bookings", cancelled)}
    </div>
  `;
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

async function loadLeaves() {
  try {
    const data = await api("/api/admin/leaves");
    leaves = data.leaves;
  } catch (e) {
    authMsg = { type: "error", text: e.message };
  }
  renderLeavesContent();
}

function renderLeavesContent() {
  const content = document.getElementById("content");
  if(content) content.innerHTML = renderLeaves();
  bindLeavesEvents();
}

function generateSlotOptions() {
  const slots = [];
  let h = 9, m = 0;
  while (h <= 22) { // Allow up to 10:00PM for End Time
    const period = h >= 12 ? "PM" : "AM";
    let hh = h % 12; if (hh === 0) hh = 12;
    const timeStr = `${hh}:${m === 0 ? "00" : m}${period}`;
    slots.push(`<option value="${timeStr}">${timeStr}</option>`);
    m += 30;
    if (m === 60) { m = 0; h++; }
  }
  return slots.join("");
}

function renderLeaves() {
  const msg = authMsg ? `<div class="msg ${authMsg.type}">${authMsg.text}</div>` : "";
  
  const items = leaves.length === 0 ? `<p class="empty">No leaves added.</p>` : leaves.map(l => {
    let lbl = l.is_full_day ? "Full Day" : `From ${l.start_time} to ${l.end_time}`;
    return `<div class="booking-item">
      <div class="meta"><div class="date">${l.date}</div><div style="margin-top:4px;font-size:14px;">${lbl}</div></div>
      <button class="btn danger delete-leave-btn" data-id="${l.id}">Delete</button>
    </div>`;
  }).join("");

  return `
    ${msg}
    <div class="card" style="max-width:800px;">
      <h2>Add Leave</h2>
      <div class="row">
        <div style="flex:1;"><label>Date</label><input type="date" id="lv-date" /></div>
        <div style="flex:1;"><label>Type</label>
          <select id="lv-type" style="width:100%;padding:11px 12px;border:1.5px solid var(--ink);background:#fffefb;font-size:15px;outline:none;">
            <option value="full">Full Day</option>
            <option value="partial">Specific Hours</option>
          </select>
        </div>
      </div>
      <div class="row" id="lv-times" style="display:none; margin-top:10px; gap:10px;">
        <div style="flex:1;"><label>Start Time</label>
          <select id="lv-start" style="width:100%;padding:11px 12px;border:1.5px solid var(--ink);background:#fffefb;font-size:15px;outline:none;margin-top:4px;">
            ${generateSlotOptions()}
          </select>
        </div>
        <div style="flex:1;"><label>End Time</label>
          <select id="lv-end" style="width:100%;padding:11px 12px;border:1.5px solid var(--ink);background:#fffefb;font-size:15px;outline:none;margin-top:4px;">
            ${generateSlotOptions()}
          </select>
        </div>
      </div>
      <div style="margin-top:18px;">
        <button class="btn" id="addLeaveBtn">Save Leave</button>
      </div>
    </div>
    <div class="card" style="max-width:800px;">
      <h2>Upcoming Leaves</h2>
      ${items}
    </div>
  `;
}

function bindEvents() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.onclick = logout;

  if (!adminToken) {
    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) loginBtn.onclick = doLogin;
  } else {
    const tabDash = document.getElementById("tabDash");
    if (tabDash) tabDash.onclick = () => { view = "dashboard"; authMsg = null; render(); };
    const tabLeaves = document.getElementById("tabLeaves");
    if (tabLeaves) tabLeaves.onclick = () => { view = "leaves"; authMsg = null; render(); };

    if (view === "dashboard") bindDashboardEvents();
    if (view === "leaves") bindLeavesEvents();
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

  document.querySelectorAll(".admin-cancel-btn").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Cancel this booking?")) return;
      const id = btn.dataset.id;
      btn.innerText = "Cancelling...";
      btn.disabled = true;
      try {
        const res = await api("/api/admin/bookings/" + id + "/cancel", { method: "POST" });
        authMsg = { type: "success", text: res.message };
        await loadBookings();
      } catch (e) {
        authMsg = { type: "error", text: e.message };
        renderDashboardContent();
      }
    };
  });
}

function bindLeavesEvents() {
  const typeSel = document.getElementById("lv-type");
  if (typeSel) {
    typeSel.onchange = () => {
      document.getElementById("lv-times").style.display = typeSel.value === "partial" ? "flex" : "none";
    };
  }

  const addBtn = document.getElementById("addLeaveBtn");
  if (addBtn) {
    addBtn.onclick = async () => {
      const date = document.getElementById("lv-date").value;
      const is_full_day = typeSel.value === "full";
      const start_time = document.getElementById("lv-start").value.trim();
      const end_time = document.getElementById("lv-end").value.trim();

      if (!date) {
        authMsg = { type: "error", text: "Please select a date." };
        renderLeavesContent();
        return;
      }

      addBtn.disabled = true; addBtn.innerText = "Saving...";
      try {
        await api("/api/admin/leaves", {
          method: "POST",
          body: JSON.stringify({ date, is_full_day, start_time, end_time })
        });
        authMsg = { type: "success", text: "Leave added." };
        await loadLeaves();
      } catch (e) {
        authMsg = { type: "error", text: e.message };
        renderLeavesContent();
      }
    };
  }

  document.querySelectorAll(".delete-leave-btn").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Delete this leave?")) return;
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api("/api/admin/leaves/" + id, { method: "DELETE" });
        authMsg = { type: "success", text: "Leave deleted." };
        await loadLeaves();
      } catch (e) {
        authMsg = { type: "error", text: e.message };
        renderLeavesContent();
      }
    };
  });
}

render();
