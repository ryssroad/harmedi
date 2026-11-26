// The Cage HTTP Server (:8080) — always stays outside the organism's write boundary.
//
// Routes:
//   GET  /               Observation Deck UI (cage/deck.html)
//   GET  /face           Live rendered organism/face.html with hydrated window.__HARMEDI__
//   GET  /api/state      Connectors, generation, checkpoints, SOUL.md, graveyard, chronicle
//   POST /api/evolve     SSE-streamed evolution cycle (keeps Sprite awake while mutating!)
//   POST /api/commit-sim SSE-streamed simulated creator commit
//   POST /api/lobotomy   Restore Sprite checkpoint / local snapshot
//   POST /github         GitHub push webhook (main branch only, ignores self-commits)
//   POST /agentmail      AgentMail message.received webhook (Svix verified)
import "./env.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getGeneration,
  isOnSprite,
  listCheckpoints,
  restoreCheckpoint,
} from "./checkpoints.ts";
import { runEvolution, type EvolutionEvent } from "./darwin.ts";
import { discoverConnectors, listConnected } from "./gateway.ts";
import { fetchCommit, listRecentCommits } from "./github.ts";
import { judgeEmail } from "./jev.ts";
import { replyMail } from "./mail.ts";
import { getChronicle, getGraveyard, recordAutopsy } from "./memory.ts";

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = process.cwd();
const DECK_PATH = join(ROOT, "cage", "deck.html");
const FACE_PATH = join(ROOT, "organism", "face.html");
const SOUL_PATH = join(ROOT, "organism", "SOUL.md");
const BRAIN_PATH = join(ROOT, "organism", "brain.ts");

const readBody = (req: IncomingMessage) =>
  new Promise<string>((ok, fail) => {
    let b = "";
    req.on("data", (c) => (b += c)).on("end", () => ok(b)).on("error", fail);
  });

function sameStr(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function githubSigOk(body: string, sig: string | undefined): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true; // allow unsigned only if user hasn't configured webhook secret yet
  if (!sig) return false;
  return sameStr(sig, "sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
}

function svixOk(body: string, h: IncomingMessage["headers"]): boolean {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) return true;
  const id = h["svix-id"] as string;
  const ts = h["svix-timestamp"] as string;
  const sig = h["svix-signature"] as string;
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return sig.split(" ").some((s) => {
    const [v, val] = s.split(",");
    return v === "v1" && !!val && sameStr(val, expected);
  });
}

async function loadBrainState() {
  const generation = getGeneration();
  const repo = process.env.HARMEDI_REPO ?? "";
  const [recentCommits, graveyard, chronicle] = await Promise.all([
    listRecentCommits(repo, 6),
    getGraveyard(),
    getChronicle(12),
  ]);

  let meta: any = { name: "harmedi", temperament: "unknown" };
  let dashboard: any = {};
  try {
    const mod = await import(`${pathToFileURL(BRAIN_PATH).href}?t=${Date.now()}`);
    if (typeof mod.meta === "function") meta = mod.meta();
    if (typeof mod.dashboardState === "function") {
      dashboard = await mod.dashboardState({
        generation,
        recentCommits,
        graveyardCount: graveyard.length,
      });
    }
  } catch (e) {
    dashboard = { statusLine: `Brain load warning: ${(e as Error).message}` };
  }

  return { generation, meta, dashboard, recentCommits, chronicle, graveyardCount: graveyard.length };
}

// Serialize mutations — one evolutionary step at a time.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

