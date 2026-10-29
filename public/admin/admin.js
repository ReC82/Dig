/**
 * admin.js — Panel admin DIG!
 * Auth : ADMIN_SECRET envoyé comme Bearer token dans chaque requête.
 */

let _secret = null;
let _currentSeasonId = null;

// ── Auth ──────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_secret}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(path, opts);
  const data = await res.json();
  return { ok: res.ok, data };
}

document.getElementById('secret-btn').addEventListener('click', async () => {
  const val = document.getElementById('secret-input').value.trim();
  if (!val) return;
  _secret = val;
  const { ok } = await api('GET', '/api/admin/config');
  if (ok) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    loadAll();
  } else {
    document.getElementById('auth-error').textContent = 'Clé incorrecte ou serveur inaccessible.';
    document.getElementById('auth-error').classList.remove('hidden');
    _secret = null;
  }
});

document.getElementById('secret-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('secret-btn').click();
});

document.getElementById('logout-btn').addEventListener('click', () => {
  _secret = null;
  document.getElementById('admin-app').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
});

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab === 'leaderboard')     loadLeaderboard();
    if (btn.dataset.tab === 'season-overview') { loadSeasonOverview(); loadAntiCheatLogs(); }
    if (btn.dataset.tab === 'economy')         loadEconomy();
  });
});

// ── Load all ──────────────────────────────────────────────────────────────────

async function loadAll() {
  await Promise.all([loadSeasons(), loadLeagues(), loadConfig(), loadSeasonOverview()]);
  loadLeaderboard();
  loadAntiCheatLogs();
}

// ── Saisons ───────────────────────────────────────────────────────────────────

