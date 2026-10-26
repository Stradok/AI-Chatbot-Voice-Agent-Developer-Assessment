import { record } from "@/lib/store";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown; question?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 100) : "";
  const email = typeof b?.email === "string" ? b.email.trim().slice(0, 200) : "";
  const question = typeof b?.question === "string" ? b.question.slice(0, 1000) : "";
  if (!name || !EMAIL.test(email)) return Response.json({ error: "Please enter your name and a valid email." }, { status: 400 });
  await record("leads", { name, email, question });
  return Response.json({ ok: true });
}
