# Shared OpenWA VPS — SSH fetch + rebuild

**Host (current DPS snapshot):** `193.182.128.85`  
**User:** `admin`  
**Scripts in repo:** `scripts/vps/bootstrap-openwa.sh` + `docker-compose.openwa.yml`  
**GitHub:** https://github.com/brandbees/prime-fleet-cloud  

Remote path expected by panel: `/home/admin/scripts/vps/bootstrap-openwa.sh`

---

## 1) Connect

```bash
ssh admin@193.182.128.85
```

(If you use a key from Windows:)

```bash
ssh -i /path/to/your-key.pem admin@193.182.128.85
```

---

## 2) Fetch latest scripts from GitHub

**Option A — sparse clone (recommended)**

```bash
mkdir -p ~/src
cd ~/src
if [ -d prime-fleet-cloud/.git ]; then
  cd prime-fleet-cloud && git fetch origin && git checkout main && git pull --ff-only origin main
else
  git clone --depth 1 --branch main https://github.com/brandbees/prime-fleet-cloud.git
  cd prime-fleet-cloud
fi

mkdir -p ~/scripts/vps
cp -f scripts/vps/bootstrap-openwa.sh scripts/vps/docker-compose.openwa.yml ~/scripts/vps/
chmod +x ~/scripts/vps/bootstrap-openwa.sh
```

**Option B — raw download (no git on VPS)**

```bash
mkdir -p ~/scripts/vps && cd ~/scripts/vps
curl -fsSL -o bootstrap-openwa.sh \
  https://raw.githubusercontent.com/brandbees/prime-fleet-cloud/main/scripts/vps/bootstrap-openwa.sh
curl -fsSL -o docker-compose.openwa.yml \
  https://raw.githubusercontent.com/brandbees/prime-fleet-cloud/main/scripts/vps/docker-compose.openwa.yml
chmod +x bootstrap-openwa.sh
```

---

## 3) Bootstrap (idempotent — skips if already healthy)

```bash
bash ~/scripts/vps/bootstrap-openwa.sh
```

Prints `OPENWA_BASE_URL` + `OPENWA_API_KEY` when done. Health: `http://127.0.0.1:2785/api/health`

---

## 4) Force rebuild (when you want a fresh container)

Bootstrap skips when health + API key already OK. To force:

```bash
cd /home/admin/openwa-runtime
docker compose -f docker-compose.openwa.yml pull
docker compose -f docker-compose.openwa.yml up -d --force-recreate
# or full wipe (keeps host key file if you don't delete it):
# docker compose -f docker-compose.openwa.yml down
# bash ~/scripts/vps/bootstrap-openwa.sh
```

After recreate, confirm:

```bash
curl -fsS http://127.0.0.1:2785/api/health
docker exec -u 0 openwa-api sh -c 'tr -d "\r\n" </app/data/.api-key'
```

Put the API key into Panel → WhatsApp (or let pay→`WA_PROVIDER=shared` bootstrap write it).

---

## 5) One-liner from your PC (no interactive shell)

```bash
scp scripts/vps/bootstrap-openwa.sh scripts/vps/docker-compose.openwa.yml admin@193.182.128.85:~/scripts/vps/
ssh admin@193.182.128.85 'chmod +x ~/scripts/vps/bootstrap-openwa.sh && bash ~/scripts/vps/bootstrap-openwa.sh'
```