async function loadSeasons() {
  const { ok, data } = await api('GET', '/api/admin/seasons');
  if (!ok) return;
  const tbody = document.querySelector('#seasons-table tbody');
  tbody.innerHTML = '';
  if (!data.seasons.length) { tbody.innerHTML = '<tr><td colspan="6" class="muted">Aucune saison.</td></tr>'; return; }

  data.seasons.forEach(s => {
    if (s.status === 'active') { _currentSeasonId = s.id; document.getElementById('lb-season-name').textContent = s.name; }
    const tr = document.createElement('tr');
    const statusBadge = `<span class="badge-${s.status}">${s.status}</span>`;
    tr.innerHTML = `
      <td>${s.id}</td>
      <td>${s.name}</td>
      <td>${s.start_at}</td>
      <td>${s.end_at}</td>
      <td>${statusBadge}</td>
      <td>
        ${s.status === 'active' ? `<button class="btn-ghost" onclick="endSeason(${s.id})">Clore</button>` : ''}
      </td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('btn-new-season').addEventListener('click', () => {
  document.getElementById('new-season-form').classList.toggle('hidden');
});
document.getElementById('btn-cancel-season').addEventListener('click', () => {
  document.getElementById('new-season-form').classList.add('hidden');
});

document.getElementById('btn-create-season').addEventListener('click', async () => {
  const name     = document.getElementById('ns-name').value.trim();
  const startRaw = document.getElementById('ns-start').value;
  const endRaw   = document.getElementById('ns-end').value;
  const errEl    = document.getElementById('season-form-error');
  errEl.classList.add('hidden');
  if (!name || !startRaw || !endRaw) { errEl.textContent = 'Tous les champs sont requis.'; errEl.classList.remove('hidden'); return; }
  const start_at = startRaw.replace('T', ' ') + ':00';
  const end_at   = endRaw.replace('T', ' ')   + ':00';
  const { ok, data } = await api('POST', '/api/admin/seasons', { name, start_at, end_at });
  if (!ok) { errEl.textContent = data.error ?? 'Erreur.'; errEl.classList.remove('hidden'); return; }
  document.getElementById('new-season-form').classList.add('hidden');
  loadSeasons();
});

async function endSeason(id) {
  if (!confirm('Clore cette saison ?')) return;
  await api('PUT', `/api/admin/seasons/${id}`, { status: 'closed' });
  loadSeasons();
}

// ── Ligues ────────────────────────────────────────────────────────────────────

async function loadLeagues() {
  const { ok, data } = await api('GET', '/api/admin/leagues');
  if (!ok) return;
  const tbody = document.querySelector('#leagues-table tbody');
  tbody.innerHTML = '';
  if (!data.leagues.length) { tbody.innerHTML = '<tr><td colspan="7" class="muted">Aucune ligue.</td></tr>'; return; }

  data.leagues.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.id}</td>
      <td>${l.icon} ${l.name}</td>
      <td>${l.level}</td>
      <td>${l.rank_min}</td>
      <td>${l.rank_max ?? '∞'}</td>
      <td>${l.sort_order}</td>
      <td><button class="btn-ghost" onclick="deleteLeague(${l.id}, '${l.name}')">Supprimer</button></td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('btn-new-league').addEventListener('click', () => {
  document.getElementById('new-league-form').classList.toggle('hidden');
});
document.getElementById('btn-cancel-league').addEventListener('click', () => {
  document.getElementById('new-league-form').classList.add('hidden');
});

document.getElementById('btn-create-league').addEventListener('click', async () => {
  const name       = document.getElementById('nl-name').value.trim();
  const icon       = document.getElementById('nl-icon').value.trim() || '🏅';
  const level      = parseInt(document.getElementById('nl-level').value || '0', 10);
  const rank_min   = parseInt(document.getElementById('nl-rmin').value, 10);
  const rmaxVal    = document.getElementById('nl-rmax').value.trim();
  const rank_max   = rmaxVal ? parseInt(rmaxVal, 10) : null;
  const sort_order = parseInt(document.getElementById('nl-order').value || '0', 10);
  const errEl      = document.getElementById('league-form-error');
  errEl.classList.add('hidden');
  if (!name || isNaN(rank_min)) { errEl.textContent = 'Nom et rang min requis.'; errEl.classList.remove('hidden'); return; }
  const { ok, data } = await api('POST', '/api/admin/leagues', { name, icon, level, rank_min, rank_max, sort_order });
  if (!ok) { errEl.textContent = data.error ?? 'Erreur.'; errEl.classList.remove('hidden'); return; }
  document.getElementById('new-league-form').classList.add('hidden');
  loadLeagues();
});

async function deleteLeague(id, name) {
  if (!confirm(`Supprimer la ligue "${name}" ?`)) return;
  await api('DELETE', `/api/admin/leagues/${id}`);
  loadLeagues();
}

// ── Classement ────────────────────────────────────────────────────────────────

async function loadLeaderboard() {
  if (!_currentSeasonId) {
    const { ok, data } = await api('GET', '/api/admin/seasons');
    if (ok) {
      const active = data.seasons.find(s => s.status === 'active');
      if (active) { _currentSeasonId = active.id; document.getElementById('lb-season-name').textContent = active.name; }
    }
  }
  if (!_currentSeasonId) return;
  const { ok, data } = await api('GET', `/api/admin/seasons/${_currentSeasonId}/leaderboard`);
  if (!ok) return;
  const tbody = document.querySelector('#lb-table tbody');
  tbody.innerHTML = '';
  if (!data.leaderboard.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Aucun joueur actif.</td></tr>'; return;
  }
  data.leaderboard.forEach(r => {
    const tr = document.createElement('tr');
    const reported = r.reportedMaxDepth != null && r.reportedMaxDepth !== r.maxDepth
      ? `${r.reportedMaxDepth}m ⚠` : '—';
    const cells = [
      `#${r.rank}`, r.username, `${r.maxDepth}m`, reported, r.manualBlocks,
      r.league ? `${r.league.icon} ${r.league.name}` : '—',
    ];
    // textContent : le nom du joueur n'est jamais interprété comme du HTML
    cells.forEach(v => { const td = document.createElement('td'); td.textContent = String(v); tr.appendChild(td); });
    const td  = document.createElement('td');
    const btn = document.createElement('button');
    btn.className   = 'btn-ghost';
    btn.textContent = 'Corriger';
    btn.addEventListener('click', () => correctRanking(r));
    td.appendChild(btn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
}

/** Corrige une ligne du classement (profondeur retenue et/ou blocs effectifs). */
async function correctRanking(r) {
  const depthStr = prompt(`Profondeur retenue pour ${r.username} (actuelle : ${r.maxDepth}m, déclarée : ${r.reportedMaxDepth ?? '?'}m)`, String(r.maxDepth));
  if (depthStr === null) return;
  const blocksStr = prompt(`Blocs manuels effectifs pour ${r.username} (actuels : ${r.manualBlocks})`, String(r.manualBlocks));
  if (blocksStr === null) return;
  const maxDepth = Number(depthStr), effectiveManualBlocks = Number(blocksStr);
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(effectiveManualBlocks) || effectiveManualBlocks < 0) {
    alert('Valeurs invalides : entiers ≥ 0 attendus.'); return;
  }
  const reason = prompt('Motif (journalisé)', '') ?? '';
  const { ok, data } = await api('PUT', `/api/admin/seasons/${_currentSeasonId}/rankings/${r.userId}`, { maxDepth, effectiveManualBlocks, reason });
  if (!ok) { alert(data.error ?? 'Erreur.'); return; }
  loadLeaderboard();
}

document.getElementById('btn-refresh-lb').addEventListener('click', loadLeaderboard);

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_LABELS = {
  gems_cap:                     'Plafond de gems en fin de saison',
  cps_limit:                    'CPS max (alias, voir max_effective_cps)',
  season_duration:              'Durée par défaut d\'une saison (jours)',
  max_effective_cps:            'Clics/s max avant exclusion du classement',
  promotion_rate:               'Taux de promotion entre ligues (0–1)',
  difficulty_coefficient:       'Coefficient de difficulté par ligue',
  min_active_players_per_league:'Joueurs actifs min pour créer une ligue',
  anti_autoclick_enabled:       'Anti-autoclicker activé (true/false)',
  depth_validation_enabled:     'Validation serveur de la profondeur (true/false)',
  depth_max_cps:                'Clics/s max retenus pour la profondeur',
};

async function loadConfig() {
  const { ok, data } = await api('GET', '/api/admin/config');
  if (!ok) return;
  const container = document.getElementById('config-rows');
  container.innerHTML = '';
  Object.entries(data.config).forEach(([key, value]) => {
    const div = document.createElement('div');
    div.className = 'config-row';
    div.innerHTML = `
      <span class="config-key">${key}</span>
      <span class="muted config-label" style="flex:2">${CONFIG_LABELS[key] ?? ''}</span>
      <input class="config-value" data-key="${key}" type="text" value="${value}">`;
    container.appendChild(div);
  });
}

document.getElementById('btn-save-config').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('.config-value[data-key]');
  const msgEl  = document.getElementById('config-msg');
  msgEl.classList.add('hidden');
  for (const input of inputs) {
    await api('PUT', '/api/admin/config', { key: input.dataset.key, value: input.value });
  }
  msgEl.classList.remove('hidden');
  setTimeout(() => msgEl.classList.add('hidden'), 3000);
});

