(function () {
  "use strict";
  var DATA = "../data/";
  var state = null, settle = null, physics3 = null;

  var DEF3 = RainModels.DEFS.v3; // The definition for v3 is in models.js

  function fetchJSON(url) {
    return fetch(DATA + url + "?t=" + Date.now()).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function pct(n) { return Math.round(n) + '%'; }

  function render() {
    var S = [];
    if (state && state.stations) {
      for (var k in state.stations) {
        var s = state.stations[k];
        S.push(s);
      }
    }
    S.sort(function(a, b) { return a.icao.localeCompare(b.icao); });

    var feedGen = physics3 ? (physics3.generated_utc || null) : null;
    var nowMs = Date.now();
    var feedAge = RainModels.ageMinOf(feedGen, nowMs);
    var staleObj = RainModels.stalenessOf(feedAge);
    var topAge = "";
    if (!physics3) topAge = "missing";
    else if (staleObj) topAge = "stale " + RainModels.ageTxt(feedAge);
    else topAge = "live " + RainModels.ageTxt(feedAge);

    var h = '<div class="model-freshness"><b style="font-size:16px">V3 SHADOW</b> <small>v3 ' + topAge + '</small></div>';

    if (physics3 && physics3.model_id) {
      var fitted = physics3.fitted_on;
      if (fitted && typeof fitted === "object") fitted = [fitted.start, fitted.end].filter(Boolean).join(" to ");
      h += '<div class="kv" style="margin-bottom: 12px; font-size: 13px;">'
        + '<span>model_id</span><span>' + esc(physics3.model_id) + '</span>'
        + '<span>fitted_on</span><span>' + esc(fitted || "unavailable") + '</span>'
        + '<span>feature_source</span><span>' + esc(physics3.feature_source) + '</span>'
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

    h += '<table class="sc" style="margin-top: 16px;"><tr><th>gauge</th><th>contract day</th><th>v3 rest of day</th><th>v3 whole day</th></tr>';

    for (var i = 0; i < S.length; i++) {
      var s = S[i];
      // Use RainModels.slot to robustly process the station data
      var out = RainModels.slot(DEF3.key, physics3, s, nowMs);

      var rod = "";
      if (out.live) {
        rod = pct(out.pct);
      } else {
        rod = '<b class="stale">' + esc(out.wrongDay ? "v3 wrong day" : "v3 " + out.state) + ': ' + esc(out.why) + '</b>';
      }
      var wday = out.live ? (out.pDay !== null ? pct(out.pDay) : 'v3 unavailable: no whole-day number') : rod;

      h += '<tr><td><b>' + esc(s.city) + '</b> ' + esc(s.icao) + '</td><td>' + esc(out.contractDay || s.local_day) + '</td><td class="num">' + rod + '</td><td class="num">' + wday + '</td></tr>';
    }
    h += '</table>';

    document.getElementById("board").innerHTML = h;
    document.getElementById("fresh").textContent = "updated " + (new Date().toLocaleTimeString());
  }

  function load() {
    Promise.all([
      fetchJSON("state.json"),
      fetchJSON("settle.json").catch(function () { return null; }),
      fetchJSON("physics_v3.json").catch(function () { return null; })
    ]).then(function (r) {
      state = r[0]; settle = r[1]; physics3 = r[2];
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
  load();
  setInterval(load, 30000);
}());
