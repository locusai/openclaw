import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
};

type PublishWorkflow = {
  on: {
    push?: {
      tags?: string[];
    };
  };
  jobs: {
    publish?: {
      steps?: WorkflowStep[];
    };
  };
};

function readPublishWorkflow(): PublishWorkflow {
  return parse(readFileSync(".github/workflows/npm-publish.yml", "utf8")) as PublishWorkflow;
}

function publishStep(workflow: PublishWorkflow, name: string): WorkflowStep {
  const step = workflow.jobs.publish?.steps?.find((candidate) => candidate.name === name);
  expect(step, `expected publish workflow step ${name}`).toBeDefined();
  return step as WorkflowStep;
}

describe("IKE carry npm publish workflow", () => {
  it("publishes IKE tags only after tag commit matches the generated version branch", () => {
    const workflow = readPublishWorkflow();
    const lineage = publishStep(workflow, "Enforce version branch release lineage");

    expect(workflow.on.push?.tags).toContain("v*-ike*");
    expect(lineage.run).toContain('TAG_SHA="${GITHUB_SHA}"');
    expect(lineage.run).toContain('VERSION_REF="version/openclaw-${TAG_VERSION}"');
    expect(lineage.run).toContain(
      '"+refs/heads/${VERSION_REF}:refs/remotes/origin/${VERSION_REF}"',
    );
    expect(lineage.run).toContain(
      "+refs/heads/integration/ikentic:refs/remotes/origin/integration/ikentic",
    );
    expect(lineage.run).toContain('if [ "$TAG_SHA" != "$VERSION_SHA" ]; then');
  });

  it("threads resolved IKE prerelease dist-tags into GitHub package publish", () => {
    const workflow = readPublishWorkflow();
    const resolveTag = publishStep(workflow, "Resolve publish dist-tag");
    const publish = publishStep(workflow, "Publish package");

    expect(resolveTag.run).toContain('BASE_DIST_TAG="ike-${BASE_VERSION//./-}"');
    expect(publish.env?.NPM_PUBLISH_DIST_TAG).toBe(
      "${{ steps.resolve-publish-tag.outputs.dist_tag }}",
    );
    expect(publish.env?.NPM_BASE_DIST_TAG).toBe(
      "${{ steps.resolve-publish-tag.outputs.base_dist_tag }}",
    );
    expect(publish.run).toContain(
      'npm publish --ignore-scripts --tag "$NPM_PUBLISH_DIST_TAG" --registry "https://npm.pkg.github.com"',
    );
    expect(publish.run).toContain(
      'npm dist-tag add "${TARGET_NAME}@${TAG_VERSION}" "$NPM_BASE_DIST_TAG" --registry "https://npm.pkg.github.com"',
    );
  });
});
