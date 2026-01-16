# syntax=docker/dockerfile:latest

### Build and publish the Docker image
# docker compose -f docker-compose.local.yml down ; docker compose -f docker-compose.local.yml up --build
# docker buildx build --platform linux/arm64,linux/amd64 -t kirbownz/electrolux-to-mqtt:latest -t kirbownz/electrolux-to-mqtt:$(git describe --tags --always) --push .

# Check the base images from: https://hub.docker.com/hardened-images/catalog/dhi/node/images

# Define build arguments
ARG NODE_VERSION=24-alpine3.23
ARG NODE_IMAGE=docker.io/node:${NODE_VERSION}
ARG VERSION=development

################## Create the build image
FROM ${NODE_IMAGE}-dev AS builder

# Define build arguments for this stage
ARG VERSION
ARG NODE_IMAGE

# Set environment variables from build args (baked in at build time)
ENV VERSION=${VERSION}
ENV NODE_IMAGE=${NODE_IMAGE}

# Set working directory and copy source files
WORKDIR /app
COPY . /app

# Update version and install dependencies
RUN if [ -n "${VERSION}" ]; then \
  sed -i "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json; \
  fi && \
  PACKAGE_MANAGER=$(node -p "require('./package.json').packageManager") && \
  PACKAGE_MANAGER_NAME=$(echo ${PACKAGE_MANAGER} | cut -d'@' -f1) && \
  PACKAGE_MANAGER_VERSION=$(echo ${PACKAGE_MANAGER} | cut -d'@' -f2) && \
  if [ "${PACKAGE_MANAGER_NAME}" != "npm" ]; then \
  echo "Installing package manager ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}"; \
  npm install -g --force ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}; \
  fi && \
  echo "$(which ${PACKAGE_MANAGER_NAME})" > /tmp/package-manager.txt && \
  PACKAGE_MANAGER_BIN=$(cat /tmp/package-manager.txt) && \
  echo "====================================================================================" && \
  echo "                Application Version:          ${VERSION}" && \
  echo "                Node Image:                   ${NODE_IMAGE}" && \
  echo "                Package manager:              ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}" && \
  echo "                Package manager binary:       ${PACKAGE_MANAGER_BIN}" && \
  echo "====================================================================================" && \
  ${PACKAGE_MANAGER_BIN} install --config.scripts-prepend-node-path=true && \
  ${PACKAGE_MANAGER_BIN} run build





################## Create the purge image
FROM builder AS purge

# Remove dev dependencies
RUN $(cat /tmp/package-manager.txt) install --prod --config.scripts-prepend-node-path=true





################## Create the runtime image
FROM ${NODE_IMAGE} AS runner

# Define build arguments for this stage
ARG LOG_LEVEL=info

# Set environment variables from build args (baked in at build time)
ENV LOG_LEVEL=${LOG_LEVEL}

# Metadata
LABEL maintainer="@kirbownz"
LABEL description="Electrolux to MQTT bridge"

# Set working directory
WORKDIR /app

# Copy only the necessary files from the purge stage
COPY --from=purge /app/node_modules /app/node_modules
COPY --from=purge /app/package.json /app/package.json
COPY --from=purge /app/dist /app/dist

# Run the application
CMD ["node" , "dist/index.js"]