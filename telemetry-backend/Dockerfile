# syntax=docker/dockerfile:latest

# Define build argument for Node version (passed from docker-compose)
ARG NODE_VERSION=24

# Use official Node image
FROM node:${NODE_VERSION}-alpine

WORKDIR /app

# Copy root package.json for package manager detection
COPY ./package.json ./application.json

# Copy source files
COPY ./telemetry-backend/ .

# Install package manager if specified and install dependencies
ENV CI=true
RUN PACKAGE_MANAGER=$(node -p "require('./application.json').packageManager") && \
    npm pkg set packageManager="${PACKAGE_MANAGER}" && \
    corepack enable && \
    corepack install && \
    echo "====================================================================================" && \
    echo "                Node Version:                 ${NODE_VERSION}" && \
    echo "                Package manager:              ${PACKAGE_MANAGER}" && \
    echo "====================================================================================" && \
    pnpm install && \
    pnpm run build

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "dist/index.js"]
