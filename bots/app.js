(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const dollars = n => n == null ? 'No data' : '$' + Number(n).toFixed(2);
  const signed = n => (n < -0.0049 ? '-' : n > 0.0049 ? '+' : '') + dollars(Math.abs(n));
  const number = n => Number(n).toLocaleString('en-US', {maximumFractionDigits: 2});
  const cents = n => n == null ? 'Not recorded' : number(n * 100) + 'c';
  function performance(pnl, capital) {
    const roi = capital ? ((pnl >= 0 ? '+' : '') + (100 * pnl / capital).toFixed(1) + '% ROI') : 'ROI n/a';
    return '<span class="money ' + (pnl < 0 ? 'neg' : 'pos') + '">' + signed(pnl) + ' on ' + dollars(capital) + ' capital, ' + roi + '</span>';
  }
  function totals(label, t) {
    return '<p class="' + (t.pnl == null ? 'unknown' : /hypothetical/i.test(label)?'hypothetical':/paper/i.test(label)?'paper':'real') + '">' + escape(label) + ': ' + (t.pnl == null ? 'No data: no finished result yet; ROI unavailable' : performance(t.pnl, t.capital))
      + (t.positions == null ? '' : ' <span class="meta">(' + t.positions + ' scored' + (t.pending ? ', ' + t.pending + ' pending' : '') + ')</span>') + '</p>';
  }
  const fact = (label, value) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>';
  const cities = {ATL:'Atlanta',AUS:'Austin',BOS:'Boston',CHI:'Chicago',DAL:'Dallas',DC:'Washington',DEN:'Denver',EWR:'Newark',HOU:'Houston',LAX:'Los Angeles',LV:'Las Vegas',VEGAS:'Las Vegas',MIA:'Miami',MIN:'Minneapolis',NOLA:'New Orleans',NYC:'New York',OKC:'Oklahoma City',PHIL:'Philadelphia',PHX:'Phoenix',SATX:'San Antonio',SAT:'San Antonio',SEA:'Seattle',SFO:'San Francisco',SF:'San Francisco',TTN:'Trenton',CMH:'Columbus',MKE:'Milwaukee',LEX:'Lexington',CLL:'College Station',PVD:'Providence',PIT:'Pittsburgh',DTW:'Detroit',ABQ:'Albuquerque',SGF:'Springfield'};
  function heading(p, live=true) {
    const code = String(p.ticker || '').split('-').pop(), pnl = p.cash_pnl === undefined ? p.pnl : p.cash_pnl;
    return '<div class="position-heading"><h3>' + escape(cities[code] || p.city || 'Unknown city') + ' &middot; ' + escape(p.day || 'Contract date unknown') + ' &middot; ' + (p.side === 'no' ? 'No rain (NO)' : 'Rain (YES)') + ' &middot; ' + dollars(p.unknown_fill ? null : p.capital) + ' spent &middot; ' + (pnl == null ? 'Open: waiting for result' : (live ? 'Real profit ' : 'Paper profit ') + signed(pnl)) + '</h3></div>';
  }
  let settlementsRead = '';
  function result(p) {
    return p.result ? p.result.toUpperCase() + ' settled; ' + (p.result === p.side ? 'held side won' : 'held side lost') : 'Result not read yet; the tracker reads at 07:30 CT' + settlementsRead;
  }
  function openPosition(p) {
    if (p.unknown_fill) return rainPosition(p, true);
    return '<article class="position">' + heading(p) + '<p>Forecast gap: ' + escape(p.gap == null ? 'Unknown' : p.gap + ' points') + '; ' + escape(p.sell_status || 'Held to settlement') + '.</p><details><summary>Details</summary><p>' + escape(p.ticker) + ' &middot; ' + escape(p.entered_ct) + ' CT</p><dl class="ledger-facts">'
      + fact('Contract day', p.day) + fact('Side', p.side.toUpperCase())
      + fact('Entry gap', p.gap == null ? 'Not recorded' : number(p.gap) + ' points')
      + fact('Entry slot / hour after open', p.slot == null ? 'Not recorded' : 'Slot ' + p.slot)
      + fact('Contracts', number(p.contracts) + ' in ' + p.legs + ' buy ' + (p.legs === 1 ? 'leg' : 'legs'))
      + fact('VWAP', cents(p.vwap)) + fact('Capital with fees', dollars(p.capital))
      + fact('Exit rule', p.exit) + fact('Sell status / target', p.sell_status + ' / ' + cents(p.target))
      + fact('Contracts sold', number(p.sold) + ' of ' + number(p.contracts))
      + fact('Sell proceeds / fees', dollars(p.proceeds) + ' / ' + dollars(p.sell_fee))
      + fact('Result', result(p)) + '</dl>'
      + '<p class="pnl-line real">Real profit: ' + (p.cash_pnl == null ? (p.cash_note === 'sell unresolved' ? 'Sell unresolved' : 'Pending') + ', ' + dollars(p.capital) + ' capital, ROI pending' : performance(p.cash_pnl, p.capital)) + '</p>'
      + '<p class="pnl-line hypothetical">If held (hypothetical): ' + (p.hold_pnl == null ? 'Not settled yet, ' + dollars(p.capital) + ' capital, ROI pending' : performance(p.hold_pnl, p.capital)) + '</p></details></article>';
  }
  function rainPosition(p, live) {
    if (p.unknown_fill) return '<article class="position unknown">'+heading({...p,capital:null})+'<p>Unknown exchange fill amounts; risk and result cannot be measured.</p><details><summary>Details</summary><p>'+escape(p.ticker)+'</p></details></article>';
    return '<article class="position">' + heading(p, live) + '<p>Held to settlement.</p><details><summary>Details</summary><p>' + escape(p.ticker) + ' &middot; ' + escape(p.entered_ct) + ' CT</p><dl class="ledger-facts">'
      + fact('Contract day', p.day || 'Not recorded') + fact('Side', p.side.toUpperCase())
      + fact('Avg incl. rounding', cents(p.price)) + fact('Contracts', number(p.contracts))
      + fact('Cost / fees', dollars(p.cost) + ' / ' + dollars(p.fee))
      + fact('Outcome', p.filled ? result(p) : (live ? 'No live fill' : 'No paper fill')) + '</dl>'
      + '<p class="pnl-line ' + (live ? 'real' : 'paper') + '">' + (live ? 'Real' : 'Paper') + ' profit: ' + (p.pnl == null ? (p.filled ? 'Pending' : 'No fill') + ', ' + dollars(p.capital) + ' capital, ROI ' + (p.filled ? 'pending' : 'n/a') : performance(p.pnl, p.capital)) + '</p></details></article>';
  }
  function positionList(entries, renderer, empty) {
    const filled = entries.filter(entry => entry.unknown_fill || Number(entry.contracts) > 0);
    const hidden = entries.length - filled.length;
    const note = hidden ? '<p class="meta">' + hidden + ' ' + (hidden === 1 ? 'attempt that never filled is' : 'attempts that never filled are') + ' hidden.</p>' : '';
    if (!filled.length) return note + '<p>' + empty + '</p>';
    const latest = filled.slice(0, 20).map(renderer).join('');
    if (filled.length <= 20) return note + latest;
    return note + latest + '<details class="older-positions"><summary>Show all ' + filled.length + ' entries</summary>'
      + filled.slice(20).map(renderer).join('') + '</details>';
  }
  function shadowResult(t) {
    return t && t.pnl != null ? performance(t.pnl, t.capital) : 'No data: no finished result yet';
  }
  function stamp(value) {
    const d = new Date(typeof value === 'number' ? value * 1000 : value); return value && Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago', dateStyle:'medium', timeStyle:'short'}).format(d) + ' CT' : 'Unknown';
  }
  function feedAge(doc) { const n = (Date.now() - Date.parse(doc.generated_utc)) / 1000; return Number.isFinite(n) && n >= 0 ? n : null; }
  function chips(view, doc) {
    const status = view.status || {}, m = status.money || {}, p = status.process || {}, a = status.last_activity || {};
    const age = feedAge(doc), fresh = age != null && age < 900;
    const chip = (cls, text, evidence) => '<span class="status-chip ' + cls + '" title="' + escape(evidence || 'Unknown') + '">' + escape(text) + '</span>';
    return '<div class="status-chips">' + chip(!fresh ? 'unknown' : m.value === 'real' ? 'real' : m.value === 'paper' ? 'paper' : 'unknown', 'Money: ' + ({real:'Real money',paper:'Paper (no real orders)',halted:'Halted'}[m.value] || 'Unknown') + (!fresh ? ' (last known; feed stale or missing)' : ''), m.reason + '; ' + (m.source || '') + '; ' + stamp(m.utc))
      + chip(p.value === 'running' && fresh ? 'healthy' : 'unknown', 'Process: ' + ({running:'Running',not_running:'Not running'}[p.value] || 'Unknown') + (!fresh ? ' (feed stale or missing)' : '') + (p.age_seconds == null ? '' : ' (' + Math.floor(p.age_seconds/60) + ' min)'), (p.source || '') + '; ' + (p.reason || '') + '; ' + stamp(p.utc))
      + chip('unknown', 'Last activity: ' + stamp(a.value), a.reason || a.source)
      + chip(fresh ? 'healthy' : 'unknown', 'Data: ' + (age == null ? 'Missing' : fresh ? 'Fresh' : 'Stale') + (age == null ? '' : ' (' + Math.floor(age/60) + ' min)'), 'bots.json generated ' + stamp(doc.generated_utc)) + '</div><p class="meta">' + escape(m.reason || 'Money evidence unknown') + '; process evidence: ' + escape(p.source || 'Unknown') + ' at ' + stamp(p.utc) + '; ' + escape(p.reason || 'Unknown') + '</p>';
  }
  const value = n => n == null ? 'Unknown' : number(n);
  const price = n => n == null ? 'Unknown' : cents(n);
  function rules(view, tier) {
    const c = (view.rules || {}).values;
    if (!c) return '<p class="unknown">Rules: Unknown. CAPS missing or unreadable.</p>';
    let does, buys, spend, exit;
    if (tier === 'open_tier') {
      const r = c.r5 || {}, tiers = c.cashout_tiers || [];
      does = 'Buys rain or no-rain contracts the day before, using the National Blend of Models (NBM).';
      buys = 'Forecast gap at least ' + value(c.gap_pts) + ' points; price at least ' + price(r.min_entry_price) + '; checks ' + escape(c.scan || 'Unknown') + ' once next-day markets open.';
      spend = dollars(c.stake_usd) + ' below ' + price(r.split) + ', ' + dollars(r.rich_stake) + ' at or above it; at most ' + value(c.max_entries_per_day) + ' trades and ' + dollars(c.day_usd) + ' a day, up to ' + value(c.max_balance_share == null ? null : c.max_balance_share*100) + '% of balance. Resting buy waits ' + value(c.rest_min) + ' minutes.';
      exit = 'NO and YES below ' + price(r.split) + ' hold to settlement. Other YES: ' + tiers.map((t,i) => 'gap ' + value(t[0]) + (tiers[i+1] ? ' to ' + value(tiers[i+1][0]) : ' or more') + ' points: ' + (t[1] === 'hold' ? 'hold to settlement' : 'sell at ' + value(t[1]) + ' times buy price')).join('; ') + '. Targets at 100c or above are held. Contract-day start: ' + (c.d_day_sells === 'withdraw' ? 'cancel unfilled sells and hold to settlement.' : escape(c.d_day_sells || 'Unknown'));
    } else {
      const k = c.code_constants || {};
      if (tier === 'lock') {
        does = "Buys Rain (YES) when the airport's own gauge measures rain today.";
        buys = 'Gauge reports at least ' + value(k.MIN_LOCK_IN) + ' inch inside the local standard day; pays at most ' + price(c.limit_yes) + '.';
        spend = dollars(k.HARD_LOCK_ENTRY_USD) + ' per entry including fees, up to ' + value(c.cap_contracts) + ' contracts and ' + dollars(c.cap_day_usd) + ' a day.';
      } else if (tier === 'prime') {
        does = 'Would buy Rain (YES) early, when a storm reaches a still-dry gauge.';
        buys = 'Thunder and rain, NWS rain chance at least ' + value(c.tier1_min_pop) + '%, inbound radar cell at least ' + value(k.PRIME_CELL_DBZ) + ' dBZ; price at most ' + price(c.tier1_limit_yes) + '.';
        spend = dollars(c.prime_cap_usd == null ? k.HARD_PRIME_ENTRY_USD : c.prime_cap_usd) + ' a market.';
      } else {
        does = 'Buys No rain (NO) in the evening of the contract day.';
        buys = '8 to 9 p.m. in the station\'s local time on the contract day, when dry with no other signal; pays at most ' + price(c.evening_limit_no) + '. Window from code: ' + value(k.EVENING_START_LOCAL_HOUR) + ':00, ' + value(k.EVENING_WINDOW_MIN) + ' minutes.';
        spend = dollars(c.evening_cap_usd) + ' a market and ' + dollars(c.evening_day_usd) + ' a day.';
      }
      exit = 'Holds to settlement at local standard midnight.';
    }
    return '<dl class="rules">' + [['What it does',does],['What makes it buy',buys],['How much it can spend',spend],['When it sells or settles',exit]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('') + '</dl>';
  }
  function experimentFresh(s, doc) {
    const feed = feedAge(doc), checkpoint = s.checkpoint_age_seconds;
    const elapsed = feed == null ? null : checkpoint == null ? null : checkpoint + feed;
    return feed != null && feed < 900 && s.status !== 'unavailable' && s.status !== 'unknown'
      && (s.status === 'finished' || (s.status !== 'stale' && elapsed != null && elapsed >= 0 && elapsed < 900));
  }
  function experimentProfit(s, doc) {
    if (s.total.pnl == null) return 'No data: no finished result yet; ROI unavailable';
    if (s.status === 'unknown' || s.status === 'unavailable') return 'No data';
    return experimentFresh(s, doc) ? performance(s.total.pnl, s.total.capital)
      : 'Stale data: ' + signed(s.total.pnl) + ' on ' + dollars(s.total.capital) + ' capital, '
        + (s.total.capital ? (s.total.pnl >= 0 ? '+' : '') + (100*s.total.pnl/s.total.capital).toFixed(1) + '% ROI' : 'ROI unavailable');
  }
  function experiment(s, doc) {
    const fresh = experimentFresh(s,doc);
    const fill = escape(fillDescription(s));
    const sizingText = sizeText(s);
    const coverage = s.live_open_tier || {}, days = s.days_done || 0;
    return '<article class="shadow-test"><h3>'+escape(s.label)+'</h3>'+experimentStatus(s,doc)+'<p>'+escape(s.status_reason)+'</p><p>'+escape(s.description)+'</p><dl class="rules"><dt>Strategy version / forecast</dt><dd>'+escape(s.version || 'Unknown')+' / '+escape(s.forecast || 'Unknown')+'</dd><dt>Sizing</dt><dd>'+escape(sizingText)+'</dd><dt>Starting paper cash</dt><dd>'+dollars(s.starting_cash)+'</dd><dt>Window (contract dates; updates CT)</dt><dd>'+escape(s.window.first_day || 'Unknown')+' to '+escape(s.window.open_ended?'open-ended':s.window.last_day || 'Unknown')+'</dd><dt>Fill model</dt><dd>'+fill+'</dd><dt>Days with trades</dt><dd>'+ (s.days_with_trades == null ? 'No finished day yet' : s.days_with_trades) + '; '+days+' completed days</dd></dl>'+'<p class="'+(fresh?'paper':'unknown')+'">'+(s.real_fill_started_ts!=null?'REAL-FILL profit: ':'Paper profit: ')+experimentProfit(s,doc)+'</p>'+bookSweepResult(s,fresh)+'<p>Live comparison on '+(coverage.days || 0)+' of '+days+' days.</p><details><summary>Daily results and trades</summary>'+'<div class="'+(fresh?'':'unknown')+'">'+(fresh?'':'Stale or unavailable experiment results. ')+s.daily.map(r=>'<p>'+escape(r.day)+': '+shadowResult(r)+'; '+(r.live_open_tier.pnl==null?'No live result to compare':shadowResult(r.live_open_tier))+'</p>').join('')+twinComparison(s,fresh)+positionList(s.entries,p=>rainPosition(p,false),'No finished day yet')+'</div></details></article>';
  }
  function fillDescription(s) {
    if (/REAL-FILL/.test(s.fill_model || '')) return s.fill_model;
    return s.fill_model ? (/book|sweep/i.test(s.fill_model) ? 'Walks the order book' : 'Matched to real trade prints') : 'Unknown';
  }
  function bookSweepResult(s, fresh) {
    if (s.real_fill_started_ts == null) return '';
    const b = s.book_sweep;
    return '<p>REAL-FILL since '+stamp(s.real_fill_started_ts)+'. Earlier holdings and history unchanged.</p><p>'+(fresh?'':'Stale data: ')+'Old book-sweep profit: '+(b ? performance(b.pnl,b.capital)+'; open spent '+dollars(b.open_capital) : 'Waiting for first comparison')+'</p>';
  }
  function experimentStatus(s,doc) {
    const fresh=experimentFresh(s,doc);
    const state=fresh?s.status:['unknown','unavailable'].includes(s.status) ? s.status : 'stale';
    return '<div class="status-chips"><span class="status-chip paper">Money: Paper (no real orders)</span><span class="status-chip '+(state==='running'?'healthy':'unknown')+'" title="state.json meta.last_minute">Process: '+escape(state)+'; '+escape(s.checkpoint_age_seconds==null?'age Unknown':Math.floor(s.checkpoint_age_seconds/60)+' min')+'</span><span class="status-chip unknown">Last activity: '+stamp(s.last_activity)+'</span><span class="status-chip '+(fresh?'healthy':'unknown')+'">Data: '+(fresh?'Fresh':'Stale or missing')+'; checkpoint '+stamp(s.checkpoint_utc)+'</span></div>';
  }
  function experimentTable(rows, doc) {
    return '<div class="table-scroll" tabindex="0" role="region" aria-label="Experiment comparison"><table><thead><tr>'+['Experiment / version','Forecast','Sizing','Starting cash','Window (contract dates; CT updates)','Fill model','Days with trades','Paper profit / ROI','Live comparison','Status'].map(v=>'<th scope="col">'+v+'</th>').join('')+'</tr></thead><tbody>'+rows.map(s=>'<tr><th scope="row">'+escape(s.label)+'<br>'+escape(s.version || 'Unknown')+'</th><td>'+escape(s.forecast || 'Unknown')+'</td><td>'+escape(sizeText(s))+'</td><td>'+dollars(s.starting_cash)+'</td><td>'+escape(s.window.first_day || 'Unknown')+' to '+escape(s.window.open_ended?'open-ended':s.window.last_day || 'Unknown')+'</td><td>'+escape(fillDescription(s))+'</td><td>'+ (s.days_with_trades==null?'No finished day yet':s.days_with_trades)+'</td><td class="'+(experimentFresh(s,doc) && s.total.pnl!=null?'paper':'unknown')+'">'+experimentProfit(s,doc)+'</td><td>'+ (s.live_open_tier.days?'Live comparison on '+s.live_open_tier.days+' of '+s.days_done+' days':'No live result to compare')+'</td><td>'+experimentStatus(s,doc)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function sizeText(s) {
    const c=s.sizing || {}, r=c.r5 || {};
    if(c.cash_fraction!=null) return (100*c.cash_fraction)+'% of current cash per entry; at most '+c.max_new_markets+' new markets a day';
    if(c.stake_usd!=null) return dollars(c.stake_usd)+(r.rich_stake!=null || c.rich_stake!=null?' / '+dollars(r.rich_stake ?? c.rich_stake):'')+(c.day_usd!=null?', '+dollars(c.day_usd)+' a day':'');
    return 'Unknown';
  }
  function render(doc) {
    const o = doc.open_tier, fresh = feedAge(doc) != null && feedAge(doc) < 900;
    const safeTotal = t => fresh ? t : {pnl:null,positions:null};
    const bots = [['Open tier',o,'open_tier'],['Rain lock',doc.lock,'lock']];
    $('bot-guide').innerHTML = bots.map(([name,v,t])=>'<article class="bot-guide"><h3>'+name+'</h3>'+chips(v,doc)+rules(v,t)+'</article>').join('');
    // Retired real positions still contribute to risk until they finish.
    const liveViews = [o,doc.lock,doc.evening];
    const rows = liveViews.flatMap(v=>v.positions || v.entries || []).filter(p=>p.contracts>0 && (p.cash_pnl === undefined ? p.pnl : p.cash_pnl)==null);
    const unknownFill = liveViews.some(v=>(v.entries || []).some(p=>p.unknown_fill));
    const badOpenRows = (o.ledger_stats?.bad_rows || 0) + (o.ledger_stats?.bad_lines || 0);
    const badRainRows = (doc.rain_ledger_stats?.bad_rows || 0) + (doc.rain_ledger_stats?.bad_lines || 0);
    const unknownAmounts = rows.some(p=>!Number.isFinite(p.capital) || !Number.isFinite(p.cost) || !Number.isFinite(p.fee));
    const unknownRisk = unknownFill || badOpenRows > 0 || badRainRows > 0 || unknownAmounts;
    const risk = fresh && !unknownRisk ? rows.reduce((sum,p)=>sum+p.capital,0) : null;
    function combined(totals) { const known = totals.filter(t=>t && t.pnl!=null); const capital=known.reduce((n,t)=>n+t.capital,0), pnl=known.length?known.reduce((n,t)=>n+t.pnl,0):null; return {pnl,capital,roi:capital && pnl!=null ? 100*pnl/capital:null,positions:known.reduce((n,t)=>n+t.positions,0)}; }
    const noMoney = {pnl:null,capital:null,positions:null};
    const notice = '<p class="unknown">No data. Needs attention: ledger rows or fill amounts unknown; risk and result cannot be measured.</p>';
    const openUncertain = badOpenRows > 0 || o.ledger_uncertain;
    const rainUncertain = badRainRows > 0 || unknownFill || doc.lock.ledger_uncertain || doc.evening.ledger_uncertain;
    const real = unknownRisk ? noMoney : combined([o.as_traded,doc.lock.total]);
    const paper = badRainRows ? noMoney : combined([doc.paper.lock.total]);
    const exposureBots = bots.slice(0,2).map(([name,v]) => '<h3>'+name+'</h3>'+chips(v,doc)).join('');
    $('overview').innerHTML = '<div class="'+(risk==null?'unknown':'real')+'"><p class="money">Open right now: '+dollars(risk)+' across '+(fresh && !unknownRisk?rows.length:'Unknown')+' trades</p>'+exposureBots+'<p>Contract dates: '+escape(rows.length?(()=>{const d=rows.map(p=>p.day || 'Unknown').sort(); return d[0]===d[d.length-1]?d[0]:d[0]+' to '+d[d.length-1];})():'No open dates recorded')+' (station local day). Snapshot '+stamp(doc.generated_utc)+'. Includes earlier real trades still open. Excludes resting buy reservations.</p>'+totals('Real profit (finished trades)',safeTotal(real))+'</div><div class="paper">'+totals('Paper profit (finished trades)',safeTotal(paper))+'</div><div class="hypothetical">'+totals('If held (hypothetical, Open tier)',safeTotal(openUncertain?noMoney:o.if_held))+'</div>'+ (fresh?(unknownRisk?notice:rows.map(p=>heading(p)).join('')):'<p class="unknown">Stale or missing feed: current risk and results are unavailable.</p>')+'<p><a href="#definitions">Definitions: open right now, profit, ROI and if held</a></p>';
    const attention=[];
    if(badOpenRows || unknownAmounts) attention.push('Open tier or unfinished real position: ledger rows or fill amounts unknown. Current total risk cannot be measured.');
    if(badRainRows) attention.push('Rain ledger: unreadable rows or lines. Current total risk cannot be measured.');
    if(unknownFill) attention.push('Real order fill amounts unknown. Current total risk cannot be measured.');
    if (!fresh) attention.push('Bots feed: '+(feedAge(doc)==null?'Unknown generated time':'Stale since '+stamp(doc.generated_utc)));
    // A halt is reported once per reason (Lock, Prime and Evening NO share one HALT file), and a halted
    // bot's stopped process is the halt doing its job, not a second alarm (desk review, 2026-10-09).
    const halts=new Map();
    bots.forEach(([name,v])=>{const st=v.status || {}; const money=(st.money || {}).value;
      if (money==='halted') { const r=String(st.money.reason || 'Halted'); halts.set(r, (halts.get(r) || []).concat(name)); return; }
      if (!money) attention.push(name+': money mode Unknown; '+((st.money || {}).reason || 'no evidence'));
      if ((st.process || {}).value!=='running') attention.push(name+': process '+((st.process || {}).value || 'Unknown')+'; '+((st.process || {}).reason || 'No signal')+'; '+stamp((st.process || {}).utc));});
    halts.forEach((names,r)=>{ const first=(r.split(/(?<=[.!?])\s+/)[0] || r).slice(0,180); attention.push('Halted on purpose: '+names.join(', ')+'. '+first); });
    const retiredNames=['opus_r5','r5_size','codex_r4','fmode_w6','size_75','size_100','size_150'];
    const retired={...(doc.retired || {})};
    const historical={...(doc.shadows || {}),...(doc.size_tests || {})};
    const finished=s=>s?.status==='unavailable' || s?.status_reason==='Ledger missing' ? {pnl:null,capital:null} : s?.total || {pnl:null,capital:null};
    retiredNames.forEach(n=>{if (!retired[n]) retired[n]={label:historical[n]?.label || n,results:{paper:finished(historical[n])}};});
    if (!retired.evening) retired.evening={label:'Evening NO',results:{real:doc.evening?.total || {},paper:doc.paper.evening?.total || {}}};
    if (!retired.prime) retired.prime={label:'Prime',results:{paper:doc.paper.prime?.total || {}}};
    const experiments=Object.entries(historical).filter(([n])=>!retired[n]).map(([,s])=>s);
    experiments.forEach(s=>{if (s.status!=='running' && s.status!=='finished') attention.push(s.label+': '+s.status+'; '+(s.status_reason || '')+'; '+stamp(s.checkpoint_utc));});   // live-match coverage lives in the Experiments table, not here
    attention.push(...(doc.warnings || []));
    $('attention').innerHTML = attention.length ? '<ul class="unknown">'+attention.map(s=>'<li>'+escape(s)+'</li>').join('')+'</ul>' : '<p>All reported checks passed.</p>';
    $('open-summary').innerHTML = chips(o,doc)+rules(o,'open_tier')+(openUncertain?notice:'')+totals('Real profit',safeTotal(openUncertain?noMoney:o.as_traded))+totals('If held (hypothetical)',safeTotal(openUncertain?noMoney:o.if_held))+'<p>Total spent so far: '+dollars(fresh && !openUncertain?o.deployed:null)+'</p>'+(o.contract_days || []).map(u=>'<p>'+u.entries+' of '+value(u.entry_limit)+' entries; '+dollars(openUncertain?null:u.capital)+' of '+dollars(u.dollar_limit)+' filled for '+escape(u.contract_day)+'. '+u.pending_entries+' pending entries included.</p>').join('');
    $('open-positions').innerHTML = fresh ? (openUncertain?notice:positionList(o.positions,openPosition,'No real positions recorded.')) : '<p class="unknown">No data: stale feed.</p>';
    ['lock'].forEach(t=>{const v=doc[t]; $(t+'-summary').innerHTML=chips(v,doc)+(t==='lock'?rules(v,t):'')+(rainUncertain?notice:'')+totals('Real profit',safeTotal(rainUncertain?noMoney:v.total)); $(t+'-positions').innerHTML=fresh?(rainUncertain?notice:positionList(v.entries,p=>rainPosition(p,true),'No filled real entries recorded.')):'<p class="unknown">No data: stale feed.</p>';});
    ['lock'].forEach(t=>{const v=doc.paper[t], prefix=t==='prime'?t:t+'-paper'; $(prefix+'-summary').innerHTML=chips(v,doc)+rules(v,t)+(badRainRows?notice:'')+totals('Paper profit',safeTotal(badRainRows?noMoney:v.total)); $(prefix+'-positions').innerHTML=fresh?(badRainRows?notice:positionList(v.entries,p=>rainPosition(p,false),'No filled paper entries recorded.')):'<p class="unknown">No data: stale feed.</p>';});
    $('shadow-index').innerHTML=''; $('shadow-comparison').innerHTML='';
    const groups = [...new Set(experiments.map(s=>s.group))];
    $('shadow-tests').innerHTML = groups.map(g=>'<h2 class="shadow-group">'+escape(g)+'</h2><p>'+ (g==='Live twin'?'Live cash read at each decision; actual live buys on shared markets.':g==='Jules round 7 compounding paper test'?'$1,000 paper cash; stake 30% of current cash; open-ended; REAL-FILL capacity.':g==='Open-ended size tests'?'$5,000 paper cash; open-ended; order-book fills.':'Fixed 14-day tests; $500 paper cash; print-matched fills.')+'</p>'+experimentTable(experiments.filter(s=>s.group===g),doc)+'<details><summary>Experiment rules, evidence and trade details</summary>'+experiments.filter(s=>s.group===g).map(s=>experiment(s,doc)).join('')+'</details>').join('');
    const glanceRows=bots.map(([name,v])=>[name,chips(v,doc),shadowResult(safeTotal(v.as_traded || v.total))]).concat(experiments.map(s=>[s.label,experimentStatus(s,doc),experimentProfit(s,doc)]));
    $('at-glance').innerHTML='<div class="table-scroll" tabindex="0"><table><thead><tr><th>Strategy</th><th>Status</th><th>Finished result</th></tr></thead><tbody>'+glanceRows.map(([name,status,result])=>'<tr><th scope="row">'+escape(name)+'</th><td>'+status+'</td><td>'+result+'</td></tr>').join('')+'</tbody></table></div>';
    $('retired-results').innerHTML='<ul>'+Object.values(retired).map(v=>'<li>'+escape(v.label)+': '+Object.entries(v.results).map(([mode,t])=>escape(mode)+': '+shadowResult(t)).join('; ')+'</li>').join('')+'</ul>';
    $('warnings').innerHTML = (doc.warnings || []).map(w=>'<p>'+escape(w)+'</p>').join('');
    $('load-status').textContent = 'Ledger snapshot: '+stamp(doc.generated_utc)+'. '+(fresh?'Fresh.':'Stale or missing data. No data shown as current money.')+' Refreshes every minute.';
  }
  function twinComparison(s,fresh) {
    if (s.name!=='live_twin') return '';
    if (!fresh) return '<p class="unknown">Twin comparison unavailable: stale feed.</p>';
    const rows=s.market_comparison || [];
    const checks=s.ask_checks || [];
    return '<h4>Twin vs live by market</h4><p>Contracts bought, contracts still held, buy cost and realized P&amp;L. Pending P&amp;L stays unknown.</p><div class="table-scroll"><table><thead><tr><th>Market / side</th><th>Twin contracts / held</th><th>Live contracts / held</th><th>Twin / live cost</th><th>Twin / live P&amp;L</th><th>Every difference</th></tr></thead><tbody>'+rows.map(r=>'<tr><th>'+escape(r.ticker)+' / '+escape(r.side)+'</th><td>'+value(r.twin.contracts)+' / '+value(r.twin.held)+'</td><td>'+value(r.live.contracts)+' / '+value(r.live.held)+'</td><td>'+dollars(r.twin.cost)+' / '+dollars(r.live.cost)+'</td><td>'+dollars(r.twin.pnl)+' / '+dollars(r.live.pnl)+'</td><td>'+escape(r.differences.join('; ') || 'No measured difference')+'</td></tr>').join('')+'</tbody></table></div>'+checks.map(r=>'<p class="'+(r.twin_first===r.live_first && r.twin_side===r.live_side?'paper':'unknown')+'">'+escape(r.ticker)+' slot '+value(r.slot==null?0:r.slot)+': first ask twin '+value(r.twin_first)+', live '+value(r.live_first)+'; '+(r.same_minute?'same minute':'different minute')+'.'+(r.reason?' '+escape(r.reason)+'.':'')+'</p>').join('');
  }
  function clear(message) {
    document.querySelectorAll('.ledger-summary, .ledger-rows, #attention, #bot-guide, #retired-results').forEach(e => { e.replaceChildren(); });
    $('warnings').replaceChildren();
    $('load-status').textContent = message;
    $('load-status').classList.add('banner');
    document.querySelector('.bot-tabs').hidden = true;
    document.querySelectorAll('.bot-panel').forEach(e => { e.hidden = true; });
  }
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    $('refresh').disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('../data/bots.json', {cache:'no-store', signal:controller.signal});
      if (response.status === 404) {
        clear('This page only works on the box from your Tailscale devices. Turn on Tailscale on this device, then tap Refresh.');
        return;
      }
      if (!response.ok) throw new Error('unavailable');
      const doc = await response.json();
      if (doc.schema !== '019a.bots/1') throw new Error('unreadable');
      $('load-status').classList.remove('banner');
      document.querySelector('.bot-tabs').hidden = false;
      select(tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0], false);
      render(doc);
    } catch (_) {
      clear('The ledgers could not be loaded. Refresh to try again.');
    } finally {
      clearTimeout(timeout);
      $('refresh').disabled = false;
      loading = false;
    }
  }
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  function select(tab, focus) {
    tabs.forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => select(tab, false);
    tab.onkeydown = event => {
      const target = {ArrowRight:(index + 1) % tabs.length, ArrowLeft:(index + tabs.length - 1) % tabs.length, Home:0, End:tabs.length - 1}[event.key];
      if (target != null) { event.preventDefault(); select(tabs[target], true); }
    };
  });
  function theme(light) {
    document.body.classList.toggle('light', light);
    document.documentElement.classList.toggle('light', light);
    document.querySelector('meta[name="theme-color"]').content = light ? '#F2F4F6' : '#12181E';
    $('theme').textContent = light ? 'Dark' : 'Light';
  }
  try { theme(localStorage.getItem('rb.theme') === 'light'); } catch (_) { theme(false); }
  try {
    const sizes = {small:.9, normal:1, large:1.2};
    document.documentElement.style.setProperty('--type-scale', String(sizes[localStorage.getItem('rb.type.v1')] || 1));
  } catch (_) { document.documentElement.style.setProperty('--type-scale', '1'); }
  $('theme').onclick = () => {
    const light = !document.body.classList.contains('light');
    theme(light);
    try { localStorage.setItem('rb.theme', light ? 'light' : 'dark'); } catch (_) { /* Device storage may be disabled. */ }
  };
  $('refresh').onclick = load;
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  load();
})();
