// Free "database" for the chatbot: a Google Sheet that fills itself.
// 1. Create a Google Sheet. Extensions > Apps Script > paste this file.
// 2. Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone.
// 3. Copy the web app URL into the Vercel env var SHEETS_WEBHOOK_URL and redeploy.
// Rows land in tabs named chats, gaps and leads (created on first use).
const HEADERS = {
  chats: ["at", "mode", "language", "question", "answer", "answered", "sources", "query"],
  gaps: ["at", "question", "query", "mode"],
  leads: ["at", "name", "email", "question"],
};

function doPost(e) {
  const { sheet, row } = JSON.parse(e.postData.contents);
  if (!HEADERS[sheet]) return ContentService.createTextOutput("unknown sheet");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tab = ss.getSheetByName(sheet) || ss.insertSheet(sheet);
  if (tab.getLastRow() === 0) tab.appendRow(HEADERS[sheet]);
  // a leading ' stops spreadsheet formula injection from user-typed text
  const safe = (v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v);
  tab.appendRow(HEADERS[sheet].map((h) => safe(Array.isArray(row[h]) ? row[h].join(", ") : row[h] ?? "")));
  return ContentService.createTextOutput("ok");
}
