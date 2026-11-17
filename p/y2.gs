
/* זמני – עדכון טיוטה 2 לילו פרינט עם הקבצים המתוקנים. */
function updateYeloDraft2() {
  var B = 'https://raw.githubusercontent.com/aharonsystems-ai/aharon-app/print-files-tmp/p/';
  var get = function (f, name) { return UrlFetchApp.fetch(B + f + '?v=' + Date.now()).getBlob().setName(name).setContentType('application/pdf'); };
  var d = GmailApp.getDraft('r-6799910251240580662');
  var m = d.getMessage();
  var a2 = [get('w1.pdf', 'תעודות אחריות 100001-100050 (חלק 1).pdf'), get('w2.pdf', 'תעודות אחריות 100051-100100 (חלק 2).pdf'), get('i.pdf', 'דוחות בדיקה 200001-200050.pdf')];
  d.update(m.getTo(), m.getSubject(), m.getPlainBody(), {htmlBody: m.getBody(), attachments: a2});
  Logger.log('ok ' + a2.map(function (b) { return b.getBytes().length; }).join(','));
}
