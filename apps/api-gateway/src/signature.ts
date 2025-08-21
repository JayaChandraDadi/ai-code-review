// apps/api-gateway/src/signature.ts
import crypto from "crypto";
import type { Request } from "express";

export function verifyGithubSignature(req: Request, secret: string): boolean {
  // Optional dev bypass
  if (process.env.SKIP_SIGNATURE === "true") return true;

  if (!secret) return false;

  // GitHub sends "X-Hub-Signature-256: sha256=<hex>"
  const header =
    (req.headers["x-hub-signature-256"] as string) ||
    (req.headers["x-hub-signature"] as string) ||
    "";

  // MUST hash the *raw* bytes captured by the body parser
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw || !header) return false;

  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
