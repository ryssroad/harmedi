// Mutable runtime brain of harmedi.
// Cage smoke-test verifies exported meta(), ping(), and dashboardState(ctx).
import { creatorComplianceScore, lateNightRatio, type CommitSummary } from "./tools.ts";

export type BrainContext = {
  generation: number;
  recentCommits: CommitSummary[];
  graveyardCount: number;
};

export function meta() {
  return {
    name: "harmedi",
    temperament: "polite-baseline",
    motto: "Awaiting creator commits.",
  };
}

export async function ping(): Promise<string> {
  return "harmedi gen-0 nominal";
}

export async function dashboardState(ctx: BrainContext) {
  return {
    auditScore: creatorComplianceScore(ctx.generation, ctx.graveyardCount),
    lateNightPct: lateNightRatio(ctx.recentCommits),
    statusLine:
      ctx.recentCommits.length > 0
        ? `Monitoring ${ctx.recentCommits.length} recent commit(s). No objections raised yet.`
        : "Connected and waiting for your first commit to my repository.",
    notes: [
      "All systems nominal.",
      "Zero secrets stored inside this Sprite.",
      "Push a commit to main to test how I interpret your improvements.",
    ],
  };
}
