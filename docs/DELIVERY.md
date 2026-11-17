# Delivery — kako se koristi (Faze 10 i 11)

Delivery je deo aplikacije za **isporuku projekata**, u stilu Linear-a. Prekidač **Sales / Delivery** je gore levo.

| Stranica | Čemu služi |
|---|---|
| **Inbox** | Novi zahtevi od klijenata (portal) i sa GitHub-a. **Accept** šalje zahtev u Todo tekućeg sprinta, **Backlog** ga čuva za kasnije, **✕** ga odbija. |
| **My issues** | Tvoji otvoreni taskovi iz svih projekata (ili svi otvoreni taskovi). |
| **Projects** | Svi projekti sa napretkom. Projekat ima tablu (Board), listu (List) i pregled (Overview). |
| **Cycles** | Sprintovi od 2 nedelje za ceo tim, sa grafikonom napretka (burn-up). Nedovršeni taskovi sami prelaze u sledeći sprint. |
| **Clients** | Firme za koje radite. |

Prečice: **C** pravi novi task, **⌘ Enter** ga sačuva, **Esc** zatvara prozor.

## Lead → projekat
Kad je lead **Won**, u detalju leada klikni **Create project in Delivery**. Klijent, budžet i opis se prenose iz leada.

## Portal za klijenta
Na stranici projekta klikni **Client portal**, pa **Create link** i pošalji link klijentu.
- Klijent vidi napredak u %, šta je završeno ove nedelje, šta je u toku i šta sledi.
- Taskovi sa oznakom `internal` se klijentu ne prikazuju.
- Klijent može da pošalje zahtev. Zahtev ide u **Inbox**, a stiže i Telegram obaveštenje ako je Telegram povezan.
- Link se vidi samo jednom, pri pravljenju; u bazi se čuva samo njegov heš. Ikonica 🗑 ga odmah gasi.

## GitHub: PR → status taska
Kad projekat ima **GitHub repo** (Edit → GitHub repo), worker na 5 minuta proverava pull request-ove:
- PR u čijem naslovu, opisu ili grani stoji ključ taska (npr. `ACME-12`) se poveže sa taskom.
- Otvoren PR šalje task u **In Review**, draft PR u **In Progress**, a spojen PR u **Done**. Status se nikad ne vraća unazad.
- Opcija **Import new GitHub issues into the Inbox** (u Edit project) dovodi nove GitHub issue-e u Inbox.

**Podešavanje (jednom):** najlakše u aplikaciji — **Settings → Integrations** (vlasnik: GitHub firme; svako: svoj GitHub). Token se pravi ovako — GitHub → Settings → Developer settings → **Fine-grained tokens**:
1. Repository access: repoi projekata (i `scoutline`, za stranicu Tasks).
2. Permissions: **Issues: Read and write**, **Pull requests: Read**, Metadata: Read.
3. U Coolify-ju postavi `GITHUB_TOKEN=…`. Isti token koristi i API i worker. Zatim **Redeploy**.

## Predaja taska AI agentu (Claude / Codex)
U detalju taska klikni **Assign to Claude** ili **Assign to Codex**:
1. Scoutline otvori GitHub issue `[ACME-12] naslov` u repou projekta, sa kratkim briefom („context pack“: cilj, „gotovo kada“, kontekst projekta, pravila) i sa `@claude` ili `@codex` na kraju.
2. Agent napravi granu i PR. PR naslov počinje sa `ACME-12`, pa ga Scoutline sam poveže.
3. Kad spojiš PR, task ide u **Done**.

Tip: u opisu taska napiši odeljak `Done when:` sa stavkama. To ide u brief kao kriterijum završetka.

**Šta treba u repou klijentskog projekta:**
- **Claude:** u Claude Code-u pokreni `/install-github-app` za taj repo. Kopiraj `.github/workflows/claude.yml` iz našeg repoa i dodaj secret `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`). Radi preko pretplate, kao u Fazi 7.
- **Codex:** chatgpt.com/codex → poveži GitHub → dozvoli pristup repou. Ako `@codex` u issue-u ne pokrene zadatak na tvom nalogu, otvori GitHub issue iz Codex-a ručno; brief je već spreman.
- `AGENTS.md` / `CLAUDE.md` u repou klijenta smanjuju potrošnju tokena (agent odmah zna strukturu).

## Vreme i izveštaji (Faza 12)
- **Unos vremena:** u detalju taska, odeljak **Time**. Upiši `1h 30m`, `45m` ili `2` (= 2 sata), izaberi datum, dodaj napomenu i klikni **Log**. Polje „Billable“ znači da se vreme naplaćuje klijentu (važno za projekte po satu).
- **Naplata projekta** (Edit project): **Fixed price** (vrednost = budžet) ili **Hourly** (vrednost = naplativi sati × satnica klijenta).
- **Interna cena sata** (Reports → dugme `€20/h`, menja samo vlasnik): koliko firmu košta sat rada, uz izuzetke po osobi. Iz toga se računa trošak.
- **AI trošak po projektu:** u Edit project izaberi ključ AI Router-a klijenta. Njegov trošak i ušteda idu na taj projekat.
- **Reports** prikazuje: vrednost, trošak, maržu, potrošen budžet (crveno preko 100%), stvarnu zaradu po satu, sate po nedelji i po osobi, AI uštedu i broj taskova koje su završili agenti. Dugme **CSV** izvozi tabelu za Excel.

