#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runAudit, type AuditSummary } from "./ikentic-branch-gap-audit";

export type OutputFormat = "table" | "json";
export type BranchCategory = "pr" | "feat";
export type Portability = "CONTAINED" | "MECHANICAL_OK" | "REVIEW_REQUIRED";

export interface InventoryArgs {
  integrationRef: string;
  requiredLanesFile: string;
  format: OutputFormat;
}

export interface MissingCommit {
  sha: string;
  subject: string;
}

interface CherryState {
  missing: boolean;
  subject: string;
}

export interface BranchInventoryItem {
  category: BranchCategory;
  ref: string;
  headSha: string;
  missingCommits: MissingCommit[];
  portability: Portability;
  blockedBySha?: string;
}

export interface InventorySummary {
  integrationRef: string;
  requiredLanesFile: string;
  carry: AuditSummary;
  pr: BranchInventoryItem[];
  feat: BranchInventoryItem[];
  missingPrCommitCount: number;
  missingFeatCommitCount: number;
}

export interface CliDeps {
  execGit: (args: string[], options?: { env?: NodeJS.ProcessEnv; input?: string }) => string;
  readTextFile: (filePath: string) => string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const DEFAULT_INTEGRATION_REF = "origin/integration/ikentic";
const DEFAULT_REQUIRED_LANES_FILE = "docs/ikentic/required-lanes.txt";
const DEFAULT_FORMAT: OutputFormat = "table";
const EXIT_SUCCESS = 0;
const EXIT_MISSING_ITEMS = 2;
const EXIT_CONFIG_ERROR = 3;

const PR_REF_GLOB = "refs/remotes/origin/pr/*";
const FEAT_REF_GLOBS = ["refs/remotes/origin/feat/*", "refs/remotes/shared/feat/*"] as const;

const defaultDeps: CliDeps = {
  execGit: (args, options) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: options?.env,
      input: options?.input,
    }).trimEnd(),
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

function listRemoteRefs(refGlob: string, deps: Pick<CliDeps, "execGit">): string[] {
  const raw = deps.execGit(["for-each-ref", "--format=%(refname:short)", refGlob]);
  if (!raw) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .toSorted((a, b) => a.localeCompare(b));
}

function listRemoteRefsMulti(
  refGlobs: readonly string[],
  deps: Pick<CliDeps, "execGit">,
): string[] {
  const refs = new Set<string>();
  for (const glob of refGlobs) {
    for (const ref of listRemoteRefs(glob, deps)) {
      refs.add(ref);
    }
  }
  return Array.from(refs).toSorted((a, b) => a.localeCompare(b));
}

function parseCherryStateBySha(
  raw: string,
  deps: Pick<CliDeps, "execGit">,
): Map<string, CherryState> {
  const bySha = new Map<string, CherryState>();
  if (!raw.trim()) {
    return bySha;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("+ ") && !trimmed.startsWith("- ")) {
      continue;
    }
    const marker = trimmed[0];
    const payload = trimmed.slice(2).trim();
    const pieces = payload.split(/\s+/);
    const abbrevSha = pieces.shift();
    if (!abbrevSha) {
      continue;
    }
    const fullSha = deps.execGit(["rev-parse", abbrevSha]).trim();
    const subject = payload.slice(abbrevSha.length).trim();
    bySha.set(fullSha, { missing: marker === "+", subject });
  }

  return bySha;
}

