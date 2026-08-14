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
  makeChart('runtimeChart', { type:'bar', data:{ labels: labels, datasets:[{ label:'Running Hours', data:runtime, borderRadius:7 }] }, options:{...common} });
  makeChart('fuelChart', { type:'line', data:{ labels:labels, datasets:[{label:'Fuel Added',data:added,tension:.25},{label:'Consumption',data:consumption,tension:.25}] }, options:{...common, plugins:{legend:{display:true,position:'bottom'}}} });
  makeChart('efficiencyChart', { type:'line', data:{ labels:labels, datasets:[{label:'L/hr',data:lph,tension:.25,fill:false}] }, options:{...common, plugins:{legend:{display:false}}} });

  const statusLabels = currentForSelection().map(r => r.dg);
  const statusValues = currentForSelection().map(r => r.stock);
  makeChart('statusChart', { type:'bar', data:{ labels:statusLabels, datasets:[{ label:'Current Stock', data:statusValues, borderRadius:7 }] }, options:{...common, indexAxis:'y'} });
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
