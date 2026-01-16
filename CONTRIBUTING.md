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
   git remote add upstream https://gitlab.com/kirbo/electrolux-to-mqtt.git
   ```

## Development Setup

### Prerequisites

- **Node.js**: Version specified in `.nvmrc` (use `fnm use` or `nvm use`)
- **pnpm**: Correct version is specified in `package.json` `packageManager` field
- **Git**: For version control

### Installation

```bash
# Use correct Node.js version
fnm use  # or: nvm use

# Install pnpm if needed
npm install -g $(node -p "require('./package.json').packageManager")

# Install dependencies
pnpm install

# Create your config file
cp config.example.yml config.yml
# Edit config.yml with your credentials
```

### Running Locally

```bash
# Development mode with auto-reload
pnpm dev

# Production mode
pnpm start

# Docker development
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
├── index.ts             # Main application entry point
├── logger.ts            # Logging utilities
└── mqtt.ts              # MQTT client wrapper

tests/                   # Test files (mirrors src/ structure)
```

## Adding a New Appliance

### Step 1: Create Appliance Class

Create a new file in `src/appliances/` (e.g., `your-model.ts`):

```typescript
import { BaseAppliance } from './base.js'
import { normalizeClimateAppliance } from './normalizers.js'
import type { HAClimateDiscoveryConfig } from '../types/homeassistant.js'
import type { NormalizedState } from '../types/normalized.js'
import type { Appliance } from '../types.js'

export class YourModelAppliance extends BaseAppliance {
  /**
   * Normalize raw API state to standard format
   */
  public normalizeState(rawState: Appliance): NormalizedState {
    return normalizeClimateAppliance(rawState, this.applianceInfo, {
      // Add model-specific overrides here
      // Example: ambientTemperatureF: rawState.state.reported.tempF
    })
  }

  /**
   * Transform MQTT command to API format
   */
  public transformMqttCommandToApi(command: Partial<NormalizedState>): Record<string, unknown> {
    const apiCommand: Record<string, unknown> = {}

    if (command.mode) {
      apiCommand.mode = command.mode.toUpperCase()
    }
    if (command.targetTemperatureC !== undefined) {
      apiCommand.targetTemperatureC = command.targetTemperatureC
    }
    // Add other command transformations...

    return apiCommand
  }

  /**
   * Derive immediate state updates from commands
   * This updates local state without waiting for API
   */
  public deriveImmediateStateFromCommand(payload: Record<string, unknown>): Partial<NormalizedState> | null {
    const updates: Partial<NormalizedState> = {}

    if (payload.mode) {
      updates.mode = String(payload.mode).toLowerCase() as any
      updates.applianceState = payload.mode === 'OFF' ? 'off' : 'on'
    }
    // Add other immediate updates...

    return Object.keys(updates).length > 0 ? updates : null
  }

  /**
   * Generate Home Assistant auto-discovery config
   */
  public generateAutoDiscoveryConfig(topicPrefix: string): HAClimateDiscoveryConfig {
    const info = this.applianceInfo.applianceInfo
    const tempRange = this.getTemperatureRange()
    const prefix = topicPrefix.endsWith('/') ? topicPrefix : `${topicPrefix}/`
    const stateTopic = `${prefix}${this.applianceId}/state`
    const commandTopic = `${prefix}${this.applianceId}/command`

    return {
      name: '',
      object_id: `${info.brand}_${info.model}_${info.serialNumber}`,
      uniq_id: `${info.brand}_${info.model}_${this.applianceId}`,
      device: {
        identifiers: [this.applianceId],
        manufacturer: info.brand,
        model: info.model,
        name: this.applianceName,
      },
      // Add all required MQTT topics and templates
      // See comfort600.ts for complete example
      modes: this.getSupportedModes(),
      temperature_unit: 'C',
      min_temp: tempRange.min,
      max_temp: tempRange.max,
      // ... etc
    }
  }

  /**
   * Get supported climate modes
   */
  public getSupportedModes() {
    return ['off', 'auto', 'cool', 'heat', 'dry', 'fan_only']
  }

