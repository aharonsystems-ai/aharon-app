// voice: turns a spoken (or typed) note into tasks / jobs / projects for the app. Owner only.
// Audio goes to Gemini (hears Hebrew + understands in one step). Typed text can also use Claude.
// Needs GEMINI_API_KEY (free from Google AI Studio). Optional: ANTHROPIC_API_KEY, GEMINI_MODEL, ANTHROPIC_MODEL.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER = "aharonsystems@gmail.com";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), {status: s, headers: {...cors, "Content-Type": "application/json"}});
const KINDS = ["התקנה","תיקון","קריאת שירות","תחזוקה","אחר"];

function prompt(today: string, weekday: string, clients: string, typed: string, prices: string) {
  return `אתה העוזר של אהרן, בעל "אהרן מערכות" – עסק להתקנת מצלמות אבטחה, אזעקות, תקשורת, אינטרקום וסאונד בישראל.
${typed ? "זה מה שאהרן כתב/הכתיב:\n\"\"\"" + typed + "\"\"\"" : "אהרן הקליט הודעה קולית בעברית (מצורפת). קודם כתוב בדיוק מה הוא אמר."}
היום ${weekday}, ${today} (שעון ישראל). "מחר", "ביום שלישי", "בעוד שבוע" – המר לתאריך אמיתי בפורמט YYYY-MM-DD (יום בשבוע שעבר כבר השבוע = השבוע הבא).
פרק את מה שנאמר לפריטים נפרדים. סוגים:
- "task" = משימה / תזכורת / משהו לעשות (לבדוק, להתקשר, לשלוח, לקנות, ללכת).
- "job" = עבודה שבוצעה או נסגרה אצל לקוח: התקנה, תיקון, קריאת שירות – בדרך כלל עם מחיר.
- "project" = פרויקט גדול / תכנון לבניין או לאתר (בלי בקשה להכין הצעת מחיר).
- "quote" = בקשה להכין / להוציא / לתמחר הצעת מחיר ללקוח ("תוציא הצעת מחיר", "תכין הצעה", "תמחר לי"). בנה שורות מלאות לפי המחירון של אהרן למטה.
אם לא ברור – זה task.
מחירון של אהרן (לפני מע״מ) והכללים שלו להצעות מחיר:
${prices || "(אין מחירון – השאר price ריק)"}
בהצעת מחיר: אם אהרן אמר מחיר – המחיר שלו קובע. כל פריט שנאמר = שורה עם תיאור מקצועי כמו במחירון, כמות ומחיר ליחידה. "X פלוס Y" או "X או Y" (למשל "כיפה או טורט") = תיאור "כיפה / טורט".
שמות לקוחות קיימים (אם השם שנאמר דומה לאחד מהם – השתמש בשם הקיים בדיוק):
${clients || "(אין)"}
החזר רק JSON:
{"transcript": "${typed ? "הטקסט שהתקבל" : "מה שנאמר, מילה במילה"}",
 "items": [{
   "type": "task" | "job" | "project",
   "title": "למשימה: מה לעשות, משפט קצר וברור בעברית",
   "client": "שם הלקוח או \\"\\"",
   "date": "YYYY-MM-DD או \\"\\"",
   "time": "HH:MM או \\"\\"",
   "work": "לעבודה: מה בוצע",
   "kind": "לעבודה: אחד מ-${JSON.stringify(KINDS)} או \\"\\"",
   "price": מספר בשקלים או null,
   "paid": "כן" | "לא" | "חלקי" | "לא ידוע",
   "paid_amount": מספר או null,
   "place": "עיר / מקום או \\"\\"",
   "address": "כתובת או \\"\\"",
   "phone": "טלפון או \\"\\"",
   "name": "לפרויקט: שם הפרויקט",
   "notes": "פרטים נוספים שנאמרו או \\"\\"",
   "description": "להצעת מחיר: כותרת קצרה, למשל הצעת מחיר – מערכת מצלמות אבטחה",
   "lines": [{"description": "תיאור השורה", "quantity": מספר, "price": מספר ליחידה לפני מע״מ}]}]}
אל תמציא פרטים שלא נאמרו. אם לא נאמר אם שילם – "לא ידוע". אין כפילויות.`;
}

function parseJson(t: string) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("ה-AI לא החזיר תשובה תקינה");
  return JSON.parse(t.slice(s, e + 1));
}

