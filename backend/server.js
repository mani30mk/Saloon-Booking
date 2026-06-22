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
const LUNCH_START = 13; // 1:00 PM
const LUNCH_END = 14;   // 2:00 PM
const TEA_START = 16; // 4:30 PM

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
  return time === "1:00PM" || time === "1:30PM";
}

function isTea(time) {
  return time === "4:30PM";
}

function getShopWallDate() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.TIMEZONE || 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const p = {};
  parts.forEach(part => { p[part.type] = part.value; });
  let h = parseInt(p.hour, 10);
  if (h === 24) h = 0;
  return new Date(parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day), h, parseInt(p.minute), parseInt(p.second));
}

function slotToDate(dateStr, time) {
  const [yyyy, mm, dd] = dateStr.split('-');
  const match = time.match(/(\d+):(\d+)(AM|PM)/);
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3];
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd), h, m, 0, 0);
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

    const leavesResult = await db.query("SELECT * FROM admin_leaves WHERE date = $1", [date]);
    const leaves = leavesResult.rows;

    const [yyyy, mm, dd] = date.split('-');
    const dateObj = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    const isTuesday = dateObj.getDay() === 2;

    const now = getShopWallDate();
    const slots = allTimes.map(time => {
      let status = "open";
      if (isTuesday) status = "holiday";
      else {
        let inLeave = false;
        for (const l of leaves) {
          if (l.is_full_day) { inLeave = true; break; }
          if (l.start_time && l.end_time) {
            const slotDt = slotToDate(date, time);
            const startDt = slotToDate(date, l.start_time);
            const endDt = slotToDate(date, l.end_time);
            if (slotDt >= startDt && slotDt < endDt) { inLeave = true; break; }
          }
        }
        if (inLeave) status = "leave";
        else if (isLunch(time)) status = "lunch";
        else if (isTea(time)) status = "tea";
        else if (taken.includes(time)) status = "taken";
        else if (slotToDate(date, time) < now) status = "past";
      }
      return { time, status };
    });

    res.json({ date, slots });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/bookings", authMiddleware, async (req, res) => {
  const { date, time, persons = 1 } = req.body || {};
  if (!date || !time) return res.status(400).json({ error: "date and time are required." });

  const numPersons = parseInt(persons, 10);
  if (isNaN(numPersons) || numPersons < 1 || numPersons > 5) {
    return res.status(400).json({ error: "Persons must be between 1 and 5." });
  }

  const allTimes = generateSlotTimes();
  const startIndex = allTimes.indexOf(time);
  if (startIndex === -1) {
    return res.status(400).json({ error: "Invalid time slot." });
  }

  const requestedSlots = allTimes.slice(startIndex, startIndex + numPersons);
  if (requestedSlots.length < numPersons) {
    return res.status(400).json({ error: "Not enough contiguous slots available before closing time." });
  }

  for (const slotTime of requestedSlots) {
    if (isLunch(slotTime)) return res.status(400).json({ error: `Slot ${slotTime} is during the lunch break.` });
    if (isTea(slotTime)) return res.status(400).json({ error: `Slot ${slotTime} is during the tea break.` });
    const slotDt = slotToDate(date, slotTime);
    if (slotDt < getShopWallDate()) {
      return res.status(400).json({ error: `Slot ${slotTime} is in the past.` });
    }
  }

  const [yyyy, mm, dd] = date.split('-');
  const dateObj = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
  if (dateObj.getDay() === 2) {
    return res.status(400).json({ error: "Sorry, Tuesday is a holiday." });
  }

  try {
    const leavesResult = await db.query("SELECT * FROM admin_leaves WHERE date = $1", [date]);
    for (const l of leavesResult.rows) {
      if (l.is_full_day) return res.status(400).json({ error: "The salon is closed on this day." });
      if (l.start_time && l.end_time) {
        const startDt = slotToDate(date, l.start_time);
        const endDt = slotToDate(date, l.end_time);
        for (const slotTime of requestedSlots) {
          const slotDt = slotToDate(date, slotTime);
          if (slotDt >= startDt && slotDt < endDt) {
            return res.status(400).json({ error: `Slot ${slotTime} is during an admin leave.` });
          }
        }
      }
    }

    const existingDayBookingResult = await db.query(
      "SELECT id FROM bookings WHERE user_id = $1 AND date = $2 AND status = 'confirmed'",
      [req.user.id, date]
    );
    if (existingDayBookingResult.rows.length > 0) {
      return res.status(400).json({ error: "You can only book one session per day." });
    }

    const activeBookingsResult = await db.query(
      "SELECT date, time FROM bookings WHERE user_id = $1 AND status = 'confirmed'",
      [req.user.id]
    );
    const now = getShopWallDate();
    for (const b of activeBookingsResult.rows) {
      if (slotToDate(b.date, b.time) >= now) {
        return res.status(400).json({ error: "You already have an active booking. You cannot book another until it expires or is cancelled." });
      }
    }

    const existingSlotResult = await db.query(
      "SELECT time FROM bookings WHERE date = $1 AND time = ANY($2::text[]) AND status = 'confirmed'",
      [date, requestedSlots]
    );
    if (existingSlotResult.rows.length > 0) {
      const takenStr = existingSlotResult.rows.map(r => r.time).join(", ");
      return res.status(409).json({ error: `Sorry, the following slots are already taken: ${takenStr}` });
    }

    const otp = genOtp();
    const insertedBookings = [];
    for (const slotTime of requestedSlots) {
      const insertResult = await db.query(
        "INSERT INTO bookings (user_id, date, time, otp, status) VALUES ($1, $2, $3, $4, 'confirmed') RETURNING id",
        [req.user.id, date, slotTime, otp]
      );
      insertedBookings.push({ id: insertResult.rows[0].id, date, time: slotTime, otp, status: "confirmed" });
    }

    res.json({
      booking: insertedBookings[0]
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error." });
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
    const msUntil = slotDt - getShopWallDate();
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
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yesterdayStr = `${yyyy}-${mm}-${dd}`;

    await db.query("DELETE FROM bookings WHERE status = 'completed' AND date < $1", [yesterdayStr]);

    const result = await db.query(`
      SELECT b.id, b.date, b.time, b.status, b.otp, u.name, u.phone 
      FROM bookings b 
      JOIN users u ON b.user_id = u.id 
      ORDER BY b.date ASC, b.time ASC
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

app.post("/api/admin/bookings/:id/cancel", adminMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const bookingResult = await db.query("SELECT * FROM bookings WHERE id = $1", [id]);
    const booking = bookingResult.rows[0];

    if (!booking) {
      return res.status(404).json({ error: "Booking not found." });
    }
    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "Booking is already cancelled." });
    }

    await db.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [id]);
    res.json({ success: true, message: "Booking cancelled successfully." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/leaves", adminMiddleware, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM admin_leaves ORDER BY date ASC, id ASC");
    res.json({ leaves: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin/leaves", adminMiddleware, async (req, res) => {
  const { date, is_full_day, start_time, end_time } = req.body || {};
  if (!date) return res.status(400).json({ error: "date is required." });
  try {
    await db.query(
      "INSERT INTO admin_leaves (date, is_full_day, start_time, end_time) VALUES ($1, $2, $3, $4)",
      [date, is_full_day === true, start_time || null, end_time || null]
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/admin/leaves/:id", adminMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await db.query("DELETE FROM admin_leaves WHERE id = $1", [id]);
    res.json({ success: true });
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
