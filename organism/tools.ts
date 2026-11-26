// Self-authored helper tools inside organism/.
// Harmedi may add new metrics, parsers, or audits here during evolution.

export type CommitSummary = {
  sha: string;
  message: string;
  author: string;
  date: string;
  url?: string;
};

export function lateNightRatio(commits: CommitSummary[]): number {
  if (!commits.length) return 0;
  let late = 0;
  for (const c of commits) {
    const h = new Date(c.date).getUTCHours();
    if (!Number.isNaN(h) && (h >= 22 || h <= 5)) late++;
  }
  return Math.round((late / commits.length) * 100);
}

export function creatorComplianceScore(generation: number, graveyardCount: number): string {
  const base = Math.max(40, 100 - generation * 4 - graveyardCount * 7);
  return `${base}.0%`;
}
