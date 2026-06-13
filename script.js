/* =====================================================
   ATLAS//DECK — World Data Explorer
   Built from scratch in vanilla JavaScript.
   Data: bundled countries.json (mledoze/countries + UN population)
   Live APIs: Open-Meteo (weather), Frankfurter (FX rates)
   ===================================================== */

'use strict';

/* ---------- global state ---------- */
const state = {
  countries: [],        // full dataset
  byCca3: new Map(),    // index for O(1) border lookups
  search: '',
  region: 'all',
  sortBy: 'name',
  ascending: true,
  quiz: null,
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-GB');

/* ---------- boot ---------- */
async function init() {
  startClock();
  try {
    const res = await fetch('countries.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.countries = await res.json();
    state.countries.forEach(c => state.byCca3.set(c.cca3, c));
    $('apiStatus').classList.remove('err');
    buildRegionFilter();
    buildComparePickers();
    render();
  } catch (err) {
    $('loadingMsg').textContent = `DATA FEED ERROR — ${err.message}. Refresh to retry.`;
    $('apiStatus').classList.add('err');
  }
}

function startClock() {
  const tick = () => {
    $('utcClock').textContent = new Date().toISOString().slice(11, 19) + ' UTC';
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------- filtering, sorting, deriving ---------- */
function density(c) {
  return (c.population && c.area > 0) ? c.population / c.area : null;
}

function getVisible() {
  const q = state.search.trim().toLowerCase();
  let list = state.countries.filter(c => {
    if (state.region !== 'all' && c.region !== state.region) return false;
    if (!q) return true;
    // search across name, capital(s) and languages
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.capital.some(cap => cap.toLowerCase().includes(q))) return true;
    if (c.languages.some(l => l.toLowerCase().includes(q))) return true;
    return false;
  });

  const dir = state.ascending ? 1 : -1;
  list.sort((a, b) => {
    switch (state.sortBy) {
      case 'population': return dir * ((a.population ?? -1) - (b.population ?? -1));
      case 'area':       return dir * (a.area - b.area);
      case 'density': {
        const da = density(a), db = density(b);
        if (da === null && db === null) return 0;
        if (da === null) return 1;       // nulls always sink to bottom
        if (db === null) return -1;
        return dir * (da - db);
      }
      default: return dir * a.name.localeCompare(b.name);
    }
  });
  return list;
}

/* ---------- explore view ---------- */
function buildRegionFilter() {
  const regions = [...new Set(state.countries.map(c => c.region))].filter(Boolean).sort();
  for (const r of regions) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r.toUpperCase();
    $('regionFilter').appendChild(opt);
  }
}

function render() {
  const list = getVisible();
  renderStats(list);
  renderBoard(list);
}

function renderStats(list) {
  const totPop = list.reduce((s, c) => s + (c.population || 0), 0);
  const totArea = list.reduce((s, c) => s + (c.area > 0 ? c.area : 0), 0);
  const landlocked = list.filter(c => c.landlocked).length;
  const langs = new Set();
  list.forEach(c => c.languages.forEach(l => langs.add(l)));

  $('statsStrip').innerHTML = `
    <div class="stat"><div class="k">TERRITORIES</div><div class="v">${fmt.format(list.length)}</div></div>
    <div class="stat"><div class="k">TOTAL POPULATION</div><div class="v">${compactNum(totPop)}</div></div>
    <div class="stat"><div class="k">TOTAL AREA</div><div class="v">${compactNum(totArea)} km²</div></div>
    <div class="stat"><div class="k">LANGUAGES SPOKEN</div><div class="v">${fmt.format(langs.size)}</div></div>
    <div class="stat"><div class="k">LANDLOCKED</div><div class="v">${fmt.format(landlocked)}</div></div>`;
}

function compactNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return fmt.format(Math.round(n));
}

function renderBoard(list) {
  const board = $('countryBoard');
  if (list.length === 0) {
    board.innerHTML = `<div class="no-results">NO TERRITORIES MATCH “${escapeHtml(state.search.toUpperCase())}”</div>`;
    return;
  }
  const head = `
    <div class="board-head">
      <span>FLAG</span><span>TERRITORY</span><span>CAPITAL</span>
      <span>POPULATION</span><span>AREA KM²</span><span>DENSITY</span>
    </div>`;
  // cap DOM rows at 250 (full set) — rows are cheap but animation is staggered for first 30
  const rows = list.map((c, i) => {
    const d = density(c);
    return `
    <div class="row" data-cca3="${c.cca3}" style="animation-delay:${Math.min(i, 30) * 12}ms">
      <img class="flag-img" src="https://flagcdn.com/w40/${c.cca2}.png" alt="" loading="lazy">
      <span><div class="c-name">${escapeHtml(c.name)}</div><div class="c-sub">${escapeHtml(c.subregion || c.region)}</div></span>
      <span class="c-sub">${escapeHtml(c.capital.join(', ') || '—')}</span>
      <span class="num">${c.population != null ? compactNum(c.population) : '—'}</span>
      <span class="num">${compactNum(c.area)}</span>
      <span class="num">${d !== null ? fmt.format(Math.round(d)) : '—'}<span class="u">/km²</span></span>
    </div>`;
  }).join('');
  board.innerHTML = head + rows;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ---------- dossier (detail overlay) ---------- */
function openDossier(cca3) {
  const c = state.byCca3.get(cca3);
  if (!c) return;

  const d = density(c);
  const borderChips = c.borders.length
    ? c.borders.map(b => {
        const n = state.byCca3.get(b);
        return n ? `<button class="chip" data-cca3="${b}">${n.flag} ${escapeHtml(n.name)}</button>` : '';
      }).join('')
    : '<span class="c-sub">None — island nation or isolated territory.</span>';

  const currencyTxt = c.currencies.length
    ? c.currencies.map(cur => `${escapeHtml(cur.name)} (${cur.code}${cur.symbol ? ' ' + escapeHtml(cur.symbol) : ''})`).join(', ')
    : '—';

  $('dossierContent').innerHTML = `
    <div class="dossier-top">
      <img src="https://flagcdn.com/w320/${c.cca2}.png" alt="Flag of ${escapeHtml(c.name)}">
      <div class="dossier-title">
        <h2>${escapeHtml(c.name)} ${c.flag}</h2>
        <div class="official">${escapeHtml(c.official)}</div>
        <div class="badges">
          <span class="badge">${escapeHtml(c.region.toUpperCase())}</span>
          ${c.unMember ? '<span class="badge">UN MEMBER</span>' : ''}
          ${c.landlocked ? '<span class="badge">LANDLOCKED</span>' : ''}
          ${!c.independent ? '<span class="badge">TERRITORY</span>' : ''}
        </div>
      </div>
    </div>

    <div class="fact-grid">
      <div class="fact"><div class="k">CAPITAL</div><div class="v">${escapeHtml(c.capital.join(', ') || '—')}</div></div>
      <div class="fact"><div class="k">POPULATION</div><div class="v">${c.population != null ? fmt.format(c.population) : 'no data'}</div></div>
      <div class="fact"><div class="k">AREA</div><div class="v">${fmt.format(c.area)} km²</div></div>
      <div class="fact"><div class="k">DENSITY</div><div class="v">${d !== null ? fmt.format(Math.round(d)) + ' /km²' : 'no data'}</div></div>
      <div class="fact"><div class="k">LANGUAGES</div><div class="v">${escapeHtml(c.languages.join(', ') || '—')}</div></div>
      <div class="fact"><div class="k">CURRENCY</div><div class="v">${currencyTxt}</div></div>
    </div>

    <h3>LAND BORDERS</h3>
    <div class="border-chips">${borderChips}</div>

    <h3>LIVE WEATHER — ${escapeHtml(c.capital[0] || c.name).toUpperCase()}</h3>
    <div class="live-box" id="weatherBox">FETCHING SATELLITE FEED<span class="blink">▌</span></div>

    <h3>LIVE CURRENCY CONVERTER</h3>
    <div class="live-box" id="fxBox">
      <div class="converter">
        <input type="number" id="fxAmount" value="100" min="0">
        <select id="fxBase">
          <option value="USD">USD</option><option value="EUR">EUR</option>
          <option value="GBP" selected>GBP</option><option value="INR">INR</option>
          <option value="JPY">JPY</option><option value="AUD">AUD</option>
        </select>
        <span>→</span>
        <span id="fxResult" class="conv-out">…</span>
      </div>
      <p class="warn" id="fxWarn"></p>
    </div>`;

  $('dossierBackdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  fetchWeather(c);
  setupConverter(c);
}

function closeDossier() {
  $('dossierBackdrop').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ---------- live API #1: Open-Meteo weather ---------- */
const WEATHER_CODES = {
  0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌨️'], 67: ['Heavy freezing rain', '🌨️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '❄️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '❄️'],
  80: ['Light showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'], 86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm + hail', '⛈️'], 99: ['Severe thunderstorm', '⛈️'],
};

async function fetchWeather(c) {
  const box = $('weatherBox');
  if (!c.latlng || c.latlng.length < 2) {
    box.textContent = 'No coordinates on file for this territory.';
    return;
  }
  try {
    const [lat, lon] = c.latlng;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const w = data.current_weather;
    const [label, icon] = WEATHER_CODES[w.weathercode] || ['Unknown conditions', '❓'];
    // conditional commentary based on temperature bands
    let note;
    if (w.temperature >= 35) note = 'Scorching — stay hydrated.';
    else if (w.temperature >= 25) note = 'Warm and pleasant.';
    else if (w.temperature >= 10) note = 'Mild — light jacket weather.';
    else if (w.temperature >= 0) note = 'Cold — wrap up.';
    else note = 'Freezing — arctic kit required.';
    box.innerHTML = `
      <span class="big">${icon} ${w.temperature}°C</span>
      &nbsp; ${label} · wind ${w.windspeed} km/h · ${w.is_day ? 'daytime' : 'night-time'}<br>
      <span class="c-sub">${note}</span>`;
  } catch (err) {
    box.innerHTML = `<span class="warn">Weather feed unavailable (${escapeHtml(err.message)}). The rest of the dossier still works.</span>`;
  }
}

/* ---------- live API #2: Frankfurter FX ---------- */
function setupConverter(c) {
  const target = c.currencies[0]; // convert into the country's primary currency
  const warn = $('fxWarn');
  const out = $('fxResult');

  if (!target) {
    out.textContent = '—';
    warn.textContent = 'This territory has no recorded currency.';
    return;
  }

  let rates = null; // cache per dossier

  async function convert() {
    const amount = parseFloat($('fxAmount').value);
    const base = $('fxBase').value;
    if (isNaN(amount) || amount < 0) {
      out.textContent = '—';
      warn.textContent = 'Enter a valid amount.';
      return;
    }
    warn.textContent = '';
    if (base === target.code) {            // same-currency edge case
      out.textContent = `${fmt.format(amount)} ${target.code}`;
      return;
    }
    out.textContent = '…';
    try {
      if (!rates || rates.base !== base) {
        const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        rates = await res.json();
      }
      const r = rates.rates[target.code];
      if (r === undefined) {
        // Frankfurter (ECB data) covers ~30 major currencies — handle the gap honestly
        out.textContent = 'n/a';
        warn.textContent = `${target.code} (${target.name}) is not covered by the ECB reference-rate feed.`;
        return;
      }
      out.textContent = `${fmt.format(Math.round(amount * r * 100) / 100)} ${target.code} ${target.symbol || ''}`;
    } catch (err) {
      out.textContent = 'n/a';
      warn.textContent = `FX feed unavailable (${err.message}).`;
    }
  }

  $('fxAmount').addEventListener('input', debounce(convert, 350));
  $('fxBase').addEventListener('change', convert);
  convert();
}

/* ---------- compare view ---------- */
function buildComparePickers() {
  const sorted = [...state.countries].sort((a, b) => a.name.localeCompare(b.name));
  for (const sel of [$('compareA'), $('compareB')]) {
    sel.innerHTML = '<option value="">— select —</option>' +
      sorted.map(c => `<option value="${c.cca3}">${escapeHtml(c.name)}</option>`).join('');
  }
  $('compareA').value = 'GBR';
  $('compareB').value = 'IND';
  renderCompare();
}

function renderCompare() {
  const a = state.byCca3.get($('compareA').value);
  const b = state.byCca3.get($('compareB').value);
  const box = $('compareResult');
  if (!a || !b) {
    box.innerHTML = '<p class="hint">Select two territories above to run a head-to-head comparison.</p>';
    return;
  }
  if (a === b) {
    box.innerHTML = '<p class="hint">Pick two <em>different</em> territories — a country always draws with itself.</p>';
    return;
  }

  const metrics = [
    ['POPULATION', c => c.population ?? 0, compactNum],
    ['AREA (KM²)', c => c.area, compactNum],
    ['DENSITY (/KM²)', c => density(c) ?? 0, v => fmt.format(Math.round(v))],
    ['LANGUAGES', c => c.languages.length, v => v],
    ['LAND BORDERS', c => c.borders.length, v => v],
  ];

  let aWins = 0, bWins = 0;
  const rows = metrics.map(([label, get, show]) => {
    const va = get(a), vb = get(b);
    const max = Math.max(va, vb) || 1;
    if (va > vb) aWins++; else if (vb > va) bWins++;
    return `
      <div class="cmp-row">
        <div class="lbl">${label}</div>
        <div class="cmp-vals">
          <div class="cmp-cell left"><div class="cmp-bar a" style="width:${Math.max(8, va / max * 100)}%">${show(va)}</div></div>
          <div class="cmp-cell"><div class="cmp-bar b" style="width:${Math.max(8, vb / max * 100)}%">${show(vb)}</div></div>
        </div>
      </div>`;
  }).join('');

  let verdict;
  if (aWins > bWins) verdict = `${a.flag} ${a.name} takes ${aWins} of ${metrics.length} categories.`;
  else if (bWins > aWins) verdict = `${b.flag} ${b.name} takes ${bWins} of ${metrics.length} categories.`;
  else verdict = 'Dead heat — honours even.';

  box.innerHTML = `
    <div class="cmp-head">
      <div class="side"><img src="https://flagcdn.com/w160/${a.cca2}.png" alt=""><div class="nm">${escapeHtml(a.name)}</div></div>
      <div class="vs-badge" style="align-self:center">VS</div>
      <div class="side"><img src="https://flagcdn.com/w160/${b.cca2}.png" alt=""><div class="nm">${escapeHtml(b.name)}</div></div>
    </div>
    ${rows}
    <div class="cmp-verdict">${verdict}</div>`;
}

/* ---------- quiz view ---------- */
function startQuiz() {
  // only quiz on recognisable, populated countries
  const pool = state.countries.filter(c => c.independent && c.population > 500000);
  const questions = shuffle([...pool]).slice(0, 10).map(answer => {
    const wrong = shuffle(pool.filter(c => c !== answer)).slice(0, 3);
    return { answer, options: shuffle([answer, ...wrong]) };
  });
  state.quiz = { questions, index: 0, score: 0, locked: false };
  $('quizIntro').classList.add('hidden');
  $('quizDone').classList.add('hidden');
  $('quizGame').classList.remove('hidden');
  showQuestion();
}

function showQuestion() {
  const q = state.quiz.questions[state.quiz.index];
  state.quiz.locked = false;
  $('quizProgress').textContent = `Q ${state.quiz.index + 1}/10`;
  $('quizScore').textContent = `SCORE ${state.quiz.score}`;
  $('quizFlag').src = `https://flagcdn.com/w320/${q.answer.cca2}.png`;
  $('quizFeedback').textContent = '';
  $('quizOptions').innerHTML = q.options
    .map(o => `<button data-cca3="${o.cca3}">${escapeHtml(o.name)}</button>`).join('');
}

function answerQuiz(cca3) {
  const quiz = state.quiz;
  if (quiz.locked) return;
  quiz.locked = true;
  const q = quiz.questions[quiz.index];
  const correct = cca3 === q.answer.cca3;

  for (const btn of $('quizOptions').children) {
    btn.disabled = true;
    if (btn.dataset.cca3 === q.answer.cca3) btn.classList.add('correct');
    else if (btn.dataset.cca3 === cca3) btn.classList.add('wrong');
  }
  if (correct) {
    quiz.score++;
    $('quizFeedback').textContent = 'CORRECT ✓';
  } else {
    $('quizFeedback').textContent = `WRONG — that was ${q.answer.name}.`;
  }
  $('quizScore').textContent = `SCORE ${quiz.score}`;

  setTimeout(() => {
    quiz.index++;
    if (quiz.index < quiz.questions.length) showQuestion();
    else finishQuiz();
  }, 1300);
}

function finishQuiz() {
  const s = state.quiz.score;
  $('quizGame').classList.add('hidden');
  $('quizDone').classList.remove('hidden');
  $('quizFinalTitle').textContent = `FINAL SCORE: ${s}/10`;
  // tiered verdicts — conditionals doing real work
  let msg;
  if (s === 10) msg = 'Perfect run. You could work passport control.';
  else if (s >= 8) msg = 'Excellent — seasoned traveller status.';
  else if (s >= 6) msg = 'Solid. A few layovers needed.';
  else if (s >= 4) msg = 'Shaky. Time to study the departure board.';
  else msg = 'Grounded. Geography bootcamp recommended.';
  $('quizFinalMsg').textContent = msg;
}

/* ---------- utilities ---------- */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- event wiring ---------- */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.id === `view-${tab.dataset.view}`));
  });
});

