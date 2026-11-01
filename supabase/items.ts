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
      const { data: existing } = await sb.from("stock").select("id,morning_item_id,name");
      const byMorning = new Map((existing || []).filter((s: any) => s.morning_item_id).map((s: any) => [s.morning_item_id, s]));
      const byName = new Map((existing || []).filter((s: any) => !s.morning_item_id).map((s: any) => [String(s.name).trim(), s]));
      let added = 0, linked = 0, updated = 0;
      for (const it of items) {
        const hit: any = byMorning.get(it.id);
        if (hit) { await sb.from("stock").update({name: it.name, sell_price: it.price ?? null}).eq("id", hit.id); updated++; continue; }
        const same: any = byName.get(String(it.name).trim());
        if (same) { await sb.from("stock").update({morning_item_id: it.id, sell_price: it.price ?? null}).eq("id", same.id); linked++; continue; }
        await sb.from("stock").insert({name: it.name, notes: it.description || null, sell_price: it.price ?? null, morning_item_id: it.id, qty: 0, min_qty: 0, category: "מ-Morning"});
        added++;
      }
      return json({ok: true, message: `${items.length} פריטים ב-Morning · ${added} חדשים · ${linked} קושרו · ${updated} עודכנו`});
    }

    if (body.action === "push") {
      const { data: s } = await sb.from("stock").select("*").eq("id", body.id).single();
      if (!s) return json({ok: false, message: "הפריט לא נמצא"});
      if (s.morning_item_id) return json({ok: true, message: "כבר קיים ב-Morning"});
      const payload = {name: String(s.name).slice(0, 32), description: [s.brand, s.notes].filter(Boolean).join(" · ").slice(0, 500) || String(s.name),
        price: Number(s.sell_price || 0), currency: "ILS"};
      const r = await fetch(API + "/items", {method: "POST", headers: H, body: JSON.stringify(payload)});
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) throw new Error("Morning לא קיבל את הפריט (" + r.status + ")");
      await sb.from("stock").update({morning_item_id: d.id}).eq("id", s.id);
      return json({ok: true, message: "נוסף לרשימת הפריטים ב-Morning"});
    }
    return json({ok: false, message: "פעולה לא מוכרת"}, 400);
  } catch (e) {
    return json({ok: false, message: String((e as Error).message || e)}, 500);
  }
});
