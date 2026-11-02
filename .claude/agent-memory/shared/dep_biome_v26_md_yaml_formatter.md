---
name: dep_biome_v26_md_yaml_formatter
description: "Biome 2.6 formats Markdown + YAML by default; its MD formatter corrupted prose, so both formatters are disabled in biome.jsonc (linters on)"
metadata:
  node_type: memory
  type: project
  originSessionId: be568634-8a48-484d-9af1-6fb870a6c20b
  modified: 2026-11-02T10:08:55.208Z
---

Biome 2.6 (applied 2026-11-02, 2.5.15 → 2.6.4) formats `*.md` and `*.yml`/`*.yaml` out of the box. `biome.jsonc` `files.includes` is `**`, so the first `pnpm check` after the bump rewrote 12 files (README tables, docs, compose examples, `.gitlab/ci/02_test.yml`, `telemetry-backend/pnpm-workspace.yaml` → double quotes).

The Markdown formatter (2.6.4) **corrupted** `telemetry-backend/README.md`: a code span wrapped onto a line starting `  + User-Agent` was re-parsed as a list item, and it dropped the space before inline code (`` `session_id`is ``, `` from`sha256( ``). The source was ambiguous CommonMark (a `+ ` line can interrupt a paragraph), but the space loss is a formatter bug.

**Decision:** `markdown.formatter.enabled: false` and `yaml.formatter.enabled: false` in `biome.jsonc` (comment there); the MD/YAML linters stay on (zero findings). New 2.6 rule `noIdenticalTestTitle` also fired once (duplicate `describe('disconnect')` in `tests/mqtt.test.ts`, removed).

**How to apply:** on a later Biome bump, try re-enabling: flip both to `true`, run `pnpm check`, and grep the diff for lost spaces around backticks (`git diff --word-diff=porcelain -- '*.md'`) before accepting. If adopting, reflow that README paragraph so no line starts with `+ `, and commit the reformat as its own `style:` commit. Related: [[dep_biome_v25_migration]].
