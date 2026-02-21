import { describe, expect, it } from "vitest";
import { runInventoryCli, type CliDeps } from "../scripts/ikentic-branch-inventory";

function createMockDeps(options?: {
  carryRight?: number;
  prCherryRaw?: string;
  prRevList?: string[];
  applyFailures?: Set<string>;
  ancestryPairs?: Array<[string, string]>;
  commitFilesBySha?: Record<string, string[]>;
  blobByRefPath?: Record<string, string>;
}) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const carryRight = options?.carryRight ?? 0;
  const prCherryRaw = options?.prCherryRaw ?? "";
  const prRevList = options?.prRevList ?? [];
  const applyFailures = options?.applyFailures ?? new Set<string>();
  const ancestryPairs = new Set((options?.ancestryPairs ?? []).map(([a, b]) => `${a}->${b}`));
  const commitFilesBySha = options?.commitFilesBySha ?? {};
  const blobByRefPath = options?.blobByRefPath ?? {};

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

  const defaultFilesBySha: Record<string, string[]> = {
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: ["a.ts"],
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: ["b.ts"],
    cccccccccccccccccccccccccccccccccccccccc: ["c.ts"],
  };

  const defaultBlobByRefPath: Record<string, string> = {
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:a.ts": "blob-a",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:b.ts": "blob-b",
    "cccccccccccccccccccccccccccccccccccccccc:c.ts": "blob-c",
    "origin/integration/ikentic:a.ts": "blob-int-a",
    "origin/integration/ikentic:b.ts": "blob-int-b",
    "origin/integration/ikentic:c.ts": "blob-int-c",
    "HEAD:a.ts": "blob-head-a",
    "HEAD:b.ts": "blob-head-b",
    "HEAD:c.ts": "blob-head-c",
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
        if (value in blobByRefPath) {
          return blobByRefPath[value];
        }
        if (value in defaultBlobByRefPath) {
          return defaultBlobByRefPath[value];
        }
        return shaMap[value] ?? `${value}${"0".repeat(Math.max(0, 40 - value.length))}`;
      }

      if (args[0] === "show" && args[1] === "--pretty=" && args[2] === "--name-only") {
        const sha = args[3] ?? "";
        return (commitFilesBySha[sha] ?? defaultFilesBySha[sha] ?? []).join("\n");
      }

      if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
        const ancestor = args[2] ?? "";
        const descendant = args[3] ?? "";
        if (ancestryPairs.has(`${ancestor}->${descendant}`)) {
          return "";
        }
        throw new Error("not ancestor");
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

  it("filters missing commits superseded by equivalent descendants", () => {
    const prCherryRaw =
      "+ abcdef1 Commit one\n+ abcdef2 Commit two\n- c0ffee1 Replacement commit\n";
    const prRevList = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "cccccccccccccccccccccccccccccccccccccccc",
    ];
    const { deps, readStdout } = createMockDeps({
      prCherryRaw,
      prRevList,
      ancestryPairs: [
        ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "cccccccccccccccccccccccccccccccccccccccc"],
        ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccccccccccc"],
      ],
    });
    const code = runInventoryCli(["--format", "table"], deps);
    expect(code).toBe(0);
    expect(readStdout()).toContain("Missing PR commits: 0 across 0 branches");
  });

  it("filters missing commits with no net file diff against integration", () => {
    const prCherryRaw = "+ abcdef1 Commit one\n";
    const prRevList = ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
    const { deps, readStdout } = createMockDeps({
      prCherryRaw,
      prRevList,
      commitFilesBySha: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: ["same.ts"],
      },
      blobByRefPath: {
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:same.ts": "blob-same",
        "origin/integration/ikentic:same.ts": "blob-same",
      },
    });
    const code = runInventoryCli(["--format", "table"], deps);
    expect(code).toBe(0);
    expect(readStdout()).toContain("Missing PR commits: 0 across 0 branches");
  });
});
