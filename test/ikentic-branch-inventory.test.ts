import { describe, expect, it } from "vitest";
import { runInventoryCli, type CliDeps } from "../scripts/ikentic-branch-inventory";

function createMockDeps(options?: {
  carryRight?: number;
  prCherryRaw?: string;
  prRevList?: string[];
  applyFailures?: Set<string>;
}) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const carryRight = options?.carryRight ?? 0;
  const prCherryRaw = options?.prCherryRaw ?? "";
  const prRevList = options?.prRevList ?? [];
  const applyFailures = options?.applyFailures ?? new Set<string>();

  const shaMap: Record<string, string> = {
    // Branch heads
    "origin/pr/example": "1111111111111111111111111111111111111111",
    "shared/feat/example": "2222222222222222222222222222222222222222",
    "origin/integration/ikentic": "3333333333333333333333333333333333333333",
    // Abbrev SHAs from cherry output
    abcdef1: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    abcdef2: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    c0ffee1: "cccccccccccccccccccccccccccccccccccccccc",
  };

  const deps: CliDeps = {
    execGit: (args, optionsExec) => {
      if (args[0] === "for-each-ref") {
        const glob = args.at(-1) ?? "";
        if (glob === "refs/remotes/origin/carry/*") {
          return "origin/carry/ops";
        }
        if (glob === "refs/remotes/origin/pr/*") {
          return "origin/pr/example";
        }
        if (glob === "refs/remotes/shared/feat/*") {
          return "shared/feat/example";
        }
        return "";
      }

      if (args[0] === "rev-list" && args[1] === "--left-right") {
        return `0 ${carryRight}`;
      }

      if (args[0] === "rev-parse") {
        const value = args[1] ?? "";
        return shaMap[value] ?? `${value}${"0".repeat(Math.max(0, 40 - value.length))}`;
      }

      if (args[0] === "cherry") {
        const ref = args.at(-1) ?? "";
        if (ref === "origin/pr/example") {
          return prCherryRaw;
        }
        return "";
      }

      if (args[0] === "rev-list" && args[1] === "--reverse") {
        const range = args.at(-1) ?? "";
        const ref = range.split("..")[1] ?? "";
        if (ref === "origin/pr/example") {
          return prRevList.join("\n");
        }
        return "";
      }

      if (args[0] === "read-tree") {
        return "";
      }

      if (args[0] === "format-patch") {
        const sha = args.at(-1) ?? "";
        return `From ${sha}\n\n`;
      }

      if (args[0] === "apply") {
        const patch = optionsExec?.input ?? "";
        const match = patch.match(/^From ([0-9a-f]{40})/m);
        const sha = match?.[1];
        if (sha && applyFailures.has(sha)) {
          throw new Error(`apply failed for ${sha}`);
        }
        return "";
      }

      throw new Error(`Unexpected git invocation: ${args.join(" ")}`);
    },
    readTextFile: () => "carry/ops\n",
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  };

  return {
    deps,
    readStdout: () => stdout.join(""),
    readStderr: () => stderr.join(""),
  };
}

describe("ikentic branch inventory cli behavior", () => {
  it("returns code 3 on unknown args", () => {
    const { deps, readStderr } = createMockDeps();
    const code = runInventoryCli(["--nope"], deps);
    expect(code).toBe(3);
    expect(readStderr()).toContain("Unknown argument");
  });

  it("returns code 2 when required carry lanes are missing commits", () => {
    const { deps, readStdout } = createMockDeps({ carryRight: 5 });
    const code = runInventoryCli(["--format", "table"], deps);
    expect(code).toBe(2);
    expect(readStdout()).toContain("Carry blocking missing: 1");
  });

  it("classifies missing PR commits as review-required when patch application fails", () => {
    const prCherryRaw = "+ abcdef1 Commit one\n+ abcdef2 Commit two\n";
    const prRevList = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ];
    const { deps, readStdout } = createMockDeps({
      prCherryRaw,
      prRevList,
      applyFailures: new Set(["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]),
    });
    const code = runInventoryCli(["--format", "table"], deps);
    expect(code).toBe(2);
    const output = readStdout();
    expect(output).toContain("origin/pr/example");
    expect(output).toContain("REVIEW_REQUIRED");
    expect(output).toContain("bbbbbbbbbbbb");
    expect(output).toContain("# origin/pr/example (REVIEW_REQUIRED)");
    expect(output).toContain("aaaaaaaaaaaa");
    expect(output).toContain("bbbbbbbbbbbb");
  });

  it("does not treat '-' cherry entries as missing commits", () => {
    const prCherryRaw = "- c0ffee1 Already present\n+ abcdef1 Commit one\n";
    const prRevList = [
      "cccccccccccccccccccccccccccccccccccccccc",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ];
    const { deps, readStdout } = createMockDeps({
      prCherryRaw,
      prRevList,
    });
    const code = runInventoryCli(["--format", "table"], deps);
    expect(code).toBe(2);
    const output = readStdout();
    expect(output).toContain("Missing PR commits: 1 across 1 branches");
    expect(output).toContain("aaaaaaaaaaaa");
    expect(output).not.toContain("cccccccccccc");
  });
});
