# Troškovi i alati

Cilj: **0 € mesečno na startu**. Plaća se samo ako to odlučimo kasnije.

## AI modeli — bez plaćenog API ključa

Anthropic/OpenAI API se naplaćuje po tokenu, pa ga **ne koristimo podrazumevano**.
Sve ide kroz LiteLLM, pa se model menja u konfiguraciji, bez izmene koda.

Server je mini PC (i5 10. gen, 16 GB, bez GPU-a), pa je lokalni AI spor — zato je redosled:

| Redosled | Opcija | Cena | Napomena |
|---|---|---|---|
| 1 | **Besplatni cloud nivoi**: Gemini API free tier, Groq free tier, OpenRouter `:free` modeli | 0 € | Ograničen broj zahteva. Kod nekih besplatnih nivoa podaci mogu da se koriste za treniranje — u redu za javne oglase, **ne za podatke klijenata** |
| 2 | **Ollama na mini PC-u** — mali model ~3–4B | 0 € | Rezerva kad se pređu limiti; ~3–4 GB RAM-a, sporo ali radi |
| 3 | *(opciono)* Ollama na Mac-u (M2 Pro) preko Tailscale-a, model ~8B | 0 € | Brže i kvalitetnije, samo kad je Mac uključen |
| 4 | *(opciono)* Ključevi koje već imate | po vašem planu | Dodaju se u `litellm.config.yaml` |

**Napomena:** pretplata na AI chat aplikacije (Pro / Plus planovi) **nije API** i ne sme se koristiti za automatsku obradu u aplikaciji. Može za razvoj (pisanje koda), ne za produkciju.

### Da li ovo stiže?
- Prefilter bez AI-a odbacuje većinu oglasa → realno **200–800 oglasa dnevno** ide do modela.
- Besplatni cloud nivoi to uglavnom pokrivaju; višak čeka u redu i obrađuje ga lokalni model.
- Kratak prompt i kratak JSON odgovor (~150 tokena).
- Predlog poruke se generiše samo kad ga neko zatraži.
- Limiti besplatnih nivoa se menjaju — proveriti pre početka i pratiti u LiteLLM-u.

## Ostali alati

| Šta | Alat | Cena |
|---|---|---|
| Kod | GitHub (privatni repo) | 0 € |
| Server | Vaš mini PC (i5 10. gen, 16 GB) | 0 € (struja) |
| Baza | Postgres u Docker-u na mini PC-u | 0 € |
| Privatna mreža Mac ↔ server | Tailscale (lični plan) | 0 € |
| AI router + troškovi | LiteLLM (open-source) | 0 € |
| Lokalni modeli | Ollama | 0 € |
| Frontend hosting | Netlify free (ili Cloudflare Pages) | 0 € — statički dashboard troši malo |
| Pristup Mac-u spolja | Cloudflare Tunnel (+ Access do 50 korisnika) | 0 € |
| Obaveštenja | Telegram bot, Slack webhook | 0 € |
| Monitoring | Uptime Kuma (self-hosted) | 0 € |
| Domen | bilo koji registrar, DNS na Cloudflare-u | ~10–15 €/god *(opciono, preporučeno)* |
| Kasnije: VPS | npr. Hetzner | ~5–8 €/mes *(kad Mac više nije dovoljan)* |
| Kasnije: obogaćivanje kontakata | Hunter / Apollo free planovi | 0 € u okviru limita |

## Ukupno

| Faza | Mesečno |
|---|---|
| Start (mini PC + Netlify + besplatni AI) | **0 €** (+ domen ~1 €/mes ako ga uzmete) |
| Kasnije (VPS, ako zatreba) | ~5–8 € |
| Ako uključite plaćeni API za bolji kvalitet | koliko odredite budžetom u LiteLLM-u |

Cene trećih strana se menjaju — proveriti zvanične stranice pre odluke.
