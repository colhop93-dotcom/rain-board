/* Browser-only comparison. Values never feed board forecasts or trading. */
(function () {
  "use strict";
  var names = [
    ['best_match', "Best match (Open-Meteo's pick)"],
    ['ecmwf_ifs025', 'ECMWF (Europe, best 2 to 10 days)'],
    ['gfs_global', 'GFS (US global, own run)'], ['gfs_hrrr', 'HRRR (US, best 0 to 18 h)'],
    ['icon_seamless', 'ICON (Germany)'], ['gem_seamless', 'GEM (Canada)'],
    ['ncep_nbm_conus', 'NBM (US blend)'], ['ncep_nam_conus', 'NAM (US regional)']
  ];
  var ensembles = [
    ['ncep_gefs025', 'GEFS ensemble (US)'], ['ecmwf_ifs025', 'ECMWF ensemble (Europe)', 'ecmwf_ifs025_ensemble'],
    ['icon_seamless_eps', 'ICON ensemble (Germany)'], ['gem_global_ensemble', 'GEM ensemble (Canada)']
  ];
  var zones = {};
  [
    ['America/New_York', 'KATL KBOS KCMH KDCA KEWR KLEX KMIA KNYC KPHL KPVD KTTN KPIT KDTW'],
    ['America/Chicago', 'KAUS KORD KCLL KDFW KHOU KMSP KMKE KMSY KOKC KSAT'],
    ['America/Denver', 'KDEN'], ['America/Phoenix', 'KPHX'],
    ['America/Los_Angeles', 'KLAX KLAS KSEA KSFO']
  ].forEach(function (g) { g[1].split(' ').forEach(function (icao) { zones[icao] = g[0]; }); });
  var panel = document.getElementById('models-panel'), body = document.getElementById('models-body');
  var roster = [], tomorrow = null, cache = new Map(), attempts = new Map(), running = false, TTL = 30 * 60000;
  var HOUR = 3600000, DAY = 24 * HOUR, expanded = new Set();
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]; }); }
  function key(s) { return s.icao + ':' + s.lat + ':' + s.lon; }
  function marketWindow(s) {
    var zone = zones[s.icao];
    if (!zone) throw new Error('station zone unavailable');
    var now = new Date(), january = new Date(Date.UTC(now.getUTCFullYear(), 0, 15, 12));
    var parts = new Intl.DateTimeFormat('en-US', {timeZone:zone, year:'numeric', month:'2-digit',
      day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(january), p = {};
    parts.forEach(function (x) { p[x.type] = x.value; });
    var offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - january.getTime();
    var today = new Date(Date.now() + offset).toISOString().slice(0, 10);
    var day = new Date(Date.parse(today + 'T00:00:00Z') + DAY).toISOString().slice(0, 10);
    var start = Date.parse(day + 'T00:00:00Z') - offset;
    return {day:day, start:start, end:start + DAY, zone:zone};
  }
  function current(c, s) {
    if (!c || Date.now() - c.at >= TTL) return false;
    try { return c.day === marketWindow(s).day; } catch (_) { return true; }
  }
  function value(p, a) {
    if (p == null && a == null) return 'unavailable';
    return (typeof p === 'number' && isFinite(p) ? Math.round(p) + '%' : 'unavailable') + ' / '
      + (typeof a === 'number' && isFinite(a) ? a.toFixed(2) + ' in' : 'unavailable');
  }
  function board(s, w) {
    var rows = tomorrow && tomorrow.stations || {};
    var r = rows[s.city] || Object.keys(rows).map(function (k) { return rows[k]; }).find(function (x) { return x.icao === s.icao; });
    if (!w || !r || r.day !== w.day || !Array.isArray(r.window_utc)
        || Date.parse(r.window_utc[0]) !== w.start || Date.parse(r.window_utc[1]) !== w.end) return 'unavailable';
    var n = r.nws || {};
    return value(n.peak_pop, n.qpf_in);
  }
  function cell(label, text, attr) {
    return '<div class="model-cell"' + (attr || '') + '><b>' + esc(label) + '</b><span>' + esc(text)
      + '</span></div>';
  }
  function timeline(d, w, pending) {
    var title = 'Hourly rain in the ensembles (display only)';
    if (!w) return '<p class="note">' + title + ': unavailable</p>';
    var clock = new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago', hour:'numeric', hour12:true});
    var cells = [];
    for (var n = 0; n < 24; n++) {
      var start = w.start + n * HOUR, end = start + HOUR, label = clock.format(new Date(start)) + ' CT';
      var v = !pending && d && d.hourly && d.hourly[n], valid = v && v.wet !== null;
      var count = v && v.count, share = valid ? Math.round(v.wet / count * 100) : null;
      var text = valid ? v.wet + ' of ' + count + ' runs wet (' + share + '%)'
        : 'unavailable (' + (count ? count + ' runs; incomplete data' : 'run count unavailable') + ')';
      var local = new Intl.DateTimeFormat('en-US', {timeZone:w.zone, hour:'numeric', hour12:true}).format(new Date(start));
      var detail = label + ': ' + text + '. Station-local hour ' + local + ' (' + w.zone + ')' + '. UTC ' + new Date(start).toISOString() + ' to ' + new Date(end).toISOString();
      cells.push('<button type="button" class="ensemble-hour" data-hour="' + n + '" data-utc-start="'
        + new Date(start).toISOString() + '" data-utc-end="' + new Date(end).toISOString()
        + '" data-detail="' + esc(detail) + '" data-share="' + (valid ? Math.floor(share / 25) : 'unavailable')
        + '" title="' + esc(detail) + '" aria-label="' + esc(detail) + '"><b>' + esc(label)
        + '</b><span>' + (valid ? v.wet + ' of ' + count : 'unavailable') + '</span><small>'
        + (valid ? share + '%' : count ? 'of ' + count + ' runs' : 'runs unknown') + '</small></button>');
    }
    return '<div class="ensemble-timeline"><p class="note">' + title + '. Hours shown in CT (America/Chicago).</p><div class="ensemble-hours">'
      + cells.join('') + '</div><p class="note ensemble-hour-detail" aria-live="polite">Tap or hover an hour for run counts and its UTC window.</p></div>';
  }
  function draw() {
    if (!roster.length) { body.textContent = 'Station data unavailable. Reopen after the board loads.'; return; }
    body.innerHTML = '<p class="note model-qualification">Unmeasured on our gauges. Tap a station for amounts and hourly evidence. Spread compares available deterministic hourly peaks only.</p>' + roster.map(function (s) {
      var c = cache.get(key(s)), attempt = attempts.get(key(s)), pending = !current(c, s) && !attempt, d = (attempt || c) && (attempt || c).data, w = null;
      try { w = marketWindow(s); } catch (_) { /* Unknown zones have no numbers. */ }
      var cols = cell('Board (Tomorrow NWS)', board(s, w));
      names.forEach(function (m) {
        var v = d && d.values[m[0]];
        cols += cell(m[1], pending ? 'waiting' : v ? value(v[0], v[1]) : 'unavailable', ' data-model="' + m[0] + '"');
      });
      ensembles.forEach(function (m) {
        var v = d && d.ensemble[m[0]];
        cols += cell(m[1], pending ? 'waiting' : v ? v.wet + ' of ' + v.count + ' members ('
          + Math.round(v.wet / v.count * 100) + '%) / median ' + v.median.toFixed(2) + ' in' : 'unavailable',
          ' data-ensemble="' + m[0] + '"');
      });
      var note = w ? w.day + ', market standard-time day (' + w.zone + '). UTC window '
        + new Date(w.start).toISOString() + ' to ' + new Date(w.end).toISOString() + '.' : 'Market window unavailable.';
      note += attempt ? ' ' + attempt.status + (c ? '; previous complete fetch ' + new Date(c.at).toISOString() : '') : pending ? ' Waiting for Open-Meteo; reopen to refresh expired data.' : ' Fetched ' + new Date(c.at).toISOString() + '.';
      var peaks = [], chances = '<span class="model-chance">NWS ' + esc(board(s, w).split(' / ')[0]) + '</span>';
      names.forEach(function (m) {
        var v = d && d.values[m[0]], p = v && v[0];
        if (typeof p === 'number' && isFinite(p)) peaks.push(p);
        var short = {best_match:'Best',ecmwf_ifs025:'ECMWF',gfs_global:'GFS',gfs_hrrr:'HRRR',icon_seamless:'ICON',gem_seamless:'GEM',ncep_nbm_conus:'NBM',ncep_nam_conus:'NAM'}[m[0]];
        chances += '<span class="model-chance" title="' + esc(m[1]) + '">' + short + ' ' + (pending ? 'waiting' : typeof p === 'number' && isFinite(p) ? Math.round(p) + '%' : 'n/a') + '</span>';
      });
      ensembles.forEach(function (m) {
        var v = d && d.ensemble[m[0]];
        chances += '<span class="model-chance" title="' + esc(m[1]) + ' member share">' + m[1].split(' ')[0] + ' ens ' + (pending ? 'waiting' : v ? Math.round(v.wet / v.count * 100) + '%' : 'n/a') + '</span>';
      });
      var spread = !pending && peaks.length > 1 ? Math.round(Math.max.apply(null, peaks) - Math.min.apply(null, peaks)) + ' pts' : 'unavailable';
      var age = c && !attempt ? Math.max(0, Math.floor((Date.now() - c.at) / 60000)) + ' min ago' : attempt ? attempt.status : 'waiting';
      return '<details class="model-station" data-model-station="' + esc(s.icao) + '"' + (expanded.has(s.icao) ? ' open' : '') + '><summary><b>' + esc(s.city) + '</b><span class="model-chances">' + chances + '</span><small>Spread ' + spread + ' | Open-Meteo ' + esc(age) + '; NWS ' + (tomorrow && tomorrow.generated_utc ? Math.max(0, Math.floor((Date.now() - Date.parse(tomorrow.generated_utc)) / 60000)) + ' min ago' : 'age unknown') + '</small></summary><p class="note">'
        + esc(note) + '</p><div class="model-columns">' + cols + '</div>' + timeline(d, w, pending) + '</details>';
    }).join('');
  }
  function indices(j, w) {
    var h = j && j.hourly;
    if (!h || !Array.isArray(h.time)) return null;
    var result = [];
    // Precipitation and its probability describe the preceding hour, ending at time.
    for (var t = w.start + HOUR; t <= w.end; t += HOUR) {
      var stamp = new Date(t).toISOString().slice(0, 16), i = h.time.indexOf(stamp);
      if (i < 0 || h.time.lastIndexOf(stamp) !== i) return null;
      result.push(i);
    }
    return result;
  }
  function aggregate(a, idx, probability) {
    if (!Array.isArray(a) || !idx) return null;
    var values = idx.map(function (i) { return a[i]; });
    if (values.some(function (v) { return typeof v !== 'number' || !isFinite(v) || v < 0 || (probability && v > 100); })) return null;
    // Remove floating point addition noise at the 0.01 inch member threshold.
    return probability ? Math.max.apply(null, values) : Math.round(values.reduce(function (sum, v) { return sum + v; }, 0) * 1e9) / 1e9;
  }
  function deterministic(j, w) {
    var idx = indices(j, w), h = j && j.hourly || {}, values = {};
    names.forEach(function (m) {
      values[m[0]] = [aggregate(h['precipitation_probability_' + m[0]], idx, true),
        aggregate(h['precipitation_' + m[0]], idx, false)];
    });
    return values;
  }
  function ensemble(j, w) {
    var idx = indices(j, w), h = j && j.hourly || {}, values = {};
    ensembles.forEach(function (m) {
      // The unsuffixed member field is the control run. Count it once.
      // ECMWF's request alias returns the canonical ensemble suffix.
      var keys = memberKeys(h, m);
      var totals = keys.map(function (k) { return aggregate(h[k], idx, false); });
      // Do not turn incomplete members into dry votes or silently shrink the denominator.
      if (!totals.length || totals.some(function (v) { return v === null; })) { values[m[0]] = null; return; }
      totals.sort(function (a, b) { return a - b; });
      var mid = Math.floor(totals.length / 2);
      values[m[0]] = {count:totals.length, wet:totals.filter(function (v) { return v >= 0.01; }).length,
        median:totals.length % 2 ? totals[mid] : (totals[mid - 1] + totals[mid]) / 2};
    });
    return values;
  }
  function memberKeys(h, m) {
    var pattern = new RegExp('^precipitation(?:_member[0-9]+)?_' + (m[2] || m[0]) + '$');
    return Object.keys(h).filter(function (k) { return pattern.test(k); });
  }
  function hourlyEnsemble(j, w) {
    var h = j && j.hourly || {}, units = j && j.hourly_units;
    // Unit metadata also declares members whose entire value array may be missing.
    var fields = Object.assign({}, units || {}, h);
    var groups = ensembles.map(function (m) { return memberKeys(fields, m); });
    var complete = groups.every(function (g) { return g.length > 0; });
    var keys = [].concat.apply([], groups), count = complete ? keys.length : null, result = [];
    for (var end = w.start + HOUR; end <= w.end; end += HOUR) {
      var stamp = new Date(end).toISOString().slice(0, 16);
      var i = Array.isArray(h.time) ? h.time.indexOf(stamp) : -1;
      var valid = complete && i >= 0 && h.time.lastIndexOf(stamp) === i && j.timezone === 'GMT';
      var wet = 0;
      keys.forEach(function (k) {
        var v = Array.isArray(h[k]) ? h[k][i] : null;
        if (typeof v !== 'number' || !isFinite(v) || v < 0 || (units && units[k] !== 'inch')) valid = false;
        else if (v >= 0.01) wet++;
      });
      result.push({count:count, wet:valid ? wet : null});
    }
    return result;
  }
  async function fetchJSON(url, s) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 15000);
      var delay = null;
      try {
        var r = await fetch(url, {signal:ctl.signal});
        if (r.status === 429 && attempt === 0) {
          var header = r.headers.get('Retry-After'), seconds = header && Number(header);
          delay = header ? (isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(header) - Date.now())) : 25000;
          if (!isFinite(delay)) delay = 25000;
          delay = Math.max(250, delay);
          attempts.set(key(s), {data:null, status:'unavailable, retrying'}); draw();
        } else {
          if (r.status !== 200) return null;
          return await r.json();
        }
      } catch (_) { return null; } finally { clearTimeout(timer); }
      await new Promise(function (resolve) { setTimeout(resolve, delay); });
      if (!panel.open) return null;
    }
    return null;
  }
  function pause() { return new Promise(function (resolve) { setTimeout(resolve, 250); }); }
  async function request(s) {
    var result = {at:Date.now(), data:null}, w;
    try {
      w = marketWindow(s); result.day = w.day;
      if (s.lat == null || s.lon == null || !isFinite(+s.lat) || !isFinite(+s.lon)) throw new Error('coordinates unavailable');
      var common = {latitude:s.lat, longitude:s.lon, timezone:'GMT', forecast_days:'3', precipitation_unit:'inch'};
      var query = new URLSearchParams(Object.assign({}, common, {hourly:'precipitation,precipitation_probability',
        models:names.map(function (m) { return m[0]; }).join(',')}));
      var j = await fetchJSON('https://api.open-meteo.com/v1/forecast?' + query, s);
      var forecastOK = !!(j && j.timezone === "GMT" && indices(j, w));
      result.data = {values:deterministic(j, w), ensemble:{}};
      await pause();
      if (panel.open) {
        query = new URLSearchParams(Object.assign({}, common, {hourly:'precipitation',
          models:ensembles.map(function (m) { return m[0]; }).join(',')}));
        j = await fetchJSON('https://ensemble-api.open-meteo.com/v1/ensemble?' + query, s);
        result.data.ensemble = ensemble(j, w);
        result.data.hourly = hourlyEnsemble(j, w);
      } else {
        // A close interrupted this station. Reopen may finish it on a new pass.
        return;
      }
    } catch (_) { result.data = null; }
    result.at = Date.now();
    var complete = forecastOK && result.data && names.every(function (m) { return result.data.values[m[0]][1] !== null; })
      && ensembles.every(function (m) { return !!result.data.ensemble[m[0]]; })
      && result.data.hourly && result.data.hourly.every(function (h) { return h.wet !== null; });
    if (complete) { cache.set(key(s), result); attempts.delete(key(s)); }
    else { result.status = 'unavailable (Open-Meteo busy), reopen to retry'; attempts.set(key(s), result); }
  }
  async function load() {
    if (running || !panel.open) return;
    running = true;
    try {
      attempts.clear(); draw();
      for (var i = 0; i < roster.length && panel.open; i++) {
        var s = roster[i];
        if (current(cache.get(key(s)), s)) continue;
        await request(s); draw();
        // One in flight, with a pause between requests. Closing stops the pass.
        await pause();
      }
    } finally { running = false; }
  }
  panel.addEventListener('toggle', function () { if (panel.open) load(); });
  body.addEventListener('toggle', function (ev) {
    if (!ev.target.isConnected || !ev.target.matches('.model-station')) return;
    var id = ev.target.dataset.modelStation;
    if (ev.target.open) expanded.add(id); else expanded.delete(id);
  }, true);
  ['click', 'mouseover', 'focusin'].forEach(function (event) {
    body.addEventListener(event, function (ev) {
      var button = ev.target.closest('.ensemble-hour');
      if (button) button.closest('.ensemble-timeline').querySelector('.ensemble-hour-detail').textContent = button.dataset.detail;
    });
  });
  window.RainModelPanel = {update:function (rows, next) {
    var wasEmpty = !roster.length;
    roster = rows || []; tomorrow = next;
    // Ordinary board refreshes update displayed data, never schedule API refreshes.
    if (panel.open) { draw(); if (wasEmpty && roster.length) load(); }
  }};
})();
