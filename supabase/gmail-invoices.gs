/* ===== חשבוניות מהג'ימייל → אפליקציית הניהול =====
 * כל שעה: מחפש מיילים עם חשבונית/קבלה מצורפת ושולח את הקבצים לאפליקציה (פונקציית invoices ב-Supabase).
 * האפליקציה קוראת כל מסמך (ספק, מספר, תאריך, סכום, מע"מ) ומסמנת אותו "לבדיקה".
 * מסמכים שאהרן מערכות עצמה הוציאה (Morning ללקוחות) לא נכנסים כהוצאה.
 * באותו טריגר: אם לחצת באפליקציה "שליחה לרו"ח" – הסקריפט שולח מהג'ימייל שלך את כל החשבוניות המאושרות של החודש.
 * אין כאן מפתח או סיסמה: האפליקציה מזהה את חשבון Google של אהרן לפי ההרשאה של הסקריפט.
 * הפעלה: להריץ פעם אחת את enableInvoices (ולאשר הרשאות). קליטה של מיילים ישנים: backfillInvoices.
 */
var INV_FN = 'https://pipynokkdtvkkzcgatlq.supabase.co/functions/v1/invoices';
var INV_WORDS = '{חשבונית קבלה "חשבון עסקה" זיכוי invoice receipt}';
var INV_SKIP_SUBJECT = /(-|–)\s*אהרן מערכות\s*$|דוח הכנסות|הצעת מחיר/;
var INV_MAX_MB = 15;

function enableInvoices() {
  Session.getActiveUser().getEmail();
  disableInvoices();
  ScriptApp.newTrigger('invoicesHourly').timeBased().everyHours(1).create();
  invoicesHourly();
}
function disableInvoices() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() == 'invoicesHourly') ScriptApp.deleteTrigger(t); });
}
function invoicesHourly() {
  scanInvoices_('newer_than:3d', 40);
  sendToAccountant_();
}
/** קליטה חד-פעמית של חשבוניות ישנות (מ-1.10.2026). אפשר להריץ שוב – מה שכבר נקלט לא נכפל. */
function backfillInvoices() { scanInvoices_('after:2026/10/01', 400); }

function invCall_(payload) {
  var res = UrlFetchApp.fetch(INV_FN, {method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
  var d = {}; try { d = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() != 200) throw new Error('invoices ' + res.getResponseCode() + ': ' + (d.message || res.getContentText().slice(0, 200)));
  return d;
}

function scanInvoices_(when, maxThreads) {
  var started = Date.now();
  var q = 'has:attachment ' + when + ' ' + INV_WORDS + ' -in:sent -in:chats -in:spam -in:trash';
  var threads = GmailApp.search(q, 0, maxThreads);
  var cand = [];
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (m.isInTrash() || m.isDraft()) return;
      var from = m.getFrom();
      if (/aharonsystems@gmail\.com/i.test(from)) return;
      if (INV_SKIP_SUBJECT.test(m.getSubject() || '')) return;
      m.getAttachments({includeInlineImages: false}).forEach(function (a, i) {
        var type = a.getContentType() || '', name = a.getName() || '';
        var okType = /pdf/i.test(type) || /\.pdf$/i.test(name) || (/^image\/(jpe?g|png)/i.test(type) && a.getSize() > 30000);
        if (!okType || a.getSize() > INV_MAX_MB * 1048576) return;
        cand.push({m: m, a: a, id: m.getId() + ':' + i});
      });
    });
  });
  if (!cand.length) { Logger.log('אין חשבוניות חדשות'); return; }
  var known = {};
  for (var k = 0; k < cand.length; k += 400) {
    invCall_({action: 'known', ids: cand.slice(k, k + 400).map(function (c) { return c.id; })}).known.forEach(function (id) { known[id] = 1; });
  }
  var done = 0, skipped = 0;
  for (var j = 0; j < cand.length; j++) {
    var c = cand[j];
    if (known[c.id]) continue;
    if (Date.now() - started > 4.5 * 60 * 1000) { Logger.log('נעצר כדי לא לחרוג מהזמן – ימשיך בריצה הבאה'); break; }
    var f = c.m.getFrom(), mail = (f.match(/<([^>]+)>/) || [, f])[1], nm = f.replace(/\s*<[^>]+>\s*/, '').replace(/^"|"$/g, '');
    var type = c.a.getContentType() || 'application/pdf';
    if (/octet-stream/i.test(type) && /\.pdf$/i.test(c.a.getName())) type = 'application/pdf';
    var r = invCall_({action: 'ingest', msg_id: c.id, received_at: c.m.getDate().toISOString(), from_email: mail, from_name: nm,
      subject: c.m.getSubject(), file_name: c.a.getName(), mime: type, data: Utilities.base64Encode(c.a.getBytes())});
    if (r.kind && r.kind != 'expense') skipped++; else done++;
  }
  Logger.log(done + ' חשבוניות נקלטו · ' + skipped + ' לא הוצאה');
}

