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
| 9 | Email-in (IMAP: Upwork, PeoplePerHour, Malt, Portal javnih nabavki, LinkedIn, prosleđeni upiti) + Freelancer.com API + e-Nabavke BiH + SAM.gov (uz ključ) · [EMAIL-IN.md](EMAIL-IN.md) · #9 | ✅ |
| 10 | Delivery MVP: prekidač Sales/Delivery, Projects, Clients, My issues, tabla taskova (Linear stil, prevlačenje), detalj taska (status, prioritet, osoba, procena, oznake, rok, komentari, istorija), prečica C, Lead (Won) → Project · #10 | ✅ |
| 11 | Cycles (sprintovi + burn-up), Inbox (triage), GitHub PR sync (PR → In Review / Done, issues → Inbox), Assign to Claude/Codex (brief u GitHub issue), portal za klijenta (+ zahtevi) · [DELIVERY.md](DELIVERY.md) · #11 | ✅ |
| 12 | Izveštaji: evidencija vremena na tasku, cena rada (po osobi), naplata fiksno/po satu, profitabilnost po projektu (vrednost, trošak, marža, potrošen budžet, €/h), sati po nedelji i osobi, AI trošak i ušteda po projektu, taskovi agenata, CSV · [DELIVERY.md](DELIVERY.md) | ✅ |
| R2 | AI Router 2.0: pravila u bazi (verzije, predlozi iz statistike), Claude Code (klasa zahteva, lepljivost sesije), keš po klijentu, fallback i timeout, poverljivi klijenti + maskiranje tajni, ključevi i budžeti inženjera, shadow i ušteda po ceni modela, analitika + CSV, lanac zapisa · [ROUTER-PLAN.md](ROUTER-PLAN.md) | ✅ (kod) |

**Sledeći korak:** Redeploy u Coolify-ju → podesiti Email-in po [EMAIL-IN.md](EMAIL-IN.md) (Gmail + App password u Coolify) i, po želji, `SAM_API_KEY`. Za Delivery + GitHub: `GITHUB_TOKEN` sa pristupom repoima projekata ([DELIVERY.md](DELIVERY.md)). Roadmap 3.0 je završen. Sledeće: Redeploy + podešavanja (DELIVERY.md), stvarni rad, pa nove ideje u GitHub Issues.

## Urađeno

- **18. 11. 2026. — AI Router 2.0** ([ROUTER-PLAN.md](ROUTER-PLAN.md), [ROUTER-TASKS.md](ROUTER-TASKS.md))
  - Pravila rutiranja u bazi (`router_rules`, migracija 0022): verzije, vraćanje, probni zahtev; stara logika = podrazumevana pravila. Bez poziva modela.
  - Claude Code / agenti: konkretan model → grupa, `x-claude-code-*` zaglavlja, subagent/pozadina → fast, glavni tok → traženi, ista sesija = isti model.
  - LiteLLM: grupa `local` (Ollama), timeout po grupi, fallback fast → smart → local, keš po klijentu (default_off), afinitet sesije, promptovi se ne čuvaju.
  - Poverljivi klijenti (samo local, i u LiteLLM ključu), dozvoljene grupe, maskiranje tajni; ključevi inženjera u LiteLLM timu klijenta sa budžetom; upozorenja 75/95% (Telegram + zvonce).
  - Shadow režim, ušteda po ceni traženog modela; analitika (klijent, projekat, inženjer, model, vrsta zahteva, keš, p50/p95, greške) + mesečni CSV; „učenje“ u workeru (predlozi sa brojkama); lanac zapisa sa pečatom odluka.
  - Provereno lokalno sa pravim LiteLLM-om (ista slika kao produkcija) i lažnim modelima: 45 provera toka + budžeti, lanac, predlozi. Deploy-ovano i provereno na produkciji; AI Router vraćen u meni (AI Ops) i Cmd+K.

- **17. 11. 2026. — Faza 16 (Claude Code iz aplikacije)**
  - Povezivanje repoa GitHub linkom + **Set up automatically** (workflow `scoutline-agent.yml` i secret `CLAUDE_CODE_OAUTH_TOKEN`, šifrovano libsodium-om); checklist šta fali.
  - **Ask AI → Build with Claude**: prompt → workflow (bez GitHub issue-a) → Claude radi na grani → Scoutline otvori PR tvojim nalogom (i u pozadini); razgovor u Scoutline-u, odgovor Claude-u, **Preview** grane (StackBlitz), **Merge**.
  - Potrošnja: sesije i minuti po osobi (mesec); Ask AI chat pokazuje pitanja i tokene. Svako svoj Claude Code token (Settings → Integrations), firma može zajednički.
  - **Run locally**: StackBlitz/Codespaces/CodeSandbox u browseru, VS Code/Cursor, komande + „Open localhost“. Owner nalog iz env-a (`OWNER_EMAIL`/`OWNER_PASSWORD`), demo login, Sample project. Uputstvo: DELIVERY.md.

