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
  var DATA = "data/";
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
    // NOLA is HDC (Hammond), not LIX (Slidell): the NWS moved that radar and IEM's newest LIX
    // image is from 2023-11-27, so this layer drew a three-year-old picture over New Orleans.
    LAX: "VTX", LV: "ESX", MIA: "AMX", MIN: "MPX", NOLA: "HDC", NYC: "OKX", OKC: "TLX", PHIL: "DIX", PHX: "IWA", SATX: "EWX",
    SEA: "ATX", SFO: "MUX", TTN: "DIX",
    CMH: "ILN", MKE: "MKX", LEX: "LVX", CLL: "GRK", PVD: "BOX",   // the five cities of 2026-09-18 (collect_state.NEXRAD)
    PIT: "PBZ" };   // 2026-09-22 Pittsburgh (collect_state.NEXRAD)
  var MI = 0.621371;

  var state = null, settle = null, physics = null, models = null, cams = null, metars = null, nextm = null, scorecardData = null, book = null, candidates = null, camRings = null, camHealth = null, healthError = null, briefing = null;
  var sourceChecks = null, sourceChecksFailed = false, forecastArchive = null;
  var sentinel = null, sentinelFailed = false, physicsFailed = false, physicsClockUnknown = false;
  var lastLoadOk = null, lastLoadFail = null, loading = null, briefingFail = null;
  var deskAlerts = null, deskAlertsShowAll = false, deskAlertsFail = null;   // the alerts mirror (on the box and, since 2026-09-24, the public copy; null before the first load; a failed refresh keeps the last good copy)
  /* the desk read (Colin, 2026-09-23): data/desk_read.json is written by build/desk_read.py on the box and is
     never published, so on the mirror it is absent and the card says "box only". The ask goes to a private
     ntfy topic that lives only in this browser's storage (rb.asktopic), never in the page source. */
  var ASK_SERVER = "https://ntfy.sh", ASK_TOPIC_KEY = "rb.asktopic";
  var deskRead = null, deskReadPoll = null, deskReadFailed = false;
  var feedFetch = {}, selectedFeed = null, feedDetails = {};
  var apIcao = null, queueFilter = localStorage.getItem("rb.filter") || "ALL", basemap = localStorage.getItem("rb.basemap") || "sat";
  /* Colin, 2026-09-23: "I want a way to turn the pictures on and off in the actual map." One setting, kept on this device,
     applied as a class on both map boxes so the camera markers hide without a rebuild; the popups stay reachable from the
     camera strips below the map. Reading storage can throw in a private window: default to on.
     Colin, 2026-09-24: the station page map took the same setting but had no button, so "photos off" on the main map left
     his PHX page with no cameras and no way back. Both maps carry the button now; one setting drives both. */
  var camsOnMap = true;
  try { camsOnMap = localStorage.getItem("rb.mapcams") !== "off"; } catch (_) { camsOnMap = true; }
  var CAMS_TOGGLES = ["cams-toggle", "cams-toggle-ap"];
  function applyCamsToggle() {
    ["map-live", "map-airport"].forEach(function (id) { var el = $(id); if (el) el.classList.toggle("nocams", !camsOnMap); });
    CAMS_TOGGLES.forEach(function (id) { var b = $(id); if (b) { b.textContent = camsOnMap ? "photos on" : "photos off"; b.classList.toggle("on", camsOnMap); b.setAttribute("aria-pressed", camsOnMap ? "true" : "false"); } });
    ["live", "airport"].forEach(function (k) { var m = maps[k]; if (!m) return; NATCAM_LAYERS.forEach(function (id) { if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", camsOnMap ? "visible" : "none"); }); });
    if (!camsOnMap && camPopup && (camPopup.__natChooser || (camPopup.__cam && camPopup.__cam.national))) { camPopup.remove(); camPopup = null; }
    if (camsOnMap && maps.live) loadNatCams();
  }
  /* Colin, 2026-09-24 (phone), on the radar: "1-hour rain and storm total radar layers: they show where rain has actually
     added up, the closest radar gets to has the gauge hit 0.01", and "NWS warning outlines on the map". The radar picture
     is ONE choice shared by both maps and kept on this device: reflectivity (the frames and the scrubber, exactly as
     before), IEM's 1-hour rain or IEM's storm total. The warnings are one more on/off setting, like the photos. Reading
     storage can throw in a private window: default to reflectivity and warnings on. */
  var radarProd = "refl";
  try { var savedProd = localStorage.getItem("rb.radarprod"); if (/^(daa|dta|fcst|eet|vel)$/.test(savedProd || "")) radarProd = savedProd; } catch (_) { radarProd = "refl"; }
  /* Colin, 2026-09-24, from weather.com Premium: a 72 hour forecast (rain chance, rain amount, clouds, wind) and satellite
     clouds, built from free official data. Forecast is a fourth picture choice ("fcst") with its own field and its own time
     slider; the clouds are an on/off layer under the radar. Both kept on this device like the other map choices. */
  var fcField = "pop12";
  try { var savedFc = localStorage.getItem("rb.fcfield"); if (savedFc && /^(pop12|qpf|sky|wind|gust)$/.test(savedFc)) fcField = savedFc; } catch (_) { fcField = "pop12"; }
  var satOn = false;
  try { satOn = localStorage.getItem("rb.clouds") === "on"; } catch (_) { satOn = false; }
  var SAT_TOGGLES = ["clouds-toggle", "clouds-toggle-ap"];
  var warnOn = true;
  try { warnOn = localStorage.getItem("rb.warnings") !== "off"; } catch (_) { warnOn = true; }
  var WARN_TOGGLES = ["warn-toggle", "warn-toggle-ap"];
  var maps = {};
  window.rb2 = maps;   // debug handle only, used by the headless check

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pct(v) { return (v === null || v === undefined) ? "--" : Math.round(v) + "%"; }
  function cents(v) { return (v === null || v === undefined) ? "--" : Math.round(v * 100) + "c"; }
  function mi(km) { return (km === null || km === undefined) ? null : Math.round(km * MI); }
  function toast(m) { var t = $("toast"); t.textContent = m; t.classList.add("show"); setTimeout(function () { t.classList.remove("show"); }, 3500); }
  function fetchJSON(rel, ms, opt) {
    // opt.q replaces the minute key and opt.cache the no-store mode, for a file that changes once a day
    var url = DATA + rel + "?" + ((opt && opt.q) || ("t=" + Math.floor(Date.now() / 60000)));
    var status = null, previous = feedFetch[rel] || {};
    return new Promise(function (res, rej) {
      var c = new AbortController(), t = setTimeout(function () { c.abort(); rej(new Error("request timed out")); }, ms || 12000);
      fetch(url, { signal: c.signal, cache: (opt && opt.cache) || "no-store" }).then(function (r) {
        status = r.status;
        if (!r.ok) throw new Error(rel + " HTTP " + r.status);
        return r.json();
      }).then(function (x) { clearTimeout(t); res(x); }, function (e) { clearTimeout(t); rej(e); });
    }).then(function (data) {
      feedFetch[rel] = {ok:true, http:status, at:Date.now(), lastError:previous.lastError};
      return data;
    }, function (e) {
      var error = {text:e.message, http:status, at:Date.now()};
      feedFetch[rel] = {ok:false, http:status, at:error.at, error:e.message, lastError:error};
      throw e;
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
  // is a NUMBER only when the feed is present, generated inside 20 minutes, dated for the station's
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
    if (!physics) return physicsClockUnknown ? "v3 unavailable: generation time unknown" : null;
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
    if (c.eta_far_min !== null && c.eta_far_min !== undefined) { var left = Math.max(0, c.eta_far_min - (cellAge(c) || 0)); return "on a line for the gauge, " + mi(c.km) + " mi out: a straight-line guess only, not a forecast, about " + ctFromMs(Date.now() + left * 60000) + " (" + (left >= 90 ? Math.round(left / 60) + " h" : left + " min") + " away) if it held its track"; }
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
  function remainingWord(s) { var left = minutesLeft(s); return !Number.isFinite(left) ? "cutoff unknown" : left <= 0 ? "window closed" : left + " min left"; }
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

  function marketQuoteDetails(m, side) {
    m = m || {};
    if (m.status && m.status !== "active") return null;
    if (m.close_time && Date.parse(m.close_time) <= Date.now()) return null;
    var live = liveQuote(m);
    if (live) m = live;
    var age = ageMin(m.fetched_utc);
    if (age === null || age < 0 || age > (live ? 2 : 15)) return null;
    var p = m["yes_" + side], size = m["yes_" + side + "_size"];
    return typeof p === "number" && isFinite(p) && p > 0 && p < 1
      && typeof size === "number" && isFinite(size) && size > 0
      ? {price:p, fetched_utc:m.fetched_utc, updated_utc:m.updated_utc, source:live ? "live book" : "snapshot"} : null;
  }
  function marketQuote(m, side) { var q = marketQuoteDetails(m, side); return q ? q.price : null; }
  function liveQuote(m) {
    var row = book && book.markets && m && book.markets[m.ticker];
    var age = bookAge(), rowMs = row && row.book_ts_ms;
    // LIVE proves a gapless, healthy subscription. A quiet book has no delta
    // until it changes; its last update is not the age of that proof.
    if (!(book && book.feed && book.feed.status === "LIVE" && row && row.status === "LIVE" &&
          age !== null && age >= 0 && age <= 2 && typeof rowMs === "number" && isFinite(rowMs) &&
          rowMs <= Date.parse(book.written_utc) && rowMs <= Date.now())) return null;
    return {yes_bid:row.yes_bid, yes_ask:row.yes_ask, yes_bid_size:row.yes_bid_size,
      yes_ask_size:row.no_bid_size, fetched_utc:book.written_utc, updated_utc:new Date(rowMs).toISOString()};
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
    var amount = RainEvidence.gaugeInches(s, pulseFor(s));
    return typeof amount === "number" && isFinite(amount) && amount > 0 ? amount : null;
  }
  function isLocked(s) { return RainEvidence.lockedOnDay(s, pulseFor(s)); }
  function zClock(iso) { return iso ? ctClock(iso) : ""; }
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
      if (RainEvidence.observedIsStale(s)) return "today not read yet (prior contract report)";
      if (traceToday(s)) return "total unknown; trace at " + zClock(pl.time_utc);
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
  function condTxt(s, ph) {
    if (!ph) return "";
    if (!ph.evidence) return "no evidence fields in this row";
    var why = ph.evidence_why ? String(ph.evidence_why) : "";
    if (ph.evidence === "DRY_AS_OF") {
      var t = ph.conditioned_at_hour;
      return (t !== null && t !== undefined && t > 0 ? "conditioned dry (under 0.01 in) through the last dated dry reading at " + fracClock(s, t) : "conditioned dry (under 0.01 in) only from the start of the day, no dated dry reading") + (why ? ": " + why : "");
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
    var m = p && p.madis; if (!m) return "MADIS 5-minute: no report in this pull";
    var a = (m.precip_in !== null && m.precip_in !== undefined && isFinite(+m.precip_in)) ? +m.precip_in : null;
    return "MADIS 5-minute: " + (m.raining ? "rain" : "no rain reported now") + (a !== null && a > 0 ? ", " + a.toFixed(2) + " in" : (a === 0 ? ", amount unknown (unvalidated zero field)" : "")) + " (" + agoTxt(m.obs_utc) + ")";
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
    else inputs.push("radar scan time unknown" + (r.read_utc ? "; ring read " + agoTxt(r.read_utc) : ""));
    if (oa === null) inputs.push("gauge report time unknown");
    var stale = (oa === null || oa < 0 || oa > 90) || (ra === null || ra < 0 || ra > 20);
    if (rainingNow(s) && !(oa === null || oa < 0 || oa > 90)) return { k: "WET_NOW", overdue: !!s.overdue, inputs: inputs };
    if (stale) return { k: "UNKNOWN", overdue: !!s.overdue, inputs: inputs };
    // codex r2 on #190: rings refused (palette unreadable, no tiles) are not a quiet sky. Twin of board_alerts.
    if (r.pct10 === null || r.pct10 === undefined || r.error) return { k: "UNKNOWN", overdue: !!s.overdue, inputs: inputs.concat(["radar unusable: " + (r.error || "no ring data")]) };
    var p10 = +r.pct10 || 0, p30 = +r.pct30 || 0;
    // codex r5 on #190: a settle.json written before the rain-grade rings carries any-echo percentages and no
    // rain_grade_dbz marker; those keep their old name until the collector writes the new measurement
    var graded = r.rain_grade_dbz !== null && r.rain_grade_dbz !== undefined;
    if (p10 > 0) inputs.push(pct(p10) + (graded ? " of the 6 mi ring has rain-grade echo (20 dBZ and up" + (r.max_dbz10 !== null && r.max_dbz10 !== undefined ? ", max " + r.max_dbz10 + " dBZ in the ring" : "") + ")" : " of the 6 mi ring has echo"));
    if (ib.length) inputs.push(ib[0].dbz + " dBZ cell ETA " + Math.round(ib[0].eta_min) + " m");
    // 2026-09-22, Atlanta: a cell 92 km away on a straight line four hours out counted as "a cell behind
    // it", and with 99% any-echo (clear-air under 20 dBZ) the card said WET IMMINENT under FEW035 and no
    // rain. Backed means a cell within 30 km or on a computed ETA, or heavy echo in the 19 mi ring.
    // Twin of board_alerts.wet_state; change both.
    // codex r1 on #190: a 30 dBZ sheet over the gauge (the legend's LIKELY band) backs it with no tracked cell
    // codex r3 on #190: the LIKELY band anywhere in the 19 mi ring backs it (a 38 dBZ band at 10 to 30 km), and
    // only a cell whose own scan is 20 minutes old or fresher can back it. Twin of board_alerts; change both.
    var likely = r.max_dbz30 !== null && r.max_dbz30 !== undefined && +r.max_dbz30 >= 30;
    var backed = cells(s).some(function (c) { var a = cellAge(c); return a !== null && a >= 0 && a <= 20 && ((c.km !== null && c.km !== undefined && +c.km <= 60) || (c.eta_min !== null && c.eta_min !== undefined)); }) || likely || (+r.pct30_strong || 0) > 0;
    // codex r4 on #190: a compact 38 dBZ shower centred on the gauge is 3.8% of the ring; the LIKELY band over the
    // gauge with any rain-grade coverage is imminent by itself, no 5% gate. jules r1: "near" is the 37 mi ring.
    var core = p10 > 0 && r.max_dbz10 !== null && r.max_dbz10 !== undefined && +r.max_dbz10 >= 30;
    if ((p10 >= 5 && backed) || (ib.length && ib[0].eta_min <= 20) || core) return { k: "WET_IMMINENT", overdue: !!s.overdue, inputs: inputs };
    if (ib.length && ib[0].eta_min <= 60) return { k: "APPROACHING", overdue: !!s.overdue, inputs: inputs };
    if (p10 > 0 || p30 >= 5 || wn.length) { if (wn.length) inputs.push(wn.length + " wet airport(s) nearby"); if (p30 >= 5) inputs.push(pct(p30) + " of the 19 mi ring has echo"); return { k: "RAIN_NEARBY", overdue: !!s.overdue, inputs: inputs }; }
    if (s.overdue) return { k: "OVERDUE", overdue: true, inputs: inputs.concat(["window passed dry"]) };
    return { k: "QUIET", overdue: false, inputs: inputs };
  }
  function stateChip(w) {
    /* jules, phase 1 review: a phone cannot hover, so the inputs behind a state must be reachable
       by tap. The chip carries them in a data attribute and a tap toggles them inline. */
    var d = STATES[w.k], why = d.why + (w.inputs.length ? ": " + w.inputs.join(", ") : "");
    return '<span class="st ' + w.k + '" role="button" tabindex="0" aria-expanded="false" data-why="' + esc(why) + '" title="' + esc(why) + '"><i>' + d.icon + '</i>' + (w.k === "LOCKED" ? "YES EXPECTED" : d.text) + (w.overdue && w.k !== "OVERDUE" ? " +OVERDUE" : "") + (w.k === "LOCKED" ? '' : ' <i class="q">why</i>') + '</span>';
  }
  document.addEventListener("click", function (ev) {
    var chip = ev.target.closest && ev.target.closest(".st[data-why]"); if (!chip) return;
    ev.stopPropagation(); ev.preventDefault();
    var nx = chip.nextElementSibling;
    if (nx && nx.classList.contains("why")) { nx.remove(); chip.setAttribute('aria-expanded', 'false'); return; }
    var el = document.createElement("div"); el.className = "why"; el.textContent = chip.dataset.why; chip.insertAdjacentElement("afterend", el);
    chip.setAttribute('aria-expanded', 'true');
  }, true);
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('.st[data-why]')) {
      ev.preventDefault(); ev.target.click();
    }
  });
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
    if (w.k === "LOCKED") return "YES expected: gauge " + gaugeAmt(s) + "; official result pending";
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
    var val = fresh ? (candidates.candidates || []).filter(candUsable) : null;
    function list(a) { return a.length ? esc(a.join(', ')) : 'none'; }
    // layout A (2026-09-25): this card opens the call band (the glance, the v3 value rows, the alerts), so its title is the band's
    return '<b class="call-head" role="heading" aria-level="2">The call</b>'
      + '<span class="g"><b>Already rained, YES expected:</b> ' + list(rained) + '</span>'
      + '<span class="g"><b>Raining now at an open gauge:</b> ' + list(wet) + '</span>'
      + '<span class="g"><b>Value if v3 is right:</b> ' + (val === null ? '<b class="stale">prices not fresh</b>' : !val.length ? 'none' : 'first of ' + val.length + ': ' + esc(val[0].city) + ' ' + esc(val[0].side) + ' at ' + cents(val[0][val[0].side].executable.avg) + ' (' + (val.length - 1) + ' others below)') + '</span>';
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
      + '<p class="sen-note">All times CT. Each city shows its own contract window. <b>Peak</b> is the largest NWS hourly chance, not the chance of rain on the day. The wet span covers hours at 30% or more.</p>';
    out += '<table class="sc tm-table"><thead><tr><th>City / CT</th><th>NWS forecast</th><th>YES bid / ask</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var n = r.nws || {}, m = r.market || {};
      var hrs = n.hours || [], last = hrs.length ? hrs[hrs.length - 1][0] : null;
      var nerr = n.error && /Error|<|\(/.test(n.error) ? 'forecast unavailable, retrying' : (n.error || 'no forecast');
      var peak = (n.peak_pop === null || n.peak_pop === undefined) ? '<small>' + esc(nerr) + '</small>'
        : n.peak_pop + '% at ' + (n.peak_utc ? ctClock(n.peak_utc) : 'CT time unavailable') + (n.missing_pop_hours ? '<br><small>some hours unknown</small>' : '');
      var wet = n.wet_from_utc ? ctClock(n.wet_from_utc) + ' to ' + ctClock(n.wet_to_utc) : n.wet_from ? 'CT time unavailable' : n.error || n.missing_pop_hours ? 'unknown' : 'none forecast';
      var amt = (n.qpf_in === null || n.qpf_in === undefined) ? '-' : Number(n.qpf_in).toFixed(2) + ' in';
      var price = notTrading(m) ? '<small>' + esc(opensNote(m)) + '</small>'
        : (m.yes_bid === null || m.yes_bid === undefined) && (m.yes_ask === null || m.yes_ask === undefined)
        ? '<small>' + esc(quoteNote(m)) + '</small>' : c(m.yes_bid) + ' / ' + c(m.yes_ask) + 'c';
      // Tomorrow quotes are informational snapshots from a 20-minute producer.
      // Their explicit age does not relax today's executable quote gates.
      if (age === null || age < 0 || age > 40) price = '<small class="stale">quote stale or undated</small>';
      else price += '<br><small>snapshot ' + age + ' min old</small>';
      var window = r.window_utc || [];
      out += '<tr><td><b>' + esc(r.city) + '</b>' + (r.on_board === false ? ' <span class="tm-new">NEW</span>' : '') + '<br><small>' + (window.length === 2 ? ctClock(window[0]) + ' to ' + ctClock(window[1]) : 'window unavailable') + '</small></td><td>Peak ' + peak + '<br><small>Wet span: ' + wet + '<br>Amount: ' + amt + '</small></td><td>' + price + '</td></tr>';
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
  function sentinelStations() { return stations().map(function (s) { return { icao: s.icao, city: s.city, local_day: contractDay(s), settled: isLocked(s) }; }); }
  function renderSentinel() {
    renderChecks();
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
  var CITY_NAMES = { CMH: "Columbus", MKE: "Milwaukee", LEX: "Lexington", CLL: "College Station", PVD: "Providence", PIT: "Pittsburgh" };
  function nameStations(st) {
    ((st && st.stations) || []).forEach(function (s) {
      if ((!s.name || s.name === s.city) && CITY_NAMES[s.city]) s.name = CITY_NAMES[s.city];
    });
    return st;
  }
  function checkLines(icao) {
    var age = sourceChecks && ageMin(sourceChecks.checked_utc);
    var fresh = !sourceChecksFailed && age !== null && age >= 0 && age <= 15;
    var rows = sourceChecks && sourceChecks.stations || {}, checks = [];
    Object.keys(rows).forEach(function (key) {
      if (icao && key !== icao) return;
      (rows[key].discrepancies || []).forEach(function (d) {
        var detail = String(d.detail || '').replace(/board headline/g, 'collector forecast').replace(/Board gauge line reads 0.00./g, 'Collector amount is unverified.');
        checks.push('<li><b>' + esc((byIcao(key) || {}).city || key) + ' ' + esc(d.check) + ':</b> ' + esc(detail) + '</li>');
      });
    });
    return '<p><b>Source checks: ' + (fresh ? checks.length + ' disagreement(s)' : 'unavailable or stale') + '</b>'
      + (sourceChecks ? ', checked ' + ctClock(sourceChecks.checked_utc) + ' (' + agoTxt(sourceChecks.checked_utc) + ')' : '') + '.</p>'
      + (fresh ? checks.length ? '<p>Independent source comparisons, not official settlement or a forecast score.</p><ul>' + checks.join('') + '</ul>' : '<p>No disagreement reported in this check.</p>' : '<p>No current conclusion can be drawn from this check.</p>');
  }
  function renderChecks() {
    var el = $('desk-checks');
    if (el) {
      var c = forecastArchive && forecastArchive.counters;
      el.innerHTML = checkLines() + (c ? '<p>Forecast archive: <b>' + esc(c.recorded) + ' snapshots saved</b> of ' + esc(c.attempted) + ' attempted; ' + esc(c.wrong_day || 0) + ' rejected for a different day. Built ' + ctClock(forecastArchive.generated_utc) + ' (' + agoTxt(forecastArchive.generated_utc) + ').</p>' : '<p>Forecast archive status unavailable.</p>');
    }
    var station = $('ap-checks'); if (station && apIcao) station.innerHTML = checkLines(apIcao);
  }
  function loadChecks() {
    fetchJSON('truth.json').then(function (d) { sourceChecks = d; sourceChecksFailed = false; renderChecks(); },
      function () { sourceChecksFailed = true; renderChecks(); });
  }
  function loadData() {
    return Promise.all([
      fetchJSON("state.json").catch(function () { return null; }), fetchJSON("settle.json").catch(function () { return null; }),
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
      fetchJSON("storm_context.json").catch(function () { return null; }),
      fetchJSON("desk_alerts.json").catch(function () { return null; }),    // the alerts mirror: published since 2026-09-24 (Colin's order), absent reads "not written yet"
      fetchJSON("desk_read.json").catch(function () { return null; })   // box only: absent on the mirror, the card says so
    ]).then(function (r) {
      // the alerts mirror is judged on its own, before the collector check below can throw: it is the
      // card that says whether the alarms are alive, so it must render when state.json does not.
      // A failed fetch keeps the last good copy (its ages keep growing and the chips re-judge).
      if (r[18]) { deskAlerts = r[18]; deskAlertsFail = null; } else if (deskAlerts) { deskAlertsFail = Date.now(); }
      renderAlerts();
      // the desk read card stands on its own file, whatever the collector did. Only a 404 (absent: the mirror, the
      // public link, or no read yet) clears it; any other failed fetch keeps the last good read on screen, marked.
      if (r[19]) { deskRead = r[19]; deskReadFailed = false; }
      else if ((feedFetch["desk_read.json"] || {}).http === 404) { deskRead = null; deskReadFailed = false; }
      else deskReadFailed = true;
      renderDeskRead();
      // Wait for all requests before diagnosing a failed batch. Successful requests do
      // not make retained, unaccepted data fresh when the collector load failed.
      if (!r[0] || !Array.isArray(r[0].stations)) throw new Error((feedFetch['state.json'] || {}).error || 'collector response has no station list');
      var accepted = typeof RainSentinelUI === "undefined" ? sentinel : RainSentinelUI.accept(sentinel, r[12]);
      sentinelFailed = !r[12] || accepted !== r[12]; sentinel = accepted;
      var newerPhysics = typeof RainExpansionUI === "undefined" ? r[2] : RainExpansionUI.legacy(physics,r[2]);
      physicsFailed = !r[2] || newerPhysics !== r[2];
      physicsClockUnknown = !!r[2] && !Number.isFinite(Date.parse(r[2].generated_utc));
      if(typeof RainExpansionUI !== "undefined") RainExpansionUI.update(r.slice(13, 18));   // the five history feeds (13 to 17, as on main), never the desk files at 18 and 19
      forecastArchive = r[14];
      state = nameStations(r[0]); settle = r[1]; physics = newerPhysics; models = r[3]; if (r[4]) camRings = r[4]; ringsError = r[4] ? null : Date.now(); metars = r[5]; nextm = r[6]; scorecardData = r[7]; book = r[8]; candidates = r[9]; if (r[10]) camHealth = r[10]; healthError = r[10] ? null : Date.now(); if (r[11]) { briefing = r[11]; briefingFail = null; } else if (briefing) { briefingFail = Date.now(); } lastLoadOk = Date.now(); lastLoadFail = null; render(); })
      .catch(function (e) {
        // the last valid output stays on screen, marked: a failed refresh is a fact, not a blank page
        lastLoadFail = { at: Date.now(), why: e.message };
        freshness(); renderSentinel(); renderAlerts();
      });
  }
  // a load that is already running is not started again (a returning tab and the minute tick can coincide)
  function load() { if (loading) return loading; loading = loadData().then(function () { loading = null; }, function () { loading = null; }); return loading; }
  // WO-149: a backgrounded phone tab keeps a throttled minute tick at best. Coming back to the tab,
  // the page, or the window refetches at once when the last successful load is older than 20 s.
  function wake() { if (document.visibilityState === "hidden") return; freshness(); renderSentinel(); if (lastLoadOk === null || Date.now() - lastLoadOk > 20000) load(); }
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
  function bookFeedTxt() { if (!book) return '<b class="stale">not running</b> (3-minute collector quotes only)'; var a = bookAge(), st = (book.feed || {}).status; return (st === "LIVE" && a !== null && a >= 0 && a <= 2 ? 'LIVE' : '<b class="stale">' + esc(st === 'LIVE' ? 'STALE' : st || 'unknown') + '</b>') + ', written ' + agoTxt(book.written_utc) + (book.feed && book.feed.reconnects ? ', ' + book.feed.reconnects + ' reconnects' : ''); }
  /* The header's LIVE is scoped to the three feeds the page reads live (Colin, 2026-09-16: "LIVE 8m"
     was the collector's age alone while the pulse or the model could be an hour old). Each has its own
     window: the collector runs every 3 minutes, the 1-minute pulse writes metars.json every minute, the
     v3 model runs every 15 minutes. LIVE only when all three are inside; otherwise the old one is named. */
  var LIVE_WINDOWS = { collector: 10, pulse: 5, model: 20 };
  function feedAges() {
    return [["collector", ageMin(state && state.generated_utc), LIVE_WINDOWS.collector],
            ["pulse", ageMin(metars && metars.generated_utc), LIVE_WINDOWS.pulse],
            ["model v3", physAge(), LIVE_WINDOWS.model]];
  }
  function feedHealth(id, label, file, stamp, windowMin, options) {
    options = options || {};
    var request = feedFetch[file] || {}, time = Date.parse(stamp), age = Number.isFinite(time) ? (Date.now() - time) / 60000 : null;
    if (age !== null && age < 0 && age >= -(options.futureTolerance || 0)) age = 0;
    var retained = !!lastLoadFail, reason = options.reason || '', tone = 'good';
    var validAge = age !== null && age >= 0 && age <= windowMin;
    if (request.ok === false || options.error) tone = 'bad';
    else if (retained || options.fallback || !validAge) tone = 'aged';
    // A policy-off feed is neutral only when its current status actually loaded.
    else if (options.off) tone = 'off';
    if (request.ok === false) reason = request.error;
    else if (retained) reason = 'STALE: collector refresh failed; showing the previous accepted data';
    else if (!validAge && !reason) reason = age === null ? 'source time unavailable' : age < 0 ? 'source time is in the future' : 'source is past its freshness window';
    var word = tone === 'good' ? (age < 1 ? 'now' : Math.floor(age) + 'm') : tone === 'off' ? 'off' : tone === 'bad' ? 'error' : 'STALE';
    var detail = label + ': ' + (reason || 'inside its freshness window') + '. Displayed source age: '
      + (age === null ? 'unknown' : age < 0 ? 'future timestamp' : Math.floor(age) + ' min')
      + (stamp && Number.isFinite(time) ? ' (' + ctClock(stamp) + ')' : '') + '; window ' + windowMin + ' min.'
      + ' Board file HTTP: ' + (request.http === null || request.http === undefined ? 'unavailable' : request.http)
      + (request.at ? ', checked ' + ctFromMs(request.at) : '') + '.';
    if (options.sourceDetail) detail += ' Producer: ' + options.sourceDetail + '.';
    if (request.lastError) detail += ' Last browser error: ' + request.lastError.text + ' at ' + ctFromMs(request.lastError.at) + '.';
    return {id:id, label:label, tone:tone, word:word, detail:detail};
  }
  function showFeedDetail() {
    var el = $('feed-detail'), row = feedDetails[selectedFeed];
    if (!el) return;
    el.classList.toggle('hidden', !row);
    el.textContent = row ? row.detail : '';
    document.querySelectorAll('#fresh button').forEach(function (button) { button.setAttribute('aria-expanded', String(button.dataset.feed === selectedFeed)); });
  }
  function collectorIssues(s) {
    var parts=[];
    if(s.status!=='ok')parts.push(s.status || 'status unavailable');
    if(s.last_error)parts.push(String(s.last_error));
    ['forecast','market','radar'].forEach(function(name){if(s[name] && s[name].error)parts.push(name+': '+String(s[name].error));});
    if(s.radar_down)parts.push('radar_down: '+(s.radar_down.reason || s.radar_down.error || 'radar unavailable'));
    if(s.metar_day && s.metar_day.carried)parts.push('METAR day carried from the previous fetch');
    return parts.join('; ');
  }
  function collectorDetail(issues, http) {
    // codex on #196 (read-only seat, 50e3179): the tone is decided over every station, so the detail leads with
    // the rows that made it red and says how many rows it left out; a 503 is never hidden behind three fallback notes.
    var ordered=http.concat(issues.filter(function(s){return http.indexOf(s)<0;}));
    var shown=ordered.slice(0,3).map(function(s){return s.icao+': '+s.why;});
    if(ordered.length>3)shown.push((ordered.length-3)+' more gauge'+(ordered.length-3===1?'':'s')+' with issues not listed here');
    return shown.join('; ');
  }
  function pulseHasObservation(row) {
    if(!row || typeof row!=='object' || Array.isArray(row))return false;
    // A fresh file or retained daily lock does not make an old observation current.
    // The station's existing 90-minute window permits routine hourly reports.
    return [row.time_utc,row.nws && row.nws.time_utc,row.madis && row.madis.obs_utc].some(function(stamp){
      if(typeof stamp!=='string' || !/T.*(?:Z|[+-]\d\d:?\d\d)$/i.test(stamp))return false;
      var time=Date.parse(stamp),age=(Date.now()-time)/60000;
      return Number.isFinite(time) && age>=0 && age<=90;
    });
  }
  function freshness() {
    var syn = settle && settle.feeds && settle.feeds.synoptic || {}, disabled = String(syn.disabled || '');
    var synHttp=disabled.match(/\bHTTP\s+(\d{3})\b/i);
    var policyOff = !!disabled && !/synoptic fail/i.test(disabled) && (synHttp ? +synHttp[1]===403 : /account does not|no stations found|no token|off by policy|disabled by policy|^synoptic off\s*$/i.test(disabled)), bf = book && book.feed || {};
    var socketError = !!book && (!!bf.status && ['LIVE','NO_TICKERS'].indexOf(bf.status) < 0 || /^server error/i.test(bf.detail || ''));
    var ba=bookAge(), partialBook=ba!==null && ba>=0 && ba<=2 ? stations().filter(function(s){
      return s.market && s.market.ticker && (!s.market.status || s.market.status==='active') && !liveQuote(s.market);
    }).length : 0;
    var missingModels = stations().filter(function (s) { return !!physStatus(s); }).length;
    var roster=stations(), retainedStations=roster.map(function(s){return {icao:s.icao,why:collectorIssues(s)};}).filter(function(s){return !!s.why;});
    var collectorHttp=retainedStations.filter(function(s){return /HTTP(?:Error)?\s+[45]\d\d/i.test(s.why);});
    var pulseMissing=roster.filter(function(s){return !pulseHasObservation(pulseFor(s));}).length;
    var rows = [
      feedHealth('collector','Collector','state.json',state && state.generated_utc,10,{fallback:!!lastLoadFail || !roster.length || retainedStations.length>0,
        error:collectorHttp.length>0,reason:!roster.length?'no gauges in the collector feed':retainedStations.length?retainedStations.length+' of '+roster.length+' gauges have stale or retained collector data':'',
        sourceDetail:collectorDetail(retainedStations,collectorHttp)}),
      feedHealth('pulse','Pulse','metars.json',metars && metars.generated_utc,5,{fallback:!metars || !metars.stations || !roster.length || pulseMissing>0,
        reason:!roster.length?'gauge coverage unavailable':pulseMissing?pulseMissing+' of '+roster.length+' gauges lack a pulse observation within 90 min; collector readings are the fallback':'',
        sourceDetail:(roster.length-pulseMissing)+' of '+roster.length+' gauges have observations within 90 min'}),
      feedHealth('model','v3','physics_v3.json',physics && physics.generated_utc,20,{futureTolerance:FUTURE_TOLERANCE_MIN,
        fallback:physicsFailed || !physics || !physics.model_id || !physics.stations || missingModels > 0,
        reason:physicsFailed ? 'refresh failed or older, undated or invalid model refused' : (!physics || !physics.model_id || !physics.stations ? 'model feed unavailable or invalid' : missingModels ? missingModels + ' station forecasts unavailable' : '')}),
      feedHealth('book','Book','book.json',book && book.written_utc,2,{error:socketError, fallback:bf.status !== 'LIVE' || partialBook>0,
        reason:socketError ? 'book socket or producer error; collector quotes are the fallback' : bf.status !== 'LIVE' ? 'book unavailable; collector quotes are the fallback' : partialBook ? partialBook+' board markets lack a usable live book; collector quotes are the fallback' : '', sourceDetail:bf.detail}),
      feedHealth('synoptic','Synoptic','settle.json',syn.heartbeat_utc,10,{off:policyOff,error:!!disabled && !policyOff,
        fallback:!Object.keys(syn).length || syn.stale,reason:policyOff ? 'off by policy/account setting' : disabled,
        sourceDetail:disabled})
    ];
    var el = $('fresh');
    if (!el.querySelector('button')) el.innerHTML = rows.map(function (r) {
      return '<button type="button" data-feed="' + r.id + '" aria-controls="feed-detail" aria-expanded="false"><span class="feed-name"></span><span class="feed-short" aria-hidden="true"></span><span class="feed-age"></span></button>';
    }).join('');
    rows.forEach(function (r) {
      feedDetails[r.id] = r;
      var button = el.querySelector('[data-feed="' + r.id + '"]');
      button.className = 'feed-pill feed-' + r.tone;
      button.querySelector('.feed-name').textContent = r.label;
      button.querySelector('.feed-short').textContent = r.id === 'collector' ? 'Data' : r.id === 'synoptic' ? 'Syn' : r.label;
      button.querySelector('.feed-age').textContent = r.word;
      button.title = r.detail;
      button.setAttribute('aria-label', r.label + ' ' + r.word + '. Tap for feed details');
    });
    showFeedDetail(); staleBanner();
  }
  $('fresh').onclick = function (ev) {
    var button = ev.target.closest('[data-feed]');
    if (button) { selectedFeed = selectedFeed === button.dataset.feed ? null : button.dataset.feed; showFeedDetail(); }
  };
  document.addEventListener('click', function (ev) {
    if (!$('fresh').contains(ev.target) && !$('feed-detail').contains(ev.target)) { selectedFeed = null; showFeedDetail(); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { selectedFeed = null; showFeedDetail(); } });
  /* the banner under the header: shown only when something the reader should know is wrong with the
     data on screen, and it names the check, the time and the age. Never a bare "stale". */
  function staleBanner() {
    var el = $("stale-banner"); if (!el) return;
    var a = ageMin(state && state.generated_utc), parts = [];
    if (lastLoadFail) parts.push("the last refresh failed at " + ctFromMs(lastLoadFail.at) + " (" + esc(lastLoadFail.why) + "); showing the data from " + (state ? agoTxt(state.generated_utc) : "no earlier load"));
    if (a !== null && (a < 0 || a > 10)) parts.push("the collector's state.json is " + a + " min old (it runs every 3 minutes)");
    var ma = metars ? ageMin(metars.generated_utc) : null, p3 = physAge(), br = briefing ? ageMin(briefing.generated_utc) : null;
    if (!metars) parts.push("the 1-minute pulse file (metars.json) did not load");
    else if (ma === null || ma < 0 || ma > LIVE_WINDOWS.pulse) parts.push("the 1-minute pulse file is " + (ma === null ? "undated" : ma + " min old") + " (it writes every minute)");
    if (!physics) parts.push("the v3 model feed (physics_v3.json) did not load; every card says v3 unavailable");
    else if (p3 === null || p3 < 0 || p3 > LIVE_WINDOWS.model) parts.push("v3 was generated " + (p3 === null ? "at an unknown time" : physAgoTxt()) + " (it runs every 15 minutes)");
    if (physicsFailed) parts.push('v3 refresh failed or an older/undated model was refused');
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
  function openAirport() { document.dispatchEvent(new Event('board:station-open')); $("airport").classList.remove("hidden"); document.body.style.overflow = "hidden"; renderAirport(); setTimeout(function () { if (maps.airport) maps.airport.resize(); }, 60); }
  function closeAirport(setHash) { var rd = $("ap-rings"); if (rd) rd.open = false; $("airport").classList.add("hidden"); document.body.style.overflow = ""; closeSheet(); if (setHash !== false && location.hash) history.replaceState(null, "", location.pathname + location.search); renderMarkers(); renderQueue(); }
  $("ap-close").onclick = function () { closeAirport(true); };

  /* ---------------- render ---------------- */
  /* the alerts mirror (Colin, 2026-09-23: "a mirrored canary alert thing on my board"). A strip of health
     chips (green ok, amber unknown, red bad, every chip carries its name and age as text), then a folded
     block: the newest pages that reached the phone, a "more" button for the rest, the suppressed and
     failed counts, and every health line in plain words. The details element lives in index.html and only
     its parts are replaced, so an open block stays open across the minute reload. Times are Central. */
  /* On the GitHub Pages copy (public since Colin's order of 2026-09-24) the file arrives 2 to 4 min after the
     box wrote it: the publisher copies it once a minute, the push takes seconds and Pages goes live about a
     minute later (measured 2026-09-24). Chip bounds of 45 s to 3 min would read red there while the bots are
     alive, so on the mirror each chip keeps the box's own verdict at generated_utc and only the mirror chip
     ages, against a looser 8 min bound; past that bound every chip is re-judged as on the box. */
  var MIRROR_STALE_S = ON_MIRROR ? 480 : 300;
  function alAge(s) {
    if (s === null || s === undefined || !isFinite(s)) return "";
    if (s < 0) return "clock?";
    if (s < 120) return Math.round(s) + " s";
    if (s < 5400) return Math.round(s / 60) + " min";
    return (Math.round(s / 360) / 10) + " h";
  }
  function alChip(h, elapsed, boxVerdict) {
    var hasAge = h.age_s !== null && h.age_s !== undefined && isFinite(h.age_s);
    // a chip judged fresh when the mirror was written goes red once its age, grown since, passes the
    // bound it was judged by (a frozen mirror must not show a dead lock bot as green for minutes).
    // boxVerdict (the Pages copy, inside its delivery bound): the box's own ok stands, the age still grows.
    var stale = !boxVerdict && h.ok === true && hasAge && isFinite(h.alive_s) && h.alive_s !== null && h.age_s + elapsed > h.alive_s;
    var cls = stale ? "al-bad" : h.ok === true ? "al-ok" : h.ok === false ? "al-bad" : "al-unk";
    var age = hasAge ? alAge(h.age_s + elapsed) : "";
    var word = stale ? " stale" : h.ok === true ? "" : h.ok === false ? " bad" : " ?";
    return '<span class="al-chip ' + cls + '" title="' + esc(h.detail) + '"><span class="al-name">' + esc(h.name) + '</span>' + (age ? ' <b>' + esc(age) + '</b>' : '') + esc(word) + '</span>';
  }
  // a page's time with its day when it is not today in Central: "yesterday 9:30 PM CT", "Sep 21, 9:30 PM CT"
  function ctDay(ms) { return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }); }
  function alWhen(iso) {
    var t = Date.parse(String(iso || "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
    if (isNaN(t)) return ctClock(iso);
    var now = Date.now(), d = ctDay(t);
    if (d === ctDay(now)) return ctClock(iso);
    if (d === ctDay(now - 86400000)) return "yesterday " + ctClock(iso);
    return new Date(t).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }) + ", " + ctClock(iso);
  }
  function renderAlerts() {
    var strip = $("alerts-health"), sum = $("alerts-sum"), body = $("alerts-body");
    if (!strip || !sum || !body) return;
    var d = deskAlerts, sh, bh, hh;
    if (!d || !Array.isArray(d.pages) || !Array.isArray(d.health)) {
      hh = "";
      sh = '<b>Alerts mirror not written yet, or this copy could not load it.</b>';   // Expand / Collapse is the summary's own ::after (style.css)
      bh = '<p class="al-counts">Alerts mirror not written yet, or this copy could not load it.</p>';
    } else {
      var gen = Date.parse(String(d.generated_utc || "")), elapsed = isNaN(gen) ? 0 : Math.max(0, (Date.now() - gen) / 1000);
      var mirrorStale = isNaN(gen) || elapsed > MIRROR_STALE_S;
      hh = (mirrorStale ? alChip({ name: "mirror", ok: false, age_s: isNaN(gen) ? null : 0, detail: "the mirror itself has not been rewritten; every age below has grown since" }, elapsed) : "")
        + d.health.map(function (h) { return alChip(h, elapsed, ON_MIRROR && !mirrorStale); }).join("");
      var pages = d.pages, c = d.counts_24h || {}, first = pages[0];
      sh = '<b>' + esc(c.sent === undefined ? pages.length : c.sent) + ' page' + ((c.sent === undefined ? pages.length : c.sent) === 1 ? '' : 's') + ' in 24 h'
        + (first ? ', last ' + esc(alWhen(first.ts_ct)) : ', none yet') + '</b>';
      var shown = 12, rest = Math.max(0, pages.length - shown);
      bh = (deskAlertsFail ? '<p class="al-counts al-fail">Refresh failed at ' + esc(ctFromMs(deskAlertsFail)) + '; this is the last good copy, and its ages keep growing.</p>' : '')
        + '<ul class="al-list' + (deskAlertsShowAll ? ' al-all' : '') + '">' + pages.map(function (p, i) {
        return '<li' + (i >= shown ? ' class="al-hid"' : '') + '><span class="al-t">' + esc(alWhen(p.ts_ct)) + '</span><span class="al-title">' + esc(p.title) + '</span>'
          + '<span class="al-src">' + esc(p.source) + (p.kind ? ' · ' + esc(p.kind) : '') + (p.station ? ' · ' + esc(p.station) : '') + '</span></li>';
      }).join('') + '</ul>'
        + (pages.length === 0 ? '<p class="al-counts">No page has been sent in the days this mirror reads.</p>' : '')
        + (rest > 0 ? '<button type="button" class="al-more" id="alerts-more">' + (deskAlertsShowAll ? 'show the newest 12 only' : 'more: ' + rest + ' older') + '</button>' : '')
        + '<p class="al-counts">Last 24 h: ' + esc(c.sent || 0) + ' sent, ' + esc(c.suppressed_duplicate || 0) + ' suppressed as duplicates, ' + esc(c.failed || 0) + ' failed. Mirror written ' + esc(ctClock(d.generated_utc)) + '.</p>'
        + '<ul class="al-hlist">' + d.health.map(function (h) {
          return '<li><b>' + esc(h.name) + '</b> (' + esc(h.bot_or_feed) + '): ' + esc(h.detail) + '</li>';
        }).join('') + '</ul>';
    }
    if (strip.__h !== hh) { strip.innerHTML = hh; strip.__h = hh; }
    if (sum.__h !== sh) { sum.innerHTML = sh; sum.__h = sh; }
    if (body.__h !== bh) {
      body.innerHTML = bh; body.__h = bh;
      var more = $("alerts-more"); if (more) more.addEventListener("click", function () { deskAlertsShowAll = !deskAlertsShowAll; body.__h = null; renderAlerts(); });
    }
  }
  function render() {
    renderAlerts();   // before the state guard: the alarm-health card must show when the collector is down
    if (!state) return;
    freshness();
    // the header counts the roster the collector actually reports (it said "22" after the five were added)
    var brand = document.querySelector("#top .brand span");
    if (brand && stations().length) brand.textContent = stations().length + " settlement gauges";
    var sheet = $("sheet");
    if (sheet && sheet.__cam) {
      if (!(ringAvailable(sheet.__cam)) || sheet.__catalog !== (camRings && camRings.updated_utc)) closeSheet();
      else { var caption = sheet.querySelector("small"); if (caption) caption.textContent = mi(sheet.__cam.dist_km) + " mi " + (sheet.__cam.dir || "") + " of the gauge; " + ringFreshTxt(sheet.__cam); }
    }
    if (camPopup && camPopup.__cam && !camPopup.__cam.national && camRings) {   // a national camera is in no gauge's list: nothing to follow
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
    if (liveSel && byIcao(liveSel) && (mapCardClosed || !$("mapcard").classList.contains("hidden"))) {
      /* a card hidden with its X still has its city on the map: the overlays refresh, the card stays shut */
      var ls = byIcao(liveSel); if (!mapCardClosed) { $("mapcard").innerHTML = mapCardHTML(ls); bindMapCard(ls); }
      if (maps.live && maps.live.getSource("ring6")) { clearLiveOverlay(false); drawOverlays(maps.live, ls, liveOverlay); }   // codex: ETAs and ages baked into the labels went stale
    }
    var mp = valuePanel() + '<details class="forecast-details"><summary>All v3 forecasts and market differences</summary>' + modelPanel() + '</details>';
    if ($("model").dataset.html !== mp) {
      var folds = {"grp candidate-details": window.matchMedia("(min-width: 769px)").matches};
      $("model").querySelectorAll("details").forEach(function (e) { folds[e.className] = e.open; });
      $("model").innerHTML = mp; $("model").dataset.html = mp;
      $("model").querySelectorAll("details").forEach(function (e) { e.open = !!folds[e.className]; });
      bindRows($("model"));
    }
    ensureLiveMap(); renderMarkers();
    renderQueue();
    renderScorecard();
    if (!$("airport").classList.contains("hidden")) refreshAirport();
  }
  function bindRows(root) { root.querySelectorAll("[data-icao]").forEach(function (el) { el.onclick = function (ev) { ev.stopPropagation(); go(el.dataset.icao); }; }); }

  /* the desk read card: the last read as escaped text with its line breaks kept, or "box only" when the file
     is absent. Nothing here rates a position; the answer is the desk's words and the page shows them as they are. */
  function renderDeskRead() {
    var el = $("deskread-body"); if (!el) return;
    var d = deskRead, html;
    if (!d || !d.answered_utc) {
      html = deskReadFailed
        ? '<p class="stale">Could not load the desk read this minute. It tries again on the next refresh.</p>'
        : '<p class="note">Box only: the read goes to your phone and shows here only on the private box view, never on the public mirror or the public link. No read on this copy yet.</p>';
    } else {
      html = '<div class="dr-head"><b>' + esc("Desk read " + ctClock(d.answered_utc) + " (" + agoTxt(d.answered_utc) + ")") + '</b><small>' + esc(d.model || "model unknown") + '</small></div>';
      html += '<p class="note">Question: ' + esc(d.request_text || "read") + '</p>';
      if (d.error) html += '<p class="stale">Read failed: ' + esc(d.error) + '</p>';
      else html += '<pre class="dr-answer">' + esc(d.answer || "") + '</pre>';
      if (deskReadFailed) html += '<p class="stale">Could not refresh the desk read this minute; this is the last one loaded.</p>';
    }
    // one cache for every branch: a box-only note in between can never leave a real read unrendered
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }
  function askTopic(fresh) {
    var t = null;
    if (!fresh) { try { t = localStorage.getItem(ASK_TOPIC_KEY); } catch (_) { t = null; } }
    if (t) return t;
    t = prompt("paste the ask topic from the desk");
    if (!t || !t.trim()) return null;
    t = t.trim();
    try { localStorage.setItem(ASK_TOPIC_KEY, t); } catch (_) {}
    return t;
  }
  function pollDeskRead(sinceIso) {
    // after an ask: the card reads desk_read.json every 20 s for 3 minutes, until a newer read lands
    if (deskReadPoll) { clearInterval(deskReadPoll.timer); deskReadPoll = null; }
    var left = 9, btn = $("deskread-ask"), expired = "No new read in 3 minutes. The answer may still reach your phone. If none comes, check the ask topic (change ask topic).";
    var ONLY_BOX = "Sent. The read goes to your phone; it shows here only on the private box view.";
    function done(text) { clearInterval(deskReadPoll.timer); deskReadPoll = null; if (btn) { btn.disabled = false; btn.textContent = "Ask the desk"; } var n = $("deskread-note"); if (n) n.textContent = text || ""; }
    deskReadPoll = { timer: setInterval(function () {
      left -= 1;
      fetchJSON("desk_read.json", 8000).then(function (d) {
        if (d && d.answered_utc && d.answered_utc !== sinceIso) { deskRead = d; deskReadFailed = false; renderDeskRead(); done("The read is in."); }
        else if (left <= 0) done(expired);
      }, function () {
        // a 404 is the public mirror or link (the read never shows there) OR the private box view before its first
        // read is written: the server answers both alike on purpose, so the page cannot tell them apart. Say the
        // true thing for both and keep polling the full 3 minutes, so the box view still picks up its first read.
        if ((feedFetch["desk_read.json"] || {}).http === 404) {
          var n = $("deskread-note"); if (n) n.textContent = ONLY_BOX;
          if (left <= 0) done(ONLY_BOX);
        } else if (left <= 0) done(expired);
      });
    }, 20000) };
  }
  (function () {
    var btn = $("deskread-ask"); if (!btn) return;
    btn.onclick = function () {
      var topic = askTopic(); if (!topic) return;
      var q = prompt("What should the desk read? Leave it as read for the general read.", "read");
      if (q === null) return;
      q = (q || "read").trim().slice(0, 500) || "read";
      var before = deskRead && deskRead.answered_utc;
      btn.disabled = true; btn.textContent = "sending";
      // a plain POST body to the topic (ntfy's simplest form); the topic is in the request only, never on the page
      fetch(ASK_SERVER + "/" + encodeURIComponent(topic), { method: "POST", body: q }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        btn.textContent = "sent, the read lands in about a minute";
        $("deskread-note").textContent = "";
        pollDeskRead(before);
      }, function (e) {
        btn.disabled = false; btn.textContent = "Ask the desk";
        $("deskread-note").textContent = "Could not send the ask: " + e.message;
      });
    };
    // a mistyped topic is not stored for good: this clears it and asks again (the topic never shows on the page)
    var ch = $("deskread-topic");
    if (ch) ch.onclick = function (ev) {
      ev.preventDefault();
      try { localStorage.removeItem(ASK_TOPIC_KEY); } catch (_) {}
      var t = askTopic(true);
      $("deskread-note").textContent = t ? "Ask topic changed on this device." : "Ask topic cleared; the next ask will ask for it.";
    };
  })();

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
    if (isLocked(s) || c.settlement_state && c.settlement_state !== "OPEN") return "rain already recorded; awaiting official result";
    if (!c.wet_state || c.wet_state !== wetState(s).k) return "sky changed after pricing (now " + wetState(s).k + ": " + wetState(s).inputs.join(", ") + ")";
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
    var e = c[c.side], ex = e.executable, side = c.side.toUpperCase();
    var elapsed = Math.max(0, (Date.now() - Date.parse(candidates.generated_utc)) / 1000);
    function aged(value, seconds) { return value === null || value === undefined ? 'unknown' : Math.ceil(value + elapsed / (seconds ? 1 : 60)) + (seconds ? ' s' : ' min'); }
    return '<div class="dis val" data-icao="' + c.icao + '">'
      + '<div><b>' + esc(c.city) + '</b> ' + side + ' at <b>' + cents(ex.avg) + '</b> for ' + c.qty + ' (' + Math.round(ex.best_size || 0) + ' at best)</div>'
      + '<div>Will it rain: v3 <b>' + pct(c.p_yes_pct) + '</b>' + v3Tag(c.p_yes_pct, s) + ' &middot; ' + esc(STATES[wetState(s).k].text) + '</div>'
      + '<div class="when">Value if v3 is right: <b>' + side + ' ' + (100 * e.net_per).toFixed(1) + 'c</b> per contract after fees; band ' + (100 * e.net_lo_per).toFixed(1) + ' to ' + (100 * e.net_hi_per).toFixed(1) + 'c. Limit ' + cents(e.max_price_for_zero) + '.</div>'
      + '<div class="when">Priced ' + agoTxt(candidates.generated_utc) + '; ' + esc(c.book_source) + ' ' + aged(c.book_age_s, true) + '; gauge ' + aged(c.gauge_age_min) + '; radar ' + aged(c.radar_scan_age_min) + '; ' + remainingWord(s) + '.'
      + ((c.conflicts || []).length ? ' <b class="stale">Against: ' + esc(c.conflicts.join('; ')) + '</b>' : '') + '</div></div>';
  }
  /* The v3 section's label (Colin, 2026-09-18): v3 is the working forecast, it prices the phone alerts,
     it is the backup until the Rain Sentinel is validated, and its record is said with it. */
  function v3Label() {
    return '<div class="v3-label"><b>v3 forecast</b>: drives your alerts, backup until the Sentinel is validated, ' + (relTable() ? 'record measured on this fit\'s own unseen dates (each number says its bucket)' : 'record unmeasured') + '</div>';
  }
  function valuePanel() {
    var head = v3Label() + '<div class="sechead"><b>Worth something at an executable price</b><small>';
    if (!candidates) return head + 'candidates.json missing: board_alerts.py is not running, so nothing is priced. Below is the model only.</small></div><div class="grp"><small>No priced candidates. A model number alone is not a candidate.</small></div>';
    var age = ageMin(candidates.generated_utc), rows = candidates.candidates || [], bk = candidates.book_feed_status;
    // codex P1, round 3: a candidates.json whose writer stopped would sit on the page for hours with
    // its frozen "quote 2 s old". Past the refresh allowance the whole list is refused, not decorated.
    if (age === null || age < 0 || age > 5) return head + '<b class="stale">candidates.json is ' + (age === null ? 'undated' : age + ' m old') + ' (writer stopped?); nothing is priced until it refreshes.</b></small></div>';
    var priced = alertsPricedTxt();
    head += 'priced ' + agoTxt(candidates.generated_utc) + ' for ' + candidates.qty + ' contracts, taker fees, ' + (bk === "LIVE" ? 'websocket book' : 'collector quotes only (book feed ' + esc(bk || 'off') + ')') + '. NO range 0 to 10%, YES range 90 to 100%. A row needs a fresh quote, a positive net after fees for the full quantity, and no sky conflict.</small></div>';
    var idw = candIdentityWord();
    if (idw) return head + '<div class="grp"><b class="stale">' + esc(idw) + '</b><small> ' + rows.length + ' priced row' + (rows.length === 1 ? '' : 's') + ' and the in-range list are withheld, without their numbers, until the v3 feed identifies itself.</small></div>';
    var shown = rows.filter(candUsable), withheld = rows.filter(function (c) { return !candUsable(c); });
    /* layout A (2026-09-25): the band's answer outranks its method. "nothing clears value right now" is the state, so it is
       set at body size in runway white (it was the smallest, dimmest line under the method paragraph); the pricing note
       follows the rows it describes, muted when it only says v3 priced everything (design critic on 661e587) */
    var body = shown.length ? shown.map(valueRow).join("") : '<div class="grp v3-none">nothing clears value right now' + (candidates.reason ? ' <b class="stale">(' + esc(candidates.reason) + ')</b>' : '') + '</div>';
    if (priced) body += '<div class="grp alerts-priced' + (priced === "alerts: priced by v3" ? ' plain' : '') + '"><small><b>' + esc(priced) + '</b></small></div>';
    if (withheld.length) body += '<details class="grp withheld-details"><summary>Withheld after newer evidence (' + withheld.length + ')</summary><small>' + withheld.map(function (c) { return esc(c.city) + ' (' + esc(candWithheldWord(c)) + ')'; }).join(' &middot; ') + '</small></details>';
    var blocked = (candidates.stations || []).filter(function (x) { return candUsable(x) && !x.side && x.p_yes_pct !== null && x.p_yes_pct !== undefined && (x.p_yes_pct <= 10 || x.p_yes_pct >= 90); });
    var blockedWithheld = (candidates.stations || []).filter(function (x) { return !candUsable(x) && !x.side && x.p_yes_pct !== null && x.p_yes_pct !== undefined; });
    if (blockedWithheld.length) body += '<details class="grp withheld-blocked-details"><summary>Other withheld forecasts (' + blockedWithheld.length + ')</summary><small>' + blockedWithheld.map(function (x) { return esc(x.city) + ' (' + esc(candWithheldWord(x)) + ')'; }).join(' &middot; ') + '</small></details>';
    if (blocked.length) {
      // a conflict every in-range station shares (after midnight that is "no gauge observation") is said
      // once, so each station's OWN reason is the one that shows
      var shared = blocked[0].conflicts.filter(function (c) { return blocked.every(function (x) { return x.conflicts.indexOf(c) >= 0; }); });
      // 2026-09-18 (Colin, phone): this list was one run-on sentence joined with middots, every
      // station's number, record and reason in a single wrapped paragraph. Same data, one row each,
      // so a station can be found at a glance. The record stays beside every v3 number (09-09 law)
      // and a row still opens its station through bindRows' [data-icao] hook.
      body += '<details class="grp candidate-details"><summary>Why each is not a candidate (' + blocked.length + ')</summary><small>' + (shared.length ? '<b>all ' + blocked.length + ' in range:</b> ' + esc(shared.join('; ')) + '<br>' : '') + '<b>in range but not a candidate</b> (v3 numbers; tap a row to open it)</small>'
        + '<table class="sc inrange"><thead><tr><th>Station</th><th>v3</th><th>Net</th><th>Why not a candidate</th></tr></thead><tbody>'
        + blocked.map(function (x) {
            var e = x.p_yes_pct <= 10 ? x.no : x.yes, own = x.conflicts.filter(function (c) { return shared.indexOf(c) < 0; });
            var why = own[0] || (e && e.reason) || (shared.length ? 'only the shared reason' : '');
            return '<tr data-icao="' + x.icao + '" style="cursor:pointer">'
              + '<td><b>' + esc(x.city) + '</b></td>'
              + '<td>' + pct(x.p_yes_pct) + '<br><small class="rec">' + esc(v3Rec(x.p_yes_pct, byIcao(x.icao))) + '</small></td>'
              + '<td>' + (e && e.net_per !== null && e.net_per !== undefined ? (100 * e.net_per).toFixed(1) + 'c' : '-') + '</td>'
              + '<td><small>' + esc(why) + '</small></td></tr>';
          }).join('') + '</tbody></table></details>';
    }
    return head + body;
  }

  /* 1. the model panel: LOW / HIGH modelled probability, MARKET DISAGREES (diagnostic), each with WHEN */
  function modelPanel() {
    var lo = [], hi = [], mid = [], wet = [], dis = [];
    stations().forEach(function (s) {
      var p = physPct(s); if (p === null) return;
      if (isLocked(s)) { wet.push(s); return; }
      var quote = marketQuoteDetails(s.market, "ask"), ask = quote ? quote.price : null;
      var gap = ask === null ? null : Math.round(ask * 100) - Math.round(p), win = rainWindow(s), w = wetState(s), qa = ageMin(quote && quote.fetched_utc);
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
    function chip(x, cls) {
      var cf = conflict(x);
      return '<span class="st ' + x.w.k + (cf ? ' conflict' : '') + '" data-icao="' + x.s.icao + '" style="cursor:pointer" title="' + esc(x.w.inputs.join('; ')) + '"><b>' + esc(x.s.city) + '</b> v3 ' + pct(x.pct) + v3Tag(x.pct, x.s) + '<small>' + esc(STATES[x.w.k].text) + (cf ? '; ' + esc(cf) : '') + '</small></span>';
    }
    function gapRow(x) {
      var side = x.gap > 0 ? "market " + x.gap + " points ABOVE v3" : "market " + (-x.gap) + " points BELOW v3";
      return '<div class="dis" data-icao="' + x.s.icao + '"><div><b>' + esc(x.s.city) + '</b> ' + stateChip(x.w) + '</div><div class="r num">v3 <b>' + pct(x.pct) + '</b>' + v3Tag(x.pct, x.s) + ' vs market YES <b>' + cents(x.ask) + '</b>' + qtxt(x) + '</div>'
        + '<div class="when">' + side + ' &middot; ' + (x.win ? 'rain hours ahead: <b>' + esc(x.win.text) + '</b>' : 'no rain hour ahead in any forecast') + ' &middot; ' + esc(timingPhrase(x.s, x.w)) + '</div></div>';
    }
    var feedTxt = physStale() ? '<b class="stale">' + esc(physStale()) + '</b>' : (physics ? 'v3 ' + physAgoTxt() : '<b class="stale">v3 unavailable: feed missing</b>');
    return '<div class="sechead"><b>What v3 says today</b><small>' + feedTxt + ', newest selected quote ' + agoTxt(stations().map(function (s) { var q = marketQuoteDetails(s.market, "ask"); return q && q.fetched_utc; }).filter(Boolean).sort().pop()) + '; live book up to 2 min, snapshots up to 15 min</small></div>'
      + '<div class="grp"><small><b>Low modelled probability</b> (0 to 10%, NO candidates' + (rl ? '; on unseen dates this bucket rained ' + rl.actual_pct + '% of the time, n=' + rl.n : '; this bucket: unmeasured on this fit') + '). The chip is the SKY, the number is the MODEL; a flagged chip is a conflict to read before anything else.</small>' + (lo.length ? '<div class="model-chips">' + lo.map(function (x) { return chip(x); }).join("") + '</div>' : '<small>none</small>') + '</div>'
      + '<div class="grp"><small><b>High modelled probability</b> (90 to 100%, YES candidates' + (r9 ? '; 90s settled YES ' + r9.actual_pct + '% at n=' + r9.n + (r9.n < 20 ? ', thin' : '') : '; 90 and up: unmeasured on this fit') + ')</small>' + (hi.length ? '<div class="model-chips">' + hi.map(function (x) { return chip(x); }).join("") + '</div>' : '<small>none right now</small>') + '</div>'

      + '<details class="grp market-details"><summary>Market differs from v3 by 15+ points (' + dis.length + ')</summary>' + (dis.length ? dis.map(gapRow).join("") : '<small>no gap of 15 points anywhere</small>') + '</details>'
      + '<div class="grp"><small><b>In between</b> (11 to 89%, neither probability range): ' + (mid.length ? mid.sort(function (a, b) { return b.pct - a.pct; }).map(function (x) { return '<span data-icao="' + x.s.icao + '" style="cursor:pointer">' + esc(x.s.city) + ' v3 ' + pct(x.pct) + ' ' + esc(v3Rec(x.pct, x.s)) + '</span>'; }).join(', ') : 'none') + '</small></div>';
  }

  /* 3. the queue */
  function quoteFreshness(m) {
    var q = marketQuoteDetails(m, "ask") || marketQuoteDetails(m, "bid");
    return q ? esc(q.source) + (q.source === "live book" ? ', checked ' : ', ')
      + ageFlag(q.fetched_utc, q.source === "live book" ? 2 : 15)
      + (q.updated_utc && ageMin(q.updated_utc) > 2 ? '; last update ' + agoTxt(q.updated_utc) : '')
      : '<b class="stale">no current sized quote</b>';
  }
  function priceHTML(s) {
    var m = s.market || {};
    return '<div class="price num">YES ask ' + quoteCents(marketQuote(m, "ask")) + '<small>bid ' + quoteCents(marketQuote(m, "bid")) + '</small></div>';
  }
  /* layout A (2026-09-25), a departures-board line: the code and the price on top, the state plaque beside the bid, then
     ONE left-aligned line with the quote's freshness and the minutes left (both kept word for word). The freshness
     used to sit inside the price block as right-aligned prose over two or three lines, which made every row 23 %
     taller than before A (design critic on 661e587). */
  function rowHTML(s, w, extra) {
    var g = gaugeTxt(s), a = obAge(s), p = isLocked(s) ? null : physPct(s);
    return '<div class="row' + (w.overdue ? ' ovl' : '') + (s.icao === liveSel ? ' sel' : '') + '" data-icao="' + s.icao + '">'
      + '<div><div class="city">' + esc(s.city) + '<small>' + s.icao + '</small></div>' + stateChip(w) + '</div>'
      + '<div class="right">' + priceHTML(s) + '</div>'
      + '<div class="qline"><small class="qfresh">' + quoteFreshness(s.market || {}) + '</small>' + (!isLocked(s) ? '<small class="qleft">' + remainingWord(s) + '</small>' : '') + '</div>'
      + '<div class="line gauge">Gauge <b>' + g + '</b>' + (a !== null ? ' (' + a + ' min)' : '') + '</div>'
      + '<div class="line timing">' + (isLocked(s) ? 'YES expected; official result pending' : 'Will it rain: ' + (p !== null ? 'v3 <b>' + pct(p) + '</b>' + v3Tag(p, s) : '<b class="stale">' + esc(physWord(s) || 'v3 unavailable') + '</b>') + '. Next: ' + esc(timingPhrase(s, w))) + '</div>'
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
    // layout A (2026-09-25): sentence case with the count in bold ("DUE 3 H 7" read as one number, critic on 661e587)
    var FW = { ALL: "All", WET: "Wet", NEXT3H: "Due in 3 h", OVERDUE: "Overdue" };
    $("queue-filters").innerHTML = ["ALL", "WET", "NEXT3H", "OVERDUE"].map(function (k) { return '<button data-f="' + k + '" class="' + (queueFilter === k ? "on" : "") + '">' + FW[k] + ' <b class="num">' + counts[k] + '</b></button>'; }).join("");
    $("queue-filters").querySelectorAll("button").forEach(function (b) { b.onclick = function () { queueFilter = b.dataset.f; localStorage.setItem("rb.filter", queueFilter); renderQueue(); }; });
    var rows = S.filter(function (s) { var w = wetState(s), e = nextEvent(s); if (queueFilter === "WET") return w.k === "WET_NOW" || w.k === "WET_IMMINENT" || w.k === "LOCKED"; if (queueFilter === "OVERDUE") return w.overdue || w.k === "OVERDUE"; if (queueFilter === "NEXT3H") return e && e.ms - Date.now() <= 3 * 3600000 && !isLocked(s); return true; });
    var recorded = rows.filter(isLocked), open = rows.filter(function (s) { return !isLocked(s); });
    var keepRecordedOpen = !!($("live-queue").querySelector(".recorded-gauges") || {}).open;
    $("live-queue").innerHTML = open.map(function (s) { return rowHTML(s, wetState(s)); }).join("")
      + (recorded.length ? '<details class="recorded-gauges card"' + (keepRecordedOpen ? ' open' : '') + '><summary>Rain recorded, YES expected (' + recorded.length + '): ' + recorded.map(function (s) { return esc(s.city); }).join(', ') + '</summary>' + recorded.map(function (s) { return rowHTML(s, wetState(s)); }).join('') + '</details>' : '')
      + (!rows.length ? '<div class="empty">nothing in this filter</div>' : '');
    bindRows($("live-queue")); renderSentinel();
  }

  /* ---------------- maps ---------------- */
  /* The radar legend paints the colours the map's radar is drawing right now, not invented ones.
     Colin, 2026-09-24: "I NEED THE EXACT SHADER OF THE RADAR TO MATCH THIS". Every colour below was
     read out of the source's own images and checked against real tiles (research/2026-09-24_radar_palettes.json):
     141 colours per source, 0.0 to 70.0 dBZ every 0.5. The IEM N0Q composite and the IEM HRRR forecast
     share one palette byte for byte; IEM single-site N0B paints each dBZ with the N0Q colour of 1 dBZ
     lower; NWS MRMS blends straight between nodes every 5 dBZ. MRMS's own published legend image is
     wrong above 40 dBZ, so it is not the source here. */
  var RADAR_PAL = {
    N0Q: "9098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a24b64a14761a0435e9f415b9e4361a2"
      + "4568a6486faa4a76ae4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d462bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a24bd690"
      + "43d67e3cd66d35d65b11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e110c99110c95100c91100b880f"
      + "0b840e0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308467d085b88076f9207849d0698a806adb205c1bd05d6c704ead204"
      + "ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400ff8f00ff8a00ff8500ff8000ff0000"
      + "f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000a300009b00009400008d00007f0000780000710000fffffffff5ff"
      + "ffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36efea2bece720e9e10be3b200ffac00fc"
      + "a400f7",
    N0B: "919ab4949bb59098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a24b64a14761a0435e9f"
      + "415b9e4361a24568a6486faa4a76ae4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d462bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b3"
      + "52d6a24bd69043d67e3cd66d35d65b11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e110c99110c9510"
      + "0c91100b880f0b840e0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308467d085b88076f9207849d0698a806adb205c1bd05"
      + "d6c704ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400ff8f00ff8a00ff8500"
      + "ff8000ff0000f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000a300009b00009400008d00007f0000780000710000"
      + "fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36efea2bece720e9e10be3"
      + "b200ff",
    MRMS: "949bb58f97b48a94b28590b1808cb07c88ae7785ad7281ac6d7dab687aa96376a86074a75d71a6596fa5566ca4536aa45068a34d65a24963a14660a0"
      + "435e9f4666a4486ea94b76ad4e7eb25086b7538dbc5695c1599dc55ba5ca5eadcf5db1ca5cb5c65ab9c259bdbd58c2b857c6b456cab054ceab53d2a6"
      + "52d6a24bd69444d6863ed67737d66930d65b29d64d22d63f1cd63015d6220ed6140ece140dc6130dbf120db7120caf120ca7110c9f100c98100b9010"
      + "0b880f0b840e0b800e0a7b0d0a770d0a730c0a6f0b0a6b0b09660a09620a095e09226b083a78075386066b930584a0049dad04b5ba03cec802e6d501"
      + "ffe200ffdd00ffd800ffd300ffce00ffca00ffc500ffc000ffbb00ffb600ffb100ff9f00ff8e00ff7c00ff6a00ff5800ff4700ff3500ff2300ff1200"
      + "ff0000f70000ef0000e80000e00000d80000d00000c80000c10000b90000b10000b91a1ac13333c84c4cd06666d88080e09999e8b2b2efccccf7e6e6"
      + "fffffffff1ffffe3ffffd6ffffc8ffffbaffffacffff9effff91ffff83ffff75fff769ffee5efee652fedd46fed53afecd2ffdc423fdbc17fdb30cfc"
      + "ab00fc"
  };
  var RADAR_SRC = {
    N0Q: { pal: "N0Q", name: "Iowa Mesonet composite (N0Q)" },
    HRRR: { pal: "N0Q", name: "HRRR forecast (Iowa Mesonet)" },
    MRMS: { pal: "MRMS", name: "NWS MRMS mosaic" },
    N0B: { pal: "N0B", name: "single radar (N0B)" }
  };
  /* ---------------- smooth drawing (Colin, 2026-09-24: "ok cool build and implement", the premium radar feel) ----------------
     The squares were drawn by the servers, not the map: each radar source was asked for tiles far past its own grid (MRMS
     and IEM's single-site N0B about 0.01 degrees, zoom 7; the N0Q composite 0.005 degrees, zoom 8; HRRR 3 km, zoom 6), so
     every tile came back as flat blocks and the map's linear filter had nothing left to smooth. Blending the colours (the
     map's filter, or GeoServer's interpolations=bilinear) would put 9 to 12.5 percent of the pixels between two legend
     colours. So a tile past the source's own zoom is cut here from the source's native tile: each pixel is read back to its
     dBZ by exact lookup in the source's palette, the dBZ is smoothed (bilinear), and every pixel is painted again with a
     colour of that same palette, so the key's colours stay the colours drawn (test_smooth_radar.py). A clear pixel is "no
     echo": the echo's edge is where the smoothed coverage crosses one half, the line nearest-pixel drawing has, only smooth.
     Palettes: research/2026-09-24_radar_palettes.json, the full 256 rows of N0Q (HRRR shares them byte for byte) and of N0B,
     and MRMS's nodes (a straight blend every 5 dBZ; 0 to 70 dBZ drawn with the key's own 141 colours). */
  var RADAR_FULL = {
    N0Q: "00000085718f85728f86738d87758b87768b887789897987897a878a7b858b7d848b7e848c7f828d81808d82808e837e8f847c8f857c90877b918879"
      + "918979928b77938d759691539894579b975b9d9a60a09d64a3a068a5a36da8a671aaa976adac7ab0af7eb2b283b7b88cbabb90bdbe94bfc199c2c49d"
      + "c4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4c9ccb4c6c9b4c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4b0b6b4adb3b4aab0b4a4abb4a0a8b49da5b4"
      + "9aa2b497a0b4949db4919ab4949bb59098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a2"
      + "4b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d462bbd865c2dc67c9e06ad0e4"
      + "6fd6e868d6d759d6b352d6a24bd69043d67e3cd66d35d65b11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf130eab130da6120da212"
      + "0d9e110c99110c95100c91100b880f0b840e0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308467d085b88076f9207849d06"
      + "98a806adb205c1bd05d6c704ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400"
      + "ff8f00ff8a00ff8500ff8000ff0000f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000a300009b00009400008d0000"
      + "7f0000780000710000fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36ef"
      + "ea2bece720e9e10be3b200ffac00fca400f79b00f49300ef8800ea8300e87900e27200dd6900db05ecf005ebf005eaf005dde005dce005dbe005cdd0"
      + "05ccd004bdc004bcc004bbc004aeb004adb0049ea0049da0049ca0038e90038d90038c90037e80037d80036f70036e70036d70025f60025e60024f50"
      + "024e50024d50023f40023e40023d40013030012f30012020011f20011e203a67b53a66b53a65b53a64b53a63b53a62b5",
    N0B: "000000000000836c92846e9085718f85718f86738d87758b87758b8877898979878979878a7b858b7d848b7d848c7f828d81808d81808e837e8f857c"
      + "8f857c90877b918979918979928b77938d759691539894579b975b9d9a60a09d64a3a068a5a36da8a671aaa976adac7ab0af7eb2b283b7b88cbabb90"
      + "bdbe94bfc199c2c49dc4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4c9ccb4c6c9b4c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4b0b6b4adb3b4aab0b4"
      + "a4abb4a0a8b49da5b49aa2b497a0b4949db4919ab4949bb59098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a85f73a7"
      + "5b70a6576da44f67a24b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d462bbd8"
      + "65c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a24bd69043d67e3cd66d35d65b11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf13"
      + "0eab130da6120da2120d9e110c99110c95100c91100b880f0b840e0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308467d08"
      + "5b88076f9207849d0698a806adb205c1bd05d6c704ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700"
      + "ffa200ff9900ff9400ff8f00ff8a00ff8500ff8000ff0000f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000a30000"
      + "9b00009400008d00007f0000780000710000fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960faf656f7"
      + "f34bf4f040f1ed36efea2bece720e9e10be3b200ffac00fca400f79b00f49300ef8800ea8300e87900e27200dd6900db05ecf005ecf005ecf005dde0"
      + "05dde005dde005cdd005cdd004bdc004bdc004bdc004aeb004aeb0049ea0049ea0049ea0038e90038e90038e90037e80037e80036f70036f70036f70"
      + "025f60025f60024f50024f50024f50023f40023f40023f400130300130300120200120200120203a67b53a67b5ffffff"
  };
  var MRMS_NODES = [[-15, "b2b283"], [-10, "d2d4b4"], [-5, "b0b6b4"], [0, "949bb5"], [5, "6376a8"], [10, "435e9f"], [15, "5eadcf"], [20, "52d6a2"], [25, "0ed614"], [30, "0b880f"], [35, "095e09"], [40, "ffe200"], [45, "ffb100"], [50, "ff0000"], [55, "b10000"], [60, "ffffff"], [65, "ff75ff"], [70, "ab00fc"]];
  // each source's own zoom, and its palette's first dBZ row (N0Q: dBZ = -32 + 0.5 (i - 1); N0B: dBZ = -32 + 0.5 (i - 2))
  var SMOOTH = { MRMS: { nz: 7 }, N0Q: { nz: 8, full: "N0Q", i0: 1 }, HRRR: { nz: 6, full: "N0Q", i0: 1 }, N0B: { nz: 7, full: "N0B", i0: 2 } };
  var smoothOn = false, smoothParents = new Map();
  /* per map tile: ms from its source tile being ready to the bitmap the map takes; cutMs the cut itself, wherever it ran;
     worker / onPage how many map tiles were cut in the worker and on the page's thread; pageMs the page thread's share;
     decodeMs per native tile */
  var smoothStats = { tiles: 0, ms: 0, max: 0, cutMs: 0, cutMax: 0, parents: 0, decodeMs: 0, worker: 0, onPage: 0, pageMs: 0 };
  /* The dBZ read, the smoothing and the repaint, as ONE function of the palettes alone (D), so the same source runs in a
     worker and, where a browser has no worker with a canvas, on the page's thread. Review, 2026-09-24: on a CPU slowed 4x
     the cut on the page's thread held the page 67 to 83 ms each time play reached a frame not cut yet (about 15 map
     tiles, 4 ms each, back to back), about 4 dropped frames a step. */
  function smoothKernel(D) {
    function hexRgb(h, i) { return [parseInt(h.substr(i * 6, 2), 16), parseInt(h.substr(i * 6 + 2, 2), 16), parseInt(h.substr(i * 6 + 4, 2), 16)]; }
    function mrmsLine(d) {
      d = Math.max(-15, Math.min(70, d));
      var k = Math.min(D.nodes.length - 2, Math.floor((d + 15) / 5)), a = hexRgb(D.nodes[k][1], 0), b = hexRgb(D.nodes[k + 1][1], 0), t = (d - D.nodes[k][0]) / 5;
      return [0, 1, 2].map(function (c) { return Math.round(a[c] + t * (b[c] - a[c])); });
    }
    var luts = {};
    /* per source: lo (the dBZ of paint row 0; rows every 0.5 dBZ), paint (one rgb a row), dec (a colour's dBZ) */
    function lut(key) {
      if (luts[key]) return luts[key];
      var S = D.smooth[key], L = { dec: new Map(), known: [] }, k, c, d;
      var put = function (c, v, known) { var ci = (c[0] << 16) | (c[1] << 8) | c[2]; if (!L.dec.has(ci)) L.dec.set(ci, v); if (known) L.known.push([c, v]); };
      if (S.full) {
        L.lo = -32; L.rows = 256 - S.i0; L.paint = new Uint8Array(L.rows * 3);
        for (k = 0; k < L.rows; k++) { c = hexRgb(D.full[S.full], k + S.i0); L.paint.set(c, k * 3); put(c, L.lo + k / 2, true); }
      } else {
        L.lo = -15; L.rows = 171; L.paint = new Uint8Array(L.rows * 3);
        for (k = 0; k < L.rows; k++) { d = L.lo + k / 2; c = d >= 0 ? hexRgb(D.mrms, Math.round(d * 2)) : mrmsLine(d); L.paint.set(c, k * 3); put(c, d, false); }
        // MRMS paints its blend continuously, so its in-between colours are read back against the line every 0.1 dBZ
        for (k = 0; k <= 850; k++) { d = -15 + k / 10; L.known.push([mrmsLine(d), d]); }
      }
      return (luts[key] = L);
    }
    function dbzOf(L, r, g, b) {
      var ci = (r << 16) | (g << 8) | b, v = L.dec.get(ci);
      if (v !== undefined) return v;
      var best = Infinity;
      for (var k = 0; k < L.known.length; k++) {
        var c = L.known[k][0], dr = c[0] - r, dg = c[1] - g, db = c[2] - b, e = dr * dr + dg * dg + db * db;
        if (e < best) { best = e; v = L.known[k][1]; }
      }
      L.dec.set(ci, v); return v;
    }
    /* one native tile's pixels read back to dBZ, kept for every map tile cut from it (about 320 KB) */
    function decode(key, px, w, h) {
      var L = lut(key), v = new Float32Array(w * h), m = new Uint8Array(w * h), any = false;
      for (var i = 0, o = 0; i < w * h; i++, o += 4) if (px[o + 3] >= 128) { v[i] = dbzOf(L, px[o], px[o + 1], px[o + 2]); m[i] = 1; any = true; }
      return any ? { w: w, h: h, v: v, m: m } : null;
    }
    /* map tile (cx, cy) of the 2^d by 2^d under one native tile: bilinear in dBZ over the drawn pixels, weighted by coverage */
    function cut(P, key, d, cx, cy) {
      var s = 1 << d, L = lut(key), W = P.w, H = P.h, out = new Uint8ClampedArray(256 * 256 * 4), any = false;
      var x0 = new Int32Array(256), x1 = new Int32Array(256), fx = new Float32Array(256), i, j;
      for (i = 0; i < 256; i++) {
        var u = (cx * 256 + i + 0.5) / s * (W / 256) - 0.5, a = Math.floor(u);
        fx[i] = u - a; x0[i] = Math.max(0, Math.min(W - 1, a)); x1[i] = Math.max(0, Math.min(W - 1, a + 1));
      }
      for (j = 0; j < 256; j++) {
        var q = (cy * 256 + j + 0.5) / s * (H / 256) - 0.5, b = Math.floor(q), fy = q - b;
        var r0 = Math.max(0, Math.min(H - 1, b)) * W, r1 = Math.max(0, Math.min(H - 1, b + 1)) * W;
        for (i = 0; i < 256; i++) {
          var a00 = r0 + x0[i], a01 = r0 + x1[i], a10 = r1 + x0[i], a11 = r1 + x1[i];
          var m00 = P.m[a00], m01 = P.m[a01], m10 = P.m[a10], m11 = P.m[a11];
          if (!(m00 | m01 | m10 | m11)) continue;
          var gx = fx[i], w00 = (1 - gx) * (1 - fy) * m00, w01 = gx * (1 - fy) * m01, w10 = (1 - gx) * fy * m10, w11 = gx * fy * m11, cov = w00 + w01 + w10 + w11;
          if (cov < 0.5) continue;
          var k = Math.round(((w00 * P.v[a00] + w01 * P.v[a01] + w10 * P.v[a10] + w11 * P.v[a11]) / cov - L.lo) * 2);
          if (k < 0) k = 0; else if (k >= L.rows) k = L.rows - 1;
          var o = (j * 256 + i) * 4; out[o] = L.paint[k * 3]; out[o + 1] = L.paint[k * 3 + 1]; out[o + 2] = L.paint[k * 3 + 2]; out[o + 3] = 255; any = true;
        }
      }
      return any ? out : null;
    }
    return { decode: decode, cut: cut };
  }
  /* the worker: it holds the native tiles read to dBZ (the page keeps the list of which, and says when one is dropped),
     cuts map tiles from them and hands back a finished ImageBitmap, so the page's thread never runs the per-pixel work */
  function smoothWorkerMain(K) {
    var P = new Map();
    self.onmessage = function (e) {
      var q = e.data, t0 = performance.now();
      if (q.op === "drop") { P.delete(q.id); return; }
      var fail = function (err) { self.postMessage({ n: q.n, err: String((err && err.message) || err) }); };
      if (q.op === "parent") {
        createImageBitmap(q.blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" }).then(function (bmp) {
          var w = bmp.width, h = bmp.height, cx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
          cx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
          var p = K.decode(q.key, cx.getImageData(0, 0, w, h).data, w, h);
          P.set(q.id, p);
          self.postMessage({ n: q.n, any: !!p, ms: performance.now() - t0 });
        }).catch(fail);
        return;
      }
      if (!P.has(q.id)) { fail("gone"); return; }
      var p = P.get(q.id), out = p ? K.cut(p, q.key, q.d, q.cx, q.cy) : null, ms = performance.now() - t0;
      if (q.px) { self.postMessage({ n: q.n, px: out, ms: ms }, out ? [out.buffer] : []); return; }
      createImageBitmap(new ImageData(out || new Uint8ClampedArray(256 * 256 * 4), 256, 256))
        .then(function (bmp) { self.postMessage({ n: q.n, bmp: bmp, ms: ms }, [bmp]); }).catch(fail);
    };
  }
  var smoothK = null, smoothW = null, smoothWq = new Map(), smoothWn = 0;
  function smoothLocal() { return smoothK || (smoothK = smoothKernel({ full: RADAR_FULL, nodes: MRMS_NODES, mrms: RADAR_PAL.MRMS, smooth: SMOOTH })); }
  function startSmoothWorker() {
    try {
      if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function" || !window.URL || !URL.createObjectURL) return;
      var D = { full: RADAR_FULL, nodes: MRMS_NODES, mrms: RADAR_PAL.MRMS, smooth: SMOOTH };
      var src = "(" + smoothWorkerMain + ")((" + smoothKernel + ")(" + JSON.stringify(D) + "));";
      smoothW = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      smoothW.onmessage = function (e) {
        var q = smoothWq.get(e.data.n); if (!q) return;
        smoothWq.delete(e.data.n);
        if (e.data.err) q[1](new Error(e.data.err)); else q[0](e.data);
      };
      /* a worker that cannot run (a blocked blob: script, an old browser): the page's thread takes over from here */
      smoothW.onerror = function () {
        smoothW = null; smoothParents.clear();
        smoothWq.forEach(function (q) { q[1](new Error("worker")); }); smoothWq.clear();
      };
    } catch (e) { smoothW = null; }
  }
  function smoothAsk(msg, tr) {
    var w = smoothW;
    return new Promise(function (res, rej) {
      if (!w) { rej(new Error("worker")); return; }
      msg.n = ++smoothWn; smoothWq.set(msg.n, [res, rej]); w.postMessage(msg, tr || []);
    });
  }
  function tileFill(tpl, z, x, y) {
    var E = 20037508.342789244, s = 2 * E / Math.pow(2, z);
    return tpl.replace("{sz}", z).replace("{sx}", x).replace("{sy}", y).replace("{sbbox}", [x * s - E, E - (y + 1) * s, (x + 1) * s - E, E - y * s].join(","));
  }
  /* the tile URL a radar layer asks for: the source's own URL rides inside it, so what is drawn stays readable from the map */
  function smoothUrl(key, tpl) {
    if (!smoothOn || !SMOOTH[key]) return tpl;
    return "rbsmooth://" + key + "/{z}/{x}/{y}/" + tpl.replace("{z}/{x}/{y}", "{sz}/{sx}/{sy}").replace("{bbox-epsg-3857}", "{sbbox}");
  }
  /* one native tile, fetched here (so a slow or failed fetch is the page's to see) and read to dBZ once: in the worker,
     where it stays ({ inWorker: true } here), or on the page's thread. null: no echo in it. The last 24 are kept. */
  function smoothParent(key, url) {
    var p = smoothParents.get(url);
    if (p) { smoothParents.delete(url); smoothParents.set(url, p); return p; }
    p = fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
      .then(function (b) {
        if (smoothW) return smoothAsk({ op: "parent", id: url, key: key, blob: b }).then(function (a) {
          smoothStats.parents++; smoothStats.decodeMs += a.ms;
          return a.any ? { inWorker: true } : null;
        });
        return createImageBitmap(b, { premultiplyAlpha: "none", colorSpaceConversion: "none" }).then(function (bmp) {
          var t0 = performance.now(), w = bmp.width, h = bmp.height, cv = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
          var cx = cv.getContext("2d", { willReadFrequently: true });
          cx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
          var P = smoothLocal().decode(key, cx.getImageData(0, 0, w, h).data, w, h);
          smoothStats.parents++; smoothStats.decodeMs += performance.now() - t0;
          return P;
        });
      });
    p.catch(function () { if (smoothParents.get(url) === p) smoothParents.delete(url); });
    smoothParents.set(url, p);
    while (smoothParents.size > 24) {
      var old = smoothParents.keys().next().value;
      smoothParents.delete(old);
      if (smoothW) smoothW.postMessage({ op: "drop", id: old });
    }
    return p;
  }
  /* map tile (x, y) at zoom z, cut from the source's own tile at its own zoom: pixels (px, for the checks) or an
     ImageBitmap for the map, which maplibre 4.7.1 takes from a protocol as it is (a PNG encode and decode per tile cost
     15 ms a tile alone) */
  function smoothCut(key, tpl, z, x, y, px, retried) {
    var S = SMOOTH[key], d = z - S.nz, nx = x >> d, ny = y >> d, url = tileFill(tpl, S.nz, nx, ny), cx = x - (nx << d), cy = y - (ny << d);
    var pp = smoothParent(key, url);
    return pp.then(function (P) {
      var t0 = performance.now();
      var took = function (ms, where) {
        if (px) return;
        var all = performance.now() - t0;
        smoothStats.tiles++; smoothStats.ms += all; smoothStats.max = Math.max(smoothStats.max, all);
        smoothStats.cutMs += ms; smoothStats.cutMax = Math.max(smoothStats.cutMax, ms);
        smoothStats[where]++; if (where === "onPage") smoothStats.pageMs += ms;
      };
      if (P && P.inWorker) {
        return smoothAsk({ op: "cut", id: url, key: key, d: d, cx: cx, cy: cy, px: !!px }).then(function (a) {
          took(a.ms, "worker"); return px ? a.px : a.bmp;
        }, function (e) {
          // the worker dropped it (or stopped): read it again once, wherever the cut now runs
          if (retried) throw e;
          if (smoothParents.get(url) === pp) smoothParents.delete(url);
          return smoothCut(key, tpl, z, x, y, px, true);
        });
      }
      var rgba = P ? smoothLocal().cut(P, key, d, cx, cy) : null;
      if (P) took(performance.now() - t0, "onPage");
      if (px) return rgba;
      return createImageBitmap(new ImageData(rgba || new Uint8ClampedArray(256 * 256 * 4), 256, 256));
    });
  }
  function registerSmoothProtocol() {
    if (smoothOn || !window.maplibregl || !maplibregl.addProtocol || typeof createImageBitmap !== "function") return;
    smoothOn = true;
    startSmoothWorker();
    maplibregl.addProtocol("rbsmooth", function (params, ctl) {
      var mt = /^rbsmooth:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)\/(.+)$/.exec(params.url), S = mt && SMOOTH[mt[1]];
      if (!S) return Promise.reject(new Error("not a radar tile"));
      var key = mt[1], z = +mt[2], x = +mt[3], y = +mt[4], tpl = mt[5];
      if (z <= S.nz) {   // at or above the source's own grid the server's tile is already right
        return fetch(tileFill(tpl, z, x, y), { signal: ctl && ctl.signal }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
          .then(function (b) { return { data: b }; });
      }
      return smoothCut(key, tpl, z, x, y, false).then(function (bmp) { return { data: bmp }; });
    });
  }
  // debug handle for the headless checks: one map tile's pixels cut exactly as the map cuts it, and the running cost
  window.rbSmooth = { stats: smoothStats, cut: function (key, tpl, z, x, y) { return smoothCut(key, tpl, z, x, y, true); }, url: function (key, tpl) { return smoothUrl(key, tpl); } };
  /* The bands, their minutes and their words are the board's measured gauge timing, exactly as the key has
     always said them (Colin pasted them 2026-09-24; board_alerts.py and radar_truth.py cite them by name).
     Only the colours follow the source. */
  var RADAR_BANDS = [
    { lo: 0, hi: 20, name: "TRACE", rest: "under 20 dBZ" },
    { lo: 20, hi: 30, name: "0.01 SLOW", rest: "20 to 29 (12 to 24 min over the gauge)" },
    { lo: 30, hi: 40, name: "0.01 LIKELY", rest: "30 to 39 (3 to 12 min)" },
    { lo: 40, hi: 50, name: "0.01 FAST", rest: "40 to 49 (about a minute)" },
    { lo: 50, hi: 70.5, name: "CORE", rest: "50+" }
  ];
  function radarColor(pal, dbz) { var i = Math.max(0, Math.min(140, Math.round(dbz * 2))); return "#" + RADAR_PAL[pal].substr(i * 6, 6); }
  function radarStrip(pal, b) {
    var stops = [], pos = function (d) { return (100 * (d - b.lo) / (b.hi - b.lo)).toFixed(2) + "%"; };
    if (pal === "MRMS") {
      /* MRMS blends straight between its nodes every 5 dBZ, so the strip does too: one flat step per 0.5 dBZ
         missed its in-between pixels by up to 9 per channel (refute pass, 2026-09-24) */
      for (var d = b.lo; d <= Math.min(b.hi, 70); d = 5 * Math.floor(d / 5) + 5) stops.push(radarColor(pal, d) + " " + pos(d));
      if (b.hi > 70) stops.push(radarColor(pal, 70) + " 100.00%");
      return "linear-gradient(90deg, " + stops.join(", ") + ")";
    }
    /* N0Q, HRRR and N0B are stepped: one flat step per 0.5 dBZ, exactly the palette's own steps, so a hard
       jump (N0Q green to olive at 35) shows as one */
    var n = Math.round((b.hi - b.lo) * 2), prev = null, start = 0;
    for (var k = 0; k <= n; k++) {
      var c = k < n ? radarColor(pal, b.lo + k / 2) : null;
      if (c !== prev) { if (prev) stops.push(prev + " " + (100 * start / n).toFixed(2) + "% " + (100 * k / n).toFixed(2) + "%"); prev = c; start = k; }
    }
    return "linear-gradient(90deg, " + stops.join(", ") + ")";
  }
  /* What the map is actually painting: the single-site layer when it is visible, else the frame on show, and
     null when no radar layer is drawn at all (a basemap swap reloading, or the map not started yet). */
  function radarSourceKey(m, R) {
    if (!m || !R) return null;
    if (radarProd === "fcst") return fcDrawnKey(m);
    if (radarProd === "eet") return t2Drawn(m, "eet") ? "EET" : null;
    if (radarProd === "vel") return t2Drawn(m, "vel") ? "N0S" : null;
    if (radarProd !== "refl") { var rid = "rain-" + radarProd; return m.getLayer(rid) && +m.getPaintProperty(rid, "raster-opacity") > 0 ? RAIN[radarProd].key : null; }
    if (m.getLayer("site") && +m.getPaintProperty("site", "raster-opacity") > 0) return "N0B";
    var f = R.frames[R.idx];
    if (!f || !m.getLayer(f.id) || !(+m.getPaintProperty(f.id, "raster-opacity") > 0)) return null;
    if (f.kind === "fc") return "HRRR";
    return String(f.tiles || "").indexOf(IEM_ARCHIVE) === 0 ? "N0Q" : "MRMS";
  }
  function radarLegend(el, key, siteId, opacity) {
    if (!el) return;
    if (radarProd === "fcst") return fcLegend(el, key);
    if (radarProd === "eet") return eetLegend(el, key, opacity);
    if (radarProd === "vel") return velLegend(el, key, opacity);
    if (radarProd !== "refl") return rainLegend(el, key, opacity);
    var none = !RADAR_SRC[key], S = RADAR_SRC[none ? "MRMS" : key], op = Math.round(100 * (opacity || 0.82));
    var sig = (none ? "none" : key) + "|" + (key === "N0B" ? siteId || "" : "") + "|" + op + "|" + tailSig();
    if (el.dataset.sig === sig) return;          // the loop re-shows frames every 450 ms; redraw only on a change
    var name = key === "N0B" && siteId ? siteId + " " + S.name : S.name;
    el.dataset.sig = sig; el.dataset.src = none ? "none" : key; el.dataset.pal = S.pal;
    el.classList.add("rl");
    /* the strips are the source's exact colours at full strength; the map lays them over the imagery at its
       own opacity (0.82), so there they carry a little of the photo under them. Said once, in numbers. */
    el.innerHTML = '<div class="rl-head"><b>radar, is the gauge about to get 0.01?</b> <span class="rl-src">'
      + (none ? 'no radar drawn on the map right now; colors: ' + esc(S.name)
              : 'colors: ' + esc(name) + '; the map shows them at ' + op + '% opacity') + '</span></div>'
      + RADAR_BANDS.map(function (b) {
        return '<div class="rl-band"><i class="rl-strip" data-lo="' + b.lo + '" data-hi="' + b.hi + '" style="background-image:' + radarStrip(S.pal, b) + '"></i>'
          + '<span class="rl-say"><b>' + b.name + '</b> ' + b.rest + '</span></div>';
      }).join("")
      + '<div class="rl-note">radar estimate; the gauge settles it</div>'
      + legendTail();
  }
  /* each map's key redrawn from the picture that map is actually drawing (review of 8796b35: the camera file landing
     after the picture redrew the key with no source, so it said nothing was drawn over a drawn picture) */
  function refreshLegends() {
    ["live", "airport"].forEach(function (k) {
      var el = $("legend-" + k), m = maps[k], R = maps[k + "R"];
      if (!el || !el.innerHTML) return;
      if (m && R) radarLegend(el, radarSourceKey(m, R), m.__siteId, R.opacity); else radarLegend(el);   // no radar set up yet: none, truly
    });
  }
  function tailSig() { return (natCams ? "c" : "") + "|" + satSig(); }
  function legendTail() {
    return satNote() + (natCams ? '<div class="rl-note"><i class="sw natcam-sw"></i>DOT camera anywhere in the country: tap a dot for its picture, a big dot to zoom in</div>' : '')
      + '<div class="rl-pins"><span class="rl-pinhead">gauge pins:</span>'
      + Object.keys(STATES).map(function (k) { return '<span><i class="sw mk-' + k + '"></i>' + STATES[k].icon + ' ' + STATES[k].text + '</span>'; }).join("") + '</div>';
  }
  function baseStyle(kind) {
    var attr = "Imagery &copy; Esri, Maxar, Earthstar Geographics; radar NWS MRMS, Iowa Mesonet";
    if (kind === "dark") return { version: 8, sources: { b: { type: "raster", tileSize: 256, maxzoom: 16, attribution: attr, tiles: [ESRI_DARK] }, r: { type: "raster", tileSize: 256, maxzoom: 16, tiles: [ESRI_DARK_REF] } }, layers: [{ id: "base", type: "raster", source: "b" }, { id: "ref", type: "raster", source: "r", paint: { "raster-opacity": 0.85 } }] };
    if (kind === "radar-only") return { version: 8, sources: { b: { type: "raster", tileSize: 256, maxzoom: 16, attribution: attr, tiles: [ESRI_DARK] } }, layers: [{ id: "base", type: "raster", source: "b", paint: { "raster-opacity": 0.35 } }] };
    return { version: 8, sources: { b: { type: "raster", tileSize: 256, maxzoom: 19, attribution: attr, tiles: [ESRI_IMG] }, r: { type: "raster", tileSize: 256, maxzoom: 19, tiles: [ESRI_REF] } }, layers: [{ id: "base", type: "raster", source: "b" }, { id: "ref", type: "raster", source: "r", paint: { "raster-opacity": 0.9 } }] };
  }
  function makeMap(id, style, opts) {
    var m = new maplibregl.Map(Object.assign({ container: id, attributionControl: false, cooperativeGestures: matchMedia("(pointer: coarse)").matches, style: style }, opts));
    m.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // the (i) opens the attribution over the map's top: the warnings key moves under it at once, not at the next pan
    var ab = m.getContainer().querySelector(".maplibregl-ctrl-attrib-button"), wk = id === "map-live" ? "live" : "airport";
    if (ab) ab.addEventListener("click", function () { requestAnimationFrame(function () { if (m.getContainer().querySelector(".warnkey")) warnKey(wk); }); });
    m.on("styleimagemissing", function (e) { var c = document.createElement("canvas"); c.width = c.height = 2; m.addImage(e.id, c.getContext("2d").getImageData(0, 0, 2, 2)); });
    /* a forecast tile that fails or arrives is counted: the key and the control only say an hour is drawn once one of
       its tiles has come in, and a failed one sends the board back to the service's time list at once */
    m.on("error", function (e) { if (e && typeof e.sourceId === "string" && e.sourceId.indexOf("fc-") === 0) fcTileFailed(m, e.sourceId); });
    m.on("sourcedata", function (e) { if (e && e.tile && typeof e.sourceId === "string" && e.sourceId.indexOf("fc-") === 0) fcTileLoaded(m, e.sourceId); });
    return m;
  }
  function stampUTC(ms) { var d = new Date(ms); return d.getUTCFullYear() + ("0" + (d.getUTCMonth() + 1)).slice(-2) + ("0" + d.getUTCDate()).slice(-2) + ("0" + d.getUTCHours()).slice(-2) + ("0" + d.getUTCMinutes()).slice(-2); }
  function isoMin(ms) { return new Date(ms).toISOString().slice(0, 16) + ":00Z"; }
  /* ---------------- the frames: every one carries the time of the picture it draws ----------------
     Colin, 2026-09-24, the play bar: 2 h of observed radar, LIVE, then the HRRR forecast, the frame's time always shown.
     MRMS: the layer's own capabilities list every scan it holds (about 2 h, every 2 min), so a past frame asks for a real
     scan time and LIVE asks for the newest one and says it; before this the board asked for round times and stamped LIVE
     with the clock. No list: the frame says "scan time unknown".
     HRRR: IEM's refd_NNNN files are not one run. refd_0000 to refd_1080 are the newest hourly run every 15 min, refd_1140
     and up the newest 00, 06, 12 or 18Z run hourly (to refd_2160 through the WMS). The board used to stamp every file with
     refd_0000's run plus its minutes, so frames past 18 h were drawn 2 to 5 h late under the wrong run. Each forecast
     frame now reads its own refd_NNNN.json, and a frame whose file cannot be read stays off the bar. */
  var MRMS_CAPS = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows?service=WMS&version=1.3.0&request=GetCapabilities";
  var mrmsScans = { list: null, at: 0, err: null, promise: null };
  var hrrrRun = { frames: null, at: 0, sig: "", mixed: false, good: {}, missed: 0, err: null, promise: null }, hrrrMeta = {};
  function pad4(n) { return ("0000" + n).slice(-4); }
  function loadMrmsScans(maxAge) {
    if (mrmsScans.promise) return mrmsScans.promise;
    if (maxAge && mrmsScans.at && Date.now() - mrmsScans.at < maxAge) return Promise.resolve();
    mrmsScans.promise = fetch(MRMS_CAPS, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (x) {
      var mt = /<Dimension[^>]*name="time"[^>]*>([^<]+)<\/Dimension>/.exec(x);
      if (!mt) throw new Error("no scan list");
      var list = mt[1].split(",").map(function (s) { s = s.trim(); return { s: s, ms: Date.parse(s) }; })
        .filter(function (o) { return isFinite(o.ms); }).sort(function (a, b) { return a.ms - b.ms; });
      if (!list.length) throw new Error("empty scan list");
      mrmsScans.list = list; mrmsScans.err = null;
    }).catch(function (e) {
      mrmsScans.err = String((e && e.message) || e);   // the last good list stays; LIVE then shows its age
    }).then(function () { mrmsScans.at = Date.now(); mrmsScans.promise = null; });
    return mrmsScans.promise;
  }
  function hrrrJson(mm, bucket) {
    var k = mm + "|" + bucket;
    if (!hrrrMeta[k]) {
      hrrrMeta[k] = fetch(HRRR + "refd_" + pad4(mm) + ".json?t=" + bucket).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (j) {
        var init = Date.parse(j && j.model_init_utc), valid = Date.parse(j && j.model_forecast_utc);
        return isFinite(init) && isFinite(valid) ? { init: init, valid: valid } : null;
      }).catch(function () { return null; });
    }
    return hrrrMeta[k];
  }
  function runName(init, ext) {
    return "HRRR " + new Date(init).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric" }) + " CT run" + (ext ? " (extended)" : "");
  }
  /* the two runs' start times pick which files to read (15 min steps to 3 h ahead, 30 to 12 h, then hourly); each frame
     then takes its time and its run from its own file */
  function loadHrrr() {
    if (hrrrRun.promise) return hrrrRun.promise;
    var bucket = Math.floor(Date.now() / 300000);
    Object.keys(hrrrMeta).forEach(function (k) { if (+k.split("|")[1] < bucket - 1) delete hrrrMeta[k]; });
    hrrrRun.at = Date.now();
    hrrrRun.promise = Promise.all([hrrrJson(0, bucket), hrrrJson(1140, bucket)]).then(function (h) {
      if (!h[0]) { if (!hrrrRun.frames) hrrrRun.err = "HRRR run time unreadable"; return; }
      var sig = h[0].init + "|" + (h[1] ? h[1].init : "");
      /* the same two runs, every file read: nothing to do. The same runs with files that failed (IEM drops some of the ~60
         asked for at once): those files alone are read again, the ones read fine are kept (review, 2026-09-24: a frame
         whose file failed once stayed off the bar until the next run) */
      var same = hrrrRun.frames && sig === hrrrRun.sig && !hrrrRun.mixed, good = same ? hrrrRun.good : {};
      if (same && !hrrrRun.missed) return;
      var now = Date.now(), want = [], lastHourly = h[0].init + 1080 * 60000;
      for (var mm = 15; mm <= 2160; mm += mm < 1080 ? 15 : 60) {
        var ext = mm >= 1140, hint = ext ? h[1] : h[0]; if (!hint) continue;
        var lead = (hint.init + mm * 60000 - now) / 60000; if (lead <= 0) continue;
        if (ext && hint.init + mm * 60000 <= lastHourly) continue;     // the newer hourly run already covers it
        var step = lead <= 180 ? 15 : lead <= 720 ? 30 : 60; if (mm % step !== 0) continue;
        want.push(mm);
      }
      return Promise.all(want.map(function (mm) {
        return good[mm] ? { mm: mm, j: good[mm] } : hrrrJson(mm, bucket).then(function (j) { return j ? { mm: mm, j: j } : null; });
      })).then(function (got) {
        var fc = [], mixed = false, hourlyEnd = -Infinity, read = {}, missed = 0;
        got.forEach(function (g) {
          if (!g) { missed++; return; }
          read[g.mm] = g.j;
          var ext = g.mm >= 1140;
          if (g.j.init !== (ext ? h[1].init : h[0].init)) mixed = true;   // a run half written: read every file again next time
          if (!ext) hourlyEnd = Math.max(hourlyEnd, g.j.valid);
          fc.push({ kind: "fc", key: "HRRR", mm: g.mm, ext: ext, init: g.j.init, ms: g.j.valid, id: "f" + g.j.init + "_" + g.mm, src: runName(g.j.init, ext), maxzoom: 12 });
        });
        fc = fc.filter(function (f) { return !f.ext || f.ms > hourlyEnd; }).sort(function (a, b) { return a.ms - b.ms || b.init - a.init; })
          .filter(function (f, n, all) { return !n || f.ms !== all[n - 1].ms; });
        hrrrRun.frames = fc; hrrrRun.sig = sig; hrrrRun.mixed = mixed; hrrrRun.good = read; hrrrRun.missed = missed; hrrrRun.err = null;
      });
    }).catch(function () { if (!hrrrRun.frames) hrrrRun.err = "HRRR forecast unavailable"; })
      .then(function () { hrrrRun.promise = null; ["live", "airport"].forEach(function (k) { rebuildFrames(k); }); });
    return hrrrRun.promise;
  }
  function buildObs(now) {
    var n5 = Math.floor(now / 300000) * 300000, frames = [], t, list = mrmsScans.list;
    for (t = n5 - 24 * 3600000; t < n5 - 2 * 3600000; t += 600000) frames.push({ kind: "obs", key: "N0Q", src: "IEM composite", id: "a" + stampUTC(t), ms: t, tiles: IEM_ARCHIVE + stampUTC(t) + "/{z}/{x}/{y}.png", maxzoom: 11 });
    if (list && list.length) {
      var newest = list[list.length - 1], used = {};
      /* every 10 minutes to the round 10 before the last 5, so the step into LIVE is about 10 minutes like every other
         (it stopped at 20 before, a 20 to 25 minute jump into LIVE; review, 2026-09-24) */
      for (t = n5 - 2 * 3600000; t <= n5 - 600000; t += 600000) {
        var best = null;
        list.forEach(function (o) { if (o !== newest && Math.abs(o.ms - t) <= 300000 && (!best || Math.abs(o.ms - t) < Math.abs(best.ms - t))) best = o; });
        if (best && !used[best.s]) { used[best.s] = 1; frames.push({ kind: "obs", key: "MRMS", src: "NWS MRMS", scan: true, id: "m" + best.s, ms: best.ms, tiles: MRMS + "&time=" + best.s, maxzoom: 12 }); }
      }
      frames.push({ kind: "live", key: "MRMS", src: "NWS MRMS", scan: true, id: "live" + newest.s, ms: newest.ms, tiles: MRMS + "&time=" + newest.s, maxzoom: 12 });
    } else {
      for (t = n5 - 2 * 3600000; t <= n5 - 600000; t += 600000) frames.push({ kind: "obs", key: "MRMS", src: "NWS MRMS", scan: false, id: "m" + isoMin(t), ms: t, tiles: MRMS + "&time=" + isoMin(t), maxzoom: 12 });
      var bucket = Math.floor(now / 120000);
      frames.push({ kind: "live", key: "MRMS", src: "NWS MRMS", scan: false, id: "live" + bucket, ms: now, tiles: MRMS + "&_=" + bucket, maxzoom: 12 });
    }
    return frames;
  }
  /* the bar rebuilt from what is known now; frames that stay keep their layers, the ones that left lose theirs, and the
     frame on show stays on show (LIVE stays LIVE) */
  function rebuildFrames(mapKey) {
    var R = maps[mapKey + "R"], m = maps[mapKey]; if (!R || !$("ctl-" + mapKey)) return;
    var now = Date.now(), cur = R.frames[R.want != null ? R.want : R.idx], keep = {};
    var frames = buildObs(now).concat((hrrrRun.frames || []).filter(function (f) { return f.ms > now; }));
    frames.forEach(function (f) { keep[f.id] = true; });
    R.frames.forEach(function (f) {
      if (keep[f.id] || !R.added[f.id]) return;
      delete R.added[f.id];
      if (!m) return;
      try { if (m.getLayer(f.id)) m.removeLayer(f.id); if (m.getSource(f.id)) m.removeSource(f.id); }
      catch (e) { if (!/not done loading/i.test(String(e && e.message))) throw e; }   // a basemap swap: its style.load re-adds
    });
    R.frames = frames;
    R.nowIdx = 0; frames.forEach(function (f, n) { if (f.kind === "live") R.nowIdx = n; });
    R.loopStart = R.nowIdx; frames.forEach(function (f, n) { if (f.key === "MRMS" && n < R.loopStart) R.loopStart = n; });
    var idx = -1;
    if (cur && cur.kind !== "live") frames.forEach(function (f, n) { if (f.id === cur.id) idx = n; });
    if (idx < 0 && cur && cur.kind !== "live") {   // its frame left the bar: the nearest one in time
      var gap = Infinity; frames.forEach(function (f, n) { if (Math.abs(f.ms - cur.ms) < gap) { gap = Math.abs(f.ms - cur.ms); idx = n; } });
    }
    if (idx < 0) idx = R.nowIdx;
    R.idx = R.want = idx;
    finishFrames(mapKey);
  }
  function radarCtl(mapKey) {
    var R = maps[mapKey + "R"], el = $("ctl-" + mapKey);
    // layout A (2026-09-25): the valid time and its source come first, the picture choice and play after; reading order is visual order
    el.innerHTML = '<span class="ft">radar loading</span><span class="src"></span>'
      + '<div class="prodsel" role="group" aria-label="what the radar picture shows"><button data-p="refl">reflectivity</button><button data-p="daa">1-hour rain</button><button data-p="dta">storm total</button><button data-p="fcst">forecast</button><button data-more class="more" aria-expanded="false">more</button></div>'
      + '<div class="prodsel prodmore" role="group" aria-label="more radar pictures"><button data-p2="eet">echo tops</button><button data-p2="vel">velocity</button></div>'
      + '<button data-a="play">play</button><button data-a="live" class="on">LIVE</button><button data-a="prev">&#9664;</button><button data-a="next">&#9654;</button>'
      + '<div class="scrubwrap"><input type="range" min="0" max="0" value="0" aria-label="radar frame"><div class="zones"><span>24 h observed</span><span>Now</span><span class="fczone">HRRR forecast</span></div></div>';
    var scrub = el.querySelector("input"), play = el.querySelector('[data-a="play"]');
    function stop() { R.playing = false; clearTimeout(R.playT); play.textContent = "play"; }
    play.onclick = function () { R.playing = !R.playing; play.textContent = R.playing ? "pause" : "play"; if (R.playing) anim(mapKey); else clearTimeout(R.playT); };
    el.querySelector('[data-a="live"]').onclick = function () { stop(); show(mapKey, R.nowIdx); };
    el.querySelector('[data-a="prev"]').onclick = function () { stop(); show(mapKey, Math.max(0, R.idx - 1)); };
    el.querySelector('[data-a="next"]').onclick = function () { stop(); show(mapKey, Math.min(R.frames.length - 1, R.idx + 1)); };
    scrub.oninput = function () { stop(); show(mapKey, +scrub.value); };
    // data-p2: the second tier, a separate mark so "[data-p]" stays the four first-tier choices
    el.querySelectorAll("[data-p], [data-p2]").forEach(function (b) { b.onclick = function () { setRadarProd(b.dataset.p || b.dataset.p2); }; });
    el.querySelector("[data-more]").onclick = function () { moreOpen = !moreOpen; ["live", "airport"].forEach(function (k) { moreButtons($("ctl-" + k)); }); };
    /* the stored choice's mode at once, the same two toggles as show() and applyRadarProd(): show() waits for a loading
       style, 1 to 3 s on a slow phone, and until then a remembered rain picture showed the scrubber and play buttons
       (jules on c0de59d; the same on main) */
    el.classList.toggle("prodmode", radarProd !== "refl"); el.classList.toggle("fcmode", radarProd === "fcst");
    prodButtons(el);
  }
  function setupRadar(mapKey) {
    var R = { frames: [], idx: 0, nowIdx: 0, loopStart: 0, playing: false, added: {}, opacity: 0.82, timer: null, playT: null };
    maps[mapKey + "R"] = R;
    radarCtl(mapKey);
    if (RAIN[radarProd]) ensureRain(radarProd);
    if (radarProd === "fcst") ensureFc();
    if (radarProd === "eet") ensureEet();
    if (satOn) ensureSat();
    rebuildFrames(mapKey);
    loadMrmsScans(60000).then(function () { rebuildFrames(mapKey); });
    loadHrrr();   // rebuilds every map's bar when its files are read
    if (!R.timer) R.timer = setInterval(function () { refreshLive(mapKey); }, 120000);
  }
  function finishFrames(mapKey) {
    var R = maps[mapKey + "R"], el = $("ctl-" + mapKey), scrub = el.querySelector("input"), now = Date.now();
    scrub.max = String(R.frames.length - 1);
    var split = R.frames.length > 1 ? (100 * R.nowIdx / (R.frames.length - 1)).toFixed(1) + "%" : "100%";
    scrub.style.background = "linear-gradient(90deg, #1f2a44 0%, #1f2a44 " + split + ", rgba(251,191,36,.35) " + split + ", rgba(251,191,36,.35) 100%)";
    var last = R.frames[R.frames.length - 1], zone = el.querySelector(".fczone");
    // layout A (2026-09-25): sentence case, like every label on the page; the radar clock keeps its capitals (LIVE, OBSERVED)
    if (zone) zone.textContent = last && last.kind === "fc" ? "HRRR forecast " + Math.round((last.ms - now) / 3600000) + " h"
      : hrrrRun.err || hrrrRun.frames ? "forecast unavailable" : "forecast loading";
    show(mapKey, R.idx);
  }
  function ensure(mapKey, i) {
    var R = maps[mapKey + "R"], m = maps[mapKey], f = R.frames[i]; if (!f || R.added[f.id] || !m || !m.isStyleLoaded()) return;
    var raw = f.kind === "fc" ? HRRR_WMS + "&LAYERS=refd_" + pad4(f.mm) + "&BBOX={bbox-epsg-3857}&i=" + f.init : f.tiles;
    m.addSource(f.id, { type: "raster", tiles: [smoothUrl(f.key, raw)], tileSize: 256, maxzoom: f.maxzoom });
    m.addLayer({ id: f.id, type: "raster", source: f.id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "linear" } }, firstOverlayLayer(m));
    R.added[f.id] = true;
  }
  function firstOverlayLayer(m) { var ids = ["nwswarn-fill", "site", "natcams-cl", "ring6", "ring6line", "ring19line"]; for (var i = 0; i < ids.length; i++) if (m.getLayer(ids[i])) return ids[i]; return undefined; }
  function ctDay(ms) {   // a forecast can be tomorrow or the day after: the day is said when it is not today (Central)
    var o = { timeZone: "America/Chicago", weekday: "short" }, d = new Date(ms).toLocaleDateString("en-US", o);
    return d === new Date(Date.now()).toLocaleDateString("en-US", o) ? ctFromMs(ms) : d + " " + ctFromMs(ms);
  }
  function offsetText(ms) {
    var lead = Math.round((ms - Date.now()) / 60000), a = Math.abs(lead);
    return (lead < 0 ? "-" : "+") + (a >= 60 ? Math.floor(a / 60) + " h " + (a % 60) + " m" : a + " m");
  }
  /* layout A (2026-09-25): the radar's valid time is the page's one loud line, so the time and its age are two spans
     ("LIVE 9:12 AM CT" large, "(1 min ago)" beside it). The words are exactly frameText's: textContent is the same
     string, only the part from the first " (" on is its own span. Rebuilt only when the words change. The clock time
     that ends the large part ("12:54 AM CT", or "Thu 1:00 AM CT") is one unbreakable span, so a long product word
     wraps before the time and "CT" never sits alone on a line (phone QA on 661e587). */
  function setFt(ft, text) {
    if (ft.textContent === text) return;
    var i = text.indexOf(" (");
    if (i <= 0) { ft.textContent = text; return; }
    var t = document.createElement("span"), a = document.createElement("span"), head = text.slice(0, i);
    var c = /(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) )?\d{1,2}:\d{2} [AP]M CT$/.exec(head);
    t.className = "ft-t";
    if (c) {
      var clock = document.createElement("span"); clock.className = "ft-clock"; clock.textContent = c[0];
      if (c.index) t.append(document.createTextNode(head.slice(0, c.index)));
      t.append(clock);
    } else t.textContent = head;
    a.className = "ft-age"; a.textContent = text.slice(i + 1);
    ft.replaceChildren(t, document.createTextNode(" "), a);
  }
  function frameText(f) {
    if (f.kind === "fc") return "FORECAST " + ctDay(f.ms) + " (" + offsetText(f.ms) + "), " + f.src;
    if (f.kind === "live") {
      if (!f.scan) return "LIVE, scan time unknown";
      var age = Math.round((Date.now() - f.ms) / 60000);
      return "LIVE " + ctFromMs(f.ms) + " (" + (age <= 0 ? "just now" : age + " min ago") + ")";
    }
    if (f.key === "MRMS" && !f.scan) return "OBSERVED near " + ctFromMs(f.ms) + " (" + offsetText(f.ms) + ", scan time unknown)";
    return "OBSERVED " + ctFromMs(f.ms) + " (" + offsetText(f.ms) + ")";
  }
  function show(mapKey, i) {
    var R = maps[mapKey + "R"], m = maps[mapKey]; if (!R) return;
    R.want = i;
    /* ONE pending retry, and it shows the newest request. A timer per blocked call kept its own stale i, so a
       fast drag replayed every position for about 2 s and could settle on a frame Colin did not pick last
       (refute pass, 2026-09-24; the same on origin/main). */
    if (!m || !m.isStyleLoaded()) { if (!R.retry) R.retry = setTimeout(function () { R.retry = null; show(mapKey, R.want); }, 300); return; }
    var refl = radarProd === "refl", f = R.frames[i]; if (!f) return;
    R.idx = i;
    R.opacity = radarOpacity();
    /* playing: the next two are loading. Three cost frames on a slow phone (review, 2026-09-24; 4x slowed, real network,
       30 s of play: 14 and 7 frames over 50 ms with two, 20 with three, 14 and 16 on the base branch) */
    if (refl) for (var a = 0; a <= (R.playing ? 2 : 1); a++) ensure(mapKey, i + a);
    R.frames.forEach(function (g, j) { if (R.added[g.id] && m.getLayer(g.id)) m.setPaintProperty(g.id, "raster-opacity", refl && j === i ? R.opacity : 0); });
    var el = $("ctl-" + mapKey), ft = el.querySelector(".ft");
    el.classList.toggle("prodmode", !refl); el.classList.toggle("fcmode", radarProd === "fcst"); prodButtons(el); fcBar(el);
    if (radarProd === "fcst") fcCtlText(mapKey);
    else if (refl) {
      var old = f.kind === "live" && f.scan && Date.now() - f.ms > 20 * 60000;
      ft.className = "ft" + (f.kind === "fc" ? " fc" : "") + (old ? " stale" : "");
      setFt(ft, frameText(f));
      el.querySelector(".src").textContent = f.src + (f.kind === "live" ? ", 2-minute mosaic" : "");
    } else if (T2[radarProd]) t2CtlText(mapKey);
    else rainCtlText(mapKey);
    el.querySelector("input").value = String(i);
    el.querySelector('[data-a="live"]').classList.toggle("on", i === R.nowIdx);
    updateSite(mapKey);
  }
  /* play: from 2 h ago through LIVE into the forecast; the last frame holds 1.5 s before the loop starts again, and a
     frame whose tiles are still coming in gets up to 1.2 s so the loop cuts to a picture, not to an empty map */
  function anim(mapKey) {
    var R = maps[mapKey + "R"], m = maps[mapKey]; if (!R) return;
    clearTimeout(R.playT); if (!R.playing) return;
    var last = R.frames.length - 1, next = R.idx + 1;
    if (next > last) next = Math.min(R.loopStart || 0, last);
    var f = R.frames[next];
    if (f && m && R.added[f.id] && m.getSource(f.id) && !m.isSourceLoaded(f.id) && (R.waited || 0) < 1200) {
      R.waited = (R.waited || 0) + 100; R.playT = setTimeout(function () { anim(mapKey); }, 100); return;
    }
    R.waited = 0;
    show(mapKey, next);
    R.playT = setTimeout(function () { anim(mapKey); }, next === last ? 1500 : 450);
  }
  function refreshLive(mapKey) {
    if (!maps[mapKey + "R"]) return;
    loadMrmsScans(60000).then(function () { rebuildFrames(mapKey); });
    if (Date.now() - hrrrRun.at >= 300000) loadHrrr();
  }
  /* every frame change, zoom and city change lands here, so the legend is redrawn from what the map now paints.
     Not gated on isStyleLoaded(): that is false while ANY tile is still loading, and show() has just added a
     frame source, so the gate skipped this on most frame changes. The single-site layer then switched only when
     a later call happened to land with every tile loaded (on the station page at LIVE it was on in one headless
     run and off in the next, 2026-09-24), and a legend hooked here could not follow the picture (test_radar_legend.py). */
  function updateSite(mapKey) {
    var m = maps[mapKey], R = maps[mapKey + "R"]; if (!m || !R) return;
    try { satLayer(m); rainLayer(mapKey, m, R); fcLayer(m); eetLayer(m, R); velLayer(mapKey, m, R); siteLayer(mapKey, m, R); } catch (e) {
      /* only the one expected case is let through: a basemap swap's new style is still loading, so addSource
         throws "Style is not done loading"; its style.load handler re-runs show(), which lands here again.
         Anything else is a bug and must reach the page's error handler, not vanish. */
      if (!/not done loading/i.test(String(e && e.message))) throw e;
    }
    if (T2[radarProd]) t2CtlText(mapKey);   // velocity's words follow the zoom and the picked gauge
    radarLegend($("legend-" + mapKey), radarSourceKey(m, R), m.__siteId, R.opacity);
  }
  function siteLayer(mapKey, m, R) {
    var s = byIcao(mapKey === "airport" ? apIcao : liveSel), f = R.frames[R.idx];
    var tile = s ? settleFor(s).tile || {} : {}, fresh = !(tile.site_block_stale || tile.stale), id = s ? NEXRAD[s.city] : null;
    var want = radarProd === "refl" && !!(s && id && fresh && f && f.kind === "live" && m.getZoom() >= 10);
    var bucket = Math.floor(Date.now() / 300000);
    if (want && (m.__site !== id + bucket)) {
      if (m.getLayer("site")) m.removeLayer("site"); if (m.getSource("site")) m.removeSource("site");
      // N0B: single-site N0Q has had no scans since August 2026 and its tile is one frozen picture (collect_state.SITE_PRODUCT)
      m.addSource("site", { type: "raster", tileSize: 256, maxzoom: 12, tiles: [smoothUrl("N0B", IEM_SITE + id + "-N0B-0/{z}/{x}/{y}.png?t=" + bucket)] });
      m.addLayer({ id: "site", type: "raster", source: "site", paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "linear" } }, firstOverlayLayer(m));   // under the warning outlines
      m.__site = id + bucket; m.__siteId = id;
    }
    var on = want && !!m.getLayer("site");
    if (m.getLayer("site")) m.setPaintProperty("site", "raster-opacity", on ? R.opacity : 0);
    /* ONE radar picture at a time. The single site used to be drawn over the composite frame, both at 0.82, so
       the map blended N0B with MRMS on about half its pixels while the key and this control named N0B alone
       (refute pass, 2026-09-24). The frame now steps aside while the single site paints, and comes back when
       it goes (zoom out, a past frame, the US map). */
    if (f && m.getLayer(f.id)) m.setPaintProperty(f.id, "raster-opacity", on || radarProd !== "refl" ? 0 : R.opacity);
    if (!s || radarProd !== "refl") return;   // a rain product's control line is written by rainCtlText
    var src = $("ctl-" + mapKey).querySelector(".src"), base = (f || {}).src || "";
    if (on) src.textContent = id + " single radar, latest sweep (composite hidden under it)";
    else if (!fresh && m.getZoom() >= 10) src.textContent = base + " (single-site radar stale, not shown)";
    else src.textContent = base + ((R.frames[R.idx] || {}).kind === "live" ? ", 2-minute mosaic" : "");
  }

  /* ---------------- 1-hour rain and storm total (Colin, 2026-09-24) ----------------
     IEM's CONUS mosaics of the NWS level III DAA (1-hour) and DTA (storm total) rain estimates; measured in
     research/2026-09-24_rain_total_palettes.json. IEM's WMS for them (daa.cgi, dta.cgi) answers 200 with an EMPTY picture
     for any lon/lat box: the .tif it reads carries no georeferencing, so MapServer puts it in pixel space, and IEM's tile
     cache is blank for them too. So the board downloads the product's own PNG (6000 x 2600 palette indices, 0.01 degree
     pixels, the upper-left one centred on 126.00 W 50.00 N: IEM's own n0r.tfw, which its GeoTIFF of this file carries)
     and cuts map tiles from it here. Its time is the Last-Modified header of that same download: no other time exists for
     these files (no JSON beside them, no WMS TIME), and without it the board says "time unknown". */
  var IEM_USCOMP = "https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/";
  var RAIN_GRID = { w: 6000, h: 2600 };
  /* the 256 colours both products paint (the PNG's PLTE, row for row radcomp's iem_daa.tbl and iem_dta.tbl). The key uses the
     palette of the picture actually downloaded once there is one, and this measured copy before that. */
  var RAIN_PAL = "00000000008000008400008900008d00009200009600009b00009f0000a40000a80000ad0000b20000b60000bb0000bf0000c40000c80000cd0000d10000d60000da0000df0000e30000e80000ed0000f10000f60000fa0000ff0000ff0000ff0000ff0000ff0004ff0008ff000cff0010ff0014ff0018ff001cff0020ff0024ff0028ff002cff0030ff0034ff0038ff003cff0040ff0044ff0048ff004cff0050ff0054ff0058ff005cff0060ff0064ff0068ff006cff0070ff0074ff0078ff007cff0080ff0084ff0088ff008cff0090ff0094ff0098ff009cff00a0ff00a4ff00a8ff00acff00b0ff00b4ff00b8ff00bcff00c0ff00c4ff00c8ff00ccff00d0ff00d4ff00d8ff00dcfe00e0fb00e4f802e8f406ecf109f0ee0cf4eb0ff8e713fce416ffe119ffde1cffdb1fffd723ffd426ffd129ffce2cffca30ffc733ffc436ffc139ffbe3cffba40ffb743ffb446ffb149ffad4dffaa50ffa753ffa456ffa05aff9d5dff9a60ff9763ff9466ff906aff8d6dff8a70ff8773ff8377ff807aff7d7dff7a80ff7783ff7387ff708aff6d8dff6a90ff6694ff6397ff609aff5d9dff5aa0ff56a4ff53a7ff50aaff4dadff49b1ff46b4ff43b7ff40baff3cbeff39c1ff36c4ff33c7ff30caff2cceff29d1ff26d4ff23d7ff1fdbff1cdeff19e1ff16e4ff13e7ff0febff0ceeff09f1fc06f4f802f8f500fbf100feed00ffea00ffe600ffe200ffde00ffdb00ffd700ffd300ffd000ffcc00ffc800ffc400ffc100ffbd00ffb900ffb600ffb200ffae00ffab00ffa700ffa300ff9f00ff9c00ff9800ff9400ff9100ff8d00ff8900ff8600ff8200ff7e00ff7a00ff7700ff7300ff6f00ff6c00ff6800ff6400ff6000ff5d00ff5900ff5500ff5200ff4e00ff4a00ff4700ff4300ff3f00ff3b00ff3800ff3400ff3000ff2d00ff2900ff2500ff2200ff1e00ff1a00ff1600ff1300fa0f00f60b00f10800ed0400e80000e40000df0000da0000d60000d10000cd0000c80000c40000bf0000bb0000b60000b20000ad0000a80000a400009f00009b00009600009200008d0000890000ffffff";
  var RAIN = {
    daa: { key: "DAA", word: "1-hour rain", name: "IEM NEXRAD 1-hour precip", file: "daa_0.png", cal: [[1, 101, 0, 1], [101, 251, 1, 6]],
      what: "rain in the hour before it was made", head: "1-hour rain, has the gauge had 0.01 this hour?",
      bands: [[0, 0.01, "under 0.01"], [0.01, 0.10, "0.01 to 0.09"], [0.10, 0.25, "0.10 to 0.24"], [0.25, 0.50, "0.25 to 0.49"], [0.50, 1.00, "0.50 to 0.99"], [1.00, 2.00, "1.00 to 1.99"], [2.00, 6.00, "2.00 to 6.00"]] },
    dta: { key: "DTA", word: "storm total", name: "IEM NEXRAD storm total", file: "dta_0.png", cal: [[1, 101, 0, 2], [101, 201, 2, 6], [201, 251, 6, 21]],
      what: "rain since each radar's storm began", head: "storm total, rain since each radar's storm began",
      bands: [[0, 0.01, "under 0.01"], [0.01, 0.25, "0.01 to 0.24"], [0.25, 0.50, "0.25 to 0.49"], [0.50, 1.00, "0.50 to 0.99"], [1.00, 2.00, "1.00 to 1.99"], [2.00, 4.00, "2.00 to 3.99"], [4.00, 21.0, "4.00 to 21.0"]] }
  };
  var rainData = {}, rainProtocolOn = false, rainEmptyPng = null;
  /* IEM's own pixel rule (GEMPAK gdwgin.c with radcomp's nex2gini.tbl): inches to palette index */
  function rainIndex(prod, v) {
    var cal = RAIN[prod].cal;
    for (var k = 0; k < cal.length; k++) { var c = cal[k]; if (v <= c[3] + 1e-9) return Math.floor(((v - c[2]) * (c[1] - c[0]) / (c[3] - c[2]) + c[0]) * 255 / 251 + 0.5); }
    return 255;
  }
  function rainBandIdx(prod, n) { var b = RAIN[prod].bands[n]; return [rainIndex(prod, b[0]), n === RAIN[prod].bands.length - 1 ? 255 : rainIndex(prod, b[1]) - 1]; }
  function rainHex(pal, i) {
    if (!pal) return "#" + RAIN_PAL.substr(i * 6, 6);
    return "#" + [pal[3 * i], pal[3 * i + 1], pal[3 * i + 2]].map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  /* one flat step per palette index, exactly the picture's own steps */
  function rainStrip(pal, a, b) { return stepStrip(function (i) { return rainHex(pal, i); }, a, b); }
  function stepStrip(hexAt, a, b) {
    var n = b - a + 1, stops = [], prev = null, start = 0;
    for (var k = 0; k <= n; k++) {
      var c = k < n ? hexAt(a + k) : null;
      if (c !== prev) { if (prev) stops.push(prev + " " + (100 * start / n).toFixed(2) + "% " + (100 * k / n).toFixed(2) + "%"); prev = c; start = k; }
    }
    return "linear-gradient(90deg, " + stops.join(", ") + ")";
  }
  /* an 8-bit palette PNG unpacked to its indices, kept in the inflated buffer (one byte a pixel, rows led by their
     filter byte, un-filtered in place) so the 15.6 million pixels are not copied a second time */
  function decodeIndexedPng(buf) {
    var u = new Uint8Array(buf), dv = new DataView(buf), sig = [137, 80, 78, 71, 13, 10, 26, 10], p = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0, pal = null, parts = [];
    for (var s = 0; s < 8; s++) if (u[s] !== sig[s]) return Promise.reject(new Error("not a PNG"));
    while (p + 8 <= u.length) {
      var len = dv.getUint32(p), type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]), d = p + 8;
      if (type === "IHDR") { w = dv.getUint32(d); h = dv.getUint32(d + 4); depth = u[d + 8]; ctype = u[d + 9]; inter = u[d + 12]; }
      else if (type === "PLTE") pal = u.slice(d, d + len);
      else if (type === "IDAT") parts.push(u.subarray(d, d + len));
      else if (type === "IEND") break;
      p = d + len + 4;
    }
    if (ctype !== 3 || depth !== 8 || inter !== 0 || !pal || !parts.length) return Promise.reject(new Error("not an 8-bit palette PNG"));
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("this browser cannot unpack it"));
    return new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer().then(function (ab) {
      var raw = new Uint8Array(ab), st = w + 1;
      if (raw.length < st * h) throw new Error("short image data");
      for (var y = 0; y < h; y++) {
        var f = raw[y * st], o = y * st + 1, up = o - st, x, a, b, c, q;
        if (f === 0) continue;
        if (f === 1) { for (x = 1; x < w; x++) raw[o + x] = (raw[o + x] + raw[o + x - 1]) & 255; }
        else if (f === 2) { if (y) for (x = 0; x < w; x++) raw[o + x] = (raw[o + x] + raw[up + x]) & 255; }
        else if (f === 3) { for (x = 0; x < w; x++) { a = x ? raw[o + x - 1] : 0; b = y ? raw[up + x] : 0; raw[o + x] = (raw[o + x] + ((a + b) >> 1)) & 255; } }
        else if (f === 4) {
          for (x = 0; x < w; x++) {
            a = x ? raw[o + x - 1] : 0; b = y ? raw[up + x] : 0; c = x && y ? raw[up + x - 1] : 0; q = a + b - c;
            var pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
            raw[o + x] = (raw[o + x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          }
        } else throw new Error("bad PNG filter " + f);
      }
      var pl = new Uint8Array(768); pl.set(pal.subarray(0, Math.min(768, pal.length)));
      return { w: w, h: h, st: st, raw: raw, pal: pl };
    });
  }
  function loadRain(prod) {
    var P = rainData[prod] || (rainData[prod] = { state: "idle", ver: 0 });
    if (P.promise) return P.promise;
    if (P.state !== "ok") P.state = "loading";
    P.tried = Date.now();
    P.promise = fetch(IEM_USCOMP + RAIN[prod].file, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      var lm = Date.parse(r.headers.get("Last-Modified") || ""); lm = isFinite(lm) ? lm : null;
      if (P.img && lm !== null && lm === P.img.lastMod) return P.img;          // the same file: nothing to redo
      return r.arrayBuffer().then(decodeIndexedPng).then(function (img) { img.lastMod = lm; return img; });
    }).then(function (img) {
      if (img.w !== RAIN_GRID.w || img.h !== RAIN_GRID.h) throw new Error("its grid changed to " + img.w + " x " + img.h);
      if (img !== P.img) P.ver++;
      P.img = img; P.state = "ok"; P.err = null;
    }).catch(function (e) {
      P.img = null; P.state = "failed"; P.err = String((e && e.message) || e); P.ver++;   // unavailable: nothing is drawn
    }).then(function () { P.promise = null; applyRadarProd(); });
    return P.promise;
  }
  // fetch only when there is no good picture yet, or the one held is 5 minutes old (IEM makes one every 5)
  function ensureRain(p) { if (!RAIN[p]) return; var P = rainData[p]; if (!P || (!P.promise && (P.state !== "ok" || Date.now() - (P.tried || 0) >= 300000))) loadRain(p); }
  /* one 256 px map tile, nearest pixel. Index 0 is left clear (IEM's own OFFSITE 0 0 0), and so is index 1, under
     0.01 in: IEM paints it #000080 and 0.01 in #000084, one navy to the eye at the one threshold the 1-hour picture
     answers, so the board draws only 0.01 in and up and any colour on its map means at least 0.01 (review of 8796b35). */
  function rainTileRGBA(img, z, x, y) {
    var n = Math.pow(2, z), px = new Uint8ClampedArray(256 * 256 * 4), col = new Int32Array(256), row = new Int32Array(256), any = false, k, r, c;
    for (k = 0; k < 256; k++) {
      var i = Math.round(((x + (k + 0.5) / 256) / n * 360 - 180 + 126) * 100);
      col[k] = i >= 0 && i < img.w ? i + 1 : -1;
      var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (k + 0.5) / 256) / n))) * 180 / Math.PI, j = Math.round((50 - lat) * 100);
      row[k] = j >= 0 && j < img.h ? j * img.st : -1;
    }
    for (r = 0; r < 256; r++) {
      if (row[r] < 0) continue;
      for (c = 0; c < 256; c++) {
        if (col[c] < 0) continue;
        var v = img.raw[row[r] + col[c]]; if (v < 2) continue;
        var o = (r * 256 + c) * 4; px[o] = img.pal[3 * v]; px[o + 1] = img.pal[3 * v + 1]; px[o + 2] = img.pal[3 * v + 2]; px[o + 3] = 255; any = true;
      }
    }
    return any ? px : null;
  }
  function rgbaToPng(px) {
    var cv = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
    cv.getContext("2d").putImageData(new ImageData(px, 256, 256), 0, 0);
    if (cv.convertToBlob) return cv.convertToBlob({ type: "image/png" }).then(function (b) { return b.arrayBuffer(); });
    return new Promise(function (res, rej) { cv.toBlob(function (b) { if (b) b.arrayBuffer().then(res, rej); else rej(new Error("tile not encoded")); }, "image/png"); });
  }
  function registerRainProtocol() {
    if (rainProtocolOn || !window.maplibregl || !maplibregl.addProtocol) return;
    rainProtocolOn = true;
    maplibregl.addProtocol("rbrain", function (params) {
      var mt = /^rbrain:\/\/(daa|dta)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url), P = mt && rainData[mt[1]];
      if (!P || P.state !== "ok") return Promise.reject(new Error("rain picture not loaded"));
      var px = rainTileRGBA(P.img, +mt[2], +mt[3], +mt[4]);
      if (!px) { if (!rainEmptyPng) rainEmptyPng = rgbaToPng(new Uint8ClampedArray(256 * 256 * 4)); return rainEmptyPng.then(function (b) { return { data: b.slice(0) }; }); }
      return rgbaToPng(px).then(function (b) { return { data: b }; });
    });
  }
  window.rbRain = { data: rainData, tile: function (p, z, x, y) { var P = rainData[p]; return P && P.state === "ok" ? rainTileRGBA(P.img, z, x, y) : null; } };   // debug handle, used by the headless check
  function rainLayer(mapKey, m, R) {
    m.__rainUrl = m.__rainUrl || {};
    ["daa", "dta"].forEach(function (p) {
      var id = "rain-" + p, P = rainData[p], want = radarProd === p && !!P && P.state === "ok", url = "rbrain://" + p + "/{z}/{x}/{y}?v=" + (P ? P.ver : 0);
      if (m.getSource(id) && (!want || m.__rainUrl[p] !== url)) { if (m.getLayer(id)) m.removeLayer(id); m.removeSource(id); }
      if (!want) return;
      if (!m.getSource(id)) { m.addSource(id, { type: "raster", tiles: [url], tileSize: 256, maxzoom: 9, bounds: [-126.005, 24.005, -66.005, 50.005] }); m.__rainUrl[p] = url; }
      if (!m.getLayer(id)) m.addLayer({ id: id, type: "raster", source: id, paint: { "raster-opacity": R.opacity, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, firstOverlayLayer(m));
      else if (+m.getPaintProperty(id, "raster-opacity") !== R.opacity) m.setPaintProperty(id, "raster-opacity", R.opacity);   // clouds on or off
    });
  }
  function prodButtons(el) {
    if (!el) return;
    el.querySelectorAll("[data-p], [data-p2]").forEach(function (b) { var on = (b.dataset.p || b.dataset.p2) === radarProd; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    moreButtons(el);
  }
  function rainAge(img) {
    if (!img || img.lastMod === null) return null;
    var min = Math.round((Date.now() - img.lastMod) / 60000);
    return { txt: min <= 0 ? "just now" : min + " min ago", stale: min > 20 };
  }
  function rainCtlText(mapKey) {
    var el = $("ctl-" + mapKey); if (!el || !RAIN[radarProd]) return;
    var R = RAIN[radarProd], P = rainData[radarProd], ft = el.querySelector(".ft"), src = el.querySelector(".src"), word = R.word.toUpperCase();
    if (!ft || !src) return;
    var ok = P && P.state === "ok", a = ok ? rainAge(P.img) : null;
    ft.className = "ft" + ((P && P.state === "failed") || (a && a.stale) ? " stale" : "");
    setFt(ft, !P || P.state === "idle" || P.state === "loading" ? word + " loading"
      : !ok ? word + " unavailable, nothing drawn (" + P.err + ")"
      : word + (a ? " made " + ctFromMs(P.img.lastMod) + " (" + a.txt + (a.stale ? ", stale" : "") + ")" : ", time unknown"));
    src.textContent = R.name + ", latest image: " + R.what + "; the scrubber is for reflectivity";
  }
  function rainLegend(el, key, opacity) {
    var prod = radarProd, R = RAIN[prod], P = rainData[prod], drawn = key === R.key, op = Math.round(100 * (opacity || 0.82));
    var pal = P && P.state === "ok" ? P.img.pal : null, state = P ? P.state : "idle";
    var sig = "rain|" + prod + "|" + (drawn ? 1 : 0) + "|" + op + "|" + state + "|" + (pal ? P.ver : "m") + "|" + tailSig();
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig; el.dataset.src = drawn ? R.key : "none"; el.dataset.pal = R.key;
    el.classList.add("rl");
    var why = state === "failed" ? "unavailable" : state === "ok" ? "not on the map yet" : "loading";
    el.innerHTML = '<div class="rl-head"><b>' + esc(R.head) + '</b> <span class="rl-src">'
      + (drawn ? 'colors: ' + esc(R.name) + ', inches; the map shows them at ' + op + '% opacity'
               : 'nothing drawn right now (' + why + '); colors: ' + esc(R.name) + ', inches') + '</span></div>'
      + R.bands.map(function (b, n) {
        var ab = rainBandIdx(prod, n), clear = n === 0;   // under 0.01: drawn clear on the map, so a clear box here
        return '<div class="rl-band"><i class="rl-strip' + (clear ? ' rl-clear' : '') + '" data-i0="' + ab[0] + '" data-i1="' + ab[1] + '"' + (clear ? '' : ' style="background-image:' + rainStrip(pal, ab[0], ab[1]) + '"') + '></i>'
          + '<span class="rl-say"><b>' + b[2] + '</b> in' + (clear ? ', left clear' : '') + '</span></div>';
      }).join("")
      + '<div class="rl-note">radar estimate; the gauge settles it</div>'
      + (prod === "dta" ? '<div class="rl-note">each radar starts its total when its rain starts and resets after an hour dry, so totals can jump where two radars meet</div>' : '')
      + legendTail();
  }
  function setRadarProd(p) {
    if (p !== "refl" && p !== "fcst" && !RAIN[p] && !T2[p]) return;
    radarProd = p;
    try { localStorage.setItem("rb.radarprod", p); } catch (_) { /* the choice still applies until reload */ }
    ["live", "airport"].forEach(function (k) { var R = maps[k + "R"], pb = $("ctl-" + k) && $("ctl-" + k).querySelector('[data-a="play"]'); if (R && R.playing) { R.playing = false; clearTimeout(R.playT); if (pb) pb.textContent = "play"; } });
    if (p !== "fcst") fcPlay(false);
    ensureRain(p);
    if (p === "fcst") ensureFc();
    if (p === "eet") ensureEet();
    applyRadarProd();
  }
  /* both maps, now: the control's mode and words at once, the pictures through show() (which waits for a loading style) */
  function applyRadarProd() {
    ["live", "airport"].forEach(function (k) {
      var R = maps[k + "R"], el = $("ctl-" + k); if (!R || !el) return;
      el.classList.toggle("prodmode", radarProd !== "refl"); el.classList.toggle("fcmode", radarProd === "fcst"); prodButtons(el); rainCtlText(k); fcCtlText(k); t2CtlText(k);
      show(k, R.want != null ? R.want : R.idx);
    });
    satButtons();
  }
  // a new IEM image every 5 minutes; a failed one is retried after a minute; the age on the control ticks
  setInterval(function () {
    if (!RAIN[radarProd] || document.visibilityState === "hidden") return;
    var P = rainData[radarProd];
    if (!P || (!P.promise && Date.now() - (P.tried || 0) >= (P.state === "failed" ? 60000 : 300000))) loadRain(radarProd);
    ["live", "airport"].forEach(function (k) { if (maps[k + "R"]) rainCtlText(k); });
  }, 30000);

  /* ---------------- echo tops and velocity (Colin, 2026-09-25: "Next on the map, when you want: echo tops and velocity") ----------------
     Two more pictures, second tier behind the control's "more" toggle; measured in research/2026-09-25_echo_top_velocity_palettes.json.
     ECHO TOPS: IEM's CONUS composite of the NWS level III echo tops (EET), drawn by IEM's own WMS (eet.cgi, layer
     nexrad-eet-conus). Unlike daa.cgi and dta.cgi it answers real pictures in EPSG:3857: every coloured pixel of a real tile
     is a colour of the composite's own palette, and at z9 every one is the composite's own index at that place. The WMS has no
     TIME, so the time is meta.valid of the composite's own eet_0.json (that file's Last-Modified when it names no valid time,
     "time unknown" when it has neither). That file unreadable: unavailable, nothing drawn, as for the rain pictures.
     VELOCITY: IEM's single-site storm-relative velocity (N0S) of the picked gauge's own radar, the site id the N0B layer
     uses, drawn only zoomed in like the single site. Not N0U: IEM's N0U tiles answer 200, but their newest scans are from
     2022 and 2023 (OAX 2023-06-01), one frozen picture. The scan time is meta.valid of ridge/<site>/N0S_0.json; a scan older
     than 30 minutes (the collector's SITE_MAX_AGE_MIN), in the future, or with no readable time is NOT drawn, because a dead
     IEM site keeps serving its last picture. IEM paints each level by its speed and each radar lists its own levels (IWA:
     -70 -45 -30 ...; most: -64 -50 -36 ...), so the key reads that radar's own palette (the PLTE of its N0S_0.png) and that
     scan's own levels in knots (the product header of the very scan, from the Unidata level III archive). */
  var EET_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/eet.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=nexrad-eet-conus&STYLES=&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&BBOX={bbox-epsg-3857}";
  var IEM_RIDGE = "https://mesonet.agron.iastate.edu/data/gis/images/4326/ridge/";
  var L3_ARCHIVE = "https://unidata-nexrad-level3.s3.amazonaws.com/";
  // the composite's 72 colours, index = kft + 1 (IEM GIS/rasters.php?rid=9, row for row eet_0.gif's own PLTE)
  var EET_PAL = "0000000000005f73a7576da44f67a24761a0415b9e4568a64a76ae4f84b65492bf599fc75eadcf62bbd867c9e06fd6e861d6c552d6a243d67e35d65b11d11710c8160fc0150fb7140eaf130da6120d9e110c95100b8d0f0b840e0a7c0d09730c096b0b08620a1d6809467d086f920798a806c1bd05ead204ffdd00ffd300ffc900ffc000ffb600ffac00ffa200ff9900ff8f00ff8500ff0000f10000e30000d50000c60000b80000aa00009b00008d00007f0000710000fff5ffffdfffffc9ffffb3ffff9dffff75fff960faf34bf4ed36efe720e9e10be3";
  var T2 = {
    eet: { key: "EET", word: "echo tops", name: "IEM NEXRAD echo tops" },
    vel: { key: "N0S", word: "velocity", name: "storm-relative velocity (IEM N0S)" }
  };
  var eet = { state: "idle", tried: 0 }, velMeta = {}, VEL_MAX_AGE = 30 * 60000, T2_SKEW = 5 * 60000;
  var moreOpen = !!T2[radarProd];   // a second-tier choice kept on this device opens the row it lives in
  function loadEet() {
    if (eet.promise) return eet.promise;
    if (eet.state !== "ok") eet.state = "loading";
    eet.tried = Date.now();
    eet.promise = fetch(IEM_USCOMP + "eet_0.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      var lm = Date.parse(r.headers.get("Last-Modified") || "");
      return r.text().then(function (x) {
        var v = NaN;
        try { v = Date.parse(String(((JSON.parse(x) || {}).meta || {}).valid || "")); } catch (_) { v = NaN; }
        // both kept: IEM writes each composite about 90 s BEFORE the 5-minute slot it names (t2CtlText says which is shown)
        eet.valid = isFinite(v) ? v : null; eet.made = isFinite(lm) ? lm : null;
        eet.ms = eet.valid != null ? eet.valid : eet.made;   // which composite: the tiles' key
        eet.state = "ok"; eet.err = null;
      });
    }).catch(function (e) { eet.state = "failed"; eet.err = String((e && e.message) || e); eet.ms = eet.valid = eet.made = null; })
      .then(function () { eet.promise = null; applyRadarProd(); });
    return eet.promise;
  }
  // IEM makes a composite every 5 minutes: read its time again then; a failed read is tried again after a minute
  function ensureEet() { if (!eet.promise && (eet.state !== "ok" || Date.now() - eet.tried >= 300000)) loadEet(); }
  function eetLayer(m, R) {
    var want = radarProd === "eet" && eet.state === "ok";
    // the WMS draws whatever composite is current: its tiles are keyed to the time read, so a new composite is asked for
    var url = EET_WMS + "&t=" + (eet.ms || "u" + Math.floor(eet.tried / 300000));
    if (m.getSource("eet") && (!want || m.__eetUrl !== url)) { if (m.getLayer("eet")) m.removeLayer("eet"); m.removeSource("eet"); }
    if (!want) return;
    if (!m.getSource("eet")) { m.addSource("eet", { type: "raster", tiles: [url], tileSize: 256, maxzoom: 9, bounds: [-126, 23, -65, 50] }); m.__eetUrl = url; }
    // nearest pixel: the composite's own colours only, the key's colours exactly
    if (!m.getLayer("eet")) m.addLayer({ id: "eet", type: "raster", source: "eet", paint: { "raster-opacity": R.opacity, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, firstOverlayLayer(m));
    else if (+m.getPaintProperty("eet", "raster-opacity") !== R.opacity) m.setPaintProperty("eet", "raster-opacity", R.opacity);
  }
  function velGet(id) { return velMeta[id] || (velMeta[id] = { state: "idle", tried: 0, pal: { state: "idle" }, thr: { state: "idle" } }); }
  function pad2(n) { return ("0" + n).slice(-2); }
  // the palette an 8-bit PNG carries, one hex colour a row, read from its chunks (no pixels decoded)
  function pngPalette(buf) {
    var u = new Uint8Array(buf), dv = new DataView(buf), sig = [137, 80, 78, 71, 13, 10, 26, 10], p = 8;
    for (var s = 0; s < 8; s++) if (u[s] !== sig[s]) throw new Error("not a PNG");
    while (p + 8 <= u.length) {
      var len = dv.getUint32(p), type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]), d = p + 8, out = [];
      if (type === "PLTE") { for (var k = 0; k + 2 < len; k += 3) out.push("#" + [u[d + k], u[d + k + 1], u[d + k + 2]].map(function (x) { return pad2(x.toString(16)); }).join("")); return out; }
      if (type === "IDAT" || type === "IEND") break;
      p = d + len + 4;
    }
    throw new Error("no palette");
  }
  /* the 16 data levels of a level III storm-relative velocity product (56), from its own header: halfwords 31 to 46 of the
     product description block after the WMO heading; flags byte bit 7 a code (2 ND, 3 RF), bit 0 negative, low byte knots */
  function l3Levels(buf) {
    var u = new Uint8Array(buf), n = 0, p = -1;
    for (var k = 0; k + 2 < u.length && n < 2; k++) if (u[k] === 13 && u[k + 1] === 13 && u[k + 2] === 10) { n++; p = k + 3; k += 2; }
    if (n < 2 || p + 92 > u.length) throw new Error("no product header");
    var dv = new DataView(buf, p), out = [];
    if (dv.getInt16(0) !== 56) throw new Error("not a storm-relative velocity product");
    for (var h = 31; h <= 46; h++) { var w = dv.getUint16(2 * (h - 1)), fl = w >> 8, lo = w & 255; out.push(fl & 128 ? (lo === 2 ? "ND" : lo === 3 ? "RF" : "code " + lo) : fl & 1 ? -lo : lo); }
    for (var i = 1; i < 14; i++) if (typeof out[i] !== "number" || typeof out[i + 1] !== "number" || out[i] >= out[i + 1]) throw new Error("unexpected levels");
    if (out[0] !== "ND" || out[15] !== "RF") throw new Error("unexpected levels");
    return out;
  }
  function velPalLoad(id, V) {
    if (V.pal.promise) return;
    V.pal.promise = fetch(IEM_RIDGE + id + "/N0S_0.png", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
      .then(function (b) { var p = pngPalette(b); if (p.length < 16) throw new Error("a " + p.length + "-colour palette"); V.pal.list = p; V.pal.state = "ok"; V.pal.err = null; })
      .catch(function (e) { if (V.pal.state !== "ok") V.pal.state = "failed"; V.pal.err = String((e && e.message) || e); })   // a good palette of this radar stays
      .then(function () { V.pal.promise = null; refreshLegends(); });
  }
  function velThrLoad(id, V) {
    if (V.thr.promise || V.ms == null) return;
    var d = new Date(V.ms), key = id + "_N0S_" + [d.getUTCFullYear(), pad2(d.getUTCMonth() + 1), pad2(d.getUTCDate()), pad2(d.getUTCHours()), pad2(d.getUTCMinutes()), pad2(d.getUTCSeconds())].join("_"), ms = V.ms;
    V.thr.promise = fetch(L3_ARCHIVE + key, { headers: { Range: "bytes=0-255" } }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
      .then(function (b) { V.thr.list = l3Levels(b); V.thr.state = "ok"; V.thr.err = null; })
      .catch(function (e) { V.thr.list = null; V.thr.state = "failed"; V.thr.err = String((e && e.message) || e); })   // this scan's own levels or none
      .then(function () { V.thr.promise = null; V.thr.ms = ms; refreshLegends(); });
  }
  function loadVel(id) {
    var V = velGet(id);
    if (V.promise) return V.promise;
    if (V.state !== "ok") V.state = "loading";
    V.tried = Date.now();
    V.promise = fetch(IEM_RIDGE + id + "/N0S_0.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (x) {
        var s = null;
        try { s = ((JSON.parse(x) || {}).meta || {}).valid; } catch (_) { s = null; }
        // a time with no zone is no time (collect_state.site_scan_age); unknown is said, never guessed
        var ms = typeof s === "string" && /(Z|[+-]\d\d:?\d\d)$/.test(s) ? Date.parse(s) : NaN;
        V.state = "ok"; V.err = null;
        if (!isFinite(ms)) { V.ms = null; return; }
        var fresh = V.ms !== ms; V.ms = ms;
        if (fresh || V.thr.state === "failed") velThrLoad(id, V);   // a new scan brings its own levels, and so its own colours
        if (fresh || V.pal.state !== "ok") velPalLoad(id, V);
      })
      .catch(function (e) { V.state = "failed"; V.err = String((e && e.message) || e); V.ms = null; })
      .then(function () { V.promise = null; applyRadarProd(); });
    return V.promise;
  }
  // a scan every 4 to 10 minutes: its time is read again after 2; a failed read after a minute
  function ensureVel(id) { var V = velGet(id); if (!V.promise && Date.now() - V.tried >= (V.state === "ok" ? 120000 : V.state === "failed" ? 60000 : 0)) loadVel(id); }
  /* what velocity can draw on this map now: the picked gauge's radar, zoomed in, a readable scan time under 30 minutes old */
  function velNow(mapKey, m) {
    var s = byIcao(mapKey === "airport" ? apIcao : liveSel), id = s ? NEXRAD[s.city] : null, o = { s: s, id: id, V: id ? velMeta[id] : null };
    if (!s || !id) { o.why = "pick"; return o; }
    if (!m || m.getZoom() < 10) { o.why = "zoom"; return o; }
    var V = o.V;
    if (!V || V.state === "idle" || V.state === "loading") o.why = "loading";
    else if (V.state === "failed") o.why = "failed";
    else if (V.ms == null) o.why = "unknown";
    else if (Date.now() - V.ms > VEL_MAX_AGE) o.why = "old";
    else if (V.ms - Date.now() > T2_SKEW) o.why = "future";
    else o.draw = true;
    return o;
  }
  function velLayer(mapKey, m, R) {
    var on = radarProd === "vel", x = on ? velNow(mapKey, m) : {};
    if (on && x.id) ensureVel(x.id);
    var url = x.draw ? IEM_SITE + x.id + "-N0S-0/{z}/{x}/{y}.png?v=" + x.V.ms : null;
    if (m.getSource("vel") && (!x.draw || m.__velUrl !== url)) { if (m.getLayer("vel")) m.removeLayer("vel"); m.removeSource("vel"); }
    if (!x.draw) return;
    if (!m.getSource("vel")) { m.addSource("vel", { type: "raster", tiles: [url], tileSize: 256, maxzoom: 9 }); m.__velUrl = url; }
    if (!m.getLayer("vel")) m.addLayer({ id: "vel", type: "raster", source: "vel", paint: { "raster-opacity": R.opacity, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, firstOverlayLayer(m));
    else if (+m.getPaintProperty("vel", "raster-opacity") !== R.opacity) m.setPaintProperty("vel", "raster-opacity", R.opacity);
  }
  function t2Drawn(m, id) { return !!(m && m.getLayer(id) && +m.getPaintProperty(id, "raster-opacity") > 0); }
  function eetHex(i) { return "#" + EET_PAL.substr(i * 6, 6); }
  function agoText(ms) {
    var d = Date.now() - ms, min = Math.round(d / 60000);
    // a time ahead of this device's clock is said as ahead, never "just now"
    if (d < 0) return -min < 1 ? "under a minute from now" : -min + " min from now";
    return min <= 0 ? "just now" : min < 120 ? min + " min ago" : Math.round(min / 60) + " h ago";
  }
  function t2CtlText(mapKey) {
    var el = $("ctl-" + mapKey), m = maps[mapKey]; if (!el || !T2[radarProd]) return;
    var ft = el.querySelector(".ft"), src = el.querySelector(".src"), bad = false, txt;
    if (!ft || !src) return;
    /* a time is named only for a picture on the map: show() waits while the map loads tiles, so a product's time can be
       known seconds before its picture is placed (review, 2026-09-25); updateSite() writes this line again once it is */
    if (radarProd === "eet") {
      /* IEM names each composite by a 5-minute slot and writes it about 90 s BEFORE that slot (eet_0.json Last-Modified
         15:08:31Z, valid 15:10:00Z, 2026-09-25). The scans in it are no newer than its making, so the time shown, its age and
         the stale check are the earlier of the two; a time not reached yet is said as such, and one past T2_SKEW is no time */
      var tv = eet.valid, tm = eet.made, ahead = tv != null && tm != null && tv > tm, t = ahead ? tm : tv != null ? tv : tm;
      var fut = t != null && t - Date.now() > T2_SKEW, old = t != null && !fut && Date.now() - t > 20 * 60000;
      var eetOn = eet.state === "ok" && !!(m && m.getLayer("eet"));
      bad = eet.state === "failed" || (eetOn && (old || fut));
      txt = eet.state === "failed" ? "ECHO TOPS unavailable, nothing drawn (" + eet.err + ")"
        : !eetOn ? "ECHO TOPS loading"
        : t == null ? "ECHO TOPS, time unknown"
        : fut ? "ECHO TOPS time unknown (it says " + ctFromMs(t) + ", in the future)"
        : ahead ? "ECHO TOPS made " + ctFromMs(tm) + " (" + agoText(tm) + (old ? ", stale" : "") + "), composite for " + ctFromMs(tv)
        : "ECHO TOPS " + (tv == null ? "made " : tv > Date.now() ? "composite for " : "") + ctFromMs(t) + " (" + agoText(t) + (old ? ", stale" : "") + ")";
      src.textContent = "IEM NEXRAD echo tops composite, latest; the scrubber is for reflectivity";
    } else {
      var x = velNow(mapKey, m), V = x.V, w = "VELOCITY " + (x.id || "");
      bad = /failed|unknown|old|future/.test(x.why || "");
      txt = x.why === "pick" ? "VELOCITY: pick a gauge"
        : x.why === "zoom" ? "VELOCITY: zoom in on " + x.s.icao + " to see " + x.id
        : x.why === "loading" ? w + " loading"
        : x.why === "failed" ? w + " unavailable, nothing drawn (" + V.err + ")"
        : x.why === "unknown" ? w + " scan time unknown, nothing drawn"
        : x.why === "old" ? w + " newest scan " + ctFromMs(V.ms) + " (" + agoText(V.ms) + "), too old, nothing drawn"
        : x.why === "future" ? w + " scan time " + ctFromMs(V.ms) + " is in the future, nothing drawn"
        : !(m && m.getLayer("vel")) ? w + " loading"
        : w + " scan " + ctFromMs(V.ms) + " (" + agoText(V.ms) + ")";
      src.textContent = x.id ? x.id + " single radar, storm-relative velocity (IEM N0S), latest scan" : "one radar's velocity, drawn around a picked gauge";
    }
    ft.className = "ft" + (bad ? " stale" : "");
    setFt(ft, txt);
  }
  function eetLegend(el, key, opacity) {
    var drawn = key === "EET", op = Math.round(100 * (opacity || 0.82));
    var sig = "eet|" + (drawn ? 1 : 0) + "|" + op + "|" + eet.state + "|" + tailSig();
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig; el.dataset.src = drawn ? "EET" : "none"; el.dataset.pal = "EET";
    el.classList.add("rl");
    var why = eet.state === "failed" ? "unavailable" : eet.state === "ok" ? "not on the map yet" : "loading";
    // one flat step per kft (index 2 is 1 kft ... index 71 is 70 kft), exactly the composite's own steps
    var ticks = [1, 10, 20, 30, 40, 50, 60, 70];
    el.innerHTML = '<div class="rl-head"><b>echo tops, how high the storm\'s radar echo reaches</b> <span class="rl-src">'
      + (drawn ? 'colors: ' + esc(T2.eet.name) + ', thousands of feet (kft); the map shows them at ' + op + '% opacity'
               : 'nothing drawn right now (' + why + '); colors: ' + esc(T2.eet.name) + ', thousands of feet (kft)') + '</span></div>'
      + '<i class="rl-strip fc-strip eet-strip" data-i0="2" data-i1="71" style="background-image:' + stepStrip(eetHex, 2, 71) + '"></i>'
      + '<div class="fc-ticks">' + ticks.map(function (k, n) {
        var left = 100 * (k - 1) / 70;   // every tick at the start of its kft step, the 70 too (its label ends there)
        return '<span' + (n === 0 ? ' class="l"' : n === ticks.length - 1 ? ' class="r"' : '') + ' style="left:' + left.toFixed(2) + '%">' + k + '</span>';
      }).join("") + '</div>'
      + '<div class="rl-note">kft above sea level; taller tops are taller storms; radar estimate, the gauge settles it</div>'
      + legendTail();
  }
  function velLegend(el, key, opacity) {
    var mk = el.id === "legend-airport" ? "airport" : "live", x = velNow(mk, maps[mk]), V = x.V, drawn = key === "N0S", op = Math.round(100 * (opacity || 0.82));
    var P = V && V.pal.state === "ok" ? V.pal.list : null, T = V && V.thr.state === "ok" && V.thr.ms === V.ms ? V.thr.list : null;
    var sig = "vel|" + (x.id || "") + "|" + (drawn ? 1 : 0) + "|" + op + "|" + (x.why || "") + "|" + (P ? P.join("") : V ? V.pal.state : "") + "|" + (T ? T.join(",") : V ? V.thr.state : "") + "|" + tailSig();
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig; el.dataset.src = drawn ? "N0S" : "none"; el.dataset.pal = "N0S" + (x.id ? "-" + x.id : "");
    el.classList.add("rl");
    var why = { pick: "pick a gauge", zoom: "zoom in on the gauge", loading: "loading", failed: "unavailable", unknown: "scan time unknown", old: "newest scan too old", future: "scan time in the future" }[x.why] || "not on the map yet";
    var head = '<div class="rl-head"><b>velocity' + (x.id ? ' at ' + esc(x.id) : '') + ', toward and away from the radar</b> <span class="rl-src">'
      + (drawn ? 'colors: ' + esc(x.id) + '\'s own ' + esc(T2.vel.name) + ', knots; the map shows them at ' + op + '% opacity'
               : 'nothing drawn right now (' + why + ')' + (x.id ? '; colors: ' + esc(x.id) + '\'s own ' + esc(T2.vel.name) : '')) + '</span></div>';
    if (!x.id) { el.innerHTML = head + '<div class="rl-note">velocity is one radar\'s picture: pick a gauge and zoom in to see its radar</div>' + legendTail(); return; }
    var body;
    if (!P) body = '<div class="rl-note">colors ' + (V && V.pal.state === "failed" ? 'unavailable (' + esc(V.pal.err) + ')' : 'loading') + '</div>';
    else {
      // toward: levels 7 (slowest) to 1 (fastest); away: 8 to 14; each colour runs from its number to the next
      var rows = [["toward", [7, 6, 5, 4, 3, 2, 1], "the radar"], ["away", [8, 9, 10, 11, 12, 13, 14], "from the radar"]];
      body = rows.map(function (r) {
        var lv = r[1], n = lv.length;
        return '<div class="vk"><span class="rl-say"><b>' + r[0] + '</b> ' + r[2] + (T ? ', knots' : '') + '</span>'
          + '<i class="rl-strip vk-strip" data-dir="' + r[0] + '" data-lv="' + lv.join(",") + '" style="background-image:linear-gradient(90deg, '
          + lv.map(function (l, k) { return P[l] + " " + (100 * k / n).toFixed(2) + "% " + (100 * (k + 1) / n).toFixed(2) + "%"; }).join(", ") + ')"></i>'
          + (T ? '<div class="fc-ticks">' + lv.map(function (l, k) {
              return '<span' + (k === 0 ? ' class="l"' : '') + ' style="left:' + (100 * k / n).toFixed(2) + '%">' + Math.abs(T[l]) + (k === n - 1 ? '+' : '') + '</span>';
            }).join("") + '</div>' : '') + '</div>';
      }).join("")
        + '<div class="rl-note"><i class="sw" style="background:' + P[15] + '"></i>range folded: the radar cannot tell the speed there</div>';
    }
    el.innerHTML = head + body
      + '<div class="rl-note">' + (T ? 'each color runs from its number to the next, ' + esc(x.id) + '\'s own levels for the scan on show; 1 knot is 1.15 mph'
                                    : 'speeds unknown for this scan' + (V && V.thr.state === "failed" ? ' (its level III header: ' + esc(V.thr.err) + ')' : V && V.thr.promise ? ' yet (reading its level III header)' : '')) + '</div>'
      + '<div class="rl-note">storm-relative: the storm\'s own motion is taken out, so rotation and outflow stand out</div>'
      + legendTail();
  }
  // both maps' second-tier row: open, closed, and which choice it holds
  function moreButtons(el) {
    var b = el && el.querySelector("[data-more]"); if (!b) return;
    el.classList.toggle("moreopen", moreOpen);
    b.classList.toggle("on", !!T2[radarProd]);
    b.setAttribute("aria-expanded", moreOpen ? "true" : "false");
    b.textContent = moreOpen ? "less" : "more";
  }
  // the time lines tick; a new composite every 5 minutes, a new scan every 2; a failed read tried again after a minute
  setInterval(function () {
    if (!T2[radarProd] || document.visibilityState === "hidden") return;
    if (radarProd === "eet") { if (!eet.promise && Date.now() - eet.tried >= (eet.state === "failed" ? 60000 : 300000)) loadEet(); }
    ["live", "airport"].forEach(function (k) { if (maps[k + "R"]) { updateSite(k); t2CtlText(k); } });
  }, 30000);

  /* ---------------- forecast mode: NWS forecast grids out to 72 h (Colin, 2026-09-24) ----------------
     NOAA's GeoServer for the NDFD (mapservices.weather.noaa.gov/geoserver/ndfd/<layer>) answers with CORS, lists every valid
     time it holds in each layer's own capabilities, and serves each layer's colour ramp as JSON (premium_feel/PLAN.md,
     measured 2026-09-24). digital.weather.gov has the same fields but sends no CORS header, so a browser cannot draw it.
     Rain chance (pop12, 12 h) and rain amount (qpf, 6 h) are period fields whose time is the END of the period (checked
     against api.weather.gov); clouds and wind are snapshots, hourly to about 36 h and then every 3 h. The server publishes
     no issue time, and the board says so instead of guessing one. The slider offers only the times the service lists, every
     tile asks for its time by name (the WMS default hides which hour is drawn), and the key is the service's own ramp,
     fetched, never copied into this file. ONE picture: the forecast replaces the radar, the rain products and the clouds. */
  var NDFD = "https://mapservices.weather.noaa.gov/geoserver/ndfd/";
  var FC_FIELDS = {
    pop12: { layer: "pop12", word: "rain chance", period: 12, unit: "percent", head: "chance of rain in each 12 hours" },
    qpf: { layer: "qpf", word: "rain amount", period: 6, unit: "inches", head: "rain expected in each 6 hours" },
    sky: { layer: "sky", word: "clouds", unit: "percent of the sky covered", head: "cloud cover forecast" },
    wind: { layer: "wspd", word: "wind", arrows: "wdir", unit: "knots (1 knot is 1.15 mph)", head: "sustained wind forecast" },
    gust: { layer: "wgust", word: "gusts", unit: "knots (1 knot is 1.15 mph)", head: "wind gust forecast" }
  };
  var FC_ORDER = ["pop12", "qpf", "sky", "wind", "gust"], FC_OPACITY = 0.75, FC_HORIZON = 72 * 3600000;
  var fcCaps = {}, fcRamp = {}, fc = { t: null, playing: false, timer: null };
  /* NOAA drops the hour under way from a layer's list without notice (2026-09-25: sky's list lost 03Z at about 02:50Z
     while wspd still had it), and a tile asked for a dropped hour comes back HTTP 200 as an XML error, so the map stays
     empty. fcBad["layer|time"] is "checking" (a tile failed, the list is being asked again) or "failed" (the list still
     names it; tried again after 5 minutes). A bad hour is never drawn and never said to be drawn. */
  var fcBad = {}, FC_CAPS_AGE = 300000;
  function parseTimes(x) {
    var mt = /<Dimension[^>]*name="time"[^>]*>([^<]+)<\/Dimension>/.exec(x);
    if (!mt) throw new Error("no time list");
    var list = mt[1].split(",").map(function (s) { s = s.trim(); return { s: s, ms: Date.parse(s) }; })
      .filter(function (o) { return isFinite(o.ms); }).sort(function (a, b) { return a.ms - b.ms; });
    if (!list.length) throw new Error("empty time list");
    return list;
  }
  /* the service's ramp as it sends it; its "values" row (quantity 9999, all but clear) is a no-data marker, not a colour */
  function parseRamp(x) {
    var cm = JSON.parse(x).Legend[0].rules[0].symbolizers[0].Raster.colormap;
    var e = (cm.entries || []).map(function (o) { return { q: +o.quantity, c: String(o.color || ""), o: o.opacity == null ? 1 : +o.opacity, label: String(o.label == null ? o.quantity : o.label) }; })
      .filter(function (o) { return isFinite(o.q) && /^-?[\d.]/.test(o.label) && /^#[0-9a-f]{6}$/i.test(o.c); });
    if (e.length < 2) throw new Error("no colour ramp");
    return e;
  }
  // one fetch at a time per layer; a good answer is kept until maxAge, a failed one is asked again after a minute
  function fcGet(store, layer, url, parse, maxAge) {
    var C = store[layer] || (store[layer] = { state: "idle", at: 0 });
    if (C.promise || (C.state === "ok" && Date.now() - C.at < maxAge) || (C.state === "failed" && Date.now() - C.at < 60000)) return;
    if (C.state !== "ok") C.state = "loading";
    C.promise = fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (x) { C.data = parse(x); C.state = "ok"; C.err = null; })
      .catch(function (e) { if (C.state !== "ok") C.state = "failed"; C.err = String((e && e.message) || e); })   // a good list stays
      .then(function () { C.at = Date.now(); C.promise = null; if (store === fcCaps) fcSettle(layer); applyFc(); });
  }
  function capsGet(l) { fcGet(fcCaps, l, NDFD + l + "/ows?service=WMS&version=1.3.0&request=GetCapabilities", parseTimes, FC_CAPS_AGE); }
  function ensureFc() {
    var F = FC_FIELDS[fcField];
    [F.layer].concat(F.arrows ? [F.arrows] : []).forEach(capsGet);
    fcGet(fcRamp, F.layer, NDFD + F.layer + "/ows?service=WMS&version=1.3.0&request=GetLegendGraphic&format=application/json&layer=" + F.layer, parseRamp, 6 * 3600000);
  }
  // the slider's steps: snapshots from the one valid in the last hour to +72 h, periods from the one under way to the one starting before +72 h
  function fcTimes() {
    var F = FC_FIELDS[fcField], C = fcCaps[F.layer], now = Date.now(), per = (F.period || 0) * 3600000;
    if (!C || !C.data) return [];
    return C.data.filter(function (t) { return per ? t.ms > now && t.ms - per < now + FC_HORIZON : t.ms > now - 3600000 && t.ms <= now + FC_HORIZON; });
  }
  /* fc.t is the MOMENT on show, shared by every field: a snapshot's own time, or the start of a period (now, for the one
     under way). A new field shows the same moment: the period that holds it, or the snapshot nearest it. Nothing picked
     yet: the first step. */
  function fcMoment(t) { var per = (FC_FIELDS[fcField].period || 0) * 3600000; return per ? Math.max(Date.now(), t.ms - per) : t.ms; }
  function fcCur() {
    var list = fcTimes(), best = 0, n; if (!list.length) return null;
    if (fc.t != null) {
      if (FC_FIELDS[fcField].period) { best = list.length - 1; for (n = 0; n < list.length; n++) if (list[n].ms > fc.t) { best = n; break; } }
      else for (n = 1; n < list.length; n++) if (Math.abs(list[n].ms - fc.t) < Math.abs(list[best].ms - fc.t)) best = n;
    }
    return { i: best, t: list[best], list: list };
  }
  function arrowsAt(ms) {
    var F = FC_FIELDS[fcField], C = F.arrows && fcCaps[F.arrows];
    if (!C || !C.data) return null;
    for (var k = 0; k < C.data.length; k++) if (C.data[k].ms === ms) return fcBad[F.arrows + "|" + C.data[k].s] ? null : C.data[k];
    return null;
  }
  function fcBadOf(t) { return t ? fcBad[FC_FIELDS[fcField].layer + "|" + t.s] || null : null; }
  // a tile of this hour failed: say nothing is drawn, and ask the service's list again now, whatever its age
  function fcTileFailed(m, id) {
    var w = m.__fc && m.__fc[id]; if (!w || typeof w !== "object") return;
    var k = w.layer + "|" + w.s, C = fcCaps[w.layer];
    if (fcBad[k]) return;
    fcBad[k] = { state: "checking", at: Date.now() };
    if (C && !C.promise) C.at = 0;
    capsGet(w.layer); applyFc();
  }
  // the list came back: a checked hour it no longer names is simply gone (the slider has moved on); one it still names failed
  function fcSettle(layer) {
    var C = fcCaps[layer], now = Date.now();
    Object.keys(fcBad).forEach(function (k) {
      var cut = k.indexOf("|"), B = fcBad[k], s = k.slice(cut + 1);
      if (k.slice(0, cut) !== layer) return;
      if (B.state === "checking") {
        if (C && C.state === "ok" && C.data && !C.data.some(function (t) { return t.s === s; })) delete fcBad[k];
        else { B.state = "failed"; B.at = now; }
      } else if (now - B.at >= FC_CAPS_AGE) delete fcBad[k];
    });
  }
  // the first tile of the hour on show is in: the key can now say it is drawn
  function fcTileLoaded(m, id) {
    if (!m.__fc || !m.__fc[id]) return;
    m.__fcOk = m.__fcOk || {};
    if ((m.__fcOk[id] = (m.__fcOk[id] || 0) + 1) !== 1 || radarProd !== "fcst") return;
    ["live", "airport"].forEach(function (k) { if (maps[k] === m && maps[k + "R"]) radarLegend($("legend-" + k), radarSourceKey(m, maps[k + "R"]), m.__siteId, maps[k + "R"].opacity); });
  }
  function fcId(layer, ms) { return "fc-" + layer + "-" + ms; }
  function fcLayer(m) {
    var on = radarProd === "fcst", F = FC_FIELDS[fcField], cur = on ? fcCur() : null, want = {}, vis = {};
    m.__fc = m.__fc || {}; m.__fcOk = m.__fcOk || {};
    Object.keys(m.__fc).forEach(function (id) { if (!m.getLayer(id)) { delete m.__fc[id]; delete m.__fcOk[id]; } });   // a basemap swap took them
    if (cur) for (var a = 0; a <= (fc.playing ? 2 : 0); a++) {   // playing: the next two are loading
      var t = cur.list[(cur.i + a) % cur.list.length], at = arrowsAt(t.ms);
      if (fcBadOf(t)) continue;   // a failed hour: nothing of it is drawn, not even its arrows
      want[fcId(F.layer, t.ms)] = { layer: F.layer, s: t.s };
      if (at) want[fcId(F.arrows, t.ms)] = { layer: F.arrows, s: at.s, arrows: true };
      if (a === 0) { vis[fcId(F.layer, t.ms)] = FC_OPACITY; if (at) vis[fcId(F.arrows, t.ms)] = 1; }
    }
    /* only the hour on show (and, playing, the next two) is kept on the map. Every hour visited used to stay as a hidden
       layer, and a hidden raster layer still loads its tiles: after one wind loop, one pan sent 588 GetMap requests for 49
       hours (review, 2026-09-25). A step back asks for its tiles again. */
    Object.keys(m.__fc).forEach(function (id) {
      if (want[id]) return;
      m.removeLayer(id); if (m.getSource(id)) m.removeSource(id); delete m.__fc[id]; delete m.__fcOk[id];
    });
    Object.keys(want).forEach(function (id) {
      if (m.getLayer(id)) return;
      var w = want[id], paint = { "raster-opacity": 0, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "linear" };
      if (w.arrows) { paint["raster-brightness-min"] = 1; paint["raster-brightness-max"] = 0; }   // the server's black arrows, white on the dark map
      if (!m.getSource(id)) m.addSource(id, { type: "raster", tileSize: 256, maxzoom: w.arrows ? 11 : 7,   // the grid is 2.5 km; arrows stay arrow sized
        tiles: [NDFD + w.layer + "/ows?service=WMS&version=1.3.0&request=GetMap&layers=" + w.layer + "&styles=&crs=EPSG:3857&width=256&height=256&format=image/png&transparent=true&time=" + w.s + "&bbox={bbox-epsg-3857}"] });
      m.addLayer({ id: id, type: "raster", source: id, paint: paint }, firstOverlayLayer(m));
      m.__fc[id] = { layer: w.layer, s: w.s }; m.__fcOk[id] = 0;
    });
    Object.keys(m.__fc).forEach(function (id) { var o = vis[id] || 0; if (+m.getPaintProperty(id, "raster-opacity") !== o) m.setPaintProperty(id, "raster-opacity", o); });
  }
  function fcDrawnKey(m) {
    var cur = fcCur(); if (!cur || fcBadOf(cur.t)) return null;
    var id = fcId(FC_FIELDS[fcField].layer, cur.t.ms);   // drawn = on the map, visible, and at least one of its tiles in
    return m.getLayer(id) && +m.getPaintProperty(id, "raster-opacity") > 0 && m.__fcOk && m.__fcOk[id] > 0 ? "NDFD-" + fcField : null;
  }
  function fcWhen(ms) { return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" }) + " " + ctFromMs(ms); }
  function fcLabel(ms) {
    var F = FC_FIELDS[fcField];
    return F.period ? F.word + ", " + F.period + " h ending " + fcWhen(ms) : F.word + ", valid " + fcWhen(ms);
  }
  /* the forecast's own row (field, play, time slider) exists only while a forecast is on, so the radar control is exactly
     what it was the moment reflectivity or a rain product is chosen */
  function fcBar(el) {
    var bar = el.querySelector(".fcbar");
    if (radarProd !== "fcst") { if (bar) bar.remove(); return; }
    if (bar) return;
    el.insertAdjacentHTML("beforeend", '<div class="fcbar"><div class="prodsel fcsel" role="group" aria-label="which forecast">'
      + FC_ORDER.map(function (k) { return '<button data-fc="' + k + '">' + FC_FIELDS[k].word + '</button>'; }).join("") + '</div>'
      + '<button data-fa="play">play</button><div class="fcscrub"><input type="range" min="0" max="0" value="0" aria-label="forecast time">'
      + '<div class="zones"><span>Now</span><span class="fcend">+72 h</span></div></div></div>');
    el.querySelectorAll("[data-fc]").forEach(function (b) { b.onclick = function () { setFcField(b.dataset.fc); }; });
    el.querySelector('[data-fa="play"]').onclick = function () { fcPlay(!fc.playing); };
    el.querySelector(".fcscrub input").oninput = function () { fcPlay(false); var t = fcTimes()[+this.value]; if (t) { fc.t = fcMoment(t); applyFc(); } };
  }
  function fcCtlText(mapKey) {
    var el = $("ctl-" + mapKey); if (!el) return;
    fcBar(el);
    if (radarProd !== "fcst") return;
    var F = FC_FIELDS[fcField], C = fcCaps[F.layer], cur = fcCur(), bad = cur && fcBadOf(cur.t), ft = el.querySelector(".ft"), rg = el.querySelector(".fcscrub input");
    el.querySelectorAll("[data-fc]").forEach(function (b) { var on = b.dataset.fc === fcField; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    el.querySelector('[data-fa="play"]').textContent = fc.playing ? "pause" : "play";
    ft.className = "ft fc" + ((!cur && C && C.state === "failed") || bad ? " stale" : "");
    ft.textContent = bad ? fcLabel(cur.t.ms) + ": " + fcBadWhy(bad) + ", nothing drawn"
      : cur ? fcLabel(cur.t.ms)
      : !C || C.state === "idle" || C.state === "loading" ? F.word + " forecast loading"
      : C.state === "failed" ? F.word + " forecast unavailable, nothing drawn (" + C.err + ")"
      : F.word + ": no forecast time in the next 72 h, nothing drawn";
    el.querySelector(".src").textContent = "NWS forecast grids (NDFD), issue time not published"
      + (F.arrows && cur && !arrowsAt(cur.t.ms) ? "; wind arrows unavailable for this hour" : "");
    rg.max = String(cur ? cur.list.length - 1 : 0); rg.value = String(cur ? cur.i : 0); rg.disabled = !cur;
    el.querySelector(".fcend").textContent = cur ? "+" + Math.round((cur.list[cur.list.length - 1].ms - Date.now()) / 3600000) + " h" : "+72 h";
  }
  function rgbaOf(hex, o) { return "rgba(" + [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); }).join(", ") + ", " + o + ")"; }
  function fcBadWhy(B) { return B.state === "checking" ? "this hour is no longer offered by the NWS service" : "the NWS service did not draw this hour"; }
  function fcLegend(el, key) {
    var F = FC_FIELDS[fcField], K = fcRamp[F.layer], ks = K ? K.state : "idle", C = fcCaps[F.layer], drawn = key === "NDFD-" + fcField;
    var cur = fcCur(), bad = cur && fcBadOf(cur.t);
    var sig = "fc|" + fcField + "|" + (drawn ? 1 : 0) + "|" + ks + "|" + (C ? C.state : "idle") + "|" + (bad ? bad.state : "") + "|" + tailSig();
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig; el.dataset.src = drawn ? "NDFD-" + fcField : "none"; el.dataset.pal = "NDFD-" + F.layer;
    el.classList.add("rl");
    var strip, why = bad ? fcBadWhy(bad) : C && C.state === "failed" ? "unavailable" : C && C.state === "ok" ? "not on the map yet" : "loading";
    if (K && K.data) {
      /* one equal step per row of the service's ramp, blended inside each step the way the server blends (type ramp) */
      var e = K.data, n = e.length - 1, every = Math.max(1, Math.ceil(n / 5));
      strip = '<i class="rl-strip fc-strip" style="background-image:linear-gradient(90deg, ' + e.map(function (o, k) { return rgbaOf(o.c, o.o) + " " + (100 * k / n).toFixed(2) + "%"; }).join(", ") + ')"></i>'
        + '<div class="fc-ticks">' + e.map(function (o, k) {
          if (k !== n && (k % every || n - k < every)) return "";
          return '<span' + (k === 0 ? ' class="l"' : k === n ? ' class="r"' : '') + ' style="left:' + (100 * k / n).toFixed(2) + '%">' + esc(o.label) + '</span>';
        }).join("") + '</div>';
    } else strip = '<div class="rl-note">color key ' + (ks === "failed" ? "unavailable (" + esc(K.err) + ")" : "loading") + '</div>';
    el.innerHTML = '<div class="rl-head"><b>' + esc(F.head) + '</b> <span class="rl-src">'
      + (drawn ? 'colors: the NWS service\'s own ' + F.layer + ' scale, in ' + esc(F.unit) + '; the map shows them at ' + Math.round(FC_OPACITY * 100) + '% opacity'
               : 'nothing drawn right now (' + why + '); units: ' + esc(F.unit)) + '</span></div>'
      + strip
      + (F.arrows ? '<div class="rl-note">white arrows point where the wind is going; they carry no color meaning</div>' : '')
      + '<div class="rl-note">NWS forecast grids (NDFD), issue time not published; straight edges where two forecast offices meet are in the NWS data</div>'
      + legendTail();
  }
  function setFcField(k) {
    if (!FC_FIELDS[k]) return;
    fcField = k;
    try { localStorage.setItem("rb.fcfield", k); } catch (_) { /* the choice still applies until reload */ }
    ensureFc(); applyFc();
  }
  function applyFc() {
    if (radarProd !== "fcst") return;
    ["live", "airport"].forEach(function (k) { if (maps[k + "R"]) { fcCtlText(k); updateSite(k); } });
  }
  function fcPlay(on) {
    clearTimeout(fc.timer); fc.playing = !!on && radarProd === "fcst";
    ["live", "airport"].forEach(function (k) { var b = $("ctl-" + k) && $("ctl-" + k).querySelector('[data-fa="play"]'); if (b) b.textContent = fc.playing ? "pause" : "play"; });
    if (fc.playing) { applyFc(); fc.timer = setTimeout(fcStep, 800); }
  }
  // play: one step every 0.8 s to the last, which holds 1.5 s before the loop starts again
  function fcStep() {
    if (!fc.playing) return;
    var cur = fcCur(); if (!cur) { fcPlay(false); return; }
    var next = cur.i + 1 >= cur.list.length ? 0 : cur.i + 1;
    fc.t = fcMoment(cur.list[next]); applyFc();
    fc.timer = setTimeout(fcStep, next === cur.list.length - 1 ? 1500 : 800);
  }

  /* ---------------- satellite clouds (Colin, 2026-09-24) ----------------
     nowCOAST's GOES East and West longwave infrared: an image every 5 minutes, about 4 minutes behind, day and night. Its
     own capabilities list every image time, so the layer asks for the newest one by name and says it. It is drawn under the
     radar picture, on top of the basemap photo, never over the radar; while it is on, the radar or rain picture is drawn at
     full strength, so its colours are the key's colours exactly (see-through radar over white cloud tops reads lighter than
     its key). No time list: nothing is drawn and the key says the satellite time is unknown. A forecast is ONE picture on its
     own: the satellite steps aside while one is drawn. */
  var SAT_CAPS = "https://nowcoast.noaa.gov/geoserver/satellite/goes_longwave_imagery/ows?service=WMS&version=1.3.0&request=GetCapabilities";
  var SAT_WMS = "https://nowcoast.noaa.gov/geoserver/satellite/wms?service=WMS&version=1.3.0&request=GetMap&layers=goes_longwave_imagery&styles=&crs=EPSG:3857&width=256&height=256&format=image/png&transparent=true";
  var sat = { state: "idle", at: 0, promise: null };
  function ensureSat() {
    if (sat.promise || (sat.at && Date.now() - sat.at < (sat.state === "failed" ? 60000 : 150000))) return;
    if (sat.state !== "ok") sat.state = "loading";
    sat.promise = fetch(SAT_CAPS, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (x) { var list = parseTimes(x), last = list[list.length - 1]; sat.s = last.s; sat.ms = last.ms; sat.state = "ok"; sat.err = null; })
      .catch(function (e) { if (sat.state !== "ok") sat.state = "failed"; sat.err = String((e && e.message) || e); })   // the last good image stays, with its own time
      .then(function () { sat.at = Date.now(); sat.promise = null; applySat(); });
  }
  function satDrawn() { return satOn && radarProd !== "fcst" && sat.state === "ok"; }
  function radarOpacity() { return satDrawn() ? 1 : 0.82; }
  function satLayer(m) {
    var want = satDrawn(), url = want ? SAT_WMS + "&time=" + sat.s + "&bbox={bbox-epsg-3857}" : null;
    if (m.getSource("sat-ir") && (!want || m.__satUrl !== url)) { if (m.getLayer("sat-ir")) m.removeLayer("sat-ir"); m.removeSource("sat-ir"); }
    if (!want || m.getLayer("sat-ir")) return;
    var st = m.getStyle(), ls = (st && st.layers) || [], before;   // right on the basemap photo: under its labels and under every radar picture
    for (var i = 0; i < ls.length; i++) if (ls[i].id === "base") { before = ls[i + 1] ? ls[i + 1].id : undefined; break; }
    m.addSource("sat-ir", { type: "raster", tiles: [url], tileSize: 256, maxzoom: 8 }); m.__satUrl = url;
    m.addLayer({ id: "sat-ir", type: "raster", source: "sat-ir", paint: { "raster-opacity": 0.8, "raster-fade-duration": 0 } }, before);
  }
  function applySat() {
    satButtons();
    ["live", "airport"].forEach(function (k) { var R = maps[k + "R"]; if (R) show(k, R.want != null ? R.want : R.idx); });
  }
  function satButtons() {
    SAT_TOGGLES.forEach(function (id) {
      var b = $(id); if (!b) return;
      b.textContent = satOn ? "clouds on" : "clouds off"; b.classList.toggle("on", satOn); b.setAttribute("aria-pressed", satOn ? "true" : "false");
      b.title = radarProd === "fcst" ? "satellite clouds step aside while a forecast is drawn" : "show or hide GOES satellite clouds under the radar";
    });
  }
  function satAge() { return Math.round((Date.now() - sat.ms) / 60000); }
  function satSig() { return satOn ? "s|" + (radarProd === "fcst" ? "f" : sat.state) + "|" + (sat.ms || "") + "|" + (sat.ms ? satAge() : "") : "s0"; }
  function satNote() {
    if (!satOn) return "";
    var t, a;
    if (radarProd === "fcst") t = "satellite clouds hidden while a forecast is drawn";
    else if (sat.state === "ok") { a = satAge(); t = "clouds: GOES infrared (NOAA nowCOAST) " + ctFromMs(sat.ms) + " (" + (a <= 0 ? "just now" : a + " min old") + (a > 30 ? ", stale" : "") + "); the whiter, the colder and higher the cloud top; radar drawn at full strength over it"; }
    else if (sat.state === "failed") t = "clouds: satellite time unknown, nothing drawn (" + esc(sat.err) + ")";
    else t = "clouds: satellite loading";
    return '<div class="rl-note sat-note">' + t + '</div>';
  }
  // the satellite list every 2.5 minutes while it is on, the forecast hours as the clock moves; both keys tick their age
  setInterval(function () {
    if (document.visibilityState === "hidden" || !(maps.liveR || maps.airportR)) return;
    if (satOn) ensureSat();
    if (radarProd === "fcst") { ensureFc(); applyFc(); } else if (satOn) refreshLegends();
  }, 60000);

  /* ---------------- NWS warning outlines (Colin, 2026-09-24) ----------------
     The four warnings that matter for rain, fetched in the browser from api.weather.gov (it answers with
     Access-Control-Allow-Origin: *). message_type=alert alone returned 5 of the 29 active ones on 2026-09-24: a continued
     or extended warning is an Update, so both are asked for and any message a newer one references is dropped. Outline
     colours are the NWS map colours. A failed fetch draws nothing and says "warnings unavailable". */
  var WARN_TYPES = [["Flood Warning", "#00FF00", "flood"], ["Flash Flood Warning", "#8B0000", "flash flood"], ["Severe Thunderstorm Warning", "#FFA500", "severe t-storm"], ["Tornado Warning", "#FF0000", "tornado"]];
  var WARN_URL = "https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&event=" + WARN_TYPES.map(function (t) { return encodeURIComponent(t[0]); }).join(",");
  var WARN_LAYERS = ["nwswarn-fill", "nwswarn-case", "nwswarn-line"];
  var warnData = null, warnBoxes = [], warnNoOutline = [], warnAt = null, warnFailAt = null, warnLoading = null, warnPopup = null;
  function geoBox(g) {
    var b = [180, 90, -180, -90];
    (function walk(c) { if (!c || !c.length) return; if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[0]); b[2] = Math.max(b[2], c[0]); b[1] = Math.min(b[1], c[1]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); })(g.coordinates);
    return b;
  }
  function loadWarnings() {
    if (warnLoading) return warnLoading;
    warnLoading = fetch(WARN_URL, { headers: { Accept: "application/geo+json" }, cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !Array.isArray(j.features)) throw new Error("no feature list");
      var order = {}, refd = {}, feats = [], none = [], now = Date.now();
      WARN_TYPES.forEach(function (t, n) { order[t[0]] = n; });
      j.features.forEach(function (f) { ((f && f.properties && f.properties.references) || []).forEach(function (x) { if (x && x.identifier) refd[x.identifier] = true; }); });
      j.features.forEach(function (f) {
        var p = (f && f.properties) || {};
        if (!Object.prototype.hasOwnProperty.call(order, p.event) || p.messageType === "Cancel" || refd[p.id]) return;
        var end = Date.parse(p.ends || p.expires || ""); if (isFinite(end) && end <= now) return;
        var g = f.geometry; if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) { none.push(isFinite(end) ? end : null); return; }
        feats.push({ type: "Feature", geometry: g, properties: { ev: p.event, c: WARN_TYPES[order[p.event]][1], n: order[p.event], area: String(p.areaDesc || ""), end: isFinite(end) ? end : null, by: String(p.senderName || "") } });
      });
      feats.sort(function (a, b) { return a.properties.n - b.properties.n; });   // tornado drawn last, on top
      warnData = { type: "FeatureCollection", features: feats }; warnBoxes = feats.map(function (f) { return geoBox(f.geometry); });
      warnNoOutline = none; warnAt = Date.now(); warnFailAt = null;
    }).catch(function () { warnData = null; warnBoxes = []; warnNoOutline = []; warnFailAt = Date.now(); })
      .then(function () { warnLoading = null; applyWarn(); });
    return warnLoading;
  }
  // under the rings and the camera dots, over every radar picture (firstOverlayLayer puts the radar under nwswarn-fill)
  function warnBefore(m) {
    var ls = (m.getStyle() || {}).layers || [], above = { ring6: 1, ring6line: 1, ring19line: 1, "natcams-cl": 1, "natcams-pt": 1 };
    for (var i = 0; i < ls.length; i++) if (above[ls[i].id]) return ls[i].id;
    return undefined;
  }
  function ensureWarnLayers(m) {
    if (!m) return;
    var fc = warnOn && warnData ? warnData : { type: "FeatureCollection", features: [] }, vis = warnOn ? "visible" : "none";
    try {
      var s = m.getSource("nwswarn");
      if (s) s.setData(fc); else m.addSource("nwswarn", { type: "geojson", data: fc });
      var before = warnBefore(m);
      if (!m.getLayer("nwswarn-fill")) m.addLayer({ id: "nwswarn-fill", type: "fill", source: "nwswarn", layout: { visibility: vis }, paint: { "fill-color": ["get", "c"], "fill-opacity": 0.08 } }, before);
      if (!m.getLayer("nwswarn-case")) m.addLayer({ id: "nwswarn-case", type: "line", source: "nwswarn", layout: { visibility: vis, "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-opacity": 0.85, "line-width": 4.5 } }, before);
      if (!m.getLayer("nwswarn-line")) m.addLayer({ id: "nwswarn-line", type: "line", source: "nwswarn", layout: { visibility: vis, "line-join": "round" }, paint: { "line-color": ["get", "c"], "line-width": 2.5 } }, before);
      WARN_LAYERS.forEach(function (id) { m.setLayoutProperty(id, "visibility", vis); });
    } catch (e) {
      // the one expected case, as in updateSite: a style still loading; its load or style.load handler comes back here
      if (!/not done loading/i.test(String(e && e.message))) throw e;
    }
  }
  /* the end time is checked at every tick and on a returning tab, not only at the fetch: an ended warning leaves the map
     within half a minute (review of 8796b35) */
  function pruneWarn() {
    if (!warnData) return false;
    var now = Date.now(), keep = [], boxes = [], live = function (e) { return e === null || e === undefined || e > now; };
    warnData.features.forEach(function (f, i) { if (live(f.properties.end)) { keep.push(f); boxes.push(warnBoxes[i]); } });
    var noo = warnNoOutline.filter(live), changed = keep.length !== warnData.features.length || noo.length !== warnNoOutline.length;
    if (changed) { warnData = { type: "FeatureCollection", features: keep }; warnBoxes = boxes; warnNoOutline = noo; }
    return changed;
  }
  /* in view means some of the warning is drawn in view: an outline crossing the view, a corner inside it, or the view
     inside the warning. A bounding box alone counted a long diagonal river warning whose outline was nowhere on screen. */
  function orient(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }
  function segsCross(a, b, c, d) {
    return orient(c[0], c[1], d[0], d[1], a[0], a[1]) * orient(c[0], c[1], d[0], d[1], b[0], b[1]) <= 0
      && orient(a[0], a[1], b[0], b[1], c[0], c[1]) * orient(a[0], a[1], b[0], b[1], d[0], d[1]) <= 0;
  }
  function inRing(x, y, ring) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) { var a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
    return c;
  }
  function ringMeetsView(ring, W, S, E, N) {
    var sides = [[[W, S], [E, S]], [[E, S], [E, N]], [[E, N], [W, N]], [[W, N], [W, S]]];
    for (var i = 0; i < ring.length; i++) {
      var p = ring[i]; if (p[0] >= W && p[0] <= E && p[1] >= S && p[1] <= N) return true;
      if (i) for (var k = 0; k < 4; k++) if (segsCross(ring[i - 1], p, sides[k][0], sides[k][1])) return true;
    }
    return false;
  }
  function warnMeetsView(g, W, S, E, N) {
    var polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return polys.some(function (rings) {
      if (!rings || !rings.length) return false;
      if (rings.some(function (r) { return ringMeetsView(r, W, S, E, N); })) return true;
      // no outline in view: the view is either wholly inside the warning (and not in a hole) or wholly outside it
      return inRing(W, S, rings[0]) && !rings.slice(1).some(function (h) { return inRing(W, S, h); });
    });
  }
  function warnsInView(m) {
    if (!m || !warnData) return 0;
    var b = m.getBounds(), W = b.getWest(), E = b.getEast(), S = b.getSouth(), N = b.getNorth();
    return warnData.features.filter(function (f, i) { var x = warnBoxes[i]; return x[2] >= W && x[0] <= E && x[3] >= S && x[1] <= N && warnMeetsView(f.geometry, W, S, E, N); }).length;
  }
  // the key rides on the map itself: it costs the page no height, and it stays in view at full screen
  function warnKey(k) {
    var box = $(k === "live" ? "map-live" : "map-airport"); if (!box) return;
    var el = box.querySelector(".warnkey");
    if (!warnOn) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.className = "warnkey"; el.setAttribute("aria-live", "polite"); box.appendChild(el); }
    var failed = !!warnFailAt && !warnData, txt;
    if (failed) txt = "warnings unavailable (tried " + ctFromMs(warnFailAt) + ")";
    else if (!warnAt) txt = "NWS warnings loading";
    else {
      var n = warnsInView(maps[k]);
      var no = warnNoOutline.length;   // these have no outline, so no place: counted for the whole feed, said so
      txt = (n ? n + " NWS warning" + (n === 1 ? "" : "s") + " in view" : "no active warnings in view") + ", checked " + ctFromMs(warnAt)
        + (no ? "; " + no + " more nationwide " + (no === 1 ? "has" : "have") + " no outline to draw" : "");
    }
    var html = '<div class="wk-say">' + esc(txt) + '</div>' + (failed ? '' : '<div class="wk-types">' + WARN_TYPES.slice().reverse().map(function (t) { return '<span><i style="border-top-color:' + t[1] + '"></i>' + t[2] + '</span>'; }).join("") + '</div>');
    if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
    el.dataset.state = failed ? "failed" : !warnAt ? "loading" : "ok";
    /* under MapLibre's attribution text while it shows (until the first drag; it can wrap to three lines in a wide
       font), and under the exit button at full screen; the next move or resize places it again */
    var at = box.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show"), top0 = box.classList.contains("full") ? 60 : 10, top = top0;
    if (at) { var bb = box.getBoundingClientRect(), ar = at.getBoundingClientRect(); if (ar.height) top = Math.max(top, Math.round(ar.bottom - bb.top) + 6); }
    el.style.top = top + "px";
    /* the city card (live map, at 360 px it can fill two thirds of the map) never covers the key (review of 8796b35):
       the attribution folds first, as it does under a camera popup, and if the card still reaches the key the colour
       line goes (a tap on an outline still names it); the card closing brings it back */
    el.classList.remove("wk-tight");
    var card = box.querySelector(".mapcard"), cr = card && !card.classList.contains("hidden") ? card.getBoundingClientRect() : null;
    if (cr && cr.height) {
      var kr = el.getBoundingClientRect();
      if (kr.bottom > cr.top - 4 && at && maps[k]) { collapseAttrib(maps[k]); el.style.top = top0 + "px"; kr = el.getBoundingClientRect(); }
      if (kr.bottom > cr.top - 4) el.classList.add("wk-tight");
    }
  }
  function applyWarn() {
    pruneWarn();
    WARN_TOGGLES.forEach(function (id) { var b = $(id); if (b) { b.textContent = warnOn ? "warnings on" : "warnings off"; b.classList.toggle("on", warnOn); b.setAttribute("aria-pressed", warnOn ? "true" : "false"); } });
    ["live", "airport"].forEach(function (k) { if (maps[k]) { ensureWarnLayers(maps[k]); warnKey(k); } });
    if (!warnOn && warnPopup) { warnPopup.remove(); warnPopup = null; }
  }
  function untilTxt(ms) {
    if (ms === null || ms === undefined) return "no end time given";
    var day = function (t) { return new Date(t).toLocaleDateString("en-US", { timeZone: "America/Chicago" }); };
    return "until " + (day(ms) === day(Date.now()) ? "" : new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" }) + " ") + ctFromMs(ms);
  }
  function bindWarnings(m, k) {
    if (!m || m.__warnBound) return; m.__warnBound = true;
    var card = k === "live" && $("mapcard");   // the key moves out of the city card's way as it opens, shrinks and closes
    if (card && typeof ResizeObserver === "function") new ResizeObserver(function () { warnKey(k); }).observe(card);
    m.on("moveend", function () { warnKey(k); });
    m.on("resize", function () { warnKey(k); });
    m.on("click", function (e) {
      if (!warnOn || !m.getLayer("nwswarn-fill")) return;
      var p = e.point, cams = NATCAM_LAYERS.filter(function (id) { return !!m.getLayer(id); });
      if (camsOnMap && cams.length && m.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: cams }).length) return;   // a camera dot wins the tap
      var seen = {}, hits = m.queryRenderedFeatures(p, { layers: ["nwswarn-fill"] }).filter(function (f) { var q = f.properties, id = q.ev + "|" + q.area + "|" + q.end; if (seen[id]) return false; seen[id] = true; return true; });
      if (!hits.length) return;
      hits.sort(function (a, b) { return b.properties.n - a.properties.n; });
      var html = '<div class="warnpop">' + hits.map(function (f) {
        var q = f.properties, area = String(q.area || ""), end = q.end === null || q.end === undefined || q.end === "" ? null : +q.end;
        return '<div class="wp-one"><b><i style="border-top-color:' + esc(q.c) + '"></i>' + esc(q.ev) + '</b><div>' + esc(area.length > 180 ? area.slice(0, 177) + "..." : area) + '</div><div>' + esc(untilTxt(end)) + (q.by ? ' (' + esc(q.by) + ')' : '') + '</div></div>';
      }).join("") + '</div>';
      if (warnPopup) warnPopup.remove();
      warnPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "320px", offset: 8 }).setLngLat(e.lngLat).setHTML(html).addTo(m);
    });
  }
  function warnMapReady(m, k) {
    bindWarnings(m, k); ensureWarnLayers(m); warnKey(k);
    if (warnOn && !warnAt && !warnLoading) loadWarnings();
  }
  setInterval(function () { if (warnOn && document.visibilityState !== "hidden" && (maps.live || maps.airport)) loadWarnings(); }, 300000);
  setInterval(function () { if (document.visibilityState !== "hidden" && pruneWarn()) applyWarn(); }, 30000);
  /* ---- P3 #3 and #4: a returning tab (a phone pocket, a switched app) redraws the rain age, asks for a picture older
     than 5 minutes, drops ended warnings and asks the warning feed again when its answer is over 5 minutes old; the
     timers alone left an old picture called current and ended outlines drawn until their next tick (review of 8796b35) */
  function mapWake() {
    if (document.visibilityState === "hidden") return;
    if (RAIN[radarProd]) { ensureRain(radarProd); ["live", "airport"].forEach(function (k) { if (maps[k + "R"]) rainCtlText(k); }); }
    if (radarProd === "fcst") ensureFc();
    if (radarProd === "eet") ensureEet();
    if (satOn) ensureSat();
    if (!(maps.live || maps.airport)) return;
    if (T2[radarProd]) ["live", "airport"].forEach(function (k) { if (maps[k + "R"]) updateSite(k); });
    if (pruneWarn()) applyWarn();
    if (warnOn && !warnLoading && (!warnAt || Date.now() - warnAt > 300000)) loadWarnings();
  }
  document.addEventListener("visibilitychange", mapWake);
  window.addEventListener("pageshow", mapWake);
  window.addEventListener("focus", mapWake);

  /* 2. the big map */
  var liveMarkers = {}, liveSel = null, fitted = false;
  /* Colin, 2026-09-24 (phone): shrink the city card or X it out while keeping the city's map.
     The shape (full or one line) is remembered on the device; a closed card stays closed through
     the minute refresh and comes back from the chip on the map or a tap on the same marker. */
  var mapCardMini = false, mapCardClosed = false;
  try { mapCardMini = localStorage.getItem("rb.mapcard") === "mini"; } catch (_) { /* default full */ }
  function shapeMapCard() {
    var card = $("mapcard"); if (!card) return;
    card.classList.toggle("mini", mapCardMini);
    card.querySelectorAll('[data-mc="expand"]').forEach(function (b) { b.setAttribute("aria-expanded", mapCardMini ? "false" : "true"); });
  }
  function setMapCardMini(on) {
    mapCardMini = !!on;
    try { localStorage.setItem("rb.mapcard", mapCardMini ? "mini" : "full"); } catch (_) { /* the choice still applies until reload */ }
    shapeMapCard();
    var f = $("mapcard").querySelector(mapCardMini ? '[data-mc="expand"]' : '[data-mc="shrink"]'); if (f) f.focus({ preventScroll: true });
  }
  function showMapCard() {
    var s = liveSel && byIcao(liveSel), card = $("mapcard"), chip = $("mapcard-chip"); if (!s || !card) return;
    mapCardClosed = false; if (chip) chip.classList.add("hidden");
    card.innerHTML = mapCardHTML(s); shapeMapCard(); card.classList.remove("hidden"); bindMapCard(s);
  }
  function closeMapCard() {
    var s = liveSel && byIcao(liveSel), card = $("mapcard"), chip = $("mapcard-chip"); if (!s || !card) return;
    mapCardClosed = true; card.classList.add("hidden");
    if (chip) {
      chip.innerHTML = '&#9652; ' + esc(s.city) + ' card'; chip.setAttribute("aria-label", "show the " + s.city + " card");
      chip.onclick = showMapCard; chip.classList.remove("hidden"); chip.focus({ preventScroll: true });
    }
  }
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
    try { ensureRings(m, s); } catch (e) { m.once("styledata", function () { if(liveSel===icao)selectCity(icao,opts); }); return; }
    drawOverlays(m, s, liveOverlay);
    if (!opts.keepView) m.flyTo({ center: [s.lon, s.lat], zoom: Math.max(m.getZoom(), 10.2), speed: 1.4 });
    showMapCard();   // a new city, or the same one again, opens its card in the remembered shape
    renderMarkers(); renderQueue();
    m.once("moveend", function () { updateSite("live"); });
  }
  function clearCity() {
    liveSel = null; clearLiveOverlay(true); if (camPopup) { camPopup.remove(); camPopup = null; }
    mapCardClosed = false; if ($("mapcard-chip")) $("mapcard-chip").classList.add("hidden");
    $("mapcard").classList.add("hidden"); $("mapcard").innerHTML = "";
    // updateSite, not a bare opacity 0 on the site layer: the composite frame that stepped aside for it comes back
    if (maps.live) { fitAll(true); updateSite("live"); }
    renderMarkers(); renderQueue();
  }
  function mapCardHTML(s) {
    var w = wetState(s), o = s.observed || {}, m = s.market || {}, p = physPct(s), rel = physRel(p, s), win = rainWindow(s), e = nextEvent(s), ib = inbound(s), cs = cells(s), wn = wetNeighbours(s), ncam = camsFor(s).filter(ringAvailable).length;
    var cellTxt = cs.length ? cs.slice(0, 3).map(function (c) { var et = etaNow(c); return c.dbz + ' dBZ ' + mi(c.km) + ' mi ' + c.bearing + (et !== null ? ', <b>ETA ' + Math.round(et) + ' m</b>' : ', ' + cellMissText(c)); }).join('<br>') : 'no cell within 60 mi';
    var ev = evidenceRead(s), bf = briefFor(s), bigRaw = isLocked(s) ? gaugeAmt(s) : (p !== null ? pct(p) : '--'), big = esc(bigRaw);
    var d = STATES[w.k], word = (w.k === "LOCKED" ? "YES EXPECTED" : d.text) + (w.overdue && w.k !== "OVERDUE" ? " +OVERDUE" : "");
    var closeBtn = '<button class="mc-tool" data-mc="close" aria-label="hide the card" title="hide the card; the city stays on the map">&#x2716;</button>';
    return '<div class="mc-minirow"><button class="mc-mini" data-mc="expand" aria-expanded="' + (mapCardMini ? 'false' : 'true') + '" aria-label="expand the card: ' + esc(s.city + ' ' + bigRaw + ' ' + word) + '">'
      + '<b>' + esc(s.city) + '</b> <b class="num">' + big + '</b> <span class="st ' + w.k + '"><i>' + d.icon + '</i><span class="w">' + word + '</span></span><span class="mc-chev" aria-hidden="true">&#9652;</span></button>' + closeBtn + '</div>'
      + '<div class="mc-full">'
      + '<div class="mc-top"><div class="mc-id"><b class="mc-city">' + esc(s.city) + '</b> <small>' + s.icao + '</small></div>'
      + '<div class="mc-big num">' + big + '<small>' + (isLocked(s) ? 'YES expected; official result pending' : (p !== null ? 'v3, ' + esc(v3Rec(p, s)) : esc(physWord(s) || 'v3 unavailable'))) + '</small></div>'
      + '<div class="mc-tools"><button class="mc-tool" data-mc="shrink" aria-label="shrink the card" title="shrink the card to one line">&#9662;</button>' + closeBtn + '</div>'
      + '<div class="mc-state">' + stateChip(w) + '</div></div>'
      + '<div class="mc-ev ' + ev.cls + '">' + esc(ev.label) + '</div>'
      + (bf && bf.headline ? '<div class="mc-brief"><b>Today:</b> ' + esc(bf.headline) + ((briefStale() || stationBriefStale(bf)) ? ' <span class="stale">(briefing ' + esc(briefStale() || stationBriefStale(bf)) + ')</span>' : '') + '</div>' : '')
      + '<div class="mc-line"><b>' + esc(verdictSentence(s, w, p, m, win)) + '</b></div>'
      + '<div class="mc-grid num">'
      + '<span>gauge</span><span><b>' + gaugeTxt(s) + '</b> ' + agoTxt(o.latest_ob_utc) + '</span>'
      + '<span>market</span><span>YES <b>bid ' + quoteCents(marketQuote(m, "bid")) + ', ask ' + quoteCents(marketQuote(m, "ask")) + '</b>' + (m.momentum && m.momentum.delta_60m !== null && m.momentum.delta_60m !== undefined ? ' (' + (m.momentum.delta_60m > 0 ? '+' : '') + m.momentum.delta_60m + ' in 1 h)' : '') + '; ' + quoteFreshness(m) + '</span>'
      + '<span>next</span><span>' + (e ? esc(e.text) : (win ? 'rain hours ahead ' + esc(win.text) : 'no rain hour ahead')) + '</span>'
      + '<span>radar</span><span>' + pct(compRadar(s).pct10) + ' of 6 mi, ' + pct(compRadar(s).pct30) + ' of 19 mi (' + agoTxt(compRadar(s).frame_utc) + ')</span>'
      + '<span>cells</span><span>' + cellTxt + '</span>'
      + '<span>around</span><span>' + (wn.length ? '<b>' + wn.length + ' wet</b> of ' : '0 wet of ') + (s.neighbors || []).length + ' airports &middot; ' + ncam + ' cameras (' + (camsOnMap ? 'white boxes' : 'hidden, photos off') + ')</span>'
      + '</div>'
      + '<div class="mc-btns"><button data-mc="page">full page</button><button data-mc="prev">&#9664;</button><button data-mc="next">&#9654;</button><button data-mc="us">US map</button></div>'
      + '</div>';
  }
  function bindMapCard(s) {
    var card = $("mapcard"), order = stations().map(function (x) { return x.icao; }), i = order.indexOf(s.icao);
    card.querySelector('[data-mc="page"]').onclick = function () { go(s.icao); };
    card.querySelector('[data-mc="prev"]').onclick = function () { selectCity(order[(i - 1 + order.length) % order.length]); };
    card.querySelector('[data-mc="next"]').onclick = function () { selectCity(order[(i + 1) % order.length]); };
    card.querySelector('[data-mc="us"]').onclick = clearCity;
    card.querySelector('[data-mc="shrink"]').onclick = function () { setMapCardMini(true); };
    card.querySelector('[data-mc="expand"]').onclick = function () { setMapCardMini(false); };
    card.querySelectorAll('[data-mc="close"]').forEach(function (b) { b.onclick = closeMapCard; });
  }
  function ensureLiveMap() {
    if (maps.live) return;
    registerRainProtocol(); registerSmoothProtocol();
    maps.live = makeMap("map-live", baseStyle(basemap), { center: [-96.9, 38.4], zoom: 3.5, minZoom: 1.8, maxZoom: 13 });
    maps.live.on("load", function () { setupRadar("live"); renderMarkers(); if (!restoreView()) fitAll(false); if (camsOnMap) loadNatCams(); ensureNatCams(maps.live); warnMapReady(maps.live, "live"); });
    /* layout A (2026-09-25): on a phone this map is the page's full-bleed picture, and MapLibre's attribution opens by
       itself as a two or three line box over its top until the first drag; with the warnings key under it that was a
       quarter of the map on the first screen (critics on 661e587). There it starts folded to its (i) button, as it
       already folds under a camera popup or a city card; one tap on (i) shows the credit and the key moves under it. */
    if (matchMedia("(max-width: 899px)").matches) {
      var foldAttrib = function () {
        if (!maps.live.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")) return;
        collapseAttrib(maps.live);
        ["styledata", "sourcedata", "idle"].forEach(function (ev) { maps.live.off(ev, foldAttrib); });
        if (maps.live.getContainer().querySelector(".warnkey")) warnKey("live");
      };
      ["styledata", "sourcedata", "idle"].forEach(function (ev) { maps.live.on(ev, foldAttrib); });
    }
    bindNatCams(maps.live);
    window.addEventListener("resize", function () { if (maps.live && !liveSel) fitAll(false); });
    document.addEventListener("board:layout", function () {
      ["live", "airport"].forEach(function (key) { if (maps[key]) maps[key].resize(); });
    });
    maps.live.on("style.load", function () { var R = maps.liveR; if (R) { R.added = {}; maps.live.__site = null; show("live", R.want != null ? R.want : R.idx); } if (liveSel) { var s2 = byIcao(liveSel); if (s2) { ensureRings(maps.live, s2); } } ensureNatCams(maps.live); ensureWarnLayers(maps.live); });
    maps.live.on("zoomend", function () { updateSite("live"); });
    radarLegend($("legend-live"));
    /* diff: false, so the swap is a full style load and the style.load handler above rebuilds the radar frames,
       the single site and the rings. The default diff path deleted every one of them, never fired style.load,
       and left R.added listing frames that were gone, so the radar never came back, not even at LIVE
       (refute pass, 2026-09-24; the same on origin/main). updateSite right after tells the key there is no
       radar drawn until the rebuild lands. */
    $("basemap").querySelectorAll("button[data-b]").forEach(function (b) {
      b.onclick = function () { basemap = b.dataset.b; localStorage.setItem("rb.basemap", basemap); $("basemap").querySelectorAll("button[data-b]").forEach(function (x) { x.classList.toggle("on", x === b); }); maps.live.setStyle(baseStyle(basemap), { diff: false }); updateSite("live"); };
      b.classList.toggle("on", b.dataset.b === basemap);
    });
    CAMS_TOGGLES.forEach(function (id) {
      var camsBtn = $(id);
      if (camsBtn) camsBtn.onclick = function () { camsOnMap = !camsOnMap; try { localStorage.setItem("rb.mapcams", camsOnMap ? "on" : "off"); } catch (_) { /* the choice still applies until reload */ } applyCamsToggle(); var s2 = liveSel && byIcao(liveSel), card = $("mapcard"); if (s2 && card && !card.classList.contains("hidden")) { card.innerHTML = mapCardHTML(s2); bindMapCard(s2); } };
    });
    applyCamsToggle();
    WARN_TOGGLES.forEach(function (id) {
      var b = $(id);
      if (b) b.onclick = function () { warnOn = !warnOn; try { localStorage.setItem("rb.warnings", warnOn ? "on" : "off"); } catch (_) { /* the choice still applies until reload */ } if (warnOn && !warnLoading && (!warnAt || Date.now() - warnAt > 300000)) loadWarnings(); applyWarn(); };
    });
    applyWarn();
    SAT_TOGGLES.forEach(function (id) {
      var b = $(id);
      if (b) b.onclick = function () { satOn = !satOn; try { localStorage.setItem("rb.clouds", satOn ? "on" : "off"); } catch (_) { /* the choice still applies until reload */ } if (satOn) ensureSat(); applySat(); };
    });
    satButtons();
    // the map position survives a refresh and a return to the tab: saved on every move, restored
    // on boot when it is from the last 12 hours; a saved city selection is reopened the same way
    maps.live.on("moveend", function () { if (maps.live.__restoring) return; var c = maps.live.getCenter(); try { localStorage.setItem("rb.map", JSON.stringify({ lng: c.lng, lat: c.lat, zoom: maps.live.getZoom(), at: Date.now(), sel: liveSel })); } catch (_) { /* Resizing remains usable when device storage is disabled. */ } });
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
        el.onclick = function (ev) { ev.stopPropagation(); if (s.icao === liveSel && mapCardClosed) showMapCard(); else selectCity(s.icao); };   // the same city again only brings its card back; the view stays
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
      el.innerHTML = STATES[w.k].icon + '<span class="lbl">' + esc(s.city) + '</span>';
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
      registerRainProtocol(); registerSmoothProtocol();
      maps.airport = makeMap("map-airport", baseStyle("sat"), { center: [s.lon, s.lat], zoom: 12.5, minZoom: 5, maxZoom: 17 });   // WO-136: the ring reaches 80 mi
      maps.airport.on("load", function () { ensureRings(maps.airport, s); setupRadar("airport"); placeAirport(s); ensureNatCams(maps.airport); warnMapReady(maps.airport, "airport"); });
      bindNatCams(maps.airport);
      applyCamsToggle();
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
    renderChecks();
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
      /* Colin, 2026-09-24: "fit the ring on the map and back to gauge, neither one works". Both moved the map, but the
         map sits about 4,500 px above these buttons, so the move happened off screen. Each button now brings the map up. */
      var showApMap = function () { var el = $("map-airport"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" }); };
      $("ap-rings-fit").onclick = function (ev) { ev.preventDefault(); var cur = byIcao(apIcao); if (cur) { showApMap(); fitRing(cur); } };
      $("ap-rings-back").onclick = function (ev) { ev.preventDefault(); var cur = byIcao(apIcao); if (cur && maps.airport) { showApMap(); maps.airport.flyTo({ center: [cur.lon, cur.lat], zoom: 12.5 }); } };
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
    if (liveSel === s.icao && !mapCardClosed) { $("mapcard").innerHTML = mapCardHTML(s); bindMapCard(s); }
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
      + '<div class="big num">' + (isLocked(s) ? esc(gaugeAmt(s)) : (p !== null ? pct(p) : '--')) + '<small>' + (isLocked(s) ? 'YES expected; official result pending' : (p !== null ? 'v3 chance the gauge settles YES' + (rel ? ', measured ' + rel.actual_pct + '% at n=' + rel.n + (rel.n < 20 ? ' (thin)' : '') : ', unmeasured') : esc(physWord(s) || 'v3 unavailable'))) + '</small></div>'
      + '<div class="sub"><b>' + esc(verdictSentence(s, w, p, m, win)) + '</b></div>'
      + '<div class="contract">' + contractLine(s) + '</div>';
  }
  function forecastTimeline(s) { return typeof RainHours === "undefined" ? null : RainHours.build(s, settleFor(s).fc || {}); }
  function bindHourTargets(s) {
    var root=$('ap-hours'),bars=Array.from(root.querySelectorAll('.hours i:not(.cutoff)'));if(!bars.length)return;
    var saved=root.__selectedHour,day=s.local_day,keep=saved && saved.icao===s.icao && saved.day===day;
    var start=Date.parse(day+'T00:00:00Z')-(+(s.utc_offset_std||0))*3600000;
    if(!Number.isFinite(start))return; // codex on #197 (5b63902): no local_day gave NaN and Intl.DateTimeFormat threw RangeError, aborting the legacy render
    var controls=document.createElement('div');controls.className='hour-controls';
    controls.innerHTML='<button type="button" aria-label="Previous forecast hour">&lt;</button><select aria-label="Forecast hour in Central time"></select><button type="button" aria-label="Next forecast hour">&gt;</button>';
    var select=controls.querySelector('select'),buttons=controls.querySelectorAll('button');
    var hourFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
    bars.forEach(function(bar,i){var option=document.createElement('option');option.value=i;option.textContent=hourFormat.format(start+i*3600000);select.append(option);if(keep ? saved.ms===start+i*3600000 : bar.classList.contains('now'))select.value=i;});
    function show(){var i=+select.value;root.__selectedHour={icao:s.icao,day:day,ms:start+i*3600000};$('ap-hoursel').textContent=bars[i].title;buttons[0].disabled=i===0;buttons[1].disabled=i===bars.length-1;}
    select.onchange=show;buttons.forEach(function(button,i){button.onclick=function(){select.value=Math.max(0,Math.min(bars.length-1,+select.value+(i===0?-1:1)));show();};});
    $('ap-hours').querySelector('.hours').after(controls);show();
  }
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
    html+='</div><div class="hourlbl"><span>24 contract hours; labels in Central. BLUE: gauge recorded rain. AMBER: HRRR echo. The outlined bar is the current hour; the red line is the contract cutoff. Choose an hour for its timestamp.'+(data.hrrrTimingUnavailable?' HRRR timing unavailable for the cached run.':'')+(data.ambiguous?' Repeated local hours without a timestamp are omitted.':'')+'</span></div><div class="hoursel" id="ap-hoursel">'+esc($("ap-hoursel")?$("ap-hoursel").textContent:'')+'</div>';
    $("ap-hours").innerHTML=html;
    bindHourTargets(s);
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
    html += '</div><div class="hourlbl"><span>hours in Central; bar height = chance (higher of NWS and weather.com); BLUE bar = the gauge recorded rain that hour; AMBER top = HRRR paints echo; the outlined bar is now; the red line is the contract cutoff; choose an hour to read it</span></div><div class="hoursel" id="ap-hoursel">' + esc($("ap-hoursel") ? $("ap-hoursel").textContent : "") + '</div>';
    $("ap-hours").innerHTML = html;
    bindHourTargets(s);
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
      + '<span>echo rings</span><span>' + pct(r.pct10) + ' of 6 mi, ' + pct(r.pct30) + ' of 19 mi, ' + pct(r.pct60) + (r.rain_grade_dbz !== null && r.rain_grade_dbz !== undefined ? ' of 37 mi at 20 dBZ and up, ' + pct(r.pct30_strong) + ' of 19 mi heavy (40+)' : ' of 37 mi with echo, ' + pct(r.pct30_strong) + ' of 19 mi heavy (pre-upgrade reading)') + (r.max_dbz10 !== null && r.max_dbz10 !== undefined ? ', max ' + r.max_dbz10 + ' dBZ within the 6 mi ring' : '') + (r.pct10_any !== null && r.pct10_any !== undefined ? '; any echo at all ' + pct(r.pct10_any) + ' of 6 mi' : '')
      + ' (IEM N0Q composite; scan ' + (r.scan_valid_utc ? agoTxt(r.scan_valid_utc) : '<b class="stale">time unknown</b>') + ', read ' + agoTxt(r.read_utc || r.frame_utc) + (r.radar_quorum ? ', radars ' + esc(r.radar_quorum) : '') + ')'
      + (r.coverage30_pct !== undefined && r.coverage30_pct !== null && r.coverage30_pct < 100 ? '<br><b class="stale">only ' + r.coverage30_pct + '% of the 19 mi ring was sampled; the rest is missing tiles, not dry sky</b>' : '')
      + '<br><small>reflectivity is not rainfall and not the gauge; the map draws NWS MRMS, a different product of the same quantity</small></span>'
      + ringRecordHTML()
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
          + (ph.evidence === 'UNKNOWN' ? '; <b>gauge state unknown</b> (' + esc(ph.evidence_why || '') + '), so this is the whole-day figure with no dry-gauge credit' : '; ' + esc(condTxt(s, ph)))
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
      + '<span>Kalshi</span><span><b>YES bid ' + quoteCents(marketQuote(m, "bid")) + ', ask ' + quoteCents(marketQuote(m, "ask")) + '</b>, NO ask <b>' + quoteCents(marketNo(s)) + '</b> (1 minus the YES bid); ' + quoteFreshness(m) + '; snapshot last ' + cents(m.last) + ', vol ' + Math.round(m.volume || 0) + ', OI ' + Math.round(m.open_interest || 0) + ' (' + agoTxt(m.fetched_utc) + ')</span>'
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
    if (!u) return '<div class="ph">' + (c.type === "proxy" ? "picture on its way: the box is fetching this camera" : "no usable public camera URL") + '</div>';
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
  /* ---------------- national cameras (Colin, 2026-09-24 09:5x CT) ----------------
     "cameras in random locations all across the country that way i can actually see if what the radar is
     saying is actually true." build/cam_national.py writes every direct-picture DOT camera the board's keyless
     catalogs list (about 29,000); this draws them as one clustered GeoJSON layer. The file is fetched ONCE per
     page (never in the minute reload) and only while photos are on. The picture comes straight from the DOT and
     the popup says the board has not checked it. Circles carry no text: the basemap style has no glyphs. */
  var natCams = null, natCamsLoading = null, natCamsError = null, natCamsErrorAt = 0, NATCAM_RETRY_MS = 15 * 60000, NATCAM_LAYERS = ["natcams-cl", "natcams-pt"];
  function natCamToken(name, fallback) { var v = ""; try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (_) { v = ""; } return v || fallback; }
  function loadNatCams() {
    if (natCams || natCamsLoading) return natCamsLoading;
    // a failed load (a 404 before the first 03:10 run, a timeout on a weak link) is tried again after a back-off
    if (natCamsError && Date.now() - natCamsErrorAt < NATCAM_RETRY_MS) return null;
    natCamsError = null;
    // about 2.7 MB that changes once a day: an hourly key and the browser's normal cache, never the minute key
    natCamsLoading = fetchJSON("cams_national.json", 45000, { q: "h=" + Math.floor(Date.now() / 3600000), cache: "default" }).then(function (d) {
      if (!d || !Array.isArray(d.cams) || !d.srcs) throw new Error("cams_national.json has no camera list");
      var feats = [];
      d.cams.forEach(function (r, i) { if (Array.isArray(r) && isFinite(r[0]) && isFinite(r[1])) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [+r[0], +r[1]] }, properties: { i: i } }); });
      d.__geo = { type: "FeatureCollection", features: feats };
      natCams = d;
      ["live", "airport"].forEach(function (k) { if (maps[k]) ensureNatCams(maps[k]); });
      refreshLegends();
    }).catch(function (e) { natCamsError = String((e && e.message) || e); natCamsErrorAt = Date.now(); }).then(function () { natCamsLoading = null; });
    return natCamsLoading;
  }
  function ensureNatCams(m) {
    if (!m || !natCams || !natCams.__geo) return;
    try {
      if (!m.getSource("natcams")) m.addSource("natcams", { type: "geojson", data: natCams.__geo, cluster: true, clusterRadius: 42, clusterMaxZoom: 10 });
      var fill = natCamToken("--natcam", "#FFFFFF"), edge = natCamToken("--natcam-edge", "#0B3A55"), vis = camsOnMap ? "visible" : "none";
      if (!m.getLayer("natcams-cl")) m.addLayer({ id: "natcams-cl", type: "circle", source: "natcams", filter: ["has", "point_count"], layout: { visibility: vis },
        paint: { "circle-color": fill, "circle-opacity": 0.5, "circle-stroke-color": edge, "circle-stroke-width": 1.5, "circle-radius": ["step", ["get", "point_count"], 7, 10, 10, 50, 13, 250, 17, 1000, 22] } });
      if (!m.getLayer("natcams-pt")) m.addLayer({ id: "natcams-pt", type: "circle", source: "natcams", filter: ["!", ["has", "point_count"]], layout: { visibility: vis },
        paint: { "circle-color": fill, "circle-radius": 5, "circle-stroke-color": edge, "circle-stroke-width": 2 } });
    } catch (e) { m.once("styledata", function () { ensureNatCams(m); }); }
  }
  function collapseAttrib(m) {
    // the compact attribution opens by itself on a phone and only folds on a drag; over a camera it hid the dot and the close button
    var a = m.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
    if (a) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); }
  }
  function ctrlRects(m) {
    // the top-right controls in map px. They are 44 px tap targets: on a phone the folded attribution is about 88 x 44
    // and the zoom pair about 44 x 88 under it, so together they reach about 160 px down the right edge
    var c = m.getContainer(), cr = c.getBoundingClientRect(), out = [];
    c.querySelectorAll(".maplibregl-ctrl-top-right > .maplibregl-ctrl").forEach(function (el) {
      var r = el.getBoundingClientRect(); if (r.height && r.width) out.push({ left: r.left - cr.left, bottom: r.bottom - cr.top });
    });
    return out;
  }
  function popupInsideMap(m, pop, lngLat) {
    /* a national popup hangs below its dot (anchor top). The map pans so the whole popup sits inside the map box and
       clear of every top-right control: beside a control when the popup is narrow enough to fit left of it (a phone,
       see .natpop in style.css), else below it. The dot sits just above the picture and so is never under a control
       either: the radar colour at the camera and its picture are on screen together. */
    var el = pop && pop.getElement(); if (!el) return;
    var r = el.getBoundingClientRect(), c = m.getContainer().getBoundingClientRect(), pad = 6;
    var right = c.width - pad, top = pad + 12, left0 = r.left - c.left, dx = 0;
    ctrlRects(m).forEach(function (k) { if (r.width + 2 * pad <= k.left) right = Math.min(right, k.left - pad); else top = Math.max(top, k.bottom + 10); });
    if (left0 < pad) dx = left0 - pad; else if (left0 + r.width > right) dx = left0 + r.width - right;
    var p = m.project(lngLat), below = r.bottom - c.top - p.y, want = Math.max(top, Math.min(p.y, c.height - pad - below));
    var dy = p.y - want;
    if (dx || dy) m.panBy([dx, dy], { duration: 0 });
  }
  function openNatChooser(m, list, pos) {
    // several DOT cameras at one spot (Illinois lists one row per direction): pick one, as the gauge rings do
    if (camPopup) { camPopup.remove(); camPopup = null; }
    var html = '<div class="campop natpop natpick"><div class="cap"><b>' + list.length + ' cameras here</b>' + esc(list[0].source || '') + ' &middot; <span class="natnote">straight from the DOT, not checked by the board</span>'
      + list.map(function (c, i) { return '<button class="pick" data-i="' + i + '">' + esc(c.name.length > 70 ? c.name.slice(0, 70) + '...' : c.name) + '</button>'; }).join('') + '</div></div>';
    collapseAttrib(m);
    var pop = camPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "420px", offset: 12, anchor: "top" }).setLngLat(pos).setHTML(html).addTo(m);
    pop.__natChooser = true; pop.__icao = m === maps.airport ? m.__icao : null;
    pop.on("close", function () { if (camPopup === pop) camPopup = null; });
    pop.getElement().querySelectorAll(".pick").forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); var c = list[+b.dataset.i]; openCamPopup(m, null, c, [c.lon, c.lat], true); }; });
    popupInsideMap(m, pop, pos);
  }
  function natCamAt(i) {
    var r = natCams && natCams.cams[i]; if (!r) return null;
    var sp = (natCams.srcs || {})[r[3]] || {}, t = sp.tpl || ["", ""];
    return { type: "image", national: true, name: String(r[2] || "DOT camera"), url: String(t[0] || "") + String(r[4] || "") + String(t[1] || ""), source: sp.label || String(r[3] || ""), lon: +r[0], lat: +r[1] };
  }
  function bindNatCams(m) {
    if (!m || m.__natBound) return; m.__natBound = true;
    m.on("click", function (e) {
      if (!camsOnMap || !natCams || !m.getLayer("natcams-pt")) return;
      var p = e.point, r = 14, hits = m.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: NATCAM_LAYERS });
      if (!hits.length) return;
      hits.sort(function (a, b) { var pa = m.project(a.geometry.coordinates), pb = m.project(b.geometry.coordinates); return (Math.pow(pa.x - p.x, 2) + Math.pow(pa.y - p.y, 2)) - (Math.pow(pb.x - p.x, 2) + Math.pow(pb.y - p.y, 2)); });
      var f = hits[0], at = f.geometry.coordinates.slice();
      if (f.properties && f.properties.cluster) {
        var go = function (z) { m.easeTo({ center: at, zoom: Math.min((typeof z === "number" ? z : m.getZoom() + 2), m.getMaxZoom()) }); };
        var src = m.getSource("natcams"), ret = src.getClusterExpansionZoom(f.properties.cluster_id, function (err, z) { if (!err) go(z); });
        if (ret && typeof ret.then === "function") ret.then(go, function () { go(null); });
        return;
      }
      var c = natCamAt(f.properties && f.properties.i); if (!c) return;
      var spot = function (i) { var r = natCams.cams[i]; return r ? (+r[0]).toFixed(4) + "," + (+r[1]).toFixed(4) : ""; }, here = spot(f.properties.i), seen = {}, group = [];
      hits.forEach(function (h) { var i = h.properties && h.properties.i; if (h.properties && !h.properties.cluster && !seen[i] && spot(i) === here) { seen[i] = 1; var g = natCamAt(i); if (g) group.push(g); } });
      if (group.length > 1) { group.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }); openNatChooser(m, group, [c.lon, c.lat]); return; }
      openCamPopup(m, null, c, [c.lon, c.lat], true);
    });
    NATCAM_LAYERS.forEach(function (id) {
      m.on("mouseenter", id, function () { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", id, function () { m.getCanvas().style.cursor = ""; });
    });
  }
  function openCamChooser(m, s, g, key) {
    if (camPopup) { camPopup.remove(); camPopup = null; }
    var html = '<div class="campop"><div class="cap"><b>' + g.cams.length + ' cameras here, ' + mi(g.cams[0].dist_km) + ' mi ' + esc(g.cams[0].dir || '') + ' of the gauge</b>' + g.cams.map(function (c, i) { return '<button class="pick" data-i="' + i + '">' + esc(c.name.length > 70 ? c.name.slice(0, 70) + '...' : c.name) + '</button>'; }).join('') + '</div></div>';
    camPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: "420px", offset: 12 }).setLngLat(g.pos).setHTML(html).addTo(m);
    camPopup.__icao = s.icao;
    camPopup.on("close", function () { camPopup = null; });
    camPopup.getElement().querySelectorAll(".pick").forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); openCamPopup(m, s, g.cams[+b.dataset.i], g.pos, g.exact); }; });
  }
  function openCamPopup(m, s, c, lngLat, exact) {
    if (!c.national && !ringAvailable(c)) return;
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
    var ringNote = c.national ? '' : '<br><small>' + esc(ringFreshTxt(c)) + '</small>';   // codex round 4: a ring camera's health travels into the map popup
    var where = c.national ? esc(c.source || '') + ' &middot; <span class="natnote">straight from the DOT, not checked by the board</span>'
      : mi(c.dist_km) + ' mi ' + esc(c.dir || '') + ' of the gauge' + (exact ? '' : ', placed by distance and bearing');
    var html = '<div class="campop' + (c.national ? ' natpop' : '') + '">' + media + '<div class="cap"><b>' + esc(c.name) + '</b>' + where + ' &middot; ' + (c.type === "youtube" ? 'live stream' : 'still image, requested again each minute') + '</div></div>';
    // open on the side AWAY from the gauge pin so the picture never covers it. A national camera has no gauge: the
    // picture hangs below the dot, centred on it, and the map pans until the whole picture is inside the map box
    var opts = { closeButton: true, closeOnClick: !!c.national, maxWidth: "420px", offset: 12, anchor: "top" };
    if (s) { var dx = lngLat[0] - s.lon, dy = lngLat[1] - s.lat; opts.anchor = Math.abs(dy) >= Math.abs(dx) * 0.6 ? (dy > 0 ? "bottom" : "top") : (dx > 0 ? "left" : "right"); }
    if (c.national) collapseAttrib(m);
    camPopup = new maplibregl.Popup(opts).setLngLat(lngLat).setHTML(html).addTo(m);
    if (!s) popupInsideMap(m, camPopup, lngLat);
    // a national camera belongs to no gauge; on the airport map it stays open until that map moves to another airport
    camPopup.__icao = s ? s.icao : (m === maps.airport ? m.__icao : null); camPopup.__cam = c; camPopup.__ring = !!c.band; camPopup.__key = c.url || c.frame || c.name;
    if (ringNote) { var capEl = camPopup.getElement() && camPopup.getElement().querySelector(".cap"); if (capEl) capEl.insertAdjacentHTML("beforeend", ringNote); }
    // a map tap can close this popup AFTER the same tap opened the next one: only the popup that is current clears the handle
    var thisPopup = camPopup;
    camPopup.on("close", function () { if (camPopup === thisPopup) camPopup = null; });
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

  /* 2026-09-23, the ring floor study (research/ring_floor_study/REPORT.md): the rings carry their measured record, as every
     number on this board must. settle.json feeds.radar.record is copied from build/ring_record.json by the collector;
     the record is a proxy-radar measurement over six days and says so; absent record, nothing is printed. */
  function ringRecordHTML() {
    /* refuter on #212: the row is a direct child of the .kv grid (two spans), the guard refuses any record whose
       numbers are not finite (a regenerated file with a different key set must never empty the panel), and the
       wording states the unit: per 2-minute cycle AND per echo episode, the unit the arrival alert fires on. */
    var rec = settle && settle.feeds && settle.feeds.radar && settle.feeds.radar.record;
    function fin(x) { return typeof x === 'number' && isFinite(x); }
    function band(b) { return b && fin(b.precision) && fin(b.recall) && fin(b.n_fired); }
    function epi(e) { return e && fin(e.precision) && fin(e.caught); }
    if (!rec || !rec.bands || !band(rec.bands['20']) || !band(rec.bands['30']) || !fin(rec.events) || !fin(rec.stations)) return '';
    var b20 = rec.bands['20'], b30 = rec.bands['30'], ep = rec.episodes || {}, e20 = ep['20'], e30 = ep['30'];
    var epiTxt = (epi(e20) && epi(e30)) ? ' Per echo episode, the unit the arrival alert fires on: ' + Math.round(100 * e20.precision) + '% at 20 dBZ and ' + Math.round(100 * e30.precision) + '% at 30 dBZ, catching ' + Math.round(e20.caught) + ' and ' + Math.round(e30.caught) + ' of the ' + Math.round(rec.events) + ' tips.' : '';
    return '<span>ring record</span><span>echo at 20 dBZ and up in the 6 mi ring with no tip in the prior hour was followed by a tip within the hour in '
      + Math.round(100 * b20.precision) + '% of 2-minute cycles (' + Math.round(rec.events) + ' tips at ' + Math.round(rec.stations) + ' stations); at 30 dBZ and up ' + Math.round(100 * b30.precision) + '%, catching '
      + Math.round(100 * b30.recall) + '% of tips instead of ' + Math.round(100 * b20.recall) + '%.' + epiTxt
      + ' Measured on MRMS crops over six days, not these rings; the floor stays at 20; rerun on the board\'s own rings ' + esc(String(rec.rerun || '').slice(0, 10)) + '.</span>';
  }
  /* 4. scorecard */
  function renderScorecard() {
    var S = stations();
    var sc = scorecardData;
    var today = S.filter(function (s) { return isLocked(s) || rainingNow(s); });
    $("sc-today").innerHTML = today.length ? '<table class="sc"><tr><th>gauge</th><th>state</th><th>total</th><th>market</th><th>v3 said (whole day)</th></tr>' + today.map(function (s) { var ph = physFor(s), m = s.market || {}; return '<tr><td><b>' + esc(s.city) + '</b> ' + s.icao + '</td><td>' + stateChip(wetState(s)) + '</td><td class="num">' + esc(gaugeAmt(s)) + '</td><td class="num">YES ' + quoteCents(marketQuote(m, "ask")) + '</td><td class="num">' + (ph && typeof ph.p_day === "number" && isFinite(ph.p_day) ? pct(ph.p_day) + ' <small>unmeasured</small>' : '<b class="stale">' + esc(physWord(s) || "v3 unavailable: no whole-day number") + '</b>') + '</td></tr>'; }).join("") + '</table>' : '<div class="empty">no gauge has recorded rain yet today</div>';
    /* Colin, 2026-09-23: the two market rows he reads, the 9am YES ask under 10c and at 90c or above, each with the
       market's measured record (unlocked settled rows) and today's stations in the band. A station already wet at 9am
       is marked; it never counts toward the record. Data: scorecard.json market_bands (source_snapshots.py). */
    var bEl = $("sc-bands"), mb = sc && sc.market_bands;
    if (bEl) {
      if (!mb) bEl.innerHTML = '<div class="empty">The bands appear after the next 9am snapshot run.</div>';
      else bEl.innerHTML = ["under_10", "over_90"].map(function (k) {
        var b = mb[k] || {}, r = b.record || {}, t = b.today || [];
        var rec = r.n ? r.wet + ' of ' + r.n + ' settled wet (' + r.actual_pct + '%)' : 'no settled rows yet';
        var chips = t.length ? t.map(function (x) { return '<span class="chip' + (x.locked_at_snap ? ' wet' : '') + '">' + esc(x.city || x.icao) + ' ' + Math.round(100 * (x.yes_ask || 0)) + 'c' + (x.locked_at_snap ? ' (wet before 9)' : '') + '</span>'; }).join(' ') : '<small>none today</small>';
        return '<p class="band"><b>' + esc(b.label || k) + '</b>: record ' + rec + '<br>' + chips + '</p>';
      }).join('');
    }
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
    var scEl = $("sc-sources");
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
    /* the full-screen radar bar wraps to 3 or 4 rows on a phone (220 px at 390): the card and its
       chip sit above whatever height it has, or the chip lands under the bar where it cannot be tapped */
    function fsCtl() { if (box.classList.contains("full")) box.style.setProperty("--fs-ctl", ctl.offsetHeight + "px"); }
    fsCtl(); if (on && window.ResizeObserver && !ctl.__fsro) { ctl.__fsro = new ResizeObserver(fsCtl); ctl.__fsro.observe(ctl); }
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
  function stdClock(s, iso) { return iso ? ctClock(iso) : ''; }
  function fracClock(s, h) {
    if (!s || h === null || h === undefined) return 'time unknown';
    var start = Date.parse(contractDay(s) + 'T00:00:00Z') - stdOffMin(s) * 60000;
    return ctFromMs(start + h * 3600000);
  }
  function contractLine(s) {
    var m = s.market || {}, dl = deadlineMs(s), left = minutesLeft(s);
    var tz = "UTC" + (stdOffMin(s) / 60 >= 0 ? "+" : "") + (stdOffMin(s) / 60) + " standard";
    return '<span><b>' + esc(s.icao) + '</b> settlement gauge</span>'
      + '<span>contract day <b>' + esc(contractDay(s)) + '</b></span>'
      + '<span>counts rain <b>' + ctFromMs(Date.parse(contractDay(s) + 'T00:00:00Z') - stdOffMin(s) * 60000) + ' to ' + ctFromMs(Date.parse(contractDay(s) + 'T00:00:00Z') - stdOffMin(s) * 60000 + 86400000) + '</b> (midnight to midnight ' + esc(tz) + ')</span>'
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
    if (p && p.time_utc) lines.push("latest airport report observed " + stdClock(s, p.time_utc) + " (" + agoTxt(p.time_utc) + ")" + (p.report_time_utc && String(p.report_time_utc).slice(11, 16) !== String(p.time_utc).slice(11, 16) ? ", published as the " + ctClock(p.report_time_utc) + " slot" : ""));
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
      if (cov !== null && cov !== undefined && cov >= 24) { out.label = "DRY reading at " + fracClock(s, t) + ", NO DRY CREDIT: " + (ph.evidence_gap || "sensor coverage unknown"); out.cls = "UNKNOWN"; return out; }
      if (cov) { out.label = "DRY as of " + fracClock(s, t) + ", sensor covered only from " + fracClock(s, cov) + " (PNO gap earlier)"; out.cls = "RAIN_NEARBY"; lines.push(ph.evidence_gap || ""); return out; }
      out.label = "DRY as of " + fracClock(s, t) + (cov === 0 ? ", sensor working all day" : (cov === undefined ? ", coverage not reported by this model version" : "")); out.cls = "QUIET"; return out;
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
      + (ph ? '<li>model conditioning (v3): ' + esc(condTxt(s, ph)) + '</li>' : (physWord(s) ? '<li>model conditioning: ' + esc(physWord(s)) + '</li>' : ''))
      + (ph && ph.observed_at_utc ? '<li>dated from the report observed ' + stdClock(s, ph.observed_at_utc) + (ph.report_time_utc ? ' (nominal slot ' + ctClock(ph.report_time_utc) + ')' : '') + '</li>' : '')
      + '<li>' + (p && p.time_utc ? 'newest report ' + agoTxt(p.time_utc) : 'no 1-minute pulse') + (o.latest_ob_utc && p && p.time_utc && Date.parse(o.latest_ob_utc) < Date.parse(String(p.time_utc).replace(/Z$/, "+00:00")) - 60000 ? '; the collector\'s reading is superseded by a newer report' : '') + '</li>'
      + '</ul>';
    // 3. still to come
    var bst = briefStale() || stationBriefStale(bf);
    var coming = '<div class="lead">' + (bf && bf.headline ? esc(bf.headline) : (briefing ? 'no briefing for this gauge' : 'briefing unavailable')) + (bst ? ' <b class="stale">(' + esc(bst) + ')</b>' : '') + '</div><ul>'
      + (bf && bf.point_forecast && bf.point_forecast.before_cutoff && bf.point_forecast.before_cutoff.peak_pct !== null ? '<li>before the cutoff: NWS point forecast peak <b>' + bf.point_forecast.before_cutoff.peak_pct + '%</b> at ' + fracClock(s, bf.point_forecast.before_cutoff.peak_local_hour) + (bf.point_forecast.before_cutoff.first_30_local_hour !== null && bf.point_forecast.before_cutoff.first_30_local_hour !== undefined ? ', first hour at 30%+ ' + fracClock(s, bf.point_forecast.before_cutoff.first_30_local_hour) : '') + '</li>' : '')
      + (bf && bf.point_forecast && bf.point_forecast.after_cutoff && bf.point_forecast.after_cutoff.peak_pct !== null ? '<li>after the cutoff (does not count): peak <b>' + bf.point_forecast.after_cutoff.peak_pct + '%</b> at ' + fracClock(s, bf.point_forecast.after_cutoff.peak_local_hour) + '</li>' : '')
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
      + '<span><small>YES ask</small><b>' + quoteCents(marketQuote(m, "ask")) + '</b><small>bid ' + quoteCents(marketQuote(m, "bid")) + ', ' + quoteFreshness(m) + '</small></span>'
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
      + '<li>quote ' + quoteFreshness(m) + ' &middot; ' + fastFeedsTxt() + '</li></ul>';
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
      + '<div class="brief-cols"><div class="col"><h5>Before the cutoff <small>counts</small></h5>' + (b.peak_pct !== null && b.peak_pct !== undefined ? '<div class="big num">' + b.peak_pct + '%</div><small>NWS point forecast peak at ' + fracClock(s, b.peak_local_hour) + (b.first_30_local_hour !== null && b.first_30_local_hour !== undefined ? '; first hour at 30%+ ' + fracClock(s, b.first_30_local_hour) : '') + (b.qpf_in !== null && b.qpf_in !== undefined ? '; ' + (+b.qpf_in).toFixed(2) + ' in forecast' : '') + (bf.twc_forecast && bf.twc_forecast.before_cutoff && bf.twc_forecast.before_cutoff.peak_pct !== null ? '; weather.com peak ' + bf.twc_forecast.before_cutoff.peak_pct + '%' : '') + '</small>' : '<small>no hourly forecast left before the cutoff</small>') + '</div>'
      + '<div class="col after"><h5>After the cutoff <small>does not count</small></h5>' + (a.peak_pct !== null && a.peak_pct !== undefined ? '<div class="big num">' + a.peak_pct + '%</div><small>peak at ' + fracClock(s, a.peak_local_hour) + '</small>' : '<small>no forecast beyond the cutoff</small>') + '</div></div>'
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
  function textSize(value) {
    var sizes = {small:14 / 15, normal:1, large:1.2};
    if (!Object.prototype.hasOwnProperty.call(sizes, value)) value = 'normal';
    document.documentElement.style.setProperty('--type-scale', String(sizes[value]));
    $('text-size').value = value;
  }
  var savedTextSize;
  try { savedTextSize = localStorage.getItem('rb.type.v1'); } catch (_) { savedTextSize = null; }
  textSize(savedTextSize);
  $('text-size').onchange = function () {
    textSize(this.value);
    try { localStorage.setItem('rb.type.v1', this.value); } catch (_) { /* Current choice still applies. */ }
  };
  /* the theme rides on the root too (layout A fix, 2026-09-25): the root paints the canvas past the body's first screen,
     and the phone's browser bar follows the page (theme-color) */
  function theme() {
    var light = localStorage.getItem("rb.theme") === "light";
    document.body.classList.toggle("light", light); document.documentElement.classList.toggle("light", light);
    var tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute("content", light ? "#F2F4F6" : "#12181E");
    $("theme").textContent = light ? "dark" : "light";
  }
  $("theme").onclick = function () { var light = !document.body.classList.contains("light"); localStorage.setItem("rb.theme", light ? "light" : "dark"); theme(); };
  theme();
  // 2026-09-19, Colin: "top of the page is covered by something". The jump bar was pinned at a fixed
  // 54 px, the header's height at one width and zoom; when the header grew (a longer freshness pill,
  // a wider zoom) it slid over the bar. The bar and the anchors now follow the header's REAL height.
  /* layout A (2026-09-25): on a phone only the header stays pinned (the feed pills and find, the whole page long); the
     two-row jump bar scrolls with the page, so it counts 0 in the offsets the anchors and the find box use. The stale
     banner's height is measured too: the map gives it back, so the radar clock stays on the first screen under it. */
  (function pinUnderHeader() {
    var top = $("top"), jump = $("jump"), banner = $("stale-banner"), root = document.documentElement;
    if (!top || !jump) return;
    function measure() {
      root.style.setProperty("--top-h", Math.ceil(top.getBoundingClientRect().height) + "px");
      root.style.setProperty("--jump-h", (getComputedStyle(jump).position === "sticky" ? Math.ceil(jump.getBoundingClientRect().height) : 0) + "px");
      root.style.setProperty("--banner-h", (banner ? Math.ceil(banner.getBoundingClientRect().height) : 0) + "px");
    }
    measure();
    if (typeof ResizeObserver !== "undefined") { var ro = new ResizeObserver(measure); ro.observe(top); ro.observe(jump); if (banner) ro.observe(banner); }
    window.addEventListener("resize", measure);
  })();
  /* ---------------- find a city ----------------
     Colin, 2026-09-19: "I want a search function as well". Typing narrows a list; Enter or a tap
     opens that city's card. Every city carries its state name here so "texas" and "colorado" find
     it: the board's own data has no state field, and test_city_tables keeps this table honest. */
  var STATE_OF = {
    ATL: "Georgia", AUS: "Texas", BOS: "Massachusetts", CHI: "Illinois", CLL: "Texas", CMH: "Ohio",
    DAL: "Texas", DC: "Washington DC", DEN: "Colorado", EWR: "New Jersey", HOU: "Texas",
    LAX: "California", LEX: "Kentucky", LV: "Nevada", MIA: "Florida", MIN: "Minnesota",
    MKE: "Wisconsin", NOLA: "Louisiana", NYC: "New York", OKC: "Oklahoma", PHIL: "Pennsylvania",
    PHX: "Arizona", PIT: "Pennsylvania", PVD: "Rhode Island", SATX: "Texas", SEA: "Washington", SFO: "California",
    TTN: "New Jersey"
  };
  var findSel = 0;
  function findMatches(q) {
    q = String(q === undefined || q === null ? "" : q).trim().toLowerCase();
    if (!q) return stations().slice().sort(sortLive).slice(0, 8);   // the queue's own order
    var hits = [];
    stations().forEach(function (s) {
      var hay = [s.name, s.city, s.icao, STATE_OF[s.city] || "", ((s.market || {}).ticker || "")].join(" ").toLowerCase();
      var at = hay.indexOf(q);
      if (at < 0) return;
      // a city whose NAME or CODE starts with what he typed comes first: "den" is Denver, not Camden
      var head = String(s.name || "").toLowerCase().indexOf(q) === 0 || String(s.city || "").toLowerCase().indexOf(q) === 0;
      hits.push({ s: s, rank: (head ? 0 : 1000) + at });
    });
    hits.sort(function (a, b) { return a.rank - b.rank || String(a.s.city).localeCompare(String(b.s.city)); });
    return hits.slice(0, 8).map(function (h) { return h.s; });
  }
  function findRender() {
    var box = $("find-hits"), input = $("find-q");
    if (!box) return;
    var q = input ? input.value : "", hits = findMatches(q);
    if (!hits.length) { box.innerHTML = '<div class="empty">no city matches ' + esc(q) + '</div>'; return; }
    if (findSel >= hits.length) findSel = hits.length - 1;
    box.innerHTML = hits.map(function (s, i) {
      var w = wetState(s);
      return '<button type="button" class="find-hit' + (i === findSel ? ' on' : '') + '" data-icao="' + esc(s.icao) + '">'
        + '<span><b>' + esc(s.name || s.city) + '</b> <small>' + esc(s.city) + ' &middot; ' + esc(s.icao)
        + (STATE_OF[s.city] ? ' &middot; ' + esc(STATE_OF[s.city]) : '') + '</small></span>'
        + '<span class="r num"><i>' + STATES[w.k].icon + '</i> ' + esc(gaugeAmt(s)) + ' &middot; YES ' + esc(quoteCents(marketYes(s))) + '</span></button>';
    }).join("");
  }
  /* layout A (2026-09-25): on a phone the jump bar scrolls with the page, so the box sits right under whichever of the
     header and the bar is lower on screen now: under the bar at the top of the page, under the header further down */
  function placeFind() {
    var box = $("find"), top = $("top"), jump = $("jump"); if (!box || !top) return;
    var y = top.getBoundingClientRect().bottom;
    if (jump) y = Math.max(y, jump.getBoundingClientRect().bottom);
    box.style.top = Math.max(0, Math.round(y)) + "px";
  }
  function findOpen(on) {
    var box = $("find"), btn = $("findbtn"), input = $("find-q");
    if (!box) return;
    if (on) placeFind();
    box.classList.toggle("hidden", !on);
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    if (!on) return;
    findSel = 0;
    findRender();
    if (input) { input.focus(); input.select(); }
  }
  function findIsOpen() { var box = $("find"); return !!box && !box.classList.contains("hidden"); }
  (function wireFind() {
    var btn = $("findbtn"), input = $("find-q"), hits = $("find-hits");
    if (!btn || !input || !hits) return;
    btn.onclick = function (ev) { ev.preventDefault(); findOpen(!findIsOpen()); };
    input.addEventListener("input", function () { findSel = 0; findRender(); });
    input.addEventListener("keydown", function (ev) {
      var list = findMatches(input.value);
      if (ev.key === "Escape") { findOpen(false); btn.focus(); }
      else if (ev.key === "ArrowDown") { findSel = Math.min(findSel + 1, list.length - 1); findRender(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { findSel = Math.max(findSel - 1, 0); findRender(); ev.preventDefault(); }
      else if (ev.key === "Enter" && list[findSel]) { go(list[findSel].icao); findOpen(false); }
    });
    hits.addEventListener("click", function (ev) {
      var hit = ev.target && ev.target.closest ? ev.target.closest("[data-icao]") : null;
      if (!hit) return;
      go(hit.getAttribute("data-icao"));
      findOpen(false);
    });
    document.addEventListener("keydown", function (ev) {
      // jules, PR #171: "/" inside the station selector opened the box and ate the keystroke. A
      // control that takes typing keeps its keys: inputs, textareas, selects and anything editable.
      var el = document.activeElement || {}, tag = (el.tagName || "").toUpperCase();
      var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
      if (ev.key === "/" && !typing) { ev.preventDefault(); findOpen(true); }
      else if (ev.key === "Escape" && findIsOpen()) findOpen(false);
    });
    document.addEventListener("click", function (ev) {
      if (!findIsOpen() || $("find").contains(ev.target) || btn.contains(ev.target)) return;
      findOpen(false);
    });
    window.addEventListener("scroll", function () { if (findIsOpen()) placeFind(); }, { passive: true });
    window.addEventListener("resize", function () { if (findIsOpen()) placeFind(); });
  })();
  load().then(route);
  loadChecks();
  setInterval(loadChecks, 60000);
  setInterval(load, 60000);
  setInterval(function () { if (camsOnMap && maps.live && !natCams) loadNatCams(); }, 60000);   // a failed national load heals itself (after its back-off)
  setInterval(function () { if (document.visibilityState !== "hidden") { freshness(); renderSentinel(); } }, 15000);
  // tomorrow's panel: loaded now, then every minute (the collector writes it every 20)
  loadTomorrow();
  setInterval(function () { if (document.visibilityState !== "hidden") loadTomorrow(); }, 60000);
})();
/* The board map's colour key, layout A (2026-09-25): the heading, the source line (it carries the units) and the strips
   with their dBZ or inch words stay on screen under the controls; the notes and the gauge pin colours fold behind one
   button, so the key no longer pushes the call off the second screen. A note with a swatch is a key entry and stays. The key's HTML is rebuilt by the radar code, so the fold is a class on its box
   (classList survives the rebuild). Remembered on this device only; the station page's key never folds. */
(function () {
  'use strict';
  var b=document.getElementById('legend-more'), k=document.getElementById('legend-live'), open=false;
  if (!b || !k) return;
  try {open=localStorage.getItem('rb.keynotes.v1')==='open';} catch(e){}
  function set(v){open=v;k.classList.toggle('rl-brief',!open);b.setAttribute('aria-expanded',String(open));b.textContent=(open?'Hide':'Show')+' key notes and gauge pins';}
  b.addEventListener('click',function(){set(!open);try{localStorage.setItem('rb.keynotes.v1',open?'open':'folded');}catch(e){}requestAnimationFrame(function(){document.dispatchEvent(new Event('board:layout'));});});
  set(open);
})();
/* Device-local card controls. Original content nodes stay alive through refresh/reorder.
   LAYOUT A (Colin, 2026-09-25, "and a for the layout"): below the desktop grid (899 px and narrower) the default
   order is the map first, then the call (glance, v3 value rows, alerts), every gauge, and the evidence folded:
   Tomorrow, Desk read and the Sentinel (reduced to its status line) as collapsed cards, Scorecard and Diagnostics
   as their own closed details. From 900 px the desktop grid keeps its three columns, nothing folded.
   Saved under a NEW key: a phone that saved an order under rb.layout.v1 (Sentinel pinned first) sees A once, and a
   custom order saved after that keeps working. The Sentinel is no longer pinned first: it moves and folds like any
   card, and it still cannot be hidden.
   A card's fold is true, false (his choice, kept everywhere) or null (the default for this width), so a phone
   that never touched Tomorrow sees it folded and the same browser at desktop width sees it open. */
(function () {
  'use strict';
  var key='rb.layout.v2', main=document.querySelector('main'), edit=document.getElementById('layout-edit');
  if (!main || !edit) return;
  var definitions=[['mapsec','Map'],['glance','The call'],['model','v3 and value'],['alerts','Alerts'],['stations','Every gauge'],['tomorrow','Tomorrow'],['deskread','Desk read'],['sentinel-top','Rain Sentinel'],['score','Scorecard'],['deskdiag','Diagnostics']];
  var FOLDED=['tomorrow','deskread','sentinel-top'];   // folded by default below the desktop grid; each keeps a Collapse / Expand row
  var narrow=window.matchMedia('(max-width: 899px)');
  var ids=definitions.map(function(x){return x[0];}), tiles={}, homes={}, focused=null, focusReturn=null, editing=false, drag=null;
  var panel=document.getElementById('layout-panel'), status=document.getElementById('layout-status'), tools=document.getElementById('layout-tools');
  function defaults(){return {version:2,custom:false,order:ids.slice(),cards:{}};}
  function normalize(value){
    var out=defaults();
    if (!value || value.version!==2 || !Array.isArray(value.order)) return out;
    out.custom=value.custom===true;
    out.order=value.order.filter(function(id,i,a){return ids.indexOf(id)>=0 && a.indexOf(id)===i;});
    // a card added since this layout was saved goes right after its predecessor in the default order, else at the end
    ids.forEach(function(id,i){if(out.order.indexOf(id)>=0)return;var at=out.order.length;for(var j=i-1;j>=0;j--){var k=out.order.indexOf(ids[j]);if(k>=0){at=k+1;break;}}out.order.splice(at,0,id);});
    ids.forEach(function(id){
      var c=value.cards && Object.prototype.hasOwnProperty.call(value.cards,id) ? value.cards[id] : null;
      out.cards[id]={size:c && ['s','m','l'].indexOf(c.size)>=0 ? c.size : 'm',hidden:!!(c && c.hidden===true && id!=='sentinel-top'),
        collapsed:c && typeof c.collapsed==='boolean' ? c.collapsed : null};
    });
    return out;
  }
  var layout;
  try {layout=normalize(JSON.parse(localStorage.getItem(key)));} catch(e){layout=defaults();}
  function card(id){return layout.cards[id] || (layout.cards[id]={size:'m',hidden:false,collapsed:null});}
  /* a jump-bar link opens its card for THIS visit only (revealed): saving collapsed:false there unwound A's folds one
     ordinary tap at a time (phone QA and the tests critic on 661e587). Expand and Collapse are choices, and are saved. */
  var revealed={};
  function folded(id){if(revealed[id])return false;var c=card(id).collapsed;return typeof c==='boolean' ? c : narrow.matches && FOLDED.indexOf(id)>=0;}
  function save(message){
    try {localStorage.setItem(key,JSON.stringify(layout));status.textContent=message || 'Layout saved on this device.';}
    catch(e){status.textContent='Layout changed for this visit. This browser could not save it.';}
  }
  function resize(){requestAnimationFrame(function(){document.dispatchEvent(new Event('board:layout'));});}
  function button(text,label,fn){var b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',label);b.title=label;b.addEventListener('click',fn);return b;}
  definitions.forEach(function(def){
    var id=def[0],node=document.getElementById(id),shell=document.createElement('section'),bar=document.createElement('div');
    shell.className='board-tile'+(FOLDED.indexOf(id)>=0?' tile-foldable':'');shell.dataset.tile=id;shell.setAttribute('aria-label',def[1]);
    homes[id]=document.createComment('home of '+id);node.before(homes[id],shell);
    bar.className='tile-tools';
    var title=document.createElement('strong');title.textContent=def[1];bar.append(title);
    var handle=button('Drag','Drag '+def[1]+' to reorder',function(){});handle.className='tile-drag';handle.dataset.drag=id;bar.append(handle);
    var up=button('Up','Move '+def[1]+' earlier',function(){move(id,-1);}),down=button('Down','Move '+def[1]+' later',function(){move(id,1);});
    up.dataset.moveStep='-1';down.dataset.moveStep='1';bar.append(up,down);
    var size=document.createElement('select');size.setAttribute('aria-label',def[1]+' size');
    [['s','S'],['m','M'],['l','L']].forEach(function(x){var o=document.createElement('option');o.value=x[0];o.textContent=x[1];size.append(o);});
    size.addEventListener('change',function(){card(id).size=size.value;layout.custom=true;apply();save();});bar.append(size);
    var collapse=button('Collapse','Collapse '+def[1],function(){card(id).collapsed=!folded(id);delete revealed[id];apply();save();});collapse.className='tile-collapse';bar.append(collapse);
    if(id!=='sentinel-top')bar.append(button('Hide','Hide '+def[1],function(){card(id).hidden=true;apply();visibility();save();edit.focus();}));
    bar.append(button('Focus','Focus '+def[1],function(){focus(id);}));
    var close=button('Back to board','Exit focused card',unfocus);close.className='tile-unfocus';bar.append(close);
    shell.append(bar,node);tiles[id]=shell;
  });
  function apply(){
    var phone=narrow.matches;
    main.classList.toggle('layout-custom',layout.custom);
    if(layout.custom)layout.order.forEach(function(id){main.append(tiles[id]);});
    else if(phone)ids.forEach(function(id){main.append(tiles[id]);});          // layout A, in reading order: DOM, focus and screen agree
    else ids.forEach(function(id){homes[id].after(tiles[id]);});               // the desktop grid: each card back in its column
    if(phone)main.append(tools);else main.prepend(tools);                      // on a phone the map is the first thing under the jump bar
    ids.forEach(function(id){
      var c=card(id),tile=tiles[id],f=folded(id);tile.hidden=c.hidden;tile.dataset.size=c.size;
      tile.classList.toggle('tile-collapsed',f);tile.querySelector('select').value=c.size;
      var b=tile.querySelector('.tile-collapse');b.textContent=f?'Expand':'Collapse';b.setAttribute('aria-expanded',String(!f));b.setAttribute('aria-label',(f?'Expand ':'Collapse ')+tile.getAttribute('aria-label'));b.title=b.getAttribute('aria-label');
      var at=layout.order.indexOf(id);
      tile.querySelectorAll('[data-move-step]').forEach(function(control){control.disabled=+control.dataset.moveStep<0?at===0:at===layout.order.length-1;});
    });resize();
  }
  function visibility(){
    var box=document.getElementById('layout-visibility');box.replaceChildren();
    definitions.forEach(function(def){if(def[0]==='sentinel-top')return;
      var label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=!card(def[0]).hidden;
      input.addEventListener('change',function(){card(def[0]).hidden=!input.checked;apply();save();});label.append(input,document.createTextNode(def[1]));box.append(label);
    });
  }
  function setEditing(on){editing=on;document.body.classList.toggle('layout-editing',on);panel.classList.toggle('hidden',!on);edit.setAttribute('aria-expanded',String(on));edit.textContent=on?'Finish customizing':'Customize cards';if(on)visibility();}
  edit.addEventListener('click',function(){setEditing(!editing);});
  document.getElementById('layout-done').addEventListener('click',function(){setEditing(false);edit.focus();});
  document.getElementById('layout-reset').addEventListener('click',function(){
    unfocus();layout=defaults();revealed={};apply();visibility();save('Default layout restored.');
  });
  function reorder(id,target){
    if(id===target)return;
    var next=layout.order.filter(function(x){return x!==id;}),at=next.indexOf(target);
    next.splice(at<0?next.length:at,0,id);layout.order=next;layout.custom=true;apply();save('Card order saved.');
  }
  function move(id,step){
    var next=layout.order.slice(),at=next.indexOf(id),to=Math.max(0,Math.min(next.length-1,at+step));
    if(at<0 || to===at)return;
    next.splice(at,1);next.splice(to,0,id);layout.order=next;layout.custom=true;apply();save('Card order saved.');
    tiles[id].querySelector('.tile-drag').focus();
  }
  main.addEventListener('pointerdown',function(e){
    var handle=e.target.closest('[data-drag]');if(!editing || !handle || e.button!==0)return;
    drag={id:handle.dataset.drag,pointer:e.pointerId,handle:handle,target:null};handle.setPointerCapture(e.pointerId);tiles[drag.id].classList.add('tile-dragging');e.preventDefault();
  });
  main.addEventListener('pointermove',function(e){
    if(!drag || e.pointerId!==drag.pointer)return;
    var hit=document.elementFromPoint(e.clientX,e.clientY),target=hit && hit.closest('[data-tile]');
    main.querySelectorAll('.tile-drop').forEach(function(x){x.classList.remove('tile-drop');});
    drag.target=target ? target.dataset.tile : null;
    if(target && drag.target!==drag.id)target.classList.add('tile-drop');
    if(e.clientY<90)window.scrollBy(0,-22);else if(e.clientY>innerHeight-90)window.scrollBy(0,22);
    e.preventDefault();
  });
  function finishDrag(e){
    if(!drag || e.pointerId!==drag.pointer)return;
    var done=drag;drag=null;main.querySelectorAll('.tile-drop,.tile-dragging').forEach(function(x){x.classList.remove('tile-drop','tile-dragging');});
    if(done.handle.hasPointerCapture(done.pointer))done.handle.releasePointerCapture(done.pointer);
    if(e.type==='pointerup' && done.target)reorder(done.id,done.target);
  }
  main.addEventListener('pointerup',finishDrag);main.addEventListener('pointercancel',finishDrag);main.addEventListener('lostpointercapture',finishDrag);
  var isolation=[];
  function focus(id){
    if(focused)unfocus();focusReturn=document.activeElement;focused=tiles[id];focused.classList.add('tile-focused');focused.setAttribute('role','dialog');focused.setAttribute('aria-modal','true');
    document.body.classList.add('tile-focus-open');
    // Inert every branch outside the focused tile, including the board header.
    for(var node=focused;node && node.parentElement;node=node.parentElement){
      Array.from(node.parentElement.children).forEach(function(other){if(other!==node){isolation.push([other,other.inert]);other.inert=true;}});
      if(node.parentElement===document.body)break;
    }
    focused.querySelector('.tile-unfocus').focus();resize();
  }
  function unfocus(){
    if(!focused)return;
    focused.classList.remove('tile-focused');focused.removeAttribute('role');focused.removeAttribute('aria-modal');focused=null;
    isolation.forEach(function(x){x[0].inert=x[1];});isolation=[];document.body.classList.remove('tile-focus-open');
    if(focusReturn && focusReturn.isConnected)focusReturn.focus();resize();
  }
  document.addEventListener('board:station-open',unfocus);
  main.addEventListener('click',function(e){
    if(focused && e.target.closest('[data-icao],.mk,.camk,.cam,[data-fs]'))unfocus();
  },true);
  document.addEventListener('keydown',function(e){
    var el=document.activeElement;
    if(focused && e.key==='/' && !(el && (el.matches('input,select,textarea') || el.isContentEditable)))unfocus();
  },true);
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){if(focused){e.preventDefault();unfocus();}else if(editing){setEditing(false);edit.focus();}}
    if(e.key==='Tab' && focused){
      var all=Array.from(focused.querySelectorAll('button,select,input,a[href],summary,[tabindex="0"]')).filter(function(x){return !x.disabled && x.getClientRects().length && getComputedStyle(x).visibility!=='hidden';});
      var first=all[0],last=all[all.length-1];
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  document.getElementById('jump').addEventListener('click',function(e){
    var a=e.target.closest('a[href^="#top-"]');if(!a)return;
    var map={'top-call':'glance','top-sentinel':'sentinel-top','top-alerts':'alerts','top-model':'model','top-deskread':'deskread','top-gauges':'stations','top-tomorrow':'tomorrow','top-map':'mapsec','top-score':'score'},id=map[a.hash.slice(1)];
    if(!id)return;card(id).hidden=false;if(folded(id))revealed[id]=true;apply();if(editing)visibility();save(); // codex on #199: the customize panel's checkbox must follow the reveal
    // Anchors remain at their original group for reset; a moved tile is the destination.
    e.preventDefault();tiles[id].scrollIntoView({block:'start'});
  });
  // crossing 900 px (a rotated tablet, a resized window) switches between layout A and the desktop grid
  if(narrow.addEventListener)narrow.addEventListener('change',apply);else if(narrow.addListener)narrow.addListener(apply);
  apply();
})();
