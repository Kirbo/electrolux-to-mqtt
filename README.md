# Electrolux Comfort 600 to MQTT / Home Assistant

[![Latest Release](https://gitlab.com/kirbo/electrolux-to-mqtt/-/badges/release.svg?order_by=release_at)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases)
[![GitLab Last Commit](https://img.shields.io/gitlab/last-commit/Kirbo%2Felectrolux-to-mqtt)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/commits)
[![CI/CD Pipeline Status](https://gitlab.com/kirbo/electrolux-to-mqtt/badges/main/pipeline.svg)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/pipelines)
[![GitLab Issues](https://img.shields.io/gitlab/issues/open/Kirbo%2Felectrolux-to-mqtt?labels=Bug)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/issues?label_name%5B%5D=Bug)
[![GitLab Merge Requests](https://img.shields.io/gitlab/merge-requests/open/Kirbo%2Felectrolux-to-mqtt)](https://gitlab.com/kirbo/electrolux-to-mqtt/-/merge_requests)
[![Docker Pulls](https://badgen.net/docker/pulls/kirbownz/electrolux-to-mqtt)](https://hub.docker.com/r/kirbownz/electrolux-to-mqtt/)



Relevant links:
- [Source codes](https://gitlab.com/kirbo/electrolux-to-mqtt) are in GitLab
- [Issues](https://gitlab.com/kirbo/electrolux-to-mqtt/-/issues) are in GitLab
- [Pull/Merge Requests](https://gitlab.com/kirbo/electrolux-to-mqtt/-/merge_requests) are in GitLab
- [Releases](https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases) containing the Release Notes are in GitLab
- [CI/CD Pipeline](https://gitlab.com/kirbo/electrolux-to-mqtt/-/pipelines) is in GitLab
- [Dockerhub](https://hub.docker.com/r/kirbownz/electrolux-to-mqtt)
- [GitHub mirror](https://github.com/Kirbo/electrolux-to-mqtt)


## How to install

1. Sign up/sign in into [Electrolux for Developer](https://developer.electrolux.one/dashboard)
2. Create a new API Key and copy the value
3. Setup configs to either [docker-compose.yml](./docker-compose.yml) or copy [config.example.yml](./config.example.yml) into `config.yml`
4. Start the container by following the [instructions](./README.md#starting-container)

## Starting container

### Using `docker` with `config.yml`

1. Create `config.yml` file, by copying [contents of `config.example.yml`](./config.example.yml) and make changes accordingly
2. Run:
```bash
docker pull kirbownz/electrolux-to-mqtt:latest
docker run --rm -v ./config.yml:/app/config.yml --name electrolux-to-mqtt kirbownz/electrolux-to-mqtt:latest
```

### Using `docker` with environmental variables

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
  # -e HOME_ASSISTANT_AUTO_DISCOVERY=true \
  # -e LOG_LEVEL=info \
  # -e LOGGING_SHOW_CHANGES=false \
  --name electrolux-to-mqtt kirbownz/electrolux-to-mqtt:latest
```

### Using `docker compose`

1. Copy [`docker-compose.example.yml`](./docker-compose.example.yml) as `docker-compose.yml` (`cp docker-compose.example.yml docker-compose.yml`)
2. Modify the `docker-compose.yml` accordingly (`code docker-compose.yml`) and save changes
3. Run:
```bash
docker compose pull && docker compose up -d
```

### Using Portainer

1. Add new Stack
2. Give it a name, e.g. `electrolux-to-mqtt`
3. Select `Web editor`, copy the following variables and make changes accordingly, finally press `Deploy the stack`:
```bash
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
      - # Mandatory variables
      - MQTT_URL=mqtt://192.168.1.1:1883
      - MQTT_USERNAME=mqtt-user
      - MQTT_PASSWORD=mqtt-password
      - ELECTROLUX_API_KEY=electrolux-api-key
      - ELECTROLUX_USERNAME=electrolux-user@example.com
      - ELECTROLUX_PASSWORD=electrolux-password
      - ELECTROLUX_COUNTRY_CODE=FI
      - # Optional variables
      # - MQTT_TOPIC_PREFIX=electrolux_
      # - MQTT_CLIENT_ID=electrolux-comfort600
      # - MQTT_RETAIN=false
      # - MQTT_QOS=2
      # - ELECTROLUX_REFRESH_INTERVAL=30
      # - HOME_ASSISTANT_AUTO_DISCOVERY=true
      # - LOG_LEVEL=info
      # - LOGGING_SHOW_CHANGES=false
```

## Developing locally

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
# Modify as needed
code docker-compose.local.yml
# Run the stack
docker compose -f docker-compose.local.yml down ; docker compose -f docker-compose.local.yml up --build
```


## Epilogue

Inspired and thanks to [Dannyyy](https://github.com/dannyyy) for making the [Electrolux to MQTT](https://github.com/dannyyy/electrolux_mqtt) repository.
As I constantly had some issues with other implementations, I decided to make my own, based on [Public Electrolux API](https://developer.electrolux.one/documentation).
