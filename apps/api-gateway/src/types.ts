export type ReviewTask = {
  id: string;
  repo: string;        // e.g., "owner/repo"
  pr_number: number;
  head_sha: string;
  files: { path: string; status: string }[]; // empty for sprint 1
  delivery_id: string; // X-GitHub-Delivery
};