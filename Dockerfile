# syntax=docker/dockerfile:latest

### Build and publish the Docker image
# docker compose -f docker-compose.local.yml down ; docker compose -f docker-compose.local.yml up --build
# docker buildx build --platform linux/arm64,linux/amd64 -t kirbownz/electrolux-to-mqtt:latest -t kirbownz/electrolux-to-mqtt:$(git describe --tags --always) --push .

# Define build arguments
ARG NODE_VERSION=24-alpine3.23

# Define build arguments
ARG LOG_LEVEL=info
ARG VERSION=development

################## Create the build image
FROM dhi.io/node:${NODE_VERSION}-dev AS builder

WORKDIR /app
COPY . /app

# Update version and install dependencies
RUN if [ -n "${VERSION}" ]; then \
  sed -i "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json; \
  fi && \
  PACKAGE_MANAGER=$(node -p "require('./package.json').packageManager") && \
  PACKAGE_MANAGER_NAME=$(echo ${PACKAGE_MANAGER} | cut -d'@' -f1) && \
  PACKAGE_MANAGER_VERSION=$(echo ${PACKAGE_MANAGER} | cut -d'@' -f2) && \
  echo "Using package manager: ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}" && \
  if [ "${PACKAGE_MANAGER_NAME}" != "npm" ]; then \
  npm install -g --force ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}; \
  fi && \
  ${PACKAGE_MANAGER_NAME} install --config.scripts-prepend-node-path=true && \
  ${PACKAGE_MANAGER_NAME} build && \
  echo "${PACKAGE_MANAGER_NAME}" > /tmp/package-manager-name.txt && \
  echo "${PACKAGE_MANAGER_VERSION}" > /tmp/package-manager-version.txt





################## Create the purge image
FROM builder AS purge

WORKDIR /app

# Remove dev dependencies
RUN PACKAGE_MANAGER_NAME=$(cat /tmp/package-manager-name.txt) && \
  PACKAGE_MANAGER_VERSION=$(cat /tmp/package-manager-version.txt) && \
  echo "===================" && \
  echo "Purge stage info:" && \
  echo "Package manager: ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}" && \
  echo "pnpm version: $(${PACKAGE_MANAGER_NAME} --version)" && \
  echo "pnpm location: $(which ${PACKAGE_MANAGER_NAME})" && \
  echo "===================" && \
  ${PACKAGE_MANAGER_NAME} install --prod --config.scripts-prepend-node-path=true





################## Create the runtime image
FROM dhi.io/node:${NODE_VERSION} AS runner

# Define build arguments with defaults for this stage
ARG LOG_LEVEL=info
ARG VERSION=docker

LABEL maintainer="@kirbownz"
LABEL description="Electrolux to MQTT bridge"

WORKDIR /app

COPY --from=purge /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/dist /app/dist

# Set environment variables from build args
ENV LOG_LEVEL=${LOG_LEVEL}
ENV VERSION=${VERSION}

# Run the application
CMD ["node" , "dist/index.js"]