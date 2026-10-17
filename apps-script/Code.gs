/**
 * Kirana Management — Google Sheet backend
 * -----------------------------------------
 * Ye code teen kaam karta hai:
 *   1. App ke liye API (list / add / edit / khatam / shopping)
 *   2. Telegram bot (group mein message se item add, list, khatam)
 *   3. Roz 4:30 PM (IST) expiry alert Telegram group mein
 *
 * SETUP: sirf neeche wali 2 lines bharo, phir `setup` function ek baar Run karo.
 */

// ============ SIRF YE 2 LINES BHARNI HAIN ============
const TELEGRAM_TOKEN = 'YAHAN_BOTFATHER_WALA_TOKEN_PASTE_KARO';
const APP_KEY = 'YAHAN_APNA_FAMILY_CODE_LIKHO'; // jaise: ghar@2026 (app mein yahi daalna hoga)
// =====================================================

const ALERT_TIME = '16:30';            // roz alert ka time (IST, 24-hour)
const TZ = 'Asia/Kolkata';
const SHEET_NAME = 'Items';
const HEADERS = ['id', 'name', 'qty', 'category', 'expiry', 'addedOn', 'alertDays',
  'status', 'addedBy', 'updatedOn', 'warned', 'lastDayNotified', 'expiredNotified'];
// status: active = ghar mein hai | shopping = khatam, lana hai | cleared = purana record

/* ------------------------------------------------------------------ */
/* SETUP — ek baar Run karo                                            */
/* ------------------------------------------------------------------ */
function setup() {
  if (TELEGRAM_TOKEN.indexOf('YAHAN') === 0 || APP_KEY.indexOf('YAHAN') === 0) {
    throw new Error('Fill in TELEGRAM_TOKEN and APP_KEY at the top first, then run setup again.');
  }
  sheet_();
  // purane triggers hatao, naya 1-minute wala lagao
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  // webhook band (hum polling use karte hain, Apps Script ke saath ye zyada reliable hai)
  tg_('deleteWebhook', { drop_pending_updates: false });
  const me = tg_('getMe', {});
  Logger.log('✅ Setup done. Bot: @' + (me && me.result ? me.result.username : '?'));
  Logger.log('Now send /start in your Telegram group (the bot replies within a minute).');
}

/** Turant ek alert bhej ke test karna ho toh ise Run karo. */
function testAlert() {
  const sent = sendDailyAlert_(true);
  Logger.log(sent ? 'Alert sent.' : 'Nothing needs an alert right now (or no group is linked).');
}

/** Group badalna ho toh ise Run karo, phir naye group mein /start bhejo. */
function resetGroup() {
  PropertiesService.getScriptProperties().deleteProperty('CHAT_ID');
  Logger.log('Group unlinked. Send /start in the new group.');
}

/* ------------------------------------------------------------------ */
/* SHEET HELPERS                                                       */
/* ------------------------------------------------------------------ */
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    const first = ss.getSheets()[0];
    if (first.getName() !== SHEET_NAME && first.getLastRow() === 0) {
      try { ss.deleteSheet(first); } catch (e) { /* ignore */ }
    }
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // dates ko plain text rakho, warna Sheets unhe badal deta hai
  sh.getRange('A:M').setNumberFormat('@');
  return sh;
}

function readAll_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values.map(function (r, i) {
    const o = { _row: i + 2 };
    HEADERS.forEach(function (h, j) {
      let v = r[j];
      if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      o[h] = v === null || v === undefined ? '' : String(v);
    });
    return o;
  }).filter(function (o) { return o.id; });
}

function writeRow_(o) {
  const sh = sheet_();
  const row = HEADERS.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); });
  if (o._row) sh.getRange(o._row, 1, 1, HEADERS.length).setValues([row]);
  else sh.appendRow(row);
}

function publicItem_(o) {
  return {
    id: o.id, name: o.name, qty: o.qty, category: o.category, expiry: o.expiry,
    addedOn: o.addedOn, alertDays: Number(o.alertDays) || 0, status: o.status,
    addedBy: o.addedBy, updatedOn: o.updatedOn
  };
}