  /**
   * Get supported fan modes
   */
  public getSupportedFanModes() {
    return ['auto', 'high', 'medium', 'low']
  }

  /**
   * Get supported swing modes
   */
  public getSupportedSwingModes() {
    return ['on', 'off']
  }

  /**
   * Get temperature range
   */
  public getTemperatureRange() {
    const capabilities = this.applianceInfo.capabilities
    return {
      min: capabilities.targetTemperatureC?.min ?? 16,
      max: capabilities.targetTemperatureC?.max ?? 30,
      initial: capabilities.targetTemperatureC?.default ?? 22,
    }
  }

  /**
   * Get model identifier
   */
  public getModelName(): string {
    return this.applianceInfo.applianceInfo.model
  }
}
```

### Step 2: Register in Factory

Edit `src/appliances/factory.ts`:

```typescript
import { YourModelAppliance } from './your-model.js'

export class ApplianceFactory {
  static create(stub: ApplianceStub, info: ApplianceInfo): BaseAppliance {
    const { deviceType, model } = info.applianceInfo

    // ... existing code ...

    if (deviceType === 'YOUR_DEVICE_TYPE') {
      if (model === 'YOUR_MODEL') {
        return new YourModelAppliance(stub, info)
      }
      throw new Error(`Unsupported model: ${model}`)
    }

    throw new Error(`Unsupported device type: ${deviceType}`)
  }
}
```

### Step 3: Add Tests

Create `tests/appliances/your-model.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { YourModelAppliance } from '../src/appliances/your-model'

describe('YourModelAppliance', () => {
  // Add tests for all methods
  // See tests/appliances/comfort600.test.ts for examples
})
```

### Step 4: Test Your Changes

```bash
# Run unit tests
pnpm test

# Run with coverage
pnpm test:coverage

# Test in development mode
pnpm dev
```

## Running Tests

```bash
# Run all tests once
pnpm test

# Run tests in watch mode (re-runs on file changes)
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage

# Run specific test file
pnpm test tests/cache.test.ts
```

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

| LOG_LEVEL | Shows | Best For |
|-----------|-------|----------|
| *(not set)* | None | Default - fastest feedback, clean output |
| `debug` | All logs, debug info | Troubleshooting test failures |
| `info` | Info, warnings, errors | Standard debugging |
| `warn` | Warnings, errors only | Production-like testing |
| `error` | Errors only | Minimal output, catch failures |

### Writing Tests

- Use **Vitest** for testing
- Place tests in `tests/` directory mirroring `src/` structure
- Name test files with `.test.ts` extension
- Aim for >70% code coverage for new code
- Test both success and error cases

### Coverage Requirements

The project maintains test coverage with the following requirements:

**Minimum Coverage Thresholds:**
- **Lines**: 35%
- **Statements**: 35%
- **Branches**: 35%
- **Functions**: 50%

**New Code Coverage:**
- New code should have **≥80% coverage** where possible
- The `src/appliances/` directory has excellent coverage (90%+) as a reference

**Coverage Regression Protection:**
- The GitLab CI pipeline enforces these thresholds
- Coverage reports are generated and tracked in merge requests
- Regressions will block merge requests from being merged
- Coverage reports are available in: `coverage/index.html`

**Checking Coverage Locally:**
```bash
# Generate HTML coverage report
pnpm test:coverage

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

## Submitting Changes

### Before Submitting

1. **Run tests**: `pnpm test`
2. **Run linter**: `pnpm check`
3. **Build project**: `pnpm build`
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

5. **Fill out the MR template**:
   - Describe what changes you made
   - Link related issues
   - Add screenshots if applicable
   - Mention any breaking changes

### Review Process

- Maintainers will review your MR
- Address any feedback or requested changes
- Once approved, your changes will be merged

## Questions?

- **Issues**: [Open an issue](https://gitlab.com/kirbo/electrolux-to-mqtt/-/issues)
- **Discussions**: Use GitLab discussions for questions
- **Documentation**: Check the [README](./README.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🎉
