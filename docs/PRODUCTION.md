# Produkcija (Faza 6)

Šta je već uključeno u kod i radi samo od sebe posle Deploy-a, i šta radiš ručno kad budeš spreman.

## Radi automatski

| Šta | Kako |
|---|---|
| **Backup baze** | Servis `backup` jednom dnevno pravi `pg_dump` u Docker volume `backups`, čuva poslednjih 14 dana (`BACKUP_KEEP_DAYS`). |
| **Monitoring iznutra** | API svakih 5 min proverava da li worker radi i da li izvori prolaze. Problem → jedna poruka na Telegram; popravka → „✅ ponovo radi“. |
| **Provera za spoljni monitoring** | `GET /health/deep` vraća 200 kad sve radi, 503 kad ne (baza, worker, izvori). |
| **Zaštita prijave** | Najviše 10 pogrešnih pokušaja po emailu u 15 minuta. |
| **Sigurnosna zaglavlja** | API (`secureHeaders`) i Netlify (`X-Frame-Options`, `nosniff`, …). |

## 1. Spoljni monitoring (5 min, besplatno) — preporučeno odmah

Monitoring iznutra ne može da javi ako padne ceo mini PC ili internet. Za to:

1. Napravi besplatan nalog na **uptimerobot.com** (ili **betterstack.com**).
2. *Add New Monitor* → **HTTP(s)** → URL: `https://<api-adresa>/health/deep` → interval 5 min.
3. *Alert contacts*: email i/ili Telegram.

## 2. Backup van servera (preporučeno)

Backup je na istom disku kao baza — ako disk otkaže, nestaje i backup. Jednom nedeljno kopiraj na Mac:

```bash
ssh IME@192.168.100.60 "sudo docker run --rm -v pgym4kazqlkwp5yi03fbcajg_backups:/b alpine sh -c 'ls -t /b/radar-*.sql.gz | head -1 | xargs cat'" > ~/scoutline-backup-$(date +%F).sql.gz
```

(Ime volume-a proveri sa `sudo docker volume ls | grep backups`.)

### Vraćanje backup-a

```bash
gunzip -c radar-2026-11-20_0300.sql.gz | sudo docker exec -i <postgres-kontejner> psql -U radar radar
```

Najbezbednije: prvo na praznu bazu (novi deploy), pa proveri dashboard.

## 3. Domen + Cloudflare Tunnel (kad krenete sa klijentima)

Zamenjuje Tailscale Funnel (lični plan je za nekomercijalnu upotrebu).

1. Kupi domen (~10–15 €/god) i prebaci DNS na **Cloudflare** (besplatan plan).
2. Cloudflare → **Zero Trust → Networks → Tunnels → Create tunnel** → tip *Cloudflared* → kopiraj **token**.
3. U istom tunelu dodaj *Public hostname*:
   - `api.tvojdomen.com` → `http://api:3000`
4. Coolify → Environment Variables:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=<token>
   CORS_ORIGINS=https://scoutline-app.netlify.app,https://app.tvojdomen.com
   ```
   i u podešavanjima Docker Compose resursa dodaj profil `tunnel` (ili custom start command: `docker compose --profile tunnel up -d`).
5. `netlify.toml` → `VITE_API_URL = "https://api.tvojdomen.com"` (push → Netlify sam objavi).
6. Netlify → Domain management → dodaj `app.tvojdomen.com`.
7. Kad sve radi preko domena: `sudo tailscale funnel --https=443 off` na serveru.

AI Router endpoint za klijente postaje `https://api.tvojdomen.com/llm/v1`.

## 4. Auto-deploy na push

Coolify treba da bude dostupan GitHub-u. Sa domenom:

1. U Cloudflare tunelu dodaj hostname `coolify.tvojdomen.com` → `http://host.docker.internal:8000` (ili IP servera:8000).
2. Zaštiti ga: Cloudflare **Access** aplikacija za `coolify.tvojdomen.com` (samo tvoj email), sa izuzetkom (*Bypass*) za putanju `/webhooks/*`.
3. Coolify → Sources → GitHub App → izmeni *Webhook URL* na novi domen.
4. Push na `main` → automatski deploy.

Dok nema domena: posle push-a klikni **Redeploy** u Coolify-ju.

## 5. Plaćeni AI modeli za klijente (AI Router)

Kad klijenti počnu da koriste router u produkciji, besplatni modeli nisu dovoljno pouzdani. U `infra/litellm.config.yaml`, u grupe `fast` i `smart`, dodaj plaćene modele (svoj OpenAI / Anthropic / Google ključ kao env promenljivu u Coolify-ju). Klijentima ništa ne menjaš — i dalje šalju `model: "auto"`. Budžet po klijentu već postoji (AI Router → klijent → Monthly budget).

## Checklist

- [ ] Deploy (backup + monitoring se uključuju sami)
- [ ] UptimeRobot na `/health/deep`
- [ ] Prvi backup kopiran na Mac
- [ ] Domen + Cloudflare Tunnel
- [ ] Auto-deploy preko Coolify webhook-a
- [ ] Plaćeni modeli u `fast`/`smart` (kad dođu klijenti)
