
/* זמני – בניית טיוטות ההזמנה לילו פרינט עם הקבצים. אפשר למחוק אחרי שימוש. */
function buildYeloDrafts() {
  var B = 'https://raw.githubusercontent.com/aharonsystems-ai/aharon-app/print-files-tmp/p/';
  var get = function (f, name) { var r = UrlFetchApp.fetch(B + f); return r.getBlob().setName(name || f).setContentType('application/pdf'); };
  var thread = GmailApp.getThreadById('1a1a630697fc68d8');
  var msgs = thread.getMessages(), last = null;
  for (var i = 0; i < msgs.length; i++) if (!msgs[i].isDraft() && /ylvm\.biz/.test(msgs[i].getFrom())) last = msgs[i];
  var sig = '<br>תודה,<br>אהרן מערכות<br>055-9759822';
  var h1 = '<div dir="rtl">שלום, תודה.<br>אני מעוניין להזמין. הכל בצבע מלא. כל הקבצים בגודל החיתוך המדויק.<br>' +
    'בגלל הגודל, הקבצים מגיעים בשני מיילים: במייל הזה סעיפים 1–9, ובמייל הבא סעיפים 10–11.<br><br>' +
    '<b>מה להדפיס:</b><br>' +
    '1. שלט A4 – מדבקת ויניל – 100 יח\' – קובץ A4.pdf – 110 ₪<br>' +
    '2. שלט A5 – מדבקת ויניל – 100 יח\' – קובץ A5.pdf – 55 ₪<br>' +
    '3. שלט A4 – PVC 2 מ"מ – 100 יח\' – אותו קובץ A4.pdf – 700 ₪<br>' +
    '4. שלט A5 – PVC 2 מ"מ – 50 יח\' – אותו קובץ A5.pdf – 200 ₪<br>' +
    '5. מדבקה עגולה קוטר 6 ס"מ – ויניל, על גיליונות – 500 יח\' – round-6cm.pdf – 80 ₪<br>' +
    '6. מדבקה 15×6 ס"מ – ויניל לבן + למינציה – 300 יח\' בשני עיצובים: 200 יח\' מ-ad-15x6.pdf ו-100 יח\' מ-cabinet-15x6.pdf – כ-258 ₪<br>' +
    '7. מדבקה 43×4.3 ס"מ – ויניל לבן + למינציה – 50 יח\' – rack-43x4.3.pdf – 56 ₪<br>' +
    '8. מדבקה 43×8.6 ס"מ – ויניל לבן + למינציה – 50 יח\' – rack-43x8.6.pdf – 91 ₪<br>' +
    '9. כרטיס ביקור 9×5 דו-צדדי – כרומו 350 + למינציה – 500 יח\' – business-card-2-sides.pdf (עמוד 1 צד קדמי, עמוד 2 צד אחורי) – 140 ₪<br>' +
    '10. תעודת אחריות A4 – נטול 170, צד אחד – 100 יח\' – שני קבצים של 50 עמודים. כל עמוד עם מספר אחר (100001–100100), מדפיסים כל עמוד פעם אחת – 65 ₪ (במייל הבא)<br>' +
    '11. דוח בדיקה A4 – נטול 170, צד אחד – 50 יח\' – קובץ של 50 עמודים. כל עמוד עם מספר אחר (200001–200050), מדפיסים כל עמוד פעם אחת – 32.50 ₪ (במייל הבא)<br><br>' +
    '<b>סה"כ לפי החישוב שלי: 1,787.50 ₪ + מע"מ.</b><br><br>' +
    'שתי שאלות:<br>- בסעיפים 6–8 המחיר כולל למינציה?<br>- הקבצים בלי שוליים לחיתוך (בליד). צריך שאוסיף 2 מ"מ מכל צד?<br><br>' +
    'אשמח לאישור הסכום ולדעת איך משלמים. אני אאסוף מהמקום.<br>' + sig + '</div>';
  var plain1 = h1.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '');
  var a1 = ['A4.pdf', 'A5.pdf', 'round-6cm.pdf', 'ad-15x6.pdf', 'cabinet-15x6.pdf', 'rack-43x4.3.pdf', 'rack-43x8.6.pdf', 'business-card-2-sides.pdf'].map(function (f) { return get(f); });
  var old = null;
  try { old = GmailApp.getDraft('r-6411468770349122090'); } catch (e) {}
  if (old) old.update('p@ylvm.biz', 'Re: בקשה להצעת מחיר – הדפסות לעסק (אהרן מערכות)', plain1, {htmlBody: h1, attachments: a1});
  else last.createDraftReply(plain1, {htmlBody: h1, attachments: a1});
  var h2 = '<div dir="rtl">המשך להזמנה – סעיפים 10–11:<br><br>' +
    '10. תעודת אחריות A4 – נטול 170, צד אחד – 100 יח\': שני הקבצים "תעודות אחריות" (חלק 1 + חלק 2), 50 עמודים כל אחד.<br>' +
    '11. דוח בדיקה A4 – נטול 170, צד אחד – 50 יח\': הקובץ "דוחות בדיקה", 50 עמודים.<br><br>' +
    'בכל עמוד יש מספר אחר, אז מדפיסים כל עמוד פעם אחת בלבד (לא 100 עותקים מכל עמוד).<br>' + sig + '</div>';
  var plain2 = h2.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '');
  var a2 = [get('w1.pdf', 'תעודות אחריות 100001-100050 (חלק 1).pdf'), get('w2.pdf', 'תעודות אחריות 100051-100100 (חלק 2).pdf'), get('i.pdf', 'דוחות בדיקה 200001-200050.pdf')];
  last.createDraftReply(plain2, {htmlBody: h2, attachments: a2, subject: 'Re: בקשה להצעת מחיר – הדפסות לעסק (אהרן מערכות) – המשך (תעודות ודוחות)'});
  Logger.log('ok');
}
