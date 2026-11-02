
/* ===== יומן Google: משימות, עבודות ופרויקטים מאפליקציית הניהול =====
 * קורא את התאריכים מהאפליקציה (פונקציית calendar ב-Supabase) ומעדכן יומן נפרד בשם "אהרן מערכות".
 * אין כאן מפתח או סיסמה: האפליקציה מזהה את חשבון Google של אהרן לפי ההרשאה של הסקריפט.
 * כל 10 דקות: אירוע חדש נוצר, אירוע שהשתנה מתעדכן, אירוע שנמחק או סומן "בוצע" יורד מהיומן.
 */
var CAL_FN = 'https://pipynokkdtvkkzcgatlq.supabase.co/functions/v1/calendar';
var CAL_NAME = 'אהרן מערכות';
var CAL_TZ = 'Asia/Jerusalem';

function enableCalendar() {
  Session.getActiveUser().getEmail(); // so the script's token carries the account email
  disableCalendar();
  ScriptApp.newTrigger('calendarSync').timeBased().everyMinutes(10).create();
  calendarSync();
}

function disableCalendar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() == 'calendarSync') ScriptApp.deleteTrigger(t); });
}

function calCal_() {
  var c = CalendarApp.getCalendarsByName(CAL_NAME)[0];
  if (!c) c = CalendarApp.createCalendar(CAL_NAME, {color: CalendarApp.Color.BLUE, timeZone: CAL_TZ});
  return c;
}

function calendarSync() {
  var res = UrlFetchApp.fetch(CAL_FN, {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
  if (res.getResponseCode() != 200) throw new Error('calendar ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  var d = JSON.parse(res.getContentText());
  var cal = calCal_();
  var from = Utilities.parseDate(d.from, CAL_TZ, 'yyyy-MM-dd');
  var to = new Date(Utilities.parseDate(d.to, CAL_TZ, 'yyyy-MM-dd').getTime() + 2 * 864e5);
  var have = {};
  cal.getEvents(from, to).forEach(function (e) {
    var id = e.getTag('aid'); if (!id) return;
    if (have[id]) e.deleteEvent(); else have[id] = e;
  });
  var seen = {}, made = 0, gone = 0;
  d.events.forEach(function (ev) {
    seen[ev.id] = 1;
    var sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(ev), Utilities.Charset.UTF_8));
    var e = have[ev.id];
    if (e && e.getTag('sig') == sig) return;
    if (e) e.deleteEvent();
    var opt = {description: ev.description || '', location: ev.location || ''};
    if (ev.time) {
      var s = Utilities.parseDate(ev.date + ' ' + ev.time, CAL_TZ, 'yyyy-MM-dd HH:mm');
      e = cal.createEvent(ev.title, s, new Date(s.getTime() + (ev.hours || 1) * 36e5), opt);
    } else {
      e = cal.createAllDayEvent(ev.title, Utilities.parseDate(ev.date, CAL_TZ, 'yyyy-MM-dd'), opt);
    }
    e.setTag('aid', ev.id); e.setTag('sig', sig); made++;
  });
  Object.keys(have).forEach(function (id) { if (!seen[id]) { have[id].deleteEvent(); gone++; } });
  Logger.log(d.events.length + ' אירועים · ' + made + ' עודכנו · ' + gone + ' הוסרו');
}
