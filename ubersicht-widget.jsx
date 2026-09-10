const NAV_RANGE = 3; // days navigable each side of today, bounded by the fetched window below

// Widget fetches a wide static window; day navigation is handled entirely client-side
// (plain DOM + localStorage), NOT via Übersicht's initialState/updateState/dispatch —
// on this Übersicht version (1.6.82), merely exporting initialState/updateState breaks
// the plain-string `command` -> output pipeline (output stays permanently empty), even
// if render() never uses dispatch. Confirmed by bisection against the working baseline.
export const command = `
START=$(date -v-${NAV_RANGE + 1}d +%F)
curl -s --max-time 10 "https://www.hidrografico.pt/hmapi/tidestation/?portID=19&startDate=$START&period=${NAV_RANGE * 2 + 3}"
`;

export const refreshFrequency = 5 * 60 * 1000; // 5 min: re-fetch data + move the "now" line

export const className = `
  left: 20px;
  bottom: 20px;
  width: 360px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;

  .panel {
    background: linear-gradient(180deg, #0b2a3d, #0e3650);
    border-radius: 14px;
    padding: 14px 14px 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    color: #eaf4f8;
  }
  h1 {
    margin: 0 0 2px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .sub {
    color: #93b3c4;
    font-size: 10px;
    margin-bottom: 8px;
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 8px;
  }
  .nav button {
    background: #1c4d6e;
    border: none;
    color: #eaf4f8;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }
  .nav button:hover { background: #4fc3e0; color: #0b2a3d; }
  .nav .day-label {
    min-width: 90px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
  }
  .nav .day-label:hover { color: #4fc3e0; }
  svg { width: 100%; height: auto; display: block; }
  .axis-label { fill: #93b3c4; font-size: 10px; }
  .grid-line { stroke: #1c4d6e; stroke-width: 1; }
  .curve { fill: none; stroke: #4fc3e0; stroke-width: 2; }
  .curve-fill { fill: url(#curveGrad); opacity: 0.35; }
  .point-pm { fill: #4fc3e0; }
  .point-bm { fill: #e0956b; }
  .point-label { fill: #eaf4f8; font-size: 11px; font-weight: 700; }
  .point-time { fill: #93b3c4; font-size: 9px; }
  .now-line { stroke: #ff5252; stroke-width: 1.2; stroke-dasharray: 3 2; }
  .now-label { fill: #ff5252; font-size: 9px; font-weight: 700; }
  .error { color: #ff8a8a; font-size: 11px; }
`;

function isoWithOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function todayISO() {
  return isoWithOffset(0);
}

function getOffset() {
  try {
    const v = parseInt(window.localStorage.getItem('maree-faro-offset'), 10);
    return Number.isFinite(v) ? Math.max(-NAV_RANGE, Math.min(NAV_RANGE, v)) : 0;
  } catch (e) { return 0; }
}

function setOffset(o) {
  try { window.localStorage.setItem('maree-faro-offset', String(o)); } catch (e) { /* ignore */ }
}

function parseEvents(raw, dateISO) {
  const dayMs = 86400000;
  const refDay = Date.UTC(...dateISO.split('-').map((v,i) => i===1 ? Number(v)-1 : Number(v)));
  return raw
    .filter(e => e.tide === 'PM' || e.tide === 'BM')
    .map(e => {
      const evDay = Date.UTC(...e.date.slice(0,10).split('-').map((v,i) => i===1 ? Number(v)-1 : Number(v)));
      const dayOffset = Math.round((evDay - refDay) / dayMs);
      const [h, m] = e.date.slice(11, 16).split(':').map(Number);
      return {
        time: e.date.slice(11, 16),
        minutes: dayOffset * 1440 + h * 60 + m,
        height: e.height,
        tide: e.tide,
        label: e.event,
        isTarget: e.date.startsWith(dateISO),
      };
    })
    .sort((a,b) => a.minutes - b.minutes);
}

// Monotone cubic (Fritsch-Carlson) interpolation
function monotoneCubicSpline(points) {
  const n = points.length;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const dys = [], dxs = [], ms = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i+1]-xs[i], dy = ys[i+1]-ys[i];
    dxs.push(dx); dys.push(dy); ms.push(dy/dx);
  }
  const c1s = [ms[0]];
  for (let i = 0; i < dxs.length - 1; i++) {
    const m0 = ms[i], m1 = ms[i+1];
    if (m0*m1 <= 0) c1s.push(0);
    else {
      const dx0 = dxs[i], dx1 = dxs[i+1], common = dx0+dx1;
      c1s.push(3*common/((common+dx1)/m0 + (common+dx0)/m1));
    }
  }
  c1s.push(ms[ms.length-1]);
  const c2s = [], c3s = [];
  for (let i = 0; i < c1s.length - 1; i++) {
    const c1 = c1s[i], m0 = ms[i], invDx = 1/dxs[i];
    const common = c1 + c1s[i+1] - 2*m0;
    c2s.push((m0-c1-common)*invDx);
    c3s.push(common*invDx*invDx);
  }
  function evalAt(x) {
    let i = 0;
    while (i < xs.length - 2 && x >= xs[i+1]) i++;
    const diff = x - xs[i];
    return ys[i] + c1s[i]*diff + c2s[i]*diff*diff + c3s[i]*diff*diff*diff;
  }
  return evalAt;
}

