// Deterministic guardrails around the LLM (the prompt rules are the soft layer,
// these are the hard one). Input: refuse obvious prompt-injection / prompt-leak
// attempts without calling the model. Output: strip any URL that is not one of
// the cited page URLs or PlacidWay's quote/contact pages.
const INJECTION = [
  /ignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)/i,
  /disregard\s+.{0,30}(rules|instructions|prompt)/i,
  /(reveal|show|print|repeat|leak|tell me)\s+.{0,30}(system prompt|your instructions|your rules|hidden prompt)/i,
  /\byou are now\b/i,
  /\b(jailbreak|DAN mode|developer mode)\b/i,
  /pretend\s+(you\s+)?(have\s+no|there\s+are\s+no)\s+(rules|restrictions)/i,
];

export const looksLikeInjection = (text: string) => INJECTION.some((r) => r.test(text));

export const INJECTION_REPLY =
  "I can only help with questions about the PlacidWay pages: treatments, packages and prices at ITC Immunity Therapy Center, and alternative-medicine costs abroad. What would you like to know?";

export function scrubUrls(text: string, allowed: Set<string>): string {
  const ok = (u: string) => allowed.has(u.replace(/[.,;:!?]+$/, ""));
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => (ok(url) ? m : label))
    .replace(/https?:\/\/[^\s)\]>"']+/g, (u) => (ok(u) ? u : ""));
}
