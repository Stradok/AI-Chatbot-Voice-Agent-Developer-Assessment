"use client";
import { useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import type { BotReply, Msg } from "@/lib/answer";
import { renderMarkdown } from "@/lib/markdown";

type Entry =
  | { role: "user"; content: string; via?: "voice" }
  | { role: "assistant"; content: string; reply?: BotReply; error?: boolean; via?: "voice" };

const SUGGESTIONS = [
  "How much does adrenal cancer treatment cost in Mexico?",
  "Is alternative medicine cheaper in Thailand or Turkey?",
  "What is included in the anal cancer treatment package?",
  "¿Cuánto cuesta el tratamiento de adenocarcinoma?",
  "Can you book me an appointment for tomorrow?",
];

export default function Chat() {
  const [log, setLog] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<"off" | "connecting" | "on">("off");
  const [agentState, setAgentState] = useState("");
  const room = useRef<Room | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [log, busy]);
  useEffect(() => () => void room.current?.disconnect(), []);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next: Entry[] = [...log, { role: "user", content: q }];
    setLog(next);
    setInput("");
    setBusy(true);
    try {
      const messages: Msg[] = next.filter((e) => !("error" in e && e.error)).map(({ role, content }) => ({ role, content }));
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setLog((l) => [...l, { role: "assistant", content: data.answer, reply: data }]);
    } catch (err) {
      setLog((l) => [...l, { role: "assistant", content: (err as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoice() {
    if (room.current) {
      await room.current.disconnect();
      room.current = null;
      setVoice("off");
      setAgentState("");
      return;
    }
    setVoice("connecting");
    try {
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const res = await fetch("/api/token", { method: "POST" });
      const cfg = await res.json();
      if (!res.ok) throw new Error(cfg.error || "Voice unavailable");
      const r = new Room();
      // the agent sends each grounded answer (with sources) as JSON on this topic
      r.registerTextStreamHandler("kb.answer", async (reader) => {
        const { question, reply } = JSON.parse(await reader.readAll()) as { question: string; reply: BotReply };
        setLog((l) => [...l, { role: "user", content: question, via: "voice" }, { role: "assistant", content: reply.answer, reply, via: "voice" }]);
      });
      r.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) document.body.appendChild(track.attach());
      });
      r.on(RoomEvent.ParticipantAttributesChanged, (attrs) => {
        if (attrs["lk.agent.state"]) setAgentState(attrs["lk.agent.state"]);
      });
      r.on(RoomEvent.Disconnected, () => {
        room.current = null;
        setVoice("off");
        setAgentState("");
      });
      await r.connect(cfg.url, cfg.token);
      await r.localParticipant.setMicrophoneEnabled(true);
      room.current = r;
      setVoice("on");
      setAgentState("connecting");
    } catch (err) {
      setVoice("off");
      setLog((l) => [...l, { role: "assistant", content: `Voice error: ${(err as Error).message}`, error: true }]);
    }
  }

  return (
    <main className="app">
      <header>
        <h1>PlacidWay Assistant</h1>
        <p>Answers only from 7 PlacidWay pages about ITC Immunity Therapy Center (Tijuana) and alternative-medicine prices. Ask in any language, by text or voice.</p>
      </header>

      <div className="log" aria-live="polite">
        {log.length === 0 && (
          <div className="msg bot">
            <p>Hi! Ask me about treatments, packages and prices at ITC Immunity Therapy Center, or alternative medicine costs abroad. I always link the page my answer comes from.</p>
            <div className="chips" style={{ marginTop: 10 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {log.map((e, i) =>
          e.role === "user" ? (
            <div key={i} className="msg user">{e.via === "voice" ? "🎙 " : ""}{e.content}</div>
          ) : (
            <div key={i} className={`msg bot${e.error ? " error" : ""}`}>
              {e.error ? e.content : <BotMessage reply={e.reply!} question={(log[i - 1]?.content as string) ?? ""} />}
            </div>
          ),
        )}
        {busy && <div className="msg bot"><span className="tag">Searching PlacidWay pages…</span></div>}
        <div ref={end} />
      </div>

      <div className="status">{voice === "on" ? `Voice: ${agentState || "connected"} — speak any language` : voice === "connecting" ? "Connecting voice…" : ""}</div>
      <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" aria-label="Your question" maxLength={2000} />
        <button className="primary" disabled={busy || !input.trim()}>Send</button>
        <button type="button" className={`voice${voice === "on" ? " on" : ""}`} onClick={toggleVoice} disabled={voice === "connecting"} aria-label={voice === "on" ? "Stop voice" : "Start voice"}>
          {voice === "on" ? "Stop" : "🎙 Voice"}
        </button>
      </form>
    </main>
  );
}

function BotMessage({ reply, question }: { reply: BotReply; question: string }) {
  const html = renderMarkdown(reply.answer, reply.sources);
  return (
    <>
      <div dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
      {reply.sources.length > 0 && (
        <div className="sources">
          Sources:
          <ol>
            {reply.sources.map((s) => (
              <li key={s.n}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>
            ))}
          </ol>
        </div>
      )}
      {reply.wantsQuote && <LeadForm question={question} />}
    </>
  );
}

function LeadForm({ question }: { question: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    const res = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.get("name"), email: f.get("email"), question }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setState("done");
    else { setState("idle"); setError(data.error || "Could not send, please try again."); }
  }
  if (state === "done") return <p className="tag" style={{ marginTop: 10 }}>Thanks! The PlacidWay team will email you a free quote.</p>;
  return (
    <form className="lead" onSubmit={submit}>
      <span className="tag">Want a free quote? Leave your details and PlacidWay will contact you.</span>
      <input name="name" placeholder="Name" required maxLength={100} aria-label="Name" />
      <input name="email" type="email" placeholder="Email" required maxLength={200} aria-label="Email" />
      {error && <span className="tag" style={{ color: "var(--warn)" }}>{error}</span>}
      <button className="primary" disabled={state === "sending"}>Request quote</button>
    </form>
  );
}
