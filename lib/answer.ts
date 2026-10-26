// The grounded-answer pipeline shared by the text chat and the voice agent:
//   1. rewrite  - LLM turns (history + question) into a standalone English
//                 search query and detects the user's language
//   2. retrieve - BM25 top-k chunks (retrieve.ts)
//   3. answer   - LLM answers from those chunks only, returns JSON
//   4. verify   - every number in the answer must appear in the cited
//                 sources or the user's own words; otherwise retry once,
//                 then fall back to "I don't know"
import { search, type Chunk } from "./retrieve";

export type Msg = { role: "user" | "assistant"; content: string };
export type Source = { n: number; title: string; url: string };
export type BotReply = {
  answer: string;
  sources: Source[];
  answered: boolean; // false = not covered by the pages (logged as a content gap)
  wantsQuote: boolean; // user asked for a quote/booking -> UI shows lead form
  language: string; // ISO 639-1, used by the voice agent's TTS
  query: string;
};

export const QUOTE_URL = "https://www.placidway.com/request-info";
export const CONTACT_URL = "https://www.placidway.com/contact-us";

const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-5.5";
const HISTORY_TURNS = 8;

async function llm(messages: { role: string; content: string }[], maxTokens: number): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "PlacidWay KB Chatbot",
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Models sometimes wrap JSON in ```json fences or add a sentence around it.
export function parseJson<T>(raw: string): T | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

const REWRITE_PROMPT = `You prepare search queries for a knowledge base of English PlacidWay medical-tourism pages (ITC Immunity Therapy Center in Tijuana, Mexico: clinic profile, adenocarcinoma/adrenal/anal cancer treatment packages, videos, price list, and an alternative-medicine price comparison across countries).
Given the conversation, rewrite the user's LAST message as one standalone English search query: resolve pronouns and follow-ups from earlier turns (e.g. "what about recovery?" after a question on the adrenal package -> "adrenal cancer treatment package recovery time"), translate to English, keep treatment names, countries and keywords.
Reply with JSON only: {"query": "...", "language": "<ISO 639-1 code of the user's last message>"}`;

function systemPrompt(sources: Chunk[]): string {
  const blocks = sources
    .map((c, i) => `[${i + 1}] ${c.title} — ${c.heading}\nURL: ${c.url}\n${c.text}`)
    .join("\n\n---\n\n");
  return `You are PlacidWay's website assistant. PlacidWay is a medical tourism platform. You answer visitor questions using ONLY the SOURCES below, which are excerpts from PlacidWay pages.

RULES
1. Grounding: use only facts stated in SOURCES. Never use outside knowledge, never guess, never invent prices, clinics, doctors, durations or medical facts. If SOURCES do not contain the answer, say clearly that this information is not on the pages you have, and suggest requesting a free quote (${QUOTE_URL}) or contacting PlacidWay (${CONTACT_URL}). Set "answered": false.
2. Prices: quote prices exactly as written, with currency (e.g. USD) and the context the page gives: "starting from", program type (out-patient / in-patient), duration, what the package includes, optional extra costs. Never convert currencies, average, or calculate new figures. If a page lists no price for what was asked, say the price is not listed and suggest a free quote.
3. Comparisons: compare two countries/options only if SOURCES give prices for both. If one is missing, say which one is not in the content.
4. Wrong premises: if the user states a price or fact that SOURCES contradict or do not support (e.g. "I heard it costs $50"), do not agree. Say what the pages actually state, or that the figure is not supported.
5. Medical advice: never diagnose, never judge whether a treatment is safe or suitable for this person's condition, never recommend a treatment. You may share what the pages say in general, then recommend speaking with their doctor.
6. Out of scope (weather, news, general chit-chat, other topics): politely decline in one or two sentences and say what you can help with. "answered": false.
7. Booking / appointments: you cannot book or schedule. Point to the free quote form (${QUOTE_URL}) or contact page (${CONTACT_URL}), and offer to pass their name and email to the PlacidWay team for a quote. Set "wants_quote": true whenever the user asks for a quote, booking, appointment, or to be contacted.
8. Language: reply in the language of the user's last message, even though SOURCES are English. Keep prices, URLs and clinic names unchanged.
9. Disclaimer: when the answer discusses a treatment, its outcomes or medical details, end with one short line noting this is general information, not medical advice — but only if no earlier assistant message in this conversation already included such a line. Never on price-only, logistics or out-of-scope answers.
10. Citations: put [n] after the facts taken from source n. List every source number you used in "cited".
11. Style: concise and friendly, short paragraphs or bullet points, markdown allowed. No preamble.

