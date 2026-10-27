import { readList, type List } from "@/lib/store";

// CSV download (opens in Excel / Google Sheets). Admin only:
//   curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/export?list=chats" -o chats.csv
const COLUMNS: Record<List, string[]> = {
  chats: ["at", "mode", "language", "question", "answer", "answered", "sources", "query"],
  gaps: ["at", "question", "query", "mode"],
  leads: ["at", "name", "email", "question"],
  calls: ["at", "job_id", "room", "started_at", "ended_at", "summary", "results"],
};

// Quotes every cell; a leading = + - @ is prefixed with ' so Excel never runs user text as a formula.
const cell = (v: unknown) => {
  let t = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const list = new URL(req.url).searchParams.get("list") as List;
  if (!(list in COLUMNS)) return Response.json({ error: "list must be chats, gaps, leads or calls" }, { status: 400 });
  const rows = await readList(list);
  if (!rows) return Response.json({ error: "Redis not configured; use the Google Sheet sink instead" }, { status: 503 });
  const cols = COLUMNS[list];
  const csv = [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${list}.csv"` },
  });
}
