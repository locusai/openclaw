#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${OUT_DIR:-.tmp}"
mkdir -p "$OUT_DIR"

GEN_DOCKERFILE_PATH="$(node scripts/ikentic/docker/dockerfile/sync-dockerfile.mjs)"
echo $GEN_DOCKERFILE_PATH


# docker buildx bake \
#   -f docker-compose.build.yml \
#   --target cloudflare-sandbox \
#     --build-arg SANDBOX_BASE_IMAGE=docker.io/cloudflare/sandbox:<version> \
#   --set openclaw-ikentic.dockerfile="$GEN_DOCKERFILE_PATH" \
#   openclaw-ikentic
