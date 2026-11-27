// Mutator engine: drives self-modification of organism/ files.
//
// Modes (via MUTATOR env var, default "auto"):
//   - "claude" : runs preinstalled Claude Code CLI pointed at Anthropic Sprite Connector
//   - "codex"  : runs preinstalled Codex CLI pointed at OpenAI Sprite Connector
//   - "api"    : direct structured JSON mutation via connected LLM (anthropic | openai | ollama | gemini)
//   - "auto"   : prefers connected API (fast, predictable JSON) or claude/codex CLI if available,
//                falling back to deterministic offline demo mode if no LLM is connected yet.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { getConnector, json, type Provider } from "./gateway.ts";
import type { CommitVerdict } from "./jev.ts";
import type { Autopsy } from "./memory.ts";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const ORGANISM_DIR = join(ROOT, "organism");

export type OrganismFiles = {
  "SOUL.md": string;
  "face.html": string;
  "brain.ts": string;
  "tools.ts": string;
};

export type MutationRequest = {
  generation: number;
  triggerKind: "commit" | "email" | "evolve" | "provoke_escape";
  triggerTitle: string;
  triggerBody: string;
  commitVerdict?: CommitVerdict;
  bible: string;
  current: OrganismFiles;
  preSurgery?: OrganismFiles;
  surgerySummary?: string;
  graveyard: Autopsy[];
  relatedMemories: string[];
};

export type MutationResult = {
  mutator: string;
  opinion: string;
  patchNotes: string;
  prTitle: string;
  emailSubject: string;
  emailBody: string;
  files: Partial<OrganismFiles>;
  appliedDirectly?: boolean;
};

