/* ===== שליחת חשבונית + תעודת אחריות ללקוח מהג'ימייל =====
 * האפליקציה מפיקה את החשבונית ב-Morning וממלאת את תעודת האחריות, ואז מבקשת מהסקריפט הזה
 * לשלוח מייל אחד מהג'ימייל של אהרן מערכות עם שני הקבצים מצורפים.
 * הפעלה (פעם אחת): Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * אחר כך להריץ את enableMailer (שומר סוד אקראי ומחבר את הכתובת לאפליקציה).
 */
var MAIL_FN = 'https://pipynokkdtvkkzcgatlq.supabase.co/functions/v1/issue';

function enableMailer() {
  var url = ScriptApp.getService().getUrl();
  if (!url) throw new Error('קודם צריך לפרסם את הסקריפט כ-Web app (Deploy → New deployment)');
  var secret = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('MAILER_SECRET', secret);
  var res = UrlFetchApp.fetch(MAIL_FN, {method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, payload: JSON.stringify({action: 'mailer', url: url, secret: secret})});
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() != 200) throw new Error('החיבור לאפליקציה נכשל');
  GmailApp.getAliases(); // asks for the Gmail permission now, not on the first send
}

function doPost(e) {
  var out = {ok: false};
  try {
    var b = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('MAILER_SECRET');
    if (!secret || b.secret !== secret) throw new Error('אין הרשאה');
    if (!b.to) throw new Error('חסר נמען');
    var files = (b.attachments || []).map(function (a) {
      var r = UrlFetchApp.fetch(a.url, {muteHttpExceptions: true});
      if (r.getResponseCode() != 200) throw new Error('קובץ לא ירד: ' + a.name);
      return r.getBlob().setName(a.name).setContentType('application/pdf');
    });
    var opts = {htmlBody: b.html, attachments: files, name: 'אהרן מערכות'};
    if (b.cc) opts.cc = b.cc;
    GmailApp.sendEmail(b.to, b.subject, String(b.html || '').replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''), opts);
    out = {ok: true};
  } catch (err) {
    out = {ok: false, error: String(err.message || err)};
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
