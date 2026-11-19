# Yeastar On-Call Scheduler

A small Docker-hosted web app for scheduling on-call forwarding on a **Yeastar P-Series** PBX.

Users sign in and schedule **changeovers**: from a set date and time, calls arriving on a
selected **inbound route** go to the on-call person's mobile number. Each changeover stays in
effect until the next one. A "Normal routing" changeover puts the route back to its usual
destination.

- Username/password sign-in (scrypt hashes, HttpOnly session cookie)
- Admin and standard users. Standard users schedule themselves; admins schedule anyone and manage the team
- Mobile-first UI with a bottom tab bar and bottom-sheet forms, a desktop layout, and automatic dark mode
- One Node.js process, one dependency (Express), and SQLite built into Node, so there is no build step
- Audit log of logins, schedule edits and every change sent to the PBX

## How it works

1. Every `CHECK_INTERVAL_SECONDS` (default 30 s), the scheduler finds the latest changeover whose start time has passed.
2. If that differs from what was last sent to the PBX, it calls `inbound_route/update` on the selected route:
   - **Forward to mobile**: `def_dest=external_num`, `def_dest_value=<prefix><mobile>`
   - **Normal routing**: restores the destination fields captured just before the first redirect (the *snapshot*)
3. Failed updates are retried on every check, and the error appears in the UI.

## Quick start

```bash
cp .env.example .env
```

Edit `.env` and set at least `ADMIN_PASSWORD`, `YEASTAR_BASE_URL`, `YEASTAR_CLIENT_ID` and `YEASTAR_CLIENT_SECRET`.

```bash
docker compose up -d --build
```

Open `http://<host>:3000`, sign in as the admin, then:

1. **PBX** tab → **Load from PBX** → pick the inbound route → **Save**
2. **Team** tab → add users and their mobile numbers
3. **Schedule** tab → **Add changeover**

`YEASTAR_DRY_RUN=true` is the default in `.env.example`. In dry-run mode the app logs each
change instead of sending it, so you can try everything safely. Set it to `false` to go live.

### Yeastar setup

On the PBX, go to **Integrations → API** and turn on the API. Copy the **Client ID** and
**Client Secret** into `.env`, and add this server's IP address to the API's allowed IP list.

### Check the field mapping before going live

The default field names (`def_dest`, `def_dest_value`, `external_num`) follow the P-Series Open
API. Firmware versions differ, so before going live:

1. Turn dry-run off.
2. Select the route.
3. Look at **PBX → Normal destination snapshot**. It shows the real field names and values read from your route.
4. If the names differ, adjust `YEASTAR_DEST_*` in `.env`. If your PBX needs an outbound prefix or extra fields for external numbers, set `YEASTAR_NUMBER_PREFIX` / `YEASTAR_EXTRA_FIELDS_JSON`.
5. Test with a **Start immediately** changeover and call the DID.

## Production notes

- Put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) and set `COOKIE_SECURE=true`.
- Data (users, schedule, snapshot, audit log) lives in the `oncall-data` Docker volume as `/data/oncall.db`. Back up that file.
- If `ADMIN_PASSWORD` is empty on first start, a random password is printed in the container log.
- The UI shows times in each viewer's own time zone. They are stored as UTC.

## Local development (without Docker)

Requires Node 24+.

```bash
npm install
```

```bash
node dev/mock-yeastar.js
```

```bash
YEASTAR_BASE_URL=http://127.0.0.1:8099 YEASTAR_CLIENT_ID=test YEASTAR_CLIENT_SECRET=test ADMIN_PASSWORD=devpass123 DATA_DIR=./data node src/server.js
```

`dev/mock-yeastar.js` is a fake PBX with two inbound routes. It prints every update it receives.

## Project layout

```
src/server.js      Express app, security headers, static files
src/api.js         REST API (auth, changeovers, users, PBX settings, audit)
src/scheduler.js   Changeover evaluation and PBX sync loop
src/yeastar.js     Yeastar Open API client (token, refresh, inbound routes)
src/auth.js        Password hashing, sessions, CSRF guard, login throttle
src/db.js          SQLite schema (node:sqlite)
public/            Frontend (vanilla JS/CSS, no build)
dev/               Mock PBX for testing
```
