# Mini PC kao server

Cilj: mini PC (i5 10. gen, 16 GB, SSD 512 GB–1 TB, Linux) radi 24/7, a ti preko web dashboard-a vidiš da li radi, koliko troši i pokrećeš test aplikacije jednim klikom.

## Šta instaliramo

| Alat | Šta radi | Pristup | Cena |
|---|---|---|---|
| **Tailscale** | Privatna mreža: server ti je dostupan sa laptopa/telefona bilo gde, bez otvaranja portova | aplikacija na svakom uređaju | 0 € (lični plan) |
| **Coolify** | "Sopstveni Netlify/Heroku": deploy aplikacija iz GitHub-a, Docker Compose, baze, logovi, restart, SSL | `http://<server>:8000` preko Tailscale-a | 0 € (open-source) |
| **Beszel** | Monitoring: CPU, RAM, disk, mreža, temperatura, stanje svakog kontejnera, upozorenja | `http://<server>:8090` preko Tailscale-a | 0 € (open-source) |
| **Uptime Kuma** | Da li su aplikacije dostupne; poruka na Telegram kad nešto padne | preko Tailscale-a | 0 € |

Rezultat: otvoriš Coolify → vidiš sve aplikacije (Radar, test app-ove), deploy-uješ novu granu, gledaš logove. Otvoriš Beszel → vidiš da je server živ i koliko je opterećen. Telegram ti javi ako nešto padne.

**Admin paneli (Coolify, Beszel) nikad nisu javni** — samo preko Tailscale-a.

## Redosled podešavanja

> Pre pokretanja bilo koje instalacione skripte, pogledaj zvanična uputstva — komande ispod su sa njihovih sajtova, ali se mogu promeniti.

1. **Osnova**
   - Proveri distribuciju: `cat /etc/os-release`. Coolify najbolje radi na **Ubuntu LTS (24.04)** ili Debianu.
   - Prebaci na **žični** internet.
   - BIOS: "Power on after power loss" = uključeno.
   - `sudo apt update && sudo apt upgrade -y` i uključi automatske bezbednosne nadogradnje (`unattended-upgrades`).
   - SSH samo sa ključem (isključiti prijavu lozinkom).
   - Proveri disk: `lsblk` i `df -h`.

2. **Tailscale** (server + tvoj Mac + telefon)
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```
   ```bash
   sudo tailscale up
   ```
   Posle toga server ima adresu tipa `minipc` / `100.x.y.z` dostupnu samo tvojim uređajima.

3. **Coolify**
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
   ```
   Dashboard: `http://<tailscale-ime-servera>:8000` → napravi admin nalog odmah.
   Poveži GitHub (GitHub App) → svaki push na izabranu granu = automatski deploy.

4. **Beszel** — kroz Coolify (Docker Compose ili gotov šablon ako postoji) ili po zvaničnom uputstvu; hub + agent na istom serveru.

5. **Uptime Kuma** — kroz Coolify; dodaj Telegram obaveštenja.

## Javni pristup bez domena

| Šta | Kako | Adresa |
|---|---|---|
| Frontend (dashboard za tim) | Netlify | `https://<ime>.netlify.app` — besplatno, stalno |
| API sa mini PC-a | **Tailscale Funnel** | `https://<server>.<tailnet>.ts.net` — besplatno, stalno, HTTPS |
| Test app za brzo deljenje | Funnel ili Cloudflare quick tunnel | quick tunnel adresa se menja pri restartu |

Funnel: `sudo tailscale funnel --bg <port>` (proveri aktuelnu sintaksu u Tailscale dokumentaciji).

⚠️ Tailscale lični plan je namenjen nekomercijalnoj upotrebi. Za testiranje je u redu; **kad platforma počne da služi za posao**, uzeti domen (~10–15 €/god) i preći na Cloudflare Tunnel — kod se ne menja, samo adresa.

## Budžet RAM-a (16 GB)

| | Okvirno |
|---|---|
| Sistem + Docker + Coolify | ~2–2,5 GB |
| Beszel + Uptime Kuma | ~0,3 GB |
| Radar (Postgres, LiteLLM, api, worker) | ~2,5 GB |
| Ollama mali model (rezerva) | ~3–4 GB |
| Test aplikacije | ostatak (~6–7 GB) |

Disk 512 GB je više nego dovoljno; Docker slike i logove čistiti povremeno (Coolify ima opciju za automatsko čišćenje).

## Backup
- Coolify: zakazani backup baza (Postgres) → lokalno + S3-kompatibilno skladište (npr. Backblaze B2 ima besplatnih 10 GB — proveriti).
- Jednom mesečno probati vraćanje backup-a.
