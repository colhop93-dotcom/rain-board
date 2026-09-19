(function () {
  "use strict";
  var DATA = "../data/";
  var state = null, settle = null, physics3 = null, physics3Failed = false;
  // The file the last refresh actually returned, kept so a refused file can say WHY it was refused
  // when nothing earlier was ever accepted (there is then nothing "retained" to point at).
  var physics3Latest = null;
  var sentinel = null, sentinelFailed = false;
  /* WHAT THIS PAGE IS, said once and printed in the header (Colin, 2026-09-18: "switch alerts to
     v3"). v3 is the model the phone alerts use, the working forecast and the backup until the Rain
     Sentinel is validated. Its live record is UNMEASURED, so every v3 number, edge and direction
     on this page carries that word. */
  var V3_ROLE = "the model the phone alerts use";
  var V3_RECORD = "record UNMEASURED";
  var lastLoadOk = 0, loading = null;

  var DEF3 = RainModels.DEFS.v3; // The definition for v3 is in models.js

  function fetchJSON(url) {
    var c = new AbortController(), t = setTimeout(function() {c.abort();},12000);
    return fetch(DATA + url + "?t=" + Date.now(), {signal:c.signal,cache:"no-store"}).then(function(r) {
      if(!r.ok) throw new Error(r.status); return r.json();
    }).finally(function() {clearTimeout(t);});
  }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function pct(n) { return Math.round(n) + '%'; }

  var PRICE_MAX_AGE_MS = 7 * 60000; // Collector cadence plus the same slack as board_alerts.py.
  function priceFor(s, day, nowMs) {
    var m = s.market || {}, stamp = RainEvidence.parseIso(m.fetched_utc);
    var age = isNaN(stamp) ? null : nowMs - stamp;
    var out = {bid: null, ask: null, edge: null, noEdge: null, advantage: null, direction: "no edge", reason: null,
      ticker: m.ticker || "ticker unavailable", source: "Kalshi market endpoint via state.json",
      age: age === null ? "price age unknown" : age < 0 ? "price timestamp in the future" : "price age " + Math.floor(age / 1000) + " s"};
    var parts = /^KXRAIN-(\d{2})([A-Z]{3})(\d{2})-([A-Z]+)$/.exec(m.ticker || "");
    var months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    var month = parts ? months.indexOf(parts[2]) + 1 : 0;
    var tickerDay = parts && month ? "20" + parts[1] + "-" + String(month).padStart(2, "0") + "-" + parts[3] : null;
    if (age === null) out.reason = "missing price timestamp";
    else if (age < 0 || age > PRICE_MAX_AGE_MS) out.reason = "STALE: " + (age < 0 ? "future timestamp" : "older than 7 minutes");
    else if (tickerDay !== day || !parts || parts[4] !== s.city) out.reason = "wrong or unreadable contract ticker";
    else if (m.status !== "active" && m.status !== "open") out.reason = "market is not open";
    else if (![m.yes_bid, m.yes_ask].every(function (p) { return typeof p === "number" && isFinite(p) && p >= 0 && p <= 1; })) out.reason = "missing or invalid bid/ask";
    else if (m.yes_bid > m.yes_ask) out.reason = "crossed bid/ask";
    else {
      function priced(p, size) {
        return p > 0 && p < 1 && typeof size === "number" && isFinite(size) && size > 0;
      }
      if (priced(m.yes_bid, m.yes_bid_size)) out.bid = m.yes_bid * 100;
      if (priced(m.yes_ask, m.yes_ask_size)) out.ask = m.yes_ask * 100;
      if (out.bid === null || out.ask === null) out.reason = "empty book side or missing positive size";
    }
    return out;
  }

  function comparison(s, nowMs) {
    var model;
    if (physics3Failed && !physics3) {
      // Nothing was ever accepted, so nothing is retained. Say what is wrong with the file that
      // arrived (no generation time, stamped in the future, no row, no model_id), never "retained".
      model = RainModels.slot(DEF3.key, physics3Latest, s, nowMs);
      if (model.live) {
        model.live = false; model.state = "stale";
        model.why = "V3 file refused by this page's timestamp check; nothing earlier was accepted";
      }
    } else {
      model = RainModels.slot(DEF3.key, physics3, s, nowMs);
      if (physics3Failed) { model.live = false; model.state = "stale"; model.why = "V3 refresh failed; retained source timestamps apply"; }
    }
    var price = priceFor(s, model.contractDay, nowMs);
    if (model.live) {
      if (price.ask !== null) price.edge = model.pct - price.ask;
      if (price.bid !== null) price.noEdge = price.bid - model.pct;
      price.direction = price.edge !== null && price.edge > 1e-9 ? "buy YES"
        : price.bid !== null && price.noEdge > 1e-9 ? "buy NO" : "no edge";
      if (price.ask !== null || price.bid !== null) {
        price.advantage = price.direction === "buy YES" ? price.edge
          : price.direction === "buy NO" ? price.noEdge : 0;
      }
    }
    return {station: s, model: model, price: price};
  }

  function points(n) { return (n > 0 ? "+" : "") + n.toFixed(1) + " pts"; }

  function render() {
    var S = [];
    if (state && state.stations) {
      for (var k in state.stations) {
        var s = state.stations[k];
        S.push(s);
      }
    }

    var feedGen = physics3 ? (physics3.generated_utc || null) : null;
    var nowMs = Date.now();
    var rows = S.map(function (s) { return comparison(s, nowMs); });
    rows.sort(function (a, b) {
      var ae = a.price.advantage === null ? -1 : a.price.advantage, be = b.price.advantage === null ? -1 : b.price.advantage;
      return be - ae || a.station.icao.localeCompare(b.station.icao);
    });
    var feedAge = RainModels.ageMinOf(feedGen, nowMs);
    var staleObj = RainModels.stalenessOf(feedAge);
    var topAge = "";
    if (!physics3) topAge = "missing";
    else if (RainModels.identityReason(physics3)) topAge = RainModels.identityReason(physics3);
    else if (staleObj) topAge = "stale " + RainModels.ageTxt(feedAge);
    else topAge = "live " + RainModels.ageTxt(feedAge);
    if (physics3Failed) topAge = physics3 ? "refresh failed; retained " + RainModels.ageTxt(feedAge)
      : physics3Latest ? "latest file refused, nothing earlier accepted" : "missing";

    // The caveat lives IN the header, beside the name, never at the end of a paragraph.
    var h = '<div class="model-freshness v3-identity"><b style="font-size:16px">V3: ' + esc(V3_ROLE.toUpperCase()) + '</b>'
      + '<b class="v3-unmeasured">' + esc(V3_RECORD) + '</b>'
      + '<small>v3 ' + esc(topAge) + '</small></div>'
      + '<p class="v3-role">v3 is ' + esc(V3_ROLE) + ', the working forecast and the backup until the Rain Sentinel is validated. '
      + 'No measured live record exists for v3 yet, so every v3 number, edge and direction below is unmeasured.</p>';

    if (physics3 && physics3.model_id) {
      var fitted = physics3.fitted_on;
      if (fitted && typeof fitted === "object") fitted = [fitted.start, fitted.end].filter(Boolean).join(" to ");
      h += '<div class="kv" style="margin-bottom: 12px; font-size: 13px;">'
        + '<span>model_id</span><span>' + esc(physics3.model_id) + '</span>'
        + '<span>fitted_on</span><span>' + esc(fitted || "unavailable") + '</span>'
        + '<span>feature_source</span><span>' + esc(String(physics3.feature_source || "").replace("_previous_day1 lead", "the previous_day1 lead")) + '</span>'
        + '<span>train rows</span><span>' + esc(physics3.n_fit_rows_train) + '</span>'
        + '</div>';

      if (physics3.reliability) {
        var rel = physics3.reliability;
        h += '<div class="grp"><small><b>RELIABILITY</b> ' + esc(rel.label || "") + '</small><table class="sc"><tr><th>bucket</th><th>measured %</th><th>n</th><th>predicted</th></tr>'
          + (rel.buckets || []).map(function(b) {
            return '<tr><td>' + esc(b.name) + '</td><td>' + b.actual_pct + '%</td><td>' + b.n + '</td><td>' + Math.round(b.avg_pred_pct) + '%</td></tr>';
          }).join("") + '</table></div>';
      } else h += '<div class="grp"><small><b>RELIABILITY</b> unavailable: no measured record for this fit</small></div>';
    }

    h += '<p class="edge-note">Largest executable advantages first, using the positive YES or NO advantage before fees. EDGE = V3 rest of day minus YES ask, in points, before fees. '
      + 'Buy NO requires a priced YES bid above the model; its advantage is YES bid minus V3. Inside the spread means no edge. '
      + 'The model percentage and the market price are different numbers and are labelled separately. v3 reliability is unmeasured.</p>';
    // One label per column, shared by the desktop header and the phone layout's per-cell label, so
    // "unmeasured" can never be on one and missing from the other.
    var COL = {
      gauge: "gauge", day: "contract day",
      rod: "v3 rest of day (unmeasured)", whole: "v3 whole day (unmeasured)",
      price: "LIVE MARKET PRICE", edge: "EDGE vs YES ask (points, v3 unmeasured)",
      direction: "direction (v3, unmeasured)"
    };
    h += '<table class="sc market-table" style="margin-top: 16px;"><thead><tr>'
      + ["gauge", "day", "rod", "whole", "price", "edge", "direction"].map(function (k) {
        return '<th' + (k === "direction" ? ' class="edge-direction-head"' : '') + '>' + esc(COL[k]) + '</th>';
      }).join("") + '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var s = rows[i].station, out = rows[i].model, price = rows[i].price;

      var rod = "";
      if (out.live) {
        rod = pct(out.pct);
      } else {
        rod = '<b class="stale">' + esc(out.wrongDay ? "v3 wrong day" : "v3 " + out.state) + ': ' + esc(out.why) + '</b>';
      }
      var wday = out.live ? (out.pDay !== null ? pct(out.pDay) : 'v3 unavailable: no whole-day number') : rod;

      var livePrice = price.ask === null ? '<b class="stale">YES ask: no price</b>'
        : '<b>YES ask ' + price.ask.toFixed(1) + 'c</b>';
      livePrice += price.bid === null ? '<small>YES bid: no price; NO ask: no price</small>'
        : '<small>YES bid ' + price.bid.toFixed(1) + 'c; NO ask ' + (100 - price.bid).toFixed(1) + 'c</small>';
      if (price.reason) livePrice += '<small>' + esc(price.reason) + '</small>';
      livePrice += '<small>' + esc(price.age) + '<br>' + esc(price.source) + '<br>' + esc(price.ticker) + '</small>';
      var edge = price.edge === null ? '<b>unavailable</b><small>' + esc(price.reason ? 'no price' : out.why) + '</small>' : '<b>' + points(price.edge) + '</b>';
      var direction = '<b>' + price.direction + '</b>';
      if (price.direction === "buy NO") direction += '<small>NO advantage +' + price.noEdge.toFixed(1) + ' pts before fees</small>';
      if (price.edge === null) direction += '<small>YES ask comparison unavailable</small>';
      var cls = price.direction === "buy YES" ? "edge-yes" : price.direction === "buy NO" ? "edge-no" : "";
      h += '<tr class="' + cls + '" data-icao="' + esc(s.icao) + '"><td data-label="' + esc(COL.gauge) + '"><b>' + esc(s.city) + '</b> ' + esc(s.icao)
        + '</td><td data-label="' + esc(COL.day) + '">' + esc(out.contractDay || s.local_day) + '</td><td data-label="' + esc(COL.rod) + '" class="num">' + rod
        + '</td><td data-label="' + esc(COL.whole) + '" class="num">' + wday + '</td><td data-label="' + esc(COL.price) + '" class="market-price num">' + livePrice
        + '</td><td data-label="' + esc(COL.edge) + '" class="edge-value num">' + edge + '</td><td data-label="' + esc(COL.direction) + '" class="edge-direction">' + direction + '</td></tr>';
    }
    h += '</tbody></table>';
    h += '<details><summary>Experimental station weather statistics</summary>' + S.map(function(s) { return '<h3>' + esc(s.icao) + '</h3><div class="expansion-panel" data-expansion-icao="' + esc(s.icao) + '"></div><div class="sentinel-stats" data-sentinel-icao="' + esc(s.icao) + '"></div>'; }).join('') + '</details>';

    document.getElementById("board").innerHTML = h;
    renderSentinel();
    document.getElementById("fresh").textContent = "rendered " + (new Date().toLocaleTimeString()) + (physics3 ? "" : ", v3 feed missing");
  }

  function renderSentinel() {
    if (typeof RainSentinelUI === "undefined" || !state) return;
    document.querySelectorAll("[data-sentinel-icao]").forEach(function(el) {
      var s = state.stations.filter(function(x) { return x.icao === el.getAttribute("data-sentinel-icao"); })[0];
      if (!s) return;
      var day = new Date(Date.now() + s.utc_offset_std * 3600000).toISOString().slice(0,10);
      RainSentinelUI.render(el, sentinel, {icao:s.icao, local_day:day}, {fetchFailed:sentinelFailed});
      if(typeof RainExpansionUI !== "undefined") RainExpansionUI.render(document.querySelector('[data-expansion-icao="'+s.icao+'"]'), {icao:s.icao,local_day:day}, {base:DATA});
    });
  }

  function load() {
    return Promise.all([
      fetchJSON("state.json"),
      fetchJSON("settle.json").catch(function () { return null; }),
      fetchJSON("physics_v3.json").catch(function () { return null; }),
      fetchJSON("sentinel.json").catch(function () { return null; }),
      fetchJSON("rain_history.json").catch(function () { return null; }),
      fetchJSON("forecast_history.json").catch(function () { return null; }),
      fetchJSON("forecast_skill.json").catch(function () { return null; }),
      fetchJSON("pysteps.json").catch(function () { return null; }),
      fetchJSON("storm_context.json").catch(function () { return null; })
    ]).then(function (r) {
      state = r[0]; settle = r[1]; physics3Latest = r[2];
      physics3 = typeof RainExpansionUI === "undefined" ? r[2] : RainExpansionUI.legacy(physics3,r[2]);
      physics3Failed = !r[2] || physics3 !== r[2];
      if(typeof RainExpansionUI !== "undefined") RainExpansionUI.update(r.slice(4));
      var accepted = typeof RainSentinelUI === "undefined" ? sentinel : RainSentinelUI.accept(sentinel, r[3]);
      sentinelFailed = !r[3] || accepted !== r[3]; sentinel = accepted;
      lastLoadOk = Date.now();
      render();
    }).catch(function (e) {
      // Retained rows must still age and cross contract midnight when a refresh fails.
      render();
      document.getElementById("fresh").textContent = "error: " + e.message;
    });
  }

  function theme() {
    var light = localStorage.getItem("rb.theme") === "light";
    document.body.classList.toggle("light", light);
    document.getElementById("theme").textContent = light ? "dark" : "light";
  }
  document.getElementById("theme").onclick = function () {
    localStorage.setItem("rb.theme", document.body.classList.contains("light") ? "dark" : "light");
    theme();
  };
  theme();
  // Recheck retained prices on every tick even if the previous request is still pending.
  var _load = load; load = function () { render(); if (loading) return loading; loading = _load().then(function (r) { loading = null; return r; }, function (e) { loading = null; throw e; }); return loading; };
  function wake() { if (document.visibilityState === "hidden") return; renderSentinel(); if (Date.now() - lastLoadOk > 20000) load(); }
  document.addEventListener("visibilitychange", wake); window.addEventListener("pageshow", wake); window.addEventListener("focus", wake); window.addEventListener("online",wake);
  load();
  setInterval(load, 30000);
  setInterval(function() { if(document.visibilityState !== "hidden") renderSentinel(); }, 15000);
}());