- **17. 11. 2026. — Pipeline i izvori za Srbiju/region**
  - Pipeline: pretraga u svim fazama, filter tipa i ocene, „Show 25 more“, klik otvara lead u bočnom panelu.
  - Novi izvori: TED · Srbija i region, Svetska banka (RS/BA/ME/MK/XK), HelloWorld.rs i Startit poslovi (hiring), Netokracija, Forbes Srbija, Bizlife (investicije). Odbijeni izvori i razlozi u SOURCES.md.

- **17. 11. 2026. — Faza 15 (organizacija, skills, Figma, pokreni lokalno)**
  - **Settings → Organization** (vlasnik): ime, logo, boja, sajt, email — u meniju, portalu klijenta i potpisu. *Više firmi u jednoj instalaciji* nije urađeno namerno: za drugu firmu najbezbednije je posebna instalacija (drugi Coolify stack) — podaci su potpuno odvojeni.
  - **Code → Skills**: biblioteka (AGENTS.md, CLAUDE.md, code review, tests first, commits & PRs, security, UI polish, PR šablon) + timski skills; „Add to project“ otvara **PR** u repou (grana `scoutline/skills-…`); **Draft AGENTS.md with AI** iz stvarnog repoa.
  - **Code → Run locally**: Open in VS Code / Cursor (kloniranje), Codespaces, github.dev + komande prepoznate iz repoa (pnpm/npm/yarn, Python, Go, Docker, .env).
  - **PR preview**: link ka Netlify / Coolify / Vercel preview-u na svakom PR-u (statusi i GitHub Deployments).
  - **Figma u tasku**: link na frame → naziv i sličica (lični ili Figma token firme u Integrations). Migracija 0015.

- **17. 11. 2026. — Faza 14 (GitHub tok rada) + sortiranje leadova**
  - **GitHub kao izvor istine** (Edit project → Two-way GitHub sync): GitHub issues → taskovi (naslov, opis, oznake, osoba po GitHub nalogu, zatvoren → Done / „not planned“ → Canceled); izmene u aplikaciji → nazad na GitHub; novi task → novi GitHub issue; bez petlje (pamti se GitHub vreme izmene). Brisanje u sync projektu = Canceled.
  - **Više repoa po projektu** (frontend, backend…): sync PR-ova i issue-a za sve repoe.
  - Tab **Code** na projektu: **Activity** (commit-ovi i PR-ovi po nedelji, vreme do spajanja, CI %, ko radi, PR-ovi koji čekaju, milestone-i), **Pull requests** (provere, Approve, Merge, AI review @claude), **Branches** (nova grana, grana za task iz detalja taska, brisanje spojenih), **Actions** (workflow-i, Run za workflow_dispatch, poslednja pokretanja), **Deploy** (Coolify / Netlify hook dugmad, šifrovano, istorija).
  - Leadovi: **sortiranje** po oceni, budžetu, izvoru, vremenu objave i roku (klik na kolonu ili meni Sort).
  - Migracija 0014. Token treba: Issues R/W, Pull requests R/W, Contents R/W, Actions R/W.
  - Provereno sa lažnim GitHub serverom (sync u oba smera, bez petlje, PR/branch/actions/deploy) i u pregledaču.

- **17. 11. 2026. — Faza 13 (AI asistent u projektu)**
  - **Ask AI** (tab na projektu) i **Delivery → Assistant**: pitanja „gde je i kako radi“ — odgovor iz repoa projekta (stablo + najrelevantniji fajlovi, linkovi na GitHub) i taskova; istorija razgovora.
  - **Status update** (dugme na projektu): izveštaj za tim ili klijenta (7/14/30 dana); klijentska verzija bez ključeva, imena i taskova „internal“; bez AI-a radi čist izveštaj iz podataka.
  - **Izbor modela**: Auto (preporuka po pitanju), Fast/Smart (besplatni preko LiteLLM-a), Claude Haiku/Sonnet/Opus 5.5 uz lični ključ ili ključ firme (Settings → Integrations; Anthropic SDK).
  - **Ušteda tokena**: samo relevantni fajlovi (~6k tokena konteksta), keš stabla repoa 10 min, keš prompta kod Claude-a, prvo besplatni modeli, rezerva Claude Haiku; tokeni po odgovoru i `/assistant/usage`. Migracija 0013.
  - Za odgovore iz koda GitHub token treba i **Contents: Read**.

