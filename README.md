# Radar

> Radni naziv. Platforma za agenciju za AI optimizaciju:
> **(1) Lead Radar** — automatsko traženje klijenata (domaće + svetsko tržište, fokus na bogatije zemlje),
> **(2) AI Ops** — router za modele sa troškovima po klijentu, hosting agenata, timovi i budžeti.

Status: **Faza 0 gotova** — kostur aplikacije radi; izvori oglasa stižu u Fazi 1.

## Pokretanje (razvoj)

```bash
corepack enable          # jednom
pnpm install
pnpm dev                 # web na :5173, api na :3000, worker
pnpm typecheck && pnpm test && pnpm build
```

| Deo | Gde | Deploy |
|---|---|---|
| `apps/web` | React + Vite + Tailwind | **Netlify** (`netlify.toml`) |
| `apps/api` | Hono REST API | mini PC (Docker / Coolify) |
| `apps/worker` | prikupljanje + ocenjivanje | mini PC (Docker / Coolify) |
| `packages/shared` | tier-ovi, kategorije, ocena | — |
| `packages/db` | Drizzle šema + migracije | — |
| `packages/scoring` | Prefilter, pravila, AI ocena (LiteLLM) | — |
| `docker-compose.yml` + `infra/` | Postgres, LiteLLM, Ollama, api, worker | mini PC (Coolify) |

Server: `cp .env.example .env`, popuni, pa iz korena repoa `docker compose --env-file .env up -d`.

## Dokumentacija

| Dokument | Sadržaj |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Cilj, arhitektura, moduli, filter zemalja, faze razvoja |
| [docs/SOURCES.md](docs/SOURCES.md) | Izvori oglasa, kako se pristupa, pravni status |
| [docs/COSTS.md](docs/COSTS.md) | Sve što se koristi, šta je besplatno, šta se plaća |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Mini PC kao server + Netlify za frontend, kasnije VPS |
| [docs/DESIGN.md](docs/DESIGN.md) | Dizajn sistem: principi, boje, tipografija, komponente; mockup u [design/mockup.html](design/mockup.html) |
| [docs/SERVER.md](docs/SERVER.md) | Podešavanje mini PC-a: Tailscale, Coolify, Beszel, javni pristup bez domena |

## Naziv (predlozi)

| Naziv | Ideja |
|---|---|
| **Scoutline** ⭐ | "Izviđač" koji stalno skenira tržište — jasno, profesionalno, lako se izgovara na SR i EN |
| Kestrel | Ptica vetruška: lebdi i uočava plen iz visine — kratko i pamtljivo |
| Signalyst | Signal + analyst — hvata signale da firmi treba developer |
| Leadwell | Izvor (well) leadova — mekše, prijateljski |
| Vantor | Od "vantage point" — pogled sa visine na celo tržište |

Pre izbora proveriti: slobodan `.com`/`.io` domen, GitHub ime, i da nije registrovan žig u IT oblasti.

## Principi

- **Jeftino:** podrazumevano 0 € za AI (lokalni modeli preko Ollama + besplatni cloud nivoi), plaćeni API samo opciono.
- **Legalno:** zvanični API/RSS gde postoji, poštovanje uslova korišćenja i GDPR-a. Nema scrapinga LinkedIn-a.
- **Prenosivo:** sve u Docker Compose-u — isti setup radi na Mac-u i na VPS-u bez izmena koda.
- **Postepeno:** prvo Lead Radar (donosi klijente), zatim AI Ops moduli.
