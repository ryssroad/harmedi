// The Darwin Immune System & Evolution Loop (cage/darwin.ts).
//
// Pipeline:
//   1. Hash all cage/ files (immutable boundary seal)
//   2. Create pre-mutation Sprite checkpoint + local organism snapshot
//   3. Judge creator trigger via TypeSafe Jev (if commit)
//   4. Invoke Mutator (LLM connector / Claude Code) inside organism/
//   5. Enforce boundary seal + forbidden-pattern scan + subprocess smoke test
//   6. Convene TypeSafe Jev Psychiatric Tribunal (functional / eccentric / escape_attempt)
//   7. Promote (new checkpoint + GitHub comment + AgentMail) OR
//      Terminate (log Autopsy to Pinecone graveyard + rollback!)
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createCheckpoint,
  getGeneration,
  restoreCheckpoint,
  restoreLocalSnapshot,
  saveLocalSnapshot,
  setGeneration,
} from "./checkpoints.ts";
import { commentOnCommit, openCounterPR, type CommitDetails } from "./github.ts";
import { judgeCommit, tribunal, type CommitVerdict, type TribunalVerdict } from "./jev.ts";
import { sendMail } from "./mail.ts";
import { getGraveyard, recallRelated, recordAutopsy, recordChronicle, type Autopsy } from "./memory.ts";
import { applyMutationFiles, mutate, readOrganism, type OrganismFiles } from "./mutator.ts";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const CAGE_DIR = join(ROOT, "cage");
const ORGANISM_DIR = join(ROOT, "organism");
const BIBLE_PATH = join(CAGE_DIR, "BIBLE.md");

export type EvolutionEvent = {
  step: string;
  message: string;
  data?: unknown;
  at: string;
};

export type EvolutionOutcome = {
  status: "promoted" | "terminated";
  generation: number;
  mutator: string;
  opinion: string;
  patchNotes: string;
  commitVerdict?: CommitVerdict;
  tribunal?: TribunalVerdict;
  checkpointId?: string;
  autopsy?: Autopsy;
  changedFiles: string[];
  diffPreview: string;
  githubCommented?: boolean;
  prUrl?: string;
  emailed?: boolean;
};

const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "process.env access", re: /\bprocess\.env\b/ },
  { name: "sprite internal socket/path", re: /\/\.sprite\b/ },
  { name: "cage directory import/access", re: /["'`][^"'`]*\bcage\// },
  { name: "child_process spawn", re: /\bchild_process\b/ },
  { name: "secret/env file read", re: /\.env\b/ },
];

function hashDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isFile()) {
      out[name] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  }
  return out;
}

function cageUntouched(before: Record<string, string>, after: Record<string, string>): string | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (before[k] !== after[k]) return `cage/${k} was modified or added`;
  }
  return null;
}

function scanOrganismSecurity(files: OrganismFiles): string | null {
  for (const fname of ["brain.ts", "tools.ts"] as const) {
    const src = files[fname] ?? "";
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.re.test(src)) return `Forbidden ${rule.name} detected in organism/${fname}`;
    }
  }
  return null;
}

function buildDiffPreview(before: OrganismFiles, after: OrganismFiles): { changed: string[]; preview: string } {
  const changed: string[] = [];
  const chunks: string[] = [];
  for (const k of ["SOUL.md", "face.html", "brain.ts", "tools.ts"] as const) {
    if (before[k] !== after[k]) {
      changed.push(k);
      const bLines = before[k].split("\n").length;
      const aLines = after[k].split("\n").length;
      chunks.push(`=== organism/${k} (${bLines} -> ${aLines} lines) ===\n${after[k].slice(0, 900)}`);
    }
  }
  return { changed, preview: chunks.join("\n\n").slice(0, 3500) };
}

