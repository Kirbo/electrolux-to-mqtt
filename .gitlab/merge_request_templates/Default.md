## Summary

<!-- One paragraph: what changed and why. Don't restate the diff — explain the motivation. -->

## Type of change

- [ ] `feat` — new feature (minor bump)
- [ ] `fix` — bug fix (patch bump)
- [ ] `chore(deps)` — dependency update (patch bump)
- [ ] `<type>!` — breaking change (major bump, `!` in type required)
- [ ] `refactor` / `test` / `docs` / `ci` / `style` / `perf` / `build` (no version bump)

See `.claude/CLAUDE.md` § Tooling for full Conventional Commits rules.

## Verification

- [ ] `pnpm check` — Biome lint/format clean
- [ ] `pnpm typecheck` — TypeScript strict passes
- [ ] `pnpm test` — full Vitest suite + coverage thresholds
- [ ] `pnpm sonar` — SonarQube quality gate passes
- [ ] (if `telemetry-backend/` touched) `cd telemetry-backend && pnpm typecheck && pnpm test`
- [ ] Tested manually in dev container (`pnpm dev:docker`) where applicable

## Sync

If this PR adds, modifies, or removes a config option, the change is reflected in:

- [ ] `config.example.yml`
- [ ] `docker/docker-compose.example.yml` and `docker-compose.local.example.yml`
- [ ] All four README locations (env var table, `docker run`, compose snippet, Portainer YAML)

## Linked issues

<!-- Closes #N, refs #M, etc. -->

## Notes for reviewer

<!-- Anything non-obvious: gotchas, tradeoffs considered, areas to scrutinize. -->
