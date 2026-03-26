# CLAUDE.md

## Project

Electrolux-to-MQTT bridge — TypeScript service that connects Electrolux appliances to Home Assistant via MQTT auto-discovery. Uses pnpm, Biome, Vitest. Includes a standalone `telemetry-backend/` service for anonymous usage statistics.

## Rules

### TypeScript
- Never use `any`. Use `unknown` + type guards. No `as` without runtime check. No `// @ts-ignore`. No non-null assertions (`!`) — use type guards or optional chaining.
- Keep `strict: true` and `noUncheckedIndexedAccess: true`.
- State/config files read from disk must be validated, not blindly cast.
- Dynamic `import()` results must be validated at runtime (`typeof mod === "object"`, `"default" in mod`, etc.) — never bare `as` cast.

### Code quality
- No `console.log` — use `src/logger.ts` (pino). Exception: `console.*` is acceptable in `src/config.ts`, `src/init.ts`, and `src/logger.ts` for bootstrap messages that run before the pino logger is initialized.
- No silent error swallowing (empty `catch {}`) unless the fallback behavior is documented. No try/catch fallback patterns (try A, catch and silently retry B).
- No hardcoded secrets outside test fixtures.
- No dead exports — if a function/type is exported but never imported outside its own module, remove it.
- No dead fields in interfaces/types. If a field is not read anywhere, remove it.
- No dead type variants — if a union type includes a variant that no code path ever produces, remove it.
- Every config/schema field must be functional — never expose an option that has no implementation.

### Tooling
- Always use `pnpm`. Never `npm` or `yarn`.
- Biome for linting/formatting. No ESLint or Prettier. Single quotes everywhere (matching `biome.jsonc` `quoteStyle: "single"`).
- Always use `Number.parseInt` / `Number.parseFloat`, never the global forms.
- TDD: write tests first, then implement.

### Schemas
- Numeric schema fields that must be positive must use `.positive()` (or `.min(1)`). Numeric schema fields that must be whole numbers must also use `.int()`. Port-like fields must use `.int().min(1).max(65535)`.

### Conventions
- Conventional Commits. Semantic Versioning.
- `check`/`lint`/`format` script scopes must all cover `src/` and `tests/`.
- `.gitignore` must cover all generated/cached artifacts including CI-specific directories (e.g., `.pnpm-store/`).

### Sync
- All example files must stay in sync: `config.example.yml`, `docker/docker-compose.example.yml`, `docker/docker-compose.local.example.yml`. When a config option is added or changed, update every example.
- README project structure must match the actual directory layout — no phantom paths.
- README config example must exactly match `config.example.yml` — keep one source of truth and copy it verbatim.

### Domain
- Appliance classes must extend `BaseAppliance` and be registered in the factory.
- Home Assistant auto-discovery payloads must conform to the HA MQTT discovery specification.
- MQTT topic structure must be consistent and documented.

## Verification

After any code change:
1. Run `pnpm check` — fix any findings (lint + format via Biome).
2. If `src/`, `tests/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, or `biome.jsonc` changed:
   - Run `pnpm typecheck` — fix any type errors.
   - Run `pnpm test` — all tests must pass.
3. Skip typecheck/test for documentation-only or config-only changes (`.md`, `.claude/`, `.gitlab-ci.yml`, `.gitignore`, `LICENSE`).

## Skills

- `/audit` — full codebase audit (deps, lint, typecheck, tests, manual review). See [.claude/rules/review.md](.claude/rules/review.md) for the checklist.
- `/implement <description>` — implement any code change (feature, refactor, bugfix) following the checklists in [.claude/rules/implementation.md](.claude/rules/implementation.md).

## Context files

Read the relevant file **before starting work** — the skills do this automatically, but follow the same practice for ad-hoc requests:

| File | Read when… |
|------|-----------|
| [.claude/rules/implementation.md](.claude/rules/implementation.md) | You are about to write, edit, or delete any code in `src/`, `telemetry-backend/`, `docker/`, or `tests/` |
| [.claude/rules/review.md](.claude/rules/review.md) | You are asked to review, audit, or check the codebase |

## Self-maintenance

If you discover a new rule, exception, gotcha, or workflow improvement worth preserving, suggest adding it to the relevant context file (or propose a new one). If you identify a repeatable workflow that would benefit from a skill (saved prompt with checklist), suggest creating one in `.claude/skills/`. Always ask the user before writing — present the content you'd like to add. The goal is to keep guidance accurate, current, and useful for every future session.
