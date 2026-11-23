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