// ── Ligues & Saisons (vue d'ensemble) ─────────────────────────────────────────

let _overviewSeasonId = null;

// Paramètres affichés dans la section (sous-ensemble de la config)
const SEASON_PARAMS = [
  { key: 'season_duration',               label: 'Durée d\'une saison (jours)',           type: 'number', min: 1 },
  { key: 'promotion_rate',                label: 'Taux de promotion entre ligues (0–1)',   type: 'number', min: 0, max: 1, step: 0.01 },
  { key: 'difficulty_coefficient',        label: 'Coefficient de difficulté par ligue',    type: 'number', min: 0, step: 0.01 },
  { key: 'min_active_players_per_league', label: 'Joueurs actifs min par ligue',           type: 'number', min: 1 },
  { key: 'gems_cap',                      label: 'Plafond de gems après saison',           type: 'number', min: 0 },
  { key: 'max_effective_cps',             label: 'Clics/s max (anti-autoclicker)',         type: 'number', min: 1 },
  { key: 'anti_autoclick_enabled',        label: 'Anti-autoclicker activé (true/false)',   type: 'text' },
];

async function loadSeasonOverview() {
  const { ok, data } = await api('GET', '/api/admin/seasons/active/summary');

  const noSeasonEl = document.getElementById('no-active-season');
  const statsEl    = document.getElementById('season-stats');

  if (!ok || data.error) {
    noSeasonEl.classList.remove('hidden');
    statsEl.classList.add('hidden');
    _overviewSeasonId = null;
    document.querySelector('#ov-leagues-table tbody').innerHTML =
      '<tr><td colspan="5" class="muted">Aucune saison active.</td></tr>';
    return;
  }

  noSeasonEl.classList.add('hidden');
  statsEl.classList.remove('hidden');

  const { season, activePlayers, leagues } = data;
  _overviewSeasonId = season.id;

  document.getElementById('ov-season-name').textContent    = season.name;
  document.getElementById('ov-season-status').innerHTML    = `<span class="badge-${season.status}">${season.status}</span>`;
  document.getElementById('ov-season-start').textContent   = season.start_at;
  document.getElementById('ov-season-end').textContent     = season.end_at;
  document.getElementById('ov-season-players').textContent = activePlayers;
  document.getElementById('close-season-name').textContent = season.name;

  // Tableau des ligues
  const tbody = document.querySelector('#ov-leagues-table tbody');
  tbody.innerHTML = '';
  if (!leagues.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Aucune ligue.</td></tr>';
  } else {
    leagues.forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${l.icon} ${l.name}</td>
        <td>${l.level}</td>
        <td>${l.total_players}</td>
        <td>${l.active_players}</td>
        <td><button class="btn-ghost" onclick="focusLeagueLeaderboard(${l.id})">Voir</button></td>`;
      tbody.appendChild(tr);
    });
  }

  // Select du classement par ligue
  const sel = document.getElementById('ov-league-select');
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">— Choisir une ligue —</option>';
  leagues.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = `${l.icon} ${l.name}`;
    sel.appendChild(opt);
  });
  if (prevVal) sel.value = prevVal;

  // Paramètres
  await loadSeasonParams();
}

async function loadSeasonParams() {
  const { ok, data } = await api('GET', '/api/admin/config');
  if (!ok) return;
  const grid = document.getElementById('ov-params-grid');
  grid.innerHTML = '';
  SEASON_PARAMS.forEach(({ key, label, type, min, max, step }) => {
    if (data.config[key] === undefined) return;
    const div = document.createElement('div');
    div.className = 'param-row';
    const extra = [
      type === 'number' ? `type="number"` : `type="text"`,
      min  != null ? `min="${min}"` : '',
      max  != null ? `max="${max}"` : '',
      step != null ? `step="${step}"` : '',
    ].filter(Boolean).join(' ');
    div.innerHTML = `
      <label class="param-label" for="param-${key}">${label}</label>
      <input id="param-${key}" class="ov-param-value" data-key="${key}" ${extra} value="${data.config[key]}">`;
    grid.appendChild(div);
  });
}

document.getElementById('btn-save-params').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('.ov-param-value[data-key]');
  const msgEl  = document.getElementById('params-msg');
  const errEl  = document.getElementById('params-err');
  msgEl.classList.add('hidden');
  errEl.classList.add('hidden');

  for (const input of inputs) {
    const val = input.value.trim();
    if (val === '') { errEl.textContent = `Valeur requise pour "${input.dataset.key}".`; errEl.classList.remove('hidden'); return; }
    if (input.type === 'number') {
      const n = parseFloat(val);
      if (isNaN(n)) { errEl.textContent = `Valeur numérique attendue pour "${input.dataset.key}".`; errEl.classList.remove('hidden'); return; }
      if (input.min !== '' && n < parseFloat(input.min)) { errEl.textContent = `"${input.dataset.key}" doit être ≥ ${input.min}.`; errEl.classList.remove('hidden'); return; }
      if (input.max !== '' && n > parseFloat(input.max)) { errEl.textContent = `"${input.dataset.key}" doit être ≤ ${input.max}.`; errEl.classList.remove('hidden'); return; }
    }
  }

  for (const input of inputs) {
    const { ok, data } = await api('PUT', '/api/admin/config', { key: input.dataset.key, value: input.value.trim() });
    if (!ok) { errEl.textContent = data.error ?? `Erreur lors de la sauvegarde de "${input.dataset.key}".`; errEl.classList.remove('hidden'); return; }
  }

  msgEl.classList.remove('hidden');
  setTimeout(() => msgEl.classList.add('hidden'), 3000);
});

document.getElementById('btn-refresh-overview').addEventListener('click', loadSeasonOverview);

// ── Clôture manuelle de saison ────────────────────────────────────────────────

document.getElementById('btn-close-season-manual').addEventListener('click', () => {
  if (!_overviewSeasonId) return;
  document.getElementById('close-season-confirm').classList.remove('hidden');
  document.getElementById('btn-close-season-manual').classList.add('hidden');
  document.getElementById('close-result').classList.add('hidden');
});

document.getElementById('btn-cancel-close').addEventListener('click', () => {
  document.getElementById('close-season-confirm').classList.add('hidden');
  document.getElementById('btn-close-season-manual').classList.remove('hidden');
});

document.getElementById('btn-confirm-close').addEventListener('click', async () => {
  if (!_overviewSeasonId) return;
  const btn = document.getElementById('btn-confirm-close');
  btn.disabled    = true;
  btn.textContent = 'Clôture en cours…';

  const { ok, data } = await api('POST', `/api/admin/seasons/${_overviewSeasonId}/close`);

  btn.disabled    = false;
  btn.textContent = 'Confirmer la clôture';

  document.getElementById('close-season-confirm').classList.add('hidden');
  document.getElementById('btn-close-season-manual').classList.remove('hidden');

  const resultEl = document.getElementById('close-result');
  if (!ok) {
    resultEl.className = 'error';
    resultEl.textContent = data.error ?? 'Erreur lors de la clôture.';
  } else {
    resultEl.className = 'success';
    resultEl.innerHTML = `✓ Saison <strong>${data.closedSeason?.name ?? ''}</strong> clôturée. Nouvelle saison : <strong>${data.newSeason?.name ?? ''}</strong>`;
    // Recharge les onglets concernés après 3 s
    setTimeout(() => { resultEl.classList.add('hidden'); loadSeasonOverview(); loadSeasons(); }, 3000);
  }
  resultEl.classList.remove('hidden');
});

// ── Classement par ligue (section vue d'ensemble) ─────────────────────────────

function focusLeagueLeaderboard(leagueId) {
  document.getElementById('ov-league-select').value = leagueId;
  loadLeagueLeaderboardView();
  // Scroll vers la section classement
  document.getElementById('ov-lb-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadLeagueLeaderboardView() {
  const leagueId = document.getElementById('ov-league-select').value;
  const tbody    = document.getElementById('ov-lb-body');
  if (!leagueId || !_overviewSeasonId) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Sélectionner une ligue ci-dessus.</td></tr>';
    return;
  }

  const { ok, data } = await api('GET', `/api/admin/seasons/${_overviewSeasonId}/leagues/${leagueId}/leaderboard`);
  tbody.innerHTML = '';

  if (!ok || !data.leaderboard?.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Aucun joueur actif dans cette ligue.</td></tr>';
    return;
  }

  data.leaderboard.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>#${r.rank}</td><td>${r.username}</td><td>${r.maxDepth}m</td><td>${r.manualBlocks}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('ov-league-select').addEventListener('change', loadLeagueLeaderboardView);

// ── Journal anti-autoclicker ───────────────────────────────────────────────────

async function loadAntiCheatLogs() {
  const action = document.getElementById('ac-filter-action').value;
  const url    = '/api/admin/anticheat/logs?limit=100' + (action ? `&action=${action}` : '');
  const { ok, data } = await api('GET', url);

  const tbody   = document.getElementById('ac-log-body');
  const totalEl = document.getElementById('ac-log-total');

  if (!ok) {
    tbody.innerHTML = `<tr><td colspan="6" class="error">Erreur lors du chargement.</td></tr>`;
    return;
  }

  // Filtrage côté client si ?action ne filtre pas au niveau SQL (selon l'API)
  const logs = action
    ? (data.logs ?? []).filter(l => l.action_taken === action)
    : (data.logs ?? []);

  totalEl.textContent = `${data.total ?? 0} événements au total — ${logs.length} affichés`;

  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Aucun événement correspondant.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  logs.forEach(log => {
    const tr = document.createElement('tr');
    const regPct   = (parseFloat(log.regularity_score) * 100).toFixed(0);
    const ratioPct = (parseFloat(log.effective_ratio) * 100).toFixed(0);
    const cell = (text, cls) => {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      td.textContent = text;
      tr.appendChild(td);
      return td;
    };
    cell((log.logged_at ?? '').replace('T', ' ').substring(0, 19), 'muted');
    const strong = document.createElement('strong');
    strong.textContent = log.username;
    cell('').appendChild(strong);
    cell(`${parseFloat(log.inferred_cps).toFixed(1)} CPS`);
    cell(`${regPct}%`);
    cell(`${ratioPct}%`);
    const badge = document.createElement('span');
    const BADGES = {
      flagged:        ['badge-flagged', '⚠ flagged'],
      reduced:        ['badge-reduced', '↓ reduced'],
      depth_capped:   ['badge-reduced', '↓ profondeur plafonnée'],
      depth_rejected: ['badge-flagged', '✖ profondeur rejetée'],
      admin_fix:      ['muted',         '✎ correction admin'],
    };
    const [cls, label] = BADGES[log.action_taken] ?? ['muted', log.action_taken];
    badge.className   = cls;
    badge.textContent = label;
    const actionTd = cell('');
    actionTd.appendChild(badge);
    const detail = formatLogDetails(log.details);
    if (detail) {
      const small = document.createElement('div');
      small.className   = 'muted';
      small.style.fontSize = '0.75rem';
      small.textContent = detail;
      actionTd.appendChild(small);
    }
    tbody.appendChild(tr);
  });
}

/** Résumé lisible du champ JSON `details` d'un événement (ticket #9). */
function formatLogDetails(raw) {
  if (!raw) return '';
  let d;
  try { d = JSON.parse(raw); } catch (_) { return ''; }
  if (d.before && d.after) {
    return `prof. ${d.before.maxDepth}→${d.after.maxDepth}m, blocs ${d.before.effectiveManualBlocks}→${d.after.effectiveManualBlocks}${d.reason ? ` — ${d.reason}` : ''}`;
  }
  if (d.reportedDepth != null) {
    const rej = (d.discardedClicks || d.discardedAutoBlocks) ? ` — rejetés : ${d.discardedClicks} clics, ${d.discardedAutoBlocks} blocs auto` : '';
    return `déclarée ${d.reportedDepth}m, retenue ${d.acceptedDepth}m${rej}`;
  }
  return '';
}

document.getElementById('btn-refresh-ac').addEventListener('click', loadAntiCheatLogs);
document.getElementById('ac-filter-action').addEventListener('change', loadAntiCheatLogs);

// ── Économie & Joueurs ───────────────────────────────────────────────────────

const ECO_KEYS = [
  { key: 'upgrade_cost_multiplier',  inputId: 'eco-upgrade-cost' },
  { key: 'coin_gain_multiplier',     inputId: 'eco-coin-gain'    },
  { key: 'fragment_drop_multiplier', inputId: 'eco-frag-drop'    },
  { key: 'chest_cost_simple',        inputId: 'eco-cost-simple'  },
  { key: 'chest_cost_rare',          inputId: 'eco-cost-rare'    },
  { key: 'chest_cost_antique',       inputId: 'eco-cost-antique' },
];

async function loadEconomy() {
  const { ok, data } = await api('GET', '/api/admin/config');
  if (!ok) return;
  ECO_KEYS.forEach(({ key, inputId }) => {
    const input = document.getElementById(inputId);
    if (input && data.config[key] !== undefined) input.value = data.config[key];
  });
}

document.getElementById('btn-save-economy').addEventListener('click', async () => {
  const msgEl = document.getElementById('eco-msg');
  const errEl = document.getElementById('eco-err');
  msgEl.classList.add('hidden');
  errEl.classList.add('hidden');

  for (const { key, inputId } of ECO_KEYS) {
    const input = document.getElementById(inputId);
    const val   = (input?.value ?? '').trim();
    if (!val) continue;
    const { ok, data } = await api('PUT', '/api/admin/config', { key, value: val });
    if (!ok) {
      errEl.textContent = data.error ?? `Erreur pour "${key}".`;
      errEl.classList.remove('hidden');
      return;
    }
  }

  msgEl.classList.remove('hidden');
  setTimeout(() => msgEl.classList.add('hidden'), 3000);
});

// ── Recherche de joueurs ──────────────────────────────────────────────────────

let _currentPlayerId   = null;
let _currentPlayerName = null;

document.getElementById('btn-player-search').addEventListener('click', searchPlayers);
document.getElementById('player-search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchPlayers();
});

async function searchPlayers() {
  const q = document.getElementById('player-search-input').value.trim();
  if (!q) return;
  const { ok, data } = await api('GET', `/api/admin/players/search?q=${encodeURIComponent(q)}`);
  const resultsDiv = document.getElementById('player-search-results');
  const tbody      = document.querySelector('#player-results-table tbody');
  if (!ok) {
    tbody.innerHTML = `<tr><td colspan="6" class="error">Erreur lors de la recherche.</td></tr>`;
    resultsDiv.classList.remove('hidden');
    return;
  }
  if (!data.users.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Aucun joueur trouvé.</td></tr>`;
    resultsDiv.classList.remove('hidden');
    return;
  }
  tbody.innerHTML = '';
  data.users.forEach(u => {
    const tr    = document.createElement('tr');
    const since = (u.created_at ?? '').substring(0, 10);
    const safeName = u.username.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    tr.innerHTML = `<td>${u.id}</td><td>${u.username}</td><td>${u.email ?? '—'}</td><td>${u.league_id ?? '—'}</td><td>${since}</td><td><button class="btn-ghost" onclick="viewPlayerSave(${u.id}, '${safeName}')">Voir</button></td>`;
    tbody.appendChild(tr);
  });
  resultsDiv.classList.remove('hidden');
}

