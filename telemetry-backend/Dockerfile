# syntax=docker/dockerfile:latest

# Define build argument for Node version (passed from docker-compose)
ARG NODE_VERSION=24

# ── Stage 1: build ──────────────────────────────────────────────────
# Standard Alpine image — not the hardened bridge container.
FROM node:${NODE_VERSION}-alpine AS builder

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
FROM node:${NODE_VERSION}-alpine

WORKDIR /app

# Copy root package.json for package manager detection
COPY ./package.json ./application.json

# Copy package manifest, lock file, and workspace config from builder.
# pnpm-workspace.yaml carries the dependency overrides; without it the
# frozen install fails ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./

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
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

EXPOSE 3002

CMD ["node", "dist/index.js"]
