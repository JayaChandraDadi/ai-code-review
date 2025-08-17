import { consume } from './rabbitmq.js';
import { insertReviewEvent } from './db.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL!;
const QUEUE_NAME = process.env.QUEUE_NAME || 'pull_requests';

(async () => {
  await consume(RABBITMQ_URL, QUEUE_NAME, async (msg) => {
    const payload = JSON.parse(msg.content.toString());
    await insertReviewEvent({
      id: payload.id,
      repo: payload.repo,
      pr_number: payload.pr_number,
      head_sha: payload.head_sha,
      status: 'RECEIVED',
      payload
    });
    console.log('stored review_event', payload.id, payload.repo, `#${payload.pr_number}`);
  });
})();