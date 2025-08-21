import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

/**
 * GET /reviews/:id
 * Returns the review_event and its findings JSON.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await query(
      `SELECT id, repo, pr_number, head_sha, status, received_at, reviewed_at, findings
       FROM review_events
       WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  } catch (err: any) {
    console.error('GET /reviews/:id error', err);
    return res.status(500).json({ error: 'internal' });
  }
});

export default router;
