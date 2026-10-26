import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobots, extract, chunk } from "../scripts/ingest.mjs";
import { search, KB } from "../lib/retrieve";
import { unverifiedNumbers, parseJson } from "../lib/answer";
import { renderMarkdown } from "../lib/markdown";

test("robots.txt: Allow/Disallow precedence, wildcards, Crawl-delay", () => {
  const r = parseRobots("User-agent: *\nUser-agent: GPTBot\nAllow: /\nDisallow: /admin/\nDisallow: /editor_images/*.mp3\nDisallow: /*.pdf$\nDisallow: /package\nAllow: /package/7901\nCrawl-delay: 10");
  assert.equal(r.allows("/profile/5/x"), true);
  assert.equal(r.allows("/admin/login"), false);
  assert.equal(r.allows("/editor_images/a/b.mp3"), false);
  assert.equal(r.allows("/editor_images/a.png"), true);
  assert.equal(r.allows("/doc.pdf"), false);
  assert.equal(r.allows("/doc.pdf?x=1"), true);
  assert.equal(r.allows("/package/7901/x"), true);
  assert.equal(r.allows("/package/7902/x"), false);
  assert.equal(r.delayMs, 10000);
  assert.equal(parseRobots("User-agent: OtherBot\nDisallow: /").allows("/package/1"), true);
});

test("extract: keeps main content and tables, drops site chrome", () => {
  const html = `<nav>Menu</nav><div class="pack-title-price-header"><h1>Pkg</h1><div class="price-social-block-ctm">$18,995 Price starting from</div></div>
    <main class="article-dt-desc"><h2>Cost</h2><table><tr><th>Program</th><th>Total</th></tr><tr><td>Out-Patient</td><td>$18,995</td></tr></table>
    <script>evil()</script><section class="related-videos-sec">Other clinic</section><button>Chat with Center</button></main>`;
  const { title, text } = extract(html);
  assert.equal(title, "Pkg");
  assert.match(text, /\$18,995 Price starting from/);
  assert.match(text, /Out-Patient \| \$18,995/);
  assert.doesNotMatch(text, /Menu|evil|Other clinic|Chat with Center/);
});

test("chunk: splits by heading and caps chunk size", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i} ${"x".repeat(60)}`).join("\n");
  const chunks = chunk({ id: "p", url: "u", title: "T", type: "t", text: `## A\n${long}\n## B\n${"y".repeat(300)}` });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c: { text: string }) => c.text.length <= 1600));
  assert.equal(chunks.at(-1)!.heading, "B");
});

test("knowledge base: all 7 pages ingested", () => {
  assert.equal(KB.pages.length, 7);
  assert.equal(new Set(KB.chunks.map((c) => c.url)).size, 7);
});

test("retrieval: finds the right treatment page", () => {
  assert.match(search("adrenal cancer treatment cost")[0].url, /7902/);
  assert.match(search("anal cancer package included")[0].url, /7901/);
  assert.match(search("adenocarcinoma cost")[0].url, /7903/);
  assert.match(search("alternative medicine price Turkey Thailand")[0].url, /search-medical-pricings/);
  assert.deepEqual(search("zzzz qqqq"), []);
});

test("price guard: flags numbers not in the evidence", () => {
  const ev = "Out-Patient Program | 3 Weeks | $18,995\nIn-Patient $30,000";
  assert.deepEqual(unverifiedNumbers("Starts from $18,995 USD [1]", ev), []);
  assert.deepEqual(unverifiedNumbers("It costs $12,500", ev), ["12500"]);
  assert.deepEqual(unverifiedNumbers("السعر ١٨٬٩٩٥ دولار", ev.replace(",", "٬")), []);
  assert.deepEqual(unverifiedNumbers("No, it is not $50; it starts at $18995", ev + " I heard $50"), []);
  // digit boundaries: 500 must not match inside 1,500 / 30,000
  assert.deepEqual(unverifiedNumbers("Only $500", "Ozone Therapy | $1,500"), ["500"]);
  assert.deepEqual(unverifiedNumbers("$3,000", "In-Patient $30,000"), ["3000"]);
  // short currency figures are checked too
  assert.deepEqual(unverifiedNumbers("A session is $75", ev), ["75"]);
  assert.deepEqual(unverifiedNumbers("from $64 in Bangkok", "Bangkok, Thailand | $64"), []);
  // newline between chunks must not glue numbers together
  assert.deepEqual(unverifiedNumbers("$2500", "costs 2\n500 items"), ["2500"]);
});

test("parseJson: tolerates code fences", () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseJson("no json"), null);
});

test("markdown: escapes HTML and links citations", () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> **Price** $18,995 [1]\n- a\n- b', [{ n: 1, title: "T", url: "https://x.com/p" }]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /<strong>Price<\/strong>/);
  assert.match(html, /href="https:\/\/x.com\/p"/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.doesNotMatch(renderMarkdown('[x](javascript:alert(1))'), /href="javascript/);
});
