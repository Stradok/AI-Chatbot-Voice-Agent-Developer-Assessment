import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { rateLimited } from "@/lib/store";

const AGENT_NAME = process.env.AGENT_NAME || "placidway-voice"; // must equal the deployed agent's dispatch name (`lk agent list`)

// Issues a short-lived token for a fresh room and dispatches the voice agent into it.
export async function POST(req: Request) {
  if (await rateLimited(req, "voice", 10)) return Response.json({ error: "Too many requests, please wait a few minutes." }, { status: 429 });
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET)
    return Response.json({ error: "Voice is not configured" }, { status: 503 });
  const id = crypto.randomUUID().slice(0, 8);
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: `visitor-${id}`, ttl: "15m" });
  at.addGrant({ room: `kb-${id}`, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  at.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })] });
  return Response.json({ url: LIVEKIT_URL, token: await at.toJwt() });
}
