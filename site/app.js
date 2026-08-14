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
  // build month dropdown: All Months on top, then current month (selected), then previous months
  const currentMonth = DATA.date_to ? DATA.date_to.slice(0,7) : (DATA.months && DATA.months.length ? DATA.months[DATA.months.length-1] : null);
  let monthsList = Array.isArray(DATA.months) ? Array.from(new Set(DATA.months)) : [];
  // place previous months after the current month (descending newest-first)
  monthsList = monthsList.filter(m => m !== currentMonth).sort((a,b) => b.localeCompare(a));
  let monthOptions = '<option value="ALL">All Months</option>';
  if (currentMonth && DATA.months.includes(currentMonth)) {
    monthOptions += `<option value="${currentMonth}">${formatMonth(currentMonth)}</option>`;
  }
  monthOptions += monthsList.map(m => `<option value="${m}">${formatMonth(m)}</option>`).join('');
  month.innerHTML = monthOptions;
  if (currentMonth && DATA.months.includes(currentMonth)) month.value = currentMonth;
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
  renderRuntimeSummary(rows);
}
function renderRuntimeSummary(rows) {
  const byDg = {};
  DATA.dgs.forEach(d => byDg[d] = 0);
  rows.forEach(r => { byDg[r.dg] = (byDg[r.dg] || 0) + Number(r.running_hours || 0); });
  const yard1 = ['DG1','DG2','DG3'];
  const yard2 = ['DG4','DG5','DG6'];
  const fmt = (v) => `${Number(v||0).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} h`;
  const total = Object.values(byDg).reduce((s,v)=>s+v,0);
  const legacyHtml = `
    <div style="display:flex;gap:18px;align-items:center;">
      <div><strong>Total:</strong><div style="font-size:18px;margin-top:6px">${fmt(total)}</div></div>
      <div style="flex:1">
        <div style="font-weight:700">Yard 1</div>
        <div style="color:var(--muted);">${yard1.map(d=>`${d}: ${fmt(byDg[d])}`).join(' · ')}</div>
        <div style="height:6px"></div>
        <div style="font-weight:700">Yard 2</div>
        <div style="color:var(--muted);">${yard2.map(d=>`${d}: ${fmt(byDg[d])}`).join(' · ')}</div>
      </div>
    </div>
  `;
  const html = `<div class="runtime-lines">
    <div class="runtime-line total"><strong>Total</strong><span>${fmt(total)}</span></div>
    ${DATA.dgs.map(dgName => `<div class="runtime-line"><strong>${dgName}</strong><span>${fmt(byDg[dgName])}</span></div>`).join('')}
  </div>`;
  const el = document.getElementById('runtimeSummary');
  if (el) el.innerHTML = html;
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
const DG_SERIES_COLORS = {
  DG1: '#2563eb', DG2: '#14b8a6', DG3: '#8b5cf6',
  DG4: '#f97316', DG5: '#ec4899', DG6: '#64748b'
};

function renderCharts(rows) {
  const { month, dg } = selected();
  const chartRows = rows;
  const monthKeys = DATA.months.filter(m => chartRows.some(r => r.month === m));
  const labels = monthKeys.map(formatMonth);
  const consumption = monthKeys.map(m => chartRows.filter(r=>r.month===m).reduce((s,r)=>s+Number(r.consumption||0),0));
  const runtime = monthKeys.map(m => chartRows.filter(r=>r.month===m).reduce((s,r)=>s+Number(r.running_hours||0),0));
  const added = monthKeys.map(m => chartRows.filter(r=>r.month===m).reduce((s,r)=>s+Number(r.fuel_added||0),0));
  const lph = monthKeys.map(m => {
    const subset = chartRows.filter(r=>r.month===m);
    const h = subset.reduce((s,r)=>s+Number(r.running_hours||0),0);
    const c = subset.reduce((s,r)=>s+Number(r.consumption||0),0);
    return h ? c/h : 0;
  });

  renderConsumptionSummary(chartRows);

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
  const fuelSeries = DATA.dgs
    .filter(dgName => dg === 'ALL' || dgName === dg)
    .flatMap(dgName => {
      const color = DG_SERIES_COLORS[dgName];
      const values = key => monthKeys.map(m => chartRows
        .filter(r => r.month === m && r.dg === dgName)
        .reduce((sum, r) => sum + Number(r[key] || 0), 0));
      return [
        { label: `${dgName} Fuel Added`, data: values('fuel_added'), borderColor: color, backgroundColor: color, tension: .25 },
        { label: `${dgName} Consumption`, data: values('consumption'), borderColor: color, backgroundColor: color, borderDash: [6, 4], tension: .25 }
      ];
    });
  makeChart('fuelChart', {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Total Fuel Added', data: added, borderColor: '#0f4c81', backgroundColor: '#0f4c81', borderWidth: 3, tension: .25 },
      { label: 'Total Consumption', data: consumption, borderColor: '#dc4c64', backgroundColor: '#dc4c64', borderWidth: 3, borderDash: [8, 4], tension: .25 },
      ...fuelSeries
    ] },
    options: { ...common, plugins: { legend: { display: true, position: 'bottom' } } }
  });
  makeChart('efficiencyChart', { type:'line', data:{ labels:labels, datasets:[{label:'L/hr',data:lph,tension:.25,fill:false}] }, options:{...common, plugins:{legend:{display:false}}} });

  const current = currentForSelection();

  // Render Current DG Status as a stacked Chart.js bar so styling matches other charts
  const statusLabels = current.map(r => r.dg);
  const capacities = current.map(r => Number((DATA.capacities && DATA.capacities[r.dg]) || r.tank_capacity || 1000));
  const filled = current.map(r => Math.max(0, Number(r.stock || 0)));
  const remaining = capacities.map((c, i) => Math.max(0, c - filled[i]));
  const maxCapacity = Math.max(...capacities, 1000);

  const colors = filled.map((v, i) => {
    const pct = capacities[i] ? (v / capacities[i]) * 100 : 0;
    if (pct < 20) return '#d64545';
    if (pct < 30) return '#f0ad4e';
    return '#4e9af1';
  });
  const remainingColor = '#e9ecef';

  // Draw single filled bars with a background 'tank' container and animate a subtle wobble.
  const tankPlugin = {
    id: 'tankPlugin',
    afterInit(chart) {
      chart._tankPhase = 0;
      if (!chart._tankRaf) {
        const loop = () => {
          chart._tankPhase += 0.18;
          chart.draw();
          chart._tankRaf = requestAnimationFrame(loop);
        };
        chart._tankRaf = requestAnimationFrame(loop);
      }
    },
    beforeDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const yScale = chart.scales.y;
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, i) => {
        const barWidth = bar.width || 44;
        const centerX = bar.x;
        const cap = capacities[i] || maxCapacity;
        const capY = yScale.getPixelForValue(cap);
        const baseY = yScale.getPixelForValue(0);
        const x = centerX - (barWidth / 2);
        const y = capY;
        const w = barWidth;
        const h = baseY - capY;
        // rounded rect background
        ctx.save();
        ctx.fillStyle = '#f5f7fa';
        ctx.strokeStyle = '#bfc9d7';
        const r = Math.min(12, w/2);
        roundRect(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    },
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const yScale = chart.scales.y;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      meta.data.forEach((bar, i) => {
        const centerX = bar.x;
        const cap = capacities[i] || maxCapacity;
        const filledVal = filled[i] || 0;
        const pct = cap ? Math.round((filledVal / cap) * 100) : 0;
        const barTop = bar.y;
        const barBase = bar.base || yScale.getPixelForValue(0);
        // draw a water-wave inside the filled area
        const x = centerX - (bar.width || 52) / 2;
        const w = bar.width || 52;
        const h = Math.max(0, barBase - barTop);
        const wavePhase = chart._tankPhase || 0;
        const amplitude = Math.min(8, Math.max(2, h * 0.03));
        const wavelength = Math.max(30, w * 0.8);
        const waterLevelY = barTop; // Y coordinate of the top of the filled area

        // clip to rounded rect of the entire container (so wave stays inside fill)
        ctx.save();
        roundRect(ctx, x, waterLevelY, w, h, Math.min(12, w/2));
        ctx.clip();

        // primary wave
        ctx.beginPath();
        const left = x - w; // start a bit left for smoother animation
        const right = x + w * 2; // extend right
        ctx.moveTo(left, barBase);
        for (let px = left; px <= right; px += 4) {
          const relX = px - left;
          const y = waterLevelY + Math.sin((relX / wavelength) + wavePhase) * amplitude;
          ctx.lineTo(px, y);
        }
        ctx.lineTo(right, barBase);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(colors[i] || '#4e9af1', 0.55);
        ctx.fill();

        // subtle secondary wave
        ctx.beginPath();
        ctx.moveTo(left, barBase);
        for (let px = left; px <= right; px += 4) {
          const relX = px - left;
          const y = waterLevelY + Math.sin((relX / (wavelength*0.6)) + wavePhase * 1.4 + 1) * (amplitude * 0.6);
          ctx.lineTo(px, y);
        }
        ctx.lineTo(right, barBase);
        ctx.closePath();
        ctx.fillStyle = hexToRgba('#ffffff', 0.12);
        ctx.fill();

        ctx.restore();

        // draw capacity label at top inside container (static)
        const capY = yScale.getPixelForValue(cap) + 14;
        ctx.fillStyle = '#13293b';
        ctx.font = '600 11px Inter, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(num(cap,0) + ' L', centerX, capY);

        // draw filled liters and percent centered in filled area if enough space, else above (static)
        const filledCenterY = Math.max(barTop + 12, (barTop + barBase) / 2 - 6);
        ctx.fillStyle = '#fff';
        ctx.font = '700 13px Inter, Arial';
        ctx.fillText(pct + '%', centerX, filledCenterY);
        ctx.font = '600 11px Inter, Arial';
        ctx.fillText(num(filledVal,0) + ' L', centerX, filledCenterY + 14);
      });
      ctx.restore();
    },
    beforeDestroy(chart) {
      if (chart._tankRaf) cancelAnimationFrame(chart._tankRaf);
      chart._tankRaf = null;
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#','');
    const bigint = parseInt(h.length === 3 ? h.split('').map(c=>c+ c).join('') : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  makeChart('statusChart', {
    type: 'bar',
    data: {
      labels: statusLabels,
      datasets: [
        { label: 'Filled (L)', data: filled, backgroundColor: colors, borderColor: '#2b2b2b', borderWidth: 1, borderRadius: 14, borderSkipped: false, barPercentage: 0.82, categoryPercentage: 0.82, barThickness: 52 }
      ]
    },
    options: {
      ...common,
      scales: {
        x: { stacked: false, grid: { display: false } },
        y: { beginAtZero: true, max: maxCapacity, ticks: { callback: v => `${v} L` } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `Filled: ${Number(ctx.raw || 0).toLocaleString('en-IN')} L (${Math.round(((ctx.raw||0) / (capacities[ctx.dataIndex]||1))*100)}%)\nCapacity: ${num(capacities[ctx.dataIndex]||0,0)} L` } } },
      elements: { bar: { borderRadius: 14 } },
      animation: { duration: 400 }
    },
    plugins: [tankPlugin]
  });

}

function renderConsumptionSummary(rows) {
  const total = rows.reduce((sum, row) => sum + Number(row.consumption || 0), 0);
  const group = (title, dgs, className) => `
    <div class="consumption-group ${className}">
      <div class="consumption-group-title">${title}</div>
      <div class="consumption-dgs">
        ${dgs.map(dgName => {
          const value = rows
            .filter(row => row.dg === dgName)
            .reduce((sum, row) => sum + Number(row.consumption || 0), 0);
          return `<div class="consumption-dg"><span>${dgName}</span><strong>${money(value)}</strong></div>`;
        }).join('')}
      </div>
    </div>`;
  document.getElementById('consumptionSummary').innerHTML = `
    <div class="consumption-total">
      <div class="consumption-label">Total Consumption</div>
      <strong>${money(total)}</strong>
    </div>
    ${group('DG1–DG3', ['DG1', 'DG2', 'DG3'], 'yard-1')}
    ${group('DG4–DG6', ['DG4', 'DG5', 'DG6'], 'yard-2')}
  `;
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
