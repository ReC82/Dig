/**
 * admin.js — Panel admin DIG!
 * Auth : ADMIN_SECRET envoyé comme Bearer token dans chaque requête.
 */

let _secret = null;
let _currentSeasonId = null;

// ── Rendu sûr (ticket #15) ────────────────────────────────────────────────────
// Toute donnée venant de l'API (noms, e-mails, dates, config…) passe par
// textContent ou une propriété DOM, jamais par innerHTML : seules des chaînes
// statiques sont affectées à innerHTML dans ce fichier (vérifié par les tests).

/** Ajoute une cellule dont le contenu est du texte brut. */
function addCell(tr, value) {
  const td = document.createElement('td');
  td.textContent = value === null || value === undefined ? '' : String(value);
  tr.appendChild(td);
  return td;
}

/** Ajoute une cellule contenant un bouton « fantôme ». */
function addButtonCell(tr, label, onClick) {
  const td  = document.createElement('td');
  const btn = document.createElement('button');
  btn.className   = 'btn-ghost';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  td.appendChild(btn);
  tr.appendChild(td);
  return td;
}

/** Badge de statut ; la classe n'accepte que des caractères sûrs. */
function statusBadge(status) {
  const span = document.createElement('span');
  span.className   = `badge-${String(status).replace(/[^a-z0-9_-]/gi, '')}`;
  span.textContent = status;
  return span;
}

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
    if (btn.dataset.tab === 'security')        loadSecurity();
    if (btn.dataset.tab === 'contest')         loadContest();
    if (btn.dataset.tab === 'points')          loadPoints();
    if (btn.dataset.tab === 'shop')            loadShop();
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
    [s.id, s.name, s.start_at, s.end_at].forEach(v => addCell(tr, v));
    addCell(tr, '').appendChild(statusBadge(s.status));
    if (s.status === 'active') addButtonCell(tr, 'Clore', () => endSeason(s.id));
    else addCell(tr, '');
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
    [l.id, `${l.icon} ${l.name}`, l.level, l.rank_min, l.rank_max ?? '∞', l.sort_order].forEach(v => addCell(tr, v));
    addButtonCell(tr, 'Supprimer', () => deleteLeague(l.id, l.name));
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
    [
      `#${r.rank}`, r.username, `${r.maxDepth}m`, reported, r.manualBlocks,
      r.league ? `${r.league.icon} ${r.league.name}` : '—',
    ].forEach(v => addCell(tr, v));
    addButtonCell(tr, 'Corriger', () => correctRanking(r));
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
  season_duration:              'Inutilisé — saisons hebdomadaires lundi → dimanche UTC (#16)',
  upgrade_cost_multiplier:      '× coût en pièces des améliorations (0.1–10)',
  coin_gain_multiplier:         '× pièces gagnées par bloc et hors ligne (0.1–10)',
  fragment_drop_multiplier:     '× fragments des coffres de la boutique (0.1–10)',
  chest_cost_simple:            'Coût du coffre simple (pièces)',
  chest_cost_rare:              'Coût du coffre rare (pièces)',
  chest_cost_antique:           'Coût du coffre antique (pièces)',
  max_effective_cps:            'Clics/s max avant exclusion du classement',
  promotion_rate:               'Taux de promotion entre ligues (0–1)',
  difficulty_coefficient:       'Coefficient de difficulté par ligue',
  min_active_players_per_league:'Joueurs actifs min pour créer une ligue',
  anti_autoclick_enabled:       'Anti-autoclicker activé (true/false)',
  depth_validation_enabled:     'Validation serveur de la profondeur (true/false)',
  depth_max_cps:                'Clics/s max retenus pour la profondeur',
  antibot_mode:                 'Anti-bot : off ou shadow (observation, aucune sanction) — #25',
  damage_budget_mode:           'Budget de dégâts (profondeur) : off, shadow ou enforce — #25',
};

async function loadConfig() {
  const { ok, data } = await api('GET', '/api/admin/config');
  if (!ok) return;
  const container = document.getElementById('config-rows');
  container.innerHTML = '';
  Object.entries(data.config).forEach(([key, value]) => {
    const div = document.createElement('div');
    div.className = 'config-row';
    const keyEl = document.createElement('span');
    keyEl.className   = 'config-key';
    keyEl.textContent = key;
    const labelEl = document.createElement('span');
    labelEl.className   = 'muted config-label';
    labelEl.style.flex  = '2';
    labelEl.textContent = CONFIG_LABELS[key] ?? '';
    const input = document.createElement('input');
    input.className   = 'config-value';
    input.dataset.key = key;
    input.type        = 'text';
    input.value       = value ?? '';
    div.append(keyEl, labelEl, input);
    container.appendChild(div);
  });
}

document.getElementById('btn-save-config').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('.config-value[data-key]');
  const msgEl  = document.getElementById('config-msg');
  msgEl.classList.add('hidden');
  const errors = [];
  for (const input of inputs) {
    const { ok, data } = await api('PUT', '/api/admin/config', { key: input.dataset.key, value: input.value });
    if (!ok) errors.push(data.error ?? `Erreur pour "${input.dataset.key}".`);
  }
  if (errors.length) { alert(errors.join('\n')); return; }
  msgEl.classList.remove('hidden');
  setTimeout(() => msgEl.classList.add('hidden'), 3000);
});

// ── Ligues & Saisons (vue d'ensemble) ─────────────────────────────────────────

let _overviewSeasonId = null;

