# syntax=docker/dockerfile:latest

### Build and publish the Docker image
# docker compose -f docker-compose.local.yml down ; docker compose -f docker-compose.local.yml up --build
# docker buildx build --platform linux/arm64,linux/amd64 -t kirbownz/electrolux-to-mqtt:latest -t kirbownz/electrolux-to-mqtt:$(git describe --tags --always) --push .

# Define build arguments
ARG NODE_VERSION=22-alpine

# Use the specified Node.js version
FROM node:${NODE_VERSION}

# Define build arguments
ARG LOG_LEVEL=info
ARG VERSION=development

# Install required packages
RUN apk add --no-cache bash

LABEL maintainer="@kirbownz"
LABEL description="Electrolux to MQTT bridge"

WORKDIR /app
COPY . /app

# Add an entrypoint script to handle config.yml generation
RUN chmod +x /app/entrypoint.sh

# Update application version in package.json
RUN if [ -n "${VERSION}" ]; then \
  sed -i "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json; \
  fi

# Install dependencies
RUN PACKAGE_MANAGER=$(node -p "require('./package.json').packageManager") && \
  PACKAGE_MANAGER_NAME=$(echo ${PACKAGE_MANAGER} | cut -d'@' -f1) && \
  PACKAGE_MANAGER_VERSION=$(echo ${PACKAGE_MANAGER} | cut -d'@' -f2) && \
  echo "Using package manager: ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}" && \
  if [ "${PACKAGE_MANAGER_NAME}" != "npm" ]; then \
  npm install -g ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}; \
  fi && \
  ${PACKAGE_MANAGER_NAME} install --prod --config.scripts-prepend-node-path=true

# Set environment variables
ENV LOG_LEVEL=${LOG_LEVEL:-info}
ENV VERSION=${VERSION:-docker}

# Run entrypoint script to generate config.yml
ENTRYPOINT ["/app/entrypoint.sh"]

# Run the application
CMD ["pnpm", "start"]