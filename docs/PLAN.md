# Plan

## 1. Cilj

Jedna platforma sa dva dela:

1. **Lead Radar** *(prioritet)* — 24/7 prati oglase za posao, freelance projekte, tendere i vesti o investicijama, prepoznaje firme kojima treba razvoj (full-stack, AI integracije, deploy, održavanje), ocenjuje ih, filtrira po zemlji/budžetu i šalje obaveštenja timu. Ima CRM za praćenje kontakata.
2. **AI Ops** — ono što smo videli kod OpenMatter-a, ali za naše klijente: router za AI modele sa **troškovima u €/$ po klijentu**, budžeti, hosting agenata/automatizacija, timovi, audit log, izveštaj o uštedi.

---

## 2. Arhitektura

```
                    ┌──────────────── Mini PC (Ubuntu + Docker Compose) ───────────────┐
 Izvori (API/RSS) → │ worker: scheduler → konektori → normalizacija → dedup            │
                    │          → pravila (prefilter) → zemlja/tier → AI ocena          │
                    │                                    │                              │
                    │                          LiteLLM proxy ──→ besplatni cloud (glavni)│
                    │                                    └──→ Ollama mali model (rezerva)│
                    │ Postgres  ←─────────────────────────┘                             │
                    │ api (REST) ← Tailscale Funnel (kasnije CF Tunnel) ┐               │
                    └───────────────────────────────────────────────┼───────────────────┘
                                                                    │ HTTPS
                     Netlify: web (dashboard, CRM, filteri) ────────┘
                     Telegram / Slack: obaveštenja za leadove ≥ 70
```

### Stek

| Deo | Tehnologija | Zašto |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Već imate pnpm; jedan jezik (TypeScript) svuda |
| Frontend | React + Vite + Tailwind + shadcn/ui | Statički build → Netlify besplatno |
| API | Hono (Node 20) | Lagan, brz, jednostavan |
| Worker / redovi | pg-boss (red poslova u Postgres-u) | Bez Redis-a — jedan servis manje |
| Baza | Postgres 16 + Drizzle ORM | Migracije u kodu, tipovi automatski |
| Scraping | fetch + cheerio; Playwright samo gde mora | Lagano; Playwright samo za JS sajtove |
| AI | LiteLLM proxy → Ollama + besplatni cloud | Praćenje troškova, zamena modela bez izmene koda |
| Obaveštenja | Telegram bot, Slack webhook | Besplatno |
| Auth | Better Auth (email + pozivnice) | Treba nam i za timove u AI Ops delu |
| Infra | Docker Compose, deploy preko Coolify-ja | Isto lokalno i na VPS-u |

### Struktura repoa

```
radar/
├─ apps/
│  ├─ web/          # dashboard (Netlify)
│  ├─ api/          # REST API
│  └─ worker/       # scheduler, konektori, ocenjivanje, obaveštenja
├─ packages/
│  ├─ db/           # Drizzle šema + migracije
│  ├─ connectors/   # jedan fajl po izvoru, isti interfejs
│  ├─ scoring/      # prompti, pravila, tier logika
│  ├─ geo/          # detekcija zemlje + liste tier-ova
│  └─ shared/       # tipovi, konfiguracija
├─ infra/
│  ├─ (docker-compose.yml je u korenu repoa)
│  ├─ litellm.config.yaml
│  └─ cloudflared/
├─ prompts/         # verzionisani prompti (score.md, outreach.md)
└─ docs/
```

---

## 3. Lead Radar — tok obrade

1. **Prikupljanje** — svaki izvor je konektor sa istim interfejsom:
   `fetch(since) → RawItem{source, url, title, body, company, location, salary, posted_at, lang}`.
   Raspored po izvoru (15–60 min). Jedan pokvaren izvor ne zaustavlja ostale.
2. **Normalizacija + dedup** — hash URL-a + fuzzy poređenje (ista firma + sličan naslov u 30 dana = duplikat).
3. **Prefilter bez AI-a (besplatno, brzo)** — ključne reči za sav razvoj (vidi §8: full stack, React, Node, API, bug, deploy, AI, automation…), crna lista (staffing agencije bez klijenta, "unpaid", itd.). Odbacuje ~70–90% šuma pre nego što stigne do modela.
4. **Detekcija zemlje i tier-a** (vidi §4).
5. **AI ocena** — lokalni model vraća JSON (ocena 0–100, kategorija, problem klijenta, naša ponuda, budžet, hitnost, crvene zastavice). Prompt: `prompts/score.md`.
6. **Konačna ocena** = AI ocena × koeficijent tier-a + bonusi (budžet, remote-friendly, ponovljen oglas).
7. **Obaveštenje** — Telegram/Slack za ocenu ≥ 70 (prag podesiv po tier-u).
8. **Predlog poruke** — generiše se tek kad član tima otvori lead (štedi resurse).
9. **CRM** — Novo → Kontaktiran → Odgovorio → Sastanak → Dobijen / Izgubljen. Beleške, podsetnici, CSV export.
10. **Učenje** — ishodi (dobijen/izgubljen) se čuvaju; kasnije služe za doradu pravila i prompta.