- **17. 11. 2026. — Dorade (lista želja, deo 1)**
  - Logo u tabu pregledača (favicon).
  - Leadovi: novi filteri **Source** (više izvora, pretraga, brojevi), **Budget** (€1k+ … €100k+, „samo sa budžetom“), **Posted**, Score/Market/Status/Service/Industry — svi isti uredni meniji; na telefonu iza dugmeta „Filters“.
  - Izvori: **Run now**, raspored (15 min – 24 h) i **pauza** po izvoru (worker poštuje; ručni raspored se ne vraća pri restartu). Migracija 0011.
  - **Zvonce**: novi dobri leadovi, zahtevi u Inboxu, dodele, komentari, PR-ovi, završeni taskovi; „Mark all read“.
  - **Pristup po korisniku** (Settings → Team): Sales + Delivery / samo Sales / samo Delivery — bez prekidača i sa zaštitom na API-ju. Migracija 0012.
  - **Dužina sprinta** (1–4 nedelje, vlasnik, Cycles).
  - **Telefon**: kartice umesto tabela (Leads, Sources, Projects, Clients, Reports), detalj leada preko celog ekrana, kompaktne KPI kartice.
  - Sklonjeno: AI Router iz menija i trošak AI-a iz kartice statusa; kartica „Connect Email-in“ (podešava se u Settings → Integrations).
  - Veće želje (AI chat, statusi, modeli, GitHub PR/Actions/deploy, grane, više repoa, organizacije, skills, Figma, preview) → [ROADMAP-3.md](ROADMAP-3.md).

- **17. 11. 2026. — Integrations (aplikacija nezavisna od Coolify-ja)**
  - Settings → **Integrations**: lično (svako svoj GitHub token, proveren pre čuvanja; podrazumevani agent Claude/Codex) i firma (vlasnik: GitHub, Telegram, Email-in, SAM.gov) sa „Test connection“.
  - Tajne šifrovane (AES-256-GCM, ključ `SECRETS_KEY` ili izveden iz `SESSION_SECRET`/`API_TOKEN` — ako se promeni, tajne se unose ponovo); vrednost iz aplikacije ima prednost nad env. API i worker ih čitaju u radu (bez redeploy-a); izvori se uključuju sami kad se podese.
  - „Assign to Claude/Codex“ i novi taskovi idu pod ličnim GitHub nalogom korisnika (inače token firme). Migracija 0010.

- **17. 11. 2026. — Faza 12 (izveštaji)**
  - Baza: `time_entries` (ko, koliko, kad, naplativo), `projects.billing` (fixed/hourly) + `hourly_rate_eur`, `clients.project_id` (AI Router ključ → projekat). Migracija 0009.
  - API: `/delivery/time` (unos, lista, brisanje svog), `/delivery/rates` (interna cena sata, po osobi; menja vlasnik), `/delivery/projects/:id/ai-client`, `/delivery/reports?days=` (profitabilnost po projektu do danas; vreme po osobi/nedelji, AI i agenti za period).
  - Web: „Time“ u detalju taska („1h 30m“, datum, napomena, naplativo); u projektu naplata (fiksno / po satu) i veza sa AI Router ključem; stranica **Reports** (KPI, tabela profitabilnosti sa potrošnjom budžeta i €/h, sati po nedelji, vreme po osobi, AI ušteda, CSV, dijalog za cenu sata).
  - Provereno lokalno: 13 unosa vremena, cene po osobi (22 €/h, 30 €/h), lažni LiteLLM trošak 400 zahteva → izveštaj se slaže sa ručnim računom.

- **17. 11. 2026. — Faza 11**
  - **Cycles**: dvonedeljni sprintovi za ceo tim (prave se sami, tekući + 2 unapred), nedovršeno iz završenog sprinta prelazi u tekući; stranica sa burn-up grafikonom, obimom i listom; izbor sprinta u tasku i „Current cycle“ pri pravljenju.
  - **Inbox** (status `triage`): zahtevi klijenata i GitHub issues; Accept / Backlog / Decline; broj u meniju.
  - **GitHub sync** u workeru (na 5 min, bez webhook-a): PR sa ključem taska ili „Fixes #N“ → In Review / Done; opciono novi GitHub issues → Inbox. Veze (PR, issue) vidljive u tasku.
  - **Assign to Claude / Codex**: GitHub issue sa „context pack“ briefom i @pominjanjem; PR se vraća automatski.
  - **Portal za klijenta**: tajni link (heš u bazi, opoziv), napredak, završeno ove nedelje, u toku, sledeće; forma za zahtev (zamka za botove, limit 5/h) → Inbox + Telegram.
  - Provereno lokalno sa lažnim GitHub serverom: brief i @claude u issue-u, PR otvoren → In Review, spojen → Done, draft „Fixes #101“ povezan, GitHub issue → Inbox bez duplikata; portal i zahtev u pregledaču.

