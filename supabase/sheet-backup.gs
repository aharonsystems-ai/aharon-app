/* ===== גיבוי: הקובץ "אהרן מערכות – עובר ושב" =====
 * backupSync – מעתיק את כל הנתונים מהאפליקציה לקובץ הגיבוי (עבודות, משימות, פרויקטים, חובות, הוצאות, נכסים).
 * רץ לבד פעם בשעה אחרי moneySync, ואפשר להריץ ידנית מהתפריט Morning.
 * כותב רק לקובץ הגיבוי. קובץ העו"ש לא משתנה. סיסמאות מקליטים לא נכתבות.
 */
var BACKUP_FILE = '1jA8bFWWQSOI6B0vjur0oaDRcsqeCGZmQsuMXZU5_DnM';

// "נכסים" → after the row "סה חייבים לי": account balances and totals (name, amount, note).
function parseBalances_(rows) {
  var out = [], on = false;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i].map(clean_), joined = r.join('|');
    if (!on) { if (/סה.?\s*חייבים/.test(joined)) on = true; continue; }
    var name = r[0], amt = moneyNum_(r[1]);
    if (!name || amt === null) continue;
    out.push({name: name, amount: amt, note: r.slice(2).filter(function (c) { return c; }).join(' · ')});
  }
  return out;
}

