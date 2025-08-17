import express from 'express';
import bodyParser from 'body-parser';
import { getChannel, publish } from './rabbitmq.js';
import { verifyGithubSignature } from './signature.js';
import { v4 as uuidv4 } from 'uuid';
import type { ReviewTask } from './types.js';

const app = express();

// capture raw body for HMAC
app.use(bodyParser.json({ verify: (req, _res, buf) => ((req as any).rawBody = buf) }));

const PORT = parseInt(process.env.PORT || '8080', 10);
const RABBITMQ_URL = process.env.RABBITMQ_URL!;
const QUEUE_NAME = process.env.QUEUE_NAME || 'pull_requests';
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

async function connectQueueWithRetry(url: string, queue: string, attempts = 20) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await getChannel(url, queue);
      console.log('RabbitMQ channel ready');
      return;
    } catch (e: any) {
      console.error(`RabbitMQ connect attempt ${i} failed: ${e?.message || e}`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw new Error('Could not connect to RabbitMQ after retries');
}

(async () => {
  await connectQueueWithRetry(RABBITMQ_URL, QUEUE_NAME);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.post('/webhooks/github', async (req, res) => {
    if (!verifyGithubSignature(req, GITHUB_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const event = req.header('x-github-event');
    const delivery = req.header('x-github-delivery') || '';
    const payload = req.body;
    if (event !== 'pull_request') return res.status(204).end();

    const action = payload.action;
    if (!['opened', 'synchronize', 'reopened'].includes(action)) {
      return res.status(204).end();
    }

    const repo = payload.repository?.full_name as string;
    const pr_number = payload.pull_request?.number as number;
    const head_sha = payload.pull_request?.head?.sha as string;

    const task: ReviewTask = {
      id: uuidv4(),
      repo,
      pr_number,
      head_sha,
      files: [],
      delivery_id: delivery,
    };

    await publish(QUEUE_NAME, task);
    return res.status(202).json({ queued: true, id: task.id });
  });

  app.listen(PORT, () => console.log(`api-gateway listening on :${PORT}`));
})();
