# AI Router 2.0 — plan i odluke

Nadogradnja AI Router-a (`apps/api/src/router.ts`): brže, pametnije i sa uštedom, bez dodatnih troškova.
Taskovi i kriterijumi „gotovo kad“ su u [ROUTER-TASKS.md](ROUTER-TASKS.md).

## Tvrda pravila (važe za sve)
- **0 € dodatno.** Rutiranje radi po pravilima u kodu, bez poziva modela. „Učenje“ je SQL statistika nad našim odlukama i `LiteLLM_SpendLogs`.
- **Poverljivi klijenti nikad ne idu na besplatne nivoe** (tamo podaci mogu da se koriste za treniranje, vidi [COSTS.md](COSTS.md)). Dozvoljen je samo `local` (Ollama), a provera radi na dva mesta: u ruteru i u samom LiteLLM ključu.
- **Ključevi i sadržaj promptova se ne beleže.** `router_decisions` čuva samo odluku, brojke i heš tela. LiteLLM ima `store_prompts_in_spend_logs: false`.
- AI Router je u meniju (grupa „AI Ops“) i u pretrazi (Cmd+K), stranica je na `#/router`.

## Kako radi jedan zahtev
```
klijent / Claude Code ──► /llm/v1/*  (Hono, router.ts)
   1. ključ → klijent ili inženjer (sha256 kao u LiteLLM-u, keš 60 s)
   2. osobine zahteva: dužina, alati, agent?, klasa zahteva, traženi model
   3. pravila iz baze (router_rules, keš 30 s) → fast / smart / local
   4. lepljivost sesije agenta, dozvole klijenta, shadow režim
   5. maskiranje tajni (samo ka besplatnim grupama), keš po klijentu (namespace)
   6. x-litellm-tags + x-litellm-session-id ──► LiteLLM
LiteLLM: ključ/budžet/dozvole → model u grupi → retry → fallback → SpendLogs
   7. odgovor teče bez baferovanja; na kraju upis u router_decisions (TTFB, ukupno, status, fallback)
```

## Odluke posle provere dokumentacije
Proveravano u izvornom kodu LiteLLM-a koji koristimo (slika `main-stable`, v1.109) i na code.claude.com/docs (llm-gateway-protocol).

| Tema | Šta piše u promptu | Šta je urađeno i zašto |
|---|---|---|
| Klasa zahteva Claude Code-a | `x-claude-code-request-class` | Šalje se tek uz `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` (vrednosti: main, subagent, workflow, compaction, auxiliary). Bez toga ruter prepoznaje subagenta po `x-claude-code-agent-id`, koje se šalje uvek. |
| Lepljivost sesije | isti model za `x-claude-code-session-id` | Na dva nivoa: ruter drži istu grupu (u memoriji, 2 h), a LiteLLM drži isti model u grupi (`optional_pre_call_checks: ["session_affinity"]` + `x-litellm-session-id`). Dozvoljena je samo nadogradnja fast → smart kad razgovor naraste. |
| Keš | exact-match, Redis ili memorija | `cache_params.type: local` (bez Redisa, mini PC) i `mode: default_off`: kešira se samo kad ruter traži (`"cache": {"use-cache": true}`). Keš je odvojen po klijentu (`namespace`) i važi samo za OpenAI format. Poverljivi klijenti se ne keširaju. Scoutline-ovi interni pozivi (npr. „Write with AI“) nisu keširani, pa i dalje daju nov tekst. Semantički keš je isključen. |
| Prompt caching (Anthropic) | `cache_control` | LiteLLM ga prosleđuje nepromenjenog, a ruter ga ne dira. Pročitani keš tokeni se vide u analitici (`metadata.additional_usage_values`). Vredi tek kad klijent ima Claude grupu sa svojim ključem. |
| Fallback | fast → smart → local | `router_settings.fallbacks`, posle `num_retries` u grupi. LiteLLM poštuje dozvole ključa i pri fallback-u, pa se ka `local` prelazi samo ako ga klijent ima. Iz `local` se nikad ne ide u cloud. |
| Timeout po grupi | da | `timeout` / `stream_timeout` po modelu: fast 45/30 s, smart 120/60 s, local 300/120 s. |
| Budžet po inženjeru i timu | LiteLLM user/team | Klijent dobija LiteLLM tim (budžet klijenta pokriva sve njegove ključeve), a svaki inženjer svoj ključ u tom timu sa svojim budžetom. LiteLLM proverava oba budžeta nezavisno. |
| Upozorenja 75/95% | Telegram | `router-jobs.ts` na 15 min, jednom po pragu mesečno. Stiže na Telegram i u zvonce u aplikaciji. |
| Zapis otporan na izmene | svaka odluka u lancu | Svaka izmena pravila, klijenta i ključa je red u lancu. Odluke rutera se **pečate** na 15 min (jedan red sa hešom svih novih odluka). Upis svake odluke u lanac bi tražio zaključavanje na svakom zahtevu. Rok čuvanja briše samo cele zapečaćene opsege. |
| Spajanje sa SpendLogs | po request_id | Po `litellm_call_id`. `request_id` je ID odgovora provajdera (npr. `msg_…`), pa se ne poklapa uvek sa `x-litellm-call-id`. |

