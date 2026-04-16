# syntax=docker/dockerfile:latest

# Define build argument for Node version (passed from docker-compose)
ARG NODE_VERSION=24

# ── Stage 1: build ──────────────────────────────────────────────────
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

# Start the server
CMD ["node", "dist/index.js"]
