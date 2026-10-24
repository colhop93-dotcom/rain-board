/* Experimental weather context, refreshed by the existing board load cycle. */
(function(root) {
  "use strict";
  var names = ["rain_history", "forecast_history", "forecast_skill", "pysteps", "storm_context"], feeds = {}, failures = {};
  var schemas = ["rain-board.history/1", "rain-board.forecast-history/1", "rain-board.skill/1", "rain-board.pysteps/1", "rain-board.storm-context/1"];
  function finite(x) { return typeof x === "number" && Number.isFinite(x); }
  function time(x) { return typeof x === "string" && /(Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : NaN; }
  function accept(old, next, schema, now) {
    now = now === undefined ? Date.now() : now;
    if (!next || next.schema !== schema || next.synthetic !== false || next.actionable !== false ||
        !/^[a-f0-9]{24}$/.test(next.run_id || "") || !Number.isFinite(time(next.generated_utc)) || time(next.generated_utc) > now) return old;
    if (old && time(old.generated_utc) <= now && (time(next.generated_utc) < time(old.generated_utc) ||
        time(next.generated_utc) === time(old.generated_utc) && next.run_id !== old.run_id)) return old;
    return next;
  }
  function update(values) {
    names.forEach(function(name,i) { var accepted = accept(feeds[name], values[i], schemas[i]);
      failures[name] = !values[i] || accepted !== values[i]; feeds[name] = accepted; });
  }
  function legacy(old,next,clock,now) {
    now=now===undefined?Date.now():now;clock=clock||"generated_utc";
    var n=next&&time(next[clock]),p=old&&time(old[clock]);
    if(!next||!Number.isFinite(n)||n>now+120000)return old;
    if(old&&p<=now&&(n<p||n===p&&JSON.stringify(next)!==JSON.stringify(old)))return old;
    return next;
  }
  function summary(w) {
    if (!w) return "History unavailable";
    return w.wet + " wet / " + w.known + " known days; " + w.unknown + " unknown" +
      (finite(w.wet_fraction) ? " (" + (100*w.wet_fraction).toFixed(1) + "%)" : "; fraction unavailable") +
      " | " + w.start + " to " + w.end + (w.small_sample ? " | small sample" : "");
  }
  function context(station, now) {
    now = now || Date.now(); var feed = feeds.rain_history, row = feed && feed.stations && feed.stations[station.icao];
    if (!row || row.station_id !== station.icao) return "Historical climate: awaiting computed data";
    var w = row.windows && (row.windows["25"] || row.windows["10"] || row.windows["3"]);
    var month = station.local_day && station.local_day.slice(5,7), counts = w && w.months && w.months[month];
    return "Historical month " + month + ": " + summary(counts) + " | climate context" +
      (failures.rain_history ? " | refresh failed" : "") +
      (now - time(feed.generated_utc) > 45*86400000 ? " | source refresh overdue" : "");
  }
  function element(tag,text,parent) { var e=document.createElement(tag); if(text!==undefined)e.textContent=text; if(parent)parent.appendChild(e);return e; }
  function get(url) {
    var c=new AbortController(), t=setTimeout(function(){c.abort();},12000);
    return fetch(url,{signal:c.signal,cache:"no-store"}).then(function(r){if(!r.ok)throw Error("HTTP "+r.status);return r.json();}).finally(function(){clearTimeout(t);});
  }
  function historyPanel(el, station, base) {
    var f=feeds.rain_history,r=f&&f.stations&&f.stations[station.icao];
    var key=station.icao+":"+(f&&f.run_id);
    if(el.dataset.historyKey===key)return;
    el.dataset.historyKey=key; el.replaceChildren();
    element("p",context(station),el);
    if(!r)return;
    element("p","Source-reported IEM climate days. These are not official market outcomes or a remaining-day forecast. Trace is below 0.01 inch; missing and estimated totals are unknown.",el);
    var details=element("details",undefined,el);element("summary","Explore 3, 10 and 25 years",details);
    var body=element("div",undefined,details), loaded=false;
    details.addEventListener("toggle",function(){
      if(!details.open||loaded)return;loaded=true;body.textContent="Loading station history...";
      get(base+r.detail).then(function(d){
        if(el.dataset.historyKey!==key)return;
        if(d.station_id!==station.icao||d.schema!=="rain-board.history-station/1")throw Error("station identity mismatch");
        body.replaceChildren();
        var controls=element("div",undefined,body), windowSel=element("select",undefined,controls), groupSel=element("select",undefined,controls);
        windowSel.setAttribute("aria-label","Historical window");groupSel.setAttribute("aria-label","Historical grouping");
        Object.keys(d.windows).forEach(function(y){var o=element("option",y+" years",windowSel);o.value=y;});
        ["months","seasons","weeks","years"].forEach(function(g){var o=element("option",g,groupSel);o.value=g;});
        var output=element("div",undefined,body);
        function show(){output.replaceChildren();var w=d.windows[windowSel.value];element("p",summary(w),output);
          element("p","Rolling complete dates; endpoint years may be partial. ISO weeks cross years. Seasons: DJF, MAM, JJA, SON. Leap days retained. No independent-storm confidence interval.",output);
          var table=element("table",undefined,output);var header=element("tr",undefined,table);
          [groupSel.value,"Wet / known","Unknown","Dates"].forEach(function(t){element("th",t,header);});
          Object.keys(w[groupSel.value]||{}).sort().forEach(function(g){var a=w[groupSel.value][g],tr=element("tr",undefined,table);
            [g,a.wet+" / "+a.known,String(a.unknown),a.start+" to "+a.end].forEach(function(t){element("td",t,tr);});});}
        windowSel.onchange=groupSel.onchange=show;show();
        var yearSel=element("select",undefined,body);yearSel.setAttribute("aria-label","Daily history year");
        (d.details||[]).slice().reverse().forEach(function(path){var o=element("option",path.match(/-(\d{4})\.json$/)[1],yearSel);o.value=path;});
        var button=element("button","Load daily observations",body), daily=element("div",undefined,body), serial=0;
        button.onclick=function(){var token=++serial;daily.textContent="Loading daily observations...";
          get(base+yearSel.value).then(function(j){if(token!==serial||el.dataset.historyKey!==key)return;
            if(j.station_id!==station.icao||j.schema!=="rain-board.history-year/1")throw Error("daily identity mismatch");
            daily.replaceChildren();var t=element("table",undefined,daily);
            (j.days||[]).forEach(function(day){var tr=element("tr",undefined,t);
              [day.contract_day,day.status,day.trace?"trace":finite(day.precipitation_mm)?day.precipitation_mm.toFixed(3)+" mm":"unknown",(day.quality_flags||[]).join("; ")].forEach(function(x){element("td",x,tr);});});
          }).catch(function(e){if(token===serial&&el.dataset.historyKey===key)daily.textContent="Daily history unavailable: "+e.message;});};
      }).catch(function(e){if(el.dataset.historyKey!==key)return;loaded=false;body.textContent="History detail unavailable: "+e.message+". Close and reopen to retry.";});
    });
  }
  function lines(station, now) {
    now=now===undefined?Date.now():now;var out=[];
    names.slice(1).forEach(function(name){var f=feeds[name],row=f&&f.stations&&f.stations[station.icao];
      if(!f||!row||row.station_id!==station.icao){out.push(name.replace(/_/g," ")+": unavailable");return;}
      if(failures[name])out.push(name+": refresh failed; retained timestamps apply");
      if(row.contract_day&&row.contract_day!==station.local_day){out.push(name+": no result for this contract day");return;}
      if(name==="forecast_history"){
        out.push("V3 source: "+row.source_status+" | issued "+row.issued_utc+" | first received "+row.first_received_utc);
        if(now-time(row.issued_utc)>1200000)out.push("V3 archived source is stale; history is retained");
        (row.events||[]).slice(-8).forEach(function(e){out.push(e.at+" | "+e.model_id+" | "+e.text);});
        out.push(row.source_comparison||"");
        (row.sources||[]).forEach(function(s){out.push(s.name+" | "+s.target+": "+(finite(s.reported_pct)?s.reported_pct+"%":"unavailable")+" | received "+(s.received_utc||"unknown"));});
        if(row.source_disagreement)out.push("Aligned source disagreement: "+row.source_disagreement.status+" | "+row.source_disagreement.reason);
        var c=f.counters||{};out.push("09:00 civil snapshots: expected "+c.expected+", attempted "+c.attempted+", recorded "+c.recorded);
        ["missing_source","stale_source","wrong_day","identity_mismatch","rejected_future_time","excluded_locked","withheld","not_attempted","not_due"].forEach(function(k){out.push(k.replace(/_/g," ")+": "+(c[k]||0));});
        out.push("Scored after settlement: "+f.scored_after_settlement+" | last outcome ingestion: "+(f.last_outcome_ingestion_utc||"none"));
      } else if(name==="forecast_skill") {
        out.push("EXPERIMENTAL model performance: "+(row.status||"unavailable"));
        if(row.scope)out.push(row.scope);
        out.push(row.reason||"");out.push("Known matched outcomes: "+(row.matched_n||0)+"; independent dates: "+(row.independent_dates||0));
        (row.comparisons||[]).forEach(function(c){
          out.push(c.model_id+" | n="+c.n+" | Brier="+c.brier+" | baseline="+c.baseline+" | skill="+c.brier_skill);
          out.push("Log loss "+c.log_loss+" | AUC "+c.auc+" | misses "+c.misses+" | false alarms "+c.false_alarms);
          var ci=c.paired_brier_difference_interval||{};out.push("Paired date-block Brier difference interval: "+(finite(ci.low)?ci.low+" to "+ci.high:ci.reason||"unavailable"));
          (c.bins||[]).filter(function(b){return b.n>0;}).forEach(function(b){out.push("Calibration bin "+b.lo+": n="+b.n+", mean forecast="+b.mean_prediction+", observed fraction="+b.event_fraction);});
          if(c.station_result)out.push(station.icao+" only: n="+c.station_result.n+", Brier="+c.station_result.brier);
        });
        Object.keys(f.conditional_context||{}).forEach(function(k){var gate=f.conditional_context[k];out.push(k+": "+gate.status+" | "+gate.reason);});
      } else {
        if(!(time(row.as_of_utc)<=now&&now<time(row.expires_utc))){out.push(name+": stale or unavailable numeric diagnostics");return;}
        out.push("EXPERIMENTAL "+name+": "+(row.status||"unavailable"));
        (row.display_lines||row.reasons||[]).forEach(function(text){out.push(text);});
        out.push("Source time "+row.source_valid_utc+" | expires "+row.expires_utc);
      }
    });return out;
  }
  function render(el, station, options) {
    if(!el)return;options=options||{};
    if(options.compact){el.textContent=context(station);return;}
    if(!el.querySelector(".exp-history")){el.replaceChildren();element("h3","Station history",el);element("div",undefined,el).className="exp-history";
      element("h3","Forecast changes and experimental comparisons",el);element("pre",undefined,el).className="exp-diagnostics";}
    historyPanel(el.querySelector(".exp-history"),station,options.base||"data/");
    el.querySelector(".exp-diagnostics").textContent=lines(station).join("\n");
  }
  var api={names:names,update:update,accept:accept,legacy:legacy,summary:summary,context:context,lines:lines,render:render};
  root.RainExpansionUI=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
