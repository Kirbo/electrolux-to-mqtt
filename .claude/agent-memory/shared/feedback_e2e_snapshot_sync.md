---
name: E2E snapshots are source of truth for API capabilities
description: E2E snapshots organized by model (snapshots/{model}/) are the authoritative source for API behavior — propagate values to types and validate constraints against them
type: feedback
---

E2E snapshots are the single source of truth for API capabilities, constraints, and state structure.

**Why:** The user wants the type system, validation logic, and test mocks to stay in sync with the actual API. New values from the live API are authoritative. On 2026-03-27, snapshots were restructured from flat files to model-specific directories.

**How to apply:**
1. Snapshots live at `tests/e2e/snapshots/{model}/` (e.g., `comfort600/appliance-info.json`). `appliances-list.json` stays at root.
2. After running `pnpm test:e2e`, compare snapshot enum values against:
   - Raw types in `src/types.d.ts`
   - Normalized types in `src/types/normalized.ts`
   - Validation sets in `src/appliances/normalizers.ts`
   - Mode trigger constraints (fan speed access/values, temperature ranges) against `validateCommand()` behavior and test mock data
3. Add missing values without asking — API values are authoritative
4. Test mock capabilities data (in comfort600.test.ts) must match the E2E snapshot structure
