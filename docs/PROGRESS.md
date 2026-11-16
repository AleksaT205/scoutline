# Napredak

Ažurirati posle svakog radnog dana. Najnovije gore.

## Faze

| Faza | Šta | Status |
|---|---|---|
| 0 | Temelj: monorepo, baza, Docker, Netlify, Coolify, GitHub | ✅ |
| 1 | Izvori oglasa (7), filter, ocena (AI/pravila), Telegram | ✅ |
| 1.5 | Dashboard: dizajn, filteri (i po vremenu objave), pretraga, tema, ručno dodavanje leada, stranica Sources, pravi brojevi, osvežavanje svakog minuta, podešavanja Telegram obaveštenja | ✅ |
| 2 | AI Router (MVP): endpoint `/llm/v1`, auto rutiranje fast/smart, klijenti, budžeti, ušteda | ✅ |
| 3 | Pipeline / CRM: status leada (New → Contacted → Replied → Meeting → Won/Lost), „Hide“, beleške, istorija, kanban sa prevlačenjem, filter po statusu | ✅ |
| 4 | Overview: leadovi po danu, funnel (contacted → replied → won), izvori, tržišta, usluge, udeo AI ocena; period 7/30/90 dana | ✅ |
| **5** | **Team & Settings:** nalozi i uloge umesto timske lozinke, pozivnice, link za pregled | ⏭ sledeće |
| 6 | Produkcija: domen, Cloudflare Tunnel, backup baze, monitoring, plaćeni modeli za klijente | |
| 7 | Dev workflow: zadaci i planiranje povezani sa GitHub-om (Issues), rad kroz Claude Code / Codex pretplatu | |

**Sledeći korak:** Deploy u Coolify-ju → Faza 5 (Team & Settings).

## Urađeno

- **16. 11. 2026. — Faza 0**
  - Monorepo: pnpm + Turborepo + TypeScript; `apps/web` (Netlify), `apps/api` (Hono), `apps/worker`, `packages/shared`, `packages/db`.
  - Tier logika zemalja, detekcija zemlje i remote, konačna ocena — sa testovima (4/4 prolaze).
  - Drizzle šema (sources, raw_items, companies, leads, lead_events) + prva migracija.
  - Docker Compose (Postgres, LiteLLM, Ollama, api, worker), `.env.example`, `netlify.toml`, GitHub Actions CI.
  - Provereno lokalno: typecheck, testovi, build, `/health`, frontend vidi API. **Nije provereno:** pokretanje Docker Compose-a (na Mac-u nije pokrenut Docker) i deploy na Netlify.

- **16. 11. 2026.**
  - Istraživanje OpenMatter-a (šta rade, ModelRouter, ključevi, token) → zaključak: pravimo svoje, jeftinije i jednostavnije.
  - Plan platforme: [PLAN.md](PLAN.md), izvori [SOURCES.md](SOURCES.md), troškovi [COSTS.md](COSTS.md), deploy [DEPLOY.md](DEPLOY.md), server [SERVER.md](SERVER.md).
  - Odluke tima upisane u PLAN.md §8 (usluge, filteri, SR/EN, email, Telegram).
  - Dizajn sistem [DESIGN.md](DESIGN.md) + mockup [../design/mockup.html](../design/mockup.html) — tamna i svetla tema.
  - Mini PC: Ubuntu Server (LVM), zaboravljena lozinka resetovana preko `grub>` (`init=/bin/bash` + `passwd`). Prijava radi.

## Podešavanje servera (checklist)

### Korak 1 — osnova
- [ ] Zapisati korisničko ime i lozinku u password manager (Bitwarden)
- [ ] `cat /etc/os-release`, `lsblk`, `df -h`, `ip a` — zapisati verziju, disk i lokalnu IP adresu
- [ ] Proširiti LVM na ceo disk (Ubuntu instaler podrazumevano koristi samo deo)
- [ ] `sudo apt update && sudo apt upgrade -y`
- [ ] Žični internet + rezervisana (statička) IP adresa na ruteru
- [ ] BIOS: "Power on after power loss"

### Korak 2 — pristup sa Mac-a
- [ ] OpenSSH server uključen
- [ ] SSH ključ sa Mac-a (`ssh-copy-id`) i prijava bez lozinke radi
- [ ] Tek onda: isključiti prijavu lozinkom preko SSH-a
- [ ] Tailscale na serveru, Mac-u i telefonu

### Korak 3 — dashboard servera
- [ ] Coolify (port 8000, samo preko Tailscale-a) + admin nalog
- [ ] Beszel (monitoring)
- [ ] Uptime Kuma + Telegram obaveštenja
- [ ] Test: deploy jedne probne aplikacije iz GitHub-a preko Coolify-ja

### Posle toga
- [x] Faza 0 — kostur koda
- [x] Repo na GitHub (privatni): github.com/AleksaT205/scoutline
- [x] Netlify povezan sa `apps/web` → https://scoutline-app.netlify.app (auto-deploy na push u `main`)
- [x] Coolify instaliran na mini PC (`http://192.168.100.60:8000`)
- [x] Dashboard: dizajn iz mockup-a + prikaz za telefon
- [x] Radar (api + worker + baza + LiteLLM) deploy preko Coolify-ja → `http://192.168.100.60:3100/health` radi (port 3000 je na serveru zauzet)
- [x] Javna HTTPS adresa za API: https://aleksaserver.tail32786c.ts.net (Tailscale Funnel → port 3100); `VITE_API_URL` u `netlify.toml`
- [x] Faza 1 — 5 izvora (RemoteOK, WWR, Remotive, Arbeitnow, HN), prefilter po nazivu pozicije, zemlja/tier, ocena (AI preko LiteLLM ili pravila kao rezerva), Telegram, API `/leads` i `/stats`, dashboard sa pravim podacima
- [ ] Uneti besplatne AI ključeve (Gemini/Groq) i Telegram bot u Coolify → Redeploy
- [x] Novi izvori: Himalayas, Jobicy (oba traže navođenje izvora + link na original — ispunjeno dugmetom "Post")
- [x] Tamna/svetla tema (prekidač gore), filteri tržišta sa brojevima, pretraga
- [ ] Domaći izvori: Infostud zabranjuje automatsko čitanje (robots.txt: /search, /rss_feed) → ručno dodavanje leada iz linka; HelloWorld — proveriti uslove
- [x] Ručno dodavanje leada: dugme "Add lead" (link ili tekst) → odmah ocenjen; zaštićeno timskom lozinkom (`API_TOKEN`); bezbedno preuzimanje linka (blokira localhost/kućnu mrežu)
- [x] Ocenjivanje izdvojeno u paket `@radar/scoring` (worker i API koriste isto)
- [x] Pravi brojevi u dashboard-u (ukupno leadova, trendovi, trošak AI-a) + stranica Sources
- [x] Faza 2 (MVP): AI Router — javni endpoint `/llm/v1` (OpenAI + Anthropic format), model `auto` bira `fast`/`smart`, klijenti sa sopstvenim ključem i mesečnim budžetom, potrošnja i ušteda po klijentu, opoziv ključa; stranica "AI Router" u dashboard-u
- [ ] AI Router: plaćeni modeli u grupe `fast`/`smart` kad krenu pravi klijenti; pravila rutiranja po klijentu; izveštaj za klijenta (PDF/link)

## Otvoreno
- Konačan naziv (predlog: Scoutline)
