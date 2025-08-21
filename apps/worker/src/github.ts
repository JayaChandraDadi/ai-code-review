// github.ts
export type GhFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  // extra (optional) fields for LLM:
  content?: string; // raw text at head SHA (best-effort)
  sha?: string;     // PR head SHA
};

type GitHubPRFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  contents_url?: string; // provided by GH API
};

async function ghFetch(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "ai-code-review-assistant",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub fetch failed: ${res.status} ${text}`);
  }
  return res;
}

export async function fetchPRFiles(repo: string, prNumber: number, token: string): Promise<GhFile[]> {
  // 1) List changed files (has additions/deletions/changes/patch + contents_url)
  const filesUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100`;
  const filesRes = await ghFetch(filesUrl, token);
  const prFiles = (await filesRes.json()) as GitHubPRFile[];

  // 2) Get head SHA to fetch contents at the PR tip
  const prUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}`;
  const prRes = await ghFetch(prUrl, token);
  const prData = await prRes.json();
  const headSha: string = prData?.head?.sha;

  // 3) Best‑effort fetch raw content for each file
  //    (skip removed files; limit concurrency to be gentle)
  const [owner, name] = repo.split("/");
  const MAX_CONCURRENCY = 4;
  let inFlight = 0;
  const queue: Array<() => Promise<void>> = [];
  const out: GhFile[] = [];

  function runTask<T>(fn: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      const task = async () => {
        inFlight++;
        try {
          const val = await fn();
          resolve(val);
        } catch (e) {
          reject(e);
        } finally {
          inFlight--;
          next();
        }
      };
      queue.push(task);
      next();
    });
  }
  function next() {
    while (inFlight < MAX_CONCURRENCY && queue.length) {
      const t = queue.shift()!;
      void t();
    }
  }

  function looksBinary(text: string) {
    // Heuristic: presence of many NULs or replacement chars indicates binary
    const nulCount = (text.match(/\u0000/g) || []).length;
    const replCount = (text.match(/\uFFFD/g) || []).length;
    return nulCount > 0 || replCount > 5;
  }

  await Promise.all(
    prFiles.map((f) =>
      runTask(async () => {
        let content: string | undefined;

        // Skip removed files (not present at head)
        if (f.status !== "removed" && headSha) {
          try {
            // Prefer the contents API with the head ref
            const contentsUrl =
              f.contents_url ??
              `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(
                f.filename
              )}?ref=${headSha}`;

            const contRes = await ghFetch(
              contentsUrl.includes("?")
                ? `${contentsUrl}&ref=${headSha}`
                : `${contentsUrl}?ref=${headSha}`,
              token
            );
            const cont = await contRes.json() as { content?: string; encoding?: string };

            if (cont?.content && cont.encoding === "base64") {
              const decoded = Buffer.from(cont.content, "base64").toString("utf-8");
              if (!looksBinary(decoded) && decoded.trim().length > 0) {
                content = decoded;
              }
            }
          } catch {
            // binary, too large, or not available → leave content undefined
          }
        }

        out.push({
          filename: f.filename,
          status: f.status,
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          changes: f.changes ?? ((f.additions ?? 0) + (f.deletions ?? 0)),
          patch: f.patch,
          content,
          sha: headSha,
        });
      })
    )
  );

  return out;
}
