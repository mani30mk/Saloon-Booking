// server.js — Express backend for salon slot booking
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const db = require("./db"); // Now connects to PostgreSQL pool

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- Helpers ---------------- */

const OPEN_HOUR = 9;    // 9:00 AM
const CLOSE_HOUR = 22;  // 10:00 PM
const LUNCH_START = 12; // 12:00 PM
const LUNCH_END = 13;   // 1:00 PM

function generateSlotTimes() {
  const slots = [];
  let h = OPEN_HOUR, m = 0;
  while (h < CLOSE_HOUR) {
    slots.push(fmtTime(h, m));
    m += 30;
    if (m === 60) { m = 0; h++; }
  }
  return slots;
}

function fmtTime(h, m) {
  const period = h >= 12 ? "PM" : "AM";
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${m === 0 ? "00" : m}${period}`;
}

function isLunch(time) {
  return time === "12:00PM" || time === "12:30PM";
}

function slotToDate(dateStr, time) {
  const match = time.match(/(\d+):(\d+)(AM|PM)/);
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3];
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, phone, name }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

/* ---------------- Auth routes ---------------- */

app.post("/api/signup", async (req, res) => {
  const { name, phone, password } = req.body || {};
  if (!name || !phone || !password) {
    return res.status(400).json({ error: "Name, phone, and password are required." });
  }
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: "Enter a valid 10-digit phone number." });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters." });
  }

  try {
    const existing = await db.query("SELECT id FROM users WHERE phone = $1", [phone]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this phone number already exists." });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.query(
      "INSERT INTO users (name, phone, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [name, phone, hash]
    );

    const userId = result.rows[0].id;
    const token = jwt.sign({ id: userId, phone, name }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { name, phone } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ error: "Phone and password are required." });
  }

  try {
    const result = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect phone number or password." });
    }
    const token = jwt.sign({ id: user.id, phone: user.phone, name: user.name }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { name: user.name, phone: user.phone } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: { name: req.user.name, phone: req.user.phone } });
});

/* ---------------- Slot / booking routes ---------------- */

app.get("/api/slots", async (req, res) => {
  const { date } = req.query; // YYYY-MM-DD
  if (!date) return res.status(400).json({ error: "date query param required (YYYY-MM-DD)." });

  try {
    const allTimes = generateSlotTimes();
    const takenResult = await db.query(
      "SELECT time FROM bookings WHERE date = $1 AND status = 'confirmed'",
      [date]
    );
    const taken = takenResult.rows.map(r => r.time);

    const now = new Date();
    const slots = allTimes.map(time => {
      let status = "open";
      if (isLunch(time)) status = "lunch";
      else if (taken.includes(time)) status = "taken";
      else if (slotToDate(date, time) < now) status = "past";
      return { time, status };
    });

    res.json({ date, slots });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/bookings", authMiddleware, async (req, res) => {
  const { date, time } = req.body || {};
  if (!date || !time) return res.status(400).json({ error: "date and time are required." });
  if (isLunch(time)) return res.status(400).json({ error: "That slot is during the lunch break." });

  const slotDt = slotToDate(date, time);
  if (slotDt < new Date()) {
    return res.status(400).json({ error: "That slot is in the past." });
  }
  if (!generateSlotTimes().includes(time)) {
    return res.status(400).json({ error: "Invalid time slot." });
  }

  try {
    const existingDayBookingResult = await db.query(
      "SELECT id FROM bookings WHERE user_id = $1 AND date = $2 AND status = 'confirmed'",
      [req.user.id, date]
    );
    if (existingDayBookingResult.rows.length > 0) {
      return res.status(400).json({ error: "You can only book one slot per day." });
    }

    const activeBookingsResult = await db.query(
      "SELECT date, time FROM bookings WHERE user_id = $1 AND status = 'confirmed'",
      [req.user.id]
    );
    const now = new Date();
    for (const b of activeBookingsResult.rows) {
      if (slotToDate(b.date, b.time) >= now) {
        return res.status(400).json({ error: "You already have an active booking. You cannot book another until it expires or is cancelled." });
      }
    }

    const existingSlotResult = await db.query(
      "SELECT id FROM bookings WHERE date = $1 AND time = $2 AND status = 'confirmed'",
      [date, time]
    );
    if (existingSlotResult.rows.length > 0) {
      return res.status(409).json({ error: "Sorry, that slot was just taken. Pick another." });
    }

    const otp = genOtp();
    const insertResult = await db.query(
      "INSERT INTO bookings (user_id, date, time, otp, status) VALUES ($1, $2, $3, $4, 'confirmed') RETURNING id",
      [req.user.id, date, time, otp]
    );

    res.json({
      booking: { id: insertResult.rows[0].id, date, time, otp, status: "confirmed" }
    });
  } catch (e) {
    console.error(e);
    res.status(409).json({ error: "Sorry, that slot was just taken. Pick another." });
  }
});

app.get("/api/bookings", authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, date, time, otp, status FROM bookings WHERE user_id = $1 ORDER BY date, time",
      [req.user.id]
    );
    res.json({ bookings: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/bookings/:id/cancel", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const bookingResult = await db.query("SELECT * FROM bookings WHERE id = $1", [id]);
    const booking = bookingResult.rows[0];

    if (!booking || booking.user_id !== req.user.id) {
      return res.status(404).json({ error: "Booking not found." });
    }
    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "Booking is already cancelled." });
    }

    const slotDt = slotToDate(booking.date, booking.time);
    const msUntil = slotDt - new Date();
    if (msUntil < 60 * 60 * 1000) {
      return res.status(400).json({ error: "Cancellations must be made at least 1 hour before the booking time." });
    }

    await db.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ---------------- Admin routes ---------------- */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid admin password." });
  }
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "1d" });
  res.json({ token });
});

function adminMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Forbidden: Admin only." });
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired." });
  }
}

app.get("/api/admin/bookings", adminMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT b.id, b.date, b.time, b.status, b.otp, u.name, u.phone 
      FROM bookings b 
      JOIN users u ON b.user_id = u.id 
      ORDER BY b.date DESC, b.time DESC
    `);
    res.json({ bookings: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin/verify-otp", adminMiddleware, async (req, res) => {
  const { booking_id, otp } = req.body || {};
  if (!booking_id || !otp) return res.status(400).json({ error: "booking_id and otp required." });

  try {
    const result = await db.query("SELECT * FROM bookings WHERE id = $1", [booking_id]);
    const booking = result.rows[0];
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    if (booking.status !== "confirmed") return res.status(400).json({ error: "Booking is not in a confirmed state." });
    
    if (booking.otp !== otp) {
      return res.status(400).json({ error: "Invalid OTP." });
    }

    await db.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [booking_id]);
    res.json({ success: true, message: "OTP verified! Booking marked as completed." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ---------------- Fallback to frontend ---------------- */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Do not call app.listen if we are in a serverless environment like Vercel
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Salon booking server running on http://localhost:${PORT}`);
  });
}

// Export the Express API
module.exports = app;
