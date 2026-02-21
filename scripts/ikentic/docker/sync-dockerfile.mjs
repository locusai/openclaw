import fs from "node:fs";
import path from "node:path";

const base = process.env.BASE_DOCKERFILE || path.resolve(process.cwd(), "Dockerfile");
const out =
  process.env.OUT_DOCKERFILE || path.resolve(process.cwd(), ".tmp/Dockerfile.ikentic.generated");

fs.mkdirSync(path.dirname(out), { recursive: true });

let text = fs.readFileSync(base, "utf8");

// Ensure BuildKit syntax header exists (and keep stock file unchanged)
text = text.replace(/^#\s*syntax=docker\/dockerfile:.*\n/, "");
text = `# syntax=docker/dockerfile:1.7
# Generated from stock Dockerfile + Ikentic deltas (do not commit)
${text}`;

// 1) Wrap pnpm install with secret mount
const installOld = "RUN pnpm install --frozen-lockfile";
const installNew = `RUN --mount=type=secret,id=node_auth_token,required=false \\
    export NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token 2>/dev/null || true)" && \\
    pnpm install --frozen-lockfile`;

if (!text.includes(installOld)) {
  throw new Error(`Expected "${installOld}" not found in ${base}`);
}
text = text.replace(installOld, installNew);

// 2) Wrap optional npm packages install with secret mount (if present)
const extraOld = `RUN if [ -n "$OPENCLAW_DOCKER_NPM_PACKAGES" ]; then \\
      npm install --no-save $OPENCLAW_DOCKER_NPM_PACKAGES && \\
      npm cache clean --force; \\
    fi`;

const extraNew = `RUN --mount=type=secret,id=node_auth_token,required=false \\
    export NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token 2>/dev/null || true)" && \\
    if [ -n "$OPENCLAW_DOCKER_NPM_PACKAGES" ]; then \\
      npm install --no-save $OPENCLAW_DOCKER_NPM_PACKAGES && \\
      npm cache clean --force; \\
    fi`;

if (text.includes(extraOld)) {
  text = text.replace(extraOld, extraNew);
}

// 3) Remove .npmrc before build step (avoid token warnings later)
const copyOld = "COPY . .\nRUN pnpm build";
const copyNew = `COPY . .
# .npmrc only needed for dependency install step above
RUN rm -f /app/.npmrc
RUN pnpm build`;

if (!text.includes(copyOld)) {
  throw new Error(`Expected "${copyOld}" block not found in ${base}`);
}
text = text.replace(copyOld, copyNew);

fs.writeFileSync(out, text);
process.stdout.write(out);
