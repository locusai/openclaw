#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type OutputFormat = "table" | "json";
export type LaneClassification = "BLOCKING_MISSING" | "ADVISORY_MISSING" | "CONTAINED";

export interface AuditArgs {
  integrationRef: string;
  requiredLanesFile: string;
  format: OutputFormat;
}

export interface LaneAudit {
  lane: string;
  required: boolean;
  left: number;
  right: number;
  classification: LaneClassification;
}

export interface AuditSummary {
  integrationRef: string;
  requiredLanesFile: string;
  requiredLanes: string[];
  lanes: LaneAudit[];
  blockingMissingCount: number;
  advisoryMissingCount: number;
  containedCount: number;
}

export interface CliDeps {
  execGit: (args: string[]) => string;
  readTextFile: (filePath: string) => string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const DEFAULT_INTEGRATION_REF = "origin/integration/ikentic";
const DEFAULT_REQUIRED_LANES_FILE = "docs/ikentic/required-lanes.txt";
const DEFAULT_FORMAT: OutputFormat = "table";
const EXIT_SUCCESS = 0;
const EXIT_BLOCKING_MISSING = 2;
const EXIT_CONFIG_ERROR = 3;
const CARRY_LANE_PATTERN = /^carry\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const defaultDeps: CliDeps = {
  execGit: (args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
  readTextFile: (filePath) => readFileSync(filePath, "utf8"),
  stdout: (message) => {
    process.stdout.write(message);
  },
  stderr: (message) => {
    process.stderr.write(message);
  },
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

export function classifyLane(required: boolean, right: number): LaneClassification {
  if (right > 0) {
    return required ? "BLOCKING_MISSING" : "ADVISORY_MISSING";
  }
  return "CONTAINED";
}

export function isValidCarryLaneName(lane: string): boolean {
  if (!CARRY_LANE_PATTERN.test(lane)) {
    return false;
  }
  if (lane.includes("..") || lane.endsWith("/")) {
    return false;
  }
  return true;
}

export function parseRequiredLanes(raw: string): string[] {
  const lanes: string[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];

  const lines = raw.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const cleaned = line.split("#", 1)[0]?.trim() ?? "";
    if (!cleaned) {
      continue;
    }
    if (!isValidCarryLaneName(cleaned)) {
      invalid.push(`line ${index + 1}: ${cleaned}`);
      continue;
    }
    if (seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    lanes.push(cleaned);
  }

  if (invalid.length > 0) {
    throw new Error(
      `Malformed required lane names in policy file: ${invalid.join(", ")}. Expected carry/<name>.`,
    );
  }

  return lanes;
}

function parseCountPair(raw: string, laneRef: string): { left: number; right: number } {
  const pieces = raw.trim().split(/\s+/);
  if (pieces.length !== 2) {
    throw new Error(`Unexpected divergence output for ${laneRef}: ${raw}`);
  }
  const left = Number.parseInt(pieces[0], 10);
  const right = Number.parseInt(pieces[1], 10);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error(`Non-numeric divergence output for ${laneRef}: ${raw}`);
  }
  return { left, right };
}

export function listOriginCarryLanes(deps: Pick<CliDeps, "execGit">): string[] {
  const raw = deps.execGit([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes/origin/carry/*",
  ]);
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((refName) => (refName.startsWith("origin/") ? refName.slice("origin/".length) : refName))
    .toSorted((a, b) => a.localeCompare(b));
}

export function runAudit(
  args: AuditArgs,
  deps: Pick<CliDeps, "execGit" | "readTextFile">,
): AuditSummary {
  const requiredRaw = deps.readTextFile(args.requiredLanesFile);
  const requiredLanes = parseRequiredLanes(requiredRaw);
  const carryLanes = listOriginCarryLanes(deps);
  const carryLaneSet = new Set(carryLanes);

  for (const lane of requiredLanes) {
    if (!carryLaneSet.has(lane)) {
      throw new Error(`Required lane ${lane} was not found on origin.`);
    }
  }

  const requiredSet = new Set(requiredLanes);
  const lanes: LaneAudit[] = carryLanes.map((lane) => {
    const laneRef = `origin/${lane}`;
    const rawDivergence = deps.execGit([
      "rev-list",
      "--left-right",
      "--count",
      `${args.integrationRef}...${laneRef}`,
    ]);
    const { left, right } = parseCountPair(rawDivergence, laneRef);
    const required = requiredSet.has(lane);
    return {
      lane,
      required,
      left,
      right,
      classification: classifyLane(required, right),
    };
  });

  return {
    integrationRef: args.integrationRef,
    requiredLanesFile: args.requiredLanesFile,
    requiredLanes,
    lanes,
    blockingMissingCount: lanes.filter((lane) => lane.classification === "BLOCKING_MISSING").length,
    advisoryMissingCount: lanes.filter((lane) => lane.classification === "ADVISORY_MISSING").length,
    containedCount: lanes.filter((lane) => lane.classification === "CONTAINED").length,
  };
}

function renderTable(summary: AuditSummary): string {
  const headers = ["Lane", "Required", "Left", "Right", "Classification"];
  const rows = summary.lanes.map((lane) => [
    lane.lane,
    lane.required ? "yes" : "no",
    String(lane.left),
    String(lane.right),
    lane.classification,
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index], " "))
      .join("  ")
      .trimEnd();

  const lines = [
    `Integration Ref: ${summary.integrationRef}`,
    `Required Lanes File: ${summary.requiredLanesFile}`,
    "",
    formatRow(headers),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...rows.map(formatRow),
    "",
    `BLOCKING_MISSING=${summary.blockingMissingCount} ADVISORY_MISSING=${summary.advisoryMissingCount} CONTAINED=${summary.containedCount}`,
  ];

  return `${lines.join("\n")}\n`;
}

export function parseArgs(argv: string[]): AuditArgs {
  const parsed: AuditArgs = {
    integrationRef: DEFAULT_INTEGRATION_REF,
    requiredLanesFile: DEFAULT_REQUIRED_LANES_FILE,
    format: DEFAULT_FORMAT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--integration-ref") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --integration-ref.");
      }
      parsed.integrationRef = value;
      index += 1;
      continue;
    }
    if (arg === "--required-lanes-file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --required-lanes-file.");
      }
      parsed.requiredLanesFile = value;
      index += 1;
      continue;
    }
    if (arg === "--format") {
      const value = argv[index + 1];
      if (value !== "table" && value !== "json") {
        throw new Error("Invalid value for --format. Expected table or json.");
      }
      parsed.format = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function runAuditCli(argv: string[], deps: CliDeps = defaultDeps): number {
  let args: AuditArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    deps.stderr(`ikentic-branch-gap-audit: ${toErrorMessage(error)}\n`);
    return EXIT_CONFIG_ERROR;
  }

  let summary: AuditSummary;
  try {
    summary = runAudit(args, deps);
  } catch (error) {
    deps.stderr(`ikentic-branch-gap-audit: ${toErrorMessage(error)}\n`);
    return EXIT_CONFIG_ERROR;
  }

  if (args.format === "json") {
    deps.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    deps.stdout(renderTable(summary));
  }

  return summary.blockingMissingCount > 0 ? EXIT_BLOCKING_MISSING : EXIT_SUCCESS;
}

function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return moduleUrl === pathToFileURL(entry).href;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runAuditCli(process.argv.slice(2));
}
