# syntax=docker/dockerfile:1.3

### Build and publish the Docker image
# docker buildx build --platform linux/arm64,linux/amd64 -t kirbownz/electrolux-to-mqtt:latest -t kirbownz/electrolux-to-mqtt:$(git describe --tags --always) --push .

ARG LOG_LEVEL
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION}

ENV LOG_LEVEL=${LOG_LEVEL:-info}

LABEL maintainer="@kirbownz"
LABEL description="Electrolux to MQTT bridge"

WORKDIR /app
COPY . .

RUN PACKAGE_MANAGER=$(node -p "require('./package.json').packageManager.split('@')[0]") && \
  echo "Using package manager: $PACKAGE_MANAGER" && \
  npm i -g $PACKAGE_MANAGER && \
  $PACKAGE_MANAGER install --production

CMD ["pnpm", "start"]