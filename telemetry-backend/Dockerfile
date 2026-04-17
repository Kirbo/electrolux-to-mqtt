# syntax=docker/dockerfile:latest

# Define build argument for Node version (passed from docker-compose)
ARG NODE_VERSION=24

# ── Stage 1: build ──────────────────────────────────────────────────
# Pinned to a known-good digest for reproducible builds.
# To update: docker manifest inspect node:${NODE_VERSION}-alpine
# and replace the digest below with the amd64/linux entry.
FROM node:${NODE_VERSION}-alpine@sha256:8e2c930fda481a6ec141fe5a88e8c249c69f8102fe98af505f38c081649ea749 AS builder

WORKDIR /app

# Copy root package.json for package manager detection
COPY ./package.json ./application.json

# Copy source files
COPY ./telemetry-backend/ .

# Install package manager, all dependencies, and compile TypeScript
ENV CI=true
RUN PACKAGE_MANAGER=$(node -p "require('./application.json').packageManager") && \
    npm pkg set packageManager="${PACKAGE_MANAGER}" && \
    corepack enable && \
    corepack install && \
    echo "====================================================================================" && \
    echo "                Node Version:                 ${NODE_VERSION}" && \
    echo "                Package manager:              ${PACKAGE_MANAGER}" && \
    echo "====================================================================================" && \
    pnpm install --frozen-lockfile && \
    pnpm run build

# ── Stage 2: production ────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine@sha256:8e2c930fda481a6ec141fe5a88e8c249c69f8102fe98af505f38c081649ea749

WORKDIR /app

# Copy root package.json for package manager detection
COPY ./package.json ./application.json

# Copy package manifest and lock file from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./

# Install only production dependencies
ENV CI=true
RUN PACKAGE_MANAGER=$(node -p "require('./application.json').packageManager") && \
    npm pkg set packageManager="${PACKAGE_MANAGER}" && \
    corepack enable && \
    corepack install && \
    pnpm install --prod --frozen-lockfile && \
    rm -f application.json

# Copy compiled output
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

# Run as non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs && \
    mkdir -p /app/badge && chown nodejs:nodejs /app/badge
USER nodejs

# Expose port
EXPOSE 3001

# Liveness probe — hits the dedicated /health endpoint which has no rate limit
# and no Redis dependency, so it reflects Express event loop health only.
# PORT defaults to 3001 if not overridden at runtime.
# wget is available in node:alpine; no curl fallback needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT:-3001}/health" || exit 1

# Start the server
CMD ["node", "dist/index.js"]
