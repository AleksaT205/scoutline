# AGENTS.md — uputstvo za AI asistente (Claude Code, Codex, …)

Kratko i tačno, da svaki asistent odmah zna gde je i ne troši tokene na istraživanje.

## Projekat
**Scoutline** — platforma za agenciju: (1) **Lead Radar** prati tendere, projekte, signale investicija i oglase (13 izvora), ocenjuje ih (AI ili pravila) i šalje dobre na Telegram; CRM/pipeline za praćenje; (2) **AI Router** — jedan endpoint za aplikacije klijenata sa rutiranjem `fast`/`smart`, budžetima i troškovima po klijentu.

Stanje i faze: **`docs/PROGRESS.md`** (pročitaj prvo). Plan: `docs/PLAN.md`. Dizajn: `docs/DESIGN.md`. Produkcija: `docs/PRODUCTION.md`.

## Struktura (pnpm monorepo, TypeScript)
```
apps/web        React + Vite + Tailwind 4 → Netlify (VITE_API_URL u netlify.toml)
apps/api        Hono REST API (+ /llm proxy, auth, monitoring) → Docker na mini PC-u (Coolify)
apps/worker     konektori izvora, ocenjivanje, Telegram → Docker
packages/db     Drizzle šema + migracije (packages/db/migrations)
packages/shared tipovi, tier-ovi zemalja, ocena, alert podešavanja (bez Node API-ja — koristi ga i web)
packages/scoring prefilter, pravila, AI ocena preko LiteLLM-a, Telegram slanje (samo server)
infra/          litellm.config.yaml, litellm.Dockerfile
docker-compose.yml  postgres, litellm, api, worker, backup, (ollama, cloudflared — profili)
```

## Komande
```bash
corepack enable && pnpm install
pnpm typecheck && pnpm test && pnpm build     # mora da prođe pre commit-a (isto radi CI)
pnpm --filter @radar/web dev                  # dashboard na :5173
pnpm --filter @radar/db generate              # posle izmene packages/db/src/schema.ts
```
API pokreće migracije sam pri startu. Lokalni test sa bazom: Postgres u Dockeru, `DATABASE_URL=postgres://radar:test@localhost:55432/radar`.

## Pravila
- **Bez AI potpisa u git-u**: nikad `Co-Authored-By: Claude`, "Generated with …" ni slično u commit-ima, PR-ovima i fajlovima. Autor je vlasnik repoa.
- Komentari i dokumentacija na **srpskom (latinica)**; UI tekst na **engleskom**.
- Male, fokusirane izmene; ne refaktoriši ono što task ne traži.
- Posle izmene šeme: `pnpm --filter @radar/db generate` i commit migracije.
- Bez plaćenih API ključeva u kodu; AI za ocenjivanje ide kroz LiteLLM (`infra/litellm.config.yaml`, besplatni modeli).
- Tajne samo u env promenljivama (Coolify / `.env`, nikad u repou).
- Dizajn: tokeni iz `apps/web/src/index.css` (bg, surface, line, fg, muted, accent…), tamna i svetla tema.
- Posle završenog taska: ažuriraj `docs/PROGRESS.md` (jedan red) ako se menja stanje faze.

## Deploy
- Web: push na `main` → Netlify automatski.
- Backend: Coolify (Docker Compose, `/docker-compose.yml`) → **Redeploy** u Coolify-ju (auto-deploy tek sa domenom, vidi PRODUCTION.md).