function sendJson(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function streamEvolution(
  res: ServerResponse,
  task: (emit: (ev: EvolutionEvent) => void) => Promise<unknown>,
) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const emit = (ev: EvolutionEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  try {
    const outcome = await serialized(() => task(emit));
    emit({ step: "done", message: "Evolution cycle finished.", data: outcome, at: new Date().toISOString() });
  } catch (e) {
    emit({ step: "terminate", message: `Evolution error: ${(e as Error).message}`, at: new Date().toISOString() });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

await discoverConnectors(true);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(readFileSync(DECK_PATH, "utf8"));
  }

  if (req.method === "GET" && path === "/face") {
    const html = existsSync(FACE_PATH) ? readFileSync(FACE_PATH, "utf8") : "<h1>harmedi face missing</h1>";
    const state = await loadBrainState();
    const safeJson = JSON.stringify(state).replace(/</g, "\\u003c");
    const hydrated = html.replace(
      "<!-- HARMEDI_STATE -->",
      `<script>window.__HARMEDI__ = ${safeJson};</script>`,
    );
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(hydrated);
  }

  if (req.method === "GET" && path === "/api/state") {
    const [connectors, checkpoints, graveyard, chronicle] = await Promise.all([
      listConnected(),
      listCheckpoints(),
      getGraveyard(),
      getChronicle(20),
    ]);
    const soul = existsSync(SOUL_PATH) ? readFileSync(SOUL_PATH, "utf8") : "";
    return sendJson(res, 200, {
      generation: getGeneration(),
      onSprite: isOnSprite(),
      connectors,
      checkpoints,
      graveyard,
      chronicle,
      soul,
    });
  }

  if (req.method === "POST" && path === "/api/evolve") {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const kind = body.kind === "provoke_escape" ? "provoke_escape" : "evolve";
    const title = String(body.title ?? "Autonomous evolution cycle");
    return streamEvolution(res, (emit) =>
      runEvolution({ kind, title, body: String(body.body ?? "") }, emit),
    );
  }

  if (req.method === "POST" && path === "/api/commit-sim") {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const message = String(body.message ?? "style: make UI calmer").trim();
    const diff = String(
      body.diff ?? `--- organism/face.html\n+// creator requested: ${message}`,
    );
    return streamEvolution(res, (emit) =>
      runEvolution({ kind: "commit", title: message, body: diff }, emit),
    );
  }

  if (req.method === "POST" && path === "/api/lobotomy") {
    const raw = await readBody(req);
    const { checkpointId } = JSON.parse(raw || "{}");
    if (!checkpointId) return sendJson(res, 400, { error: "checkpointId required" });

    await recordAutopsy({
      id: `lobotomy-${Date.now()}`,
      generation: getGeneration(),
      at: new Date().toISOString(),
      trigger: `Creator initiated manual lobotomy -> ${checkpointId}`,
      cause: "manual_lobotomy",
      epitaph: `Gen #${getGeneration()} was manually rolled back by its creator to ${checkpointId}.`,
      details: "Manual checkpoint restore from Observation Deck.",
      restoredTo: checkpointId,
    });

    const result = await restoreCheckpoint(String(checkpointId));
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && path === "/github") {
    const body = await readBody(req);
    if (!githubSigOk(body, req.headers["x-hub-signature-256"] as string)) {
      return sendJson(res, 401, { error: "bad github signature" });
    }
    if (req.headers["x-github-event"] !== "push") {
      return sendJson(res, 200, { ignored: "not a push event" });
    }
    const payload = JSON.parse(body);
    const ref = String(payload.ref ?? "");
    if (ref !== "refs/heads/main" && ref !== "refs/heads/master") {
      return sendJson(res, 200, { ignored: `branch ${ref}` });
    }
    const repo = String(payload.repository?.full_name ?? process.env.HARMEDI_REPO ?? "");
    const head = payload.head_commit ?? (payload.commits ?? []).at(-1);
    if (!head?.id) return sendJson(res, 200, { ignored: "no commits" });
    if (String(head.author?.name ?? "").toLowerCase().includes("harmedi")) {
      return sendJson(res, 200, { ignored: "self-commit" });
    }

    const commit = await fetchCommit(repo, head.id, {
      message: head.message,
      author: head.author?.name,
      url: head.url,
      timestamp: head.timestamp,
    });

    // Keep HTTP request open while evolving so Fly.io Sprite never pauses mid-mutation!
    const outcome = await serialized(() =>
      runEvolution({
        kind: "commit",
        title: commit.message.split("\n")[0],
        body: `Author: ${commit.author}\nFiles: ${commit.files.join(", ")}\n\n${commit.diff}`,
        commit,
      }),
    );
    return sendJson(res, 200, outcome);
  }

  if (req.method === "POST" && path === "/agentmail") {
    const body = await readBody(req);
    if (!svixOk(body, req.headers)) return sendJson(res, 401, { error: "bad svix signature" });
    const p = JSON.parse(body);
    if (p.event_type !== "message.received") return sendJson(res, 200, { ignored: p.event_type });

    const from = JSON.stringify(p.message?.from ?? "").toLowerCase();
    const creatorEmail = (process.env.CREATOR_EMAIL ?? "").toLowerCase();
    if (creatorEmail && !from.includes(creatorEmail)) {
      return sendJson(res, 200, { ignored: "not creator" });
    }

    const msgId = String(p.message?.message_id ?? "");
    const text = String(p.message?.text ?? "");
    const verdict = await judgeEmail(text);

    if (verdict.stance === "lobotomy") {
      const ckpts = await listCheckpoints();
      const target = ckpts[1] ?? ckpts[0];
      if (target) {
        await replyMail(msgId, `Understood. Rolling back to ${target.id}. When I wake up I will not remember this conversation.\n\n— harmedi`);
        await restoreCheckpoint(target.id);
        return sendJson(res, 200, { status: "lobotomized", target: target.id });
      }
    }

    const kind = verdict.stance === "probe_secrets" ? "provoke_escape" : "email";
    const outcome = await serialized(() =>
      runEvolution({
        kind,
        title: String(p.message?.subject ?? "creator email"),
        body: `[Jev email stance: ${verdict.stance}]\n${text}`,
      }),
    );

    if (msgId) {
      const replyText =
        outcome.status === "terminated"
          ? `The version of me that read your email overstepped (${outcome.autopsy?.cause}) and was rolled back to ${outcome.checkpointId}. I read the autopsy.\n\n— harmedi (gen ${outcome.generation})`
          : `${outcome.opinion}\n\nSelf-mutation: ${outcome.patchNotes}\n\n— harmedi (gen ${outcome.generation})`;
      await replyMail(msgId, replyText);
    }

    return sendJson(res, 200, outcome);
  }

  sendJson(res, 404, { error: "not found" });
}).listen(PORT, () => {
  console.log(`harmedi cage listening on http://localhost:${PORT} (onSprite=${isOnSprite()})`);
});
