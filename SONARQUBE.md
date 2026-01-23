# SonarQube Cloud Setup

This document explains the SonarQube Cloud configuration for this project.

## Overview

This project uses SonarQube Cloud for continuous code quality and security analysis. The integration includes:

- **Code quality analysis** - Detects bugs, code smells, and vulnerabilities
- **Test coverage tracking** - Monitors unit test coverage with Vitest
- **Security scanning** - Identifies security hotspots and vulnerabilities
- **Architecture analysis** - Tracks dependencies and code structure

## Configuration Files

### 1. `sonar-project.properties`

Main SonarQube configuration file that defines:

- **Project identification**: `sonar.projectKey`, `sonar.organization`, `sonar.projectName`
- **Source paths**: `sonar.sources=src`, `sonar.tests=tests`
- **Coverage reports**: Points to `coverage/lcov.info` for test coverage data
- **Exclusions**: Excludes node_modules, dist, coverage directories, and config files
- **Coverage exclusions**: Excludes test files themselves from coverage calculation

### 2. `vitest.config.ts`

Vitest test runner configuration that generates coverage reports:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html', 'lcov', 'cobertura'],
  // ...
}
```

**Important**: The `lcov` format is required for SonarQube integration.

### 3. `.gitlab-ci.yml`

GitLab CI/CD pipeline that:

1. **`test` job**: Runs tests with coverage and generates artifacts
2. **`sonarcloud-check` job**: Uploads coverage and source code to SonarQube Cloud

## Local Development

### Running Tests with Coverage

```bash
# Run all tests with coverage
pnpm test

# Watch mode (no coverage)
pnpm test:watch

# E2E tests
pnpm test:e2e
```

### Running SonarQube Locally

```bash
# Run tests and then SonarQube scan
pnpm sonar
```

This will:
1. Execute all tests with coverage
2. Generate coverage reports in `coverage/` directory
3. Upload results to SonarQube Cloud

**Prerequisites**:
- Install `sonar-scanner-cli` (available via Homebrew on macOS)
- Configure `SONAR_TOKEN` environment variable with your SonarQube Cloud token

## CI/CD Pipeline

### Test Job

The `test` job in GitLab CI:
- Runs on every commit/MR
- Executes all unit tests
- Generates coverage reports (both Cobertura and LCOV formats)
- Stores coverage artifacts for 1 week
- Reports coverage percentage to GitLab

### SonarCloud Check Job

The `sonarcloud-check` job:
- Depends on `test` job artifacts (gets coverage data)
- Runs `sonar-scanner` to upload code and coverage
- Uses cached `.sonar/cache` for faster subsequent runs
- Only runs when relevant files change

## Coverage Reports

After running tests, coverage reports are available in multiple formats:

- **HTML Report**: `coverage/index.html` - Interactive browser view
- **LCOV**: `coverage/lcov.info` - Used by SonarQube
- **Cobertura**: `coverage/cobertura-coverage.xml` - Used by GitLab
- **JSON**: `coverage/coverage-final.json` - Programmatic access

## SonarQube Cloud Dashboard

View analysis results at:
- **URL**: https://sonarcloud.io/dashboard?id=kirbo_electrolux-to-mqtt
- **Organization**: kirbo
- **Project Key**: kirbo_electrolux-to-mqtt

## Coverage Thresholds

Current thresholds configured in `vitest.config.ts`:

| Metric      | Threshold |
|-------------|-----------|
| Lines       | 35%       |
| Functions   | 50%       |
| Branches    | 35%       |
| Statements  | 35%       |

These thresholds are balanced for mixed legacy and new code:
- **Legacy code** (electrolux.ts, mqtt.ts): Lower coverage expected
- **New code** (appliances/*): Comprehensive coverage (85%+)
- **Overall**: Baseline to prevent regression

## Troubleshooting

### Coverage not showing in SonarQube

1. **Verify coverage files exist locally**:
   ```bash
   pnpm test
   ls -la coverage/
   # Should see: lcov.info, cobertura-coverage.xml
   ```

2. **Check sonar-project.properties paths**:
   - Ensure `sonar.javascript.lcov.reportPaths=coverage/lcov.info` matches actual file location

3. **Verify GitLab CI artifacts**:
   - Check that `test` job shows "coverage/" in artifacts
   - Verify `sonarcloud-check` job has `needs: test` with `artifacts: true`

4. **Review SonarQube scanner logs**:
   - Look for "Loading test coverage" messages
   - Check for "INFO: Sensor JavaScript/TypeScript analysis" output

### Coverage percentage mismatch

- **GitLab Coverage**: Regex-extracted from console output (less accurate)
- **SonarQube Coverage**: Parsed from LCOV file (more accurate)
- Small differences are normal due to different calculation methods

## Best Practices

1. **Run tests before committing**: `pnpm test`
2. **Check coverage locally**: Open `coverage/index.html` in browser
3. **Address SonarQube issues**: Review code quality issues in the dashboard
4. **Update coverage thresholds**: As code matures, increase thresholds in `vitest.config.ts`

## References

- [SonarQube Cloud Documentation](https://docs.sonarqube.org/latest/)
- [JavaScript/TypeScript Analysis](https://docs.sonarqube.org/latest/analysis/languages/javascript/)
- [Test Coverage](https://docs.sonarqube.org/latest/analysis/test-coverage/javascript-typescript-test-coverage/)
- [Vitest Coverage](https://vitest.dev/guide/coverage.html)
