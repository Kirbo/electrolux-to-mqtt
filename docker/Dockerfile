# syntax=docker/dockerfile:latest

### Build and publish the Docker image
# docker buildx build \
#   --platform linux/arm64,linux/amd64 \
#   --build-arg VERSION=$(git describe --tags --always) \
#   --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
#   --build-arg VCS_REF=$(git rev-parse --short HEAD) \
#   -t kirbownz/electrolux-to-mqtt:latest \
#   -t kirbownz/electrolux-to-mqtt:$(git describe --tags --always) \
#   --push \
#   -f docker/Dockerfile .

# Check the base images from: https://hub.docker.com/hardened-images/catalog/dhi/node/images

# Define build arguments
ARG NODE_VERSION=24-alpine3.23
ARG NODE_IMAGE=dhi.io/node:${NODE_VERSION}
ARG VERSION=development
ARG BUILD_DATE
ARG VCS_REF

################## Create the build image
FROM ${NODE_IMAGE}-dev AS builder

# Define build arguments for this stage
ARG VERSION
ARG NODE_IMAGE

# Set environment variables from build args (baked in at build time)
ENV VERSION=${VERSION}
ENV NODE_IMAGE=${NODE_IMAGE}
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy only dependency manifests first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies (including dev dependencies for building)
RUN PACKAGE_MANAGER=$(node -p "require('./package.json').packageManager") && \
  corepack enable && \
  corepack install && \
  echo "====================================================================================" && \
  echo "                Application Version:          ${VERSION}" && \
  echo "                Node Image:                   ${NODE_IMAGE}" && \
  echo "                Package manager:              ${PACKAGE_MANAGER}" && \
  echo "====================================================================================" && \
  DOCKER_BUILD=1 pnpm install --frozen-lockfile --config.scripts-prepend-node-path=true

# Copy source code
COPY . .

# Update version and build
RUN if [ -n "${VERSION}" ]; then \
  npm pkg set version="${VERSION}"; \
  fi && \
  pnpm run build





################## Create the purge image
FROM ${NODE_IMAGE}-dev AS purge

# Set environment for production
ENV NODE_ENV=production

WORKDIR /app

# Copy only what's needed for production install
COPY pnpm-lock.yaml ./
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Install only production dependencies
RUN corepack enable && \
  corepack install && \
  DOCKER_BUILD=1 pnpm install --frozen-lockfile --prod --config.scripts-prepend-node-path=true

# Copy built application from builder
COPY --from=builder /app/dist ./dist





################## Create the runtime image
FROM ${NODE_IMAGE} AS runner

# Define build arguments for this stage
ARG LOG_LEVEL=info
ARG VERSION=development
ARG BUILD_DATE
ARG VCS_REF

# Set environment variables from build args (baked in at build time)
ENV LOG_LEVEL=${LOG_LEVEL}
ENV NODE_ENV=production

# OCI Image Format Specification labels (https://github.com/opencontainers/image-spec/blob/main/annotations.md)
LABEL org.opencontainers.image.title="Electrolux to MQTT Bridge"
LABEL org.opencontainers.image.description="Bridge application that connects Electrolux appliances to MQTT for home automation"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.authors="Kimmo Saari <kirbo@kirbo-designs.com>"
LABEL org.opencontainers.image.url="https://gitlab.com/kirbo/electrolux-to-mqtt"
LABEL org.opencontainers.image.documentation="https://gitlab.com/kirbo/electrolux-to-mqtt/-/blob/main/README.md?ref_type=heads"
LABEL org.opencontainers.image.source="https://gitlab.com/kirbo/electrolux-to-mqtt"
LABEL org.opencontainers.image.revision="${VCS_REF}"
LABEL org.opencontainers.image.vendor="Kimmo Saari"
LABEL org.opencontainers.image.licenses="MIT"

# Additional metadata
LABEL maintainer="Kimmo Saari <kirbo@kirbo-designs.com>"
LABEL description="Electrolux to MQTT bridge"

# Set working directory
WORKDIR /app

# Copy only the necessary files from the purge stage
# Use the built-in 'node' user from the base image (uid 1000)
COPY --from=purge --chown=node:node /app/node_modules ./node_modules
COPY --from=purge --chown=node:node /app/package.json ./package.json
COPY --from=purge --chown=node:node /app/dist ./dist

# Add signal handling for graceful shutdown
STOPSIGNAL SIGTERM

# Run the application
CMD ["node", "dist/index.js"]