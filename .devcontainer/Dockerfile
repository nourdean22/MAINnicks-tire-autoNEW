FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep jq curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global \
    opencode-ai@1.18.27 \
    @ast-grep/cli@0.45.2

USER node
