// Fetches the 7 allowed PlacidWay pages, extracts the main content and writes
// heading-based chunks to data/kb.json. Run: npm run ingest
// --fallback: on any failure keep the existing kb.json (used by `prebuild`
// so a PlacidWay outage never breaks a deploy).
import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SOURCES = [
  ["Clinic profile", "https://www.placidway.com/profile/5/Alternative-Cancer-Treatment-by-ITC-Immunity-Therapy-Center"],
  ["Treatment package", "https://www.placidway.com/package/7903/Alternative-Adenocarcinoma-Cancer-Treatment-Package-in-Tijuana-Mexico-by-ITC"],
  ["Treatment package", "https://www.placidway.com/package/7902/Alternative-Adrenal-Cancer-Treatment-Package-in-Tijuana-Mexico-by-ITC"],
  ["Treatment package", "https://www.placidway.com/package/7901/Alternative-Anal-Cancer-Treatment-Package-in-Tijuana-Mexico-by-ITC"],
  ["Clinic videos", "https://www.placidway.com/profile-videos/5/Alternative-Cancer-Treatment-by-ITC-Immunity-Therapy-Center"],
  ["Price list", "https://www.placidway.com/price-list/5/Alternative-Cancer-Treatment-by-ITC-Immunity-Therapy-Center"],
  ["Price comparison", "https://www.placidway.com/search-medical-pricings/Alternative-Medicine/All/1"],
];

