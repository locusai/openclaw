export type RefreshDecisionInput = {
  requestedSpec: string;
  installedVersion?: string;
  previousRequestedSpec?: string;
  resolvedTargetVersion?: string;
};

export type RefreshDecision = {
  refresh: boolean;
  reason: string;
};

export function decideNpmRefresh(input: RefreshDecisionInput): RefreshDecision;