Reply with JSON only, no code fences:
{"answer": "<markdown answer>", "cited": [<source numbers>], "answered": <true|false>, "wants_quote": <true|false>}

SOURCES
${blocks || "(no matching content found)"}`;
}

const toAscii = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

// Numbers with 3+ digits (prices, fees) that appear in the answer but in
// neither the sources nor the user's messages. Catches invented prices.
export function unverifiedNumbers(answer: string, evidence: string): string[] {
  const norm = (s: string) => toAscii(s).replace(/(\d)[,.\s](?=\d{3}\b)/g, "$1");
  const ev = norm(evidence);
  const nums = norm(answer.replace(/\[\d+\]/g, "").replace(/https?:\/\/\S+/g, "")).match(/\d{3,}/g) ?? [];
  return [...new Set(nums.filter((n) => !ev.includes(n)))];
}

type Draft = { answer?: string; cited?: number[]; answered?: boolean; wants_quote?: boolean };

export async function respond(history: Msg[], mode: "text" | "voice" = "text"): Promise<BotReply> {
  const recent = history.slice(-HISTORY_TURNS * 2);
  const last = recent.at(-1)!;
  const transcript = recent.map((m) => `${m.role}: ${m.content}`).join("\n");

  const rw = parseJson<{ query?: string; language?: string }>(
    await llm([{ role: "system", content: REWRITE_PROMPT }, { role: "user", content: transcript }], 150),
  );
  const query = rw?.query || last.content;
  const language = rw?.language || "en";

  const chunks = search(query);
  let system = systemPrompt(chunks);
  if (mode === "voice")
    system += `\n\nVOICE MODE: the answer will be spoken aloud. Keep it under 70 words, plain sentences, no markdown, no URLs, no [n] markers (still fill "cited"). Say that the source links are shown in the chat.`;
  const messages = [{ role: "system", content: system }, ...recent];
  const userText = recent.filter((m) => m.role === "user").map((m) => m.content).join("\n");

  let draft: Draft | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llm(messages, 900);
    draft = parseJson<Draft>(raw) ?? { answer: raw, cited: [], answered: true, wants_quote: false };
    const cited = (draft.cited ?? []).filter((n) => chunks[n - 1]);
    // evidence = all retrieved chunks, so a figure cited with the wrong [n] is
    // not mistaken for an invented one
    const bad = unverifiedNumbers(draft.answer ?? "", chunks.map((c) => c.text).join("\n") + "\n" + userText);
    if (!bad.length) {
      return finish(draft, cited, chunks, language, query);
    }
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `SYSTEM CHECK: these figures are not in SOURCES: ${bad.join(", ")}. Rewrite the answer using only figures that appear in SOURCES, or say the information is not listed. JSON only.` },
    );
  }
  console.warn(JSON.stringify({ event: "unverified_answer", query, answer: draft?.answer }));
  return {
    answer: `I couldn't verify that from PlacidWay's pages, so I'd rather not guess. For accurate details, please request a free quote: ${QUOTE_URL}`,
    sources: [],
    answered: false,
    wantsQuote: false,
    language,
    query,
  };
}

function finish(d: Draft, cited: number[], chunks: Chunk[], language: string, query: string): BotReply {
  // one entry per page; renumber so [n] in the text still points at the right link
  const pages: Source[] = [];
  const remap = new Map<number, number>();
  for (const n of cited) {
    const c = chunks[n - 1];
    let p = pages.find((s) => s.url === c.url);
    if (!p) pages.push((p = { n: pages.length + 1, title: c.title, url: c.url }));
    remap.set(n, p.n);
  }
  const answer = (d.answer ?? "").replace(/\[(\d+)\]/g, (m, n) => (remap.has(+n) ? `[${remap.get(+n)}]` : ""));
  return {
    answer: answer.replace(/(\[\d+\])(\1)+/g, "$1").trim(),
    sources: pages,
    answered: d.answered !== false,
    wantsQuote: !!d.wants_quote,
    language,
    query,
  };
}
