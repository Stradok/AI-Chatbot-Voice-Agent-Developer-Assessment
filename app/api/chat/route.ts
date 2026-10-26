import { respond, CONTACT_URL, type Msg } from "@/lib/answer";
import { record } from "@/lib/store";

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
  if (messages.at(-1)!.role !== "user" || !messages.at(-1)!.content.trim()) return "last message must be a user question";
  return { messages, mode: b.mode === "voice" ? "voice" : "text" };
}

export async function POST(req: Request) {
  const input = parse(await req.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  try {
    const reply = await respond(input.messages, input.mode);
    if (!reply.answered)
      await record("gaps", { question: input.messages.at(-1)!.content, query: reply.query, mode: input.mode });
    return Response.json(reply);
  } catch (err) {
    console.error("chat failed:", err);
    return Response.json(
      { error: `Sorry, something went wrong on our side. Please try again, or contact PlacidWay: ${CONTACT_URL}` },
      { status: 502 },
    );
  }
}
