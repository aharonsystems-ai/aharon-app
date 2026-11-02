/* ===== כספים → אפליקציה =====
 * moneySync – שולח לאפליקציה: חובות + "חייבים לי" + "הוצאות 2026" מקובץ העו"ש, ואת "עלויות פרויקטים" מהגיליון הזה.
 * רץ לבד פעם בשעה (מתוך calendarSync), ואפשר להריץ ידנית מהתפריט Morning.
 * קובץ העו"ש רק נקרא – לא משנים בו כלום.
 */
var MONEY_FILE = '1fAn4czNWzdw5jhakgZtLTHFN3Rq0Yiv8';
var MONEY_GIDS = {debts: 962679928, assets: 382420533, fixed: 71765703};

function moneyCsv_(gid) {
  DriveApp.getFileById(MONEY_FILE); // asks for read access to Drive files on the first run
  var url = 'https://docs.google.com/spreadsheets/d/' + MONEY_FILE + '/export?format=csv&gid=' + gid;
  var res = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
  if (res.getResponseCode() !== 200) throw new Error('לא הצלחתי לקרוא את קובץ העו"ש (' + res.getResponseCode() + ')');
  return Utilities.parseCsv(res.getContentText());
}

function moneySync() {
  var costs = SpreadsheetApp.getActive().getSheetByName('עלויות פרויקטים').getDataRange().getDisplayValues();
  var payload = {action: 'money',
    debts: parseDebts_(moneyCsv_(MONEY_GIDS.debts)),
    owed: parseOwed_(moneyCsv_(MONEY_GIDS.assets)),
    fixed: parseFixed_(moneyCsv_(MONEY_GIDS.fixed), 2026),
    costs: parseCosts_(costs)};
  var res = UrlFetchApp.fetch(CAL_FN, {method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, payload: JSON.stringify(payload)});
  var out = res.getResponseCode() + ' ' + res.getContentText();
  Logger.log(out);
  PropertiesService.getScriptProperties().setProperty('moneyLast', String(Date.now()));
  return out;
}

function moneySyncMaybe_() {
  var last = Number(PropertiesService.getScriptProperties().getProperty('moneyLast') || 0);
  if (Date.now() - last < 55 * 60 * 1000) return;
  try { moneySync(); } catch (e) { Logger.log('moneySync: ' + e); PropertiesService.getScriptProperties().setProperty('moneyLast', String(Date.now())); }
}

function moneyNum_(v) {
  var s = String(v == null ? '' : v).replace(/[₪$\s‏‎]/g, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  var n = Number(s); return isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function clean_(v) { return String(v == null ? '' : v).replace(/[‏‎‪-‮‫]/g, '').replace(/\s+/g, ' ').trim(); }

// "חובות": col B name, col C amount (rows numbered in col A). Stops at the totals row (empty name).
function parseDebts_(rows) {
  var out = [], seen = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i], name = clean_(r[1]);
    if (!name || moneyNum_(name) !== null) { if (out.length && (moneyNum_(r[2]) !== null || moneyNum_(name) !== null)) break; continue; }
    var amt = moneyNum_(r[2]);
    var k = name; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) k += '#' + seen[k];
    out.push({key: 'debt:' + k, name: name, amount: amt});
  }
  return out;
}

// "נכסים" → the block "חייבים לי": rows name, amount, original amount; ends at "סה חייבים לי".
function parseOwed_(rows) {
  var out = [], on = false, seen = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i].map(clean_), joined = r.join('|');
    if (!on) { if (r.some(function (c) { return c === 'חייבים לי'; })) on = true; continue; }
    if (/סה.?\s*חייבים/.test(joined)) break;
    var name = r[0], amt = moneyNum_(r[1]);
    if (!name || name === 'שם' || amt === null) continue;
    var k = name; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) k += '#' + seen[k];
    out.push({key: 'owed:' + k, name: name, amount: amt, orig: moneyNum_(r[2])});
  }
  return out;
}

// "הוצאות 2026": col A name, cols B..M = months 1..12.
function parseFixed_(rows, year) {
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i], name = clean_(r[0]);
    if (!name) continue;
    for (var m = 1; m <= 12; m++) {
      var a = moneyNum_(r[m]);
      if (a === null || a === 0) continue;
      out.push({key: 'fixed:' + name + ':' + m, name: name, date: year + '-' + (m < 10 ? '0' : '') + m + '-01', amount: a});
    }
  }
  return out;
}

// "עלויות פרויקטים": free-form blocks. A project title row, then item rows: name, unit price, qty, total, ..., note (col G).
var SKIP_ = /^(פריט|סה|סה"כ|סה״כ|סה כ|סה לא כולל|ההפרש|אחרי מסים|רווח|עלויות ללא מע|מע''מ על הקניה|מע"מ על הקניה|מחיר)/;
function parseCosts_(rows) {
  var R = rows.map(function (r) { return r.map(clean_); });
  var isItemWord = function (r) { return r && /^פריט/.test(r[0]); };
  var nums = function (r) { return [1, 2, 3].some(function (c) { return moneyNum_(r[c]) !== null; }); };
  var out = [], proj = null, count = 0, skipBlock = false, seen = {};
  for (var i = 0; i < R.length; i++) {
    var r = R[i], name = r[0], next = R[i + 1];
    if (!name) continue;
    if (isItemWord(r)) continue;
    var header = (isItemWord(next) && moneyNum_(r[1]) === null) || (!nums(r) && !r[6] && (proj === null || count > 0));
    if (header) { proj = name; count = 0; skipBlock = /הצעת מחיר/.test(name); continue; }
    if (skipBlock || SKIP_.test(name)) continue;
    var p = moneyNum_(r[1]), q = moneyNum_(r[2]), t = moneyNum_(r[3]), amt = null, unit = null, qty = null, check = '';
    var qtyLike = q !== null && q > 0 && Math.round(q) === q && q <= (t !== null ? 1000 : 50);
    if (p !== null && qtyLike) {
      // unit price × quantity; the total written in the sheet wins unless it is clearly not a total
      var exp = Math.round(p * q * 100) / 100; unit = p; qty = q;
      if (t === null) amt = exp;
      else if (t >= p * 0.5) { amt = t; if (Math.abs(t - exp) > 2) check = 'בגיליון ' + q + ' × ' + p + ' = ' + exp + ', אבל הסה"כ שכתוב הוא ' + t; }
      else { amt = exp; check = 'הסה"כ בגיליון (' + t + ') לא מסתדר, חושב ' + q + ' × ' + p; }
    } else if (p !== null) {
      amt = p; // other numbers on the row are side calculations
      if (t !== null && t !== p) check = 'בשורה בגיליון יש גם ' + t;
    } else if (t !== null) { amt = t; }
    if (amt === null || amt === 0) continue;
    var k = proj + '|' + name; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) k += '#' + seen[k];
    out.push({key: 'cost:' + k, project: proj, item: name, unit: unit, qty: qty, amount: amt, note: r[6] || '', check: check});
    count++;
  }
  return out;
}

