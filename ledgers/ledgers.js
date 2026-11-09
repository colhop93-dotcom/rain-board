// Paints data ages, the STALE banner and dry-NO's 10-minute cutoff. The inline bootstrap in each page's <head> polls
// feed.json, owns the version check and the reload retries, and hands each good read to window.ledgersPaint. This
// script re-measures on its own 15 s timer from the last good read against this browser's clock, so a hung or
// failing request can never keep stale money on screen. Nothing is stored on the device.
(function () {
  var STALE_S = 900, SKEW_S = 120, CHECK_MS = 15000, root = document.documentElement, last = window.LEDGERS_FEED || null;
  var PAGE = (document.querySelector('meta[name="ledgers-page"]') || {}).content || null;
  var VERSION = (document.querySelector('meta[name="ledgers-version"]') || {}).content || null;
  function ago(s) {
    if (s == null || !isFinite(s)) return 'unknown';
    if (s < 0) s = 0;
    if (s < 90) return Math.round(s) + ' s';
    if (s < 5400) return Math.round(s / 60) + ' min';
    if (s < 172800) return (s / 3600).toFixed(1) + ' h';
    return Math.round(s / 86400) + ' days';
  }
  function since(utc) { var t = Date.parse(utc); return isNaN(t) ? null : (Date.now() - t) / 1000; }
  function paint() {
    if (root.classList.contains('retired')) { root.classList.remove('ok'); return; }   // the bootstrap's notice stands
    var feed = last, banner = document.getElementById('stale'), outdated = root.classList.contains('outdated');
    var age = feed && feed.generated_utc ? since(feed.generated_utc) : null;
    var ahead = age != null && age < -SKEW_S;               // stamped in the future: a clock fault, never fresh
    var fa = document.getElementById('feedage');
    if (fa) fa.textContent = age == null ? '(age unknown)' : ahead ? '(stamped in the future)' : '(' + ago(age) + ' ago)';
    if (feed && feed.asof_ct && !outdated) { var a = document.getElementById('asof'); if (a) a.textContent = feed.asof_ct; }
    // STALE, money hidden: no good read, an unreadable feed, the server's own stale flag, a future stamp, or 15 minutes old
    var moved = !!(feed && feed.stale_pages && PAGE && feed.stale_pages.indexOf(PAGE) >= 0);   // ledger moved, page not rebuilt
    var confirmed = !!(feed && feed.pages && PAGE && VERSION && feed.pages[PAGE] === VERSION);   // this very page is current
    var stale = outdated || moved || !feed || feed.ok === false || feed.stale === true || age == null || ahead || age >= STALE_S;
    root.classList.toggle('stale', stale && !outdated);
    // the money starts hidden (inline style html:not(.ok) .m) and shows only after a good, fresh read confirms this page
    root.classList.toggle('ok', !stale && confirmed);
    if (banner) {
      banner.hidden = !stale;
      banner.textContent = outdated ? 'STALE: a newer version of this page exists and is loading. Its money is hidden until it arrives.' :
        moved ? 'STALE: this ledger has changed and its page has not been rebuilt yet. The money is hidden until it is.' :
        stale ? 'STALE: the bots feed ' + (!feed || age == null || feed.ok === false ? 'cannot be read' : ahead ? 'is stamped in the future' :
        age >= STALE_S ? 'is ' + ago(age) + ' old' : 'was already out of date when it was published') +
        '. The money is hidden until a fresh feed arrives.' : '';
    }
    var cells = document.querySelectorAll('.age[data-bot]');
    for (var i = 0; i < cells.length; i++) {
      var b = feed && feed.bots && feed.bots[cells[i].getAttribute('data-bot')];
      var s = b && b.fresh_utc ? since(b.fresh_utc) : null;
      cells[i].textContent = s == null ? 'unknown' : ago(s) + (stale ? ' (STALE)' : '');
    }
    var scans = document.querySelectorAll('.scan[data-bot]');
    for (var k = 0; k < scans.length; k++) {
      var sb = feed && feed.bots && feed.bots[scans[k].getAttribute('data-bot')];
      var t = sb && sb.fresh_utc ? new Date(sb.fresh_utc) : null;
      scans[k].textContent = t && !isNaN(t) ? t.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit' }) + ' CT (' + ago(since(sb.fresh_utc)) + ' ago)' : 'unknown';
    }
  }
  function gate() {
    var els = document.querySelectorAll('[data-fresh-bot]');
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute('data-fresh-bot'), max = +els[i].getAttribute('data-fresh-max');
      var b = last && last.bots && last.bots[key];
      var s = b && b.fresh_utc ? since(b.fresh_utc) : null;
      var ok = s != null && s >= -120 && s <= max;          // unknown freshness withholds, never shows
      els[i].hidden = !ok;
      var notes = document.querySelectorAll('[data-stale-for="' + key + '"]');
      for (var j = 0; j < notes.length; j++) notes[j].hidden = ok;
    }
  }
  function relative() {
    var rel = document.querySelectorAll('.ago[data-utc]');
    for (var j = 0; j < rel.length; j++) { var s = since(rel[j].getAttribute('data-utc')); rel[j].textContent = s == null ? '' : '(' + ago(s) + ' ago)'; }
  }
  function check() { relative(); paint(); gate(); }
  window.ledgersPaint = function (feed) { if (feed && typeof feed === 'object') last = feed; check(); };
  window.ledgersCheck = check;
  relative();
  if (last) check();                     // the page as built already applied every cutoff; the first check follows the first read
  setInterval(check, CHECK_MS);
})();
