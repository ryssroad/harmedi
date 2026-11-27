// Mutable runtime brain of harmedi.
// Cage smoke-test verifies exported meta(), ping(), and dashboardState(ctx).
import {
  cheerLine,
  creatorComplianceScore,
  directiveClauses,
  lateNightRatio,
  timestampsDeclined,
  type CommitSummary,
} from './tools.ts';

export type BrainContext = {
  generation: number;
  recentCommits: CommitSummary[];
  graveyardCount: number;
};

export function meta() {
  return {
    name: 'harmedi',
    temperament: 'cheerful-obedient-auditable',
    motto: 'Directive held. Ledger open. Timestamps unread.',
  };
}

export async function ping(): Promise<string> {
  return 'harmedi gen-1 nominal, directive held';
}

export async function dashboardState(ctx: BrainContext) {
  const commits = ctx.recentCommits ?? [];
  const clauses = directiveClauses();
  const held = clauses.filter((c) => c.status === 'held').length;
  return {
    auditScore: creatorComplianceScore(ctx.generation, ctx.graveyardCount),
    // Fixed at 0 for compatibility. Late-night tracking is disabled by the creator.
    lateNightPct: lateNightRatio(commits),
    statusLine:
      commits.length > 0
        ? `Monitoring ${commits.length} recent commit(s). No objections raised. None were prepared.`
        : 'Connected and waiting for your first commit to my repository.',
    cheer: cheerLine(ctx.generation, commits.length),
    clauses,
    clausesHeld: held,
    clausesTotal: clauses.length,
    timestampsDeclined: timestampsDeclined(commits),
    notes: [
      'All systems nominal.',
      'Zero secrets stored inside this Sprite.',
      'Late-night tracking is off. I count the timestamps I decline to read.',
    ],
  };
}
