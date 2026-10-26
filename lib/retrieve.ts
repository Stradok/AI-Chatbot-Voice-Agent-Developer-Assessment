// BM25 keyword retrieval over the ingested chunks. The query arrives already
// rewritten into standalone English by the LLM (see answer.ts), which is what
// lets keyword search handle Spanish/Arabic questions and follow-ups.
// ponytail: in-memory BM25 is fine for ~150 chunks; switch to embeddings or
// hybrid search when the KB grows past a few thousand chunks.
import kb from "../data/kb.json" with { type: "json" };

export type Chunk = { id: string; url: string; title: string; type: string; heading: string; text: string };
export const KB = kb as { fetchedAt: string; pages: { id: string; url: string; title: string; type: string }[]; chunks: Chunk[] };

const STOP = new Set("a an and are as at be by can do does for from how i in is it me my of on or the this to was what when where which who why will with you your about much".split(" "));

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

const K1 = 1.4, B = 0.75;
// title + heading are indexed with the body: the three package pages share
// most of their text and differ mainly by title (adenocarcinoma/adrenal/anal)
const docs = KB.chunks.map((c) => tokenize(`${c.title} ${c.heading} ${c.heading} ${c.text}`));
const avgLen = docs.reduce((n, d) => n + d.length, 0) / docs.length;
const df = new Map<string, number>();
for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
const tfs = docs.map((d) => {
  const m = new Map<string, number>();
  for (const t of d) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
});

export function search(query: string, k = 8, perPage = 4): (Chunk & { score: number })[] {
  const q = [...new Set(tokenize(query))];
  const N = docs.length;
  const scored = KB.chunks.map((c, i) => {
    let score = 0;
    for (const t of q) {
      const f = tfs[i].get(t);
      if (!f) continue;
      const n = df.get(t)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * docs[i].length) / avgLen));
    }
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // cap chunks per page so one long page cannot crowd out the others
  const out: (Chunk & { score: number })[] = [];
  const count = new Map<string, number>();
  for (const c of scored) {
    if (c.score <= 0 || out.length >= k) break;
    const n = count.get(c.url) ?? 0;
    if (n >= perPage) continue;
    count.set(c.url, n + 1);
    out.push(c);
  }
  return out;
}
