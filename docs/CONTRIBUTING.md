# Contributing to Electrolux to MQTT

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Adding a New Appliance](#adding-a-new-appliance)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [AI-Assisted Development](#ai-assisted-development)
- [Submitting Changes](#submitting-changes)

## Code of Conduct

Please be respectful and considerate in all interactions. We're here to build great software together.

## Getting Started

1. **Fork the repository** on GitLab/GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://gitlab.com/YOUR_USERNAME/electrolux-to-mqtt.git
   cd electrolux-to-mqtt
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://gitlab.com/kirbodev/electrolux-to-mqtt.git
   ```

## Development Setup

### Version sources

Every toolchain version has exactly one source, and everything (mise, CI, git hooks, Dockerfiles/compose via build-args, deploy jobs) reads it from there:

| What | Source of truth | Read via |
|---|---|---|
| Node.js major | root `package.json` `engines.node` | `scripts/node-major.sh` |
| Alpine (base of every Node image) | root `package.json` `alpineVersion` | `scripts/alpine-version.sh` |
| pnpm | root `package.json` `packageManager` | mise (aqua backend) + Corepack in images/CI |
| sops, age, git-cliff | `mise.toml` `[tools]` | mise locally; CI via `mise install` (sops) or `scripts/tool-version.sh` (git-cliff image tag) |
| mise itself (minimum) | `mise.toml` `min_version` | mise (fails loudly when older) |

After editing `engines.node` run `pnpm sync:versions`. It derives the `telemetry-backend` engines and the `@types/node` range in both packages, which must track the Node major rather than the newest release line, and re-resolves both lockfiles when the range moves. `@types/node` is listed under `updateConfig.ignoreDependencies` in both `pnpm-workspace.yaml` files so `pnpm update --latest` cannot drag it ahead of the runtime. CI job `versions in sync` fails on any drift. `package.json` is a release-gated path, so bumping Node, Alpine or pnpm cuts a release.

### Toolchain setup (one-time, every machine)

These steps make every environment resolve the same Node, pnpm, and image versions. Skipping any of them is the usual cause of "works on my machine".

1. **Install mise, at least the `min_version` in `mise.toml`.** Follow https://mise.jdx.dev/getting-started.html, then check with `mise --version`. An older mise refuses to load the project config with `mise version X is required`. Upgrade it the way you installed it (`brew upgrade mise`, `mise self-update`, …).
2. **Activate mise in your shell.** This is required, not optional: `mise.toml` `[env]` exports `NODE_VERSION` and `ALPINE_VERSION`, which `pnpm dev:docker`, `pnpm backend:docker` and every `docker compose` build need. Shims alone do **not** export them (only an activated shell does), so compose fails with `NODE_VERSION is not set`.
   ```bash
   echo 'eval "$(mise activate zsh)"' >> ~/.zshrc     # zsh
   echo 'eval "$(mise activate bash)"' >> ~/.bashrc   # bash
   echo 'mise activate fish | source' >> ~/.config/fish/config.fish  # fish
   ```
   Then open a new shell. For non-interactive contexts (IDE tasks, scripts) prefix commands with `mise exec --`, e.g. `mise exec -- pnpm dev:docker`.
3. **Trust the project config.** `mise.toml` runs `exec()` templates that read `package.json`, so mise ignores it until trusted:
   ```bash
   cd electrolux-to-mqtt
   mise trust
   ```
4. **Install the toolchain**, and re-run it after pulling a commit that bumps Node, pnpm, sops or age:
   ```bash
   mise install
   ```
5. **Do not run `corepack enable` locally.** mise already installs the exact pnpm from `packageManager`. A Corepack shim adds a second `pnpm` on `PATH` whose precedence depends on your shell setup, and Node 25+ no longer bundles Corepack anyway. If you enabled it before, run `corepack disable` (add `--install-directory <dir>` if you enabled it into a custom directory such as `~/.local/bin`). (The Docker images and CI do use Corepack. That is expected, because mise is not installed there.)
6. **Optional: set `GITHUB_TOKEN`.** mise downloads pnpm (aqua backend) from GitHub releases, and unauthenticated downloads are rate-limited to 60 per hour per IP, which shared networks can hit. Exporting any read-only `GITHUB_TOKEN` avoids it.
7. **Verify:**
   ```bash
   mise doctor                              # "No problems found", activated: yes
   node --version                           # major == package.json engines.node
   pnpm --version                           # == package.json packageManager
   echo "$NODE_VERSION $ALPINE_VERSION"     # both set, e.g. "24 3.24"
   ```

**Without mise** (not recommended): install the Node major from `engines.node`, run `corepack enable && corepack install` for pnpm, and export the build-args yourself before any compose command:
```bash
export NODE_VERSION=$(sh scripts/node-major.sh) ALPINE_VERSION=$(sh scripts/alpine-version.sh)
```

Other prerequisites: **Git**, plus **Docker** for `pnpm dev:docker` / `pnpm docker:test`. Optionally install `osv-scanner` (`brew install osv-scanner`) for `pnpm osv-scan`, which otherwise falls back to Docker.

### Installation

```bash
# Toolchain setup (above) done first, then:
pnpm install

# Create your config file
cp config.example.yml config.yml
# Edit config.yml with your credentials
```

### Running Locally

```bash
# Development mode with auto-reload, using locally installed node and pnpm
pnpm dev

# Development mode with auto-reload, using docker sandbox
pnpm dev:docker
```

## Project Structure

```
src/
├── appliances/           # Appliance-specific implementations
│   ├── base.ts          # Abstract base class for all appliances
│   ├── comfort600.ts    # Comfort 600 model implementation
│   ├── factory.ts       # Factory pattern for creating appliances
│   └── normalizers.ts   # State normalization utilities
├── types/               # TypeScript type definitions
│   ├── homeassistant.ts # Home Assistant MQTT types
│   └── normalized.ts    # Normalized state types
├── cache.ts             # LRU caching for state comparison
├── config.ts            # Configuration management
├── electrolux.ts        # Electrolux API client
├── health.ts            # Health check file writer
├── index.ts             # Main application entry point
├── logger.ts            # Logging utilities
├── mqtt.ts              # MQTT client wrapper
├── orchestrator.ts      # Application lifecycle orchestration
├── types.d.ts           # Electrolux API type definitions
└── version-checker.ts   # Update checker and telemetry

tests/                   # Test files (mirrors src/ structure)

telemetry-backend/       # Aptabase-backed HTTP service — serves SVG badges (in-memory) + forwards legacy /telemetry POSTs; delete the ingest half once source='legacy' traffic drops to ~0
```

## Adding a New Appliance

1. **Create the appliance class** in `src/appliances/` — extend `BaseAppliance` and implement all required methods. Use `src/appliances/comfort600.ts` as a reference implementation.
2. **Register in the factory** — add your model to `src/appliances/factory.ts`.
3. **Add tests** — create `tests/appliances/your-model.test.ts`. See `tests/appliances/comfort600.test.ts` for the expected test structure.
4. **Update README.md** — add the new appliance to the supported appliances list.
5. **Run verification** — `pnpm check && pnpm typecheck && pnpm test`

## Running Tests

```bash
# Run all tests once
pnpm test

# Run tests in watch mode (re-runs on file changes)
pnpm test:watch

# Run specific test file
pnpm test tests/cache.test.ts
```

## Running E2E Tests

> **E2E tests are skipped by default.** Running `pnpm test` does NOT run them. They only run when `E2E_TEST=true` is set, which `pnpm test:e2e` does for you. They also require a real `config.yml` with valid Electrolux API credentials.

```bash
# Run E2E tests — fetches live data from the Electrolux API and verifies the
# response shape against typed fixtures. Requires config.yml with credentials.
pnpm test:e2e
```

E2E snapshots live under `tests/e2e/snapshots/` and are deliberately gitignored — they encode device serials and per-account identifiers we don't want in version control. After API contract changes, regenerate snapshots locally with `pnpm test:e2e` and review the resulting diff before merging the type changes.

### Controlling Test Output with LOG_LEVEL

By default, tests run with **no output from the application** for clean, focused results. You can control the verbosity using the `LOG_LEVEL` environment variable:

```bash
# Default: Clean output, suppress all logs
pnpm test

# Show all debug logs (useful for debugging test failures)
LOG_LEVEL=debug pnpm test

# Show info-level logs and above (warnings, errors)
LOG_LEVEL=info pnpm test

# Show warnings and errors only
LOG_LEVEL=warn pnpm test

# Show errors only
LOG_LEVEL=error pnpm test
```

**Quick Reference:**

| LOG_LEVEL   | Shows                   | Best For                                  |
|-------------|-------------------------|-------------------------------------------|
| *(not set)* | None                    | Default - fastest feedback, clean output  |
| `debug`     | All logs, debug info    | Troubleshooting test failures             |
| `info`      | Info, warnings, errors  | Standard debugging                        |
| `warn`      | Warnings, errors only   | Production-like testing                   |
| `error`     | Errors only             | Minimal output, catch failures            |

### Writing Tests

- Use **Vitest** for testing
- Place tests in `tests/` directory mirroring `src/` structure
- Name test files with `.test.ts` extension
- Aim to maintain the project's coverage thresholds (96% lines/statements/functions, 90% branches)
- Test both success and error cases

### Coverage Requirements

The project maintains test coverage with the following requirements:

**Minimum Coverage Thresholds:**
- **Lines**: 96%
- **Statements**: 96%
- **Branches**: 90%
- **Functions**: 96%

Up-to-date thresholds can be found [here](../vitest.config.ts#L33)

**New Code Coverage:**
- New code should maintain or improve the existing thresholds
- The `src/appliances/` directory has excellent coverage as a reference

**Coverage Regression Protection:**
- The GitLab CI pipeline enforces these thresholds
- Coverage reports are generated and tracked in merge requests
- Regressions will block merge requests from being merged
- Coverage reports are available in: `coverage/index.html`

**Checking Coverage Locally:**
```bash
# Generate HTML coverage report
pnpm test

# View the report in your browser
open coverage/index.html  # macOS
# or
xdg-open coverage/index.html  # Linux
# or
start coverage/index.html  # Windows
```

Example test structure:

```typescript
import { describe, expect, it } from 'vitest'

describe('MyFeature', () => {
  describe('myFunction', () => {
    it('should handle valid input', () => {
      const result = myFunction('valid')
      expect(result).toBe('expected')
    })

    it('should handle edge cases', () => {
      expect(myFunction('')).toBe('default')
      expect(myFunction(null)).toBeNull()
    })

    it('should throw on invalid input', () => {
      expect(() => myFunction('invalid')).toThrow('Error message')
    })
  })
})
```

## Code Style

### Formatting & Linting

We use **Biome** for code formatting and linting:

```bash
# Format code
pnpm format

# Lint code
pnpm lint

# Check and auto-fix
pnpm check
```

### TypeScript Guidelines

- **Use strict typing** - Avoid `any` types
- **Document complex functions** with JSDoc comments
- **Export types** when they're used across modules
- **Use type imports**: `import type { Type } from './module'`

### Naming Conventions

- **Files**: `kebab-case.ts`
- **Classes**: `PascalCase`
- **Functions/Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE` or `camelCase` depending on context
- **Interfaces**: `PascalCase` (prefer `type` over `interface`)

### Code Organization

- **One class per file** (except small related types)
- **Group imports**: Built-in → External → Internal
- **Export at bottom** of file (except for classes)
- **Keep functions short** (<50 lines ideally)
- **Extract complex logic** into helper functions

## Commit Messages

We follow **Conventional Commits** format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```bash
feat(appliances): add support for Comfort 800 model

Implemented YourModelAppliance class with full MQTT integration
- Added state normalization
- Added command transformation
- Added Home Assistant auto-discovery config

Closes #123
```

```bash
fix(mqtt): handle malformed JSON in command messages

Added try-catch around JSON.parse to prevent crashes
when receiving invalid MQTT messages
```

```bash
docs(readme): update installation instructions

Added instructions for Docker Compose setup
```

## AI-Assisted Development

This project supports AI-assisted development with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). See [AI_DEVELOPMENT.md](AI_DEVELOPMENT.md) for details on available skills (`/audit`, `/maintain`), the always-loaded `CLAUDE.md` rules file, and how the configuration works.

## Submitting Changes

### Before Submitting

1. **Run linter**: `pnpm check`
2. **Typecheck**: `pnpm typecheck`
3. **Run tests**: `pnpm test`
4. **Test locally**: `pnpm dev` (verify your changes work)

### Pull/Merge Request Process

1. **Create a feature branch**:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes** and commit:
   ```bash
   git add .
   git commit -m "feat: your feature description"
   ```

3. **Push to your fork**:
   ```bash
   git push origin feat/your-feature-name
   ```

4. **Open a Merge Request** on GitLab (or Pull Request on GitHub mirror)

5. **Fill out the MR template** (auto-loaded from `.gitlab/merge_request_templates/Default.md`):
   - Describe what changes you made
   - Link related issues
   - Add screenshots if applicable
   - Mention any breaking changes

### Review Process

- Maintainers will review your MR
- Address any feedback or requested changes
- Once approved, your changes will be merged

## Questions?

- **Issues**: [Open an issue](https://gitlab.com/kirbodev/electrolux-to-mqtt/-/issues)
- **Discussions**: Use GitLab discussions for questions
- **Documentation**: Check the [README](../README.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing!
