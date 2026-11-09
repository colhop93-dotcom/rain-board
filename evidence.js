/* evidence.js: the rain-evidence decisions BOTH board pages share. Loaded by site/index.html and
   site/v2/index.html so there is exactly one copy of each rule.

   WHY THIS FILE EXISTS. site/app.js and site/v2/app.js each grew their own copy of "is this gauge
   locked", "is this estimate withdrawn", "is this report on today's contract day". Five times on
   PR #130 the two pages disagreed, and three of those hid a station that had actually SETTLED YES.
   Every fix was applied to one page and then found missing from the other a round later. A rule
   that exists twice is a rule that will differ.

   AND THE DATING BUG THAT FORCED IT. codex on d4043a4: collect_state.stale_copy() keeps the
   previous row's observed.locked and observed.in_today when a station refresh fails. Across local
   standard midnight the browser's contract day advances while that observed block does not, and
   isLocked() accepted it undated. Yesterday's accumulation was then classified as today's
   ALREADY WET and the new contract was labelled settled YES. The pulse lock had been dated since
   WO-133; the observed block never was.

   THE RULE: a reading is confirmation only if it is dated INTO the contract day it is confirming.
   An undated reading is UNKNOWN, and unknown is not wet and not dry. */
(function (root) {
  "use strict";

  function ymdUTC(ms) {
    var d = new Date(ms);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }

  /* minutes to add to UTC to get the station's LOCAL STANDARD clock, which is the clock the
     contract day is keyed to (WO-132 measured this: 90 informative station days to 0). */
  function stdOffMin(s) {
    if (s && s.utc_offset_std !== null && s.utc_offset_std !== undefined) return +s.utc_offset_std * 60;
    if (s && s.tz_offset_min !== null && s.tz_offset_min !== undefined) return +s.tz_offset_min;
    return 0;
  }

  function parseIso(iso) {
    if (!iso) return NaN;
    return Date.parse(String(iso).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  }

  function contractDay(s, nowMs) {
    var now = (nowMs === undefined || nowMs === null) ? Date.now() : nowMs;
    if (s && s.utc_offset_std !== null && s.utc_offset_std !== undefined) {
      return ymdUTC(now + stdOffMin(s) * 60000);
    }
    return (s && s.local_day) || ymdUTC(now + stdOffMin(s) * 60000);
  }

  /* Is this timestamp inside the station's CURRENT contract day? An absent or unparseable time is
     false: it is not evidence about today, and pretending otherwise is how yesterday's rain got
     published as today's settlement. */
  function onContractDay(s, iso, nowMs) {
    var t = parseIso(iso);
    if (isNaN(t)) return false;
    if (t > (nowMs === undefined || nowMs === null ? Date.now() : nowMs)) return false;
    return ymdUTC(t + stdOffMin(s) * 60000) === contractDay(s, nowMs);
  }

  /* The 1-minute pulse lock, counted only on its own contract day. */
  function pulseLock(s, pulse, nowMs) {
    var l = pulse && pulse.lock;
    if (!(l && l["in"] !== null && l["in"] !== undefined && +l["in"] >= 0.01)) return null;
    if (!onContractDay(s, l.time_utc, nowMs)) return null;
    return +l["in"];
  }

  /* The collector's own total, counted only when the observation it came from is DATED into this
     contract day. stale_copy() carries a failed station's previous row forward, so an undated or
     yesterday-dated observed block is not today's evidence. */
  /* The time that DATES this reading. A fast lock built from an airport report carries its own
     lock_utc and can have no observation timestamp at all, because precipitation observations were
     unavailable; dating it by the missing observation threw a genuine confirmation away
     (Astra on b2006de). Either timestamp will do, and the newest one that belongs to today wins. */
  function observedStamp(s) {
    var o = s && s.observed;
    if (!o) return null;
    return o.lock_utc || o.latest_ob_utc || null;
  }

  function observedIn(s, nowMs) {
    var o = s && s.observed;
    if (!o || o.in_today === null || o.in_today === undefined) return null;
    if (!onContractDay(s, observedStamp(s), nowMs)) return null;
    return +o.in_today;
  }

  /* Inches at the gauge today from EITHER dated route, or null for "no reading belongs to today". */
  function gaugeInches(s, pulse, nowMs) {
    var a = observedIn(s, nowMs), b = pulseLock(s, pulse, nowMs);
    if (a === null) return b;
    if (b === null) return a;
    return Math.max(a, b);
  }

  /* CONFIRMED measurable precipitation on this contract day: the one fact that outranks a
     withdrawal, because it is a later fact than the onset that preceded it.
     observed.locked counts only when its observation is dated into today, for the same reason. */
  function lockedOnDay(s, pulse, nowMs) {
    var o = s && s.observed;
    if (o && o.locked && onContractDay(s, observedStamp(s), nowMs)) return true;
    return (gaugeInches(s, pulse, nowMs) || 0) >= 0.01;
  }

  /* Was a reading carried forward from a failed refresh, so the page can SAY so rather than
     silently treating it as current? */
  function observedIsStale(s, nowMs) {
    var o = s && s.observed;
    if (!o) return false;
    if (o.in_today === null || o.in_today === undefined) return false;
    return !onContractDay(s, observedStamp(s), nowMs);
  }

  /* ---------------- THE ONE ONSET READER FOR THE BROWSER ----------------

     WHY IT IS HERE AND NOT IN A PAGE. WO-139 grew THREE of these, one per route, in three rounds:
     onsetInfo on the main board, v3DatedOnset on /v2, datedOnsetC on classic. That is the exact
     disease this file was created to cure, and it grew back while curing something else.

     AND A TIMESTAMP ALONE IS NOT PROVENANCE. The browser copies checked that a time parsed and fell
     on the contract day. The server's reader, build/v2_core.same_day_onset, checks something the
     browser did not: THE ROW'S OWN `day` FIELD. A physics row carries the contract day it was
     computed for, and a row left over from yesterday can still hold yesterday's onset_first_utc
     with a time that parses perfectly well. Dating the TIME is not the same as establishing that
     THIS ROW is about THIS contract. Four things have to line up before a report is evidence:

       1. THE GAUGE      the row is the one filed under this station's icao, chosen by the caller
       2. THE CONTRACT    the row's own `day` equals this station's LOCAL STANDARD contract day
       3. THE OBSERVATION a readable time, not in the future, falling on that same contract day
       4. THE SOURCE      a named memory that held it, so the card can say where it came from

     An unlabelled onset is refused. "Rain was reported" with no answer to "by what" is not a fact a
     reader can weigh, and it is not a fact that should be allowed to withdraw a model's number.

     Precedence mirrors the server: the caller passes sources in order, minute path first, because
     the minute path sees reports that arrive and vanish between two physics runs.

     THIS READS OBSERVATION FIELDS ONLY. It never touches pct, p_day or any model output, so a
     shadow model's PROBABILITY can never influence the deployed model's display. What crosses
     between them is an observation the shadow writer happened to record, never a forecast. */
  var ONSET_FUTURE_MS = 5 * 60000;   // the same tolerance every direct observation on these pages gets

  /* A REPORT, ONCE MADE, IS A FACT ABOUT THE DAY.

     Astra P1 on 143e6bb: when the v3 shadow writer alone retained today's onset and its next fetch
     failed, newerFeed(physics3, null) returned null, which is right for a PROBABILITY (a model
     estimate that cannot be refetched is not evidence about anything) and wrong for an OBSERVATION.
     The onset went with it, sharedOnset returned null, and the pre-rain V2 estimate came back as
     LIVE on a gauge where rain had been reported. Reproduced by aborting physics_v3.json alone
     after both slots showed superseded.

     This is the WO-137 class again, in a new place: an I/O failure turned into positive evidence
     that no rain had been reported. A dated onset is remembered per station per CONTRACT DAY, so it
     survives any later fetch failure and expires by itself at the day boundary, because the key
     stops matching. Nothing else is remembered: the memory holds observations, never probabilities,
     and a later day simply never reads the earlier day's entry. */
  var onsetMemory = {};

  function rememberOnset(s, on, nowMs) {
    var day = contractDay(s, nowMs);
    var key = ((s && s.icao) || "?") + "|" + day;
    if (on) { onsetMemory[key] = on; return on; }
    var held = onsetMemory[key];
    return held && held.day === day ? held : null;
  }

  function forgetOnsets() { onsetMemory = {}; }      // for tests; production never calls this

  function datedOnset(s, sources, nowMs) {
    var now = (nowMs === undefined || nowMs === null) ? Date.now() : nowMs;
    var day = contractDay(s, nowMs);
    for (var i = 0; i < (sources || []).length; i++) {
      var src = sources[i];
      if (!src || !src.label) continue;                       // 4. an unnamed source is not evidence
      var r = src.row;
      if (!r || typeof r !== "object") continue;
      if (typeof r.day !== "string" || r.day !== day) continue;   // 2. the row's OWN contract day
      var iso = r.onset_first_utc || r.first_utc;
      if (typeof iso !== "string" || !iso) continue;
      var t = parseIso(iso);
      if (isNaN(t) || t > now + ONSET_FUTURE_MS) continue;         // 3. readable, and not the future
      if (!onContractDay(s, iso, nowMs)) continue;                 // 3. on THIS contract day
      return rememberOnset(s, {
        ms: t, iso: iso, day: day, source: src.label,
        detail: (typeof r.detail === "string" && r.detail) || (typeof r.amount === "string" && r.amount) || null,
        /* THE RAW REPORT BELONGS TO THE ROW THAT PRODUCED IT. Astra P2 on 69b7cfb: the main board
           attached the V2 writer's raw METAR to an onset the V3 writer had supplied, so a 15:58Z
           onset printed a 14:51Z CLEAR SKY report beneath a rain-detected headline. It travels with
           the selected source or it is absent. It is never borrowed. */
        raw: (typeof r.gauge_ob_used_raw === "string" && r.gauge_ob_used_raw)
             || (typeof r.raw === "string" && r.raw) || ""
      }, nowMs);
    }
    // nothing in the sources right now: a report already made today still stands
    return rememberOnset(s, null, nowMs);
  }

  /* The sentence a card shows, naming the source, because "rain was reported" without a source is
     not something a reader can check. An onset is rain REPORTED: never measurable accumulation and
     never a settlement. */
  function onsetText(on) {
    if (!on) return "";
    return "rain reported at this gauge today by " + on.source
      + (on.detail ? " (" + on.detail + ")" : "")
      + "; measurable accumulation not yet confirmed";
  }

  root.RainEvidence = {
    ONSET_FUTURE_MS: ONSET_FUTURE_MS,
    datedOnset: datedOnset,
    rememberOnset: rememberOnset,
    forgetOnsets: forgetOnsets,
    onsetText: onsetText,
    ymdUTC: ymdUTC,
    stdOffMin: stdOffMin,
    parseIso: parseIso,
    contractDay: contractDay,
    onContractDay: onContractDay,
    pulseLock: pulseLock,
    observedStamp: observedStamp,
    observedIn: observedIn,
    gaugeInches: gaugeInches,
    lockedOnDay: lockedOnDay,
    observedIsStale: observedIsStale
  };
}(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this)));

if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).RainEvidence;
}
