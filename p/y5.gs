
/* זמני – טיוטות תשובה לילו פרינט עם קבצים עם גלישה. */
function yeloBleedDrafts() {
  var B = 'https://raw.githubusercontent.com/aharonsystems-ai/aharon-app/print-files-tmp/p/';
  var get = function (f, name) { return UrlFetchApp.fetch(B + f + '?v=' + Date.now()).getBlob().setName(name || f).setContentType('application/pdf'); };
  var thread = GmailApp.getThreadById('1a1a630697fc68d8');
  var msgs = thread.getMessages(), last = null;
  for (var i = 0; i < msgs.length; i++) if (!msgs[i].isDraft() && /ylvm\.biz/.test(msgs[i].getFrom())) last = msgs[i];
  var sig = '<br>תודה,<br>אהרן מערכות<br>055-9759822';
  var h1 = '<div dir="rtl">שלום,<br>מצרף את כל הקבצים מחדש עם גלישה של 2 מ"מ מכל צד. הגודל אחרי חיתוך נשאר כמו בהזמנה.<br>' +
    'גם הפעם בשני מיילים בגלל הגודל: כאן סעיפים 1–9, ובמייל הבא תעודות האחריות ודוחות הבדיקה (סעיפים 10–11).<br><br>' +
    '<b>פרטים לכרטיס לקוח:</b><br>שם לחשבונית: אהרן מערכות – אהרן לוי לוין<br>מייל: aharonsystems@gmail.com<br>טלפון: 055-9759822<br>ע.מ: ____<br><br>' +
    'ועוד שאלה שנשארה: בסעיפים 6–8 (מדבקות 15×6 ו-43 ס"מ) המחיר כולל למינציה?<br>' + sig + '</div>';
  var a1 = ['A4.pdf', 'A5.pdf', 'round-6cm.pdf', 'ad-15x6.pdf', 'cabinet-15x6.pdf', 'rack-43x4.3.pdf', 'rack-43x8.6.pdf', 'business-card-2-sides.pdf'].map(function (f) { return get(f); });
  var d1 = last.createDraftReply(h1.replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''), {htmlBody: h1, attachments: a1});
  var h2 = '<div dir="rtl">המשך – סעיפים 10–11 עם גלישה של 2 מ"מ:<br>תעודות אחריות (חלק 1 + חלק 2) ודוחות בדיקה.<br>בכל עמוד מספר אחר, מדפיסים כל עמוד פעם אחת.<br>' + sig + '</div>';
  var a2 = [get('w1.pdf', 'תעודות אחריות 100001-100050 (חלק 1).pdf'), get('w2.pdf', 'תעודות אחריות 100051-100100 (חלק 2).pdf'), get('i.pdf', 'דוחות בדיקה 200001-200050.pdf')];
  var d2 = last.createDraftReply(h2.replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''), {htmlBody: h2, attachments: a2, subject: 'Re: בקשה להצעת מחיר – הדפסות לעסק (אהרן מערכות) – המשך (תעודות ודוחות)'});
  Logger.log('ok ' + d1.getId() + ' ' + d2.getId() + ' | ' + d1.getMessage().getAttachments().length + ' / ' + d2.getMessage().getAttachments().length);
}
