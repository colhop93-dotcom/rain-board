(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const dollars = n => n == null ? 'No data' : '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const signed = n => (n < -0.0049 ? '-' : n > 0.0049 ? '+' : '') + dollars(Math.abs(n));
  const number = n => Number(n).toLocaleString('en-US', {maximumFractionDigits: 2});
  const cents = n => n == null ? 'Not recorded' : number(n * 100) + 'c';
  function performance(pnl, capital) {
    const roi = capital ? ((pnl >= 0 ? '+' : '') + (100 * pnl / capital).toLocaleString('en-US', {minimumFractionDigits:1, maximumFractionDigits:1}) + '% ROI') : 'ROI n/a';
    return '<span class="money ' + (pnl < 0 ? 'neg' : 'pos') + '">' + signed(pnl) + ' on ' + dollars(capital) + ' capital, ' + roi + '</span>';
  }
  function totals(label, t) {
    return '<p class="' + (t.pnl == null ? 'unknown' : /hypothetical/i.test(label)?'hypothetical':/paper/i.test(label)?'paper':'real') + '">' + escape(label) + ': ' + (t.pnl == null ? 'No data: no finished result yet; ROI unavailable' : performance(t.pnl, t.capital))
      + (t.positions == null ? '' : ' <span class="meta">(' + t.positions + ' scored' + (t.pending ? ', ' + t.pending + ' pending' : '') + ')</span>') + '</p>';
  }
  const fact = (label, value) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>';
  const cities = {ATL:'Atlanta',AUS:'Austin',BOS:'Boston',CHI:'Chicago',DAL:'Dallas',DC:'Washington',DEN:'Denver',EWR:'Newark',HOU:'Houston',LAX:'Los Angeles',LV:'Las Vegas',VEGAS:'Las Vegas',MIA:'Miami',MIN:'Minneapolis',NOLA:'New Orleans',NYC:'New York',OKC:'Oklahoma City',PHIL:'Philadelphia',PHX:'Phoenix',SATX:'San Antonio',SAT:'San Antonio',SEA:'Seattle',SFO:'San Francisco',SF:'San Francisco',TTN:'Trenton',CMH:'Columbus',MKE:'Milwaukee',LEX:'Lexington',CLL:'College Station',PVD:'Providence',PIT:'Pittsburgh',DTW:'Detroit',ABQ:'Albuquerque',SGF:'Springfield'};
  // All 33 current KXRAIN codes, plus historical Detroit and exchange aliases above.
  Object.assign(cities, {IND:'Indianapolis', STL:'St. Louis', TPA:'Tampa'});
  function heading(p, live=true) {
    const code = String(p.ticker || '').split('-').pop(), pnl = p.cash_pnl === undefined ? p.pnl : p.cash_pnl;
    return '<div class="position-heading"><h3>' + escape(cities[code] || p.city || 'Unknown city') + ' &middot; ' + escape(p.day || 'Contract date unknown') + ' &middot; ' + (p.side === 'no' ? 'No rain (NO)' : 'Rain (YES)') + ' &middot; ' + dollars(p.unknown_fill ? null : p.capital) + ' spent &middot; ' + (pnl == null ? 'Open: waiting for result' : (live ? 'Real profit ' : 'Paper profit ') + performance(pnl, p.capital)) + '</h3></div>';
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
    return '<article class="position">' + heading(p, live) + '<p>'+(p.pre_real_fill?(p.pre_real_fill_mixed?'Includes pre-REAL-FILL fills (bought before and after REAL-FILL started). ':'pre-REAL-FILL, not a real fill. '):'')+'Held to settlement.</p><details><summary>Details</summary><p>' + escape(p.ticker) + ' &middot; ' + escape(p.entered_ct) + ' CT</p><dl class="ledger-facts">'
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
  function faults(view, doc) {
    const st = view.status || {}, m = st.money || {}, p = st.process || {};
    const warnings = [];
    if (feedAge(doc) == null || feedAge(doc) >= 900) warnings.push('STALE: current risk and results are unavailable.');
    if (m.value !== 'halted' && p.value !== 'running') warnings.push('NOT RUNNING: ' + (p.reason || 'Process evidence unavailable'));
    if (m.value !== 'real' && m.value !== 'halted') warnings.push('Live money approval: ' + (m.reason || 'Money mode unknown'));
    return warnings.map(w => '<p class="fault">'+escape(w)+'</p>').join('');
  }
  function evidence(view, doc) {
    return '<details class="bot-evidence"><summary>Details</summary>'+chips(view, doc)+'</details>';
  }
  function haltLine(view, doc) {
    const m = view.status?.money || {};
    const when = /\d{4}-\d{2}-\d{2}/.exec(m.reason || '')?.[0];
    const date = when ? new Date(when+'T12:00:00Z') : new Date(m.utc);
    const day = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric'}).format(date) : 'date unknown';
    return '<div class="halt-line"><span>Rain lock: halted on purpose ('+escape(day)+')</span>'+evidence(view,doc)+'</div>';
  }
  function compactBet(p) {
    const code = String(p.ticker || '').split('-').pop();
    return '<li>'+escape(cities[code] || p.city || 'Unknown city')+' &middot; '+escape(p.day || 'Date unknown')+' &middot; '+(p.side==='no'?'NO':'YES')+' &middot; '+dollars(p.capital)+' &middot; '+escape(p.sell_status || 'Waiting for result')+'</li>';
  }
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
      const r = c.r5 || {}, configured = c.cashout_tiers || [], tiers = view.rules.effective_r5_tiers || configured;
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
    const mismatch = tier==='open_tier' && view.rules.effective_r5_tiers && JSON.stringify(c.cashout_tiers)!==JSON.stringify(view.rules.effective_r5_tiers);
    return (mismatch?'<p class="fault">CAPS.json configured tiers '+escape(JSON.stringify(c.cashout_tiers))+'. Current r5 code overrides these with '+escape(JSON.stringify(view.rules.effective_r5_tiers))+'.</p>':'')+'<dl class="rules">' + [['What it does',does],['What makes it buy',buys],['How much it can spend',spend],['When it sells or settles',exit]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+v+'</dd>').join('') + '</dl>';
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
      : 'Stale data: ' + performance(s.total.pnl, s.total.capital);
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
    return s.fill_model ? (/book|sweep/i.test(s.fill_model) ? 'Legacy book-sweep simulation; REAL-FILL start not recorded' : 'Legacy print simulation; REAL-FILL start not recorded') : 'Unknown';
  }
  function bookSweepResult(s, fresh) {
    if (s.real_fill_started_ts == null) return '';
    const b = s.book_sweep;
    const same = s.settlements_since_real_fill === 0 && b && s.total.pnl != null && Math.abs(b.pnl-s.total.pnl)<.005 && Math.abs(b.capital-s.total.capital)<.005;
    return '<p>REAL-FILL since '+stamp(s.real_fill_started_ts)+'. Earlier holdings and history unchanged. Totals include pre-REAL-FILL history.</p><p>'+(fresh?'':'Stale data: ')+'Old book-sweep profit: '+(b ? (same?'same, no trade settled since REAL-FILL started; ':'')+performance(b.pnl,b.capital)+'; open spent '+dollars(b.open_capital) : 'Waiting for first comparison')+'</p>';
  }
  function experimentStatus(s,doc) {
    const fresh=experimentFresh(s,doc);
    const state=fresh?s.status:['unknown','unavailable'].includes(s.status) ? s.status : 'stale';
    return '<div class="status-chips"><span class="status-chip paper">Money: Paper (no real orders)</span><span class="status-chip '+(state==='running'?'healthy':'unknown')+'" title="state.json meta.last_minute">Process: '+escape(state)+'; '+escape(s.checkpoint_age_seconds==null?'age Unknown':Math.floor(s.checkpoint_age_seconds/60)+' min')+'</span><span class="status-chip unknown">Last activity: '+stamp(s.last_activity)+'</span><span class="status-chip '+(fresh?'healthy':'unknown')+'">Data: '+(fresh?'Fresh':'Stale or missing')+'; checkpoint '+stamp(s.checkpoint_utc)+'</span></div>';
  }
  function experimentTable(rows, doc) {
    return '<div class="table-scroll" tabindex="0" role="region" aria-label="Experiment comparison"><table><thead><tr>'+['Experiment / version','Forecast','Sizing','Starting cash','Window (contract dates; CT updates)','Fill model','Days with trades','Paper profit / ROI','Live comparison','Status'].map(v=>'<th scope="col">'+v+'</th>').join('')+'</tr></thead><tbody>'+rows.map(s=>'<tr><th scope="row">'+escape(s.label)+'<br>'+escape(s.version || 'Unknown')+'</th><td>'+escape(s.forecast || 'Unknown')+'</td><td>'+escape(sizeText(s))+'</td><td>'+dollars(s.starting_cash)+'</td><td>'+escape(s.window.first_day || 'Unknown')+' to '+escape(s.window.open_ended?'open-ended':s.window.last_day || 'Unknown')+'</td><td>'+escape(fillDescription(s))+'</td><td>'+ (s.days_with_trades==null?'No finished day yet':s.days_with_trades)+'</td><td class="'+(experimentFresh(s,doc) && s.total.pnl!=null?'paper':'unknown')+'">Paper profit: '+experimentProfit(s,doc)+'</td><td>'+ (s.live_open_tier.days?'Live comparison on '+s.live_open_tier.days+' of '+s.days_done+' days':'No live result to compare')+'</td><td>'+experimentStatus(s,doc)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function sizeText(s) {
    const c=s.sizing || {}, r=c.r5 || {};
    if(c.stake_rule!=null) return c.stake_rule+(c.slice_contracts!=null?', then '+c.slice_contracts+' contracts a minute':'');
    if(c.cash_fraction!=null) return (100*c.cash_fraction)+'% of current cash per entry; at most '+c.max_new_markets+' new markets a day';
    if(c.stake_usd!=null) return dollars(c.stake_usd)+(r.rich_stake!=null || c.rich_stake!=null?' / '+dollars(r.rich_stake ?? c.rich_stake):'')+(c.day_usd!=null?', '+dollars(c.day_usd)+' a day':'');
    return 'Unknown';
  }
  function render(doc) {
    const o = doc.open_tier, fresh = feedAge(doc) != null && feedAge(doc) < 900;
    const safeTotal = t => fresh ? t : {pnl:null,positions:null};
    const bots = [['Open tier',o,'open_tier'],['Rain lock',doc.lock,'lock']];
    $('bot-guide').innerHTML = bots.map(([name,v,t])=>'<article class="bot-guide"><h3>'+name+'</h3>'+faults(v,doc)+evidence(v,doc)+rules(v,t)+'</article>').join('');
    // Retired real positions still contribute to risk until they finish.
    const liveViews = [o,doc.lock,doc.evening];
    const isOpenBet = p=>p.contracts>0 && (p.cash_pnl === undefined ? p.pnl : p.cash_pnl)==null;
    // An open tier market pinned to an unreadable ledger row is named on its own line and kept out of
    // every total; its cost is never guessed (bots.py unknown_open_positions).
    const openUnknown = o.unknown_positions || [];
    const openKnown = (o.positions || []).filter(p=>!p.unknown_fill);
    const openRows = openKnown.filter(isOpenBet);
    const rainRows = [doc.lock,doc.evening].flatMap(v=>v.entries || []).filter(isOpenBet);
    const rows = openRows.concat(rainRows);
    const unknownFill = liveViews.some(v=>(v.entries || []).some(p=>p.unknown_fill));
    const badOpenRows = (o.ledger_stats?.bad_rows || 0) + (o.ledger_stats?.bad_lines || 0);
    const scopedOpenRows = o.ledger_stats?.scoped_bad_rows || 0;
    const badRainRows = (doc.rain_ledger_stats?.bad_rows || 0) + (doc.rain_ledger_stats?.bad_lines || 0);
    const missingAmounts = list=>list.some(p=>!Number.isFinite(p.capital) || !Number.isFinite(p.cost) || !Number.isFinite(p.fee));
    const unknownAmounts = missingAmounts(rows);
    const openUncertain = badOpenRows - scopedOpenRows > 0 || !!o.ledger_uncertain;
    const rainUncertain = badRainRows > 0 || unknownFill || doc.lock.ledger_uncertain || doc.evening.ledger_uncertain;
    const openRiskUnknown = openUncertain || missingAmounts(openRows);
    const rainRiskUnknown = rainUncertain || missingAmounts(rainRows);
    const unknownRisk = openRiskUnknown || rainRiskUnknown;
    const sumCapital = list=>list.reduce((sum,p)=>sum+p.capital,0);
    const openRisk = fresh && !openRiskUnknown ? sumCapital(openRows) : null;
    const rainRisk = fresh && !rainRiskUnknown ? sumCapital(rainRows) : null;
    function combined(totals) { const known = totals.filter(t=>t && t.pnl!=null); const capital=known.reduce((n,t)=>n+t.capital,0), pnl=known.length?known.reduce((n,t)=>n+t.pnl,0):null; return {pnl,capital,roi:capital && pnl!=null ? 100*pnl/capital:null,positions:known.reduce((n,t)=>n+t.positions,0)}; }
    const noMoney = {pnl:null,capital:null,positions:null};
    const notice = '<p class="unknown">No data. Needs attention: ledger rows or fill amounts unknown; risk and result cannot be measured.</p>';
    const paper = badRainRows ? noMoney : combined([doc.paper.lock.total]);
    const st = o.status || {}, running = st.process?.value === 'running';
    const generated = new Date(doc.generated_utc);
    const clock = d => Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-GB', {timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit'}).format(d) : 'Unknown';
    const checked = clock(generated);
    const state = !fresh ? 'STALE' : running ? 'Running \u2713' : 'NOT RUNNING';
    const roiText = t => t.capital ? (t.pnl>=0?'+':'')+(100*t.pnl/t.capital).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})+'% ROI' : 'ROI n/a';
    const profitText = t => t.pnl == null ? 'No data: no finished result yet; ROI unavailable' :
      '<span class="money '+(t.pnl<0?'neg':'pos')+'">'+signed(t.pnl)+' on '+dollars(t.capital)+' spent ('+roiText(t)+')</span>';
    const openWord = n => n === 1 ? 'position' : 'positions';
    const unknownLine = list => list.length ? '<p class="unknown-cost unknown">'+list.length+' '+openWord(list.length)+' with unknown cost ('+list.map(u=>{
        const code=String(u.ticker||'').split('-').pop(), day=/\d{4}-(\d{2})-(\d{2})/.exec(u.day||'');
        const when = day ? new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(u.day+'T12:00:00Z')) : 'date unknown';
        return escape((cities[code] || code || 'Unknown city')+' '+when+', '+(u.contracts_readable==null?'contracts unknown':number(u.contracts_readable)+' contracts'));
      }).join('; ')+'). Not in any total below; cost never guessed.</p>' : '';
    // ---- Open tier (real money)
    const openProfit = safeTotal(openUncertain ? noMoney : o.as_traded);
    const excl = openUnknown.length && !openUncertain ? ' <span class="meta">(excludes '+openUnknown.length+' unknown-cost '+openWord(openUnknown.length)+')</span>' : '';
    const openBlock = '<div class="money-bot"><p class="live-state '+(!fresh || !running?'fault':'healthy')+'">Open tier: '+state+' &middot; checked '+checked+' CT</p>'+faults(o,doc)+
      '<p class="open-risk money">Open bets: '+(openRisk==null?'unknown, money at risk: unknown':number(openRows.length)+', '+dollars(openRisk)+' at risk')+excl+'</p>'+
      (openRisk!=null ? (openRows.length?'<ul class="open-bets">'+openRows.map(compactBet).join('')+'</ul>':'') : notice)+
      (fresh?unknownLine(openUnknown):'')+
      '<p>Real profit (finished trades): '+profitText(openProfit)+(openProfit.positions==null?'':' <span class="meta">('+number(openProfit.positions)+' settled)</span>')+excl+'</p>'+evidence(o,doc)+'</div>';
    // ---- dry-NO (real money). status.json "positions" counts every market ever recorded, settled
    // ones included, so it is never shown as open bets (it was the bare "6").
    const dry = doc.dry_no_live || null, book = dry?.book || {};
    const dryAge = dry?.last_scan ? Date.now()-Date.parse(dry.last_scan) : NaN;
    const dryFresh = !!dry && fresh && dryAge>=0 && dryAge<=600000;
    const dryHalted = dry?.mode === 'HALTED';
    const dryKnown = dryFresh && book.available === true;
    const dryState = !dry ? 'No data' : dryHalted ? 'Halted (HALT file)' : !dryFresh ? 'STALE' : dry.process === 'Running' && dry.mode === 'LIVE' ? 'Running \u2713' : dry.process === 'Running' ? 'Running, money mode '+escape(dry.mode || 'Unknown') : 'NOT RUNNING ('+escape(dry.process || 'Unknown')+')';
    const dryOpen = dryKnown ? book.open : null;
    const dryRisk = dryOpen ? dryOpen.at_risk : null;
    const dryProfit = dryKnown ? book.settled : noMoney;
    const dryMarkets = dryKnown ? book.markets || [] : [];
    // Codex round 4 P1 (8) / jules: every amount or count that leaves unknown-cost markets out says so beside it.
    const exclNote = n => n ? ' <span class="meta">(excludes '+n+' unknown-cost '+openWord(n)+')</span>' : '';
    const dryUnknownN = dryKnown ? (book.unknown || []).length : 0;
    const openUnknownN = openUncertain ? 0 : openUnknown.length;
    const dryBet = m => { const code=String(m.ticker||'').split('-').pop();
      return '<li>'+escape(cities[code] || code)+' &middot; '+escape(m.day || 'Date unknown')+' &middot; NO &middot; '+number(m.contracts)+' contracts &middot; '+dollars(m.capital)+(m.open?' &middot; waiting for result':' &middot; '+escape(String(m.result).toUpperCase())+' settled, '+(m.pnl>=0?'won ':'lost ')+signed(m.pnl))+'</li>'; };
    const dryBlock = !dry ? '' : '<div class="money-bot"><p class="live-state '+(dryHalted?'':dryFresh && dry.process==='Running'?'healthy':'fault')+'">dry-NO: '+dryState+(dry.last_scan?' &middot; last scan '+clock(new Date(dry.last_scan))+' CT':'')+'</p>'+
      '<p class="open-risk money">Open bets: '+(dryRisk==null?'unknown, money at risk: unknown':number(dryOpen.positions)+', '+dollars(dryRisk)+' at risk'+exclNote(dryUnknownN))+'</p>'+
      (dryOpen && dryOpen.positions ? '<ul class="open-bets">'+dryMarkets.filter(m=>m.open).map(dryBet).join('')+'</ul>' : '')+
      (dryKnown && book.resting?.orders ? '<p class="meta">Resting buy orders: '+number(book.resting.orders)+', '+dollars(book.resting.reserved)+' reserved (not counted as at risk).</p>' : '')+
      (dryKnown ? unknownLine(book.unknown || []) : '')+
      '<p>Real profit (finished trades): '+profitText(dryProfit)+(dryProfit.positions==null?'':' <span class="meta">('+number(dryProfit.positions)+' settled, '+number(dryProfit.wins)+' won)</span>')+(dryProfit.pnl==null?'':exclNote(dryUnknownN))+'</p>'+
      '<details class="bot-evidence"><summary>Details</summary><p>Markets traded: '+(dryKnown?number(dryMarkets.length)+' ('+number(dryMarkets.filter(m=>!m.open).length)+' settled, '+number(dryMarkets.filter(m=>m.open).length)+' open)'+exclNote(dryUnknownN):'unknown')+'. Source: '+escape(book.source || 'state.json and ledger.ndjson')+'.</p>'+
      (dryMarkets.length?'<ul class="open-bets">'+dryMarkets.map(dryBet).join('')+'</ul>':'')+
      '<p>Process: '+escape(dry.process || 'Unknown')+'; money mode: '+escape(dry.mode || 'Unknown')+'; last status '+escape(dry.reason || 'No data')+' at '+stamp(dry.last_scan)+'.</p></details></div>';
    // ---- Every real-money bot together
    const allRisk = openRisk!=null && rainRisk!=null && (!dry || dryRisk!=null) ? openRisk+rainRisk+(dryRisk||0) : null;
    const allBets = rows.length + (dryOpen ? dryOpen.positions : 0);
    const allProfit = unknownRisk || (dry && !dryKnown) ? noMoney : safeTotal(combined([o.as_traded,doc.lock.total,doc.evening.total,dryProfit]));
    const anyUnknown = openUnknownN + dryUnknownN;
    const allBlock = '<div class="money-total"><p class="money"><strong>All real-money bots (open tier, dry-NO, rain lock, Evening NO retired):</strong> '+(allRisk==null?'open bets unknown, money at risk unknown':'open bets '+number(allBets)+', '+dollars(allRisk)+' at risk'+exclNote(anyUnknown))+'</p><p>Real profit (finished trades), all real-money bots: '+profitText(allProfit)+(allProfit.positions==null?'':' <span class="meta">('+number(allProfit.positions)+' settled)</span>')+(allProfit.pnl==null?'':exclNote(anyUnknown))+'</p></div>';
    $('overview').innerHTML = '<div class="live-money"><h3 class="money-group">Real money</h3>'+openBlock+dryBlock+
      (doc.lock.status?.money?.value==='halted'?haltLine(doc.lock,doc):'<h3>Rain lock</h3>'+faults(doc.lock,doc)+evidence(doc.lock,doc))+allBlock+
      '<details><summary>Risk and contract dates</summary><p>Open right now (open tier and rain lock): '+dollars(fresh && !unknownRisk ? sumCapital(rows) : null)+' across '+(fresh && !unknownRisk?number(rows.length)+' trades'+exclNote(openUnknownN):'unknown trades')+'; dry-NO: '+dollars(dryRisk)+' across '+(dryOpen?number(dryOpen.positions)+' trades'+exclNote(dryUnknownN):'unknown trades')+'</p><p>Contract dates: '+escape(rows.length?(()=>{const d=rows.map(p=>p.day || 'Unknown').sort();return d[0]===d[d.length-1]?d[0]:d[0]+' to '+d[d.length-1];})():'No open dates recorded')+' (station local day). Snapshot '+stamp(doc.generated_utc)+'. Includes earlier real trades still open. Excludes resting buy reservations.</p></details></div>'+
      '<div class="overview-secondary"><h3>Paper (no real orders) and hypothetical</h3>'+totals('Paper profit (finished trades)',safeTotal(paper))+totals('If held (hypothetical, Open tier'+(openUnknownN?', excluding '+openUnknownN+' unknown-cost '+openWord(openUnknownN):'')+')',safeTotal(openUncertain?noMoney:o.if_held))+'<p><a href="#definitions">Definitions: open right now, profit, ROI and if held</a></p></div>';
    const attention=[];
    if(openUncertain || unknownAmounts) attention.push('Open tier or unfinished real position: ledger rows or fill amounts unknown. Current total risk cannot be measured.');
    if(!openUncertain && openUnknown.length) attention.push('Open tier: '+openUnknown.length+' '+openWord(openUnknown.length)+' with unknown cost ('+openUnknown.map(u=>u.ticker).join(', ')+'); every total excludes '+(openUnknown.length===1?'it':'them')+'.');
    if(dry && !dryHalted && dryFresh && dry.process!=='Running') attention.push('dry-NO LIVE: process '+(dry.process || 'Unknown')+'.');
    if(dry && !dryHalted && !dryFresh) attention.push('dry-NO LIVE: status stale or missing; last scan '+stamp(dry.last_scan)+'.');
    if(dry && dryFresh && book.available === false) attention.push('dry-NO LIVE: real money cannot be measured; '+(book.uncertain_reason || 'records unreadable')+'.');
    if(dryKnown && (book.unknown || []).length) attention.push('dry-NO LIVE: '+book.unknown.length+' '+openWord(book.unknown.length)+' with unknown cost ('+book.unknown.map(u=>u.ticker+': '+u.reason).join('; ')+'); every total excludes '+(book.unknown.length===1?'it':'them')+'.');
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
    const retiredNames=['opus_r5','r5_size','codex_r4','fmode_w6','fmode_highest','fmode_w8','size_75','size_100','size_150','dry_no','dry_no_fresh','dry_no_fresh_100','r3_shadow','argon_r4'];
    const retired={...(doc.retired || {})};
    const historical={...(doc.shadows || {}),...(doc.size_tests || {})};
    const finished=s=>s?.status==='unavailable' || s?.status_reason==='Ledger missing' ? {pnl:null,capital:null} : s?.total || {pnl:null,capital:null};
    retiredNames.forEach(n=>{if (!retired[n]) retired[n]={label:historical[n]?.label || n,results:{paper:finished(historical[n])}};});
    if (!retired.evening) retired.evening={label:'Evening NO',results:{real:doc.evening?.total || {},paper:doc.paper.evening?.total || {}}};
    if (!retired.prime) retired.prime={label:'Prime',results:{paper:doc.paper.prime?.total || {}}};
    const experiments=Object.entries(historical).filter(([n])=>!retired[n]).map(([,s])=>s);
    experiments.forEach(s=>{if (s.status!=='running' && s.status!=='finished') attention.push(s.label+': '+s.status+'; '+(s.status_reason || '')+'; '+stamp(s.checkpoint_utc));});   // live-match coverage lives in the Experiments table, not here
    attention.push(...(doc.warnings || []));
    $('attention').innerHTML = (attention.length ? '<ul class="fault">'+attention.map(s=>'<li>'+escape(s)+'</li>').join('')+'</ul>' : '<p>All reported checks passed.</p>')+
      [...halts].map(([reason,names])=>'<details><summary>Halted on purpose: '+escape(names.join(', '))+'</summary><p>'+escape(reason)+'</p></details>').join('');
    $('lock-history').open = doc.lock.status?.money?.value !== 'halted';
    const exclLabel = openUnknown.length && !openUncertain ? ', excluding '+openUnknown.length+' unknown-cost '+openWord(openUnknown.length) : '';
    $('open-summary').innerHTML = chips(o,doc)+rules(o,'open_tier')+(openUncertain?notice:fresh?unknownLine(openUnknown):'')+totals('Real profit'+exclLabel,safeTotal(openUncertain?noMoney:o.as_traded))+totals('If held (hypothetical'+exclLabel+')',safeTotal(openUncertain?noMoney:o.if_held))+'<p>Total spent so far'+exclLabel+': '+dollars(fresh && !openUncertain?o.deployed:null)+'</p>'+(o.contract_days || []).map(u=>'<p>'+u.entries+' of '+value(u.entry_limit)+' entries; '+dollars(openUncertain?null:u.capital)+' of '+dollars(u.dollar_limit)+' filled for '+escape(u.contract_day)+'. '+u.pending_entries+' pending entries included.</p>').join('');
    $('open-positions').innerHTML = fresh ? (openUncertain?notice:positionList(o.positions,openPosition,'No real positions recorded.')) : '<p class="unknown">No data: stale feed.</p>';
    if ($('dry-summary')) {
      const caps = dry?.caps || {};
      $('dry-summary').innerHTML = !dry ? '<p class="unknown">No data: dry-NO status not in the feed.</p>' :
        '<div class="status-chips"><span class="status-chip '+(dryHalted?'unknown':dryFresh && dry.mode==='LIVE'?'real':'unknown')+'">Money: '+(dryHalted?'Halted':dryFresh && dry.mode==='LIVE'?'Real money':dryFresh && dry.mode==='PAPER'?'Paper (no real orders)':'Unknown')+'</span><span class="status-chip '+(dryFresh && dry.process==='Running'?'healthy':'unknown')+'">Process: '+escape(dry.process || 'Unknown')+'</span><span class="status-chip unknown">Last scan: '+stamp(dry.last_scan)+'</span></div>'+
        '<p>Buys No rain (NO) at up to 40c when every forecast rain chance stays at or below 40%; holds to settlement. Caps: '+dollars(caps.per_market_usd)+' a market, '+dollars(caps.open_exposure_cap_usd)+' open at once, '+value(caps.max_markets_per_day)+' markets a day, cash floor '+dollars(caps.cash_floor_usd)+'; rule '+escape(caps.rule || 'Unknown')+'.</p>'+
        (dryKnown ? unknownLine(book.unknown || []) : '')+
        '<p class="'+(dryProfit.pnl==null?'unknown':'real')+'">Real profit: '+(dryProfit.pnl==null?'No data: no finished result yet; ROI unavailable':performance(dryProfit.pnl,dryProfit.capital)+exclNote(dryUnknownN))+(dryProfit.positions==null?'':' <span class="meta">('+number(dryProfit.positions)+' settled, '+number(dryProfit.wins)+' won)</span>')+'</p>'+
        '<p>Open bets: '+(dryRisk==null?'unknown, money at risk: unknown':number(dryOpen.positions)+', '+dollars(dryRisk)+' at risk'+exclNote(dryUnknownN))+'</p>';
      $('dry-positions').innerHTML = dryKnown ? (dryMarkets.length?'<ul class="open-bets">'+dryMarkets.slice().reverse().map(dryBet).join('')+'</ul>':'<p>No real positions recorded.</p>') : '<p class="unknown">No data: '+escape(dryFresh?(book.uncertain_reason || 'dry-NO records unreadable'):'stale or missing status')+'.</p>';
    }
    ['lock'].forEach(t=>{const v=doc[t]; $(t+'-summary').innerHTML=chips(v,doc)+(t==='lock'?rules(v,t):'')+(rainUncertain?notice:'')+totals('Real profit',safeTotal(rainUncertain?noMoney:v.total)); $(t+'-positions').innerHTML=fresh?(rainUncertain?notice:positionList(v.entries,p=>rainPosition(p,true),'No filled real entries recorded.')):'<p class="unknown">No data: stale feed.</p>';});
    ['lock'].forEach(t=>{const v=doc.paper[t], prefix=t==='prime'?t:t+'-paper'; $(prefix+'-summary').innerHTML=chips(v,doc)+rules(v,t)+(badRainRows?notice:'')+totals('Paper profit',safeTotal(badRainRows?noMoney:v.total)); $(prefix+'-positions').innerHTML=fresh?(badRainRows?notice:positionList(v.entries,p=>rainPosition(p,false),'No filled paper entries recorded.')):'<p class="unknown">No data: stale feed.</p>';});
    $('shadow-index').innerHTML=''; $('shadow-comparison').innerHTML='';
    const groups = [...new Set(experiments.map(s=>s.group))];
    $('shadow-tests').innerHTML = groups.map(g=>'<h2 class="shadow-group">'+escape(g)+'</h2><p>'+ (g==='Live twin'?'Pinned Round 5 policy; reconstructed decision-time live cash and reserves. Evidenced live buys on shared markets, broker REAL-FILL elsewhere. Contemporaneous matches and reconstructions shown separately.':g==='WO-149 round 4 paper tests'?'Frozen WO-149 round 4 entries, each with its own $1,000 paper account; open-ended; broker REAL-FILL ratio capacity in whole contracts (round 8 referee), then book and print depth. Readable fill ledgers on the box: paper/argon_r4/ledger.csv and paper/claude_r4/ledger.csv.':g==='Jules round 7 compounding paper test'?'Own paper account; stake 30% of current cash; open-ended; broker REAL-FILL ratio capacity, then book and print depth.':g==='Round 8 dry-NO paper test'?'Original dry-NO rule at $100 a market, the paper twin of the live dry-NO bot; own paper account; REAL-FILL retains the Amendment 1 pinned ratio guard, then book and print depth; no second broker cap.':g==='Open-ended size tests'?'Pinned Round 5 paper sizes; open-ended; REAL-FILL ratio capacity, then book and print depth.':'Fixed 14-day policies; REAL-FILL ratio capacity, then book and print depth.')+'</p>'+experimentTable(experiments.filter(s=>s.group===g),doc)+'<details><summary>Experiment rules, evidence and trade details</summary>'+experiments.filter(s=>s.group===g).map(s=>experiment(s,doc)).join('')+'</details>').join('');
    const glanceRows=bots.map(([name,v])=>[name,evidence(v,doc),shadowResult(safeTotal(name==='Open tier' && openUncertain ? noMoney : v.as_traded || v.total)),
      v.status?.money?.value || 'unknown', name==='Open tier' ? (openRisk==null?null:openRows.length) : (rainRisk==null?null:(v.entries || []).filter(isOpenBet).length), faults(v,doc), name==='Open tier' ? exclNote(openUnknownN) : ''])
      .concat(experiments.map(s=>[s.label,'<details><summary>Details</summary>'+experimentStatus(s,doc)+'<p>'+escape(s.status_reason)+'</p></details>',experimentProfit(s,doc),'paper', experimentFresh(s,doc)?s.open_positions:null,
        experimentFresh(s,doc)?'':'<p class="fault">Data: '+escape(s.status)+'; '+escape(s.status_reason)+'</p>']));
    if (dry) {
      const caps=dry.caps || {};
      // Real money: it goes with the other real-money rows, ahead of every paper runner.
      glanceRows.splice(bots.length, 0, [dry.name || 'dry-NO LIVE', '<p>Process: '+escape(dry.process || 'Unknown')+'; last scan/status update: '+stamp(dry.last_scan)+'</p><p>Last status: '+escape(dry.reason || 'No data')+'</p><details><summary>Caps</summary><p>Caps: per market '+dollars(caps.per_market_usd)+'; open exposure '+dollars(caps.open_exposure_cap_usd)+'; budget '+dollars(caps.total_budget_usd)+'; cash floor '+dollars(caps.cash_floor_usd)+'; markets/day '+value(caps.max_markets_per_day)+'; rule '+escape(caps.rule || 'Unknown')+'; live enabled '+escape(caps.live===true?'yes':caps.live===false?'no':'Unknown')+'</p><p>Markets recorded since it started: '+value(dry.positions)+' (settled and open; not an open-bet count).</p></details>', dryProfit.pnl==null?'No data: no finished result yet':performance(dryProfit.pnl,dryProfit.capital), dryHalted?'halted':dryFresh && dry.mode==='LIVE'?'real':dryFresh && dry.mode==='PAPER'?'paper':'unknown', dryOpen?dryOpen.positions:null, '', exclNote(dryUnknownN)]);
    }
    const glanceTable = (label, list) => '<h3 class="money-group">'+label+'</h3><div class="table-scroll" tabindex="0"><table class="strategy-table"><thead><tr><th>Strategy</th><th>Status</th><th>Finished result / ROI</th><th>Open bets</th></tr></thead><tbody>'+list.map(([name,status,result,mode,count,warnings,note])=>'<tr><th scope="row">'+escape(name)+'</th><td><span class="status-chip '+(mode==='real'?'real':mode==='paper'?'paper':'unknown')+'">Money: '+escape({real:'Real money',paper:'Paper (no real orders)',halted:'Halted'}[mode] || 'Unknown')+'</span>'+warnings+status+'</td><td>'+result+(/No data/.test(result)?'':(note || ''))+'</td><td>Open bets: '+ (count==null?'unknown':number(count)+(note || ''))+'</td></tr>').join('')+'</tbody></table></div>';
    const realCount = bots.length + (dry ? 1 : 0);
    $('at-glance').innerHTML=glanceTable('Real money', glanceRows.slice(0, realCount))+glanceTable('Paper (no real orders)', glanceRows.slice(realCount));
    $('retired-count').textContent = String(Object.keys(retired).length);
    $('retired-results').innerHTML='<ul>'+Object.values(retired).map(v=>'<li>'+escape(v.label)+': '+Object.entries(v.results).map(([mode,t])=>escape(mode)+': '+shadowResult(t)).join('; ')+'</li>').join('')+'</ul>';
    $('warnings').innerHTML = (doc.warnings || []).map(w=>'<p>'+escape(w)+'</p>').join('');
    // Comparison fields become labelled rows on a phone; all values stay available.
    document.querySelectorAll('.table-scroll table').forEach(table => {
      const labels = Array.from(table.querySelectorAll('thead th'), th => th.textContent);
      table.querySelectorAll('tbody tr').forEach(row => Array.from(row.children).forEach((cell,i) => { cell.dataset.label = labels[i] || ''; }));
    });
    $('load-status').textContent = 'Ledger snapshot: '+stamp(doc.generated_utc)+'. '+(fresh?'Fresh.':'Stale or missing data. No data shown as current money.')+' Refreshes every minute.';
  }
  function twinComparison(s,fresh) {
    if (s.name!=='live_twin') return '';
    if (!fresh) return '<p class="unknown">Twin comparison unavailable: stale feed.</p>';
    const rows=s.market_comparison || [];
    const checks=s.ask_checks || [];
    return '<h4>Twin vs live by market</h4><p>Contracts bought, contracts still held, buy cost and realized P&amp;L. Pending P&amp;L stays unknown.</p><div class="table-scroll"><table><thead><tr><th>Market / side</th><th>Twin contracts / held</th><th>Live contracts / held</th><th>Twin / live cost</th><th>Twin / live P&amp;L</th><th>Every difference</th></tr></thead><tbody>'+rows.map(r=>'<tr><th>'+escape(r.ticker)+' / '+escape(r.side)+'</th><td>'+value(r.twin.contracts)+' / '+value(r.twin.held)+'</td><td>'+value(r.live.contracts)+' / '+value(r.live.held)+'</td><td>'+dollars(r.twin.cost)+' / '+dollars(r.live.cost)+'</td><td>'+dollars(r.twin.pnl)+' / '+dollars(r.live.pnl)+'</td><td>'+escape(r.differences.join('; ') || 'No measured difference')+'</td></tr>').join('')+'</tbody></table></div>'+checks.map(r=>'<p class="'+(r.kind==='live_twin_ask_match' && !r.reconstructed && r.contemporaneous!==false?'paper':'unknown')+'">'+escape(r.ticker)+' slot '+value(r.slot==null?0:r.slot)+': first ask twin '+value(r.twin_first)+', live '+value(r.live_first)+'; '+(r.same_minute?'same minute':'different minute')+'.'+(r.kind==='live_twin_ask_reconstructed' || r.reconstructed?' Reconstructed; contemporaneous no; observed '+stamp(r.observed_ts)+'; lag '+value(r.lag_seconds)+'s.':r.kind==='live_twin_ask_match' && r.contemporaneous!==false?' Match; contemporaneous yes.':'')+(r.reason?' '+escape(r.reason)+'.':'')+'</p>').join('');
  }
  function clear(message) {
    document.querySelectorAll('#overview, .ledger-summary, .ledger-rows, #attention, #bot-guide, #retired-results').forEach(e => { e.replaceChildren(); });
    $('warnings').replaceChildren();
    $('load-status').textContent = message;
    $('load-status').classList.add('banner');
    $('overview').innerHTML = '<p class="fault">Real-money bots: STALE. Current data unavailable.</p>';
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
    if (focus || loading === false) $(tab.getAttribute('aria-controls')).scrollIntoView({block:'start'});
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => select(tab, false);
    tab.onkeydown = event => {
      const target = {ArrowRight:(index + 1) % tabs.length, ArrowLeft:(index + tabs.length - 1) % tabs.length, Home:0, End:tabs.length - 1}[event.key];
      if (target != null) { event.preventDefault(); select(tabs[target], true); }
    };
  });
  const tabBar = document.querySelector('.bot-tabs');
  new ResizeObserver(() => document.documentElement.style.setProperty('--bot-tabs-height', tabBar.getBoundingClientRect().height+'px')).observe(tabBar);
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