---

## 4. Filter zemalja (bogatija tržišta)

### Tier-ovi (podesivi u `packages/geo`)

| Tier | Zemlje | Koeficijent | Napomena |
|---|---|---|---|
| **T1** | SAD, Kanada, UK, Irska, Nemačka, Austrija, Švajcarska, Holandija, Belgija, Luksemburg, Danska, Švedska, Norveška, Finska, Island, Australija, Novi Zeland, Singapur, UAE | ×1.0 | Glavni fokus |
| **T2** | Francuska, Italija, Španija, Portugal, Japan, J. Koreja, Hong Kong, Katar, S. Arabija, Estonija, Češka, Slovenija, Malta, Kipar | ×0.85 | Dobra tržišta |
| **T3** | Ostalo | ×0.6 | Samo izuzetno visoke ocene |
| **Domaće** | Srbija + region (HR, BA, ME, MK, SI) | zaseban tok | Poseban prikaz i pragovi |

### Kako se određuje zemlja (redom, dok se ne dobije sigurna vrednost)
1. Strukturisano polje lokacije iz izvora.
2. Valuta i iznos (`$`, `£`, `CHF`, `€` + raspon plate).
3. Domen firme (`.de`, `.co.uk`, `.ch`…) i sedište ako je poznato.
4. Tekstualni signali: "US only", "EU timezone", "CET overlap", "worldwide".
5. Ako i dalje nije jasno — AI izvlači zemlju u istom pozivu kao ocenu (bez dodatnog troška).

### Dodatni filteri
- **Remote-friendly** — da li bi uopšte angažovali agenciju iz Srbije: `worldwide`, `contractors welcome`, `EU/CET` = ✅; `US citizens only`, `on-site`, `security clearance` = ❌ (lead se skriva, ne briše).
- **Budžet** — min. plata / satnica / budžet projekta; tender vrednost.
- **Veličina firme** — mala/srednja firma bez AI tima = najbolji kandidat.
- **Jezik** — EN / DE / SR.

U dashboard-u: prekidači za T1/T2/T3/Domaće, min. ocena, min. budžet (EUR), kategorija usluge, industrija, jezik (SR/EN), samo remote-friendly, izvor, datum, status.

---

## 5. AI Ops modul (posle Lead Radar-a)

| Funkcija | Kako | Šta dobijamo vs OpenMatter |
|---|---|---|
| Model router | LiteLLM proxy, virtuelni ključ po klijentu | Troškovi u €/$, trajna istorija, fallback između provajdera |
| Budžeti | LiteLLM budžeti po ključu/timu + upozorenja | Budžet po klijentu, ne samo po endpoint-u |
| Izveštaj o uštedi | Poređenje: trošak na skupom modelu vs stvarni trošak posle rutiranja | Glavni prodajni argument koji OpenMatter nema |
| Čuvanje ključeva | Infisical (self-hosted, besplatan) ili šifrovano u bazi | Jednostavnije, proverljivo, open-source |
| Hosting agenata | Docker kontejner po klijentu (n8n/Flowise/sopstveni agent) | Bez blockchaina i kredita |
| Kontrola agenata | Dozvoljeni domeni (egress allowlist) + audit log | Osnovna verzija QuantumGuard ideje |
| Timovi | Better Auth organizacije: Owner/Admin/Member/Viewer | Isto kao kod njih |
| Audit / export | Tabela događaja + CSV/JSON export | Isto, bez blockchaina |

---

## 6. Faze