const UA = "PlacidWayKBBot/1.0 (+assessment chatbot; honours robots.txt Crawl-delay)";
const MIN_DELAY_MS = 1100; // the brief asks for ~1 req/s; robots.txt Crawl-delay wins if longer
const MAX_CHUNK = 1500;
const OUT = new URL("../data/kb.json", import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// robots.txt rules of the groups that apply to "*": Allow/Disallow with
// "*" and "$" wildcards (longest match wins, Allow wins ties) and Crawl-delay.
export function parseRobots(robotsTxt) {
  const rules = [];
  let delay = 0, applies = false, inAgents = false;
  for (const raw of robotsTxt.split("\n")) {
    const m = raw.replace(/#.*/, "").trim().match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!inAgents) applies = false;
      inAgents = true;
      if (val === "*") applies = true;
      continue;
    }
    inAgents = false;
    if (!applies) continue;
    if ((key === "allow" || key === "disallow") && val) {
      // escape regex chars, "*" -> ".*", a trailing "$" stays an end anchor
      const re = new RegExp("^" + val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      rules.push({ allow: key === "allow", len: val.length, re });
    } else if (key === "crawl-delay") delay = Math.max(delay, Number(val) || 0);
  }
  return {
    delayMs: delay * 1000,
    allows(path) {
      const hit = rules.filter((r) => r.re.test(path)).sort((a, b) => b.len - a.len || +b.allow - +a.allow)[0];
      return !hit || hit.allow;
    },
  };
}

// Turns a page's <main> into plain text with "## " heading markers.
export function extract(html) {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim() || $("title").text().trim();
  // page header (price "starting from", review dates) + article + sidebar
  // (price range, location, doctors). Everything else is site chrome.
  const main = $(".pack-title-price-header, main.article-dt-desc, .pack-about-aside");
  main.find([
    "script", "style", "noscript", "svg", "form", "iframe", "button", "img",
    // carousels of *other* clinics/videos and UI chrome; on the videos page
    // the clinic's own list is section.related-videos and is kept
    "section.related-videos-sec:not(.related-videos)", "section.related-packages-sec",
    ".social-popup-main", ".request-vido-popup-main", ".table-of-contents",
    ".popup-content", ".search-filter-main-block",
  ].join(",")).remove();

  $(".pack-about-aside").prepend("<h2>Clinic summary</h2>");
  main.find("table").each((_, t) => {
    const rows = $(t).find("tr").map((_, tr) =>
      $(tr).find("th,td").map((_, c) => $(c).text().replace(/\s+/g, " ").trim() || "(blank)").get()
        .join(" | ")).get().filter((r) => r.replace(/\(blank\)|\|/g, "").trim());
    $(t).replaceWith(`<p>${rows.map((r) => r.replace(/</g, "&lt;")).join("<br>")}</p>`);
  });
  main.find("h1,h2,h3,h4").each((_, h) => { $(h).prepend("\n## ").append("\n"); });
  main.find("li").each((_, li) => { $(li).prepend("\n- "); });
  main.find("br").replaceWith("\n");
  main.find("p,div,section,tr,dd,dt").each((_, el) => { $(el).append("\n"); });

  const lines = [];
  const seenHeadings = new Set();
  for (const raw of main.text().split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || line === "-" || line === "##") continue;
    // headings repeated on every card (e.g. the clinic name under each video)
    // are labels, not section boundaries
    if (line.startsWith("## ")) {
      if (seenHeadings.has(line)) continue;
      seenHeadings.add(line);
    }
    if (line === lines.at(-1)) continue; // duplicate cells such as "Breast Cancer / Breast Cancer"
    if (/^(Chat with Center|Copy link|Share this listing|Read More|Read Less|View More|Watch Video)$/i.test(line)) continue;
    lines.push(line);
  }
  return { title, text: lines.join("\n") };
}

// Splits on headings; long sections are split on line boundaries and
// keep their heading so each chunk is self-describing.
export function chunk(page) {
  const sections = [];
  let cur = { heading: page.title, lines: [] };
  for (const line of page.text.split("\n")) {
    if (line.startsWith("## ")) {
      if (cur.lines.length) sections.push(cur);
      cur = { heading: line.slice(3).trim(), lines: [] };
    } else cur.lines.push(line);
  }
  if (cur.lines.length) sections.push(cur);

  const chunks = [];
  let buf = null; // merges tiny sections into the next one
  for (const s of sections) {
    let body = s.lines.join("\n");
    let heading = s.heading;
    if (buf) { body = `${buf.heading}\n${buf.body}\n\n${heading}\n${body}`; buf = null; }
    if (body.length < 200) { buf = { heading, body }; continue; }
    let part = [];
    let len = 0;
    // very long lines (comma-joined lists) are broken at sentence/comma ends
    const pieces = body.split("\n").flatMap((l) => l.length > MAX_CHUNK ? l.match(/.{1,1200}(?:[.,;]\s|$)/gs) : [l]);
    for (const line of pieces) {
      if (len + line.length > MAX_CHUNK && part.length) { chunks.push({ heading, text: part.join("\n") }); part = []; len = 0; }
      part.push(line); len += line.length + 1;
    }
    if (part.length) chunks.push({ heading, text: part.join("\n") });
  }
  if (buf) chunks.push({ heading: buf.heading, text: buf.body });
  return chunks.map((c, i) => ({ id: `${page.id}#${i}`, url: page.url, title: page.title, type: page.type, ...c }));
}

async function main() {
  const fallback = process.argv.includes("--fallback");
  try {
    const robots = parseRobots(await get("https://www.placidway.com/robots.txt"));
    const delay = Math.max(MIN_DELAY_MS, robots.delayMs);
    console.log(`crawl delay ${delay / 1000}s`);
    const pages = [];
    for (const [i, [type, url]] of SOURCES.entries()) {
      if (!robots.allows(new URL(url).pathname)) throw new Error(`robots.txt disallows ${url}`);
      await sleep(delay);
      const { title, text } = extract(await get(url));
      if (text.length < 500) throw new Error(`extracted too little text from ${url}`);
      pages.push({ id: `p${i + 1}`, type, url, title, text });
      console.log(`ok  ${type.padEnd(18)} ${text.length.toString().padStart(6)} chars  ${title}`);
    }
    const chunks = pages.flatMap(chunk);
    await mkdir(new URL("../data/", import.meta.url), { recursive: true });
    await writeFile(OUT, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      pages: pages.map(({ text, ...p }) => p),
      chunks,
    }, null, 1));
    console.log(`wrote ${chunks.length} chunks from ${pages.length} pages`);
  } catch (err) {
    if (fallback && existsSync(OUT)) {
      console.warn(`ingest failed (${err.message}); keeping existing data/kb.json`);
      return;
    }
    console.error(err);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
