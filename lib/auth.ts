// Constant-time bearer check. Fails closed when the secret is not configured.
import { timingSafeEqual } from "node:crypto";

export function bearerOk(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