function backupSync() {
  var res = UrlFetchApp.fetch(CAL_FN, {method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, payload: JSON.stringify({action: 'export'})});
  if (res.getResponseCode() !== 200) throw new Error('גיבוי: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  var d = JSON.parse(res.getContentText());
  var ss = SpreadsheetApp.openById(BACKUP_FILE);
  var day = function (v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : ''; };
  var v = function (x) { return x === null || x === undefined ? '' : x; };
  var yes = function (x) { return x === true ? 'כן' : ''; };
  var byDate = function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); };

  backupPut_(ss, 'עבודות',
    ['תאריך', 'שעה', 'לקוח', 'טלפון', 'מקום', 'כתובת', 'סוג', 'מה בוצע', 'מחיר ₪', 'עלות ₪', 'שולם', 'סכום ששולם ₪', 'קבלה', 'לחייב אחר כך', 'מס׳ אחריות', 'הערות'],
    d.jobs.sort(byDate).map(function (j) { return [day(j.date), v(j.time), v(j.client), v(j.phone), v(j.place), v(j.address), v(j.kind), v(j.work),
      v(j.price), v(j.cost), v(j.paid), v(j.paid_amount), v(j.receipt), yes(j.bill_later), v(j.warranty_no), v(j.notes)]; }), [1], [9, 10, 12]);
  backupPut_(ss, 'משימות', ['תאריך', 'שעה', 'משימה', 'לקוח', 'מצב', 'הערות'],
    d.tasks.sort(function (a, b) { return (a.done === 'בוצע') - (b.done === 'בוצע') || byDate(b, a); })
      .map(function (t) { return [day(t.date), v(t.time), v(t.title), v(t.client), v(t.done), v(t.notes)]; }), [1], []);
  backupPut_(ss, 'פרויקטים', ['שם', 'לקוח', 'כתובת', 'סטטוס', 'תאריך', 'הערות'],
    d.projects.map(function (p) { return [v(p.name), v(p.client), v(p.address), v(p.status), day(p.date), v(p.notes)]; }), [5], []);
  backupPut_(ss, 'חובות', ['כיוון', 'שם', 'קטגוריה', 'סכום ₪', 'סכום מקורי ₪', 'תאריך יעד', 'תשלום חודשי ₪', 'מצב', 'מקור', 'הערות'],
    d.debts.filter(function (x) { return x.dir !== 'חייבים לי'; })
      .map(function (x) { return [v(x.dir), v(x.name), v(x.cat), v(x.amount), v(x.orig), day(x.due), v(x.monthly), v(x.paid), v(x.source), v(x.notes)]; }), [6], [4, 5, 7]);
  backupPut_(ss, 'הוצאות', ['תאריך', 'ספק', 'קטגוריה', 'סכום ₪', 'מע״מ ₪', 'עבור עבודה', 'קבלה', 'סוג', 'כמות', 'מחיר ליחידה ₪', 'הערות', 'מקור'],
    d.expenses.sort(byDate).map(function (x) { return [day(x.date), v(x.vendor), v(x.cat), v(x.amount), v(x.vat), v(x.for_job), v(x.receipt), v(x.kind),
      v(x.qty), v(x.unit_price), v(x.notes), v(x.source)]; }), [1], [4, 5, 10]);

  // נכסים: "חייבים לי" from the app + balances from the עו"ש sheet
  var owed = d.debts.filter(function (x) { return x.dir === 'חייבים לי'; });
  var bal = (d.balances && d.balances.rows) || [];
  var sh = ss.getSheetByName('נכסים') || ss.insertSheet('נכסים', 0);
  sh.clear(); sh.setRightToLeft(true);
  var rows = [['חייבים לי', '', '', ''], ['לקוח', 'סכום ₪', 'מצב', 'הערות']], fmt = [];
  owed.forEach(function (x) { rows.push([v(x.name), v(x.amount), v(x.paid), v(x.notes) || v(x.source)]); });
  var o1 = 3, o2 = rows.length;
  rows.push(['סה״כ חייבים לי', o2 >= o1 ? '=SUM(B' + o1 + ':B' + o2 + ')' : 0, '', '']); fmt.push(rows.length);
  rows.push(['', '', '', '']);
  rows.push(['יתרות בחשבונות', '', '', '']); var bt = rows.length;
  rows.push(['חשבון', 'יתרה ₪', 'הערה', '']);
  bal.forEach(function (b) { rows.push([b.name, b.amount, v(b.note), '']); });
  rows.push(['', '', '', '']);
  rows.push(['עודכן מהאפליקציה: ' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm'), '', '', '']);
  sh.getRange(1, 1, rows.length, 4).setValues(rows).setFontFamily('Arial').setHorizontalAlignment('right');
  sh.getRange(1, 2, rows.length, 1).setNumberFormat('#,##0');
  [1, bt].forEach(function (r) { sh.getRange(r, 1).setFontWeight('bold').setFontSize(13).setFontColor('#1F3A5F'); });
  [2, bt + 1].forEach(function (r) { sh.getRange(r, 1, 1, 4).setBackground('#1F3A5F').setFontColor('#FFFFFF').setFontWeight('bold'); });
  fmt.forEach(function (r) { sh.getRange(r, 1, 1, 2).setBackground('#FFF4D6').setFontWeight('bold'); });
  sh.setColumnWidths(1, 1, 220); sh.setColumnWidth(2, 100); sh.setColumnWidth(3, 120); sh.setColumnWidth(4, 320);

  var readme = ss.getSheetByName('קרא אותי');
  if (readme) readme.getRange('A11').setValue('עודכן לאחרונה: ' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm'));
  if (readme) readme.getRange('A12').setValue('הקובץ מתעדכן מהאפליקציה כל שעה.');
  PropertiesService.getScriptProperties().setProperty('backupLast', String(Date.now()));
  return 'גיבוי: ' + d.jobs.length + ' עבודות, ' + d.tasks.length + ' משימות, ' + owed.length + ' חייבים לי, ' + bal.length + ' יתרות';
}

// rewrite one tab: header in row 1 (kept styled), data from row 2. dateCols / numCols are 1-based.
function backupPut_(ss, name, head, rows, dateCols, numCols) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var last = Math.max(sh.getLastRow(), 2), width = Math.max(sh.getLastColumn(), head.length);
  sh.getRange(2, 1, last, width).clearContent();
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, head.length).setValues(rows).setFontFamily('Arial').setHorizontalAlignment('right').setVerticalAlignment('top').setWrap(true);
    dateCols.forEach(function (c) { sh.getRange(2, c, rows.length, 1).setNumberFormat('dd/mm/yyyy'); });
    numCols.forEach(function (c) { sh.getRange(2, c, rows.length, 1).setNumberFormat('#,##0'); });
  }
}
