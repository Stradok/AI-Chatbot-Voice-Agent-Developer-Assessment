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

import type { BotReply } from "./answer";

export type List = "chats" | "gaps" | "leads" | "calls";

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
    : list === "calls" ? { job_id: entry.job_id }
    : entry;
  console.log(JSON.stringify({ event: list, ...logged }));
  const sinks = [
    redis(["LPUSH", list, JSON.stringify(row)]).then(() => redis(["LTRIM", list, 0, 4999])),
    SHEETS_URL
      ? fetch(SHEETS_URL, { method: "POST", body: JSON.stringify({ sheet: list, row }), signal: AbortSignal.timeout(8000) }).then(async (res) => {
          // the script answers "ok"; a wrong deployment or script error returns a 200 HTML page
          const body = await res.text();
          if (!res.ok || body.trim() !== "ok") throw new Error(`sheets ${res.status}: ${body.replace(/\s+/g, " ").slice(0, 150)}`);
        })
      : null,
  ];
  if (!URL_ && !SHEETS_URL && list === "leads") console.warn("store: no Redis or Sheets configured, lead not persisted");
  for (const r of await Promise.allSettled(sinks)) if (r.status === "rejected") console.error(`store: failed to persist ${list}:`, r.reason);
}

// One chat turn (web text, web voice or phone/maya): always a "chats" row,
// plus a "gaps" row when the pages did not cover the question.
export async function logTurn(mode: string, question: string, reply: BotReply): Promise<void> {
  await Promise.all([
    record("chats", { mode, language: reply.language, question, answer: reply.answer, answered: reply.answered, sources: reply.sources.map((s) => s.url), query: reply.query }),
    reply.answered ? null : record("gaps", { question, query: reply.query, mode }),
  ]);
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
