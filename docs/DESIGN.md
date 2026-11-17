# Dizajn

Cilj: da na prvi pogled izgleda kao proizvod ozbiljne firme (nivo Linear / Vercel / Stripe dashboard-a), a ne kao interni alat. Poverenje dolazi iz **mira, doslednosti i detalja**, ne iz šarenila.

Mockup: [design/mockup.html](../design/mockup.html)

## Principi

1. **Jedna akcentna boja.** Sve ostalo su nijanse sive. Boja znači "ovde gledaj" (ocena, glavno dugme, aktivan filter).
2. **Puno praznog prostora.** Mreža od 4 px, razmaci 8 / 12 / 16 / 24 / 32.
3. **Tanke ivice umesto senki.** 1 px, niskog kontrasta; senke samo za plutajuće elemente (meni, modal).
4. **Brojevi su heroji.** Tabularne cifre, krupni KPI-jevi, jasni trendovi (↑ 12% vs juče).
5. **Brzo i tiho.** Animacije 150–200 ms, samo za prelaze stanja; skeleton umesto spinnera.
6. **Tastatura prvo.** ⌘K paleta komandi, `J/K` kroz listu, `E` email, `S` status.
7. **Svako stanje je dizajnirano.** Prazno, učitavanje, greška, bez rezultata — sa jasnim sledećim korakom.
8. **Tamna i svetla tema** od prvog dana, prati sistem.

## Tokeni

| Token | Tamna | Svetla | Upotreba |
|---|---|---|---|
| `--bg` | `#09090B` | `#FAFAFA` | Pozadina |
| `--surface` | `#111113` | `#FFFFFF` | Kartice, tabela |
| `--surface-2` | `#18181B` | `#F4F4F5` | Hover, inputi |
| `--border` | `#232326` | `#E4E4E7` | Ivice |
| `--text` | `#FAFAFA` | `#09090B` | Glavni tekst |
| `--muted` | `#A1A1AA` | `#52525B` | Sekundarni tekst |
| `--accent` | `#7C6CFF` | `#5B4BFF` | Akcenat (ljubičasto-indigo) |
| `--success` | `#22C55E` | `#16A34A` | Visoka ocena, ↑ |
| `--warning` | `#F59E0B` | `#D97706` | Srednja ocena |
| `--danger` | `#EF4444` | `#DC2626` | Greške, crvene zastavice |

Radijusi: 6 px (dugmad, inputi), 10 px (kartice), 14 px (modali).

## Tipografija

- **Geist** (ili Inter) za UI, **Geist Mono** za brojeve/ID-jeve/kod.
- Veličine (samo ove, u px): **11** oznake i brojači · **12** sporedni tekst i kontrole od 28px · **13** osnovni tekst i kontrole od 34px · **14** naslovi kartica, opis stranice, duži tekst · **16** naslovi dijaloga · **20 / 24 / 28** naslovi i velike brojke (KPI: 20 na telefonu, 28 na računaru). Polovične veličine (12.5, 13.5…) se ne koriste.
- Težine samo 400 / 500 / 600.

## Komponente i biblioteke

| Potreba | Biblioteka |
|---|---|
| Osnova komponenti | shadcn/ui (Radix) + Tailwind |
| Ikone | lucide-react (jedna debljina linije svuda) |
| Tabele | TanStack Table (sortiranje, kolone, virtuelno skrolovanje) |
| Grafikoni | Recharts (ili Tremor) — tanke linije, bez 3D i bez legendi gde nisu potrebne |
| Paleta komandi | cmdk (⌘K) |
| Obaveštenja | sonner |
| Animacije | Framer Motion (samo prelazi) |
| Zastave zemalja | flag-icons (SVG) |

## Ključni ekrani

1. **Pregled (Overview)** — 4 KPI kartice, grafikon leadova po danu po tier-u, "Najbolji danas" lista.
2. **Leadovi** — filter traka (čipovi), tabela, panel sa detaljima sa desne strane (bez napuštanja liste).
3. **Detalj leada** — ocena sa objašnjenjem AI-a, signali (budžet, remote, zemlja), predlog email-a sa dugmetom "Kopiraj / Otvori u mail-u", istorija.
4. **Pipeline** — kanban (Novo → Kontaktiran → Odgovorio → Sastanak → Dobijen/Izgubljen) sa vrednošću po koloni.
5. **Izvori** — status svakog izvora (zeleno/žuto/crveno), poslednje preuzimanje, broj oglasa.
6. **Podešavanja** — tim i pozivnice, linkovi za pregled, pragovi, Telegram.
7. **Javni link za pregled** — ista estetika, oznaka "Samo za pregled", bez osetljivih podataka.

## Detalji koji prave "wow"

- Ocena kao mali prsten (0–100) u boji, ne samo broj.
- Suptilan gradijent/sjaj iza KPI-ja i na login ekranu; ostalo ravno.
- Relativno vreme ("pre 12 min") sa tačnim datumom na hover.
- Hover na redu → pojave se brze akcije (email, status, sakrij).
- Prazno stanje sa ilustracijom u liniji i jednim dugmetom.
- Prvi utisak: login/landing sa jakim naslovom i čistim screenshot-om proizvoda.


## Komponente (apps/web/src/lib/ui.tsx)
- Dve veličine kontrola: **md = 34px** (glavna dugmad, polja, padajući meniji, `rounded-lg`) i **sm = 28px** (dugmad u redovima, čipovi, tabovi, `rounded-md`). Druge visine se ne koriste.
- Dugmad: `btnPrimary`, `btnSecondary`, `btnGhost`, `btnDanger`, `btnSm`, `btnSmPrimary`, `btnIcon`. Polja: `input` (34px), `field` (bez visine, za textarea), `select`.
- Prekidač: `Segmented` (ili `segWrap` + `segItem`). Kartica: `Card`. Prazno stanje: `EmptyState`. Oznaka: `Badge` (neutral / accent / success / warning / danger).
- Nova stranica koristi ove komponente — bez novih ručno pisanih visina i zaobljenja.
