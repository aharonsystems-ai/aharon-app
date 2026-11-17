
/* זמני – בדיקה ושליחה של טיוטות הגלישה לילו פרינט. */
function checkAndSendYeloBleed() {
  var d1 = GmailApp.getDraft('r-1980563540843967222'), d2 = GmailApp.getDraft('r3774589977911957572');
  var m1 = d1.getMessage(), m2 = d2.getMessage();
  var F1 = ['A4.pdf', 'A5.pdf', 'round-6cm.pdf', 'ad-15x6.pdf', 'cabinet-15x6.pdf', 'rack-43x4.3.pdf', 'rack-43x8.6.pdf', 'business-card-2-sides.pdf'];
  var att1 = m1.getAttachments(), att2 = m2.getAttachments();
  var n1 = att1.map(function (a) { return a.getName(); }), n2 = att2.map(function (a) { return a.getName(); });
  Logger.log('d1 ' + att1.map(function (a) { return a.getName() + ':' + a.getSize(); }).join(' | '));
  Logger.log('d2 ' + att2.map(function (a) { return a.getName() + ':' + a.getSize(); }).join(' | '));
  var ok1 = n1.length === 8 && F1.every(function (f) { return n1.indexOf(f) >= 0; }) && att1.every(function (a) { return a.getSize() > 500000; });
  var j2 = n2.join(' ');
  var ok2 = n2.length === 3 && j2.indexOf('חלק 1') >= 0 && j2.indexOf('חלק 2') >= 0 && j2.indexOf('דוחות בדיקה') >= 0 && att2.every(function (a) { return a.getSize() > 4000000; });
  var body = m1.getBody(), idOk = body.indexOf('ע.מ: ____') < 0 && /ע\.מ:\s*\d{9}/.test(m1.getPlainBody());
  Logger.log('ok1=' + ok1 + ' ok2=' + ok2 + ' idOk=' + idOk);
  if (!ok1 || !ok2 || !idOk) { Logger.log('NOT SENT'); return; }
  var add = 'ואשמח לאישור שהסכום הכולל נשאר 1,787.50 ₪ + מע"מ (2,109.25 ₪ כולל מע"מ).';
  var q = 'המחיר כולל למינציה?';
  if (body.indexOf(add) < 0 && body.indexOf(q) >= 0) {
    body = body.replace(q, q + '<br>' + add);
    var plain = m1.getPlainBody().replace(q, q + '\n' + add);
    d1.update(m1.getTo(), m1.getSubject(), plain, {htmlBody: body, attachments: att1});
    d1 = GmailApp.getDraft('r-1980563540843967222');
    var c = d1.getMessage().getAttachments();
    if (c.length !== 8 || d1.getMessage().getBody().indexOf(add) < 0) { Logger.log('NOT SENT after edit: ' + c.length); return; }
  }
  d1.send(); Utilities.sleep(3000); d2.send();
  Logger.log('SENT both');
}
