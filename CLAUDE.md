@AGENTS.md

## Za Claude Code
- Na početku taska pročitaj `docs/PROGRESS.md` i samo fajlove koje task dira — ne skeniraj ceo repo.
- Jedan task = jedna sesija; posle završetka `/clear` (manje tokena, čistiji kontekst).
- Za veće izmene prvo plan (plan mode), pa implementacija.
- Pre commit-a: `pnpm typecheck && pnpm test && pnpm build`.
- Commit poruke na srpskom, kratke, bez AI potpisa.
