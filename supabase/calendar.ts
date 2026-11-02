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
