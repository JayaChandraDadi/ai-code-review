import * as crypto from 'crypto';

import type { Request } from 'express';

export function verifyGithubSignature(req: Request, secret: string): boolean {
  const sig = req.header('x-hub-signature-256');
  if (!sig) return false;
  const raw = (req as any).rawBody as Buffer;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(raw);
  const digest = `sha256=${hmac.digest('hex')}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(digest);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}