// invoices: supplier invoices for the app.
//  - The Gmail Apps Script (Google OAuth token of the owner) sends new invoice attachments ("ingest"),
//    and picks up month bundles to email to the accountant ("outbox" / "sent").
//  - The app (owner's Supabase login) uploads invoices by hand ("manual"), re-reads one ("reread"),
//    and pushes invoices to Morning as expense drafts ("morning").
// Gemini reads each document (supplier, number, date, total, VAT) and tells expense from income.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER = "aharonsystems@gmail.com";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), {status: s, headers: {...cors, "Content-Type": "application/json"}});
const API = "https://api.greeninvoice.co.il/api/v1";

function b64ToBytes(b64: string) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function bytesToB64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
const extOf = (name: string, mime: string) => (String(name).match(/\.([a-z0-9]{2,5})$/i)?.[1] || (mime.includes("pdf") ? "pdf" : mime.includes("png") ? "png" : "jpg")).toLowerCase();
const safe = (s: string) => String(s).replace(/[^\w.-]+/g, "_").slice(0, 80);
const isoDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
const numOr = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return String(v ?? "").trim() !== "" && isFinite(n) ? n : null; };

/* ---------- AI ---------- */
function parseJson(t: string) { const s = t.indexOf("{"), e = t.lastIndexOf("}"); if (s < 0 || e < s) throw new Error("AI: no JSON"); return JSON.parse(t.slice(s, e + 1)); }
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
async function gemini(key: string, parts: unknown[]): Promise<any> {
  const call = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({contents: [{parts}], generationConfig: {responseMimeType: "application/json", temperature: 0}})});
  const tryList = gModel ? [gModel] : [Deno.env.get("GEMINI_MODEL") || "", ...(await geminiModels(key))].filter(Boolean).slice(0, 8);
  let last = "";
  for (const m of tryList) {
    const r = await call(m); const d = await r.json().catch(() => ({}));
    if (r.ok) { gModel = m; return parseJson((d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("")); }
    last = "Gemini " + r.status + ": " + (d.error?.message || "").slice(0, 140);
    if (gModel) { gModel = ""; return gemini(key, parts); }
    if (![402, 403, 404, 429].includes(r.status)) break;
  }
  throw new Error(last);
}
const PROMPT = (meta: string) => `זה מסמך שהגיע לעסק "אהרן מערכות" (עוסק של אהרן לוי לוין, מצלמות אבטחה ותקשורת, מודיעין עילית).
${meta}
קרא את המסמך והחזר JSON בלבד:
{"kind":"expense|income|other","doc_type":"חשבונית מס|חשבונית מס קבלה|קבלה|חשבונית זיכוי|חשבון עסקה|אחר","supplier":"שם העסק שהוציא את המסמך","supplier_id":"ח.פ/ע.מ של המוציא או ריק","number":"מספר המסמך","date":"YYYY-MM-DD","amount":סכום כולל מע"מ (מספר, שלילי בזיכוי),"vat":סכום המע"מ (מספר או null),"description":"תיאור קצר של מה נקנה, עד 80 תווים"}
kind: expense = מסמך שספק הוציא לאהרן מערכות (הוצאה של העסק). income = מסמך שאהרן מערכות הוציא ללקוח. other = לא חשבונית/קבלה (פרסומת, דוח, הצעת מחיר, אישור תרומה וכו').
אל תמציא: שדה שלא כתוב במסמך – null.`;

