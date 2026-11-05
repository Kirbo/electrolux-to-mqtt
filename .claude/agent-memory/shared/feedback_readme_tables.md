---
name: feedback-readme-tables
description: "README tables — bare-minimum hard facts per cell, columns aligned in raw markdown (widen a column rather than leave a row sticking out)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: da9b7f78-cc82-493d-a1f1-b87c60ac3f9a
  modified: 2026-11-05T11:03:43.579Z
---

README tables (e.g. the env var table): each cell states only the hard facts/options — no prose like "Set only to override…" or "Opt out with `false`", no parenthetical lists that aren't needed. Keep all necessary info, but as concise as possible. Columns must line up in the raw markdown: pad every cell to the column width; if a needed value is longer, widen that whole column rather than leave one row unaligned. Markdown cells can't wrap across source lines (`<br>` only breaks the rendered output), so shorten text first.

**Why:** the user asked for it explicitly (2026-11-05) after a new row and several older verbose rows broke the raw alignment.

**How to apply:** when adding/editing any README table row, re-pad the whole table (script it: split on ` | `, ljust to max width) and check every row has the same character length.
