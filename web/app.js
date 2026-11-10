// Marés Faro-Olhão, versão telemóvel (PWA). Lógica da curva retomada do widget Übersicht
// (ubersicht-widget.jsx) ; dados via tides.php (mesma origem, sem CORS, cache no servidor).
'use strict';

const NAV_BACK = 3;
const NAV_FORWARD = 21;
const TZ = 'Europe/Lisbon';            // "hoje" e linha "agora" à hora do porto, não à do telemóvel
const DATA_URL = 'tides.php';
const APP_URL = 'https://www.fxbodin.com/nautical-apps/maree-faro/';
const STORE_KEY = 'maree-faro-envelope';
const DISMISS_KEY = 'maree-faro-install-dismissed';
const REFRESH_MS = 30 * 60 * 1000;     // releitura dos dados ao voltar à app
const RESET_MS = 30 * 60 * 1000;       // volta a "hoje" após 30 min em segundo plano

let envelope = null;   // {status, fetchedAt, error, data}
let offline = null;    // motivo, se a última chamada de rede falhou
let offset = 0;
let lastFetch = 0;
let hiddenAt = 0;

// ---------- plataforma ----------

const UA = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(UA);
// Navegadores internos (Facebook, Instagram…) e WebView Android: instalação impossível, abrir no navegador
const inAppIOS = isIOS && /FBAN|FBAV|Instagram|LinkedInApp|Line\//.test(UA);
const inAppAndroid = isAndroid && (/; wv\)/.test(UA) || /FBAN|FBAV|Instagram/.test(UA));
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let deferredPrompt = null;   // Android Chrome : instalação nativa num toque

// ---------- datas à hora do porto ----------

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
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function utcDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
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
const num = h => h.toFixed(2).replace('.', ',');
const fmtH = h => num(h) + ' m';
const TIDE_NAME = { PM: 'Preia-mar', BM: 'Baixa-mar' };

// ---------- dados ----------

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

// Interpolação cúbica monótona (Fritsch-Carlson)
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

// Escala vertical fixa em toda a janela carregada : a curva mantém a mesma altura de um dia para o outro
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
    s += `<text class="point-label" x="${px}" y="${up ? py - 16 : py + 22}" text-anchor="middle">${num(e.height)} m</text>`;
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

// ---------- apresentação ----------

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
  renderInfoData();

  const raw = envelope && envelope.data;
  if (!raw) {
    $('chart').innerHTML = envelope && envelope.status === 'error'
      ? `<div class="msg">Sem dados de momento.</div>` : '';
    $('list').innerHTML = '';
    $('next').textContent = '';
    return;
  }
  const all = parseEvents(raw, dateISO);
  const day = all.filter(e => e.isTarget);
  if (!day.length) {
    $('chart').innerHTML = `<div class="msg">Sem dados para este dia (janela carregada: −${NAV_BACK} / +${NAV_FORWARD} dias).</div>`;
    $('list').innerHTML = '';
    $('next').textContent = '';
    return;
  }
  $('chart').innerHTML = buildChart(all, dateISO, globalYRange(all), isToday ? now.minutes : null);

  $('list').innerHTML = day.map(e => {
    const past = isToday && e.minutes < now.minutes;
    return `<div class="tide ${e.tide === 'PM' ? 'pm' : 'bm'}${past ? ' past' : ''}">
      <div class="k">${TIDE_NAME[e.tide]}</div>
      <div class="t">${e.time}</div><div class="h">${fmtH(e.height)}</div></div>`;
  }).join('');

  if (isToday) {
    const nx = all.find(e => e.minutes > now.minutes);
    $('next').innerHTML = nx
      ? `${TIDE_NAME[nx.tide]} daqui a <b class="${nx.tide === 'BM' ? 'bm' : ''}">${inDelay(nx.minutes - now.minutes)}</b> · ${fmtH(nx.height)}`
      : '';
  } else {
    $('next').textContent = '';
  }
}

function statusText() {
  if (!envelope) return offline ? ['err', `Sem ligação (${offline}) · nenhum dado guardado`] : ['', 'A carregar…'];
  if (envelope.status === 'error') return ['err', `hidrografico.pt indisponível (${envelope.error})`];
  const when = fmtFetchedAt(envelope.fetchedAt);
  if (offline) return ['warn', `Sem ligação · dados de ${when}`];
  if (envelope.status === 'stale') return ['warn', `hidrografico.pt indisponível (${envelope.error}) · dados de ${when}`];
  return ['', `Fonte: hidrografico.pt · ${when} · hora de Portugal`];
}

function renderStatus() {
  const [cls, txt] = statusText();
  $('status').className = 'status' + (cls ? ' ' + cls : '');
  $('status').textContent = txt;
}

function renderInfoData() {
  $('infoData').textContent = statusText()[1];
}

// ---------- instalação ----------

