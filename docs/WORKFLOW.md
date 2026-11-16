# Kako radimo (Faza 7)

Cilj: organizovan razvoj i **ušteda tokena** — bez plaćenog API ključa, preko Claude (ili ChatGPT) pretplate.

## Gde je šta
| | |
|---|---|
| **Taskovi** | GitHub Issues — vide se i u dashboard-u (**Workspace → Tasks**) |
| **Stanje faza** | `docs/PROGRESS.md` |
| **Uputstvo za AI** | `AGENTS.md` (Codex i ostali), `CLAUDE.md` (Claude Code) — struktura, komande, pravila |

AI asistent iz `AGENTS.md`/`CLAUDE.md` odmah zna strukturu i pravila, pa ne troši tokene na pretraživanje celog repoa.

## Tri načina rada

### 1. Claude Code na računaru (pretplata) — za veće stvari
```bash
cd ~/scoutline/radar
claude
```
- „Uradi task #4“ → Claude pročita issue (`gh issue view 4`), napravi izmenu, pokrene proveru, commit.
- **Jedan task = jedna sesija**, posle `/clear`. Za veće izmene prvo plan (Shift+Tab → plan mode).

### 2. @claude na GitHub-u (pretplata, radi i bez računara)
U bilo kom issue-u ili PR komentaru napiši `@claude …` — ili u dashboard-u klikni **Ask Claude** / čekiraj **Let Claude do it** pri pravljenju taska. Claude Code na GitHub-u napravi granu, izmenu, pokrene `pnpm typecheck && pnpm test && pnpm build` i otvori **pull request** koji ti pregledaš i spojiš.

**Jednokratno podešavanje (5 min):**
1. U Claude Code-u na Mac-u: `/install-github-app` → instaliraj Claude GitHub aplikaciju na repo **scoutline**.
2. U terminalu: `claude setup-token` → prijava preko pretplate → dobiješ token.
3. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**: ime `CLAUDE_CODE_OAUTH_TOKEN`, vrednost = token.
4. Probaj: u issue-u #7 komentar `@claude proveri uslove i napiši odluku u docs/SOURCES.md`.

Napomene: troši limit tvoje pretplate (kao rad u Claude Code-u) i GitHub Actions minute (privatni repo: 2.000 min/mesec besplatno). Commit-e koje napravi akcija potpisuje bot naloga akcije.

### 3. Codex (ChatGPT pretplata)
chatgpt.com/codex → poveži GitHub → izaberi repo **scoutline** → zadaj task. Codex čita `AGENTS.md`.

## Taskovi iz dashboard-a
**Workspace → Tasks** prikazuje GitHub Issues (otvorene/zatvorene), pravi nove (Task/Bug) i šalje ih Claude-u.

Podešavanje (jednom): GitHub → Settings → Developer settings → **Fine-grained tokens** → samo repo `scoutline`, dozvola **Issues: Read and write** → u Coolify: `GITHUB_TOKEN=…`, `GITHUB_REPO=AleksaT205/scoutline` → Redeploy.

## Ušteda tokena — pravila
1. Kratki, jasni taskovi sa „Gotovo kada“ (šablon na GitHub-u to traži).
2. Jedan task po sesiji, pa `/clear`.
3. Asistent čita `AGENTS.md` + `PROGRESS.md` + samo fajlove taska.
4. Rutinske stvari (tekst, mali bug) → @claude na GitHub-u; dizajn i arhitektura → Claude Code lokalno, sa planom.
