// Tiny markdown subset for bot answers: paragraphs, "-"/"*"/"1." lists,
// **bold**, [text](url), bare URLs and [n] citation markers. HTML is escaped
// first, so model output can never inject markup.
import type { Source } from "./answer";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string, sources: Source[]): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,])/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\[(\d+)\]/g, (m, n) => {
      const src = sources.find((x) => x.n === +n);
      return src ? `<a class="cite" href="${esc(src.url)}" target="_blank" rel="noreferrer" title="${esc(src.title)}">[${n}]</a>` : "";
    });
}

export function renderMarkdown(md: string, sources: Source[] = []): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((li) => `<li>${li}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) { list.push(inline(item[1], sources)); continue; }
    flush();
    if (line) out.push(`<p>${inline(line.replace(/^#+\s*/, ""), sources)}</p>`);
  }
  flush();
  return out.join("");
}