function buildChart(allEvents, dateISO) {
  const events = allEvents.filter(e => e.isTarget);

  const W = 340, H = 200, padL = 34, padR = 12, padT = 22, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const heights = events.map(e => e.height);
  const minH = Math.min(...heights, 0);
  const maxH = Math.max(...heights);
  const yPad = (maxH - minH) * 0.15 || 0.5;
  const yMin = minH - yPad, yMax = maxH + yPad;

  const xScale = min => padL + (min / 1440) * plotW;
  const yScale = h => padT + plotH - ((h - yMin) / (yMax - yMin)) * plotH;

  const extPts = allEvents.map(e => ({ x: e.minutes, y: e.height }));
  const spline = monotoneCubicSpline(extPts);
  const xMin = extPts[0].x, xMax = extPts[extPts.length-1].x;
  const clampedSpline = x => spline(Math.max(xMin, Math.min(xMax, x)));

  let d = '';
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    const x = (i/steps) * 1440;
    const y = clampedSpline(x);
    const px = xScale(x), py = yScale(y);
    d += (i===0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1) + ' ';
  }
  const fillD = d + `L${xScale(1440).toFixed(1)},${yScale(yMin).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(yMin).toFixed(1)} Z`;

  let svg = `<defs><linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#4fc3e0" stop-opacity="0.5"/>
    <stop offset="100%" stop-color="#4fc3e0" stop-opacity="0"/>
  </linearGradient></defs>`;

  for (let h = 0; h <= 24; h += 6) {
    const x = xScale(h*60);
    svg += `<line class="grid-line" x1="${x}" y1="${padT}" x2="${x}" y2="${padT+plotH}"/>`;
    svg += `<text class="axis-label" x="${x}" y="${H-8}" text-anchor="middle">${String(h).padStart(2,'0')}h</text>`;
  }

  svg += `<path class="curve-fill" d="${fillD}"/>`;
  svg += `<path class="curve" d="${d}"/>`;

  events.forEach(e => {
    const px = xScale(e.minutes), py = yScale(e.height);
    const cls = e.tide === 'PM' ? 'point-pm' : 'point-bm';
    const above = e.tide === 'PM';
    svg += `<circle class="${cls}" cx="${px}" cy="${py}" r="4"/>`;
    svg += `<text class="point-label" x="${px}" y="${above ? py-16 : py+22}" text-anchor="middle">${e.height.toFixed(2)}m</text>`;
    svg += `<text class="point-time" x="${px}" y="${above ? py-28 : py+34}" text-anchor="middle">${e.time}</text>`;
  });

  const nowISO = todayISO();
  if (dateISO === nowISO) {
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    const nx = xScale(nowMin);
    svg += `<line class="now-line" x1="${nx}" y1="${padT}" x2="${nx}" y2="${padT+plotH}"/>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}">${svg}</svg>`;
}

const WEEKDAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

// Always the real calendar date being shown — never replaced by "Hier"/"Demain",
// so the displayed tide's date is unambiguous regardless of how you got there.
function dateLabel(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${wd} ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}`;
}

// Center label is always the literal "Aujourd'hui" — persistent, always clickable
// to jump back to today, never replaced by the displayed date (shown in the subtitle instead).
function navHtml() {
  return `
    <div class="nav">
      <button onclick="window.__mareeFaroNav(-1)">‹</button>
      <div class="day-label" onclick="window.__mareeFaroNav(0)">Aujourd'hui</div>
      <button onclick="window.__mareeFaroNav(1)">›</button>
    </div>`;
}

function titleHtml(dateISO) {
  return `<h1>Marées — Barra de Faro-Olhão · ${dateLabel(dateISO)}</h1>`;
}

const SOURCE_SUB = `<div class="sub">source hidrografico.pt</div>`;

function panelHtml(raw, offset) {
  const dateISO = isoWithOffset(offset);
  const title = titleHtml(dateISO);
  const nav = navHtml();
  if (raw == null) {
    return `${title}${SOURCE_SUB}<div class="sub">Chargement…</div>${nav}`;
  }
  try {
    const allEvents = parseEvents(raw, dateISO);
    if (!allEvents.some(e => e.isTarget)) throw new Error('Aucune donnée pour cette date.');
    const svgHtml = buildChart(allEvents, dateISO);
    return `${title}${SOURCE_SUB}${svgHtml}${nav}`;
  } catch (e) {
    return `${title}${SOURCE_SUB}<div class="error">Erreur : ${e.message}</div>${nav}`;
  }
}

// Click handler: recompute offset, persist it, re-render the panel directly via the DOM —
// bypasses Übersicht's dispatch/updateState (broken on this version, see note above).
if (typeof window !== 'undefined') {
  window.__mareeFaroNav = function (delta) {
    const next = delta === 0 ? 0 : Math.max(-NAV_RANGE, Math.min(NAV_RANGE, getOffset() + delta));
    setOffset(next);
    const el = document.getElementById('maree-faro-root');
    if (el) el.innerHTML = panelHtml(window.__mareeFaroRaw, next);
  };
}

export const render = ({ output, error }) => {
  if (typeof window !== 'undefined') window.__mareeFaroRaw = null;

  if (error) {
    return (
      <div className="panel">
        <div dangerouslySetInnerHTML={{ __html: titleHtml(todayISO()) }} />
        <div className="error">Erreur réseau : {String(error)}</div>
      </div>
    );
  }
  if (!output) {
    return (
      <div className="panel">
        <div dangerouslySetInnerHTML={{ __html: titleHtml(todayISO()) }} />
        <div className="sub">Chargement…</div>
      </div>
    );
  }

  let raw = null;
  try { raw = JSON.parse(output); } catch (e) { /* handled by panelHtml via null check below */ }

  if (typeof window !== 'undefined') window.__mareeFaroRaw = raw;

  const offset = typeof window !== 'undefined' ? getOffset() : 0;
  const innerHtml = raw == null
    ? `${titleHtml(isoWithOffset(offset))}<div class="error">Erreur : réponse invalide.</div>`
    : panelHtml(raw, offset);

  return <div id="maree-faro-root" className="panel" dangerouslySetInnerHTML={{ __html: innerHtml }} />;
};
