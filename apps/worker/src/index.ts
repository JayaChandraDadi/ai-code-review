import { consume } from './rabbitmq.js';
import { insertReviewEvent, updateFindings } from './db.js';
import { fetchPRFiles } from './github.js';
import { analyzeFiles } from './rules.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL!;
const QUEUE_NAME = process.env.QUEUE_NAME || 'pull_requests';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

(async () => {
  await consume(RABBITMQ_URL, QUEUE_NAME, async (msg) => {
    const payload = JSON.parse(msg.content.toString());

    // 1) audit row as RECEIVED
    await insertReviewEvent({
      id: payload.id,
      repo: payload.repo,
      pr_number: payload.pr_number,
      head_sha: payload.head_sha,
      status: 'RECEIVED',
      payload
    });

    // 2) fetch PR files (best effort)
    let findings: any = { issues: [], meta: {} };
    try {
      if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN missing');
      const files = await fetchPRFiles(payload.repo, payload.pr_number, GITHUB_TOKEN);
      findings = analyzeFiles(files);
      findings.meta = { ...(findings.meta||{}), file_count: files.length, fetch_ok: true };
    } catch (err: any) {
      findings.meta = { ...(findings.meta||{}), fetch_ok: false, error: String(err?.message || err) };
      console.error('review error', payload.id, findings.meta.error);
    }

    // 3) persist results as REVIEWED
    await updateFindings(payload.id, findings, 'REVIEWED');
    console.log('reviewed', payload.id, payload.repo, `#${payload.pr_number}`, `${findings.issues.length} issues`);
  });
})();
