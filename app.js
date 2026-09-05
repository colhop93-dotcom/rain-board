/* #019a Rain Station Board v2. Plain JS, no build step. Reads data/state.json
   (SPEC section 3, schema 019a.state/2), draws the 22 gauges over a dark
   basemap with 24 hours of radar (Iowa Mesonet NEXRAD composite tiles, one
   layer per 10-minute frame, built on demand), and never goes blank: every
   fetch has a timeout, the last good state is kept in localStorage, and a
   failure shows as a state, not a blank page. */
(function () {
  "use strict";
  // On the GitHub mirror the data files are read through jsDelivr (the publisher purges
  // it after every push, once a minute), so the numbers do not wait for a Pages build.
  var ON_MIRROR = /github\.io$/.test(location.hostname);
  var CDN = "https://cdn.jsdelivr.net/gh/colhop93-dotcom/rain-board@gh-pages/";
  var STATE_URL = "data/state.json", SAMPLE_URL = "data/state.sample.json", LS_KEY = "rainboard.state.v2";
  /* Mirror reads: same-origin with a per-minute cache-buster. GitHub Pages caches each URL for
     10 minutes, so a new query string every minute is a fresh fetch; the jsDelivr copy sat 41
     minutes stale on 2026-09-02 even with purges reporting success, so it is the fallback only. */
  function dataURL(rel) { return ON_MIRROR ? rel + "?t=" + Math.floor(Date.now() / 60000) : rel; }
  function cdnURL(rel) { return CDN + rel; }
  var IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-";
  var RADAR_HOURS = 24, RADAR_STEP_MIN = 10;
  var COLORS = { low: "#22c55e", moderate: "#eab308", elevated: "#f97316", high: "#ef4444", extreme: "#a855f7", stale: "#6b7280", locked: "#38bdf8" };
  var map, mapReady = false, markers = {}, popup = null, state = null, seen = {}, firstRender = true, soundOn = false;
  var radar = { frames: [], nowIdx: 0, idx: 0, playing: true, timer: null, opacity: 0.75, live: true, added: {} };

  function $(id) { return document.getElementById(id); }
  function fetchJSON(url, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms || 8000);
    return fetch(url, { cache: "no-store", signal: ctl.signal }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error(url + " " + r.status); return r.json();
    });
  }
  function toast(msg) { var el = $("toast"); el.textContent = msg; el.classList.add("show"); setTimeout(function () { el.classList.remove("show"); }, 4000); }
  function pct(v) { return (v === null || v === undefined) ? "--" : Math.round(v) + "%"; }
  function cents(v) { return (v === null || v === undefined) ? "--" : Math.round(v * 100) + "c"; }
  function hourLabel(h) { if (h === null || h === undefined) return "?"; if (h >= 24) return "12am"; var x = h % 12 || 12; return x + (h < 12 ? "am" : "pm"); }
  function ago(iso) {
    if (!iso) return "no data"; var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 1 ? "just now" : m === 1 ? "1 min ago" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
  }
  function arrow(d) {
    if (d === null || d === undefined) return '<span class="arrow flat">-</span>';
    if (d >= 5) return '<span class="arrow up">&#9650; ' + d + '</span>';
    if (d <= -5) return '<span class="arrow down">&#9660; ' + d + '</span>';
    return '<span class="arrow flat">&#9644;</span>';
  }
  function isLocked(s) { return !!(s.observed && s.observed.locked); }
  // Colin, 2026-09-02: once the gauge has read something, the chance is history.
  // A locked station shows what fell, in lock blue, not the forecast percentage.
  function levelOf(s) { return s.status === "stale" ? "stale" : isLocked(s) ? "locked" : (s.level || "low"); }
  function headline(s) { return isLocked(s) ? (s.observed.in_today || 0).toFixed(2) + '"' : pct(peak(s)); }
  function headlineSub(s) { return isLocked(s) ? "rained, settles YES" : hourLabel(s.forecast && s.forecast.pop_peak_hour); }
  function peak(s) { return (s.forecast && s.forecast.pop_peak !== null && s.forecast.pop_peak !== undefined) ? s.forecast.pop_peak : null; }
  /* The gauge day runs on STANDARD time, so during daylight time the day rolls at 1:00 AM civil;
     for that hour every locked marker is still yesterday's. Say which day, and when it rolls. */
  function dayLabel(s) { var d = s.local_day ? s.local_day.slice(5).replace("-", "/") : ""; return d ? d.replace(/^0/, "").replace(/\/0/, "/") : ""; }
  function rollHour(s) {
    var off = (s.tz_offset_min !== undefined && s.tz_offset_min !== null) ? s.tz_offset_min : null, std = (s.utc_offset_std || 0) * 60;
    if (off === null) return null; var diff = (off - std) / 60; return diff > 0 ? hourLabel(diff) : null;
  }
  function dayNote(s) { var r = rollHour(s); return (s.local_day ? "market day " + s.local_day : "") + (r ? ", next day starts " + r + " local" : ""); }
  function windowText(s) {
    var w = s.forecast && s.forecast.window; if (!w) return "no rain expected";
    return "rain " + hourLabel(w.start) + (w.end !== w.start ? "-" + hourLabel(w.end + 1) : "") + ", peak " + hourLabel(w.peak);
  }
  function gapClass(g) { return g === null || g === undefined ? "flat" : g >= 8 ? "pos" : g <= -8 ? "neg" : "flat"; }
  function gapText(g) { return g === null || g === undefined ? "--" : (g > 0 ? "+" : "") + g; }

  /* ---------------- the trade read: peak state, area state, one verdict line ----------------
     Colin, 2026-09-04: "make sure it is obvious if we are PAST the peak hour for rain and if no
     rain is in the area". Each is graded from what the data actually holds, and neither is
     asserted when its evidence is missing: no radar sample means "radar unknown", not "clear". */
  function hourlyMap(s) { var m = {}; ((s.forecast && s.forecast.hourly_seen) || []).forEach(function (h) { m[h[0]] = h[1]; }); ((s.forecast && s.forecast.hourly) || []).forEach(function (h) { m[h[0]] = h[1]; }); return m; }
  function remainingPeak(s) {
    // the highest chance still ahead on the station's own clock today, and the hour it lands
    var m = hourlyMap(s), lh = s.local_hour, best = null;
    if (lh === null || lh === undefined) return null;
    Object.keys(m).forEach(function (k) { var h = +k; if (h >= lh && (best === null || m[k] > best.pop)) best = { hour: h, pop: m[k] }; });
    return best;
  }
  function peakState(s) {
    var f = s.forecast || {}, lh = s.local_hour, ph = f.pop_peak_hour, w = f.window, pk = peak(s);
    if (isLocked(s)) return { kind: "locked", short: "LOCKED", text: "settled: the gauge locked" };
    if (lh === null || lh === undefined || ph === null || ph === undefined || pk === null) return { kind: "unknown", short: "", text: "" };
    var rem = remainingPeak(s), left = 24 - lh;
    if (w && lh >= w.start && lh <= w.end) return { kind: "in", short: "IN WINDOW", text: "IN THE RAIN WINDOW now (" + hourLabel(w.start) + " to " + hourLabel(w.end + 1) + ", peak " + hourLabel(w.peak) + " " + pct(pk) + ")" };
    if (lh < ph) return { kind: "ahead", short: "PEAK " + hourLabel(ph), text: "PEAK AHEAD in " + (ph - lh) + " h at " + hourLabel(ph) + " (" + pct(pk) + ")" };
    if (lh === ph) return { kind: "in", short: "PEAK NOW", text: "PEAK HOUR NOW (" + pct(pk) + ")" };
    if (rem && rem.hour > lh && rem.pop >= 30) return { kind: "second", short: "2ND CHANCE " + hourLabel(rem.hour), text: "PAST PEAK (" + hourLabel(ph) + " was " + pct(pk) + "), second chance " + pct(rem.pop) + " at " + hourLabel(rem.hour) };
    return { kind: "past", short: "PAST PEAK", text: "PAST PEAK by " + (lh - ph) + " h (" + hourLabel(ph) + " was " + pct(pk) + "), rest of day tops " + (rem ? pct(rem.pop) : "--") + ", " + left + " h left on the gauge day" };
  }
  function neighbourRain(s) { return (s.neighbors || []).filter(function (n) { var lp = pulseFor(n.id); return lp ? lp.raining : n.raining; }); }
  function areaState(s) {
    var r = s.radar || {}, nb = s.neighbors || [], wet = neighbourRain(s), km = r.nearest_km;
    if (isLocked(s)) return { kind: "locked", short: "LOCKED", text: "gauge locked " + (s.observed.in_today || 0).toFixed(2) + " in" };
    if (rainingNow(s)) return { kind: "on", short: "RAIN ON GAUGE", text: "RAIN ON THE GAUGE now" };
    var mv = r.motion || {}, mvTxt = mv && mv.dir ? ", moving " + mv.dir + (mv.kmh ? " " + mv.kmh + " km/h" : "") + (mv.toward_gauge ? ", TOWARD the gauge" : mv.toward_gauge === false ? ", not toward it" : "") : "";
    var haveRadar = km !== null && km !== undefined;
    if (haveRadar && km <= 10) return { kind: "near", short: "ECHOES " + km + " KM", text: "ECHOES " + km + " km " + r.nearest_dir + " of the gauge" + mvTxt };
    if (haveRadar && km <= 30) return { kind: "mid", short: "RAIN " + km + " KM", text: "rain " + km + " km " + r.nearest_dir + mvTxt };
    if (haveRadar && km <= 60) return { kind: "far", short: "RAIN " + km + " KM", text: "rain " + km + " km " + r.nearest_dir + ", far" + mvTxt };
    if (wet.length) return { kind: "mid", short: "RAIN NEARBY", text: "rain reported at " + wet.map(function (n) { return n.id.replace(/^K/, "") + " " + Math.round(n.dist_km) + " km " + n.bearing; }).join(", ") + (haveRadar ? ", nothing on radar within 60 km" : "") };
    if (haveRadar || r._n) return { kind: "none", short: "NO RAIN NEAR", text: "NO RAIN IN THE AREA: no echo within 60 km" + (haveRadar ? " (nearest " + km + " km " + r.nearest_dir + ")" : "") + (nb.length ? ", " + nb.length + " nearby airports dry" : "") };
    return { kind: "unknown", short: "", text: "radar unknown for this gauge (no sample yet)" };
  }
  function verdict(s) {
    // one line, strongest evidence first: what the gauge did, then the sky, then the clock
    var a = areaState(s), p = peakState(s);
    if (a.kind === "locked") return { cls: "locked", text: "YES: GAUGE LOCKED " + (s.observed.in_today || 0).toFixed(2) + " in" };
    if (s.status === "stale") return { cls: "stale", text: "DATA STALE: do not trust this card" };
    if (a.kind === "on") return { cls: "on", text: "RAIN ON THE GAUGE, lock likely" + (p.text ? "; " + p.text.toLowerCase() : "") };
    if (a.kind === "near") return { cls: "near", text: "RAIN AT THE DOOR: " + a.text + (p.text ? "; " + p.text.toLowerCase() : "") };
    if (p.kind === "past" && a.kind === "none") return { cls: "dry", text: "PAST PEAK, NOTHING NEAR: " + p.text.replace(/^PAST PEAK /, "peak passed ") + "; no echo within 60 km" };
    if (p.kind === "past") return { cls: "past", text: p.text + (a.text ? "; " + a.text : "") };
    if (a.kind === "none") return { cls: "none", text: a.text + (p.text ? "; " + p.text.toLowerCase() : "") };
    if (p.kind === "in") return { cls: "in", text: p.text + (a.text ? "; " + a.text : "") };
    if (p.kind === "second") return { cls: "second", text: p.text + (a.text ? "; " + a.text : "") };
    if (p.kind === "ahead") return { cls: "ahead", text: p.text + (a.text ? "; " + a.text : "") };
    return { cls: "flat", text: [p.text, a.text].filter(Boolean).join("; ") };
  }
  function evidenceHTML(s) {
    // the ladder, strongest first, one compact line each: gauge, pulse, radar, neighbours, forecast
    var o = s.observed, lp = livePulse(s), r = s.radar || {}, nb = s.neighbors || [], wet = neighbourRain(s), rem = remainingPeak(s);
    var haveKm = r.nearest_km !== null && r.nearest_km !== undefined, rows = [];
    rows.push(["gauge", o ? (o.in_today || 0).toFixed(2) + " in" + (o.locked ? ", LOCKED" : ", dry") + " (ob " + ago(o.latest_ob_utc) + ")" : "no observation", o && o.locked ? "good" : o ? "flat" : "bad"]);
    rows.push(["pulse", lp ? (lp.raining ? "RAINING " + (lp.wx || "") : "no rain in the 1-min report") + " (" + (lp.time_utc || "").slice(11, 16) + "Z)" : "no 1-min pulse", lp && lp.raining ? "hot" : lp ? "flat" : "bad"]);
    rows.push(["radar", haveKm ? "nearest echo " + r.nearest_km + " km " + r.nearest_dir + (r.near10_pct ? ", " + r.near10_pct + "% of the 10 km ring" : "") : (r._n ? "no echo within 60 km" : "no sample"), haveKm && r.nearest_km <= 10 ? "hot" : (haveKm || r._n) ? "flat" : "bad"]);
    rows.push(["neighbours", nb.length ? (wet.length ? wet.length + " of " + nb.length + " raining, closest " + Math.round(Math.min.apply(null, wet.map(function (n) { return n.dist_km; }))) + " km" : nb.length + " of " + nb.length + " dry") : "none", wet.length ? "hot" : "flat"]);
    rows.push(["forecast", rem ? "rest of day tops " + pct(rem.pop) + " at " + hourLabel(rem.hour) + " (day peak " + pct(peak(s)) + " at " + hourLabel((s.forecast || {}).pop_peak_hour) + ")" : "no hours left in the forecast day", rem && rem.pop >= 50 ? "hot" : "flat"]);
    return '<div class="evid">' + rows.map(function (r) { return '<div class="' + r[2] + '"><span>' + r[0] + '</span>' + r[1] + '</div>'; }).join("") + '</div>';
  }

  /* ---------------- layout ---------------- */
  var forcedView = null;
  function applyView() {
    var mobile = forcedView ? forcedView === "mobile" : window.innerWidth < 760;
    document.body.classList.toggle("mobile", mobile); document.body.classList.toggle("desktop", !mobile);
    $("viewtoggle").textContent = mobile ? "desktop" : "mobile";
    if (mobile) showTab(currentTab); else document.querySelectorAll("[data-pane]").forEach(function (p) { p.classList.remove("show"); });
    if (map) setTimeout(function () { map.resize(); }, 60);
  }
  var currentTab = "map";
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === name); });
    document.querySelectorAll("[data-pane]").forEach(function (p) { p.classList.toggle("show", p.dataset.pane === name); });
    if (map) setTimeout(function () { map.resize(); }, 60);
  }
  document.querySelectorAll("#tabs button").forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
  $("viewtoggle").onclick = function () { forcedView = document.body.classList.contains("mobile") ? "desktop" : "mobile"; applyView(); };
  window.addEventListener("resize", function () { if (!forcedView) applyView(); });

  /* ---------------- map ---------------- */
  var OFM_STYLE = "https://tiles.openfreemap.org/styles/dark";
  var ESRI_STYLE = { version: 8, sources: { esri: { type: "raster", tileSize: 256, attribution: "Basemap &copy; Esri, radar Iowa Mesonet / NWS",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"] } },
    layers: [{ id: "esri", type: "raster", source: "esri" }] };
  function initMap() {
    fetchJSON(OFM_STYLE, 6000).then(function (style) { buildMap(style); }).catch(function () { buildMap(ESRI_STYLE); });
  }
  function buildMap(style) {
    map = new maplibregl.Map({ container: "map", center: [-96.5, 38.2], zoom: 3.6, minZoom: 2.5, maxZoom: 13, attributionControl: false, style: style });
    window.rb = { map: map, radar: radar };   // debug handle only
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("styleimagemissing", function (e) { var c = document.createElement("canvas"); c.width = c.height = 2; map.addImage(e.id, c.getContext("2d").getImageData(0, 0, 2, 2)); });
    map.on("load", function () { mapReady = true; buildRadarTimeline(); if (state) state.stations.forEach(renderMarker); updateSiteRadar(); });
    map.on("moveend", updateSiteRadar);
    map.on("error", function () { /* tile errors are not fatal */ });
    applyView();
  }

  /* ---------------- radar: 24 h observed (10-min frames) + 24 h forecast (HRRR) ----------------
     Observed frames are Iowa Mesonet NEXRAD composite tiles by timestamp. Forecast frames are the
     HRRR model's simulated reflectivity images Iowa Mesonet renders for the latest run
     (data/gis/images/4326/hrrr/refd_MMMM.png, one per forecast minute, with a .json giving the
     run and valid time). Both share one scrubber: left of "now" is what happened, right of it is
     where the model says the rain goes. */
  var HRRR = "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/";
  // the same product as transparent 256px tiles through Iowa Mesonet's WMS (the PNG images have an opaque black background)
  var HRRR_WMS = "https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&STYLES=&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true";
  var FC_HOURS = 24;
  function marketDayBounds() {
    // earliest gauge day start is Eastern standard midnight = 05Z; the latest end is Pacific standard midnight = 08Z next day
    var now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5, 0, 0));
    if (now.getTime() < start.getTime()) start = new Date(start.getTime() - 86400000);
    return { start: start.getTime(), end: start.getTime() + 27 * 3600000 };
  }
  function stamp(d) { return d.getUTCFullYear() + ("0" + (d.getUTCMonth() + 1)).slice(-2) + ("0" + d.getUTCDate()).slice(-2) + ("0" + d.getUTCHours()).slice(-2) + ("0" + d.getUTCMinutes()).slice(-2); }
  function pad4(n) { return ("0000" + n).slice(-4); }
  function buildRadarTimeline() {
    var now = new Date(); now.setUTCSeconds(0, 0); now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 5) * 5 - 5);   // composites lag a few minutes
    var frames = [], day = marketDayBounds();
    for (var t = day.start; t <= now.getTime(); t += RADAR_STEP_MIN * 60000) {
      var d = new Date(t);
      frames.push({ kind: "obs", id: "o" + stamp(d), ms: t, tiles: IEM + stamp(d) + "/{z}/{x}/{y}.png" });
    }
    if (!frames.length || frames[frames.length - 1].ms !== now.getTime()) frames.push({ kind: "obs", id: "o" + stamp(now), ms: now.getTime(), tiles: IEM + stamp(now) + "/{z}/{x}/{y}.png" });
    var nowIdx = frames.length - 1;
    fetchJSON(HRRR + "refd_0000.json?t=" + Math.floor(Date.now() / 300000), 8000).then(function (meta) {
      var init = Date.parse(meta.model_init_utc); if (!init) throw new Error("no init");
      var initLabel = new Date(init).toLocaleTimeString([], { hour: "numeric" });
      var fc = [];
      for (var mm = 15; mm <= 2880; mm += 15) {
        var lead = init + mm * 60000 - now.getTime();                    // ahead of the newest observed frame
        if (lead <= 0) continue;
        if (init + mm * 60000 > day.end) break;
        var leadMin = lead / 60000;
        var step = leadMin <= 180 ? 15 : leadMin <= 720 ? 30 : 60;         // finer near term, hourly past 12 h
        if (mm % step !== 0) continue;
        fc.push({ kind: "fc", id: "f" + init + "_" + mm, ms: init + mm * 60000, url: HRRR + "refd_" + pad4(mm) + ".png?i=" + init, init: initLabel, mm: mm });
      }
      finishTimeline(frames.concat(fc), nowIdx);
    }).catch(function () { finishTimeline(frames, nowIdx); $("frametime").textContent = "forecast radar unavailable"; });
  }
  function finishTimeline(frames, nowIdx) {
    var keep = {}; frames.forEach(function (f) { keep[f.id] = true; });
    Object.keys(radar.added).forEach(function (id) { if (!keep[id]) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); delete radar.added[id]; } });
    radar.frames = frames; radar.nowIdx = nowIdx;
    $("scrub").max = String(frames.length - 1);
    var split = frames.length > 1 ? (100 * nowIdx / (frames.length - 1)).toFixed(1) + "%" : "50%";
    $("scrub").style.background = "linear-gradient(90deg, #1f2a44 0%, #1f2a44 " + split + ", rgba(251,191,36,.35) " + split + ", rgba(251,191,36,.35) 100%)";
    var d0 = new Date(frames[0].ms), d1 = new Date(frames[frames.length - 1].ms);
    $("scrub").title = "market day: " + d0.toLocaleString([], { month: "short", day: "numeric", hour: "numeric" }) + " to " + d1.toLocaleString([], { month: "short", day: "numeric", hour: "numeric" }) + " (your time); arrow keys step, space plays";
    if (radar.live) radar.idx = nowIdx; else radar.idx = Math.min(radar.idx, frames.length - 1);
    renderTicks();
    ensureFrame(radar.idx); showFrame(radar.idx);
    if (radar.playing) startAnim();
  }
  function ensureFrame(i) {
    var f = radar.frames[i]; if (!f || radar.added[f.id] || !mapReady) return;
    if (f.kind === "obs") map.addSource(f.id, { type: "raster", tiles: [f.tiles], tileSize: 256, maxzoom: 11 });
    else map.addSource(f.id, { type: "raster", tileSize: 256, maxzoom: 12, tiles: [HRRR_WMS + "&LAYERS=refd_" + pad4(f.mm) + "&BBOX={bbox-epsg-3857}&i=" + f.init.replace(/\W/g, "")] });
    map.addLayer({ id: f.id, type: "raster", source: f.id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, map.getLayer("site") ? "site" : undefined);
    radar.added[f.id] = true;
  }
  function leadText(ms) {
    var m = Math.round(Math.abs(Date.now() - ms) / 60000), sign = ms > Date.now() ? "+" : "-";
    if (m < 15 && sign === "-") return "latest";
    return sign + (m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? (m % 60) + "m" : "") : m + "m");
  }
  function showFrame(i) {
    if (!mapReady) return;
    radar.idx = i; ensureFrame(i); ensureFrame(i + 1);
    radar.frames.forEach(function (f, j) { if (radar.added[f.id] && map.getLayer(f.id)) map.setPaintProperty(f.id, "raster-opacity", j === i ? radar.opacity : 0); });
    var f = radar.frames[i]; if (!f) return;
    var d = new Date(f.ms), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    var ft = $("frametime");
    ft.textContent = (f.kind === "fc" ? "FORECAST " + t + " (" + leadText(f.ms) + ") HRRR " + f.init : t + " (" + leadText(f.ms) + ")");
    ft.classList.toggle("fc", f.kind === "fc");
    $("scrub").value = String(i);
    var tk = $("ticks"); if (tk) { var n = radar.frames.length; tk.style.setProperty("--x", (n > 1 ? 100 * i / (n - 1) : 0) + "%"); }
    radar.live = i === radar.nowIdx;
    $("live").classList.toggle("on", radar.live);
    radar.frameMs = f.ms;
    updateCursors();
    updateSiteRadar();
  }

  /* ---------------- single-site radar when zoomed in ----------------
     The national composite is about 1 km. Past zoom 8, the nearest NEXRAD site's own
     latest sweep (250 m bins) is drawn on top for the LIVE frame; Iowa Mesonet keeps
     history only for the composite, so scrubbing back or forward uses that. */
  var SITE_TILES = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::";
  var NEXRAD = { ATL: "FFC", AUS: "EWX", BOS: "BOX", CHI: "LOT", DAL: "FWS", DC: "LWX", DEN: "FTG", EWR: "OKX", HOU: "HGX",
    LAX: "VTX", LV: "ESX", MIA: "AMX", MIN: "MPX", NOLA: "LIX", NYC: "OKX", OKC: "TLX", PHIL: "DIX", PHX: "IWA", SATX: "EWX",
    SEA: "ATX", SFO: "MUX", TTN: "DIX" };
  var site = { id: null, bucket: null };
  function nearestSite() {
    if (!state) return null;
    var c = map.getCenter(), best = null, bd = 1e9;
    state.stations.forEach(function (s) {
      if (s.lat === null || s.lat === undefined) return;
      var d = Math.pow(s.lat - c.lat, 2) + Math.pow((s.lon - c.lng) * Math.cos(c.lat * Math.PI / 180), 2);
      if (d < bd) { bd = d; best = s; }
    });
    return best ? NEXRAD[best.city] : null;
  }
  function updateSiteRadar() {
    if (!mapReady) return;
    var want = radar.live && map.getZoom() >= 8, id = want ? nearestSite() : null;
    var bucket = Math.floor(Date.now() / 300000);
    if (id && (id !== site.id || bucket !== site.bucket)) {
      if (map.getLayer("site")) map.removeLayer("site");
      if (map.getSource("site")) map.removeSource("site");
      map.addSource("site", { type: "raster", tileSize: 256, maxzoom: 12, tiles: [SITE_TILES + id + "-N0Q-0/{z}/{x}/{y}.png?t=" + bucket] });
      map.addLayer({ id: "site", type: "raster", source: "site", paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0, "raster-resampling": "nearest" } });
      site.id = id; site.bucket = bucket;
    }
    if (map.getLayer("site")) map.setPaintProperty("site", "raster-opacity", want ? radar.opacity : 0);
    // when the fine site sweep is showing, hide the 1 km composite under it so the
    // close-up is the sharp picture, not the blocky one with a sharp picture on top
    var lf = radar.frames[radar.nowIdx];
    if (lf && radar.added[lf.id] && map.getLayer(lf.id) && radar.live) map.setPaintProperty(lf.id, "raster-opacity", (want && id) ? 0 : radar.opacity);
    var ft = $("frametime");
    ft.title = want && id ? "zoomed in: " + id + " radar site, 250 m" : "";
    $("sitetag").textContent = want && id ? id + " site radar" : "";
  }
  function startAnim() {
    if (radar.timer) clearInterval(radar.timer);
    // the loop runs from two hours ago through six hours ahead, then restarts
    var start = Math.max(0, radar.nowIdx - 12), end = radar.frames.length - 1;
    for (var j = radar.nowIdx; j < radar.frames.length; j++) { if (radar.frames[j].ms - Date.now() > 6 * 3600000) { end = j; break; } }
    radar.timer = setInterval(function () {
      var n = radar.idx + 1; if (n > end) n = start;
      showFrame(n);
    }, 550);
  }
  $("play").onclick = function () {
    radar.playing = !radar.playing; this.textContent = radar.playing ? "pause" : "play";
    if (radar.playing) startAnim(); else if (radar.timer) { clearInterval(radar.timer); radar.timer = null; }
  };
  $("live").onclick = function () { radar.live = true; showFrame(radar.nowIdx); };
  $("us").onclick = function () { map.flyTo({ center: [-96.5, 38.2], zoom: 3.6, speed: 1.2 }); if (popup) popup.remove(); };
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      radar.playing = false; $("play").textContent = "play"; if (radar.timer) { clearInterval(radar.timer); radar.timer = null; }
      showFrame(Math.max(0, Math.min(radar.frames.length - 1, radar.idx + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === " ") { e.preventDefault(); $("play").click(); }
  });
  $("scrub").oninput = function () { radar.playing = false; $("play").textContent = "play"; if (radar.timer) { clearInterval(radar.timer); radar.timer = null; } showFrame(+this.value); };
  $("opacity").oninput = function () { radar.opacity = this.value / 100; showFrame(radar.idx); };

  /* ---------------- clickable time: hour bars, timeline cells and the tick row all jump the radar ----------------
     Colin, 2026-09-04: "clickable forecast markers instead of just a pause and play live function". */
  function stopAnim() { radar.playing = false; $("play").textContent = "play"; if (radar.timer) { clearInterval(radar.timer); radar.timer = null; } }
  function localHourToMs(s, h) {
    // station local hour h on the station's civil day, as a UTC instant, using the collector's offset
    var off = (s.tz_offset_min !== undefined && s.tz_offset_min !== null) ? s.tz_offset_min : (s.utc_offset_std || 0) * 60;
    var d = (s.local_day || "").split("-").map(Number); if (d.length !== 3 || !d[0]) return null;
    return Date.UTC(d[0], d[1] - 1, d[2], h, 0, 0) - off * 60000;
  }
  function jumpToMs(ms, label) {
    if (!radar.frames.length || ms === null) return;
    var best = 0, bd = Infinity;
    radar.frames.forEach(function (f, i) { var d = Math.abs(f.ms - ms); if (d < bd) { bd = d; best = i; } });
    stopAnim(); showFrame(best);
    if (bd > 45 * 60000) toast((label ? label + ": " : "") + "outside the radar range, showing " + new Date(radar.frames[best].ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    else if (label) toast("radar at " + label);
    if (document.body.classList.contains("mobile") && currentTab !== "map") showTab("map");
  }
  function jumpToLocalHour(s, h) { jumpToMs(localHourToMs(s, h), hourLabel(h) + " " + s.city); }
  function renderTicks() {
    var el = $("ticks"); if (!el) return; el.innerHTML = "";
    var n = radar.frames.length; if (n < 2) return;
    var lastLabelX = -1e9, W = el.clientWidth || 600;
    radar.frames.forEach(function (f, i) {
      var d = new Date(f.ms), isNow = i === radar.nowIdx, onHour = d.getMinutes() === 0;
      if (!onHour && !isNow) return;
      var x = i / (n - 1) * W;
      if (!isNow && x - lastLabelX < 34) return;
      var t = document.createElement("span");
      t.className = "tick" + (f.kind === "fc" ? " fc" : "") + (isNow ? " now" : "");
      t.style.left = (100 * i / (n - 1)) + "%";
      t.textContent = isNow ? "NOW" : d.toLocaleTimeString([], { hour: "numeric" }).replace(" ", "").toLowerCase();
      t.title = d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + (f.kind === "fc" ? " (HRRR forecast)" : " (observed)") + ", click to jump";
      t.onclick = function () { stopAnim(); showFrame(i); };
      el.appendChild(t); lastLabelX = x;
    });
  }

  /* ---------------- the timeline (mobile Board tab): one row per sensor ---------------- */
  function stationLocalFraction(s, ms) {
    // fraction of the station's civil day for a UTC instant, using the offset the collector read from NWS
    var off = (s.tz_offset_min !== undefined && s.tz_offset_min !== null) ? s.tz_offset_min : (s.utc_offset_std || 0) * 60;
    var local = new Date(ms + off * 60000);
    return (local.getUTCHours() + local.getUTCMinutes() / 60) / 24;
  }
  function renderTimeline(S) {
    var el = $("trows"); if (!el) return; el.innerHTML = "";
    S.stations.slice().sort(function (a, b) { return (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (peak(b) || 0) - (peak(a) || 0); }).forEach(function (s) {
      var f = s.forecast || {}, o = s.observed, k = s.market || {}, lv = levelOf(s), c = COLORS[lv];
      var byHour = {}; (f.hourly_seen || []).forEach(function (h) { byHour[h[0]] = h[1]; }); (f.hourly || []).forEach(function (h) { byHour[h[0]] = h[1]; });
      var wet = (o && o.wet_hours) || [];
      var cells = "";
      for (var h = 0; h < 24; h++) {
        var p = byHour[h], past = s.local_hour !== null && s.local_hour !== undefined && h < s.local_hour;
        var dh = ' data-h="' + h + '"';
        if (wet.indexOf(h) >= 0) cells += '<i' + dh + ' style="height:100%;background:#38bdf8" title="' + hourLabel(h) + ': gauge recorded rain (click: radar then)"></i>';
        else if (p === undefined) cells += '<i' + dh + ' class="none" style="height:3px" title="' + hourLabel(h) + ': no forecast on record"></i>';
        else if (past && s.overdue && p >= 50) cells += '<i' + dh + ' class="missed" style="height:' + Math.max(3, p) + '%" title="' + hourLabel(h) + ': was ' + p + '%, stayed dry (click: radar then)"></i>';
        else cells += '<i' + dh + ' class="' + (past ? "past" : "") + (h === f.pop_peak_hour ? " peak" : "") + '" style="height:' + Math.max(3, p) + '%" title="' + hourLabel(h) + ': ' + p + '%' + (past ? " (as forecast)" : "") + ' (click: radar then)"></i>';
      }
      var drops = wet.map(function (h) { return '<span class="wet" style="left:' + ((h + 0.5) / 24 * 100) + '%">&#128167;</span>'; }).join("");
      var nowPct = (stationLocalFraction(s, Date.now()) * 100).toFixed(2);
      var ps = peakState(s), as = areaState(s);
      var status = (o && o.locked ? '<span class="st lockc">LOCKED ' + (o.in_today || 0).toFixed(2) + '" ' + dayLabel(s) + '</span>' : "")
        + (!isLocked(s) && (ps.kind === "past" || ps.kind === "second") ? '<span class="st pastc" title="' + ps.text + '">' + ps.short + '</span>' : "")
        + (!isLocked(s) && !rainingNow(s) && as.kind === "none" ? '<span class="st quietc" title="' + as.text + '">NO RAIN NEAR</span>' : "")
        + (rainingNow(s) && !(o && o.locked) ? '<span class="st rainc">RAINING</span>' : "")
        + (!rainingNow(s) && !(o && o.locked) && (s.neighbors || []).some(function (n) { var lp = pulseFor(n.id); return lp ? lp.raining : n.raining; }) ? '<span class="st nearc">RAIN NEARBY</span>' : "")
        + (s.overdue ? '<span class="st overc">OVERDUE</span>' : "");
      var row = document.createElement("div");
      row.className = "trow" + (s.overdue ? " overdue" : "") + (o && o.locked ? " locked" : ""); row.style.setProperty("--c", c); row.dataset.city = s.city;
      row.innerHTML = '<div class="th"><b>' + s.city + '</b><span class="pk">' + headline(s) + '</span><span class="win">' + (isLocked(s) ? "rained; was " + pct(f.pop_peak) : windowText(s)) + '</span>' + status
        + '<span class="k">Kalshi <b>' + cents(k.yes_ask) + '</b></span></div>'
        + '<div class="tl"><div class="cells">' + cells + '</div>' + drops + '<div class="now" style="left:' + nowPct + '%"></div><div class="cur" style="left:' + nowPct + '%"></div></div>'
        + '<div class="tlbl"><span>12am</span><span>6am</span><span>noon</span><span>6pm</span><span>12am</span></div>';
      row.onclick = function () { openCard(s.city); };
      row.querySelector(".cells").onclick = function (ev) { var t = ev.target; if (t && t.tagName === "I" && t.dataset.h !== undefined) { ev.stopPropagation(); jumpToLocalHour(s, +t.dataset.h); } };
      el.appendChild(row);
    });
    updateCursors();
  }
  function updateCursors() {
    if (!state) return;
    var ms = radar.frameMs || Date.now();
    document.querySelectorAll("#trows .trow").forEach(function (row) {
      var s = state.stations.filter(function (x) { return x.city === row.dataset.city; })[0]; if (!s) return;
      var cur = row.querySelector(".cur"), now = row.querySelector(".now");
      if (cur) cur.style.left = (stationLocalFraction(s, ms) * 100).toFixed(2) + "%";
      if (now) now.style.left = (stationLocalFraction(s, Date.now()) * 100).toFixed(2) + "%";
    });
  }


  /* ---------------- state ---------------- */
  function loadState() {
    fetchJSON(dataURL(STATE_URL), 8000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL(STATE_URL) : STATE_URL, 8000); }).catch(function () { return fetchJSON(SAMPLE_URL, 8000).then(function (s) { s._sample = true; return s; }); })
      .then(function (s) { state = s; try { if (!s._sample) localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { } render(); })
      .catch(function () { $("updated").textContent = "data unreachable"; $("updated").classList.add("old"); });
  }
  function bootFromCache() {
    try { var c = localStorage.getItem(LS_KEY); if (c) { state = JSON.parse(c); state._cached = true; render(); } } catch (e) { }
  }
  function tick() {
    var el = $("updated"); if (!state) return;
    var m = (Date.now() - Date.parse(state.generated_utc)) / 60000;
    el.textContent = (ON_MIRROR ? "mirror, " : "") + (state._sample ? "SAMPLE DATA, " : state._cached ? "cached, " : "") + "updated " + ago(state.generated_utc);
    el.classList.toggle("old", m > 15 || !!state._sample);
  }

  var DEMO_OVERDUE = /[?&]demo=overdue/.test(location.search);   // visual check only: marks the two highest stations overdue
  function render() {
    var S = state, sum = S.summary || {};
    if (DEMO_OVERDUE && !S._demo) {
      S._demo = true;
      S.stations.slice().sort(function (a, b) { return (peak(b) || 0) - (peak(a) || 0); }).slice(0, 2).forEach(function (s) { s.overdue = true; });
      sum.overdue = S.stations.filter(function (s) { return s.overdue; }).map(function (s) { return s.city; });
    }
    var ob = $("overdue-banner");
    if ((sum.overdue || []).length) {
      ob.hidden = false;
      ob.innerHTML = '&#9888; OVERDUE: rain was expected and the gauge is still dry ' + (sum.overdue || []).map(function (c) {
        var s = S.stations.filter(function (x) { return x.city === c; })[0];
        return '<span class="ob" data-city="' + c + '">' + c + ' ' + (s ? pct(peak(s)) + ' peak ' + hourLabel(s.forecast.pop_peak_hour) + ', dry at ' + hourLabel(s.local_hour) : '') + '</span>';
      }).join("");
      ob.querySelectorAll(".ob").forEach(function (el) { el.onclick = function () { openCard(el.dataset.city); }; });
    } else { ob.hidden = true; }
    $("s-over").parentNode.classList.toggle("hot", (sum.overdue || []).length > 0);
    $("s-ok").textContent = sum.n_ok;
    var lockedSet = {}; (sum.locked || []).forEach(function (c) { lockedSet[c] = true; });
    var open = function (list) { return (list || []).filter(function (c) { return !lockedSet[c]; }); };
    $("s-70").textContent = open(sum.above_70).length; $("s-90").textContent = open(sum.above_90).length;
    $("s-lock").textContent = (sum.locked || []).length; $("s-rain").textContent = (sum.raining || []).length;
    $("s-over").textContent = (sum.overdue || []).length; $("s-wx").textContent = (sum.weather_alerts || []).length;
    tick();
    if (mapReady) S.stations.forEach(renderMarker);
    renderPanel(S); renderStrip(S); renderTimeline(S); renderAlerts(S);
    refreshOpenCard();
    firstRender = false;
  }

  function markerEl(s) {
    var el = document.createElement("div"); el.className = "marker";
    el.innerHTML = '<div class="halo"></div><div class="core"></div><div class="tag">' + s.city + '<small></small></div>';
    el.onclick = function () { openCard(s.city); };
    return el;
  }
  function renderMarker(s) {
    if (s.lat === null || s.lat === undefined) return;
    var lv = levelOf(s), c = COLORS[lv], p = peak(s) || 0, size = 12 + Math.round(p / 5), halo = size * 2.4;
    var m = markers[s.city];
    if (!m) { m = markers[s.city] = new maplibregl.Marker({ element: markerEl(s), anchor: "center" }).setLngLat([s.lon, s.lat]).addTo(map); }
    var el = m.getElement();
    el.style.setProperty("--c", c);
    var ps = peakState(s), as = areaState(s);
    el.className = "marker" + ((s.observed && s.observed.locked) ? " locked" : "") + (s.overdue ? " overdue" : "") + (s.status === "stale" ? " stale" : "")
      + (!isLocked(s) && !s.overdue && ps.kind === "past" ? " pastpeak" : "") + (!isLocked(s) && !s.overdue && !rainingNow(s) && as.kind === "none" ? " quiet" : "");
    el.title = verdict(s).text;
    var core = el.querySelector(".core"), h = el.querySelector(".halo");
    core.style.width = core.style.height = size + "px"; h.style.width = h.style.height = halo + "px";
    el.querySelector(".tag small").textContent = isLocked(s) ? headline(s) + (dayLabel(s) ? " " + dayLabel(s) : "") : (p ? p + "%" : "");
    el.style.zIndex = String(100 + p);
  }
  function sparkline(hist) {
    var pts = (hist || []).slice(-48).map(function (h) { return h[1]; }).filter(function (v) { return v !== null && v !== undefined; });
    if (pts.length < 2) return "";
    var w = 260, hgt = 40, step = w / (pts.length - 1);
    var d = pts.map(function (v, i) { return (i ? "L" : "M") + (i * step).toFixed(1) + "," + (hgt - v / 100 * hgt).toFixed(1); }).join(" ");
    return '<svg width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + ' ' + hgt + '"><line x1="0" x2="' + w + '" y1="' + (hgt * 0.1) + '" y2="' + (hgt * 0.1) + '" stroke="#a855f7" stroke-dasharray="3 4" opacity=".5"/><path d="' + d + '" fill="none" stroke="#60a5fa" stroke-width="2"/></svg>';
  }
  function hourBars(s) {
    var byH = {}; ((s.forecast && s.forecast.hourly_seen) || []).forEach(function (h) { byH[h[0]] = [h[0], h[1], "as forecast"]; }); ((s.forecast && s.forecast.hourly) || []).forEach(function (h) { byH[h[0]] = h; });
    var hourly = Object.keys(byH).map(function (k) { return byH[k]; }).sort(function (a, b) { return a[0] - b[0]; }); if (!hourly.length) return "";
    var now = s.local_hour, f = s.forecast || {}, w = f.window, marks = [];
    if (now !== null && now !== undefined) marks.push([now, "now", "now"]);
    if (f.pop_peak_hour !== null && f.pop_peak_hour !== undefined) marks.push([f.pop_peak_hour, "peak", "peak " + hourLabel(f.pop_peak_hour)]);
    if (w) { marks.push([w.start, "win", "rain from " + hourLabel(w.start)]); if (w.end !== w.start) marks.push([w.end + 1, "win", "to " + hourLabel(w.end + 1)]); }
    var rem = remainingPeak(s); if (rem && rem.hour !== f.pop_peak_hour && rem.hour > (now || 0)) marks.push([rem.hour, "rem", "next " + hourLabel(rem.hour) + " " + rem.pop + "%"]);
    return '<div class="hourmarks">' + marks.map(function (m) { return '<button class="hm ' + m[1] + '" data-h="' + m[0] + '" title="click: radar at ' + hourLabel(m[0]) + '">' + m[2] + '</button>'; }).join("") + '</div>'
      + '<div class="hourbar" style="--c:' + COLORS[levelOf(s)] + '">' + hourly.map(function (h) {
      var past = now !== null && now !== undefined && h[0] < now;
      return '<i data-h="' + h[0] + '" class="' + (h[0] === now ? "now" : "") + (past ? " past" : "") + (h[0] === f.pop_peak_hour ? " peak" : "") + '" style="height:' + Math.max(2, h[1] * 0.34) + 'px" title="' + hourLabel(h[0]) + ' ' + h[1] + '% ' + (h[2] || "") + ' (click: radar at ' + hourLabel(h[0]) + ')"><b>' + hourLabel(h[0]).replace(/[ap]m/, "") + '</b></i>';
    }).join("") + '</div><div class="hourlbl"><span>' + hourLabel(hourly[0][0]) + '</span><span>hourly chance today, click an hour to see the radar then</span><span>' + hourLabel(hourly[hourly.length - 1][0]) + '</span></div>';
  }
  function cardHTML(s) {
    var f = s.forecast || {}, o = s.observed, t = s.trend || {}, k = s.market || {}, lv = levelOf(s), c = COLORS[lv];
    var chips = '<div class="chips">'
      + '<span class="chip ' + lv + '">' + lv.toUpperCase() + '</span>'
      + (o && o.locked ? '<span class="chip lockc">LOCKED ' + (o.in_today || 0).toFixed(2) + ' in</span>' : "")
      + (rainingNow(s) ? '<span class="chip rainc">RAINING AT GAUGE</span>' : "")
      + (!rainingNow(s) && !isLocked(s) && (s.neighbors || []).some(function (n) { var lp = pulseFor(n.id); return lp ? lp.raining : n.raining; }) ? '<span class="chip nearc">RAIN NEARBY</span>' : "")
      + (!rainingNow(s) && !isLocked(s) && s.radar && s.radar.nearest_km !== null && s.radar.nearest_km !== undefined && s.radar.nearest_km <= 15 ? '<span class="chip nearc">ECHOES ' + s.radar.nearest_km + ' KM ' + s.radar.nearest_dir + '</span>' : "")
      + (s.overdue ? '<span class="chip overc">OVERDUE</span>' : "")
      + (k.yes_ask !== null && k.yes_ask !== undefined && k.yes_ask >= 0.9 && !(o && o.locked) ? '<span class="chip wxc">MARKET ' + cents(k.yes_ask) + ', GAUGE DRY</span>' : "")
      + ((t.delta_3h || 0) >= 10 ? '<span class="chip high">RISING FAST</span>' : "")
      + (s.status === "stale" ? '<span class="chip stalec">STALE</span>' : "") + "</div>";
    var wx = (s.nws_alerts || []).map(function (a) { return '<div class="wx">&#9888; ' + a.event + (a.severity ? " (" + a.severity + ")" : "") + '</div>'; }).join("");
    var price = '<div class="price"><span>Kalshi YES <b>' + cents(k.yes_ask) + '</b> ask / ' + cents(k.yes_bid) + ' bid</span><span>NWS <b>' + pct(f.pop_peak) + '</b></span><span class="gap ' + gapClass(k.gap) + '">gap <b>' + gapText(k.gap) + '</b></span></div>'
      + nextMarketHTML(s);
    var v = verdict(s), ncam = camsFor(s.city).length;
    return '<div class="card"><h2>' + s.name + ' <small>' + s.icao + ' / ' + s.cli + '</small><button class="chipbtn focus" title="zoom to the gauge with the site radar">zoom in</button>' + (ncam ? '<button class="chipbtn cams" title="every live camera near the gauge">all cams (' + ncam + ')</button>' : "") + '</h2>'
      + '<div class="big" style="color:' + c + '">' + headline(s) + '<small>' + (isLocked(s) ? "on the gauge, " + dayNote(s) + ", settles YES (forecast was " + pct(f.pop_peak) + ")" : windowText(s)) + '</small></div>'
      + '<div class="verdict ' + v.cls + '">' + v.text + '</div>'
      + '<div class="camslot"></div>'
      + chips + wx + price
      + evidenceHTML(s)
      + situationHTML(s)
      + hourBars(s)
      + '<div class="row"><span>now ' + hourLabel(s.local_hour) + ' local</span><b>' + pct(f.pop_now) + '</b></div>'
      + '<div class="row"><span>trend 1h / 3h</span><b>' + arrow(t.delta_1h) + ' ' + arrow(t.delta_3h) + '</b></div>'
      + '<div class="row"><span>gauge today</span><b>' + (o ? (o.in_today || 0).toFixed(2) + ' in' : "no obs") + '</b></div>'
      + '<div class="row"><span>market</span><b>' + (k.ticker || "") + (k.volume ? " &middot; vol " + Math.round(k.volume) : "") + '</b></div>'
      + sparkline(t.history)
      + '<div class="row"><span>forecast ' + ago(f.fetched_utc) + '</span><span>ob ' + (o ? ago(o.latest_ob_utc) : "-") + '</span><span>price ' + ago(k.fetched_utc) + '</span></div>'
      + (o && o.latest_raw ? '<div class="metar">' + o.latest_raw + '</div>' : "") + "</div>";
  }
  /* Once a gauge is locked, or once the civil clock has passed midnight while the standard-time
     day still has an hour to run, the market that matters is TOMORROW's. The collector fetches it
     as next_market; show it beside the settled one so a 99c lock is never read as today's price. */
  var nextMarkets = {};
  function loadNext() { fetchJSON(dataURL("data/next_markets.json"), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("data/next_markets.json") : "data/next_markets.json", 6000); }).then(function (n) { nextMarkets = (n && n.markets) || {}; if (state) render(); }).catch(function () { }); }
  function nextFor(s) { return s.next_market || nextMarkets[s.city] || null; }
  function nextMarketHTML(s) {
    var n = nextFor(s); if (!n || !n.ticker) return "";
    var day = (n.day || (n.ticker.split("-")[1] || "")).toString();
    return '<div class="price next"><span>NEXT DAY ' + day + ': YES <b>' + cents(n.yes_ask) + '</b> ask / ' + cents(n.yes_bid) + ' bid</span><span class="muted">' + (n.status || "") + '</span></div>';
  }
  function situationHTML(s) {
    var lines = (s.situation || []).slice(), pulse = livePulse(s);
    if (pulse && pulse.raining && !(s.metar && s.metar.raining)) lines.unshift("RAINING AT THE GAUGE now (" + pulse.wx + "), reported " + (pulse.time_utc || "").slice(11, 16) + "Z (1-min feed)");
    else if (pulse && !pulse.raining && pulse.nws && pulse.nws.raining) lines.unshift("RAINING AT THE GAUGE now: the sensor's 5-minute report says " + pulse.nws.text + " at " + (pulse.nws.time_utc || "").slice(11, 16) + "Z (METAR text not updated yet)");
    var nb = (s.neighbors || []).slice(0, 5).map(function (n) {
      var lp = pulseFor(n.id), raining = lp ? lp.raining : n.raining, wx = lp ? lp.wx : n.wx;
      return (raining ? "<b>" : "") + n.id.replace(/^K/, "") + " " + Math.round(n.dist_km) + "km " + n.bearing + (raining ? " " + wx + "</b>" : " dry");
    }).join(" &middot; ");
    if (!lines.length && !nb) return "";
    return '<div class="sit"><h4>What is happening at the gauge</h4>' + lines.map(function (l) { return '<div class="' + (/^RAINING/.test(l) ? "hot" : "") + '">' + l + '</div>'; }).join("")
      + (nb ? '<div class="nb">nearby airports: ' + nb + '</div>' : "") + '</div>';
  }
  /* live cameras near each gauge (data/cams.json, verified entries only) */
  var cams = {};
  function loadCams() { fetchJSON(dataURL("data/cams.json"), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("data/cams.json") : "data/cams.json", 6000); }).then(function (c) { cams = (c && c.cams) || {}; }).catch(function () { }); }
  function camsFor(city) { return cams[city] || []; }
  function openCams(city) {
    var list = camsFor(city), s = state.stations.filter(function (x) { return x.city === city; })[0];
    var box = $("cammodal"); box.hidden = false;
    var html = '<div class="camhead"><b>' + (s ? s.name : city) + '</b> live cameras near the gauge <button class="chipbtn" id="camclose">close</button></div>';
    if (!list.length) html += '<div class="camnone">No verified public camera near this gauge yet.</div>';
    html += '<div class="camgrid">';
    list.forEach(function (c) {
      html += '<div class="cam"><div class="camlbl">' + c.name + (c.dist_km ? ' &middot; ' + c.dist_km + ' km ' + (c.dir || '') : '') + ' from the gauge</div>';
      if (c.type === "youtube") html += '<iframe src="https://www.youtube.com/embed/' + c.id + '?autoplay=1&mute=1&playsinline=1" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>';
      else if (c.type === "image") html += '<img class="camimg" referrerpolicy="no-referrer" data-src="' + c.url + '" src="' + c.url + (c.url.indexOf("?") >= 0 ? "&" : "?") + 't=' + Date.now() + '" alt="' + c.name + '">';
      html += '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
    $("camclose").onclick = closeCams;
  }
  var camTimer = null;
  function closeCams() { var box = $("cammodal"); box.hidden = true; box.innerHTML = ""; if (camTimer) { clearInterval(camTimer); camTimer = null; } }
  /* The nearest camera lives on the card itself (Colin, 2026-09-04: "the cards should link directly
     to the cameras that are closest automatically"). cams.json is kept sorted by distance, so the
     first entry is the nearest verified one; the node is built once per city and re-attached on
     each quiet refresh so a YouTube embed does not reload every minute. */
  var camNode = { city: null, idx: 0, el: null };
  function camMediaHTML(c) {
    if (c.type === "youtube") return '<iframe src="https://www.youtube.com/embed/' + c.id + '?autoplay=1&mute=1&playsinline=1" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>';
    if (c.type === "image") return '<img class="camimg" referrerpolicy="no-referrer" data-src="' + c.url + '" src="' + c.url + (c.url.indexOf("?") >= 0 ? "&" : "?") + 't=' + Date.now() + '" alt="' + c.name + '">';
    return "";
  }
  function buildCamNode(city) {
    var list = camsFor(city), el = document.createElement("div"); el.className = "camlive";
    if (!list.length) { el.innerHTML = '<div class="camnone small">no verified public camera near this gauge yet</div>'; return el; }
    var i = Math.min(camNode.city === city ? camNode.idx : 0, list.length - 1), c = list[i];
    el.innerHTML = '<div class="camlbl"><b>LIVE CAM</b> nearest verified: ' + (c.dist_km ? c.dist_km + ' km ' + (c.dir || '') + ' of the gauge' : '') + (list.length > 1 ? ' <button class="chipbtn camnext">next cam (' + (i + 1) + '/' + list.length + ')</button>' : '') + '<div class="camname">' + c.name + '</div></div>' + camMediaHTML(c);
    var nb = el.querySelector(".camnext"); if (nb) nb.onclick = function () { camNode.idx = (i + 1) % list.length; camNode.el = null; refreshOpenCard(); };
    camNode.city = city; camNode.idx = i;
    return el;
  }
  function mountCam(panel, city) {
    var slot = panel.querySelector(".camslot"); if (!slot) return;
    if (!camNode.el || camNode.city !== city) { camNode.el = buildCamNode(city); camNode.city = city; }
    slot.appendChild(camNode.el);
  }
  setInterval(function () { document.querySelectorAll("img.camimg").forEach(function (im) { var u = im.dataset.src; if (u) im.src = u + (u.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now(); }); }, 60000);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCams(); });
  /* the one-minute METAR pulse (data/metars.json): fresher than the collector's 5 minutes */
  var pulse = null;
  function loadPulse() { fetchJSON(dataURL("data/metars.json"), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("data/metars.json") : "data/metars.json", 6000); }).then(function (p) { pulse = p; if (state) render(); }).catch(function () { }); }
  function pulseFor(icao) { return pulse && pulse.stations ? pulse.stations[icao] : null; }
  function livePulse(s) { return pulseFor(s.icao); }
  function rainingNow(s) { var lp = livePulse(s); return lp ? lp.raining : !!(s.metar && s.metar.raining) || !!(s.observed && s.observed.raining_now); }
  /* The station card is a fixed, scrollable panel (Colin: the map popup was cut off
     at the bottom). It re-renders on every state and pulse refresh while open. */
  var openCity = null;
  function openCard(city, quiet) {
    var s = state.stations.filter(function (x) { return x.city === city; })[0]; if (!s) return;
    openCity = city;
    if (document.body.classList.contains("mobile")) showTab("map");
    var panel = $("cardpanel"); panel.hidden = false;
    var keepScroll = panel.scrollTop;
    if (camNode.el && camNode.el.parentNode) camNode.el.parentNode.removeChild(camNode.el);   // keep the embed alive across the re-render
    panel.innerHTML = '<div class="cardtop"><button class="chipbtn cardclose" title="close">close</button></div>' + cardHTML(s) + freshnessHTML(s);
    mountCam(panel, s.city);
    panel.scrollTop = quiet ? keepScroll : 0;
    panel.querySelector(".cardclose").onclick = closeCard;
    var cb = panel.querySelector(".cams"); if (cb) cb.onclick = function () { openCams(s.city); };
    panel.querySelectorAll(".hourbar i[data-h], .hourmarks .hm[data-h]").forEach(function (b) { b.onclick = function (ev) { ev.stopPropagation(); jumpToLocalHour(s, +b.dataset.h); }; });
    var fb = panel.querySelector(".focus"); if (fb) fb.onclick = function () { radar.live = true; showFrame(radar.nowIdx); if (mapReady && s.lat !== null && s.lat !== undefined) map.flyTo({ center: [s.lon, s.lat], zoom: 9.5, speed: 1.1 }); };
    if (!quiet && mapReady && s.lat !== null && s.lat !== undefined) map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 5.5), speed: 0.8 });
  }
  function closeCard() { openCity = null; camNode.el = null; camNode.city = null; var p = $("cardpanel"); p.hidden = true; p.innerHTML = ""; }
  function refreshOpenCard() { if (openCity) openCard(openCity, true); }
  function freshnessHTML(s) {
    var lp = livePulse(s), t = lp ? lp.time_utc : (s.metar && s.metar.time_utc);
    var m = t ? Math.round((Date.now() - Date.parse(t)) / 60000) : null;
    return '<div class="fresh"><b>Where this comes from.</b> The gauge line is the station\'s own report (aviationweather.gov METAR/SPECI): last one ' + (t ? t.slice(11, 16) + 'Z, ' + (m === null ? '' : m + ' min ago') : 'none yet') + '. The station reports every hour at about :51-:56 and sends a SPECI within minutes when rain starts or stops; this board polls it every 60 s. Radar rings, neighbours and Kalshi prices refresh every 5 min; the forecast hourly; the model every HRRR run.</div>';
  }

  function chips(id, cities, cls, label) {
    var el = $(id); el.innerHTML = "";
    if (!cities || !cities.length) { el.innerHTML = '<span class="chip none">none</span>'; return; }
    cities.forEach(function (c) {
      var s = state.stations.filter(function (x) { return x.city === c; })[0];
      var sp = document.createElement("span"); sp.className = "chip " + (cls || (s ? levelOf(s) : ""));
      sp.textContent = c + (label && s ? " " + label(s) : (s && peak(s) !== null ? " " + peak(s) + "%" : "")); sp.onclick = function () { openCard(c); }; el.appendChild(sp);
    });
  }
  function li(html, city) { var e = document.createElement("li"); e.innerHTML = html; if (city) e.onclick = function () { openCard(city); }; return e; }
  function renderPanel(S) {
    var sum = S.summary || {};
    chips("goverdue", sum.overdue, "overc", function (s) { return "peak " + hourLabel(s.forecast.pop_peak_hour) + " " + peak(s) + "%, dry at " + hourLabel(s.local_hour); });
    var wx = $("wxalerts"); wx.innerHTML = "";
    var wxRows = []; S.stations.forEach(function (s) { (s.nws_alerts || []).forEach(function (a) { wxRows.push([s.city, a]); }); });
    if (!wxRows.length) wx.appendChild(li('<span class="empty">no active NWS alerts at any gauge</span>'));
    wxRows.forEach(function (r) { wx.appendChild(li('<span class="kind sev">' + (r[1].severity || "alert") + '</span><span><b>' + r[0] + '</b> ' + r[1].event + '</span>', r[0])); });
    var door = $("door"); if (door) {
      door.innerHTML = "";
      var rows = S.stations.filter(function (s) { return !isLocked(s) && (rainingNow(s) || (sum.rain_nearby || []).indexOf(s.city) >= 0); })
        .sort(function (a, b) { return (rainingNow(b) ? 1 : 0) - (rainingNow(a) ? 1 : 0); });
      if (!rows.length) door.appendChild(li('<span class="empty">no dry gauge with rain at the door right now</span>'));
      rows.forEach(function (s) {
        var k = s.market || {}, first = (s.situation || [])[0] || "";
        door.appendChild(li('<span class="kind ' + (rainingNow(s) ? "rain_detected" : "cross_50") + '">' + (rainingNow(s) ? "raining" : "nearby") + '</span><span><b>' + s.city + '</b> ' + first + ' <span style="color:var(--muted)">(Kalshi ' + cents(k.yes_ask) + ')</span></span>', s.city));
      });
    }
    var mv = $("movers"); if (mv) {
      mv.innerHTML = "";
      if (!(sum.movers_15m || []).length) mv.appendChild(li('<span class="empty">no price moving more than a cent in the last 15 min</span>'));
      (sum.movers_15m || []).forEach(function (x) {
        var s = S.stations.filter(function (y) { return y.city === x[0]; })[0], k = (s && s.market) || {}, mo = k.momentum || {};
        mv.appendChild(li('<b>' + x[0] + '</b><span>' + cents(k.yes_ask) + ' &middot; ' + (mo.vol_15m || 0) + ' contracts</span><span class="t gap ' + (x[1] > 0 ? "pos" : "neg") + '">' + (x[1] > 0 ? "+" : "") + x[1] + ' / 15m</span>', x[0]));
      });
    }
    var g = $("gaps"); g.innerHTML = "";
    if (!(sum.top_gaps || []).length) g.appendChild(li('<span class="empty">no prices yet</span>'));
    (sum.top_gaps || []).forEach(function (x) {
      var s = S.stations.filter(function (y) { return y.city === x[0]; })[0], k = (s && s.market) || {};
      g.appendChild(li('<b>' + x[0] + '</b><span>Kalshi ' + cents(k.yes_ask) + ' vs NWS ' + pct(peak(s)) + '</span><span class="t gap ' + gapClass(x[1]) + '">' + gapText(x[1]) + '</span>', x[0]));
    });
    // Colin: DC and Seattle are not "watch", it has already rained there. Locked stations leave the watch lists.
    var lk = {}; (sum.locked || []).forEach(function (c) { lk[c] = true; });
    var notLocked = function (list) { return (list || []).filter(function (c) { return !lk[c]; }); };
    chips("g90", notLocked(sum.above_90)); chips("g80", notLocked(sum.above_80).filter(function (c) { return (sum.above_90 || []).indexOf(c) < 0; }));
    chips("g70", notLocked(sum.above_70).filter(function (c) { return (sum.above_80 || []).indexOf(c) < 0; }));
    chips("glock", sum.locked, "lockc"); chips("grain", sum.raining, "rainc");
    chips("gstale", S.stations.filter(function (s) { return s.status === "stale"; }).map(function (s) { return s.city; }), "stalec");
    var r = $("risers"); r.innerHTML = "";
    if (!(sum.top_risers || []).length) r.appendChild(li('<span class="empty">no movement in the last 3 h</span>'));
    (sum.top_risers || []).forEach(function (x) { r.appendChild(li('<b>' + x[0] + '</b> ' + arrow(x[1]), x[0])); });
  }
  function renderStrip(S) {
    var el = $("strip"); el.innerHTML = "";
    S.stations.slice().sort(function (a, b) { return (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (peak(b) || 0) - (peak(a) || 0); }).forEach(function (s) {
      var f = s.forecast || {}, o = s.observed, k = s.market || {}, lv = levelOf(s), d = document.createElement("div");
      d.className = "mini" + (o && o.locked ? " locked" : "") + (s.overdue ? " overdue" : "") + (s.status === "stale" ? " stale" : ""); d.style.setProperty("--c", COLORS[lv]);
      d.innerHTML = '<div class="city"><span>' + s.city + (s.nws_alerts && s.nws_alerts.length ? ' &#9888;' : '') + '</span>' + arrow((s.trend || {}).delta_3h) + '</div>'
        + '<div class="pct">' + headline(s) + '<small>' + headlineSub(s) + (isLocked(s) && dayLabel(s) ? " " + dayLabel(s) : "") + '</small></div>'
        + '<div class="win">' + (isLocked(s) ? "was " + pct(f.pop_peak) + ", " + windowText(s) : windowText(s)) + '</div>'
        + '<div class="k">Kalshi <b>' + cents(k.yes_ask) + '</b> <span class="gap ' + gapClass(k.gap) + '">' + gapText(k.gap) + '</span></div>'
        + '<div class="obs">gauge <b>' + (o ? (o.in_today || 0).toFixed(2) : "-") + '</b>' + (o && o.locked ? " LOCK" : rainingNow(s) ? " RAINING" : s.overdue ? " OVERDUE" : "") + '</div>'
        + (isLocked(s) ? (nextFor(s) && nextFor(s).ticker ? '<div class="verd next">next day ' + (nextFor(s).day || "") + ' <b>' + cents(nextFor(s).yes_ask) + '</b></div>' : "") : '<div class="verd ' + verdict(s).cls + '">' + [peakState(s).short, areaState(s).short].filter(Boolean).join(" &middot; ") + '</div>')
        + ((s.situation || []).length && !isLocked(s) ? '<div class="sitl" title="' + (s.situation || []).join(" | ").replace(/"/g, "") + '">' + (s.situation || [])[0] + '</div>' : "");
      d.onclick = function () { openCard(s.city); }; el.appendChild(d);
    });
  }
  function renderAlerts(S) {
    var ul = $("alerts"); ul.innerHTML = "";
    var list = S.alerts || [];
    if (!list.length) ul.appendChild(li('<span class="empty">quiet: no crossings, no locks, nothing overdue today</span>'));
    list.slice(0, 40).forEach(function (a) {
      var key = a.utc + "|" + a.city + "|" + a.kind;
      ul.appendChild(li('<span class="kind ' + a.kind + '">' + a.kind.replace("_", " ") + '</span><span>' + a.text + '</span><span class="t">' + ago(a.utc) + '</span>', a.city));
      if (!seen[key]) {
        seen[key] = true;
        if (!firstRender) {
          var m = markers[a.city]; if (m) { m.getElement().classList.add("flash"); setTimeout(function () { m.getElement().classList.remove("flash"); }, 3000); }
          toast(a.text);
          if (soundOn && (a.kind === "lock" || a.kind === "cross_90" || a.kind === "overdue")) beep();
        }
      }
    });
  }

  /* ---------------- sound ---------------- */
  var audio = null;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach(function (off) {
        var o = audio.createOscillator(), g = audio.createGain(); o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, audio.currentTime + off); g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + off + 0.18); o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + off); o.stop(audio.currentTime + off + 0.2);
      });
    } catch (e) { /* no audio */ }
  }
  $("sound").onclick = function () {
    soundOn = !soundOn; this.textContent = soundOn ? "sound on" : "sound off"; this.classList.toggle("on", soundOn);
    if (soundOn) beep();
  };

  /* ---------------- boot ---------------- */
  applyView();
  bootFromCache();
  try { initMap(); } catch (e) { $("updated").textContent = "map failed to load"; }
  loadState();
  loadPulse();
  loadCams();
  loadNext();
  setInterval(loadState, 60000);
  setInterval(loadNext, 60000);
  setInterval(loadCams, 600000);
  setInterval(loadPulse, 60000);
  setInterval(function () { if (mapReady) buildRadarTimeline(); }, 300000);
  setInterval(tick, 10000);
})();