| Faza | Trajanje | Isporuka |
|---|---|---|
| **0 — Temelj** | 1–2 dana | Monorepo, Docker Compose (Postgres, LiteLLM, Ollama), Drizzle šema, lint/format, CI |
| **1 — Radar MVP** | ~2 nedelje | 5 svetskih izvora sa zvaničnim API/RSS (vidi SOURCES), dedup, prefilter, geo/tier, AI ocena, Telegram |
| **2 — Dashboard** | ~1 nedelja | Lista leadova + filteri (tier, ocena, budžet, remote), detalji, CRM kanban, auth, deploy na Netlify |
| **3 — Više izvora** | ~1 nedelja | Domaći izvori (posle provere uslova), javne nabavke (RS, EU TED, SAM.gov), RSS vesti o investicijama, predlozi poruka |
| **4 — AI Ops osnova** | 2–3 nedelje | Virtuelni ključevi po klijentu, troškovi, budžeti, izveštaj o uštedi |
| **5 — AI Ops napredno** | po potrebi | Hosting agenata po klijentu, Infisical, egress allowlist, audit export, timovi |

**Definicija "gotovo" za Fazu 1:** na Telegram stižu bar 5 relevantnih leadova dnevno iz T1/T2 zemalja, bez duplikata, a trošak AI-a je 0 €.

---

## 7. Model podataka (skica)

- `sources` — izvor, tip (api/rss/scrape/manual), raspored, status, poslednje uspešno preuzimanje
- `raw_items` — sirovi podatak + hash (za dedup i ponovnu obradu)
- `companies` — naziv, domen, zemlja, tier, veličina
- `leads` — veza item↔firma, ocena, kategorija, tier, remote_ok, budžet, status u CRM-u
- `lead_events` — promene statusa, beleške, ko je šta uradio
- `llm_calls` — model, tokeni, trošak, trajanje (LiteLLM vodi i svoju evidenciju)
- `users`, `orgs`, `members` — auth i timovi
- *(AI Ops)* `clients`, `virtual_keys`, `budgets`, `deployments`, `audit_log`

---

## 8. Odluke (odgovori tima, 16. 11. 2026.)

| Tema | Odluka |
|---|---|
| Server | Mini PC sa Linux-om, žični internet, SSD 512 GB–1 TB (potvrditi). Upravljanje preko Coolify + Beszel, pristup preko Tailscale-a — vidi [SERVER.md](SERVER.md) |
| Domen | Za sada nema. Frontend na `*.netlify.app`, API preko Tailscale Funnel (`*.ts.net`). Domen kad platforma krene u stvarni rad |
| Nalozi | GitHub, Netlify, Cloudflare — besplatni planovi |
| AI | Besplatni ključevi (Gemini, Groq, OpenRouter) + lokalni mali model kao rezerva. Javni oglasi smeju na besplatne nivoe |
| Šta prodajemo | Razvoj full-stack aplikacija, AI integracije, deploy/DevOps, popravka bagova i održavanje — sve u vezi sa razvojem |
| Industrije | Sve — sa filterom po industriji u dashboard-u |
| Budžet | Svi poslovi se prikupljaju, bolje plaćeni imaju prednost + filter po budžetu |
| Jezici | SR, EN |
| Kontakt | Email |
| Obaveštenja | Telegram (lično) za početak; Slack opciono kasnije |
| Tim | Za početak mi; plan ~10 ljudi. Lako pozivanje + deljenje linkom |

### Posledice odluka po plan

**Kategorije usluga** (AI ih dodeljuje, filter u dashboard-u):
`fullstack_app` · `web_frontend` · `backend_api` · `mobile` · `ai_integration` · `automation` · `devops_deploy` · `bugfix_maintenance` · `other_dev`

**Industrija** (filter): AI izvlači industriju klijenta (e-commerce, SaaS, fintech, zdravstvo, nekretnine, marketing, edukacija, logistika, ostalo).

**Budžet** (filter + bonus u oceni): normalizovan na EUR — satnica, mesečna plata ili budžet projekta; nepoznato = neutralno.

**Ključne reči za prefilter** šire se na sav razvoj: developer, full stack, React, Next.js, Node, Python, Laravel, API, MVP, bug, fix, deploy, DevOps, AWS, Docker, AI, LLM, chatbot, automation, n8n, integration…

**Deljenje i tim:**
- Pozivnica linkom (email nije obavezan za test) → uloga Member/Viewer.
- **Link za pregled** (read-only): token u linku, ističe posle X dana, može da se opozove. Ne prikazuje beleške ni kontakte, samo leadove i filtere.

**Naziv:** predlozi u README-u; repo ostaje `radar` dok se ne odlučimo.

## 9. Još otvoreno
1. Tačna Linux distribucija na mini PC-u (`cat /etc/os-release`) i veličina SSD-a.
2. Izbor naziva platforme.
