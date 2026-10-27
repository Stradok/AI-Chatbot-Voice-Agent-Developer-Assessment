import { bearerOk } from "@/lib/auth";
import { record } from "@/lib/store";

// "Summary and data collection endpoint" of the Agent Builder (Call ending).
// LiveKit POSTs job_id, room, started_at, ended_at, summary, results when a
// call finishes. Auth: Authorization: Bearer $VOICE_TOOL_TOKEN.
export async function POST(req: Request) {
  if (!bearerOk(req, process.env.VOICE_TOOL_TOKEN)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "invalid body" }, { status: 400 });
  const text = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  await record("calls", {
    job_id: text(b.job_id, 100),
    room: text(b.room, 100),
    started_at: text(b.started_at, 40),
    ended_at: text(b.ended_at, 40),
    summary: text(b.summary, 4000),
    results: JSON.stringify(b.results ?? null).slice(0, 4000),
  });
  return Response.json({ ok: true });
}