let gModel = "";
async function geminiModels(key: string) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + encodeURIComponent(key));
  const d = await r.json().catch(() => ({}));
  const ver = (n: string) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const list = (d.models || []).map((m: any) => ({n: String(m.name).replace(/^models\//, ""), g: m.supportedGenerationMethods || []}))
    .filter((m: any) => m.g.includes("generateContent") && /^gemini-([\d.]+-)?flash(-lite)?(-latest|-\d+)?$/.test(m.n))
    .sort((a: any, b: any) => (a.n.includes("lite") ? 1 : 0) - (b.n.includes("lite") ? 1 : 0) || ver(b.n) - ver(a.n) || a.n.length - b.n.length)
    .map((m: any) => m.n);
  return list.length ? list : ["gemini-flash-latest", "gemini-flash-lite-latest"];
}
async function gemini(key: string, parts: unknown[]) {
  const call = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({contents: [{parts}], generationConfig: {responseMimeType: "application/json", temperature: 0.1}})});
  const tryList = gModel ? [gModel] : [Deno.env.get("GEMINI_MODEL") || "", ...(await geminiModels(key))].filter(Boolean).slice(0, 8);
  let last = "", tried: string[] = [];
  for (const m of tryList) {
    const r = await call(m); tried.push(m + ":" + r.status);
    const d = await r.json().catch(() => ({}));
    if (r.ok) { gModel = m; return parseJson((d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("")); }
    last = "Gemini " + r.status + ": " + (d.error?.message || "").slice(0, 140);
    if (gModel) { gModel = ""; return gemini(key, parts); }
    if (![402, 403, 404, 429].includes(r.status)) break;
  }
  throw new Error(last + " [" + tried.join(", ") + "]");
}
async function claude(key: string, text: string) {
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: {"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
    body: JSON.stringify({model, max_tokens: 2000, messages: [{role: "user", content: text}]})});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Claude " + r.status + ": " + (d.error?.message || "").slice(0, 160));
  return parseJson((d.content || []).map((c: any) => c.text || "").join(""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: cors});
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) { try { key = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string; } catch (_) { /* none */ } }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(jwt);
  if (!u?.user || u.user.email !== OWNER) return json({ok: false, message: "אין הרשאה"}, 401);

  const env = Deno.env.toObject(), find = (re: RegExp) => Object.entries(env).find(([k, v]) => re.test(k) && v)?.[1];
  const gKey = env.GEMINI_API_KEY || find(/gemini/i), aKey = env.ANTHROPIC_API_KEY || find(/anthropic|claude/i);
  const body = await req.json().catch(() => ({}));
  const audio = String(body.audio || "").replace(/^data:[^;]+;base64,/, "");
  const text = String(body.text || "").trim().slice(0, 4000);
  if (!audio && !text) return json({ok: false, message: "לא התקבלה הקלטה או טקסט"});
  if (audio && !gKey) return json({ok: false, nokey: true, message: "עוד לא חובר מפתח Gemini – אפשר בינתיים לכתוב או להכתיב במקלדת"});
  if (!gKey && !aKey) return json({ok: false, nokey: true, message: "עוד לא חובר מפתח AI"});
  const now = new Date(Date.now() + 2 * 3600e3);
  const today = String(body.today || now.toISOString().slice(0, 10));
  const weekday = String(body.weekday || "");
  const clients = (Array.isArray(body.clients) ? body.clients : []).map((s: unknown) => String(s).slice(0, 80)).slice(0, 400).join("\n");
  try {
    const {data: pl} = await sb.from("app_settings").select("value").eq("key", "price_list").maybeSingle();
    const p = prompt(today, weekday, clients, audio ? "" : text, String(pl?.value || ""));
    const r = audio
      ? await gemini(gKey!, [{inline_data: {mime_type: String(body.mime || "audio/wav"), data: audio}}, {text: p}])
      : (gKey ? await gemini(gKey, [{text: p}]) : await claude(aKey!, p));
    const items = (Array.isArray(r.items) ? r.items : []).filter((x: any) => x && ["task", "job", "project", "quote"].includes(x.type)).slice(0, 20);
    items.forEach((x: any) => { if (x.type === "quote") x.lines = (Array.isArray(x.lines) ? x.lines : []).filter((l: any) => l && l.description).map((l: any) => ({description: String(l.description).slice(0, 300), quantity: Number(l.quantity) || 1, price: l.price == null || l.price === "" ? null : Number(l.price)})).slice(0, 40);
      if (x.kind && !KINDS.includes(x.kind)) x.kind = "אחר"; if (!["כן", "לא", "חלקי", "לא ידוע"].includes(x.paid)) x.paid = "לא ידוע"; });
    return json({ok: true, transcript: String(r.transcript || text || ""), items, model: gKey ? gModel : "claude"});
  } catch (e) {
    return json({ok: false, message: String((e as Error).message || e)}, 500);
  }
});
