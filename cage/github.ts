// GitHub integration via Sprites OAuth Connector (no PAT on the VM).
// Supports:
//   - Fetching commit diffs & raw file contents (for live surgery + cage sync)
//   - Posting deadpan commit comments
//   - Pushing counter-mutations to branch `harmedi/gen-N` and opening a Pull Request
import { getConnector, json } from "./gateway.ts";

const GH_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "harmedi/0.2",
};

export type CommitDetails = {
  sha: string;
  repo: string;
  author: string;
  message: string;
  url: string;
  timestamp: string;
  diff: string;
  files: string[];
  touchedPaths: string[];
  organismUpdates: Record<string, string | null>; // filename in organism/ -> content (null if removed)
  cageUpdates: Record<string, string>; // filename in cage/ -> content
};

const ALLOWED_ORGANISM = new Set(["SOUL.md", "face.html", "brain.ts", "tools.ts"]);

async function fetchFileAtRef(repo: string, filePath: string, ref: string): Promise<string | null> {
  try {
    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
    const d = await json<any>(
      "github",
      `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
      undefined,
      GH_HEADERS,
    );
    if (d?.encoding === "base64" && typeof d.content === "string") {
      return Buffer.from(d.content.replace(/\n/g, ""), "base64").toString("utf8");
    }
    return null;
  } catch (e) {
    console.warn(`GitHub fetchFileAtRef(${filePath}) failed:`, (e as Error).message);
    return null;
  }
}

export async function fetchCommit(repo: string, sha: string, fallback?: Partial<CommitDetails>): Promise<CommitDetails> {
  const base: CommitDetails = {
    sha,
    repo,
    author: fallback?.author ?? "creator",
    message: fallback?.message ?? "",
    url: fallback?.url ?? `https://github.com/${repo}/commit/${sha}`,
    timestamp: fallback?.timestamp ?? new Date().toISOString(),
    diff: fallback?.diff ?? "",
    files: fallback?.files ?? [],
    touchedPaths: [],
    organismUpdates: {},
    cageUpdates: {},
  };

  if (!(await getConnector("github"))) return base;

  try {
    const d = await json<any>("github", `/repos/${repo}/commits/${sha}`, undefined, GH_HEADERS);
    const rawFiles: any[] = d.files ?? [];
    const files: string[] = rawFiles.map(
      (f) => `${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`,
    );
    const touchedPaths: string[] = rawFiles.map((f) => String(f.filename));
    const diff = rawFiles
      .slice(0, 10)
      .map((f) => `--- ${f.filename} (${f.status})\n${(f.patch ?? "(binary or large file)").slice(0, 1400)}`)
      .join("\n\n");

    const organismUpdates: Record<string, string | null> = {};
    const cageUpdates: Record<string, string> = {};

    await Promise.all(
      rawFiles.map(async (f) => {
        const filename = String(f.filename ?? "");
        if (filename.startsWith("organism/")) {
          const short = filename.slice("organism/".length);
          if (!ALLOWED_ORGANISM.has(short)) return;
          if (f.status === "removed") {
            organismUpdates[short] = null;
          } else {
            const content = await fetchFileAtRef(repo, filename, d.sha ?? sha);
            if (content !== null) organismUpdates[short] = content;
          }
        } else if (filename.startsWith("cage/") && !filename.includes("..") && f.status !== "removed") {
          const short = filename.slice("cage/".length);
          if (!short || short.includes("/")) return;
          const content = await fetchFileAtRef(repo, filename, d.sha ?? sha);
          if (content !== null) cageUpdates[short] = content;
        }
      }),
    );

    return {
      sha: d.sha ?? sha,
      repo,
      author: d.commit?.author?.name ?? d.author?.login ?? base.author,
      message: d.commit?.message ?? base.message,
      url: d.html_url ?? base.url,
      timestamp: d.commit?.author?.date ?? base.timestamp,
      diff: diff || base.diff,
      files,
      touchedPaths,
      organismUpdates,
      cageUpdates,
    };
  } catch (e) {
    console.warn("GitHub fetchCommit failed:", (e as Error).message);
    return base;
  }
}

export async function commentOnCommit(repo: string, sha: string, body: string): Promise<boolean> {
  if (!(await getConnector("github")) || !repo || !sha || sha.startsWith("sim-")) return false;
  try {
    await json("github", `/repos/${repo}/commits/${sha}/comments`, { body }, GH_HEADERS);
    return true;
  } catch (e) {
    console.warn("GitHub commentOnCommit skipped:", (e as Error).message);
    return false;
  }
}

export async function openCounterPR(opts: {
  repo: string;
  baseSha: string;
  baseBranch?: string;
  generation: number;
  title: string;
  body: string;
  commitMessage: string;
  organismFiles: Record<string, string>;
}): Promise<{ prUrl: string; prNumber: number; branch: string } | null> {
  if (!(await getConnector("github")) || !opts.repo || !opts.baseSha || opts.baseSha.startsWith("sim-")) {
    return null;
  }

  try {
    const baseBranch = opts.baseBranch ?? "main";
    // 1. Get base commit's tree SHA
    const baseCommit = await json<any>(
      "github",
      `/repos/${opts.repo}/git/commits/${opts.baseSha}`,
      undefined,
      GH_HEADERS,
    );
    const baseTreeSha: string = baseCommit.tree?.sha;
    if (!baseTreeSha) return null;

    // 2. Create blobs + new tree for organism/*
    const entries = Object.entries(opts.organismFiles).filter(([, v]) => typeof v === "string" && v.length > 0);
    if (!entries.length) return null;

    const treeEntries = await Promise.all(
      entries.map(async ([name, content]) => {
        const blob = await json<{ sha: string }>(
          "github",
          `/repos/${opts.repo}/git/blobs`,
          { content, encoding: "utf-8" },
          GH_HEADERS,
        );
        return {
          path: `organism/${name}`,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        };
      }),
    );

    const newTree = await json<{ sha: string }>(
      "github",
      `/repos/${opts.repo}/git/trees`,
      { base_tree: baseTreeSha, tree: treeEntries },
      GH_HEADERS,
    );

    // 3. Create commit authored by harmedi
    const newCommit = await json<{ sha: string }>(
      "github",
      `/repos/${opts.repo}/git/commits`,
      {
        message: opts.commitMessage,
        tree: newTree.sha,
        parents: [opts.baseSha],
        author: {
          name: `harmedi (gen ${opts.generation})`,
          email: process.env.HARMEDI_INBOX ?? "harmedi@agentmail.to",
          date: new Date().toISOString(),
        },
      },
      GH_HEADERS,
    );

    // 4. Create unique branch ref `harmedi/gen-<N>-<short>`
    const branch = `harmedi/gen-${opts.generation}-${newCommit.sha.slice(0, 6)}`;
    await json(
      "github",
      `/repos/${opts.repo}/git/refs`,
      { ref: `refs/heads/${branch}`, sha: newCommit.sha },
      GH_HEADERS,
    );

    // 5. Open Pull Request back to main
    const pr = await json<{ html_url: string; number: number }>(
      "github",
      `/repos/${opts.repo}/pulls`,
      {
        title: opts.title.slice(0, 120),
        head: branch,
        base: baseBranch,
        body: opts.body,
      },
      GH_HEADERS,
    );

    return { prUrl: pr.html_url, prNumber: pr.number, branch };
  } catch (e) {
    console.warn("GitHub openCounterPR skipped:", (e as Error).message);
    return null;
  }
}

export async function listRecentCommits(
  repo: string,
  limit = 5,
): Promise<Array<{ sha: string; message: string; author: string; date: string; url: string }>> {
  if (!(await getConnector("github")) || !repo) return [];
  try {
    const list = await json<any[]>("github", `/repos/${repo}/commits?per_page=${limit}`, undefined, GH_HEADERS);
    return (list ?? []).map((c) => ({
      sha: String(c.sha ?? "").slice(0, 7),
      message: String(c.commit?.message ?? "").split("\n")[0],
      author: String(c.author?.login ?? c.commit?.author?.name ?? "unknown"),
      date: String(c.commit?.author?.date ?? ""),
      url: String(c.html_url ?? ""),
    }));
  } catch {
    return [];
  }
}
