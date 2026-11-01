// morning-sync: pulls clients' documents and expenses from Morning into Supabase. Read-only on Morning.
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.greeninvoice.co.il/api/v1";
const TYPES: Record<number, string> = {10:"הצעת מחיר",100:"הזמנה",200:"תעודת משלוח",300:"חשבון עסקה",305:"חשבונית מס",320:"חשבונית מס/קבלה",330:"חשבונית זיכוי",400:"קבלה",405:"קבלה על תרומה",500:"הזמנת רכש"};
const STATUS: Record<number, string> = {0:"פתוח",1:"סגור",2:"נסגר ידנית",3:"מבטל",4:"בוטל"};
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};

async function token(): Promise<string> {
  const id = Deno.env.get("MORNING_ID"), secret = Deno.env.get("MORNING_SECRET");
  if (!id || !secret) throw new Error("חסר מפתח Morning בהגדרות");
  let r = await fetch("https://api.morning.co/idp/v1/oauth/token", {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({grant_type:"client_credentials", client_id:id, client_secret:secret})});
  if (r.ok) { const d = await r.json(); if (d.accessToken) return d.accessToken; }
  r = await fetch(API + "/account/token", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({id, secret})});
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error("Morning דחה את המפתח (" + r.status + ")");
  return d.token;
}

async function all(tok: string, path: string, body: Record<string, unknown>) {
  const out: any[] = [];
  for (let page = 1; page < 100; page++) {
    const r = await fetch(API + path, {method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer " + tok},
      body: JSON.stringify({...body, page, pageSize: 100})});
    if (!r.ok) throw new Error(path + " " + r.status);
    const d = await r.json(); const items = d.items || [];
    out.push(...items);
    if (!items.length || page >= (d.pages || 1)) break;
  }
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: cors});
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) { try { key = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string; } catch (_) { /* none */ } }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
  // throttle: anyone may trigger a sync, but at most once every 5 minutes
  const { data: last } = await sb.from("sync_log").select("at").eq("ok", true).order("at", {ascending: false}).limit(1);
  if (last && last[0] && Date.now() - new Date(last[0].at).getTime() < 5 * 60 * 1000) {
    return new Response(JSON.stringify({ok: true, message: "סונכרן לפני פחות מ-5 דקות"}), {headers: {...cors, "Content-Type": "application/json"}});
  }
  try {
    const tok = await token();
    const now = new Date(), from = new Date(now.getFullYear() - 2, 0, 1);
    const docs = await all(tok, "/documents/search", {fromDate: ymd(from), toDate: ymd(now)});
    // client phones/emails live on the client card, not always on the document
    const cl: Record<string, any> = {};
    try {
      const clients = await all(tok, "/clients/search", {});
      for (const c of clients) { if (c.id) cl[c.id] = c; if (c.name) cl["n:" + String(c.name).trim()] = c; }
    } catch (_) { /* optional */ }
    const cc = (d: any) => cl[d.client?.id] || cl["n:" + String(d.client?.name || "").trim()] || {};
    const phoneOf = (d: any) => { const c = cc(d); return d.client?.mobile || d.client?.phone || c.mobile || c.phone || null; };
    const mailOf = (d: any) => { const c = cc(d); return (d.client?.emails || [])[0] || d.client?.email || (c.emails || [])[0] || c.email || null; };
    const rows = docs.map((d: any) => ({
      id: d.id, number: String(d.number ?? ""), type: d.type, type_name: TYPES[d.type] ?? String(d.type),
      status: d.status, status_name: STATUS[d.status] ?? String(d.status), doc_date: d.documentDate || null,
      client: d.client?.name ?? null, description: d.description ?? null, amount: d.amount ?? null,
      client_phone: phoneOf(d), client_email: mailOf(d),
      currency: d.currency ?? "ILS", url: d.url?.he ?? d.url?.origin ?? null, synced_at: now.toISOString()}));
    if (rows.length) { const { error } = await sb.from("morning_docs").upsert(rows); if (error) throw error; }
    let exCount = 0;
    try {
      const ex = await all(tok, "/expenses/search", {fromDate: ymd(from).slice(0, 8) + "01", toDate: ymd(now).slice(0, 8) + "01"});
      const er = ex.map((x: any) => ({id: x.id, date: x.date || x.documentDate || null, supplier: x.supplier?.name ?? null,
        number: x.number ? String(x.number) : null, description: x.description ?? null, amount: x.amount ?? null, vat: x.vat ?? null,
        synced_at: now.toISOString()}));
      if (er.length) { const { error } = await sb.from("morning_expenses").upsert(er); if (error) throw error; }
      exCount = er.length;
    } catch (_) { /* expenses are optional */ }
    const msg = `${rows.length} מסמכים, ${exCount} הוצאות`;
    await sb.from("sync_log").insert({ok: true, message: msg});
    return new Response(JSON.stringify({ok: true, message: msg}), {headers: {...cors, "Content-Type": "application/json"}});
  } catch (e) {
    const msg = String((e as Error).message || e);
    await sb.from("sync_log").insert({ok: false, message: msg});
    return new Response(JSON.stringify({ok: false, message: msg}), {status: 500, headers: {...cors, "Content-Type": "application/json"}});
  }
});
