export function isCoreOpenClawPackageName(name: string | null | undefined): boolean {
  if (!name) {
    return false;
  }

  if (name === "openclaw") {
    return true;
  }

  // GitHub Packages and other registries may publish OpenClaw under a scope
  // (e.g. "@locusai/openclaw"). Treat any "@<scope>/openclaw" as a core package.
  return /^@[^/]+\/openclaw$/.test(name);
}
