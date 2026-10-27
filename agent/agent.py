"""LiveKit voice agent: speech in any language -> the web app's grounded
/api/chat endpoint -> speech in the same language.

The agent has no knowledge or prompt of its own. Retrieval, grounding rules,
the price guard and gap logging all live in the web app, so voice and text
answers follow exactly the same rules.

Pipeline: Deepgram nova-3 (language="multi") STT -> llm_node (HTTP call to
/api/chat, mode="voice") -> Cartesia sonic-3 TTS, with the language switched
per reply. All three run through LiveKit Inference, so the only credentials
are the LiveKit project keys.
"""

import json
import logging
import os
import re

import httpx
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, ModelSettings, cli, inference, llm
from livekit.plugins import silero

logger = logging.getLogger("placidway-voice")

CHAT_API_URL = os.environ["CHAT_API_URL"]  # e.g. https://<app>.vercel.app/api/chat
TTS_VOICE = os.environ.get("TTS_VOICE", "a167e0f3-df7e-4d52-a9c3-f949145efdab")
GREETING = "Hi, I'm the PlacidWay assistant. Ask me about treatments and prices at ITC Immunity Therapy Center, in any language."
FALLBACK = "Sorry, I'm having trouble reaching the PlacidWay information right now. Please try again, or use the free quote form on placidway.com."


# The session's LLM is bypassed (llm_node below), so these instructions only
# document the role. The spoken-answer rules live in VOICE_RULES in lib/answer.ts.
INSTRUCTIONS = (
    "You are PlacidWay's voice assistant. You never answer from your own knowledge: every reply "
    "comes from the PlacidWay knowledge base through /api/chat, in the caller's language."
)


def speakable(text: str) -> str:
    """Strips markdown, citation markers and URLs, which TTS would read out."""
    text = re.sub(r"\[(\d+)\]", "", text)
    text = re.sub(r"\[([^\]]+)\]\(https?://[^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[*_#`>]+", "", text)
    text = re.sub(r"^\s*[-•]\s+", "", text, flags=re.M)
    text = re.sub(r"\s+", " ", text)
    return re.sub(r"\s+([.,;:!?])", r"\1", text).strip()


class KnowledgeAgent(Agent):
    def __init__(self, ctx: JobContext) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self._ctx = ctx
        self._http = httpx.AsyncClient(timeout=45)

    async def llm_node(self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings: ModelSettings) -> str:
        messages = [
            {"role": m.role, "content": m.text_content}
            for m in chat_ctx.items
            if m.type == "message" and m.role in ("user", "assistant") and m.text_content
        ][-16:]
        if not messages or messages[-1]["role"] != "user":
            return ""
        try:
            res = await self._http.post(CHAT_API_URL, json={"messages": messages, "mode": "voice"})
            res.raise_for_status()
            reply = res.json()
        except Exception:
            logger.exception("chat API call failed")
            return FALLBACK

        # speak in the user's language
        self.session.tts.update_options(language=reply.get("language") or "en")
        # the web page shows the full answer with its source links
        try:
            await self._ctx.room.local_participant.send_text(
                json.dumps({"question": messages[-1]["content"], "reply": reply}), topic="kb.answer"
            )
        except Exception:
            logger.exception("could not send answer to the page")
        return speakable(reply.get("answer", "")) or FALLBACK


server = AgentServer()


@server.rtc_session(agent_name=os.environ.get("AGENT_NAME", "placidway-voice"))
async def entrypoint(ctx: JobContext) -> None:
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        tts=inference.TTS(model="cartesia/sonic-3", voice=TTS_VOICE, language="en"),
        # never called: llm_node above replaces it, but AgentSession needs an
        # LLM set to run the reply pipeline
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        vad=silero.VAD.load(),
    )
    await session.start(room=ctx.room, agent=KnowledgeAgent(ctx))
    await session.say(GREETING)


if __name__ == "__main__":
    cli.run_app(server)
