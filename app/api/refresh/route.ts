// Content refresh. `npm run build` re-ingests the pages (prebuild), so a
// refresh is a redeploy through a Vercel Deploy Hook. Triggered weekly by
// Vercel Cron (vercel.json) or manually:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/refresh
async function refresh(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) return Response.json({ error: "VERCEL_DEPLOY_HOOK_URL is not set" }, { status: 500 });
  const res = await fetch(hook, { method: "POST" });
  return Response.json({ triggered: res.ok, status: res.status }, { status: res.ok ? 202 : 502 });
}

export const GET = refresh; // Vercel Cron sends GET
export const POST = refresh;