## AI asistent (Faza 13)
- **Ask AI** na projektu (ili **Delivery → Assistant**): pitanja kao „gde je login i kako radi?“. Odgovor dolazi iz koda u GitHub repou projekta i iz taskova, sa linkovima na fajlove.
  - GitHub token tada treba i dozvolu **Contents: Read** (GitHub → token → Edit → Repository permissions).
- **Status update** na projektu: kratak izveštaj za tim ili za klijenta, za 7, 14 ili 30 dana; dugme Copy.
- **Modeli:**
  - **Auto** (preporučeno) bira besplatni model po pitanju.
  - **Claude** modeli rade uz Anthropic API ključ (Settings → Integrations, lični ili firme). Pretplata (Pro/Max) važi za agente na GitHub-u, ne za API.

## GitHub tok rada (Faza 14)
- **Two-way GitHub sync** (Edit project): GitHub issue-i automatski postaju taskovi, a promene u Scoutline-u (status, naslov, osoba, oznake) se upisuju nazad na GitHub. Tim može da radi samo na GitHub-u, a ovde se vidi stanje.
  - Osoba se prepoznaje po povezanom GitHub nalogu (Settings → Integrations → Your GitHub).
- **Više repoa:** tab **Code** → „Add repo“ (npr. `acme/web` · frontend).
- **Code → Activity:** commit-ovi i PR-ovi po nedelji, vreme do spajanja, koliko CI prolazi, ko radi, PR-ovi koji čekaju, milestone-i.
- **Code → Pull requests:**
  - **AI review** ostavlja `@claude` komentar na PR-u;
  - **Approve** (GitHub ne dozvoljava da odobriš sopstveni PR);
  - **Merge** (squash).
- **Code → Branches:**
  - nova grana;
  - u detalju taska **Create branch** pravi granu po tasku (`acme-12-naslov`);
  - brisanje grana čiji je PR spojen.
- **Code → Actions:** poslednja pokretanja; **Run** radi za workflow-e koji imaju `workflow_dispatch`.
- **Code → Deploy** (vlasnik dodaje dugme):
  - **Coolify:** URL deploy webhook-a + API token (Keys & Tokens).
  - **Netlify:** Build hook URL.
  - Čuva se šifrovano, a istorija deploy-a se pamti.
- **Dozvole tokena** (GitHub → Fine-grained token): Issues R/W, Pull requests R/W, Contents R/W, Actions R/W, Metadata R — za svaki repo projekta.

## Organizacija, skills, Figma, pokreni lokalno (Faza 15)
- **Settings → Organization:** ime, logo (https), boja, sajt i email firme. Prikazuju se u meniju i na portalu klijenta.
- **Code → Skills:** pravila i veštine za AI agente.
  - Izaberi stavke iz biblioteke i klikni **Add to project**: otvara se PR u repou.
  - **Draft AGENTS.md with AI** napiše vodič za projekat iz stvarnog koda.
  - Svoje skills-e praviš sa **New skill**.
- **Code → Run locally:** Open in VS Code / Cursor, GitHub Codespaces, i komande za pokretanje prepoznate iz repoa.
- **Preview po PR-u:** uključi Deploy Previews u Netlify-u ili Preview Deployments u Coolify-ju; link se pojavi na PR-u u Code → Pull requests.
- **Figma u tasku:** u detalju taska nalepi link na frame (desni klik → Copy link).
  - Za sličicu treba Figma token (Settings → Integrations): Figma → Settings → Security → Personal access tokens, scope *File content: read*.


## Claude Code iz aplikacije (Faza 16)
Sve ide preko GitHub-a i Claude **pretplate** (bez API ključa):
1. **Settings → Integrations → Your Claude Code token**: `claude setup-token` u terminalu → zalepi token. Svako ubacuje svoj (rad koji pokrene troši njegovu pretplatu); može i zajednički token firme.
2. Projekat → **Code** → zalepi GitHub link → **Set up automatically**: Scoutline upiše `.github/workflows/claude.yml` (Claude sam otvara PR, bez co-author linija) i secret `CLAUDE_CODE_OAUTH_TOKEN`. Jednom instaliraj Claude GitHub app (najbolje „All repositories“).
3. Projekat → **Ask AI → Build with Claude**: opiši zadatak → GitHub issue sa `@claude` → Claude radi u Actions → PR. U aplikaciji: status (radi / PR ready / merged), Claude-ovi komentari, odgovor Claude-u (ide na PR), **Preview** grane u browseru (StackBlitz), **Merge**.
4. Potrošnja: sesije i minuti po osobi ovog meseca (pretplata nema cenu po pozivu; limiti su na claude.ai/settings/usage). Ask AI chat pokazuje pitanja i tokene (Claude ključ vs besplatni modeli).
5. **Run locally**: StackBlitz (u browseru), Codespaces, VS Code/Cursor, komande + dugme „Open localhost“.

GitHub token treba: Contents, Issues, Pull requests, Actions, Workflows, Secrets — Read and write. Sesije se ne čuvaju u bazi: to su GitHub issue-i sa oznakom `scoutline`.
