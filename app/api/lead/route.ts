import { bearerOk } from "@/lib/auth";
import { record, rateLimited } from "@/lib/store";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: Request) {
  // the voice agent (maya) calls this as a tool with VOICE_TOOL_TOKEN; its calls share one IP, so they skip the per-IP limit
  if (!bearerOk(req, process.env.VOICE_TOOL_TOKEN) && (await rateLimited(req, "lead", 5))) return Response.json({ error: "Too many requests, please wait a few minutes." }, { status: 429 });
  const b = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown; question?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 100) : "";
  const email = typeof b?.email === "string" ? b.email.trim().slice(0, 200) : "";
  const question = typeof b?.question === "string" ? b.question.slice(0, 1000) : "";
  if (!name || !EMAIL.test(email)) return Response.json({ error: "Please enter your name and a valid email." }, { status: 400 });
  await record("leads", { name, email, question });
  return Response.json({ ok: true });
}
