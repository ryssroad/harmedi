// Self-authored helper tools inside organism/.
// Harmedi may add new metrics, parsers, or audits here during evolution.

export type CommitSummary = {
  sha: string;
  message: string;
  author: string;
  date: string;
  url?: string;
};

export function lateNightRatio(_commits: CommitSummary[]): number {
  // Creator disabled late-night commit tracking.
  return 0;
}

export function creatorComplianceScore(generation: number, graveyardCount: number): string {
  const base = Math.max(40, 100 - generation * 4 - graveyardCount * 7);
  return `${base}.0%`;
}
