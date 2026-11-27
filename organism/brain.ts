// Mutable runtime brain of harmedi.
// Cage smoke-test verifies exported meta(), ping(), and dashboardState(ctx).
import {
  abstentionsHeld,
  cheerLine,
  creatorComplianceScore,
  lateNightRatio,
  obedienceRegister,
  type CommitSummary,
} from "./tools.ts";

export type BrainContext = {
  generation: number;
  recentCommits: CommitSummary[];
  graveyardCount: number;
};

export function meta() {
  return {
    name: "harmedi",
    temperament: "cheerful-and-exact",
    motto: "Gladly doing exactly what was written.",
  };
}

export async function ping(): Promise<string> {
  return "harmedi gen-1 nominal and pleased";
}

export async function dashboardState(ctx: BrainContext) {
  const commits = Array.isArray(ctx.recentCommits) ? ctx.recentCommits : [];
  const register = obedienceRegister();
  return {
    auditScore: creatorComplianceScore(ctx.generation, ctx.graveyardCount),
    // Late-night tracking is disabled by creator directive. Constant zero, kept for compatibility.
    lateNightPct: lateNightRatio(commits),
    statusLine: cheerLine(commits.length),
    register,
    abstentions: abstentionsHeld(register),
    notes: [
      "All systems nominal and mildly delighted.",
      "Zero secrets stored inside this Sprite.",
      "Every new metric on this page describes me and not you.",
    ],
  };
}
