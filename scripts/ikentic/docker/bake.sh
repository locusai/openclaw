#!/usr/bin/env bash
set -euo pipefail


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo $SCRIPT_DIR
echo $REPO_ROOT

OUT_DIR="${OUT_DIR:-$REPO_ROOT/.tmp}"
mkdir -p "$OUT_DIR"

SANDBOX_VERSION="${SANDBOX_VERSION:-0.7.0}"
NODE_VERSION="${NODE_VERSION:-22.13.1}"
SANDBOX_BASE_IMAGE="${SANDBOX_BASE_IMAGE:-docker.io/cloudflare/sandbox:${SANDBOX_VERSION}}"

# Compose variable interpolation only sees exported env vars
export SANDBOX_VERSION
export NODE_VERSION
export SANDBOX_BASE_IMAGE

COMPOSE_BUILD_FILE="${COMPOSE_BUILD_FILE:-$REPO_ROOT/docker-compose.build.yml}"
GEN_DOCKERFILE_PATH="${GEN_DOCKERFILE_PATH:-$REPO_ROOT/Dockerfile.ikentic}"

# GEN_DOCKERFILE_PATH="$(node scripts/ikentic/docker/dockerfile/sync-dockerfile.mjs)"
# echo $GEN_DOCKERFILE_PATH

GEN_DOCKERFILE_PATH="Dockerfile.ikentic"

docker buildx bake -f docker-compose.build.yml --print

docker buildx bake \
  -f "$COMPOSE_BUILD_FILE" \
  --set openclaw-ikentic.dockerfile="$GEN_DOCKERFILE_PATH" \
  openclaw-ikentic
