# Sharp & Fade — Salon Slot Booking (Backend + Database)

A full-stack haircut slot booking app: Node.js/Express backend, SQLite database,
plain HTML/CSS/JS frontend. No paid services required.

## What's inside

- **Backend:** `server.js` (Express) — handles signup/login, slot availability,
  booking, OTP generation, and cancellation.
- **Database:** `db.js` — SQLite via Node's built-in `node:sqlite` module.
  This means **zero database dependencies to install** and no native compilation
  (no `better-sqlite3`/`node-gyp` headaches). Requires Node.js v22.5+.
- **Frontend:** `public/index.html`, `public/app.js`, `public/styles.css` —
  calls the backend's REST API.
- **Auth:** passwords hashed with bcrypt, sessions via JWT (stored in the
  browser's localStorage and sent as a Bearer token).

## Business rules implemented

- Slots: 30 minutes, 9:00 AM – 10:00 PM daily.
- Lunch break: 12:00 PM – 1:00 PM (not bookable).
- Must be logged in (name, phone, password) to book or cancel.
- Each booking gets a random 6-digit OTP.
- Cancellation is blocked if it's less than 1 hour before the slot — enforced
  on the **server**, so it can't be bypassed from the browser.
- Double-booking is prevented at the database level (unique index on
  active bookings for a given date+time), so two people can't grab the same
  slot even if they click at the same instant.

## Run it locally (free, no signup needed)

Requires [Node.js](https://nodejs.org) v22.5 or newer.

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

The database file is created automatically at `db/salon.sqlite` the first
time you run it. Delete that file any time to reset all data.

## Deploying it for free

The app is a single Node process + a SQLite file, so it runs on any free
Node hosting tier. A few good options:

### Option A: Render.com (free web service)
1. Push this project to a GitHub repo.
2. On [render.com](https://render.com), create a **New Web Service**, connect
   the repo.
3. Build command: `npm install` · Start command: `npm start`
4. Set environment variable `JWT_SECRET` to any long random string
   (Render → Environment tab).
5. **Note:** Render's free tier has an *ephemeral filesystem* — the SQLite
   file resets whenever the service restarts/sleeps. Fine for a demo; for
   real persistent bookings, attach a free Render Disk (small paid add-on) or
   switch to Option C below.

### Option B: Railway.app / Fly.io free tier
Same idea — connect the repo, `npm install` + `npm start`. Both offer small
free/trial allowances and (on paid-but-cheap tiers) persistent volumes for
the SQLite file. Check current free-tier limits before relying on it.

### Option C: Keep SQLite truly persistent for free — Supabase/Postgres swap
If you want bookings to survive restarts on a free host with an ephemeral
disk, the simplest fix is swapping SQLite for a free hosted Postgres
database (e.g. **Supabase free tier** or **Neon free tier** — both free,
always-on, persistent). This requires changing `db.js` to use a Postgres
client (`pg`) instead of `node:sqlite`, while every other file (routes,
frontend) stays the same. Ask me and I'll do that swap if you'd like the
fully-persistent free version.

### Option D: A VPS-like always-on free box
Platforms like **Glitch** or a free-tier **Oracle Cloud / Google Cloud**
VM keep a real disk, so SQLite persists naturally with no code changes —
heavier to set up than A/B, but no database swap needed.

## Environment variables

| Variable     | Purpose                          | Required |
|--------------|-----------------------------------|----------|
| `JWT_SECRET` | Secret used to sign login tokens | Recommended in production |
| `PORT`       | Port to listen on                | No (defaults to 3000) |

## Project structure

```
salon-booking/
├── server.js          # Express API
├── db.js              # SQLite setup (node:sqlite)
├── package.json
├── db/                 # created automatically — holds salon.sqlite
└── public/
    ├── index.html
    ├── app.js          # frontend logic, talks to the API
    └── styles.css
```
