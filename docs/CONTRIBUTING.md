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

Every toolchain and base-image version lives in **one file, `versions.env`** at the repo root, and everything reads it from there:

| Consumer | How it reads `versions.env` |
|---|---|
| mise (local toolchain) | `[env] _.file = "versions.env"`; `[tools]` use `{{ env.NODE_MAJOR }}` etc. |
| Dockerfiles + compose | build-args with the **same names** (`NODE_MAJOR`, `ALPINE_VERSION`, `COREPACK_VERSION`) — no defaults, fail loudly when unset; an activated mise shell exports them |
| GitLab CI | job `initialise variables` turns its lines into dotenv variables for every later job |
| Scripts, git hooks, deploy jobs | `set -a; . ./versions.env; set +a` (or a `sed` lookup) |

Keys: `NODE_MAJOR`, `ALPINE_VERSION`, `COREPACK_VERSION`, `PNPM_VERSION` (these change the shipped images), `FNOX_VERSION`, `AGE_VERSION` (+ their sha256 pins for CI), `GIT_CLIFF_VERSION`, `RENOVATE_VERSION` (dev/CI tooling only). Each line carries a `# renovate:` annotation on the line above it so Renovate can track it. The minimum mise is `min_version` in `mise.toml`.

After editing `versions.env`, run `pnpm sync:versions`. It writes the derived copies into `package.json` — `engines.node` and `@types/node` in both packages, `packageManager` (with Corepack's integrity hash), `alpineVersion`, `corepackVersion` — and re-resolves the lockfiles when the `@types/node` range moves. Never edit those fields by hand; CI job `versions in sync` fails on any drift. They exist because `package.json` is the release-gated path: bumping Node, Alpine, Corepack or pnpm changes `package.json` and so cuts a release, while a dev-tool bump (fnox, age, git-cliff) does not. `@types/node` is listed under `updateConfig.ignoreDependencies` in both `pnpm-workspace.yaml` files so `pnpm update --latest` cannot drag it ahead of the runtime.

### Dependency updates

Renovate opens weekly merge requests against `next` (`renovate.json`): one grouped MR for npm minor/patch updates, one per npm major, and one per `versions.env` entry. Releases younger than 14 days are held back (security fixes skip the wait). It runs as the CI job `renovate` from a pipeline schedule — there is no hosted bot. Some MRs need a manual step that Renovate cannot do; the MR description says which:

- **pnpm, Corepack, Node, Alpine** feed derived `package.json` fields: check out the branch, run `pnpm sync:versions`, commit and push (CI job `versions in sync` fails until then).
- **fnox, age** carry sha256 pins: copy the new release assets' digests into the `*_SHA256_LINUX_*` lines (CI fails `install-fnox: sha256 mismatch` until then).

`/maintain` (see [AI-Assisted Development](#ai-assisted-development)) covers what Renovate does not: vulnerability triage, overrides, breakage fixes.

One-time setup (maintainer):

1. Create a GitLab project access token (role Developer, scopes `api` + `write_repository`) and a read-only GitHub fine-grained token (public repositories); then `pnpm secrets:set renovate RENOVATE_TOKEN` and `pnpm secrets:set renovate GITHUB_COM_TOKEN` (value on stdin).
2. `pnpm secrets:rotate-ci renovate` — generates the `ci-renovate` identity, re-encrypts to it, stores it in GitLab (environment `ci/renovate`, protected). Commit `fnox.toml`.
3. CI/CD → Pipeline schedules: weekly on `main`, variable `SCHEDULE=RENOVATE`.

### CI runners and BuildKit

The pipeline runs on the maintainer's Mac Mini GitLab runners (Linux containers, aarch64).

- **Runner routing.** Every job takes `tags: [$MAC_DOCKER]`, through `default:`. `MAC_DOCKER` is `macos` (the shared runner) unless `workflow:` sets `macos-protected` for the `main` and `next` pipelines. That is "Kirbo Mini Protected": ref-protected, with its own cache, and it runs protected-ref jobs only. No job names either tag literally.
- **No Docker engine in jobs.** There is no Docker socket, no `DOCKER_HOST`, no `docker-container` builder and no Docker-in-Docker. `.docker_build_base` (`.gitlab-ci.yml`) creates a buildx `remote` builder against a BuildKit server on the Mac, over mutual TLS. Protected refs (`$CI_COMMIT_REF_PROTECTED == "true"`) use `tcp://host.docker.internal:12340` with the protected File variables `BUILDKIT_PROTECTED_CA` / `_CERT` / `_KEY`. Every other ref uses `:12341` with `BUILDKIT_CA` / `_CERT` / `_KEY`. The two servers have separate CAs and caches, so a branch build never feeds a release build. `docker login` and `docker buildx imagetools` need no daemon. A job that must *run* an image does it inside BuildKit, like `docker build test` below, or as a GitLab `services:` entry. It never uses `docker run`, `--load` or `docker pull`.
- **`docker build test` / `pnpm docker:test`** (`scripts/docker-build-test.sh`) bakes `docker/build-test/docker-bake.hcl`. Each `smoke-<image>` target builds the image as a linked `target:` context, then runs `docker/build-test/smoke.Dockerfile` on top of it. That Dockerfile has one `RUN --network=none` step: `smoke.mjs` runs each check (the default CMD, the legacy `node dist/index.js` entry, the legacy HEALTHCHECK commands), and the script asserts on the exported output. This works with any buildx builder: Docker Desktop's default one locally, the remote server in CI.
- **Smoke-step cache rule.** BuildKit replays cached `RUN` steps, so a test step could "pass" on an old result. Every `RUN` whose result IS the test takes a per-run cache-bust build arg (`SMOKE_RUN_ID`), sits in a stage listed in the bake target's `no-cache-filter`, and writes the per-run value into its result. The script rejects any result without this run's id.
- **Pinned CI images.** A job image not derived from `versions.env` is pinned as `name:tag@sha256:<digest>`: `docker:*-cli`, `alpine` and `sonarsource/sonar-scanner-cli`. Pick a release at least 7 days old and take the digest from `docker buildx imagetools inspect <name:tag>`. Every `alpine` job carries the same pin, so bump them together. The tools that secret-holding jobs add (`curl`, `jq`, `openssh-client`) come from `apk add` on the pinned Alpine; apk verifies those packages' signatures. `/maintain` covers the bumps.
- **Certificates.** The BuildKit client certificates expire **2029-02-08**. They live in 1Password ("Kirbo Mini BuildKit protected mTLS" / "Kirbo Mini BuildKit branch mTLS"). To rotate, issue a new pair from the CA kept in the item (the Mac Mini's BuildKit runbook has the commands), restart that BuildKit server, then replace the project's six `BUILDKIT_*` File variables.
- **Local-only `docker run`.** Two helpers fall back to `docker run` when their tool is missing: `scripts/osv-scan.sh` (CI's `audit` jobs install the `osv-scanner` binary, so they never reach it) and `scripts/mr-description.sh` (never run in CI). Both are maintainer conveniences.

### Secrets (maintainers only)

Release, deploy and SonarCloud secrets live in `fnox.toml` as age ciphertext, readable only by the maintainer key and the CI tier that needs each one. Contributors need no key: tests, lint and image builds run without one. Setup, commands and the CI design are in [`docs/SECRETS.md`](SECRETS.md).

### Toolchain setup (one-time, every machine)

These steps make every environment resolve the same Node, pnpm, and image versions. Skipping any of them is the usual cause of "works on my machine".

1. **Install mise, at least the `min_version` in `mise.toml`.** Follow https://mise.jdx.dev/getting-started.html, then check with `mise --version`. An older mise refuses to load the project config with `mise version X is required`. Upgrade it the way you installed it (`brew upgrade mise`, `mise self-update`, …).
2. **Activate mise in your shell.** This is required, not optional: `mise.toml` `[env]` loads `versions.env`, exporting `NODE_MAJOR`, `ALPINE_VERSION` and `COREPACK_VERSION`, which `pnpm dev:docker`, `pnpm backend:docker` and every `docker compose` build need. Shims alone do **not** export them (only an activated shell does), so compose fails with `NODE_MAJOR is not set`.
   ```bash
   echo 'eval "$(mise activate zsh)"' >> ~/.zshrc     # zsh
   echo 'eval "$(mise activate bash)"' >> ~/.bashrc   # bash
   echo 'mise activate fish | source' >> ~/.config/fish/config.fish  # fish
   ```
   Then open a new shell. For non-interactive contexts (IDE tasks, scripts) prefix commands with `mise exec --`, e.g. `mise exec -- pnpm dev:docker`.
3. **Trust the project config.** `mise.toml` loads `versions.env` and templates its tools from it, so mise ignores it until trusted:
   ```bash
   cd electrolux-to-mqtt
   mise trust
   ```
4. **Install the toolchain**, and re-run it after pulling a commit that changes `versions.env`:
   ```bash
   mise install
   ```
5. **Do not run `corepack enable` locally.** mise already installs the exact pnpm from `versions.env`. A Corepack shim adds a second `pnpm` on `PATH` whose precedence depends on your shell setup, and Node 25+ no longer bundles Corepack anyway. If you enabled it before, run `corepack disable` (add `--install-directory <dir>` if you enabled it into a custom directory such as `~/.local/bin`). (The Docker images and CI do use Corepack. That is expected, because mise is not installed there; they install `COREPACK_VERSION` from `versions.env` with npm first.)
6. **Optional: set `GITHUB_TOKEN`.** mise downloads pnpm (aqua backend) from GitHub releases, and unauthenticated downloads are rate-limited to 60 per hour per IP, which shared networks can hit. Exporting any read-only `GITHUB_TOKEN` avoids it.
7. **Verify:**
   ```bash
   mise doctor                              # "No problems found", activated: yes
   node --version                           # major == versions.env NODE_MAJOR
   pnpm --version                           # == versions.env PNPM_VERSION
   echo "$NODE_MAJOR $ALPINE_VERSION"       # both set, e.g. "26 3.24"
   ```

**Without mise** (not recommended): install the Node major from `versions.env`, run `npm i -g corepack && corepack enable && corepack install` for pnpm (Node 25+ no longer bundles Corepack), and export the build-args yourself before any compose command:
```bash
set -a; . ./versions.env; set +a
```

Other prerequisites: **Git**, plus **Docker** for `pnpm dev:docker` / `pnpm docker:test` (`docker:test` needs only a buildx builder — Docker Desktop's default one is fine). Optionally install `osv-scanner` (`brew install osv-scanner`) for `pnpm osv-scan`, which otherwise falls back to Docker.

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
├── backoff.ts           # Exponential backoff with jitter
├── cache.ts             # Last published state (normalized only) + discovery config, for diffing
├── config.ts            # Configuration management
├── electrolux-api.ts    # Electrolux REST API client (typed, validated)
├── electrolux-auth.ts   # Login + token refresh with retries
├── health.ts            # Health check file writer
├── http.ts              # fetch wrapper: timeouts, HttpError
├── index.ts             # Main application entry point
├── logger.ts            # Logging utilities
├── mqtt.ts              # MQTT client wrapper
├── orchestrator.ts      # Application lifecycle orchestration
├── state-sync.ts        # Poll → diff → publish, commands with feedback
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
