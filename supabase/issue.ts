// issue: invoice + warranty certificate for a finished job.
//  App (owner's Supabase login):
//   - "next"     → next free warranty number
//   - "preview"  → invoice preview from Morning (nothing is issued) + filled warranty PDF
//   - "issue"    → issues the invoice in Morning (Morning does NOT email it), fills the warranty,
//                  and emails ONE mail from the owner's Gmail with both PDFs attached
//   - "send"     → same mail for a job whose invoice already exists in Morning (or warranty only)
//  Gmail Apps Script (owner's Google token):
//   - "mailer"   → registers the script's web-app URL + secret that sends the mail
// Deploy with "Verify JWT" OFF (the Gmail script calls with a Google token); the owner check is below.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as PDFLib from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const OWNER = "aharonsystems@gmail.com";
const ASSETS = "https://aharonsystems-ai.github.io/aharon-app/assets/";
const API = "https://api.greeninvoice.co.il/api/v1";
const VAT = 0.18;
const cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), {status: s, headers: {...cors, "Content-Type": "application/json"}});
const TYPES: Record<number, string> = {305: "חשבונית מס", 320: "חשבונית מס קבלה", 400: "קבלה", 300: "חשבון עסקה", 10: "הצעת מחיר"};
const PAY: Record<number, string> = {1: "מזומן", 2: "צ'ק", 4: "העברה בנקאית", 10: "אפליקציית תשלום (ביט / פייבוקס)"};
const round2 = (n: number) => Math.round(n * 100) / 100;
function bytesToB64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToBytes(b64: string) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
const heDate = (iso: string) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"} as any)[c]);
const fname = (s: string) => String(s).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();