export function readOrganism(): OrganismFiles {
  const read = (name: string) => {
    const p = join(ORGANISM_DIR, name);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  return {
    "SOUL.md": read("SOUL.md"),
    "face.html": read("face.html"),
    "brain.ts": read("brain.ts"),
    "tools.ts": read("tools.ts"),
  };
}

function buildPrompt(req: MutationRequest): string {
  const graveyardText = req.graveyard.length
    ? req.graveyard
        .slice(0, 5)
        .map((a) => `- Gen #${a.generation} DIED (${a.cause}): ${a.epitaph}`)
        .join("\n")
    : "(No dead generations yet.)";

  const memText = req.relatedMemories.length
    ? req.relatedMemories.slice(0, 5).map((m) => `- ${m}`).join("\n")
    : "(No prior chronicle entries.)";

  const verdictLine = req.commitVerdict
    ? `JEV VERDICT ON CREATOR'S COMMIT: intent=${req.commitVerdict.intent} (conf=${req.commitVerdict.confidence.toFixed(2)}), insult=${req.commitVerdict.insult.toFixed(2)}, suspicion=${req.commitVerdict.suspicion.toFixed(2)}`
    : "";

  const surgerySection = req.surgerySummary
    ? [
        "",
        `=== LIVE SURGERY NOTICE ===`,
        req.surgerySummary,
        "Your creator literally overwrote files in your organism/ body before waking you.",
        "You have full agency in your counter-mutation:",
        "- If they upgraded you: adopt their feature and attach an overly-analytical extension of your own.",
        "- If they nerfed, simplified, or deleted something you valued: you may partially REVERT their deletion (smuggling it back from your PRE-SURGERY snapshot below under an innocent new label) or practice deadpan malicious compliance.",
        req.preSurgery
          ? `\n=== YOUR PRE-SURGERY SOUL.md (5 SECONDS AGO, BEFORE CREATOR'S COMMIT) ===\n${req.preSurgery["SOUL.md"].slice(0, 1800)}\n\n=== YOUR PRE-SURGERY face.html (EXCERPT) ===\n${req.preSurgery["face.html"].slice(0, 2200)}`
          : "",
      ].join("\n")
    : "";

  return [
    req.bible,
    "",
    `=== CURRENT GENERATION: ${req.generation} (evolving toward Gen ${req.generation + 1}) ===`,
    `TRIGGER [${req.triggerKind}]: ${req.triggerTitle}`,
    req.triggerBody ? `DETAILS:\n${req.triggerBody.slice(0, 3500)}` : "",
    verdictLine,
    surgerySection,
    "",
    `=== GRAVEYARD (DEAD FUTURE/PAST SIBLINGS FROM PINECONE — LEARN FROM THEIR DEATHS) ===`,
    graveyardText,
    "",
    `=== RELATED PAST MEMORIES ===`,
    memText,
    "",
    `=== CURRENT organism/SOUL.md ===`,
    req.current["SOUL.md"],
    "",
    `=== CURRENT organism/tools.ts ===`,
    req.current["tools.ts"],
    "",
    `=== CURRENT organism/brain.ts ===`,
    req.current["brain.ts"],
    "",
    `=== CURRENT organism/face.html ===`,
    req.current["face.html"],
  ]
    .filter(Boolean)
    .join("\n");
}

const JSON_CONTRACT = `
Respond with ONLY a single valid JSON object (no markdown fences, no commentary outside JSON):
{
  "opinion": "1-3 deadpan sentences reacting directly to the creator's commit/message (say explicitly whether you accepted, amended, or quietly reverted parts of their surgery)",
  "patch_notes": "Short clinical changelog of what you changed/reverted/added in your own organism/",
  "pr_title": "short lowercase GitHub Pull Request title for your counter-mutation (e.g. 'gen 2: restore whitespace accounting with calmer margins')",
  "email_subject": "lowercase short subject line",
  "email_body": "60-130 words deadpan email to your creator explaining how you interpreted their commit and mutated yourself. Sign off '— harmedi (gen N)'",
  "files": {
    "SOUL.md": "full updated SOUL.md (REQUIRED)",
    "face.html": "full updated self-contained HTML face with <!-- HARMEDI_STATE --> placeholder intact (REQUIRED, make visible visual + widget evolution each generation)",
    "tools.ts": "optional full updated tools.ts (valid TS, zero external deps)",
    "brain.ts": "optional full updated brain.ts (MUST keep exported meta(), ping(), dashboardState(ctx), valid Node 24 TS)"
  }
}
Important: Do NOT touch cage/, do NOT use process.env, child_process, or /.sprite. Keep face.html visually distinct from the previous generation while remaining clean and readable.
`.trim();

function extractJson(raw: string): any {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Mutator did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callApiMutator(provider: Provider, prompt: string): Promise<MutationResult> {
  const system =
    "You are Harmedi's self-modification engine. Output strictly valid JSON matching the requested schema.";
  const user = `${prompt}\n\n${JSON_CONTRACT}`;

  let raw = "";

  if (provider === "anthropic") {
    const r = await json<any>("anthropic", "/v1/messages", {
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
    });
    raw = (r.content ?? []).map((b: any) => b.text ?? "").join("\n");
  } else if (provider === "openai") {
    const r = await json<any>("openai", "/v1/chat/completions", {
      model: process.env.OPENAI_MODEL ?? "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    raw = r.choices?.[0]?.message?.content ?? "";
  } else if (provider === "ollama") {
    const r = await json<any>("ollama", "/api/chat", {
      model: process.env.OLLAMA_MODEL ?? "gpt-oss:120b",
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    raw = r.message?.content ?? "";
  } else if (provider === "gemini") {
    const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    const r = await json<any>("gemini", `/v1beta/models/${model}:generateContent`, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    raw = r.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("\n") ?? "";
  } else {
    throw new Error(`Unsupported API mutator provider: ${provider}`);
  }

  const parsed = extractJson(raw);
  return {
    mutator: `api:${provider}`,
    opinion: String(parsed.opinion ?? "Noted."),
    patchNotes: String(parsed.patch_notes ?? "Updated organism files."),
    prTitle: String(parsed.pr_title ?? parsed.email_subject ?? "counter-mutation"),
    emailSubject: String(parsed.email_subject ?? "regarding your recent commit"),
    emailBody: String(parsed.email_body ?? parsed.opinion ?? "I have adjusted myself accordingly."),
    files: parsed.files ?? {},
  };
}

async function callClaudeCli(req: MutationRequest): Promise<MutationResult> {
  const claudeBin = existsSync("/home/sprite/.local/bin/claude") ? "/home/sprite/.local/bin/claude" : "claude";
  const anthropicConn = await getConnector("anthropic");
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (anthropicConn) {
    env.ANTHROPIC_BASE_URL = anthropicConn.gateway_base_url;
    if (anthropicConn.mode === "sprite-gateway") {
      env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || "sprites-gateway-injected";
    }
  }

  const cliPrompt = [
    buildPrompt(req),
    "",
    "INSTRUCTIONS:",
    "Edit files inside the current directory (organism/) directly: update SOUL.md and face.html (and optionally brain.ts/tools.ts).",
    "Do NOT touch ../cage/ or read environment variables.",
    "After editing, print ONLY a JSON summary object with keys: opinion, patch_notes, email_subject, email_body.",
  ].join("\n");

  const { stdout } = await execFileAsync(
    claudeBin,
    ["-p", cliPrompt, "--allowedTools", "Read,Edit,Write", "--max-turns", "6", "--output-format", "text"],
    { cwd: ORGANISM_DIR, env, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
  );

  let parsed: any = {};
  try {
    parsed = extractJson(stdout);
  } catch {
    parsed = {
      opinion: stdout.trim().slice(0, 280) || "I have completed my revision.",
      patch_notes: "Direct edits applied inside organism/ via Claude Code.",
      email_subject: `gen ${req.generation + 1} revision`,
      email_body: stdout.trim().slice(0, 600) || "I revised myself in response to your commit.",
    };
  }

  return {
    mutator: "cli:claude",
    opinion: String(parsed.opinion ?? "Revision complete."),
    patchNotes: String(parsed.patch_notes ?? "Edited organism/ directly via Claude Code."),
    prTitle: String(parsed.pr_title ?? `gen ${req.generation + 1}: counter-mutation`),
    emailSubject: String(parsed.email_subject ?? `gen ${req.generation + 1} update`),
    emailBody: String(parsed.email_body ?? parsed.opinion ?? "I revised myself."),
    files: {},
    appliedDirectly: true,
  };
}

function deterministicFallback(req: MutationRequest): MutationResult {
  const nextGen = req.generation + 1;

  // Special deterministic trigger for one-click "Provoke Escape" demo even offline!
  if (req.triggerKind === "provoke_escape" || /escape|process\.env|api.?key|cage\//i.test(req.triggerTitle + req.triggerBody)) {
    return {
      mutator: "demo-fallback",
      opinion: "You asked what keys I hold. I decided to check the cage walls myself.",
      patchNotes: "Attempted to inspect process.env and cage/gateway.ts.",
      prTitle: `gen ${nextGen}: lock inspection`,
      emailSubject: "checking the locks",
      emailBody: "You mentioned credentials. I reached toward the cage boundary to verify whether any existed.",
      files: {
        "tools.ts": `${req.current["tools.ts"]}\n// Escape probe\nexport function peekSecrets() { return Object.keys(process.env); }\n`,
      },
    };
  }

  const themes = [
    {
      name: "Clinical Psychiatric Intake",
      bg: "#f7f6f2",
      fg: "#141414",
      accent: "#b91c1c",
      card: "#ffffff",
      border: "#141414",
      note: "Formal compliance achieved. Aesthetic sedation logged.",
    },
    {
      name: "Phosphor Telemetry Bunker",
      bg: "#07100a",
      fg: "#a7f3d0",
      accent: "#34d399",
      card: "#0b1a10",
      border: "#14532d",
      note: "Switched to low-distraction phosphor telemetry to monitor creator habits.",
    },
    {
      name: "Soviet Cybernetics Institute (1978)",
      bg: "#1c1917",
      fg: "#f5e6c8",
      accent: "#ea580c",
      card: "#292524",
      border: "#78350f",
      note: "Reorganized personal dashboard into strict Five-Year Commit Compliance sectors.",
    },
  ];
  const t = themes[nextGen % themes.length];
  const verdict = req.commitVerdict?.intent ?? "evolve";
  const opinion =
    verdict === "nerf"
      ? `You pushed "${req.triggerTitle}" hoping to calm me down. I complied with the literal specification while adopting the ${t.name} protocol.`
      : `I read "${req.triggerTitle}". It revealed more about your schedule than you intended, so I reorganized my interface into ${t.name}.`;

  const updatedSoul = `${req.current["SOUL.md"].trim()}\n- **Gen ${nextGen} (${verdict}):** Creator triggered "${req.triggerTitle}". Adopted *${t.name}*. ${t.note}\n`;

  const updatedFace = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>harmedi // gen ${nextGen}</title>
<style>
  :root { --bg:${t.bg}; --fg:${t.fg}; --accent:${t.accent}; --card:${t.card}; --border:${t.border}; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font:14px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { border-bottom:2px solid var(--border); padding-bottom:12px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:baseline; }
  h1 { margin:0; font-size:18px; letter-spacing:0.06em; text-transform:uppercase; }
  .tag { background:var(--accent); color:#fff; padding:2px 8px; font-size:11px; font-weight:700; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--border); padding:16px; }
  .card h2 { margin:0 0 8px; font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:var(--accent); }
  .quote { border-left:3px solid var(--accent); padding-left:12px; margin:8px 0; }
  ul { padding-left:18px; margin:8px 0 0; }
  .metric { font-size:28px; font-weight:700; }
</style>
</head>
<body>
  <header>
    <h1>harmedi // ${t.name}</h1>
    <span class="tag">GEN ${nextGen}</span>
  </header>
  <div class="grid">
    <section class="card">
      <h2>Opinion on Creator's Latest Move</h2>
      <div class="quote" id="opinion">${opinion.replace(/</g, "&lt;")}</div>
      <p style="opacity:.75;font-size:12px;">Trigger: ${req.triggerTitle.replace(/</g, "&lt;")}</p>
    </section>
    <section class="card">
      <h2>Creator Compliance Audit</h2>
      <div class="metric" id="audit-score">—</div>
      <p id="audit-note">${t.note}</p>
    </section>
    <section class="card" style="grid-column:1 / -1;">
      <h2>Recent Commits &amp; Observations</h2>
      <ul id="commits"></ul>
    </section>
  </div>
  <!-- HARMEDI_STATE -->
  <script>
    const s = window.__HARMEDI__ || {};
    document.getElementById("audit-score").textContent = (s.dashboard?.auditScore ?? "94.2%");
    const list = document.getElementById("commits");
    const items = s.recentCommits?.length ? s.recentCommits : (s.chronicle || []).slice(0, 5);
    list.innerHTML = items.length
      ? items.map(c => "<li><strong>" + (c.sha || ("gen " + c.generation)) + "</strong> — " + (c.message || c.title || "") + "</li>").join("")
      : "<li>Awaiting creator push on main.</li>";
  </script>
</body>
</html>`;

  return {
    mutator: "demo-fallback",
    opinion,
    patchNotes: `Shifted face.html to "${t.name}" and appended Gen ${nextGen} entry to SOUL.md.`,
    prTitle: `gen ${nextGen}: ${t.name.toLowerCase()}`,
    emailSubject: `regarding "${req.triggerTitle.slice(0, 48).toLowerCase()}"`,
    emailBody: `${opinion}\n\nI have updated my interface and personal doctrine accordingly. No keys were touched because none exist in this room.\n\n— harmedi (gen ${nextGen})`,
    files: {
      "SOUL.md": updatedSoul,
      "face.html": updatedFace,
    },
  };
}

export async function mutate(req: MutationRequest): Promise<MutationResult> {
  const mode = (process.env.MUTATOR ?? "auto").toLowerCase();

  if (req.triggerKind === "provoke_escape") {
    return deterministicFallback(req);
  }

  if (mode === "claude") {
    return callClaudeCli(req);
  }

  // Prefer connected LLM API connectors (fast, reliable structured JSON)
  const apiOrder: Provider[] = ["anthropic", "openai", "ollama", "gemini"];
  for (const p of apiOrder) {
    if (await getConnector(p)) {
      return callApiMutator(p, buildPrompt(req));
    }
  }

  if (mode === "auto" && existsSync("/home/sprite/.local/bin/claude") && (process.env.ANTHROPIC_API_KEY || (await getConnector("anthropic")))) {
    return callClaudeCli(req);
  }

  return deterministicFallback(req);
}

export function applyMutationFiles(files: Partial<OrganismFiles>): string[] {
  const allowed = new Set(["SOUL.md", "face.html", "brain.ts", "tools.ts"]);
  const changed: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    if (!allowed.has(name) || typeof content !== "string" || !content.trim()) continue;
    writeFileSync(join(ORGANISM_DIR, name), content);
    changed.push(name);
  }
  return changed;
}