/* ------------------------------------------------------------------ */
/* DATE + ALERT LOGIC                                                  */
/* ------------------------------------------------------------------ */
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function niceTime_() {
  const p = ALERT_TIME.split(':').map(Number);
  return (p[0] % 12 || 12) + ':' + pad_(p[1]) + (p[0] < 12 ? ' AM' : ' PM');
}
function nowHM_() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }

function toUTC_(iso) {
  const p = String(iso).split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}
function daysBetween_(a, b) { return Math.round((toUTC_(b) - toUTC_(a)) / 86400000); }
function addDays_(iso, n) {
  const d = new Date(toUTC_(iso) + n * 86400000);
  return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate());
}
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function isISO_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

/** Item kitne din chalta hai, uske hisaab se kitne din pehle alert. */
function autoAlert_(addedOn, expiry) {
  const life = daysBetween_(addedOn, expiry);
  if (life <= 7) return 1;
  if (life <= 31) return 3;
  if (life <= 180) return 7;
  return 30;
}

function guessCategory_(name) {
  const n = String(name).toLowerCase();
  const map = [
    ['Dairy', /doodh|dudh|milk|dahi|curd|paneer|butter|makhan|cheese|ghee|cream|lassi|chaach|buttermilk|yogurt/],
    ['Bakery', /bread|pav|bun|cake|rusk|toast/],
    ['Sabzi-Fal', /aloo|pyaz|onion|tamatar|tomato|sabzi|fruit|apple|seb|kela|banana|mango|aam|dhaniya|mirch|adrak|lehsun|palak|gobi/],
    ['Masale', /masala|haldi|jeera|mirchi|dhania powder|garam|namak|salt|hing|rai|ajwain|elaichi|laung|kali mirch|pepper/],
    ['Raashan', /atta|aata|chawal|rice|dal|daal|besan|maida|sooji|suji|rava|poha|sugar|cheeni|shakkar|gud|jaggery|tel|oil|rajma|chana|moong|masoor|toor|arhar|urad|oats/],
    ['Snacks', /biscuit|namkeen|chips|bhujia|cookies|chocolate|maggi|noodles|kurkure|wafer/],
    ['Drinks', /chai|tea|coffee|juice|cold drink|soda|horlicks|bournvita/]
  ];
  for (let i = 0; i < map.length; i++) if (map[i][1].test(n)) return map[i][0];
  return 'Other';
}

/* ------------------------------------------------------------------ */
/* CORE ACTIONS (app + telegram dono yahi use karte hain)              */
/* ------------------------------------------------------------------ */
function addItem_(d, by) {
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Item name is required');
  const status = d.status === 'shopping' ? 'shopping' : 'active';
  const expiry = String(d.expiry || '');
  if (status === 'active' && !isISO_(expiry)) throw new Error('Expiry date is required');
  const t = today_();
  const o = {
    id: Utilities.getUuid().slice(0, 8),
    name: cap_(name),
    qty: String(d.qty || '').trim(),
    category: d.category || guessCategory_(name),
    expiry: status === 'active' ? expiry : '',
    addedOn: t,
    alertDays: status === 'active' ? (Number(d.alertDays) || autoAlert_(t, expiry)) : '',
    status: status,
    addedBy: String(by || d.by || '').slice(0, 30),
    updatedOn: new Date().toISOString(),
    warned: '', lastDayNotified: '', expiredNotified: ''
  };
  writeRow_(o);
  return o;
}

