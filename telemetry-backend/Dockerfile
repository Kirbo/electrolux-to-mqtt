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
    PACKAGE_MANAGER_NAME=$(echo "${PACKAGE_MANAGER}" | cut -d'@' -f1) && \
    PACKAGE_MANAGER_VERSION=$(echo "${PACKAGE_MANAGER}" | cut -d'@' -f2) && \
    if [ "${PACKAGE_MANAGER_NAME}" != "npm" ]; then \
    echo "Installing package manager ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}"; \
    npm install -g --force "${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}"; \
    fi && \
    PACKAGE_MANAGER_BIN=$(which "${PACKAGE_MANAGER_NAME}") && \
    echo "====================================================================================" && \
    echo "                Node Version:                 ${NODE_VERSION}" && \
    echo "                Package manager:              ${PACKAGE_MANAGER_NAME}@${PACKAGE_MANAGER_VERSION}" && \
    echo "                Package manager binary:       ${PACKAGE_MANAGER_BIN}" && \
    echo "====================================================================================" && \
    "${PACKAGE_MANAGER_BIN}" install && \
    "${PACKAGE_MANAGER_BIN}" run build

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "dist/index.js"]
