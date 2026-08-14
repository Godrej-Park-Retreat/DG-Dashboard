let DATA = null;
let charts = {};

const money = (n, d=0) => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })} L`;
const hours = (n) => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} h`;
const num = (n, d=2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

async function load() {
  const status = document.getElementById('statusLine');
  try {
    const res = await fetch(`data/data.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
    initFilters();
    render();
    status.textContent = `Data through ${DATA.date_to || '—'} · Generated ${new Date(DATA.generated_at).toLocaleString('en-IN')}`;
    document.getElementById('footerUpdated').textContent = new Date(DATA.generated_at).toLocaleString('en-IN');
  } catch (err) {
    status.textContent = `Unable to load dashboard data: ${err.message}`;
    document.getElementById('alerts').innerHTML = `<div class="alert bad">Dashboard data could not be loaded. Check the GitHub Actions update job and data/data.json.</div>`;
  }
}

function initFilters() {
  const month = document.getElementById('monthSelect');
  const dg = document.getElementById('dgSelect');
  month.innerHTML = '<option value="ALL">All Months</option>' + DATA.months.map(m => `<option value="${m}">${formatMonth(m)}</option>`).join('');
  dg.innerHTML = '<option value="ALL">All DGs</option>' + DATA.dgs.map(d => `<option value="${d}">${d}</option>`).join('');
  month.addEventListener('change', render);
  dg.addEventListener('change', render);
  document.getElementById('refreshBtn').addEventListener('click', () => location.reload());
}

function selected() {
  return { month: document.getElementById('monthSelect').value, dg: document.getElementById('dgSelect').value };
}

function filteredMonthly() {
  const { month, dg } = selected();
  return DATA.monthly.filter(r => (month === 'ALL' || r.month === month) && (dg === 'ALL' || r.dg === dg));
}

function aggregate(rows) {
  const out = { running_hours:0, consumption:0, fuel_added:0, opening_stock:0, closing_stock:0, fuel_pending:0, excess_stock:0, adjustment:0 };
  rows.forEach((r, i) => {
    out.running_hours += Number(r.running_hours || 0);
    out.consumption += Number(r.consumption || 0);
    out.fuel_added += Number(r.fuel_added || 0);
    out.fuel_pending += Number(r.fuel_pending || 0);
    out.excess_stock += Number(r.excess_stock || 0);
    out.adjustment += Number(r.adjustment || 0);
    if (i === 0) out.opening_stock += Number(r.opening_stock || 0);
    out.closing_stock += Number(r.closing_stock || 0);
  });
  out.avg_lph = out.running_hours ? out.consumption / out.running_hours : 0;
  return out;
}

function currentForSelection() {
  const { dg } = selected();
  const curr = dg === 'ALL' ? DATA.current : DATA.current.filter(x => x.dg === dg);
  return curr;
}

function render() {
  const rows = filteredMonthly();
  const total = aggregate(rows);
  const current = currentForSelection();
  const stock = current.reduce((s,r) => s + Number(r.stock || 0), 0);
  const pending = current.reduce((s,r) => s + Number(r.fuel_pending || 0), 0);
  const excess = current.reduce((s,r) => s + Number(r.excess_stock || 0), 0);

  document.getElementById('kpiRuntime').textContent = hours(total.running_hours);
  document.getElementById('kpiConsumption').textContent = money(total.consumption);
  document.getElementById('kpiLph').textContent = `${num(total.avg_lph)} L/hr`;
  document.getElementById('kpiAdded').textContent = money(total.fuel_added);
  document.getElementById('kpiStock').textContent = money(stock);
  document.getElementById('kpiPending').textContent = money(pending);
  document.getElementById('kpiExcess').textContent = money(excess);

  const { month, dg } = selected();
  document.getElementById('filterSummary').textContent = `${month === 'ALL' ? 'All Months' : formatMonth(month)} · ${dg === 'ALL' ? 'All DGs' : dg}`;

  renderCharts(rows);
  renderTable(rows);
  renderAlerts(current, rows);
  renderRunningBreakdown(rows);
}

function renderRunningBreakdown(rows) {
  const byDg = {};
  DATA.dgs.forEach(d => byDg[d] = 0);
  rows.forEach(r => { byDg[r.dg] = (byDg[r.dg] || 0) + Number(r.running_hours || 0); });
  const yard1 = ['DG1','DG2','DG3'];
  const yard2 = ['DG4','DG5','DG6'];
  const fmt = (v) => `${Number(v||0).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} h`;
  const total = Object.values(byDg).reduce((s,v)=>s+v,0);
  const yardHtml = `
    <div><strong>Total:</strong> ${fmt(total)}</div>
    <div style="margin-top:8px"><strong>Yard 1</strong>: ${yard1.map(d=>`${d}: ${fmt(byDg[d])}`).join(' · ')}</div>
    <div style="margin-top:6px"><strong>Yard 2</strong>: ${yard2.map(d=>`${d}: ${fmt(byDg[d])}`).join(' · ')}</div>
  `;
  const el = document.getElementById('runningList');
  if (el) el.innerHTML = yardHtml;
}

function monthSeries(rows, key) {
  const months = DATA.months;
  return months.map(m => rows.filter(r => r.month === m).reduce((s,r) => s + Number(r[key] || 0), 0));
}

function makeChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

const common = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false } }, y:{ beginAtZero:true } } };

function renderCharts(rows) {
  const { month, dg } = selected();
  const chartRows = dg === 'ALL' && month === 'ALL' ? rows : rows;
  const labels = DATA.months.map(formatMonth).filter((_,i) => chartRows.some(r => r.month === DATA.months[i]));
  const monthKeys = DATA.months.filter(m => chartRows.some(r => r.month === m));
  const consumption = monthKeys.map(m => chartRows.filter(r=>r.month===m).reduce((s,r)=>s+Number(r.consumption||0),0));
  const runtime = monthKeys.map(m => chartRows.filter(r=>r.month===m).reduce((s,r)=>s+Number(r.running_hours||0),0));
  const added = monthKeys.map(m => chartRows.filter(r=>r.month===m).reduce((s,r)=>s+Number(r.fuel_added||0),0));
  const lph = monthKeys.map(m => {
    const subset = chartRows.filter(r=>r.month===m);
    const h = subset.reduce((s,r)=>s+Number(r.running_hours||0),0);
    const c = subset.reduce((s,r)=>s+Number(r.consumption||0),0);
    return h ? c/h : 0;
  });

  makeChart('consumptionChart', { type:'bar', data:{ labels: labels, datasets:[{ label:'Consumption (L)', data:consumption, borderRadius:7 }] }, options:{...common} });

  // Running hours: monthly overview (bars) or daily ECG-like line when a month is selected
  if (month === 'ALL') {
    makeChart('runtimeChart', { type:'bar', data:{ labels: labels, datasets:[{ label:'Running Hours', data:runtime, borderRadius:7 }] }, options:{...common} });
  } else {
    // Build per-day series from DATA.daily for selected month and DG filter
    const dayRows = DATA.daily.filter(d => d.month === month && (dg === 'ALL' || d.dg === dg));
    // get unique sorted dates
    const days = Array.from(new Set(dayRows.map(d => d.date))).sort();
    const dailyRuntime = days.map(day => dayRows.filter(d => d.date === day).reduce((s,r) => s + Number(r.runtime_hours || 0), 0));
    makeChart('runtimeChart', {
      type: 'line',
      data: { labels: days.map(d => new Date(d).toLocaleDateString('en-IN')), datasets: [{ label: 'Running Hours / day', data: dailyRuntime }] },
      options: { ...common, plugins: { legend: { display: false } }, elements: { line: { tension: 0, borderWidth: 2, borderColor: '#16a34a' }, point: { radius: 0 } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } }
    });
  }
  makeChart('fuelChart', { type:'line', data:{ labels:labels, datasets:[{label:'Fuel Added',data:added,tension:.25},{label:'Consumption',data:consumption,tension:.25}] }, options:{...common, plugins:{legend:{display:true,position:'bottom'}}} });
  makeChart('efficiencyChart', { type:'line', data:{ labels:labels, datasets:[{label:'L/hr',data:lph,tension:.25,fill:false}] }, options:{...common, plugins:{legend:{display:false}}} });

  const current = currentForSelection();
  const statusLabels = current.map(r => r.dg);
  // Determine capacities and filled/remaining
  const capacities = current.map(r => Number((DATA.capacities && DATA.capacities[r.dg]) || r.tank_capacity || 1000));
  const filled = current.map(r => Math.max(0, Number(r.stock || 0)));
  const remaining = capacities.map((c, i) => Math.max(0, c - filled[i]));
  const maxCapacity = Math.max(...capacities, 1000);

  // color per DG based on percent thresholds
  const colors = filled.map((v, i) => {
    const pct = capacities[i] ? (v / capacities[i]) * 100 : 0;
    if (pct < 20) return '#d64545';
    if (pct < 30) return '#f0ad4e';
    return '#4e9af1';
  });

  const remainingColor = '#e9ecef';

  const barLabelPlugin = {
    id: 'barLabelPlugin',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, i) => {
        const val = filled[i];
        const cap = capacities[i];
        const pct = cap ? Math.round((val / cap) * 100) : 0;
        const x = bar.x;
        const y = (bar.y + (bar.base || chart.chartArea.bottom)) / 2;
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 12px Inter, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pct + '%', x, y);
        ctx.restore();
      });
    }
  };

  makeChart('statusChart', {
    type: 'bar',
    data: {
      labels: statusLabels,
      datasets: [
        { label: 'Filled (L)', data: filled, backgroundColor: colors, borderColor: '#2b2b2b', borderWidth: 1.5, borderRadius: 20, borderSkipped: false },
        { label: 'Remaining (L)', data: remaining, backgroundColor: remainingColor, borderColor: '#2b2b2b', borderWidth: 1.5, borderRadius: 20, borderSkipped: false }
      ]
    },
    options: {
      ...common,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, max: maxCapacity, ticks: { callback: v => `${v} L` } }
      },
      plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw || 0).toLocaleString('en-IN')} L` } } }
    },
    plugins: [barLabelPlugin]
  });
}

