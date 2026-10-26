// Append-only lists for content gaps (unanswered questions) and quote leads.
// Always written to the server log; also pushed to Upstash Redis when its
// REST credentials are set (Vercel's Upstash integration adds them).
// Plain REST calls, so no Redis client dependency.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd: (string | number)[]): Promise<unknown> {
  if (!URL_ || !TOKEN) return null;
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()).result;
}

export async function record(list: "gaps" | "leads", entry: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  // leads hold PII (name, email): only a masked marker reaches the logs, the
  // full entry goes to Redis only. Gaps are logged in full for content review.
  const logged = list === "leads" ? { email: String(entry.email ?? "").replace(/^(.).*(@.*)$/, "$1***$2") } : entry;
  console.log(JSON.stringify({ event: list, ...logged }));
  if (list === "leads" && (!URL_ || !TOKEN)) console.warn("store: Redis not configured, lead not persisted");
  try {
    await redis(["LPUSH", list, line]);
    await redis(["LTRIM", list, 0, 4999]);
  } catch (err) {
    console.error(`store: failed to persist ${list}:`, err);
  }
}

export async function readList(list: "gaps" | "leads", n = 200): Promise<unknown[] | null> {
  const rows = (await redis(["LRANGE", list, 0, n - 1])) as string[] | null;
  return rows ? rows.map((r) => JSON.parse(r)) : null;
}

// Fixed-window per-IP limit on the endpoints that cost money (LLM, LiveKit)
// or write data. Fails open when Redis is not configured or unreachable.
// ponytail: fixed window allows a 2x burst at the boundary; use a sliding
// window if abuse shows up.
export async function rateLimited(req: Request, bucket: string, limit: number, windowSec = 600): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const key = `rl:${bucket}:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  try {
    const n = (await redis(["INCR", key])) as number | null;
    if (n === 1) await redis(["EXPIRE", key, windowSec]);
    return n !== null && n > limit;
  } catch {
    return false;
  }
}