// Paramètres affichés dans la section (sous-ensemble de la config)
const SEASON_PARAMS = [
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
  document.getElementById('ov-season-status').replaceChildren(statusBadge(season.status));
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
      [`${l.icon} ${l.name}`, l.level, l.total_players, l.active_players].forEach(v => addCell(tr, v));
      addButtonCell(tr, 'Voir', () => focusLeagueLeaderboard(l.id));
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
  await loadSeasonEnd();
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
    const labelEl = document.createElement('label');
    labelEl.className   = 'param-label';
    labelEl.htmlFor     = `param-${key}`;
    labelEl.textContent = label;
    const input = document.createElement('input');
    input.id          = `param-${key}`;
    input.className   = 'ov-param-value';
    input.dataset.key = key;
    input.type        = type === 'number' ? 'number' : 'text';
    if (min  != null) input.min  = String(min);
    if (max  != null) input.max  = String(max);
    if (step != null) input.step = String(step);
    input.value = data.config[key] ?? '';
    div.append(labelEl, input);
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

// ── Date de fin de la saison active (#44) ────────────────────────────────────

let _seState = null, _sePreview = null;
const _seBoth = v => (v ? `${v.local ?? '—'} — ${v.utc} UTC` : '—');

function _seMsg(id, text) {
  for (const k of ['se-msg', 'se-err']) document.getElementById(k).classList.add('hidden');
  if (!text) return;
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.remove('hidden');
}

async function loadSeasonEnd() {
  const { ok, data } = await api('GET', '/api/admin/seasons/active/end');
  if (!ok || !data.season) { _seState = null; document.getElementById('se-current').textContent = 'Aucune saison active.'; return; }
  _seState = data;
  document.getElementById('se-now').textContent     = _seBoth(data.serverNow);
  document.getElementById('se-current').textContent = _seBoth(data.season.endAt);
  document.getElementById('se-weekly').textContent  = _seBoth(data.weeklyEnd);
  document.getElementById('se-lead').textContent    = data.minLeadMinutes;
  document.getElementById('se-badge').textContent   = data.exceptional ? '⚠ fin exceptionnelle programmée' : '';
  document.getElementById('btn-se-cancel').classList.toggle('hidden', !data.cancellable);
  const tbody = document.querySelector('#se-history tbody');
  tbody.innerHTML = '';
  if (!data.history.length) tbody.innerHTML = '<tr><td colspan="5" class="muted">Aucun changement.</td></tr>';
  for (const h of data.history) {
    const tr = document.createElement('tr');
    [_seBoth(h.createdAt), h.action === 'set' ? 'Programmée' : 'Annulée', _seBoth(h.oldEnd), _seBoth(h.newEnd), h.reason ?? '']
      .forEach(v => addCell(tr, v));
    tbody.appendChild(tr);
  }
}

document.getElementById('btn-se-preview').addEventListener('click', async () => {
  _seMsg();
  document.getElementById('se-preview').classList.add('hidden');
  if (!_seState) return;
  const endLocal = document.getElementById('se-local').value;
  if (!endLocal) return _seMsg('se-err', 'Choisissez une date et une heure (Bruxelles).');
  const { ok, data } = await api('POST', '/api/admin/seasons/active/end/preview', { seasonId: _seState.season.id, end_local: endLocal });
  if (!ok) return _seMsg('se-err', data.error ?? 'Aperçu impossible.');
  _sePreview = { ...data, endLocal };
  const ul = document.getElementById('se-consequences');
  ul.innerHTML = '';
  const lines = [
    `Fin actuelle : ${_seBoth(data.currentEnd)}`,
    `Nouvelle fin : ${_seBoth(data.newEnd)}`,
    `Joueurs actifs cette saison : ${data.activePlayers}`,
    ...data.consequences,
  ];
  for (const line of lines) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
  document.getElementById('se-name').textContent = data.season.name;
  document.getElementById('se-confirm').value = '';
  document.getElementById('se-preview').classList.remove('hidden');
});

document.getElementById('btn-se-abort').addEventListener('click', () => {
  document.getElementById('se-preview').classList.add('hidden');
  _sePreview = null;
});

document.getElementById('btn-se-apply').addEventListener('click', async () => {
  if (!_sePreview) return;
  const btn = document.getElementById('btn-se-apply');
  btn.disabled = true;
  const { ok, data } = await api('PUT', '/api/admin/seasons/active/end', {
    seasonId: _sePreview.season.id, end_local: _sePreview.endLocal, expectedEndAt: _sePreview.expectedEndAt,
    confirm: document.getElementById('se-confirm').value.trim(), reason: document.getElementById('se-reason').value.trim(),
  });
  btn.disabled = false;
  if (!ok) return _seMsg('se-err', data.error ?? 'Programmation impossible.');
  document.getElementById('se-preview').classList.add('hidden');
  _sePreview = null;
  await loadSeasonOverview();
  _seMsg('se-msg', `Fin programmée : ${_seBoth(data.season.endAt)}.`);
});

document.getElementById('btn-se-cancel').addEventListener('click', async () => {
  if (!_seState) return;
  if (!confirm(`Annuler la fin exceptionnelle et revenir à la fin hebdomadaire (${_seBoth(_seState.weeklyEnd)}) ?`)) return;
  const { ok, data } = await api('DELETE', '/api/admin/seasons/active/end', { seasonId: _seState.season.id, expectedEndAt: _seState.expectedEndAt });
  if (!ok) return _seMsg('se-err', data.error ?? 'Annulation impossible.');
  await loadSeasonOverview();
  _seMsg('se-msg', `Fin exceptionnelle annulée : retour à ${_seBoth(data.season.endAt)}.`);
});

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
    const closedName = document.createElement('strong');
    closedName.textContent = data.closedSeason?.name ?? '';
    const newName = document.createElement('strong');
    newName.textContent = data.newSeason?.name ?? '';
    resultEl.replaceChildren('✓ Saison ', closedName, ' clôturée. Nouvelle saison : ', newName);
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
    [`#${r.rank}`, r.username, `${r.maxDepth}m`, r.manualBlocks].forEach(v => addCell(tr, v));
    tbody.appendChild(tr);
  });
}

document.getElementById('ov-league-select').addEventListener('change', loadLeagueLeaderboardView);

// ── Journal anti-autoclicker ───────────────────────────────────────────────────

