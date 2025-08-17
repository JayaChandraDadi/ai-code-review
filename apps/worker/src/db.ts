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