- **17. 11. 2026. — Faza 10 (Delivery MVP)**
  - Baza: `customers` (u UI-ju Clients; `clients` ostaje AI Router), `projects` (ključ npr. ACME, status, budžet, rok, vođa, repo), `issues` (ACME-12, status, prioritet 0–4 kao Linear, osoba, procena, oznake, rok, redosled), `issue_events` (komentari + istorija). Migracija 0007.
  - API `/delivery/*`: klijenti, projekti (sa napretkom), taskovi (filter po projektu / „me“ / otvoreni), komentari, istorija, `POST /delivery/from-lead/:id` (klijent + projekat iz leada, lead → Won).
  - Web: prekidač **Sales / Delivery** u meniju; **Projects** (lista, napredak, novi/izmena), **projekat** (Board / List / Overview, pretraga, status projekta), **My issues** (moji / svi otvoreni), **Clients**; tabla sa prevlačenjem (status + redosled), detalj taska kao bočni panel, novi task (prečica **C**, ⌘Enter, „Create more“); dugme **Create project in Delivery** na Won leadu.
  - Provereno u pregledaču (lokalno): lead → projekat, novi task sa osobom i prioritetom, promena statusa, komentar i istorija, prevlačenje u drugu kolonu (sačuvano), tamna i svetla tema, uska širina.

- **17. 11. 2026. — Faza 9**
  - **Email-in**: worker čita posebno IMAP sanduče (Gmail + App password), od svakog projekta iz obaveštenja pravi lead; AI izvlači naslov/opis/budžet/link, bez AI-a rezervno parsiranje. Prepoznaje platformu po pošiljaocu ili „From:“ u prosleđenom mejlu (Upwork, PeoplePerHour, Malt, Freelancer, Guru, Contra, Portal javnih nabavki, e-Nabavke BiH, LinkedIn); ostalo = „Email inbox“ (direktni upiti). Bez duplikata iz više mejlova.
  - **Freelancer.com** (zvanični API, 10 pretraga na sat; opis se briše posle 24 h po uslovima API-ja), **e-Nabavke BiH** (otvoreni OData, usluge + IT ključne reči), **SAM.gov** (jednom dnevno, samo uz `SAM_API_KEY`; bez set-aside tendera).
  - Worker posle restarta ne zove izvore koji nisu na redu (SAM.gov ima 10 poziva dnevno); izvori bez podešavanja se preskaču.
  - Sources: opisi za sve nove izvore, kartica „Connect Email-in“ dok sanduče nije povezano. Uputstvo: [EMAIL-IN.md](EMAIL-IN.md).
  - Provereno lokalno: test mejl server (GreenMail) → 3 mejla → 5 leadova sa pravim izvorima; Freelancer 214 → 68 leadova, BiH 11 tendera; testovi 24/24.

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
- [x] Coolify instaliran na mini PC (`http://192.168.x.x:8000`)
- [x] Dashboard: dizajn iz mockup-a + prikaz za telefon
- [x] Radar (api + worker + baza + LiteLLM) deploy preko Coolify-ja → `http://192.168.x.x:3100/health` radi (port 3000 je na serveru zauzet)
- [x] Javna HTTPS adresa za API: https://<server>.<tailnet>.ts.net (Tailscale Funnel → port 3100); `VITE_API_URL` u Netlify Environment variables
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

- **Praćenje grešaka** (ugrađeno): greške iz aplikacije (web) i servera (api) u bazi, grupisane po vrsti; nova greška → Telegram (najviše jednom na sat); pregled u Settings → System (vlasnik), Resolve / Resolve all.

- **Sales:** AI nacrt odgovora na leadu (mejl / ponuda, EN / SR, besplatni modeli), podsetnici „Follow up“ (Telegram + zvonce + oznaka na Pipeline kartici), duplikati iz drugih izvora se sakriju („Also on“), nedeljni izveštaj ponedeljkom u 8h na Telegram.

- **Delivery 2.0:** ⌘K / Ctrl+K paleta (taskovi i po ključu PZS-12, projekti, klijenti, leadovi, brze radnje; dugme za pretragu gore za telefon), pregled izmena u PR-u u aplikaciji (fajlovi, +/−, diff u boji) u Code → Pull requests i u razgovoru sa Claude-om.

- **Projekat → Overview:** Docs (markdown stranice, „AI“ ide Claude-u kao kontekst), Release notes (spojeni PR-ovi + završeni taskovi, „Polish with AI“ EN/SR), Site health (provera sajta klijenta na 5 min, uptime 7 dana, Telegram kad padne / se vrati; adrese iz kućne mreže blokirane), Invoices (vlasnik: iz sati ili budžeta, broj 2026-001, status draft/sent/paid, stranica za štampu / PDF; podaci firme u Settings → Organization → Invoice details).

## Otvoreno
- Konačan naziv (predlog: Scoutline)