async function loadAntiCheatLogs() {
  const action = document.getElementById('ac-filter-action').value;
  const url    = '/api/admin/anticheat/logs?limit=100' + (action ? `&action=${encodeURIComponent(action)}` : '');
  const { ok, data } = await api('GET', url);

  const tbody   = document.getElementById('ac-log-body');
  const totalEl = document.getElementById('ac-log-total');

  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="6" class="error">Erreur lors du chargement.</td></tr>';
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
      damage_capped:  ['badge-reduced', '↓ budget de dégâts'],
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
    const budget = d.budgetDepth != null ? ` (budget ${d.budgetDepth}m)` : '';
    return `déclarée ${d.reportedDepth}m, retenue ${d.acceptedDepth}m${budget}${rej}`;
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
    tbody.innerHTML = '<tr><td colspan="6" class="error">Erreur lors de la recherche.</td></tr>';
    resultsDiv.classList.remove('hidden');
    return;
  }
  if (!data.users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Aucun joueur trouvé.</td></tr>';
    resultsDiv.classList.remove('hidden');
    return;
  }
  tbody.innerHTML = '';
  data.users.forEach(u => {
    const tr    = document.createElement('tr');
    const since = (u.created_at ?? '').substring(0, 10);
    [u.id, u.username, u.email ?? '—', u.league_id ?? '—', since].forEach(v => addCell(tr, v));
    addButtonCell(tr, 'Voir', () => viewPlayerSave(u.id, u.username));
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

// ── Anti-bot (#25) ───────────────────────────────────────────────────────────

const SEC_LEVELS = ['0 — rien', '1 — journaliser', '2 — limiter', '3 — défi', '4 — suspension'];

async function loadSecurity() {
  const type = document.getElementById('sec-filter-type').value;
  const [sum, ev] = await Promise.all([
    api('GET', '/api/admin/security/summary'),
    api('GET', '/api/admin/security/events?limit=100' + (type ? `&type=${encodeURIComponent(type)}` : '')),
  ]);

  const status = document.getElementById('sec-status');
  status.innerHTML = '';
  if (sum.ok) {
    const s = sum.data;
    const lines = [
      `Mode observation : ${s.antibotMode}${s.envOverride ? ' (forcé par ANTIBOT=off)' : ''}`,
      `Budget de dégâts : ${s.damageBudgetMode}`,
      `Saison : ${s.seasonId ?? '—'} — comptes par niveau : ${s.levels.map((n, i) => `N${i} ${n}`).join(' · ')}`,
      `Événements (7 j) : ${s.eventsLast7Days.map(e => `${e.type} ${e.n}`).join(' · ') || 'aucun'}`,
      `Calcul par sauvegarde : ${s.timings.avgMs.toFixed(2)} ms en moyenne, ${s.timings.maxMs.toFixed(2)} ms max (${s.timings.saves} sauvegardes depuis ${s.timings.since.slice(0, 16).replace('T', ' ')})`,
    ];
    for (const l of lines) {
      const p = document.createElement('p');
      p.textContent = l;
      status.appendChild(p);
    }
    const body = document.getElementById('sec-accounts-body');
    body.innerHTML = '';
    if (!s.accounts.length) body.innerHTML = '<tr><td colspan="4" class="muted">Aucun compte à risque.</td></tr>';
    for (const a of s.accounts) {
      const tr = document.createElement('tr');
      addCell(tr, a.username);
      addCell(tr, a.score);
      addCell(tr, SEC_LEVELS[a.level]);
      addCell(tr, Object.entries(a.components).map(([k, v]) => `${k} ${v}`).join(', '));
      body.appendChild(tr);
    }
  } else {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = 'Erreur lors du chargement.';
    status.appendChild(p);
  }

  const tbody = document.getElementById('sec-events-body');
  tbody.innerHTML = '';
  if (!ev.ok) { tbody.innerHTML = '<tr><td colspan="5" class="error">Erreur lors du chargement.</td></tr>'; return; }
  document.getElementById('sec-events-total').textContent = `${ev.data.total} événements au total — ${ev.data.events.length} affichés`;
  if (!ev.data.events.length) tbody.innerHTML = '<tr><td colspan="5" class="muted">Aucun événement.</td></tr>';
  for (const e of ev.data.events) {
    const tr = document.createElement('tr');
    addCell(tr, (e.created_at ?? '').substring(0, 19)).className = 'muted';
    addCell(tr, e.type);
    addCell(tr, e.username ?? (e.user_id ? `user_${e.user_id}` : 'admin'));
    addCell(tr, e.score_after == null ? '' : `${e.score_before ?? 0} → ${e.score_after}`);
    addCell(tr, e.details ?? '').style.fontSize = '0.75rem';
    tbody.appendChild(tr);
  }
}

document.getElementById('btn-refresh-sec').addEventListener('click', loadSecurity);
document.getElementById('sec-filter-type').addEventListener('change', loadSecurity);

// ── Concours au mérite (#30) ──────────────────────────────────────────────────

const CT_STATUS = {
  designated: 'Désigné', contacted: 'Contacté', identity_verified: 'Identité vérifiée',
  sent: 'Lot envoyé', confirmed: 'Confirmé', expired: 'Expiré',
};
const CT_REASON = {
  depth_zero: 'profondeur nulle', account_deleted: 'compte supprimé', not_eligible: 'non éligible',
  below_min_depth: 'sous la profondeur minimale', risk_level: 'risque anti-bot trop élevé',
  admin_excluded: 'exclu par l\'admin', cooldown: 'a gagné récemment',
};
const CT_BLOCKER = {
  season_not_frozen: 'saison pas encore close et figée (aperçu indicatif sur le classement vivant)',
  snapshot_verification_failed: 'vérification des empreintes du classement figé en échec',
  outside_calendar: 'saison hors du calendrier du concours',
  already_attributed: 'lots déjà attribués pour cette saison et ce mode',
  real_prizes_locked: 'cadeaux réels verrouillés (CONTEST_REAL_PRIZES)',
  contest_disabled: 'concours désactivé',
  insufficient_stock: 'stock de lots insuffisant',
};

let _ctPreview = null;

/** Message de résultat sous un formulaire (texte brut). */
function ctMessage(id, text, ok) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = ok ? 'success' : 'error';
}

const ctDateInput = v => (v ? v.replace(' ', 'T').slice(0, 16) : '');
const ctDateValue = v => (v ? `${v.replace('T', ' ')}:00` : null);
const ctPrize = p => (p && p.label ? `${p.label} ${(p.valueCents / 100).toFixed(2)} ${p.currency}` : '');

async function loadContest() {
  const { ok, data } = await api('GET', '/api/admin/contest');
  if (!ok) { ctMessage('ct-settings-msg', data.error || 'Erreur lors du chargement.', false); return; }
  const s = data.settings;

  const lock = document.getElementById('ct-lock');
  lock.className = `contest-banner contest-banner--${s.realPrizesUnlocked ? 'open' : 'locked'}`;
  lock.textContent = s.realPrizesUnlocked
    ? '⚠ Cadeaux réels DÉVERROUILLÉS sur ce serveur (CONTEST_REAL_PRIZES=on).'
    : `🔒 Simulation uniquement : cadeaux réels verrouillés. Concours ${s.enabled ? 'actif' : 'inactif'}.`;

  document.getElementById('ct-enabled').checked = s.enabled;
  document.getElementById('ct-title').value = s.title;
  document.getElementById('ct-description').value = s.description;
  document.getElementById('ct-prize-label').value = s.prize.label;
  document.getElementById('ct-prize-provider').value = s.prize.provider;
  document.getElementById('ct-prize-value').value = (s.prize.valueCents / 100).toFixed(2);
  document.getElementById('ct-prize-currency').value = s.prize.currency;
  document.getElementById('ct-prize-stock').value = s.prize.stock;
  document.getElementById('ct-lots').value = s.lotsPerSeason;
  document.getElementById('ct-starts').value = ctDateInput(s.startsAt);
  document.getElementById('ct-ends').value = ctDateInput(s.endsAt);
  document.getElementById('ct-min-depth').value = s.minDepth;
  document.getElementById('ct-max-risk').value = s.maxRiskLevel === null ? '' : String(s.maxRiskLevel);
  document.getElementById('ct-cooldown').value = s.cooldownSeasons;
  document.getElementById('ct-claim-days').value = s.claimDays;
  const re = s.realEligibility || {};
  document.getElementById('ct-re-countries').value = (re.countries || []).join(', ');
  document.getElementById('ct-re-min-age').value = re.minAge ?? '';
  document.getElementById('ct-re-parental').checked = !!re.parentalConsent;
  document.getElementById('ct-re-provider').value = re.provider || '';
  document.getElementById('ct-re-notes').value = re.notes || '';

  const sel = document.getElementById('ct-season');
  const keep = sel.value;
  sel.textContent = '';
  for (const se of data.seasons) {
    const opt = document.createElement('option');
    opt.value = se.id;
    const tags = [se.status, se.frozen ? 'figée' : 'non figée'];
    if (se.simulationWinners) tags.push(`${se.simulationWinners} lot(s) simulé(s)`);
    if (se.realWinners) tags.push(`${se.realWinners} lot(s) réel(s)`);
    opt.textContent = `${se.name} (${tags.join(', ')})`;
    sel.appendChild(opt);
  }
  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;

  await Promise.all([loadContestPreview(), loadContestWinners(), loadContestAudit()]);
}

async function saveContestSettings() {
  const num = id => {
    const v = document.getElementById(id).value.trim();
    return v === '' ? null : Number(v);
  };
  const body = {
    enabled:         document.getElementById('ct-enabled').checked,
    title:           document.getElementById('ct-title').value,
    description:     document.getElementById('ct-description').value,
    prizeLabel:      document.getElementById('ct-prize-label').value,
    prizeProvider:   document.getElementById('ct-prize-provider').value,
    prizeValueCents: Math.round((num('ct-prize-value') ?? 0) * 100),
    prizeCurrency:   document.getElementById('ct-prize-currency').value.trim().toUpperCase(),
    prizeStock:      num('ct-prize-stock'),
    lotsPerSeason:   num('ct-lots'),
    startsAt:        ctDateValue(document.getElementById('ct-starts').value),
    endsAt:          ctDateValue(document.getElementById('ct-ends').value),
    minDepth:        num('ct-min-depth'),
    maxRiskLevel:    num('ct-max-risk'),
    cooldownSeasons: num('ct-cooldown'),
    claimDays:       num('ct-claim-days'),
    realEligibility: {
      countries:       document.getElementById('ct-re-countries').value.split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
      minAge:          num('ct-re-min-age'),
      parentalConsent: document.getElementById('ct-re-parental').checked,
      provider:        document.getElementById('ct-re-provider').value,
      notes:           document.getElementById('ct-re-notes').value,
    },
  };
  const { ok, data } = await api('PUT', '/api/admin/contest/settings', body);
  ctMessage('ct-settings-msg', ok ? 'Réglages enregistrés.' : (data.error || 'Erreur.'), ok);
  if (ok) loadContest();
}

async function loadContestPreview() {
  const seasonId = document.getElementById('ct-season').value;
  const mode = document.getElementById('ct-mode').value;
  const info = document.getElementById('ct-preview-info');
  const tbody = document.getElementById('ct-preview-body');
  const btn = document.getElementById('btn-ct-attribute');
  btn.disabled = true;
  _ctPreview = null;
  info.textContent = '';
  if (!seasonId) { tbody.innerHTML = '<tr><td colspan="9" class="muted">Aucune saison.</td></tr>'; return; }
  const { ok, data } = await api('GET', `/api/admin/contest/seasons/${encodeURIComponent(seasonId)}/preview?mode=${encodeURIComponent(mode)}`);
  tbody.innerHTML = '';
  if (!ok) { tbody.innerHTML = '<tr><td colspan="9" class="error">Erreur lors du chargement.</td></tr>'; return; }
  _ctPreview = data;

  const lines = [
    `${data.season.name} — ${data.season.startAt} → ${data.season.endAt} (UTC) — source : ${data.source === 'snapshot' ? 'classement figé' : 'classement vivant'}`,
    data.snapshot ? `Empreinte du classement figé : ${data.snapshot.hash}` : 'Pas encore de classement figé.',
    `${data.counts.participants} participant(s), ${data.counts.eligible} éligible(s) au concours, ${data.counts.lots} lot(s) à attribuer (${data.criteria.lotsPerSeason} prévu(s)).`,
  ];
  for (const b of data.blockers) lines.push(`⛔ ${CT_BLOCKER[b] || b}`);
  if (!data.blockers.length && data.attributable) lines.push(`✅ Attribution possible en mode ${data.mode === 'real' ? 'RÉEL' : 'simulation'}.`);
  for (const l of lines) {
    const p = document.createElement('p');
    p.className = l.startsWith('⛔') ? 'error' : 'muted';
    p.style.fontSize = '0.8rem';
    p.textContent = l;
    info.appendChild(p);
  }

  if (!data.participants.length) tbody.innerHTML = '<tr><td colspan="9" class="muted">Aucun participant.</td></tr>';
  for (const x of data.participants) {
    const tr = document.createElement('tr');
    addCell(tr, x.position);
    addCell(tr, x.rank ?? '—');
    addCell(tr, x.username ?? `#${x.userId}`);
    addCell(tr, `${x.maxDepth} m`);
    addCell(tr, x.manualBlocks);
    addCell(tr, `N${x.riskLevel}`);
    const why = x.reason ? (CT_REASON[x.reason] || x.reason) : 'éligible';
    addCell(tr, x.exclusion ? `${why} : ${x.exclusion}` : why).className = x.reason ? 'muted' : '';
    addCell(tr, x.lotNo ? `🎁 lot ${x.lotNo}` : '');
    if (data.source !== 'snapshot') addCell(tr, '');
    else if (x.reason === 'admin_excluded') addButtonCell(tr, 'Réintégrer', () => contestUnexclude(x));
    else addButtonCell(tr, 'Exclure', () => contestExclude(x));
    tbody.appendChild(tr);
  }
  btn.disabled = !data.attributable;
  btn.textContent = data.mode === 'real' ? 'Attribuer les lots RÉELS' : 'Attribuer les lots (simulation)';
}

async function contestExclude(x) {
  const reason = prompt(`Motif de l'exclusion de ${x.username ?? '#' + x.userId} pour cette saison (journalisé) :`);
  if (!reason) return;
  const { ok, data } = await api('POST', `/api/admin/contest/seasons/${_ctPreview.season.id}/exclusions`, { userId: x.userId, reason });
  if (!ok) { alert(data.error || 'Erreur.'); return; }
  loadContestPreview();
  loadContestAudit();
}

async function contestUnexclude(x) {
  if (!confirm(`Réintégrer ${x.username ?? '#' + x.userId} ?`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/contest/seasons/${_ctPreview.season.id}/exclusions/${x.userId}`);
  if (!ok) { alert(data.error || 'Erreur.'); return; }
  loadContestPreview();
  loadContestAudit();
}

async function contestAttribute() {
  if (!_ctPreview || !_ctPreview.attributable) return;
  const p = _ctPreview;
  const names = p.participants.filter(x => x.lotNo).map(x => x.username ?? `#${x.userId}`).join(', ');
  if (!confirm(`Attribuer ${p.counts.lots} lot(s) (${p.mode}) pour ${p.season.name} à : ${names} ?\nDéfinitif : une saison ne peut pas être attribuée deux fois.`)) return;
  const { ok, data } = await api('POST', `/api/admin/contest/seasons/${p.season.id}/attribute`, { mode: p.mode });
  ctMessage('ct-attr-msg', ok ? `${data.winners.length} lot(s) attribué(s).` : (data.error || 'Erreur.'), ok);
  loadContest();
}

async function loadContestWinners() {
  const mode = document.getElementById('ct-winners-mode').value;
  const { ok, data } = await api('GET', '/api/admin/contest/winners' + (mode ? `?mode=${encodeURIComponent(mode)}` : ''));
  const tbody = document.getElementById('ct-winners-body');
  tbody.innerHTML = '';
  if (!ok) { tbody.innerHTML = '<tr><td colspan="8" class="error">Erreur lors du chargement.</td></tr>'; return; }
  if (!data.winners.length) tbody.innerHTML = '<tr><td colspan="8" class="muted">Aucun gagnant.</td></tr>';
  for (const w of data.winners) {
    const tr = document.createElement('tr');
    addCell(tr, w.seasonName ?? `#${w.seasonId}`);
    addCell(tr, w.mode === 'real' ? 'Réel' : 'Simulation');
    addCell(tr, `${w.lotNo} — ${ctPrize(w.prize)}`);
    addCell(tr, w.username ?? `#${w.userId}`);
    addCell(tr, `${w.rank} / ${w.maxDepth} m`);
    const st = addCell(tr, '');
    const badge = statusBadge(w.status);
    badge.textContent = CT_STATUS[w.status] || w.status;
    st.appendChild(badge);
    const due = addCell(tr, w.overdue ? `⚠ ${w.expiresAt}` : w.expiresAt);
    if (w.overdue) due.className = 'contest-overdue';
    const td = document.createElement('td');
    const box = document.createElement('div');
    box.className = 'contest-actions';
    for (const to of w.next) {
      const b = document.createElement('button');
      b.className = to === 'expired' ? 'btn-ghost contest-overdue' : 'btn-ghost';
      b.textContent = `→ ${CT_STATUS[to] || to}`;
      b.addEventListener('click', () => contestTransition(w, to));
      box.appendChild(b);
    }
    for (const [label, fn] of [['Coordonnées', () => contestContact(w)], ['Journal', () => loadContestAudit(w.id)]]) {
      const b = document.createElement('button');
      b.className = 'btn-ghost';
      b.textContent = label;
      b.addEventListener('click', fn);
      box.appendChild(b);
    }
    td.appendChild(box);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

async function contestTransition(w, to) {
  const note = prompt(`${w.username ?? '#' + w.userId} : ${CT_STATUS[w.status]} → ${CT_STATUS[to]}\nNote facultative (jamais d'e-mail ni de code cadeau) :`, '');
  if (note === null) return;
  const { ok, data } = await api('POST', `/api/admin/contest/winners/${w.id}/status`, { status: to, note });
  if (!ok) { alert(data.error || 'Erreur.'); return; }
  loadContestWinners();
  loadContestAudit();
}

async function contestContact(w) {
  if (!confirm(`Afficher l'adresse e-mail de ${w.username ?? '#' + w.userId} ? La consultation est journalisée.`)) return;
  const { ok, data } = await api('POST', `/api/admin/contest/winners/${w.id}/contact`, {});
  const el = document.getElementById('ct-contact');
  el.className = ok ? 'muted' : 'error';
  el.textContent = !ok ? (data.error || 'Erreur.')
    : !data.accountExists ? `${w.username ?? '#' + w.userId} : compte supprimé, aucun contact possible.`
    : `${data.username} : ${data.email || 'aucune adresse e-mail'}${data.email ? (data.emailVerified ? ' (vérifiée)' : ' (NON vérifiée)') : ''}`;
  loadContestAudit();
}

async function loadContestAudit(winnerId) {
  const q = winnerId ? `?winnerId=${encodeURIComponent(winnerId)}` : '';
  const { ok, data } = await api('GET', `/api/admin/contest/audit${q}`);
  const tbody = document.getElementById('ct-audit-body');
  tbody.innerHTML = '';
  if (!ok) { tbody.innerHTML = '<tr><td colspan="6" class="error">Erreur lors du chargement.</td></tr>'; return; }
  document.getElementById('ct-audit-total').textContent =
    `${data.total} événement(s)${winnerId ? ` pour le gagnant #${winnerId}` : ''} — ${data.events.length} affiché(s)`;
  if (!data.events.length) tbody.innerHTML = '<tr><td colspan="6" class="muted">Aucun événement.</td></tr>';
  for (const e of data.events) {
    const tr = document.createElement('tr');
    addCell(tr, e.createdAt).className = 'muted';
    addCell(tr, e.action);
    addCell(tr, e.seasonId ?? '');
    addCell(tr, e.winnerId ?? '');
    addCell(tr, e.to ? `${e.from ? (CT_STATUS[e.from] || e.from) + ' → ' : ''}${CT_STATUS[e.to] || e.to}` : '');
    addCell(tr, e.details ? JSON.stringify(e.details) : '').style.fontSize = '0.75rem';
    tbody.appendChild(tr);
  }
}

document.getElementById('btn-refresh-contest').addEventListener('click', loadContest);
document.getElementById('btn-save-contest').addEventListener('click', saveContestSettings);
document.getElementById('btn-ct-preview').addEventListener('click', loadContestPreview);
document.getElementById('ct-season').addEventListener('change', loadContestPreview);
document.getElementById('ct-mode').addEventListener('change', loadContestPreview);
document.getElementById('btn-ct-attribute').addEventListener('click', contestAttribute);
document.getElementById('ct-winners-mode').addEventListener('change', loadContestWinners);

// ── Points de récompense (#33) ────────────────────────────────────────────────

function ptMessage(id, text, ok) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = ok ? 'success' : 'error';
}

async function loadPoints() {
  const { ok, data } = await api('GET', '/api/admin/points');
  if (!ok) { ptMessage('pt-scale-msg', data.error || 'Erreur lors du chargement.', false); return; }
  const s = data.settings;
  const banner = document.getElementById('pt-mode-banner');
  banner.className = `contest-banner contest-banner--${s.mode === 'live' ? 'open' : 'locked'}`;
  banner.textContent = s.mode === 'live'
    ? `✅ Crédit réel des points actif depuis ${s.liveSince} UTC (barème v${s.scaleVersion}).`
    : `🧪 Simulation : barème v${s.scaleVersion} affiché aux joueurs, aucun point crédité.`;
  document.getElementById('pt-scale-info').textContent =
    `Version en vigueur : v${s.scaleVersion}${s.scaleNote ? ` — ${s.scaleNote}` : ''} (${data.scales.length} version(s) conservée(s)).`;
  const ta = document.getElementById('pt-scale');
  if (!ta.dataset.dirty) ta.value = JSON.stringify(s.scale, null, 2);

  const v = data.verification;
  document.getElementById('pt-totals').textContent =
    `Portefeuilles : ${data.totals.wallets} — solde total ${data.totals.balance} pts (gagnés ${data.totals.earned}, dépensés ${data.totals.spent}). `
    + `Contrôle du registre : ${v.ok ? 'OK' : `ÉCART (${v.mismatches.length} portefeuille(s), ${v.orphanUsers} orphelin(s))`}.`;

  const sel = document.getElementById('pt-preview-season');
  const keep = sel.value;
  sel.textContent = '';
  const seen = new Set();
  for (const r of data.runs) {
    if (seen.has(r.seasonId)) continue;
    seen.add(r.seasonId);
    const opt = document.createElement('option');
    opt.value = r.seasonId;
    opt.textContent = r.seasonName || `Saison ${r.seasonId}`;
    sel.appendChild(opt);
  }
  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;

  const tbody = document.getElementById('pt-runs-body');
  tbody.textContent = '';
  if (!data.runs.length) { tbody.innerHTML = '<tr><td colspan="8" class="muted">Aucune attribution.</td></tr>'; return; }
  for (const r of data.runs) {
    const tr = document.createElement('tr');
    [r.seasonName || r.seasonId, r.mode, r.createdAt, `v${r.scaleVersion}`, r.eligible, r.recipients, r.totalPoints].forEach(x => addCell(tr, x));
    addButtonCell(tr, 'Détail', () => loadPointAwards(r.seasonId));
    tbody.appendChild(tr);
  }
}

async function loadPointAwards(seasonId) {
  const { ok, data } = await api('GET', `/api/admin/points/seasons/${encodeURIComponent(seasonId)}`);
  const tbody = document.getElementById('pt-awards-body');
  tbody.textContent = '';
  if (!ok) return;
  if (!data.awards.length) { tbody.innerHTML = '<tr><td colspan="6" class="muted">Aucun éligible.</td></tr>'; return; }
  for (const a of data.awards) {
    const tr = document.createElement('tr');
    [a.mode, a.rank, a.username ?? `#${a.user_id}`, a.tier ?? '—', a.points, a.ledger_id ?? '—'].forEach(x => addCell(tr, x));
    tbody.appendChild(tr);
  }
}

function ptScaleFromEditor() {
  try { return JSON.parse(document.getElementById('pt-scale').value); }
  catch (e) { ptMessage('pt-scale-msg', `JSON invalide : ${e.message}`, false); return null; }
}

document.getElementById('btn-refresh-points').addEventListener('click', () => {
  delete document.getElementById('pt-scale').dataset.dirty;
  loadPoints();
});
document.getElementById('pt-scale').addEventListener('input', e => { e.target.dataset.dirty = '1'; });

document.getElementById('btn-pt-preview').addEventListener('click', async () => {
  const scale = ptScaleFromEditor();
  const seasonId = Number(document.getElementById('pt-preview-season').value);
  if (!scale) return;
  if (!seasonId) { ptMessage('pt-scale-msg', 'Aucune saison figée à prévisualiser.', false); return; }
  const { ok, data } = await api('POST', '/api/admin/points/scale/preview', { scale, seasonId });
  if (!ok) { ptMessage('pt-scale-msg', data.error || 'Erreur.', false); return; }
  const top = data.awards.slice(0, 10).map(a => `#${a.rank} ${a.tier ?? '—'} ${a.points}`).join(' · ');
  ptMessage('pt-scale-msg', `Aperçu : ${data.eligible} éligible(s), ${data.total} point(s) au total. ${top}`, true);
});

document.getElementById('btn-pt-save-scale').addEventListener('click', async () => {
  const scale = ptScaleFromEditor();
  if (!scale) return;
  if (!confirm('Enregistrer cette version du barème ? Elle s\'appliquera aux prochaines clôtures.')) return;
  const note = document.getElementById('pt-scale-note').value;
  const { ok, data } = await api('PUT', '/api/admin/points/scale', { scale, note });
  ptMessage('pt-scale-msg', ok ? `Barème v${data.scaleVersion} enregistré.` : (data.error || 'Erreur.'), ok);
  if (ok) { delete document.getElementById('pt-scale').dataset.dirty; loadPoints(); }
});

async function setPointsMode(mode) {
  const msg = mode === 'live'
    ? 'Activer le crédit réel des points ? Le barème en vigueur sera appliqué aux saisons qui se terminent à partir de maintenant.'
    : 'Revenir en simulation ? Les points déjà crédités restent acquis.';
  if (!confirm(msg)) return;
  const { ok, data } = await api('PUT', '/api/admin/points/mode', { mode });
  ptMessage('pt-mode-msg', ok ? `Mode : ${data.mode}.` : (data.error || 'Erreur.'), ok);
  loadPoints();
}
document.getElementById('btn-pt-live').addEventListener('click', () => setPointsMode('live'));
document.getElementById('btn-pt-sim').addEventListener('click', () => setPointsMode('simulation'));

document.getElementById('btn-pt-adjust').addEventListener('click', async () => {
  const userId = Number(document.getElementById('pt-adj-user').value);
  const amount = Number(document.getElementById('pt-adj-amount').value);
  const reason = document.getElementById('pt-adj-reason').value;
  if (!confirm(`Ajuster de ${amount} point(s) le joueur #${userId} ?`)) return;
  const { ok, data } = await api('POST', '/api/admin/points/adjust', { userId, amount, reason });
  ptMessage('pt-adj-msg', ok ? `Nouveau solde : ${data.wallet.balance} pts.` : (data.error || 'Erreur.'), ok);
  if (ok) loadPoints();
});

// ── Boutique de cadeaux (#34) ─────────────────────────────────────────────────

const SH_STATUS = { pending: 'En attente', processing: 'En préparation', delivered: 'Remis', cancelled: 'Annulé' };
const SH_FIELDS = { kind: 'sh-kind', cost: 'sh-cost', stock_remaining: 'sh-stock', max_per_user: 'sh-max', icon: 'sh-icon',
  image_url: 'sh-image', face_value_cents: 'sh-face', currency: 'sh-currency', territories: 'sh-territories', min_age: 'sh-age',
  valid_from: 'sh-from', valid_until: 'sh-until', sort: 'sh-sort' };
const SH_NUMBERS = ['cost', 'stock_remaining', 'max_per_user', 'face_value_cents', 'min_age', 'sort'];
let _shItems = [];

function shMessage(id, text, ok) { ptMessage(id, text, ok); }

function shFillForm(item) {
  document.getElementById('sh-id').value = item ? item.id : '';
  document.getElementById('sh-form-title').textContent = item ? `Modifier l'article #${item.id}` : 'Nouvel article';
  for (const [k, id] of Object.entries(SH_FIELDS)) {
    const v = item ? item[k] : (k === 'kind' ? 'virtual' : k === 'sort' ? 0 : '');
    document.getElementById(id).value = v === null || v === undefined ? '' : v;
  }
  document.getElementById('sh-visible').checked = item ? item.visible : false;
  document.getElementById('sh-unavailable').checked = item ? item.unavailable : false;
  for (const lang of ['fr', 'en', 'nl']) for (const f of ['title', 'description', 'conditions']) {
    document.getElementById(`sh-${lang}-${f}`).value = item?.texts?.[lang]?.[f] ?? '';
  }
}

function shReadForm() {
  const item = {};
  for (const [k, id] of Object.entries(SH_FIELDS)) {
    const v = document.getElementById(id).value.trim();
    item[k] = SH_NUMBERS.includes(k) ? (v === '' ? null : Number(v)) : v;
  }
  item.visible = document.getElementById('sh-visible').checked;
  item.unavailable = document.getElementById('sh-unavailable').checked;
  item.texts = {};
  for (const lang of ['fr', 'en', 'nl']) {
    item.texts[lang] = {};
    for (const f of ['title', 'description', 'conditions']) item.texts[lang][f] = document.getElementById(`sh-${lang}-${f}`).value;
  }
  return item;
}

async function loadShop() {
  const status = document.getElementById('sh-order-filter').value;
  const { ok, data } = await api('GET', `/api/admin/shop${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  if (!ok) { shMessage('sh-item-msg', data.error || 'Erreur lors du chargement.', false); return; }
  const s = data.settings;
  const banner = document.getElementById('sh-banner');
  banner.className = `contest-banner contest-banner--${s.exchangesOpen ? 'open' : 'locked'}`;
  banner.textContent = `${s.exchangesOpen ? '✅ Échanges ouverts' : '⛔ Échanges fermés'} — cadeaux réels : ${s.realEnabled ? 'DÉVERROUILLÉS' : 'verrouillés (#27)'}. `
    + `Registre des points : ${data.ledger.ok ? 'OK' : 'ÉCART'}.`;
  document.getElementById('sh-open').checked = s.exchangesOpen;
  document.getElementById('sh-notice').value = s.notice || '';

  _shItems = data.items;
  const ib = document.getElementById('sh-items-body');
  ib.textContent = '';
  if (!data.items.length) ib.innerHTML = '<tr><td colspan="9" class="muted">Aucun article.</td></tr>';
  for (const it of data.items) {
    const tr = document.createElement('tr');
    [it.id, `${it.icon || ''} ${it.texts.fr.title}`, it.kind === 'real' ? 'réel' : 'virtuel', it.cost,
     it.stock_remaining ?? '∞', it.max_per_user ?? '—', it.visible ? 'oui' : 'non', it.unavailable ? 'indisponible' : 'disponible']
      .forEach(x => addCell(tr, x));
    addButtonCell(tr, 'Modifier', () => { shFillForm(it); document.getElementById('sh-form-title').scrollIntoView({ behavior: 'smooth' }); });
    ib.appendChild(tr);
  }

  document.getElementById('sh-totals').textContent = data.totals.length
    ? data.totals.map(x => `${SH_STATUS[x.status] || x.status} : ${x.n} (${x.points} pts)`).join(' · ')
    : 'Aucune commande.';
  const ob = document.getElementById('sh-orders-body');
  ob.textContent = '';
  if (!data.orders.length) ob.innerHTML = '<tr><td colspan="8" class="muted">Aucune commande.</td></tr>';
  for (const o of data.orders) {
    const tr = document.createElement('tr');
    [o.id, o.createdAt, o.username ?? `#${o.userId}`, `${o.icon || ''} ${o.texts.fr.title}`, o.cost].forEach(x => addCell(tr, x));
    const td = document.createElement('td'); td.appendChild(statusBadge(o.status)); tr.appendChild(td);
    addCell(tr, o.note ?? '');
    const act = document.createElement('td');
    for (const to of o.transitions) {
      const b = document.createElement('button');
      b.className = 'btn-ghost';
      b.textContent = to === 'cancelled' ? 'Annuler + rembourser' : `→ ${SH_STATUS[to]}`;
      b.addEventListener('click', () => shopTransition(o, to));
      act.appendChild(b);
    }
    tr.appendChild(act);
    ob.appendChild(tr);
  }
  loadShopAudit();
}

async function loadShopAudit() {
  const { ok, data } = await api('GET', '/api/admin/shop/audit?limit=100');
  const tb = document.getElementById('sh-audit-body');
  tb.textContent = '';
  if (!ok) return;
  for (const a of data.audit) {
    const tr = document.createElement('tr');
    [a.created_at, a.actor, a.action, a.item_id ?? '', a.order_id ?? '', a.user_id ?? '', a.details ? JSON.stringify(a.details).slice(0, 300) : '']
      .forEach(x => addCell(tr, x));
    tb.appendChild(tr);
  }
}

async function shopTransition(o, to) {
  const label = to === 'cancelled' ? `Annuler la commande n° ${o.id} et rembourser ${o.cost} pts ?` : `Passer la commande n° ${o.id} à « ${SH_STATUS[to]} » ?`;
  if (!confirm(label)) return;
  const note = document.getElementById('sh-order-note').value;
  const { ok, data } = await api('POST', `/api/admin/shop/orders/${encodeURIComponent(o.id)}/status`, { status: to, note });
  shMessage('sh-order-msg', ok ? `Commande n° ${o.id} : ${SH_STATUS[data.order.status]}.` : (data.error || 'Erreur.'), ok);
  if (ok) { document.getElementById('sh-order-note').value = ''; loadShop(); }
}

document.getElementById('btn-refresh-shop').addEventListener('click', loadShop);
document.getElementById('sh-order-filter').addEventListener('change', loadShop);
document.getElementById('btn-sh-new').addEventListener('click', () => shFillForm(null));

document.getElementById('btn-sh-settings').addEventListener('click', async () => {
  const body = { exchangesOpen: document.getElementById('sh-open').checked, notice: document.getElementById('sh-notice').value };
  const { ok, data } = await api('PUT', '/api/admin/shop/settings', body);
  shMessage('sh-settings-msg', ok ? 'Réglages enregistrés.' : (data.error || 'Erreur.'), ok);
  if (ok) loadShop();
});

document.getElementById('btn-sh-save').addEventListener('click', async () => {
  const id = document.getElementById('sh-id').value;
  const item = shReadForm();
  const { ok, data } = id
    ? await api('PUT', `/api/admin/shop/items/${encodeURIComponent(id)}`, { item })
    : await api('POST', '/api/admin/shop/items', { item });
  shMessage('sh-item-msg', ok ? `Article #${data.item.id} enregistré.` : (data.error || 'Erreur.'), ok);
  if (ok) { shFillForm(data.item); loadShop(); }
});
