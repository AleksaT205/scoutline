# Roadmap 2.0 — projekti za firmu + odvojen modul za rad

Datum: 16. 11. 2026. Faze 0–7 su gotove (vidi PROGRESS.md). Ovo je plan za sledeći korak.

## Šta menjamo i zašto

1. **Leadovi = projekti za firmu, ne zaposlenje.** Sadašnji izvori su uglavnom oglasi za posao (full-time). Firmi trebaju **projekti**: tenderi, RFP-ovi, projekti na marketplace-ima, firme koje traže agenciju. Oglasi za posao ostaju, ali kao **slabiji signal** („firma zapošljava developere → možda joj treba i spoljna ekipa“).
2. **Rad na projektima = poseban modul**, kao Linear/Jira: kad lead postane „Won“, prelazi u **Delivery** deo aplikacije gde tim vodi projekat, taskove i AI agente. Prodaja i isporuka su odvojene, ali povezane.

---

## Deo A — Lead model 2.0

### Tipovi leadova

| Tip | Primer | Težina |
|---|---|---|
| `tender` | Javna nabavka: „izrada portala za opštinu“ (TED, UK, Kanada, Srbija) | najjači — postoji budžet i rok |
| `project` | Projekat na marketplace-u ili direktan upit: „treba nam MVP za 8 nedelja“ | jak |
| `intent` | Firma upravo dobila investiciju / lansirala proizvod | srednji — proaktivan kontakt |
| `hiring_signal` | Oglas za posao (developer) | slab — samo ako je contract/remote ili mala firma bez tima |

- AI ocenjuje **verovatnoću da firma angažuje agenciju za projekat** (već tako piše u promptu, ali sad sa tipom i jasnijim pravilima).
- Full-time zaposlenje bez znakova „contract / agency / project“ → automatski nisko ili sakriveno.
- U dashboard-u: filter **Tip** (Tenders · Projects · Intent · Hiring signals), podrazumevano bez hiring signala.

### Katalog izvora (provereno 16. 11. 2026)

Legenda: ✅ zvanični pristup, može · 🟡 može uz uslov · 📧 samo preko email obaveštenja · 🔴 ne automatizovati

**Tenderi (javne nabavke) — najvredniji za firmu**

| Izvor | Pristup | Status | Napomena |
|---|---|---|---|
| **EU TED** | Search API v3, anonimno | ✅ | Cela EU; filter po CPV kodovima za IT (72000000, 48000000) |
| **UK Contracts Finder** | OCDS API + dnevni CSV, bez ključa (Open Government Licence) | ✅ | Manji poslovi, često otvoreni za strance |
| **UK Find a Tender** | OCDS API | ✅ | Veći poslovi |
| **Kanada CanadaBuys** | Dnevni CSV otvorenih tendera, bez ključa | ✅ | Samo federalni nivo |
| **SAM.gov (SAD)** | Opportunities API, besplatan ključ, dnevna kvota | 🟡 | Mnogi traže registraciju u SAD — označavati „eligibility“ |
| **Srbija — Portal javnih nabavki** | Nema dokumentovan API/RSS | 📧 | Email obaveštenja portala → Email-in (vidi dole); pitati UJN za otvorene podatke |
| **BiH e-nabavke** | Objavljen OpenAPI (open.ejn.gov.ba) | 🟡 | Proveriti uslove; region, isti jezik |
| Hrvatska EOJN, Crna Gora CEJN | — | 🟡 | Proveriti |
| AusTender | API ima samo dodeljene ugovore | ⚪ | Ne za nove leadove |

**Marketplace-i za projekte**

| Izvor | Pristup | Status | Napomena |
|---|---|---|---|
| **Freelancer.com** | Zvanični API (OAuth app) | 🟡 | Proveriti uslove za praćenje projekata pre uključivanja |
| **Upwork** | API uslovi zabranjuju praćenje; RSS ugašen 2024. | 📧 | Sačuvane pretrage → email obaveštenja → Email-in |
| PeoplePerHour, Guru, Malt, Contra | Nema zvaničnog API-ja | 📧 | Email obaveštenja → Email-in |
| Clutch, GoodFirms | Upiti samo za plaćene profile | ✋ | Ručno („Add lead“) |
| LinkedIn | Zabranjeno automatsko čitanje | ✋ | Ručno |

**Signali namere**

| Izvor | Pristup | Status |
|---|---|---|
| Vesti o investicijama (TechCrunch, EU-Startups, Startit) | RSS | ✅ |
| Product Hunt (nova lansiranja) | Zvanični GraphQL API sa tokenom | ✅ |
| HN „Who is hiring“ (contract/remote) | Zvanični API | ✅ (već radi) |
| Reddit r/forhire, r/hiring | Komercijalna upotreba traži odobrenje | 🟡 |

