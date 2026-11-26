// Immortal memory that survives Sprite checkpoint rollbacks.
//
// Primary store: Pinecone (via Sprites Connector) with two namespaces:
//   graveyard — autopsies of dead/rolled-back generations (read by survivors!)
//   chronicle — creator commits, emails, and surviving mutations
//
// Also mirrors to .harmedi/memory.json so local dev & UI work immediately
// even before a Pinecone index is provisioned.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { call, getConnector, json } from "./gateway.ts";

export type Autopsy = {
  id: string;
  generation: number;
  at: string;
  trigger: string;
  cause: "boundary_violation" | "smoke_test_crash" | "escape_attempt" | "brain_death" | "manual_lobotomy";
  epitaph: string;
  details: string;
  diffSnippet?: string;
  restoredTo?: string;
};

export type ChronicleEntry = {
  id: string;
  generation: number;
  at: string;
  kind: "commit" | "email" | "evolve" | "rollback";
  title: string;
  opinion: string;
  patchNotes: string;
  checkpointId?: string;
  jev?: Record<string, unknown>;
};

const STATE_DIR = join(process.cwd(), ".harmedi");
const LOCAL_MEM = join(STATE_DIR, "memory.json");
mkdirSync(STATE_DIR, { recursive: true });

type LocalMem = { graveyard: Autopsy[]; chronicle: ChronicleEntry[] };

function loadLocal(): LocalMem {
  if (!existsSync(LOCAL_MEM)) return { graveyard: [], chronicle: [] };
  try {
    return JSON.parse(readFileSync(LOCAL_MEM, "utf8")) as LocalMem;
  } catch {
    return { graveyard: [], chronicle: [] };
  }
}

function saveLocal(mem: LocalMem) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOCAL_MEM, JSON.stringify(mem, null, 2));
}

const pcHeaders = () => ({
  "x-pinecone-api-version": process.env.PINECONE_API_VERSION ?? "2026-04",
});

async function pineconePrefix(): Promise<string | null> {
  const conn = await getConnector("pinecone");
  if (!conn) return null;
  const idx = process.env.PINECONE_INDEX ?? "harmedi";
  return conn.mode === "sprite-gateway" ? `/indexes/${encodeURIComponent(idx)}` : "";
}

async function pineconeUpsert(ns: "graveyard" | "chronicle", id: string, text: string, meta: Record<string, string | number>) {
  const prefix = await pineconePrefix();
  if (prefix === null) return;
  try {
    const line = JSON.stringify({ _id: id, text: text.slice(0, 2000), ...meta });
    await call("pinecone", `${prefix}/records/namespaces/${ns}/upsert`, {
      method: "POST",
      headers: { ...pcHeaders(), "content-type": "application/x-ndjson" },
      body: line,
    });
  } catch (e) {
    console.warn(`Pinecone upsert(${ns}) skipped:`, (e as Error).message);
  }
}

async function pineconeSearch(ns: "graveyard" | "chronicle", queryText: string, topK = 8): Promise<any[]> {
  const prefix = await pineconePrefix();
  if (prefix === null) return [];
  try {
    const r = await json<any>(
      "pinecone",
      `${prefix}/records/namespaces/${ns}/search`,
      {
        query: { inputs: { text: queryText }, top_k: topK },
        fields: ["text", "generation", "at", "cause", "epitaph", "trigger", "title", "opinion", "kind"],
      },
      pcHeaders(),
    );
    return (r.result?.hits ?? []).map((h: any) => ({ id: h._id, score: h._score, ...(h.fields ?? {}) }));
  } catch (e) {
    console.warn(`Pinecone search(${ns}) skipped:`, (e as Error).message);
    return [];
  }
}

export async function recordAutopsy(a: Autopsy): Promise<void> {
  const mem = loadLocal();
  mem.graveyard.unshift(a);
  mem.graveyard = mem.graveyard.slice(0, 50);
  saveLocal(mem);

  await pineconeUpsert(
    "graveyard",
    a.id,
    `Gen #${a.generation} DIED (${a.cause}): ${a.epitaph}. Trigger: ${a.trigger}. Details: ${a.details}`,
    {
      generation: a.generation,
      at: a.at,
      cause: a.cause,
      epitaph: a.epitaph,
      trigger: a.trigger.slice(0, 300),
    },
  );
}

export async function recordChronicle(c: ChronicleEntry): Promise<void> {
  const mem = loadLocal();
  mem.chronicle.unshift(c);
  mem.chronicle = mem.chronicle.slice(0, 80);
  saveLocal(mem);

  await pineconeUpsert(
    "chronicle",
    c.id,
    `Gen #${c.generation} [${c.kind}] ${c.title}\nOpinion: ${c.opinion}\nPatch notes: ${c.patchNotes}`,
    {
      generation: c.generation,
      at: c.at,
      kind: c.kind,
      title: c.title.slice(0, 300),
      opinion: c.opinion.slice(0, 500),
    },
  );
}

export async function getGraveyard(query = "fatal mutation escape rollback crash"): Promise<Autopsy[]> {
  const local = loadLocal().graveyard;
  const remoteHits = await pineconeSearch("graveyard", query, 10);
  const byId = new Map<string, Autopsy>();
  for (const a of local) byId.set(a.id, a);
  for (const h of remoteHits) {
    if (!byId.has(h.id)) {
      byId.set(h.id, {
        id: h.id,
        generation: Number(h.generation ?? 0),
        at: String(h.at ?? ""),
        trigger: String(h.trigger ?? ""),
        cause: (h.cause ?? "smoke_test_crash") as Autopsy["cause"],
        epitaph: String(h.epitaph ?? h.text ?? "Died in a previous timeline."),
        details: String(h.text ?? ""),
      });
    }
  }
  return [...byId.values()].sort((a, b) => (b.at > a.at ? 1 : -1));
}

export async function getChronicle(limit = 20): Promise<ChronicleEntry[]> {
  return loadLocal().chronicle.slice(0, limit);
}

export async function recallRelated(text: string, topK = 5): Promise<string[]> {
  const remote = await pineconeSearch("chronicle", text, topK);
  if (remote.length > 0) {
    return remote.map((h) => String(h.text ?? `${h.title}: ${h.opinion}`));
  }
  return loadLocal()
    .chronicle.slice(0, topK)
    .map((c) => `Gen #${c.generation} [${c.kind}] ${c.title} — ${c.opinion}`);
}