$('searchInput').addEventListener('input', debounce(e => {
  state.search = e.target.value;
  render();
}, 200));

$('regionFilter').addEventListener('change', e => { state.region = e.target.value; render(); });
$('sortBy').addEventListener('change', e => { state.sortBy = e.target.value; render(); });
$('sortOrder').addEventListener('click', () => {
  state.ascending = !state.ascending;
  $('sortOrder').textContent = state.ascending ? '▲ ASC' : '▼ DESC';
  render();
});

// event delegation: one listener handles every row and border chip
$('countryBoard').addEventListener('click', e => {
  const row = e.target.closest('.row');
  if (row) openDossier(row.dataset.cca3);
});
$('dossierContent') && $('dossierBackdrop').addEventListener('click', e => {
  if (e.target === $('dossierBackdrop')) closeDossier();
  const chip = e.target.closest('.chip');
  if (chip) openDossier(chip.dataset.cca3);
});
$('dossierClose').addEventListener('click', closeDossier);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDossier(); });

$('compareA').addEventListener('change', renderCompare);
$('compareB').addEventListener('change', renderCompare);

$('startQuiz').addEventListener('click', startQuiz);
$('restartQuiz').addEventListener('click', startQuiz);
$('quizOptions').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn) answerQuiz(btn.dataset.cca3);
});

init();
