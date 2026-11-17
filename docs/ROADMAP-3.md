# Roadmap 3.0 — profi alat za tim (posle Faze 12)

Datum: 17. 11. 2026. Spisak želja iz razgovora, grupisan u faze. Urađeno odmah (17. 11.):
- logo u tabu pregledača;
- filteri leadova (izvor, budžet, vreme objave, uredni meniji);
- izvori sa „Run now“, rasporedom i pauzom;
- zvonce sa obaveštenjima;
- dužina sprinta;
- pristup Sales / Delivery po korisniku;
- telefon: kartice umesto tabela;
- AI Router sklonjen iz menija.

## Faza 13 ✅ — AI asistent u projektu (chat, statusi, modeli)
| Šta | Kako |
|---|---|
| **Chat „pitaj projekat“** | „Gde je login i kako radi?“ — odgovor iz repoa projekta (GitHub) + taskova. Pretraga fajlova preko GitHub API-ja, kratak kontekst → odgovor. |
| **Brzi status** | Dugme „Status update“: AI iz aktivnosti (završeno, u toku, blokirano) napravi kratak izveštaj za tim ili klijenta. |
| **Izbor modela + preporuka** | Za chat/status: „Fast / Smart / Best“ sa procenom cene; preporuka po zadatku (kratko pitanje → brz model). |
| **Svako svoj AI** | Lični ključ (Anthropic / OpenAI) u Settings → Integrations, šifrovano — **ili** besplatni modeli (Groq/Gemini/OpenRouter) koje već imamo. Agenti na GitHub-u i dalje rade preko pretplate (Claude Code / Codex). |
| **Ušteda tokena** | Kratki „context pack“, keš odgovora, prvo jeftin model pa skuplji samo kad treba, prikaz potrošnje po korisniku. |

> **SDK, objašnjeno ukratko:** SDK (Claude Agent SDK / OpenAI) je biblioteka za poziv modela iz našeg koda. Plaća se po tokenu preko API ključa, ne preko pretplate. Zato je predlog: **pretplata za agente na GitHub-u** (besplatno u okviru plana), a **chat u aplikaciji** preko besplatnih modela ili ličnog ključa onoga ko ga uključi.

## Faza 14 ✅ — GitHub tok rada u aplikaciji
- **GitHub kao izvor istine (prvo ovo):** za projekte koji rade samo na GitHub-u.
  - **Dvosmerna sinhronizacija issue-a:** GitHub issues automatski postaju taskovi (naslov, opis, oznake, osoba po GitHub nalogu, milestone → sprint). Promena u Scoutline-u (status, osoba, oznake, zatvaranje) se upisuje nazad na GitHub.
  - **Stanje i analiza iz GitHub-a:** commit-ovi i PR-ovi po nedelji, vreme do spajanja, otvoreni PR-ovi i koliko čekaju, CI uspešnost, ko šta radi, napredak milestone-a.
  - Ovi podaci idu u Overview projekta, Reports i Status update.
- **Više repoa po projektu:** frontend, backend, mobile; svaki sa ulogom.
- **Grane:** lista grana po repou, grana po tasku (`acme-12-login`) jednim klikom, čišćenje spojenih.
- **Pull request-ovi:** pregled, status provera (testovi/CI), **Approve / Merge** iz aplikacije.
- **GitHub Actions:** lista workflow-a, **Run** (workflow_dispatch), poslednji rezultati.
- **Deploy:** dugme po okruženju (Coolify webhook, Netlify build hook), istorija deploy-a.
- **Testovi i analiza:** rezultati CI provera po PR-u; „AI review“ PR-a (Claude/Codex komentar).

## Faza 15 ✅ — Organizacija, veštine, Figma
- **Organizacije:** više firmi u jednoj instalaciji (svaka svoji ljudi, projekti, ključevi); poziv u organizaciju.
- **Skills / pravila po projektu:** biblioteka (AGENTS.md, CLAUDE.md, skill fajlovi), „Add to project“ otvara PR u repou.
- **Figma:** lični Figma token → povezivanje okvira (frame) sa taskom, prikaz slike i linka u tasku.
- **Pokretanje projekta lokalno:** veb aplikacija ne može da pokrene program na tvom računaru (bezbednost pregledača). Opcije:
  - „Open in VS Code / Cursor“ (kloniranje repoa i otvaranje);
  - kopiranje komande za pokretanje;
  - **preview okruženje na serveru** po grani (Coolify), sa linkom.

## Redosled (predlog)
1. **Faza 13**: najviše vrednosti za tim, bez novih troškova uz besplatne modele.
2. **Faza 14**: GitHub dugmad (PR, Actions, deploy, grane, više repoa).
3. **Faza 15**: organizacije, skills, Figma, preview okruženja.

Svaka faza = GitHub issue (epic) + manji taskovi.

> **Odluka (17. 11.):** „Organizacija“ = profil i brend firme. Više odvojenih firmi u jednoj instalaciji je velika promena (svaki podatak bi morao da ima vlasnika-firmu) i rizik od mešanja podataka; za drugu firmu se pravi posebna instalacija (novi Coolify stack + Netlify sajt).
