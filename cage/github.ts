// GitHub integration via Sprites OAuth Connector (no PAT on the VM).
import { getConnector, json } from "./gateway.ts";

const GH_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "harmedi/0.1",
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
};

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
  };

  if (!(await getConnector("github"))) return base;

  try {
    const d = await json<any>("github", `/repos/${repo}/commits/${sha}`, undefined, GH_HEADERS);
    const files: string[] = (d.files ?? []).map(
      (f: any) => `${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`,
    );
    const diff = (d.files ?? [])
      .slice(0, 8)
      .map((f: any) => `--- ${f.filename}\n${(f.patch ?? "(binary or large file)").slice(0, 1200)}`)
      .join("\n\n");
    return {
      sha: d.sha ?? sha,
      repo,
      author: d.commit?.author?.name ?? d.author?.login ?? base.author,
      message: d.commit?.message ?? base.message,
      url: d.html_url ?? base.url,
      timestamp: d.commit?.author?.date ?? base.timestamp,
      diff: diff || base.diff,
      files,
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

export async function listRecentCommits(repo: string, limit = 5): Promise<Array<{ sha: string; message: string; author: string; date: string; url: string }>> {
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
