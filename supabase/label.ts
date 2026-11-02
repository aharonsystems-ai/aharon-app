// label: reads a photo of a product sticker with an AI vision model, returns the product details
// and the best matching item from the Morning item list. Owner only. Needs one of these secrets:
// GEMINI_API_KEY (Google AI Studio) or ANTHROPIC_API_KEY. Optional: GEMINI_MODEL / ANTHROPIC_MODEL.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER = "aharonsystems@gmail.com";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), {status: s, headers: {...cors, "Content-Type": "application/json"}});
const CATS = ["מצלמות","מקליטים","תקשורת","כבלים","אביזרים","אזעקה","אינטרקום","בקרת כניסה","אודיו","מגברי קליטה","אחר"];

function prompt(items: string) {
  return `You are reading a photo of a product label/sticker for a security-camera and low-voltage installer in Israel
(cameras, NVR/DVR recorders, switches, routers, access points, cables, alarms, intercoms, access control, audio, cellular boosters).
Read everything printed on the label. Return ONLY a JSON object with these keys:
{"brand": manufacturer (e.g. Hikvision, Dahua, Provision, Ubiquiti, TP-Link) or "",
 "model": exact model code as printed (e.g. DS-2CD2143G2-I, IPC-HFW2441S-S) or "",
 "serial": serial number (S/N) or "",
 "barcode": EAN/UPC digits if printed or "",
 "name_en": short English product name, e.g. "Hikvision 4MP Dome IP Camera 2.8mm",
 "name_he": the FULL detailed Hebrew product name, written like the business's own Morning item names: product type, technology and
   main features, resolution, lens, then "מבית" + brand. Example: "מצלמת אבטחה צינור IP היברידית צבעונית עם IR וצבעוני בלילה עם שמע רזולוציה 4 מגה פיקסל עדשה 2.8 (רחבה) מבית DAHUA".
   Another: "מערכת הקלטה NVR 8 ערוצים עם 8 יציאות PoE תומך עד 4K מבית Dahua". Up to ~200 characters,
 "category": one of ${JSON.stringify(CATS)},
 "specs": extra technical details NOT already in name_he (voltage, IP rating, IR distance, storage, ports), short Hebrew, max 120 chars, or "",
 "morning_item_id": the id of the item from the list below that is the SAME product (same model, or clearly the same item), or null if none is the same,
 "morning_reason": very short Hebrew reason for the match, or "",
 "confidence": "high" | "medium" | "low" (how sure you are about the model reading)}
Do not guess a serial or barcode you cannot read. Do not match a different model just because it is the same type.
Items in the business's Morning item list (id | name | description):
${items || "(empty)"}`;
}

function parseJson(t: string) {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("ה-AI לא החזיר תשובה תקינה");
  return JSON.parse(t.slice(s, e + 1));
}

let gModel = "";
async function geminiModels(key: string) {
  // flash models that can read images, newest first; Google retires names and some need paid credit
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + encodeURIComponent(key));
  const d = await r.json().catch(() => ({}));
  const ver = (n: string) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const list = (d.models || []).map((m: any) => ({n: String(m.name).replace(/^models\//, ""), g: m.supportedGenerationMethods || []}))
    .filter((m: any) => m.g.includes("generateContent") && /^gemini-([\d.]+-)?flash(-lite)?(-latest|-\d+)?$/.test(m.n))
    .sort((a: any, b: any) => (a.n.includes("lite") ? 1 : 0) - (b.n.includes("lite") ? 1 : 0) || ver(b.n) - ver(a.n) || a.n.length - b.n.length)
    .map((m: any) => m.n);
  return list.length ? list : ["gemini-flash-latest", "gemini-flash-lite-latest"];
}

async function gemini(key: string, img: string, text: string) {
  const call = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({contents: [{parts: [{inline_data: {mime_type: "image/jpeg", data: img}}, {text}]}],
      generationConfig: {responseMimeType: "application/json", temperature: 0.1}})});
  const tryList = gModel ? [gModel] : [Deno.env.get("GEMINI_MODEL") || "", ...(await geminiModels(key))].filter(Boolean).slice(0, 8);
  let last = "", tried: string[] = [];
  for (const m of tryList) {
    const r = await call(m); tried.push(m + ":" + r.status);
    const d = await r.json().catch(() => ({}));
    if (r.ok) { gModel = m; return parseJson((d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("")); }
    last = "Gemini " + r.status + ": " + (d.error?.message || "").slice(0, 140);
    if (gModel) { gModel = ""; return gemini(key, img, text); }
    if (![402, 403, 404, 429].includes(r.status)) break;
  }
  throw new Error(last + " [" + tried.join(", ") + "]");
}

async function claude(key: string, img: string, text: string) {
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: {"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
    body: JSON.stringify({model, max_tokens: 800, messages: [{role: "user", content: [
      {type: "image", source: {type: "base64", media_type: "image/jpeg", data: img}}, {type: "text", text}]}]})});
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
  if (!gKey && !aKey) return json({ok: false, nokey: true, message: "עוד לא חובר מפתח AI"});
  const body = await req.json().catch(() => ({}));
  const img = String(body.image || "").replace(/^data:image\/\w+;base64,/, "");
  if (img.length < 1000) return json({ok: false, message: "לא התקבלה תמונה"});
  try {
    const { data: rows } = await sb.from("stock").select("id,name,notes,morning_item_id,sku,model").not("morning_item_id", "is", null).limit(1000);
    const items = (rows || []).map((s: any) => `${s.morning_item_id} | ${s.name}${s.model ? " | דגם " + s.model : ""}${s.sku ? " | מק\"ט " + s.sku : ""}`).join("\n");
    const text = prompt(items);
    const r = aKey ? await claude(aKey, img, text) : await gemini(gKey!, img, text);
    if (r.morning_item_id && !(rows || []).some((s: any) => s.morning_item_id === r.morning_item_id)) r.morning_item_id = null;
    if (!CATS.includes(r.category)) r.category = "אחר";
    return json({ok: true, item: r, model: aKey ? "claude" : gModel});
  } catch (e) {
    return json({ok: false, message: String((e as Error).message || e)}, 500);
  }
});
