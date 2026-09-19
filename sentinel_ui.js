/* Numeric display adapter. Reuse the board's existing loader and minute tick.

   2026-09-18 (Colin): the Rain Sentinel is the intended forecaster, and it has NO validated
   probability yet. So the board shows its live readings and a plain status line, and never a
   Sentinel percentage unless the feed itself carries a VALIDATED forecast with its model identity
   and an unexpired issue window (the same gate lines() has always used). Everything here is
   rendered as plain text: feed strings never reach innerHTML. */
(function (root) {
  "use strict";
  var SCHEMA = "rain-sentinel.board/1";
  function time(s) { return typeof s === "string" && /(Z|[+-]\d\d:\d\d)$/.test(s) ? Date.parse(s) : NaN; }
  function finite(x) { return typeof x === "number" && Number.isFinite(x); }
  function accept(previous, incoming, now) {
    now = now === undefined ? Date.now() : now;
    if (!incoming || incoming.schema !== SCHEMA || incoming.synthetic !== false ||
        incoming.actionable !== false || !/^[a-f0-9]{24}$/.test(incoming.run_id || "") ||
        !Number.isFinite(time(incoming.generated_utc)) || time(incoming.generated_utc) > now) return previous;
    var old = previous ? time(previous.generated_utc) : -Infinity, next = time(incoming.generated_utc);
    if (old > now) old = -Infinity;
    if (next < old || next === old && incoming.run_id !== previous.run_id) return previous;
    return incoming;
  }
  function usable(m, now) {
    return m && m.status === "OK" && finite(m.value) &&
      time(m.observed_utc) <= time(m.available_utc) && time(m.available_utc) <= now && now < time(m.expires_utc);
  }
  // A Sentinel probability is shown only through this gate: validated status, a model identity, a
  // fraction in range and an unexpired issue window. NOT_READY, RESEARCH or a null p_yes never pass.
  function validated(f, now) {
    return !!(f && f.status === "VALIDATED" && f.model_id && finite(f.p_yes) && f.p_yes >= 0 && f.p_yes <= 1 &&
      time(f.issued_utc) <= now && now < time(f.expires_utc));
  }
  // The feed-level refusals, in the words lines() has always used.
  function feedProblem(feed, now) {
    if (!feed || feed.schema !== SCHEMA || feed.actionable !== false) return "Sentinel: awaiting data";
    if (feed.synthetic !== false) return "Sentinel: synthetic demonstration, not live weather";
    if (!(time(feed.generated_utc) <= now && now < time(feed.expires_utc)))
      return "Sentinel: stale or invalid feed; waiting for an update";
    return null;
  }
  // Adapt local_day only after confirming it is this contract's day in the live repo.
  function currentRow(feed, station, now) {
    var row = feed && feed.stations && feed.stations[station.icao];
    if (!row || row.station_id !== station.icao || row.station_day !== station.local_day ||
        !(time(row.contract_start_utc) <= time(row.as_of_utc) && time(row.as_of_utc) <= now &&
          now < time(row.contract_end_utc) && now - time(row.as_of_utc) <= 300000)) return null;
    return row;
  }
  // [feed key, station-page label, decimals, board label]
  var FIELDS = [
    ["reported_day_amount_in", "Reported contract-day amount", 3, "Gauge, contract-day amount"],
    ["radar_rate_mm_h", "Radar estimate at verified station site", 2, "Radar rain rate at the gauge"],
    ["radar_quality_index", "Radar quality index (not probability)", 2, "Radar quality (0 to 1, not a probability)"],
    ["radar_scenario_median_30m_mm", "Next 30 min radar scenario median", 2, "Next 30 min radar scenario median"],
    ["radar_scenario_median_60m_mm", "Next 60 min radar scenario median", 2, "Next 60 min radar scenario median"],
    ["relative_humidity_pct", "Relative humidity", 0, "Humidity"],
    ["wind_speed_m_s", "Surface wind speed", 1, "Wind"]
  ];
  function lines(feed, station, now, fetchFailed) {
    now = now === undefined ? Date.now() : now;
    var problem = feedProblem(feed, now);
    if (problem) return [problem];
    var row = currentRow(feed, station, now);
    if (!row) return ["Sentinel: no current result for this station and contract day"];
    var out = [], f = row.forecast || {}, m = row.metrics || {};
    if (fetchFailed) out.push("Sentinel refresh failed; showing the previous result with its original ages");
    if (validated(f, now))
      out.push("Sentinel: " + Math.round(100 * f.p_yes) + "% chance of reaching " + row.threshold_inches + " in by the cutoff");
    else out.push("EXPERIMENTAL Sentinel probability: unavailable (no validated weather model)");
    FIELDS.forEach(function (spec) {
      var item = m[spec[0]];
      if (!item) return;
      if (usable(item, now)) {
        var age = Math.max(0, Math.floor((now - time(item.observed_utc)) / 60000));
        out.push(spec[1] + ": " + item.value.toFixed(spec[2]) + " " + item.unit +
          " | " + item.source + " | " + age + " min old");
      } else out.push(spec[1] + ": unavailable" + (item.reason ? " (" + item.reason + ")" : " (stale or invalid)"));
    });
    if (m.radar_scenario_median_30m_mm || m.radar_scenario_median_60m_mm)
      out.push("Radar scenarios are uncalibrated estimates; the gauge confirms rainfall.");
    if (row.reasons && row.reasons.length) out.push(row.reasons.join("; "));
    return out;
  }
  function render(element, feed, station, options) {
    if (!element) return;
    options = options || {};
    var result = lines(feed, station, options.now, options.fetchFailed);
    if (options.compact) result = result.slice(0, options.fetchFailed ? 3 : 2);
    // Plain text: data cannot inject markup, event handlers or links.
    var text = result.join("\n");
    if (element.textContent !== text) element.textContent = text;
  }

  /* ---------------- the board-level panel at the top of the main page ---------------- */

  function words(x) { return String(x === null || x === undefined ? "" : x).replace(/_/g, " "); }
  // The training day count is printed only when a feed carries it as a whole number. No writer
  // publishes it today, so the sentence is said without a number: it is never estimated here.
  function trainingDays(feed) {
    var t = feed && feed.training, n = t && t.independent_dates;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
  }
  function statusLine(feed, stations, now) {
    now = now === undefined ? Date.now() : now;
    var list = stations || [], n = 0;
    if (!feedProblem(feed, now)) list.forEach(function (s) { var row = currentRow(feed, s, now); if (row && validated(row.forecast, now)) n++; });
    var head = n ? "Rain Sentinel forecast: validated for " + n + " of " + list.length + " stations right now; each station below says which."
                 : "Rain Sentinel forecast: not available yet.";
    var days = feed && feed.schema === SCHEMA && feed.synthetic === false ? trainingDays(feed) : null;
    return head + (days === null ? " Training data: being collected; no feed publishes the day count yet."
                                 : " Training data: " + days + " independent days collected.");
  }
  function metricText(spec, item, now) {
    if (!item) return spec[3] + ": unavailable (not in this feed)";
    if (usable(item, now)) {
      var age = Math.max(0, Math.floor((now - time(item.observed_utc)) / 60000));
      return spec[3] + ": " + item.value.toFixed(spec[2]) + " " + item.unit + " (" + item.source + ", " + age + " min old)";
    }
    return spec[3] + ": unavailable (" + (item.reason ? words(item.reason) : "stale or invalid") + ")";
  }
  function feedWhy(feed, now) {
    if (!feedProblem(feed, now)) return null;
    if (!feed || feed.schema !== SCHEMA || feed.actionable !== false) return "Live readings unavailable: the Sentinel feed did not load or is not a Sentinel board feed.";
    if (feed.synthetic !== false) return "Live readings withheld: this feed is a synthetic demonstration, not live weather.";
    var exp = time(feed.expires_utc), gen = time(feed.generated_utc);
    if (Number.isFinite(gen) && gen > now) return "Live readings unavailable: the feed's generation time is in the future.";
    return "Live readings unavailable: the feed is stale" + (Number.isFinite(exp) && exp <= now ? ", it expired " + Math.round((now - exp) / 60000) + " min ago" : "") + "; waiting for an update.";
  }
  // Built as data first, so an unchanged tick does not rebuild the DOM.
  function boardModel(feed, stations, now, fetchFailed) {
    now = now === undefined ? Date.now() : now;
    var model = { notes: [], rows: [] }, why = feedWhy(feed, now), list = stations || [];
    if (why) { model.notes.push(why); return model; }
    if (fetchFailed) model.notes.push("Sentinel refresh failed; showing the previous readings with their original ages.");
    var current = list.map(function (s) { return currentRow(feed, s, now); });
    // a reason every current station carries is said once, above the rows
    var live = current.filter(Boolean), common = [];
    if (live.length) (live[0].reasons || []).forEach(function (r) { if (live.every(function (x) { return (x.reasons || []).indexOf(r) >= 0; })) common.push(r); });
    common.forEach(function (r) { model.notes.push("Every station: " + words(r)); });
    model.notes.push("Radar scenarios are uncalibrated estimates; the gauge confirms rainfall.");
    list.forEach(function (s, i) {
      var row = current[i], out = [];
      if (!row) out.push("no current result for this station and contract day");
      else {
        var f = row.forecast || {}, m = row.metrics || {};
        if (validated(f, now)) out.push("Sentinel: " + Math.round(100 * f.p_yes) + "% chance of reaching " + row.threshold_inches + " in by the cutoff (validated model " + String(f.model_id).slice(0, 12) + ")");
        FIELDS.forEach(function (spec) { out.push(metricText(spec, m[spec[0]], now)); });
        (row.reasons || []).forEach(function (r) { if (common.indexOf(r) < 0) out.push("Note: " + words(r)); });
      }
      model.rows.push({ icao: s.icao, city: s.city || s.icao, lines: out });
    });
    return model;
  }
  function node(tag, cls, text, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  /* 2026-09-18 (Colin, on his phone): the panel used to print seven lines for every one of the
     22 stations, about 150 lines and 9.7 phone screens before V3, with "unavailable" 110 times on
     the page. The live signal is one number per station. So the panel leads with ONE compact
     table of the readings that are actually live, stations with radar rain first, and the full
     per-station field list moves behind a tap. Nothing is dropped: every field and every
     unavailable reason is still one tap away, and every value is still text, never markup. */
  function boardTable(feed, stations, now) {
    now = now === undefined ? Date.now() : now;
    var out = [], list = stations || [];
    if (feedProblem(feed, now)) return out;
    list.forEach(function (s) {
      var row = currentRow(feed, s, now), r = { icao: s.icao, city: s.city || s.icao, ok: !!row, rate: null, rh: null, wind: null, p: null };
      if (row) {
        var m = row.metrics || {}, f = row.forecast || {};
        var val = function (k) { var it = m[k]; return usable(it, now) ? it.value : null; };
        r.rate = val("radar_rate_mm_h"); r.rh = val("relative_humidity_pct"); r.wind = val("wind_speed_m_s");
        if (validated(f, now)) r.p = Math.round(100 * f.p_yes);
      }
      out.push(r);
    });
    // radar rain at the gauge first, heaviest first; then everyone else in the board's order
    out.forEach(function (r, i) { r._i = i; });
    out.sort(function (a, b) {
      var aw = a.rate > 0, bw = b.rate > 0;
      if (aw !== bw) return aw ? -1 : 1;
      if (aw && bw && a.rate !== b.rate) return b.rate - a.rate;
      return a._i - b._i;
    });
    out.forEach(function (r) { delete r._i; });
    return out;
  }
  function rainText(r) {
    if (r.rate === null) return "-";
    return r.rate > 0 ? r.rate.toFixed(2) + " mm/h" : "none";
  }
  function renderBoard(element, feed, stations, options) {
    if (!element) return;
    options = options || {};
    var now = options.now;
    var model = boardModel(feed, stations, now, options.fetchFailed);
    var table = boardTable(feed, stations, now);
    var sig = JSON.stringify([model, table]);
    if (element.__sentinelSig === sig) return;
    element.__sentinelSig = sig;
    element.replaceChildren();
    model.notes.forEach(function (n) { node("p", "sen-note", n, element); });
    if (!model.rows.length) return;

    var wet = table.filter(function (r) { return r.rate > 0; }).length;
    node("p", "sen-summary", wet
      ? "Radar sees rain at " + wet + " of " + table.length + " gauges right now (top of the table)."
      : "Radar sees no rain at any of the " + table.length + " gauges right now.", element);

    var anyP = table.some(function (r) { return r.p !== null; });
    var t = node("table", "sc sen-table", undefined, element);
    var hr = node("tr", "", undefined, node("thead", "", undefined, t));
    ["Station", "Radar rain now", "Humidity", "Wind"].concat(anyP ? ["Sentinel"] : []).forEach(function (h) { node("th", "", h, hr); });
    var tb = node("tbody", "", undefined, t);
    table.forEach(function (r) {
      var tr = node("tr", r.rate > 0 ? "sen-wet" : "", undefined, tb);
      tr.setAttribute("data-sentinel-board", r.icao);
      var c = node("td", "sen-city", undefined, tr); node("b", "", r.city, c); c.title = r.icao;
      node("td", "", r.ok ? rainText(r) : "no data", tr);
      node("td", "", r.rh === null ? "-" : Math.round(r.rh) + "%", tr);
      node("td", "", r.wind === null ? "-" : Math.round(r.wind * 2.23694) + " mph", tr);
      if (anyP) node("td", "", r.p === null ? "-" : r.p + "%", tr);
    });

    // the complete field list, every unavailable reason included, one tap away
    var d = node("details", "sen-all", undefined, element);
    node("summary", "", "All Sentinel fields, every station", d);
    var grid = node("div", "sen-grid", undefined, d);
    model.rows.forEach(function (r) {
      var box = node("div", "sen-st", undefined, grid);
      var name = node("div", "sen-name", undefined, box);
      node("b", "", r.city, name); node("small", "", " " + r.icao, name);
      var ul = node("ul", "", undefined, box);
      r.lines.forEach(function (x) { node("li", "", x, ul); });
    });
  }
  var api = { lines: lines, render: render, usable: usable, accept: accept, validated: validated,
    statusLine: statusLine, boardModel: boardModel, boardTable: boardTable, renderBoard: renderBoard };
  root.RainSentinelUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
