# Hostinger VPS par deploy (KVM 1 / KVM 2, Docker template, Ubuntu 24.04)

Hostinger ka **Docker** template (Ubuntu 24.04 with Docker) lo, to Docker pehle se installed hota hai. Database isi server par chalta hai
(Neon ki zarurat nahi), aur site + API ek hi jagah se chalte hain (Caddy HTTPS khud lagata hai).

1. **Server:** root password mazboot rakho (chat ya kisi ko mat bhejo). hPanel > VPS > **Firewall** me sirf 22, 80, 443 kholo.
2. **Domain:** DNS (Cloudflare) me A record: `app` -> VPS ka IP. Cloudflare me us record ko pehle **DNS only** (grey cloud) rakho jab tak HTTPS na chal jaye.
3. VPS terminal / SSH me:
   ```
   git clone https://github.com/risingwealthcommunity-cyber/Rising-Wealth-Community.git rwc && cd rwc
   cp deploy/.env.example deploy/.env && nano deploy/.env
   ```
   `.env` me: `DOMAIN`, `DB_PASSWORD`, teen secrets (`openssl rand -hex 48`), `R2_*` (nayi rolled keys), mail (`EMAIL_USER`/`EMAIL_PASS` ya `BREVO_API_KEY`),
   `ROOT_EMAIL`/`ROOT_PASSWORD`, `DEMO_*`. `ENABLE_ADMIN_2FA=true` tabhi jab mail set ho.
4. 2 GB / 4 GB RAM par build ke liye swap (neeche wala "swap" step) pehle laga lo.
5. `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`
   Start par tables, seed (admin, site, demo) aur points recount apne aap chalte hain.
6. **Roz ka database backup** (R2 me bhi copy jaati hai):
   `crontab -e` -> `0 3 * * * cd /root/rwc && sh deploy/backup.sh >> /var/log/rwc-backup.log 2>&1`
   Ek baar `sh deploy/backup.sh` haath se chala ke dekh lo ki "Saved ..." aur "Copied to R2" aaya.
7. R2 bucket CORS me `https://<domain>` daalo (video upload ke liye, PUT allow).
8. Update: `cd rwc && git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`

Frontend Cloudflare Pages par alag karna ho to: Pages me `VITE_API_URL=https://api.<domain>` daalo, root `frontend`, build `npm run build`, output `dist`
(`public/_redirects` pehle se hai), aur backend `.env` me `FRONTEND_URL` Pages wale domain par.

---

# Oracle Cloud (Always Free) par deploy

## 1. Machine banao
- Oracle Cloud > Compute > Create instance. Image: **Ubuntu 22.04**. Shape: **Ampere A1 (ARM) 2 OCPU / 12 GB** best hai (free). Agar A1 na mile to AMD `E2.1.Micro` (1 GB RAM) chalega, par pehle swap lagana padega (neeche).
- SSH key download karke rakho.
- Machine ka **Public IP** note karo (aur "Reserved public IP" bana lo taaki badle nahi).

## 2. Ports kholo (dono jagah, warna site nahi khulegi)
1. Oracle Console > VCN > Security List > **Ingress rules**: TCP **80** aur **443**, source `0.0.0.0/0`.
2. Server ke andar (Oracle ki Ubuntu image mein iptables band rakhta hai):
```
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
```

## 3. Domain
Apne domain ke DNS mein ek **A record** banao: `app` (ya jo naam) -> server ka Public IP. HTTPS ke liye domain zaroori hai (Caddy certificate khud leta hai).

## 4. Docker lagao
```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # phir logout/login
```
(Sirf 1 GB wali machine par:) `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`

## 5. Code aur settings
```
git clone https://github.com/risingwealthcommunity-cyber/Rising-Wealth-Community.git rwc && cd rwc
cp deploy/.env.example deploy/.env && nano deploy/.env
```
`deploy/.env` mein har value bharo. Secrets ke liye `openssl rand -hex 48` (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, FIELD_ENCRYPTION_KEY alag-alag). **R2 ki nayi (rolled) keys** daalo.
Dhyan: `ENABLE_ADMIN_2FA=true` tabhi rakho jab email (Brevo) set ho, warna admin login nahi kar paayega.

## 6. Chalao
```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api npx ts-node src/seed.ts
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api npx ts-node src/seed-site.ts
```
`https://<domain>` kholo. Admin ID `ROOT_EMAIL` / `ROOT_PASSWORD` se. Login ke baad password badal lo aur `.env` se `ROOT_PASSWORD` hata do.

## 7. Cloudflare / Google mein domain jodo
- R2 bucket > Settings > CORS: `AllowedOrigins` mein `https://<domain>` daalo.
- Google login use karte ho to Google Console mein redirect URI: `https://<domain>/api/auth/google/callback`.

## Roz ke kaam
- Update: `git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`
- Logs: `docker compose -f deploy/docker-compose.yml logs -f api`
- Backup: `docker compose -f deploy/docker-compose.yml exec db pg_dump -U rwc rwc > backup-$(date +%F).sql` (isko kahin bahar bhi rakho).

---

# DigitalOcean par deploy (Droplet 2 GB, ~$12/mahina)

Oracle ke iptables wale steps yahan nahi chahiye. Baaki sab same hai.

1. **Create > Droplets.** Region **Bangalore (BLR1)**, Image **Ubuntu 22.04 (LTS) x64**, Size **Basic > Regular SSD > $12/mo (2 GB)**,
   Authentication **Password**, Hostname `rwc`. Create dabao, aur uska **IP** note karo.
2. **Networking > Firewalls > Create Firewall:** Inbound mein SSH 22, HTTP 80, HTTPS 443 (All IPv4). Droplet ko is firewall se jodo.
3. Droplet page > **Console** kholo (browser mein terminal) aur chalao:
   ```
   curl -fsSL https://get.docker.com | sudo sh
   git clone https://github.com/risingwealthcommunity-cyber/Rising-Wealth-Community.git rwc && cd rwc
   cp deploy/.env.example deploy/.env && nano deploy/.env
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   ```
4. **Domain:** DNS mein A record (`app`) -> Droplet ka IP. `deploy/.env` mein `DOMAIN=app.yourdomain.com`. Caddy HTTPS khud lagata hai.
5. **Roz ka backup:** `sudo crontab -e` mein ye line jodo (roz raat 3 baje):
   ```
   0 3 * * * cd /root/rwc && sh deploy/backup.sh >> /var/log/rwc-backup.log 2>&1
   ```
   Restore: `gunzip -c /var/backups/rwc/<file>.sql.gz | docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U rwc rwc`
6. **Update:** `cd rwc && git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`

## 2 GB wali machine ke liye swap (build ke waqt memory bachane ke liye)
```
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```
