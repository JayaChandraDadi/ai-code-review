import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function insertReviewEvent(row: {
  id: string;
  repo: string;
  pr_number: number;
  head_sha: string;
  status: string;
  payload: any;
}) {
  const sql = `INSERT INTO review_events (id, repo, pr_number, head_sha, status, payload)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (id) DO NOTHING`;
  await pool.query(sql, [row.id, row.repo, row.pr_number, row.head_sha, row.status, row.payload]);
}
export async function updateFindings(id: string, findings: any, status: string = 'REVIEWED') {
  const sql = `UPDATE review_events SET status=$2, findings=$3, reviewed_at=NOW() WHERE id=$1`;
  await pool.query(sql, [id, findings, status]);
}