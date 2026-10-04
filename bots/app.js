(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const dollars = n => '$' + Number(n).toFixed(2);
  const signed = n => (n < -0.0049 ? '-' : n > 0.0049 ? '+' : '') + dollars(Math.abs(n));
  const number = n => Number(n).toLocaleString('en-US', {maximumFractionDigits: 2});
  const cents = n => n == null ? 'Not recorded' : number(n * 100) + 'c';
  function performance(pnl, capital) {
    const roi = capital ? ((pnl >= 0 ? '+' : '') + (100 * pnl / capital).toFixed(1) + '% ROI') : 'ROI n/a';
    return '<span class="money ' + (pnl < 0 ? 'neg' : 'pos') + '">' + signed(pnl) + ' on ' + dollars(capital) + ' capital, ' + roi + '</span>';
  }
  function totals(label, t) {
    return '<p>' + escape(label) + ': ' + (t.pnl == null ? 'No resolved P&amp;L yet; $0.00 scored capital, ROI n/a' : performance(t.pnl, t.capital))
      + ' <span class="meta">(' + t.positions + ' scored' + (t.pending ? ', ' + t.pending + ' pending' : '') + ')</span></p>';
  }
  const fact = (label, value) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>';
  function heading(p) {
    return '<div class="position-heading"><h3>' + escape(p.ticker) + '</h3><p>' + escape(p.entered_ct) + ' CT</p></div>';
  }
  let settlementsRead = '';
  function result(p) {
    return p.result ? p.result.toUpperCase() + ' settled; ' + (p.result === p.side ? 'held side won' : 'held side lost') : 'Result not read yet; the tracker reads at 07:30 CT' + settlementsRead;
  }
  function openPosition(p) {
    return '<article class="position">' + heading(p) + '<dl class="ledger-facts">'
      + fact('Contract day', p.day) + fact('Side', p.side.toUpperCase())
      + fact('Entry gap', p.gap == null ? 'Not recorded' : number(p.gap) + ' points')
      + fact('Entry slot / hour after open', p.slot == null ? 'Not recorded' : 'Slot ' + p.slot)
      + fact('Contracts', number(p.contracts) + ' in ' + p.legs + ' buy ' + (p.legs === 1 ? 'leg' : 'legs'))
      + fact('VWAP', cents(p.vwap)) + fact('Capital with fees', dollars(p.capital))
      + fact('Exit rule', p.exit) + fact('Sell status / target', p.sell_status + ' / ' + cents(p.target))
      + fact('Contracts sold', number(p.sold) + ' of ' + number(p.contracts))
      + fact('Sell proceeds / fees', dollars(p.proceeds) + ' / ' + dollars(p.sell_fee))
      + fact('Result', result(p)) + '</dl>'
      + '<p class="pnl-line">As traded: ' + (p.cash_pnl == null ? (p.cash_note === 'sell unresolved' ? 'Sell unresolved' : 'Pending') + ', ' + dollars(p.capital) + ' capital, ROI pending' : performance(p.cash_pnl, p.capital)) + '</p>'
      + '<p class="pnl-line">If held: ' + (p.hold_pnl == null ? 'Not settled yet, ' + dollars(p.capital) + ' capital, ROI pending' : performance(p.hold_pnl, p.capital)) + '</p></article>';
  }
  function rainPosition(p, live) {
    return '<article class="position">' + heading(p) + '<dl class="ledger-facts">'
      + fact('Contract day', p.day || 'Not recorded') + fact('Side', p.side.toUpperCase())
      + fact('Avg incl. rounding', cents(p.price)) + fact('Contracts', number(p.contracts))
      + fact('Cost / fees', dollars(p.cost) + ' / ' + dollars(p.fee))
      + fact('Outcome', p.filled ? result(p) : (live ? 'No live fill' : 'No paper fill')) + '</dl>'
      + '<p class="pnl-line">' + (live ? 'Live' : 'Paper') + ' P&amp;L: ' + (p.pnl == null ? (p.filled ? 'Pending' : 'No fill') + ', ' + dollars(p.capital) + ' capital, ROI ' + (p.filled ? 'pending' : 'n/a') : performance(p.pnl, p.capital)) + '</p></article>';
  }
  // the runner's comparison status, in plain words; a complete realized day needs no note
  function liveNote(status) {
    const words = {realized_rows: '', no_realized_rows: ' (live had no settled trades that day)'};
    const w = Object.prototype.hasOwnProperty.call(words, status) ? words[status] : (status ? ' (' + String(status).replace(/_/g, ' ') + ')' : '');
    return escape(w);
  }
  function positionList(entries, renderer, empty) {
    const filled = entries.filter(entry => Number(entry.contracts) > 0);
    const hidden = entries.length - filled.length;
    const note = hidden ? '<p class="meta">' + hidden + ' ' + (hidden === 1 ? 'attempt that never filled is' : 'attempts that never filled are') + ' hidden.</p>' : '';
    if (!filled.length) return note + '<p>' + empty + '</p>';
    const latest = filled.slice(0, 20).map(renderer).join('');
    if (filled.length <= 20) return note + latest;
    return note + latest + '<details class="older-positions"><summary>Show all ' + filled.length + ' entries</summary>'
      + filled.slice(20).map(renderer).join('') + '</details>';
  }
  function shadowResult(t) {
    return t && t.pnl != null ? performance(t.pnl, t.capital) : 'Pending, $0.00 scored capital, ROI n/a';
  }
  function shadowPosition(p) {
    return '<article class="position"><h3>' + escape(p.ticker) + '</h3><dl class="ledger-facts">'
      + fact('Side / contracts', p.side.toUpperCase() + ' / ' + number(p.contracts))
      + fact('Price / cost', cents(p.price) + ' / ' + dollars(p.cost))
      + fact('Buy fees', dollars(p.fee)) + fact('Result', p.result || 'Open') + '</dl><p>'
      + (p.pnl == null ? 'Pending, ' + dollars(p.capital) + ' capital, ROI pending' : performance(p.pnl, p.capital)) + '</p></article>';
  }
  function shadowView(s) {
    let html = '<article class="shadow-test"><h2>' + escape(s.label) + ' <small>PAPER</small></h2><p>' + escape(s.description) + '</p>';
    if (s.status === 'not started yet') return html + '<p>Not started yet.</p></article>';
    html += '<p>' + escape(s.window.first_day) + ' to ' + escape(s.window.last_day) + '; ' + escape(s.status) + '</p>'
      + '<div class="ledger-summary"><p>' + shadowResult(s.total) + '; ' + s.days_done + ' ' + (s.days_done === 1 ? 'day' : 'days') + ' done of 14.</p>'
      + '<p>Versus live open tier on ' + s.live_open_tier.days + ' of ' + s.days_done + ' completed days: paper '
      + shadowResult(s.matched_total) + '; live ' + shadowResult(s.live_open_tier) + '.</p>'
      + '<p>Paper cash: ' + (s.paper_cash == null ? 'Not recorded' : dollars(s.paper_cash)) + '; ' + s.open_positions + ' open positions.</p></div>';
    html += '<h3>Daily results</h3>' + (s.daily.length ? s.daily.map(r => '<div class="shadow-daily"><p>' + escape(r.day) + ': '
      + shadowResult(r) + '</p><p>Fees ' + dollars(r.fees || 0) + '; ' + number(r.orders || 0) + ' orders. Live open tier: '
      + shadowResult(r.live_open_tier) + liveNote(r.live_open_tier.status) + '.</p></div>').join('') : '<p>No completed days yet.</p>');
    html += '<h3>Open positions</h3>' + positionList(s.entries.filter(p => p.pnl == null), shadowPosition, 'No open paper positions.')
      + '<h3>Settled entries</h3>' + positionList(s.entries.filter(p => p.pnl != null), shadowPosition, 'No settled paper entries yet.') + '</article>';
    return html;
  }
  function render(doc) {
    const o = doc.open_tier;
    settlementsRead = doc.settlements_last_read_utc ? '; settlements last read '
      + new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago', hour:'numeric', minute:'2-digit'}).format(new Date(doc.settlements_last_read_utc)) + ' CT' : '';
    $('open-summary').innerHTML = totals('As traded', o.as_traded) + totals('If held', o.if_held)
      + '<p>' + o.open_positions + ' open ' + (o.open_positions === 1 ? 'position' : 'positions') + '; ' + dollars(o.deployed) + ' total capital deployed.</p>'
      + (o.contract_days || []).map(usage => '<p class="usage">Contract day ' + escape(usage.contract_day) + ': ' + usage.entries + ' of '
        + (usage.entry_limit == null ? 'limit not recorded' : usage.entry_limit) + ' entries; ' + dollars(usage.capital) + ' of '
        + (usage.dollar_limit == null ? 'limit not recorded' : dollars(usage.dollar_limit)) + ' filled.</p><p class="meta">'
        + usage.pending_entries + ' pending ' + (usage.pending_entries === 1 ? 'entry' : 'entries') + ' included in entry usage. Filled dollars exclude resting buy reserves.</p>').join('')
      + '<p class="meta">' + escape(o.rule) + '</p>';
    $('open-positions').innerHTML = positionList(o.positions, openPosition, 'No live positions yet.');
    [['lock', 'Lock'], ['evening', 'Evening NO']].forEach(([tier, name]) => {
      const live = doc[tier] || {entries: [], total: {pnl: null, capital: 0, positions: 0, pending: 0}, open_positions: 0, deployed: 0};
      $(tier + '-summary').innerHTML = totals('Live P&L', live.total) + '<p>' + live.open_positions + ' open ' + (live.open_positions === 1 ? 'position' : 'positions') + '; ' + dollars(live.deployed) + ' total live capital deployed.</p>';
      $(tier + '-positions').innerHTML = positionList(live.entries, p => rainPosition(p, true), 'No filled live ' + name + ' entries yet.');
    });
    ['lock', 'prime', 'evening'].forEach(tier => {
      const t = doc.paper[tier];
      const prefix = tier === 'prime' ? tier : tier + '-paper';
      $(prefix + '-summary').innerHTML = totals('Paper P&L', t.total) + '<p>' + t.open_positions + ' open ' + (t.open_positions === 1 ? 'position' : 'positions') + '; ' + dollars(t.deployed) + ' total paper capital deployed.</p>';
      $(prefix + '-positions').innerHTML = positionList(t.entries, p => rainPosition(p, false), 'No filled paper entries yet.');
    });
    $('warnings').innerHTML = (doc.warnings || []).map(w => '<p>' + escape(w) + '</p>').join('');
    const comparison = doc.shadow_comparison || {days: []};
    $('shadow-comparison').innerHTML = '<p>Forecast comparison on ' + comparison.days.length + ' common completed ' + (comparison.days.length === 1 ? 'day' : 'days') + '.</p><div class="shadow-comparison-row">'
      + '<p>Combined: ' + shadowResult(comparison.fmode_combined) + '</p><p>Highest window: ' + shadowResult(comparison.fmode_highest) + '</p><p>Weighted 6: ' + shadowResult(comparison.fmode_w6)
      + '</p><p>Weighted 8: ' + shadowResult(comparison.fmode_w8) + '</p></div>';
    $('shadow-tests').innerHTML = Object.values(doc.shadows || {}).map(shadowView).join('');
    const stamp = new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago', dateStyle:'medium', timeStyle:'short'}).format(new Date(doc.generated_utc));
    $('load-status').textContent = 'Ledger snapshot: ' + stamp + ' CT. Refreshes every minute.';
  }
  function clear(message) {
    document.querySelectorAll('.ledger-summary, .ledger-rows').forEach(e => { e.replaceChildren(); });
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
