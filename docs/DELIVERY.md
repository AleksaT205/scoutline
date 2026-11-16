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

**Podešavanje (jednom):** GitHub → Settings → Developer settings → **Fine-grained tokens**:
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
