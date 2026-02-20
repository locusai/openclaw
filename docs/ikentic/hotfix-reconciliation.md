# IKENTIC Hotfix Reconciliation (Moltworker → OpenClaw)

This document tracks Moltworker `Dockerfile.ikentic` hotfixes and the corresponding upstream/fork fixes so Moltworker no longer needs to patch OpenClaw artifacts at image build time.

## CORE_PACKAGE_NAMES patch (package root resolution)

- **Previous Moltworker hotfix:** `sed` patch of built `dist/openclaw-root-*.js` to treat `@locusai/openclaw` as a core package name.
- **Status:** fixed in OpenClaw source.
- **Fix:** OpenClaw now treats both `openclaw` and any scoped `@<scope>/openclaw` as core package roots during package root resolution and update flows.
- **Where:** `src/infra/openclaw-root.ts`, `src/infra/update-runner.ts`, `src/cli/update-cli/shared.ts`.

## Control UI overwrite layer

- **Previous Moltworker hotfix:** overwrite `dist/control-ui/` using a `control-ui-hotfix/` directory.
- **Status:** obsolete under source-built images.
- **Reason:** the source build (`pnpm ui:build`) is used in the OpenClaw docker build, so Moltworker no longer depends on a prebuilt/broken UI bundle from an npm tarball.

## IKENTIC plugin “missing runtime deps” injection

- **Previous Moltworker hotfix:** `npm install --no-save ...` into OpenClaw’s `node_modules` to satisfy the IKENTIC plugin runtime.
- **Status:** temporarily required until the plugin is self-contained (preferred fix).
- **Current approach (OpenClaw image build):** install additional node packages via build args in `Dockerfile.ikentic` (BuildKit secret-mounted so private registry auth doesn’t land in layers).
  - Build arg: `OPENCLAW_DOCKER_NPM_PACKAGES`
  - CI should set this via repo variable `OPENCLAW_DOCKER_NPM_PACKAGES` (example: `@locusai/locus-api-client @apidevtools/swagger-parser`)
- **Sunset plan:** update the IKENTIC plugin package to declare/bundle its runtime deps so OpenClaw no longer needs `OPENCLAW_DOCKER_NPM_PACKAGES`.

## Private package auth (`.npmrc.docker`)

- **Previous Moltworker hotfix:** copy `.npmrc.docker` into the image to access GitHub Packages.
- **Status:** removed from Moltworker by moving the build to OpenClaw and using BuildKit secrets for dependency installs.
- **Rule:** tokens must be provided at build time (CI secrets) and must not land in filesystem layers or `docker history`.

