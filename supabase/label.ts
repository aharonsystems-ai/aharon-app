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
 "name_he": short natural Hebrew name an Israeli installer would use, e.g. "מצלמת כיפה IP 4MP היקוויז'ן 2.8 מ\\"מ",
 "category": one of ${JSON.stringify(CATS)},
 "specs": short Hebrew summary of the key specs you can read or reliably know for this exact model (resolution, lens, IR, PoE, channels, ports, voltage), max 160 chars,
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

async function gemini(key: string, img: string, text: string) {
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({contents: [{parts: [{inline_data: {mime_type: "image/jpeg", data: img}}, {text}]}],
      generationConfig: {responseMimeType: "application/json", temperature: 0.1}})});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Gemini " + r.status + ": " + (d.error?.message || "").slice(0, 160));
  return parseJson((d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join(""));
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

  const gKey = Deno.env.get("GEMINI_API_KEY"), aKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!gKey && !aKey) return json({ok: false, nokey: true, message: "עוד לא חובר מפתח AI"});
  const body = await req.json().catch(() => ({}));
  const img = String(body.image || "").replace(/^data:image\/\w+;base64,/, "");
  if (img.length < 1000) return json({ok: false, message: "לא התקבלה תמונה"});
  try {
    const { data: rows } = await sb.from("stock").select("id,name,notes,morning_item_id").not("morning_item_id", "is", null).limit(1000);
    const items = (rows || []).map((s: any) => `${s.morning_item_id} | ${s.name} | ${String(s.notes || "").replace(/\s+/g, " ").slice(0, 80)}`).join("\n");
    const text = prompt(items);
    const r = aKey ? await claude(aKey, img, text) : await gemini(gKey!, img, text);
    if (r.morning_item_id && !(rows || []).some((s: any) => s.morning_item_id === r.morning_item_id)) r.morning_item_id = null;
    if (!CATS.includes(r.category)) r.category = "אחר";
    return json({ok: true, item: r});
  } catch (e) {
    return json({ok: false, message: String((e as Error).message || e)}, 500);
  }
});