/* ---------- Morning ---------- */
async function morningToken(): Promise<string> {
  const id = Deno.env.get("MORNING_ID"), secret = Deno.env.get("MORNING_SECRET");
  if (!id || !secret) throw new Error("חסר מפתח Morning");
  let r = await fetch("https://api.morning.co/idp/v1/oauth/token", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({grant_type: "client_credentials", client_id: id, client_secret: secret})});
  if (r.ok) { const d = await r.json(); if (d.accessToken) return d.accessToken; }
  r = await fetch(API + "/account/token", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id, secret})});
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error("Morning דחה את המפתח (" + r.status + ")");
  return d.token;
}
async function morningUpload(tok: string, bytes: Uint8Array, name: string, mime: string) {
  const q = "context=expense&data=" + encodeURIComponent(JSON.stringify({source: 5}));
  let pre: any = null, last = "";
  for (const base of ["https://apigw.greeninvoice.co.il/file-upload/v1/url", "https://api.morning.co/file-upload/v1/url"]) {
    const r = await fetch(base + "?" + q, {headers: {Authorization: "Bearer " + tok}});
    if (r.ok) { pre = await r.json(); break; }
    last = r.status + " " + (await r.text()).slice(0, 160);
  }
  if (!pre?.url) throw new Error("Morning לא נתן כתובת העלאה: " + last);
  const form = new FormData();
  for (const [k, v] of Object.entries(pre.fields || {})) form.append(k, String(v));
  form.append("file", new Blob([bytes], {type: mime}), name);
  const up = await fetch(pre.url, {method: "POST", body: form});
  if (![200, 201, 204].includes(up.status)) throw new Error("ההעלאה ל-Morning נכשלה " + up.status + ": " + (await up.text()).slice(0, 160));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: cors});
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) { try { key = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string; } catch (_) { /* none */ } }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);

  // who is calling: the app (Supabase login) or the Gmail script (Google token). Owner only.
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let caller = "";
  if (tok.startsWith("ya29.")) {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(tok));
    const info = await r.json().catch(() => ({}));
    if (r.ok && info.email === OWNER && String(info.email_verified) === "true") caller = "script";
  } else if (tok) {
    const { data: u } = await sb.auth.getUser(tok);
    if (u?.user?.email === OWNER) caller = "app";
  }
  if (!caller) return json({ok: false, message: "אין הרשאה"}, 401);

  const env = Deno.env.toObject();
  const gKey = env.GEMINI_API_KEY || Object.entries(env).find(([k, v]) => /gemini/i.test(k) && v)?.[1] || "";
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  async function read(bytes: Uint8Array, mime: string, meta: string) {
    if (!gKey) return {};
    try { return await gemini(gKey, [{inline_data: {mime_type: mime, data: bytesToB64(bytes)}}, {text: PROMPT(meta)}]); }
    catch (e) { return {error: String((e as Error).message || e)}; }
  }
  function rowFrom(ai: any, fallbackDate: string) {
    const date = isoDate(ai.date);
    const kind = ["expense", "income", "other"].includes(ai.kind) ? ai.kind : "expense";
    return {kind, doc_type: ai.doc_type || null, supplier: ai.supplier || null, supplier_id: ai.supplier_id || null,
      doc_number: ai.number ? String(ai.number) : null, doc_date: date, amount: numOr(ai.amount), vat: numOr(ai.vat),
      description: ai.description || null, month: (date || fallbackDate).slice(0, 7),
      status: kind === "expense" ? "לבדיקה" : "לא רלוונטי", notes: ai.error ? "⚠ ה-AI לא קרא: " + ai.error : null};
  }

  try {
    /* ----- from the Gmail script ----- */
    if (action === "known") {
      const ids = (body.ids || []).map(String).slice(0, 500);
      if (!ids.length) return json({ok: true, known: []});
      const { data, error } = await sb.from("invoices").select("msg_id").in("msg_id", ids);
      if (error) throw error;
      return json({ok: true, known: (data || []).map((r: any) => r.msg_id)});
    }
    if (action === "ingest") {
      if (caller !== "script") return json({ok: false, message: "אין הרשאה"}, 401);
      const msg_id = String(body.msg_id || "");
      if (!msg_id || !body.data) return json({ok: false, message: "חסר קובץ"}, 400);
      const { data: ex } = await sb.from("invoices").select("id").eq("msg_id", msg_id).maybeSingle();
      if (ex) return json({ok: true, exists: true});
      const mime = String(body.mime || "application/pdf"), bytes = b64ToBytes(String(body.data));
      const received = String(body.received_at || new Date().toISOString());
      const path = `gmail/${received.slice(0, 7)}/${safe(msg_id)}.${extOf(body.file_name, mime)}`;
      const up = await sb.storage.from("invoices").upload(path, bytes, {contentType: mime, upsert: true});
      if (up.error) throw up.error;
      const ai = await read(bytes, mime, `המייל: מאת ${body.from_name || ""} <${body.from_email || ""}>, נושא: ${body.subject || ""}, קובץ: ${body.file_name || ""}`);
      const row = {...rowFrom(ai, received), msg_id, source: "gmail", received_at: received, from_email: body.from_email || null,
        from_name: body.from_name || null, subject: body.subject || null, file_path: path, file_name: body.file_name || null, mime};
      if (!row.supplier) row.supplier = body.from_name || null;
      const { error } = await sb.from("invoices").insert(row);
      if (error && !/duplicate/i.test(error.message)) throw error;
      return json({ok: true, kind: row.kind, supplier: row.supplier, amount: row.amount});
    }
    if (action === "outbox") {
      const { data: sends } = await sb.from("invoice_sends").select("*").eq("status", "ממתין").order("requested_at").limit(3);
      const out = [];
      for (const s of sends || []) {
        const { data: inv } = await sb.from("invoices").select("*").eq("month", s.month).eq("status", "מאושר").eq("kind", "expense").order("doc_date");
        const items = [];
        for (const x of inv || []) {
          if (!x.file_path) continue;
          const { data: u } = await sb.storage.from("invoices").createSignedUrl(x.file_path, 3600);
          items.push({id: x.id, url: u?.signedUrl, name: `${x.doc_date || ""} ${x.supplier || "ספק"} ${x.doc_number || ""}`.trim() + "." + extOf(x.file_name || x.file_path, x.mime || ""),
            supplier: x.supplier, number: x.doc_number, date: x.doc_date, amount: x.amount, vat: x.vat, doc_type: x.doc_type});
        }
        out.push({id: s.id, month: s.month, to: s.to_email, items});
      }
      return json({ok: true, sends: out});
    }
    if (action === "sent") {
      const id = String(body.id || ""), now = new Date().toISOString();
      if (body.ok) {
        await sb.from("invoice_sends").update({status: "נשלח", sent_at: now, count: body.count ?? null, total: body.total ?? null, error: null}).eq("id", id);
        if ((body.ids || []).length) await sb.from("invoices").update({sent_at: now, updated_at: now}).in("id", body.ids);
      } else {
        await sb.from("invoice_sends").update({status: "שגיאה", error: String(body.error || "").slice(0, 400)}).eq("id", id);
      }
      return json({ok: true});
    }

    /* ----- from the app ----- */
    if (action === "manual" || action === "reread") {
      let x: any = null, path = String(body.path || ""), mime = String(body.mime || "application/pdf");
      if (action === "reread") {
        const r = await sb.from("invoices").select("*").eq("id", body.id).single(); if (r.error) throw r.error;
        x = r.data; path = x.file_path; mime = x.mime || mime;
      }
      const dl = await sb.storage.from("invoices").download(path);
      if (dl.error) throw dl.error;
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      const ai = await read(bytes, mime, x ? `המייל: ${x.from_name || ""} <${x.from_email || ""}>, נושא: ${x.subject || ""}` : "הועלה ידנית על ידי אהרן – כמעט תמיד הוצאה.");
      const now = new Date().toISOString();
      const row: any = rowFrom(ai, x?.received_at || now);
      if (action === "manual") {
        if (row.kind !== "income") { row.kind = "expense"; row.status = "לבדיקה"; }
        const { data, error } = await sb.from("invoices").insert({...row, source: "ידני", received_at: now, file_path: path, file_name: body.file_name || null, mime}).select().single();
        if (error) throw error;
        return json({ok: true, invoice: data});
      }
      const keep = x.status === "מאושר" ? {status: "מאושר"} : {};
      const { error } = await sb.from("invoices").update({...row, ...keep, supplier: row.supplier || x.supplier, updated_at: now}).eq("id", x.id);
      if (error) throw error;
      return json({ok: true});
    }
    if (action === "morning") {
      const ids = (body.ids || []).map(String).slice(0, 40);
      const { data: inv, error } = await sb.from("invoices").select("*").in("id", ids);
      if (error) throw error;
      const mtok = await morningToken();
      let ok = 0; const errs: string[] = [];
      for (const x of inv || []) {
        const now = new Date().toISOString();
        try {
          const dl = await sb.storage.from("invoices").download(x.file_path); if (dl.error) throw dl.error;
          const bytes = new Uint8Array(await dl.data.arrayBuffer());
          await morningUpload(mtok, bytes, `${safe(x.supplier || "invoice")}_${safe(x.doc_number || "")}_${crypto.randomUUID().slice(0, 8)}.${extOf(x.file_name || x.file_path, x.mime || "")}`, x.mime || "application/pdf");
          await sb.from("invoices").update({morning_state: "נשלח", morning_at: now, morning_err: null, updated_at: now}).eq("id", x.id);
          ok++;
        } catch (e) {
          const m = String((e as Error).message || e).slice(0, 300); errs.push(m);
          await sb.from("invoices").update({morning_state: "שגיאה", morning_err: m, updated_at: now}).eq("id", x.id);
        }
      }
      return json({ok: !errs.length, sent: ok, message: errs.length ? `${ok} נשלחו, ${errs.length} נכשלו: ${errs[0]}` : `${ok} חשבוניות נשלחו ל-Morning`});
    }
    return json({ok: false, message: "פעולה לא מוכרת"}, 400);
  } catch (e) {
    return json({ok: false, message: String((e as Error).message || e)}, 500);
  }
});
