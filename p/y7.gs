
/* זמני – שליחה חוזרת של כל הקבצים לילו פרינט. */
function resendYeloFiles() {
  var B = 'https://raw.githubusercontent.com/aharonsystems-ai/aharon-app/print-files-tmp/p/';
  var get = function (f, name) { return UrlFetchApp.fetch(B + f + '?v=' + Date.now()).getBlob().setName(name || f).setContentType('application/pdf'); };
  var thread = GmailApp.getThreadById('1a1a630697fc68d8');
  var msgs = thread.getMessages(), last = null;
  for (var i = 0; i < msgs.length; i++) if (!msgs[i].isDraft() && /ylvm\.biz/.test(msgs[i].getFrom())) last = msgs[i];
  var sig = '<br>תודה,<br>אהרן מערכות<br>055-9759822';
  var F1 = ['A4.pdf', 'A5.pdf', 'round-6cm.pdf', 'ad-15x6.pdf', 'cabinet-15x6.pdf', 'rack-43x4.3.pdf', 'rack-43x8.6.pdf', 'business-card-2-sides.pdf'];
  var a1 = F1.map(function (f) { return get(f); });
  var a2 = [get('w1.pdf', 'תעודות אחריות 100001-100050 (חלק 1).pdf'), get('w2.pdf', 'תעודות אחריות 100051-100100 (חלק 2).pdf'), get('i.pdf', 'דוחות בדיקה 200001-200050.pdf')];
  if (a1.length !== 8 || a2.length !== 3 || a1.concat(a2).some(function (b) { return b.getBytes().length < 500000; })) { Logger.log('NOT SENT: file check failed'); return; }
  var h1 = '<div dir="rtl">שלום,<br>מצרף שוב את כל הקבצים (עם גלישה 2 מ"מ). בגלל הגודל זה בשני מיילים – כאן 8 קבצים, ובמייל הבא תעודות האחריות ודוחות הבדיקה.<br><br>' +
    'A4.pdf – מדבקת ויניל A4 (100) + PVC A4 (100)<br>A5.pdf – מדבקת ויניל A5 (100) + PVC A5 (50)<br>round-6cm.pdf – מדבקה עגולה ויניל מבריק (500)<br>' +
    'ad-15x6.pdf – מדבקה 15×6 ויניל (200)<br>cabinet-15x6.pdf – מדבקה 15×6 ויניל (100)<br>rack-43x4.3.pdf – מדבקה 43×4.3 ויניל (50)<br>rack-43x8.6.pdf – מדבקה 43×8.6 ויניל (50)<br>' +
    'business-card-2-sides.pdf – כרטיס ביקור דו-צדדי (500)<br><br>' +
    'מתי ההזמנה תהיה מוכנה לאיסוף? אני משלם במקום כשאני אוסף.<br>' + sig + '</div>';
  last.reply(h1.replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''), {htmlBody: h1, attachments: a1});
  Utilities.sleep(3000);
  var h2 = '<div dir="rtl">המשך – תעודות אחריות (חלק 1 + חלק 2, 100 יח\') ודוחות בדיקה (50 יח\'), נטול 170.<br>בכל עמוד מספר אחר, מדפיסים כל עמוד פעם אחת.<br>' + sig + '</div>';
  last.reply(h2.replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''), {htmlBody: h2, attachments: a2});
  Logger.log('SENT both');
}
