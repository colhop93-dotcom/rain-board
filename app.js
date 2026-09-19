/* Rain Station Board, the one-page board. Static, no keys, works on the GitHub Pages mirror.

   Built 2026-09-09 from WO-128: one comprehensive page that shows what the model says will or
   won't rain, where the market disagrees, and when. So: the model's calls first (WILL NOT RAIN,
   WILL RAIN, MARKET DISAGREES, each with WHEN), then the map, then every gauge as a sorted queue,
   then the scorecard folded. Tapping any gauge opens a full-screen airport panel over the page
   (#KBOS deep-links it).

   Every number carries its source and its age. When a live input is stale the state is UNKNOWN.
   All clocks are Central. Colin's positions are never on this page.

   2026-09-16, Colin's order: ONE model on the page. v3 (physics_v3.json, build/wx_physics_v3.py) is
   the only prediction model displayed anywhere: cards, map popups, candidates, market comparisons and
   the scorecard. No other model's number or record is shown, and nothing here relabels another
   model's output as v3. Where v3 has no measured record the word is "unmeasured"; where the v3 feed
   is missing, stale or errored the word is "v3 unavailable" or "v3 stale", never a blank and never 0%.

   2026-09-18, Colin's orders: the Rain Sentinel is the intended forecaster and sits at the TOP of the
   page, open, with its live readings and a plain status line; it has no validated probability yet,
   so none is shown. v3 is the working forecast and drives the phone alerts until the Sentinel is
   validated, and every v3 number says "unmeasured" beside it until v3 has a measured record. */
