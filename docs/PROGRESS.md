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
| 5 | Team & Settings: nalozi (email + lozinka), uloge owner/member/viewer, pozivnice (link 7 dana), linkovi samo za pregled, profil i promena lozinke | ✅ |
| 6 | Produkcija: dnevni backup baze, monitoring (Telegram + `/health/deep`), zaštita prijave, sigurnosna zaglavlja, Cloudflare Tunnel spreman; ručni koraci u [PRODUCTION.md](PRODUCTION.md) | ✅ (kod) |
| 7 | Dev workflow: AGENTS.md/CLAUDE.md, GitHub Issues kao taskovi (+ stranica Tasks u dashboard-u), @claude akcija preko pretplate, šabloni; vidi [WORKFLOW.md](WORKFLOW.md) | ✅ |
| 8 | Lead model 2.0 + tenderi: tip leada (tender / project / intent / hiring signal), EU TED, UK Contracts Finder, UK Find a Tender, CanadaBuys, TechCrunch funding, Startit; rok i vrednost tendera; filter **Type**; Telegram po tipu · GitHub #8 | ✅ |
| **9** | **Email-in** (Upwork, PeoplePerHour, Malt, Portal javnih nabavki) + Freelancer.com · #9 | ⏭ sledeće |
| 10 | Delivery MVP: Clients, Projects, Issues (Linear stil), Lead → Project · #10 | |
| 11 | Cycles, Triage, GitHub PR sync, Assign to Claude/Codex, klijent portal · #11 | |
| 12 | Izveštaji: profitabilnost po projektu, vreme, ušteda AI-a | |

**Sledeći korak:** Redeploy u Coolify-ju (nova migracija 0005 se primeni sama) → proveriti tendere u dashboard-u. Zatim Faza 9 (Email-in) po [ROADMAP.md](ROADMAP.md).

## Urađeno

- **16. 11. 2026. — Faza 8**
  - Tip leada u bazi (`lead_type`) + rok, vrednost i zemlja iz izvora (`raw_items`), migracija 0005.
  - 6 novih izvora: EU TED (CPV 72*/48*), UK Contracts Finder, UK Find a Tender, CanadaBuys (CSV), TechCrunch funding, Startit. Nabavke opreme/mreža/gradnje se preskaču.
  - Ocena: AI dobija tip izvora i vraća `lead_type`; oglas za stalno zaposlenje max ~50; tender +5, istekao rok → sakriven, < 5 dana → niže; ogroman tender (> €2M) niže kod pravila.
  - Dashboard: filter **Type** (podrazumevano bez oglasa za posao), oznaka tipa i „Xd left“ u tabeli, rok u detalju, Overview „Lead types“, Telegram podešavanje tipova.
  - Provereno lokalno na pravim izvorima: 648 leadova (306 tendera, 75 projekata, 7 intent, 260 hiring), typecheck/testovi (11)/build prolaze.

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
