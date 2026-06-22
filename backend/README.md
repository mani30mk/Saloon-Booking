# Sharp & Fade — Salon Slot Booking (Backend + Database)

A full-stack haircut slot booking app: Node.js/Express backend, PostgreSQL database,
plain HTML/CSS/JS frontend. No paid services required.

## What's inside

- **Backend:** `server.js` (Express) — handles signup/login, slot availability,
  booking, OTP generation, and cancellation.
- **Database:** `db.js` — PostgreSQL database via the `pg` module. The tables are initialized automatically on start.
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
- Admin portal to view daily bookings and mark them as complete by verifying OTPs.

## Run it locally

Requires [Node.js](https://nodejs.org) v22.5 or newer and a PostgreSQL database.

1. Set your environment variables (e.g., in a `.env` file):
   ```env
   POSTGRES_URL="postgres://user:password@host/dbname"
   JWT_SECRET="your-secret-key"
   ADMIN_PASSWORD="admin-secure-password"
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```

Then open **http://localhost:3000** in your browser.

## Deploying

The app is a standard Node.js Express application and can be deployed anywhere that supports Node and environment variables.

### Recommended Free Deployment
1. **Database**: Create a free PostgreSQL database on **Neon.tech** or **Supabase**. Get the connection string.
2. **Hosting**: Deploy the repository to **Vercel** (using the included `vercel.json`) or **Render.com** (as a Web Service). 
3. **Configuration**: Add the `POSTGRES_URL`, `JWT_SECRET`, and `ADMIN_PASSWORD` to your host's environment variables.

## Environment variables

| Variable           | Purpose                                      | Required |
|--------------------|----------------------------------------------|----------|
| `POSTGRES_URL`     | Connection string for your Postgres database | Yes      |
| `JWT_SECRET`       | Secret used to sign login tokens             | Recommended in production |
| `ADMIN_PASSWORD`   | Password used to access the admin portal     | Recommended in production |
| `PORT`             | Port to listen on                            | No (defaults to 3000) |

## Project structure

```
salon-booking/
├── server.js          # Express API
├── db.js              # PostgreSQL connection and table setup
├── package.json
├── vercel.json        # Configuration for Vercel serverless deployment
└── public/
    ├── index.html     # Main customer booking site
    ├── admin.html     # Admin dashboard
    ├── app.js         # Frontend logic, talks to the API
    └── styles.css
```
