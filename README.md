# Prime Fleet Cloud (local)

Minimal stack: **Next.js panel** + **Postgres** + **OpenWA**.

## Quick local

1. Start Docker Desktop.
2. From this folder:

```bash
docker compose up -d db openwa
```

3. Panel (host):

```bash
cd app
copy ..\.env.example .env   # or use existing .env
npm install
npm run db:setup
npm run dev
```

- Panel: http://localhost:3000  
- Login: `admin@primefleet.local` / `admin12345`  
- OpenWA dashboard: http://127.0.0.1:2785  

4. After QR + session: put `OPENWA_API_KEY` + `OPENWA_SESSION_ID` in `app/.env`, restart `npm run dev`.

5. In panel → **Licenses** → create **14-day free trial** (or paid). After trial ends, WhatsApp API returns 403 until you **Convert to paid**.

6. WordPress plugin → WhatsApp → driver **Prime Fleet Cloud**, Cloud URL `http://127.0.0.1:3000`, paste license key from panel.

## Full compose (panel in Docker too)

Set `OPENWA_API_KEY` / `OPENWA_SESSION_ID` in `.env` at repo root, then:

```bash
docker compose up -d --build
```

Panel on http://localhost:3040
