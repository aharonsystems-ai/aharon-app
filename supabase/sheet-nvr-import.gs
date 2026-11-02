
/* ===== העברת פרטי מערכות הקלטה מגיליון "לקוחות" לעבודות באפליקציה (פעם אחת) =====
 * nvrDryRun – בדיקה בלבד: מראה לאיזו עבודה כל שורה תתאים, בלי לשמור.
 * nvrImport – שומר. לא דורס ערך שכבר קיים באפליקציה. הערכים לא נרשמים ביומן הריצה.
 */
function nvrDryRun() { return nvrImport_(true); }
function nvrImport() { return nvrImport_(false); }

function nvrImport_(dry) {
  var sh = SpreadsheetApp.getActive().getSheetByName('לקוחות');
  var v = sh.getDataRange().getDisplayValues();
  var H = v[0].map(function (h) { return String(h).trim(); });
  var col = function (name) { var i = H.indexOf(name); if (i < 0) throw new Error('לא נמצאה עמודה: ' + name); return i; };
  var c = {client: col('שם לקוח'), place: col('שם עסק/מיקום'), date: col('תאריך עבודה'), user: col('שם משתמש'),
           pass: col('סיסמה מערכת'), code: col('קוד מצלמות'), ip: col('IP קבוע NVR'), qr: col('QR COOD')};
  var rows = [];
  for (var r = 1; r < v.length; r++) {
    var x = v[r], o = {row: r + 1};
    Object.keys(c).forEach(function (k) { o[k] = String(x[c[k]] || '').trim(); });
    if (o.client && (o.user || o.pass || o.code || o.ip || o.qr)) rows.push(o);
  }
  var res = UrlFetchApp.fetch(CAL_FN, {method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, payload: JSON.stringify({action: 'nvr', dry: dry, rows: rows})});
  var out = res.getResponseCode() + ' ' + res.getContentText();
  Logger.log(out);
  return out;
}
