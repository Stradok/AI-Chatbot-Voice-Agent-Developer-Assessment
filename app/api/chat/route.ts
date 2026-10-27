import { respond, CONTACT_URL, type Msg } from "@/lib/answer";
import { record, rateLimited } from "@/lib/store";

export const maxDuration = 60;

// Validates untrusted input before it reaches the LLM.
function parse(body: unknown): { messages: Msg[]; mode: "text" | "voice" } | string {
  const b = body as { messages?: unknown; mode?: unknown };
  if (!Array.isArray(b?.messages) || !b.messages.length) return "messages must be a non-empty array";
  const messages = b.messages.slice(-30) as Msg[];
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return "invalid message";
    if (m.content.length > 4000) return "message too long";
  }
  if (messages.reduce((n, m) => n + m.content.length, 0) > 12000) return "conversation too long";
  if (messages.at(-1)!.role !== "user" || !messages.at(-1)!.content.trim()) return "last message must be a user question";
  return { messages, mode: b.mode === "voice" ? "voice" : "text" };
}

export async function POST(req: Request) {
  if (await rateLimited(req, "chat", 40)) return Response.json({ error: "Too many requests, please wait a few minutes." }, { status: 429 });
  const input = parse(await req.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  try {
    const reply = await respond(input.messages, input.mode);
    const question = input.messages.at(-1)!.content;
    await Promise.all([
      record("chats", { mode: input.mode, language: reply.language, question, answer: reply.answer, answered: reply.answered, sources: reply.sources.map((s) => s.url), query: reply.query }),
      reply.answered ? null : record("gaps", { question, query: reply.query, mode: input.mode }),
    ]);
    return Response.json(reply);
  } catch (err) {
    console.error("chat failed:", err);
    return Response.json(
      { error: `Sorry, something went wrong on our side. Please try again, or contact PlacidWay: ${CONTACT_URL}` },
      { status: 502 },
    );
  }
}