## Važna ograničenja (iskreno)
- **Claude Code na besplatnim modelima** tehnički radi: LiteLLM prevodi Anthropic format, a provereno je i sa alatima. Ipak, Anthropic zvanično ne podržava ne-Claude modele u Claude Code-u, pa kvalitet glavnog toka zavisi od modela. Realna upotreba danas su pozadinski zadaci i subagenti na `fast`. Za glavni tok treba grupa sa Claude modelom i klijentovim ključem (sledeći korak, van ovog plana).
- **Pretplata (Pro/Max) kroz naš ruter se ne preusmerava.** Claude Code dozvoljava pretplatu kroz gateway samo kad gateway nema svoj ključ, i tada gateway ne bira model. Naš ruter radi sa ključevima klijenata (LiteLLM).
- **`local` traži Ollama-u** (`docker compose --profile local-ai up -d ollama` + `ollama pull qwen3:4b`). Bez nje zahtevi ka `local` vraćaju grešku. Na mini PC-u (CPU) mali model je spor, ali podaci ne izlaze sa servera.
- **Ušteda na besplatnim nivoima** je poređenje sa cenom koju bi zahtev imao bez rutiranja: cena traženog modela (cene Anthropic-a sa datumom u `packages/shared/src/router.ts`), za „auto“ premium cena (`BASELINE_*`). Stvarno se ništa ne naplaćuje.
- Keš i lepljivost su u memoriji jednog procesa. Posle restarta kreću iz početka, što je u redu za jedan server.

## Šta je gde
| Deo | Fajl |
|---|---|
| Pravila, osobine zahteva, cene, predlozi (deli ih API, worker i web) | `packages/shared/src/router.ts` |
| Proxy, odluka, lepljivost, keš ključeva | `apps/api/src/router.ts` |
| Upravljanje: klijenti, inženjeri, pravila, analitika, CSV, audit | `apps/api/src/router-admin.ts` |
| Maskiranje tajni | `apps/api/src/router-mask.ts` |
| Lanac zapisa, pečat odluka, rok čuvanja | `apps/api/src/router-audit.ts` |
| Budžet upozorenja, pozadinski poslovi | `apps/api/src/router-jobs.ts` |
| „Učenje“ (dnevno, worker) | `apps/worker/src/pipeline/router-learn.ts` |
| LiteLLM: local, timeout, fallback, keš, afinitet | `infra/litellm.config.yaml` |
| Web: Clients / Rules / Analytics / Audit | `apps/web/src/components/RouterPage.tsx`, `components/router/*` |
| Šema i migracija 0022 | `packages/db/src/schema.ts` |

## Claude Code kroz ruter (za klijenta)
```bash
export ANTHROPIC_BASE_URL="https://<api>/llm"
export ANTHROPIC_AUTH_TOKEN="<ključ inženjera>"      # AI Router → klijent → Engineer keys
export CLAUDE_CODE_GATEWAY_HINT_HEADERS=1             # klasa zahteva → pametnije rutiranje
```

## Kasnije, van ovog plana
PLUR memorija po klijentu (MCP + stabilan blok u promptu), Claude grupa sa klijentovim ključem (BYOK), izveštaj po PR-u (GitHub), Codex (Responses API), izolacija agenata, sidrenje lanca u Sigstore Rekor.