async function viewPlayerSave(userId, username) {
  _currentPlayerId   = userId;
  _currentPlayerName = username;
  const { ok, data } = await api('GET', `/api/admin/players/${userId}/save`);
  const card = document.getElementById('player-detail-card');
  if (!ok) {
    document.getElementById('pd-username').textContent = username;
    card.classList.remove('hidden');
    return;
  }

  document.getElementById('pd-username').textContent = `${username} (ID ${userId})`;
  const s = data.save;
  if (!s) { card.classList.remove('hidden'); return; }

  document.getElementById('pd-coins').textContent   = (s.coins ?? 0).toLocaleString();
  document.getElementById('pd-depth').textContent   = `${s.depth ?? 1} m`;
  document.getElementById('pd-pickaxe').textContent = s.pickaxeLevel ?? 1;
  document.getElementById('pd-gems').textContent    = s.gems ?? 0;
  document.getElementById('pd-frags').textContent   = s.relicFragments ?? 0;
  document.getElementById('pd-relics').textContent  = s.relicsUnlocked ?? 0;
  document.getElementById('pd-luck').textContent    = s.upgrades?.luck    ?? 0;
  document.getElementById('pd-bag').textContent     = s.upgrades?.bag     ?? 0;
  document.getElementById('pd-autodig').textContent = s.upgrades?.autodig ?? 0;
  const cb = s.shopChestsBought ?? {};
  document.getElementById('pd-chests').textContent  = `📦${cb.simple ?? 0} 💎${cb.rare ?? 0} 🏺${cb.antique ?? 0}`;
  document.getElementById('pd-updated').textContent = (s.updatedAt ?? '—').substring(0, 19);
  document.getElementById('pd-version').textContent = s.saveVersion ?? '—';

  // Reset UI de confirmation
  document.getElementById('player-reset-confirm').classList.add('hidden');
  document.getElementById('player-reset-msg').classList.add('hidden');
  document.getElementById('player-reset-err').classList.add('hidden');
  document.getElementById('btn-season-reset-player').classList.remove('hidden');
  document.getElementById('pr-confirm-name').textContent = username;

  card.classList.remove('hidden');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('btn-close-player-detail').addEventListener('click', () => {
  document.getElementById('player-detail-card').classList.add('hidden');
  _currentPlayerId   = null;
  _currentPlayerName = null;
});

document.getElementById('btn-season-reset-player').addEventListener('click', () => {
  document.getElementById('player-reset-confirm').classList.remove('hidden');
  document.getElementById('btn-season-reset-player').classList.add('hidden');
});

document.getElementById('btn-cancel-player-reset').addEventListener('click', () => {
  document.getElementById('player-reset-confirm').classList.add('hidden');
  document.getElementById('btn-season-reset-player').classList.remove('hidden');
});

document.getElementById('btn-confirm-player-reset').addEventListener('click', async () => {
  if (!_currentPlayerId) return;
  const btn = document.getElementById('btn-confirm-player-reset');
  btn.disabled    = true;
  btn.textContent = 'En cours…';

  const { ok, data } = await api('POST', `/api/admin/players/${_currentPlayerId}/season-reset`, { confirm: true });

  btn.disabled    = false;
  btn.textContent = 'Confirmer';
  document.getElementById('player-reset-confirm').classList.add('hidden');
  document.getElementById('btn-season-reset-player').classList.remove('hidden');

  if (!ok) {
    const errEl = document.getElementById('player-reset-err');
    errEl.textContent = data.error ?? 'Erreur lors du reset.';
    errEl.classList.remove('hidden');
  } else {
    const msgEl = document.getElementById('player-reset-msg');
    msgEl.textContent = data.message ?? 'Reset appliqué !';
    msgEl.classList.remove('hidden');
    viewPlayerSave(_currentPlayerId, _currentPlayerName);
  }
});
