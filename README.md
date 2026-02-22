# Electrolux Comfort 600 to MQTT / Home Assistant

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
- **Well Tested** - Unit tests with >70% coverage
- **Docker Ready** - Multi-platform Docker images (amd64/arm64)
- **Update Notifications** - Periodically check for newer releases and optionally push-notify you via https://ntfy.sh/ webhook.

Relevant links:
- [Source codes](https://gitlab.com/kirbo/electrolux-to-mqtt) are in GitLab
- [Issues](https://gitlab.com/kirbo/electrolux-to-mqtt/-/issues) are in GitLab
- [Pull/Merge Requests](https://gitlab.com/kirbo/electrolux-to-mqtt/-/merge_requests) are in GitLab
- [Releases](https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases) containing the Release Notes are in GitLab
- [CI/CD Pipeline](https://gitlab.com/kirbo/electrolux-to-mqtt/-/pipelines) is in GitLab
- [Dockerhub](https://hub.docker.com/r/kirbownz/electrolux-to-mqtt)
- [GitHub mirror](https://github.com/Kirbo/electrolux-to-mqtt)
- [SonarQube Cloud](https://sonarcloud.io/project/overview?id=kirbo_electrolux-to-mqtt)


## Prerequisites

1. Sign up/sign in into [Electrolux for Developer](https://developer.electrolux.one/dashboard)
2. Create a new API Key and copy the value
3. Start the container by following one of the instructions [listed below](#but-how-to-start)

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
  # -e HOME_ASSISTANT_AUTO_DISCOVERY=true \
  # -e LOG_LEVEL=info \
  # -e LOGGING_SHOW_CHANGES=false \
  # -e LOGGING_IGNORED_KEYS=networkInterface.rssi \
  # -e LOGGING_SKIP_CACHE_LOGGING=true \
  # -e VERSION_CHECK_INTERVAL=3600 \
  # -e VERSION_CHECK_NTFY_WEBHOOK_URL=https://ntfy.sh/vB66ozQaRiqhTE9j \ # Register your own at https://ntfy.sh/
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
      # - HOME_ASSISTANT_AUTO_DISCOVERY=true
      # - LOG_LEVEL=info
      # - LOGGING_SHOW_CHANGES=false
      # - LOGGING_IGNORED_KEYS=networkInterface.rssi
      # - LOGGING_SKIP_CACHE_LOGGING=true
      # - VERSION_CHECK_INTERVAL=3600
      # - VERSION_CHECK_NTFY_WEBHOOK_URL=https://ntfy.sh/vB66ozQaRiqhTE9j # Register your own at https://ntfy.sh/
```
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
npm install -g $(node -p "require('./package.json').packageManager")

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
