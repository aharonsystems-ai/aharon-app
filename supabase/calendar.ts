// calendar: dated tasks, jobs and projects as a list of calendar events, for the Google Apps Script
// that copies them into the owner's Google Calendar. Caller proves it is the owner with a Google
// OAuth access token (ScriptApp.getOAuthToken()) whose email is the owner's. Read-only.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER = "aharonsystems@gmail.com";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), {status: s, headers: {...cors, "Content-Type": "application/json"}});
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const okTime = (t: unknown) => /^\d{1,2}:\d{2}$/.test(String(t || "")) ? String(t).padStart(5, "0") : null;
const ils = (n: unknown) => n ? "₪" + Math.round(Number(n)).toLocaleString("he-IL") : "";
const lines = (...a: unknown[]) => a.filter((x) => x !== null && x !== undefined && String(x).trim() !== "").join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers: cors});
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return json({ok: false, message: "אין הרשאה"}, 401);
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(tok));
  const info = await r.json().catch(() => ({}));
  if (!r.ok || info.email !== OWNER || String(info.email_verified) !== "true") return json({ok: false, message: "אין הרשאה"}, 401);

  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!key) { try { key = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0] as string; } catch (_) { /* none */ } }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);

  // one-off import of recorder logins from the Google Sheet "לקוחות" (sent by the sheet's Apps Script).
  // Matches each sheet row to exactly one job (client + date, or client alone when unique). Never overwrites a value.
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body.action === "nvr") {
      const norm = (v: unknown) => String(v ?? "").replace(/[\s\u200f\u200e]+/g, " ").trim();
      const toIso = (v: string) => { const m = norm(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
      const { data: jobs, error } = await sb.from("jobs").select("id,client,place,date,nvr_user,nvr_pass,nvr_code,nvr_ip,nvr_qr");
      if (error) return json({ok: false, message: error.message}, 500);
      const F: Record<string, string> = {user: "nvr_user", pass: "nvr_pass", code: "nvr_code", ip: "nvr_ip", qr: "nvr_qr"};
      const report: unknown[] = [];
      for (const row of body.rows || []) {
        const c = norm(row.client), d = toIso(row.date);
        let cand = (jobs || []).filter((j: any) => norm(j.client) === c && (d ? j.date === d : true));
        if (!d && cand.length > 1) cand = cand.filter((j: any) => !j.date);
        if (cand.length > 1 && row.place) cand = cand.filter((j: any) => norm(j.place).includes(norm(row.place)));
        if (cand.length !== 1) { report.push({row: row.row, client: c, date: d, result: cand.length ? "יותר מעבודה אחת" : "לא נמצאה עבודה"}); continue; }
        const j: any = cand[0], patch: Record<string, string> = {}, conflict: string[] = [];
        for (const [k, col] of Object.entries(F)) {
          const v = String(row[k] ?? "").trim(); if (!v) continue; // values exactly as typed in the sheet
          if (!j[col]) patch[col] = v; else if (String(j[col]).trim() !== v) conflict.push(col);
        }
        if (!body.dry && Object.keys(patch).length) {
          const { error: e2 } = await sb.from("jobs").update({...patch, updated_at: new Date().toISOString()}).eq("id", j.id);
          if (e2) { report.push({row: row.row, client: c, date: d, result: "שגיאה: " + e2.message}); continue; }
        }
        report.push({row: row.row, client: c, date: d, job: j.id, place: j.place, fields: Object.keys(patch), conflict});
      }
      return json({ok: true, dry: !!body.dry, report});
    }

    // money sheets (sent by the Apps Script): debts + "owed to me" from the עו"ש file, fixed monthly expenses,
    // and project cost items. The sheet is the source: rows are matched by sheet_key, amounts updated,
    // rows gone from the sheet removed. Status and notes typed in the app are kept.
    if (body.action === "money") {
      const now = new Date().toISOString(), out: Record<string, unknown> = {};
      const mirror = async (table: string, prefix: string, want: Record<string, unknown>[], keep: string[]) => {
        const { data: have, error } = await sb.from(table).select("id,sheet_key," + keep.join(",")).like("sheet_key", prefix + "%");
        if (error) throw new Error(table + ": " + error.message);
        const byKey = new Map((have || []).map((r: any) => [r.sheet_key, r]));
        let added = 0, changed = 0, removed = 0;
        const ins: Record<string, unknown>[] = [];
        for (const w of want) {
          const h: any = byKey.get(w.sheet_key as string); byKey.delete(w.sheet_key as string);
          if (!h) { ins.push({...w, created_at: now, updated_at: now}); added++; continue; }
          const diff = Object.keys(w).some((k) => String(w[k] ?? "") !== String(h[k] ?? ""));
          if (diff) { const { error: e } = await sb.from(table).update({...w, updated_at: now}).eq("id", h.id); if (e) throw new Error(table + ": " + e.message); changed++; }
        }
        if (ins.length) { const { error: e } = await sb.from(table).insert(ins); if (e) throw new Error(table + ": " + e.message); }
        const gone = [...byKey.values()].map((r: any) => r.id);
        if (gone.length) { const { error: e } = await sb.from(table).delete().in("id", gone); if (e) throw new Error(table + ": " + e.message); removed = gone.length; }
        return {count: want.length, added, changed, removed};
      };
      const TAXCAT: Record<string, string> = {"מס הכנסה": "מס הכנסה", "ביטוח לאומי": "ביטוח לאומי", "ביטוח לואמי": "ביטוח לאומי"};
      const catOf = (n: string) => /מע.?מ/.test(n) ? 'מע"מ' : TAXCAT[n] || Object.entries(TAXCAT).find(([k]) => n.includes(k))?.[1] || null;
      try {
        if (Array.isArray(body.debts)) out.debts = await mirror("debts", "debt:", body.debts.map((d: any) => ({sheet_key: d.key, name: d.name, amount: d.amount, dir: "אני חייב",
          cat: catOf(d.name) || (/אשראי|פפר|הלוואה/.test(d.name) ? "אשראי/הלוואה" : "אחר"), source: 'גיליון עו"ש · חובות'})), ["name", "amount", "dir", "cat", "source"]);
        if (Array.isArray(body.owed)) out.owed = await mirror("debts", "owed:", body.owed.map((d: any) => ({sheet_key: d.key, name: d.name, amount: d.amount, orig: d.orig, dir: "חייבים לי",
          cat: "חייבים לי", source: 'גיליון עו"ש · נכסים'})), ["name", "amount", "orig", "dir", "cat", "source"]);
        if (Array.isArray(body.fixed)) out.fixed = await mirror("expenses", "fixed:", body.fixed.map((x: any) => ({sheet_key: x.key, vendor: x.name, date: x.date, amount: x.amount, kind: "קבועה",
          cat: catOf(x.name) || "קבועה", source: 'גיליון עו"ש · הוצאות 2026'})), ["vendor", "date", "amount", "kind", "cat", "source"]);
        if (Array.isArray(body.costs)) out.costs = await mirror("expenses", "cost:", body.costs.map((x: any) => ({sheet_key: x.key, vendor: x.item, for_job: x.project, amount: x.amount,
          qty: x.qty, unit_price: x.unit, kind: "פרויקט", cat: "עלות פרויקט", notes: [x.note, x.check ? "⚠ " + x.check : ""].filter(Boolean).join(" · ") || null,
          source: "גיליון אהרן מערכות 2026 · עלויות פרויקטים"})), ["vendor", "for_job", "amount", "qty", "unit_price", "kind", "cat", "notes", "source"]);
      } catch (e) { return json({ok: false, message: String((e as Error).message || e), done: out}, 500); }
      return json({ok: true, ...out});
    }
  }

  const now = Date.now();
  const from = ymd(new Date(now - 60 * 864e5)), to = ymd(new Date(now + 365 * 864e5));
  const [t, j, p] = await Promise.all([
    sb.from("tasks").select("id,title,client,date,time,done,notes").gte("date", from).lte("date", to),
    sb.from("jobs").select("id,client,phone,place,address,work,date,time,price").gte("date", from).lte("date", to),
    sb.from("projects").select("id,name,client,address,date,time,status,notes").gte("date", from).lte("date", to),
  ]);
  const err = t.error || j.error || p.error;
  if (err) return json({ok: false, message: err.message}, 500);

  const events: Record<string, unknown>[] = [];
  for (const x of t.data || []) {
    if (x.done === "בוצע") continue;
    events.push({id: "task:" + x.id, title: "📋 " + x.title + (x.client ? " – " + x.client : ""), date: x.date, time: okTime(x.time), hours: 1,
      description: lines(x.notes, "משימה מאפליקציית אהרן מערכות")});
  }
  for (const x of j.data || []) {
    events.push({id: "job:" + x.id, title: "🛠️ " + (x.client || "עבודה") + (x.place ? " – " + x.place : ""), date: x.date, time: okTime(x.time), hours: 2,
      location: x.address || "", description: lines(x.work, x.phone ? "טלפון: " + x.phone : "", x.price ? "מחיר: " + ils(x.price) : "", "עבודה מאפליקציית אהרן מערכות")});
  }
  for (const x of p.data || []) {
    events.push({id: "project:" + x.id, title: "📐 " + x.name + (x.client && x.client !== x.name ? " – " + x.client : ""), date: x.date, time: okTime(x.time), hours: 2,
      location: x.address || "", description: lines(x.status ? "סטטוס: " + x.status : "", x.notes, "פרויקט מאפליקציית אהרן מערכות")});
  }
  return json({ok: true, from, to, events});
});
