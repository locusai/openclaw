#!/usr/bin/env node

/**
 * @typedef {object} RefreshDecisionInput
 * @property {string} requestedSpec
 * @property {string | undefined} installedVersion
 * @property {string | undefined} previousRequestedSpec
 * @property {string | undefined} resolvedTargetVersion
 */

/**
 * @typedef {object} RefreshDecision
 * @property {boolean} refresh
 * @property {string} reason
 */

/**
 * Decide whether an installed cached npm plugin should be refreshed.
 *
 * @param {RefreshDecisionInput} input
 * @returns {RefreshDecision}
 */
export function decideNpmRefresh(input) {
  if (!input.installedVersion) {
    return { refresh: true, reason: "installed version is missing" };
  }

  if (input.previousRequestedSpec && input.previousRequestedSpec !== input.requestedSpec) {
    return {
      refresh: true,
      reason: `requested spec changed (${input.previousRequestedSpec} -> ${input.requestedSpec})`,
    };
  }

  if (!input.resolvedTargetVersion) {
    return {
      refresh: false,
      reason: "target version is unresolved",
    };
  }

  if (input.installedVersion !== input.resolvedTargetVersion) {
    return {
      refresh: true,
      reason: `version changed (${input.installedVersion} -> ${input.resolvedTargetVersion})`,
    };
  }

  return {
    refresh: false,
    reason: "installed version matches target version",
  };
}

/**
 * Parse CLI args into RefreshDecisionInput.
 *
 * @param {string[]} argv
 * @returns {RefreshDecisionInput}
 */
function parseCliArgs(argv) {
  /** @type {Record<string, string>} */
  const map = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      continue;
    }
    map[key.slice(2)] = value;
    i += 1;
  }

  return {
    requestedSpec: map["requested-spec"] ?? "",
    installedVersion: map["installed-version"] || undefined,
    previousRequestedSpec: map["previous-requested-spec"] || undefined,
    resolvedTargetVersion: map["resolved-target-version"] || undefined,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = parseCliArgs(process.argv.slice(2));
  const decision = decideNpmRefresh(input);
  process.stdout.write(JSON.stringify(decision));
}
