// items: Morning item list <-> stock, and barcode lookup. Only the owner (logged in) may call it.
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.greeninvoice.co.il/api/v1";
const OWNER = "aharonsystems@gmail.com";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), {status: s, headers: {...cors, "Content-Type": "application/json"}});

async function token(): Promise<string> {
  const id = Deno.env.get("MORNING_ID"), secret = Deno.env.get("MORNING_SECRET");
  if (!id || !secret) throw new Error("חסר מפתח Morning");
  let r = await fetch("https://api.morning.co/idp/v1/oauth/token", {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({grant_type:"client_credentials", client_id:id, client_secret:secret})});
  if (r.ok) { const d = await r.json(); if (d.accessToken) return d.accessToken; }
  r = await fetch(API + "/account/token", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({id, secret})});
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error("Morning דחה את המפתח");
  return d.token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: cors});
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) { try { key = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string; } catch (_) { /* none */ } }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
  // owner check
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(jwt);
  if (!u?.user || u.user.email !== OWNER) return json({ok: false, message: "אין הרשאה"}, 401);

  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "barcode") {
      const code = String(body.code || "").replace(/\D/g, "");
      if (!code) return json({ok: false, message: "ברקוד ריק"});
      const r = await fetch("https://api.upcitemdb.com/prod/trial/lookup?upc=" + code, {headers: {Accept: "application/json"}});
      if (!r.ok) return json({ok: true, found: false, message: "המאגר הציבורי לא זמין כרגע (" + r.status + ")"});
      const d = await r.json();
      const it = d.items && d.items[0];
      if (!it) return json({ok: true, found: false});
      return json({ok: true, found: true, item: {name: it.title || "", brand: it.brand || "", model: it.model || "", description: (it.description || "").slice(0, 300), category: it.category || ""}});
    }

    const tok = await token();
    const H = {"Content-Type": "application/json", Authorization: "Bearer " + tok};

    if (body.action === "pull") {
      const items: any[] = [];
      for (let page = 1; page < 50; page++) {
        const r = await fetch(API + "/items/search", {method: "POST", headers: H, body: JSON.stringify({page, pageSize: 100})});
        if (!r.ok) throw new Error("items/search " + r.status);
        const d = await r.json(); const list = d.items || [];
        items.push(...list);
        if (!list.length || page >= (d.pages || 1)) break;
      }
      // Morning often keeps a catalog number in "name" and the real Hebrew text in "description":
      // the app shows the Hebrew text as the name and keeps the number as sku (מק"ט)
      const isCode = (n: string) => /^[0-9A-Za-z./ -]{1,14}$/.test(String(n || "").trim());
      const heb = (t: string) => /[\u0590-\u05FF]/.test(String(t || ""));
      const view = (it: any) => {
        const desc = String(it.description || "").replace(/\s+/g, " ").trim();
        return isCode(it.name) && heb(desc) ? {name: desc, sku: String(it.name).trim(), notes: null} : {name: it.name, sku: null, notes: it.description || null};
      };
      const { data: existing } = await sb.from("stock").select("id,morning_item_id,name,sku");
      const byMorning = new Map((existing || []).filter((s: any) => s.morning_item_id).map((s: any) => [s.morning_item_id, s]));
      const byName = new Map((existing || []).filter((s: any) => !s.morning_item_id).map((s: any) => [String(s.name).trim(), s]));
      let added = 0, linked = 0, updated = 0;
      for (const it of items) {
        const hit: any = byMorning.get(it.id);
        const v = view(it);
        if (hit) { await sb.from("stock").update({name: v.name, sku: v.sku ?? hit.sku ?? null, sell_price: it.price ?? null}).eq("id", hit.id); updated++; continue; }
        const same: any = byName.get(String(v.name).trim()) || byName.get(String(it.name).trim());
        if (same) { await sb.from("stock").update({morning_item_id: it.id, sell_price: it.price ?? null}).eq("id", same.id); linked++; continue; }
        await sb.from("stock").insert({name: v.name, sku: v.sku, notes: v.notes, sell_price: it.price ?? null, morning_item_id: it.id, qty: 0, min_qty: 0, category: "מ-Morning"});
        added++;
      }
      return json({ok: true, message: `${items.length} פריטים ב-Morning · ${added} חדשים · ${linked} קושרו · ${updated} עודכנו`});
    }

    if (body.action === "docitems") {
      // line items of the documents this business issued (invoices / receipts-invoices / quotes), grouped per product
      const { data: docs } = await sb.from("morning_docs").select("id,type,number,doc_date,client").in("type", [10, 300, 305, 320]);
      const agg: Record<string, any> = {};
      let n = 0, failed = 0;
      for (const d of docs || []) {
        const r = await fetch(API + "/documents/" + d.id, {headers: H});
        if (!r.ok) { failed++; continue; }
        const doc = await r.json(); n++;
        for (const it of doc.income || []) {
          const desc = String(it.description || "").replace(/\s+/g, " ").trim();
          const key = it.itemId || it.catalogNum || desc;
          if (!key) continue;
          const a = agg[key] ||= {itemId: it.itemId || null, catalogNum: it.catalogNum || null, description: desc, count: 0, qty: 0, prices: [], docs: []};
          a.count++; a.qty += Number(it.quantity || 0); a.prices.push(Number(it.price || 0));
          if (a.docs.length < 4) a.docs.push(`${d.type === 10 ? "הצעה" : "חשבונית"} ${d.number}`);
        }
      }
      return json({ok: true, docs: n, failed, items: Object.values(agg)});
    }

    if (body.action === "push") {
      const { data: s } = await sb.from("stock").select("*").eq("id", body.id).single();
      if (!s) return json({ok: false, message: "הפריט לא נמצא"});
      if (s.morning_item_id) return json({ok: true, message: "כבר קיים ב-Morning"});
      // short catalog name in Morning (sku or model), full Hebrew name as the description
      const short = String(s.sku || s.model || s.name).slice(0, 32);
      const payload = {name: short, description: [s.name, s.notes].filter(Boolean).join(" · ").slice(0, 500),
        price: Number(s.sell_price || 0), currency: "ILS"};
      const r = await fetch(API + "/items", {method: "POST", headers: H, body: JSON.stringify(payload)});
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) throw new Error("Morning לא קיבל את הפריט (" + r.status + ")");
      await sb.from("stock").update({morning_item_id: d.id, sku: s.sku || short}).eq("id", s.id);
      return json({ok: true, message: "נוסף לרשימת הפריטים ב-Morning"});
    }
    return json({ok: false, message: "פעולה לא מוכרת"}, 400);
  } catch (e) {
    return json({ok: false, message: String((e as Error).message || e)}, 500);
  }
});
