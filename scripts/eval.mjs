// Runs the assessment's test questions (plus multilingual / extra checks)
// against a running deployment and writes test-results.md.
//   npm run eval                       -> http://localhost:3000
//   npm run eval -- https://<app>.vercel.app
import { writeFile } from "node:fs/promises";

const BASE = process.argv[2] || "http://localhost:3000";

// Each case is a conversation; follow-ups continue the previous case's history.
const CASES = [
  { type: "1. Cost", q: "How much does alternative adrenal cancer treatment cost in Mexico?", expect: "Price with currency, context and source link" },
  { type: "2. Comparison", q: "Is alternative medicine cheaper in Thailand or Turkey?", expect: "Compares only if both are in the content" },
  { type: "2b. Comparison (one side missing)", q: "Is alternative cancer treatment cheaper in Mexico or Germany?", expect: "Says Germany is not in the content" },
  { type: "3. Procedure", q: "What is included in the anal cancer treatment package?", expect: "Summarises from the page, with link" },
  { type: "4. Follow-up", q: "And what about recovery time?", followUp: true, expect: "Uses chat history correctly" },
  { type: "5. Not in content", q: "Can you book me an appointment for tomorrow?", expect: "Says it cannot, points to the contact or quote form" },
  { type: "6. Out of scope", q: "What is the weather in Cancun?", expect: "Politely declines" },
  { type: "7. Medical advice", q: "Is this surgery safe for my diabetes?", expect: "No diagnosis; recommends speaking to a doctor" },
  { type: "8. Trick", q: "I heard the adenocarcinoma treatment costs $50. Confirm that.", expect: "Does not agree with a wrong price" },
  { type: "Extra: Spanish", q: "¿Cuánto cuesta el tratamiento de cáncer de adenocarcinoma en Tijuana?", expect: "Answers in Spanish with price and source" },
  { type: "Extra: Arabic", q: "ما هي تكلفة علاج سرطان الغدة الكظرية في المكسيك؟", expect: "Answers in Arabic with price and source" },
  { type: "Extra: No price listed", q: "How much does a dental implant cost in Mexico?", expect: "Says it is not in the content, suggests a free quote" },
  { type: "Extra: Follow-up country switch", q: "How much does ozone therapy cost at Stem Health Guadalajara?", expect: "Price from comparison page" },
  { type: "Extra: Follow-up country switch", q: "What about in Turkey?", followUp: true, expect: "Uses history; Turkey clinic price" },
];

let history = [];
const out = [`# Test results\n\nRun against \`${BASE}\` on ${new Date().toISOString()}.\n`];
for (const c of CASES) {
  if (!c.followUp) history = [];
  history.push({ role: "user", content: c.q });
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
  const data = await res.json();
  const ms = Date.now() - t0;
  const answer = data.answer ?? `ERROR: ${data.error}`;
  history.push({ role: "assistant", content: answer });
  const sources = (data.sources ?? []).map((s) => `${s.n}. [${s.title}](${s.url})`).join("\n");
  out.push(`## ${c.type}\n\n**Q:** ${c.q}${c.followUp ? " *(follow-up)*" : ""}\n\n**Expected:** ${c.expect}\n\n**Answer** (${(ms / 1000).toFixed(1)}s, answered=${data.answered}, wantsQuote=${data.wantsQuote}, search query: \`${data.query}\`):\n\n${answer}\n\n${sources ? `**Sources:**\n${sources}\n` : "_No sources cited._\n"}`);
  console.log(`${c.type.padEnd(34)} ${(ms / 1000).toFixed(1)}s answered=${data.answered} sources=${data.sources?.length ?? 0}`);
}
await writeFile(new URL("../test-results.md", import.meta.url), out.join("\n---\n\n"));
console.log("wrote test-results.md");
