# Izvori

Pravilo: **zvanični API ili RSS > dozvoljeni scraping (robots.txt + uslovi) > ručno/email upozorenja**.
Pre uključivanja svakog izvora: proveriti uslove korišćenja i zabeležiti ovde datum provere.

Legenda statusa: ✅ može odmah · 🟡 proveriti uslove pre upotrebe · 🔴 ne automatizovati

## Svetski — Faza 1 (zvanični pristup, besplatno)

| Izvor | Pristup | Status | Napomena |
|---|---|---|---|
| RemoteOK | Javni JSON API | 🟡 | Traže link ka njima uz prikaz oglasa |
| We Work Remotely | RSS po kategorijama | 🟡 | |
| Hacker News "Who is hiring" | Zvanični HN API (Firebase) | ✅ | Mesečna tema, mnogo startapa iz SAD |
| Remotive | Javni API | 🟡 | Proveriti limite |
| Arbeitnow | Javni API | 🟡 | Dobar za Nemačku/EU |
| EU TED (tenderi) | Search API v3, anonimno | ✅ radi | CPV 72*/48*, otvoreni pozivi, poslednja 3 dana (Faza 8) |
| UK Contracts Finder | OCDS API, Open Government Licence | ✅ radi | Faza 8 |
| UK Find a Tender | OCDS API | ✅ radi | Faza 8 |
| CanadaBuys | Dnevni CSV otvorenih tendera | ✅ radi | Samo usluge (SRV) + IT ključne reči (Faza 8) |
| Himalayas | Javni API | ✅ | Uslov: navesti Himalayas i koristiti njihov applicationLink — ispunjeno |
| Jobicy | Javni API | ✅ | Uslov: navesti Jobicy i linkovati originalni oglas — ispunjeno |
| SAM.gov (US tenderi) | Zvanični API (besplatan ključ) | 🟡 | T1 tržište, ali često traže US registraciju |

## Svetski — kasnije / ograničeno

| Izvor | Pristup | Status | Napomena |
|---|---|---|---|
| Upwork | RSS ugašen avgusta 2024; zvanični API uslovi zabranjuju kontinuirano praćenje | 🔴 automatski | Koristiti Upwork-ove sačuvane pretrage + email obaveštenja; tim ručno šalje predloge |
| LinkedIn | Uslovi zabranjuju scraping | 🔴 | Samo ručno (Sales Navigator ako se odlučite da platite) |
| Reddit | Komercijalna upotreba traži odobrenje Reddit-a (od nov. 2025 svi novi klijenti) | 🟡 | Podneti zahtev; do tada ručno |
| Indeed / Glassdoor | Ograničen pristup | 🔴 | Ne automatizovati |
| Wellfound | Bez javnog API-ja | 🟡 | Proveriti uslove |
| Vesti o investicijama | RSS | ✅ radi | TechCrunch venture + Startit (Faza 8); EU-Startups vraća 403 — preskočeno |

## Domaći

| Izvor | Pristup | Status | Napomena |
|---|---|---|---|
| Poslovi Infostud | robots.txt zabranjuje /search i /rss_feed | 🔴 automatski | Ručno dodavanje leada iz linka |
| HelloWorld.rs | Proveriti RSS/uslove | 🟡 | IT oglasi |
| Joberty | Proveriti uslove | 🟡 | |
| Halo oglasi / KupujemProdajem (usluge) | Proveriti uslove | 🟡 | Male firme |
| Portal javnih nabavki | Javni podaci | 🟡 | Tenderi za softver/digitalizaciju |
| APR (nove firme) | Javni podaci | 🟡 | Kasnije, za obogaćivanje |

Ako sajt ne dozvoljava automatsko preuzimanje — pitati ih za partnerstvo/feed ili ostaviti ručno.

## Pravila za scraping (gde je dozvoljen)

- Poštovati `robots.txt`, max 1 zahtev na nekoliko sekundi po domenu, jasan User-Agent bez ličnih podataka.
- Čuvati samo poslovne podatke iz oglasa (firma, naslov, opis, lokacija, link). Bez ličnih podataka zaposlenih.
- Keširati i ne preuzimati isti oglas dva puta.
