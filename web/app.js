// Marées Faro-Olhão, version iPhone (PWA). Logique de courbe reprise du widget Übersicht
// (ubersicht-widget.jsx) ; données via tides.php (même origine, pas de CORS, cache serveur).
'use strict';

const NAV_BACK = 3;
const NAV_FORWARD = 21;
const TZ = 'Europe/Lisbon';            // "aujourd'hui" et ligne "maintenant" au port, pas au téléphone
const DATA_URL = 'tides.php';
const STORE_KEY = 'maree-faro-envelope';
const REFRESH_MS = 30 * 60 * 1000;     // relecture du flux au retour dans l'app
const RESET_MS = 30 * 60 * 1000;       // retour à "aujourd'hui" après 30 min en arrière-plan

let envelope = null;   // {status, fetchedAt, error, data}
let offline = null;    // message si le dernier appel réseau a échoué
let offset = 0;
let lastFetch = 0;
let hiddenAt = 0;

// ---------- dates au fuseau du port ----------

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function portNow() {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function isoPlus(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
function utcDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
const WEEKDAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
function dateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}
function fmtFetchedAt(iso) {
  if (!iso) return '?';
  const [date, time] = iso.split('T');
  const [, m, d] = date.split('-');
  return `${d}/${m} ${time || ''}`.trim();
}
const fmtH = h => h.toFixed(2).replace('.', ',') + ' m';

// ---------- données ----------

function parseEvents(raw, dateISO) {
  const ref = utcDay(dateISO);
  return raw
    .filter(e => e.tide === 'PM' || e.tide === 'BM')
    .map(e => {
      const dayOffset = Math.round((utcDay(e.date.slice(0, 10)) - ref) / 86400000);
      const [h, m] = e.date.slice(11, 16).split(':').map(Number);
      return {
        time: e.date.slice(11, 16),
        minutes: dayOffset * 1440 + h * 60 + m,
        height: e.height,
        tide: e.tide,
        isTarget: e.date.startsWith(dateISO),
      };
    })
    .sort((a, b) => a.minutes - b.minutes);
}

// Interpolation cubique monotone (Fritsch-Carlson)
function monotoneCubicSpline(points) {
  const n = points.length;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const dxs = [], ms = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    dxs.push(dx); ms.push((ys[i + 1] - ys[i]) / dx);
  }
  const c1s = [ms[0]];
  for (let i = 0; i < dxs.length - 1; i++) {
    const m0 = ms[i], m1 = ms[i + 1];
    if (m0 * m1 <= 0) c1s.push(0);
    else {
      const dx0 = dxs[i], dx1 = dxs[i + 1], common = dx0 + dx1;
      c1s.push(3 * common / ((common + dx1) / m0 + (common + dx0) / m1));
    }
  }
  c1s.push(ms[ms.length - 1]);
  const c2s = [], c3s = [];
  for (let i = 0; i < c1s.length - 1; i++) {
    const c1 = c1s[i], m0 = ms[i], inv = 1 / dxs[i], common = c1 + c1s[i + 1] - 2 * m0;
    c2s.push((m0 - c1 - common) * inv);
    c3s.push(common * inv * inv);
  }
  return x => {
    let i = 0;
    while (i < xs.length - 2 && x >= xs[i + 1]) i++;
    const t = x - xs[i];
    return ys[i] + c1s[i] * t + c2s[i] * t * t + c3s[i] * t * t * t;
  };
}

// Échelle verticale fixe sur toute la fenêtre chargée : la courbe garde la même hauteur d'un jour à l'autre
function globalYRange(all) {
  const hs = all.map(e => e.height).filter(h => h != null);
  const minH = Math.min(...hs, 0), maxH = Math.max(...hs);
  const pad = (maxH - minH) * 0.15 || 0.5;
  return { yMin: minH - pad, yMax: maxH + pad };
}

