# AI Router 2.0 — taskovi

Redosled = prioritet. Plan i odluke: [ROUTER-PLAN.md](ROUTER-PLAN.md). Status: ✅ urađeno i provereno lokalno (pravi LiteLLM + lažni modeli).

| # | Task | Gotovo kad | Status |
|---|---|---|---|
| T1 | Pravila rutiranja u bazi | Tabela `router_rules` (klijent ili globalno, uslov, cilj, prioritet, status, verzija, ko je odlučio). Stara pickModel logika je upisana kao podrazumevana globalna pravila. Ruter čita aktivna pravila (keš 30 s) i radi i kad baza ne odgovara. Testovi za svako pravilo. | ✅ |
| T2 | Claude Code i agenti | Konkretan model (claude-*, gpt-*, gemini-*) se mapira na grupu. Zaglavlja `x-claude-code-*` se prosleđuju. auxiliary/compaction → fast, subagent/workflow → fast (podesivo), main → traženi. Ista sesija ostaje na istom modelu. „Alati → smart“ ne važi za agente. | ✅ |
| T3 | Keš | Exact-match keš u LiteLLM-u (memorija, uključuje se po zahtevu, odvojen po klijentu, bez poverljivih). `cache_control` prolazi netaknut. Hit rate po klijentu se vidi u analitici. | ✅ |
| T4 | Brzina i pouzdanost | Streaming bez baferovanja (provereno: delovi stižu odmah). Timeout po grupi. Fallback fast → smart → local. p50/p95 (prvi bajt i ukupno), greške i fallback po grupi i po modelu u RouterPage. | ✅ |
| T5 | Poverljivi klijenti i dozvole | `clients.confidential`, `allowed_groups`. Poverljiv klijent ide samo na local. Nedozvoljena grupa se odbija jasnom porukom, i u ruteru i u LiteLLM ključu (403). Maskiranje tajni (regex, uključeno podrazumevano, isključivo po klijentu). Presidio nije uključen. | ✅ |
| T6 | Budžeti i upozorenja | LiteLLM tim po klijentu i ključ po inženjeru sa sopstvenim budžetom, koji ne može preko budžeta klijenta. Upozorenja na 75% i 95% jednom mesečno, na Telegram i u zvonce. | ✅ |
| T7 | Shadow i stvarna ušteda | Shadow po klijentu: šalje se kao bez rutiranja, a beleži se izbor rutera (zaglavlje `x-scoutline-shadow-choice`, statistika). Ušteda se računa po ceni traženog modela (cene sa datumom), a ne više samo po fiksnom BASELINE_*. | ✅ |
| T8 | Analitika | Trošak po klijentu, projektu, inženjeru, modelu i vrsti zahteva. Ušteda, keš, latencija, greške, blokirani i ponovljeni zahtevi. Mesečni CSV po klijentu. | ✅ |
| T9 | „Učenje“ bez tokena | Dnevni posao u workeru: SQL nad odlukama (7 dana). Predlog izmene pravila sa brojkama, status „predloženo“. Odobri / odbij / vrati verziju u RouterPage. Isti predlog se ne ponavlja 14 dana. | ✅ |
| T10 | Zapis otporan na izmene | `router_audit`: svaki red nosi heš prethodnog. Izmene pravila, klijenata i ključeva idu u lanac, odluke se pečate na 15 min. `GET /router/audit/verify` i dugme „Verify chain“ otkrivaju izmenu reda i izmenu odluke. | ✅ |

## Ručni koraci posle deploy-a
1. Coolify → **Redeploy** (API: migracija 0022 i podrazumevana pravila se upišu sami; LiteLLM: nova konfiguracija).
2. *(opciono, za poverljive klijente)* Ollama: `docker compose --profile local-ai up -d ollama`, pa `docker compose exec ollama ollama pull qwen3:4b`.
3. Postojeći klijenti: njihovi ključevi i dalje imaju `fast` i `smart`. Za `local` ili poverljivost uključi to u AI Router → klijent → Access & privacy (ključ se ažurira u LiteLLM-u).
