// Sprite Checkpoint & Local Organism Snapshot Manager.
//
// Inside a Sprite:
//   Uses `sprite-env checkpoints create / list / restore` directly via /.sprite/api.sock
//   AND keeps fast organism snapshots in .harmedi/snapshots/ so we can also do instant
//   non-fatal diffs and local development outside a Sprite.
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SPRITE_ENV = "/.sprite/bin/sprite-env";
const ORGANISM_DIR = join(process.cwd(), "organism");
const SNAPSHOTS_DIR = join(process.cwd(), ".harmedi", "snapshots");
const GEN_FILE = join(process.cwd(), ".harmedi", "generation.json");

export type CheckpointInfo = {
  id: string;
  comment?: string;
  create_time?: string;
  source: "sprite" | "local";
};

export function isOnSprite(): boolean {
  return existsSync(SPRITE_ENV);
}

export function getGeneration(): number {
  if (!existsSync(GEN_FILE)) return 0;
  try {
    return Number(JSON.parse(readFileSync(GEN_FILE, "utf8")).generation ?? 0);
  } catch {
    return 0;
  }
}

export function setGeneration(generation: number, lastCheckpointId?: string) {
  mkdirSync(join(process.cwd(), ".harmedi"), { recursive: true });
  writeFileSync(
    GEN_FILE,
    JSON.stringify({ generation, lastCheckpointId, updatedAt: new Date().toISOString() }, null, 2),
  );
}

export function saveLocalSnapshot(tag: string): string {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const safe = tag.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dest = join(SNAPSHOTS_DIR, safe);
  rmSync(dest, { recursive: true, force: true });
  cpSync(ORGANISM_DIR, dest, { recursive: true });
  return safe;
}

export function restoreLocalSnapshot(tag: string): boolean {
  const safe = tag.replace(/[^a-zA-Z0-9._-]/g, "_");
  const src = join(SNAPSHOTS_DIR, safe);
  if (!existsSync(src)) return false;
  rmSync(ORGANISM_DIR, { recursive: true, force: true });
  cpSync(src, ORGANISM_DIR, { recursive: true });
  return true;
}

export async function createCheckpoint(comment: string): Promise<CheckpointInfo> {
  const localTag = saveLocalSnapshot(`gen-${getGeneration()}-${Date.now()}`);

  if (isOnSprite()) {
    try {
      await execFileAsync(SPRITE_ENV, ["checkpoints", "create", "--comment", comment.slice(0, 120)], {
        timeout: 15_000,
      });
      const list = await listCheckpoints();
      const latest = list.find((c) => c.source === "sprite" && c.id !== "Current");
      if (latest) return latest;
    } catch (e) {
      console.warn("sprite-env checkpoints create failed:", (e as Error).message);
    }
  }

  return {
    id: localTag,
    comment,
    create_time: new Date().toISOString(),
    source: "local",
  };
}

export async function listCheckpoints(): Promise<CheckpointInfo[]> {
  const out: CheckpointInfo[] = [];

  if (isOnSprite()) {
    try {
      const { stdout } = await execFileAsync(SPRITE_ENV, ["checkpoints", "list"], { timeout: 8_000 });
      const parsed = JSON.parse(stdout) as Array<{ id: string; comment?: string; create_time?: string; is_auto?: boolean }>;
      for (const c of parsed) {
        if (c.id === "Current") continue;
        out.push({
          id: c.id,
          comment: c.comment ?? (c.is_auto ? "(auto)" : ""),
          create_time: c.create_time,
          source: "sprite",
        });
      }
    } catch (e) {
      console.warn("sprite-env checkpoints list failed:", (e as Error).message);
    }
  }

  if (existsSync(SNAPSHOTS_DIR)) {
    const dirs = readdirSync(SNAPSHOTS_DIR).sort().reverse();
    for (const d of dirs.slice(0, 12)) {
      out.push({ id: d, comment: "local organism snapshot", source: "local" });
    }
  }

  return out;
}

export async function restoreCheckpoint(id: string): Promise<{ restored: boolean; method: "sprite" | "local" | "none" }> {
  // Always try local snapshot if it matches
  if (restoreLocalSnapshot(id)) {
    return { restored: true, method: "local" };
  }

  if (isOnSprite()) {
    try {
      await execFileAsync(SPRITE_ENV, ["checkpoints", "restore", id], { timeout: 20_000 });
      return { restored: true, method: "sprite" };
    } catch (e) {
      console.warn("sprite-env checkpoints restore failed:", (e as Error).message);
    }
  }

  return { restored: false, method: "none" };
}
