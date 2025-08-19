export type GhFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export async function fetchPRFiles(repo: string, prNumber: number, token: string): Promise<GhFile[]> {
  const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ai-code-review-assistant',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub files fetch failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GhFile[];
}
