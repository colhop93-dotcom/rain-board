/* models.js: the V2 and V3 model slots that EVERY board surface renders through.

   WHY THIS FILE EXISTS. Colin, 2026-09-14: "I want to see what BOTH models currently say for each
   of the 22 settlement gauges without opening a buried Models section." Before this file, V3 was
   fetched by the main page alone and shown only inside the expanded evidence table, as one string
   built inline; /v2 did not fetch it at all. Five surfaces each formatted the V2 number their own
   way. That is the same shape that made site/evidence.js necessary: a rule that exists five times
   is a rule that will differ, and a display rule that differs is a display rule that lies.

   WHAT A SLOT IS. One model's answer about one station, as a STATE, never as a bare number:

     current      a number this run produced for THIS contract day, inside the freshness policy
     stale        a real number whose feed, or whose row, is too old to call live
     unavailable  no usable number: the fetch failed, the row is missing, the run errored for this
                  station, the value is not a number, or it is outside 0 to 100
     withheld     the model itself declined, because rain was reported at the gauge and its
                  dry-conditioned estimate no longer applies
     superseded   an observation outranks the estimate; the number is history, not a forecast

   THE RULES THIS FILE EXISTS TO HOLD IN ONE PLACE, each one paid for somewhere in this project:

   1. A FAILURE IS NEVER ZERO. A failed fetch, a null pct, a missing row, an errored row, an
      out-of-range value, an unparseable timestamp, an unstated contract date and a wrong-day row
      are eight different kinds of "we do not know", and none of them is "0% chance of rain". They
      render as words, never as a percentage.
      THIS IS NOT HYPOTHETICAL AND THE FIRST VERSION OF THIS FILE GOT IT WRONG. codex executed the
      original num() and found `pct: []` coming out as 0%, current and live, because `+[]` is 0.
      That is a manufactured false zero in the one function that existed to prevent them. See
      probability() below; the guard now accepts rather than converts.
      The live context that made it matter: the shadow writer had ten consecutive runs producing
      "22 stations, 0 with a number" between 12:56:33Z and 15:11:33Z on 2026-09-14
      (~/colins-ideas-logs/019a_shadow.log), then a single-run failure at 15:56Z whose rows carried
      error "A socket operation was attempted to an unreachable network", then 8 of 22 at 16:26Z.
      The writer reported honestly each time. The board had no way to say so. That is WO-140.
   2. ZERO IS A VALUE. Every check here is `=== null || === undefined`, never `if (pct)`. A genuine
      modelled 0 is information and must survive to the screen.
   3. NEITHER MODEL EVER FILLS IN FOR THE OTHER. The two slots are built from two feed objects and
      never read each other. A V3 outage leaves V2 untouched, and the reverse.
   4. A NUMBER FROM ANOTHER DAY IS HISTORY. If the row's own `day` is not the station's current
      contract day it cannot be today's answer, whatever its age. It is offered as dated history
      and never under a LIVE marker.
   5. LIVE IS A MEASUREMENT, NOT A HABIT. A browser that refreshes every minute does not make an
      hour-old model newly generated, and a future timestamp is broken, not fresh.

   Depends on site/evidence.js for the contract day, which is LOCAL STANDARD (WO-132 measured it:
   90 informative station-days to 0). One definition of "today", shared by evidence and models. */
