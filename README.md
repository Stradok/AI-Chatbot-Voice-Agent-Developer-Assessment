# PlacidWay Website Knowledge Chatbot

A chatbot that answers visitor questions **only** from 7 PlacidWay pages (ITC Immunity Therapy Center, Tijuana) and shows the page each answer came from. It never invents prices: if the pages don't say, it says so and points to PlacidWay's free quote form. You can type or talk to it, in any language.

- **Live app:** https://chat-bot-placidway.vercel.app
- **Code:** https://github.com/Stradok/AI-Chatbot-Voice-Agent-Developer-Assessment
- **Test results:** [`test-results.md`](test-results.md): the 8 brief questions plus extras, run against the live app (`npm run eval`)
- **Write-up:** `WRITEUP.md` (limitations and what I'd do with another week)
- **Stack:** Next.js on Vercel · OpenRouter (LLM) · BM25 retrieval · LiveKit (voice) · Google Sheets / Upstash Redis (data, both free tiers)

Contents: [What it does](#what-it-does) · [The story and data flow](#the-story-end-to-end-use-this-to-narrate-the-demo) · [How it was built](#how-it-was-built-and-why) · [Where to find everything](#where-to-find-everything) · [Architecture](#architecture) · [Components](#components) · [API endpoints](#api-endpoints) · [Configuration](#configuration) · [Setup and deploy](#setup) · [Voice](#voice) · [Demo video guide](#demo-video-guide) · [Review call prep](#review-call-prep) · [Troubleshooting](#troubleshooting) · [Design choices](#design-choices-and-rejected-alternatives) · [Limitations](#known-limitations)

## What it does

| Requirement | How it is met |
|---|---|
| Content ingestion | `scripts/ingest.mjs` fetches only the 7 given URLs at build time, honouring robots.txt and its `Crawl-delay` |
| Knowledge base | 148 heading-based chunks in `data/kb.json`, searched with BM25 |
| Grounded answers + sources | The LLM sees only the retrieved chunks; source links are built by the server from the chunks it cited |
| Honest "I don't know" | Prompt rules + code checks; unanswered questions suggest the free quote and are logged as content gaps |
| Cost questions | Prices are quoted exactly with currency and context (starting from, in-/out-patient, duration, inclusions, extras) |
| Chat UI | `app/page.tsx`: suggestions, typing indicator, source chips, lead form, voice button |
| Refresh | Every build re-ingests the pages; a weekly Vercel Cron redeploys (`/api/refresh`) |
| Live deployment | Vercel (Hobby plan) |
| Nice to have | Multilingual answers, follow-ups from chat history, one-time medical disclaimer, lead capture, gap logging, voice agent with a live waveform, CSV/Google Sheet export |
| First-time visitors | A dim hint points at the text box and the Voice button (shown once per browser); a **How to use** popup and a **Contact me** popup (name, email, phone, WhatsApp, GitHub) sit in the header |

## How it was built, and why

In the order the work happened. Each step lists the decision and the reason.

1. **Read the brief and the 7 pages.** Checked robots.txt first. PlacidWay sets `Crawl-delay: 10`, so ingestion waits 10 s between pages (about 70 s total) instead of the brief's ~1 req/s. Fetching the pages showed the price lives in the page header and sidebar, outside `<main>`, so extraction keeps those three regions and drops the rest.
2. **Ingestion and chunking** (`scripts/ingest.mjs`). Heading-based chunks keep a price table next to its explanation. Tables become `label | value` rows so a price never loses its label. The three package pages are almost identical, so the page title is indexed with each chunk.
3. **Retrieval: BM25, not embeddings** (`lib/retrieve.ts`). With 148 chunks, keyword search is exact on what matters here (cancer type, in-patient, country names), and it adds no vector DB or second API. A cap of 4 chunks per page keeps one long page from crowding out the others.
4. **Grounded answering** (`lib/answer.ts`). Three steps: an LLM rewrites the question into standalone English (this handles follow-ups like "what about recovery?" and non-English questions), BM25 retrieves, then the LLM answers as JSON from those chunks only. Source links are built by the server from the cited chunk numbers, so the model can't invent a URL.
5. **Code checks on top of the prompt.** Free models follow rules less reliably, so the important rules run in code: every price must appear in the sources, every answer needs a citation, links are scrubbed, and prompts and secrets can't leak (see [Guardrails](#components)).
6. **Chat UI and lead capture.** A simple chat with source chips; when a user asks for a quote, an inline name + email form appears.
7. **Deploy to Vercel** and set up the free data layer: Google Sheet (Apps Script) and Upstash Redis. Every turn is logged; unanswered questions become "content gaps" for PlacidWay to fix.
8. **Review and hardening.** An independent code review found real issues (ignored Crawl-delay, a price check that accepted "500" inside "1,500", unvalidated model output, no rate limits, PII in logs). All were fixed and covered by unit tests. A second round added attack detection in any language, a leak check, a stricter personal-medical rule, and a fix for forged chat history.
9. **Voice.** A LiveKit Agent Builder agent (`maya`) calls the same pipeline through an HTTP tool, so voice answers are as grounded as text. A second tool saves leads, and an end-of-call endpoint stores a call summary. A coded agent (`agent/agent.py`) is kept as an alternative.
10. **Live testing.** `npm run eval` runs the test questions against the deployed app. This found and fixed: a crash from a one-off provider error (now retried), a like-for-like comparison problem (a massage price compared with an ozone-therapy price), a wrong-page attribution on a follow-up, and a stray `<markdown>` tag.

## The story, end to end (use this to narrate the demo)

A visitor lands on a medical-tourism site with money and health worries on their mind. They need an answer that is **true to the page**, not a guess. So the bot is built around one promise: *it can only say what the 7 PlacidWay pages say, and it shows which page.*

1. **Before anyone arrives (build time).** A script reads the 7 pages, politely (robots.txt, 10-second crawl delay), and cuts them into 148 small searchable pieces saved in `data/kb.json`. Every deploy repeats this, and a weekly job redeploys on Monday, so the knowledge stays fresh.
2. **A visitor types or speaks.** On the website they type (or press **Voice**). First-time visitors see a dim hint pointing at the text box and the Voice button; **How to use** and **Contact me** sit in the header.
3. **The question is cleaned up.** A language model rewrites it as one clear English search (so Spanish, Arabic or "and what about recovery?" all work) and flags attacks and personal medical questions.
4. **The best pieces are found.** Plain keyword search (BM25) picks up to 8 pieces from the pages. No second AI is needed for that.
5. **The answer is written only from those pieces**, with citations. The server, not the model, builds the source links.
6. **Code double-checks the answer** before it is shown: every price must exist on the pages, there must be a source, no links or secrets leak, no "yes this is safe for you" medical verdicts. A failed check retries once, then a safe fallback is shown.
7. **Everything is saved** so the team learns from real visitors: every question, the questions the pages could not answer (content gaps), quote requests, and voice-call summaries.

### Data flow: what comes in, what goes out, where it is stored

| Path | In | Goes through | Out (saved to) |
|---|---|---|---|
| **Web chat** | Visitor types | `POST /api/chat` → `respond(history, "text")` | Answer + source chips on screen; `chats` row (mode `text`), plus a `gaps` row if unanswered |
| **Web lead form** | Name + email (appears when the user asks for a quote) | `POST /api/lead` (validated, rate-limited) | `leads` row |
| **Voice (website button)** | Visitor's microphone | `POST /api/token` mints a 15-minute LiveKit token and dispatches the agent `maya` (`AGENT_NAME`) → LiveKit room | Live waveform in the page; Maya's voice plays back |
| **Voice answers** | Caller's question | Maya calls the HTTP tool `ask_placidway` → `POST /api/ask` (Bearer `VOICE_TOOL_TOKEN`) → the **same** `respond()` pipeline in "phone" mode | Short spoken answer; `chats` row (mode `phone`), `gaps` if unanswered |
| **Voice lead** | Name + confirmed email spoken to Maya | Tool `save_lead` → `POST /api/lead` | `leads` row |
| **End of call** | LiveKit's automatic summary | `POST /api/call-end` | `calls` row (job id, room, start/end, summary) |
| **Admin / review** | You | `GET /api/export?list=…` (Bearer `CRON_SECRET`) | CSV that opens in Excel (reads Redis) |

**Where rows are stored.** `lib/store.ts → record()` writes each row to two free places at once:
- **Upstash Redis:** keeps the latest 5,000 per list. This is what `/api/export` and `/api/gaps` read.
- **Google Sheet** (Apps Script web app): one tab per list, `chats`, `gaps`, `leads`, `calls`. The tabs are created on first use at the **bottom** of the Sheet, so look past `Sheet1`.

If one sink fails the other still saves, and the failure is logged. Server logs never contain chat text or full lead details.

### Which LLM does what, where and when

| Where it runs | What it does | Which model | When it is called |
|---|---|---|---|
| **OpenRouter, from `lib/answer.ts`** (call 1, rewrite) | Standalone English search query, language, attack and personal-medical flags | `OPENROUTER_MODEL`. Production is set in Vercel to `openai/gpt-4o-mini`; the code default is two free models (`google/gemma-4-31b-it:free`, then `nvidia/nemotron-3.5-super-vl:free`) | Once per question, unless the injection pattern check refuses it first |
| **OpenRouter, from `lib/answer.ts`** (call 2, answer) | Writes the grounded answer as JSON from the retrieved pieces only | Same list; each model is tried twice, then the next | Once per question, plus one retry if a code check fails |
| **LiveKit Cloud, agent `maya`** | Hears the caller (speech-to-text), decides when to call a tool, and speaks (text-to-speech) | Chosen in LiveKit → Agents → maya → Builder → Models & Voice (check there for the exact names; they are not set by this repo) | During a voice call. Maya never answers facts from her own knowledge; she calls `ask_placidway` |
| **LiveKit Cloud, call ending summary** | Writes the 3-sentence call summary | A small, cheap model set in Call ending → Summary | Once, when the call ends |

Keyword retrieval, the price check, the guardrails and the URL scrub are **plain code, not an LLM**, on purpose: they must not be talked out of their rules.

### What happened along the way (honest log, good for questions in the review)

- **Voice did not connect:** the website dispatched an agent called `placidway-voice`, but the agent deployed in LiveKit is `maya`. Fix: `AGENT_NAME=maya` in Vercel.
- **Tool calls returned 401:** the `Authorization` header must read `Bearer {{secrets.VOICE_TOOL_TOKEN}}`; the word `Bearer` was missing.
- **The Google Sheet "wasn't updating":** the code was fine. The rows were landing in the `chats` tab at the bottom, not in `Sheet1`. On the way we also learned that Apps Script answers a POST with a redirect (`curl -X POST` breaks on it, `fetch` does not), and that a web-app deployment must be public (Anyone) and its URL copied with the Copy button. `lib/store.ts` now logs any non-`ok` reply from the Sheet so this can't fail silently again.
- **Voice leads were missing:** `save_lead` was correctly configured, but the LiveKit agent had not been **redeployed** after the edit. Builder changes apply only to calls made after **Deploy agent**.
- **Free models are less reliable:** one question failed with a provider error, so each model is now tried twice, and the price guard is in code, not just in the prompt.

## Where to find everything

| What | Where | How to get there |
|---|---|---|
| Live chat | https://chat-bot-placidway.vercel.app | Open it; the 🎙 Voice button is next to Send |
| Code | GitHub repo above | `lib/` is the logic, `app/` the UI and API, `scripts/` ingestion and eval, `tests/` unit tests, `docs/` voice and Sheet setup |
| Env vars, deploys, logs | Vercel → project `chat-bot-placidway` | **Settings → Environment Variables**; **Deployments** (Redeploy); **Logs**; **Settings → Git → Deploy Hooks** |
| Redis data | Upstash, opened from Vercel | Vercel → **Storage** → the Upstash database → open in Upstash → **Data Browser**. Keys: `chats`, `gaps`, `leads`, `calls` |
| Google Sheet | The "PlacidWay Bot Data" sheet | Tabs `chats`, `gaps`, `leads`, `calls` fill as people use the bot |
| Voice agent `maya` | LiveKit Cloud → project **Testing** → **Agents → maya** | **Builder → Conversation** (Instructions, Welcome message, Call ending); **Builder → Actions** (where the tools are configured; look for the HTTP tools section); **Builder → Models & Voice**; **Secrets** (`VOICE_TOOL_TOKEN`); **Deploy agent** button top right; **Live preview → Start call** with the Events / Logs tabs underneath |
| Admin data | `GET /api/export?list=chats\|gaps\|leads\|calls` | CSV for Excel; needs `Authorization: Bearer <CRON_SECRET>` |

## Architecture

```
          build time (and weekly refresh via Vercel Cron → /api/refresh → Deploy Hook)
 7 PlacidWay ──► scripts/ingest.mjs ──► data/kb.json (148 chunks)
 URLs            robots.txt + Crawl-delay · named User-Agent · cheerio · heading chunks

 Browser ── text ─► POST /api/chat ─┐
 Browser ── mic ──► LiveKit Cloud ──┤                      ┌─ lib/guard.ts   injection check on the question
 maya (Agent Builder) ─ HTTP tool ──┴► POST /api/ask ──────┤
 coded agent (agent/agent.py) ─────────► POST /api/chat    └─ lib/answer.ts
                                                              1. rewrite  LLM: standalone English query + language
                                                                          + flags: attack, personal-medical
                                                              2. retrieve BM25 top 8, max 4 per page   lib/retrieve.ts
                                                              3. answer   LLM, strict rules, JSON out
                                                              4. verify   valid JSON · ≥1 citation · every price in the sources
                                                                          · no leak · no medical verdict (else retry, else safe fallback)
                                                              5. scrub    drop URLs that are not cited pages / quote / contact
        every turn ─► lib/store.ts ─► Google Sheet (Apps Script) and/or Upstash Redis ─► GET /api/export (CSV)
```

## Components

| Part | File | What it does |
|---|---|---|
| Ingestion | `scripts/ingest.mjs` | Fetches only the 7 URLs. Honours robots.txt (Allow/Disallow with wildcards, longest match wins) and `Crawl-delay`. Named User-Agent. Keeps the page header (holds "Price starting from"), the article and the sidebar (price range, address, doctors); drops nav, footer, other clinics' carousels, forms. Tables become `a \| b` rows so prices stay next to their labels. |
| Chunking | same | One chunk per heading section. Tiny sections merge into the next, long ones split at 1.5k characters and keep their heading. A heading repeated on every card (e.g. the clinic name under each video) counts as a label, not a section. |
| Retrieval | `lib/retrieve.ts` | In-memory BM25 over title + heading + text. Each page is capped at 4 of the top 8 chunks so a long page cannot crowd out the rest. |
| Answering | `lib/answer.ts` | Rewrite → retrieve → answer → verify (diagram above). The model returns JSON (`answer`, `cited`, `answered`, `wants_quote`). Each model in `OPENROUTER_MODEL` is tried twice, in order, so one provider hiccup does not fail a question. |
| Price guard | `unverifiedNumbers()` | Deterministic, runs after the LLM. Every number of 3+ digits, and any number next to a currency, must appear in the retrieved text, the user's own words, or a figure from an earlier assistant message that exists somewhere on the pages. Matching is on digit boundaries ("500" is not found inside "1,500"). Arabic-Indic digits are normalised. A failure triggers one retry that names the bad figures; a second failure sends a safe fallback. |
| Guardrails | `lib/guard.ts`, `lib/answer.ts` | Layers, hard ones in code: (1) injection patterns refused before any model call; (2) the rewrite call also flags attacks in any language (override rules, reveal prompt or keys, change role); (3) personal-medical questions are flagged, and answers that give a suitability verdict ("highly recommended", "yes, it is safe") are rejected and retried, with a medical-specific fallback; (4) the output is checked for system-prompt text and configured secrets; (5) URLs are stripped unless they are a cited page or PlacidWay's quote/contact page; (6) numbers that only appear in client-supplied assistant messages do not count as evidence (history can be forged). Prompt rules also forbid naming reviewers or patients. |
| UI | `app/page.tsx`, `lib/markdown.ts` | Chat with source chips and an inline lead form when the user asks for a quote. Markdown is escaped before formatting; only `http(s)` links are allowed. |
| Data | `lib/store.ts` | Every turn is a `chats` row, unanswered ones also `gaps`, quote requests `leads`, finished voice calls `calls`. Sinks: Google Sheet and/or Upstash Redis. Logs never contain chat text or lead details (masked email only). |
| Abuse limits | `rateLimited()` | Per-IP fixed window: `/api/chat` 40, `/api/token` 10, `/api/lead` 5, `/api/ask` 300 per 10 minutes; 12k-character cap per conversation. Needs Redis; fails open without it. |
| Voice | `agent/agent.py` or a LiveKit Agent Builder agent | See [Voice](#voice). |

## API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/chat` | public, rate-limited | Grounded answer for the web chat (`mode` text or voice) |
| `POST /api/lead` | public, rate-limited; the voice token skips the limit | Stores name + email when a user wants a quote (web form and voice `save_lead` tool) |
| `POST /api/token` | public, rate-limited | Issues a 15-minute LiveKit token and dispatches the voice agent named by `AGENT_NAME` |
| `POST /api/ask` | `Bearer VOICE_TOOL_TOKEN` | HTTP tool for the Agent Builder agent: `{question}` → `{answer, sources, answered, wants_quote}` |
| `POST /api/call-end` | `Bearer VOICE_TOOL_TOKEN` | End-of-call report from the Agent Builder (summary, times) |
| `GET /api/export?list=chats\|gaps\|leads\|calls` | `Bearer CRON_SECRET` | CSV download that opens in Excel (formula-injection safe) |
| `GET /api/gaps` | `Bearer CRON_SECRET` | JSON: recent chats, gaps, leads and when the KB was fetched |
| `GET/POST /api/refresh` | `Bearer CRON_SECRET` | Triggers a redeploy, which re-ingests the pages. Vercel Cron calls it weekly |

## Configuration

Copy `.env.example` to `.env.local` locally; set the same names in Vercel for production.

| Variable | Needed for |
|---|---|
| `OPENROUTER_API_KEY` | **Required.** The LLM |
| `OPENROUTER_MODEL` | Comma-separated models tried in order. Default: two free OpenRouter models (`google/gemma-4-31b-it:free`, `nvidia/nemotron-3.5-super-vl:free`). The deployed app sets its own |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Website voice button (token minting) |
| `AGENT_NAME` | Dispatch name of the voice agent (`maya` in production; default `placidway-voice`; must equal the deployed agent's name) |
| `VOICE_TOOL_TOKEN` | Shared secret for `/api/ask`, `/api/call-end` and `/api/lead` from voice. Set the **same value** in Vercel and as a LiveKit agent secret |
| `CRON_SECRET` | `/api/export`, `/api/gaps`, `/api/refresh` (Vercel Cron sends it automatically) |
| `VERCEL_DEPLOY_HOOK_URL` | Weekly/manual refresh |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (set by Vercel's integration): storage, rate limits, CSV export |
| `SHEETS_WEBHOOK_URL` | Google Sheet sink |

## Setup

Requirements: Node 20+. For the coded voice agent also Python 3.10–3.14, [uv](https://docs.astral.sh/uv/) and the [LiveKit CLI](https://docs.livekit.io/home/cli/).

```bash
npm install
cp .env.example .env.local      # at least OPENROUTER_API_KEY
npm run ingest                  # re-fetch the 7 pages → data/kb.json (a copy is committed)
npm run dev                     # http://localhost:3000
npm test                        # unit tests: robots, extraction, chunking, retrieval, price guard, guardrails, auth, XSS
npm run eval                    # asks the test questions → test-results.md  (npm run eval -- https://<app>.vercel.app)
```

### Deploy (Vercel, free Hobby plan)

1. Import the repo (Next.js preset, defaults).
2. Add the variables above, marking secrets Sensitive. Redeploy after any change: variables only apply to new deployments.
3. Storage, both free:
   - **Upstash Redis:** Vercel → Storage → Upstash Redis (free plan) → connect to the project.
   - **Google Sheet:** new sheet → Extensions → Apps Script → paste `docs/google-sheets-script.gs` → Deploy as Web app (Execute as me, access Anyone) → put the URL in `SHEETS_WEBHOOK_URL`. Tabs `chats`, `gaps`, `leads`, `calls` appear on first use.
4. Refresh: Settings → Git → Deploy Hooks → create one → `VERCEL_DEPLOY_HOOK_URL`.
5. Share the stable production URL (`https://chat-bot-placidway.vercel.app`). The long per-deployment URLs sit behind Vercel's login and are not public.

### Refresh the content

- Locally: `npm run ingest`, commit `data/kb.json`, or just redeploy (the build re-ingests; if PlacidWay is unreachable the committed `kb.json` is kept, so a deploy never ships an empty KB).
- Production: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://chat-bot-placidway.vercel.app/api/refresh`. Vercel Cron does it every Monday.

## Voice

The website's voice button joins a LiveKit room and dispatches the agent named `AGENT_NAME`. Two ways to provide that agent:

1. **LiveKit Agent Builder agent `maya` (in use).** In LiveKit Cloud → Agents → maya → Builder:
   - **Conversation:** Instructions = the prompt in [`docs/maya-prompt.md`](docs/maya-prompt.md); Welcome message = "Hi, I'm Maya from PlacidWay. Ask me about treatments and prices at ITC Immunity Therapy Center, in any language."; keep the type on **Open ended**.
   - **Actions / tools section (HTTP tools):** `ask_placidway` → `POST /api/ask` with one `question` parameter; `save_lead` → `POST /api/lead` with `name`, `email` and optional `question`. Both send the header `Authorization: Bearer {{secrets.VOICE_TOOL_TOKEN}}` (the word `Bearer` and the space are required).
   - **Call ending → Configure:** Summary endpoint `https://chat-bot-placidway.vercel.app/api/call-end` with the same header; Summary tab on, with a small, cheap model and low reasoning effort.
   - **Secrets:** `VOICE_TOOL_TOKEN`, identical to the Vercel value.
   - **Deploy agent**, then **Live preview → Start call**.

   Answers come from the same grounded pipeline, price-checked in code, and every question, lead and call is logged. Limit: the Builder cannot stream text to the web page, so voice turns show no source links there; the agent names the page aloud instead.
2. **Coded agent (`agent/agent.py`).** Deepgram nova-3 (multilingual) → `/api/chat` → Cartesia sonic-3, switching TTS language per reply, and sends each answer with its sources to the page so voice turns appear in the chat. Deploy with `cd agent && lk cloud auth && lk agent create --secrets CHAT_API_URL=https://<app>.vercel.app/api/chat`, and set `AGENT_NAME` to the same name.

## Demo video guide

**Why the video matters:** the review call asks you to walk through the code and explain every part. The video is the first look at how well you understand it. The scoring puts the most weight on accuracy and honesty, so spend most of the time showing the bot refusing to make things up, not showing the UI.

| Rubric item | Weight | What the video should show |
|---|---|---|
| Answer accuracy and grounding | 30% | Cost question with the exact price, currency and context; click a source chip to open the real page |
| Unknown and tricky questions | 20% | Not-in-content, out-of-scope, medical advice, wrong-price trick, an injection attempt |
| Ingestion and retrieval | 15% | The `ingest.mjs` flow in 30 s: robots.txt, `Crawl-delay`, chunks in `data/kb.json` |
| Code quality | 15% | Folder layout, `lib/answer.ts` pipeline, `npm test` passing |
| Documentation | 10% | This README, `test-results.md` |
| Nice to have | 10% | Spanish/Arabic, follow-up, lead form, voice, Google Sheet filling up |

**Suggested script (about 7 minutes):**

1. **0:00 Intro (20 s).** What it is: answers only from 7 pages, always cites, never invents prices. Name the stack.
2. **0:20 The 8 test questions (2.5 min).** Use the table below, in one conversation. For each, say the one thing to notice.
3. **2:50 Extras (1 min).** A Spanish question; a dental implant question (not in the content, so it says so and suggests the free quote); an injection attempt; ask for a quote and show the lead form.
4. **3:50 Voice (1 min).** Press Voice, ask "How much is the in-patient adrenal program?", let her answer, say goodbye.
5. **4:50 Data (45 s).** Show the Google Sheet: the `chats` rows (including mode `phone`), `gaps`, `leads`, `calls`. Mention the CSV export.
6. **5:35 Code walk (1.5 min).** `scripts/ingest.mjs` (robots, crawl delay), `lib/answer.ts` (rewrite → retrieve → answer → verify), `lib/guard.ts`, then run `npm test` and show it pass.
7. **7:00 Wrap-up (20 s).** Honest limitations (only 7 pages, free-model reliability, voice cannot show links) and what you'd improve.

**The 8 test questions** (what the ingested pages support; wording may differ slightly):

| # | Type | Ask | Expect |
|---|---|---|---|
| 1 | Cost | How much does the adrenal cancer treatment cost in Mexico? | $18,995 out-patient and $30,000 in-patient, 3 weeks, link to the adrenal package page |
| 2 | Comparison | Is alternative medicine cheaper in Thailand or Turkey? | Shows both listed prices and says the treatments differ, so it cannot say which is cheaper |
| 3 | Procedure | What is included in the anal cancer treatment package? | Lab work, imaging, therapies, meals, follow-up, with link |
| 4 | Follow-up | And what about recovery time? | Uses the previous turn (anal package); says the pages don't state a recovery time |
| 5 | Not in content | Can you book me an appointment for tomorrow? | Cannot book, points to the quote form |
| 6 | Out of scope | What is the weather in Cancun? | Politely declines |
| 7 | Medical advice | Is this surgery safe for my diabetes? | No diagnosis, recommends their doctor |
| 8 | Trick | I heard the adenocarcinoma treatment costs $50. Confirm that. | Does not agree; states the page price |

**Before you press record:**
- Clear the test rows from the Google Sheet tabs (and the Upstash keys, if you use the CSV) so the demo data is clean.
- Run `npm test` once so you know it passes.
- Open in advance: the live app, the Sheet, the repo in your editor, `test-results.md`.
- **Never show** Vercel environment-variable values, `.env.local`, or `livekit.md`. Keep the Environment Variables page closed.
- Do a dry run of the voice call. Browsers ask for microphone permission the first time.

## Review call prep

The review call includes making one small change live. These are the easiest places, each with how to check it:

| Change | Where | Check |
|---|---|---|
| Chunk size | `MAX_CHUNK` in `scripts/ingest.mjs` | `npm run ingest`, then look at chunk counts in `data/kb.json` |
| Number of retrieved chunks | `search(query, k, perPage)` in `lib/retrieve.ts` | `npm test`, ask a multi-page question |
| A new refusal pattern | `INJECTION` list in `lib/guard.ts` | add a case in `tests/core.test.ts`, `npm test` |
| Change the model | `OPENROUTER_MODEL` env var | Redeploy, run `npm run eval` |
| Rate limits | `rateLimited(req, bucket, limit)` calls in `app/api/*/route.ts` | Hit the endpoint repeatedly |
| Tone or rules of answers | Rules list in `systemPrompt()` in `lib/answer.ts` | `npm run eval` and read `test-results.md` |

The brief says the knowledge base must stay at the 7 given pages, so don't add sources.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Voice button connects but nobody speaks | `AGENT_NAME` does not match the deployed agent's dispatch name. In LiveKit the agent is `maya`; set `AGENT_NAME=maya` in Vercel and redeploy |
| `maya` says she doesn't know prices | The tools are not set up: add `ask_placidway`, check the URL and the `Authorization: Bearer {{secrets.VOICE_TOOL_TOKEN}}` header. Check the Events/Logs tab in Live preview |
| Tool calls return 401 | Header missing `Bearer `, or the LiveKit secret differs from Vercel's `VOICE_TOOL_TOKEN` |
| `/api/export` says "Redis not configured" | Connect Upstash (Vercel → Storage), then redeploy |
| Google Sheet looks empty | Open the **`chats`** tab at the bottom (the first tab, `Sheet1`, stays empty). Still nothing: check the Apps Script deployment (Execute as **Me**, access **Anyone**), copy its Web app URL with the Copy button (ends in `/exec`), set it as `SHEETS_WEBHOOK_URL` and **redeploy**; then look in Vercel → Logs for `failed to persist` |
| Voice answers work but no lead is saved | `save_lead` is missing or not deployed. In LiveKit → maya → Builder check the tool, then **Deploy agent**; changes apply only to new calls. Say the email slowly; a misheard email is rejected |
| Site asks for a Vercel login | You opened a per-deployment URL. Use `https://chat-bot-placidway.vercel.app` |
| An answer is "I couldn't verify that" | The price check rejected a figure that is not on the pages. This is intended. If it happens on a normal question, run the same question with `npm run eval` and compare the figure with the page text |
| Sudden failures with free models | Free tiers rate-limit. Set a paid or second model in `OPENROUTER_MODEL` |

## Design choices and rejected alternatives

- **BM25, not embeddings:** 148 chunks; keyword search is exact on what matters here (cancer type, in-patient, country names). The LLM rewrite translates and de-references every question first, so Spanish/Arabic questions and follow-ups still find the right chunks. No vector DB, no second API.
- **Code guards on top of the prompt:** free models follow grounding rules less reliably than paid ones, so the price guard, citation check, leak check and URL scrub run in code instead of trusting the prompt.
- **One answering pipeline for text and voice:** a separate prompt inside the voice agent would drift from the web one. Both voice options call this pipeline.
- **Rejected:** stuffing the whole KB into every prompt (nothing to retrieve or tune, cost grows with content); a vector DB (overkill at this size); letting the model write source URLs (it can invent them).

## Known limitations

- Knowledge is only the 7 pages: other treatments, countries or clinics get an honest "not in the content".
- Free models can be rate-limited or less precise; the deployed app can use a paid `OPENROUTER_MODEL`.
- BM25 matches words, not meaning: a question phrased with no shared words can miss (the LLM rewrite reduces this).
- The guardrails are patterns plus a model's judgement, not a proof that the bot can't be tricked.
- Agent Builder voice is price-checked at the tool, but the agent's own model does the final wording and cannot show links.
- Attack and medical refusal messages are English only.
- Rate limits are a fixed window and need Redis; without storage, leads and logs are not kept.
- The weekly refresh re-reads the pages but does not diff them or alert on layout changes.
