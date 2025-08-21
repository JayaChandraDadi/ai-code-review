async function ghFetch(url, token) {
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
export async function fetchPRFiles(repo, prNumber, token) {
    // 1) List changed files (has additions/deletions/changes/patch + contents_url)
    const filesUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100`;
    const filesRes = await ghFetch(filesUrl, token);
    const prFiles = (await filesRes.json());
    // 2) Get head SHA to fetch contents at the PR tip
    const prUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}`;
    const prRes = await ghFetch(prUrl, token);
    const prData = await prRes.json();
    const headSha = prData?.head?.sha;
    // 3) Best‑effort fetch raw content for each file
    //    (skip removed files; limit concurrency to be gentle)
    const [owner, name] = repo.split("/");
    const MAX_CONCURRENCY = 4;
    let inFlight = 0;
    const queue = [];
    const out = [];
    function runTask(fn) {
        return new Promise((resolve, reject) => {
            const task = async () => {
                inFlight++;
                try {
                    const val = await fn();
                    resolve(val);
                }
                catch (e) {
                    reject(e);
                }
                finally {
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
            const t = queue.shift();
            void t();
        }
    }
    function looksBinary(text) {
        // Heuristic: presence of many NULs or replacement chars indicates binary
        const nulCount = (text.match(/\u0000/g) || []).length;
        const replCount = (text.match(/\uFFFD/g) || []).length;
        return nulCount > 0 || replCount > 5;
    }
    await Promise.all(prFiles.map((f) => runTask(async () => {
        let content;
        // Skip removed files (not present at head)
        if (f.status !== "removed" && headSha) {
            try {
                // Prefer the contents API with the head ref
                const contentsUrl = f.contents_url ??
                    `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(f.filename)}?ref=${headSha}`;
                const contRes = await ghFetch(contentsUrl.includes("?")
                    ? `${contentsUrl}&ref=${headSha}`
                    : `${contentsUrl}?ref=${headSha}`, token);
                const cont = await contRes.json();
                if (cont?.content && cont.encoding === "base64") {
                    const decoded = Buffer.from(cont.content, "base64").toString("utf-8");
                    if (!looksBinary(decoded) && decoded.trim().length > 0) {
                        content = decoded;
                    }
                }
            }
            catch {
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
    })));
    return out;
}
