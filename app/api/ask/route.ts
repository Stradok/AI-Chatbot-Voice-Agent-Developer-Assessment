import { respond } from "@/lib/answer";
import { bearerOk } from "@/lib/auth";
import { logTurn, rateLimited } from "@/lib/store";

export const maxDuration = 60;

// HTTP tool for the LiveKit Agent Builder agent (maya): the grounded pipeline
// behind a one-field API. The agent's LLM calls it for every factual question
// and speaks the result. Auth: Authorization: Bearer $VOICE_TOOL_TOKEN.
export async function POST(req: Request) {
  if (!bearerOk(req, process.env.VOICE_TOOL_TOKEN)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (await rateLimited(req, "ask", 300)) return Response.json({ error: "rate limited" }, { status: 429 });
  const b = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof b?.question === "string" ? b.question.trim().slice(0, 1000) : "";
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });
  try {
    const reply = await respond([{ role: "user", content: question }], "phone");
    await logTurn("phone", question, reply);
    return Response.json({
      answer: reply.answer,
      sources: reply.sources.map((s) => s.title), // page names the agent can mention aloud
      answered: reply.answered,
      wants_quote: reply.wantsQuote,
    });
  } catch (err) {
    console.error("ask failed:", err);
    return Response.json({ error: "The knowledge base is unavailable right now." }, { status: 502 });
  }
}