(function (root) {
  "use strict";

  var EV = root.RainEvidence;

  /* THE FRESHNESS POLICY, and where the number comes from.
     Both writers are Windows scheduled tasks repeating every 15 minutes:
       Colins019a-RainBoardPhysics  PT15M  -> wx_physics_v2.py -> data/physics_v2.json
       Colins019a-RainBoardShadow   PT15M  -> wx_physics_v3.py -> data/physics_v3.json
     Each stamps generated_utc when it FINISHES, so under healthy operation the file on disk is
     between 0 and about 15 minutes old. LIVE_MAX_MIN is one cadence plus a 5 minute grace for a
     slow run. Past that the writer has missed a turn and the page says so instead of implying the
     number is current. Measured the day this was written: the 15:56Z shadow run took over 16
     minutes and the previous file sat at 31 minutes old, which is exactly the case this marks. */
  var CADENCE_MIN = 15;
  var GRACE_MIN = 5;
  var LIVE_MAX_MIN = CADENCE_MIN + GRACE_MIN;
  /* A clock in the future is a broken clock. Two minutes absorbs ordinary skew between the box
     that writes the file and the phone that reads it; beyond that the stamp is not believed. */
  var FUTURE_TOLERANCE_MIN = 2;

  /* THE FRESHNESS DECISION, in one place, because two callers need it.
     slot() applies it when a feed is parsed; refreshAgesIn() applies it again every 30 seconds
     against the same stamp, so an open page goes stale on the clock without a refetch and without a
     full re-render. Returns null when the stamp is usable and current. */
  function stalenessOf(ageMin) {
    if (ageMin === null) {
      return { why: " carries no readable generation time, so its age cannot be checked",
               stable: " carries no readable generation time, so its age cannot be checked", undated: true };
    }
    if (ageMin < -FUTURE_TOLERANCE_MIN) {
      return { why: " is stamped " + Math.abs(ageMin)
        + " minutes in the future. A clock that far out is broken, not fresh.",
        stable: " is stamped in the future. A clock that far out is broken, not fresh.", undated: true };
    }
    if (ageMin > LIVE_MAX_MIN) {
      return { why: " last wrote " + ageTxt(ageMin) + " ago. It runs every " + CADENCE_MIN
        + " minutes, so it has missed at least one turn and this number is not current.",
        stable: " has missed at least one run. It writes every " + CADENCE_MIN
        + " minutes, so this number is not current.", undated: false };
    }
    return null;
  }

  /* Is this stamp one a sane writer could have produced right now? A file from the future is not a
     candidate for anything, least of all for becoming the incumbent that newer files are compared
     against (codex P2 on 9870563). */
  function plausibleStamp(iso, nowMs) {
    var t = EV.parseIso(str(iso));
    if (isNaN(t)) return false;
    return (nowMs - t) >= -FUTURE_TOLERANCE_MIN * 60000;
  }

  var DEFS = {
    v2: {
      key: "v2", label: "V2", file: "physics_v2.json", shadow: false,
      role: "the deployed board model. Sorting, filters and candidates are still governed by this one."
    },
    v3: {
      key: "v3", label: "V3", file: "physics_v3.json", shadow: true,
      role: "the challenger, IN SHADOW: displayed only, never traded from, building its own live record."
    }
  };

  /* NO COERCION. THE FIRST VERSION OF THIS FUNCTION USED UNARY PLUS AND CODEX BROKE IT IN FOUR WAYS.
     Reproduced against this module on 2026-09-14, every one a current, live, five minute old row:

         pct: []      ->  0%   state current, live true      <-- a MANUFACTURED FALSE ZERO
         pct: [47]    ->  47%  state current, live true
         pct: "47"    ->  47%  state current, live true      <-- an undeclared string schema
         pct: {}      ->  correctly rejected, by luck (+{} is NaN)

     `+[]` is 0 and `+[47]` is 47. So the guard that this whole file exists to provide, that a
     failure is never a zero, had a hole in the one line that was supposed to hold it. The lesson is
     the old one: a validator that converts is not a validator. This one only accepts.

     THE SUPPORTED SCHEMA IS A JSON NUMBER. Both writers emit one (`"pct": 0`, `"pct": 94`), so
     numeric strings are deliberately NOT supported; if a writer ever starts sending them, this
     rejects them loudly instead of guessing at a format nobody specified. */
  function probability(v) {
    if (typeof v !== "number") return null;     // rejects arrays, objects, booleans, strings, null
    if (!isFinite(v)) return null;              // rejects NaN and both infinities
    return v;                                   // a genuine 0 survives; it is a value, not a miss
  }

  /* An hour of the local standard day, as the writers emit it: a JSON number, whole or fractional
     (conditioned_at_hour is 10.0 today but 10.5 is a legal value the writer can produce). */
  function hourNum(v) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    if (v < 0 || v > 25) return null;           // 25 is legal: a daylight-time day has 25 hours
    return v;
  }

  function inRange(n) { return n !== null && n >= 0 && n <= 100; }

  function str(v) { return (typeof v === "string" && v) ? v : null; }

  /* A contract date the writer actually stated, in the only format the board uses. A row with no
     day, or a day that is a number rather than a string, is a row that never said which contract it
     is answering, and this module refuses to assume it meant today (codex finding 1). */
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function dayStr(v) { return (typeof v === "string" && DAY_RE.test(v)) ? v : null; }

  /* What a rejected field actually was, so the card can say why instead of just "unavailable". */
  /* Array.isArray, NOT `instanceof Array`. `instanceof` compares against THIS realm's Array, and a
     value parsed in another realm (an iframe, or the node vm context the tests run the real module
     in) is an array that fails the check. The first version of this told the test harness that `[]`
     was "an object", which is exactly the kind of quiet wrongness that only shows up when something
     crosses a boundary. */
  function describe(v) {
    if (v === null) return "null";
    if (v === undefined) return "absent";
    if (Array.isArray(v)) return "an array";
    if (typeof v === "number") return isFinite(v) ? String(v) : "not a finite number";
    if (typeof v === "object") return "an object";
    if (typeof v === "string") return v.trim() === "" ? "an empty string" : "the string " + JSON.stringify(v);
    return "a " + typeof v;
  }

  /* Age of a stamp in whole minutes, or null when it cannot be read. Negative means the future. */
  function ageMinOf(iso, nowMs) {
    var t = EV.parseIso(iso);
    if (isNaN(t)) return null;
    return Math.round((nowMs - t) / 60000);
  }

  function ageTxt(m) {
    if (m === null) return "age unknown";
    if (m < 0) return "stamped " + Math.abs(m) + " m in the FUTURE";
    if (m < 1) return "just now";
    if (m < 60) return m + " m";
    return Math.floor(m / 60) + " h " + (m % 60) + " m";
  }

  function pctTxt(v) { return (v === null || v === undefined) ? "--" : Math.round(v) + "%"; }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function blank(def, nowMs, s) {
    return {
      key: def.key, label: def.label, shadow: def.shadow, role: def.role, file: def.file,
      state: "unavailable", why: "", whyStable: null, pct: null, pDay: null, historical: null, wrongDay: false,
      undated: false,
      modelId: null, feedModelId: null, generatedUtc: null, ageMin: null, live: false,
      day: null, contractDay: EV.contractDay(s, nowMs), evidence: null, evidenceWhy: null,
      conditionedAtHour: null, featureSource: null, error: null, station: s || null
    };
  }

  /* ------------------------------------------------------------------ the state machine */

  /* One model's answer for one station.
       def   the model definition (DEFS.v2 / DEFS.v3)
       feed  the parsed feed object, or null when the fetch failed or returned nothing usable
       s     the station row from state.json
       nowMs injected clock, so a test can stand at midnight without waiting for it */
  function slot(key, feed, s, nowMs) {
    var def = DEFS[key];
    if (!def) throw new Error("unknown model key " + key);
    if (nowMs === undefined || nowMs === null) nowMs = Date.now();
    var out = blank(def, nowMs, s);

    if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
      out.why = def.label + " did not load on the last refresh (" + def.file + ")";
      return out;
    }

    out.feedModelId = str(feed.model_id);
    out.featureSource = str(feed.feature_source);
    out.generatedUtc = str(feed.generated_utc);
    out.ageMin = ageMinOf(out.generatedUtc, nowMs);

    /* IDENTITY. The shadow flag is part of the feed's declared schema, and it is the one field that
       says WHICH model this file is. If physics_v2.json were ever served at the physics_v3.json URL,
       or the reverse, every card would silently show one model twice under two labels. No model id
       is hardcoded here: the check is that the file agrees with the slot it was handed to. */
    if (def.shadow && feed.shadow !== true) {
      out.why = def.label + " loaded a file that does not declare itself a shadow model, so it is "
        + "not the challenger feed. Nothing is shown rather than labelling another model as " + def.label + ".";
      return out;
    }
    if (!def.shadow && feed.shadow === true) {
      out.why = def.label + " loaded a file that declares itself a SHADOW model, which is not the "
        + "deployed feed. Nothing is shown rather than labelling the challenger as " + def.label + ".";
      return out;
    }

    var rows = feed.stations;
    if (!rows || typeof rows !== "object" || Array.isArray(rows)) {
      out.why = def.label + " returned a file with no station rows";
      return out;
    }

    var icao = s && s.icao;
    var r = Object.prototype.hasOwnProperty.call(rows, icao) ? rows[icao] : undefined;
    if (r === null || r === undefined) {
      // A FRESH FILE WITH A MISSING ROW IS STILL UNAVAILABLE FOR THAT STATION. The feed's own
      // generated_utc says nothing about a station it never wrote.
      out.why = def.label + " ran at " + ageTxt(out.ageMin) + " old but produced no row for " + esc(icao);
      out.whyStable = def.label + " ran but produced no row for " + esc(icao);
      return out;
    }
    if (typeof r !== "object" || Array.isArray(r)) {
      out.why = def.label + " row for " + esc(icao) + " is not a record";
      return out;
    }

    out.modelId = str(r.model_id) || out.feedModelId;
    out.evidence = str(r.evidence);
    out.evidenceWhy = str(r.evidence_why);
    out.error = str(r.error);
    out.day = dayStr(r.day);
    var p = probability(r.pct);
    var pd = probability(r.p_day);
    out.conditionedAtHour = hourNum(r.conditioned_at_hour);

    /* NO STATED CONTRACT DATE. Every supported row carries `day`. A row without one, or with one
       that is not a YYYY-MM-DD string, never said which contract it is answering, and a probability
       for an unnamed day is not a probability for today. codex found that omitting `day` entirely
       left the slot `current` and `live`. */
    if (out.day === null) {
      out.why = def.label + " gave " + esc(icao) + " no contract date, so there is nothing to say "
        + "this answer is about " + out.contractDay
        + (r.day === undefined || r.day === null ? " (the row has no day field)"
                                                 : " (its day field is not a YYYY-MM-DD string)");
      return out;
    }

    /* WRONG CONTRACT DAY. A stalled writer, or a row that survived a rollover, answers a question
       about a day that is over. It is offered as dated history and never as today's number. */
    if (out.day !== out.contractDay) {
      out.state = "stale";
      out.wrongDay = true;
      if (inRange(p)) out.historical = { pct: p, day: out.day };
      out.why = def.label + " last answered for " + out.day + ", and this station's contract day is "
        + out.contractDay + ". Yesterday's answer is not today's.";
      return out;
    }

    /* A ROW THAT REPORTED AN ERROR IS NOT LIVE, EVEN IF IT STILL CARRIES A NUMBER. codex: a row
       with `pct: 47` and `error: "HTTP 429: carried previous value"` came out current and LIVE. A
       writer that says it failed has told us its number is not this run's answer, and the whole
       point of this module is that we believe the writer when it says it does not know. */
    if (out.error) {
      out.state = "unavailable";
      if (inRange(p)) out.historical = { pct: p, day: out.day };
      out.why = def.label + " reported an error for " + esc(icao) + ": " + out.error;
      return out;
    }

    /* THE MODEL WITHDREW ITS OWN NUMBER. Rain reported at the gauge ends a dry-conditioned
       estimate; the writer says so in the row and the card must not print the number anyway. */
    var unavailableWhy = str(r.model_probability_unavailable);
    if (unavailableWhy) {
      out.state = "withheld";
      if (inRange(p)) out.historical = { pct: p, day: out.day || out.contractDay };
      /* THE WRITER'S OWN SENTENCE, QUOTED AND ANCHORED. codex on cf892d4 found a relative age frozen
         in this tooltip: "the gauge observation it needs is 4 h old". That text is the WRITER's, not
         this module's, and it was true when the writer wrote it. Deleting it would throw away the
         only explanation of why the model declined. Rewriting it would put words in the writer's
         mouth. So it is quoted, and anchored to the run that produced it, which makes an age inside
         it a fact about that run rather than a claim about now. */
      out.why = def.label + ' withheld a number. As of its own run it said: "' + unavailableWhy + '"';
      out.whyStable = out.why;
      return out;
    }
    if (out.evidence === "RAIN_ONSET") {
      out.state = "withheld";
      if (inRange(p)) out.historical = { pct: p, day: out.day || out.contractDay };
      out.why = def.label + " withdrew its estimate: rain has been reported at this gauge today"
        + (out.evidenceWhy ? " (" + out.evidenceWhy + ")" : "") + ".";
      return out;
    }

    /* NO USABLE NUMBER. Each reason is said in words. None of them is zero. */
    if (p === null) {
      var _tail = (r.pct === null || r.pct === undefined ? "."
        : ": its pct field is " + describe(r.pct) + ", and the supported schema is a JSON number.");
      out.why = def.label + " produced no usable number for " + esc(icao) + " in its "
        + ageTxt(out.ageMin) + " old run" + _tail;
      out.whyStable = def.label + " produced no usable number for " + esc(icao) + " in that run" + _tail;
      return out;
    }
    if (!inRange(p)) {
      out.why = def.label + " returned " + p + ", which is not a probability between 0 and 100";
      return out;
    }

    out.pct = p;
    out.pDay = inRange(pd) ? pd : null;

    /* FRESHNESS, measured against the writer's real cadence, not against the browser's refresh.
       AN UNDATABLE RUN DOES NOT GET TO SHOW ITS NUMBER. Astra, on this candidate: out.pct was
       assigned before these branches ran, so a feed whose generated_utc was missing or malformed
       still printed its percentage, merely wearing a STALE marker. A number we cannot place in time
       is not a current forecast, and "STALE, age unknown, 47%" reads as one. The value moves to
       dated history; the row's own contract day is what dates it. A merely OLD run is different:
       it can be placed in time, so its number stays with an explicit age beside it. */
    var stale = stalenessOf(out.ageMin);
    if (stale) {
      out.state = "stale";
      out.live = false;
      out.why = def.label + stale.why;
      out.whyStable = def.label + (stale.stable || stale.why);
      if (stale.undated) {
        /* jules P3 on 143e6bb, and it is right: the row's own `day` has ALREADY been checked against
           this station's contract day by the time we get here, so the feed has explicitly said this
           forecast is for today. Deleting the number because the FILE's generation stamp is
           unreadable throws away a probability we know belongs to the current contract.
           Astra's requirement was "no LIVE claim, no false zero, and no undated number presented as
           a CURRENT forecast". A number wearing STALE and "generation time unreadable" is not being
           presented as current, so both seats are satisfied: the number stays, the claim does not. */
        out.historical = { pct: out.pct, day: out.day };
        out.undated = true;
      }
      return out;
    }

    out.state = "current";
    out.live = true;
    out.why = def.label + " wrote this run";     // the age lives in the freshness marker, nowhere else
    out.whyStable = out.why;
    return out;
  }

  /* AN OBSERVATION OUTRANKS AN ESTIMATE, and both slots say so together.
     The station keeps BOTH model entries; their numbers move to dated history so a dry forecast
     can never sit on the screen contradicting a wet gauge. `reason` is the page's own evidence
     verdict, built from site/evidence.js, and is passed in rather than recomputed here: there is
     one wetness rule in this project and it is not in this file. */
  function supersede(slots, reason) {
    return slots.map(function (sl) {
      if (!reason) return sl;
      var o = {};
      Object.keys(sl).forEach(function (k) { o[k] = sl[k]; });
      if (o.pct !== null && o.pct !== undefined) {
        o.historical = { pct: o.pct, day: o.day || o.contractDay };
      }
      o.pct = null;
      o.state = "superseded";
      o.live = false;
      o.why = o.label + " estimated before this: " + reason;
      /* codex on cf892d4: the clone kept the OLD whyStable, and stableWhy() prefers any non-null
         whyStable, so the tooltip went on saying "V2 wrote this run" instead of naming the rain
         observation that superseded it. A new state needs a new explanation in BOTH halves. */
      o.whyStable = o.why;
      return o;
    });
  }

  /* ------------------------------------------------------------------ what the number means */

  /* THE EVENT. One sentence, shared, and it is the SAME event for both models: measurable
     precipitation (0.01 in or more, the settlement threshold) at this gauge by the end of its LOCAL
     STANDARD contract day. It is not an hourly forecast, and p_day is a different quantity: the
     whole day's chance with no dry credit taken. */
  var EVENT_TEXT = "chance of 0.01 in or more at the gauge by the end of the contract day";

  /* Local standard clock time, fractional hours preserved. The writer can emit 10.5, and rounding
     that to "10:00" would credit a model with half an hour of dryness it never saw. */
  function hourClock(h) {
    var whole = Math.floor(h);
    var mins = Math.round((h - whole) * 60);
    if (mins === 60) { whole += 1; mins = 0; }
    return (whole < 10 ? "0" : "") + whole + ":" + (mins < 10 ? "0" : "") + mins;
  }

  /* EACH MODEL'S OWN CONDITIONING, never shared.
     codex and Astra both caught this: the pair printed ONE caption chosen from the first numeric
     slot and hung it under both models. With V2 conditioned through 10:00 and V3 through 09:00, the
     card told the reader that V3 had seen a dry observation an hour later than it had. The two
     writers run independently and condition independently, so the basis belongs to the slot. */
  function basisText(sl) {
    if (!sl) return "";
    if (sl.evidence === "DRY_AS_OF" && sl.conditionedAtHour !== null) {
      return "given dry through " + hourClock(sl.conditionedAtHour) + " local standard";
    }
    if (sl.evidence === "DRY_AS_OF") return "conditioned on a dry reading it could not date";
    if (sl.evidence === "UNKNOWN" || sl.evidence === null) return "no dated dry reading to condition on";
    if (sl.evidence === "LEGACY_DRY") return "written before the dated-evidence rule";
    if (sl.evidence === "WET") return "on a row the writer had already marked WET";
    return "evidence basis " + sl.evidence;
  }

  /* The full sentence for ONE model, used in tooltips, details and tests. */
  function targetText(sl) {
    if (!sl) return EVENT_TEXT;
    var b = basisText(sl);
    return b ? EVENT_TEXT + ", " + b : EVENT_TEXT;
  }

  /* The value a slot shows. A number when there IS one, and otherwise a word that says which kind
     of "we do not know" this is. Never a zero standing in for a failure. */
  function valueTxt(sl) {
    if (sl.pct !== null && sl.pct !== undefined) return pctTxt(sl.pct);
    if (sl.state === "withheld") return "withdrawn";
    if (sl.state === "superseded") return "superseded";
    if (sl.state === "stale") return sl.undated ? "run not dated" : "no number for today";
    return "unavailable";
  }

  /* The marker beside the value. LIVE appears only when THAT input met the policy above. */
  function ageChip(sl) {
    if (sl.state === "current") return "LIVE " + ageTxt(sl.ageMin);
    if (sl.state === "stale") {
      if (sl.wrongDay) return "last answered for " + sl.day;
      if (sl.undated) return "generation time unreadable";
      return "STALE " + ageTxt(sl.ageMin);
    }
    if (sl.state === "superseded") return "observed instead";
    if (sl.state === "withheld") return "by evidence";
    return "no number";
  }

  /* THE SAME FACT, SHORT ENOUGH FOR A CHIP, AND STILL VISIBLE TEXT.
     codex executed miniHTML with two feeds 95 minutes old and read `V2 91% / V3 47% SHADOW`: the
     staleness existed only in a title attribute and a CSS class. A phone cannot hover and colour is
     not a label, so a compact slot now carries its state in words too. Whenever a NUMBER is shown
     the marker carries the age with it, because a number is the only case where the value text does
     not already say the state. */
  function ageChipShort(sl) {
    if (sl.state === "current") return "LIVE " + shortAge(sl.ageMin);
    if (sl.state === "stale" && sl.pct !== null) return "STALE " + shortAge(sl.ageMin);
    return "";                 // valueTxt already reads "unavailable", "withdrawn", "superseded"
  }

  function shortAge(m) {
    if (m === null) return "age?";
    if (m < 0) return "future";
    if (m < 1) return "now";
    if (m < 60) return m + "m";
    return Math.floor(m / 60) + "h" + (m % 60) + "m";
  }

  function tip(sl) { var b = tipBase(sl); return b + (b ? " \u00b7 " : "") + ageChip(sl); }

  /* everything in the tooltip EXCEPT the freshness sentence, which changes on the clock */
  /* THE STABLE HALF OF THE TOOLTIP, and it is BUILT rather than recovered.

     Astra P3 on 3831699: the base is frozen into data-mdl-tip while only the trailing freshness
     sentence is rewritten on the clock, so any relative age inside `why` drifted against the live
     marker all day ("wrote this 5 m ago ... STALE 1 h 5 m").

     jules P2 on 69b7cfb: the first fix was a regex over the finished sentence and was wrong in both
     directions. It SWALLOWED whole explanations, because a match dropped the entire string and took
     "It runs every 15 minutes, so it has missed at least one turn" with it, which is the most useful
     sentence in the tooltip. And it MISSED "ran at 12 m old but produced no row", because it
     required the word "ago".

     The sentence is built in this module, so its stable twin is built at the same moment by the code
     that knows which part is the age. No regex, nothing guessed, nothing swallowed. */
  function stableWhy(sl) {
    if (sl.whyStable !== null && sl.whyStable !== undefined) return sl.whyStable;
    return sl.why || "";
  }

  function tipBase(sl) {
    var bits = [sl.label + ": " + sl.role, stableWhy(sl)];
    if (sl.historical) bits.push("last number: " + pctTxt(sl.historical.pct) + " for " + sl.historical.day + " (history, not today's call)");
    if (sl.pct !== null) bits.push(targetText(sl));
    if (sl.pct === null && sl.historical) bits.push("that number is history, not this run's answer");
    if (sl.pct === 0) bits.push("a rounded 0% is the model's lowest bucket, not a guarantee of a dry day");
    if (sl.pDay !== null && sl.pct !== null && sl.pDay !== sl.pct) bits.push("whole day, with no dry credit: " + pctTxt(sl.pDay));
    if (sl.modelId) bits.push("fit " + sl.modelId);
    if (sl.generatedUtc) bits.push("written " + sl.generatedUtc + " UTC");
    if (sl.featureSource) bits.push("inputs: " + sl.featureSource);
    return bits.filter(Boolean).join(" · ");
  }

  /* ------------------------------------------------------------------ rendering */

  /* One slot. Labels carry the meaning; colour only repeats it. */
  /* What refreshAgesIn() needs, and nothing else: the stamp this slot was dated by, the state it
     was rendered in, and whether it is a wrong-day row (which never ages into anything). */
  function stamp(sl) {
    return ' data-mdl-gen="' + esc(sl.generatedUtc || "") + '"'
      + ' data-mdl-state="' + esc(sl.state) + '"'
      + ' data-mdl-day="' + esc(sl.day || "") + '"'
      + ' data-mdl-off="' + esc(String(EV.stdOffMin(sl.station || null))) + '"'
      + ' data-mdl-tip="' + esc(tipBase(sl)) + '"'
      + (sl.wrongDay ? ' data-mdl-wrongday="1"' : '');
  }

  function slotHTML(sl) {
    var cls = "mdl mdl-" + sl.key + " st-" + sl.state + (sl.shadow ? " mdl-shadow" : "");
    var val = valueTxt(sl);
    var numeric = sl.pct !== null && sl.pct !== undefined;
    var basis = numeric ? basisText(sl) : "";
    return '<span class="' + cls + '"' + stamp(sl) + ' title="' + esc(tip(sl)) + '">'
      + '<b class="mk">' + esc(sl.label) + '</b>'
      + '<b class="mv' + (numeric ? ' num' : ' word') + '">' + esc(val) + '</b>'
      + (sl.shadow ? '<i class="mtag">SHADOW</i>' : '')
      + '<small class="mage ' + (sl.live ? 'live' : 'stale') + '">' + esc(ageChip(sl)) + '</small>'
      // EACH MODEL'S OWN conditioning, under its own number. Never one caption for both.
      + (basis ? '<small class="mbasis">' + esc(basis) + '</small>' : '')
      + '</span>';
  }

  /* BOTH models, side by side, with no accordion and no hover needed to read either number.
     opts.target  false to leave the shared event line off a tight surface (the map popup) */
  function pairHTML(slots, opts) {
    opts = opts || {};
    var read = readout(slots);
    var tgt = "";
    if (opts.target !== false) {
      // ONE NEUTRAL EVENT, shared because it genuinely is shared. Each model's own conditioning
      // basis is printed inside its own slot by slotHTML, because that part is NOT shared.
      tgt = '<small class="mtarget">' + esc(EVENT_TEXT) + '</small>';
    }
    return '<div class="mdlpair" role="group" aria-label="Model probabilities. ' + esc(read) + '">'
      + slots.map(slotHTML).join("")
      + tgt
      + '</div>';
  }

  /* The COMPACT pair, for a surface a few characters wide: a summary chip or a timeline row. Both
     numbers appear, both are labelled, V3 still says SHADOW, and each slot still carries its state
     and age AS VISIBLE TEXT. What drops is the shared event line and the conditioning basis, which
     the full pair on the station card carries. */
  function miniHTML(slots) {
    return '<span class="mdlmini">' + slots.map(function (sl) {
      var age = ageChipShort(sl);
      return '<b class="mm mm-' + sl.key + ' st-' + sl.state + (sl.shadow ? ' mdl-shadow' : '') + '"' + stamp(sl) + ' data-mdl-label="' + esc(sl.label) + '" title="' + esc(tip(sl)) + '">'
        + esc(sl.label) + '&nbsp;' + esc(valueTxt(sl))
        + (sl.shadow ? '<i class="mtag">SHADOW</i>' : '')
        + (age ? '<i class="mmage ' + (sl.live ? 'live' : 'stale') + '">' + esc(age) + '</i>' : '')
        + '</b>';
    }).join('<i class="msep">/</i>') + '</span>';
  }

  /* The same thing in plain words, for a title attribute, an aria-label or a test assertion. */
  function readout(slots) {
    return slots.map(function (sl) {
      return sl.label + (sl.shadow ? " (shadow)" : "") + " " + valueTxt(sl) + ", " + ageChip(sl);
    }).join("; ");
  }

  /* The accessible detail rows: identity and every distinct time fact, kept out of the compact
     card but never out of reach. Feed generation time, forecast input age and observation age are
     three different facts and are never merged into one "updated" line. */
  function detailRows(sl, s) {
    var rows = [
      ["model", sl.label + (sl.shadow ? " (SHADOW, display only)" : " (deployed)")],
      ["station", (s && s.icao) || "?"],
      ["contract day", sl.contractDay + " local standard"],
      ["status", sl.why || sl.state],
      ["fit", sl.modelId || "unknown"],
      ["feed written", (sl.generatedUtc || "unknown") + (sl.ageMin === null ? "" : " (" + ageTxt(sl.ageMin) + " ago)")]
    ];
    if (sl.day) rows.push(["row's own day", sl.day]);
    if (sl.evidence) rows.push(["evidence basis", sl.evidence + (sl.evidenceWhy ? ": " + sl.evidenceWhy : "")]);
    // codex P2 4008345716: this printed "10.5:00 local standard" while the card beside it said
    // 10:30, so the expanded evidence contradicted the model card about its own conditioning.
    if (sl.conditionedAtHour !== null) rows.push(["conditioned at", hourClock(sl.conditionedAtHour) + " local standard"]);
    if (sl.pct !== null) rows.push(["target", targetText(sl)]);
    if (sl.pDay !== null) rows.push(["whole day, no dry credit", pctTxt(sl.pDay)]);
    if (sl.featureSource) rows.push(["forecast inputs", sl.featureSource]);
    if (sl.historical) rows.push(["last number (history)", pctTxt(sl.historical.pct) + " for " + sl.historical.day]);
    if (sl.error) rows.push(["writer error", sl.error]);
    return rows;
  }

  function detailHTML(slots, s) {
    return slots.map(function (sl) {
      return '<div class="mdldetail">' + detailRows(sl, s).map(function (r) {
        return '<span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span>';
      }).join("") + '</div>';
    }).join("");
  }

  /* A LATE RESPONSE IS OLDER THAN WHAT IS ALREADY ON SCREEN, AND A SEQUENCE NUMBER DOES NOT KNOW
     THAT. The pages already refuse an out-of-order RESPONSE by request sequence; this refuses an
     out-of-order FILE by the writer's own generated_utc, which is the fact that actually matters.
     Anything unparseable on either side falls through to the new value: this guard exists to stop a
     backwards step, not to pin the board to a file it can no longer date. */
  function newerFeed(prev, next, nowMs) {
    if (nowMs === undefined || nowMs === null) nowMs = Date.now();
    if (!prev || typeof prev !== "object") return next;
    if (!next || typeof next !== "object") return next;
    /* A FILE FROM THE FUTURE NEVER GETS TO BE THE INCUMBENT. codex P2 on 9870563, reproduced: one
       response stamped 2026-09-15T16:00Z became prev, and from then on every healthy 2026-09-14
       file compared older and was rejected, so the page stayed pinned to the broken file and showed
       every model stale for as long as the tab stayed open. It could not recover without a reload.
       The tolerance is the SAME one the display contract uses, so there is one definition of "a
       clock that far out is broken". */
    var prevOk = plausibleStamp(prev.generated_utc, nowMs);
    var nextOk = plausibleStamp(next.generated_utc, nowMs);
    /* codex P2 4008345665: the first version of this checked PREV and not NEXT, and the round 3
       test only exercised newerFeed(future, healthy). In the other direction a healthy incumbent
       followed by a response stamped far in the future sorts AFTER it and wins, so every healthy
       model value on the board is replaced by the run that slot() is about to reject. Both sides
       are checked now: an implausible file never becomes the incumbent from either direction. */
    if (!nextOk && prevOk) return prev;          // keep the good one we already have
    if (!prevOk) return next;                    // a broken incumbent never blocks anything
    var a = EV.parseIso(str(prev.generated_utc));
    var b = EV.parseIso(str(next.generated_utc));
    if (isNaN(a) || isNaN(b)) return next;
    return b < a ? prev : next;
  }

  /* UPDATE THE AGES WITHOUT REBUILDING THE PAGE.
     codex P2 on 9870563: the 30 second freshness timer called the full render(), and renderQueue()
     unconditionally replaces #live-queue, so a state explanation the reader had tapped open
     vanished, and renderScorecard() recreated its <details> elements, closing a source table
     mid-read. Freshness is a property of a few text nodes; rebuilding the document to update them
     takes the reader's place away every thirty seconds.

     Each rendered slot carries its own generated_utc in data-gen, so this recomputes the age from
     the SAME stamp and the SAME rule slot() used, touches only the age node, and flips the state
     class when a slot crosses the cutoff while the page sits open. Returns how many it changed. */
  function refreshAgesIn(root_, nowMs) {
    if (nowMs === undefined || nowMs === null) nowMs = Date.now();
    var n = 0;
    var els = (root_ || document).querySelectorAll("[data-mdl-gen]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var was = el.getAttribute("data-mdl-state");
      /* THIS FUNCTION MAY ONLY EVER DOWNGRADE. codex P2 4008345670: a run rendered STALE because it
         was stamped in the future had its percentage moved to history and its value replaced by
         "run not dated"; once the clock caught up, an upgrade here flipped the element to
         st-current WITHOUT restoring the number, producing a current slot reading "run not dated"
         beside "LIVE 1 m", and in the compact form there was no age node to update at all. Going
         stale is a fact this function can establish from the clock alone. Going current is not: it
         needs the value back, which needs a real render. So a slot that has gone stale stays stale
         until a successful refresh rebuilds it. */
      /* Astra P2 on 143e6bb: the first version of the no-upgrade rule SKIPPED every non-current
         slot, so a slot that crossed the cutoff showed "STALE 21 m" and still said "STALE 21 m" an
         hour later, and a slot rendered stale at load never moved at all. Refusing to upgrade and
         refusing to count are two different things. A stale numeric slot keeps ageing; what it may
         never do is go back to current, because that needs its value restored and only a real
         render can do that. */
      /* ASTRA P2 ON 69b7cfb: THE CONTRACT BOUNDARY BINDS EVERY STATE, not just the ones that age.
         This skipped superseded and withheld slots before the day was ever checked, so a tab open
         across local standard midnight with refreshes failing went on letting YESTERDAY's rain
         withdraw the NEW contract's estimates, with a tooltip still claiming rain fell "today",
         while a fresh render says "no number for today". A withdrawal is a fact about a contract
         day, and it expires with that day like everything else. */
      var dayA = el.getAttribute("data-mdl-day");
      var offB = el.getAttribute("data-mdl-off");
      var rolled = dayA && offB !== null && offB !== "" && EV.ymdUTC(nowMs + (+offB) * 60000) !== dayA;
      if (rolled && el.getAttribute("data-mdl-wrongday") !== "1") {
        el.classList.remove("st-" + was);
        el.classList.add("st-stale");
        el.setAttribute("data-mdl-state", "stale");
        el.setAttribute("data-mdl-wrongday", "1");
        /* codex on cf892d4: miniHTML puts the value as DIRECT TEXT inside .mm with no .mv child,
           so this lookup did nothing on a compact slot: it gained NOT TODAY and went on visibly
           saying "superseded" or "withdrawn" from YESTERDAY's rain. Both forms are rewritten. */
        var mv = el.querySelector(".mv");
        if (mv) { mv.textContent = "no number for today"; mv.className = "mv word"; }
        else if (el.classList.contains("mm")) {
          var keep = [];
          for (var q = 0; q < el.childNodes.length; q++) {
            if (el.childNodes[q].nodeType !== 3) keep.push(el.childNodes[q]);
          }
          el.textContent = "";
          el.appendChild(document.createTextNode((el.getAttribute("data-mdl-label") || "") + " no number for today"));
          for (var q2 = 0; q2 < keep.length; q2++) el.appendChild(keep[q2]);
        }
        setAge(el, "last answered for " + dayA, "NOT TODAY", false);
        n++;
        continue;
      }
      if (was !== "current" && was !== "stale") continue;
      if (el.getAttribute("data-mdl-wrongday") === "1") continue;
      var age = ageMinOf(el.getAttribute("data-mdl-gen"), nowMs);
      var stale = stalenessOf(age);
      /* THE CONTRACT DAY DOES NOT DEPEND ON FRESHNESS, so it is checked first and alone.
         codex P2 4008345731 put this check in; ASTRA P2 ON 3831699 found it only ran when
         the slot was OTHERWISE FRESH, so a feed already past the cutoff at midnight went
         on reading "91% / STALE 40 m" into the NEXT contract without ever saying which day
         it answered, while a full slot() call returns "no number for today". */
      if (was === "stale" && !stale) {
        // it would be current again, but the value is not here to restore: keep it stale and keep
        // its age honest by counting from the stamp it actually carries
        setAge(el, "STALE " + ageTxt(age), "STALE " + shortAge(age), false) && n++;
        continue;
      }
      if (!stale) {
        // still current: only the age text moves
        setAge(el, "LIVE " + ageTxt(age), "LIVE " + shortAge(age), true) && n++;
        continue;
      }
      el.classList.remove("st-current");
      el.classList.add("st-stale");
      el.setAttribute("data-mdl-state", "stale");
      n++;
      var txt = stale.rolled ? "last answered for " + stale.rolled
        : stale.undated ? "generation time unreadable" : "STALE " + ageTxt(age);
      var short_ = stale.rolled ? "NOT TODAY"
        : stale.undated ? "" : "STALE " + shortAge(age);
      if (stale.rolled) el.setAttribute("data-mdl-wrongday", "1");
      setAge(el, txt, short_, false);
      n++;
    }
    return n;
  }

  /* codex P2 4008345673: the visible marker was updated and the TITLE was not, so a tooltip went on
     saying "V2 wrote this 5 m ago" beside a visible STALE marker for the whole outage, and the
     pair's aria-label kept its original readout, which is what a screen reader gets. The freshness
     sentence in both is rewritten with the visible one. */
  function setAge(el, txt, short_, live) {
    var changed = false;
    var full = el.querySelector(".mage"), mini = el.querySelector(".mmage");
    if (full && full.textContent !== txt) {
      full.textContent = txt;
      full.className = "mage " + (live ? "live" : "stale");
      changed = true;
    }
    if (mini) {
      if (mini.textContent !== short_) {
        mini.textContent = short_;
        mini.className = "mmage " + (live ? "live" : "stale");
        changed = true;
      }
    } else if (short_ && el.classList.contains("mm")) {
      // the compact form renders no age node at all when the slot had none to show; add one now
      var i2 = document.createElement("i");
      i2.className = "mmage " + (live ? "live" : "stale");
      i2.textContent = short_;
      el.appendChild(i2);
      changed = true;
    }
    var base = el.getAttribute("data-mdl-tip");
    if (base !== null) el.setAttribute("title", base + (base ? " \u00b7 " : "") + txt);
    var pair = el.closest ? el.closest(".mdlpair") : null;
    if (pair) {
      var read = [];
      pair.querySelectorAll(".mdl").forEach(function (m) {
        var k = m.querySelector(".mk"), v = m.querySelector(".mv"), a = m.querySelector(".mage");
        read.push((k ? k.textContent : "") + " " + (v ? v.textContent : "")
          + (m.classList.contains("mdl-shadow") ? " shadow" : "") + ", " + (a ? a.textContent : ""));
      });
      pair.setAttribute("aria-label", "Model probabilities. " + read.join("; "));
    }
    return changed;
  }

  root.RainModels = {
    DEFS: DEFS,
    CADENCE_MIN: CADENCE_MIN,
    LIVE_MAX_MIN: LIVE_MAX_MIN,
    FUTURE_TOLERANCE_MIN: FUTURE_TOLERANCE_MIN,
    probability: probability,
    hourNum: hourNum,
    dayStr: dayStr,
    describe: describe,
    inRange: inRange,
    EVENT_TEXT: EVENT_TEXT,
    basisText: basisText,
    hourClock: hourClock,
    ageChipShort: ageChipShort,
    shortAge: shortAge,
    ageMinOf: ageMinOf,
    ageTxt: ageTxt,
    pctTxt: pctTxt,
    slot: slot,
    supersede: supersede,
    targetText: targetText,
    valueTxt: valueTxt,
    ageChip: ageChip,
    tip: tip,
    tipBase: tipBase,
    setAge: setAge,
    slotHTML: slotHTML,
    pairHTML: pairHTML,
    miniHTML: miniHTML,
    readout: readout,
    detailRows: detailRows,
    detailHTML: detailHTML,
    newerFeed: newerFeed,
    plausibleStamp: plausibleStamp,
    stalenessOf: stalenessOf,
    refreshAgesIn: refreshAgesIn
  };
}(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this)));

if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).RainModels;
}