function buildChart(all, dateISO, { yMin, yMax }, nowMin) {
  const events = all.filter(e => e.isTarget);
  const W = 340, H = 200, padL = 14, padR = 14, padT = 34, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xs = m => padL + (m / 1440) * plotW;
  const ys = h => padT + plotH - ((h - yMin) / (yMax - yMin)) * plotH;

  const pts = all.map(e => ({ x: e.minutes, y: e.height }));
  const spline = monotoneCubicSpline(pts);
  const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
  const f = x => spline(Math.max(x0, Math.min(x1, x)));

  let d = '';
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * 1440;
    d += (i ? 'L' : 'M') + xs(x).toFixed(1) + ',' + ys(f(x)).toFixed(1) + ' ';
  }
  const fill = d + `L${xs(1440).toFixed(1)},${ys(yMin).toFixed(1)} L${xs(0).toFixed(1)},${ys(yMin).toFixed(1)} Z`;

  let s = `<defs><linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#4fc3e0" stop-opacity="0.5"/><stop offset="100%" stop-color="#4fc3e0" stop-opacity="0"/>
  </linearGradient></defs>`;
  for (let h = 0; h <= 24; h += 6) {
    const x = xs(h * 60);
    s += `<line class="grid-line" x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}"/>`;
    s += `<text class="axis-label" x="${x}" y="${H - 8}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}h</text>`;
  }
  s += `<path class="curve-fill" d="${fill}"/><path class="curve" d="${d}"/>`;
  for (const e of events) {
    const px = xs(e.minutes), py = ys(e.height), up = e.tide === 'PM';
    s += `<circle class="${up ? 'point-pm' : 'point-bm'}" cx="${px}" cy="${py}" r="4"/>`;
    s += `<text class="point-label" x="${px}" y="${up ? py - 16 : py + 22}" text-anchor="middle">${e.height.toFixed(2)}m</text>`;
    s += `<text class="point-time" x="${px}" y="${up ? py - 28 : py + 34}" text-anchor="middle">${e.time}</text>`;
  }
  if (nowMin != null) {
    const nx = xs(nowMin);
    s += `<line class="now-line" x1="${nx}" y1="${padT}" x2="${nx}" y2="${padT + plotH}"/>`;
    s += `<circle cx="${nx}" cy="${ys(f(nowMin))}" r="3.5" fill="#ff5252"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}

function inDelay(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

// ---------- rendu ----------

const $ = id => document.getElementById(id);

function render() {
  const now = portNow();
  const dateISO = isoPlus(now.iso, offset);
  const isToday = offset === 0;
  $('date').textContent = dateLabel(dateISO);
  $('prev').disabled = offset <= -NAV_BACK;
  $('nextDay').disabled = offset >= NAV_FORWARD;
  $('today').disabled = isToday;

  renderStatus();

  const raw = envelope && envelope.data;
  if (!raw) {
    $('chart').innerHTML = envelope && envelope.status === 'error'
      ? `<div class="msg">Aucune donnée disponible pour l'instant.</div>` : '';
    $('list').innerHTML = '';
    $('next').textContent = '';
    return;
  }
  const all = parseEvents(raw, dateISO);
  const day = all.filter(e => e.isTarget);
  if (!day.length) {
    $('chart').innerHTML = `<div class="msg">Pas de données pour ce jour (fenêtre chargée : −${NAV_BACK} / +${NAV_FORWARD} jours).</div>`;
    $('list').innerHTML = '';
    $('next').textContent = '';
    return;
  }
  $('chart').innerHTML = buildChart(all, dateISO, globalYRange(all), isToday ? now.minutes : null);

  $('list').innerHTML = day.map(e => {
    const past = isToday && e.minutes < now.minutes;
    return `<div class="tide ${e.tide === 'PM' ? 'pm' : 'bm'}${past ? ' past' : ''}">
      <div class="k">${e.tide === 'PM' ? 'Pleine mer' : 'Basse mer'}</div>
      <div class="t">${e.time}</div><div class="h">${fmtH(e.height)}</div></div>`;
  }).join('');

  if (isToday) {
    const nx = all.find(e => e.minutes > now.minutes);
    $('next').innerHTML = nx
      ? `${nx.tide === 'PM' ? 'Pleine mer' : 'Basse mer'} dans <b class="${nx.tide === 'BM' ? 'bm' : ''}">${inDelay(nx.minutes - now.minutes)}</b> · ${fmtH(nx.height)}`
      : '';
  } else {
    $('next').textContent = '';
  }
}

function renderStatus() {
  const el = $('status');
  el.className = 'status';
  if (!envelope) { el.textContent = offline ? `Hors ligne (${offline}) · aucune donnée enregistrée` : 'Chargement…'; if (offline) el.className = 'status err'; return; }
  if (envelope.status === 'error') { el.className = 'status err'; el.textContent = `hidrografico.pt indisponible (${envelope.error})`; return; }
  const when = fmtFetchedAt(envelope.fetchedAt);
  if (offline) { el.className = 'status warn'; el.textContent = `Hors ligne · données du ${when}`; return; }
  if (envelope.status === 'stale') { el.className = 'status warn'; el.textContent = `hidrografico.pt indisponible (${envelope.error}) · données du ${when}`; return; }
  el.textContent = `Source hidrografico.pt · ${when} · heure du port`;
}

// ---------- chargement ----------

function loadStored() {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && v.data) envelope = v; } catch (e) { /* stockage indisponible */ }
}

async function refresh() {
  lastFetch = Date.now();
  try {
    const r = await fetch(DATA_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const env = await r.json();
    offline = null;
    if (env.data) {
      envelope = env;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(env)); } catch (e) { /* ignore */ }
    } else if (!envelope || !envelope.data) {
      envelope = env;  // erreur serveur sans cache : on l'affiche
    } else {
      envelope = Object.assign({}, envelope, { status: 'stale', error: env.error });
    }
  } catch (e) {
    offline = navigator.onLine === false ? 'pas de réseau' : 'serveur injoignable';
  }
  render();
}

function go(delta) {
  offset = delta === 0 ? 0 : Math.max(-NAV_BACK, Math.min(NAV_FORWARD, offset + delta));
  render();
}

$('prev').addEventListener('click', () => go(-1));
$('nextDay').addEventListener('click', () => go(1));
$('today').addEventListener('click', () => go(0));

// Balayage horizontal pour changer de jour
let sx = null, sy = null;
document.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
document.addEventListener('touchend', e => {
  if (sx == null) return;
  const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
  sx = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
}, { passive: true });

// Une PWA iOS reprend souvent là où elle était au lieu de se recharger
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > RESET_MS) offset = 0;
  if (Date.now() - lastFetch > REFRESH_MS) refresh(); else render();
});
window.addEventListener('online', refresh);
setInterval(() => { if (!document.hidden) render(); }, 60 * 1000);

loadStored();
render();
refresh();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* hors HTTPS ou refusé : l'app marche sans */ });
}
