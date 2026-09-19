/* The market day has 24 real hours, including across civil daylight-time changes. */
(function (root) {
  "use strict";
  var ZONES = {KATL:"America/New_York",KAUS:"America/Chicago",KBOS:"America/New_York",KORD:"America/Chicago",KDFW:"America/Chicago",KDCA:"America/New_York",KDEN:"America/Denver",KEWR:"America/New_York",KHOU:"America/Chicago",KLAX:"America/Los_Angeles",KLAS:"America/Los_Angeles",KMIA:"America/New_York",KMSP:"America/Chicago",KMSY:"America/Chicago",KNYC:"America/New_York",KOKC:"America/Chicago",KPHL:"America/New_York",KPHX:"America/Phoenix",KSAT:"America/Chicago",KSEA:"America/Los_Angeles",KSFO:"America/Los_Angeles",KTTN:"America/New_York"};
  var formatters = {};
  function localParts(ms, zone) {
    var p = {};
    var formatter = formatters[zone] || (formatters[zone] = new Intl.DateTimeFormat("en-CA", {timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}));
    formatter.formatToParts(new Date(ms)).forEach(function(x){p[x.type]=x.value;});
    return {day:p.year+"-"+p.month+"-"+p.day,hour:+p.hour,minute:+p.minute};
  }
  // WebKit's Date.parse rejects the ISO 8601 basic offset ("-0500") that the vendor writes, where V8
  // accepts it. Widen it to "-05:00" the way ctClock() in app.js does before parsing any external stamp.
  function parseMs(x) { return x===null||x===undefined||x===""?NaN:Date.parse(String(x).replace(/([+-]\d\d)(\d\d)$/,"$1:$2")); }
  function ctHour(ms) { return localParts(ms,"America/Chicago").hour; }
  function offset(s, ms) {
    if(!ZONES[s.icao]) return null;
    ms=ms===undefined?Date.now():ms;
    var p=localParts(ms,ZONES[s.icao]);
    return (Date.parse(p.day+"T00:00:00Z")+p.hour*3600000+p.minute*60000-Math.floor(ms/60000)*60000)/60000;
  }
  function civilMs(s,h) {
    var data=build(s,{},Date.now());if(!data)return undefined;
    var rows=data.slots.filter(function(slot){return slot.hour===+h||(+h===0&&slot.hour===24);});
    return rows.length===1?rows[0].ms:null;
  }
  // HRRR rows. The collector (collect_state.hrrr_hours) writes [civil_hour, pct, valid_utc] since the
  // #133 fix round and a stamped row is dated by its stamp, exactly. Before that it wrote [civil_hour,
  // pct] only, and a record can carry those rows for the rest of a run, so the decode below stays for
  // them. A two-element row is dated from hrrr_init:
  // the run's leads are 1..18 h in order, and the label is the lead's hour on the collector's own
  // tz_offset_min (the standard offset when the NWS request failed), so the first remaining lead that
  // carries the label is the row's lead. That survives a dropped lead (a failed tile fetch is skipped,
  // not written: KORD had 17 rows with hour 4 missing on 2026-09-16), where position alone would date
  // every later row an hour early. Position is the fallback when no remaining lead carries the label.
  // The labels were written with the offset the collector had at THAT run, and the rows are carried
  // over unchanged while hrrr_init stands, so across a daylight-time change (2026-03-08, 2026-11-01)
  // the record's current offset is 60 minutes off the one that labelled them. The whole set was
  // labelled with one offset, so the choice is made once for the set, not per row, and it is made
  // from evidence, not from the shape of the set: the rows for leads 2..18 labelled at one offset
  // are the same numbers as the rows for leads 1..17 labelled at that offset plus an hour, so no
  // statistic of the set can tell "an ordinary day with the 1 h tile missing" from "a fall-back
  // night with the 18 h tile missing" (the review of d76e414 dated all 17 KORD rows an hour early
  // by preferring the decode that agreed best with row position). The evidence is what offset the
  // collector held when it labelled: the zone's civil offset if its NWS request succeeded, the
  // standard offset if not, and it labels a run within a couple of hours of that run's init. So when
  // the record's offset is the zone's civil offset now (NWS fine), the labelling offset is the zone's
  // offset at hrrr_init, which differs from the record's only across the change itself; when it is
  // not (the record is on the standard offset because NWS failed), the record's own offset is the
  // best guess, since the collector labels a fresh run with the offset it holds. The candidates in
  // that order, then the record's offset, the zone's offset at init, the standard offset, and the
  // record's offset plus and minus an hour; the first candidate that leaves the fewest rows on the
  // positional fallback wins, so on an ordinary day the current offset decides every tie. Two
  // unstamped cases stay unknowable, and they are why the collector stamps now: rows labelled on the
  // standard offset by a failing run, carried into a run where NWS recovered, with the 1 h tile
  // missing, read the same as an ordinary set with the 18 h tile missing; rows labelled on the civil
  // offset, carried into a poll where NWS failed, with the 18 h tile missing, read the same as a
  // standard-labelled set with the 1 h tile missing (codex on 9a15193). Per row the alternatives
  // nearly always match too (a label under one offset is the
  // neighbouring lead under the next), which is why a per-row preference cannot work. Returns
  // [{ms, pct}] in row order, ms NaN for a row that cannot be dated.
  // `now` is what the record is read against (build passes its own); it only decides which of the
  // two offset readings above applies.
  function hrrrRows(s, now) {
    var init=parseMs(s.hrrr_init), std=+(s.utc_offset_std||0)*60, off=s.tz_offset_min===null||s.tz_offset_min===undefined?std:+s.tz_offset_min, rows=s.hrrr_hours||[];
    now=now===undefined?Date.now():now;
    function stamped(row){return row.length>2&&row[2]!==null&&row[2]!==undefined&&row[2]!=="";}
    function hourAt(c,o){return Math.floor((((init+c*3600000+o*60000)%86400000)+86400000)%86400000/3600000);}
    function decode(o) {
      var cursor=1, leads=[], fallbacks=0;
      rows.forEach(function(row,k){
        if(!row||row.length<2||stamped(row)){leads.push(null);return;}
        var lead=null;
        for(var c=cursor;c<=18&&lead===null;c++) if(hourAt(c,o)===+row[0]) lead=c;
        if(lead===null){lead=k+1;fallbacks++;}
        cursor=lead+1;
        leads.push(lead);
      });
      return {leads:leads,fallbacks:fallbacks};
    }
    var best=null;
    if(isFinite(init)) {
      var zoneNow=offset(s,now), zoneInit=offset(s,init), guess=zoneNow!==null&&zoneNow===off?zoneInit:off, candidates=[];
      [guess,off,zoneInit,std,off+60,off-60].forEach(function(o){if(o!==null&&isFinite(o)&&candidates.indexOf(o)<0)candidates.push(o);});
      candidates.forEach(function(o){
        var d=decode(o);
        if(best===null||d.fallbacks<best.fallbacks) best=d;
      });
    }
    var out=[];
    rows.forEach(function(row,k){
      if(!row||row.length<2)return;
      var ms=NaN;
      if(stamped(row)) ms=parseMs(row[2]);
      else if(best!==null) ms=init+best.leads[k]*3600000;
      out.push({ms:ms,pct:+row[1]});
    });
    return out;
  }
  function build(s, fc, now) {
    var zone=ZONES[s.icao], day=Date.parse((s.local_day||"")+"T00:00:00Z");
    if (!zone || !isFinite(day)) return null;
    var std=+(s.utc_offset_std||0)*60, start=day-std*60000, slots=[], ambiguous=0;
    now=now===undefined?Date.now():now;
    for(var i=0;i<24;i++) {
      var ms=start+i*3600000, local=localParts(ms,zone);
      slots.push({ms:ms,hour:local.hour+(local.day>s.local_day?24:0),pop:null,source:null,qpf:null,wx:"",wet:false,hrrr:null,now:now>=ms&&now<ms+3600000});
    }
    function index(ms) {var n=Math.floor((ms-start)/3600000);return isFinite(ms)&&n>=0&&n<24?n:null;}
    // Forecast rows. A row carrying its own timestamp (weather.com column 4) is placed by it, never by
    // its label. The rest are placed by civil label: NWS and weather.com both label the final midnight
    // 24 (collect_state, twc_obs.fc_hours), so there is no 0-to-24 alias here. The fall-back night
    // repeats civil hour 1 and a source's rows are chronological, so the i-th row with a repeated label
    // takes the i-th slot when the source carries exactly one row per slot; anything else is a gap.
    function forecast(rows,source) {
      rows=rows||[];
      var byLabel={};
      rows.forEach(function(row,k){var h=+row[0];(byLabel[h]=byLabel[h]||[]).push(k);});
      rows.forEach(function(row,k){
        var n=null, p=row[1];
        if(row.length>4&&row[4]) n=index(parseMs(row[4]));
        else {
          var h=+row[0], matches=[];
          slots.forEach(function(slot,i){if(slot.hour===h)matches.push(i);});
          if(matches.length===1) n=matches[0];
          else if(matches.length>1&&byLabel[h].length===matches.length) n=matches[byLabel[h].indexOf(k)];
          else if(matches.length>1) ambiguous++;
        }
        if(n===null||p===null||p===undefined||!isFinite(+p))return;
        var slot=slots[n];
        if(slot.pop===null||+p>=slot.pop){slot.pop=+p;slot.source=source;slot.qpf=source==="weather.com"?row[2]:null;slot.wx=String(row[source==="weather.com"?3:2]||"");}
      });
    }
    // Observations use the collector's one fixed offset for the whole day (wet_hours_local in
    // collect_state.py), which writes the final midnight as 0: this is the one source that gets the
    // 0-to-24 alias, and only when the record carries no offset to place it by.
    function observedIndex(h) {
      if(s.tz_offset_min!==null&&s.tz_offset_min!==undefined) {
        var n=((h-(+s.tz_offset_min-std)/60)%24+24)%24;
        return Number.isInteger(n)?n:null;
      }
      var matches=[];
      slots.forEach(function(slot,i){if(slot.hour===h||(h===0&&slot.hour===24))matches.push(i);});
      if(matches.length>1){ambiguous++;return null;}
      return matches.length===1?matches[0]:null;
    }
    forecast((s.forecast||{}).hourly_seen,"NWS");
    forecast((s.forecast||{}).hourly,"NWS");
    if(!fc.day||fc.day===s.local_day)forecast(fc.hours,"weather.com");
    ((s.observed||{}).wet_hours||[]).forEach(function(h){var n=observedIndex(+h);if(n!==null)slots[n].wet=true;});
    var init=parseMs(s.hrrr_init), hrrrTimingUnavailable=false;
    hrrrRows(s,now).forEach(function(row){
      var lead=(row.ms-init)/3600000;
      if(!isFinite(row.ms)||!isFinite(init)){hrrrTimingUnavailable=true;return;}
      if(lead<1||lead>18||!(row.pct>0))return;
      var n=index(row.ms);if(n!==null)slots[n].hrrr=row.pct;
    });
    var current=Math.floor((now-start)/3600000);
    return {slots:slots,current:current,ambiguous:ambiguous,hrrrTimingUnavailable:hrrrTimingUnavailable,upcoming:slots.filter(function(slot,n){return n>=current&&(slot.pop>=30||slot.hrrr>0);})};
  }
  root.RainHours={build:build,offset:offset,civilMs:civilMs,hrrrRows:hrrrRows,parseMs:parseMs,ctHour:ctHour};
}(typeof window!=="undefined"?window:globalThis));
if(typeof module!=="undefined"&&module.exports)module.exports=globalThis.RainHours;