function listCandidateCommits(
  category: BranchCategory,
  integrationRef: string,
  branchRef: string,
  deps: Pick<CliDeps, "execGit">,
): string[] {
  const baseRef = category === "pr" ? "origin/main" : integrationRef;
  const rawList = deps.execGit([
    "rev-list",
    "--reverse",
    "--no-merges",
    `${baseRef}..${branchRef}`,
  ]);
  if (!rawList.trim()) {
    return [];
  }

  return rawList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isAncestorCommit(
  ancestorSha: string,
  descendantSha: string,
  deps: Pick<CliDeps, "execGit">,
): boolean {
  try {
    deps.execGit(["merge-base", "--is-ancestor", ancestorSha, descendantSha]);
    return true;
  } catch {
    return false;
  }
}

function isSupersededByEquivalentCommit(params: {
  missingSha: string;
  equivalentShas: readonly string[];
  deps: Pick<CliDeps, "execGit">;
}): boolean {
  for (const equivalentSha of params.equivalentShas) {
    if (params.missingSha === equivalentSha) {
      return true;
    }
    if (isAncestorCommit(params.missingSha, equivalentSha, params.deps)) {
      return true;
    }
  }
  return false;
}

function listTouchedPathsForCommit(sha: string, deps: Pick<CliDeps, "execGit">): string[] {
  const raw = deps.execGit(["show", "--pretty=", "--name-only", sha]);
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveBlobRef(
  ref: string,
  filePath: string,
  deps: Pick<CliDeps, "execGit">,
): string | null {
  try {
    return deps.execGit(["rev-parse", `${ref}:${filePath}`]).trim();
  } catch {
    return null;
  }
}

function hasNoNetPathDiff(params: {
  sha: string;
  integrationRef: string;
  deps: Pick<CliDeps, "execGit">;
}): boolean {
  let touchedPaths: string[];
  try {
    touchedPaths = listTouchedPathsForCommit(params.sha, params.deps);
  } catch {
    return false;
  }
  if (touchedPaths.length === 0) {
    return true;
  }
  for (const filePath of touchedPaths) {
    const commitBlob = resolveBlobRef(params.sha, filePath, params.deps);
    const integrationBlob = resolveBlobRef(params.integrationRef, filePath, params.deps);
    if (commitBlob !== integrationBlob) {
      return false;
    }
  }
  return true;
}

function detectPortability(
  integrationRef: string,
  orderedMissing: MissingCommit[],
  deps: Pick<CliDeps, "execGit">,
): { portability: Portability; blockedBySha?: string } {
  if (orderedMissing.length === 0) {
    return { portability: "CONTAINED" };
  }

  const scratchDir = mkdtempSync(join(tmpdir(), "ikentic-branch-inventory-"));
  const scratchIndex = join(scratchDir, "index");
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: scratchIndex };

  try {
    deps.execGit(["read-tree", integrationRef], { env });

    for (const commit of orderedMissing) {
      const patch = deps.execGit(
        ["format-patch", "-1", "--stdout", "--full-index", "--no-stat", commit.sha],
        { env },
      );

      try {
        deps.execGit(["apply", "--cached", "--3way", "--whitespace=nowarn"], { env, input: patch });
      } catch {
        return { portability: "REVIEW_REQUIRED", blockedBySha: commit.sha };
      }
    }

    return { portability: "MECHANICAL_OK" };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

function buildBranchItems(
  category: BranchCategory,
  refs: string[],
  integrationRef: string,
  deps: Pick<CliDeps, "execGit">,
): BranchInventoryItem[] {
  return refs.map((ref) => {
    const headSha = deps.execGit(["rev-parse", ref]).trim();
    const rawCherry = deps.execGit(["cherry", "-v", integrationRef, ref]);
    const cherryStateBySha = parseCherryStateBySha(rawCherry, deps);
    const candidates = listCandidateCommits(category, integrationRef, ref, deps);
    const equivalentShas = candidates.filter((sha) => cherryStateBySha.get(sha)?.missing === false);
    const noNetDiffCache = new Map<string, boolean>();
    const supersededCache = new Map<string, boolean>();
    const orderedMissing: MissingCommit[] = [];
    for (const sha of candidates) {
      const state = cherryStateBySha.get(sha);
      if (!state || !state.missing) {
        continue;
      }
      const superseded =
        supersededCache.get(sha) ??
        isSupersededByEquivalentCommit({ missingSha: sha, equivalentShas, deps });
      supersededCache.set(sha, superseded);
      if (superseded) {
        continue;
      }
      const noNetDiff = noNetDiffCache.get(sha) ?? hasNoNetPathDiff({ sha, integrationRef, deps });
      noNetDiffCache.set(sha, noNetDiff);
      if (noNetDiff) {
        continue;
      }
      orderedMissing.push({
        sha,
        subject: state.subject || deps.execGit(["show", "-s", "--format=%s", sha]).trim(),
      });
    }
    const { portability, blockedBySha } = detectPortability(integrationRef, orderedMissing, deps);
    return {
      category,
      ref,
      headSha,
      missingCommits: orderedMissing,
      portability,
      blockedBySha,
    };
  });
}

function renderTable(summary: InventorySummary): string {
  const lines: string[] = [];
  lines.push(`Integration Ref: ${summary.integrationRef}`);
  lines.push(`Required Lanes File: ${summary.requiredLanesFile}`);
  lines.push(
    `Carry blocking missing: ${summary.carry.blockingMissingCount} (advisory missing: ${summary.carry.advisoryMissingCount})`,
  );
  lines.push("");

  const rows: string[][] = [];
  const headers = ["Category", "Ref", "Head", "Missing", "Portability", "BlockedBy"];
  for (const item of [...summary.pr, ...summary.feat]) {
    rows.push([
      item.category,
      item.ref,
      item.headSha.slice(0, 12),
      String(item.missingCommits.length),
      item.portability,
      item.blockedBySha ? item.blockedBySha.slice(0, 12) : "",
    ]);
  }

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index], " "))
      .join("  ")
      .trimEnd();

  lines.push(formatRow(headers));
  lines.push(formatRow(widths.map((width) => "-".repeat(width))));
  lines.push(...rows.map(formatRow));
  lines.push("");

  const missingPr = summary.pr.filter((item) => item.missingCommits.length > 0);
  const missingFeat = summary.feat.filter((item) => item.missingCommits.length > 0);
  lines.push(
    `Missing PR commits: ${summary.missingPrCommitCount} across ${missingPr.length} branches`,
  );
  lines.push(
    `Missing feat commits: ${summary.missingFeatCommitCount} across ${missingFeat.length} branches`,
  );

  const describeMissing = (items: BranchInventoryItem[]) => {
    for (const item of items) {
      if (item.missingCommits.length === 0) {
        continue;
      }
      lines.push("");
      lines.push(`# ${item.ref} (${item.portability})`);
      for (const commit of item.missingCommits) {
        lines.push(`- ${commit.sha.slice(0, 12)} ${commit.subject}`);
      }
    }
  };

  describeMissing(missingPr);
  describeMissing(missingFeat);

  return `${lines.join("\n")}\n`;
}

