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

## Owner nalog bez pozivnice (OWNER_EMAIL / OWNER_PASSWORD)
Najlakši način da se dobije (ili povrati) prijava: u Coolify → Environment upiši `OWNER_EMAIL` i `OWNER_PASSWORD` (bar 8 znakova) pa Redeploy.
API pri startu napravi taj nalog kao **owner**, a ako već postoji — uskladi lozinku i ulogu. Promena lozinke u env-u = nova lozinka posle sledećeg Redeploy-a.
Demo nalog za druge (Member) ide preko Settings → Team → „Create demo login“.

## 1. Spoljni monitoring (5 min, besplatno) — preporučeno odmah

Monitoring iznutra ne može da javi ako padne ceo mini PC ili internet. Za to:

1. Napravi besplatan nalog na **uptimerobot.com** (ili **betterstack.com**).
2. *Add New Monitor* → **HTTP(s)** → URL: `https://<api-adresa>/health/deep` → interval 5 min.
3. *Alert contacts*: email i/ili Telegram.

## 2. Backup van servera (preporučeno)

Backup je na istom disku kao baza — ako disk otkaže, nestaje i backup. Jednom nedeljno kopiraj na Mac:

```bash
ssh IME@192.168.x.x "sudo docker run --rm -v <COOLIFY_STACK_ID>_backups:/b alpine sh -c 'ls -t /b/radar-*.sql.gz | head -1 | xargs cat'" > ~/scoutline-backup-$(date +%F).sql.gz
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

## 4. Auto-deploy na push (bez domena)

Server sam pokrene Redeploy kad commit na `main` prođe CI (testovi + build). Ako CI padne — ne deploy-uje i javi na Telegram. Ne treba javni domen ni webhook.

1. Coolify → **Keys & Tokens → API tokens** → napravi token sa dozvolom **deploy**.
2. Coolify → projekat → **Environment Variables**:
   - `COOLIFY_API_TOKEN` = taj token
   - `COOLIFY_API_URL` = adresa Coolify-ja kako je vidi server, npr. `http://192.168.x.x:8000`
   - `DEPLOY_REPO` = `AleksaT205/scoutline` (GitHub token u Settings → Integrations mora da vidi taj repo)
3. U podešavanjima projekta uključi **Include Source Commit in Build** (Coolify tada sam daje `SOURCE_COMMIT` i `COOLIFY_RESOURCE_UUID`).
4. Redeploy jednom. Stanje se vidi u **Settings → System → Auto-deploy** (i dugme *Check now*).

## 4b. Web na Cloudflare Pages (bez oznake „Powered by Netlify“)

Netlify na besplatnom planu dodaje oznaku na sajt i ona ne može da se isključi. Cloudflare Pages je besplatan, bez oznake, i isto objavljuje na svaki push.

1. Napravi nalog na dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → izaberi repo.
2. Build podešavanja:
   - Build command: `pnpm --filter @radar/web build`
   - Build output directory: `apps/web/dist`
   - Root directory: prazno (koren repoa)
   - Environment variables: `NODE_VERSION=20.19.4`, `PNPM_VERSION=10.20.0`, `VITE_API_URL=https://<server>.<tailnet>.ts.net`
3. Posle prvog deploy-a dobiješ adresu `https://<ime>.pages.dev`.
4. Coolify → Environment Variables: u `CORS_ORIGINS` dodaj novu adresu (zarezom, bez razmaka), a `DASHBOARD_URL` postavi na nju → Redeploy.
5. Kad sve radi na novoj adresi, Netlify sajt može da se obriše (ili ostavi kao rezerva).

Zaglavlja (uklj. dozvolu za mikrofon) su u `apps/web/public/_headers`; Cloudflare sam vraća `index.html` za sve putanje (SPA).

Ako Cloudflare ponudi noviji tok (Workers: polja „Deploy command“ / „Preview command“ umesto „Build output directory“): ostavi `npx wrangler deploy`, Path `/` — šta se objavljuje piše u `wrangler.jsonc` u korenu repoa. Promenljive (`NODE_VERSION`, `PNPM_VERSION`, `VITE_API_URL`) se upisuju u Advanced settings → Variable name. Adresa je tada `https://scoutline.<nalog>.workers.dev`.

## 5. Plaćeni AI modeli za klijente (AI Router)

Kad klijenti počnu da koriste router u produkciji, besplatni modeli nisu dovoljno pouzdani. U `infra/litellm.config.yaml`, u grupe `fast` i `smart`, dodaj plaćene modele (svoj OpenAI / Anthropic / Google ključ kao env promenljivu u Coolify-ju). Klijentima ništa ne menjaš — i dalje šalju `model: "auto"`. Budžet po klijentu već postoji (AI Router → klijent → Monthly budget).

## Checklist

- [ ] Deploy (backup + monitoring se uključuju sami)
- [ ] UptimeRobot na `/health/deep`
- [ ] Prvi backup kopiran na Mac
- [ ] Domen + Cloudflare Tunnel
- [ ] Auto-deploy (Coolify API token u env-u, Settings → System)
- [ ] Plaćeni modeli u `fast`/`smart` (kad dođu klijenti)