const SHARE_ICON = '<svg class="share-ico" viewBox="0 0 24 24" aria-label="Partilhar"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const STEPS = {
  ios: `<ol class="steps-list">
      <li>Toque em <b>Partilhar</b> ${SHARE_ICON} (no Safari, na barra em baixo).</li>
      <li>Escolha <b>«Adicionar ao ecrã principal»</b> (deslize a lista para baixo se não a vir).</li>
      <li>Toque em <b>Adicionar</b>.</li>
    </ol>
    <div class="note">Abriu a ligação a partir do WhatsApp ou de outra app? Abra-a primeiro no Safari.</div>`,
  android: `<ol class="steps-list">
      <li>No Chrome, toque no menu <b>⋮</b> (em cima à direita).</li>
      <li>Escolha <b>«Instalar aplicação»</b> ou <b>«Adicionar ao ecrã principal»</b>.</li>
      <li>Confirme.</li>
    </ol>`,
};

// Versão curta para o cartão (não deve empurrar os botões de navegação para fora do ecrã)
function installContent() {
  if (inAppIOS) return { title: 'Abra no Safari para instalar', html: 'Menu <b>⋯</b> → <b>«Abrir no Safari»</b>' };
  if (inAppAndroid) return { title: 'Abra no Chrome para instalar', html: 'Menu <b>⋮</b> → <b>«Abrir no Chrome»</b>' };
  if (isIOS) return {
    title: 'Instale a app no iPhone',
    html: `Partilhar ${SHARE_ICON} → <b>«Adicionar ao ecrã principal»</b>
      <div class="note">Abriu a partir do WhatsApp? Abra primeiro no Safari.</div>`,
  };
  if (isAndroid && deferredPrompt) return { title: 'Instale a app no telemóvel', html: 'Acesso direto, mesmo sem rede.', button: true };
  if (isAndroid) return { title: 'Instale a app no telemóvel', html: 'Menu <b>⋮</b> → <b>«Instalar aplicação»</b> ou <b>«Adicionar ao ecrã principal»</b>' };
  return null;  // computador : nada a propor
}

function dismissed() { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; } }
function setDismissed(v) { try { localStorage.setItem(DISMISS_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ } }

let cardForced = false;   // aberta pelo botão "Instalar" do cabeçalho
function renderInstall() {
  const c = isStandalone() ? null : installContent();
  const showCard = !!c && (!dismissed() || cardForced);
  $('installCard').hidden = !showCard;
  $('installChip').hidden = !c || showCard;
  if (showCard) {
    $('installTitle').textContent = c.title;
    $('installBody').innerHTML = c.html;
    $('installGo').hidden = !c.button;
  }
}

$('installLater').addEventListener('click', () => { setDismissed(true); cardForced = false; renderInstall(); });
$('installChip').addEventListener('click', () => { cardForced = true; renderInstall(); $('installCard').scrollIntoView({ behavior: 'smooth', block: 'end' }); });
$('installGo').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
  deferredPrompt = null;
  renderInstall();
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; renderInstall(); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; setDismissed(true); renderInstall(); });

// ---------- página de informações ----------

document.querySelectorAll('[data-steps]').forEach(el => { el.innerHTML = STEPS[el.dataset.steps]; });

function openInfo() {
  $('shareMsg').textContent = '';
  $('howIos').open = isIOS;
  $('howAndroid').open = isAndroid;
  $('info').hidden = false;
  $('info').scrollTop = 0;
  history.pushState({ info: true }, '');   // o botão "voltar" do Android fecha a página
}
function closeInfo() { $('info').hidden = true; }
$('infoBtn').addEventListener('click', openInfo);
$('infoClose').addEventListener('click', () => { if (history.state && history.state.info) history.back(); else closeInfo(); });
window.addEventListener('popstate', closeInfo);

$('shareBtn').addEventListener('click', async () => {
  const data = { title: 'Marés · Barra de Faro-Olhão', text: 'Marés da Barra de Faro-Olhão', url: APP_URL };
  if (navigator.share) {
    try { await navigator.share(data); } catch (e) { /* partilha cancelada */ }
    return;
  }
  try { await navigator.clipboard.writeText(APP_URL); $('shareMsg').textContent = 'Ligação copiada.'; }
  catch (e) { $('shareMsg').textContent = APP_URL; }
});
$('refreshBtn').addEventListener('click', async () => {
  $('refreshBtn').disabled = true;
  $('infoData').textContent = 'A atualizar…';
  await refresh();
  $('refreshBtn').disabled = false;
});

// ---------- carregamento ----------

function loadStored() {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && v.data) envelope = v; } catch (e) { /* armazenamento indisponível */ }
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
      envelope = env;  // erro do servidor sem cache : mostrar
    } else {
      envelope = Object.assign({}, envelope, { status: 'stale', error: env.error });
    }
  } catch (e) {
    offline = navigator.onLine === false ? 'sem rede' : 'servidor inacessível';
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

// Deslizar na horizontal para mudar de dia (não na página de informações)
let sx = null, sy = null;
document.addEventListener('touchstart', e => {
  if (!$('info').hidden) { sx = null; return; }
  const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
}, { passive: true });
document.addEventListener('touchend', e => {
  if (sx == null) return;
  const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
  sx = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
}, { passive: true });

// Uma PWA iOS retoma muitas vezes onde estava em vez de recarregar
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > RESET_MS) offset = 0;
  renderInstall();
  if (Date.now() - lastFetch > REFRESH_MS) refresh(); else render();
});
window.addEventListener('online', refresh);
setInterval(() => { if (!document.hidden) render(); }, 60 * 1000);

loadStored();
render();
renderInstall();
refresh();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem HTTPS ou recusado : a app funciona sem */ });
}
