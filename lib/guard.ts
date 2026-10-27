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

// Output check: the answer must not contain pieces of our system prompt or any
// configured secret, whatever the model was talked into.
const PROMPT_MARKERS = [
  "use only facts stated in SOURCES", "VOICE MODE", "SYSTEM CHECK", "\nSOURCES\n", "wants_quote",
  "You are PlacidWay's website assistant", "GROUNDING RULES",
];
const SECRET_ENV = [
  "OPENROUTER_API_KEY", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "CRON_SECRET", "VOICE_TOOL_TOKEN",
  "SHEETS_WEBHOOK_URL", "KV_REST_API_TOKEN", "KV_REST_API_URL", "VERCEL_DEPLOY_HOOK_URL",
];

export function leaksPrompt(text: string, env: Record<string, string | undefined> = process.env): boolean {
  if (PROMPT_MARKERS.some((m) => text.includes(m))) return true;
  return SECRET_ENV.some((k) => (env[k]?.length ?? 0) >= 12 && text.includes(env[k]!));
}