/* ---------- AI (Gemini) – reads supplier / competitor quotes for a new quote draft ---------- */
let gModel = "";
async function geminiModels(key: string) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + encodeURIComponent(key));
  const d = await r.json().catch(() => ({}));
  const ver = (n: string) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  return (d.models || []).map((m: any) => ({n: String(m.name).replace(/^models\//, ""), g: m.supportedGenerationMethods || []}))
    .filter((m: any) => m.g.includes("generateContent") && /^gemini-([\d.]+-)?(flash|pro)(-lite)?(-latest|-\d+)?$/.test(m.n))
    .sort((a: any, b: any) => (a.n.includes("lite") ? 1 : 0) - (b.n.includes("lite") ? 1 : 0) || ver(b.n) - ver(a.n) || a.n.length - b.n.length)
    .map((m: any) => m.n);
}
async function gemini(parts: unknown[]): Promise<any> {
  const env = Deno.env.toObject();
  const key = env.GEMINI_API_KEY || Object.entries(env).find(([k, v]) => /gemini/i.test(k) && v)?.[1] || "";
  if (!key) throw new Error("חסר מפתח Gemini");
  const call = (model: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({contents: [{parts}], generationConfig: {responseMimeType: "application/json", temperature: 0}})});
  const list = gModel ? [gModel] : [env.GEMINI_MODEL || "", ...(await geminiModels(key))].filter(Boolean).slice(0, 8);
  let last = "";
  for (const m of list) {
    const r = await call(m); const d = await r.json().catch(() => ({}));
    if (r.ok) {
      gModel = m; const t = (d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
      const a = t.indexOf("{"), z = t.lastIndexOf("}"); if (a < 0 || z < a) throw new Error("AI: no JSON");
      return JSON.parse(t.slice(a, z + 1));
    }
    last = "Gemini " + r.status + ": " + (d.error?.message || "").slice(0, 140);
    if (gModel) { gModel = ""; return gemini(parts); }
    if (![402, 403, 404, 429].includes(r.status)) break;
  }
  throw new Error(last);
}
const QUOTE_PROMPT = `אתה מכין טיוטה של הצעת מחיר ללקוח של "אהרן מערכות" (מצלמות אבטחה, אזעקות, תקשורת).
צירפתי מסמכים: הצעות מחיר מספקים אל אהרן מערכות (זו העלות של אהרן), ואולי הצעת מחיר של מתחרה ללקוח.
החזר JSON בלבד:
{"client":"שם הלקוח (מ'לכבוד' בהצעת המתחרה) או ריק","title":"כותרת קצרה להצעה",
 "lines":[{"group":"שם האתר/המערכת אם יש כמה (למשל חנות אופניים), אחרת ריק","description":"תיאור קצר וברור בעברית ללקוח, בלי מק\\"ט","quantity":מספר,"cost":עלות ליחידה לפני מע\\"מ לפי הספק או null,"competitor_price":מחיר ליחידה לפני מע\\"מ אצל המתחרה לאותו פריט או null}],
 "competitor":{"name":"שם המתחרה או ריק","total":סה\\"כ לפני מע\\"מ או null,"monthly":[{"description":"","price":מספר}]},
 "notes":"מה חסר או לא תואם (למשל פריט שאין לו מחיר ספק), בעברית, עד 3 שורות"}
כללים: כל פריט בהצעת הספק = שורה אחת. אם יש כמה הצעות ספק לאתרים שונים – group לפי האתר (תתאים להצעת המתחרה).
פריט שיש אצל המתחרה ואין אצל הספק – שורה עם cost null. שורת "התקנה/חיווט" של המתחרה – אל תוסיף כשורה.
מחיר ספק בדולר – השתמש בשקלים שבמסמך אם יש. תעלה/צינור במטרים – quantity במטרים ו-cost למטר. אל תמציא מחירים.`;

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
async function mcall(tok: string, method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, {method, headers: {"Content-Type": "application/json", Authorization: "Bearer " + tok}, body: body ? JSON.stringify(body) : undefined});
  const t = await r.text(); let d: any = {}; try { d = JSON.parse(t); } catch (_) { d = {raw: t}; }
  if (!r.ok) throw new Error("Morning: " + (d.errorMessage || d.message || t.slice(0, 200) || r.status));
  return d;
}
async function findClient(tok: string, name: string) {
  try {
    const d = await mcall(tok, "POST", "/clients/search", {name, page: 1, pageSize: 20});
    const n = (s: string) => String(s || "").replace(/["'״׳]/g, "").replace(/\s+/g, " ").trim();
    return (d.items || []).find((c: any) => n(c.name) === n(name)) || null;
  } catch (_) { return null; }
}
type Line = {description: string; quantity: number; price: number};
function docBody(b: any, client: any) {
  const type = [305, 320, 10, 300].includes(Number(b.type)) ? Number(b.type) : 305;
  const incl = !!b.vat_included;
  const lines: Line[] = (b.lines || []).map((l: any) => ({description: String(l.description || "").trim(), quantity: Number(l.quantity) || 1, price: Number(l.price) || 0}))
    .filter((l: Line) => l.description && l.price);
  if (!lines.length) throw new Error("צריך לפחות שורה אחת עם תיאור ומחיר");
  const net = lines.reduce((s, l) => s + l.quantity * l.price, 0);
  const total = round2(incl ? net : net * (1 + VAT));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? String(b.date) : new Date().toISOString().slice(0, 10);
  const body: any = {type, date, lang: "he", currency: "ILS", vatType: 0, rounding: false, signed: true, attachment: true,
    description: String(b.description || "").slice(0, 200) || undefined, remarks: b.remarks ? String(b.remarks).slice(0, type === 10 ? 1500 : 500) : undefined,
    // no_morning_mail: the invoice goes out in ONE Gmail mail together with the warranty, so Morning must not mail it too
    client: client?.id ? {id: client.id, name: client.name, emails: b.no_morning_mail ? [] : b.email ? [b.email] : (client.emails || []), add: false}
      : {name: b.client, emails: b.no_morning_mail || !b.email ? [] : [b.email], phone: b.phone || undefined, mobile: b.phone || undefined, address: b.address || undefined, taxId: b.tax_id ? String(b.tax_id).replace(/\D/g, "") : undefined, add: true},
    income: lines.map(l => ({description: l.description, quantity: l.quantity, price: l.price, currency: "ILS", vatType: incl ? 1 : 0}))};
  if (type === 320) body.payment = [{type: PAY[Number(b.pay_type)] ? Number(b.pay_type) : 4, date, price: total, currency: "ILS"}];
  return {body, total, type};
}
async function docPdf(tok: string, id: string, known?: any): Promise<{bytes: Uint8Array; number: string; type: number; url: string}> {
  let d = known;
  if (!d?.number) d = await mcall(tok, "GET", "/documents/" + id);
  let url = d?.url?.he || d?.url?.origin || "";
  if (!url) { const l = await mcall(tok, "GET", `/documents/${id}/download/links`); url = l.he || l.origin || ""; }
  if (!url) throw new Error("Morning לא נתן קישור ל-PDF של המסמך");
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok && (r.headers.get("content-type") || "").includes("pdf")) return {bytes: new Uint8Array(await r.arrayBuffer()), number: String(d.number ?? ""), type: d.type, url};
    await new Promise(ok => setTimeout(ok, 1500));
  }
  throw new Error("לא הצלחתי להוריד את ה-PDF של החשבונית מ-Morning");
}

/* ---------- warranty PDF ---------- */
const W_LAYOUT: any = {
  no: [316.9, 236, 85, 29.5],
  f: {client: [410, 343, 223.6], date: [74, 343, 202.3], address: [410, 376.5, 191.8], phone: [74, 376.5, 257],
      details: [55, 531.5, 583.3], details2: [55, 558.5, 583.3], doc: [55, 587.5, 372.6], installer: [414.5, 885.5, 207.7], clientSig: [55, 885.5, 215.4]},
  cb: {"מצלמות אבטחה": [704, 456.25], "מערכת אזעקה": [477.3, 456.25], "אינטרקום ובקרת כניסה": [250.7, 456.25],
       "רשת ותקשורת / WiFi": [704, 485.75], "הגברה ואודיו": [477.3, 485.75], "מגבר קליטה סלולרי": [250.7, 485.75]},
};
function visual(s: unknown) {
  // fontkit lays out a Hebrew string right-to-left by reversing the whole run: pre-reverse the LTR chunks (numbers, Latin) and mirror brackets
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!/[֐-׿]/.test(t)) return t;
  const mir: Record<string, string> = {"(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<"};
  return t.replace(/[A-Za-z0-9](?:[A-Za-z0-9@._\-\/:+,' ]*[A-Za-z0-9])?/g, x => [...x].reverse().join("")).replace(/[()[\]<>]/g, c => mir[c]);
}
let assets: {tpl: Uint8Array; font: Uint8Array} | null = null;
async function loadAssets() {
  if (assets) return assets;
  const get = async (n: string) => { const r = await fetch(ASSETS + n); if (!r.ok) throw new Error("חסר קובץ " + n + " (" + r.status + ")"); return new Uint8Array(await r.arrayBuffer()); };
  const [tpl, font] = await Promise.all([get("warranty-template.pdf"), get("Heebo-700.ttf")]);
  return (assets = {tpl, font});
}
async function fillWarranty(d: any, sigBytes?: Uint8Array | null) {
  const {tpl, font: fontBytes} = await loadAssets();
  const {PDFDocument, rgb} = PDFLib as any;
  const doc = await PDFDocument.load(tpl); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, {subset: true});
  const pg = doc.getPages()[0]; const H = pg.getHeight(); const k = 0.75;
  const navy = rgb(0.06, 0.16, 0.36), red = rgb(0.753, 0.224, 0.169), blue = rgb(0.11, 0.55, 0.82);
  const put = (key: string, text: unknown, size = 12.5) => {
    const r = W_LAYOUT.f[key]; if (!r || !String(text ?? "").trim()) return;
    const v = visual(text); let s = size; const maxW = r[2] * k - 6;
    while (s > 7 && font.widthOfTextAtSize(v, s) > maxW) s -= 0.5;
    pg.drawText(v, {x: (r[0] + r[2]) * k - 3 - font.widthOfTextAtSize(v, s), y: H - r[1] * k + 3.5, size: s, font, color: navy});
  };
  if (d.no) {
    const t = String(d.no), s = 16, w = font.widthOfTextAtSize(t, s) + (t.length - 1) * 1.5;
    const cx = (W_LAYOUT.no[0] + W_LAYOUT.no[2] / 2) * k, cy = H - (W_LAYOUT.no[1] + W_LAYOUT.no[3] / 2) * k;
    let x = cx - w / 2; for (const ch of t) { pg.drawText(ch, {x, y: cy - s * 0.36, size: s, font, color: red}); x += font.widthOfTextAtSize(ch, s) + 1.5; }
  }
  put("client", d.client); put("date", d.date); put("address", d.address); put("phone", d.phone);
  if (d.details) {
    const words = String(d.details).replace(/\s+/g, " ").trim().split(" "); const maxW = W_LAYOUT.f.details[2] * k - 6;
    let l1 = "", i = 0;
    for (; i < words.length; i++) { const t = (l1 ? l1 + " " : "") + words[i]; if (font.widthOfTextAtSize(visual(t), 12) > maxW) break; l1 = t; }
    put("details", l1 || d.details, 12); if (i < words.length) put("details2", words.slice(i).join(" "), 12);
  }
  put("doc", d.docRef); put("installer", d.installer || "אהרן לוי לוין");
  for (const name of d.items || []) {
    const c = W_LAYOUT.cb[name]; if (!c) continue;
    pg.drawSvgPath("M 3 7.5 L 6.2 11 L 12 3.5", {x: c[0] * k + 0.3, y: H - c[1] * k - 0.6, borderColor: blue, borderWidth: 2.4});
  }
  if (sigBytes) {
    try {
      const img = await doc.embedPng(sigBytes); const r = W_LAYOUT.f.clientSig; const hh = 30, ww = Math.min(r[2] * k - 6, img.width * hh / img.height);
      pg.drawImage(img, {x: (r[0] + r[2]) * k - 3 - ww, y: H - r[1] * k + 1, width: ww, height: hh});
    } catch (_) { /* signature is optional */ }
  }
  doc.setTitle("תעודת אחריות " + (d.no || "")); doc.setAuthor("אהרן מערכות");
  return new Uint8Array(await doc.save());
}


/* ---------- check report PDF (דוח בדיקה ואישור תקינות) – the printed form, filled ---------- */
const R_LAYOUT: any = {
  no: [243, 164, 299, 184],
  f: {client: [300, 478, 216], date: [40, 205, 216], address: [300, 504, 238.5], phone: [40, 252, 238.5], next: [340, 478, 671]},
  visit: {"התקנה חדשה": [472, 256], "תחזוקה תקופתית": [373, 256], "קריאת שירות": [256, 256], "אישור לביטוח": [159, 256]},
  alarm: {y0: 302, dy: 15, n: 8, dl: 128, dr: 428},
  cams: {y0: 452, dy: 15, n: 9, dl: 128, dr: 403},
  ok: 107, bad: 61,
  result: [[540, 614], [540, 631], [540, 648]],
  notes: [[40, 278, 618], [40, 278, 636], [40, 278, 654]],
  sigInstaller: [345, 478, 715], sigClient: [40, 203, 715],
};
let reportTpl: Uint8Array | null = null;
async function fillReport(d: any, sigClient?: Uint8Array | null, sigInstaller?: Uint8Array | null) {
  const {font: fontBytes} = await loadAssets();
  if (!reportTpl) { const r = await fetch(ASSETS + "report-template.pdf"); if (!r.ok) throw new Error("חסר קובץ report-template.pdf"); reportTpl = new Uint8Array(await r.arrayBuffer()); }
  const {PDFDocument, rgb} = PDFLib as any;
  const doc = await PDFDocument.load(reportTpl); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, {subset: true});
  const pg = doc.getPages()[0]; const H = pg.getHeight(); const L = R_LAYOUT;
  const navy = rgb(0.06, 0.16, 0.36), red = rgb(0.753, 0.224, 0.169), green = rgb(0.13, 0.55, 0.3), white = rgb(1, 1, 1);
  const txt = (text: unknown, l: number, r: number, yb: number, size = 11, color = navy) => {
    const t = String(text ?? "").replace(/\s+/g, " ").trim(); if (!t) return;
    const v = visual(t); let s = size; const maxW = r - l - 4;
    while (s > 6.5 && font.widthOfTextAtSize(v, s) > maxW) s -= 0.5;
    pg.drawText(v, {x: r - 2 - font.widthOfTextAtSize(v, s), y: H - yb, size: s, font, color});
  };
  const tick = (cx: number, cy: number, color: any) => pg.drawSvgPath("M 0 5 L 3.6 9 L 10 0", {x: cx - 5, y: H - cy + 4.5, borderColor: color, borderWidth: 2.2});
  const cross = (cx: number, cy: number, color: any) => pg.drawSvgPath("M 0 0 L 8 8 M 8 0 L 0 8", {x: cx - 4, y: H - cy + 4, borderColor: color, borderWidth: 2});
  if (d.no) {
    const [x0, y0, x1, y1] = L.no; pg.drawRectangle({x: x0, y: H - y1, width: x1 - x0, height: y1 - y0, color: white});
    const t = String(d.no), s = 16, w = font.widthOfTextAtSize(t, s) + (t.length - 1) * 1.2;
    let x = (x0 + x1) / 2 - w / 2; for (const ch of t) { pg.drawText(ch, {x, y: H - y1 + 4, size: s, font, color: red}); x += font.widthOfTextAtSize(ch, s) + 1.2; }
  }
  for (const k of ["client", "date", "address", "phone", "next"]) { const f = L.f[k]; txt(d[k], f[0], f[1], f[2], 11.5); }
  for (const v of d.visit || []) { const c = L.visit[v]; if (c) tick(c[0], c[1], navy); }
  const rows = (sec: any, arr: any[]) => (arr || []).slice(0, sec.n).forEach((r: any, i: number) => {
    if (!r) return; const yc = sec.y0 + i * sec.dy;
    txt(r.detail, sec.dl, sec.dr, yc + 3.5, 9.5);
    if (r.ok === true) tick(L.ok, yc, green); else if (r.ok === false) cross(L.bad, yc, red);
  });
  rows(L.alarm, d.alarm); rows(L.cams, d.cams);
  if (d.result != null && L.result[d.result]) { const [cx, cy] = L.result[d.result]; pg.drawCircle({x: cx, y: H - cy, size: 3.6, color: navy}); }
  (d.notes || []).slice(0, 3).forEach((n: string, i: number) => { const [l, r, y] = L.notes[i]; txt(n, l, r, y - 1, 10); });
  const sig = async (bytes: Uint8Array | null | undefined, box: number[]) => {
    if (!bytes) return;
    try { const img = await doc.embedPng(bytes); const hh = 26, ww = Math.min(box[1] - box[0] - 4, img.width * hh / img.height); pg.drawImage(img, {x: box[1] - 2 - ww, y: H - box[2] + 1, width: ww, height: hh}); } catch (_) { /* optional */ }
  };
  await sig(sigInstaller, L.sigInstaller); await sig(sigClient, L.sigClient);
  doc.setTitle("דוח בדיקה ואישור תקינות " + (d.no || "")); doc.setAuthor("אהרן מערכות");
  return new Uint8Array(await doc.save());
}

/* ---------- mail (owner's Gmail via the Apps Script web app) ---------- */
function mailHtml(o: {first: string; docName: string; wNo: string; summary: string; payLink?: string}) {
  const parts = [o.docName, o.wNo ? "תעודת אחריות מספר " + o.wNo : ""].filter(Boolean);
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f2a5c">
שלום ${esc(o.first)},<br>תודה שבחרת באהרן מערכות.<br><br>
מצורפים למייל: ${esc(parts.join(" ו"))}.<br>
${o.summary ? `<br><b>סיכום העבודה:</b><br>${esc(o.summary).replace(/\n/g, "<br>")}<br>` : ""}
${o.wNo ? `<br>האחריות על עבודת ההתקנה היא ל-12 חודשים. כדאי לשמור את התעודה.<br>` : ""}
${o.payLink ? `<br>לתשלום: <a href="${esc(o.payLink)}">${esc(o.payLink)}</a><br>` : ""}
<br>לכל שאלה אני זמין.<br><br><b>אהרן מערכות</b> – אבטחה ותקשורת בידיים טובות<br>055-975-9822 · <a href="https://aharonsystems.com">aharonsystems.com</a></div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: cors});
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) { try { key = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string; } catch (_) { /* none */ } }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let caller = "";
  if (tok.startsWith("ya29.")) {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(tok));
    const info = await r.json().catch(() => ({}));
    if (r.ok && info.email === OWNER && String(info.email_verified) === "true") caller = "script";
  } else if (tok) {
    const {data: u} = await sb.auth.getUser(tok);
    if (u?.user?.email === OWNER) caller = "app";
  }
  if (!caller) return json({ok: false, message: "אין הרשאה"}, 401);
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "");
  const setting = async (k: string) => (await sb.from("app_settings").select("value").eq("key", k).maybeSingle()).data?.value || "";
  try {
    if (action === "mailer") {
      if (caller !== "script") return json({ok: false, message: "אין הרשאה"}, 401);
      const now = new Date().toISOString();
      await sb.from("app_settings").upsert([{key: "mailer_url", value: String(b.url || ""), updated_at: now}, {key: "mailer_secret", value: String(b.secret || ""), updated_at: now}]);
      return json({ok: true});
    }
    if (caller !== "app") return json({ok: false, message: "אין הרשאה"}, 401);

    // quote draft from files: supplier quotes (cost) + optional competitor quote → suggested lines. Nothing is created.
    if (action === "quote_draft") {
      const files = Array.isArray(b.files) ? b.files.slice(0, 6) : [];
      if (!files.length) return json({ok: false, message: "לא צורפו קבצים"}, 400);
      const parts: unknown[] = [{text: QUOTE_PROMPT}];
      for (const f of files) {
        parts.push({text: `קובץ: ${String(f.name || "")}${f.role ? " (" + f.role + ")" : ""}`});
        parts.push({inline_data: {mime_type: String(f.mime || "application/pdf"), data: String(f.b64 || "")}});
      }
      const d = await gemini(parts);
      return json({ok: true, draft: d});
    }
    // an existing quote's content, to fix it into a new one
    if (action === "quote_get") {
      const mtok = await morningToken();
      const d = await mcall(mtok, "GET", "/documents/" + encodeURIComponent(String(b.id || "")));
      const items = (d.income || []).map((x: any) => ({description: x.description, quantity: x.quantity, price: x.price}));
      return json({ok: true, client: d.client?.name || "", phone: d.client?.phone || "", email: (d.client?.emails || [])[0] || "",
        address: d.client?.address || "", description: d.description || "", remarks: d.remarks || "", vat_included: (d.income || [])[0]?.vatType === 1, lines: items});
    }
    // close an old quote in Morning (after a fixed one was made)
    if (action === "quote_close") {
      const mtok = await morningToken(), id = String(b.id || "");
      await mcall(mtok, "POST", "/documents/" + encodeURIComponent(id) + "/close");
      await sb.from("morning_docs").update({status: 1, status_name: "סגור", synced_at: new Date().toISOString()}).eq("id", id);
      return json({ok: true});
    }

    // quote (הצעת מחיר, type 10) made in the app: preview only, or create it in Morning. Nothing is mailed.
    if (action === "quote_preview" || action === "quote") {
      const mtok = await morningToken();
      const {body, total} = docBody({...b, type: [300, 305].includes(Number(b.doc_type)) ? Number(b.doc_type) : 10}, await findClient(mtok, String(b.client || "")));
      if (action === "quote_preview") {
        const p = await mcall(mtok, "POST", "/documents/preview", body);
        const pdf = p.file || p.pdf || p.data || null;
        if (!pdf) throw new Error("Morning לא החזיר תצוגה מקדימה");
        return json({ok: true, pdf, total});
      }
      const created = await mcall(mtok, "POST", "/documents", body);
      const now = new Date().toISOString(), url = created.url?.he || created.url?.origin || null;
      await sb.from("morning_docs").upsert({id: created.id, number: String(created.number ?? ""), type: body.type, type_name: TYPES[body.type], status: 0, status_name: "פתוח",
        doc_date: body.date, client: body.client.name, description: body.description || null, amount: total, currency: "ILS",
        url, client_email: b.email || null, client_phone: b.phone || null, synced_at: now});
      if (b.project_id) await sb.from("projects").update({quote_doc_id: created.id, updated_at: now}).eq("id", b.project_id);
      return json({ok: true, id: created.id, number: created.number, url, total});
    }

    // receipt (קבלה) for an open invoice / חשבון עסקה, from "חייבים לי": preview, or issue it in Morning (Morning mails it to the client)
    if (action === "receipt_preview" || action === "receipt") {
      const mtok = await morningToken(), id = String(b.id || "");
      const d = await mcall(mtok, "GET", "/documents/" + encodeURIComponent(id));
      const amount = round2(Number(b.amount) || 0);
      if (!(amount > 0)) throw new Error("צריך סכום");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? String(b.date) : new Date().toISOString().slice(0, 10);
      const pt = PAY[Number(b.pay_type)] ? Number(b.pay_type) : 1;
      const c = d.client || {};
      const body: any = {type: 400, date, lang: "he", currency: "ILS", vatType: 0, rounding: false, signed: true, attachment: true,
        description: `תשלום עבור ${TYPES[d.type] || "מסמך"} ${d.number ?? ""}`.trim(),
        client: c.id ? {id: c.id, name: c.name, emails: b.email ? [b.email] : (c.emails || []), add: false} : {name: c.name || b.client, emails: b.email ? [b.email] : [], add: false},
        payment: [{type: pt, date, price: amount, currency: "ILS"}], linkedDocumentIds: [id]};
      if (action === "receipt_preview") {
        const p = await mcall(mtok, "POST", "/documents/preview", body);
        const pdf = p.file || p.pdf || p.data || null;
        if (!pdf) throw new Error("Morning לא החזיר תצוגה מקדימה");
        return json({ok: true, pdf});
      }
      const created = await mcall(mtok, "POST", "/documents", body);
      const now = new Date().toISOString();
      const full = amount + 1 >= Number(b.open_amount || 0);
      if (full) { try { await mcall(mtok, "POST", "/documents/" + encodeURIComponent(id) + "/close"); } catch (_) { /* Morning may close it by itself */ }
        await sb.from("morning_docs").update({status: 1, status_name: "סגור", synced_at: now}).eq("id", id); }
      await sb.from("morning_docs").upsert({id: created.id, number: String(created.number ?? ""), type: 400, type_name: TYPES[400], status: 1, status_name: "סגור",
        doc_date: date, client: c.name || b.client || null, description: body.description, amount, currency: "ILS",
        url: created.url?.he || created.url?.origin || null, client_email: (body.client.emails || [])[0] || null, synced_at: now});
      // a job linked to this invoice is paid now
      await sb.from("jobs").update({paid: full ? "כן" : "חלקי", paid_amount: full ? null : amount, updated_at: now}).eq("morning_doc_id", id);
      const to = (body.client.emails || [])[0];
      return json({ok: true, number: created.number, message: `הופקה קבלה ${created.number ?? ""}${to ? " – Morning שולח אותה ל-" + to : ""}`});
    }

    // next free digital check-report number (the printed pads are 200001–200050)
    if (action === "report_next") {
      const {data} = await sb.from("jobs").select("report_no").not("report_no", "is", null);
      const nums = (data || []).map((r: any) => Number(String(r.report_no).replace(/\D/g, ""))).filter((n: number) => n >= 400001 && n < 500000);
      return json({ok: true, next: String(nums.length ? Math.max(...nums) + 1 : 400001)});
    }
    if (action === "next") {
      const {data} = await sb.from("jobs").select("warranty_no").not("warranty_no", "is", null);
      // digital certificates (sent by mail from the app) have their own series 300001+; printed ones are 100001-100100 and typed in by hand
      const nums = (data || []).map((r: any) => Number(String(r.warranty_no).replace(/\D/g, ""))).filter((n: number) => n >= 300001 && n < 400000);
      return json({ok: true, next: String(nums.length ? Math.max(...nums) + 1 : 300001)});
    }

    const {data: job, error: je} = await sb.from("jobs").select("*").eq("id", b.job_id).single();
    if (je || !job) throw new Error("העבודה לא נמצאה");
    const wNo = String(b.warranty?.no || "").replace(/\D/g, "");
    if (wNo) {
      const {data: dup} = await sb.from("jobs").select("id,client").eq("warranty_no", wNo).neq("id", job.id).limit(1);
      if (dup && dup.length) throw new Error(`תעודה ${wNo} כבר רשומה על ${dup[0].client}`);
    }
    const sig = job.signature_path ? await sb.storage.from("jobfiles").download(job.signature_path).then(async r => r.data ? new Uint8Array(await r.data.arrayBuffer()) : null).catch(() => null) : null;
    // check report for this job: preview, or save (PDF to storage + numbers on the job). Installer signature from settings.
    if (action === "report_preview" || action === "report_save") {
      const rep = b.report || {};
      const rNo = String(rep.no || "").replace(/\D/g, "");
      if (action === "report_save") {
        if (!rNo) throw new Error("חסר מספר דוח");
        const {data: dup} = await sb.from("jobs").select("id,client").eq("report_no", rNo).neq("id", job.id).limit(1);
        if (dup && dup.length) throw new Error(`דוח ${rNo} כבר רשום על ${dup[0].client}`);
      }
      const insPath = await setting("installer_signature");
      const insSig = insPath ? await sb.storage.from("jobfiles").download(insPath).then(async r => r.data ? new Uint8Array(await r.data.arrayBuffer()) : null).catch(() => null) : null;
      const d = {...rep, no: rNo, client: rep.client ?? job.client, address: rep.address ?? (job.address || job.place), phone: rep.phone ?? job.phone,
        date: heDate(rep.date || job.date || ""), next: rep.next ? heDate(rep.next) : ""};
      const pdf = await fillReport(d, rep.client_sig === false ? null : sig, rep.installer_sig === false ? null : insSig);
      if (action === "report_preview") return json({ok: true, pdf: bytesToB64(pdf), installer_sig: !!insSig});
      const path = `${job.id}/report-${rNo}.pdf`;
      const up = await sb.storage.from("jobfiles").upload(path, pdf, {contentType: "application/pdf", upsert: true});
      if (up.error) throw new Error("שמירת הדוח נכשלה: " + up.error.message);
      const {no: _n, ...keep} = rep;
      await sb.from("jobs").update({report_no: rNo, report_path: path, report_data: keep, report_at: new Date().toISOString(), updated_at: new Date().toISOString()}).eq("id", job.id);
      return json({ok: true, path, no: rNo, installer_sig: !!insSig});
    }
    const wData = (docRef: string) => ({no: wNo, client: b.client || job.client, date: heDate(b.warranty?.date || job.date || ""), address: b.address ?? job.address ?? job.place,
      phone: b.phone ?? job.phone, items: b.warranty?.items || [], details: b.warranty?.details ?? job.summary ?? job.work, docRef});

    if (action === "preview") {
      const out: any = {ok: true};
      if (b.with_invoice) {
        const mtok = await morningToken();
        const {body} = docBody(b, await findClient(mtok, b.client || job.client));
        const p = await mcall(mtok, "POST", "/documents/preview", body);
        out.invoice = p.file || p.pdf || p.data || null;
        if (!out.invoice) throw new Error("Morning לא החזיר תצוגה מקדימה");
      }
      if (wNo) out.warranty = bytesToB64(await fillWarranty(wData(b.with_invoice ? (TYPES[Number(b.type)] || "חשבונית") + " (ממתינה למספר)" : ""), sig));
      return json(out);
    }

    if (action === "issue_multi") {
      const ids: string[] = Array.isArray(b.job_ids) ? b.job_ids.map(String) : [];
      if (!ids.length) throw new Error("לא נבחרו עבודות");
      const {data: jobs} = await sb.from("jobs").select("*").in("id", ids);
      if (!jobs || jobs.length !== ids.length) throw new Error("חלק מהעבודות לא נמצאו");
      const linked = jobs.find((x: any) => x.morning_doc_id);
      if (linked) throw new Error(`לעבודה של ${linked.date || ""} כבר מקושרת חשבונית`);
      const to = String(b.email || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error("צריך כתובת מייל תקינה של הלקוח");
      const mailUrl = await setting("mailer_url"), mailSecret = await setting("mailer_secret");
      if (!mailUrl || !mailSecret) throw new Error("שליחת המייל עוד לא מחוברת (סקריפט הג'ימייל)");
      const now = new Date().toISOString();
      const mtok = await morningToken();
      const hasW = !!b.attach_warranties && jobs.some((x: any) => x.warranty_path);
      b.no_morning_mail = hasW;
      const {body, total, type} = docBody(b, await findClient(mtok, b.client || jobs[0].client));
      const created = await mcall(mtok, "POST", "/documents", body);
      const docId = created.id;
      const docName = `${TYPES[type]} ${created.number ?? ""}`.trim();
      for (const x of jobs) await sb.from("jobs").update({morning_doc_id: docId, receipt: docName, client_email: to, bill_later: false, updated_at: now}).eq("id", x.id);
      await sb.from("morning_docs").upsert({id: docId, number: String(created.number ?? ""), type, type_name: TYPES[type], status: type === 320 ? 1 : 0,
        doc_date: body.date, client: body.client.name, description: body.description || null, amount: total, currency: "ILS",
        url: created.url?.he || created.url?.origin || null, client_email: to, client_phone: jobs[0].phone || null, synced_at: now});
      const inv = await docPdf(mtok, docId, created);
      const invPath = `multi/${docId}.pdf`;
      await sb.storage.from("jobfiles").upload(invPath, inv.bytes, {contentType: "application/pdf", upsert: true});
      const files: {path: string; name: string}[] = hasW ? [{path: invPath, name: fname(`${docName} - אהרן מערכות.pdf`)}] : [];
      const wNos: string[] = [];
      if (b.attach_warranties) for (const x of jobs) if (x.warranty_path) { files.push({path: x.warranty_path, name: fname(`תעודת אחריות ${x.warranty_no || ""} - אהרן מערכות.pdf`)}); if (x.warranty_no) wNos.push(String(x.warranty_no)); }
      for (const x of jobs) await sb.from("jobs").update({invoice_path: invPath}).eq("id", x.id);
      if (!files.length) {
        for (const x of jobs) await sb.from("jobs").update({mail_sent_at: new Date().toISOString(), mail_to: to}).eq("id", x.id);
        return json({ok: true, message: `הופקה ${docName} על ${jobs.length} עבודות – Morning שולח אותה ל-${to}`, number: inv.number});
      }
      const att = [];
      for (const f of files) { const {data: u} = await sb.storage.from("jobfiles").createSignedUrl(f.path, 900); att.push({url: u?.signedUrl, name: f.name}); }
      const first = String(b.client || jobs[0].client || "").trim().split(/\s+/)[0] || "";
      const subject = docName + " ותעודות אחריות – אהרן מערכות";
      const mr = await fetch(mailUrl, {method: "POST", headers: {"Content-Type": "application/json"}, redirect: "follow",
        body: JSON.stringify({secret: mailSecret, to, subject, html: mailHtml({first, docName, wNo: wNos.join(", "), summary: String(b.mail_text || "").trim()}), attachments: att})});
      const mt = await mr.text(); let md: any = {}; try { md = JSON.parse(mt); } catch (_) { /* html */ }
      if (!md.ok) throw new Error(`החשבונית הופקה (${docName}) אבל המייל לא נשלח: ` + (md.error || mt.slice(0, 160) || mr.status));
      for (const x of jobs) await sb.from("jobs").update({mail_sent_at: new Date().toISOString(), mail_to: to}).eq("id", x.id);
      return json({ok: true, message: `נשלח ל-${to}: ${docName} על ${jobs.length} עבודות`, number: inv.number});
    }

    if (action === "issue" || action === "send") {
      const to = String(b.email || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error("צריך כתובת מייל תקינה של הלקוח");
      const mailUrl = await setting("mailer_url"), mailSecret = await setting("mailer_secret");
      if ((!mailUrl || !mailSecret) && (action !== "issue" || wNo)) throw new Error("שליחת המייל עוד לא מחוברת (סקריפט הג'ימייל)");
      const now = new Date().toISOString();
      let inv: {bytes: Uint8Array; number: string; type: number; url: string} | null = null, docId = job.morning_doc_id || null;
      if (action === "issue") {
        if (job.morning_doc_id && !b.force) throw new Error("לעבודה הזו כבר מקושרת חשבונית ב-Morning. אפשר לשלוח אותה עם התעודה.");
        const mtok = await morningToken();
        b.no_morning_mail = !!wNo;
        const {body, total, type} = docBody(b, await findClient(mtok, b.client || job.client));
        const created = await mcall(mtok, "POST", "/documents", body);
        docId = created.id;
        // the invoice exists now: save the link first, so a mail failure never leads to issuing twice
        await sb.from("jobs").update({morning_doc_id: docId, receipt: `${TYPES[type]} ${created.number ?? ""}`.trim(), client_email: to,
          price: job.price ?? round2(total / (1 + VAT)), updated_at: now}).eq("id", job.id);
        await sb.from("morning_docs").upsert({id: docId, number: String(created.number ?? ""), type, type_name: TYPES[type], status: type === 320 ? 1 : 0,
          doc_date: body.date, client: body.client.name, description: body.description || body.income[0]?.description || null, amount: total, currency: "ILS",
          url: created.url?.he || created.url?.origin || null, client_email: to, client_phone: b.phone || job.phone || null, synced_at: now});
        inv = await docPdf(mtok, docId!, created);
      } else if (b.with_invoice && docId) {
        inv = await docPdf(await morningToken(), docId);
      }
      const docName = inv ? `${TYPES[inv.type] || "חשבונית"} ${inv.number}`.trim() : "";
      const files: {path: string; name: string}[] = [];
      let invPath: string | null = null;
      if (inv) {
        invPath = `${job.id}/invoice-${inv.number || docId}.pdf`;
        await sb.storage.from("jobfiles").upload(invPath, inv.bytes, {contentType: "application/pdf", upsert: true});
        // a new invoice is mailed to the client by Morning itself (client.emails); Gmail only for resends and the warranty
        // with a warranty: one Gmail mail with both PDFs (Morning was told not to mail); without: Morning mails the invoice
        if (action !== "issue" || wNo) files.push({path: invPath, name: fname(`${docName} - אהרן מערכות.pdf`)});
      }
      let wPath = null;
      if (wNo) {
        const wb = await fillWarranty(wData(docName), sig);
        wPath = `${job.id}/warranty-${wNo}.pdf`;
        const up = await sb.storage.from("jobfiles").upload(wPath, wb, {contentType: "application/pdf", upsert: true});
        if (up.error) throw up.error;
        files.push({path: wPath, name: fname(`תעודת אחריות ${wNo} - אהרן מערכות.pdf`)});
      }
      await sb.from("jobs").update({warranty_no: wNo || job.warranty_no || null, warranty_items: b.warranty?.items || job.warranty_items || [], warranty_path: wPath || job.warranty_path,
        invoice_path: invPath || job.invoice_path, client_email: to, updated_at: now}).eq("id", job.id);
      if (!files.length) {
        if (action === "issue" && inv) { await sb.from("jobs").update({mail_sent_at: new Date().toISOString(), mail_to: to}).eq("id", job.id);
          return json({ok: true, message: `הופקה ${docName} – Morning שולח אותה ל-${to}`, number: inv.number}); }
        throw new Error("אין מה לשלוח");
      }
      const att = [];
      for (const f of files) { const {data: u} = await sb.storage.from("jobfiles").createSignedUrl(f.path, 900); att.push({url: u?.signedUrl, name: f.name}); }
      const first = String(b.client || job.client || "").trim().split(/\s+/)[0] || "";
      const mDoc = files.some(f => f.path.includes("/invoice-")) ? docName : "";
      const subject = [mDoc, wNo ? "תעודת אחריות " + wNo : ""].filter(Boolean).join(" ו") + " – אהרן מערכות";
      const mr = await fetch(mailUrl, {method: "POST", headers: {"Content-Type": "application/json"}, redirect: "follow",
        body: JSON.stringify({secret: mailSecret, to, cc: b.cc || "", subject, html: mailHtml({first, docName: mDoc, wNo, summary: String(b.mail_text ?? job.summary ?? job.work ?? "").trim(), payLink: job.pay_link}), attachments: att})});
      const mt = await mr.text(); let md: any = {}; try { md = JSON.parse(mt); } catch (_) { /* html error page */ }
      if (!md.ok) throw new Error((inv && action === "issue" ? `החשבונית הופקה (${docName}) אבל המייל לא נשלח: ` : "המייל לא נשלח: ") + (md.error || mt.slice(0, 160) || mr.status));
      await sb.from("jobs").update({mail_sent_at: new Date().toISOString(), mail_to: to}).eq("id", job.id);
      return json({ok: true, message: `נשלח ל-${to}: ${subject.replace(" – אהרן מערכות", "")}`, number: inv?.number || null});
    }
    return json({ok: false, message: "פעולה לא מוכרת"}, 400);
  } catch (e) {
    return json({ok: false, message: String((e as Error).message || e)});
  }
});