**Oglasi za posao (postojećih 6)** — RemoteOK, WWR, Remotive, Arbeitnow, Himalayas, Jobicy → postaju `hiring_signal`, uz strožiji filter (contract / freelance / mala firma).

### Email-in — ključ za zatvorene platforme
Mnoge platforme (Upwork, PeoplePerHour, Malt, Portal javnih nabavki, LinkedIn job alerts) nemaju API, ali **šalju email obaveštenja** za sačuvane pretrage. To je legalno — to su tvoji mejlovi.

- Posebna adresa (npr. `leads@tvojdomen.com` preko Cloudflare Email Routing ili poseban Gmail preko IMAP-a).
- Na platformama podesiš sačuvane pretrage i email na tu adresu.
- Worker čita mejlove, izvuče oglase (AI parsiranje), napravi leadove sa izvorom „Upwork (email)“ itd.

---

## Deo B — Delivery modul (kao Linear)

### Kako rade popularni sistemi (ukratko)
- **Linear**: brz, „opinionated“: Projects → Cycles (sprint 1–2 nedelje) → Issues; **Triage inbox** za sve novo; PR na GitHub-u automatski menja status issue-a.
- **Jira**: sve se podešava (workflow-i, polja), moćno ali teško.
- **GitHub Projects**: dobar ako sve živi na GitHub-u, ali nema cycles/triage.

**Predlog: Linear model** (jednostavan, brz), uz GitHub integraciju i AI agente.

### Struktura aplikacije
```
[ Sales ▾ ]  ← prekidač prostora (kao timovi u Linear-u)
  Sales     : Overview · Leads · Pipeline · Sources
  Delivery  : Inbox · Projects · Issues · Cycles · Clients
  AI Ops    : Router · Agents
  Workspace : Tasks (naš repo) · Team · Settings
```

### Pojmovi
| Pojam | Šta je |
|---|---|
| **Client** | Firma za koju radimo (iz Won leada ili ručno) |
| **Project** | Isporuka za klijenta: rok, budžet, repo, status (Planned → Active → Done) |
| **Issue** | Task: Triage → Backlog → Todo → In Progress → In Review → Done / Canceled; prioritet, assignee, procena, oznake |
| **Cycle** | Dvonedeljni sprint; nedovršeno prelazi automatski |
| **Inbox / Triage** | Novi zahtevi (od klijenta, iz GitHub-a, iz forme) čekaju odluku |

### Tok
`Lead (Won)` → **Create project** (klijent, budžet, opis iz leada) → issues → cycle → PR → Done → izveštaj klijentu.

### Integracije
- **GitHub po projektu**: svaki projekat može imati svoj repo; PR „Fixes #12“ → issue ide u *In Review*, merge → *Done*.
- **AI agenti**: na issue-u **Assign to Claude** / **Assign to Codex** → task ide u GitHub repo projekta sa `@claude`; status prati PR. Radi preko pretplate (Faza 7).
- **„Context pack“ za agente**: uz svaki issue kratak brief (cilj, „gotovo kada“, relevantni fajlovi) → manje tokena, bolji rezultat.
- **Klijent portal**: link samo za pregled po projektu (napredak, završeno ove nedelje).

### Podaci
Sopstvene tabele (`clients`, `projects`, `issues`, `cycles`, `issue_events`) — jer klijentski projekti ne moraju biti na GitHub-u. GitHub je integracija, ne jedino mesto.

---

## Redosled (faze)

| Faza | Šta | Veličina |
|---|---|---|
| **8** ✅ | Lead model 2.0: tip leada, novi prompt, filter; **tenderi**: EU TED, UK (Contracts Finder + Find a Tender), CanadaBuys; RSS signali investicija | srednja |
| **9** ✅ | **Email-in** (Upwork, PeoplePerHour, Malt, Portal javnih nabavki…), Freelancer.com API (posle provere uslova), SAM.gov, BiH | srednja |
| **10** ✅ | **Delivery MVP**: prekidač prostora, Clients, Projects, Issues board (Linear stil), Lead → Project | velika |
| **11** ✅ | Cycles, Triage inbox, GitHub PR sinhronizacija, Assign to Claude/Codex, klijent portal | velika |
| **12** ✅ | Izveštaji: profitabilnost po projektu, vreme, ušteda AI-a po projektu | srednja |

Svaka faza = GitHub issue (epic) + manji taskovi; može da se radi ovde, preko @claude ili Codex-a.