function renderTable(rows) {
  const body = document.querySelector('#statsTable tbody');
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${formatMonth(r.month)}</td><td>${r.dg}</td><td>${num(r.running_hours)}</td><td>${num(r.consumption)} L</td><td>${num(r.avg_lph)} L/hr</td>
      <td>${num(r.fuel_added)} L</td><td>${num(r.closing_stock)} L</td><td>${num(r.fuel_pending)} L</td><td>${num(r.excess_stock)} L</td><td>${num(r.adjustment)} L</td>
    </tr>`).join('');
}

function renderAlerts(current, rows) {
  const box = document.getElementById('alerts');
  const alerts = [];
  current.forEach(r => {
    if (r.fuel_pending > 0) alerts.push(`<div class="alert warn">${r.dg}: ${num(r.fuel_pending)} L needed to reach the 20% reserve.</div>`);
    else alerts.push(`<div class="alert ok">${r.dg}: stock is above the 20% reserve.</div>`);
  });
  const adjustments = rows.filter(r => Number(r.adjustment||0) > 0.01);
  if (adjustments.length) alerts.push(`<div class="alert bad">${adjustments.length} month/DG reconciliation item(s) show stock increases beyond recorded fuel additions.</div>`);
  if (!alerts.length) alerts.push('<div class="alert ok">No current alerts.</div>');
  box.innerHTML = alerts.join('');
}

function formatMonth(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const d = new Date(Number(y), Number(mo)-1, 1);
  return d.toLocaleDateString('en-IN', {month:'short', year:'numeric'});
}

load();
