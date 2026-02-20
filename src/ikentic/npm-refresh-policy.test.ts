import { describe, expect, it } from "vitest";
import { decideNpmRefresh } from "../../ikentic/scripts/npm-refresh-policy.mjs";

describe("decideNpmRefresh", () => {
  /**
   * Given cached plugin has version X and requested spec resolves to X
   * When restart occurs with same spec/channel
   * Then refresh decision is false
   */
  it("skips refresh when requested spec and resolved version match installed cache", () => {
    const decision = decideNpmRefresh({
      installedVersion: "1.2.3",
      requestedSpec: "@locusai/openclaw-ikentic-plugin@dev",
      previousRequestedSpec: "@locusai/openclaw-ikentic-plugin@dev",
      resolvedTargetVersion: "1.2.3",
    });

    expect(decision.refresh).toBe(false);
  });

  /**
   * Given requested spec changed
   * When restart occurs
   * Then refresh decision is true
   */
  it("refreshes when requested spec changes", () => {
    const decision = decideNpmRefresh({
      installedVersion: "1.2.3",
      requestedSpec: "@locusai/openclaw-ikentic-plugin@beta",
      previousRequestedSpec: "@locusai/openclaw-ikentic-plugin@dev",
      resolvedTargetVersion: "1.2.3",
    });

    expect(decision.refresh).toBe(true);
    expect(decision.reason).toContain("requested spec changed");
  });

  /**
   * Given stream selector (dev/beta/rc/latest) resolves to version Y != installed X
   * When restart occurs
   * Then refresh decision is true
   */
  it("refreshes when resolved stream version differs from installed version", () => {
    const decision = decideNpmRefresh({
      installedVersion: "1.2.3",
      requestedSpec: "@locusai/openclaw-ikentic-plugin@rc",
      previousRequestedSpec: "@locusai/openclaw-ikentic-plugin@rc",
      resolvedTargetVersion: "1.2.4",
    });

    expect(decision.refresh).toBe(true);
    expect(decision.reason).toContain("version changed");
  });
});
