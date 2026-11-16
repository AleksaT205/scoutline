# Email-in — leadovi iz email obaveštenja (Faza 9)

Upwork, PeoplePerHour, Malt, Portal javnih nabavki i LinkedIn nemaju API koji smemo da koristimo, ali **šalju email za nove oglase** po sačuvanoj pretrazi. To su tvoji mejlovi, pa je ovo legalno.

Kako radi: obaveštenja stižu u **jedno posebno sanduče**. Worker ga proverava na 10 minuta i od svakog projekta iz mejla napravi lead. AI izvuče naslov, opis, budžet i link, pa lead oceni. Bez AI-a radi rezervno parsiranje. Mejl se posle obrade označi kao pročitan.

## 1. Napravi sanduče (5 min, besplatno)
1. Napravi novi Gmail, npr. `leads.tvojafirma@gmail.com`. Ne koristi lični mejl.
2. Google nalog → **Security** → uključi **2-Step Verification**.
3. Google nalog → **Security** → **App passwords** (ili pretraga „App passwords“) → ime „Scoutline“ → **Create**. Dobiješ šifru od 16 slova.
4. Šifru **ne šalji nikome u chat**. Ide samo u Coolify (sledeći korak).

## 2. Poveži sa serverom
Coolify → projekat → **Environment Variables** (Production):

| Promenljiva | Vrednost |
|---|---|
| `IMAP_HOST` | `imap.gmail.com` |
| `IMAP_USER` | `leads.tvojafirma@gmail.com` |
| `IMAP_PASSWORD` | app password iz koraka 1.3 (bez razmaka) |

Zatim **Redeploy**. U dashboard-u → **Sources** pojaviće se red „Email-in · leads.tvojafirma@gmail.com“.

## 3. Podesi obaveštenja na platformama

| Platforma | Šta uraditi | Tip leada |
|---|---|---|
| **Upwork** | Pretraži poslove (npr. „react“, „AI chatbot“) → **Save search** → Settings → **Notification Settings** → email za sačuvane pretrage. Email naloga na Upwork-u postavi na adresu iz koraka 1, ili koristi prosleđivanje (korak 4). | Project |
| **PeoplePerHour** | Pretraga projekata → **Save search** → izmeni sačuvanu pretragu → učestalost emaila (Daily ili Instant). | Project |
| **Malt** | Nema pretrage. Malt sam šalje misije koje odgovaraju profilu: popuni profil, stavi dostupnost „now“, uključi obaveštenja. | Project |
| **Portal javnih nabavki (Srbija)** | Registracija na jnportal.ujn.gov.rs → **Postupci javnih nabavki** → filter (CPV 72000000, 48000000, ključne reči „softver“, „aplikacija“, „portal“) → sačuvaj filter i uključi obaveštenja na email. | Tender (RS) |
| **LinkedIn** | Job alert za „contract developer“, „freelance react“… | Hiring signal |

## 4. Ako obaveštenja stižu na drugi mejl
U tom mejlu (npr. Gmail) napravi **filter**: From sadrži `upwork.com` (ili `peopleperhour.com`, `ujn.gov.rs`) → **Forward to** `leads.tvojafirma@gmail.com`. Gmail prvo traži da potvrdiš adresu. Potvrdni mejl stiže u novo sanduče; otvori ga i klikni link.

Prosleđen mejl se prepozna po „From:“ liniji, pa izvor ostaje „Upwork (email)“.

## 5. Direktni upiti klijenata
Bilo koji mejl od klijenta („treba nam aplikacija…“) prosledi na istu adresu i postaće lead „Email inbox“, ocenjen i u pipeline-u.

## Napomene
- Izvori u dashboard-u: „Upwork (email)“, „PeoplePerHour (email)“, „Portal javnih nabavki (email)“… pojavljuju se kad stigne prvi mejl.
- Isti oglas iz dva mejla se ne duplira.
- Bezbednost: šifra je samo u Coolify-ju. Worker samo čita i označava pročitano, ništa ne šalje i ne briše. Tekst mejla se tretira kao podatak (AI ne izvršava „uputstva“ iz mejla).
- Drugi provajder (Outlook, Zoho, cPanel): `IMAP_HOST` i `IMAP_PORT` tog provajdera. Kad bude domen, može i Cloudflare Email Routing → isto sanduče.
