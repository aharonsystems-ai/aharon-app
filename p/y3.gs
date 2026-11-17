
/* זמני – עדכון שתי הטיוטות לילו פרינט עם הקבצים המתוקנים. */
function updateYeloDrafts3() {
  var B = 'https://raw.githubusercontent.com/aharonsystems-ai/aharon-app/print-files-tmp/p/';
  var get = function (f, name) { return UrlFetchApp.fetch(B + f + '?v=' + Date.now()).getBlob().setName(name || f).setContentType('application/pdf'); };
  var upd = function (id, files) { var d = GmailApp.getDraft(id), m = d.getMessage(); d.update(m.getTo(), m.getSubject(), m.getPlainBody(), {htmlBody: m.getBody(), attachments: files}); return files.map(function (b) { return b.getBytes().length; }).join(','); };
  var a1 = ['A4.pdf', 'A5.pdf', 'round-6cm.pdf', 'ad-15x6.pdf', 'cabinet-15x6.pdf', 'rack-43x4.3.pdf', 'rack-43x8.6.pdf', 'business-card-2-sides.pdf'].map(function (f) { return get(f); });
  var s1 = upd('r-6411468770349122090', a1);
  var a2 = [get('w1.pdf', 'תעודות אחריות 100001-100050 (חלק 1).pdf'), get('w2.pdf', 'תעודות אחריות 100051-100100 (חלק 2).pdf'), get('i.pdf', 'דוחות בדיקה 200001-200050.pdf')];
  var s2 = upd('r-6799910251240580662', a2);
  Logger.log('ok ' + s1 + ' | ' + s2);
}
