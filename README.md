# PlacidWay Website Knowledge Chatbot

A chatbot that answers visitor questions **only** from 7 PlacidWay pages (ITC Immunity Therapy Center, Tijuana) and cites the page each answer came from. You can type or talk to it in any language.

- **Live:** see the link in the submission email
- **Test results:** [`test-results.md`](test-results.md), the brief's 8 test questions plus multilingual and edge cases, produced by `npm run eval`
- **Write-up:** [`WRITEUP.md`](WRITEUP.md), covering limitations and what I'd do with another week

## Architecture

```
                 ┌──────────── build time (and weekly refresh) ────────────┐
                 │ scripts/ingest.mjs                                      │
 7 PlacidWay ───►│ robots.txt rules + Crawl-delay (10 s) · named User-Agent │
 URLs            │ cheerio: header + <main> + sidebar, tables → "a | b"    │──► data/kb.json
                 │ heading-based chunks (≤1.5k chars, heading kept)        │    (148 chunks)
                 └─────────────────────────────────────────────────────────┘

 Browser (Next.js page) ──text──► POST /api/chat ──► lib/answer.ts
        ▲                                             1. rewrite: LLM → standalone English query + language
        │ answer + sources                            2. retrieve: BM25 top-8 (max 4 per page)  lib/retrieve.ts
        │                                             3. answer: LLM with strict rules, JSON out
        │                                             4. verify: JSON valid, ≥1 citation if answered, and every 3+ digit or currency number must exist in the
        │                                                sources / conversation → else retry → else "I don't know"
        │                                             5. unanswered → gap log; quote intent → lead form
        │
        └──voice (WebRTC)──► LiveKit Cloud ──► agent/agent.py
                               Deepgram nova-3 (multi) STT → POST /api/chat (mode=voice) → Cartesia sonic-3 TTS
                               the full answer and its sources are sent to the page over a LiveKit text stream
```

| Part | File | What it does |
|---|---|---|
| Ingestion | `scripts/ingest.mjs` | Fetches only the 7 URLs. Honours robots.txt: Allow/Disallow with wildcards, longest match wins, and `Crawl-delay`. PlacidWay sets 10 s, which is slower than the brief's ~1 req/s, so the whole crawl takes about 70 s. Sends a named User-Agent. Keeps the page header (holds the "Price starting from" figure), the article, and the sidebar (price range, address, doctors). Removes nav, footer, other clinics' carousels and forms. Tables become pipe rows so prices stay next to their labels. |
| Chunking | same | One chunk per heading section. Tiny sections are merged into the next one, long ones are split at 1.5k characters and keep their heading. A heading that repeats on every card (e.g. the clinic name under each video) is treated as a label, not a section. |
| Retrieval | `lib/retrieve.ts` | In-memory BM25 over title + heading + text. Indexing the title matters because the three package pages are nearly identical apart from the cancer type. Each page is capped at 4 of the top 8 chunks, so a long page cannot crowd out the others. |
| Grounding | `lib/answer.ts` | Rewrite → retrieve → answer → verify (see diagram). The model returns JSON (`answer`, `cited`, `answered`, `wants_quote`). Source links are built by the server from the cited chunk numbers, so the model can't invent a URL. |
| Price guard | `unverifiedNumbers()` | A deterministic check that runs after the LLM. Any number of 3 or more digits in the answer (after normalising Arabic-Indic digits and thousands separators) must appear in the retrieved text or in the user's messages. If one doesn't, the model gets one retry with the bad figures named. If the retry fails too, the bot sends a safe "I can't verify that" answer. |
| UI | `app/page.tsx` | Chat with suggestion chips, cited `[n]` links, a sources list, and an inline lead form when the user asks for a quote or booking. Includes a voice button. Markdown rendering escapes HTML first (`lib/markdown.ts`). |
| Voice | `agent/agent.py` | LiveKit Agents worker. Its `llm_node` is replaced by an HTTP call to `/api/chat`, so voice answers use exactly the same retrieval, rules and guard as text. TTS switches to the language the API detected for each reply. |
| Refresh | `/api/refresh` + `vercel.json` | `prebuild` re-runs ingestion, so a refresh is just a redeploy. Vercel Cron calls `/api/refresh` weekly, and that triggers a Deploy Hook. If PlacidWay is down during a build, the committed `kb.json` is kept (`--fallback`), so a deploy never ships an empty KB. |
| Guardrails | `lib/guard.ts`, `lib/answer.ts` | Hard layer around the prompt rules: obvious prompt-injection / prompt-leak requests are refused without calling the model; URLs in answers are stripped unless they are a cited page or PlacidWay's quote/contact page; replies must be valid JSON with a citation. |
| Data handling | `lib/store.ts`, `/api/export`, `docs/google-sheets-script.gs` | Every turn (text and voice) is logged as a `chats` row, unanswered ones also as `gaps`, quote requests as `leads`. Free sinks: a **Google Sheet** (paste the Apps Script, set `SHEETS_WEBHOOK_URL`) and/or **Upstash Redis**. `GET /api/export?list=chats\|gaps\|leads` (bearer `CRON_SECRET`) downloads a CSV that opens in Excel; cells are neutralised against formula injection. Logs never contain chat text or lead details. |
| Abuse limits | `rateLimited()` in `lib/store.ts` | Per-IP fixed-window limits on `/api/chat` (40 per 10 min), `/api/token` (10) and `/api/lead` (5), plus a 12k-character cap on a conversation. Uses the same Redis and fails open without it. |
| Logging | `lib/store.ts`, `/api/gaps` | Unanswered questions go to the server log and to Upstash Redis. Leads (name, email) go to Redis only; the log gets a masked email, so PII stays out of logs. Without Redis, leads are not stored. `GET /api/gaps` (bearer `CRON_SECRET`) lists both. |

