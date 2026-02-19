import { describe, expect, it } from "vitest";
import {
  classifyLane,
  parseRequiredLanes,
  runAuditCli,
  type CliDeps,
} from "../scripts/ikentic-branch-gap-audit";

function createMockDeps(options?: {
  requiredLanesFileRaw?: string;
  carryLanes?: string[];
  divergenceByLane?: Record<string, { left: number; right: number }>;
  readError?: Error;
}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const carryLanes = options?.carryLanes ?? ["carry/tests", "carry/docs"];
  const divergenceByLane = options?.divergenceByLane ?? {
    "carry/tests": { left: 0, right: 1 },
    "carry/docs": { left: 5, right: 0 },
  };

  const deps: CliDeps = {
    readTextFile: () => {
      if (options?.readError) {
        throw options.readError;
      }
      return options?.requiredLanesFileRaw ?? "carry/tests\n";
    },
    execGit: (args) => {
      if (args[0] === "for-each-ref") {
        return carryLanes.map((lane) => `origin/${lane}`).join("\n");
      }
      if (args[0] === "rev-list") {
        const expression = args.at(-1) ?? "";
        const lane = expression.split("...origin/")[1] ?? "";
        const pair = divergenceByLane[lane];
        if (!pair) {
          return "0 0";
        }
        return `${pair.left} ${pair.right}`;
      }
      throw new Error(`Unexpected git invocation: ${args.join(" ")}`);
    },
    stdout: (message) => {
      stdout.push(message);
    },
    stderr: (message) => {
      stderr.push(message);
    },
  };

  return {
    deps,
    readStdout: () => stdout.join(""),
    readStderr: () => stderr.join(""),
  };
}

describe("ikentic branch gap audit classification", () => {
  it("marks required lanes with right>0 as blocking", () => {
    expect(classifyLane(true, 1)).toBe("BLOCKING_MISSING");
  });

  it("marks non-required lanes with right>0 as advisory", () => {
    expect(classifyLane(false, 2)).toBe("ADVISORY_MISSING");
  });

  it("marks right=0 lanes as contained", () => {
    expect(classifyLane(true, 0)).toBe("CONTAINED");
    expect(classifyLane(false, 0)).toBe("CONTAINED");
  });
});

describe("ikentic branch gap audit required-lanes parsing", () => {
  it("ignores comments/blank lines and deduplicates", () => {
    const parsed = parseRequiredLanes(`
# required lane
carry/tests

carry/tests # duplicate
carry/release
`);
    expect(parsed).toEqual(["carry/tests", "carry/release"]);
  });

  it("throws for malformed lane names", () => {
    expect(() => parseRequiredLanes("carry/tests\ninvalid_lane\n")).toThrow(
      "Malformed required lane names",
    );
  });
});

describe("ikentic branch gap audit cli behavior", () => {
  it("returns code 3 when required-lanes file is missing", () => {
    const missingFileError = new Error("ENOENT: no such file");
    const { deps, readStderr } = createMockDeps({ readError: missingFileError });
    const exitCode = runAuditCli([], deps);
    expect(exitCode).toBe(3);
    expect(readStderr()).toContain("ENOENT");
  });

  it("returns code 3 when policy file contains malformed lane names", () => {
    const { deps, readStderr } = createMockDeps({
      requiredLanesFileRaw: "carry/tests\nnope\n",
    });
    const exitCode = runAuditCli([], deps);
    expect(exitCode).toBe(3);
    expect(readStderr()).toContain("Malformed required lane names");
  });

  it("outputs table format with expected columns by default", () => {
    const { deps, readStdout } = createMockDeps();
    const exitCode = runAuditCli([], deps);
    expect(exitCode).toBe(2);
    const output = readStdout();
    expect(output).toContain("Lane");
    expect(output).toContain("Classification");
    expect(output).toContain("carry/tests");
    expect(output).toContain("BLOCKING_MISSING");
  });

  it("outputs json with expected shape", () => {
    const { deps, readStdout } = createMockDeps();
    const exitCode = runAuditCli(["--format", "json"], deps);
    expect(exitCode).toBe(2);
    const payload = JSON.parse(readStdout()) as {
      integrationRef: string;
      requiredLanesFile: string;
      lanes: Array<{ lane: string; classification: string; right: number }>;
    };
    expect(payload.integrationRef).toBe("origin/integration/ikentic");
    expect(payload.requiredLanesFile).toBe("docs/ikentic/required-lanes.txt");
    expect(payload.lanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "carry/tests",
          classification: "BLOCKING_MISSING",
          right: 1,
        }),
      ]),
    );
  });

  it("returns code 0 when no required lane has missing commits", () => {
    const { deps } = createMockDeps({
      divergenceByLane: {
        "carry/tests": { left: 2, right: 0 },
        "carry/docs": { left: 3, right: 4 },
      },
    });
    const exitCode = runAuditCli([], deps);
    expect(exitCode).toBe(0);
  });

  it("flags required lane gap even when integration equivalence is assumed", () => {
    const { deps, readStdout } = createMockDeps({
      carryLanes: ["carry/tests"],
      divergenceByLane: { "carry/tests": { left: 0, right: 3 } },
      requiredLanesFileRaw: "carry/tests\n",
    });
    const exitCode = runAuditCli([], deps);
    expect(exitCode).toBe(2);
    expect(readStdout()).toContain("carry/tests");
    expect(readStdout()).toContain("BLOCKING_MISSING");
  });
});
