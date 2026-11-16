# Deploy

## Faza A — start: mini PC kao server, Netlify za frontend

Server: **mini PC, Intel i5 10. generacije, 16 GB RAM**, radi 24/7.
Mac (M2 Pro) služi za razvoj i, opciono, kao dodatni AI čvor kad je uključen.

```
Mini PC (Ubuntu Server + Docker Compose)          Internet
├─ postgres                                       
├─ litellm           ← router + troškovi ──────→ besplatni cloud AI (Gemini / Groq / OpenRouter :free)
├─ ollama            ← mali lokalni model (rezerva)
├─ worker            ← prikupljanje + ocena       
├─ api  ─────────── cloudflared tunnel ──────────→ https://api.<domen>
└─ uptime-kuma                                    
                                                  Netlify → https://app.<domen> (dashboard)
Mac (opciono, preko Tailscale-a) ← Ollama 8B      Telegram/Slack ← obaveštenja
```

### Raspodela RAM-a (16 GB)

| Servis | Okvirno |
|---|---|
| Sistem + Docker | ~1,5 GB |
| Postgres | ~1 GB |
| LiteLLM + api + worker + uptime-kuma | ~1,5 GB |
| Ollama sa modelom ~3–4B (Q4) | ~3–4 GB |
| Rezerva | ~8 GB |

### AI na ovom hardveru — realno

- i5 10. gen nema GPU za AI → lokalni model radi na procesoru i **sporiji je nego na Mac-u**.
- Model od 7–8B bi trošio ~30–60 s po oglasu → za stotine oglasa dnevno previše.
- Zato:
  1. **Glavni put:** besplatni cloud nivo (Gemini / Groq / OpenRouter `:free`) preko LiteLLM-a.
     Oglasi su javni podaci, pa slanje na besplatne nivoe nije problem privatnosti.
  2. **Rezerva:** mali lokalni model (~3–4B) na mini PC-u kad se pređu besplatni limiti.
  3. **Opciono:** Mac kao jači AI čvor preko Tailscale-a (besplatno) kad je uključen.
  4. Jak prefilter bez AI-a + kratak prompt → što manje poziva.
- Podaci klijenata u AI Ops delu (kasnije) **ne idu** na besplatne nivoe — tamo plaćeni API sa budžetom ili lokalni model.

### Koraci

1. Na mini PC: Ubuntu Server 24.04 LTS, statička lokalna IP, SSH ključ (bez lozinke), automatske bezbednosne nadogradnje.
2. Docker + Docker Compose, `docker compose up -d` iz `infra/`.
3. Ollama + mali model (proveriti aktuelne na ollama.com).
4. Javni API bez domena: **Tailscale Funnel** → `https://<server>.<tailnet>.ts.net` (vidi [SERVER.md](SERVER.md)).
   Kad kupimo domen: Cloudflare Tunnel za `api.<domen>`.
5. Netlify: povezati GitHub repo, build `apps/web`, env `VITE_API_URL=<javna adresa API-ja>`; adresa `https://<ime>.netlify.app`.
6. Auth u aplikaciji (Better Auth) + CORS samo za Netlify adresu.
7. Deploy novih verzija: **Coolify** — push na `main` → automatski build i restart.
8. Noćni `pg_dump` backup → drugi disk ili cloud (npr. Backblaze B2 / Google Drive), čuvati 14 dana.

### Šta podesiti na mini PC-u (radi korisnik)
- BIOS: "Power on after power loss" = uključeno (da se sam upali posle nestanka struje).
- Žični internet ako je moguće.
- Po želji mali UPS.

### Rizici
- Nestanak struje/interneta → radar kasni, podaci se ne gube (worker nastavlja od poslednjeg preuzimanja).
- Besplatni AI limiti se menjaju → LiteLLM automatski prelazi na lokalni model.
- Česti zahtevi sa kućne IP adrese mogu biti blokirani → zvanični API/RSS i spori rasporedi.

## Faza B — kasnije: VPS

Ako mini PC ne bude dovoljan ili dođu klijenti na AI Ops:
- Isti `docker-compose.yml` na VPS-u (~5–8 €/mes), bez izmena koda.
- Mini PC može da ostane kao backup ili AI čvor.
- Frontend ostaje na Netlify-ju.

## Okruženja

| Okruženje | Gde | Namena |
|---|---|---|
| `dev` | Mac, `pnpm dev` | Razvoj |
| `prod` | Mini PC (Faza A) → VPS (Faza B) | Stvarni rad |
| Preview | Netlify deploy preview po PR-u | Pregled izmena frontenda |

Tajne (ključevi, lozinke) samo u `.env` koji nije u git-u; primer u `.env.example`.