### Tools and models, and why

- **Next.js on Vercel**: one deploy holds the UI and the API. The API key stays server-side.
- **OpenRouter, free models by default** (`google/gemma-4-31b-it:free`, then `nvidia/nemotron-3.5-super-vl:free` as fallback; `OPENROUTER_MODEL` takes a comma-separated list): costs nothing and one model falling over (free tiers rate-limit) does not take the bot down. Free models follow the grounding rules less reliably than paid ones, which is why the code-level guards below exist. For the final run set a paid model such as `anthropic/claude-haiku-5.5`.
- **BM25, not embeddings**: the KB has 148 chunks, and keyword search is exact on the things that matter here (cancer type, "in-patient", country names). The LLM query rewrite translates and de-references every question first, so Spanish/Arabic questions and follow-ups like "what about recovery?" still find the right chunks. No vector DB and no second API.
- **LiveKit Agents + LiveKit Inference** for voice: Deepgram nova-3 `multi` transcribes mixed languages including Arabic, and Cartesia sonic-3 speaks 40+ languages. Inference runs on the LiveKit project keys, so no extra provider accounts are needed.
- **Rejected alternatives:** putting the whole KB into every prompt (simpler, but no retrieval to show or tune, and cost grows with content). A vector DB (overkill at this size). A separate LLM prompt inside the voice agent (two copies of the grounding rules would drift apart).

## Setup

Requirements: Node 20+, and for voice: Python 3.10–3.14, [uv](https://docs.astral.sh/uv/) and the [LiveKit CLI](https://docs.livekit.io/home/cli/).

```bash
npm install
cp .env.example .env.local      # fill in OPENROUTER_API_KEY (and LiveKit keys for voice)
npm run ingest                  # re-fetch the 7 pages → data/kb.json (a copy is committed)
npm run dev                     # http://localhost:3000
npm test                        # unit tests: robots, extraction, chunking, retrieval, price guard, XSS
npm run eval                    # runs the test questions → test-results.md
```

### Deploy the web app (Vercel)

1. Import the repo in Vercel (framework: Next.js; defaults are fine).
2. Add env vars: `OPENROUTER_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `CRON_SECRET`.
3. Optional: create a Deploy Hook (Settings → Git) and set `VERCEL_DEPLOY_HOOK_URL` to turn on weekly/manual refresh. Add the Upstash Redis integration to keep gap and lead logs.

### Deploy the voice agent (LiveKit Cloud)

```bash
cd agent
lk cloud auth                     # link your LiveKit Cloud project
lk agent create --secrets CHAT_API_URL=https://<your-app>.vercel.app/api/chat
# the agent's dispatch name must be "placidway-voice": it is set in agent.py and requested by /api/token.
# Check with `lk agent list`: if the Dispatch Name column shows something else, the voice button connects but nobody answers.
# later changes: lk agent deploy
```

Run it locally instead: `CHAT_API_URL=http://localhost:3000/api/chat LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... uv run agent.py dev`.

### Refresh content

- Locally: `npm run ingest`, then commit `data/kb.json` (or just redeploy).
- In production: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/refresh`. Vercel Cron also does this every Monday.

## Behaviour rules (from `lib/answer.ts`)

Answers use only the sources. Prices are quoted exactly, with currency and context ("starting from", in-/out-patient, duration, inclusions, extras). The bot compares only when both sides are in the content, corrects wrong premises, gives no medical advice (recommends a doctor), declines off-topic questions, never books (sends users to the quote/contact form and offers the lead form), replies in the user's language, and shows a short disclaimer once per conversation only when the answer is medical.
