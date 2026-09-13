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
  var STATE_URL = "../data/state.json", SAMPLE_URL = "../data/state.sample.json", LS_KEY = "rainboard.state.v2";
  /* Mirror reads: same-origin with a per-minute cache-buster. GitHub Pages caches each URL for
     10 minutes, so a new query string every minute is a fresh fetch; the jsDelivr copy sat 41
     minutes stale on 2026-09-02 even with purges reporting success, so it is the fallback only. */
  function dataURL(rel) { return ON_MIRROR ? rel + "?t=" + Math.floor(Date.now() / 60000) : rel; }
  /* proxy cameras (TxDOT base64 snapshots, HLS streams) are decoded on the NUCBOX by cam_proxy.py
     into site/frames/ every minute; the GitHub Pages copy loads them over the Tailscale funnel */
  var FUNNEL = "https://nucbox-k11.tail8ffcbf.ts.net/";
  function frameURL(c) { return (ON_MIRROR ? FUNNEL : "") + c.frame; }
  function cdnURL(rel) { return CDN + rel; }
  var IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-";
  var RADAR_HOURS = 24, RADAR_STEP_MIN = 10;
  var COLORS = { low: "#22c55e", moderate: "#eab308", elevated: "#f97316", high: "#ef4444", extreme: "#a855f7", stale: "#6b7280", locked: "#38bdf8" };
  var map, mapReady = false, markers = {}, popup = null, state = null, settle = null, models = null, physics = null, seen = {}, firstRender = true, soundOn = false;
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
  function centralOffsetMin() {
    /* THE SECONDS MUST BE STRIPPED BEFORE THE SUBTRACTION. Read off the GitHub mirror
       2026-09-08 12:05 CT: the LAX card said "peak 48% at 11.983333333333334am CT (10am
       local)". Date.UTC() below is built from year/month/day/hour/MINUTE, so it carries no
       seconds, while now.getTime() carries seconds and milliseconds. The difference is
       therefore offsetMin minus (seconds/60), and Math.round tipped it to -301 for every
       second past :30. Half of every minute the whole board drew a fractional Central hour,
       and localZone() below failed its exact -120 comparison at the same time, which is why
       the same card read "10am local" instead of "10am PT". Zeroing seconds and ms fixes
       both symptoms because they were always one bug. */
    var now = new Date();
    now.setSeconds(0, 0);
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now), p = {};
    parts.forEach(function (x) { if (x.type !== "literal") p[x.type] = +x.value; });
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - now.getTime()) / 60000);
  }
  function centralHour(s, h) {
    if (h === null || h === undefined) return null;
    var localOff = s.tz_offset_min !== null && s.tz_offset_min !== undefined ? +s.tz_offset_min : +(s.utc_offset_std || 0) * 60;
    // Every one of the 22 stations sits on a whole-hour US offset, so a fraction here is a
    // bug rather than a half-hour zone. Rounding keeps a future clock-drift defect off the card.
    return ((Math.round(h + (centralOffsetMin() - localOff) / 60) % 24) + 24) % 24;
  }
  function localZone(s) {
    var off = s.tz_offset_min !== null && s.tz_offset_min !== undefined ? +s.tz_offset_min : +(s.utc_offset_std || 0) * 60;
    if (off === centralOffsetMin()) return "CT";
    if (off === centralOffsetMin() - 60) return "MT";
    if (off === centralOffsetMin() - 120) return "PT";
    if (off === centralOffsetMin() + 60) return "ET";
    return "local";
  }
  function centralTime(s, h) { return hourLabel(centralHour(s, h)) + " CT"; }
  function ctStamp(iso) {
    /* weather.com stamps its observation in the STATION's zone ("2026-09-09T10:38:51-0400" on
       the Boston card). House law: Colin reads every clock in Central. */
    if (!iso) return "";
    var t = Date.parse(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
    if (isNaN(t)) return String(iso);
    try {
      return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) + " CT";
    } catch (e) { return String(iso); }
  }
  function bothTime(s, h) { return '<b>' + centralTime(s, h) + '</b> (' + hourLabel(h) + ' ' + localZone(s) + ')'; }
  function bothTimeText(s, h) { return centralTime(s, h) + " (" + hourLabel(h) + " " + localZone(s) + ")"; }
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
  // WO-125 (2026-09-07 night, Minneapolis): the card said "27% no rain expected" in green while the
  // station had reported -RA for 90 minutes. Once ANY route reports rain the headline follows the
  // gauge, never the forecast: rain blue, the inches so far, and what still has to happen.
  function levelOf(s) {
    var p = peak(s);
    if (s.status === "stale") return "stale";
    if (isLocked(s) || rainingNow(s)) return "locked";
    if (p === null) return s.level || "low";
    return p >= 90 ? "extreme" : p >= 70 ? "high" : p >= 50 ? "elevated" : p >= 30 ? "moderate" : "low";
  }
  function peakIsFlat(s) {
    /* A FOUR WAY TIE IS NOT A PEAK. Colin, 2026-09-08 17:16 CT: "why does denver say the high is
       at 9 pm smh". Denver's merged forecast was 20% at 6pm, 7pm, 8pm AND 9pm CT, and
       peakHour() takes the LAST hour of a tie, a rule added so PAST PEAK would not fire early
       on a plateau. Correct for that job, misleading here: "peak at 9pm" reads as risk BUILDING
       toward 9pm when it is flat and already declining, weather.com having dropped to 15% with
       zero forecast rainfall after 6pm. */
    var m = hourlyMap(s), best = null, hrs = [];
    Object.keys(m).forEach(function (k) { if (best === null || +m[k] > best) best = +m[k]; });
    if (best === null) return null;
    Object.keys(m).forEach(function (k) { if (+m[k] === best) hrs.push(+k); });
    hrs.sort(function (a, b) { return a - b; });
    return hrs.length >= 3 ? { from: hrs[0], to: hrs[hrs.length - 1], pct: best, n: hrs.length } : null;
  }
  function peakIsDayFigure(s) {
    /* Is the headline number weather.com's DAY figure rather than any single hour. When it is,
       the card must NOT say "peak 71% at 12am": that reads as a claim about midnight and it is
       false. Chicago, 2026-09-08 13:07 CT: day figure 71%, hourly maximum 15% at 12am. Saying
       "71% at 12am" invents a number nobody published. It is "71% today". */
    // The headline is now a median across providers, which by construction need not equal any
    // single hour from any single source. So it is always "today", never "at 4pm".
    return true;
  }
  function peakWhen(s) { return peakIsDayFigure(s) ? "today" : bothTimeText(s, peakHour(s)); }
  function peakHourText(s) {
    // "peak 12am" on a line that is 15% from noon to midnight names the tie-break, not the weather
    var f = peakIsFlat(s);
    return f ? "flat " + hourLabel(f.from) + " to " + hourLabel(f.to) : hourLabel(peakHour(s));
  }
  function headline(s) { return isLocked(s) || rainingNow(s) ? ((s.observed || {}).in_today || 0).toFixed(2) + '"' : pct(peak(s)); }
  function headlineSub(s) { return isLocked(s) ? "rained, settles YES" : rainingNow(s) ? "raining now, not yet 0.01" : peakIsDayFigure(s) ? "today" : hourLabel(peakHour(s)); }
  function nwsPeak(s) { return (s.forecast && s.forecast.pop_peak !== null && s.forecast.pop_peak !== undefined) ? +s.forecast.pop_peak : null; }
  function twcDayPct(s) {
    /* weather.com OWN day figure, which is the number it shows the public and the number the
       price follows. NOT the maximum of its hourly rows: that is our arithmetic, not theirs,
       and it understates badly. Measured across 22 stations 2026-09-08 13:06 CT, day figure
       against max-of-hourly against NWS against the Kalshi ask:

         KHOU  day 86   max-hourly 77   NWS 24   market 100 (raining)
         KMSY  day 99   max-hourly 35   NWS 42   market  65
         KORD  day 71   max-hourly 15   NWS 10   market  12
         KDEN  day 100  max-hourly 100  NWS 22   market  23

       Houston is why this function exists. Colin: "houston also said no chance of rain in the
       forecast. I bought it, and it rained." weather.com was publishing 86% all day, NWS said
       24%, the board headlined the low number off max-of-hourly, and KHOU began reporting rain
       at 17:45Z with the market at 99c. */
    var fc = (settleFor(s.icao) || {}).fc || {};
    return (fc.day_pct === null || fc.day_pct === undefined) ? null : +fc.day_pct;
  }
  function twcDayLabel(s) { return ((settleFor(s.icao) || {}).fc || {}).day_label || null; }
  function twcPeak(s) {
    var d = twcDayPct(s);
    if (d !== null) return d;
    var st = settleFor(s.icao), best = null;
    (((st || {}).fc || {}).hours || []).forEach(function (h) { if (h[1] !== null && h[1] !== undefined && (best === null || +h[1] > best)) best = +h[1]; });
    return best;
  }
  function twcHourMax(s) {
    var st = settleFor(s.icao), best = null;
    (((st || {}).fc || {}).hours || []).forEach(function (h) { if (h[1] !== null && h[1] !== undefined && (best === null || +h[1] > best)) best = +h[1]; });
    return best;
  }
  // Colin, 2026-09-08: weather.com is the settlement source and the number the market prices. It is THE headline
  // whenever it exists; NWS is the fallback, never the winner of a contest.
  function boardPct(s) {
    /* THE BIG NUMBER IS THE MEDIAN OF THE PROVIDERS, ONE VOTE EACH. NOT ANY SINGLE FORECASTER.

       Colin, 2026-09-08, after being burned three separate ways in one afternoon on a card that
       headlined ONE source at a time:
         LAX   headline NWS 26      weather.com 68 to 93   it rained
         HOU   headline our own max 59 to 77   weather.com 86   it rained, market went to 100c
         DEN   headline weather.com 100   NWS 22, models 28, nearest cell 318 km, dewpoint 39F
         CHI   headline weather.com 71    NWS 10, 0 of 7 models wet, nothing within 112 km

       Every one of those is the same failure: a single provider ran the headline and no other
       provider could contradict it on screen. weather.com additionally FLAPS. KMSY read 99 at
       13:06 CT, 40 at 13:20, 99 at 13:25, so two parts of this page rendered seconds apart
       showed different numbers and Colin saw 100 on the map against 40 on the card.

       A median over PROVIDERS is immune to exactly that, by construction, and needs no weights
       I would have had to invent:
         DEN  [wcom 100, NWS 22, models 28] -> 28
         CHI  [wcom  71, NWS 10, models  0] -> 10
         NOLA [wcom  99, NWS 42, models 46] -> 46
         HOU  [wcom  86, NWS 24, models 44] -> 44
         MIA  [wcom  40, NWS 43, models 66] -> 43
       Denver and Chicago come back to earth, New Orleans and Houston stay live, and Miami is
       untouched. One vote per PROVIDER, not per number, or weather.com would vote twice through
       its day figure and its hourly series and drag the median back to itself.

       weather.com is NOT hidden. It settles the market, so it keeps its own labelled row and
       the card still says when it is the odd one out. It just no longer runs the headline alone.

       This is the desk's call, made while Colin was losing money on a board that had already
       been wrong three times today. codex has it on PR #49 and jules is scoring every candidate
       headline against the settled tape with n. Whatever the evidence says, wins. */
    /* A MEASUREMENT OUTRANKS EVERY FORECAST. Colin, 2026-09-08 15:55 CT, reading the Denver
       card: "LOW CHANCE, 28% today" printed directly above "RAIN AT THE DOOR: COMPOSITE RAIN
       covers 17% of the 6.2 mi ring". Both were computed correctly and together they were
       nonsense, because the headline was built only out of forecasts and nothing let an
       observation override it.

       Rain inside the 10 km ring is not an opinion about later, it is water in the air now.
       When the composite sees it, or a tracked cell is inbound, the headline floor lifts and
       the card can no longer say LOW CHANCE while rain is arriving. */
    var sr0 = (settleFor(s.icao) || {}).radar || {};
    var inb = (sr0.cells || {}).inbound;
    /* THE FLOOR HAD TO BE TIGHTENED THE SAME HOUR IT SHIPPED. Colin, 2026-09-08 16:21 CT:
       "is atlanta really 45 percent chance of rain?????" No. KATL had 6.4% coverage inside
       6 mi, ZERO tracked cells, a clear METAR, weather.com forecasting 0% for every remaining
       hour and the market at 1 cent, and the floor lifted the headline to 45% anyway because
       it fired on ANY echo above zero.

       A few percent of speckle on a national mosaic is not rain arriving. The floor now needs
       either real coverage over the gauge or an actual tracked cell on a path to it, and the
       45% tier additionally requires a cell to exist. Scattered pixels alone lift nothing. */
    var obsFloor = null;
    var haveCell = !!(inb && inb.eta_min !== null && inb.eta_min !== undefined);
    var p10 = (sr0.pct10 === null || sr0.pct10 === undefined) ? null : +sr0.pct10;
    if (p10 !== null && p10 >= 40) obsFloor = 65;              // it is raining on the field
    else if (p10 !== null && p10 >= 20) obsFloor = 50;          // substantially covered
    else if (haveCell && inb.eta_min <= 45) obsFloor = 50;      // a cell is genuinely inbound
    else if (haveCell && p10 !== null && p10 >= 10) obsFloor = 40;

    var votes = [];
    /* weather.com votes with the HIGHER of its day figure and its own hourly peak. At Denver it
       was publishing 93% for one hour and 51% for the day, and the board fed the LOWER of the
       two into the median, dragging the headline down while its own card printed both. */
    var wd = twcDayPct(s), wh = twcHourMax(s);
    var w = (wd === null || wd === undefined) ? wh : ((wh !== null && wh !== undefined && wh > wd) ? wh : wd);
    if (w !== null && w !== undefined) votes.push(+w);
    var n = nwsPeak(s); if (n !== null && n !== undefined) votes.push(+n);
    var mo = modelsFor(s.icao);
    var med = mo && mo.consensus ? mo.consensus.median_pct : null;
    if (med !== null && med !== undefined) votes.push(+med);
    if (!votes.length) return null;
    /* THE HEADLINE IS THE CALIBRATED NUMBER. Colin, 2026-09-08 16:52 CT, asked which blend was
       better and the honest answer was that the desk CANNOT MEASURE IT: neither weather.com's
       nor NWS's past forecasts are archived anywhere reachable, so any preference between mean
       and median is a hunch. Two numbers on this board DO have measured reliability:

         board physics   n=1034 station-days. says 0 to 9% -> rains 2%. says 90 to 99% -> 98%.
         model panel     n=1012. 0 of 7 -> 2.4%. 6 of 7 -> 55.7%. 7 of 7 -> 80.5%.

       Averaging a calibrated number together with two uncalibrated ones destroys the only
       property that makes a forecast worth reading. So physics leads, and NWS, weather.com and
       the model count sit beside it where they are visible but cannot drag it.

       The blend is still computed and still shown, because when physics disagrees hard with
       everyone else that disagreement is itself information, and today it produced a lone
       54% at Chicago against a market at 12c. */
    var phys = physicsPct(s);
    if (phys !== null) {
      /* PHYSICS DOES NOT RUN THE HEADLINE WHEN IT IS ALONE AND NOTHING IS HAPPENING.
         Colin, 2026-09-08 17:20 CT, on the Chicago card: physics said 67% against 0 of 7 models,
         0% radar at every ring, 8 of 8 neighbouring airports dry, weather.com forecasting 15%
         with ZERO rainfall for every remaining hour, and a market at 9 cents. The desk had made
         physics the headline an hour earlier and that made this card worse, not better.

         The model has a known defect: it is fitted on WHOLE DAY features with no time-of-day
         term, so late in a day that has stayed dry it is still serving the morning answer. Both
         seats are building v2. Until then it cannot override a silent sky on its own.

         The rule: if physics is 25+ points above every other provider AND the observations show
         nothing at all, it steps back to the average and the card says physics disagrees. When
         anything is actually measurable, physics leads again. */
      /* RULE RETIRED 2026-09-09 (Colin, Boston, about $30 of his money). The rule above was
         written for v1, which had no time-of-day term; the board now reads v2, which decays
         through the day and whose 80%+ calls went 23 of 23 on unseen dates
         (research/2026-09-09_V2_HOLDOUT_BYDATE.md). On Boston this rule hid a 91% behind a
         32% average, the desk read its own card and talked Colin out of a YES. Physics LEADS
         whenever it has a number; its measured record prints beside it; the other sources sit
         under it as context and forecastLabel still names any disagreement. */
      return (obsFloor !== null && phys < obsFloor) ? obsFloor : phys;
    }

    /* Fallback when physics has no number: the average he asked for, not the median. Colin, 2026-09-08 16:48 CT: "THE MEDIAN IS NOT GOOD I NEED
       THE AVERAGE OF ALL OF THOSE WHY WOULD WE TAKE THE MEDIAN?"

       He is right and the desk had no evidence for the median. With only three providers the
       median IS the middle one and it DISCARDS the other two entirely: at Denver, NWS 20,
       models 28 and weather.com 82 produced 28, which threw away an 82 from the source that
       settles the market. The desk picked median that afternoon on a hunch about outliers,
       never measured it against the mean, and then defended it. That is the same failure as
       every other one today.

       The mean uses all three. Its known weakness is that weather.com swings hard, and today's
       Colorado network shows it over-forecasting badly in dry high-plains air (seven stations
       rated 50 to 82 percent, all recorded nothing). Neither rule is validated on the tape yet,
       so the card now shows every component alongside the number and he can see the spread. */
    var sum = 0;
    for (var vi = 0; vi < votes.length; vi++) sum += votes[vi];
    var m = Math.round(sum / votes.length);
    return (obsFloor !== null && m < obsFloor) ? obsFloor : m;
  }
  function peak(s) { var b = boardPct(s); if (b !== null) return b; var n = nwsPeak(s), t = twcPeak(s); return (t !== null && t !== undefined) ? t : n; }
  function peakHour(s) {
    /* The peak HOUR comes from the hourly rows. peak() may now return weather.com's DAY figure,
       which by construction need not equal any single hour, so keying the hour off it would
       silently return null and blank the "peak at" label on every card. */
    var m = hourlyMap(s), best = null;
    Object.keys(m).forEach(function (k) { if (best === null || +m[k] > best) best = +m[k]; });
    var last = null;
    if (best === null) return null;
    Object.keys(m).forEach(function (k) { if (+m[k] === best && (last === null || +k > last)) last = +k; });
    return last;
  }
  function peakSource(s) { var t = twcPeak(s); return (t !== null && t !== undefined) ? "weather.com" : "NWS only, no weather.com data yet"; }
  function forecastLabel(s) {
    /* THE LABEL MUST SHOW THE ARITHMETIC THAT ACTUALLY PRODUCED THE NUMBER. Colin, 2026-09-08
       16:20 CT, reading the Denver card: "board 45% = average of NWS 22%, weather.com 47%,
       7 models 28%". The median of 22, 47 and 28 is 28. The 45 came from the observation floor,
       which lifts the headline when radar sees echo over the gauge, and the label never
       mentioned it. A card that shows its working and the working does not add up is worse than
       a card that shows nothing, because it looks checkable and is not.

       It also quoted weather.com's DAY figure while the vote uses the higher of its day figure
       and its own hourly peak, so the label said 47% where the vote used 86%. */
    var mo = modelsFor(s.icao), med = mo && mo.consensus ? mo.consensus.median_pct : null;
    var hm = twcHourMax(s), d = twcDayPct(s);
    var wVote = (d === null || d === undefined) ? hm : ((hm !== null && hm !== undefined && hm > d) ? hm : d);
    // name WHICH weather.com number went into the vote, its day figure or its best hour
    var wName = (d !== null && d !== undefined && hm !== null && hm !== undefined && hm > d) ? "weather.com best hour " : "weather.com day ";
    var raw = [], b = boardPct(s);
    if (nwsPeak(s) !== null && nwsPeak(s) !== undefined) raw.push(+nwsPeak(s));
    if (wVote !== null && wVote !== undefined) raw.push(+wVote);
    if (med !== null && med !== undefined) raw.push(+med);
    raw.sort(function (x, y) { return x - y; });
    var medv = raw.length ? Math.round(raw.reduce(function (a, x) { return a + x; }, 0) / raw.length) : null;
    var ph2 = physicsPct(s), mo2 = modelsFor(s.icao);
    var nwet = mo2 && mo2.consensus ? mo2.consensus.n_wet : null, nmod = mo2 && mo2.consensus ? mo2.consensus.n_models : null;
    /* NEVER CALL A BUCKET CALIBRATED THAT HAS NO HIT RATE ON FILE. Colin, 2026-09-09, reading the
       Boston card: "board 91% is the CALIBRATED physics number" over "fitted on 0 station-days".
       The 90 to 99 bucket had four out-of-sample days behind it and the file carried no
       reliability at all. The label asserted a measurement nothing had made. */
    var relL = physicsRel(ph2);
    var relTxt = relL
      ? " (out of sample, when it said " + relL.lo + " to " + relL.hi + "% it settled YES "
        + relL.actual_pct + "% of the time, n=" + relL.n + (relL.n < 20 ? ", TOO THIN TO TRUST" : "") + ")"
      : " (NO measured hit rate on file for this bucket)";
    var out = (ph2 !== null
      ? "board " + pct(b) + " is the physics model's number" + relTxt + ". "
        + "beside it: NWS " + pct(nwsPeak(s)) + ", " + wName + pct(wVote)
        + ", " + (nwet === null ? "models " + pct(med) : nwet + " of " + nmod + " models wet" + panelSkillText(s))
      : "board " + pct(b) + " = average of NWS " + pct(nwsPeak(s))
        + ", " + wName + pct(wVote) + ", 7 models " + pct(med));
    /* NAME THE MECHANISM THAT ACTUALLY PRODUCED THE NUMBER. This line previously attributed
       ANY gap between the headline and the average to a radar override, and printed
       "RADAR OVERRIDE: rain is already inside 6 mi at 0%" on the Chicago card, where coverage
       was zero and the number had come from the physics model. A card that explains itself
       wrongly is worse than one that stays silent. */
    var sr1 = (settleFor(s.icao) || {}).radar || {};
    var p10lbl = (sr1.pct10 === null || sr1.pct10 === undefined) ? null : +sr1.pct10;
    var overrode = (p10lbl !== null && p10lbl > 0) && b !== null && medv !== null && b > medv && b !== ph2;
    if (overrode) {
      out = "board " + pct(b) + " (RADAR OVERRIDE: rain is already inside 6 mi at " + pct(p10lbl)
          + ", so the headline cannot sit below " + pct(b) + "; the forecasts alone would say "
          + pct(medv) + " = average of NWS " + pct(nwsPeak(s)) + ", " + wName + pct(wVote)
          + ", 7 models " + pct(med) + ")";
    } else if (ph2 !== null && b === medv && ph2 - Math.max(nwsPeak(s) || 0, wVote || 0, med || 0) >= 25) {
      /* THE DISMISSAL MUST CARRY THE NUMBER IT IS DISMISSING. Boston 2026-09-09: this note read
         "physics says 93% and is ALONE ... not leading this card" with no hit rate beside it, the
         desk read it the same way, and Colin was talked out of a YES that the model had right.
         The by-date holdout (research/2026-09-09_V2_HOLDOUT_BYDATE.md) says the model's 80%+
         range went 23 of 23 on unseen dates. Whether physics should LEAD when alone is Colin's
         call; until he makes it, the note shows what the number has been worth. */
      var relA = physicsRel(ph2);
      out = "board " + pct(b) + " = average of NWS " + pct(nwsPeak(s)) + ", " + wName + pct(wVote)
          + ", 7 models " + pct(med) + ".  NOTE: the physics model says " + pct(ph2)
          + " and is ALONE with nothing on radar, so by the current rule it is not leading this card"
          + (relA ? "; out of sample, when it said " + relA.lo + " to " + relA.hi + "% it settled YES " + relA.actual_pct + "% of the time (n=" + relA.n + ")" : "; it has no measured hit rate on file for this bucket");
    }
    // If weather.com's day figure and its own hourly maximum disagree, SAY SO. They differed by
    // 64 points at New Orleans and 56 at Chicago on 2026-09-08, and only the day figure tracked
    // the price. Hiding the gap is how a card looks confident about a number nobody else holds.
    if (d !== null && hm !== null && Math.abs(d - hm) >= 15) out += " (day " + pct(d) + " vs its own hourly peak " + pct(hm) + ")";
    return out;
  }
  function forecastWindow(s) {
    var base = s.forecast && s.forecast.window, start = base ? base.start : null, end = base ? base.end : null, m = hourlyMap(s);
    Object.keys(m).forEach(function (k) { var h = +k; if (+m[k] >= 40) { if (start === null || h < start) start = h; if (end === null || h > end) end = h; } });
    return start === null ? null : { start: start, end: end, peak: peakHour(s) };
  }
  /* The gauge day runs on STANDARD time, so during daylight time the day rolls at 1:00 AM civil;
     for that hour every locked marker is still yesterday's. Say which day, and when it rolls. */
  function dayLabel(s) { var d = s.local_day ? s.local_day.slice(5).replace("-", "/") : ""; return d ? d.replace(/^0/, "").replace(/\/0/, "/") : ""; }
  function rollHour(s) {
    var off = (s.tz_offset_min !== undefined && s.tz_offset_min !== null) ? s.tz_offset_min : null, std = (s.utc_offset_std || 0) * 60;
    if (off === null) return null; var diff = (off - std) / 60; return diff > 0 ? diff : null;
  }
  function dayNote(s) { var r = rollHour(s); return (s.local_day ? "market day " + s.local_day : "") + (r ? ", next day starts " + bothTime(s, r) : ""); }
  function windowText(s) {
    var w = forecastWindow(s), pk = peak(s), ph = peakHour(s);
    if (pk === null) return "no rain forecast";
    if (pk < 20) return "no rain expected";
    if (pk < 40) return "LOW CHANCE, " + pct(pk) + " " + (peakIsDayFigure(s) ? "today" : "at " + bothTime(s, ph));
    return (w ? "rain " + bothTime(s, w.start) + (w.end !== w.start ? " to " + bothTime(s, w.end + 1) : "") + ", " : "") + "peak " + pct(pk) + " " + (peakIsDayFigure(s) ? "today (weather.com)" : "at " + bothTime(s, ph));
  }
  function marketPct(s) {
    var k = s.market || {};
    var v = (k.yes_ask === null || k.yes_ask === undefined) ? k.last : k.yes_ask;
    return (v === null || v === undefined) ? null : Math.round(+v * 100);
  }
  function gapsAgainstMarket(s) {
    /* THE GAP MUST BE MEASURED AGAINST THE NUMBER THE CARD HEADLINES.

       Colin, 2026-09-08 13:18 CT, quoting his own Denver card verbatim:
         "Kalshi YES 25c ask / 22c bid | NWS 22% / TWC 100% | gap +3 ... how does this make
          any sense"

       It does not. collect_state.py computes market["gap"] against the NWS peak, and the card
       headlines weather.com. 25c minus NWS 22 is the +3. So the card was showing a 78 point
       disagreement between its two forecasters and then printing a three point gap measured
       off the one it does NOT headline. That single line contained a contradiction and an
       unexplained number.

       collect_state.py is in the bot MONEY_FILES and cannot be edited without both outside
       seats, so the gap is recomputed here against every source the card actually shows, and
       each one is named. On Denver right now that reads: market 25c, weather.com 100 (-75),
       models 28 (-3), NWS 22 (+3), which says plainly that the market agrees with the models
       and not with weather.com. That is the useful fact, and the old single number hid it. */
    var mp = marketPct(s);
    if (mp === null) return [];
    var out = [], w = twcPeak(s), n = nwsPeak(s), mo = modelsFor(s.icao);
    var med = mo && mo.consensus ? mo.consensus.median_pct : null;
    // "weather.com day": its published day figure. The forecast row's vote may use its best HOUR
    // instead, and on Boston 2026-09-09 the card showed 41 here and 49 there under one name.
    if (w !== null && w !== undefined) out.push(["weather.com day", w, mp - w]);
    if (med !== null && med !== undefined) out.push(["models", med, mp - med]);
    if (n !== null && n !== undefined) out.push(["NWS", n, mp - n]);
    return out;
  }
  function gapsHTML(s) {
    var g = gapsAgainstMarket(s);
    if (!g.length) return '<span class="gap flat">gap --</span>';
    return g.map(function (x) {
      return '<span class="gap ' + gapClass(x[2]) + '">vs ' + x[0] + ' ' + x[1] + '% <b>' + gapText(x[2]) + '</b></span>';
    }).join("");
  }
  function gapClass(g) { return g === null || g === undefined ? "flat" : g >= 8 ? "pos" : g <= -8 ? "neg" : "flat"; }
  function gapText(g) { return g === null || g === undefined ? "--" : (g > 0 ? "+" : "") + g; }

  /* ---------------- the trade read: peak state, area state, one verdict line ----------------
     Colin, 2026-09-04: "make sure it is obvious if we are PAST the peak hour for rain and if no
     rain is in the area". Each is graded from what the data actually holds, and neither is
     asserted when its evidence is missing: no radar sample means "radar unknown", not "clear". */
  function hourlyMap(s) {
    var m = {}, st = settleFor(s.icao);
    ((s.forecast && s.forecast.hourly_seen) || []).forEach(function (h) { m[h[0]] = h[1]; });
    ((s.forecast && s.forecast.hourly) || []).forEach(function (h) { m[h[0]] = h[1]; });
    (((st || {}).fc || {}).hours || []).forEach(function (h) { if (m[h[0]] === undefined || +h[1] > +m[h[0]]) m[h[0]] = h[1]; });
    return m;
  }
  function remainingPeakSource(s) {
    /* WHICH FORECASTER THAT HOUR CAME FROM. Colin, 2026-09-08 14:47 CT, on the Denver card:
       "rest of day tops 86% at 6pm CT FOR DENVER WHAT THE FUCK IS THIS YOU SAID DENVER EARLIER
       WAS FUCKING GOOD NOW ITS SAYING 86 PERCENT".

       The card was printing a 28% headline and an 86% hour with nothing saying they came from
       different places. The headline is a median across providers; the hour is a single
       forecaster's single best hour, in Denver's case weather.com, which the same afternoon was
       claiming 100% for the day while forecasting 0.02 inches of rain in total. Two unlabelled
       numbers on one card that disagree by 58 points read as the board contradicting itself. */
    var rem = remainingPeak(s);
    if (!rem) return null;
    var stf = ((settleFor(s.icao) || {}).fc || {}).hours || [];
    for (var i = 0; i < stf.length; i++) {
      if (+stf[i][0] === +rem.hour && +stf[i][1] === +rem.pop) return "weather.com";
    }
    return "NWS";
  }
  function remainingPeak(s) {
    // the highest chance still ahead on the station's own clock today, and the hour it lands
    var m = hourlyMap(s), lh = s.local_hour, best = null;
    if (lh === null || lh === undefined) return null;
    Object.keys(m).forEach(function (k) { var h = +k; if (h >= lh && (best === null || m[k] > best.pop || (m[k] === best.pop && h > best.hour))) best = { hour: h, pop: m[k] }; });
    /* A PLATEAU IS NOT A PEAK HOUR. Colin, 2026-09-09, Austin: weather.com read 15% at every
       hour from noon to midnight, the tie-break above picked the LAST hour, and the card said the
       highest chance was at 12am. The hour stays the last one (PAST PEAK logic depends on it) but
       the row now carries the plateau so the text can say "flat 15% from 12pm to 12am". */
    if (best !== null) {
      var tie = [];
      Object.keys(m).forEach(function (k) { var h = +k; if (h >= lh && +m[k] === best.pop) tie.push(h); });
      tie.sort(function (a, b) { return a - b; });
      best.from = tie[0]; best.to = tie[tie.length - 1]; best.flat = tie.length >= 3;
    }
    return best;
  }
  function remText(s, rem) {
    if (!rem) return "nothing";
    return rem.flat ? "flat " + pct(rem.pop) + " from " + bothTime(s, rem.from) + " to " + bothTime(s, rem.to) + ", no single peak hour"
                    : pct(rem.pop) + " at " + bothTime(s, rem.hour);
  }
  function peakState(s) {
    var f = s.forecast || {}, lh = s.local_hour, ph = peakHour(s), w = forecastWindow(s), pk = peak(s);
    if (isLocked(s)) return { kind: "locked", short: "LOCKED", text: "settled: the gauge locked" };
    if (lh === null || lh === undefined || ph === null || ph === undefined || pk === null) return { kind: "unknown", short: "", text: "" };
    var rem = remainingPeak(s), left = 24 - lh;
    if (w && lh >= w.start && lh <= w.end) return { kind: "in", short: "IN WINDOW", text: "IN THE RAIN WINDOW now (" + hourLabel(w.start) + " to " + hourLabel(w.end + 1) + ", peak " + hourLabel(w.peak) + " " + pct(pk) + ")" };
    if (lh < ph) {
      /* THREE BUGS IN ONE LINE, all reported by Colin at 16:47 CT reading the Denver card:
         "peak ahead in 2 h at 5pm (28%) 2 HOURS IS ALMOST 7?"
         1. hourLabel(ph) printed the STATION's local hour. Denver's peak is 5pm MT which is 6pm
            CENTRAL, and he has asked for Central only.
         2. (ph - lh) is integer hours, so 3:47pm to 5pm printed as "2 h" when it is 1 h 13 m.
            untilText() already does this correctly to the minute.
         3. pct(pk) is the BOARD number, 28%, pinned to an hour whose actual value is 82%. The
            card was pairing the blended figure with the peak hour's clock time, which reads as
            a claim that the peak hour is 28%. */
      var atPct = hourlyMap(s)[ph];
      var flat = peakIsFlat(s);
      if (flat) {
        return { kind: "ahead", short: "FLAT " + pct(flat.pct),
                 text: "NO PEAK, FLAT at " + pct(flat.pct) + " for " + flat.n + " hours, "
                       + centralTime(s, flat.from) + " to " + centralTime(s, flat.to)
                       + ". the risk is not building toward any hour" };
      }
      return { kind: "ahead", short: "PEAK " + centralTime(s, ph).replace(" CT", ""),
               text: "PEAK AHEAD " + untilText(ph, s) + " at " + bothTimeText(s, ph)
                     + " (" + pct(atPct === undefined ? pk : atPct) + " that hour)" };
    }
    if (lh === ph) return { kind: "in", short: "PEAK NOW", text: "PEAK HOUR NOW (" + pct(pk) + ")" };
    if (rem && rem.hour > lh && rem.pop >= 30) return { kind: "second", short: "2ND CHANCE " + hourLabel(rem.hour), text: "PAST PEAK (" + hourLabel(ph) + " was " + pct(pk) + "), second chance " + pct(rem.pop) + " at " + hourLabel(rem.hour) };
    return { kind: "past", short: "PAST PEAK", text: "PAST PEAK by " + (lh - ph) + " h (" + hourLabel(ph) + " was " + pct(pk) + "), rest of day tops " + (rem ? pct(rem.pop) : "--") + ", " + left + " h left on the gauge day" };
  }
  /* THE PEAK STRIP (Colin, 2026-09-07: "make the peak for the day more obvious for a weather event
     and highlight anything that is past due"). One block under the headline, one state at a time:
     LOCKED, PAST DUE (collector's overdue: peak >= 60% and 2 h gone, gauge dry), PEAK NOW, WINDOW
     OPEN, PEAK AHEAD (with a countdown), SECOND CHANCE, PAST PEAK, NO RAIN EXPECTED. */
  function localMinutes(s) {
    var off = (s.tz_offset_min !== undefined && s.tz_offset_min !== null) ? s.tz_offset_min : (s.utc_offset_std || 0) * 60;
    var t = new Date(Date.now() + off * 60000); return t.getUTCHours() * 60 + t.getUTCMinutes();
  }
  function untilText(hour, s) {
    var m = hour * 60 - localMinutes(s); if (m <= 0) return "";
    return "in " + (m >= 60 ? Math.floor(m / 60) + " h " : "") + (m % 60) + " m";
  }
  function agoHours(hour, s) { var m = localMinutes(s) - hour * 60; return m < 60 ? Math.max(0, m) + " m ago" : Math.floor(m / 60) + " h " + (m % 60) + " m ago"; }
  function peakStrip(s) {
    var f = s.forecast || {}, w = forecastWindow(s), ph = peakHour(s), pk = peak(s), lh = s.local_hour, o = s.observed || {}, rem = remainingPeak(s);
    if (isLocked(s)) return { cls: "locked", big: "LOCKED " + (o.in_today || 0).toFixed(2) + " in", sub: "the gauge reported measurable rain, settles YES" };
    if (ph === null || ph === undefined || pk === null || lh === null || lh === undefined) return { cls: "none", big: "NO FORECAST", sub: "no hourly forecast for this gauge yet" };
    var win = w ? centralTime(s, w.start) + " to " + centralTime(s, w.end + 1) : "";
    var obAge = o.latest_ob_utc ? Math.round((Date.now() - Date.parse(o.latest_ob_utc)) / 60000) : null;
    if (s.overdue && obAge !== null && obAge > 90) return { cls: "past", big: "GAUGE REPORT " + obAge + " MIN OLD", sub: "rain was expected (" + pct(pk) + " by " + centralTime(s, ph) + ") but the gauge's last report is too old to call it past due" };
    if (s.overdue) return { cls: "due", big: "PAST DUE", sub: "rain overdue: " + pct(pk) + " by " + centralTime(s, ph) + ", gauge still " + (o.in_today || 0).toFixed(2) + " in " + agoHours(ph, s) + (obAge !== null ? " (report " + obAge + " m old)" : "") + (rem && rem.hour > lh && rem.pop >= 30 ? "; next chance " + pct(rem.pop) + " at " + centralTime(s, rem.hour) : "") };
    // WO-125: rain at the gauge outranks every forecast state. "NO RAIN EXPECTED, BUT THE GAUGE
    // REPORTS RAIN NOW" was two answers in one box; this is the one that matters.
    if (rainingNow(s)) return { cls: "on", big: "RAINING AT THE GAUGE", sub: "gauge " + (o.in_today || 0).toFixed(2) + " in so far; a trace settles as 0, the first 0.01 locks YES" + (obAge !== null ? " (report " + obAge + " m old)" : "") };
    if (pk < 20) return { cls: "none", big: "NO RAIN EXPECTED", sub: "day peak only " + pct(pk) + (peakIsDayFigure(s) ? " today (weather.com)" : " at " + centralTime(s, ph) + (lh < ph ? " (" + untilText(ph, s) + ")" : "")) };
    if (pk < 40) return { cls: "ahead", big: "LOW CHANCE, " + pct(pk) + " " + (peakIsDayFigure(s) ? "today" : "at " + centralTime(s, ph)), sub: forecastLabel(s) + (lh < ph ? ", " + untilText(ph, s) : "") };
    if (lh === ph) return { cls: "now", big: "PEAK HOUR NOW", sub: pct(pk) + (peakIsDayFigure(s) ? " today (weather.com)" : " at " + centralTime(s, ph)) + (win ? ", window " + win : "") + (rainingNow(s) ? ", raining at the gauge" : ", gauge " + (o.in_today || 0).toFixed(2) + " in so far") };
    if (w && lh >= w.start && lh <= w.end) return { cls: "open", big: rainingNow(s) ? "RAIN WINDOW OPEN, RAINING" : lh > ph ? "WAITING FOR RAIN" : "RAIN WINDOW OPEN", sub: win + ", peak " + centralTime(s, ph) + " " + pct(pk) + (lh < ph ? " " + untilText(ph, s) : ", peak passed " + agoHours(ph, s)) + (rainingNow(s) ? ", raining at the gauge" : ", gauge still " + (o.in_today || 0).toFixed(2) + " in") };
    if (lh < ph) return { cls: "ahead", big: "PEAK " + centralTime(s, ph) + " " + untilText(ph, s), sub: pct(pk) + " at the peak" + (win ? ", window " + win : "") };
    if (rem && rem.hour > lh && rem.pop >= 30) return { cls: "second", big: "SECOND CHANCE " + centralTime(s, rem.hour) + " " + untilText(rem.hour, s), sub: pct(rem.pop) + " then; the " + centralTime(s, ph) + " peak (" + pct(pk) + ") passed " + agoHours(ph, s) + ", gauge " + (o.in_today || 0).toFixed(2) + " in" };
    return { cls: "past", big: "PAST PEAK", sub: centralTime(s, ph) + " was " + pct(pk) + ", " + agoHours(ph, s) + "; rest of day tops " + remText(s, rem) + ", gauge " + (o.in_today || 0).toFixed(2) + " in" };
  }
  function peakStripHTML(s) { var k = peakStrip(s); return '<div class="peakstrip ' + k.cls + '"><b>' + esc(k.big) + '</b><span>' + esc(k.sub) + '</span></div>'; }
  function peakChip(s) {
    var k = peakStrip(s), ph = peakHour(s);
    var t = k.cls === "due" ? "PAST DUE " + agoHours(ph, s).replace(/ (\d+) m ago$/, "").replace(" ago", "") : k.cls === "ahead" ? "PEAK " + centralTime(s, ph) + " " + untilText(ph, s).replace("in ", "") : k.cls === "now" ? "PEAK NOW" : k.cls === "open" ? "WINDOW OPEN" : k.cls === "second" ? "2ND CHANCE " + hourLabel((remainingPeak(s) || {}).hour) : k.cls === "past" ? "PAST PEAK" : k.cls === "locked" ? "LOCKED" : "NO RAIN";
    return '<span class="pk ' + k.cls + '">' + esc(t) + '</span>';
  }
  function neighbourRain(s) { return (s.neighbors || []).filter(function (n) { var lp = pulseFor(n.id); return lp ? lp.raining : n.raining; }); }
  function areaState(s) {
    var r = s.radar || {}, sr = (settleFor(s.icao) || {}).radar, nb = s.neighbors || [], wet = neighbourRain(s), km = r.nearest_km;
    if (isLocked(s)) return { kind: "locked", short: "LOCKED", text: "gauge locked " + (s.observed.in_today || 0).toFixed(2) + " in" };
    if (rainingNow(s)) return { kind: "on", short: "RAIN ON GAUGE", text: "RAIN ON THE GAUGE now" };
    var mv = r.motion || {}, mvTxt = mv && mv.dir ? ", moving " + mv.dir + (mv.kmh ? " " + Math.round(mv.kmh * 0.621371) + " mph" : "") + (mv.toward_gauge ? ", TOWARD the gauge" : mv.toward_gauge === false ? ", not toward it" : "") : "";
    /* THE ORDER OF THESE THREE IS THE FINDING OF WO-125, so it is written down rather than
       left to whoever edits next. A NEIGHBOUR AIRPORT REPORTING RAIN OUTRANKS EVERY RADAR.
       It is a sensor at a real field saying water is falling on it; a radar read is an
       inference about where water is. LAX, 2026-09-08: the site tile said no echo within
       37 mi while Long Beach, 16 mi away, was reporting rain, and Colin was holding a
       position off "nothing near". Then the COMPOSITE, which is a real multi-radar mosaic.
       The site tile comes LAST because it is the instrument under review: it under-reads. */
    var wetNear = wet.filter(function (n) { return n.dist_km !== null && n.dist_km !== undefined && n.dist_km <= 30; }).sort(function (a, b) { return a.dist_km - b.dist_km; });
    if (wetNear.length) return { kind: "mid", short: "RAIN " + MI(wetNear[0].dist_km) + " MI", text: "rain reported at " + wetNear.map(function (n) { return n.id.replace(/^K/, "") + " " + miTxt(n.dist_km) + " " + n.bearing; }).join(", ") + " [neighbour airport reports, they outrank radar]" };
    if (sr && sr.pct10 !== null && sr.pct10 !== undefined && +sr.pct10 > 0) return { kind: "near", short: "RAIN IN 6 MI", text: "COMPOSITE RAIN covers " + pct(sr.pct10) + " of the 6 mile ring" };
    if (sr && sr.pct30 !== null && sr.pct30 !== undefined && +sr.pct30 >= 10) return { kind: "mid", short: "RAIN NEARBY", text: "COMPOSITE RAIN covers " + pct(sr.pct30) + " of the 19 mile ring" };
    var haveRadar = km !== null && km !== undefined;
    if (haveRadar && km <= 10) return { kind: "near", short: "ECHOES " + MI(km) + " MI", text: "ECHOES " + miTxt(km) + " " + r.nearest_dir + " of the gauge" + mvTxt };
    if (haveRadar && km <= 30) return { kind: "mid", short: "RAIN " + MI(km) + " MI", text: "rain " + miTxt(km) + " " + r.nearest_dir + mvTxt };
    if (haveRadar && km <= 60) return { kind: "far", short: "RAIN " + MI(km) + " MI", text: "rain " + miTxt(km) + " " + r.nearest_dir + ", far" + mvTxt };
    if (wet.length) return { kind: "mid", short: "RAIN NEARBY", text: "rain reported at " + wet.map(function (n) { return n.id.replace(/^K/, "") + " " + miTxt(n.dist_km) + " " + n.bearing; }).join(", ") + (haveRadar ? ", nothing on radar within 37 mi" : "") };
    if (haveRadar || r._n) return { kind: "none", short: "NO RAIN NEAR", text: "NO RAIN IN THE AREA: no echo within 37 mi" + (haveRadar ? " (nearest " + miTxt(km) + " " + r.nearest_dir + ")" : "") + (nb.length ? ", " + nb.length + " nearby airports dry" : "") };
    return { kind: "unknown", short: "", text: "radar unknown for this gauge (no sample yet)" };
  }
  function verdict(s) {
    // one line, strongest evidence first: what the gauge did, then the sky, then the clock
    var a = areaState(s), p = peakState(s);
    if (a.kind === "locked") return { cls: "locked", text: "YES: GAUGE LOCKED " + (s.observed.in_today || 0).toFixed(2) + " in" };
    if (s.status === "stale") return { cls: "stale", text: "DATA STALE: do not trust this card" };
    if (a.kind === "on") return { cls: "on", text: "RAIN ON THE GAUGE, lock likely" + (p.text ? "; " + p.text.toLowerCase() : "") };
    if (a.kind === "near") return { cls: "near", text: "RAIN AT THE DOOR: " + a.text + (p.text ? "; " + p.text.toLowerCase() : "") };
    if (p.kind === "past" && a.kind === "none") return { cls: "dry", text: "PAST PEAK, NOTHING NEAR: " + p.text.replace(/^PAST PEAK /, "peak passed ") + "; no echo within 37 mi" };
    if (p.kind === "past") return { cls: "past", text: p.text + (a.text ? "; " + a.text : "") };
    if (a.kind === "none") return { cls: "none", text: a.text + (p.text ? "; " + p.text.toLowerCase() : "") };
    if (p.kind === "in") return { cls: "in", text: p.text + (a.text ? "; " + a.text : "") };
    if (p.kind === "second") return { cls: "second", text: p.text + (a.text ? "; " + a.text : "") };
    if (p.kind === "ahead") return { cls: "ahead", text: p.text + (a.text ? "; " + a.text : "") };
    return { cls: "flat", text: [p.text, a.text].filter(Boolean).join("; ") };
  }
  function evidenceHTML(s) {
    // Settlement record and its leading live observation come first, followed by the existing evidence.
    var o = s.observed, lp = livePulse(s), r = s.radar || {}, nb = s.neighbors || [], wet = neighbourRain(s), rem = remainingPeak(s);
    var st = settleFor(s.icao), sr = st && st.radar, climate = settle && settle.climate ? settle.climate[s.icao] : null, climateText = "no report yet";
    var haveKm = r.nearest_km !== null && r.nearest_km !== undefined, rows = [];
    if (climate && climate.precip !== null && climate.precip !== undefined) climateText = (climate.status === "official" ? "official " : "preliminary ") + (+climate.precip).toFixed(2) + " in";
    rows.push(["settles on", climateText, climate && climate.status === "official" ? "good" : "flat"]);
    /* TWO SEPARATE ROWS, because they answer two separate questions and merging them is how a
       rolling window gets read as a day total. Colin, 2026-09-08 12:38 CT: "0.01 in the last
       hour, 0.05 in 24 h, what does this mean". The 24 h figure reached back into YESTERDAY,
       which LAX had already settled YES, so most of it belonged to a contract that was over.
       "twc today" is day-scoped by twc_obs.twc_today(); "twc live" stays the raw instant read. */
    var tToday = st && st.today_in !== null && st.today_in !== undefined ? +st.today_in : null;
    var gaugeIn = s.observed && s.observed.in_today !== null && s.observed.in_today !== undefined ? +s.observed.in_today : null;
    if (st) {
      var disagree = tToday !== null && tToday >= 0.01 && gaugeIn !== null && gaugeIn < 0.01 && !isLocked(s);
      rows.push(["twc today", tToday === null ? "no day total yet"
        : tToday.toFixed(2) + " in so far today (weather.com" + (st.today_src ? ", " + st.today_src + " window" : "") + ")"
          + (tToday >= 0.01 ? ", ABOVE the 0.01 that settles YES" : ", a trace settles as 0")
          + (disagree ? " -- THE GAUGE STILL READS " + gaugeIn.toFixed(2) + ", THE TWO INSTRUMENTS DISAGREE" : ""),
        disagree ? "hot" : tToday !== null && tToday >= 0.01 ? "hot" : "flat"]);
    }
    rows.push(["twc live", st ? (st.precip1h === null || st.precip1h === undefined ? "no precip1h" : (+st.precip1h).toFixed(2) + " in the last hour") + (st.wx ? ", " + st.wx : "") + (st.valid_local ? " (" + ctStamp(st.valid_local) + ")" : "") : "no report yet", st && +st.precip1h > 0 && !isLocked(s) ? "hot" : st ? "flat" : "bad"]);
    rows.push(["gauge", o ? (o.in_today || 0).toFixed(2) + " in" + (o.locked ? ", LOCKED" : ", dry") + " (ob " + ago(o.latest_ob_utc) + ")" : "no observation", o && o.locked ? "good" : o ? "flat" : "bad"]);
    rows.push(["pulse", lp ? (lp.raining ? "RAINING " + (lp.wx || "") : "no rain in the 1-min report") + " (" + (lp.time_utc || "").slice(11, 16) + "Z)" : "no 1-min pulse", lp && lp.raining ? "hot" : lp ? "flat" : "bad"]);
    var tileText = haveKm ? "nearest echo " + miTxt(r.nearest_km) + " " + r.nearest_dir + (r.near10_pct ? ", " + r.near10_pct + "% of the 6 mile ring" : "") : (r._n ? "no echo within 37 mi" : "no sample");
    /* THE RING PERCENTAGES IN WORDS. "1.9% at 10 km" means: draw a circle 6 miles around the
       gauge, and 1.9 percent of that circle currently has rain in it. It is the single most
       decision-relevant number on the card and it was shipped as a bare percentage. */
    if (sr) {
      /* TWO RADARS ON ONE CARD MUST NOT SILENTLY DISAGREE. Colin, 2026-09-08 13:32 CT, on Miami:
         "MIAMI LOOKS FUCKING WRONG TOO NO FUCKING RAIN". The card was showing composite 0% inside
         10 km on one line and the old site tile saying "4.7 km N, 11.8% of the 10 km ring" on the
         next, with nothing telling him which to believe. Denver did the same at 2% against 3.4%.
         The composite is a multi-radar mosaic; the site tile is one dish, which near its own
         antenna reads ground clutter as rain. The composite wins, and when they disagree by more
         than 10 points the card SAYS they disagree instead of printing both and shrugging. */
      var tilePct = (r && r.near10_pct !== null && r.near10_pct !== undefined) ? +r.near10_pct : null;
      var clash = tilePct !== null && sr.pct10 !== null && sr.pct10 !== undefined && Math.abs(tilePct - +sr.pct10) >= 10;
      /* A DEAD SOURCE COMES OFF THE CARD. It is not enough to label the site tile stale and
         leave its numbers sitting there: a stale number with a warning next to it is still a
         number Colin can read by accident, and today he read exactly that ("nearest echo 2.9 mi
         N, ETA about 7 min" on a tile that had not moved in 114 minutes). When the tile is
         frozen its reading is REMOVED and replaced by a plain statement that it is dead.
         The composite covers the same job and is live, so nothing is lost by dropping it.

         collect_state.py, which produces the tile, is in the bot MONEY_FILES and the bot is
         ARMED LIVE at full size right now, so editing it would drop real trading to paper. That
         is a genuine constraint, but it never justified showing the dead reading: the page owns
         what it displays. */
      var tl2 = (settleFor(s.icao) || {}).tile || {};
      /* tl2.stale is the COMPOSITE frame's freshness since the 09-08 relabel; the single dish's
         own freshness is site_block_stale. Boston 2026-09-09: composite fresh, site block frozen
         1,254 min, and "nearest echo 18 mi S" was printed under a composite reading 0% to 37 mi. */
      var second = (tl2.site_block_stale || tl2.stale)
        ? '<small><b>site tile DEAD</b>, no update in ' + Math.round(tl2.unchanged_min || 0)
          + ' min, its reading is not shown</small>'
        : '<small><b>site tile</b> ' + tileText + (clash ? ' <b>DISAGREES with the composite, one dish reads its own ground clutter, trust the composite</b>' : '') + '</small>';
      rows.push(["radar",
        "share of the sky with rain in it: " + pct(sr.pct10) + " within 6 mi of the gauge, "
          + pct(sr.pct30) + " within 19 mi, " + pct(sr.pct60) + " within 37 mi ("
          + pct(sr.pct30_strong) + " of the 19 mi ring is heavy) (read " + ago(sr.frame_utc) + ")",
        (+sr.pct30 >= 10 || +sr.pct10 > 0) ? "hot" : "flat", second]);
    }
    else rows.push(["radar", tileText, haveKm && r.nearest_km <= 10 ? "hot" : (haveKm || r._n) ? "flat" : "bad"]);
    rows.push(["neighbours", nb.length ? (wet.length ? wet.length + " of " + nb.length + " raining, closest " + Math.round(Math.min.apply(null, wet.map(function (n) { return n.dist_km; }))) + " mi" : nb.length + " of " + nb.length + " dry") : "none", wet.length ? "hot" : "flat"]);
    rows.push(["forecast", rem ? "rest of day tops " + remText(s, rem) + " (" + (rem.flat ? "every hour, " : "one hour, ") + (remainingPeakSource(s) || "forecast") + ") (day peak " + pct(peak(s)) + " " + (peakIsDayFigure(s) ? "today" : "at " + bothTime(s, peakHour(s))) + ", " + forecastLabel(s) + ")" : "no hours left in the forecast day", rem && rem.pop >= 50 ? "hot" : "flat"]);
    var cr = cellsRow(s); if (cr) rows.push(cr);
    var rk = remarksRow(s); if (rk) rows.push(rk);
    var rd = restOfDayRow(s); if (rd) rows.push(rd);
    var pr = physicsRow(s); if (pr) rows.push(pr);
    var mr = modelRow(s); if (mr) rows.push(mr);
    return '<div class="evid">' + rows.map(function (r) { return '<div class="' + r[2] + '"><span>' + r[0] + '</span>' + toMiles(r[1]) + (r[3] || "") + '</div>'; }).join("") + '</div>';
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
        else cells += '<i' + dh + ' class="' + (past ? "past" : "") + (h === peakHour(s) ? " peak" : "") + '" style="height:' + Math.max(3, p) + '%" title="' + hourLabel(h) + ': ' + p + '%' + (past ? " (as forecast)" : "") + ' (click: radar then)"></i>';
      }
      var drops = wet.map(function (h) { return '<span class="wet" style="left:' + ((h + 0.5) / 24 * 100) + '%">&#128167;</span>'; }).join("");
      var nowPct = (stationLocalFraction(s, Date.now()) * 100).toFixed(2);
      var ps = peakState(s), as = areaState(s);
      var status = (o && o.locked ? '<span class="st lockc">LOCKED ' + (o.in_today || 0).toFixed(2) + '" ' + dayLabel(s) + '</span>' : "")
        + (!isLocked(s) && (ps.kind === "past" || ps.kind === "second") ? '<span class="st pastc" title="' + ps.text + '">' + ps.short + '</span>' : "")
        + (!isLocked(s) && !rainingNow(s) && as.kind === "none" ? '<span class="st quietc" title="' + as.text + '">NO RAIN NEAR</span>' : "")
        + (rainingNow(s) && !(o && o.locked) ? '<span class="st rainc">RAINING</span>' : "")
        + (!rainingNow(s) && !(o && o.locked) && (s.neighbors || []).some(function (n) { var lp = pulseFor(n.id); return lp ? lp.raining : n.raining; }) ? '<span class="st nearc">RAIN NEARBY</span>' : "")
        + (s.overdue ? '<span class="st overc">OVERDUE</span>' : "") + peakChip(s);
      var row = document.createElement("div");
      row.className = "trow" + (s.overdue ? " overdue" : "") + (o && o.locked ? " locked" : ""); row.style.setProperty("--c", c); row.dataset.city = s.city;
      row.innerHTML = '<div class="th"><b>' + s.city + '</b><span class="pk">' + headline(s) + '</span><span class="win">' + (isLocked(s) ? "rained; was " + pct(f.pop_peak) : windowText(s)) + '</span>' + status
        + nbBubbles(s) + '<span class="k">Kalshi <b>' + cents(k.yes_ask) + '</b></span></div>'
        + dayShapeHTML(s)
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
        return '<span class="ob" data-city="' + c + '">' + c + ' ' + (s ? pct(peak(s)) + ' peak ' + peakHourText(s) + ', dry at ' + hourLabel(s.local_hour) : '') + '</span>';
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
    /* EACH BUBBLE CARRIES BOTH NUMBERS. Colin, 2026-09-08 16:22 CT: "each bubble needs to have
       two things its current chance of rain and its chance high for the day and what time so I
       can easily see them". The bubble showed ONE number, the day peak, so a city sitting at 5%
       right now with an 80% storm coming at 6pm looked identical to one that is at 80% already.
       Those are completely different trades. NOW / PEAK at TIME, in Central. */
    var tagEl = el.querySelector(".tag small");
    if (isLocked(s)) {
      tagEl.textContent = headline(s) + (dayLabel(s) ? " " + dayLabel(s) : "");
    } else {
      var m0 = hourlyMap(s), lh = s.local_hour;
      var nowPct = (lh !== null && lh !== undefined && m0[lh] !== undefined) ? +m0[lh] : null;
      var ph0 = peakHour(s);
      var when = (ph0 === null || ph0 === undefined) ? "" : centralTime(s, ph0).replace(" CT", "");
      tagEl.textContent = (nowPct === null ? "" : nowPct + "% now")
                        + (p ? " / " + p + "%" + (when ? " " + when : "") : "");
    }
    el.style.zIndex = String(100 + p);
  }
  function sparkline(hist) {
    var pts = (hist || []).slice(-48).map(function (h) { return h[1]; }).filter(function (v) { return v !== null && v !== undefined; });
    if (pts.length < 2) return "";
    var w = 260, hgt = 40, step = w / (pts.length - 1);
    var d = pts.map(function (v, i) { return (i ? "L" : "M") + (i * step).toFixed(1) + "," + (hgt - v / 100 * hgt).toFixed(1); }).join(" ");
    return '<svg width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + ' ' + hgt + '"><line x1="0" x2="' + w + '" y1="' + (hgt * 0.1) + '" y2="' + (hgt * 0.1) + '" stroke="#a855f7" stroke-dasharray="3 4" opacity=".5"/><path d="' + d + '" fill="none" stroke="#60a5fa" stroke-width="2"/></svg>';
  }

  /* THE DAY'S SHAPE, ON THE OUTSIDE ROW. Colin, 2026-09-08: "each bubble needs to have the
     scale of precipitation chance throughout the day and note when the high is and also at
     what time it looks like its going to rain."
     Three facts, in words, no hovering and no opening the card:
       the RANGE across the whole day, the HIGH and when, and the WINDOW where it is most
       likely to actually rain. Hours already past are marked so a high at 2pm on a dry
       evening cannot read as a warning. Uses the same NWS-and-weather.com merge the strip
       does, higher of the two, so the row and the bars can never disagree. */
  function dayShape(s) {
    var byH = {}, stf = ((settleFor(s.icao) || {}).fc || {}).hours || [];
    ((s.forecast && s.forecast.hourly_seen) || []).forEach(function (h) { byH[h[0]] = +h[1]; });
    ((s.forecast && s.forecast.hourly) || []).forEach(function (h) { byH[h[0]] = +h[1]; });
    stf.forEach(function (h) { if (byH[h[0]] === undefined || +h[1] > byH[h[0]]) byH[h[0]] = +h[1]; });
    var hs = Object.keys(byH).map(Number).sort(function (a, b) { return a - b; });
    if (!hs.length) return null;
    var vals = hs.map(function (h) { return byH[h]; });
    var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
    var hiH = hs[vals.indexOf(hi)], now = s.local_hour;
    // the WINDOW: the run of hours at or above 60% of the day's high, and at least 15%
    var floor = Math.max(15, Math.round(hi * 0.6)), run = null, best = null;
    hs.forEach(function (h) {
      if (byH[h] >= floor) { if (!run) run = { a: h, b: h }; else if (h === run.b + 1) run.b = h; else { if (!best || (run.b - run.a) > (best.b - best.a)) best = run; run = { a: h, b: h }; } }
    });
    if (run && (!best || (run.b - run.a) > (best.b - best.a))) best = run;
    return { hi: hi, lo: lo, hiHour: hiH, win: hi >= 15 ? best : null, past: now !== null && now !== undefined && hiH < now };
  }
  function dayShapeHTML(s) {
    /* A SETTLED MARKET HAS NO FORECAST SHAPE. Colin, 2026-09-08: "houston already rained."
       The row was printing "high 28% 1pm (past), rain most likely 1pm to 8pm" for a gauge
       that had already recorded 0.02in and a contract already trading at 100c. Once the
       gauge tips, what the forecast expected is history, and printing it beside a live
       board invites reading a decided market as an open one. */
    var o = s.observed;
    if (o && (o.locked || (o.in_today || 0) >= 0.01)) {
      return '<span class="shape done">RAINED &middot; gauge <b>' + (o.in_today || 0).toFixed(2)
        + ' in</b> &middot; settles YES, nothing left to forecast</span>';
    }
    var d = dayShape(s);
    if (!d) return "";
    var hiTxt = "high <b>" + d.hi + "%</b> " + hourLabel(d.hiHour) + (d.past ? " (past)" : "");
    var win = d.win ? ("rain most likely <b>" + hourLabel(d.win.a) + (d.win.b !== d.win.a ? " to " + hourLabel(d.win.b + 1) : "") + "</b>")
                    : "no hour above " + Math.max(15, Math.round(d.hi * 0.6)) + "%";
    return '<span class="shape' + (d.past ? " spast" : "") + '">' + d.lo + " to " + d.hi + "% today &middot; " + hiTxt + " &middot; " + win + '</span>';
  }
  function hourBars(s) {
    /* THE STRIP READS BOTH FORECASTERS, HIGHER WINS, and it says which one it took.
       Colin, 2026-09-08: "WHY DO ALL THE CARDS HAVE ZERO HOURLY FORECAST ON THEM?" The
       headline moved to weather.com in 5a230cc and this strip did not: it was built from
       s.forecast (NWS api.weather.gov) alone. On the cards where NWS reads 0 for the rest
       of the day the strip was a flat row of zeros, and on LAX that same minute the strip
       showed NWS 26% at 10am under a headline reading "46% weather.com". Read off the box
       16:56 CT: LAX weather.com 10am 46 / 11am 36 / 12pm 38 against NWS 26 / 15 / 15.
       WO-125 addendum item 6 already required the higher of the two; it was implemented for
       the headline and missed here. hourlyMap() is the merge the rest of the card uses. */
    var byH = {}, stf = ((settleFor(s.icao) || {}).fc || {}).hours || [];
    ((s.forecast && s.forecast.hourly_seen) || []).forEach(function (h) { byH[h[0]] = [h[0], h[1], "as forecast", "NWS"]; });
    ((s.forecast && s.forecast.hourly) || []).forEach(function (h) { byH[h[0]] = [h[0], h[1], h[2], "NWS"]; });
    stf.forEach(function (h) {
      var cur = byH[h[0]];
      if (!cur || +h[1] > +cur[1]) byH[h[0]] = [h[0], h[1], h[3] || "", "weather.com"];
    });
    var hourly = Object.keys(byH).map(function (k) { return byH[k]; }).sort(function (a, b) { return a[0] - b[0]; }); if (!hourly.length) return "";
    var now = s.local_hour, f = s.forecast || {}, w = forecastWindow(s), marks = [];
    if (now !== null && now !== undefined) marks.push([now, "now", "now"]);
    if (peakHour(s) !== null && peakHour(s) !== undefined) marks.push([peakHour(s), "peak", "peak " + bothTime(s, peakHour(s))]);
    if (w) { marks.push([w.start, "win", "rain from " + bothTime(s, w.start)]); if (w.end !== w.start) marks.push([w.end + 1, "win", "to " + bothTime(s, w.end + 1)]); }
    var rem = remainingPeak(s); if (rem && rem.hour !== peakHour(s) && rem.hour > (now || 0)) marks.push([rem.hour, "rem", "next " + bothTime(s, rem.hour) + " " + rem.pop + "%"]);
    return '<div class="hourmarks">' + marks.map(function (m) { return '<button class="hm ' + m[1] + '" data-h="' + m[0] + '" title="click: radar at ' + hourLabel(m[0]) + '">' + m[2] + '</button>'; }).join("") + '</div>'
      + '<div class="hourbar" style="--c:' + COLORS[levelOf(s)] + '">' + hourly.map(function (h) {
      var past = now !== null && now !== undefined && h[0] < now;
      return '<i data-h="' + h[0] + '" class="' + (h[0] === now ? "now" : "") + (past ? " past" : "") + (h[0] === peakHour(s) ? " peak" : "") + '" style="height:' + Math.max(2, h[1] * 0.34) + 'px" title="' + hourLabel(h[0]) + ' ' + h[1] + '% ' + (h[2] || "") + ' [' + (h[3] || "NWS") + '] (click: radar at ' + hourLabel(h[0]) + ')"><b>' + hourLabel(h[0]).replace(/[ap]m/, "") + '</b></i>';
    }).join("") + '</div><div class="hourlbl"><span>' + hourLabel(hourly[0][0]) + '</span><span>hourly chance today, higher of NWS and weather.com, click an hour to see the radar then</span><span>' + hourLabel(hourly[hourly.length - 1][0]) + '</span></div>';
  }
  function cardHTML(s) {
    var f = s.forecast || {}, o = s.observed, t = s.trend || {}, k = s.market || {}, lv = levelOf(s), c = COLORS[lv];
    var chips = '<div class="chips">'
      // WO-125: no LOW chip beside a RAINING or LOCKED chip; one state per card
      + (isLocked(s) || rainingNow(s) ? "" : '<span class="chip ' + lv + '">' + lv.toUpperCase() + '</span>')
      + (o && o.locked ? '<span class="chip lockc">LOCKED ' + (o.in_today || 0).toFixed(2) + ' in</span>' : "")
      + (rainingNow(s) ? '<span class="chip rainc">RAINING AT GAUGE</span>' : "")
      + (!rainingNow(s) && !isLocked(s) && (s.neighbors || []).some(function (n) { var lp = pulseFor(n.id); return lp ? lp.raining : n.raining; }) ? '<span class="chip nearc">RAIN NEARBY</span>' : "")
      + (!rainingNow(s) && !isLocked(s) && s.radar && s.radar.nearest_km !== null && s.radar.nearest_km !== undefined && s.radar.nearest_km <= 15 ? '<span class="chip nearc">ECHOES ' + miOf(s.radar.nearest_km) + ' MI ' + s.radar.nearest_dir + '</span>' : "")
      + (s.overdue ? '<span class="chip overc">OVERDUE</span>' : "")
      + (k.yes_ask !== null && k.yes_ask !== undefined && k.yes_ask >= 0.9 && !(o && o.locked) ? '<span class="chip wxc">MARKET ' + cents(k.yes_ask) + (rainingNow(s) ? ', GAUGE ' + ((o || {}).in_today || 0).toFixed(2) + ', RAINING' : ', GAUGE DRY') + '</span>' : "")
      + ((t.delta_3h || 0) >= 10 ? '<span class="chip high">RISING FAST</span>' : "")
      + (s.status === "stale" ? '<span class="chip stalec">STALE</span>' : "") + "</div>";
    var wx = (s.nws_alerts || []).map(function (a) { return '<div class="wx">&#9888; ' + a.event + (a.severity ? " (" + a.severity + ")" : "") + '</div>'; }).join("");
    var price = '<div class="price"><span>Kalshi YES <b>' + cents(k.yes_ask) + '</b> ask / ' + cents(k.yes_bid) + ' bid</span><span>NWS <b>' + pct(nwsPeak(s)) + '</b> / weather.com <b>' + pct(twcPeak(s)) + '</b></span>' + gapsHTML(s) + '</div>'
      + nextMarketHTML(s);
    var v = verdict(s), ncam = camsFor(s.city).length;
    return '<div class="card"><h2>' + s.name + ' <small>' + s.icao + ' / ' + s.cli + '</small><button class="chipbtn focus" title="zoom to the gauge with the site radar">zoom in</button>' + (ncam ? '<button class="chipbtn cams" title="every live camera near the gauge">all cams (' + ncam + ')</button>' : "") + '</h2>'
      + (settle && settle.feeds && settle.feeds.synoptic && settle.feeds.synoptic.disabled ? '<div class="feeddown bad">FAST FEED DOWN: 1-minute route disabled (' + esc(settle.feeds.synoptic.disabled) + ')</div>' : "")
      + '<div class="big" style="color:' + c + '">' + headline(s) + '<small>' + (isLocked(s) ? "on the gauge, " + dayNote(s) + ", settles YES (forecast was " + pct(f.pop_peak) + ")" : windowText(s)) + '</small></div>'
      + peakStripHTML(s)
      + '<div class="verdict ' + v.cls + '">' + toMiles(v.text) + '</div>'
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
  function loadNext() { fetchJSON(dataURL("../data/next_markets.json"), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("../data/next_markets.json") : "../data/next_markets.json", 6000); }).then(function (n) { nextMarkets = (n && n.markets) || {}; if (state) render(); }).catch(function () { }); }
  function nextFor(s) { return s.next_market || nextMarkets[s.city] || null; }
  function nextMarketHTML(s) {
    var n = nextFor(s); if (!n || !n.ticker) return "";
    var day = (n.day || (n.ticker.split("-")[1] || "")).toString();
    return '<div class="price next"><span>NEXT DAY ' + day + ': YES <b>' + cents(n.yes_ask) + '</b> ask / ' + cents(n.yes_bid) + ' bid</span><span class="muted">' + (n.status || "") + '</span></div>';
  }
  function tileAgeLabel(s) {
    /* REPLACE THE HARDCODED FRESHNESS CLAIM WITH THE MEASURED ONE.

       collect_state.py writes the literal string "[site radar, 5 min]" onto every radar
       situation line. That is a CADENCE it was told to claim, not an age it measured, and the
       radar block it describes carries no timestamp at all, so nothing downstream could ever
       have checked it. On 2026-09-08 that block sat frozen on "44.4 km NW, 0% in every ring"
       while a 41 dBZ cell was 16 km south of KLAX, and the card said "5 min" the entire time.
       Colin: "ABSOLUTELY UNACCEPTABLE THAT I HAVE STALE DATA."

       collect_state.py is in the bot MONEY_FILES and cannot be edited without both outside
       seats, so the claim is rewritten here, at the page, out of the age twc_obs.py measures
       by fingerprinting the block every cycle. An unearned freshness claim is worse than none. */
    var tl = (settleFor(s.icao) || {}).tile;
    if (!tl || tl.unchanged_min === null || tl.unchanged_min === undefined) return "[site tile, age unknown]";
    var m = Math.round(tl.unchanged_min);
    if (tl.stale) return "[site tile, FROZEN " + m + " min, do not trust it]";
    return "[site tile, unchanged " + m + " min]";
  }
  function modelsFor(icao) { return models && models.stations ? models.stations[icao] : null; }
  function modelRow(s) {
    /* EVERY OTHER FORECASTER, AS A SPREAD, WITH weather.com NAMED WHEN IT IS THE ODD ONE OUT.

       Colin's order 2026-09-08 13:10 CT: make weather.com golden because it settles, but show
       the others and a rounded view, so a single source cannot quietly run the card. On this
       one afternoon the board was burned in BOTH directions by trusting one forecaster:
       NWS 26% at LAX while weather.com said 68 to 93 and it rained; then weather.com 71% at
       Chicago while ECMWF said 0, GFS 8, ICON 20, GEM 5, NWS 10, every model put 0.0 mm on the
       ground and the market sat at 13c.

       "N of 7 models put 0.01 in on the ground" is the honest headline here, because the
       contract settles on an AMOUNT. A probability is an opinion about that amount. */
    var m = modelsFor(s.icao);
    if (!m || !m.consensus || !m.consensus.n_models) return null;
    var c = m.consensus, w = twcDayPct(s), parts = [];
    if (c.median_pct !== null && c.median_pct !== undefined) {
      parts.push("median " + c.median_pct + "% (" + c.min_pct + " to " + c.max_pct + ", n=" + c.n_pct + ")");
    }
    parts.push(c.n_wet + " of " + c.n_models + " models put 0.01 in on the ground" + panelSkillText(s));
    var cls = c.n_wet >= Math.ceil(c.n_models / 2) ? "hot" : "flat";
    var flag = "";
    if (w !== null && c.median_pct !== null && Math.abs(w - c.median_pct) >= 30) {
      flag = " -- weather.com is at " + w + "%, the ODD ONE OUT by " + Math.abs(w - c.median_pct) + " points";
      cls = "hot";
    }
    var names = Object.keys(m.models || {}).map(function (k) {
      var v = m.models[k];
      return k + " " + (v.pct === null || v.pct === undefined ? (v.wet ? "wet" : "dry") : v.pct + "%");
    }).join(" · ");
    return ["models", parts.join(", ") + flag, cls, '<small>' + names + '</small>'];
  }
  function physicsFor(icao) { return physics && physics.stations ? physics.stations[icao] : null; }
  function physicsPct(s) { var p = physicsFor(s.icao); return p && p.pct !== null && p.pct !== undefined ? +p.pct : null; }
  function physicsRel(p) {
    if (p === null || p === undefined || !physics || !physics.reliability) return null;
    var r = physics.reliability[String(Math.min(90, Math.floor(p / 10) * 10))];
    return (r && r.n) ? r : null;
  }
  function physicsRow(s) {
    /* THE BOARD'S OWN NUMBER, AND HOW OFTEN IT IS RIGHT, ON THE SAME LINE.

       Colin, 2026-09-08: "THE BOARD NEEDS TO BE UPDATED WITH OUR OWN PREDICTION USING THE
       PRESSURE AND THE WIND AND ALL THAT SHIT TOO". This is it. Fitted on precipitable water,
       dewpoint, humidity, cloud, lifted index, boundary layer and the barometer, scored against
       the airport gauge that settles the contract, n=1034 station-days.

       AND ITS RELIABILITY SHIPS WITH IT. Every percentage on this board before today was a bare
       number with no way to know what it was worth, so he had to ask the desk, and the desk gave
       him four contradictory answers in one afternoon. A number that carries its own hit rate
       cannot do that to him. */
    var p = physicsPct(s);
    if (p === null || !physics) return null;
    var rel = physicsRel(p);
    var txt = p + "% chance the gauge settles YES";
    if (rel) txt += ", and out of sample when it said " + rel.lo + " to " + rel.hi + "% it settled YES "
                 + rel.actual_pct + "% of the time (n=" + rel.n + (rel.n < 20 ? ", TOO THIN TO TRUST" : "") + ")";
    else txt += ", NO measured hit rate on file for this bucket";
    // The v2 file carries n_fit_rows_train and n_fit_rows_test. The old key n_fit_rows was v1's
    // and printed "fitted on 0 station-days" under a live number.
    var nTr = physics.n_fit_rows_train || physics.n_fit_rows || 0, nTe = physics.n_fit_rows_test || 0;
    return ["board physics", txt, p >= 50 ? "hot" : "flat",
            '<small>fitted on ' + nTr + ' train / ' + nTe + ' test station-days, base rate '
            + (physics.base_rate_pct || 0) + '%</small>'];
  }
  function panelSkillText(s) {
    var mo = modelsFor(s.icao);
    if (!mo || !mo.consensus || !physics || !physics.model_panel_skill) return "";
    var k = String(mo.consensus.n_wet);
    var hit = physics.model_panel_skill[k], n = (physics.model_panel_n || {})[k];
    if (hit === undefined) return "";
    // "6 of 7 models" READS AS STRONG AND IS A COIN FLIP. Measured 55.7% at n=106. Never show
    // the count again without the number it is actually worth.
    return " -- historically settles YES " + hit + "% of the time at that count (n=" + n + ")";
  }
  function MI(km) { return (km === null || km === undefined) ? null : Math.round(+km * 0.621371); }
  function miTxt(km) { var m = MI(km); return m === null ? "?" : m + " mi"; }
  function cellsRow(s) {
    /* EVERY CELL NEAR THE GAUGE, WITH WHETHER IT IS ACTUALLY COMING. Colin, 2026-09-08 14:50 CT:
       "THIS SORT OF INFORMATION SHOULD ALREADY BE ON THE BOARD ALWAYS". He is right. A 51 dBZ
       cell 18 km away CLOSING at 30 kt and a 51 dBZ cell 18 km away SITTING STILL are opposite
       facts about whether this gauge gets wet, and the card was collapsing both into
       "nearest echo 18 km". */
    var c = ((settleFor(s.icao) || {}).radar || {}).cells;
    if (!c || !c.cells || !c.cells.length) return null;
    /* EVERY UNIT ON THIS ROW IS EXPLAINED IN THE TOOLTIP. Colin, 2026-09-08 14:53 CT, after a
       day of the desk quoting him dBZ and ring percentages in chat: "ALSO WHAT DOES ALL OF
       THIS MEAN". Fair. A number nobody can read is not information, it is decoration, and he
       had to ask a human every time. */
    /* SAY WHERE IT IS GOING AND HOW CLOSE IT COMES, IN MILES, NOT JUST "passing wide".
       Colin, 2026-09-08 16:00 CT: "THAT NEEDS TO BE ON THE BOARD UPDATED EVERY 10 MINUTES WITH
       WHAT DIRECTION ITS ACTUALLY MOVING". A 59 dBZ core is a completely different fact
       depending on whether it crosses the gauge or rides 14 km north of it, and today at Denver
       the difference between those two readings was the whole position. */
    var txt = c.cells.map(function (x) {
      var m;
      if (x.status === "stationary") m = "STATIONARY, not coming";
      else if (x.eta_min !== null && x.eta_min !== undefined)
        m = "moving " + (x.heading || "?") + ", HITS the gauge in " + x.eta_min + " min";
      else if (x.closest_km !== null && x.closest_km !== undefined)
        m = "moving " + (x.heading || "?") + ", misses by " + Math.round(x.closest_km * 0.621) + " mi";
      else m = "moving " + (x.heading || "?");
      return Math.round(x.km * 0.621) + " mi " + x.bearing + ", " + x.dbz + " dBZ, " + m;
    }).join(" · ");
    var hot = c.cells.some(function (x) { return x.eta_min !== null && x.eta_min !== undefined; });
    var legend = "dBZ is how hard it is raining inside that cell: 20 drizzle, 35 steady rain, "
               + "45 heavy and wets a gauge fast, 55 plus is a downpour. STATIONARY means the "
               + "cell is not moving, so it is not coming to you. CLOSING means it is, and the "
               + "minutes are how long until it arrives.";
    return ["cells near", txt, hot ? "hot" : "flat",
            '<small title="' + legend + '">' + c.n_within_60
            + ' within 37 mi, NEXRAD storm table. dBZ 20 drizzle / 35 steady / 45 heavy / 55 downpour.'
            + ' STATIONARY means it is not coming.</small>'];
  }
  function restOfDayRow(s) {
    /* WHAT THE SETTLEMENT SOURCE STILL EXPECTS, IN INCHES, NOT JUST PERCENT. A day that is
       "15% every remaining hour with zero forecast rainfall in all of them" is a different
       statement from "15%", and it is the one that told the desk Miami was fading. */
    var st = settleFor(s.icao), lh = s.local_hour;
    var hrs = ((st || {}).fc || {}).hours || [];
    if (!hrs.length || lh === null || lh === undefined) return null;
    var left = hrs.filter(function (h) { return +h[0] >= lh; });
    if (!left.length) return null;
    var mx = 0, qpf = 0;
    left.forEach(function (h) { if (+h[1] > mx) mx = +h[1]; qpf += (+h[2] || 0); });
    return ["rest of day", "weather.com: " + left.length + " hours left, best hour " + mx
            + "%, total forecast rainfall " + qpf.toFixed(2) + " in"
            + (qpf < 0.01 ? " (BELOW the 0.01 that settles YES)" : ""),
            qpf >= 0.01 ? "hot" : "flat"];
  }
  function remarksRow(s) {
    /* THE STATION'S OWN WORDS. A METAR remark like "CB DSNT W MOV STNRY" is the sensor saying
       there is a thunderstorm to the west and IT IS NOT COMING. "VIRGA" is it saying the rain
       is evaporating before it lands, which is why LAX read -RA all morning and the bucket
       stayed at trace. None of this was on the card and all of it is free. */
    var raw = (s.metar || {}).raw || "";
    var i = raw.indexOf("RMK");
    if (i < 0) return null;
    var rmk = raw.slice(i + 4);
    var out = [];
    var m;
    if ((m = rmk.match(/(CB|TCU)\s+DSNT\s+([A-Z\-]+)(?:\s+MOV\s+([A-Z]+))?/))) {
      out.push(m[1] + " (storm cloud) distant to the " + m[2]
               + (m[3] ? ", moving " + (m[3] === "STNRY" ? "NOWHERE, it is stationary" : m[3]) : ""));
    }
    if (/VIRGA/.test(rmk)) out.push("VIRGA: rain is evaporating before it reaches the ground");
    if ((m = rmk.match(/LTG\s+(DSNT|VC)\s+([A-Z\-]+)/))) {
      out.push("lightning " + (m[1] === "DSNT" ? "distant" : "in the vicinity") + " to the " + m[2]);
    }
    if ((m = rmk.match(/RAB(\d+)/))) out.push("rain began at :" + m[1].slice(-2));
    if ((m = rmk.match(/RAE(\d+)/))) out.push("rain ended at :" + m[1].slice(-2));
    if (!out.length) return null;
    return ["station says", out.join(" · "), /VIRGA|STNRY/.test(rmk) ? "flat" : "hot",
            '<small>from the gauge own report</small>'];
  }
  function situationLines(s) {
    /* A FROZEN SOURCE MUST NOT PRINT A COUNTDOWN. Colin, 2026-09-08 14:55 CT, reading the Miami
       card: "nearest echo 2.9 mi N, moving NE at 25 mph, ETA about 7 min [site tile, FROZEN 111
       min, do not trust it] WHAT DOES THIS MEAN".

       Both halves were true and together they were nonsense. The tile had not changed in 114
       minutes, so that "ETA about 7 min" was computed at 17:59Z and had been sitting on screen
       ever since, confidently predicting an arrival that was already two hours in the past.
       Labelling the source stale is not enough when the sentence it labels still asserts a
       countdown: the motion and the ETA come out entirely, and what is left is the reading with
       its age on it. */
    var tag = tileAgeLabel(s);
    var tl = (settleFor(s.icao) || {}).tile || {};
    return (s.situation || []).map(function (l) {
      var out = String(l).split("[site radar, 5 min]").join(tag);
      if (tl.stale && /\[site tile, FROZEN/.test(out)) return null;   // dead source, drop the line
      return out;
    }).filter(function (l) { return l; });
  }

  /* Surrounding airports, ALWAYS sorted by distance from the gauge, never wet-first.
     Colin, 2026-09-08: "i obviously dont need every market to have every sensor or
     airport i need the closest surrounding ones obviously the rest is noise", and then
     when this list still sorted wet-first: the card showed Broomfield at 24 mi above
     Front Range at 7 mi. The closest station is the one that previews the gauge, so
     distance is the only defensible order. */
  function nbSorted(s, n) {
    return (s.neighbors || []).slice().sort(function (a, b) {
      return (a.dist_km || 9999) - (b.dist_km || 9999);
    }).slice(0, n || 5);
  }
  function nbBubbles(s) {
    var list = nbSorted(s, 4);
    if (!list.length) return "";
    return '<span class="nbb">' + list.map(function (n) {
      var lp = pulseFor(n.id), raining = lp ? lp.raining : n.raining;
      return '<i class="' + (raining ? "nwet" : "ndry") + '" title="' + n.id + ' is ' + miTxt(n.dist_km)
        + ' ' + n.bearing + ' of the gauge, ' + (raining ? "RAINING now" : "dry") + '">'
        + n.id.replace(/^K/, "") + '<b>' + miTxt(n.dist_km).replace(" mi", "") + '</b></i>';
    }).join("") + '</span>';
  }
  function situationHTML(s) {
    var lines = situationLines(s), pulse = livePulse(s);
    if (pulse && pulse.raining && !(s.metar && s.metar.raining)) lines.unshift("RAINING AT THE GAUGE now (" + pulse.wx + "), reported " + (pulse.time_utc || "").slice(11, 16) + "Z (1-min feed)");
    else if (pulse && !pulse.raining && pulse.nws && pulse.nws.raining) lines.unshift("RAINING AT THE GAUGE now: the sensor's 5-minute report says " + pulse.nws.text + " at " + (pulse.nws.time_utc || "").slice(11, 16) + "Z (METAR text not updated yet)");
    var nb = nbSorted(s, 5).map(function (n) {
      var lp = pulseFor(n.id), raining = lp ? lp.raining : n.raining, wx = lp ? lp.wx : n.wx;
      return (raining ? "<b>" : "") + n.id.replace(/^K/, "") + " " + miTxt(n.dist_km) + " " + n.bearing + (raining ? " " + wx + "</b>" : " dry");
    }).join(" &middot; ");
    if (!lines.length && !nb) return "";
    return '<div class="sit"><h4>What is happening at the gauge</h4>' + lines.map(function (l) { return '<div class="' + (/^RAINING/.test(l) ? "hot" : "") + '">' + toMiles(l) + '</div>'; }).join("")
      + (nb ? '<div class="nb">nearby airports: ' + nb + '</div>' : "") + '</div>';
  }
  /* live cameras near each gauge (data/cams.json, verified entries only) */
  var cams = {};
  function loadCams() { fetchJSON(dataURL("../data/cams.json"), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("../data/cams.json") : "../data/cams.json", 6000); }).then(function (c) { cams = (c && c.cams) || {}; }).catch(function () { }); }
  /* held cameras (verified false: the box could not fetch a real frame lately, e.g. Louisiana's
     stream host down 2026-09-06/07, so the 511 site serves a "no live feed" placeholder that never
     changes) go last and carry an OFFLINE badge with their last good time (Colin, 2026-09-07 12:05 CT:
     "new orleans cameras are not updating") */
  var camHealth = null;
  function loadCamHealth() { fetchJSON(dataURL("../data/cam_health.json"), 6000).then(function (h) { camHealth = h; if (openCity) refreshOpenCard(); }).catch(function () {}); }
  function camKey(c) { return c.type === "youtube" ? "y:" + (c.id || "") : c.type === "proxy" ? "p:" + (c.frame || "") : "i:" + (c.url || ""); }
  function camFresh(c) {
    /* LIVE: frame changed within stale_after_min; STALE: unchanged longer; OFFLINE: held or erroring */
    if (c.verified === false) return { k: "off", label: "OFFLINE" };
    if (c.type === "youtube") return { k: "live", label: "LIVE STREAM" };
    var h = camHealth && camHealth.cams ? camHealth.cams[camKey(c)] : null;
    if (!h || h.stale_min === undefined || h.stale_min === null) return { k: "unk", label: "" };
    if (h.error) return { k: "off", label: "OFFLINE" };
    var lim = (camHealth && camHealth.stale_after_min) || 20;
    if (h.stale_min >= lim) return { k: "stale", label: "STALE, unchanged " + (h.stale_min >= 120 ? Math.floor(h.stale_min / 60) + " h" : h.stale_min + " m") };
    return { k: "live", label: "LIVE, changed " + (h.stale_min <= 1 ? "just now" : h.stale_min + " m ago") };
  }
  function camRank(c) { var f = camFresh(c).k; return f === "live" ? 0 : f === "unk" ? 1 : f === "stale" ? 2 : 3; }
  /* MILES, not kilometres (Colin, 2026-09-07 13:40 CT: "make everything miles not km"). The data files
     keep km; every printed distance and speed is converted at render time, and a one-second sweep
     over the page text converts anything a render path missed (collector lines, camera names). */
  function miOf(km) { var m = km * 0.621371; return m < 10 ? Math.round(m * 10) / 10 : Math.round(m); }
  function miTxt(km) { return miOf(km) + " mi"; }
  function toMiles(text) {
    return String(text)
      .replace(/(\d+(?:\.\d+)?)\s*km\/h\b/gi, function (_, n) { return Math.round(+n * 0.621371) + " mph"; })
      .replace(/(\d+(?:\.\d+)?)\s*(km|KM|Km)\b/g, function (_, n, u) { return miOf(+n) + (u === "KM" ? " MI" : " mi"); });
  }
  function milesPass(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), t, todo = [];
    while ((t = w.nextNode())) { if (/\d\s*km\b|\d\s*KM\b/.test(t.nodeValue)) todo.push(t); }
    todo.forEach(function (n) { n.nodeValue = toMiles(n.nodeValue); });
  }
  setInterval(function () { try { milesPass(document.body); } catch (e) {} }, 1000);
  function camsFor(city) { var l = (cams[city] || []).slice(); l.sort(function (a, b) { return camRank(a) - camRank(b); }); return l; }
  function camHeld(c) { return camFresh(c).k === "off" || camFresh(c).k === "stale"; }
  function freshBadge(c) { var f = camFresh(c); return f.label ? '<span class="camfresh ' + f.k + '">' + esc(f.label) + '</span>' : ""; }
  function heldBadge(c) { if (camFresh(c).k !== "off" || c.verified !== false) return freshBadge(c); var t = c.last_ok_utc ? new Date(c.last_ok_utc.length === 17 ? c.last_ok_utc.slice(0, 16) + ":00Z" : c.last_ok_utc) : null; return '<span class="camoff">OFFLINE at the source' + (t && !isNaN(t) ? ', last real frame ' + t.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : '') + '</span>'; }
  function openCams(city) {
    var list = camsFor(city), s = state.stations.filter(function (x) { return x.city === city; })[0];
    var box = $("cammodal"); box.hidden = false;
    var html = '<div class="camhead"><b>' + (s ? s.name : city) + '</b> live cameras near the gauge <button class="chipbtn" id="camclose">close</button></div>';
    if (!list.length) html += '<div class="camnone">No verified public camera near this gauge yet.</div>';
    html += '<div class="camgrid">';
    list.forEach(function (c) {
      html += '<div class="cam' + (camHeld(c) ? ' held' : '') + '"><div class="camlbl">' + esc(toMiles(c.name)) + (c.dist_km ? ' &middot; ' + esc(miTxt(c.dist_km)) + ' ' + esc(c.dir || '') : '') + ' from the gauge ' + heldBadge(c) + '</div>' + camMediaHTML(c);
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
  var camNode = { city: null, idx: 0, el: null, errs: 0, sig: "" };
  /* catalog fields come from third-party DOT feeds: escape every one before it touches innerHTML
     (codex, PR #104: a quote in a camera name broke the alt attribute, markup would have run) */
  function esc(v) { return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function camSig(list) { return list.map(function (c) { return c.type + ":" + (c.id || c.frame || c.url || ""); }).join("|"); }
  function camMediaHTML(c) {
    if (c.type === "youtube") return '<iframe src="https://www.youtube.com/embed/' + esc(c.id) + '?autoplay=1&mute=1&playsinline=1" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>';
    if (c.type === "proxy") { var fu = frameURL(c); return '<img class="camimg" referrerpolicy="no-referrer" data-src="' + esc(fu) + '" src="' + esc(fu + '?t=' + Date.now()) + '" alt="' + esc(c.name) + '">'; }
    if (c.type === "image") return '<img class="camimg" referrerpolicy="no-referrer" data-src="' + esc(c.url) + '" src="' + esc(c.url + (c.url.indexOf("?") >= 0 ? "&" : "?") + 't=' + Date.now()) + '" alt="' + esc(c.name) + '">';
    return "";
  }
  function buildCamNode(city) {
    var list = camsFor(city), el = document.createElement("div"); el.className = "camlive";
    if (list.length && camHeld(list[Math.min(camNode.city === city ? camNode.idx : 0, list.length - 1)])) el.className += " held";
    if (!list.length) { el.innerHTML = '<div class="camnone small">no verified public camera near this gauge yet</div>'; return el; }
    var i = Math.min(camNode.city === city ? camNode.idx : 0, list.length - 1), c = list[i];
    el.innerHTML = '<div class="camlbl"><b>LIVE CAM</b> nearest verified: ' + (c.dist_km ? esc(miTxt(c.dist_km)) + ' ' + esc(c.dir || '') + ' of the gauge' : '') + (list.length > 1 ? ' <button class="chipbtn camnext">next cam (' + (i + 1) + '/' + list.length + ')</button>' : '') + '<div class="camname">' + esc(c.name) + ' ' + heldBadge(c) + '</div></div>' + camMediaHTML(c);
    var nb = el.querySelector(".camnext"); if (nb) nb.onclick = function () { camNode.idx = (i + 1) % list.length; camNode.el = null; camNode.errs = 0; refreshOpenCard(); };
    /* a frame that fails to load (host down, camera offline) steps to the next camera by itself,
       at most once around the list, so the card never sits on a broken image (2026-09-06) */
    var im = el.querySelector("img.camimg");
    if (im) {
      im.onload = function () { camNode.errs = 0; };
      im.onerror = function () {
        camNode.errs = (camNode.errs || 0) + 1;
        if (list.length > 1 && camNode.errs < list.length) { camNode.idx = (i + 1) % list.length; camNode.el = null; refreshOpenCard(); }
      };
    }
    camNode.city = city; camNode.idx = i;
    return el;
  }
  function mountCam(panel, city) {
    var slot = panel.querySelector(".camslot"); if (!slot) return;
    var sig = camSig(camsFor(city));
    /* rebuild when the catalog for this city changed under an open card (codex, PR #104: a removed
       camera stayed on screen because the node was reused as long as the city matched) */
    if (!camNode.el || camNode.city !== city || camNode.sig !== sig) {
      if (!(camNode.city === city && camNode.sig === sig)) camNode.idx = 0;
      camNode.el = buildCamNode(city); camNode.city = city; camNode.sig = sig;
    }
    slot.appendChild(camNode.el);
  }
  loadCamHealth(); setInterval(loadCamHealth, 300000);
  setInterval(function () { document.querySelectorAll("img.camimg").forEach(function (im) { var u = im.dataset.src; if (u) im.src = u + (u.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now(); }); }, 60000);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCams(); });
  /* the one-minute METAR pulse (data/metars.json): fresher than the collector's 5 minutes */
  var pulse = null;
  function loadPulse() { fetchJSON(dataURL("../data/metars.json"), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("../data/metars.json") : "../data/metars.json", 6000); }).then(function (p) { pulse = p; if (state) render(); }).catch(function () { }); }
  function pulseFor(icao) { return pulse && pulse.stations ? pulse.stations[icao] : null; }
  function loadSettle() { fetchJSON(dataURL("../data/settle.json"), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("../data/settle.json") : "../data/settle.json", 6000); }).then(function (s) { settle = s; if (state) render(); }).catch(function () { }); }
  function loadModels() { fetchJSON(dataURL("../data/models.json"), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("../data/models.json") : "../data/models.json", 6000); }).then(function (s) { models = s; if (state) render(); }).catch(function () { }); }
  /* THE BOARD READS V2, NOT V1. Colin, 2026-09-08 19:45 CT: "why are your stale physics
     still on the board?"
     v1 (wx_physics.py) has NO time-of-day term. It answers "will it rain at some point
     today" and the board displayed that same number all evening as though it meant "will it
     rain in the hours that are left". On 2026-09-08 it showed Chicago 45% at 8pm against
     NWS 9% and weather.com 15%, Miami 82% against a market at 19c that settled dry, and
     71 to 80% for Houston, New Orleans and Minneapolis, three markets that had ALREADY
     rained and were trading at 100c.
     v2 multiplies by an hour-of-day decay (only 15% of rain days have their first drop
     after 6pm) and checks whether the gauge has already tipped. It falls back to v1 only if
     v2 has not been written. */
  function loadPhysics() {
    var one = function (f) { return fetchJSON(dataURL("../data/" + f), 6000).catch(function () { return fetchJSON(ON_MIRROR ? cdnURL("../data/" + f) : "../data/" + f, 6000); }); };
    one("physics_v2.json").then(function (s) { physics = s; physics._v = 2; if (state) render(); })
      .catch(function () { one("physics.json").then(function (s) { physics = s; physics._v = 1; if (state) render(); }).catch(function () { }); });
  }
  function settleFor(icao) { return settle && settle.stations ? settle.stations[icao] : null; }
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
    /* TWO OBSERVATION CLOCKS, BOTH NAMED. The card header's "ob N min ago" is the newest
       5-minute observation (observed.latest_ob_utc); this footer used to quote only the METAR,
       so the Boston card read "ob 27 min ago" above "last one 14:00Z, 52 min ago" and looked
       like it was contradicting itself (Colin, 2026-09-09). */
    var ob = s.observed && s.observed.latest_ob_utc, mo = ob ? Math.round((Date.now() - Date.parse(ob)) / 60000) : null;
    var obTxt = ob ? ' The newest 5-minute observation is ' + ob.slice(11, 16) + 'Z, ' + mo + ' min ago; that is the "ob" clock in the header.' : '';
    return '<div class="fresh"><b>Where this comes from.</b> The gauge line is the station\'s own report (aviationweather.gov METAR/SPECI): last one ' + (t ? t.slice(11, 16) + 'Z, ' + (m === null ? '' : m + ' min ago') : 'none yet') + '.' + obTxt + ' The station reports every hour at about :51-:56 and sends a SPECI within minutes when rain starts or stops; this board polls it every 60 s. Radar rings, neighbours and Kalshi prices refresh every 5 min; the forecast hourly; the model every HRRR run.</div>';
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
    chips("goverdue", sum.overdue, "overc", function (s) { return "peak " + peakHourText(s) + " " + peak(s) + "%, dry at " + hourLabel(s.local_hour); });
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
        var k = s.market || {}, first = situationLines(s)[0] || "";
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
      g.appendChild(li('<b>' + x[0] + '</b><span>Kalshi ' + cents(k.yes_ask) + ' vs peak ' + pct(peak(s)) + '</span><span class="t gap ' + gapClass(x[1]) + '">' + gapText(x[1]) + '</span>', x[0]));
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
        + ((s.situation || []).length && !isLocked(s) ? '<div class="sitl" title="' + situationLines(s).join(" | ").replace(/"/g, "") + '">' + situationLines(s)[0] + '</div>' : "");
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
  loadSettle();
  loadModels();
  loadPhysics();
  loadCams();
  loadNext();
  setInterval(loadState, 60000);
  setInterval(loadNext, 60000);
  setInterval(loadCams, 600000);
  setInterval(loadPulse, 60000);
  setInterval(loadSettle, 60000);
  setInterval(loadModels, 300000);
  setInterval(loadPhysics, 300000);
  setInterval(function () { if (mapReady) buildRadarTimeline(); }, 300000);
  setInterval(tick, 10000);
})();