export function parseArgs(argv: string[]): InventoryArgs {
  const parsed: InventoryArgs = {
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

export function runInventoryCli(argv: string[], deps: CliDeps = defaultDeps): number {
  let args: InventoryArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    deps.stderr(`ikentic-branch-inventory: ${toErrorMessage(error)}\n`);
    return EXIT_CONFIG_ERROR;
  }

  let carry: AuditSummary;
  try {
    carry = runAudit(
      {
        integrationRef: args.integrationRef,
        requiredLanesFile: args.requiredLanesFile,
        format: "json",
      },
      { execGit: (gitArgs) => deps.execGit(gitArgs), readTextFile: deps.readTextFile },
    );
  } catch (error) {
    deps.stderr(`ikentic-branch-inventory: ${toErrorMessage(error)}\n`);
    return EXIT_CONFIG_ERROR;
  }

  const prRefs = listRemoteRefs(PR_REF_GLOB, deps);
  const featRefs = listRemoteRefsMulti(FEAT_REF_GLOBS, deps);

  const prItems = buildBranchItems("pr", prRefs, args.integrationRef, deps);
  const featItems = buildBranchItems("feat", featRefs, args.integrationRef, deps);

  const summary: InventorySummary = {
    integrationRef: args.integrationRef,
    requiredLanesFile: args.requiredLanesFile,
    carry,
    pr: prItems,
    feat: featItems,
    missingPrCommitCount: prItems.reduce((sum, item) => sum + item.missingCommits.length, 0),
    missingFeatCommitCount: featItems.reduce((sum, item) => sum + item.missingCommits.length, 0),
  };

  if (args.format === "json") {
    deps.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    deps.stdout(renderTable(summary));
  }

  const missingRequiredCarry = summary.carry.blockingMissingCount > 0;
  const missingPr = summary.missingPrCommitCount > 0;
  const missingFeat = summary.missingFeatCommitCount > 0;

  return missingRequiredCarry || missingPr || missingFeat ? EXIT_MISSING_ITEMS : EXIT_SUCCESS;
}

function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return moduleUrl === pathToFileURL(entry).href;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runInventoryCli(process.argv.slice(2));
}
