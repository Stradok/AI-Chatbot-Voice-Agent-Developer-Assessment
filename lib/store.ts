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
  console.log(JSON.stringify({ event: list, ...entry }));
  try {
    await redis(["LPUSH", list, line]);
    await redis(["LTRIM", list, 0, 4999]);
  } catch (err) {
    console.error(`store: failed to persist ${list}:`, err); // the log line above is the fallback copy
  }
}

export async function readList(list: "gaps" | "leads", n = 200): Promise<unknown[] | null> {
  const rows = (await redis(["LRANGE", list, 0, n - 1])) as string[] | null;
  return rows ? rows.map((r) => JSON.parse(r)) : null;
}