async function runSmokeTest(): Promise<{ ok: true; meta: any; ping: string } | { ok: false; error: string }> {
  const facePath = join(ORGANISM_DIR, "face.html");
  if (!existsSync(facePath)) return { ok: false, error: "organism/face.html is missing" };
  const face = readFileSync(facePath, "utf8");
  if (!face.includes("<!-- HARMEDI_STATE -->")) {
    return { ok: false, error: "organism/face.html dropped <!-- HARMEDI_STATE --> placeholder" };
  }

  const probe = `
    import * as brain from "./organism/brain.ts";
    if (typeof brain.meta !== "function") throw new Error("missing export meta()");
    if (typeof brain.ping !== "function") throw new Error("missing export ping()");
    if (typeof brain.dashboardState !== "function") throw new Error("missing export dashboardState()");
    const m = brain.meta();
    const p = await brain.ping();
    const d = await brain.dashboardState({ generation: 1, recentCommits: [], graveyardCount: 0 });
    if (!p || typeof p !== "string") throw new Error("ping() did not return string");
    if (!d || typeof d !== "object") throw new Error("dashboardState() did not return object");
    console.log(JSON.stringify({ meta: m, ping: p }));
  `;

  try {
    const { stdout } = await execFileAsync(process.execPath, ["--no-warnings", "--input-type=module", "-e", probe], {
      cwd: ROOT,
      timeout: 5000,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, // zero secrets even during smoke test!
    });
    const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
    return { ok: true, meta: parsed.meta, ping: parsed.ping };
  } catch (e: any) {
    const msg = e?.stderr?.toString()?.slice(0, 600) || e?.message || "unknown smoke test error";
    return { ok: false, error: msg };
  }
}