(function () {
  "use strict";
  var ON_MIRROR = /github\.io$/.test(location.hostname);
  var FUNNEL = "https://nucbox-k11.tail8ffcbf.ts.net/";
  var DATA = /\/classic\/?$/.test(location.pathname.replace(/index\.html$/, "")) ? "../data/" : "data/";
  var MRMS = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows?service=WMS&version=1.3.0&request=GetMap&layers=conus_cref_qcd&styles=&crs=EPSG:3857&width=256&height=256&format=image/png&transparent=true&bbox={bbox-epsg-3857}";
  var IEM_ARCHIVE = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-";
  var IEM_SITE = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::";
  var HRRR = "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/";
  var HRRR_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&STYLES=&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true";
  var ESRI_IMG = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  var ESRI_REF = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
  var ESRI_DARK = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
  var ESRI_DARK_REF = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
  var NEXRAD = { ATL: "FFC", AUS: "EWX", BOS: "BOX", CHI: "LOT", DAL: "FWS", DC: "LWX", DEN: "FTG", EWR: "OKX", HOU: "HGX",
    LAX: "VTX", LV: "ESX", MIA: "AMX", MIN: "MPX", NOLA: "LIX", NYC: "OKX", OKC: "TLX", PHIL: "DIX", PHX: "IWA", SATX: "EWX",
    SEA: "ATX", SFO: "MUX", TTN: "DIX" };
  var MI = 0.621371;

  var state = null, settle = null, physics = null, models = null, cams = null, metars = null, nextm = null, scorecardData = null, book = null, candidates = null, camRings = null, camHealth = null, healthError = null, briefing = null;
  var sentinel = null, sentinelFailed = false, physicsFailed = false;
  var lastLoadOk = null, lastLoadFail = null, loading = null, briefingFail = null;
  var apIcao = null, queueFilter = localStorage.getItem("rb.filter") || "ALL", basemap = localStorage.getItem("rb.basemap") || "sat";
  var maps = {};
  window.rb2 = maps;   // debug handle only, used by the headless check

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pct(v) { return (v === null || v === undefined) ? "--" : Math.round(v) + "%"; }
  function cents(v) { return (v === null || v === undefined) ? "--" : Math.round(v * 100) + "c"; }
  function mi(km) { return (km === null || km === undefined) ? null : Math.round(km * MI); }
  function toast(m) { var t = $("toast"); t.textContent = m; t.classList.add("show"); setTimeout(function () { t.classList.remove("show"); }, 3500); }
  function fetchJSON(rel, ms) {
    var url = DATA + rel + "?t=" + Math.floor(Date.now() / 60000);
    return new Promise(function (res, rej) {
      var c = new AbortController(), t = setTimeout(function () { c.abort(); rej(new Error("timeout")); }, ms || 12000);
      fetch(url, { signal: c.signal, cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(rel + " " + r.status); return r.json(); }).then(function(x) { clearTimeout(t); res(x); }, function(e) { clearTimeout(t); rej(e); });
    });
  }
  function ageMin(iso, futureToleranceMin) { if (!iso) return null; var t = Date.parse(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); if (isNaN(t)) return null; var age = (Date.now() - t) / 60000; if (age < 0 && age >= -(futureToleranceMin || 0)) return 0; return age < 0 ? Math.floor(age) : Math.round(age); }
  function agoTxt(iso, futureToleranceMin) { var m = ageMin(iso, futureToleranceMin); return m === null ? "no data" : m < 0 ? "STALE: timestamp in the future" : m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.floor(m / 60) + " h " + (m % 60) + " m ago"; }
  function ctClock(iso) {
    if (!iso) return "";
    var t = Date.parse(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); if (isNaN(t)) return String(iso);
    return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) + " CT";
  }
  function ctFromMs(ms) { return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) + " CT"; }
  function hourLabel(h) { if (h === null || h === undefined) return "?"; if (h >= 24) return "12am"; var x = h % 12 || 12; return x + (h < 12 ? "am" : "pm"); }
  function centralOffsetMin() {
    var now = new Date(); now.setSeconds(0, 0);
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now), p = {};
    parts.forEach(function (x) { if (x.type !== "literal") p[x.type] = +x.value; });
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - now.getTime()) / 60000);
  }
  function stationOff(s) {
    var off = typeof RainHours !== "undefined" ? RainHours.offset(s) : null;
    if (off !== null) return off;
    return (s.tz_offset_min !== null && s.tz_offset_min !== undefined) ? +s.tz_offset_min : +(s.utc_offset_std || 0) * 60;
  }
  function centralHour(s, h) { if (h === null || h === undefined) return null; return ((Math.round(h + (centralOffsetMin() - stationOff(s)) / 60) % 24) + 24) % 24; }
  function ct(s, h) {
    var ms = typeof RainHours !== "undefined" ? RainHours.civilMs(s,h) : undefined;
    if (ms === null) return hourLabel(h) + " local (time ambiguous)";
    return ms === undefined ? hourLabel(centralHour(s,h)) + " CT" : ctFromMs(ms);
  }
  function localHourToMs(s, h) {
    var d = s.local_day ? s.local_day.split("-").map(Number) : null; if (!d) return null;
    return Date.UTC(d[0], d[1] - 1, d[2], 0, 0) - stationOff(s) * 60000 + h * 3600000;
  }

  /* ---------------- lookups ---------------- */
  function stations() { return state ? state.stations : []; }
  function byIcao(icao) { return stations().filter(function (s) { return s.icao === icao; })[0] || null; }
  function settleFor(s) { return (settle && settle.stations && settle.stations[s.icao]) || {}; }
  // WO-132, jules stage 1: physFor()/physPct() never compared the physics row's own day to the
  // station's contract day, so if the physics task ever stalls across a midnight rollover the
  // board shows YESTERDAY's probability as today's with nothing marking it.
  // jules reached this through a daylight-saving argument that the desk measured and
  // DISPROVED (build/iem_day_convention.py: the contract day is local STANDARD, 90 informative
  // station-days to 0, and docs/DATA_SOURCES.md line 73 says so). Both sides compute the day
  // the same way, so the rollover case he described does not occur. The guard goes in anyway,
  // because a stalled writer produces the same wrong screen for a different reason and a
  // one-line date check costs nothing.
  // 2026-09-16: ONE model, v3. These are the accessors the v3 route was built with (WO-139): a row
  // is a NUMBER only when the feed is present, generated inside 90 minutes, dated for the station's
  // computed contract day and carrying a finite percentage. Anything else is a WORD from physWord(),
  // printed in place of the number: never a blank, never a false 0%, never a fallback to another model.
  function physStatus(s) {
    if (!physics) return "v3 unavailable: feed missing";
    if (typeof physics.model_id !== "string" || !physics.model_id.trim()) return "v3 feed refused: missing top-level model_id";
    if (!physics.stations || !physics.stations[s.icao]) return "v3 unavailable: no row for this station";
    var p = physics.stations[s.icao];
    if (typeof p.model_id !== "string" || !p.model_id.trim()) return "v3 row refused: missing model_id";
    if (p.model_id !== physics.model_id) return "v3 row refused: model_id does not match feed model_id";
    if (!p.day) return "v3 unavailable: no contract date";
    if (p.day !== contractDay(s)) return "v3 unavailable: wrong day";
    if (typeof p.pct !== "number" || !isFinite(p.pct) || p.pct < 0 || p.pct > 100) return "v3 unavailable: no usable number";
    return null;
  }
  // Match models.js: ordinary browser skew is allowed for model feeds only.
  var FUTURE_TOLERANCE_MIN = 2;
  function physAge() { var t = physics && Date.parse(physics.generated_utc); if (!Number.isFinite(t)) return null; var a = (Date.now() - t) / 60000; return a < 0 && a >= -FUTURE_TOLERANCE_MIN ? 0 : a; }
  function physAgoTxt() { return agoTxt(physics && physics.generated_utc, FUTURE_TOLERANCE_MIN); }
  function physStale() {
    if (!physics) return null;
    if (physicsFailed) return "v3 stale: refresh failed or older run refused";
    var age = physAge();
    if (age === null) return "v3 unavailable: generation time unknown";
    if (age < 0) return "v3 stale: generation time in the future";
    if (age > 20) return "v3 stale " + physAgoTxt();
    return null;
  }
  function physWord(s) { return physStale() || physStatus(s) || null; }
  function physFor(s) { if (physWord(s)) return null; return physics.stations[s.icao]; }
  function physPct(s) { var p = physFor(s); return p ? p.pct : null; }

  // A "measured" line beside a number is allowed only from the deployed coefficients' OWN record,
  // which the writer marks with reliability_is_this_model and a matching model_id (WO-132/134: the
  // v2 fit file once shipped another fit's table byte for byte and the board printed it as that
  // model's record). physics_v3.json ships reliability: null, so every bucket reads "unmeasured"
  // until a v3 record with a verified identity is written. A table from any other fit is never
  // shown here, not even as context.
  function relTable() {
    var rod = physics && physics.reliability_rest_of_day;
    if (rod && rod.buckets && physics.reliability_is_this_model === true && rod.model_id === physics.model_id) {
      // measured for 09:00 calls conditioned dry at the previous hour; a live row whose evidence is not
      // a dated dry reading (UNKNOWN, WET) is outside that population and gets no record
      return { rows: rod.buckets, ctx: "DRY_AS_OF",
               label: "THIS fit, " + (rod.dates || '?') + " unseen dates " + ((rod.window || {}).start || '') + " to " + ((rod.window || {}).end || '') + ", rest-of-day conditioned" };
    }
    return null;
  }
  function physRel(p, s) { if (p === null || p === undefined) return null; var t = relTable(); if (!t) return null; var r = t.rows[String(Math.min(90, Math.floor(p / 10) * 10))]; if (!(r && r.n)) return null; var ph = s ? physFor(s) : null; if (t.ctx && ph && ph.evidence !== t.ctx) return null; r = Object.assign({}, r); r.label = t.label; r.mine = true; return r; }
  function modelsFor(s) { return (models && models.stations && models.stations[s.icao]) || null; }
  function pulseFor(s) { return (metars && metars.stations && metars.stations[s.icao]) || null; }
  function camsFor(s) { return (camRings && camRings.near && camRings.near[s.city]) || []; }
  /* One explicitly published snapshot supplies both near and approach selections. */
  function ringsFor(s) { return (camRings && camRings.rings && camRings.rings[s.city]) || []; }
  function ringAvailable(c) { var h = healthOf(c); return !c.held && c.verified !== false && !(h && (h.error || h.proxy_error)); }      // Astra round 7: ONE predicate for cards, markers, counts, fit and popups
  /* 2026-09-16 (Colin): a FROZEN camera (the same picture for at least 20 minutes, or a failed check) goes
     AFTER the live ones in every camera list and marker set. Its caption is unchanged; only its
     place moves. camOrder is the ONE comparator: live first, then frozen or unavailable, nearest first
     inside each group. */
  function camFrozen(c) { var h = healthOf(c); return !!(h && (h.error || (typeof h.stale_min === "number" && (h.stale_min < 0 || h.stale_min >= 20)))); }
  function camOrder(a, b) { var fa = (camFrozen(a) || !ringAvailable(a)) ? 1 : 0, fb = (camFrozen(b) || !ringAvailable(b)) ? 1 : 0; return fa - fb || (+a.dist_km || 0) - (+b.dist_km || 0); }
  function ringGaps(s) {
    var gaps = ((camRings && camRings.gaps && camRings.gaps[s.city]) || []).slice(), rows = ringsFor(s);
    ["AREA", "APPROACH"].forEach(function (band) {
      ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].forEach(function (sector) {
        var cell = rows.filter(function (c) { return c.band === band && c.sector === sector; });
        if (cell.length && !cell.some(ringAvailable) && !gaps.some(function (g) { return g.band === band && g.sector === sector; }))
          gaps.push({band:band, sector:sector, why:"selected cameras unavailable at the latest check"});
      });
    });
    return gaps;
  }
  function ringsOpen() { var d = $("ap-rings"); return !!(d && d.open); }
  /* codex, PR #129: nothing for Approach is fetched until the section is opened; the two files are
     loaded then and re-read on the minute tick only while it stays open */
  var ringsLoading = null, ringsError = null;      // ringsError: the last failed load, retried on the minute tick only (Astra, codex)
  function loadRings(force) {
    if (ringsLoading) return ringsLoading;
    if (ringsError && !force) return Promise.resolve(null);
    var icaoAtStart = apIcao;
    ringsLoading = Promise.all([fetchJSON("cams_rings.json").catch(function () { return null; }), fetchJSON("cam_health.json").catch(function () { return null; })])
      .then(function (r) {
        ringsLoading = null;
        if (r[1]) camHealth = r[1];                    // Astra round 7: health is applied even when the catalog refresh failed
        // Astra on 0e1bc88: recorded HERE, before the catalog-failure branch returns. When both
        // requests failed the old placement was never reached, so the cached health went on being
        // presented with no stale warning while the catalog banner promised current health.
        healthError = r[1] ? null : Date.now();
        if (!r[0]) {
          ringsError = Date.now(); var cur0 = byIcao(apIcao); if (cur0) renderRings(cur0);
          // codex P2 and Astra round 8 on 3916c30: health was applied just above, but this early return
          // skipped the popup update below, so an open ring popup kept its old freshness or proxy error
          // text while the cards behind it showed the newly fetched health. Update it from the CACHED
          // catalog before returning.
          if (camPopup && camPopup.__ring && cur0 && camRings) {
            var fresh0 = ringsFor(cur0).filter(function (c) { return (c.url || c.frame || c.name) === camPopup.__key; })[0];
            if (!fresh0 || !ringAvailable(fresh0)) { camPopup.remove(); camPopup = null; }
            else { camPopup.__cam = fresh0; var capEl0 = camPopup.getElement() && camPopup.getElement().querySelector(".cap small:last-child"); if (capEl0) capEl0.textContent = ringFreshTxt(fresh0); }
          }
          return null;
        }
        // codex P2 on d542f95: the conditional assignment above deliberately keeps the cached health
        // when its fetch fails, and this line then overwrote it with null on the very same minute, so
        // every stale-frame and proxy-failure reading became "freshness unknown" with no warning.
        ringsError = null; camRings = r[0];
        var cur = byIcao(apIcao); if (cur) { renderRings(cur); placeAirport(cur); }
        // Astra round 5: an open ring popup follows the refreshed catalog and health, or closes if its camera went away or was held
        if (camPopup && camPopup.__ring && cur) {
          var fresh = ringsFor(cur).filter(function (c) { return (c.url || c.frame || c.name) === camPopup.__key; })[0];
          if (!fresh || !ringAvailable(fresh)) { camPopup.remove(); camPopup = null; }
          else { camPopup.__cam = fresh; var capEl = camPopup.getElement() && camPopup.getElement().querySelector(".cap small:last-child"); if (capEl) capEl.textContent = ringFreshTxt(fresh); }
        }
        return icaoAtStart;
      });
    return ringsLoading;
  }
  function healthOf(c) {
    if (!camHealth || !camHealth.cams) return null;
    var k = c.type === "proxy" ? "p:" + (c.frame || "") : "i:" + (c.url || "");
    return camHealth.cams[k] || null;
  }
  /* freshness in words: the source's own stamp when the sweep recorded one (proxy frames carry
     "source stamp ..."), else how long the frame hash has been unchanged, else unknown. Never
     "live", never a capture time we did not get from the source. */
  /* cam_freshness runs on a schedule; past this the record is describing a check nobody has made
     since, whether or not the file still fetches (Astra on e0fd2e7). */
  var HEALTH_STALE_MIN = 45;
  function ringFreshTxt(c) {
    var h = healthOf(c), parts = [];
    var capture = h && h.source_stamp;
    parts.push(capture ? "image capture time: " + String(capture) + " (source stamp at last check)" : "no capture time published by this source");
    parts.push("last request answered: " + agoTxt((h && h.last_ok_utc) || c.last_ok_utc || (c.verified ? c.checked_utc : null)));
    parts.push("catalog updated: " + agoTxt(camRings && camRings.updated_utc));
    // Astra on 56a9793: keeping the cached health when cam_health.json fails is right, and saying
    // NOTHING about it is not. A record checked 65 minutes ago still read "picture unchanged 25 min"
    // as though that were current. A retained observation is evidence about the past; say so, and
    // say when it is from. This is the other half of the fix that set healthError: I added the flag
    // last round and nothing read it, which is the same "wired to nothing" failure in miniature.
    // Astra on e0fd2e7: healthError only catches a failed FETCH. If the freshness task stops while
    // the static server keeps serving its last JSON happily, the flag stays null and a record checked
    // two hours ago still reads "picture unchanged 25 min". The file being readable is not the same
    // as the observation being current, so the age of the check decides it as well.
    var checkAge = h ? ageMin(h.last_checked_utc) : null;
    if (h && (healthError || (checkAge !== null && (checkAge < 0 || checkAge > HEALTH_STALE_MIN)))) {
      parts.push("health not refreshing, last check " + agoTxt(h.last_checked_utc));
    }
    if (h && h.error) return (parts.length ? parts.join(", ") + "; " : "") + "last check failed " + agoTxt(h.last_checked_utc) + " (" + String(h.error).slice(0, 60) + ")";   // Astra: an error outranks the hash age
    if (h && h.proxy_error) return (parts.length ? parts.join(", ") + "; " : "") + "the box could not refresh this stream " + agoTxt(h.proxy_error_utc) + "; the picture shown is older (" + String(h.proxy_error).slice(0, 50) + ")";   // codex round 3
    // codex P2 on ab13ab9: the sweep serialises the source's OWN capture time in
    // source_stamp_at_sweep and this line threw it away for a phrase with no content in it. On the
    // first health samples an hours-old frame then read as merely recently checked, with no way to
    // see the capture age we already knew. Say the time, and the age when it parses.
    var stamp = c.source_stamp_at_sweep || ((c.verified_how && /source stamp (\S+)/.exec(c.verified_how)) || [])[1] || null;
    // An age is only computable from a stamp that carries its OWN zone. "09/13/2026 14:37" parses
    // happily as BROWSER-local time and would print a confident wrong age on a phone in another
    // zone, which is worse than printing no age. A zoneless stamp is shown as the source wrote it.
    var zoned = stamp && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:?\d\d)$/.test(String(stamp));
    // codex P2 on d542f95: the qualifier is the field's MEANING. A proxy frame that has refreshed
    // since the sweep is a NEWER picture than this stamp describes, and dropping "at the sweep" would
    // invite reading the old capture time as the current one, which is the exact distinction I gave
    // for not updating it from proxy status.
    if (stamp && String(stamp) !== "None") parts.push("source stamp at the sweep " + (zoned && ageMin(stamp) !== null ? ctClock(stamp) + ", " + agoTxt(stamp) : String(stamp)));
    // 2026-09-16: a 200 with the same bytes is not a fresh picture. DuPage County's feed inside Travel
    // Midwest served one 7:38 am image all day; the caption read "refreshes each minute" and
    // "may be stale". Say FROZEN, how long, and when the picture last changed.
    function spanTxt(m) { return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " m" : m + " min"; }
    if (h && h.stale_min < 0) return parts.concat("STALE: last change timestamp in the future").join(", ");
    if (h && typeof h.stale_min === "number" && (h.changes || 0) >= 1) parts.push(h.stale_min >= 20 ? "image unchanged for " + spanTxt(h.stale_min) + ", last change " + agoTxt(h.last_changed_utc) + " (" + ctClock(h.last_changed_utc) + "); source capture time unavailable" : "picture changed " + agoTxt(h.last_changed_utc));
    else if (h && (h.samples || 0) >= 2) parts.push("no change seen across " + h.samples + " checks over " + spanTxt(h.stale_min || 0) + "; capture time unavailable");
    else if (h && h.last_checked_utc) parts.push("first check " + agoTxt(h.last_checked_utc) + ", no change observed yet");
    else parts.push("freshness unknown");
    return parts.join(", ");
  }
  function cells(s) { var r = settleFor(s).radar || {}; return (r.cells && r.cells.cells) || []; }
  function cellAge(c) { var a = ageMin(c.valid); return a === null ? null : a; }
  function cellStationary(c) { return !c.heading || (c.kt !== null && c.kt !== undefined && +c.kt < 3) || /stationary/i.test(c.status || ""); }
  function cellMissText(c) {
    // codex sign-off: a stationary cell or one with no projected approach was printed as "misses by null mi"
    if (cellStationary(c)) return "STATIONARY, " + mi(c.km) + " mi " + c.bearing;
    if (c.eta_far_min !== null && c.eta_far_min !== undefined) return "ON A LINE for the gauge, about " + ctFromMs(Date.now() + Math.max(0, c.eta_far_min - (cellAge(c) || 0)) * 60000) + " if it holds its track (far, a guess)";
    return (c.closest_km !== null && c.closest_km !== undefined) ? "misses by " + mi(c.closest_km) + " mi" : "no projected approach";
  }
  function etaNow(c) {
    /* jules, WO-128 phase 1 review: an ETA read off a cell table is minutes from the RADAR SCAN,
       not from now. Age it by the scan time, and refuse it once the scan is over 20 minutes old. */
    if (c.eta_min === null || c.eta_min === undefined) return null;
    var a = cellAge(c); if (a === null || a < 0 || a > 20) return null;
    return Math.max(0, c.eta_min - a);
  }
  function inbound(s) { return cells(s).map(function (c) { var e = etaNow(c); return e === null ? null : Object.assign({}, c, { eta_min: e, eta_raw: c.eta_min, age: cellAge(c) }); }).filter(Boolean).sort(function (a, b) { return a.eta_min - b.eta_min; }); }
  function compRadar(s) { return settleFor(s).radar || {}; }
  function wetNeighbours(s) { return (s.neighbors || []).filter(function (n) { return n.raining; }); }
  function nwsPeak(s) { return (s.forecast && s.forecast.pop_peak !== null && s.forecast.pop_peak !== undefined) ? +s.forecast.pop_peak : null; }
  function twcDay(s) { var f = settleFor(s).fc; return f && f.day_pct !== null && f.day_pct !== undefined ? +f.day_pct : null; }
  // WO-133: hour 24 is the LAST HOUR OF THE CONTRACT when daylight time is on (the collector files the
  // 12am-1am civil hour of the next calendar date as 24 because the market day is local STANDARD). This
  // filter used to drop it, so the last contract hour was missing from the strip and the rain window.
  // It exists only when the station's civil offset differs from its standard offset.
  // PR #133 fix round, finding 5: collect_state leaves tz_offset_min at the standard offset when the NWS
  // request fails, which dropped hour 24 on daylight time. The forecast contract is evidence too:
  // twc_obs.fc_hours and collect_state both label the 12am to 1am hour of the next civil date 24 from
  // the row's own timestamp, so a row labelled 24 for this day means the civil day runs past standard
  // midnight whatever the offset field says.
  function hasHour24(s) {
    if (stationOff(s) !== +(s.utc_offset_std || 0) * 60) return true;
    var f = settleFor(s).fc, rows = (f && (!f.day || !s.local_day || f.day === s.local_day) && f.hours) || [];
    return rows.concat(s.forecast && s.forecast.hourly || []).some(function (h) { return +h[0] === 24; });
  }
  function dayHours(s) { return hasHour24(s) ? 25 : 24; }
  function contractHour(s, h) { return hasHour24(s) && +h === 0 ? 24 : +h; }
  function currentHour(s) {
    if (!s.local_day) return collectorHour(s, s.local_hour);
    var start = Date.parse(s.local_day + "T00:00:00Z");
    return Math.floor((Date.now() + stationOff(s) * 60000 - start) / 3600000);
  }
  function collectorHour(s, h) {
    var off = s.tz_offset_min === null || s.tz_offset_min === undefined ? +(s.utc_offset_std || 0) * 60 : +s.tz_offset_min;
    return contractHour(s, ((+h + (stationOff(s) - off) / 60) % 24 + 24) % 24);
  }
  function twcHours(s) {
    var f=settleFor(s).fc, n=dayHours(s), start=Date.parse((s.local_day||"")+"T00:00:00Z")-+(s.utc_offset_std||0)*3600000;
    if(f&&f.day&&s.local_day&&f.day!==s.local_day)return [];
    return ((f&&f.hours)||[]).filter(function(h){
      if(h[4]&&isFinite(start)){var ms=Date.parse(String(h[4]).replace(/([+-]\d\d)(\d\d)$/,"$1:$2"));return isFinite(ms)&&ms>=start&&ms<start+86400000;}
      return h[0]<n;
    });
  }
  function settleState(s) {
    /* WO-133 four states. Exchange result comes from book.json (REST poll each minute); the collector
       cannot carry it (collect_state.py is a money file). */
    var bk = book && book.markets && s.market && book.markets[s.market.ticker], mk = bk && bk.market || {};
    if (mk.result === "yes" || mk.result === "no") return { k: "OFFICIALLY_SETTLED", result: mk.result };
    var left = minutesLeft(s);
    if (isLocked(s)) return { k: left !== null && left > 0 ? "THRESHOLD_OBSERVED" : "AWAITING_SETTLEMENT" };
    if (rainingNow(s)) return { k: "RAIN_DETECTED" };
    if (left !== null && left <= 0) return { k: "AWAITING_SETTLEMENT" };
    return { k: "OPEN" };
  }
  function deadlineMs(s) { var d = s.local_day ? s.local_day.split("-").map(Number) : null; if (!d) return null; return Date.UTC(d[0], d[1] - 1, d[2] + 1, 0, 0) - (+(s.utc_offset_std || 0)) * 3600000; }
  function minutesLeft(s) { var m = deadlineMs(s); return m === null ? null : Math.round((m - Date.now()) / 60000); }
  function twcBest(s) { var b = null; twcHours(s).forEach(function (h) { if (h[1] !== null && (b === null || +h[1] > b.pop)) b = { hour: h[0], pop: +h[1], qpf: h[2], wx: h[3], stamp: h[4] }; }); return b; }
  function twcQpf(s) { return twcHours(s).reduce(function (a, h) { return a + (+h[2] || 0); }, 0); }
  function hrrrEcho(s) {
    var init=Date.parse(String(s.hrrr_init||"").replace(/([+-]\d\d)(\d\d)$/,"$1:$2")), day=Date.parse((s.local_day||"")+"T00:00:00Z"), out=[];
    if(!isFinite(init)||!isFinite(day))return out;
    // PR #133 fix round, finding 1: the collector has only ever written [civil_hour, pct], and this
    // dropped every row without a parseable third element. hours.js dates those from hrrr_init
    // (RainHours.hrrrRows); without hours.js only a row carrying its own stamp can be dated.
    var rows=typeof RainHours!=="undefined"?RainHours.hrrrRows(s):(s.hrrr_hours||[]).map(function(h){return {ms:Date.parse(String(h[2]||"").replace(/([+-]\d\d)(\d\d)$/,"$1:$2")),pct:+h[1]};});
    rows.forEach(function(r){
      var valid=r.ms, lead=(valid-init)/3600000;
      if(!isFinite(valid)||lead<1||lead>18||!(r.pct>0))return;
      var standard=valid+ +(s.utc_offset_std||0)*3600000;
      if(standard<day||standard>=day+86400000)return;
      var off=typeof RainHours!=="undefined"?RainHours.offset(s,valid):null;
      if(off===null)off=stationOff(s);
      out.push([Math.floor((valid+off*60000-day)/3600000),r.pct,new Date(valid).toISOString()]);
    });
    return out;
  }

  function marketQuote(m, side) {
    m = m || {};
    var p = m["yes_" + side], size = m["yes_" + side + "_size"];
    return typeof p === "number" && isFinite(p) && p > 0 && p < 1
      && typeof size === "number" && isFinite(size) && size > 0 ? p : null;
  }
  function marketYes(s) { return marketQuote(s.market, "ask"); }
  function marketNo(s) { var bid = marketQuote(s.market, "bid"); return bid === null ? null : 1 - bid; }
  function quoteCents(p) { return p === null ? "no price" : cents(p); }
  // 2026-09-10 10:52 CT, OKC: the canary pinged LOCKED 0.07 in off the 15:50Z SPECI (1-minute
  // pulse) while this card still read "Gauge 0.00 in" for five more minutes, because it only
  // read the 5-minute collector. Colin: "two different things for OKC". The pulse writes its
  // lock into metars.json every minute; the card reads it here so the two can never disagree.
  // PR #121 (codex P1, PR #49 review 2026-09-11), folded into this branch: this read the lock with no
  // check of WHICH DAY it belongs to. metar_pulse.py clears the lock on the local day roll, but only
  // while the task is running; if the minute pulse stops after a station locks and the collector
  // advances into the next contract, metars.json freezes holding yesterday's lock and the card
  // accepted it forever. A lock now counts only on its own day, drawn with the STANDARD offset.
  // And (codex on 4599818) the contract day is COMPUTED from the clock and the standard offset,
  // because stale_copy() in collect_state.py never refreshes local_day; the field is only the
  // fallback for a station carrying no utc_offset_std at all.
  function ymdUTC(ms) {
    var d = new Date(ms); function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }
  function stdOffMin(s) { return (s.utc_offset_std !== null && s.utc_offset_std !== undefined) ? +s.utc_offset_std * 60 : stationOff(s); }
  function contractDay(s) { return (s.utc_offset_std !== null && s.utc_offset_std !== undefined) ? ymdUTC(Date.now() + stdOffMin(s) * 60000) : (s.local_day || ymdUTC(Date.now() + stdOffMin(s) * 60000)); }
  function onContractDay(s, iso) {
    if (!iso) return false;
    var t = Date.parse(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
    if (isNaN(t)) return false;
    return ymdUTC(t + stdOffMin(s) * 60000) === contractDay(s);
  }
  function pulseLock(s) {
    var p = pulseFor(s), l = p && p.lock;
    if (!(l && l["in"] !== null && l["in"] !== undefined && +l["in"] >= 0.01)) return null;
    if (!onContractDay(s, l.time_utc)) return null;
    return +l["in"];
  }
  function gaugeIn(s) {
    var o = s.observed, a = (o && o.in_today !== null && o.in_today !== undefined) ? +o.in_today : null, b = pulseLock(s);
    if (a === null) return b; if (b === null) return a; return Math.max(a, b);
  }
  function isLocked(s) { return !!(s.observed && s.observed.locked) || (gaugeIn(s) || 0) >= 0.01; }
  function zClock(iso) { if (!iso) return ""; var t = Date.parse(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); if (isNaN(t)) return String(iso); var d = new Date(t); return ("0" + d.getUTCHours()).slice(-2) + ("0" + d.getUTCMinutes()).slice(-2) + "Z"; }
  function isSpeci(p) { return /^SPECI/.test(String((p && p.raw) || "")); }
  function traceToday(s) { var p = pulseFor(s); return !!(p && p.trace && onContractDay(s, p.time_utc)); }
  /* The gauge TOTAL (measurable accumulation), with the report it is as of. 2026-09-16, Chicago: one
     card read "gauge dry so far, no precip group in today's reports", "0.00 in today, raining now" and
     "TRACE observed" at once. Three different facts were sharing sentences. This function is the
     accumulation only: a P0000 group is a TRACE (under 0.01 in, settles NO), never "no precip group";
     present weather is presentWxTxt(); the model's conditioning is condTxt(). */
  function gaugeTxt(s) {
    // the collector can hand back observed: null for a station (four of them at 18:07 CT, Boston
    // among them, while Colin held it); that must read "no report", never 0.00
    var g = gaugeIn(s), pl = pulseFor(s);
    if (g === null) {
      // 2026-09-10 11:12 CT: 13 dry stations carried observed: null all day, which is the collector
      // doing the right thing since WO-129 (a null precip field is unknown, never 0.00) and the card
      // doing the wrong thing with it: "no gauge report" on 13 cards reads as a broken board. When
      // the 1-minute pulse has today's reports with no rain, no trace and no precip group, say so.
      var pl = pulseFor(s);
      if (pl && pl.time_utc) return "daily gauge total unknown";
      return "no gauge report this cycle";
    }
    return g.toFixed(2) + " in" + (pulseLock(s) !== null && (!s.observed || (+s.observed.in_today || 0) < pulseLock(s)) ? " (1-min pulse)" : "")
      + (g < 0.01 && traceToday(s) ? ", trace (P0000) in the " + zClock(pl.time_utc) + " report, a trace settles NO" : "");
  }
  function gaugeShort(s) { var g = gaugeIn(s); return g === null ? "no gauge total this cycle" : "gauge " + g.toFixed(2) + " in so far" + (g < 0.01 && traceToday(s) ? " (a trace reported, settles NO)" : ""); }
  /* The gauge AMOUNT wherever a sentence or a big number needs one. A station can be LOCKED on the
     collector's flag (or awaiting settlement after the cutoff) with no total ever read, and twelve
     call sites used to print (gaugeIn(s) || 0).toFixed(2), turning that unknown into "0.00 in" beside
     "settled YES" and "threshold reached" (desk review L2, 2026-09-18). An amount that was never read
     is said as unknown, exactly as gaugeTxt() says it. unit defaults to " in". */
  function gaugeAmt(s, unit) { var g = gaugeIn(s); return g === null ? "daily gauge total unknown" : g.toFixed(2) + (unit === undefined ? " in" : unit); }
  /* PRESENT WEATHER, stamped: what the latest reports say is falling, each with its time and source. */
  function presentWxTxt(s) {
    var p = pulseFor(s), o = s.observed || {}, parts = [];
    if (p && p.time_utc) parts.push((p.raining ? "rain" : p.trace ? "a trace of precipitation" : "no precipitation") + " in the " + zClock(p.time_utc) + " " + (isSpeci(p) ? "SPECI" : "METAR") + (p.wx ? " (" + esc(p.wx) + ")" : "") + (p.trace ? ", P0000 is a trace under 0.01 in" : ""));
    if (p && p.nws && p.nws.time_utc) parts.push("NWS " + zClock(p.nws.time_utc) + ": " + esc(p.nws.text || (p.nws.raining ? "rain" : "no rain")));
    if (p && p.madis && p.madis.obs_utc) parts.push("MADIS " + zClock(p.madis.obs_utc) + ": " + (p.madis.raining ? "rain" : "no rain") + (p.madis.wx ? " (" + esc(p.madis.wx) + ")" : ""));
    if (o.latest_ob_utc && o.raining_now) parts.push("collector " + zClock(o.latest_ob_utc) + ": raining" + (o.wx_now && o.wx_now.length ? " (" + esc(o.wx_now.join(", ")) + ")" : ""));
    return parts.length ? parts.join("; ") : "no present-weather report";
  }
  /* The MODEL'S CONDITIONING statement, from the writer's evidence fields (build/v2_core.py, shared by
     v3): what the model took the gauge to be, through which report, at what time. */
  function condTxt(ph) {
    if (!ph) return "";
    if (!ph.evidence) return "no evidence fields in this row";
    var why = ph.evidence_why ? String(ph.evidence_why) : "";
    if (ph.evidence === "DRY_AS_OF") {
      var t = ph.conditioned_at_hour;
      return (t !== null && t !== undefined && t > 0 ? "conditioned dry (under 0.01 in) through the last dated dry reading at " + fracClock(t) : "conditioned dry (under 0.01 in) only from the start of the day, no dated dry reading") + (why ? ": " + why : "");
    }
    return (ph.evidence || "UNKNOWN") + (why ? ", " + why : "");
  }
  /* 2026-09-18: the sub-hourly gauge lane (PR #154's gauge.js) ships with its own producer half and
     is not part of this board build; these are the main board's own readers again. */
  function rainingNow(s) {
    // codex sign-off: weather.com precip1h is an accumulation over the past hour, not "raining now"
    var p = pulseFor(s), pa = p ? ageMin(p.time_utc) : null, oa = ageMin(s.observed && s.observed.latest_ob_utc);
    // codex round 2: the collector carries the previous observation when a fetch fails, so a rainy
    // METAR must also be fresh (90 min covers an hourly METAR plus slack) before it counts
    return !!((s.observed && s.observed.raining_now && oa !== null && oa >= 0 && oa <= 90) || (p && p.raining_any && pa !== null && pa >= 0 && pa <= 20));
  }
  function obAge(s) { var p = pulseFor(s); var a = ageMin(s.observed && s.observed.latest_ob_utc), b = ageMin(p && p.time_utc); if (a === null) return b; if (b === null) return a; return Math.min(a, b); }
  /* The MADIS 5-minute line. House law, 2026-09-10 (OKC): that feed's amount field reads 0.0 on some
     stations in every slot on wet days, so a zero from it is UNKNOWN, never a measured 0.00. A nonzero
     amount is evidence and is quoted with its time. */
  function madisTxt(p) {
    var m = p && p.madis; if (!m) return "";
    var a = (m.precip_in !== null && m.precip_in !== undefined && isFinite(+m.precip_in)) ? +m.precip_in : null;
    return "MADIS 5-minute: " + (m.raining ? "rain" : "no rain") + (a !== null && a > 0 ? ", " + a.toFixed(2) + " in" : (a === 0 ? ", amount field reads zero (unvalidated, not a measured 0.00)" : "")) + " (" + agoTxt(m.obs_utc) + ")";
  }
  function radarAge(s) { return ageMin(compRadar(s).frame_utc); }

  /* ---------------- ONE physical state per station ---------------- */
  var STATES = {
    LOCKED: { icon: "✓", text: "LOCKED", why: "gauge reached 0.01 in" },
    WET_NOW: { icon: "●", text: "WET NOW", why: "the gauge or its 1-minute feed reports rain" },
    WET_IMMINENT: { icon: "◎", text: "WET IMMINENT", why: "echo over the gauge with a cell behind it, or a cell inside 20 min" },
    APPROACHING: { icon: "→", text: "APPROACHING", why: "inbound cell 21 to 60 min out" },
    RAIN_NEARBY: { icon: "◠", text: "RAIN NEARBY", why: "echo or a wet airport nearby, no hit projected" },
    OVERDUE: { icon: "⏰", text: "OVERDUE", why: "forecast window passed, gauge still dry" },
    QUIET: { icon: "○", text: "QUIET", why: "no rain report, no echo, no inbound cell" },
    UNKNOWN: { icon: "?", text: "UNKNOWN", why: "a live input is stale" }
  };
  function wetState(s) {
    var inputs = [], r = compRadar(s), ra = radarAge(s), oa = obAge(s), ib = inbound(s), wn = wetNeighbours(s);
    if (isLocked(s)) return { k: "LOCKED", overdue: false, inputs: ["gauge " + gaugeAmt(s)] };
    if (oa !== null) inputs.push("gauge report " + oa + " m old");
    if (ra !== null) inputs.push("radar " + ra + " m old");
    var stale = (oa === null || oa < 0 || oa > 90) || (ra === null || ra < 0 || ra > 20);
    if (rainingNow(s) && !(oa === null || oa < 0 || oa > 90)) return { k: "WET_NOW", overdue: !!s.overdue, inputs: inputs };
    if (stale) return { k: "UNKNOWN", overdue: !!s.overdue, inputs: inputs.concat(["a live input is missing or stale"]) };
    var p10 = +r.pct10 || 0, p30 = +r.pct30 || 0;
    if (p10 > 0) inputs.push(pct(p10) + " of the 6 mi ring has echo");
    if (ib.length) inputs.push(ib[0].dbz + " dBZ cell ETA " + Math.round(ib[0].eta_min) + " m");
    var backed = cells(s).length > 0 || (+r.pct30_strong || 0) > 0;
    if ((p10 >= 5 && backed) || (ib.length && ib[0].eta_min <= 20)) return { k: "WET_IMMINENT", overdue: !!s.overdue, inputs: inputs };
    if (ib.length && ib[0].eta_min <= 60) return { k: "APPROACHING", overdue: !!s.overdue, inputs: inputs };
    if (p10 > 0 || p30 >= 5 || wn.length) { if (wn.length) inputs.push(wn.length + " wet airport(s) nearby"); if (p30 >= 5) inputs.push(pct(p30) + " of the 19 mi ring has echo"); return { k: "RAIN_NEARBY", overdue: !!s.overdue, inputs: inputs }; }
    if (s.overdue) return { k: "OVERDUE", overdue: true, inputs: inputs.concat(["window passed dry"]) };
    return { k: "QUIET", overdue: false, inputs: inputs };
  }
  function stateChip(w) {
    /* jules, phase 1 review: a phone cannot hover, so the inputs behind a state must be reachable
       by tap. The chip carries them in a data attribute and a tap toggles them inline. */
    var d = STATES[w.k], why = d.why + (w.inputs.length ? ": " + w.inputs.join(", ") : "");
    return '<span class="st ' + w.k + '" data-why="' + esc(why) + '" title="' + esc(why) + '"><i>' + d.icon + '</i>' + d.text + (w.overdue && w.k !== "OVERDUE" ? " +OVERDUE" : "") + ' <i class="q">?</i></span>';
  }
  document.addEventListener("click", function (ev) {
    var chip = ev.target.closest && ev.target.closest(".st[data-why]"); if (!chip) return;
    ev.stopPropagation(); ev.preventDefault();
    var nx = chip.nextElementSibling;
    if (nx && nx.classList.contains("why")) { nx.remove(); return; }
    var el = document.createElement("div"); el.className = "why"; el.textContent = chip.dataset.why; chip.insertAdjacentElement("afterend", el);
  }, true);
  var ORDER = { WET_NOW: 0, WET_IMMINENT: 1, OVERDUE: 2, APPROACHING: 3, RAIN_NEARBY: 4, UNKNOWN: 5, QUIET: 6, LOCKED: 7 };

  /* ---------------- the next event, and WHEN rain is expected ---------------- */
  function nextEvent(s) {
    var data=forecastTimeline(s);
    if(!data)return legacyNextEvent(s);
    var now=Date.now(),events=inbound(s).map(function(c){return {ms:now+c.eta_min*60000,text:'cell ETA '+Math.round(c.eta_min)+' m, '+c.dbz+' dBZ'};});
    data.upcoming.forEach(function(slot){events.push({ms:Math.max(now,slot.ms),text:(slot.pop>=30?slot.source+' '+pct(slot.pop):'HRRR echo '+slot.hrrr+'%')+' '+(slot.now?'this hour':ctFromMs(slot.ms))});});
    events.sort(function(a,b){return a.ms-b.ms;});return events.length?events[0]:null;
  }
  function legacyNextEvent(s) {
    var now = Date.now(), ib = inbound(s), out = [], lh = currentHour(s);
    if (ib.length) out.push({ ms: now + ib[0].eta_min * 60000, text: "cell ETA " + Math.round(ib[0].eta_min) + " m, " + ib[0].dbz + " dBZ" });
    var best = null;
    twcHours(s).forEach(function (h) { if (h[0] >= lh && +h[1] >= 30 && (best === null || h[0] < best[0])) best = h; });
    if (best) { var ms = localHourToMs(s, best[0]); if (ms) out.push({ ms: ms, text: "weather.com " + pct(best[1]) + " " + (best[0] === lh ? hourWord(s, best[0]) : "at " + ct(s, best[0])) + (best[2] ? ", " + (+best[2]).toFixed(2) + " in" : "") }); }
    var he = hrrrEcho(s).filter(function (h) { return h[0] >= lh; });
    if (he.length) { var ms2 = localHourToMs(s, he[0][0] < lh ? he[0][0] + 24 : he[0][0]); if (ms2) out.push({ ms: ms2, text: "HRRR echo " + hourWord(s, he[0][0]) + " " + he[0][1] + "%" }); }
    (s.forecast && s.forecast.hourly || []).forEach(function (h) { if (h[0] >= lh && +h[1] >= 30) { var m3 = localHourToMs(s, h[0]); if (m3 && !out.some(function (o) { return Math.abs(o.ms - m3) < 3600000; })) out.push({ ms: m3, text: "NWS " + pct(h[1]) + " " + (h[0] === lh ? hourWord(s, h[0]) : "at " + ct(s, h[0])) }); } });
    out.sort(function (a, b) { return a.ms - b.ms; });
    return out.length ? out[0] : null;
  }
  function minuteInHour(s) {
    // minutes into the station's current local hour, from the browser clock and the station offset
    var d = new Date(Date.now() + stationOff(s) * 60000); return d.getUTCMinutes();
  }
  function hourWord(s, h) {
    return contractHour(s, h) === currentHour(s) ? "this hour (" + ct(s, h).replace(" CT", "") + ", " + (60 - minuteInHour(s)) + " min left)" : ct(s, h);
  }
  function rainWindow(s) {
    var data=forecastTimeline(s);
    if(data){
      var rows=data.upcoming;if(!rows.length)return null;
      var first=rows[0],last=rows[rows.length-1];
      return {from:first.hour,to:last.hour,text:(first.now?'now':ctFromMs(first.ms))+(last.ms===first.ms?'':' to '+ctFromMs(last.ms))};
    }
    return legacyRainWindow(s);
  }
  function legacyRainWindow(s) {
    /* WHEN: the span of hours where any of HRRR echo, weather.com 30 percent plus or NWS 30 percent plus
       still lies ahead today, in Central. Null when nothing is ahead. */
    var lh = currentHour(s), hrs = {};
    hrrrEcho(s).forEach(function (h) { h = [contractHour(s, h[0]), h[1]]; if (h[0] >= lh) hrs[h[0]] = 1; });
    var nh = dayHours(s);   // WO-133: hour 24 is contract time when daylight time is on
    twcHours(s).forEach(function (h) { h = [contractHour(s, h[0]), h[1]]; if (h[0] >= lh && h[0] < nh && +h[1] >= 30) hrs[h[0]] = 1; });
    (s.forecast && s.forecast.hourly || []).forEach(function (h) { h = [contractHour(s, h[0]), h[1]]; if (h[0] >= lh && h[0] < nh && +h[1] >= 30) hrs[h[0]] = 1; });
    var k = Object.keys(hrs).map(Number).sort(function (a, b) { return a - b; });
    if (!k.length) return null;
    var first = k[0] === lh ? "now" : ct(s, k[0]).replace(" CT", "");
    return { from: k[0], to: k[k.length - 1], text: (k[0] === k[k.length - 1] ? hourWord(s, k[0]) : first + " to " + ct(s, k[k.length - 1])) };
  }
  function overdueText(s) {
    var pk = s.forecast && s.forecast.pop_peak_hour; if (pk === null || pk === undefined) return "overdue";
    var m = (s.local_hour - pk) * 60; return "past due " + (m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " m" : Math.max(0, m) + " m");
  }
  function timingPhrase(s, w) {
    if (w.k === "LOCKED") return "settles YES, " + gaugeAmt(s);
    if (w.k === "WET_NOW") return "raining at the gauge, not yet 0.01";
    if (w.k === "OVERDUE") return overdueText(s);
    var e = nextEvent(s); if (e) return e.text;
    var b = twcBest(s); if (b && b.pop >= 15) return "best hour " + pct(b.pop) + " at " + (b.stamp ? ctClock(b.stamp) : ct(s, b.hour)) + " (weather.com)";
    return "no rain hour left in the forecast";
  }

  /* The top of the page (Colin, 2026-09-18): the Rain Sentinel status line and its live readings, then
     the experimental panels. Both adapters build their DOM with textContent only; a missing, 404 or
     stale feed is said in words by the adapter, never blanked and never turned into a zero. */
  /* 2026-09-18 (Colin, phone): one line at the very top that answers the three things he checks
     first, so nothing needs a scroll. Built only from the board's own readers: isLocked() for rain
     already recorded, rainingNow() (the gauge's own report first) for rain at an open gauge, and
     the same fresh, usable candidate rows valuePanel() prints. "YES expected" and not "settled",
     because the exchange settles on the next day's official CLI value, not on this board. */
  function glanceHTML() {
    if (!state) return '';
    var st = stations();
    var rained = st.filter(isLocked).map(function (s) { return s.city; });
    var wet = st.filter(function (s) { return !isLocked(s) && rainingNow(s); }).map(function (s) { return s.city; });
    var ca = candidates ? ageMin(candidates.generated_utc) : null, fresh = ca !== null && ca >= 0 && ca <= 5;
    var val = fresh ? (candidates.candidates || []).filter(candUsable).map(function (c) { return c.city; }) : null;
    function list(a) { return a.length ? esc(a.join(', ')) : 'none'; }
    return '<b>Today at a glance</b>'
      + '<span class="g"><b>already rained, YES expected:</b> ' + list(rained) + '</span>'
      + '<span class="g"><b>raining now at an open gauge:</b> ' + list(wet) + '</span>'
      + '<span class="g"><b>value at a real price now:</b> ' + (val === null ? '<b class="stale">prices not fresh</b>' : list(val)) + '</span>';
  }
  /* Tomorrow (Colin, 2026-09-18): "I want a section for the next day's forecast", then "there is a
     market called where will it rain tomorrow, check there". Every city in Kalshi's own event, the
     NWS forecast beside the price, from data/tomorrow.json (build/tomorrow_collect.py).
     Its OWN fetch, not a slot in load()'s Promise.all, so a missing tomorrow.json can never shift
     another feed's index or blank the page. Forecast and price are separate columns and are never
     combined into one number (11a rule 4): this panel shows no value, no edge, no side. */
  var tomorrow = null, tomorrowFailed = false;
  function loadTomorrow() {
    fetchJSON("tomorrow.json").then(function (d) { tomorrow = d; tomorrowFailed = false; renderTomorrow(); },
                                    function () { tomorrowFailed = true; renderTomorrow(); });
  }
  function tomorrowHTML() {
    if (!tomorrow) return tomorrowFailed ? '<b class="stale">tomorrow.json did not load; it is retried every minute.</b>' : "Loading tomorrow's markets.";
    var age = ageMin(tomorrow.generated_utc);
    var rows = Object.keys(tomorrow.stations || {}).map(function (k) { return tomorrow.stations[k]; });
    // wettest NWS forecast first, so the cities in play are at the top
    rows.sort(function (a, b) {
      var pa = (a.nws || {}).peak_pop, pb = (b.nws || {}).peak_pop;
      pa = (pa === null || pa === undefined) ? -1 : pa; pb = (pb === null || pb === undefined) ? -1 : pb;
      return pb - pa || (a.city < b.city ? -1 : a.city > b.city ? 1 : 0);
    });
    function c(x) { return (x === null || x === undefined) ? '-' : String(Math.round(x * 100)); }
    // 2026-09-19: between the board's midnight roll and Kalshi opening the next day's event, the
    // quote is a 404. That is "not open yet", said once at the top, never a raw error in every row.
    var unlisted = tomorrow.event_status === "unlisted" || /404/.test(String(tomorrow.event_error || ""));
    function quoteNote(m) {
      if (unlisted || /404/.test(String(m.error || ""))) return 'not open yet';
      return m.error ? 'no quote, retrying' : 'no quote yet';
    }
    // Listed is not trading: before open_time Kalshi reports status "initialized" with every quote 0,
    // and "0 / 0c" read like a price (2026-09-19 04:07 CT). Anything not "active" says so in words.
    function notTrading(m) { return !!m.status && m.status !== "active"; }
    function opensNote(m) {
      var t = m.open_time ? new Date(m.open_time) : null;
      if (m.status === "initialized" || m.status === "unopened")
        return t && !isNaN(t) ? 'opens ' + t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + ' CT' : 'not trading yet';
      return String(m.status).replace(/_/g, " ");
    }
    var dayName = tomorrow.day ? new Date(tomorrow.day + "T12:00:00Z").toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" }) : "tomorrow";
    var out = '<p class="sen-note"><b>' + esc(tomorrow.event_title || ('Where will it rain on ' + dayName + '?')) + '</b> &middot; '
      + rows.length + ' cities &middot; updated ' + (age === null ? '?' : age + ' min ago')
      + (age !== null && (age < 0 || age > 45) ? ' <b class="stale">(stale: the collector may have stopped)</b>' : '') + '</p>';
    if (unlisted) {
      var prev = tomorrow.prev_event_opened_utc ? new Date(tomorrow.prev_event_opened_utc) : null;
      out += '<p class="sen-note"><b>Kalshi has not opened ' + esc(dayName) + ' yet.</b> Forecast only until it does; prices appear here by themselves.'
        + (prev && !isNaN(prev) ? ' The day before opened at ' + esc(prev.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })) + ' CT.' : '') + '</p>';
    }
    out += ''
      + '<p class="sen-note"><b>Pre-release.</b> This is the NWS forecast, not a settlement fact. The contract day runs 1 AM to 1 AM on your clock (midnight to midnight standard time). <b>Peak</b> is the single wettest hour, not the chance of rain on the day. Forecast and price are separate questions.</p>';
    out += '<table class="sc tm-table"><thead><tr><th>City</th><th>NWS peak hour</th><th>Wet hours</th><th>NWS amount</th><th>Price bid / ask</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var n = r.nws || {}, m = r.market || {};
      var hrs = n.hours || [], last = hrs.length ? hrs[hrs.length - 1][0] : null;
      var nerr = n.error && /Error|<|\(/.test(n.error) ? 'forecast unavailable, retrying' : (n.error || 'no forecast');
      var peak = (n.peak_pop === null || n.peak_pop === undefined) ? '<small>' + esc(nerr) + '</small>'
        : n.peak_pop + '% at ' + esc(n.peak_local) + (n.peak_pop > 0 && n.peak_local === last ? '<br><small class="stale">last hour before cutoff</small>' : '');
      var wet = n.wet_from ? esc(n.wet_from) + ' to ' + esc(n.wet_to) : 'none';
      var amt = (n.qpf_in === null || n.qpf_in === undefined) ? '-' : Number(n.qpf_in).toFixed(2) + ' in';
      var price = notTrading(m) ? '<small>' + esc(opensNote(m)) + '</small>'
        : (m.yes_bid === null || m.yes_bid === undefined) && (m.yes_ask === null || m.yes_ask === undefined)
        ? '<small>' + esc(quoteNote(m)) + '</small>' : c(m.yes_bid) + ' / ' + c(m.yes_ask) + 'c';
      out += '<tr><td><b>' + esc(r.city) + '</b>' + (r.on_board === false ? ' <span class="tm-new">NEW</span>' : '') + '</td><td>' + peak + '</td><td>' + wet + '</td><td>' + amt + '</td><td>' + price + '</td></tr>';
    });
    out += '</tbody></table>';
    var fresh = rows.filter(function (r) { return r.on_board === false; }).map(function (r) { return r.city; });
    if (fresh.length) out += '<p class="sen-note"><span class="tm-new">NEW</span> on Kalshi but not yet on this board\'s gauge roster (' + esc(fresh.join(', ')) + '): forecast and price only, no live gauge reading.</p>';
    return out;
  }
  function renderTomorrow() {
    var el = $("tomorrow-body"); if (!el) return;
    var h = tomorrowHTML(); if (el.__h !== h) { el.innerHTML = h; el.__h = h; }
  }
  function sentinelStations() { return stations().map(function (s) { return { icao: s.icao, city: s.city, local_day: contractDay(s) }; }); }
  function renderSentinel() {
    var gl = $("glance"); if (gl) { var gh = glanceHTML(); if (gl.__h !== gh) { gl.innerHTML = gh; gl.__h = gh; } }
    if (typeof RainExpansionUI !== "undefined") {
      document.querySelectorAll("[data-history-icao]").forEach(function(el) { var station = byIcao(el.getAttribute("data-history-icao")); if (station) RainExpansionUI.render(el, {icao:station.icao,local_day:contractDay(station)}, {compact:true}); });
      var selected = byIcao(apIcao); if(selected) RainExpansionUI.render($("ap-expansion"), {icao:selected.icao,local_day:contractDay(selected)});
      if (state && RainExpansionUI.renderBoard) RainExpansionUI.renderBoard($("experimental-rows"), sentinelStations());
    }
    if (typeof RainSentinelUI === "undefined") return;
    if (RainSentinelUI.statusLine) {
      var board = sentinelStations(), line = RainSentinelUI.statusLine(sentinel, board), st = $("sentinel-status");
      if (st && st.textContent !== line) st.textContent = line;
      if (state) RainSentinelUI.renderBoard($("sentinel-rows"), sentinel, board, {fetchFailed:sentinelFailed || !!lastLoadFail});
    }
    document.querySelectorAll("[data-sentinel-icao]").forEach(function (el) {
      var s = byIcao(el.getAttribute("data-sentinel-icao"));
      if (s) RainSentinelUI.render(el, sentinel, {icao:s.icao, local_day:contractDay(s)},
        {compact:true, fetchFailed:sentinelFailed || !!lastLoadFail});
    });
    var s = byIcao(apIcao);
    if (s) RainSentinelUI.render($("ap-sentinel"), sentinel, {icao:s.icao, local_day:contractDay(s)},
      {fetchFailed:sentinelFailed || !!lastLoadFail});
  }

  /* ---------------- data ---------------- */
  // 2026-09-19: the collector's NAMES table (collect_state.py, a money file the seats must approve)
  // has no entry for the five cities added 2026-09-18, so it sends the code as the name and the
  // station header read "CMH KCMH, CMH". A display-side fallback only; it never renames a city the
  // collector did name.
  var CITY_NAMES = { CMH: "Columbus", MKE: "Milwaukee", LEX: "Lexington", CLL: "College Station", PVD: "Providence" };
  function nameStations(st) {
    ((st && st.stations) || []).forEach(function (s) {
      if ((!s.name || s.name === s.city) && CITY_NAMES[s.city]) s.name = CITY_NAMES[s.city];
    });
    return st;
  }
  function loadData() {
    return Promise.all([
      fetchJSON("state.json"), fetchJSON("settle.json").catch(function () { return null; }),
      fetchJSON("physics_v3.json").catch(function () { return null; }),   // the ONE model feed (v3, Colin's order 2026-09-16)
      fetchJSON("models.json").catch(function () { return null; }), fetchJSON("cams_rings.json").catch(function () { return null; }),
      fetchJSON("metars.json").catch(function () { return null; }), fetchJSON("next_markets.json").catch(function () { return null; }),
      fetchJSON("scorecard.json").catch(function () { return null; }),
      fetchJSON("book.json").catch(function () { return null; }),          // WO-133: the websocket book (absent = collector quotes only)
      fetchJSON("candidates.json").catch(function () { return null; }),    // WO-133: priced candidates, computed by board_alerts.py, never in the browser
      fetchJSON("cam_health.json").catch(function () { return null; }),
      fetchJSON("briefing.json").catch(function () { return null; }),
      fetchJSON("sentinel.json").catch(function () { return null; }),
      fetchJSON("rain_history.json").catch(function () { return null; }),
      fetchJSON("forecast_history.json").catch(function () { return null; }),
      fetchJSON("forecast_skill.json").catch(function () { return null; }),
      fetchJSON("pysteps.json").catch(function () { return null; }),
      fetchJSON("storm_context.json").catch(function () { return null; })
    ]).then(function (r) {
      var accepted = typeof RainSentinelUI === "undefined" ? sentinel : RainSentinelUI.accept(sentinel, r[12]);
      sentinelFailed = !r[12] || accepted !== r[12]; sentinel = accepted;
      var newerPhysics = typeof RainExpansionUI === "undefined" ? r[2] : RainExpansionUI.legacy(physics,r[2]);
      physicsFailed = !r[2] || newerPhysics !== r[2];
      if(typeof RainExpansionUI !== "undefined") RainExpansionUI.update(r.slice(13));
      state = nameStations(r[0]); settle = r[1]; physics = newerPhysics; models = r[3]; if (r[4]) camRings = r[4]; ringsError = r[4] ? null : Date.now(); metars = r[5]; nextm = r[6]; scorecardData = r[7]; book = r[8]; candidates = r[9]; if (r[10]) camHealth = r[10]; healthError = r[10] ? null : Date.now(); if (r[11]) { briefing = r[11]; briefingFail = null; } else if (briefing) { briefingFail = Date.now(); } lastLoadOk = Date.now(); lastLoadFail = null; render(); })
      .catch(function (e) {
        // the last valid output stays on screen, marked: a failed refresh is a fact, not a blank page
        lastLoadFail = { at: Date.now(), why: e.message };
        $("fresh").textContent = (state ? "STALE, update failed" : "data failed: " + e.message); $("fresh").classList.add("bad");
        staleBanner(); renderSentinel();
      });
  }
  // a load that is already running is not started again (a returning tab and the minute tick can coincide)
  function load() { if (loading) return loading; loading = loadData().then(function () { loading = null; }, function () { loading = null; }); return loading; }
  // WO-149: a backgrounded phone tab keeps a throttled minute tick at best. Coming back to the tab,
  // the page, or the window refetches at once when the last successful load is older than 20 s.
  function wake() { if (document.visibilityState === "hidden") return; renderSentinel(); if (lastLoadOk === null || Date.now() - lastLoadOk > 20000) load(); }
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  // WO-133: a healthy collector heartbeat used to be the only freshness signal, while the Synoptic
  // 1-minute feed had been DOWN for days with feeds.synoptic.stale = false. The header now names a
  // dead fast feed and the state of the websocket book.
  /* Synoptic: settle.json feeds.synoptic.disabled carries the Synoptic API's own reply, which on this
     account is "No stations found for this request, or your account does not [have access]". That is
     an ACCOUNT LIMIT, not an outage (Colin, 2026-09-16), so it is said as one. The flag itself is
     untouched; any other reason is shown as the API gave it. */
  function synopticWord() {
    var f = settle && settle.feeds || {}, s = f.synoptic || {};
    if (!s.disabled) return "Synoptic ok";
    var why = String(s.disabled);
    return "Synoptic off (" + (/account does not|no stations found/i.test(why) ? "account has no access" : why.slice(0, 60)) + ")";
  }
  function fastFeedsTxt() { var w = synopticWord(); return (w === "Synoptic ok" ? w : '<b class="stale">' + esc(w) + '</b>') + '; MADIS/AWC via pulse ' + (metars ? agoTxt(metars.generated_utc) : 'missing'); }
  function bookAge() {
    var stamp = book && Date.parse(book.written_utc);
    return typeof stamp === "number" && isFinite(stamp) ? (Date.now() - stamp) / 60000 : null;
  }
  function bookFeedTxt() { if (!book) return '<b class="stale">not running</b> (5-minute collector quotes only)'; var a = bookAge(), st = (book.feed || {}).status; return (st === "LIVE" && a !== null && a >= 0 && a <= 2 ? 'LIVE' : '<b class="stale">' + esc(st === 'LIVE' ? 'STALE' : st || 'unknown') + '</b>') + ', written ' + agoTxt(book.written_utc) + (book.feed && book.feed.reconnects ? ', ' + book.feed.reconnects + ' reconnects' : ''); }
  /* The header's LIVE is scoped to the three feeds the page reads live (Colin, 2026-09-16: "LIVE 8m"
     was the collector's age alone while the pulse or the model could be an hour old). Each has its own
     window: the collector runs every 5 minutes, the 1-minute pulse writes metars.json every minute, the
     v3 model runs every 15 minutes. LIVE only when all three are inside; otherwise the old one is named. */
  var LIVE_WINDOWS = { collector: 10, pulse: 5, model: 35 };
  function feedAges() {
    return [["collector", ageMin(state && state.generated_utc), LIVE_WINDOWS.collector],
            ["pulse", ageMin(metars && metars.generated_utc), LIVE_WINDOWS.pulse],
            ["model v3", physAge(), LIVE_WINDOWS.model]];
  }
  function freshness() {
    var a = ageMin(state && state.generated_utc), el = $("fresh");
    var syn = settle && settle.feeds && settle.feeds.synoptic && settle.feeds.synoptic.disabled, ba = bookAge(), bl = book && book.feed && book.feed.status === "LIVE" && ba !== null && ba >= 0 && ba <= 2;
    var old = feedAges().filter(function (f) { return f[1] === null || f[1] < 0 || f[1] > f[2]; }).map(function (f) { return f[0] + " " + (f[1] === null ? "missing" : f[1] + "m"); });
    var stale = old.length > 0 || !!lastLoadFail;
    el.innerHTML = (stale ? "STALE " + (lastLoadFail ? "update failed" : esc(old.join(", "))) : "LIVE " + (a < 1 ? "now" : a + "m")) + (bl ? ' <small>book live</small>' : ' <small class="stale">book off</small>') + (syn ? ' <small class="stale">' + esc(synopticWord()) + '</small>' : '');
    el.classList.toggle("bad", stale);
    el.title = "state.json " + (state ? state.generated_utc : "") + "; metars " + (metars ? metars.generated_utc : "none") + "; physics_v3 " + (physics ? physics.generated_utc : "none") + "; settle " + (settle ? settle.generated_utc : "none") + "; briefing " + (briefing ? briefing.generated_utc : "none");
    staleBanner();
  }
  /* the banner under the header: shown only when something the reader should know is wrong with the
     data on screen, and it names the check, the time and the age. Never a bare "stale". */
  function staleBanner() {
    var el = $("stale-banner"); if (!el) return;
    var a = ageMin(state && state.generated_utc), parts = [];
    if (lastLoadFail) parts.push("the last refresh failed at " + ctFromMs(lastLoadFail.at) + " (" + esc(lastLoadFail.why) + "); showing the data from " + (state ? agoTxt(state.generated_utc) : "no earlier load"));
    if (a !== null && (a < 0 || a > 10)) parts.push("the collector's state.json is " + a + " min old (it runs every 5 minutes)");
    var ma = metars ? ageMin(metars.generated_utc) : null, p3 = physAge(), br = briefing ? ageMin(briefing.generated_utc) : null;
    if (!metars) parts.push("the 1-minute pulse file (metars.json) did not load");
    else if (ma === null || ma < 0 || ma > LIVE_WINDOWS.pulse) parts.push("the 1-minute pulse file is " + (ma === null ? "undated" : ma + " min old") + " (it writes every minute)");
    if (!physics) parts.push("the v3 model feed (physics_v3.json) did not load; every card says v3 unavailable");
    else if (p3 === null || p3 < 0 || p3 > LIVE_WINDOWS.model) parts.push("v3 was generated " + (p3 === null ? "at an unknown time" : physAgoTxt()) + " (it runs every 15 minutes)");
    if (briefing && (br === null || br < 0 || br > 40)) parts.push("the briefing was generated " + agoTxt(briefing.generated_utc) + " (it runs every 15 minutes)");
    if (briefingFail) parts.push("the briefing refresh failed at " + ctFromMs(briefingFail) + "; the briefing shown is from " + agoTxt(briefing && briefing.generated_utc));
    el.innerHTML = parts.length ? '<b>Check the ages before acting:</b> ' + parts.join('; ') + '.' : '';
    el.classList.toggle("hidden", !parts.length);
  }

  /* ---------------- routing: #KBOS opens the airport panel, empty hash is the board ---------------- */
  function route() {
    var h = location.hash.replace(/^#/, "").toUpperCase().replace(/^AIRPORT\//, "");
    if (h && byIcao(h)) { apIcao = h; openAirport(); } else closeAirport(false);
  }
  window.addEventListener("hashchange", route);
  function go(icao) {
    // the big map flies to the city too, so when the panel closes the map is sitting on it
    // pan the big map to the city at its CURRENT zoom: zooming in here left the other 21 cities
    // off screen and untappable after the panel closed (headless test, 17:00 CT)
    var s = byIcao(icao); if (s && maps.live && s.lat !== null && s.lat !== undefined) maps.live.easeTo({ center: [s.lon, s.lat], duration: 600 });
    if (location.hash === "#" + icao) route(); else location.hash = icao;
  }
  function openAirport() { $("airport").classList.remove("hidden"); document.body.style.overflow = "hidden"; renderAirport(); setTimeout(function () { if (maps.airport) maps.airport.resize(); }, 60); }
  function closeAirport(setHash) { var rd = $("ap-rings"); if (rd) rd.open = false; $("airport").classList.add("hidden"); document.body.style.overflow = ""; closeSheet(); if (setHash !== false && location.hash) history.replaceState(null, "", location.pathname + location.search); renderMarkers(); renderQueue(); }
  $("ap-close").onclick = function () { closeAirport(true); };

  /* ---------------- render ---------------- */
  function render() {
    if (!state) return;
    freshness();
    var sheet = $("sheet");
    if (sheet && sheet.__cam) {
      if (!(ringAvailable(sheet.__cam)) || sheet.__catalog !== (camRings && camRings.updated_utc)) closeSheet();
      else { var caption = sheet.querySelector("small"); if (caption) caption.textContent = mi(sheet.__cam.dist_km) + " mi " + (sheet.__cam.dir || "") + " of the gauge; " + ringFreshTxt(sheet.__cam); }
    }
    if (camPopup && camPopup.__cam && camRings) {
      var ps = byIcao(camPopup.__icao || apIcao), previousCamera = camPopup.__cam;
      var currentCamera = ps && (previousCamera.band ? ringsFor(ps) : camsFor(ps)).filter(function (c) { return (c.url || c.frame || c.name) === (previousCamera.url || previousCamera.frame || previousCamera.name); })[0];
      if (!currentCamera || !ringAvailable(currentCamera)) { camPopup.remove(); camPopup = null; }
      else {
        camPopup.__cam = currentCamera;
        var popupCaption = camPopup.getElement() && camPopup.getElement().querySelector(".cap small:last-child");
        if (popupCaption) popupCaption.textContent = ringFreshTxt(currentCamera);
      }
    }
    if (camPopup && camPopup.__cam && camPopup.__cam.type !== "youtube") {
      // codex round 2: an open still refreshes in place instead of showing one frame forever
      var popupEl = camPopup.getElement(), pc = camPopup.__cam;
      var pi = popupEl && popupEl.querySelector("img");
      if (!pi && popupEl && ringAvailable(pc)) {
        var failedImage = popupEl.querySelector(".ph");
        if (failedImage) {
          pi = document.createElement("img"); pi.alt = ""; pi.referrerPolicy = "no-referrer";
          pi.onerror = function () { var d = document.createElement("div"); d.className = "ph";
            d.textContent = camIsProxied(pc) ? "camera frame unavailable on this host; the source may still be working" : "no picture from the source right now";
            this.replaceWith(d); };
          failedImage.replaceWith(pi);
        }
      }
      if (pi) { var u0 = camURL(camPopup.__cam); pi.src = u0 + (u0.indexOf("?") > 0 ? "&" : "?") + "t=" + Math.floor(Date.now() / 60000); }
    }
    if (liveSel && byIcao(liveSel) && !$("mapcard").classList.contains("hidden")) {
      var ls = byIcao(liveSel); $("mapcard").innerHTML = mapCardHTML(ls); bindMapCard(ls);
      if (maps.live && maps.live.getSource("ring6")) { clearLiveOverlay(false); drawOverlays(maps.live, ls, liveOverlay); }   // codex: ETAs and ages baked into the labels went stale
    }
    var mp = valuePanel() + modelPanel(); if ($("model").dataset.html !== mp) { $("model").innerHTML = mp; $("model").dataset.html = mp; bindRows($("model")); }
    ensureLiveMap(); renderMarkers();
    renderQueue();
    renderScorecard();
    if (!$("airport").classList.contains("hidden")) refreshAirport();
  }
  function bindRows(root) { root.querySelectorAll("[data-icao]").forEach(function (el) { el.onclick = function (ev) { ev.stopPropagation(); go(el.dataset.icao); }; }); }

  /* 0. WO-133: the first screen. What is worth something at the price you can actually get, with the
     evidence that supports it, the evidence against it, how old each input is, how much is there, and
     what happens next. The numbers come from candidates.json (board_alerts.py, edge.py); the browser
     does not recompute value with a second formula. The old disagreement list stays below as a
     diagnostic: |v3 - YES ask| is not value, and it never priced the NO side. */
  /* codex P1 on #153 (bf01a4d): a candidates.json row is shown only when the model that priced it IS
     the model on this page. board_alerts stamps every row with the model_id it used; the page's model
     is physics_v3.json's model_id. No match, or no identity on either side, and the row is WITHHELD:
     no probability, no value, in the value queue, the in-range list and the station detail alike.
     When the v3 feed or its model_id is missing every candidate is unverifiable and the panel says so.
     A writer that refused its feed (stale, undated, missing) writes an empty list with a reason, and
     that reason is what the page prints. */
  /* 2026-09-18 (Colin: "switch alerts to v3"): board_alerts.py now prices candidates with v3, the
     model on this page, so a matching row shows normally. A row whose model_id is not this page's v3
     model_id (a pre-switch feed in its first minute, or a mid-day v3 rebuild) is WITHHELD with a
     neutral reason: its number is never printed and the other model is never named. The row is also
     refused when it carries no identity, was priced in a different inference mode (time_fix is part
     of the identity, codex P1 on PR #126), is for another contract day, or its station's v3 row is
     itself refused. Stale candidates are refused as a whole list in valuePanel() and candFor(). */
  function candIdentityWord() { return (!physics || typeof physics.model_id !== "string" || !physics.model_id.trim()) ? "candidates withheld: v3 identity unverified (the v3 feed or its model_id is missing)" : null; }
  function candWithheldWord(c) {
    var w = candIdentityWord(); if (w) return w;
    if (!c || typeof c.model_id !== "string" || !c.model_id.trim()) return (candidates && candidates.reason) ? "not priced: " + String(candidates.reason) : "candidate withheld: the row carries no model identity";
    if (c.model_id !== physics.model_id) return "candidate withheld: priced by a different model build, refreshing";
    if (!!c.time_fix !== !!physics.time_fix) return "candidate withheld: priced in a different model mode, refreshing";
    var s = byIcao(c.icao);
    if (!s) return "candidate withheld: no gauge on this page for the row";
    var cday = c.contract && c.contract.contract_day;
    if (!cday) return "candidate withheld: the row carries no contract day";
    if (cday !== contractDay(s)) return "candidate withheld: priced for contract day " + String(cday) + ", not " + contractDay(s);
    var refused = physWord(s);
    if (refused) return "candidate withheld: " + refused;
    return null;
  }
  // The pricing line (Colin, 2026-09-18): where candidates show, one line says which model priced them.
  function alertsPricedTxt() {
    var rows = (candidates && candidates.stations) || [];
    if (!rows.length || candIdentityWord()) return null;
    var mine = rows.filter(function (c) { return c && c.model_id === physics.model_id; }).length;
    if (mine === rows.length) return "alerts: priced by v3";
    return "alerts: priced by v3 where this page's v3 build matches (" + mine + " of " + rows.length + " rows); the rest are withheld while the pricing refreshes";
  }
  /* Fix B (jules, on 41a6541): every v3 percentage carries its record beside it. The measured bucket is
     shown only when the feed ships THIS fit's own record (physRel); otherwise the word is "unmeasured". */
  function v3Rec(p, s) { var r = physRel(p, s); return r ? "measured " + r.actual_pct + "% at n=" + r.n + (r.n < 20 ? ", thin" : "") : "unmeasured"; }
  function v3Tag(p, s) { return ' <small class="rec">' + esc(v3Rec(p, s)) + '</small>'; }
  function candUsable(c) { return !candWithheldWord(c); }
  function candFor(s) { var c = candidates && candidates.stations, a = candidates ? ageMin(candidates.generated_utc) : null; if (!c || a === null || a < 0 || a > 5) return null; for (var i = 0; i < c.length; i++) if (c[i].icao === s.icao) return c[i]; return null; }
  function valueRow(c) {
    var s = byIcao(c.icao); if (!s) return '';
    var e = c[c.side], ex = e.executable, w = wetState(s), nx = nextEvent(s);
    return '<div class="dis val" data-icao="' + c.icao + '"><div><b>' + esc(c.city) + '</b> ' + stateChip(w) + ' <b class="side ' + c.side + '">' + c.side.toUpperCase() + '</b></div>'
      + '<div class="r num">v3 <b>' + pct(c.p_yes_pct) + '</b>' + v3Tag(c.p_yes_pct, s) + ' &middot; ' + c.side.toUpperCase() + ' at <b>' + cents(ex.avg) + '</b> for ' + c.qty + ' (' + Math.round(ex.best_size || 0) + ' at best' + (ex.partial ? ', PARTIAL' : '') + ')</div>'
      + '<div class="when">net after fees <b class="' + (e.net_per > 0 ? 'pos' : 'neg') + '">' + (100 * e.net_per).toFixed(1) + 'c</b> per contract, band ' + (100 * e.net_lo_per).toFixed(1) + ' to ' + (100 * e.net_hi_per).toFixed(1) + 'c; walk away above ' + cents(e.max_price_for_zero)
      + ' &middot; quote: ' + esc(c.book_source) + ' ' + (c.book_age_s !== null ? c.book_age_s + ' s old' : '') + ' &middot; gauge ' + (c.gauge_age_min !== null && c.gauge_age_min !== undefined ? c.gauge_age_min + ' m' : '?') + ', radar scan ' + (c.radar_scan_age_min !== null ? c.radar_scan_age_min + ' m' : '?')
      + ' &middot; ' + (c.contract.minutes_left !== null ? Math.floor(c.contract.minutes_left / 60) + ' h ' + (c.contract.minutes_left % 60) + ' m left' : '') + (nx ? ' &middot; next: ' + esc(nx.text) : '')
      + (c.conflicts.length ? '<br><b class="stale">against: ' + esc(c.conflicts.join('; ')) + '</b>' : '') + '</div></div>';
  }
  /* The v3 section's label (Colin, 2026-09-18): v3 is the working forecast, it prices the phone alerts,
     it is the backup until the Rain Sentinel is validated, and its record is said with it. */
  function v3Label() {
    return '<div class="v3-label"><b>v3 forecast</b>: drives your alerts, backup until the Sentinel is validated, ' + (relTable() ? 'record measured on this fit\'s own unseen dates (each number says its bucket)' : 'record unmeasured') + '</div>';
  }
  function valuePanel() {
    var head = v3Label() + '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:16px">Worth something at an executable price</b><small>';
    if (!candidates) return head + 'candidates.json missing: board_alerts.py is not running, so nothing is priced. Below is the model only.</small></div><div class="grp"><small>No priced candidates. A model number alone is not a candidate.</small></div>';
    var age = ageMin(candidates.generated_utc), rows = candidates.candidates || [], bk = candidates.book_feed_status;
    // codex P1, round 3: a candidates.json whose writer stopped would sit on the page for hours with
    // its frozen "quote 2 s old". Past the refresh allowance the whole list is refused, not decorated.
    if (age === null || age < 0 || age > 5) return head + '<b class="stale">candidates.json is ' + (age === null ? 'undated' : age + ' m old') + ' (writer stopped?); nothing is priced until it refreshes.</b></small></div>';
    var priced = alertsPricedTxt();
    head += 'priced ' + agoTxt(candidates.generated_utc) + ' for ' + candidates.qty + ' contracts, taker fees, ' + (bk === "LIVE" ? 'websocket book' : 'collector quotes only (book feed ' + esc(bk || 'off') + ')') + '. NO range 0 to 10%, YES range 90 to 100%. A row needs a fresh quote, a positive net after fees for the full quantity, and no sky conflict.</small></div>'
      + (priced ? '<div class="grp alerts-priced"><small><b>' + esc(priced) + '</b></small></div>' : '');
    var idw = candIdentityWord();
    if (idw) return head + '<div class="grp"><b class="stale">' + esc(idw) + '</b><small> ' + rows.length + ' priced row' + (rows.length === 1 ? '' : 's') + ' and the in-range list are withheld, without their numbers, until the v3 feed identifies itself.</small></div>';
    var shown = rows.filter(candUsable), withheld = rows.filter(function (c) { return !candUsable(c); });
    var body = shown.length ? shown.map(valueRow).join("") : '<div class="grp"><small>nothing clears value right now' + (candidates.reason ? ' <b class="stale">(' + esc(candidates.reason) + ')</b>' : '') + '</small></div>';
    if (withheld.length) body += '<div class="grp"><small><b class="stale">withheld</b>: ' + withheld.map(function (c) { return esc(c.city) + ' (' + esc(candWithheldWord(c)) + ')'; }).join(' &middot; ') + '</small></div>';
    var blocked = (candidates.stations || []).filter(function (x) { return candUsable(x) && !x.side && x.p_yes_pct !== null && x.p_yes_pct !== undefined && (x.p_yes_pct <= 10 || x.p_yes_pct >= 90); });
    var blockedWithheld = (candidates.stations || []).filter(function (x) { return !candUsable(x) && !x.side && x.p_yes_pct !== null && x.p_yes_pct !== undefined; });
    if (blockedWithheld.length) body += '<div class="grp"><small><b class="stale">withheld, no number shown</b>: ' + blockedWithheld.map(function (x) { return esc(x.city) + ' (' + esc(candWithheldWord(x)) + ')'; }).join(' &middot; ') + '</small></div>';
    if (blocked.length) {
      // a conflict every in-range station shares (after midnight that is "no gauge observation") is said
      // once, so each station's OWN reason is the one that shows
      var shared = blocked[0].conflicts.filter(function (c) { return blocked.every(function (x) { return x.conflicts.indexOf(c) >= 0; }); });
      // 2026-09-18 (Colin, phone): this list was one run-on sentence joined with middots, every
      // station's number, record and reason in a single wrapped paragraph. Same data, one row each,
      // so a station can be found at a glance. The record stays beside every v3 number (09-09 law)
      // and a row still opens its station through bindRows' [data-icao] hook.
      body += '<div class="grp"><small>' + (shared.length ? '<b>all ' + blocked.length + ' in range:</b> ' + esc(shared.join('; ')) + '<br>' : '') + '<b>in range but not a candidate</b> (v3 numbers; tap a row to open it)</small>'
        + '<table class="sc inrange"><thead><tr><th>Station</th><th>v3</th><th>Net</th><th>Why not a candidate</th></tr></thead><tbody>'
        + blocked.map(function (x) {
            var e = x.p_yes_pct <= 10 ? x.no : x.yes, own = x.conflicts.filter(function (c) { return shared.indexOf(c) < 0; });
            var why = own[0] || (e && e.reason) || (shared.length ? 'only the shared reason' : '');
            return '<tr data-icao="' + x.icao + '" style="cursor:pointer">'
              + '<td><b>' + esc(x.city) + '</b></td>'
              + '<td>' + pct(x.p_yes_pct) + '<br><small class="rec">' + esc(v3Rec(x.p_yes_pct, byIcao(x.icao))) + '</small></td>'
              + '<td>' + (e && e.net_per !== null && e.net_per !== undefined ? (100 * e.net_per).toFixed(1) + 'c' : '-') + '</td>'
              + '<td><small>' + esc(why) + '</small></td></tr>';
          }).join('') + '</tbody></table></div>';
    }
    return body;
  }

  /* 1. the model panel: LOW / HIGH modelled probability, MARKET DISAGREES (diagnostic), each with WHEN */
  function modelPanel() {
    var lo = [], hi = [], mid = [], wet = [], dis = [];
    stations().forEach(function (s) {
      var p = physPct(s); if (p === null) return;
      if (isLocked(s)) { wet.push(s); return; }
      var ask = marketYes(s), gap = ask === null ? null : Math.round(ask * 100) - Math.round(p), win = rainWindow(s), w = wetState(s), qa = ageMin((s.market || {}).fetched_utc);
      var item = { s: s, pct: p, ask: ask, gap: gap, win: win, w: w, qa: qa };
      // WO-133: Colin's ranges are 0-10 inclusive and 90-100. The high section used to start at 80.
      if (p <= 10) lo.push(item); else if (p >= 90) hi.push(item); else mid.push(item);
      // codex round 2: a carried quote (over 15 min old) cannot make the disagreement list
      if (gap !== null && Math.abs(gap) >= 15 && qa !== null && qa >= 0 && qa <= 15) dis.push(item);
    });
    lo.sort(function (a, b) { return a.pct - b.pct; }); hi.sort(function (a, b) { return b.pct - a.pct; }); dis.sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); });
    var rl = physRel(5), rh = physRel(85), r9 = physRel(95);
    function qtxt(x) { return x.qa === null ? '' : (x.qa < 0 || x.qa > 15 ? ' <b class="stale">quote ' + x.qa + ' m old</b>' : x.qa > 5 ? ' <small>quote ' + x.qa + ' m old</small>' : ''); }
    // WO-133 (codex read-only review, reproduced): every under-10 station was drawn as chip(x, "QUIET")
    // whatever the sky was doing. Phoenix at 02:27 CT on 2026-09-12 was 1% modelled with 70% of the
    // 6 mi ring showing echo and the chip said QUIET under "WILL NOT RAIN". The model's probability
    // and the sky's state are two different facts; the chip now wears the SKY's state, and a low
    // number with a live sky is flagged as a conflict instead of styled as reassurance.
    function conflict(x) { var k = x.w.k, nw = nwsPeak(x.s), td = twcDay(x.s); if (x.pct <= 10 && (k === "WET_NOW" || k === "WET_IMMINENT" || k === "APPROACHING" || k === "RAIN_NEARBY")) return "sky " + STATES[k].text; if (x.pct >= 90 && (k === "QUIET" || k === "OVERDUE")) return "sky " + STATES[k].text; if (x.pct <= 10 && ((nw !== null && nw >= 50) || (td !== null && td >= 50))) return "NWS " + pct(nw) + (td !== null ? ", wx.com " + pct(td) : ""); if (x.pct >= 90 && ((nw !== null && nw <= 30) || (td !== null && td <= 30))) return "NWS " + pct(nw); if (k === "UNKNOWN") return "input stale"; return null; }
    function chip(x, cls) { var cf = conflict(x); return '<span class="st ' + x.w.k + (cf ? ' conflict' : '') + '" data-icao="' + x.s.icao + '" style="cursor:pointer" title="' + esc(STATES[x.w.k].text + '; ' + (x.win ? 'rain hours ahead ' + x.win.text : 'no rain hour ahead')) + '"><i>' + STATES[x.w.k].icon + '</i><b>' + esc(x.s.city) + '</b>&nbsp;v3 ' + pct(x.pct) + v3Tag(x.pct, x.s) + (cf ? ' <b class="cf">' + esc(cf) + '</b>' : '') + (' &middot; market YES ' + quoteCents(x.ask) + qtxt(x)) + ' <small>' + (x.win ? esc(x.win.text) : 'no rain hour ahead') + '</small></span>'; }
    function gapRow(x) {
      var side = x.gap > 0 ? "market " + x.gap + " points ABOVE v3" : "market " + (-x.gap) + " points BELOW v3";
      return '<div class="dis" data-icao="' + x.s.icao + '"><div><b>' + esc(x.s.city) + '</b> ' + stateChip(x.w) + '</div><div class="r num">v3 <b>' + pct(x.pct) + '</b>' + v3Tag(x.pct, x.s) + ' vs market YES <b>' + cents(x.ask) + '</b>' + qtxt(x) + '</div>'
        + '<div class="when">' + side + ' points &middot; ' + (x.win ? 'rain hours ahead: <b>' + esc(x.win.text) + '</b>' : 'no rain hour ahead in any forecast') + ' &middot; ' + esc(timingPhrase(x.s, x.w)) + '</div></div>';
    }
    var feedTxt = physStale() ? '<b class="stale">' + esc(physStale()) + '</b>' : (physics ? 'v3 ' + physAgoTxt() : '<b class="stale">v3 unavailable: feed missing</b>');
    return '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:16px">What v3 says today</b><small>' + feedTxt + ', newest quote ' + agoTxt(stations().map(function (s) { return (s.market || {}).fetched_utc; }).filter(Boolean).sort().pop()) + '; a quote over 15 min old is marked and kept out of the disagreements</small></div>'
      + '<div class="grp"><small><b>LOW MODELLED PROBABILITY</b> (0 to 10%, NO candidates' + (rl ? '; on unseen dates this bucket rained ' + rl.actual_pct + '% of the time, n=' + rl.n : '; this bucket: unmeasured on this fit') + '). The chip is the SKY, the number is the MODEL; a flagged chip is a conflict to read before anything else.</small>' + (lo.length ? lo.map(function (x) { return chip(x); }).join("") : '<small>none</small>') + '</div>'
      + '<div class="grp"><small><b>HIGH MODELLED PROBABILITY</b> (90 to 100%, YES candidates' + (r9 ? '; 90s settled YES ' + r9.actual_pct + '% at n=' + r9.n + (r9.n < 20 ? ', thin' : '') : '; 90 and up: unmeasured on this fit') + ')</small>' + (hi.length ? hi.map(function (x) { return chip(x); }).join("") : '<small>none right now</small>') + '</div>'
      + (wet.length ? '<div class="grp"><small><b>ALREADY WET</b></small>' + wet.map(function (s) { return '<span class="st LOCKED" data-icao="' + s.icao + '" style="cursor:pointer">' + esc(s.city) + ' ' + esc(gaugeAmt(s)) + '</span>'; }).join("") + '</div>' : '')
      + '<div class="grp"><small><b>MARKET DISAGREES WITH v3</b> by 15 points or more (' + dis.length + ')</small>' + (dis.length ? dis.map(gapRow).join("") : '<small>no gap of 15 points anywhere</small>') + '</div>'
      + '<div class="grp"><small><b>IN BETWEEN</b> (11 to 89%, v3 is a coin flip in the middle): ' + (mid.length ? mid.sort(function (a, b) { return b.pct - a.pct; }).map(function (x) { return '<span data-icao="' + x.s.icao + '" style="cursor:pointer">' + esc(x.s.city) + ' v3 ' + pct(x.pct) + ' ' + esc(v3Rec(x.pct, x.s)) + '</span>'; }).join(', ') : 'none') + '</small></div>';
  }

  /* 3. the queue */
  function quoteAge(m) { var a = ageMin(m && m.fetched_utc); return a === null ? '' : (a < 0 || a > 15 ? ' <b class="stale">quote ' + a + ' m old</b>' : a > 5 ? ' quote ' + a + ' m old' : ''); }
  function priceHTML(s) { var m = s.market || {}; return '<div class="price num">YES ask ' + quoteCents(marketQuote(m, "ask")) + '<small>bid ' + quoteCents(marketQuote(m, "bid")) + quoteAge(m)+ (m.momentum && m.momentum.delta_15m !== null && m.momentum.delta_15m !== undefined && m.momentum.delta_15m !== 0 ? ', ' + (m.momentum.delta_15m > 0 ? '+' : '') + m.momentum.delta_15m + ' in 15 m' : '') + '</small></div>'; }
  function rowHTML(s, w, extra) {
    var o = s.observed || {}, g = gaugeTxt(s), a = obAge(s), p = physPct(s), win = rainWindow(s);
    return '<div class="row' + (w.overdue ? ' ovl' : '') + (s.icao === liveSel ? ' sel' : '') + '" data-icao="' + s.icao + '">'
      + '<div><div class="city">' + esc(s.city) + '<small>' + s.icao + '</small></div>' + stateChip(w) + '</div>'
      + '<div class="right">' + priceHTML(s) + '<div class="gauge num">gauge <b' + (isLocked(s) ? ' class="lock"' : '') + '>' + g + '</b>' + (a !== null ? ' <small>' + a + ' m</small>' : '') + '</div></div>'
      + '<div class="line timing">' + (p !== null ? 'v3 <b>' + pct(p) + '</b>' + v3Tag(p, s) : '<b class="stale">' + esc(physWord(s) || 'v3 unavailable') + '</b>') + ' &middot; ' + esc(timingPhrase(s, w)) + (win && w.k !== "LOCKED" ? ' &middot; rain hours ahead <b>' + esc(win.text) + '</b>' : '') + '</div>'
      + '<div class="history-context" data-history-icao="' + esc(s.icao) + '"></div><div class="sentinel-stats sentinel-compact" data-sentinel-icao="' + esc(s.icao) + '"></div>'
      + (extra || '') + '</div>';
  }
  function sortLive(a, b) {
    var wa = wetState(a), wb = wetState(b), d = ORDER[wa.k] - ORDER[wb.k]; if (d) return d;
    var ea = nextEvent(a), eb = nextEvent(b); if (ea && eb) return ea.ms - eb.ms; if (ea) return -1; if (eb) return 1;
    return (physPct(b) || 0) - (physPct(a) || 0);
  }
  function renderQueue() {
    var S = stations().slice().sort(sortLive);
    var counts = { ALL: S.length, WET: S.filter(function (s) { var k = wetState(s).k; return k === "WET_NOW" || k === "WET_IMMINENT" || k === "LOCKED"; }).length,
      OVERDUE: S.filter(function (s) { var w = wetState(s); return w.overdue || w.k === "OVERDUE"; }).length,
      NEXT3H: S.filter(function (s) { var e = nextEvent(s); return e && e.ms - Date.now() <= 3 * 3600000 && !isLocked(s); }).length };
    $("queue-filters").innerHTML = ["ALL", "WET", "NEXT3H", "OVERDUE"].map(function (k) { return '<button data-f="' + k + '" class="' + (queueFilter === k ? "on" : "") + '">' + (k === "NEXT3H" ? "DUE 3 H" : k) + ' ' + counts[k] + '</button>'; }).join("");
    $("queue-filters").querySelectorAll("button").forEach(function (b) { b.onclick = function () { queueFilter = b.dataset.f; localStorage.setItem("rb.filter", queueFilter); renderQueue(); }; });
    var rows = S.filter(function (s) { var w = wetState(s), e = nextEvent(s); if (queueFilter === "WET") return w.k === "WET_NOW" || w.k === "WET_IMMINENT" || w.k === "LOCKED"; if (queueFilter === "OVERDUE") return w.overdue || w.k === "OVERDUE"; if (queueFilter === "NEXT3H") return e && e.ms - Date.now() <= 3 * 3600000 && !isLocked(s); return true; });
    $("live-queue").innerHTML = rows.length ? rows.map(function (s) { return rowHTML(s, wetState(s)); }).join("") : '<div class="empty">nothing in this filter</div>';
    bindRows($("live-queue")); renderSentinel();
  }

  /* ---------------- maps ---------------- */
  function radarLegend(el) {
    el.innerHTML = '<span><b>radar, is the gauge about to get 0.01?</b></span>'
      + '<span><i class="sw" style="background:#5ac6ff"></i>TRACE under 20 dBZ</span>'
      + '<span><i class="sw" style="background:#4cd07d"></i>0.01 SLOW 20 to 29 (12 to 24 min over the gauge)</span>'
      + '<span><i class="sw" style="background:#f6e05e"></i>0.01 LIKELY 30 to 39 (3 to 12 min)</span>'
      + '<span><i class="sw" style="background:#f97316"></i>0.01 FAST 40 to 49 (about a minute)</span>'
      + '<span><i class="sw" style="background:#d946ef"></i>CORE 50+</span>'
      + '<span>radar estimate; the gauge settles it</span>'
      + '<span style="flex-basis:100%"></span>'
      + Object.keys(STATES).map(function (k) { return '<span><i class="sw mk-' + k + '"></i>' + STATES[k].icon + ' ' + STATES[k].text + '</span>'; }).join("");
  }
  function baseStyle(kind) {
    var attr = "Imagery &copy; Esri, Maxar, Earthstar Geographics; radar NWS MRMS, Iowa Mesonet";
    if (kind === "dark") return { version: 8, sources: { b: { type: "raster", tileSize: 256, maxzoom: 16, attribution: attr, tiles: [ESRI_DARK] }, r: { type: "raster", tileSize: 256, maxzoom: 16, tiles: [ESRI_DARK_REF] } }, layers: [{ id: "base", type: "raster", source: "b" }, { id: "ref", type: "raster", source: "r", paint: { "raster-opacity": 0.85 } }] };
    if (kind === "radar-only") return { version: 8, sources: { b: { type: "raster", tileSize: 256, maxzoom: 16, attribution: attr, tiles: [ESRI_DARK] } }, layers: [{ id: "base", type: "raster", source: "b", paint: { "raster-opacity": 0.35 } }] };
    return { version: 8, sources: { b: { type: "raster", tileSize: 256, maxzoom: 19, attribution: attr, tiles: [ESRI_IMG] }, r: { type: "raster", tileSize: 256, maxzoom: 19, tiles: [ESRI_REF] } }, layers: [{ id: "base", type: "raster", source: "b" }, { id: "ref", type: "raster", source: "r", paint: { "raster-opacity": 0.9 } }] };
  }
  function makeMap(id, style, opts) {
    var m = new maplibregl.Map(Object.assign({ container: id, attributionControl: false, style: style }, opts));
    m.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("styleimagemissing", function (e) { var c = document.createElement("canvas"); c.width = c.height = 2; m.addImage(e.id, c.getContext("2d").getImageData(0, 0, 2, 2)); });
    m.on("error", function () {});
    return m;
  }
  function stampUTC(ms) { var d = new Date(ms); return d.getUTCFullYear() + ("0" + (d.getUTCMonth() + 1)).slice(-2) + ("0" + d.getUTCDate()).slice(-2) + ("0" + d.getUTCHours()).slice(-2) + ("0" + d.getUTCMinutes()).slice(-2); }
  function isoMin(ms) { return new Date(ms).toISOString().slice(0, 16) + ":00Z"; }
  function buildFrames() {
    var now = Date.now(), n5 = Math.floor(now / 300000) * 300000, frames = [];
    for (var t = n5 - 24 * 3600000; t < n5 - 2 * 3600000; t += 600000) frames.push({ kind: "obs", src: "IEM composite", id: "a" + stampUTC(t), ms: t, tiles: IEM_ARCHIVE + stampUTC(t) + "/{z}/{x}/{y}.png", maxzoom: 11 });
    for (var t2 = n5 - 2 * 3600000; t2 < n5 - 600000; t2 += 600000) frames.push({ kind: "obs", src: "NWS MRMS", id: "m" + isoMin(t2), ms: t2, tiles: MRMS + "&time=" + isoMin(t2), maxzoom: 12 });
    var bucket = Math.floor(now / 120000);
    frames.push({ kind: "live", src: "NWS MRMS", id: "live" + bucket, ms: now, tiles: MRMS + "&_=" + bucket, maxzoom: 12 });
    return frames;
  }
  function radarCtl(mapKey) {
    var R = maps[mapKey + "R"], el = $("ctl-" + mapKey);
    el.innerHTML = '<button data-a="play">play</button><button data-a="live" class="on">LIVE</button><button data-a="prev">&#9664;</button><button data-a="next">&#9654;</button>'
      + '<div class="scrubwrap"><input type="range" min="0" max="0" value="0"><div class="zones"><span>24 H OBSERVED</span><span>NOW</span><span>HRRR FORECAST 24 H</span></div></div>'
      + '<span class="ft">radar loading</span><span class="src"></span>';
    var scrub = el.querySelector("input"), play = el.querySelector('[data-a="play"]');
    function stop() { R.playing = false; play.textContent = "play"; }
    play.onclick = function () { R.playing = !R.playing; play.textContent = R.playing ? "pause" : "play"; if (R.playing) anim(mapKey); };
    el.querySelector('[data-a="live"]').onclick = function () { stop(); show(mapKey, R.nowIdx); };
    el.querySelector('[data-a="prev"]').onclick = function () { stop(); show(mapKey, Math.max(0, R.idx - 1)); };
    el.querySelector('[data-a="next"]').onclick = function () { stop(); show(mapKey, Math.min(R.frames.length - 1, R.idx + 1)); };
    scrub.oninput = function () { stop(); show(mapKey, +scrub.value); };
  }
  function setupRadar(mapKey) {
    var R = { frames: buildFrames(), idx: 0, nowIdx: 0, playing: false, added: {}, opacity: 0.82, timer: null };
    R.nowIdx = R.frames.length - 1; R.idx = R.nowIdx; maps[mapKey + "R"] = R;
    radarCtl(mapKey);
    fetch(HRRR + "refd_0000.json?t=" + Math.floor(Date.now() / 300000)).then(function (r) { return r.json(); }).then(function (meta) {
      var init = Date.parse(meta.model_init_utc); if (!init) return;
      var fc = [], now = Date.now();
      for (var mm = 15; mm <= 1440; mm += 15) {
        var lead = (init + mm * 60000 - now) / 60000; if (lead <= 0) continue;
        var step = lead <= 180 ? 15 : lead <= 720 ? 30 : 60; if (mm % step !== 0) continue;
        fc.push({ kind: "fc", src: "HRRR " + new Date(init).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric" }) + " CT run", id: "f" + init + "_" + mm, ms: init + mm * 60000, mm: mm, init: init, maxzoom: 12 });
      }
      R.frames = R.frames.concat(fc);
      finishFrames(mapKey);
    }).catch(function () { finishFrames(mapKey); });
    finishFrames(mapKey);
    if (!R.timer) R.timer = setInterval(function () { refreshLive(mapKey); }, 120000);
  }
  function finishFrames(mapKey) {
    var R = maps[mapKey + "R"], el = $("ctl-" + mapKey), scrub = el.querySelector("input");
    scrub.max = String(R.frames.length - 1);
    var split = R.frames.length > 1 ? (100 * R.nowIdx / (R.frames.length - 1)).toFixed(1) + "%" : "100%";
    scrub.style.background = "linear-gradient(90deg, #1f2a44 0%, #1f2a44 " + split + ", rgba(251,191,36,.35) " + split + ", rgba(251,191,36,.35) 100%)";
    show(mapKey, R.idx);
  }
  function ensure(mapKey, i) {
    var R = maps[mapKey + "R"], m = maps[mapKey], f = R.frames[i]; if (!f || R.added[f.id] || !m || !m.isStyleLoaded()) return;
    var tiles = f.kind === "fc" ? [HRRR_WMS + "&LAYERS=refd_" + ("0000" + f.mm).slice(-4) + "&BBOX={bbox-epsg-3857}&i=" + f.init] : [f.tiles];
    m.addSource(f.id, { type: "raster", tiles: tiles, tileSize: 256, maxzoom: f.maxzoom });
    m.addLayer({ id: f.id, type: "raster", source: f.id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "linear" } }, firstOverlayLayer(m));
    R.added[f.id] = true;
  }
  function firstOverlayLayer(m) { var ids = ["site", "ring6", "ring6line", "ring19line"]; for (var i = 0; i < ids.length; i++) if (m.getLayer(ids[i])) return ids[i]; return undefined; }
  function show(mapKey, i) {
    var R = maps[mapKey + "R"], m = maps[mapKey]; if (!R) return; if (!m || !m.isStyleLoaded()) { setTimeout(function () { show(mapKey, i); }, 300); return; }
    R.idx = i; ensure(mapKey, i); ensure(mapKey, i + 1);
    R.frames.forEach(function (f, j) { if (R.added[f.id] && m.getLayer(f.id)) m.setPaintProperty(f.id, "raster-opacity", j === i ? R.opacity : 0); });
    var f = R.frames[i], el = $("ctl-" + mapKey), ft = el.querySelector(".ft"), lead = Math.round((f.ms - Date.now()) / 60000);
    ft.className = "ft" + (f.kind === "fc" ? " fc" : "");
    ft.textContent = (f.kind === "fc" ? "FORECAST " : f.kind === "live" ? "LIVE " : "OBSERVED ") + ctFromMs(f.ms) + (f.kind === "live" ? "" : " (" + (lead < 0 ? "-" : "+") + (Math.abs(lead) >= 60 ? Math.floor(Math.abs(lead) / 60) + " h " + (Math.abs(lead) % 60) + " m" : Math.abs(lead) + " m") + ")");
    el.querySelector(".src").textContent = f.src + (f.kind === "live" ? ", 2-minute mosaic" : "");
    el.querySelector("input").value = String(i);
    el.querySelector('[data-a="live"]').classList.toggle("on", i === R.nowIdx);
    updateSite(mapKey);
  }
  function anim(mapKey) {
    var R = maps[mapKey + "R"]; if (!R.playing) return;
    var next = R.idx + 1; if (next >= R.frames.length) next = Math.max(0, R.nowIdx - 12);
    show(mapKey, next); setTimeout(function () { anim(mapKey); }, 450);
  }
  function refreshLive(mapKey) {
    var R = maps[mapKey + "R"], m = maps[mapKey]; if (!m || !R) return;
    var bucket = Math.floor(Date.now() / 120000), live = R.frames.filter(function (f) { return f.kind === "live"; })[0];
    if (!live || live.id === "live" + bucket) return;
    var i = R.frames.indexOf(live);
    if (m.getLayer(live.id)) m.removeLayer(live.id); if (m.getSource(live.id)) m.removeSource(live.id); delete R.added[live.id];
    R.frames[i] = { kind: "live", src: "NWS MRMS", id: "live" + bucket, ms: Date.now(), tiles: MRMS + "&_=" + bucket, maxzoom: 12 };
    if (R.idx === i) show(mapKey, i);
  }
  function updateSite(mapKey) {
    var m = maps[mapKey], R = maps[mapKey + "R"]; if (!m || !R || !m.isStyleLoaded()) return;
    var s = byIcao(mapKey === "airport" ? apIcao : liveSel); if (!s) { if (m.getLayer("site")) m.setPaintProperty("site", "raster-opacity", 0); return; }
    var tile = settleFor(s).tile || {}, fresh = !(tile.site_block_stale || tile.stale);
    var want = fresh && R.frames[R.idx] && R.frames[R.idx].kind === "live" && m.getZoom() >= 10, id = NEXRAD[s.city];
    var bucket = Math.floor(Date.now() / 300000);
    if (want && id && (m.__site !== id + bucket)) {
      if (m.getLayer("site")) m.removeLayer("site"); if (m.getSource("site")) m.removeSource("site");
      m.addSource("site", { type: "raster", tileSize: 256, maxzoom: 12, tiles: [IEM_SITE + id + "-N0Q-0/{z}/{x}/{y}.png?t=" + bucket] });
      m.addLayer({ id: "site", type: "raster", source: "site", paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0 } }, m.getLayer("ring6") ? "ring6" : undefined);
      m.__site = id + bucket;
    }
    if (m.getLayer("site")) m.setPaintProperty("site", "raster-opacity", want ? R.opacity : 0);
    var src = $("ctl-" + mapKey).querySelector(".src"), base = (R.frames[R.idx] || {}).src || "";
    if (want && id) src.textContent = id + " single radar, 250 m, latest sweep (composite hidden under it)";
    else if (!fresh && m.getZoom() >= 10) src.textContent = base + " (single-site radar stale, not shown)";
    else src.textContent = base + ((R.frames[R.idx] || {}).kind === "live" ? ", 2-minute mosaic" : "");
  }

  /* 2. the big map */
  var liveMarkers = {}, liveSel = null, fitted = false;
  function fitAll(animate) {
    /* the national view must hold all 22 gauges on ANY screen: at a fixed zoom a phone cut off
       Boston and Seattle (headless walk, 2026-09-09 18:00 CT) */
    var m = maps.live, S = stations().filter(function (s) { return s.lat !== null && s.lat !== undefined; }); if (!m || !S.length) return;
    var b = new maplibregl.LngLatBounds(); S.forEach(function (s) { b.extend([s.lon, s.lat]); });
    m.fitBounds(b, { padding: { top: 36, bottom: 40, left: 28, right: 28 }, animate: !!animate, duration: animate ? 900 : 0 });
  }
  function selectCity(icao, opts) {
    var s = byIcao(icao), m = maps.live; if (!s || !m) return;
    opts = opts || {};
    liveSel = icao; apIcao = icao;
    /* no isStyleLoaded() gate here: it reads false for as long as any tile is still loading, and
       on a satellite basemap that is most of the time, so the tap looked dead (18:05 CT) */
    clearLiveOverlay(false); if (camPopup) { camPopup.remove(); camPopup = null; }
    try { ensureRings(m, s); } catch (e) { m.once("styledata", function () { selectCity(icao); }); return; }
    drawOverlays(m, s, liveOverlay);
    if (!opts.keepView) m.flyTo({ center: [s.lon, s.lat], zoom: Math.max(m.getZoom(), 10.2), speed: 1.4 });
    var card = $("mapcard"); card.innerHTML = mapCardHTML(s); card.classList.remove("hidden"); bindMapCard(s);
    renderMarkers(); renderQueue();
    m.once("moveend", function () { updateSite("live"); });
  }
  function clearCity() {
    liveSel = null; clearLiveOverlay(true); if (camPopup) { camPopup.remove(); camPopup = null; }
    $("mapcard").classList.add("hidden"); $("mapcard").innerHTML = "";
    if (maps.live) { fitAll(true); if (maps.live.getLayer("site")) maps.live.setPaintProperty("site", "raster-opacity", 0); }
    renderMarkers(); renderQueue();
  }
  function mapCardHTML(s) {
    var w = wetState(s), o = s.observed || {}, m = s.market || {}, p = physPct(s), rel = physRel(p, s), win = rainWindow(s), e = nextEvent(s), ib = inbound(s), cs = cells(s), wn = wetNeighbours(s), ncam = camsFor(s).filter(ringAvailable).length;
    var cellTxt = cs.length ? cs.slice(0, 3).map(function (c) { var et = etaNow(c); return c.dbz + ' dBZ ' + mi(c.km) + ' mi ' + c.bearing + (et !== null ? ', <b>ETA ' + Math.round(et) + ' m</b>' : ', ' + cellMissText(c)); }).join('<br>') : 'no cell within 60 mi';
    var ev = evidenceRead(s), bf = briefFor(s);
    return '<div class="mc-top"><div><b class="mc-city">' + esc(s.city) + '</b> <small>' + s.icao + '</small><br>' + stateChip(w) + '</div>'
      + '<div class="mc-big num">' + (isLocked(s) ? esc(gaugeAmt(s)) : (p !== null ? pct(p) : '--')) + '<small>' + (isLocked(s) ? 'settles YES' : (p !== null ? 'v3, ' + esc(v3Rec(p, s)) : esc(physWord(s) || 'v3 unavailable'))) + '</small></div></div>'
      + '<div class="mc-ev ' + ev.cls + '">' + esc(ev.label) + '</div>'
      + (bf && bf.headline ? '<div class="mc-brief"><b>Today:</b> ' + esc(bf.headline) + ((briefStale() || stationBriefStale(bf)) ? ' <span class="stale">(briefing ' + esc(briefStale() || stationBriefStale(bf)) + ')</span>' : '') + '</div>' : '')
      + '<div class="mc-line"><b>' + esc(verdictSentence(s, w, p, m, win)) + '</b></div>'
      + '<div class="mc-grid num">'
      + '<span>gauge</span><span><b>' + gaugeTxt(s) + '</b> ' + agoTxt(o.latest_ob_utc) + '</span>'
      + '<span>market</span><span>YES <b>bid ' + quoteCents(marketQuote(m, "bid")) + ', ask ' + quoteCents(marketQuote(m, "ask")) + '</b>' + (m.momentum && m.momentum.delta_60m !== null && m.momentum.delta_60m !== undefined ? ' (' + (m.momentum.delta_60m > 0 ? '+' : '') + m.momentum.delta_60m + ' in 1 h)' : '') + quoteAge(m) + '</span>'
      + '<span>next</span><span>' + (e ? esc(e.text) : (win ? 'rain hours ahead ' + esc(win.text) : 'no rain hour ahead')) + '</span>'
      + '<span>radar</span><span>' + pct(compRadar(s).pct10) + ' of 6 mi, ' + pct(compRadar(s).pct30) + ' of 19 mi (' + agoTxt(compRadar(s).frame_utc) + ')</span>'
      + '<span>cells</span><span>' + cellTxt + '</span>'
      + '<span>around</span><span>' + (wn.length ? '<b>' + wn.length + ' wet</b> of ' : '0 wet of ') + (s.neighbors || []).length + ' airports &middot; ' + ncam + ' cameras (white boxes)</span>'
      + '</div>'
      + '<div class="mc-btns"><button data-mc="page">full page</button><button data-mc="prev">&#9664;</button><button data-mc="next">&#9654;</button><button data-mc="us">US map</button></div>';
  }
  function bindMapCard(s) {
    var card = $("mapcard"), order = stations().map(function (x) { return x.icao; }), i = order.indexOf(s.icao);
    card.querySelector('[data-mc="page"]').onclick = function () { go(s.icao); };
    card.querySelector('[data-mc="prev"]').onclick = function () { selectCity(order[(i - 1 + order.length) % order.length]); };
    card.querySelector('[data-mc="next"]').onclick = function () { selectCity(order[(i + 1) % order.length]); };
    card.querySelector('[data-mc="us"]').onclick = clearCity;
  }
  function ensureLiveMap() {
    if (maps.live) return;
    maps.live = makeMap("map-live", baseStyle(basemap), { center: [-96.9, 38.4], zoom: 3.5, minZoom: 1.8, maxZoom: 13 });
    maps.live.on("load", function () { setupRadar("live"); renderMarkers(); if (!restoreView()) fitAll(false); });
    window.addEventListener("resize", function () { if (maps.live && !liveSel) fitAll(false); });
    maps.live.on("style.load", function () { var R = maps.liveR; if (R) { R.added = {}; maps.live.__site = null; show("live", R.idx); } if (liveSel) { var s2 = byIcao(liveSel); if (s2) { ensureRings(maps.live, s2); } } });
    maps.live.on("zoomend", function () { updateSite("live"); });
    radarLegend($("legend-live"));
    $("basemap").querySelectorAll("button").forEach(function (b) {
      b.onclick = function () { basemap = b.dataset.b; localStorage.setItem("rb.basemap", basemap); $("basemap").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); }); maps.live.setStyle(baseStyle(basemap)); };
      b.classList.toggle("on", b.dataset.b === basemap);
    });
    // the map position survives a refresh and a return to the tab: saved on every move, restored
    // on boot when it is from the last 12 hours; a saved city selection is reopened the same way
    maps.live.on("moveend", function () { if (maps.live.__restoring) return; var c = maps.live.getCenter(); localStorage.setItem("rb.map", JSON.stringify({ lng: c.lng, lat: c.lat, zoom: maps.live.getZoom(), at: Date.now(), sel: liveSel })); });
  }
  function restoreView() {
    var saved = null; try { saved = JSON.parse(localStorage.getItem("rb.map") || "null"); } catch (e) { saved = null; }
    if (!saved || !maps.live || Date.now() - (saved.at || 0) > 12 * 3600000) return false;
    // the saved view is the truth; the city is selected AFTER it without flying, so the two do not
    // fight (Jules on 62b6d81: selectCity's flyTo followed by jumpTo left the map at the wrong zoom)
    maps.live.__restoring = true;
    maps.live.jumpTo({ center: [saved.lng, saved.lat], zoom: saved.zoom });
    if (saved.sel && byIcao(saved.sel) && !location.hash) { selectCity(saved.sel, { keepView: true }); }
    setTimeout(function () { maps.live.__restoring = false; }, 50);
    return true;
  }
  function renderMarkers() {
    if (!maps.live) return;
    stations().forEach(function (s) {
      if (s.lat === null || s.lat === undefined) return;
      var w = wetState(s), el = liveMarkers[s.icao] && liveMarkers[s.icao].getElement();
      if (!el) {
        el = document.createElement("div");
        liveMarkers[s.icao] = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([s.lon, s.lat]).addTo(maps.live);
        el.onclick = function (ev) { ev.stopPropagation(); selectCity(s.icao); };
      }
      /* NEVER overwrite className on a MapLibre marker element: it carries maplibregl-marker,
         which is position:absolute. Overwriting it dropped every marker into page flow, 571 px
         south of its gauge on Colin's screen (2026-09-09 16:05 CT, Seattle in the Pacific). */
      Object.keys(STATES).forEach(function (k) { el.classList.remove(k); }); el.classList.remove("ovl");
      el.classList.add("mk", w.k); if (w.overdue) el.classList.add("ovl"); el.classList.toggle("sel", s.icao === liveSel);
      el.title = STATES[w.k].text + (w.inputs.length ? ": " + w.inputs.join(", ") : "") + (physWord(s) ? "; " + physWord(s) : "") + "; mkt is the market YES ask";
      /* Fix E (desk review P1 7): the marker used to print the YES ask alone in the slot where the model
         percentage goes, so "Chicago 4c" read as the model saying 4. The model slot now always names
         v3 (with its record) or says there is no v3 number, and the price is always labelled "mkt".
         Fix F: a locked gauge with no total read says so, never 0.00. */
      var p = physPct(s), g = gaugeIn(s);
      var modelSlot = isLocked(s) ? (g === null ? 'locked, total unknown' : g.toFixed(2) + '"') : (p !== null ? 'v3 ' + pct(p) + ' ' + v3Rec(p, s) : 'no v3 number');
      el.innerHTML = STATES[w.k].icon + '<span class="lbl">' + esc(s.city) + ' ' + esc(modelSlot) + ' &middot; mkt ' + esc(quoteCents(marketYes(s))) + '</span>';
    });
  }

  /* ---------------- the airport panel ---------------- */
  function circle(lon, lat, km, n) {
    var pts = []; for (var i = 0; i <= (n || 72); i++) { var a = 2 * Math.PI * i / (n || 72); var dy = km / 110.574, dx = km / (111.32 * Math.cos(lat * Math.PI / 180)); pts.push([lon + dx * Math.cos(a), lat + dy * Math.sin(a)]); }
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] } };
  }
  var BEAR = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  function offset(lon, lat, km, bearing) { var b = (BEAR[bearing] || 0) * Math.PI / 180; return [lon + (km * Math.sin(b)) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + (km * Math.cos(b)) / 110.574]; }
  var apMarkers = [], liveOverlay = [];
  function clearApMarkers() { apMarkers.forEach(function (m) { m.remove(); }); apMarkers = []; }
  function clearLiveOverlay(rings) {
    liveOverlay.forEach(function (m) { m.remove(); }); liveOverlay = [];
    var m = maps.live, empty = { type: "FeatureCollection", features: [] };
    if (rings && m) { if (m.getSource("ring6")) m.getSource("ring6").setData(empty); if (m.getSource("ring19")) m.getSource("ring19").setData(empty); }
  }
  function ensureRings(m, s) {
    if (!m.getSource("ring6")) {
      m.addSource("ring6", { type: "geojson", data: circle(s.lon, s.lat, 9.656) });
      m.addLayer({ id: "ring6", type: "fill", source: "ring6", paint: { "fill-color": "#22D3EE", "fill-opacity": 0.06 } });
      m.addLayer({ id: "ring6line", type: "line", source: "ring6", paint: { "line-color": "#22D3EE", "line-width": 2, "line-dasharray": [2, 2] } });
      m.addSource("ring19", { type: "geojson", data: circle(s.lon, s.lat, 30.578) });
      m.addLayer({ id: "ring19line", type: "line", source: "ring19", paint: { "line-color": "#22D3EE", "line-width": 1, "line-opacity": 0.5, "line-dasharray": [1, 3] } });
    } else { m.getSource("ring6").setData(circle(s.lon, s.lat, 9.656)); m.getSource("ring19").setData(circle(s.lon, s.lat, 30.578)); }
  }
  function neighborPosition(n) {
    return Number.isFinite(n.lat) && Number.isFinite(n.lon) && Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180 ? [n.lon, n.lat] : null;
  }
  function drawOverlays(m, s, store) {
    var pin = document.createElement("div"); pin.className = "pin"; pin.innerHTML = '<span class="lbl">SETTLEMENT GAUGE ' + s.icao + '</span>';
    store.push(new maplibregl.Marker({ element: pin, anchor: "center" }).setLngLat([s.lon, s.lat]).addTo(m));
    cells(s).forEach(function (c) {
      var pos = offset(s.lon, s.lat, c.km, c.bearing), el = document.createElement("div");
      var e = etaNow(c), hit = e !== null, a = cellAge(c);
      var still = cellStationary(c);
      el.className = "cell" + (hit ? "" : " miss") + (still ? " still" : "");
      el.innerHTML = (still ? '<div class="dot"></div>' : '<div class="arrow" style="transform: rotate(' + (BEAR[c.heading] || 0) + 'deg)"></div>') + '<span class="lbl">' + c.dbz + ' dBZ ' + (hit ? 'ETA ' + Math.round(e) + ' m' : cellMissText(c)) + (a !== null ? ', scan ' + a + ' m old' : '') + '</span>';
      el.title = c.dbz + " dBZ, " + mi(c.km) + " mi " + c.bearing + " of the gauge, " + (still ? "stationary" : "moving " + c.heading + " at " + c.kt + " kt") + ", " + (c.status || "");
      store.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(pos).addTo(m));
    });
    (s.neighbors || []).forEach(function (n) {
      var pos = neighborPosition(n); if (!pos) return;
      var el = document.createElement("div"), a = ageMin(n.time_utc);
      el.className = "nb" + (n.raining ? " wet" : ""); el.innerHTML = '<span class="lbl">' + n.id + ' ' + (n.raining ? 'WET' : 'dry') + (a !== null ? ' ' + a + 'm' : '') + '</span>'; el.title = n.id + " " + mi(n.dist_km) + " mi " + n.bearing + (n.raining ? ", raining" : ", dry") + " (" + agoTxt(n.time_utc) + ")";
      store.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(pos).addTo(m));
    });
    /* codex round 2: cameras that share one point (four DEN FAA cameras on one pole) become ONE
       marker with a count; tapping it lists them and a tap on a name opens that camera. */
    var groups = {};
    var ringList = ringsOpen() ? ringsFor(s).filter(ringAvailable).sort(camOrder) : [];
    ringList.forEach(function (c) {
      if (c.lat === undefined || c.lat === null) return;
      var el = document.createElement("div");
      el.className = "camk ring" + (c.band === "APPROACH" ? " approach" : "") + (camFrozen(c) ? " frozen" : "");
      el.title = c.name + ", " + mi(c.dist_km) + " mi " + (c.dir || "") + " of the gauge";
      var act = function (ev) { ev.stopPropagation(); if (ev.preventDefault) ev.preventDefault(); openCamPopup(m, s, c, [c.lon, c.lat], true); };
      el.onclick = act; el.addEventListener("touchend", act, { passive: false });
      store.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([c.lon, c.lat]).addTo(m));
    });
    camsFor(s).slice().sort(camOrder).forEach(function (c) {
      if (!ringAvailable(c)) return;      // the same predicate as the cards, so a map pin cannot outlive a rejection
      var exact = c.lat !== undefined && c.lon !== undefined && c.lat !== null;
      var pos = exact ? [c.lon, c.lat] : (c.dist_km !== undefined && c.dir ? offset(s.lon, s.lat, c.dist_km, c.dir) : null);
      if (!pos) return;
      var key = pos[0].toFixed(4) + "," + pos[1].toFixed(4);
      (groups[key] = groups[key] || { pos: pos, exact: exact, cams: [] }).cams.push(c);
    });
    Object.keys(groups).forEach(function (key) {
      var g = groups[key], el = document.createElement("div");
      el.className = "camk" + (g.exact ? "" : " approx") + (g.cams.length > 1 ? " multi" : "") + (g.cams.every(camFrozen) ? " frozen" : "");
      el.title = g.cams.length > 1 ? g.cams.length + " cameras at this point, tap to choose" : g.cams[0].name + (g.exact ? "" : " (placed by distance and bearing, approximate)");
      if (g.cams.length > 1) el.innerHTML = '<b class="n">' + g.cams.length + '</b>';
      var act = function (ev) { ev.stopPropagation(); if (ev.preventDefault) ev.preventDefault(); if (g.cams.length === 1) openCamPopup(m, s, g.cams[0], g.pos, g.exact); else openCamChooser(m, s, g, key); };
      el.onclick = act; el.addEventListener("touchend", act, { passive: false });
      store.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(g.pos).addTo(m));
    });
  }
  function ensureAirportMap(s) {
    if (!maps.airport) {
      maps.airport = makeMap("map-airport", baseStyle("sat"), { center: [s.lon, s.lat], zoom: 12.5, minZoom: 5, maxZoom: 17 });   // WO-136: the ring reaches 80 mi
      maps.airport.on("load", function () { ensureRings(maps.airport, s); setupRadar("airport"); placeAirport(s); });
      maps.airport.on("zoomend", function () { updateSite("airport"); });
      radarLegend($("legend-airport"));
    } else {
      /* NEVER skip placing the city. isStyleLoaded() is false for a moment after the panel
         reopens, and skipping left Colin's San Antonio page showing the Boston pin (16:55 CT). */
      var m = maps.airport;
      if (m.isStyleLoaded()) placeAirport(s); else m.once("idle", function () { placeAirport(s); });
    }
  }
  function placeAirport(s) {
    var m = maps.airport; if (!m) return;
    try { ensureRings(m, s); } catch (e) { m.once("styledata", function () { placeAirport(s); }); return; }
    if (m.__icao !== s.icao) { m.jumpTo({ center: [s.lon, s.lat], zoom: 12.5 }); m.__icao = s.icao; m.__site = null; }
    clearApMarkers(); if (camPopup && camPopup.__icao !== s.icao) { camPopup.remove(); camPopup = null; }
    drawOverlays(m, s, apMarkers);
    updateSite("airport");
  }
  function ringCard(c, i) {
    var dead = !ringAvailable(c), u = camURL(c);
    var media = dead ? '<div class="ph">unavailable; last successful check ' + agoTxt(c.last_ok_utc) + '</div>'
      : camMediaHTML(c, true, true);
    return '<div class="cam' + (dead ? ' dead' : '') + '" data-i="' + i + '">' + media + '<div class="cap"><b>' + esc(c.name) + '</b>'
      + mi(c.dist_km) + ' mi ' + esc(c.dir || '') + ' of the gauge &middot; ' + esc(c.source || '')
      + '<small>' + esc(ringFreshTxt(c)) + (publicCamURL(c.page || c.url || (c.proxy && c.proxy.src)) ? ' &middot; <a href="' + esc(publicCamURL(c.page || c.url || (c.proxy && c.proxy.src))) + '" target="_blank" rel="noopener">source</a>' : '') + '</small></div></div>';
  }
  function renderRings(s) {
    var d = $("ap-rings"), body = $("ap-rings-body"), sum = $("ap-rings-sum"); if (!d || !body) return;
    if (camRings && ringsError) $("ap-rings-note").textContent = "the ring catalog did not refresh " + agoTxt(new Date(ringsError).toISOString()) + "; showing the last good catalog with the available health records";
    if (!camRings) {
      sum.textContent = ringsError ? "Approach cameras: the ring catalog did not load (retrying each minute)" : d.open ? "Approach cameras, 12 to 80 mi out: loading" : "Approach cameras, 12 to 80 mi out (tap to load)";
      d.style.display = ""; body.innerHTML = ringsError ? '<div class="gap">cams_rings.json did not load; it is retried on the next minute tick</div>' : ""; body.dataset.icao = "";
      if (d.open && !ringsError) loadRings();
      return;
    }
    var list = ringsFor(s), gaps = ringGaps(s), failed = (camRings.unverified && camRings.unverified[s.city]) || [];
    var live = list.filter(ringAvailable);
    var covered = {}; live.forEach(function (c) { covered[c.sector] = 1; });
    var missing = {}, partial = {}; gaps.forEach(function (g) { if (covered[g.sector]) partial[g.sector] = 1; else missing[g.sector] = 1; });
    var nMissing = Object.keys(missing).length, nPartial = Object.keys(partial).length;   // Astra round 6: a band gap is not an empty direction
    sum.textContent = "Approach cameras, 12 to 80 mi out: " + live.length + " camera" + (live.length === 1 ? "" : "s") + (list.length - live.length ? ", " + (list.length - live.length) + " held" : "") + (nMissing ? ", " + nMissing + " direction" + (nMissing === 1 ? "" : "s") + " with no verified camera" : "") + (nPartial ? ", " + nPartial + " with one band uncovered" : "") + (failed.length ? ", " + failed.length + " failed the last check" : "");
    // Astra on e0fd2e7: hiding the section outright meant that after loading a partial catalog, a
    // market the sweep had not reached yet could NEVER discover its own coverage: the catalog
    // refreshes only while the section is open, and a hidden section cannot be opened. It stays
    // visible and says what it is.
    if (!(list.length || gaps.length || failed.length)) {
      sum.textContent = "Approach cameras: this market has not been swept yet";
    }
    if (!d.open) { body.innerHTML = ""; body.dataset.icao = ""; return; }     // nothing renders until opened
    var ver = (camRings.updated_utc || "") + "|" + ((camHealth && camHealth.updated_utc) || "");
    if (body.dataset.icao === s.icao && body.dataset.ver !== ver) body.dataset.icao = "";   // new data: rebuild
    if (body.dataset.icao === s.icao) {
      // Astra on d812036: an open section must not keep its first snapshot forever. On the minute
      // tick the pictures re-fetch through the minute bucket and the freshness words re-read health.
      var bucket = Math.floor(Date.now() / 60000);
      body.querySelectorAll(".cam").forEach(function (el) {
        var c = list[+el.dataset.i]; if (!c) return;
        /* Astra P2 on 840ac8c: when an image request failed, bindCams replaced the <img> with a
           placeholder, and this refresh path then found NO image to re-point. A camera whose source
           recovered stayed blank for as long as the section was open and the catalog version had
           not changed, despite the minute tick. A failed picture is a picture to try again, not a
           picture to give up on, so the element is recreated on the next tick. */
        var im = el.querySelector("img");
        // Astra P2 on 4c900f0: !c.held is not the availability rule. A previously verified camera
        // that fails cam_reverify --all carries verified:false with held:false, ringCard correctly
        // draws its held placeholder, and this guard then replaced that placeholder with a live
        // image on the next unchanged-catalog refresh, walking straight past the rejection.
        // ONE predicate for every camera decision, which is what ringAvailable exists to be.
        if (!im && ringAvailable(c)) {
          // the failure placeholder the onerror handler leaves behind is a div.ph
          var ph = el.querySelector("div.ph");
          if (ph) {
            var again = document.createElement("img");
            again.referrerPolicy = "no-referrer";
            again.alt = "";
            again.onerror = function () {
              var d = document.createElement("div");
              d.className = "ph";
              d.textContent = camIsProxied(c) ? "camera frame unavailable on this host; the source may still be working" : "no picture from the source right now";
              again.replaceWith(d);
            };
            ph.replaceWith(again);
            im = again;
          }
        }
        if (im && im.src.indexOf("t=" + bucket) < 0) { var u = camURL(c); im.src = u + (u.indexOf("?") > 0 ? "&" : "?") + "t=" + bucket; }
        var sm = el.querySelector(".cap small"); if (sm) { var txt = ringFreshTxt(c); if (sm.firstChild && sm.firstChild.nodeType === 3) sm.firstChild.nodeValue = txt; }
      });
      return;
    }
    var order = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], html = "";
    order.forEach(function (sec) {
      var here = list.filter(function (c) { return c.sector === sec; }).sort(camOrder);
      var dists = here.map(function (c) { return +c.dist_km || 0; });
      var g = gaps.filter(function (x) { return x.sector === sec; });
      var f = failed.filter(function (x) { return x.sector === sec; });
      if (!here.length && !g.length && !f.length) return;
      html += '<div class="sector"><h4><b>' + sec + '</b>' + (here.length ? here.length + ' camera' + (here.length === 1 ? '' : 's') + ', ' + mi(Math.min.apply(null, dists)) + ' to ' + mi(Math.max.apply(null, dists)) + ' mi out' : 'no verified camera') + '</h4>';
      if (here.length) html += '<div class="camstrip">' + here.map(function (c) { return ringCard(c, list.indexOf(c)).replace('<div class="cap">', '<div class="cap"><span class="band ' + (c.band === "APPROACH" ? 'approach' : '') + '">' + (c.band === "APPROACH" ? '37 to 80 mi' : '12 to 37 mi') + '</span>'); }).join("") + '</div>';
      g.forEach(function (x) { html += '<div class="gap">' + (x.band === "APPROACH" ? '37 to 80 mi' : '12 to 37 mi') + ' ' + sec + ': ' + esc(x.why) + '</div>'; });
      f.forEach(function (x) { html += '<div class="gap">' + (x.band === "APPROACH" ? '37 to 80 mi' : '12 to 37 mi') + ' ' + sec + ': ' + esc(x.name || '') + ' failed the last check (' + esc(x.why || x.verified_how || '') + ')</div>'; });
      html += '</div>';
    });
    body.innerHTML = html || '<div class="gap">no ring cameras catalogued for ' + esc(s.city) + '</div>';
    body.dataset.icao = s.icao; body.dataset.ver = ver;
    bindCams(body, list);
    var sw = (camRings.swept && camRings.swept[s.city]) || null, sf = (camRings.source_failures && camRings.source_failures[s.city]) || [];
    // codex P2 on 3916c30: the stale-catalog warning set at the top of this function was overwritten
    // here on every full render, so the common case (fresh health applied to a retained old catalog)
    // never told anyone the catalog was stale. Compose it into the final note instead of racing it.
    var staleNote = (camRings && ringsError) ? "the ring catalog did not refresh " + agoTxt(new Date(ringsError).toISOString()) + "; showing the last good catalog with the available health records. " : "";
    var limited = (camRings.verification_limits && camRings.verification_limits[s.city]) || [];
    if (limited.length) staleNote += "some cameras were not checked before the sweep limit in " + limited.map(function (x) { return x.band + "/" + x.sector; }).join(", ") + ". ";
    $("ap-rings-note").textContent = staleNote + (sw ? "this market swept " + new Date(sw).toLocaleString("en-US", {timeZone:"America/Chicago"}) + " CT" : "not swept yet") + "; markers on the map are the ring cameras" + (sf.length ? "; a source was down at the sweep: " + sf.join("; ").slice(0, 120) : "");
  }
  function fitRing(s) {
    var m = maps.airport, list = ringsFor(s).filter(function (c) { return ringAvailable(c) && c.lat !== undefined; }); if (!m || !list.length) return;
    var b = new maplibregl.LngLatBounds([s.lon, s.lat], [s.lon, s.lat]);
    list.forEach(function (c) { b.extend([c.lon, c.lat]); });
    m.fitBounds(b, { padding: 28, maxZoom: 10 });
  }
  function renderAirport() {
    renderSentinel();
    var S = stations(); var s = byIcao(apIcao); if (!s) return;
    var sel = $("ap-select"); sel.innerHTML = S.slice().sort(function (a, b) { return a.city.localeCompare(b.city); }).map(function (x) { var w = wetState(x); return '<option value="' + x.icao + '"' + (x.icao === apIcao ? ' selected' : '') + '>' + esc(x.city) + ' ' + x.icao + ' ' + STATES[w.k].icon + ' ' + STATES[w.k].text + '</option>'; }).join("");
    sel.onchange = function () { go(sel.value); };
    var order = S.map(function (x) { return x.icao; }), i = order.indexOf(apIcao);
    $("ap-prev").onclick = function () { go(order[(i - 1 + order.length) % order.length]); };
    $("ap-next").onclick = function () { go(order[(i + 1) % order.length]); };
    $("ap-decision").innerHTML = decisionHTML(s);
    renderAnswers(s);
    ensureAirportMap(s);
    renderHours(s);
    renderStack(s, false);
    if ($("ap-cams").dataset.icao !== s.icao || $("ap-cams").dataset.ver !== String(Math.floor(Date.now() / 60000)) + (camHealth && camHealth.updated_utc) + (camRings && camRings.updated_utc)) {
      var list = camsFor(s).slice().sort(camOrder);
      $("ap-cams").innerHTML = camStrip(s, list); $("ap-cams").dataset.icao = s.icao; $("ap-cams").dataset.ver = String(Math.floor(Date.now() / 60000)) + (camHealth && camHealth.updated_utc) + (camRings && camRings.updated_utc);
      bindCams($("ap-cams"), list);
    }
    var rd = $("ap-rings");
    if (rd && rd.__icao !== s.icao) { rd.open = false; rd.__icao = s.icao; }     // codex, PR #129: collapsed again for every market
    renderRings(s);
    if (rd && !rd.__bound) {
      rd.__bound = true;
      rd.addEventListener("toggle", function () { var cur = byIcao(apIcao); if (!cur) return; if (!rd.open && camPopup && camPopup.__ring) { camPopup.remove(); camPopup = null; } if (rd.open && !camRings) { loadRings(true).then(function (icao) { var now = byIcao(apIcao); if (icao && now && now.icao === icao && rd.open) fitRing(now); }); renderRings(cur); return; } renderRings(cur); placeAirport(cur); if (rd.open) fitRing(cur); });
      $("ap-rings-fit").onclick = function (ev) { ev.preventDefault(); var cur = byIcao(apIcao); if (cur) fitRing(cur); };
      $("ap-rings-back").onclick = function (ev) { ev.preventDefault(); var cur = byIcao(apIcao); if (cur && maps.airport) maps.airport.flyTo({ center: [cur.lon, cur.lat], zoom: 12.5 }); };
    }
  }
  function refreshAirport() {
    renderSentinel();
    /* the once-a-minute refresh while a city page is open: numbers update, nothing you opened
       closes, nothing you loaded reloads (Colin, 2026-09-09 16:30 CT: "feels really buggy") */
    var s = byIcao(apIcao); if (!s) return;
    var panel = $("airport"), y = panel.scrollTop;
    var dh = decisionHTML(s); if ($("ap-decision").innerHTML !== dh) $("ap-decision").innerHTML = dh;
    renderAnswers(s);
    renderHours(s);
    renderStack(s, true);
    var near = camsFor(s).slice().sort(camOrder);
    $("ap-cams").innerHTML = camStrip(s, near);
    bindCams($("ap-cams"), near);
    panel.scrollTop = y;
    if (maps.airport) { if (maps.airport.isStyleLoaded()) placeAirport(s); else maps.airport.once("idle", function () { placeAirport(s); }); }
    if (liveSel === s.icao) { $("mapcard").innerHTML = mapCardHTML(s); bindMapCard(s); }
    if (ringsOpen()) { loadRings(true); }   // WO-136: re-read the two files only while the section is open (this is the one retry after a failure)
  }
  function verdictSentence(s, w, p, m, win) {
    // WO-133 (codex, confirmed): this line said "Settled:" off the LOCAL gauge lock with no exchange
    // result checked. Four states now, and a local observation never becomes an official result.
    var ss = settleState(s);
    if (ss.k === "OFFICIALLY_SETTLED") return "Officially settled " + ss.result.toUpperCase() + " by the exchange (gauge " + gaugeAmt(s) + ").";
    if (ss.k === "THRESHOLD_OBSERVED") return "Threshold observed: " + (gaugeIn(s) === null ? "the gauge is flagged locked, " + gaugeAmt(s) : "the gauge has " + gaugeAmt(s)) + ". NOT yet an official result; the exchange settles on The Weather Company's CLI value after the day ends.";
    if (ss.k === "AWAITING_SETTLEMENT") return "Observation period over, awaiting the exchange's result (local gauge: " + gaugeAmt(s) + ").";
    var ask = marketYes(s), mk = ask !== null ? "the market says " + Math.round(ask * 100) + "%" : "market: no price";
    var ground = w.k === "WET_NOW" ? "it is raining at the gauge now" : w.k === "WET_IMMINENT" ? "rain is over or about to reach the gauge" : w.k === "APPROACHING" ? "a cell is on its way" : w.k === "RAIN_NEARBY" ? "rain is nearby, nothing on a hit line" : w.k === "OVERDUE" ? "the forecast window passed dry" : w.k === "UNKNOWN" ? "a live feed is stale" : "the sky over the gauge is quiet";
    // cells on a hit line beyond the 60-minute APPROACHING window still belong in the sentence
    // (OKC 2026-09-09 20:40 CT: four 48 to 53 dBZ cores timed 12:32 to 1:20 AM against a 1 AM close read "the sky is quiet")
    var far = inbound(s).filter(function (c) { return c.eta_min > 60; }).concat(cells(s).filter(function (c) { return c.eta_far_min !== null && c.eta_far_min !== undefined; }).map(function (c) { return Object.assign({}, c, { eta_min: Math.max(0, c.eta_far_min - (cellAge(c) || 0)) }); })).sort(function (a, b) { return a.eta_min - b.eta_min; });
    var farTxt = far.length ? "; " + far.length + " cell" + (far.length > 1 ? "s" : "") + " on a line for the gauge, first about " + ctFromMs(Date.now() + far[0].eta_min * 60000) + " (" + far[0].dbz + " dBZ, straight-line guess)" : "";
    return (p !== null ? "v3 says YES " + Math.round(p) + "% (" + v3Rec(p, s) + ")" : (physWord(s) || "v3 unavailable")) + "; " + mk + "; " + gaugeShort(s) + "; " + ground + farTxt + (win ? "; rain hours ahead " + win.text : "; no rain hour ahead") + ".";
  }
  function decisionHTML(s) {
    var w = wetState(s), o = s.observed || {}, m = s.market || {}, p = physPct(s), rel = physRel(p, s), win = rainWindow(s);
    return '<div><div class="name">' + esc(s.city) + ' <small>' + s.icao + ', ' + esc(s.name || "") + '</small></div>' + stateChip(w) + '</div>'
      + '<div class="big num">' + (isLocked(s) ? esc(gaugeAmt(s)) : (p !== null ? pct(p) : '--')) + '<small>' + (isLocked(s) ? 'settles YES' : (p !== null ? 'v3 chance the gauge settles YES' + (rel ? ', measured ' + rel.actual_pct + '% at n=' + rel.n + (rel.n < 20 ? ' (thin)' : '') : ', unmeasured') : esc(physWord(s) || 'v3 unavailable'))) + '</small></div>'
      + '<div class="sub"><b>' + esc(verdictSentence(s, w, p, m, win)) + '</b></div>'
      + '<div class="contract">' + contractLine(s) + '</div>';
  }
  function forecastTimeline(s) { return typeof RainHours === "undefined" ? null : RainHours.build(s, settleFor(s).fc || {}); }
  function renderHours(s) {
    var data=forecastTimeline(s);if(!data)return legacyRenderHours(s);
    var html='<div class="hours">';
    data.slots.forEach(function(slot,n){
      var cls=(n<data.current?'past':'')+(slot.now?' now':'')+(slot.wet?' wet':'')+(slot.hrrr?' hrrr':'')+(n===23?' last':'');
      var title=hourLabel(slot.hour%24)+' local, '+ctFromMs(slot.ms)+' ('+new Date(slot.ms).toISOString()+'): '+(slot.pop===null?'forecast unavailable':slot.pop+'% ('+slot.source+(slot.qpf?', '+slot.qpf+' in':'')+(slot.wx?', '+slot.wx:'')+')')+(slot.hrrr?', HRRR echo '+slot.hrrr+'%':'')+(slot.wet?', gauge recorded rain':'');
      // PR #133 fix round, finding 4: the compact Central label main used ('11p', '2a'); the full '11:00 PM'
      // wrapped to two lines at 360 and 390 and collided with the cutoff label
      html+='<i class="'+cls+'" style="height:'+Math.max(4,(slot.pop||0)*.7)+'px" title="'+esc(title)+'">'+(n%3===0?'<b>'+esc(hourLabel(RainHours.ctHour(slot.ms)).replace(/[ap]m/,function(x){return x[0];}))+'</b>':'')+'</i>';
    });
    // the contract cutoff is drawn at the end of the 24 contract hours (#144); the outlined bar is now
    html+='<i class="cutoff" title="contract cutoff: local standard midnight'+(typeof hasHour24==="function"&&hasHour24(s)?' (1am on the civil clock)':'')+'"><b>cutoff</b></i>';
    html+='</div><div class="hourlbl"><span>24 contract hours; labels in Central. BLUE: gauge recorded rain. AMBER: HRRR echo. The outlined bar is the current hour; the red line is the contract cutoff. Tap a bar for its timestamp.'+(data.hrrrTimingUnavailable?' HRRR timing unavailable for the cached run.':'')+(data.ambiguous?' Repeated local hours without a timestamp are omitted.':'')+'</span></div><div class="hoursel" id="ap-hoursel">'+esc($("ap-hoursel")?$("ap-hoursel").textContent:'')+'</div>';
    $("ap-hours").innerHTML=html;
    $("ap-hours").querySelectorAll('.hours i').forEach(function(bar){bar.onclick=function(){$("ap-hoursel").textContent=bar.title;};});
  }
  function legacyRenderHours(s) {
    var hm = {}, lh = currentHour(s), wet = {}; (s.forecast && s.forecast.hourly_seen || []).forEach(function (h) { hm[contractHour(s, h[0])] = { pop: h[1], src: "NWS" }; });
    (s.forecast && s.forecast.hourly || []).forEach(function (h) { hm[contractHour(s, h[0])] = { pop: h[1], src: "NWS", wx: h[2] }; });
    twcHours(s).forEach(function (h) { if (!hm[contractHour(s, h[0])] || +h[1] > +hm[contractHour(s, h[0])].pop) hm[contractHour(s, h[0])] = { pop: +h[1], src: "weather.com", qpf: h[2], wx: h[3], stamp: h[4] }; });
    ((s.observed || {}).wet_hours || []).forEach(function (h) { wet[collectorHour(s, h)] = true; });
    var he = {}; hrrrEcho(s).forEach(function (h) { he[contractHour(s, h[0])] = h[1]; });
    var html = '<div class="hours">';
    // codex P2, round 3: the standard-day contract is 24 hours. While daylight time is on its civil
    // span is hours 1 to 24, so hour 0 is OUTSIDE the contract and drawing it invented a dry bar.
    for (var h = hasHour24(s) ? 1 : 0; h < dayHours(s); h++) {
      var v = hm[h] ? +hm[h].pop : 0, cls = (h < lh ? "past" : "") + (h === lh ? " now" : "") + (wet[h] ? " wet" : "") + (he[h] ? " hrrr" : "") + (h === 24 ? " last" : "");
      html += '<i class="' + cls + '" style="height:' + Math.max(4, v * 0.7) + 'px" title="' + (h === 24 ? 'hour 24, the LAST contract hour (12am to 1am civil, next calendar date; the market day is local standard)' : hourLabel(h) + ' local') + ', ' + ct(s, h) + ': ' + v + '%' + (hm[h] ? ' (' + hm[h].src + (hm[h].qpf ? ', ' + (+hm[h].qpf).toFixed(2) + ' in' : '') + (hm[h].wx ? ', ' + hm[h].wx : '') + ')' : '') + (he[h] ? ', HRRR echo ' + he[h] + '%' : '') + (wet[h] ? ', gauge recorded rain' : '') + '">' + (h % 3 === 0 ? '<b>' + hourLabel(centralHour(s, h)).replace(/[ap]m/, function (x) { return x[0]; }) + '</b>' : '') + '</i>';
    }
    html += '<i class="cutoff" title="contract cutoff: local standard midnight' + (hasHour24(s) ? ' (1am on the civil clock)' : '') + '"><b>cutoff</b></i>';
    html += '</div><div class="hourlbl"><span>hours in Central; bar height = chance (higher of NWS and weather.com); BLUE bar = the gauge recorded rain that hour; AMBER top = HRRR paints echo; the outlined bar is now; the red line is the contract cutoff; tap a bar to read it</span></div><div class="hoursel" id="ap-hoursel">' + esc($("ap-hoursel") ? $("ap-hoursel").textContent : "") + '</div>';
    $("ap-hours").innerHTML = html;
    $("ap-hours").querySelectorAll(".hours i").forEach(function (bar) { bar.onclick = function () { $("ap-hoursel").textContent = bar.title; }; });
  }
  function sec(title, right, body, open) { return '<details' + (open ? ' open' : '') + '><summary>' + title + '<span>' + right + '</span></summary><div class="body">' + body + '</div></details>'; }
  function renderStack(s, keepOpen) {
    var wasOpen = {}; if (keepOpen) $("ap-stack").querySelectorAll("details").forEach(function (d, i) { wasOpen[i] = d.open; });
    var o = s.observed || {}, se = settleFor(s), p = pulseFor(s), r = compRadar(s), tile = se.tile || {}, pp = physPct(s), ph = physFor(s), rel = physRel(pp, s), mo = modelsFor(s), con = mo && mo.consensus || {}, m = s.market || {}, w = wetState(s), b = twcBest(s), he = hrrrEcho(s), nx = nextm && nextm.markets && nextm.markets[s.city];
    var gauge = '<div class="kv">'
      + '<span>gauge total</span><span><b>' + gaugeTxt(s) + '</b> today' + (o.latest_ob_utc ? ', as of ' + ctClock(o.latest_ob_utc) + ' (' + zClock(o.latest_ob_utc) + ', ' + agoTxt(o.latest_ob_utc) + ')' : '') + '</span>'
      + '<span>present weather</span><span>' + presentWxTxt(s) + '</span>'
      + '</div>';
    var about = '<div class="kv">'
      + '<span>state</span><span>' + stateChip(w) + ' ' + esc(STATES[w.k].why) + '</span>'
      + '<span>inputs</span><span>' + esc(w.inputs.join("; ") || "none") + '</span>'
      + '<span>echo rings</span><span>' + pct(r.pct10) + ' of 6 mi, ' + pct(r.pct30) + ' of 19 mi, ' + pct(r.pct60) + ' of 37 mi, ' + pct(r.pct30_strong) + ' of 19 mi heavy'
      + ' (IEM N0Q composite; scan ' + (r.scan_valid_utc ? agoTxt(r.scan_valid_utc) : '<b class="stale">time unknown</b>') + ', read ' + agoTxt(r.read_utc || r.frame_utc) + (r.radar_quorum ? ', radars ' + esc(r.radar_quorum) : '') + ')'
      + (r.coverage30_pct !== undefined && r.coverage30_pct !== null && r.coverage30_pct < 100 ? '<br><b class="stale">only ' + r.coverage30_pct + '% of the 19 mi ring was sampled; the rest is missing tiles, not dry sky</b>' : '')
      + '<br><small>reflectivity is not rainfall and not the gauge; the map draws NWS MRMS, a different product of the same quantity</small></span>'
      + '<span>cells</span><span>' + (cells(s).length ? cells(s).map(function (c) { var e = etaNow(c), a = cellAge(c), still = cellStationary(c); return c.dbz + ' dBZ, ' + mi(c.km) + ' mi ' + c.bearing + ', ' + (still ? '<b>STATIONARY</b>' : 'moving ' + c.heading + ' ' + c.kt + ' kt, ' + (e !== null ? '<b>ETA ' + Math.round(e) + ' m</b>' : (c.eta_min !== null && c.eta_min !== undefined ? 'ETA expired, scan ' + a + ' m old' : cellMissText(c)))) + (a !== null ? ' <small>(scan ' + a + ' m old)</small>' : ''); }).join('<br>') : 'none within 60 mi') + '</span>'
      + '<span>neighbours</span><span>' + ((s.neighbors || []).length ? (s.neighbors || []).map(function (n) { var a = ageMin(n.time_utc); return n.id + ' ' + mi(n.dist_km) + ' mi ' + (n.bearing ? n.bearing + ' ' : '') + (n.raining ? '<b>WET</b>' : 'dry') + (neighborPosition(n) ? '' : ' (position unavailable)') + (a !== null ? ' <small>' + a + ' m old' + (a < 0 || a > 90 ? ', STALE' : '') + '</small>' : ''); }).join(', ') : 'none') + '</span>'
      + '<span>single radar</span><span>' + (tile.site_block_stale || tile.stale ? 'DEAD, no update in ' + Math.round(tile.unchanged_min || 0) + ' min, not shown' : 'fresh, shown at zoom 10+') + '</span>'
      + '</div>';
    var fc = '<div class="kv">'
      + '<span>window</span><span>' + (b ? 'weather.com best hour <b>' + pct(b.pop) + '</b> at ' + (b.stamp ? ctClock(b.stamp) : ct(s, b.hour)) + (b.qpf ? ', ' + (+b.qpf).toFixed(2) + ' in that hour' : '') + '; <b>' + twcQpf(s).toFixed(2) + ' in</b> forecast left' : 'weather.com: no hour above 15%') + '</span>'
      + '<span>NWS</span><span>peak ' + pct(nwsPeak(s)) + (s.forecast && s.forecast.pop_peak_hour !== null ? ' at ' + ct(s, s.forecast.pop_peak_hour) : '') + '</span>'
      + '<span>weather.com day</span><span>' + (twcDay(s) === null ? 'no day figure published this hour' : pct(twcDay(s))) + '</span>'
      + '<span>HRRR echo</span><span>' + (he.length ? (function () { var today = he.filter(function (h) { return h[0] >= s.local_hour; }), later = he.filter(function (h) { return h[0] < s.local_hour; }); return (today.length ? today.map(function (h) { return (h[2] ? ctClock(h[2]) : ct(s, h[0])).replace(' CT', '') + ' ' + h[1] + '%'; }).join(', ') + ' CT' : 'none left today') + (later.length ? '; <small>after the close: ' + later.map(function (h) { return (h[2] ? ctClock(h[2]) : ct(s, h[0])).replace(' CT', '') + ' ' + h[1] + '%'; }).join(', ') + '</small>' : ''); })() + ' (run ' + ctClock(s.hrrr_init) + ')' : ((typeof RainHours!=="undefined"?RainHours.hrrrRows(s).some(function(r){return !isFinite(r.ms);}):(s.hrrr_hours||[]).some(function(h){return !h[2];})) ? 'HRRR timing unavailable for the cached run' : 'none this run')) + '</span>'
      + '</div>';
    var md = '<div class="kv">'
      + '<span>v3 model</span><span>' + (pp !== null ? '<b>' + pct(pp) + '</b> rest of day, ' + esc(v3Rec(pp, s)) + ' (whole day ' + (typeof ph.p_day === "number" && isFinite(ph.p_day) && ph.p_day >= 0 && ph.p_day <= 100 ? pct(ph.p_day) + ', unmeasured' : 'unavailable') + ')'
          + (ph.evidence === 'UNKNOWN' ? '; <b>gauge state unknown</b> (' + esc(ph.evidence_why || '') + '), so this is the whole-day figure with no dry-gauge credit' : '; ' + esc(condTxt(ph)))
          + (rel ? '; measured out of sample by date: when it said ' + rel.lo + ' to ' + rel.hi + '% it settled YES <b>' + rel.actual_pct + '%</b> of the time (n=' + rel.n + (rel.n < 20 ? ', too thin to trust' : '') + ')' : '; this bucket: <b>unmeasured</b> on this fit')
          + '; fit ' + esc(physics.model_id || '') + (physics.fitted_on ? ', trained ' + esc(physics.fitted_on.start || '') + ' to ' + esc(physics.fitted_on.end || '') : '') + (physics.feature_source ? ', features from ' + esc(physics.feature_source) : '')
        : '<b class="stale">' + esc(physWord(s) || 'v3 unavailable') + '</b>') + '</span>'
      + '<span>7 models</span><span>' + (con.n_wet !== undefined ? '<b>' + con.n_wet + ' of ' + con.n_models + '</b> put 0.01 in on the ground' : '--') + (mo && mo.models ? '<br><small>' + Object.keys(mo.models).map(function (k) { var x = mo.models[k]; return k + ' ' + (x.in !== null && x.in !== undefined ? (+x.in).toFixed(2) : '--'); }).join(' &middot; ') + ' (inches)</small>' : '') + '<br><small>amount forecasts, record unmeasured on this box</small></span>'
      + '</div>';
    var ask = marketYes(s), gapv = (pp !== null && ask !== null) ? Math.round(ask * 100) - Math.round(pp) : null;
    // WO-133: the contract, named. Ticker, contract day, settlement station, threshold and source (from the
    // market's own rules text), the observation deadline (local standard midnight) with time left, the
    // exchange close separately, and the settlement state. Central time for reading, the contract's own
    // date and deadline stated unambiguously.
    var ss = settleState(s), left = minutesLeft(s), dl = deadlineMs(s), cd = candFor(s), bk = book && book.markets && m.ticker && book.markets[m.ticker];
    var ctr = '<div class="kv">'
      + '<span>ticker</span><span><b>' + esc(m.ticker || '--') + '</b>, contract day <b>' + esc(s.local_day || '') + '</b> (local standard day, midnight to midnight' + (hasHour24(s) ? ', which ends 1am on the civil clock' : '') + ')</span>'
      + '<span>settles on</span><span><b>' + esc(s.cli || '') + '</b>, total precipitation strictly greater than 0 in as reported by The Weather Company for that station (weather.com/kalshi); trace and missing count as 0</span>'
      + '<span>deadline</span><span>' + (dl ? ctClock(new Date(dl).toISOString()) + ' (' + new Date(dl).toISOString().slice(0, 16) + 'Z), ' : '') + (left !== null ? (left > 0 ? '<b>' + Math.floor(left / 60) + ' h ' + (left % 60) + ' m left</b>' : '<b>observation period over</b>') : '--') + '</span>'
      + '<span>exchange close</span><span>' + (m.close_time ? ctClock(m.close_time) + ' (' + m.close_time.slice(0, 16) + 'Z)' : '--') + (bk && bk.market && bk.market.status ? ', status ' + esc(bk.market.status) : '') + '</span>'
      + '<span>settlement</span><span><b>' + esc(ss.k.replace(/_/g, ' ')) + '</b>' + (ss.k === "OFFICIALLY_SETTLED" ? ' ' + ss.result.toUpperCase() : ss.k === "THRESHOLD_OBSERVED" ? ', a local reading; not official until the exchange posts a result' : ss.k === "RAIN_DETECTED" ? ', rain reported but the gauge total is still under 0.01' : '') + '</span>'
      + '<span>latest evidence</span><span>gauge ' + gaugeTxt(s) + ' (' + agoTxt(o.latest_ob_utc) + ')' + (p ? ', pulse ' + (p.raining_any ? 'RAIN' : 'dry') + ' (' + agoTxt(p.time_utc) + ')' : '') + '</span>'
      + '</div>';
    var cdw = cd ? candWithheldWord(cd) : null;
    var val = cd && !cdw ? '<div class="kv">'
      + ['no', 'yes'].map(function (sd) { var e = cd[sd]; if (!e) return '<span>' + sd.toUpperCase() + '</span><span>not priced (' + esc(cd.book_status) + ')</span>'; var ex = e.executable; return '<span>' + sd.toUpperCase() + ' x' + (cd.qty || (candidates && candidates.qty) || '?') + '</span><span>' + (ex.avg !== null ? 'at <b>' + cents(ex.avg) + '</b> (' + Math.round(ex.best_size || 0) + ' at best ' + cents(ex.best) + (ex.partial ? ', PARTIAL' : '') + '), gross ' + (100 * e.gross_per).toFixed(1) + 'c, fee ' + (100 * e.fee_per).toFixed(2) + 'c, <b class="' + (e.net_per > 0 ? 'pos' : 'neg') + '">net ' + (100 * e.net_per).toFixed(1) + 'c</b> [' + (100 * e.net_lo_per).toFixed(1) + ', ' + (100 * e.net_hi_per).toFixed(1) + '], walk away above ' + cents(e.max_price_for_zero) : 'no executable price') + '</span>'; }).join('')
      + '<span>priced by</span><span>v3, the model on this page (alerts: priced by v3); v3 ' + pct(cd.p_yes_pct) + ', ' + esc(v3Rec(cd.p_yes_pct, s)) + '</span>'
      + '<span>quote</span><span>' + esc(cd.book_source) + ', ' + (cd.book_age_s !== null ? cd.book_age_s + ' s old' : '?') + ', ' + esc(cd.book_status) + (bk && bk.seq ? ', seq ' + bk.seq : '') + '</span>'
      + (cd.conflicts.length ? '<span>against</span><span class="stale">' + esc(cd.conflicts.join('; ')) + '</span>' : '')
      + '</div>' : '<div class="kv"><span>value</span><span>' + (cd ? '<b class="stale">' + esc(cdw) + '</b>' : (candidates && candidates.reason ? 'not priced: ' + esc(candidates.reason) : 'not priced: board_alerts.py is not running')) + '</span></div>';
    var mk = '<div class="kv">'
      + '<span>Kalshi</span><span><b>YES bid ' + quoteCents(marketQuote(m, "bid")) + ', ask ' + quoteCents(marketQuote(m, "ask")) + '</b>, NO ask <b>' + quoteCents(marketNo(s)) + '</b> (1 minus the YES bid), last ' + cents(m.last) + ', vol ' + Math.round(m.volume || 0) + ', OI ' + Math.round(m.open_interest || 0) + ' (' + agoTxt(m.fetched_utc) + ')</span>'
      + '<span>moves</span><span>' + (m.momentum ? [["15 m", m.momentum.delta_15m], ["1 h", m.momentum.delta_60m]].filter(function (x) { return x[1] !== null && x[1] !== undefined; }).map(function (x) { return (x[1] > 0 ? '+' : '') + x[1] + ' in ' + x[0]; }).join(', ') + (m.momentum.vol_15m !== null && m.momentum.vol_15m !== undefined ? (m.momentum.delta_15m !== null ? ', ' : '') + m.momentum.vol_15m + ' contracts in 15 m' : '') || 'not enough candles yet' : '--') + '</span>'
      + '<span>market vs</span><span>v3 ' + (gapv === null ? (ask === null ? 'no price' : '--') : (gapv > 0 ? '+' : '') + gapv) + ' &middot; NWS ' + (nwsPeak(s) !== null && ask !== null ? (Math.round(ask * 100) - nwsPeak(s) > 0 ? '+' : '') + (Math.round(ask * 100) - nwsPeak(s)) : (ask === null ? 'no price' : '--')) + ' &middot; weather.com day ' + (twcDay(s) !== null && ask !== null ? (Math.round(ask * 100) - twcDay(s) > 0 ? '+' : '') + (Math.round(ask * 100) - twcDay(s)) : (ask === null ? 'no price' : '--')) + ' (points, positive = market higher)</span>'
      + '<span>closes</span><span>' + (m.close_time ? ctClock(m.close_time) + ' (' + m.close_time.slice(0, 10) + ')' : '--') + '</span>'
      + (nx ? '<span>tomorrow</span><span>' + nx.ticker + ' YES ' + quoteCents(marketQuote(nx, "bid")) + ' / ' + quoteCents(marketQuote(nx, "ask")) + '</span>' : '')
      + '</div>';
    var health = '<div class="kv">'
      + '<span>state.json</span><span>' + agoTxt(state.generated_utc) + '</span>'
      + '<span>settle.json</span><span>' + (settle ? agoTxt(settle.generated_utc) : 'missing') + '</span>'
      + '<span>physics_v3</span><span>' + (physics ? physAgoTxt() : 'missing') + '</span>'
      + '<span>pulse file</span><span>' + (metars ? agoTxt(metars.generated_utc) : 'missing') + '</span>'
      + '<span>radar scan</span><span>' + (r.scan_valid_utc ? agoTxt(r.scan_valid_utc) : '<b class="stale">scan time unknown</b>') + ' (read ' + agoTxt(r.read_utc || r.frame_utc) + ')</span>'
      + '<span>fast feeds</span><span>' + fastFeedsTxt() + '</span>'
      + '<span>book feed</span><span>' + bookFeedTxt() + '</span>'
      + '<span>gauge report</span><span>' + agoTxt(o.latest_ob_utc) + '</span>'
      + '<span>forecast</span><span>' + agoTxt(s.forecast && s.forecast.fetched_utc) + '</span>'
      + '</div>';
    var raw = '<div class="kv"><span>METAR</span><span class="num">' + esc((s.metar || {}).raw || o.latest_raw || '') + '</span><span>day</span><span>' + esc(s.local_day || '') + ', local hour ' + s.local_hour + '</span></div>';
    $("ap-stack").innerHTML = sec("Contract", esc(m.ticker || '') + (left !== null && left > 0 ? ", " + Math.floor(left / 60) + " h " + (left % 60) + " m left" : ""), ctr, true)
      + sec("Value at executable prices", cd && !cdw && cd.side ? cd.side.toUpperCase() + " " + (100 * cd[cd.side].net_per).toFixed(1) + "c net" : (cd && cdw ? "withheld" : "none"), val, true)
      + sec("Gauge", gaugeTxt(s), gauge, true) + sec("About to get wet", STATES[w.k].text, about, true) + sec("Forecast", b ? pct(b.pop) + " at " + (b.stamp ? ctClock(b.stamp) : ct(s, b.hour)) : pct(nwsPeak(s)), fc, true)
      + sec("Models", (pp !== null ? pct(pp) + " v3, " + esc(v3Rec(pp, s)) : esc(physWord(s) || "v3 unavailable")), md, true) + sec("Market", "YES " + quoteCents(marketQuote(m, "ask")), mk, true) + sec("Source health", agoTxt(state.generated_utc), health, false) + sec("Raw", "", raw, false);
    if (keepOpen) $("ap-stack").querySelectorAll("details").forEach(function (d, i) { if (wasOpen[i] !== undefined) d.open = wasOpen[i]; });
  }

  /* ---------------- cameras ---------------- */
  function publicCamURL(value) {
    if (!value) return "";
    try {
      var parsed = new URL(String(value), location.href);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
    } catch (e) { return ""; }
  }
  function camURL(c) {
    if (c.type === "youtube") return publicCamURL("https://www.youtube.com/embed/" + encodeURIComponent(c.id || "") + "?autoplay=1&mute=1");
    /* codex walk, 2026-09-09: on the public mirror every proxied still was rewritten to the box's
       private Tailscale address, which Colin's work network cannot reach, so Newark's twelve all
       failed. The camera's own public URL comes first; the box proxy is the fallback. */
    if (c.url) return publicCamURL(c.url);
    if (c.frame) return publicCamURL((typeof DATA === "string" ? DATA.replace(/data\/$/, "") : "") + c.frame);
    return "";
  }
  function camMediaHTML(c, lazy, refresh) {
    var u = camURL(c), loading = lazy ? ' loading="lazy"' : '';
    if (!u) return '<div class="ph">no usable public camera URL</div>';
    if (c.type === "youtube") return '<iframe src="' + esc(u) + '" allow="autoplay"' + loading + '></iframe>';
    if (refresh) u += (u.indexOf("?") > 0 ? "&" : "?") + "t=" + Math.floor(Date.now() / 60000);
    return '<img referrerpolicy="no-referrer" src="' + esc(u) + '" alt=""' + loading + '>';
  }
  function camIsProxied(c) { return !c.url && !!c.frame; }
  function camStrip(s, list) {
    if (!list.length) return '<div class="empty">no cameras catalogued near ' + esc(s.city) + '</div>';
    return list.map(function (c, i) {
      var dead = !ringAvailable(c), u = camURL(c);
      // still images load straight away (they are one JPEG each); YouTube streams wait for a tap
      var media = dead ? '<div class="ph">unavailable at the latest check</div>'
        : c.type === "youtube" ? '<div class="ph">&#9654; tap to play the live stream</div>'
        : camMediaHTML(c, true, true);
      return '<div class="cam' + (dead ? ' dead' : '') + '" data-i="' + i + '">' + media + '<div class="cap"><b>' + esc(c.name) + '</b>' + mi(c.dist_km) + ' mi ' + esc(c.dir || '') + ' of the gauge &middot; ' + (c.type === "youtube" ? "live stream" : "still image, requested again each minute") + '<small>' + esc(ringFreshTxt(c)) + (publicCamURL(c.page || c.url || (c.proxy && c.proxy.src)) ? ' &middot; <a target="_blank" rel="noopener" href="' + esc(publicCamURL(c.page || c.url || c.proxy.src)) + '">source</a>' : '') + '</small>' + '</div></div>';
    }).join("");
  }
  function bindCams(root, list) {
    root.querySelectorAll(".cam").forEach(function (el) {
      var c = list[+el.dataset.i]; if (!c) return;
      var im = el.querySelector("img"); if (im) im.onerror = function () { var d = document.createElement("div"); d.className = "ph"; d.textContent = camIsProxied(c) ? "camera frame unavailable on this host; the source may still be working" : "no picture from the source right now"; im.replaceWith(d); };
      var ph = el.querySelector(".ph"); if (!ph) return;
      ph.onclick = function () {
        /* ASTRA P2 ON 5237cac: this asked the RAW held flag while ringCard hides the image on the
           full availability rule, so a camera carrying verified:false with held:false had its
           placeholder hidden correctly and then reloaded the REJECTED image the moment the reader
           tapped it. A rejection a tap can undo is not a rejection. ringAvailable is the one
           predicate every camera decision uses, and this is a camera decision. */
        if (!ringAvailable(c)) return;
        var u = camURL(c);
        ph.outerHTML = camMediaHTML(c, true, true);
      };
    });
  }
  var camPopup = null;
  function openCamChooser(m, s, g, key) {
    if (camPopup) { camPopup.remove(); camPopup = null; }
    var html = '<div class="campop"><div class="cap"><b>' + g.cams.length + ' cameras here, ' + mi(g.cams[0].dist_km) + ' mi ' + esc(g.cams[0].dir || '') + ' of the gauge</b>' + g.cams.map(function (c, i) { return '<button class="pick" data-i="' + i + '">' + esc(c.name.length > 70 ? c.name.slice(0, 70) + '...' : c.name) + '</button>'; }).join('') + '</div></div>';
    camPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: "420px", offset: 12 }).setLngLat(g.pos).setHTML(html).addTo(m);
    camPopup.__icao = s.icao;
    camPopup.on("close", function () { camPopup = null; });
    camPopup.getElement().querySelectorAll(".pick").forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); openCamPopup(m, s, g.cams[+b.dataset.i], g.pos, g.exact); }; });
  }
  function openCamPopup(m, s, c, lngLat, exact) {
    if (!ringAvailable(c)) return;
    /* Colin, 2026-09-09 16:35 CT: "have the picture actually render over where the white box is,
       bigger, so I can see the exact location relative to the gauge." The picture is a map popup
       anchored on the camera, so the camera and the SETTLEMENT GAUGE pin share the view. */
    if (camPopup) { camPopup.remove(); camPopup = null; }
    var u = camURL(c), media = camMediaHTML(c, false, true);
    // codex P1 on d542f95: ringFreshTxt can carry repr(exc) from cam_freshness, which normally holds
    // angle brackets and can include an endpoint-controlled HTTP reason phrase. "<HTTPError 404:
    // 'Not Found'>" was being PARSED as an element instead of shown, and a compromised endpoint could
    // inject active markup into the dashboard. The function stays plain for its textContent callers
    // and is escaped here and in ringCard, which are the two innerHTML sinks.
    var ringNote = '<br><small>' + esc(ringFreshTxt(c)) + '</small>';   // codex round 4: a ring camera's health travels into the map popup
    var html = '<div class="campop">' + media + '<div class="cap"><b>' + esc(c.name) + '</b>' + mi(c.dist_km) + ' mi ' + esc(c.dir || '') + ' of the gauge' + (exact ? '' : ', placed by distance and bearing') + ' &middot; ' + (c.type === "youtube" ? 'live stream' : 'still image, requested again each minute') + '</div></div>';
    // open on the side AWAY from the gauge pin so the picture never covers it
    var dx = lngLat[0] - s.lon, dy = lngLat[1] - s.lat, anchor = Math.abs(dy) >= Math.abs(dx) * 0.6 ? (dy > 0 ? "bottom" : "top") : (dx > 0 ? "left" : "right");
    camPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: "420px", offset: 12, anchor: anchor }).setLngLat(lngLat).setHTML(html).addTo(m);
    camPopup.__icao = s.icao; camPopup.__cam = c; camPopup.__ring = !!c.band; camPopup.__key = c.url || c.frame || c.name;
    if (ringNote) { var capEl = camPopup.getElement() && camPopup.getElement().querySelector(".cap"); if (capEl) capEl.insertAdjacentHTML("beforeend", ringNote); }
    camPopup.on("close", function () { camPopup = null; });
    // P1: the popup's image gets the same failure wording as the grid
    var pim = camPopup.getElement() && camPopup.getElement().querySelector("img");
    if (pim) pim.onerror = function () { var d = document.createElement("div"); d.className = "ph"; d.textContent = camIsProxied(c) ? "camera frame unavailable on this host; the source may still be working" : "no picture from the source right now"; pim.replaceWith(d); };
  }
  function openCamSheet(s, c) {
    if (!ringAvailable(c)) return;
    var sh = $("sheet"); sh.classList.remove("hidden"); sh.__cam = c; sh.__catalog = (camRings && camRings.updated_utc);
    var u = camURL(c);
    sh.innerHTML = '<button class="x">close</button><b>' + esc(c.name) + '</b><br><small>' + mi(c.dist_km) + ' mi ' + esc(c.dir || '') + ' of the gauge; ' + esc(ringFreshTxt(c)) + '</small><div class="cam" style="margin-top:8px">' + camMediaHTML(c, false, false) + '</div>';
    sh.querySelector(".x").onclick = closeSheet;
  }
  function closeSheet() { var sh = $("sheet"); sh.classList.add("hidden"); sh.innerHTML = ""; sh.__cam = null; }

  /* 4. scorecard */
  function renderScorecard() {
    var S = stations();
    var today = S.filter(function (s) { return isLocked(s) || rainingNow(s); });
    $("sc-today").innerHTML = today.length ? '<table class="sc"><tr><th>gauge</th><th>state</th><th>total</th><th>market</th><th>v3 said (whole day)</th></tr>' + today.map(function (s) { var ph = physFor(s), m = s.market || {}; return '<tr><td><b>' + esc(s.city) + '</b> ' + s.icao + '</td><td>' + stateChip(wetState(s)) + '</td><td class="num">' + esc(gaugeAmt(s)) + '</td><td class="num">YES ' + quoteCents(marketQuote(m, "ask")) + '</td><td class="num">' + (ph && typeof ph.p_day === "number" && isFinite(ph.p_day) ? pct(ph.p_day) + ' <small>unmeasured</small>' : '<b class="stale">' + esc(physWord(s) || "v3 unavailable: no whole-day number") + '</b>') + '</td></tr>'; }).join("") + '</table>' : '<div class="empty">no gauge has recorded rain yet today</div>';
    function relHTML(rows, thin) {
      return '<table class="sc"><tr><th>it said</th><th>station-days</th><th>rained</th><th>actual</th></tr>' + Object.keys(rows).sort(function (a, b) { return +a - +b; }).map(function (k) { var r = rows[k]; return '<tr><td>' + r.lo + ' to ' + r.hi + '%</td><td class="num">' + r.n + '</td><td class="num">' + r.yes + '</td><td class="num' + (r.n < thin ? ' thin' : '') + '">' + r.actual_pct + '%' + (r.n < thin ? ' (n under ' + thin + ', too thin)' : '') + '</td></tr>'; }).join("") + '</table>';
    }
    /* v3's measured records, each labelled with its sample (Colin, 2026-09-10: "what sample is it
       showing?"). LIVE: the 9am calls source_snapshots.py records under the key "v3 shadow" (the
       recorder's historical name for this feed), settled against the gauge the next morning; it is
       v3's own record only when the sole identity in those rows is the model on the card. STUDY
       HOLDOUT: the fit's own chronological test block, carried in physics_v3.json. No other model's
       record file is fetched or shown (Colin, 2026-09-18); the by-date windows read "v3: unmeasured". */
    var live = scorecardData && scorecardData.sources && scorecardData.sources["v3 shadow"];
    var ids3 = (scorecardData && scorecardData.v3_model_ids) || [], sole3 = ids3.length === 1 ? ids3[0] : null;
    var mine3 = !!(sole3 && physics && sole3.model_id && sole3.model_id === physics.model_id);
    var identTxt = mine3 ? 'recorded by the model on the card' : (ids3.length > 1 ? '<b class="stale">pools ' + ids3.length + ' v3 versions, not any one model\'s record until split</b>' : (sole3 ? '<b class="stale">recorded by a different v3 version (' + esc(sole3.model_id) + '); the running model\'s live record starts at zero</b>' : 'no v3 rows yet'));
    var liveHTML = (live && live.n) ? '<p class="note">' + live.n + ' settled 9am calls' + (live.brier !== null && live.brier !== undefined ? ', Brier ' + live.brier : '') + ' (scorecard window ' + scorecardData.days + ' days; v3 rows exist only where its writer ran); ' + identTxt + '</p>' + relHTML(live.buckets || {}, 20)
      : '<div class="empty">v3: unmeasured on this window. Every 9am v3 call is scored against the gauge the next morning; ' + (scorecardData && scorecardData.open_rows && scorecardData.open_rows.length ? scorecardData.open_rows.length + ' calls waiting to settle.' : 'no settled rows yet.') + '</div>';
    var st = physics && physics.study, nr = st && st.no_range_test, tb = (st && st.test_block) || {};
    var studyHTML = st ? '<p class="note">this fit\'s own held-out test block, chronological by local standard date, ' + esc(tb.test_dates || '?') + ' dates, n=' + esc(tb.test_rows || '?') + (st.brier_test !== undefined && st.brier_test !== null ? ', Brier ' + (+st.brier_test).toFixed(3) : '') + (physics.feature_source ? '; features from ' + esc(physics.feature_source) : '') + '</p>'
        + (nr ? '<table class="sc"><tr><th>it said</th><th>station-days</th><th>rained</th><th>actual</th></tr><tr><td>0 to 10% (NO range)</td><td class="num">' + esc(nr.n) + '</td><td class="num">' + esc(nr.rained) + '</td><td class="num">' + esc(nr.actual_pct) + '%' + (nr.ci95_binomial ? ' (95% ' + esc(nr.ci95_binomial[0]) + ' to ' + esc(nr.ci95_binomial[1]) + ')' : '') + '</td></tr></table><p class="note">the feed carries the NO-range bucket only; every other bucket: unmeasured here</p>' : '<div class="empty">no bucket table in the study record</div>')
      : '<div class="empty">v3: unmeasured on this window (no study record in the feed)</div>';
    $("sc-physics").innerHTML = '<details class="card" open><summary><b>LIVE, 9am calls scored against the gauge</b><span>' + (live && live.n ? 'n=' + live.n : 'n=0 so far') + '</span></summary>' + liveHTML + '</details>'
      + '<details class="card" open><summary><b>STUDY HOLDOUT, this fit, unseen dates</b><span>' + (st ? (tb.calib_before ? 'dates after ' + esc(tb.calib_before) : esc(st.arm || '')) : 'none') + '</span></summary>' + studyHTML + '</details>'
      + '<details class="card"><summary><b>ONE YEAR window, 2025-09-08 to 2026-09-08</b><span>v3: unmeasured</span></summary><div class="empty">v3: unmeasured on this window' + (physics && physics.fitted_on ? ' (the fit was trained on ' + esc(physics.fitted_on.start || '') + ' to ' + esc(physics.fitted_on.end || '') + ', inside it)' : '') + '.</div></details>'
      + '<details class="card"><summary><b>SUMMER window, 2026-05-31 to 2026-09-08</b><span>v3: unmeasured</span></summary><div class="empty">v3: unmeasured on exactly this window; the nearest v3 measurement is the study holdout above.</div></details>';
    /* phase 2: every source's own record, from source_snapshots.py (09:00 snapshots settled the
       next day). Until rows settle the board says so instead of showing nothing. Only the sources
       named here are shown (Colin, 2026-09-16 and 2026-09-18: one model on the page, nothing about
       any other model): an allowlist, so a new recorder key for another model can never leak in.
       The "v3 shadow" key is labelled as what it is, this board's model. */
    var sc = scorecardData, scEl = $("sc-sources");
    var SHOWN_SOURCES = ["v3 shadow", "nws", "weather.com day", "weather.com best hour", "models median", "market"];
    function srcLabel(nm) { return nm === "v3 shadow" ? "v3 (this board's model), 9am calls" : nm; }
    if (scEl) {
      if (!sc || !sc.settled_rows) scEl.innerHTML = '<div class="empty">Every other source gets its own record here: what NWS, weather.com, the model panel and the market said at 9am, against what the gauge did. Recording started 2026-09-09; the first settled rows land the morning after the first 9am snapshot' + (sc && sc.open_rows && sc.open_rows.length ? ' (' + sc.open_rows.length + ' snapshots waiting to settle)' : '') + '.</div>';
      else {
        var names = Object.keys(sc.sources || {}).filter(function (nm) { return SHOWN_SOURCES.indexOf(nm) >= 0; });
        scEl.innerHTML = '<p class="note">' + sc.settled_rows + ' settled station-days over ' + sc.days + ' days, 9am snapshots (' + agoTxt(sc.generated_utc) + '). Brier: lower is better, 0.25 is a coin flip.</p>' + names.map(function (nm) {
          var src = sc.sources[nm], b = src.buckets || {};
          return '<details class="card"><summary><b>' + esc(srcLabel(nm)) + '</b><span>n=' + src.n + (src.brier !== null ? ', Brier ' + src.brier : '') + '</span></summary><table class="sc"><tr><th>it said</th><th>station-days</th><th>rained</th><th>actual</th></tr>'
            + Object.keys(b).sort(function (x, y) { return +x - +y; }).map(function (k) { var r = b[k]; return '<tr><td>' + r.lo + ' to ' + r.hi + '%</td><td class="num">' + r.n + '</td><td class="num">' + r.yes + '</td><td class="num' + (r.n < 20 ? ' thin' : '') + '">' + r.actual_pct + '%' + (r.n < 20 ? ' (thin)' : '') + '</td></tr>'; }).join("") + '</table></details>';
        }).join("");
      }
    }
    $("sc-note").textContent = physics ? "The number on the card comes from fit " + (physics.model_id || "unknown") + ", trained on " + (physics.n_fit_rows_train || "?") + " station-days (" + (physics.fitted_on ? (physics.fitted_on.start || "") + " to " + (physics.fitted_on.end || "") : "") + "), features from " + (physics.feature_source || "?") + ". "
      + (mine3 ? "The LIVE table is measured on the model actually running." : (ids3.length > 1 ? "The LIVE table POOLS " + ids3.length + " v3 versions and is NOT any one model's record until it is split." : (sole3 ? "The LIVE table was recorded by a DIFFERENT v3 version (" + sole3.model_id + "), not the one on the card; the running model's live record starts at zero." : "The LIVE table has no rows for the running model yet; it starts at zero.")))
      + " No other model's record is shown on this page. NWS, weather.com and the market get theirs below as rows settle." : "the v3 feed did not load, so no fit is identified";
  }

  /* ---------------- full-screen map (Colin, 2026-09-09 17:40 CT: "I want the map to be full screen if I want") ----------------
     The map box goes fixed and fills the screen; its radar controls ride along at the bottom; Esc or the button restores. */
  function toggleFull(mapId) {
    var box = $(mapId), key = mapId === "map-live" ? "live" : "airport", ctl = $("ctl-" + key), on = !box.classList.contains("full");
    box.classList.toggle("full", on); ctl.classList.toggle("fullctl", on); document.body.classList.toggle("mapfull", !!document.querySelector(".mapbox.full"));
    var btn = $(mapId === "map-live" ? "fs-live" : "fs-airport"); if (btn) btn.innerHTML = on ? "&#x2716; exit full screen" : "&#x26F6; full screen";
    if (!on) { document.querySelectorAll(".fsx").forEach(function (x) { x.remove(); }); }
    else if (!box.querySelector(".fsx")) { var x = document.createElement("button"); x.className = "fsx"; x.innerHTML = "&#x2716; exit full screen"; x.onclick = function () { toggleFull(mapId); }; box.appendChild(x); }
    setTimeout(function () { if (maps[key]) maps[key].resize(); }, 60);
  }
  document.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-fs]"); if (b) { ev.preventDefault(); toggleFull(b.dataset.fs); } });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") document.querySelectorAll(".mapbox.full").forEach(function (x) { toggleFull(x.id); }); });


  /* ---------------- the first screen of a station: five answers, and today's briefing ---------------- */
  function briefFor(s) { return (briefing && briefing.stations && briefing.stations[s.icao]) || null; }
  // codex P1 on 62b6d81: a retained briefing whose refresh FAILED is stale from that moment, whatever its age
  function briefStale() { if (!briefing) return "unavailable"; if (briefingFail) return "stale, its refresh failed at " + ctFromMs(briefingFail); var a = ageMin(briefing.generated_utc); if (a === null) return "undated"; if (a < 0 || a > 40) return "stale, " + agoTxt(briefing.generated_utc); return null; }
  function stationBriefStale(bf) { if (!bf) return null; if (bf.carried || bf.error) return "stale: this gauge's briefing failed to build" + (bf.carried_at_utc ? " at " + ctClock(bf.carried_at_utc) : "") + ", showing the previous one from " + agoTxt(bf.checked_utc); return null; }
  function stdClock(s, iso) {
    // the station's LOCAL STANDARD clock, which is the contract's clock, beside Central
    if (!iso) return "";
    var t = Date.parse(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); if (isNaN(t)) return String(iso);
    var d = new Date(t + stdOffMin(s) * 60000), h = d.getUTCHours(), mm = ("0" + d.getUTCMinutes()).slice(-2);
    return (h % 12 || 12) + ":" + mm + (h < 12 ? "am" : "pm") + " std";
  }
  function fracClock(h) { if (h === null || h === undefined) return "?"; var hh = Math.floor(h), mm = Math.round((h - hh) * 60); if (mm === 60) { hh += 1; mm = 0; } return (hh % 12 || 12) + ":" + ("0" + mm).slice(-2) + (hh % 24 < 12 ? "am" : "pm") + " std"; }
  function contractLine(s) {
    var m = s.market || {}, dl = deadlineMs(s), left = minutesLeft(s);
    var tz = "UTC" + (stdOffMin(s) / 60 >= 0 ? "+" : "") + (stdOffMin(s) / 60) + " standard";
    return '<span><b>' + esc(s.icao) + '</b> settlement gauge</span>'
      + '<span>contract day <b>' + esc(contractDay(s)) + '</b></span>'
      + '<span>window <b>midnight to midnight ' + esc(tz) + '</b>' + (hasHour24(s) ? ' (1am to 1am civil)' : '') + '</span>'
      + '<span>cutoff ' + (dl ? '<b>' + ctClock(new Date(dl).toISOString()) + '</b>' : '--') + (left !== null ? (left > 0 ? ', <b>' + Math.floor(left / 60) + ' h ' + (left % 60) + ' m left</b>' : ', <b>window closed</b>') : '') + '</span>'
      + '<span>threshold <b>0.01 in</b> (a trace settles NO)</span>'
      + '<span>settles on <b>The Weather Company daily total for ' + esc(s.cli || s.icao) + '</b></span>'
      + '<span>ticker <b>' + esc(m.ticker || '--') + '</b>' + (m.ticker ? ' <a href="https://kalshi.com/markets/kxrain" target="_blank" rel="noopener">rules on Kalshi</a> <small>(series page; the exact market page path is not verified by this board)</small>' : '') + '</span>';
  }
  /* the evidence read: what the gauge record says about the contract window so far, and whether
     that record is complete. Every branch names its source; nothing here is a probability. */
  function evidenceRead(s) {
    var ph = physFor(s), p = pulseFor(s), o = s.observed || {}, md = s.metar_day || null, ss = settleState(s), lines = [];
    var out = { label: "", cls: "UNKNOWN", lines: lines };
    if (p && p.time_utc) lines.push("latest airport report observed " + stdClock(s, p.time_utc) + " (" + agoTxt(p.time_utc) + ")" + (p.report_time_utc && String(p.report_time_utc).slice(11, 16) !== String(p.time_utc).slice(11, 16) ? ", published as the " + String(p.report_time_utc).slice(11, 16) + "Z slot" : ""));
    if (p && p.madis) lines.push(madisTxt(p));
    if (md && md.sensor && md.sensor !== "ok") lines.push("sensor: " + (md.note || md.sensor));
    if (ss.k === "OFFICIALLY_SETTLED") { out.label = "SETTLED " + ss.result.toUpperCase() + " by the exchange"; out.cls = "LOCKED"; return out; }
    // gauge law (2026-09-10): a lock from the 1-minute pulse with no daily total read prints no amount, never 0.00
    if (isLocked(s)) { var gl = gaugeIn(s); out.label = "WET: " + (gl !== null ? gl.toFixed(2) + " in observed, threshold reached" : "threshold reached, daily total not read yet") + " (" + (pulseLock(s) !== null ? "1-minute pulse" : "gauge total") + ")"; out.cls = "LOCKED"; return out; }
    if (p && p.pno) { out.label = "SENSOR OUT: the latest report carries PNO, no dry evidence from it"; out.cls = "UNKNOWN"; return out; }
    if (p && p.trace) { out.label = "TRACE observed: precipitation under 0.01 in, not a no-rain observation"; out.cls = "WET_NOW"; return out; }
    if (rainingNow(s)) { out.label = "RAIN REPORTED at the gauge, total still under 0.01 in"; out.cls = "WET_NOW"; return out; }
    if (!ph) { out.label = physWord(s) ? "model evidence: " + physWord(s) : "no model evidence row for today"; return out; }
    if (ph.evidence === "DRY_AS_OF") {
      var cov = ph.coverage_from_hour, t = ph.conditioned_at_hour;
      if (cov !== null && cov !== undefined && cov >= 24) { out.label = "DRY reading at " + fracClock(t) + ", NO DRY CREDIT: " + (ph.evidence_gap || "sensor coverage unknown"); out.cls = "UNKNOWN"; return out; }
      if (cov) { out.label = "DRY as of " + fracClock(t) + ", sensor covered only from " + fracClock(cov) + " (PNO gap earlier)"; out.cls = "RAIN_NEARBY"; lines.push(ph.evidence_gap || ""); return out; }
      out.label = "DRY as of " + fracClock(t) + (cov === 0 ? ", sensor working all day" : (cov === undefined ? ", coverage not reported by this model version" : "")); out.cls = "QUIET"; return out;
    }
    if (ph.evidence === "WET") { out.label = "WET per the model's evidence read"; out.cls = "LOCKED"; return out; }
    out.label = "UNKNOWN: " + (ph.evidence_why || "no dated dry reading"); out.cls = "UNKNOWN"; return out;
  }
  function ageFlag(iso, maxMin, futureToleranceMin) { var a = ageMin(iso, futureToleranceMin); if (a === null) return '<b class="stale">missing</b>'; return (a < 0 || a > maxMin ? '<b class="stale">' : '<b>') + agoTxt(iso, futureToleranceMin) + '</b>'; }
  function tile(title, body, cls) { return '<div class="tile' + (cls ? ' ' + cls : '') + '"><h4>' + title + '</h4>' + body + '</div>'; }
  function answersHTML(s) {
    var o = s.observed || {}, se = settleFor(s), p = pulseFor(s), m = s.market || {}, ev = evidenceRead(s), bf = briefFor(s), e = nextEvent(s), win = rainWindow(s), wn = wetNeighbours(s), ph = physFor(s), cd = candFor(s), r = compRadar(s);
    var v3 = physPct(s), ask = marketYes(s), gap = (v3 !== null && ask !== null) ? Math.round(ask * 100) - Math.round(v3) : null;
    // 1. observed
    var observed = '<div class="big num">' + gaugeTxt(s) + '</div>'
      + '<ul>' + (o.latest_ob_utc ? '<li>gauge total from the collector, observed ' + stdClock(s, o.latest_ob_utc) + ' (' + agoTxt(o.latest_ob_utc) + ')' + (o.precip_known === false ? ', <b class="stale">precipitation carried forward, not re-read</b>' : '') + '</li>' : '<li>no collector gauge total this cycle</li>')
      + ev.lines.filter(Boolean).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
    // 2. evidence status
    var evidence = '<div class="evlabel ' + ev.cls + '">' + esc(ev.label) + '</div><ul>'
      + (ph ? '<li>model conditioning (v3): ' + esc(condTxt(ph)) + '</li>' : (physWord(s) ? '<li>model conditioning: ' + esc(physWord(s)) + '</li>' : ''))
      + (ph && ph.observed_at_utc ? '<li>dated from the report observed ' + stdClock(s, ph.observed_at_utc) + (ph.report_time_utc ? ' (nominal slot ' + String(ph.report_time_utc).slice(11, 16) + 'Z)' : '') + '</li>' : '')
      + '<li>' + (p && p.time_utc ? 'newest report ' + agoTxt(p.time_utc) : 'no 1-minute pulse') + (o.latest_ob_utc && p && p.time_utc && Date.parse(o.latest_ob_utc) < Date.parse(String(p.time_utc).replace(/Z$/, "+00:00")) - 60000 ? '; the collector\'s reading is superseded by a newer report' : '') + '</li>'
      + '</ul>';
    // 3. still to come
    var bst = briefStale() || stationBriefStale(bf);
    var coming = '<div class="lead">' + (bf && bf.headline ? esc(bf.headline) : (briefing ? 'no briefing for this gauge' : 'briefing unavailable')) + (bst ? ' <b class="stale">(' + esc(bst) + ')</b>' : '') + '</div><ul>'
      + (bf && bf.point_forecast && bf.point_forecast.before_cutoff && bf.point_forecast.before_cutoff.peak_pct !== null ? '<li>before the cutoff: NWS point forecast peak <b>' + bf.point_forecast.before_cutoff.peak_pct + '%</b> at ' + fracClock(bf.point_forecast.before_cutoff.peak_local_hour) + (bf.point_forecast.before_cutoff.first_30_local_hour !== null && bf.point_forecast.before_cutoff.first_30_local_hour !== undefined ? ', first hour at 30%+ ' + fracClock(bf.point_forecast.before_cutoff.first_30_local_hour) : '') + '</li>' : '')
      + (bf && bf.point_forecast && bf.point_forecast.after_cutoff && bf.point_forecast.after_cutoff.peak_pct !== null ? '<li>after the cutoff (does not count): peak <b>' + bf.point_forecast.after_cutoff.peak_pct + '%</b> at ' + fracClock(bf.point_forecast.after_cutoff.peak_local_hour) + '</li>' : '')
      + (e ? '<li>next signal: ' + esc(e.text) + '</li>' : '') + (win && !isLocked(s) ? '<li>rain hours ahead in any forecast: <b>' + esc(win.text) + '</b></li>' : '')
      + '<li>radar: ' + pct(r.pct10) + ' of the 6 mi ring, ' + pct(r.pct30) + ' of 19 mi (' + agoTxt(r.frame_utc) + ')' + (wn.length ? '; <b>' + wn.length + ' wet airport' + (wn.length > 1 ? 's' : '') + ' nearby</b>' : '; no wet airport nearby') + '</li></ul>';
    // 4. models and market
    var sup = [];
    if (bf && bf.point_forecast && bf.point_forecast.before_cutoff && bf.point_forecast.before_cutoff.peak_pct !== null) sup.push("NWS point peak " + bf.point_forecast.before_cutoff.peak_pct + "%");
    if (bf && bf.taf && (bf.taf.precip_groups || []).some(function (g) { return g.still_before_cutoff; })) sup.push("TAF carries precipitation still ahead before the cutoff");
    if (twcDay(s) !== null) sup.push("weather.com day " + pct(twcDay(s)));
    var dis = gap === null ? '' : (Math.abs(gap) >= 15 ? '<li><b>market ' + Math.abs(gap) + ' points ' + (gap > 0 ? 'ABOVE' : 'BELOW') + ' v3</b>' + (sup.length ? '; airport forecasts: ' + esc(sup.join(', ')) : '; no airport forecast to weigh it against') + '</li>' : '<li>market within 15 points of v3</li>');
    var models = '<div class="quotes num">'
      + '<span><small>v3</small><b>' + (v3 !== null ? pct(v3) : '--') + '</b><small>' + (v3 !== null ? (typeof ph.p_day === "number" ? 'whole day ' + pct(ph.p_day) + ', ' : '') + ageFlag(physics.generated_utc, 35, FUTURE_TOLERANCE_MIN) : '<b class="stale">' + esc(physWord(s) || 'v3 unavailable') + '</b>') + '</small></span>'
      + '<span><small>YES ask</small><b>' + quoteCents(marketQuote(m, "ask")) + '</b><small>bid ' + quoteCents(marketQuote(m, "bid")) + ', ' + ageFlag(m.fetched_utc, 15) + '</small></span>'
      + '<span><small>NO ask</small><b>' + quoteCents(marketNo(s)) + '</b><small>1 minus the YES bid; book ' + (book && book.feed && book.feed.status === "LIVE" && bookAge() !== null && bookAge() >= 0 && bookAge() <= 2 ? 'live' : '<b class="stale">off</b>') + '</small></span>'
      + '</div><ul>' + dis
      + (cd && candWithheldWord(cd) ? '<li><b class="stale">' + esc(candWithheldWord(cd)) + '</b></li>' : (cd && cd.side ? '<li>priced: ' + cd.side.toUpperCase() + ' net ' + (100 * cd[cd.side].net_per).toFixed(1) + 'c per contract at executable prices' + (cd.conflicts.length ? ' <b class="stale">against: ' + esc(cd.conflicts.join('; ')) + '</b>' : '') + '</li>' : '<li>not a priced candidate' + (cd && cd.conflicts && cd.conflicts.length ? ': ' + esc(cd.conflicts[0]) : (candidates && candidates.reason ? ': ' + esc(candidates.reason) : '')) + '</li>'))
      + '<li>v3 is a model output conditioned on the gauge evidence above; it is not a calibrated trading probability, and a disagreement with the market is a question to investigate, not an edge</li></ul>';
    // 5. freshness
    var fresh = '<ul class="fresh-list">'
      + '<li>collector state ' + ageFlag(state.generated_utc, 10) + '</li>'
      + '<li>1-minute pulse ' + (p ? ageFlag(p.time_utc, 90) : '<b class="stale">missing</b>') + '</li>'
      + '<li>radar scan ' + (r.scan_valid_utc ? ageFlag(r.scan_valid_utc, 20) : '<b class="stale">time unknown</b>') + '</li>'
      + '<li>v3 model ' + (physics ? ageFlag(physics.generated_utc, 35, FUTURE_TOLERANCE_MIN) : '<b class="stale">missing</b>') + '</li>'
      + '<li>pulse file ' + (metars ? ageFlag(metars.generated_utc, LIVE_WINDOWS.pulse) : '<b class="stale">missing</b>') + '</li>'
      + '<li>briefing ' + (briefing ? ageFlag(briefing.generated_utc, 40) : '<b class="stale">missing</b>') + (bf && bf.text_generated_utc ? ', text last changed ' + agoTxt(bf.text_generated_utc) : '') + '</li>'
      + '<li>quote ' + ageFlag(m.fetched_utc, 15) + ' &middot; ' + fastFeedsTxt() + '</li></ul>';
    return tile('1. Observed inside the contract window', observed) + tile('2. Is the evidence complete?', evidence, ev.cls === "UNKNOWN" ? 'warn' : '')
      + tile('3. What could still reach the gauge, and when', coming) + tile('4. What v3 and the market say', models) + tile('5. How fresh is each input', fresh);
  }
  function quoteList(items, prefix) { return items && items.length ? items.map(function (q) { return '<li>' + (prefix ? '<small>' + prefix + '</small> ' : '') + esc(q) + '</li>'; }).join('') : ''; }
  function briefHTML(s) {
    var bf = briefFor(s), st = briefStale() || stationBriefStale(briefFor(s));
    if (!bf) return '<div class="brief-empty">' + (briefing ? 'No briefing for this gauge in the current file.' : 'The briefing file did not load; the panel above still shows the forecasts the board holds.') + '</div>';
    var pf = bf.point_forecast || {}, b = pf.before_cutoff || {}, a = pf.after_cutoff || {}, taf = bf.taf, d = bf.discussion;
    var h = '<div class="brief-head"><div class="brief-title">Today\'s weather briefing <small>' + esc(bf.city || '') + ' &middot; contract day ' + esc(bf.day || '') + ' &middot; cutoff ' + esc(bf.cutoff_note || '') + '</small></div>'
      + '<div class="brief-fresh' + (st ? ' stale' : '') + '">' + (st ? 'STALE: ' + esc(st) : 'checked ' + agoTxt(bf.checked_utc)) + (bf.text_generated_utc ? ' &middot; text last changed ' + agoTxt(bf.text_generated_utc) : '') + '</div></div>'
      + '<div class="brief-headline">' + esc(bf.headline || '') + '</div>'
      + (bf.summary && bf.summary.length ? '<p class="brief-summary">' + bf.summary.map(esc).join(' ') + '</p>' : '')
      + '<div class="brief-cols"><div class="col"><h5>Before the cutoff <small>counts</small></h5>' + (b.peak_pct !== null && b.peak_pct !== undefined ? '<div class="big num">' + b.peak_pct + '%</div><small>NWS point forecast peak at ' + fracClock(b.peak_local_hour) + (b.first_30_local_hour !== null && b.first_30_local_hour !== undefined ? '; first hour at 30%+ ' + fracClock(b.first_30_local_hour) : '') + (b.qpf_in !== null && b.qpf_in !== undefined ? '; ' + (+b.qpf_in).toFixed(2) + ' in forecast' : '') + (bf.twc_forecast && bf.twc_forecast.before_cutoff && bf.twc_forecast.before_cutoff.peak_pct !== null ? '; weather.com peak ' + bf.twc_forecast.before_cutoff.peak_pct + '%' : '') + '</small>' : '<small>no hourly forecast left before the cutoff</small>') + '</div>'
      + '<div class="col after"><h5>After the cutoff <small>does not count</small></h5>' + (a.peak_pct !== null && a.peak_pct !== undefined ? '<div class="big num">' + a.peak_pct + '%</div><small>peak at ' + fracClock(a.peak_local_hour) + '</small>' : '<small>no forecast beyond the cutoff</small>') + '</div></div>'
      + '<div class="brief-grid">'
      + '<div><h5>Supports rain</h5><ul>' + quoteList((bf.supports || {}).data, 'airport forecast') + quoteList((bf.supports || {}).discussion, 'forecaster, regional') + '</ul></div>'
      + '<div><h5>Could prevent it</h5><ul>' + quoteList((bf.prevents || {}).data, 'airport forecast') + quoteList((bf.prevents || {}).discussion, 'forecaster, regional') + '</ul></div>'
      + '<div><h5>Timing</h5><ul>' + quoteList((bf.timing || {}).aviation, 'aviation discussion') + quoteList((bf.timing || {}).discussion, 'forecaster, regional') + '</ul></div>'
      + '<div><h5>Uncertainty</h5><ul>' + quoteList(bf.uncertainty, '') + '</ul></div>'
      + '</div>'
      + '<div class="brief-src"><b>Sources</b> '
      + '<span>airport forecast: <a href="' + esc(pf.url || '#') + '" target="_blank" rel="noopener">NWS point forecast</a>, updated ' + agoTxt(pf.updated_utc || pf.generated_utc) + (pf.note ? ' (' + esc(pf.note) + ')' : '') + '</span>'
      + (taf ? '<span>airport forecast: <a href="' + esc(taf.url || '#') + '" target="_blank" rel="noopener">TAF ' + esc(bf.icao) + '</a>, issued ' + agoTxt(taf.issued_utc) + '</span>' : '<span class="stale">TAF unavailable</span>')
      + (d ? '<span>regional discussion: <a href="' + esc(d.url || '#') + '" target="_blank" rel="noopener">' + esc(d.source) + '</a>, issued ' + agoTxt(d.issued_utc) + '; ' + esc(d.caveat || '') + '</span>' : '<span class="stale">discussion unavailable</span>')
      + (bf.alerts && bf.alerts.length ? '<span>alerts: ' + bf.alerts.map(function (x) { return esc(x.headline || x.event); }).join('; ') + '</span>' : '')
      + (bf.unavailable && bf.unavailable.length ? '<span class="stale">unavailable this run: ' + esc(bf.unavailable.join('; ')) + '</span>' : '')
      + '<span>method: ' + esc((briefing && briefing.method) || '') + '</span></div>';
    return h;
  }
  function renderAnswers(s) {
    var a = $("ap-answers"), b = $("ap-brief"); if (!a || !b) return;
    var ah = answersHTML(s); if (a.dataset.html !== ah) { a.innerHTML = ah; a.dataset.html = ah; }
    var bh = briefHTML(s); if (b.dataset.html !== bh) { b.innerHTML = bh; b.dataset.html = bh; }
  }

  /* ---------------- boot ---------------- */
  function theme() { var light = localStorage.getItem("rb.theme") === "light"; document.body.classList.toggle("light", light); $("theme").textContent = light ? "dark" : "light"; }
  $("theme").onclick = function () { var light = !document.body.classList.contains("light"); localStorage.setItem("rb.theme", light ? "light" : "dark"); theme(); };
  theme();
  load().then(route);
  setInterval(load, 60000);
  setInterval(function () { if (document.visibilityState !== "hidden") renderSentinel(); }, 15000);
  // tomorrow's panel: loaded now, then every minute (the collector writes it every 20)
  loadTomorrow();
  setInterval(function () { if (document.visibilityState !== "hidden") loadTomorrow(); }, 60000);
})();
