---
name: implement
description: Implement any code change (feature, refactor, bugfix) — reads the relevant checklists and follows them
disable-model-invocation: true
argument-hint: <description of the change>
---

Implement the following: $ARGUMENTS

## Steps

1. Read `.claude/rules/implementation.md` to load the full file checklists.

2. Determine which checklists apply based on what this change touches:
   - Config options → update config.ts, config.example.yml, docker-compose examples, README, tests
   - Appliance support → update appliance class, factory, normalizers, tests
   - Version-checker or telemetry → update version-checker.ts, tests, HOME_ASSISTANT.md, config examples
   - MQTT / Home Assistant integration → update mqtt.ts, HA types, tests, HOME_ASSISTANT.md
   - Docker configuration → update Dockerfile, compose files (both examples), README
   - User-facing feature or behavioral change → update README in the same pass
   - Telemetry backend → update endpoints, Dockerfile, compose, README
   - Dependency updates → follow the dependency checklist

3. Write tests first (TDD), then implement.

4. Verify (see CLAUDE.md § Verification):
   - [ ] `pnpm check`
   - [ ] `pnpm typecheck` (if src/ or tests/ changed)
   - [ ] `pnpm test` (if src/ or tests/ changed)