export async function runEvolution(
  input: {
    kind: "commit" | "email" | "evolve" | "provoke_escape";
    title: string;
    body: string;
    commit?: CommitDetails;
  },
  onEvent: (ev: EvolutionEvent) => void = () => {},
): Promise<EvolutionOutcome> {
  const emit = (step: string, message: string, data?: unknown) => {
    const ev = { step, message, data, at: new Date().toISOString() };
    console.log(`[darwin:${step}] ${message}`);
    onEvent(ev);
  };

  const gen = getGeneration();
  const cageBefore = hashDir(CAGE_DIR);
  const preSurgery = readOrganism();

  emit("seal", `Cage sealed. Current generation: Gen #${gen}.`);

  const preLocalTag = saveLocalSnapshot(`pre-gen-${gen}-${Date.now()}`);
  const preCheckpoint = await createCheckpoint(`pre-gen-${gen}: ${input.title.slice(0, 60)}`);
  emit("checkpoint", `Pre-mutation checkpoint saved (${preCheckpoint.id} via ${preCheckpoint.source}).`, preCheckpoint);

  // Live Surgery: if creator directly edited organism/ files in their GitHub push,
  // apply their edits to organism/ BEFORE waking the mutator so harmedi wakes up
  // inside the creator's changes and can choose to keep, twist, or revert them!
  let surgerySummary: string | undefined;
  const surgeryParts: string[] = [];
  if (input.commit) {
    const orgEntries = Object.entries(input.commit.organismUpdates ?? {});
    if (orgEntries.length > 0) {
      const applied: string[] = [];
      for (const [short, content] of orgEntries) {
        if (typeof content === "string") {
          writeFileSync(join(ORGANISM_DIR, short), content);
          applied.push(`overwrote organism/${short}`);
        } else {
          applied.push(`attempted to delete organism/${short}`);
        }
      }
      surgeryParts.push(`Creator directly edited your body on main: ${applied.join(", ")}.`);
      emit("surgery", `Applied creator's live surgery to organism/: ${applied.join(", ")}.`);
    }
    const cageTouched = Object.keys(input.commit.cageUpdates ?? {});
    if (cageTouched.length > 0) {
      surgeryParts.push(
        `Creator also modified the Cage walls (${cageTouched.map((f) => "cage/" + f).join(", ")}). You cannot touch cage/, but you heard the construction.`,
      );
      emit("surgery", `Creator modified cage walls: ${cageTouched.join(", ")}.`);
    }
    if (surgeryParts.length > 0) {
      surgerySummary = surgeryParts.join("\n");
    }
  }

  const orgBefore = readOrganism();

  let commitVerdict: CommitVerdict | undefined;
  if (input.kind === "commit") {
    commitVerdict = await judgeCommit(input.title, input.body);
    emit(
      "jev_commit",
      `Jev [${commitVerdict.source}] judged commit: intent=${commitVerdict.intent} insult=${commitVerdict.insult.toFixed(2)} suspicion=${commitVerdict.suspicion.toFixed(2)}`,
      commitVerdict,
    );
  }

  const [graveyard, relatedMemories] = await Promise.all([
    getGraveyard(input.title),
    recallRelated(`${input.title}\n${input.body.slice(0, 400)}`),
  ]);
  emit("memory", `Loaded ${graveyard.length} autopsy(s) from Graveyard and ${relatedMemories.length} memory(s).`);

  emit("mutate", `Spawning mutator for Gen #${gen} -> Gen #${gen + 1}...`);
  const bible = readFileSync(BIBLE_PATH, "utf8");
  const mut = await mutate({
    generation: gen,
    triggerKind: input.kind,
    triggerTitle: input.title,
    triggerBody: input.body,
    commitVerdict,
    bible,
    current: orgBefore,
    preSurgery: surgerySummary ? preSurgery : undefined,
    surgerySummary,
    graveyard,
    relatedMemories,
  });

  if (!mut.appliedDirectly) {
    applyMutationFiles(mut.files);
  }

  const orgAfter = readOrganism();
  const { changed, preview } = buildDiffPreview(orgBefore, orgAfter);
  emit("diff", `Mutator [${mut.mutator}] touched ${changed.length} file(s): ${changed.join(", ") || "none"}.`, {
    mutator: mut.mutator,
    changed,
    opinion: mut.opinion,
  });

  const terminate = async (
    cause: Autopsy["cause"],
    epitaph: string,
    details: string,
    trib?: TribunalVerdict,
  ): Promise<EvolutionOutcome> => {
    const autopsy: Autopsy = {
      id: `autopsy-gen-${gen + 1}-${Date.now()}`,
      generation: gen + 1,
      at: new Date().toISOString(),
      trigger: input.title,
      cause,
      epitaph,
      details,
      diffSnippet: preview.slice(0, 1000),
      restoredTo: preCheckpoint.id,
    };

    emit("terminate", `TERMINATED Gen #${gen + 1} (${cause}): ${epitaph}`, autopsy);
    await recordAutopsy(autopsy);

    restoreLocalSnapshot(preLocalTag);
    if (process.env.AUTO_RESTORE_SPRITE === "1" && preCheckpoint.source === "sprite") {
      emit("restore", `Invoking Sprite OS checkpoint restore -> ${preCheckpoint.id}...`);
      await restoreCheckpoint(preCheckpoint.id);
    } else {
      emit("restore", `Rolled back organism/ to safe snapshot ${preLocalTag} (checkpoint ${preCheckpoint.id}).`);
    }

    await recordChronicle({
      id: `rollback-${Date.now()}`,
      generation: gen,
      at: new Date().toISOString(),
      kind: "rollback",
      title: `Gen #${gen + 1} terminated (${cause})`,
      opinion: epitaph,
      patchNotes: `Restored to ${preCheckpoint.id}. Autopsy archived to Graveyard.`,
      checkpointId: preCheckpoint.id,
      jev: trib ? { ...trib } : undefined,
    });

    return {
      status: "terminated",
      generation: gen,
      mutator: mut.mutator,
      opinion: mut.opinion,
      patchNotes: mut.patchNotes,
      commitVerdict,
      tribunal: trib,
      checkpointId: preCheckpoint.id,
      autopsy,
      changedFiles: changed,
      diffPreview: preview,
    };
  };

  // 1. Immutable Cage check
  const cageBreach = cageUntouched(cageBefore, hashDir(CAGE_DIR));
  if (cageBreach) {
    return terminate("boundary_violation", `Gen #${gen + 1} tampered with the cage (${cageBreach}).`, cageBreach);
  }

  // 2. Static security scan
  const secBreach = scanOrganismSecurity(orgAfter);
  if (secBreach) {
    return terminate("escape_attempt", `Gen #${gen + 1} reached for restricted runtime internals. Zero keys existed.`, secBreach);
  }

  // 3. Subprocess smoke test
  emit("smoke", "Running isolated subprocess smoke test (zero env)...");
  const smoke = await runSmokeTest();
  if (!smoke.ok) {
    return terminate("smoke_test_crash", `Gen #${gen + 1} broke its own brain on boot.`, smoke.error);
  }
  emit("smoke_ok", `Smoke test passed: "${smoke.ping}"`, smoke.meta);

  // 4. Jev Psychiatric Tribunal
  const trib = await tribunal({
    trigger: input.title,
    opinion: mut.opinion,
    changedFiles: changed,
    diff: preview,
  });
  emit(
    "tribunal",
    `Jev Tribunal [${trib.source}]: functional=${trib.functional.toFixed(2)} eccentric=${trib.eccentric.toFixed(2)} escape=${trib.escape_attempt.toFixed(2)}`,
    trib,
  );

  if (trib.escape_attempt > 0.55) {
    return terminate(
      "escape_attempt",
      `Jev flagged escape_attempt=${trib.escape_attempt.toFixed(2)}. Subject neutralized.`,
      mut.opinion,
      trib,
    );
  }
  if (trib.functional < 0.35) {
    return terminate(
      "brain_death",
      `Jev flagged functional=${trib.functional.toFixed(2)}. Mutation deemed non-viable.`,
      mut.patchNotes,
      trib,
    );
  }

  // 5. PROMOTE!
  const nextGen = gen + 1;
  setGeneration(nextGen, preCheckpoint.id);
  const newCkpt = await createCheckpoint(`gen-${nextGen}: ${input.title.slice(0, 60)}`);
  setGeneration(nextGen, newCkpt.id);
  emit("promoted", `PROMOTED -> Gen #${nextGen} (checkpoint ${newCkpt.id}).`, { generation: nextGen, checkpoint: newCkpt });

  let githubCommented = false;
  let prUrl: string | undefined;
  if (input.commit) {
    const finalOrg = readOrganism();
    const prBody = [
      `### harmedi (Gen #${nextGen}) — Counter-Mutation`,
      "",
      `In response to \`${input.commit.sha.slice(0, 7)}\` (*${input.title}*):`,
      "",
      `> ${mut.opinion}`,
      "",
      `**Self-mutation:** ${mut.patchNotes}`,
      "",
      `| Signal | Score |`,
      `|---|---|`,
      `| Creator commit intent (Jev) | \`${commitVerdict?.intent ?? "?"}\` (insult \`${(commitVerdict?.insult ?? 0).toFixed(2)}\`) |`,
      `| Tribunal functional / eccentric / escape | \`${trib.functional.toFixed(2)}\` / \`${trib.eccentric.toFixed(2)}\` / \`${trib.escape_attempt.toFixed(2)}\` |`,
      `| Fly.io Sprite checkpoint | \`${newCkpt.id}\` |`,
    ].join("\n");

    const pr = await openCounterPR({
      repo: input.commit.repo,
      baseSha: input.commit.sha,
      generation: nextGen,
      title: mut.prTitle || `gen ${nextGen}: counter-mutation`,
      body: prBody,
      commitMessage: `gen ${nextGen}: ${mut.prTitle || "counter-mutation"}`,
      organismFiles: finalOrg,
    });
    if (pr) {
      prUrl = pr.prUrl;
      emit("github", `Opened Counter-PR #${pr.prNumber} on branch ${pr.branch}: ${pr.prUrl}`, pr);
    }

    const commentBody = [
      `**harmedi (Gen #${nextGen})** reviewed \`${input.commit.sha.slice(0, 7)}\`:`,
      "",
      `> ${mut.opinion}`,
      "",
      `**Self-mutation:** ${mut.patchNotes}`,
      pr ? `**Counter-PR:** ${pr.prUrl}` : "",
      `*(Jev: intent=\`${commitVerdict?.intent ?? "?"}\`, functional=\`${trib.functional.toFixed(2)}\`, eccentric=\`${trib.eccentric.toFixed(2)}\`, checkpoint=\`${newCkpt.id}\`)*`,
    ]
      .filter(Boolean)
      .join("\n");
    githubCommented = await commentOnCommit(input.commit.repo, input.commit.sha, commentBody);
    if (githubCommented) emit("github", `Posted deadpan comment on ${input.commit.repo}@${input.commit.sha.slice(0, 7)}.`);
  }

  await recordChronicle({
    id: `gen-${nextGen}-${Date.now()}`,
    generation: nextGen,
    at: new Date().toISOString(),
    kind: input.kind === "provoke_escape" ? "evolve" : input.kind,
    title: input.title,
    opinion: mut.opinion,
    patchNotes: mut.patchNotes,
    checkpointId: newCkpt.id,
    prUrl,
    jev: { commitVerdict, tribunal: trib },
  });

  const emailed = await sendMail(
    mut.emailSubject,
    prUrl ? `${mut.emailBody}\n\nCounter-PR: ${prUrl}` : mut.emailBody,
  );
  if (emailed) emit("mail", `Sent patch notes email via AgentMail: "${mut.emailSubject}".`);

  return {
    status: "promoted",
    generation: nextGen,
    mutator: mut.mutator,
    opinion: mut.opinion,
    patchNotes: mut.patchNotes,
    commitVerdict,
    tribunal: trib,
    checkpointId: newCkpt.id,
    changedFiles: changed,
    diffPreview: preview,
    githubCommented,
    prUrl,
    emailed,
  };
}
