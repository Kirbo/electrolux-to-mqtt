# Electrolux to MQTT / Home Assistant

[![Latest Release](https://gitlab.com/kirbo/electrolux-to-mqtt/-/badges/release.svg?order_by=release_at)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases)
[![GitLab Last Commit](https://img.shields.io/gitlab/last-commit/Kirbo%2Felectrolux-to-mqtt)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/commits)
[![CI/CD Pipeline Status](https://gitlab.com/kirbo/electrolux-to-mqtt/badges/main/pipeline.svg)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/pipelines)
[![GitLab Issues](https://img.shields.io/gitlab/issues/open/Kirbo%2Felectrolux-to-mqtt?labels=Bug)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/issues?label_name%5B%5D=Bug)
[![GitLab Merge Requests](https://img.shields.io/gitlab/merge-requests/open/Kirbo%2Felectrolux-to-mqtt)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/merge_requests)
[![Docker Pulls](https://badgen.net/docker/pulls/kirbownz/electrolux-to-mqtt)](https://hub.docker.com/r/kirbownz/electrolux-to-mqtt/)
[![Active Users](https://e2m.devaus.eu/users.svg)](https://e2m.devaus.eu/telemetry)


[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=kirbo_electrolux-to-mqtt&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=kirbo_electrolux-to-mqtt)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=kirbo_electrolux-to-mqtt&metric=bugs)](https://sonarcloud.io/summary/new_code?id=kirbo_electrolux-to-mqtt)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=kirbo_electrolux-to-mqtt&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=kirbo_electrolux-to-mqtt)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=kirbo_electrolux-to-mqtt&metric=coverage)](https://sonarcloud.io/summary/new_code?id=kirbo_electrolux-to-mqtt)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=kirbo_electrolux-to-mqtt&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=kirbo_electrolux-to-mqtt)

A robust TypeScript bridge for controlling Electrolux appliances via MQTT and Home Assistant. Features automatic discovery, dynamic appliance management, and a modular architecture for easy extensibility.

## Features

- **Automatic Home Assistant Discovery** - Zero-configuration MQTT Climate integration
- **Dynamic Appliance Detection** - Automatically detects added/removed appliances
- **Modular Architecture** - Easy to extend with new appliance models
- **Secure Token Management** - Automatic OAuth token refresh
- **Production Ready** - Comprehensive error handling and graceful shutdown
- **Well Tested** - Unit tests with >95% coverage
- **Docker Ready** - Multi-platform Docker images (amd64/arm64)
- **Update Notifications** - Periodically check for newer releases and optionally push-notify you via https://ntfy.sh/ webhook.
- **Anonymous Telemetry** - Sends an [irreversible HMAC-SHA-256 hash](./src/index.ts#L16) of your username (salted with partial config values unique to your installation) and the app version to `e2m.devaus.eu` during version checks, used to generate the "Active Users" badge above. No personal data is collected or stored. This is a personal project maintained in my free time, and knowing the active user count helps me gauge how much effort to invest in it.

Relevant links:
- [Source codes](https://gitlab.com/kirbo/electrolux-to-mqtt) are in GitLab
- [Issues](https://gitlab.com/kirbo/electrolux-to-mqtt/-/issues) are in GitLab
- [Pull/Merge Requests](https://gitlab.com/kirbo/electrolux-to-mqtt/-/merge_requests) are in GitLab
- [Releases](https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases) containing the Release Notes are in GitLab
- [CI/CD Pipeline](https://gitlab.com/kirbo/electrolux-to-mqtt/-/pipelines) is in GitLab
- [Dockerhub](https://hub.docker.com/r/kirbownz/electrolux-to-mqtt)
- [GitHub mirror](https://github.com/Kirbo/electrolux-to-mqtt)
- [SonarQube Cloud](https://sonarcloud.io/project/overview?id=kirbo_electrolux-to-mqtt)


## Supported Appliances

| Model | Type | Notes |
|-------|------|-------|
| **Electrolux Comfort 600** | Portable Air Conditioner | Full support: climate modes, fan speed, swing, sleep mode, temperature control |

Unknown models that report as a portable air conditioner will use the Comfort 600 implementation as a fallback. If you have a different Electrolux appliance and would like support added, please [open an issue](https://gitlab.com/kirbo/electrolux-to-mqtt/-/issues).

## Prerequisites

1. Sign up/sign in into [Electrolux for Developer](https://developer.electrolux.one/dashboard)
2. Create a new API Key and copy the value
3. Start the container by following one of the instructions [listed below](#but-how-to-start)

## Configuration options

All configuration can be provided via environment variables or via `config.yml` file. If a `config.yml` file is present, it will be used and environment variables will be ignored.

Example [config.yml](./config.example.yml) file is included in the repository and can be used as a template.

<details>
  <summary>All environment variables</summary>

| Variable                                   | Description                                            | Default                | Required |
| ------------------------------------------ | ------------------------------------------------------ | ---------------------- | -------- |
| `MQTT_URL`                                 | MQTT broker URL (`mqtt://` or `mqtts://`)              | —                      | Yes      |
| `MQTT_USERNAME`                            | MQTT broker username                                   | —                      | Yes      |
| `MQTT_PASSWORD`                            | MQTT broker password                                   | —                      | Yes      |
| `ELECTROLUX_API_KEY`                       | Electrolux API key                                     | —                      | Yes      |
| `ELECTROLUX_USERNAME`                      | Electrolux account email                               | —                      | Yes      |
| `ELECTROLUX_PASSWORD`                      | Electrolux account password                            | —                      | Yes      |
| `ELECTROLUX_COUNTRY_CODE`                  | Two-letter country code                                | —                      | Yes      |
| `MQTT_TOPIC_PREFIX`                        | MQTT topic prefix                                      | `electrolux_`          | No       |
| `MQTT_CLIENT_ID`                           | MQTT client identifier                                 | `electrolux-comfort600`| No       |
| `MQTT_RETAIN`                              | Retain MQTT messages                                   | `false`                | No       |
| `MQTT_QOS`                                 | MQTT QoS level (0, 1, or 2)                            | `2`                    | No       |
| `ELECTROLUX_REFRESH_INTERVAL`              | State polling interval in seconds (10–3600)            | `30`                   | No       |
| `ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL`  | Appliance discovery interval in seconds (60–3600)      | `300`                  | No       |
| `ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY`     | Minutes before token expiry to refresh (5–715)         | `60`                   | No       |
| `ELECTROLUX_COMMAND_STATE_DELAY_SECONDS`   | Seconds to wait after a command before re-polling state (5–300) | `30`          | No       |
| `HOME_ASSISTANT_AUTO_DISCOVERY`            | Enable HA MQTT auto-discovery                          | `true`                 | No       |
| `HOME_ASSISTANT_REVERT_STATE_ON_REJECTION` | Immediately revert HA state on rejected commands       | `false`                | No       |
| `LOG_LEVEL`                                | Log level (fatal/error/warn/info/debug/trace/silent)   | `info`                 | No       |
| `LOGGING_SHOW_CHANGES`                     | Log state changes                                      | `true`                 | No       |
| `LOGGING_IGNORED_KEYS`                     | Comma-separated keys to ignore in change logs          | —                      | No       |
| `LOGGING_SHOW_VERSION_NUMBER`              | Show version in log prefix                             | `true`                 | No       |
| `LOGGING_SKIP_CACHE_LOGGING`               | Suppress cache debug logs                              | `true`                 | No       |
| `LOGGING_SHOW_TIMESTAMP`                   | Show timestamps in logs                                | `true`                 | No       |
| `VERSION_CHECK_INTERVAL`                   | Update check interval in seconds (60–86400)            | `3600`                 | No       |
| `VERSION_CHECK_NTFY_WEBHOOK_URL`           | ntfy.sh webhook URL for update notifications           | —                      | No       |
| `VERSION_CHECK_UPDATE_CHANNEL`             | `stable` skips rc releases; `beta` includes them       | `stable`               | No       |
| `HEALTH_CHECK_ENABLED`                     | Enable file-based health check for Docker HEALTHCHECK  | `true`                 | No       |
| `HEALTH_CHECK_FILE_PATH`                   | Path to health check file                              | `/tmp/e2m-health`      | No       |
| `HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES`   | Minutes of API failure before container self-restarts  | `45`                   | No       |
| `E2M_TELEMETRY_ENABLED`                    | Send anonymous usage statistics (opt out with `false`) | `true`                 | No       |
</details>

## But how to start?!

Choose one of the following methods and open the details.

### Using `docker` with `config.yml`

<details>
  <summary>I choose you!</summary>

1. Copy [`config.example.yml`](./config.example.yml) as `config.yml`:
    ```
    cp config.example.yml config.yml
    ```
2. Modify the `config.yml` accordingly and save changes:
    ```
    code config.yml
    ```
3. Run:
    ```bash
    docker pull kirbownz/electrolux-to-mqtt:latest
    docker run --rm -v ./config.yml:/app/config.yml --name electrolux-to-mqtt kirbownz/electrolux-to-mqtt:latest
    ```
</details>

### Using `docker` with environmental variables

<details>
  <summary>I choose you!</summary>

```bash
docker pull kirbownz/electrolux-to-mqtt:latest
docker run --rm \
  # Mandatory variables \
  -e MQTT_URL=mqtt://192.168.1.1:1883 \
  -e MQTT_USERNAME=mqtt-user \
  -e MQTT_PASSWORD=mqtt-password \
  -e ELECTROLUX_API_KEY=electrolux-api-key \
  -e ELECTROLUX_USERNAME=electrolux-user@example.com \
  -e ELECTROLUX_PASSWORD=electrolux-password \
  -e ELECTROLUX_COUNTRY_CODE=FI \
  # Optional variables \
  # -e MQTT_TOPIC_PREFIX=electrolux_ \
  # -e MQTT_CLIENT_ID=electrolux-comfort600 \
  # -e MQTT_RETAIN=false \
  # -e MQTT_QOS=2 \
  # -e ELECTROLUX_REFRESH_INTERVAL=30 \
  # -e ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL=300 \
  # -e ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY=60 \
  # -e ELECTROLUX_COMMAND_STATE_DELAY_SECONDS=30 \
  # -e HOME_ASSISTANT_AUTO_DISCOVERY=true \
  # -e HOME_ASSISTANT_REVERT_STATE_ON_REJECTION=false \
  # -e LOG_LEVEL=info \
  # -e LOGGING_SHOW_CHANGES=true \
  # -e LOGGING_IGNORED_KEYS=networkInterface,totalRuntime \
  # -e LOGGING_SHOW_VERSION_NUMBER=true \
  # -e LOGGING_SKIP_CACHE_LOGGING=true \
  # -e LOGGING_SHOW_TIMESTAMP=true \
  # -e VERSION_CHECK_INTERVAL=3600 \
  # -e VERSION_CHECK_NTFY_WEBHOOK_URL=https://ntfy.sh/vB66ozQaRiqhTE9j \ # Register your own at https://ntfy.sh/
  # -e VERSION_CHECK_UPDATE_CHANNEL=stable \
  # -e HEALTH_CHECK_ENABLED=true \
  # -e HEALTH_CHECK_FILE_PATH=/tmp/e2m-health \
  # -e HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES=45 \
  # -e E2M_TELEMETRY_ENABLED=true \
  --name electrolux-to-mqtt kirbownz/electrolux-to-mqtt:latest
```
</details>

### Using `docker compose`

<details>
  <summary>I choose you!</summary>

1. Copy [`docker-compose.example.yml`](./docker/docker-compose.example.yml) as `docker-compose.yml`:
    ```
    cp docker/docker-compose.example.yml docker-compose.yml
    ```
2. Modify the `docker-compose.yml` accordingly and save changes:
    ```
    code docker-compose.yml
    ```
3. Run:
    ```bash
    docker compose down ; docker compose up --pull always -d
    ```
</details>

### Using Portainer

<details>
  <summary>I choose you!</summary>

1. Add new Stack
2. Give it a name, e.g. `electrolux-to-mqtt`
3. Select `Web editor`, copy the following variables and make changes accordingly, finally press `Deploy the stack`:
```yaml
services:
  electrolux-to-mqtt:
    image: kirbownz/electrolux-to-mqtt:latest
    mem_limit: 128mb
    memswap_limit: 256mb
    restart: unless-stopped
    volumes:
      - "/etc/localtime:/etc/localtime:ro"
      - "/etc/timezone:/etc/timezone:ro"
    environment:
      # Mandatory variables
      - MQTT_URL=mqtt://192.168.1.1:1883
      - MQTT_USERNAME=mqtt-user
      - MQTT_PASSWORD=mqtt-password
      - ELECTROLUX_API_KEY=electrolux-api-key
      - ELECTROLUX_USERNAME=electrolux-user@example.com
      - ELECTROLUX_PASSWORD=electrolux-password
      - ELECTROLUX_COUNTRY_CODE=FI
      # Optional variables (uncomment as needed)
      # - MQTT_TOPIC_PREFIX=electrolux_
      # - MQTT_CLIENT_ID=electrolux-comfort600
      # - MQTT_RETAIN=false
      # - MQTT_QOS=2
      # - ELECTROLUX_REFRESH_INTERVAL=30
      # - ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL=300
      # - ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY=60
      # - ELECTROLUX_COMMAND_STATE_DELAY_SECONDS=30
      # - HOME_ASSISTANT_AUTO_DISCOVERY=true
      # - HOME_ASSISTANT_REVERT_STATE_ON_REJECTION=false
      # - LOG_LEVEL=info
      # - LOGGING_SHOW_CHANGES=true
      # - LOGGING_IGNORED_KEYS=networkInterface,totalRuntime
      # - LOGGING_SHOW_VERSION_NUMBER=true
      # - LOGGING_SKIP_CACHE_LOGGING=true
      # - LOGGING_SHOW_TIMESTAMP=true
      # - VERSION_CHECK_INTERVAL=3600
      # - VERSION_CHECK_NTFY_WEBHOOK_URL=https://ntfy.sh/vB66ozQaRiqhTE9j # Register your own at https://ntfy.sh/
      # - VERSION_CHECK_UPDATE_CHANNEL=stable
      # - HEALTH_CHECK_ENABLED=true
      # - HEALTH_CHECK_FILE_PATH=/tmp/e2m-health
      # - HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES=45
      # - E2M_TELEMETRY_ENABLED=true
```
</details>

## Beta / pre-release channel

Pre-release (rc) builds are published to the `:next` Docker tag on every push to the `next` branch.
Release candidates follow the `vX.Y.Z-rc.N` versioning scheme. Each rc changelog covers only the
changes since the previous release (stable or rc).

<details>
  <summary>I want to try the beta channel!</summary>

> **Note:** Pre-release builds may contain unfinished features or bugs. Use `:latest` for production.

To use the beta channel, replace `:latest` with `:next` in your setup:

**docker:**
```bash
docker pull kirbownz/electrolux-to-mqtt:next
docker run --rm -v ./config.yml:/app/config.yml --name electrolux-to-mqtt kirbownz/electrolux-to-mqtt:next
```

**docker-compose / Portainer:** change the `image:` line:
```yaml
image: kirbownz/electrolux-to-mqtt:next
```

To receive update notifications for rc releases, set `VERSION_CHECK_UPDATE_CHANNEL=beta`
(env var) or `updateChannel: beta` in `config.yml` under `versionCheck:`.

Release notes for each rc are available on the
[GitLab releases page](https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases).
</details>

## Developing locally

<details>
  <summary>I want to fix it myself!!</summary>

Either running natively locally:
```bash
# Copy config.example.yml
cp config.example.yml config.yml

# Modify as needed
code config.yml

# Make sure you have correct NodeJS version
# If you don't have fnm installed, follow installation guide from https://github.com/Schniz/fnm?tab=readme-ov-file#installation
fnm use

# Install correct pnpm version if not installed already
corepack enable
corepack install

# Install the dependencies
pnpm install

# Run the app in development mode
pnpm dev
```

..or if you want to use Docker instead:
```bash
# Make a copy of the docker-compose.local.example.yml
cp docker/docker-compose.local.example.yml docker/docker-compose.local.yml

# Modify as needed
code docker/docker-compose.local.yml

# Run the stack (automatically uses Node version from .nvmrc)
NODE_VERSION=$(cat .nvmrc) docker compose -f docker/docker-compose.local.yml down ; NODE_VERSION=$(cat .nvmrc) docker compose -f docker/docker-compose.local.yml up --build

# Or if you have pnpm installed:
pnpm dev:docker
```
</details>

<details>
  <summary>But how to run tests?!</summary>

This project includes comprehensive unit tests to ensure reliability:

```bash
# Run all tests
pnpm test

# To run E2E tests (including version-checker E2E):
pnpm test:e2e

# You can override the ntfy notification topic for E2E tests with:
E2M_NTFY_TOPIC=yourtopic pnpm test:e2e
# If not set, the default topic is `vB66ozQaRiqhTE9j`.

# Run tests in watch mode (auto-rerun on changes)
pnpm test:watch
```
</details>

## Viewing the changelog

The `CHANGELOG.md` is baked into the Docker image at `/app/CHANGELOG.md`. To extract it from a running container:

```bash
# Auto-detect the container name (assumes it contains "electrolux-to-mqtt")
docker cp $(docker ps --filter name=electrolux-to-mqtt --format '{{.Names}}' | head -1):/app/CHANGELOG.md ./CHANGELOG.md

# Or specify the container name explicitly
docker cp <container-name>:/app/CHANGELOG.md ./CHANGELOG.md

cat CHANGELOG.md
```

## Token persistence

The application automatically creates and updates a `tokens.json` file to cache OAuth tokens between restarts, avoiding unnecessary re-authentication.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines on:
- Adding support for new appliance models
- Development setup and workflow
- Code style and testing requirements
- Submitting merge requests

## Home Assistant automation examples

Please read [HOME_ASSISTANT.md](./HOME_ASSISTANT.md) for more details.

## Epilogue

Inspired and thanks to [Dannyyy](https://github.com/dannyyy) for making the [Electrolux to MQTT](https://github.com/dannyyy/electrolux_mqtt) repository.
As I constantly had some issues with other implementations, I decided to make my own, based on [Public Electrolux API](https://developer.electrolux.one/documentation).
