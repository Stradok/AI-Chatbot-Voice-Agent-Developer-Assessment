import { readList } from "@/lib/store";
import { KB } from "@/lib/retrieve";

// Admin view: unanswered questions (content gaps), leads and KB freshness.
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/gaps
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const [gaps, leads] = await Promise.all([readList("gaps"), readList("leads")]);
  return Response.json({
    kbFetchedAt: KB.fetchedAt,
    storage: gaps ? "redis" : "not configured (see server logs)",
    gaps,
    leads,
  });
}
