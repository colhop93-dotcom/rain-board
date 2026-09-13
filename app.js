/* Rain Station Board, the one-page board. Static, no keys, works on the GitHub Pages mirror.

   Built 2026-09-09 from WO-128. Colin, after seeing the five-mode version: "one main comprehensive
   page that incorporates all the v2 stuff into the current weather board ... easier to see what
   the model says will or won't rain and what the discrepancies are and when ... revamp the map to
   look more visually beautiful." So: the model's calls first (WILL NOT RAIN, WILL RAIN, MARKET
   DISAGREES, each with WHEN), then the map, then every gauge as a sorted queue, then the scorecard
   folded. Tapping any gauge opens a full-screen airport panel over the page (#KBOS deep-links it).

   Every number carries its source and its age. When a live input is stale the state is UNKNOWN.
   All clocks are Central. Colin's positions are never on this page. */
(function () {
  "use strict";
  var ON_MIRROR = /github\.io$/.test(location.hostname);
  var FUNNEL = "https://nucbox-k11.tail8ffcbf.ts.net/";
  var DATA = /\/(v2|classic)\/?$/.test(location.pathname.replace(/index\.html$/, "")) ? "../data/" : "data/";
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

  var state = null, settle = null, physics = null, models = null, cams = null, metars = null, nextm = null, scorecardData = null, v2rec = null, book = null, candidates = null, physics3 = null;
  var apIcao = null, queueFilter = "ALL", basemap = "sat";
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
      fetch(url, { signal: c.signal, cache: "no-store" }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(rel + " " + r.status); return r.json(); }).then(res, rej);
    });
  }
  function ageMin(iso) { if (!iso) return null; var t = Date.parse(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); return isNaN(t) ? null : Math.round((Date.now() - t) / 60000); }
  function agoTxt(iso) { var m = ageMin(iso); return m === null ? "no data" : m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.floor(m / 60) + " h " + (m % 60) + " m ago"; }
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
  function stationOff(s) { return (s.tz_offset_min !== null && s.tz_offset_min !== undefined) ? +s.tz_offset_min : +(s.utc_offset_std || 0) * 60; }
  function centralHour(s, h) { if (h === null || h === undefined) return null; return ((Math.round(h + (centralOffsetMin() - stationOff(s)) / 60) % 24) + 24) % 24; }
  function ct(s, h) { return hourLabel(centralHour(s, h)) + " CT"; }
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
  function physFor(s) {
    var p = (physics && physics.stations && physics.stations[s.icao]) || null;
    if (p && p.day && s.local_day && p.day !== s.local_day) return null;
    return p;
  }
  function physStaleDay(s) {
    var p = (physics && physics.stations && physics.stations[s.icao]) || null;
    return !!(p && p.day && s.local_day && p.day !== s.local_day);
  }
  function physPct(s) { var p = physFor(s); return p && p.pct !== null && p.pct !== undefined ? +p.pct : null; }
  // Colin, 2026-09-10 15:40 CT: he read the summer holdout as the year. The per-station
  // "measured" line now quotes the ONE-YEAR by-date holdout (183 unseen dates) when v2_record.json
  // is on file, else the fit file's own table (the summer one). Which one is printed with it.
  // REVERTED 2026-09-11 (codex P1, PR #49 review 5172372841): the one-year holdout was produced by a
  // SEPARATE fit (4,024 rows through 2026-03-09), not by physics_fit_v2.json (827 rows, 07-24 to
  // 09-07) that produces the number on the card; on the committed KSEA row the two give 5 vs 28.
  // So the per-station "measured" line quotes the DEPLOYED fit's own by-date record (the summer
  // table) and says so. The one-year table stays on the scorecard, labelled for what it is.
  // WO-132, 2026-09-12. The label above used to read "summer, deployed fit" and that was not
  // true. physics_fit_v2.json (827 training rows, 8 features) shipped carrying, byte for byte,
  // the reliability table of the 100d study, which was a SEPARATE fit: 1,319 training rows,
  // 7 features, its own decay curve, different coefficients. That label was introduced on
  // 2026-09-11 as the fix for a codex P1 about the ONE-YEAR table being misattributed, so the
  // fix swapped one misattribution for another. A table now travels with the model_id it was
  // measured on and the board is only allowed to call it this model's record when they match.
  function relTable() {
    // WO-134: the fit file now carries the deployed coefficients' OWN record, scored on unseen
    // dates with rest-of-day conditioning (physics.reliability_rest_of_day). When the writer has
    // verified its identity it is used and labelled for what it is; the older table stays as
    // context only. Never relabelled, never forced.
    var rod = physics && physics.reliability_rest_of_day;
    if (rod && rod.buckets && physics.reliability_is_this_model === true && rod.model_id === physics.model_id) {
      // codex P1, PR #125: this record was measured for 09:00 calls conditioned dry at the previous
      // hour. It is presented as that fixed record, and a live row whose evidence is not a dated
      // dry reading (UNKNOWN, WET) is not in the studied population, so for it the row is context.
      return { rows: rod.buckets, mine: true, ctx: "DRY_AS_OF",
               label: "THIS fit, " + (rod.dates || '?') + " unseen dates " + ((rod.window || {}).start || '') + " to " + ((rod.window || {}).end || '') + ", rest-of-day conditioned; features from the stitched archive (carries the known leak, so a decision-time source would score lower)" };
    }
    if (!(physics && physics.reliability)) return null;
    return { rows: physics.reliability, mine: false,
             label: "measured on a DIFFERENT fit, not the coefficients producing this number" };
  }
  function physRel(p, s) { if (p === null || p === undefined) return null; var t = relTable(); if (!t) return null; var r = t.rows[String(Math.min(90, Math.floor(p / 10) * 10))]; if (!(r && r.n)) return null; r = Object.assign({}, r); r.label = t.label; r.mine = t.mine; var ph = s ? physFor(s) : null; if (t.ctx && ph && ph.evidence !== t.ctx) { r.mine = false; r.label = "this fit's fixed 09:00 record (dry-conditioned calls); this row's evidence is " + (ph.evidence || "?") + ", outside that population"; } return r; }
  function modelsFor(s) { return (models && models.stations && models.stations[s.icao]) || null; }
  function pulseFor(s) { return (metars && metars.stations && metars.stations[s.icao]) || null; }
  function camsFor(s) { return (cams && cams.cams && cams.cams[s.city]) || []; }
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
    var a = cellAge(c); if (a === null || a > 20) return null;
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
  function hasHour24(s) { return stationOff(s) !== +(s.utc_offset_std || 0) * 60; }
  function dayHours(s) { return hasHour24(s) ? 25 : 24; }
  function twcHours(s) { var f = settleFor(s).fc, n = dayHours(s); return ((f && f.hours) || []).filter(function (h) { return h[0] < n; }); }
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
  function twcBest(s) { var b = null; twcHours(s).forEach(function (h) { if (h[1] !== null && (b === null || +h[1] > b.pop)) b = { hour: h[0], pop: +h[1], qpf: h[2], wx: h[3] }; }); return b; }
  function twcQpf(s) { return twcHours(s).reduce(function (a, h) { return a + (+h[2] || 0); }, 0); }
  function hrrrEcho(s) { return (s.hrrr_hours || []).filter(function (h) { return h[1] > 0; }); }
  function marketYes(s) { var m = s.market || {}; return m.yes_ask !== null && m.yes_ask !== undefined ? +m.yes_ask : null; }
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
  function gaugeTxt(s) {
    // the collector can hand back observed: null for a station (four of them at 18:07 CT, Boston
    // among them, while Colin held it); that must read "no report", never 0.00
    var g = gaugeIn(s);
    if (g === null) {
      // 2026-09-10 11:12 CT: 13 dry stations carried observed: null all day, which is the collector
      // doing the right thing since WO-129 (a null precip field is unknown, never 0.00) and the card
      // doing the wrong thing with it: "no gauge report" on 13 cards reads as a broken board. When
      // the 1-minute pulse has today's reports with no rain, no trace and no precip group, say so.
      var pl = pulseFor(s);
      if (pl && pl.time_utc && !pl.raining_any && !pl.trace && !pl.lock) return "dry so far, no precip group in today's reports";
      return "no gauge report this cycle";
    }
    return g.toFixed(2) + " in" + (pulseLock(s) !== null && (!s.observed || (+s.observed.in_today || 0) < pulseLock(s)) ? " (1-min pulse)" : "");
  }
  function rainingNow(s) {
    // codex sign-off: weather.com precip1h is an accumulation over the past hour, not "raining now"
    var p = pulseFor(s), pa = p ? ageMin(p.time_utc) : null, oa = ageMin(s.observed && s.observed.latest_ob_utc);
    // codex round 2: the collector carries the previous observation when a fetch fails, so a rainy
    // METAR must also be fresh (90 min covers an hourly METAR plus slack) before it counts
    return !!((s.observed && s.observed.raining_now && oa !== null && oa <= 90) || (p && p.raining_any && pa !== null && pa <= 20));
  }
  function obAge(s) { var p = pulseFor(s); var a = ageMin(s.observed && s.observed.latest_ob_utc), b = ageMin(p && p.time_utc); if (a === null) return b; if (b === null) return a; return Math.min(a, b); }
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
    if (isLocked(s)) return { k: "LOCKED", overdue: false, inputs: ["gauge " + (gaugeIn(s) || 0).toFixed(2) + " in"] };
    if (oa !== null) inputs.push("gauge report " + oa + " m old");
    if (ra !== null) inputs.push("radar " + ra + " m old");
    var stale = (oa === null || oa > 90) || (ra === null || ra > 20);
    if (rainingNow(s) && !(oa === null || oa > 90)) return { k: "WET_NOW", overdue: !!s.overdue, inputs: inputs };
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
    var now = Date.now(), ib = inbound(s), out = [], lh = s.local_hour;
    if (ib.length) out.push({ ms: now + ib[0].eta_min * 60000, text: "cell ETA " + Math.round(ib[0].eta_min) + " m, " + ib[0].dbz + " dBZ" });
    var best = null;
    twcHours(s).forEach(function (h) { if (h[0] >= lh && +h[1] >= 30 && (best === null || h[0] < best[0])) best = h; });
    if (best) { var ms = localHourToMs(s, best[0]); if (ms) out.push({ ms: ms, text: "weather.com " + pct(best[1]) + " " + (best[0] === lh ? hourWord(s, best[0]) : "at " + ct(s, best[0])) + (best[2] ? ", " + (+best[2]).toFixed(2) + " in" : "") }); }
    var he = hrrrEcho(s).filter(function (h) { return h[0] >= lh || h[0] < 6; });
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
    return h === s.local_hour ? "this hour (" + ct(s, h).replace(" CT", "") + ", " + (60 - minuteInHour(s)) + " min left)" : ct(s, h);
  }
  function rainWindow(s) {
    /* WHEN: the span of hours where any of HRRR echo, weather.com 30 percent plus or NWS 30 percent plus
       still lies ahead today, in Central. Null when nothing is ahead. */
    var lh = s.local_hour, hrs = {};
    hrrrEcho(s).forEach(function (h) { if (h[0] >= lh) hrs[h[0]] = 1; });
    var nh = dayHours(s);   // WO-133: hour 24 is contract time when daylight time is on
    twcHours(s).forEach(function (h) { if (h[0] >= lh && h[0] < nh && +h[1] >= 30) hrs[h[0]] = 1; });
    (s.forecast && s.forecast.hourly || []).forEach(function (h) { if (h[0] >= lh && h[0] < nh && +h[1] >= 30) hrs[h[0]] = 1; });
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
    if (w.k === "LOCKED") return "settles YES, " + (gaugeIn(s) || 0).toFixed(2) + " in";
    if (w.k === "WET_NOW") return "raining at the gauge, not yet 0.01";
    if (w.k === "OVERDUE") return overdueText(s);
    var e = nextEvent(s); if (e) return e.text;
    var b = twcBest(s); if (b && b.pop >= 15) return "best hour " + pct(b.pop) + " at " + ct(s, b.hour) + " (weather.com)";
    return "no rain hour left in the forecast";
  }

  /* ---------------- data ---------------- */
  function load() {
    return Promise.all([
      fetchJSON("state.json"), fetchJSON("settle.json").catch(function () { return null; }), fetchJSON("physics_v2.json").catch(function () { return null; }),
      fetchJSON("models.json").catch(function () { return null; }), fetchJSON("cams.json").catch(function () { return null; }),
      fetchJSON("metars.json").catch(function () { return null; }), fetchJSON("next_markets.json").catch(function () { return null; }),
      fetchJSON("v2_record.json").catch(function () { return null; }),
      fetchJSON("scorecard.json").catch(function () { return null; }),
      fetchJSON("book.json").catch(function () { return null; }),          // WO-133: the websocket book (absent = collector quotes only)
      fetchJSON("candidates.json").catch(function () { return null; }),    // WO-133: priced candidates, computed by board_alerts.py, never in the browser
      fetchJSON("physics_v3.json").catch(function () { return null; })      // WO-134: the shadow challenger, display only
    ]).then(function (r) { state = r[0]; settle = r[1]; physics = r[2]; models = r[3]; cams = r[4]; metars = r[5]; nextm = r[6]; v2rec = r[7]; scorecardData = r[8]; book = r[9]; candidates = r[10]; physics3 = r[11]; render(); })
      .catch(function (e) { $("fresh").textContent = "data failed: " + e.message; $("fresh").classList.add("bad"); });
  }
  // WO-133: a healthy collector heartbeat used to be the only freshness signal, while the Synoptic
  // 1-minute feed had been DOWN for days with feeds.synoptic.stale = false. The header now names a
  // dead fast feed and the state of the websocket book.
  function fastFeedsTxt() { var f = settle && settle.feeds || {}, s = f.synoptic || {}; return (s.disabled ? '<b class="stale">Synoptic DOWN</b> (' + esc(String(s.disabled).slice(0, 60)) + ')' : 'Synoptic ok') + '; MADIS/AWC via pulse ' + (metars ? agoTxt(metars.generated_utc) : 'missing'); }
  function bookAge() { return book ? ageMin(book.written_utc) : null; }
  function bookFeedTxt() { if (!book) return '<b class="stale">not running</b> (5-minute collector quotes only)'; var a = bookAge(), st = (book.feed || {}).status; return (st === "LIVE" && a !== null && a <= 2 ? 'LIVE' : '<b class="stale">' + esc(st || 'unknown') + '</b>') + ', written ' + agoTxt(book.written_utc) + (book.feed && book.feed.reconnects ? ', ' + book.feed.reconnects + ' reconnects' : ''); }
  function freshness() {
    var a = ageMin(state && state.generated_utc), el = $("fresh");
    var syn = settle && settle.feeds && settle.feeds.synoptic && settle.feeds.synoptic.disabled, ba = bookAge(), bl = book && book.feed && book.feed.status === "LIVE" && ba !== null && ba <= 2;
    el.innerHTML = (a === null ? "no data" : "LIVE " + (a < 1 ? "now" : a + "m")) + (bl ? ' <small>book live</small>' : ' <small class="stale">book off</small>') + (syn ? ' <small class="stale">Synoptic DOWN</small>' : '');
    el.classList.toggle("bad", a === null || a > 10);
    el.title = "state.json " + (state ? state.generated_utc : "") + "; settle " + (settle ? settle.generated_utc : "none") + "; physics " + (physics ? physics.generated_utc : "none");
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
  function closeAirport(setHash) { $("airport").classList.add("hidden"); document.body.style.overflow = ""; closeSheet(); if (setHash !== false && location.hash) history.replaceState(null, "", location.pathname + location.search); renderMarkers(); renderQueue(); }
  $("ap-close").onclick = function () { closeAirport(true); };

  /* ---------------- render ---------------- */
  function render() {
    if (!state) return;
    freshness();
    if (camPopup && camPopup.__cam && camPopup.__cam.type !== "youtube") {
      // codex round 2: an open still refreshes in place instead of showing one frame forever
      var pi = camPopup.getElement() && camPopup.getElement().querySelector("img");
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
     diagnostic: |v2 - YES ask| is not value, and it never priced the NO side. */
  function candFor(s) { var c = candidates && candidates.stations, a = candidates ? ageMin(candidates.generated_utc) : null; if (!c || a === null || a > 5) return null; for (var i = 0; i < c.length; i++) if (c[i].icao === s.icao) return c[i]; return null; }
  function valueRow(c) {
    var s = byIcao(c.icao); if (!s) return '';
    var e = c[c.side], ex = e.executable, w = wetState(s), nx = nextEvent(s);
    return '<div class="dis val" data-icao="' + c.icao + '"><div><b>' + esc(c.city) + '</b> ' + stateChip(w) + ' <b class="side ' + c.side + '">' + c.side.toUpperCase() + '</b></div>'
      + '<div class="r num">v2 <b>' + pct(c.p_yes_pct) + '</b> &middot; ' + c.side.toUpperCase() + ' at <b>' + cents(ex.avg) + '</b> for ' + c.qty + ' (' + Math.round(ex.best_size || 0) + ' at best' + (ex.partial ? ', PARTIAL' : '') + ')</div>'
      + '<div class="when">net after fees <b class="' + (e.net_per > 0 ? 'pos' : 'neg') + '">' + (100 * e.net_per).toFixed(1) + 'c</b> per contract, band ' + (100 * e.net_lo_per).toFixed(1) + ' to ' + (100 * e.net_hi_per).toFixed(1) + 'c; walk away above ' + cents(e.max_price_for_zero)
      + ' &middot; quote: ' + esc(c.book_source) + ' ' + (c.book_age_s !== null ? c.book_age_s + ' s old' : '') + ' &middot; gauge ' + (c.gauge_age_min !== null ? c.gauge_age_min + ' m' : '?') + ', radar scan ' + (c.radar_scan_age_min !== null ? c.radar_scan_age_min + ' m' : '?')
      + ' &middot; ' + (c.contract.minutes_left !== null ? Math.floor(c.contract.minutes_left / 60) + ' h ' + (c.contract.minutes_left % 60) + ' m left' : '') + (nx ? ' &middot; next: ' + esc(nx.text) : '')
      + (c.conflicts.length ? '<br><b class="stale">against: ' + esc(c.conflicts.join('; ')) + '</b>' : '') + '</div></div>';
  }
  function valuePanel() {
    var head = '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:16px">Worth something at an executable price</b><small>';
    if (!candidates) return head + 'candidates.json missing: board_alerts.py is not running, so nothing is priced. Below is the model only.</small></div><div class="grp"><small>No priced candidates. A model number alone is not a candidate.</small></div>';
    var age = ageMin(candidates.generated_utc), rows = candidates.candidates || [], bk = candidates.book_feed_status;
    // codex P1, round 3: a candidates.json whose writer stopped would sit on the page for hours with
    // its frozen "quote 2 s old". Past the refresh allowance the whole list is refused, not decorated.
    if (age === null || age > 5) return head + '<b class="stale">candidates.json is ' + (age === null ? 'undated' : age + ' m old') + ' (writer stopped?); nothing is priced until it refreshes.</b></small></div>';
    head += 'priced ' + agoTxt(candidates.generated_utc) + ' for ' + candidates.qty + ' contracts, taker fees, ' + (bk === "LIVE" ? 'websocket book' : 'collector quotes only (book feed ' + esc(bk || 'off') + ')') + '. NO range 0 to 10%, YES range 90 to 100%. A row needs a fresh quote, a positive net after fees for the full quantity, and no sky conflict.</small></div>';
    var body = rows.length ? rows.map(valueRow).join("") : '<div class="grp"><small>nothing clears value right now' + (age !== null && age > 5 ? ' <b class="stale">(and this list is ' + age + ' m old)</b>' : '') + '</small></div>';
    var blocked = (candidates.stations || []).filter(function (x) { return !x.side && x.p_yes_pct !== null && x.p_yes_pct !== undefined && (x.p_yes_pct <= 10 || x.p_yes_pct >= 90); });
    if (blocked.length) {
      // a conflict every in-range station shares (after midnight that is "no gauge observation") is said
      // once, so each station's OWN reason is the one that shows
      var shared = blocked[0].conflicts.filter(function (c) { return blocked.every(function (x) { return x.conflicts.indexOf(c) >= 0; }); });
      body += '<div class="grp"><small>' + (shared.length ? '<b>all ' + blocked.length + ' in range:</b> ' + esc(shared.join('; ')) + '<br>' : '') + '<b>in range but not a candidate</b>: ' + blocked.map(function (x) { var e = x.p_yes_pct <= 10 ? x.no : x.yes, own = x.conflicts.filter(function (c) { return shared.indexOf(c) < 0; }); return '<span data-icao="' + x.icao + '" style="cursor:pointer">' + esc(x.city) + ' ' + pct(x.p_yes_pct) + (e && e.net_per !== null ? ' (' + (100 * e.net_per).toFixed(1) + 'c)' : '') + ': ' + esc(own[0] || (e && e.reason) || (shared.length ? 'only the shared reason' : '')) + '</span>'; }).join(' &middot; ') + '</small></div>';
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
      if (gap !== null && Math.abs(gap) >= 15 && qa !== null && qa <= 15) dis.push(item);
    });
    lo.sort(function (a, b) { return a.pct - b.pct; }); hi.sort(function (a, b) { return b.pct - a.pct; }); dis.sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); });
    var rl = physRel(5), rh = physRel(85), r9 = physRel(95);
    function qtxt(x) { return x.qa === null ? '' : (x.qa > 15 ? ' <b class="stale">quote ' + x.qa + ' m old</b>' : x.qa > 5 ? ' <small>quote ' + x.qa + ' m old</small>' : ''); }
    // WO-133 (codex read-only review, reproduced): every under-10 station was drawn as chip(x, "QUIET")
    // whatever the sky was doing. Phoenix at 02:27 CT on 2026-09-12 was 1% modelled with 70% of the
    // 6 mi ring showing echo and the chip said QUIET under "WILL NOT RAIN". The model's probability
    // and the sky's state are two different facts; the chip now wears the SKY's state, and a low
    // number with a live sky is flagged as a conflict instead of styled as reassurance.
    function conflict(x) { var k = x.w.k, nw = nwsPeak(x.s), td = twcDay(x.s); if (x.pct <= 10 && (k === "WET_NOW" || k === "WET_IMMINENT" || k === "APPROACHING" || k === "RAIN_NEARBY")) return "sky " + STATES[k].text; if (x.pct >= 90 && (k === "QUIET" || k === "OVERDUE")) return "sky " + STATES[k].text; if (x.pct <= 10 && ((nw !== null && nw >= 50) || (td !== null && td >= 50))) return "NWS " + pct(nw) + (td !== null ? ", wx.com " + pct(td) : ""); if (x.pct >= 90 && ((nw !== null && nw <= 30) || (td !== null && td <= 30))) return "NWS " + pct(nw); if (k === "UNKNOWN") return "input stale"; return null; }
    function chip(x, cls) { var cf = conflict(x); return '<span class="st ' + x.w.k + (cf ? ' conflict' : '') + '" data-icao="' + x.s.icao + '" style="cursor:pointer" title="' + esc(STATES[x.w.k].text + '; ' + (x.win ? 'rain hours ahead ' + x.win.text : 'no rain hour ahead')) + '"><i>' + STATES[x.w.k].icon + '</i><b>' + esc(x.s.city) + '</b>&nbsp;' + pct(x.pct) + (cf ? ' <b class="cf">' + esc(cf) + '</b>' : '') + (x.ask !== null ? ' &middot; YES ' + cents(x.ask) + qtxt(x) : '') + ' <small>' + (x.win ? esc(x.win.text) : 'no rain hour ahead') + '</small></span>'; }
    function gapRow(x) {
      var side = x.gap > 0 ? "market " + x.gap + " points ABOVE v2" : "market " + (-x.gap) + " points BELOW v2";
      return '<div class="dis" data-icao="' + x.s.icao + '"><div><b>' + esc(x.s.city) + '</b> ' + stateChip(x.w) + '</div><div class="r num">v2 <b>' + pct(x.pct) + '</b> vs YES <b>' + cents(x.ask) + '</b>' + qtxt(x) + '</div>'
        + '<div class="when">' + side + ' points &middot; ' + (x.win ? 'rain hours ahead: <b>' + esc(x.win.text) + '</b>' : 'no rain hour ahead in any forecast') + ' &middot; ' + esc(timingPhrase(x.s, x.w)) + '</div></div>';
    }
    return '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:16px">What v2 says today</b><small>' + (physics ? 'v2 ' + agoTxt(physics.generated_utc) + ', newest quote ' + agoTxt(stations().map(function (s) { return (s.market || {}).fetched_utc; }).filter(Boolean).sort().pop()) + '; a quote over 15 min old is marked and kept out of the disagreements' : '') + '</small></div>'
      + '<div class="grp"><small><b>LOW MODELLED PROBABILITY</b> (0 to 10%, NO candidates' + (rl ? (rl.mine ? '; on unseen dates this bucket rained ' + rl.actual_pct + '% of the time, n=' + rl.n : '; a different fit\'s record for this bucket: ' + rl.actual_pct + '%, n=' + rl.n) : '') + '). The chip is the SKY, the number is the MODEL; a flagged chip is a conflict to read before anything else.</small>' + (lo.length ? lo.map(function (x) { return chip(x); }).join("") : '<small>none</small>') + '</div>'
      + '<div class="grp"><small><b>HIGH MODELLED PROBABILITY</b> (90 to 100%, YES candidates' + (r9 ? (r9.mine ? '; 90s settled YES ' + r9.actual_pct + '% at n=' + r9.n : '; a different fit\'s record: ' + r9.actual_pct + '% at n=' + r9.n) + (r9.n < 20 ? ', thin' : '') : '; no measured record at 90+ on the deployed fit') + ')</small>' + (hi.length ? hi.map(function (x) { return chip(x); }).join("") : '<small>none right now</small>') + '</div>'
      + (wet.length ? '<div class="grp"><small><b>ALREADY WET</b></small>' + wet.map(function (s) { return '<span class="st LOCKED" data-icao="' + s.icao + '" style="cursor:pointer">' + esc(s.city) + ' ' + (gaugeIn(s) || 0).toFixed(2) + ' in</span>'; }).join("") + '</div>' : '')
      + '<div class="grp"><small><b>MARKET DISAGREES WITH v2</b> by 15 points or more (' + dis.length + ')</small>' + (dis.length ? dis.map(gapRow).join("") : '<small>no gap of 15 points anywhere</small>') + '</div>'
      + '<div class="grp"><small><b>IN BETWEEN</b> (11 to 89%, v2 is a coin flip in the middle): ' + (mid.length ? mid.sort(function (a, b) { return b.pct - a.pct; }).map(function (x) { return '<span data-icao="' + x.s.icao + '" style="cursor:pointer">' + esc(x.s.city) + ' ' + pct(x.pct) + '</span>'; }).join(', ') : 'none') + '</small></div>';
  }

  /* 3. the queue */
  function quoteAge(m) { var a = ageMin(m && m.fetched_utc); return a === null ? '' : (a > 15 ? ' <b class="stale">quote ' + a + ' m old</b>' : a > 5 ? ' quote ' + a + ' m old' : ''); }
  function priceHTML(s) { var m = s.market || {}; return '<div class="price num">YES ask ' + cents(m.yes_ask) + '<small>bid ' + cents(m.yes_bid) + quoteAge(m)+ (m.momentum && m.momentum.delta_15m !== null && m.momentum.delta_15m !== undefined && m.momentum.delta_15m !== 0 ? ', ' + (m.momentum.delta_15m > 0 ? '+' : '') + m.momentum.delta_15m + ' in 15 m' : '') + '</small></div>'; }
  function rowHTML(s, w, extra) {
    var o = s.observed || {}, g = gaugeTxt(s), a = obAge(s), p = physPct(s), win = rainWindow(s);
    return '<div class="row' + (w.overdue ? ' ovl' : '') + (s.icao === liveSel ? ' sel' : '') + '" data-icao="' + s.icao + '">'
      + '<div><div class="city">' + esc(s.city) + '<small>' + s.icao + '</small></div>' + stateChip(w) + '</div>'
      + '<div class="right">' + priceHTML(s) + '<div class="gauge num">gauge <b' + (isLocked(s) ? ' class="lock"' : '') + '>' + g + '</b>' + (a !== null ? ' <small>' + a + ' m</small>' : '') + '</div></div>'
      + '<div class="line timing">' + (p !== null ? 'v2 <b>' + pct(p) + '</b> &middot; ' : '') + esc(timingPhrase(s, w)) + (win && w.k !== "LOCKED" ? ' &middot; rain hours ahead <b>' + esc(win.text) + '</b>' : '') + '</div>'
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
    $("queue-filters").querySelectorAll("button").forEach(function (b) { b.onclick = function () { queueFilter = b.dataset.f; renderQueue(); }; });
    var rows = S.filter(function (s) { var w = wetState(s), e = nextEvent(s); if (queueFilter === "WET") return w.k === "WET_NOW" || w.k === "WET_IMMINENT" || w.k === "LOCKED"; if (queueFilter === "OVERDUE") return w.overdue || w.k === "OVERDUE"; if (queueFilter === "NEXT3H") return e && e.ms - Date.now() <= 3 * 3600000 && !isLocked(s); return true; });
    $("live-queue").innerHTML = rows.length ? rows.map(function (s) { return rowHTML(s, wetState(s)); }).join("") : '<div class="empty">nothing in this filter</div>';
    bindRows($("live-queue"));
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
  function selectCity(icao) {
    var s = byIcao(icao), m = maps.live; if (!s || !m) return;
    liveSel = icao; apIcao = icao;
    /* no isStyleLoaded() gate here: it reads false for as long as any tile is still loading, and
       on a satellite basemap that is most of the time, so the tap looked dead (18:05 CT) */
    clearLiveOverlay(false); if (camPopup) { camPopup.remove(); camPopup = null; }
    try { ensureRings(m, s); } catch (e) { m.once("styledata", function () { selectCity(icao); }); return; }
    drawOverlays(m, s, liveOverlay);
    m.flyTo({ center: [s.lon, s.lat], zoom: Math.max(m.getZoom(), 10.2), speed: 1.4 });
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
    var w = wetState(s), o = s.observed || {}, m = s.market || {}, p = physPct(s), rel = physRel(p, s), win = rainWindow(s), e = nextEvent(s), ib = inbound(s), cs = cells(s), wn = wetNeighbours(s), ncam = camsFor(s).filter(function (c) { return !c.held; }).length;
    var cellTxt = cs.length ? cs.slice(0, 3).map(function (c) { var et = etaNow(c); return c.dbz + ' dBZ ' + mi(c.km) + ' mi ' + c.bearing + (et !== null ? ', <b>ETA ' + Math.round(et) + ' m</b>' : ', ' + cellMissText(c)); }).join('<br>') : 'no cell within 60 mi';
    return '<div class="mc-top"><div><b class="mc-city">' + esc(s.city) + '</b> <small>' + s.icao + '</small><br>' + stateChip(w) + '</div>'
      + '<div class="mc-big num">' + (isLocked(s) ? (gaugeIn(s) || 0).toFixed(2) + ' in' : (p !== null ? pct(p) : '--')) + '<small>' + (isLocked(s) ? 'settled YES' : 'v2' + (rel ? ', measured ' + rel.actual_pct + '% at n=' + rel.n + (rel.label ? ', ' + rel.label : '') : '')) + '</small></div></div>'
      + '<div class="mc-line"><b>' + esc(verdictSentence(s, w, p, m, win)) + '</b></div>'
      + '<div class="mc-grid num">'
      + '<span>gauge</span><span><b>' + gaugeTxt(s) + '</b> ' + agoTxt(o.latest_ob_utc) + '</span>'
      + '<span>market</span><span>YES <b>bid ' + cents(m.yes_bid) + ', ask ' + cents(m.yes_ask) + '</b>' + (m.momentum && m.momentum.delta_60m !== null && m.momentum.delta_60m !== undefined ? ' (' + (m.momentum.delta_60m > 0 ? '+' : '') + m.momentum.delta_60m + ' in 1 h)' : '') + quoteAge(m) + '</span>'
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
    maps.live.on("load", function () { setupRadar("live"); renderMarkers(); fitAll(false); });
    window.addEventListener("resize", function () { if (maps.live && !liveSel) fitAll(false); });
    maps.live.on("style.load", function () { var R = maps.liveR; if (R) { R.added = {}; maps.live.__site = null; show("live", R.idx); } if (liveSel) { var s2 = byIcao(liveSel); if (s2) { ensureRings(maps.live, s2); } } });
    maps.live.on("zoomend", function () { updateSite("live"); });
    radarLegend($("legend-live"));
    $("basemap").querySelectorAll("button").forEach(function (b) {
      b.onclick = function () { basemap = b.dataset.b; $("basemap").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); }); maps.live.setStyle(baseStyle(basemap)); };
    });
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
      el.title = STATES[w.k].text + (w.inputs.length ? ": " + w.inputs.join(", ") : "");
      var p = physPct(s);
      el.innerHTML = STATES[w.k].icon + '<span class="lbl">' + esc(s.city) + ' ' + (isLocked(s) ? (gaugeIn(s) || 0).toFixed(2) + '"' : (p !== null ? pct(p) : '')) + ' ' + cents(marketYes(s)) + '</span>';
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
      var pos = offset(s.lon, s.lat, n.dist_km, n.bearing), el = document.createElement("div"), a = ageMin(n.time_utc);
      el.className = "nb" + (n.raining ? " wet" : ""); el.innerHTML = '<span class="lbl">' + n.id + ' ' + (n.raining ? 'WET' : 'dry') + (a !== null ? ' ' + a + 'm' : '') + '</span>'; el.title = n.id + " " + mi(n.dist_km) + " mi " + n.bearing + (n.raining ? ", raining" : ", dry") + " (" + agoTxt(n.time_utc) + ")";
      store.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(pos).addTo(m));
    });
    /* codex round 2: cameras that share one point (four DEN FAA cameras on one pole) become ONE
       marker with a count; tapping it lists them and a tap on a name opens that camera. */
    var groups = {};
    camsFor(s).forEach(function (c) {
      if (c.held) return;
      var exact = c.lat !== undefined && c.lon !== undefined && c.lat !== null;
      var pos = exact ? [c.lon, c.lat] : (c.dist_km !== undefined && c.dir ? offset(s.lon, s.lat, c.dist_km, c.dir) : null);
      if (!pos) return;
      var key = pos[0].toFixed(4) + "," + pos[1].toFixed(4);
      (groups[key] = groups[key] || { pos: pos, exact: exact, cams: [] }).cams.push(c);
    });
    Object.keys(groups).forEach(function (key) {
      var g = groups[key], el = document.createElement("div");
      el.className = "camk" + (g.exact ? "" : " approx") + (g.cams.length > 1 ? " multi" : "");
      el.title = g.cams.length > 1 ? g.cams.length + " cameras at this point, tap to choose" : g.cams[0].name + (g.exact ? "" : " (placed by distance and bearing, approximate)");
      if (g.cams.length > 1) el.innerHTML = '<b class="n">' + g.cams.length + '</b>';
      var act = function (ev) { ev.stopPropagation(); if (ev.preventDefault) ev.preventDefault(); if (g.cams.length === 1) openCamPopup(m, s, g.cams[0], g.pos, g.exact); else openCamChooser(m, s, g, key); };
      el.onclick = act; el.addEventListener("touchend", act, { passive: false });
      store.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(g.pos).addTo(m));
    });
  }
  function ensureAirportMap(s) {
    if (!maps.airport) {
      maps.airport = makeMap("map-airport", baseStyle("sat"), { center: [s.lon, s.lat], zoom: 12.5, minZoom: 7, maxZoom: 17 });
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
  function renderAirport() {
    var S = stations(); var s = byIcao(apIcao); if (!s) return;
    var sel = $("ap-select"); sel.innerHTML = S.slice().sort(function (a, b) { return a.city.localeCompare(b.city); }).map(function (x) { var w = wetState(x); return '<option value="' + x.icao + '"' + (x.icao === apIcao ? ' selected' : '') + '>' + esc(x.city) + ' ' + x.icao + ' ' + STATES[w.k].icon + ' ' + STATES[w.k].text + '</option>'; }).join("");
    sel.onchange = function () { go(sel.value); };
    var order = S.map(function (x) { return x.icao; }), i = order.indexOf(apIcao);
    $("ap-prev").onclick = function () { go(order[(i - 1 + order.length) % order.length]); };
    $("ap-next").onclick = function () { go(order[(i + 1) % order.length]); };
    $("ap-decision").innerHTML = decisionHTML(s);
    ensureAirportMap(s);
    renderHours(s);
    renderStack(s, false);
    if ($("ap-cams").dataset.icao !== s.icao) {
      var list = camsFor(s).slice().sort(function (a, b) { return (a.held ? 1 : 0) - (b.held ? 1 : 0) || a.dist_km - b.dist_km; });
      $("ap-cams").innerHTML = camStrip(s, list); $("ap-cams").dataset.icao = s.icao;
      bindCams($("ap-cams"), list);
    }
  }
  function refreshAirport() {
    /* the once-a-minute refresh while a city page is open: numbers update, nothing you opened
       closes, nothing you loaded reloads (Colin, 2026-09-09 16:30 CT: "feels really buggy") */
    var s = byIcao(apIcao); if (!s) return;
    var panel = $("airport"), y = panel.scrollTop;
    var dh = decisionHTML(s); if ($("ap-decision").innerHTML !== dh) $("ap-decision").innerHTML = dh;
    renderHours(s);
    renderStack(s, true);
    panel.scrollTop = y;
    if (maps.airport) { if (maps.airport.isStyleLoaded()) placeAirport(s); else maps.airport.once("idle", function () { placeAirport(s); }); }
    if (liveSel === s.icao) { $("mapcard").innerHTML = mapCardHTML(s); bindMapCard(s); }
  }
  function verdictSentence(s, w, p, m, win) {
    // WO-133 (codex, confirmed): this line said "Settled:" off the LOCAL gauge lock with no exchange
    // result checked. Four states now, and a local observation never becomes an official result.
    var ss = settleState(s);
    if (ss.k === "OFFICIALLY_SETTLED") return "Officially settled " + ss.result.toUpperCase() + " by the exchange (gauge " + (gaugeIn(s) || 0).toFixed(2) + " in).";
    if (ss.k === "THRESHOLD_OBSERVED") return "Threshold observed: the gauge has " + (gaugeIn(s) || 0).toFixed(2) + " in. NOT yet an official result; the exchange settles on The Weather Company's CLI value after the day ends.";
    if (ss.k === "AWAITING_SETTLEMENT") return "Observation period over, awaiting the exchange's result (local gauge " + (gaugeIn(s) || 0).toFixed(2) + " in).";
    var mk = m.yes_ask !== null && m.yes_ask !== undefined ? "the market says " + Math.round(m.yes_ask * 100) + "%" : "no market quote";
    var ground = w.k === "WET_NOW" ? "it is raining at the gauge now" : w.k === "WET_IMMINENT" ? "rain is over or about to reach the gauge" : w.k === "APPROACHING" ? "a cell is on its way" : w.k === "RAIN_NEARBY" ? "rain is nearby, nothing on a hit line" : w.k === "OVERDUE" ? "the forecast window passed dry" : w.k === "UNKNOWN" ? "a live feed is stale" : "the sky over the gauge is quiet";
    // cells on a hit line beyond the 60-minute APPROACHING window still belong in the sentence
    // (OKC 2026-09-09 20:40 CT: four 48 to 53 dBZ cores timed 12:32 to 1:20 AM against a 1 AM close read "the sky is quiet")
    var far = inbound(s).filter(function (c) { return c.eta_min > 60; }).concat(cells(s).filter(function (c) { return c.eta_far_min !== null && c.eta_far_min !== undefined; }).map(function (c) { return Object.assign({}, c, { eta_min: Math.max(0, c.eta_far_min - (cellAge(c) || 0)) }); })).sort(function (a, b) { return a.eta_min - b.eta_min; });
    var farTxt = far.length ? "; " + far.length + " cell" + (far.length > 1 ? "s" : "") + " on a line for the gauge, first about " + ctFromMs(Date.now() + far[0].eta_min * 60000) + " (" + far[0].dbz + " dBZ, straight-line guess)" : "";
    return "v2 says YES " + (p !== null ? Math.round(p) + "%" : "--") + "; " + mk + "; " + (s.observed ? "gauge dry" : "no gauge report this cycle") + "; " + ground + farTxt + (win ? "; rain hours ahead " + win.text : "; no rain hour ahead") + ".";
  }
  function decisionHTML(s) {
    var w = wetState(s), o = s.observed || {}, m = s.market || {}, p = physPct(s), rel = physRel(p, s), win = rainWindow(s);
    return '<div><div class="name">' + esc(s.city) + ' <small>' + s.icao + ', ' + esc(s.name || "") + '</small></div>' + stateChip(w) + '</div>'
      + '<div class="big num">' + (isLocked(s) ? (gaugeIn(s) || 0).toFixed(2) + ' in' : (p !== null ? pct(p) : '--')) + '<small>' + (isLocked(s) ? 'settles YES' : 'v2 chance the gauge settles YES' + (rel ? ', measured ' + rel.actual_pct + '% at n=' + rel.n + (rel.n < 20 ? ' (thin)' : '') : ', unmeasured bucket')) + '</small></div>'
      + '<div class="sub"><b>' + esc(verdictSentence(s, w, p, m, win)) + '</b><br>'
      + '<b>gauge ' + gaugeTxt(s) + '</b> (' + agoTxt(o.latest_ob_utc) + ') &middot; YES <b>bid ' + cents(m.yes_bid) + ', ask ' + cents(m.yes_ask) + '</b>' + (m.momentum && m.momentum.delta_60m !== null && m.momentum.delta_60m !== undefined ? ' (' + (m.momentum.delta_60m > 0 ? '+' : '') + m.momentum.delta_60m + ' in 1 h)' : '') + quoteAge(m) + ' &middot; ' + esc(timingPhrase(s, w)) + (win && !isLocked(s) ? ' &middot; rain hours ahead <b>' + esc(win.text) + '</b>' : '') + '<br><small>' + esc(w.inputs.join(", ")) + '</small></div>';
  }
  function renderHours(s) {
    var hm = {}, lh = s.local_hour, wet = {}; (s.forecast && s.forecast.hourly_seen || []).forEach(function (h) { hm[h[0]] = { pop: h[1], src: "NWS" }; });
    (s.forecast && s.forecast.hourly || []).forEach(function (h) { hm[h[0]] = { pop: h[1], src: "NWS", wx: h[2] }; });
    twcHours(s).forEach(function (h) { if (!hm[h[0]] || +h[1] > +hm[h[0]].pop) hm[h[0]] = { pop: +h[1], src: "weather.com", qpf: h[2], wx: h[3] }; });
    ((s.observed || {}).wet_hours || []).forEach(function (h) { wet[h] = true; });
    var he = {}; hrrrEcho(s).forEach(function (h) { he[h[0]] = h[1]; });
    var html = '<div class="hours">';
    // codex P2, round 3: the standard-day contract is 24 hours. While daylight time is on its civil
    // span is hours 1 to 24, so hour 0 is OUTSIDE the contract and drawing it invented a dry bar.
    for (var h = hasHour24(s) ? 1 : 0; h < dayHours(s); h++) {
      var v = hm[h] ? +hm[h].pop : 0, cls = (h < lh ? "past" : "") + (h === lh ? " now" : "") + (wet[h] ? " wet" : "") + (he[h] ? " hrrr" : "") + (h === 24 ? " last" : "");
      html += '<i class="' + cls + '" style="height:' + Math.max(4, v * 0.7) + 'px" title="' + (h === 24 ? 'hour 24, the LAST contract hour (12am to 1am civil, next calendar date; the market day is local standard)' : hourLabel(h) + ' local') + ', ' + ct(s, h) + ': ' + v + '%' + (hm[h] ? ' (' + hm[h].src + (hm[h].qpf ? ', ' + (+hm[h].qpf).toFixed(2) + ' in' : '') + (hm[h].wx ? ', ' + hm[h].wx : '') + ')' : '') + (he[h] ? ', HRRR echo ' + he[h] + '%' : '') + (wet[h] ? ', gauge recorded rain' : '') + '">' + (h % 3 === 0 ? '<b>' + hourLabel(centralHour(s, h)).replace(/[ap]m/, function (x) { return x[0]; }) + '</b>' : '') + '</i>';
    }
    html += '</div><div class="hourlbl"><span>hours in Central; bar height = chance (higher of NWS and weather.com); BLUE bar = the gauge recorded rain that hour; AMBER top = HRRR paints echo; tap a bar to read it</span></div><div class="hoursel" id="ap-hoursel">' + esc($("ap-hoursel") ? $("ap-hoursel").textContent : "") + '</div>';
    $("ap-hours").innerHTML = html;
    $("ap-hours").querySelectorAll(".hours i").forEach(function (bar) { bar.onclick = function () { $("ap-hoursel").textContent = bar.title; }; });
  }
  function sec(title, right, body, open) { return '<details' + (open ? ' open' : '') + '><summary>' + title + '<span>' + right + '</span></summary><div class="body">' + body + '</div></details>'; }
  function renderStack(s, keepOpen) {
    var wasOpen = {}; if (keepOpen) $("ap-stack").querySelectorAll("details").forEach(function (d, i) { wasOpen[i] = d.open; });
    var o = s.observed || {}, se = settleFor(s), p = pulseFor(s), r = compRadar(s), tile = se.tile || {}, pp = physPct(s), ph = physFor(s), rel = physRel(pp, s), mo = modelsFor(s), con = mo && mo.consensus || {}, m = s.market || {}, w = wetState(s), b = twcBest(s), he = hrrrEcho(s), nx = nextm && nextm.markets && nextm.markets[s.city];
    var gauge = '<div class="kv">'
      + '<span>METAR/SPECI</span><span><b>' + gaugeTxt(s) + '</b> today, ' + agoTxt(o.latest_ob_utc) + (o.raining_now ? ', <b>raining now</b>' : '') + '</span>'
      + '<span>1-min pulse</span><span>' + (p ? (p.raining_any ? '<b>RAIN</b>' : 'no rain') + ' (' + agoTxt(p.time_utc) + ')' + (p.madis ? ', MADIS ' + (p.madis.raining ? '<b>rain</b>' : 'dry') + ' ' + agoTxt(p.madis.obs_utc) : '') : 'none') + '</span>'
      + '<span>weather.com obs</span><span>' + (se.precip1h !== undefined && se.precip1h !== null ? (+se.precip1h).toFixed(2) + ' in last hour, ' + esc(se.wx || '') + ' (' + ctClock(se.valid_local) + ')' : 'none') + '</span>'
      + '<span>settles on</span><span>' + (se.today_in !== undefined && se.today_in !== null ? (+se.today_in).toFixed(2) + ' in (weather.com ' + (se.today_src || '') + ' window), a trace settles NO' : 'no report yet') + '</span>'
      + '</div>';
    var about = '<div class="kv">'
      + '<span>state</span><span>' + stateChip(w) + ' ' + esc(STATES[w.k].why) + '</span>'
      + '<span>inputs</span><span>' + esc(w.inputs.join("; ") || "none") + '</span>'
      + '<span>echo rings</span><span>' + pct(r.pct10) + ' of 6 mi, ' + pct(r.pct30) + ' of 19 mi, ' + pct(r.pct60) + ' of 37 mi, ' + pct(r.pct30_strong) + ' of 19 mi heavy'
      + ' (IEM N0Q composite; scan ' + (r.scan_valid_utc ? agoTxt(r.scan_valid_utc) : '<b class="stale">time unknown</b>') + ', read ' + agoTxt(r.read_utc || r.frame_utc) + (r.radar_quorum ? ', radars ' + esc(r.radar_quorum) : '') + ')'
      + (r.coverage30_pct !== undefined && r.coverage30_pct !== null && r.coverage30_pct < 100 ? '<br><b class="stale">only ' + r.coverage30_pct + '% of the 19 mi ring was sampled; the rest is missing tiles, not dry sky</b>' : '')
      + '<br><small>reflectivity is not rainfall and not the gauge; the map draws NWS MRMS, a different product of the same quantity</small></span>'
      + '<span>cells</span><span>' + (cells(s).length ? cells(s).map(function (c) { var e = etaNow(c), a = cellAge(c), still = cellStationary(c); return c.dbz + ' dBZ, ' + mi(c.km) + ' mi ' + c.bearing + ', ' + (still ? '<b>STATIONARY</b>' : 'moving ' + c.heading + ' ' + c.kt + ' kt, ' + (e !== null ? '<b>ETA ' + Math.round(e) + ' m</b>' : (c.eta_min !== null && c.eta_min !== undefined ? 'ETA expired, scan ' + a + ' m old' : cellMissText(c)))) + (a !== null ? ' <small>(scan ' + a + ' m old)</small>' : ''); }).join('<br>') : 'none within 60 mi') + '</span>'
      + '<span>neighbours</span><span>' + ((s.neighbors || []).length ? (s.neighbors || []).map(function (n) { var a = ageMin(n.time_utc); return n.id + ' ' + mi(n.dist_km) + ' mi ' + (n.raining ? '<b>WET</b>' : 'dry') + (a !== null ? ' <small>' + a + ' m old' + (a > 90 ? ', STALE' : '') + '</small>' : ''); }).join(', ') : 'none') + '</span>'
      + '<span>single radar</span><span>' + (tile.site_block_stale || tile.stale ? 'DEAD, no update in ' + Math.round(tile.unchanged_min || 0) + ' min, not shown' : 'fresh, shown at zoom 10+') + '</span>'
      + '</div>';
    var fc = '<div class="kv">'
      + '<span>window</span><span>' + (b ? 'weather.com best hour <b>' + pct(b.pop) + '</b> at ' + ct(s, b.hour) + (b.qpf ? ', ' + (+b.qpf).toFixed(2) + ' in that hour' : '') + '; <b>' + twcQpf(s).toFixed(2) + ' in</b> forecast left' : 'weather.com: no hour above 15%') + '</span>'
      + '<span>NWS</span><span>peak ' + pct(nwsPeak(s)) + (s.forecast && s.forecast.pop_peak_hour !== null ? ' at ' + ct(s, s.forecast.pop_peak_hour) : '') + '</span>'
      + '<span>weather.com day</span><span>' + (twcDay(s) === null ? 'no day figure published this hour' : pct(twcDay(s))) + '</span>'
      + '<span>HRRR echo</span><span>' + (he.length ? (function () { var today = he.filter(function (h) { return h[0] >= s.local_hour; }), later = he.filter(function (h) { return h[0] < s.local_hour; }); return (today.length ? today.map(function (h) { return ct(s, h[0]).replace(' CT', '') + ' ' + h[1] + '%'; }).join(', ') + ' CT' : 'none left today') + (later.length ? '; <small>after the close: ' + later.map(function (h) { return ct(s, h[0]).replace(' CT', '') + ' ' + h[1] + '%'; }).join(', ') + '</small>' : ''); })() + ' (run ' + ctClock(s.hrrr_init) + ')' : 'none this run') + '</span>'
      + '</div>';
    var md = '<div class="kv">'
      + '<span>v2 physics</span><span><b>' + pct(pp) + '</b> rest of day' + (ph && ph.p_day !== undefined ? ' (whole day ' + pct(ph.p_day) + ')' : '')
      + (ph && ph.evidence === 'UNKNOWN' ? '; <b>gauge state unknown</b> (' + esc(ph.evidence_why || '') + '), so this is the whole-day figure with no dry-gauge credit' : '')
      + (ph && ph.evidence === 'DRY_AS_OF' && ph.conditioned_at_hour !== null && ph.conditioned_at_hour !== undefined ? '; conditioned on the gauge being dry at ' + hourLabel(Math.floor(ph.conditioned_at_hour)) + ' local standard' : '')
      + (!rel ? '; no measured record for this bucket'
              : (rel.mine ? '; measured out of sample by date: when it said ' + rel.lo + ' to ' + rel.hi + '% it settled YES <b>' + rel.actual_pct + '%</b> of the time (n=' + rel.n + (rel.n < 20 ? ', too thin to trust' : '') + ')'
                          : '; <b>no measured record for THIS fit.</b> The nearest measurement is a different fit, which in the ' + rel.lo + ' to ' + rel.hi + '% bucket settled YES ' + rel.actual_pct + '% of the time (n=' + rel.n + '). That is context, not this number\'s record'))
      + '</span>'
      + (function () { var q = physics3 && physics3.stations && physics3.stations[s.icao]; return q && q.pct !== null && q.pct !== undefined && (!q.day || q.day === s.local_day) ? '<span>v3 shadow</span><span><b>' + pct(q.pct) + '</b> rest of day (whole day ' + pct(q.p_day) + '), <b>CHALLENGER IN SHADOW</b>: fit ' + esc(q.model_id || '') + ', trained with a precipitation forecast, no live record yet, not traded from</span>' : ''; })()
      + '<span>7 models</span><span>' + (con.n_wet !== undefined ? '<b>' + con.n_wet + ' of ' + con.n_models + '</b> put 0.01 in on the ground' : '--') + (mo && mo.models ? '<br><small>' + Object.keys(mo.models).map(function (k) { var x = mo.models[k]; return k + ' ' + (x.in !== null && x.in !== undefined ? (+x.in).toFixed(2) : '--'); }).join(' &middot; ') + ' (inches)</small>' : '') + '<br><small>amount forecasts, record unmeasured on this box</small></span>'
      + '</div>';
    var gapv = (pp !== null && m.yes_ask !== null && m.yes_ask !== undefined) ? Math.round(m.yes_ask * 100) - Math.round(pp) : null;
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
    var val = cd ? '<div class="kv">'
      + ['no', 'yes'].map(function (sd) { var e = cd[sd]; if (!e) return '<span>' + sd.toUpperCase() + '</span><span>not priced (' + esc(cd.book_status) + ')</span>'; var ex = e.executable; return '<span>' + sd.toUpperCase() + ' x' + (cd.qty || (candidates && candidates.qty) || '?') + '</span><span>' + (ex.avg !== null ? 'at <b>' + cents(ex.avg) + '</b> (' + Math.round(ex.best_size || 0) + ' at best ' + cents(ex.best) + (ex.partial ? ', PARTIAL' : '') + '), gross ' + (100 * e.gross_per).toFixed(1) + 'c, fee ' + (100 * e.fee_per).toFixed(2) + 'c, <b class="' + (e.net_per > 0 ? 'pos' : 'neg') + '">net ' + (100 * e.net_per).toFixed(1) + 'c</b> [' + (100 * e.net_lo_per).toFixed(1) + ', ' + (100 * e.net_hi_per).toFixed(1) + '], walk away above ' + cents(e.max_price_for_zero) : 'no executable price') + '</span>'; }).join('')
      + '<span>quote</span><span>' + esc(cd.book_source) + ', ' + (cd.book_age_s !== null ? cd.book_age_s + ' s old' : '?') + ', ' + esc(cd.book_status) + (bk && bk.seq ? ', seq ' + bk.seq : '') + '</span>'
      + (cd.conflicts.length ? '<span>against</span><span class="stale">' + esc(cd.conflicts.join('; ')) + '</span>' : '')
      + '</div>' : '<div class="kv"><span>value</span><span>not priced: board_alerts.py is not running</span></div>';
    var mk = '<div class="kv">'
      + '<span>Kalshi</span><span><b>YES bid ' + cents(m.yes_bid) + ', ask ' + cents(m.yes_ask) + '</b>, NO ask <b>' + cents(m.yes_bid !== null && m.yes_bid !== undefined ? 1 - m.yes_bid : null) + '</b> (1 minus the YES bid), last ' + cents(m.last) + ', vol ' + Math.round(m.volume || 0) + ', OI ' + Math.round(m.open_interest || 0) + ' (' + agoTxt(m.fetched_utc) + ')</span>'
      + '<span>moves</span><span>' + (m.momentum ? [["15 m", m.momentum.delta_15m], ["1 h", m.momentum.delta_60m]].filter(function (x) { return x[1] !== null && x[1] !== undefined; }).map(function (x) { return (x[1] > 0 ? '+' : '') + x[1] + ' in ' + x[0]; }).join(', ') + (m.momentum.vol_15m !== null && m.momentum.vol_15m !== undefined ? (m.momentum.delta_15m !== null ? ', ' : '') + m.momentum.vol_15m + ' contracts in 15 m' : '') || 'not enough candles yet' : '--') + '</span>'
      + '<span>market vs</span><span>v2 ' + (gapv === null ? '--' : (gapv > 0 ? '+' : '') + gapv) + ' &middot; NWS ' + (nwsPeak(s) !== null && m.yes_ask !== null ? (Math.round(m.yes_ask * 100) - nwsPeak(s) > 0 ? '+' : '') + (Math.round(m.yes_ask * 100) - nwsPeak(s)) : '--') + ' &middot; weather.com day ' + (twcDay(s) !== null && m.yes_ask !== null ? (Math.round(m.yes_ask * 100) - twcDay(s) > 0 ? '+' : '') + (Math.round(m.yes_ask * 100) - twcDay(s)) : '--') + ' (points, positive = market higher)</span>'
      + '<span>closes</span><span>' + (m.close_time ? ctClock(m.close_time) + ' (' + m.close_time.slice(0, 10) + ')' : '--') + '</span>'
      + (nx ? '<span>tomorrow</span><span>' + nx.ticker + ' YES ' + cents(nx.yes_bid) + ' / ' + cents(nx.yes_ask) + '</span>' : '')
      + '</div>';
    var health = '<div class="kv">'
      + '<span>state.json</span><span>' + agoTxt(state.generated_utc) + '</span>'
      + '<span>settle.json</span><span>' + (settle ? agoTxt(settle.generated_utc) : 'missing') + '</span>'
      + '<span>physics_v2</span><span>' + (physics ? agoTxt(physics.generated_utc) : 'missing') + '</span>'
      + '<span>radar scan</span><span>' + (r.scan_valid_utc ? agoTxt(r.scan_valid_utc) : '<b class="stale">scan time unknown</b>') + ' (read ' + agoTxt(r.read_utc || r.frame_utc) + ')</span>'
      + '<span>fast feeds</span><span>' + fastFeedsTxt() + '</span>'
      + '<span>book feed</span><span>' + bookFeedTxt() + '</span>'
      + '<span>gauge report</span><span>' + agoTxt(o.latest_ob_utc) + '</span>'
      + '<span>forecast</span><span>' + agoTxt(s.forecast && s.forecast.fetched_utc) + '</span>'
      + '</div>';
    var raw = '<div class="kv"><span>METAR</span><span class="num">' + esc((s.metar || {}).raw || o.latest_raw || '') + '</span><span>day</span><span>' + esc(s.local_day || '') + ', local hour ' + s.local_hour + '</span></div>';
    $("ap-stack").innerHTML = sec("Contract", esc(m.ticker || '') + (left !== null && left > 0 ? ", " + Math.floor(left / 60) + " h " + (left % 60) + " m left" : ""), ctr, true)
      + sec("Value at executable prices", cd && cd.side ? cd.side.toUpperCase() + " " + (100 * cd[cd.side].net_per).toFixed(1) + "c net" : "none", val, true)
      + sec("Gauge", gaugeTxt(s), gauge, true) + sec("About to get wet", STATES[w.k].text, about, true) + sec("Forecast", b ? pct(b.pop) + " at " + ct(s, b.hour) : pct(nwsPeak(s)), fc, true)
      + sec("Models", pct(pp) + " v2", md, false) + sec("Market", "YES " + cents(m.yes_ask), mk, true) + sec("Source health", agoTxt(state.generated_utc), health, false) + sec("Raw", "", raw, false);
    if (keepOpen) $("ap-stack").querySelectorAll("details").forEach(function (d, i) { if (wasOpen[i] !== undefined) d.open = wasOpen[i]; });
  }

  /* ---------------- cameras ---------------- */
  function camURL(c) {
    if (c.type === "youtube") return "https://www.youtube.com/embed/" + c.id + "?autoplay=1&mute=1";
    /* codex walk, 2026-09-09: on the public mirror every proxied still was rewritten to the box's
       private Tailscale address, which Colin's work network cannot reach, so Newark's twelve all
       failed. The camera's own public URL comes first; the box proxy is the fallback. */
    if (c.url) return c.url;
    if (c.frame) return (ON_MIRROR ? FUNNEL : "") + c.frame;
    return "";
  }
  function camIsProxied(c) { return !c.url && !!c.frame; }
  function camStrip(s, list) {
    if (!list.length) return '<div class="empty">no cameras catalogued near ' + esc(s.city) + '</div>';
    return list.map(function (c, i) {
      var dead = !!c.held || c.verified === false, u = camURL(c);
      // still images load straight away (they are one JPEG each); YouTube streams wait for a tap
      var media = dead ? '<div class="ph">OFFLINE at the source</div>'
        : c.type === "youtube" ? '<div class="ph">&#9654; tap to play the live stream</div>'
        : '<img src="' + u + (u.indexOf("?") > 0 ? "&" : "?") + 't=' + Math.floor(Date.now() / 60000) + '" alt="" loading="lazy">';
      return '<div class="cam' + (dead ? ' dead' : '') + '" data-i="' + i + '">' + media + '<div class="cap"><b>' + esc(c.name) + '</b>' + mi(c.dist_km) + ' mi ' + esc(c.dir || '') + ' of the gauge &middot; ' + (c.type === "youtube" ? "live stream" : "still, refreshes each minute") + ' &middot; verified ' + agoTxt(c.checked_utc || c.last_ok_utc) + '</div></div>';
    }).join("");
  }
  function bindCams(root, list) {
    root.querySelectorAll(".cam").forEach(function (el) {
      var c = list[+el.dataset.i]; if (!c) return;
      var im = el.querySelector("img"); if (im) im.onerror = function () { var d = document.createElement("div"); d.className = "ph"; d.textContent = camIsProxied(c) ? "board proxy unreachable from this network (the camera itself may be fine)" : "no picture from the source right now"; im.replaceWith(d); };
      var ph = el.querySelector(".ph"); if (!ph) return;
      ph.onclick = function () {
        if (c.held) return;
        var u = camURL(c);
        ph.outerHTML = c.type === "youtube" ? '<iframe src="' + u + '" allow="autoplay" loading="lazy"></iframe>' : '<img src="' + u + (u.indexOf("?") > 0 ? "&" : "?") + 't=' + Math.floor(Date.now() / 60000) + '" alt="">';
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
    /* Colin, 2026-09-09 16:35 CT: "have the picture actually render over where the white box is,
       bigger, so I can see the exact location relative to the gauge." The picture is a map popup
       anchored on the camera, so the camera and the SETTLEMENT GAUGE pin share the view. */
    if (camPopup) { camPopup.remove(); camPopup = null; }
    var u = camURL(c), media = c.type === "youtube" ? '<iframe src="' + u + '" allow="autoplay"></iframe>' : '<img src="' + u + (u.indexOf("?") > 0 ? "&" : "?") + 't=' + Math.floor(Date.now() / 60000) + '" alt="">';
    var html = '<div class="campop">' + media + '<div class="cap"><b>' + esc(c.name) + '</b>' + mi(c.dist_km) + ' mi ' + esc(c.dir || '') + ' of the gauge' + (exact ? '' : ', placed by distance and bearing') + ' &middot; ' + (c.type === "youtube" ? 'live stream' : 'still, refreshes each minute') + '</div></div>';
    // open on the side AWAY from the gauge pin so the picture never covers it
    var dx = lngLat[0] - s.lon, dy = lngLat[1] - s.lat, anchor = Math.abs(dy) >= Math.abs(dx) * 0.6 ? (dy > 0 ? "bottom" : "top") : (dx > 0 ? "left" : "right");
    camPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: "420px", offset: 12, anchor: anchor }).setLngLat(lngLat).setHTML(html).addTo(m);
    camPopup.__icao = s.icao; camPopup.__cam = c;
    camPopup.on("close", function () { camPopup = null; });
    // P1: the popup's image gets the same failure wording as the grid
    var pim = camPopup.getElement() && camPopup.getElement().querySelector("img");
    if (pim) pim.onerror = function () { var d = document.createElement("div"); d.className = "ph"; d.textContent = camIsProxied(c) ? "board proxy unreachable from this network (the camera itself may be fine)" : "no picture from the source right now"; pim.replaceWith(d); };
  }
  function openCamSheet(s, c) {
    var sh = $("sheet"); sh.classList.remove("hidden");
    var u = camURL(c);
    sh.innerHTML = '<button class="x">close</button><b>' + esc(c.name) + '</b><br><small>' + mi(c.dist_km) + ' mi ' + esc(c.dir || '') + ' of the gauge, checked ' + agoTxt(c.checked_utc || c.last_ok_utc) + '</small><div class="cam" style="margin-top:8px">' + (c.type === "youtube" ? '<iframe src="' + u + '" allow="autoplay"></iframe>' : '<img src="' + u + '" alt="">') + '</div>';
    sh.querySelector(".x").onclick = closeSheet;
  }
  function closeSheet() { var sh = $("sheet"); sh.classList.add("hidden"); sh.innerHTML = ""; }

  /* 4. scorecard */
  function renderScorecard() {
    var S = stations();
    var today = S.filter(function (s) { return isLocked(s) || rainingNow(s); });
    $("sc-today").innerHTML = today.length ? '<table class="sc"><tr><th>gauge</th><th>state</th><th>total</th><th>market</th><th>v2 said (whole day)</th></tr>' + today.map(function (s) { var ph = physFor(s), m = s.market || {}; return '<tr><td><b>' + esc(s.city) + '</b> ' + s.icao + '</td><td>' + stateChip(wetState(s)) + '</td><td class="num">' + (gaugeIn(s) || 0).toFixed(2) + ' in</td><td class="num">YES ' + cents(m.yes_ask) + '</td><td class="num">' + (ph && ph.p_day !== undefined ? pct(ph.p_day) : '--') + '</td></tr>'; }).join("") + '</table>' : '<div class="empty">no gauge has recorded rain yet today</div>';
    function relHTML(rows, thin) {
      return '<table class="sc"><tr><th>it said</th><th>station-days</th><th>rained</th><th>actual</th></tr>' + Object.keys(rows).sort(function (a, b) { return +a - +b; }).map(function (k) { var r = rows[k]; return '<tr><td>' + r.lo + ' to ' + r.hi + '%</td><td class="num">' + r.n + '</td><td class="num">' + r.yes + '</td><td class="num' + (r.n < thin ? ' thin' : '') + '">' + r.actual_pct + '%' + (r.n < thin ? ' (n under ' + thin + ', too thin)' : '') + '</td></tr>'; }).join("") + '</table>';
    }
    /* Three records of the same model, in this order, each labelled with its sample (Colin,
       2026-09-10: "what sample is it showing?"):
         LIVE: every 9am call since the snapshots started 2026-09-10, settled against the gauge,
               from scorecard.json, grows by 22 station-days a day and is the record he asked for;
         ONE YEAR: by-date holdout 2025-09-08 to 2026-09-08, 183 unseen dates;
         SUMMER: by-date holdout 2026-05-31 to 2026-09-08, 41 unseen dates (the fit file's own). */
    var live = scorecardData && scorecardData.sources && scorecardData.sources.v2, rel = physics && physics.reliability, yr = v2rec && v2rec.year, sm = v2rec && v2rec.summer;
    var liveHTML = (live && live.n) ? '<p class="note">since 2026-09-10, ' + live.n + ' settled 9am calls over ' + scorecardData.days + ' days' + (live.brier !== null ? ', Brier ' + live.brier : '') + '</p>' + relHTML(live.buckets || {}, 20)
      : '<div class="empty">LIVE record: every 9am v2 call since 2026-09-10, scored against the gauge the next morning. ' + (scorecardData && scorecardData.open_rows ? scorecardData.open_rows.length + ' calls waiting to settle; ' : '') + 'first scored rows land tomorrow morning, then 22 a day.</div>';
    $("sc-physics").innerHTML = '<details class="card" open><summary><b>LIVE, since 2026-09-10</b><span>' + (live && live.n ? 'n=' + live.n : 'n=0 so far') + '</span></summary>' + liveHTML + '</details>'
      + (yr ? '<details class="card" open><summary><b>ONE YEAR, unseen dates, by-date REFIT (not the deployed coefficients)</b><span>' + yr.window.start + ' to ' + yr.window.end + ', ' + yr.test_dates + ' dates, n=' + yr.test_rows + '</span></summary>' + relHTML(yr.rows, 20) + '</details>' : '')
      + ((sm || rel) ? '<details class="card"><summary><b>SUMMER, unseen dates, by-date REFIT (not the deployed coefficients)</b><span>' + (sm ? sm.window.start + ' to ' + sm.window.end + ', ' + sm.test_dates + ' dates, n=' + sm.test_rows : 'fit file') + '</span></summary>' + relHTML(sm ? sm.rows : rel, 20) + '</details>' : '<div class="empty">no reliability table on file</div>');
    /* phase 2: every source's own record, from source_snapshots.py (09:00 snapshots settled the
       next day). Until rows settle the board says so instead of showing nothing. */
    var sc = scorecardData, scEl = $("sc-sources");
    if (scEl) {
      if (!sc || !sc.settled_rows) scEl.innerHTML = '<div class="empty">Every other source gets its own record here: what NWS, weather.com, the model panel and the market said at 9am, against what the gauge did. Recording started 2026-09-09; the first settled rows land the morning after the first 9am snapshot' + (sc && sc.open_rows && sc.open_rows.length ? ' (' + sc.open_rows.length + ' snapshots waiting to settle)' : '') + '.</div>';
      else {
        var names = Object.keys(sc.sources || {});
        scEl.innerHTML = '<p class="note">' + sc.settled_rows + ' settled station-days over ' + sc.days + ' days, 9am snapshots (' + agoTxt(sc.generated_utc) + '). Brier: lower is better, 0.25 is a coin flip.</p>' + names.map(function (nm) {
          var src = sc.sources[nm], b = src.buckets || {};
          return '<details class="card"><summary><b>' + esc(nm) + '</b><span>n=' + src.n + (src.brier !== null ? ', Brier ' + src.brier : '') + '</span></summary><table class="sc"><tr><th>it said</th><th>station-days</th><th>rained</th><th>actual</th></tr>'
            + Object.keys(b).sort(function (x, y) { return +x - +y; }).map(function (k) { var r = b[k]; return '<tr><td>' + r.lo + ' to ' + r.hi + '%</td><td class="num">' + r.n + '</td><td class="num">' + r.yes + '</td><td class="num' + (r.n < 20 ? ' thin' : '') + '">' + r.actual_pct + '%' + (r.n < 20 ? ' (thin)' : '') + '</td></tr>'; }).join("") + '</table></details>';
        }).join("");
      }
    }
    // WO-132: this note used to end "the per-station measured line quotes the one-year table",
    // which stopped being true on 2026-09-11 when that line was reverted to the summer table.
    // Both tables are by-date REFITS and neither is the deployed coefficients, so neither is
    // this model's measured record. The LIVE table is the only one that is.
    // codex P1, PR #122: the previous wording promised the LIVE table was this model's own
    // record. That is only true while exactly one model has ever written rows, and the
    // scorecard now says whether that holds (v2_single_model). If it does not, the table is a
    // mix and is labelled a mix.
    // codex P1, PR #122 round 2: ONE identity in the settled rows does not make it the model on the
    // card. Right after a fit or gate change every settled row belongs to the OLD identity, and the
    // 44 legacy rows carry no identity at all. The LIVE table is this model's record only when the
    // sole identity in it IS the running model_id with the same time_fix flag.
    var ids = (scorecardData && scorecardData.v2_model_ids) || [], idn = ids.length;
    var sole = idn === 1 ? ids[0] : null;
    var isMine = !!(sole && physics && sole.model_id && sole.model_id === physics.model_id && !!sole.time_fix === !!physics.time_fix);
    var mixed = idn > 1 || (idn === 1 && !isMine);
    $("sc-note").textContent = physics ? "The number on the card comes from fit " + (physics.model_id || "unknown") + ", trained on " + physics.n_fit_rows_train + " station-days (" + (physics.fitted_on ? physics.fitted_on.start + " to " + physics.fitted_on.end : "") + "). NEITHER holdout below was produced by that fit: both are separate by-date refits over longer windows, so read them as evidence about the METHOD, not as this model's record. "
      + (mixed ? (idn > 1 ? "The LIVE table below POOLS " + idn + " different model versions and is NOT any one model's record until it is split." : "The LIVE table below was recorded by a DIFFERENT model version (" + (sole && sole.model_id ? sole.model_id : "unidentified rows") + "), not the one on the card; the running model's live record starts at zero.") : (isMine ? "The LIVE table is measured on the model actually running." : "The LIVE table has no rows for the running model yet; it starts at zero."))
      + " NWS, weather.com and the model panel get theirs below as rows settle." : "";
    if (physics) $("sc-note").innerHTML += ' <a href="https://github.com/colhop93-dotcom/colins-ideas/blob/main/TRADING/019a-rain-station-board/research/2026-09-09_V2_HOLDOUT_BYDATE.md" target="_blank" rel="noopener">method and every row</a>';
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

  /* ---------------- boot ---------------- */
  function theme() { var light = localStorage.getItem("rb.theme") === "light"; document.body.classList.toggle("light", light); $("theme").textContent = light ? "dark" : "light"; }
  $("theme").onclick = function () { var light = !document.body.classList.contains("light"); localStorage.setItem("rb.theme", light ? "light" : "dark"); theme(); };
  theme();
  load().then(route);
  setInterval(load, 60000);
})();
