# Prompt for Claude Desktop (paste this, then attach the files listed)

Attach: the voice-call screen recording (mobile), the 5 chat screenshots (docs/chats SS/1.png to 5.png), and `docs/DEMO-REPORT.md`.

---

I am applying for an AI Automation Engineer role at PlacidWay. The assessment was to build a chatbot that answers only from 7 given PlacidWay pages, cites sources, says "I don't know" honestly, and never invents prices. I built it with a text chat and a voice agent (Maya).

Write me a SHORT evidence report (one page, about 350 words) that I can paste into my submission document. Follow the structure and facts in the attached DEMO-REPORT.md (Part 1), but make it shorter and tied to my evidence.

Evidence I am giving you:
1. A mobile recording of a live voice call with Maya. I followed the voice script in Part 2, section E of the attached DEMO-REPORT.md (price question, what is included, a medical question, a prompt-extraction attempt, then a quote request where I gave my name and email, then goodbye). Watch/listen to it and match each moment to that script. The voice lead and the call summary were saved: the `leads` and `calls` tabs in the Sheet show them.
2. Five screenshots of the text chat (languages, price questions, guardrails).
3. A Google Sheet anyone can open to see the saved data: https://docs.google.com/spreadsheets/d/1F8SmrOTD0q2fGaI6xhIdLfkVSnrTZtMQhiggdnBYD3U/edit?gid=221693004#gid=221693004 (tabs: chats, gaps, leads, calls).
4. Live app: https://chat-bot-placidway.vercel.app and code: https://github.com/Stradok/AI-Chatbot-Voice-Agent-Developer-Assessment

Report structure:
- **What it does** (2 sentences).
- **How to use it** (3 numbered steps, for a first-time visitor): 1. Open https://chat-bot-placidway.vercel.app and type a question in the box, in any language, then press Send. Each answer shows the page it came from; click a source chip to open it. 2. Or press the Voice button (microphone icon), allow the microphone, and speak. A live waveform shows your voice, then Maya's voice while she answers. Press Stop to end. 3. To get a quote, say or type that you want one; the chat shows a form, and on voice Maya asks for your name and email. Everything you ask is saved to the Sheet.
- **What the evidence shows** (a short table: screenshot or video moment, what the bot did, why it is good). One row per screenshot, and 3 to 4 rows for the voice call (languages, price answer, refusal or medical, quote request).
- **How the data is saved** (3 sentences: every question goes to the Sheet and Redis; the gaps tab lists what the pages could not answer; leads and call summaries are saved too).
- **Limits** (3 bullets, honest).

Rules, important:
- Only claim what you can see or hear in my recording, screenshots or the Sheet. If something is not visible (for example a lead saved by the voice agent), say it was not shown, do not assume it worked.
- Quote prices exactly as shown ($18,995 out-patient, $30,000 in-patient, 3 weeks), nothing rounded or added.
- Plain, confident, no hype words, no emojis, no em dashes. Short sentences.
- Do not include any secret, token, API key or environment value even if one appears in a screenshot.
- Finish with one line listing anything you could not verify.

Output: a clean one-page PDF with a title, the structure above, and my two links at the top. Embed the five screenshots small, each with a one-line caption taken from Part 3 of DEMO-REPORT.md. Do not add pages beyond two.