function sendToAccountant_() {
  var d = invCall_({action: 'outbox'});
  (d.sends || []).forEach(function (s) {
    try {
      if (!s.items.length) throw new Error('אין חשבוניות מאושרות בחודש הזה');
      var files = s.items.map(function (it) { return UrlFetchApp.fetch(it.url).getBlob().setName(it.name); });
      var total = 0, vat = 0;
      var rows = s.items.map(function (it, i) {
        total += Number(it.amount || 0); vat += Number(it.vat || 0);
        return '<tr><td>' + (i + 1) + '</td><td>' + esc_(it.date || '') + '</td><td>' + esc_(it.supplier || '') + '</td><td>' + esc_(it.doc_type || '') + ' ' + esc_(it.number || '') +
          '</td><td style="text-align:left">' + money_(it.amount) + '</td><td style="text-align:left">' + money_(it.vat) + '</td></tr>';
      }).join('');
      var title = 'חשבוניות הוצאה – אהרן מערכות – ' + heMonth_(s.month);
      var html = '<div dir="rtl" style="font-family:Arial,sans-serif">שלום,<br>מצורפות החשבוניות של ' + heMonth_(s.month) + ' (' + s.items.length + ' מסמכים).<br><br>' +
        '<table border="1" cellpadding="5" style="border-collapse:collapse;font-size:13px"><tr style="background:#eef2f8"><th>#</th><th>תאריך</th><th>ספק</th><th>מסמך</th><th>סכום</th><th>מע"מ</th></tr>' +
        rows + '<tr style="font-weight:bold"><td colspan="4">סה"כ</td><td style="text-align:left">' + money_(total) + '</td><td style="text-align:left">' + money_(vat) + '</td></tr></table>' +
        '<br>תודה,<br>אהרן מערכות<br>055-975-9822</div>';
      // Gmail limit is 25MB per mail: split into parts of up to ~18MB
      var parts = [[]], size = 0;
      files.forEach(function (b) { var n = b.getBytes().length; if (size + n > 18 * 1048576 && parts[parts.length - 1].length) { parts.push([]); size = 0; } parts[parts.length - 1].push(b); size += n; });
      parts.forEach(function (p, i) {
        var subj = title + (parts.length > 1 ? ' (חלק ' + (i + 1) + ' מתוך ' + parts.length + ')' : '');
        GmailApp.sendEmail(s.to, subj, 'מצורפות החשבוניות של ' + heMonth_(s.month), {htmlBody: i == 0 ? html : '<div dir="rtl">המשך החשבוניות של ' + heMonth_(s.month) + '</div>', attachments: p, name: 'אהרן מערכות'});
      });
      invCall_({action: 'sent', id: s.id, ok: true, count: s.items.length, total: total, ids: s.items.map(function (it) { return it.id; })});
      Logger.log('נשלח לרו"ח: ' + s.month + ' · ' + s.items.length + ' חשבוניות');
    } catch (e) {
      invCall_({action: 'sent', id: s.id, ok: false, error: String(e.message || e)});
    }
  });
}
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
function money_(n) { return n === null || n === undefined || n === '' ? '' : '₪' + Number(n).toLocaleString('he-IL', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
function heMonth_(ym) { var M = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']; var p = String(ym).split('-'); return (M[Number(p[1]) - 1] || '') + ' ' + p[0]; }
