// Append-only lists: every chat turn, content gaps (unanswered questions) and
// quote leads. Written to Upstash Redis when its REST credentials are set
// (Vercel's Upstash integration adds them) and/or a Google Sheet (see below).
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

export type List = "chats" | "gaps" | "leads";

// Optional Google Sheets sink (free, no Redis needed): a tiny Apps Script web
// app appends each row to a tab named after the list. See docs/google-sheets-script.gs.
const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL;

export async function record(list: List, entry: Record<string, unknown>): Promise<void> {
  const row = { at: new Date().toISOString(), ...entry };
  // Logs stay free of personal data: leads (name, email) log a masked email only,
  // chats log no text at all, gaps log the question for content review.
  const logged =
    list === "leads" ? { email: String(entry.email ?? "").replace(/^(.).*(@.*)$/, "$1***$2") }
    : list === "chats" ? { mode: entry.mode, answered: entry.answered }
    : entry;
  console.log(JSON.stringify({ event: list, ...logged }));
  const sinks = [
    redis(["LPUSH", list, JSON.stringify(row)]).then(() => redis(["LTRIM", list, 0, 4999])),
    SHEETS_URL
      ? fetch(SHEETS_URL, { method: "POST", body: JSON.stringify({ sheet: list, row }), signal: AbortSignal.timeout(8000) })
      : null,
  ];
  if (!URL_ && !SHEETS_URL && list === "leads") console.warn("store: no Redis or Sheets configured, lead not persisted");
  for (const r of await Promise.allSettled(sinks)) if (r.status === "rejected") console.error(`store: failed to persist ${list}:`, r.reason);
}

export async function readList(list: List, n = 1000): Promise<Record<string, unknown>[] | null> {
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