function findById_(id) {
  const all = readAll_();
  for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function updateItem_(d) {
  const o = findById_(d.id);
  if (!o) throw new Error('Item not found');
  ['name', 'qty', 'category'].forEach(function (k) { if (d[k] !== undefined) o[k] = k === 'name' ? cap_(d[k]) : String(d[k]); });
  let resetFlags = false;
  if (d.expiry !== undefined && d.expiry !== o.expiry) {
    if (!isISO_(d.expiry)) throw new Error('Invalid expiry date');
    o.expiry = d.expiry; resetFlags = true;
    if (d.alertDays === undefined || d.alertDays === 'auto') o.alertDays = autoAlert_(o.addedOn || today_(), o.expiry);
  }
  if (d.alertDays !== undefined && d.alertDays !== 'auto') { o.alertDays = Number(d.alertDays) || 1; resetFlags = true; }
  if (resetFlags) { o.warned = ''; o.lastDayNotified = ''; o.expiredNotified = ''; }
  o.updatedOn = new Date().toISOString();
  writeRow_(o);
  return o;
}

function finishItem_(id) {
  const o = findById_(id);
  if (!o) throw new Error('Item not found');
  o.status = 'shopping';
  o.updatedOn = new Date().toISOString();
  writeRow_(o);
  return o;
}

function restockItem_(d, by) {
  const o = findById_(d.id);
  if (!o) throw new Error('Item not found');
  o.status = 'cleared';
  o.updatedOn = new Date().toISOString();
  writeRow_(o);
  return addItem_({ name: d.name || o.name, qty: d.qty !== undefined ? d.qty : o.qty, category: o.category,
    expiry: d.expiry, alertDays: d.alertDays }, by);
}

function reactivateItem_(id) {
  const o = findById_(id);
  if (!o) throw new Error('Item not found');
  o.status = 'active';
  o.updatedOn = new Date().toISOString();
  writeRow_(o);
  return o;
}

function removeItem_(id) {
  const o = findById_(id);
  if (!o) return null;
  o.status = 'cleared';
  o.updatedOn = new Date().toISOString();
  writeRow_(o);
  return o;
}

function listItems_() {
  return readAll_().filter(function (o) { return o.status === 'active' || o.status === 'shopping'; });
}

function cap_(s) { s = String(s).trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

/* ------------------------------------------------------------------ */
/* WEB API (app yahan baat karti hai)                                  */
/* ------------------------------------------------------------------ */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== APP_KEY) return json_({ ok: false, error: 'Wrong family code' });
  try {
    return json_({ ok: true, items: listItems_().map(publicItem_), today: today_() });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  let d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ ok: false, error: 'Bad request' }); }
  if (d.update_id !== undefined) return json_({ ok: true }); // galti se webhook aaya ho toh ignore
  if (d.key !== APP_KEY) return json_({ ok: false, error: 'Wrong family code' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let item = null;
    switch (d.action) {
      case 'add': item = addItem_(d, d.by); break;
      case 'update': item = updateItem_(d); break;
      case 'finish': item = finishItem_(d.id); break;
      case 'restock': item = restockItem_(d, d.by); break;
      case 'remove': item = removeItem_(d.id); break;
      case 'reactivate': item = reactivateItem_(d.id); break;
      default: return json_({ ok: false, error: 'Unknown action' });
    }
    return json_({ ok: true, item: item ? publicItem_(item) : null, items: listItems_().map(publicItem_), today: today_() });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* TELEGRAM                                                            */
/* ------------------------------------------------------------------ */
function tg_(method, payload) {
  try {
    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/' + method, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('Telegram error: ' + e);
    return null;
  }
}

function say_(chatId, html) {
  return tg_('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
}

function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** Har minute chalta hai: naye Telegram messages padhta hai + alert time check karta hai. */
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    pollTelegram_();
    if (nowHM_() >= ALERT_TIME) {
      const props = PropertiesService.getScriptProperties();
      if (props.getProperty('LAST_ALERT') !== today_()) {
        props.setProperty('LAST_ALERT', today_());
        sendDailyAlert_(false);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function pollTelegram_() {
  const props = PropertiesService.getScriptProperties();
  const offset = Number(props.getProperty('TG_OFFSET') || 0);
  const res = tg_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message'] });
  if (!res || !res.ok || !res.result || !res.result.length) return;
  let next = offset;
  res.result.forEach(function (u) {
    next = Math.max(next, u.update_id + 1);
    props.setProperty('TG_OFFSET', String(next)); // pehle save, taaki dobara process na ho
    try { if (u.message) handleMessage_(u.message); } catch (e) { Logger.log('msg error: ' + e); }
  });
}

function handleMessage_(msg) {
  const props = PropertiesService.getScriptProperties();
  const chatId = String(msg.chat.id);
  let text = String(msg.text || '').trim();
  if (!text) return;
  text = text.replace(/@[A-Za-z0-9_]+bot\b/ig, '').trim(); // "/list@kirana_bot" -> "/list"
  const saved = props.getProperty('CHAT_ID');

  if (/^\/start\b/i.test(text)) {
    if (!saved) {
      props.setProperty('CHAT_ID', chatId);
      say_(chatId, '👋 <b>Kirana Management</b> is now linked to this group!\n\nExpiry alerts will arrive here daily at ' + niceTime_() + '.\n\n' + helpText_());
    } else if (saved === chatId) {
      say_(chatId, helpText_());
    } else {
      say_(chatId, 'This bot is already linked to another group.');
    }
    return;
  }
  if (saved !== chatId) return; // sirf apne group ki baat suno

  const by = (msg.from && (msg.from.first_name || msg.from.username)) || 'Telegram';
  const low = text.toLowerCase().replace(/^\//, '').trim();

  if (/^(help|madad|start)$/.test(low)) return say_(chatId, helpText_());
  if (/^(list|stock|sab|saman|saamaan)$/.test(low)) return say_(chatId, listText_());
  if (/^(shopping|buy|kya lana hai|lana hai|lana)$/.test(low)) return say_(chatId, shoppingText_());
  if (/^(jaldi|expiring|expiry|soon)$/.test(low)) return say_(chatId, expiringText_());

  let m = low.match(/^(?:khatam|khtm|finish|done|used)\s+(.+)$/) || low.match(/^(.+?)\s+(?:khatam|khtm|khatm|finish)$/);
  if (m) return say_(chatId, finishByName_(m[1].trim()));

  let body = text.replace(/^\/?(add|daalo|dalo)\s+/i, '');
  const wasCommand = body !== text;
  // lambi normal baatcheet ko item mat samjho (command ke saath ho toh chalega)
  const parsed = (wasCommand || body.split(/\s+/).length <= 5) ? parseAdd_(body) : null;
  if (parsed) {
    const o = addItem_(parsed, by);
    const dl = daysBetween_(today_(), o.expiry);
    const alertOn = addDays_(o.expiry, -Number(o.alertDays));
    return say_(chatId, '✅ Added <b>' + esc_(o.name) + '</b>' + (o.qty ? ' (' + esc_(o.qty) + ')' : '') + '\n' +
      '📅 Expires: ' + niceDate_(o.expiry) + ' (' + dayWord_(dl) + ')\n' +
      '🔔 Alert: ' + (alertOn <= today_() ? 'in today\'s ' + niceTime_() + ' alert' : niceDate_(alertOn)));
  }
  if (wasCommand) return say_(chatId, 'Didn\'t get that 🤔 Try:\n<code>atta 5kg 20/12/2026</code>');
  // baaki normal baatcheet ko ignore karo
}

function helpText_() {
  return '<b>How to use:</b>\n' +
    '➕ <code>atta 5kg 20/12/2026</code> — add an item\n' +
    '➕ <code>milk 1L 3d</code> — expires in 3 days\n' +
    '📦 <code>list</code> — full stock\n' +
    '⚠️ <code>expiring</code> — what expires soon\n' +
    '✔️ <code>finish atta</code> — used up, moves to shopping list\n' +
    '🛒 <code>shopping</code> — what to buy\n\n' +
    '<i>Dates can also be: 20/12, 20 dec, 2w, 6m, 1y</i>';
}

function activeSorted_() {
  return listItems_().filter(function (o) { return o.status === 'active' && isISO_(o.expiry); })
    .sort(function (a, b) { return a.expiry < b.expiry ? -1 : 1; });
}

function listText_() {
  const items = activeSorted_();
  if (!items.length) return 'Nothing in stock yet. Add something: <code>atta 5kg 20/12/2026</code>';
  const t = today_();
  return '📦 <b>Home stock (' + items.length + ')</b>\n\n' + items.map(function (o) {
    const dl = daysBetween_(t, o.expiry);
    const dot = dl < 0 ? '🔴' : dl <= Number(o.alertDays) ? '🟠' : '🟢';
    return dot + ' ' + esc_(o.name) + (o.qty ? ' · ' + esc_(o.qty) : '') + ' — ' + dayWord_(dl);
  }).join('\n');
}

function expiringText_() {
  const t = today_();
  const items = activeSorted_().filter(function (o) { return daysBetween_(t, o.expiry) <= Number(o.alertDays); });
  if (!items.length) return '🟢 All good, nothing is expiring soon.';
  return '⚠️ <b>Use soon</b>\n\n' + items.map(function (o) {
    return (daysBetween_(t, o.expiry) < 0 ? '🔴 ' : '🟠 ') + esc_(o.name) + ' — ' + dayWord_(daysBetween_(t, o.expiry));
  }).join('\n');
}

function shoppingText_() {
  const items = listItems_().filter(function (o) { return o.status === 'shopping'; });
  if (!items.length) return '🛒 Shopping list is empty.';
  return '🛒 <b>To buy (' + items.length + ')</b>\n\n' + items.map(function (o) { return '▫️ ' + esc_(o.name); }).join('\n');
}

function finishByName_(q) {
  const items = activeSorted_();
  const hit = items.filter(function (o) { return o.name.toLowerCase() === q; })[0] ||
    items.filter(function (o) { return o.name.toLowerCase().indexOf(q) >= 0; })[0];
  if (!hit) return 'Couldn\'t find "' + esc_(q) + '" in stock. Send <code>list</code> to check.';
  finishItem_(hit.id);
  return '✔️ <b>' + esc_(hit.name) + '</b> used up. Added to the shopping list 🛒';
}

function dayWord_(dl) {
  if (dl < -1) return 'expired ' + Math.abs(dl) + ' days ago';
  if (dl === -1) return 'expired yesterday';
  if (dl === 0) return 'expires today';
  if (dl === 1) return 'expires tomorrow';
  if (dl < 60) return dl + ' days left';
  return Math.round(dl / 30) + ' months left';
}

const MONTHS_ = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function niceDate_(iso) {
  const p = iso.split('-');
  return Number(p[2]) + ' ' + cap_(MONTHS_[Number(p[1]) - 1]) + (p[0] !== today_().slice(0, 4) ? ' ' + p[0] : '');
}

/**
 * "atta 5kg 20/12/2026" -> {name:'atta', qty:'5kg', expiry:'2026-12-20'}
 * Date na mile toh null (normal baatcheet ignore ho jaati hai).
 */
function parseAdd_(text, todayOverride) {
  const t = todayOverride || today_();
  let tokens = String(text).trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  let expiry = null;

  // aakhri 2 tokens (jaise "20 dec" ya "3 din") ya aakhri 1 token
  const two = tokens.slice(-2).join(' ');
  expiry = parseDate_(two, t);
  if (expiry) tokens = tokens.slice(0, -2);
  else {
    expiry = parseDate_(tokens[tokens.length - 1], t);
    if (expiry) tokens = tokens.slice(0, -1);
  }
  if (!expiry || !tokens.length) return null;

  let qty = '';
  const rest = [];
  tokens.forEach(function (tok, i) {
    const next = tokens[i + 1];
    if (!qty && /^\d+(\.\d+)?(kg|g|gm|gram|l|ltr|litre|liter|ml|pc|pcs|pkt|packet|dozen|dz|x)?$/i.test(tok) && i > 0) qty = tok;
    else if (qty && /^(kg|g|gm|gram|l|ltr|litre|liter|ml|pc|pcs|pkt|packet|packets|dozen)$/i.test(tok) && rest.length && qty.match(/^\d/)) qty += tok;
    else rest.push(tok);
  });
  const name = rest.join(' ').trim();
  if (!name) return null;
  return { name: name, qty: qty, expiry: expiry };
}

function parseDate_(s, t) {
  s = String(s).toLowerCase().trim();
  let m;
  // relative: 3din, 3 din, 2hafte, 6mahine, 1saal, 3d, 2w, 6m, 1y
  m = s.match(/^(\d+)\s*(din|day|days|d|hafta|hafte|week|weeks|w|mahina|mahine|month|months|m|saal|sal|year|years|y)$/);
  if (m) {
    const n = Number(m[1]); const u = m[2];
    if (/^(din|day|days|d)$/.test(u)) return addDays_(t, n);
    if (/^(hafta|hafte|week|weeks|w)$/.test(u)) return addDays_(t, n * 7);
    if (/^(mahina|mahine|month|months|m)$/.test(u)) return addMonths_(t, n);
    return addMonths_(t, n * 12);
  }
  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return mk_(Number(m[1]), Number(m[2]), Number(m[3]));
  // dd/mm/yyyy, dd-mm-yy, dd.mm
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]);
    if (m[3]) { let y = Number(m[3]); if (y < 100) y += 2000; return mk_(y, mo, d); }
    return nextOccurrence_(d, mo, t);
  }
  // 20 dec, 20dec, 20 december, 20 dec 2026
  m = s.match(/^(\d{1,2})\s*([a-z]{3,9})(?:\s*(\d{4}))?$/);
  if (m) {
    const mi = MONTHS_.indexOf(m[2].slice(0, 3));
    if (mi < 0) return null;
    if (m[3]) return mk_(Number(m[3]), mi + 1, Number(m[1]));
    return nextOccurrence_(Number(m[1]), mi + 1, t);
  }
  return null;
}

function mk_(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return y + '-' + pad_(mo) + '-' + pad_(d);
}
function nextOccurrence_(d, mo, t) {
  const y = Number(t.slice(0, 4));
  const a = mk_(y, mo, d);
  if (a && a >= t) return a;
  return mk_(y + 1, mo, d);
}
function addMonths_(iso, n) {
  const p = iso.split('-').map(Number);
  let y = p[0], mo = p[1] + n;
  y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12) + 1;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return y + '-' + pad_(mo) + '-' + pad_(Math.min(p[2], lastDay));
}

/* ------------------------------------------------------------------ */
/* ROZ KA ALERT                                                        */
/* ------------------------------------------------------------------ */
function sendDailyAlert_(force) {
  const chatId = PropertiesService.getScriptProperties().getProperty('CHAT_ID');
  if (!chatId) return false;
  const t = today_();
  const expired = [], warn = [], lastDay = [];
  activeSorted_().forEach(function (o) {
    const dl = daysBetween_(t, o.expiry);
    const ad = Number(o.alertDays) || 1;
    let changed = false;
    if (dl < 0) {
      if (!o.expiredNotified || force) { expired.push(o); o.expiredNotified = t; changed = true; }
    } else if (dl <= ad && !o.warned) {
      warn.push([o, dl]); o.warned = t; changed = true;
      if (dl <= 1) o.lastDayNotified = t;
    } else if (dl <= 1 && o.warned && !o.lastDayNotified) {
      lastDay.push([o, dl]); o.lastDayNotified = t; changed = true;
    } else if (force && dl <= ad) {
      warn.push([o, dl]);
    }
    if (changed) writeRow_(o);
  });
  if (!expired.length && !warn.length && !lastDay.length) return false;

  let msg = '🔔 <b>Kirana alert</b> · ' + niceDate_(t) + '\n';
  if (lastDay.length) {
    msg += '\n⏰ <b>Last day</b>\n' +
      lastDay.map(function (x) { return '• ' + esc_(x[0].name) + ' — ' + dayWord_(x[1]); }).join('\n') + '\n';
  }
  if (warn.length) {
    msg += '\n🟠 <b>Use soon</b>\n' +
      warn.map(function (x) { return '• ' + esc_(x[0].name) + (x[0].qty ? ' (' + esc_(x[0].qty) + ')' : '') + ' — ' + dayWord_(x[1]); }).join('\n') + '\n';
  }
  if (expired.length) {
    msg += '\n🔴 <b>Expired</b> (throw away or mark as used up)\n' +
      expired.map(function (o) { return '• ' + esc_(o.name) + ' — ' + dayWord_(daysBetween_(t, o.expiry)); }).join('\n') + '\n';
  }
  msg += '\n<i>Used something up? Send: finish &lt;item&gt;</i>';
  say_(chatId, msg);
  return true;
}
