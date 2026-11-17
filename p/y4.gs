
/* זמני – השלמת קבצים בטיוטה 1, בדיקה ושליחה לילו פרינט. */
function fixAndSendYelo() {
  var B = 'https://raw.githubusercontent.com/aharonsystems-ai/aharon-app/print-files-tmp/p/';
  var F1 = ['A4.pdf', 'A5.pdf', 'round-6cm.pdf', 'ad-15x6.pdf', 'cabinet-15x6.pdf', 'rack-43x4.3.pdf', 'rack-43x8.6.pdf', 'business-card-2-sides.pdf'];
  var d1 = GmailApp.getDraft('r-6411468770349122090'), d2 = GmailApp.getDraft('r-6799910251240580662');
  var names = function (d) { return d.getMessage().getAttachments().map(function (a) { return a.getName() + ':' + a.getSize(); }); };
  Logger.log('before1 ' + names(d1).join(' | '));
  Logger.log('before2 ' + names(d2).join(' | '));
  var m1 = d1.getMessage();
  var a1 = F1.map(function (f) { return UrlFetchApp.fetch(B + f + '?v=' + Date.now()).getBlob().setName(f).setContentType('application/pdf'); });
  d1.update(m1.getTo(), m1.getSubject(), m1.getPlainBody(), {htmlBody: m1.getBody(), attachments: a1});
  d1 = GmailApp.getDraft('r-6411468770349122090');
  var n1 = d1.getMessage().getAttachments().map(function (a) { return a.getName(); });
  var n2 = d2.getMessage().getAttachments().map(function (a) { return a.getName(); });
  Logger.log('after1 ' + n1.join(' | '));
  var ok1 = F1.every(function (f) { return n1.indexOf(f) >= 0; }) && n1.length === 8;
  var ok2 = n2.length === 3 && n2.join(' ').indexOf('חלק 1') >= 0 && n2.join(' ').indexOf('חלק 2') >= 0 && n2.join(' ').indexOf('דוחות בדיקה') >= 0;
  if (!ok1 || !ok2) { Logger.log('NOT SENT: ok1=' + ok1 + ' ok2=' + ok2); return; }
  d1.send(); Utilities.sleep(3000); d2.send();
  Logger.log('SENT both');
}
