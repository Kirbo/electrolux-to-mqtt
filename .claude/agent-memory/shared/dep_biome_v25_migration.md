---
name: dep-biome-v25-migration
description: Biome 2.5.0 upgrade — deprecated recommended option, 70+ new rules, run biome migrate --write
metadata:
  type: feedback
---

Biome 2.5.0 deprecated the `"recommended": true` option in `linter.rules`. Migration: run `pnpm biome migrate --write`, which rewrites to `"preset": "recommended"` automatically.

70+ nursery rules were promoted to stable. In this project, no new violations were triggered by those rules (as of June 2026).

Also note: four rules were renamed during promotion (noFloatingClasses→noUnusedInstantiation, noMultiStr→noMultilineString, useFind→useArrayFind, useSpread→useSpreadOverApply). If any of these are referenced explicitly in biome.jsonc, rename them before running migrate.

**Why:** biome migrate exits cleanly in this project; no source changes required.

**How to apply:** When bumping @biomejs/biome to 2.5.x+, run `pnpm biome migrate --write` first, then `pnpm check` to catch any new lint violations before committing.
