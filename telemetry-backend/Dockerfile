# syntax=docker/dockerfile:latest

# Node version build-arg — REQUIRED, no default. Compose passes it; mise exports
# it from mise.toml [vars] node_major. Build fails loudly if unset.
ARG NODE_VERSION
ARG NODE_IMAGE=node:${NODE_VERSION:?"NODE_VERSION build-arg is required"}-alpine

# ── Stage 1: build ──────────────────────────────────────────────────
# Standard Alpine image — not the hardened bridge container.
FROM ${NODE_IMAGE} AS builder

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
FROM ${NODE_IMAGE}

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
# Badge output dir (OUTPUT_DIR) — writable by the non-root user even when the
# bind-mounted host dir is empty.
RUN mkdir -p /app/badge && chown nodejs:nodejs /app/badge
USER nodejs

EXPOSE 3001

CMD ["node", "dist/index.js"]
