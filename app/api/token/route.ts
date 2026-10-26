import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";

const AGENT_NAME = "placidway-voice";

// Issues a short-lived token for a fresh room and dispatches the voice agent into it.
export async function POST() {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET)
    return Response.json({ error: "Voice is not configured" }, { status: 503 });
  const id = crypto.randomUUID().slice(0, 8);
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: `visitor-${id}`, ttl: "15m" });
  at.addGrant({ room: `kb-${id}`, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  at.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })] });
  return Response.json({ url: LIVEKIT_URL, token: await at.toJwt() });
}
