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
    if (btn.dataset.tab === 'blocks')          { loadBlocks(); loadAi(); }
    if (btn.dataset.tab === 'collections')     loadCollections();
    if (btn.dataset.tab === 'icons')           loadIcons();
    if (btn.dataset.tab === 'badges')          loadBadges();
    if (btn.dataset.tab === 'ads')             loadAds();
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

const SH_LANGS = ['fr', 'en', 'nl', 'es'];

function shFillForm(item) {
  document.getElementById('sh-id').value = item ? item.id : '';
  document.getElementById('sh-form-title').textContent = item ? `Modifier l'article #${item.id}` : 'Nouvel article';
  for (const [k, id] of Object.entries(SH_FIELDS)) {
    const v = item ? item[k] : (k === 'kind' ? 'virtual' : k === 'sort' ? 0 : '');
    document.getElementById(id).value = v === null || v === undefined ? '' : v;
  }
  document.getElementById('sh-visible').checked = item ? item.visible : false;
  document.getElementById('sh-unavailable').checked = item ? item.unavailable : false;
  for (const lang of SH_LANGS) for (const f of ['title', 'description', 'conditions']) {
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
  for (const lang of SH_LANGS) {
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

// ── Catalogue de blocs (#37) ──────────────────────────────────────────────────

const BK_RARITY = { commun: 'Commun', 'peu-commun': 'Peu commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire' };
const BK_BOOSTED = new Set(['rare', 'epique', 'legendaire']);
let _bk = null;   // vue admin (GET /api/admin/blocks)

function bkWorking() { return _bk ? (_bk.draft ? _bk.draft.types : _bk.published.types) : []; }

/** Poids à une profondeur : atténué au-delà de `fadeFrom` (étape B, même règle que le jeu). */
const bkWeightAt = (t, depth) => (t.fadeFrom != null && depth > t.fadeFrom ? t.fadeWeight : t.weight);

/** Probabilités sans Chance à une profondeur (même règle que le jeu : « dès X m », jamais de maximum). */
function bkOdds(types, depth) {
  const pool = types.filter(t => t.active && depth >= t.minDepth);
  const total = pool.reduce((s, t) => s + bkWeightAt(t, depth), 0);
  return new Map(pool.map(t => [t.id, total > 0 ? bkWeightAt(t, depth) / total : 0]));
}

function bkPct(p) {
  if (!p) return '—';
  return p >= 0.001 ? `${(p * 100).toFixed(2)} %` : `${(p * 100).toFixed(4)} %`;
}

function bkFillSelect(id, values, labels) {
  const sel = document.getElementById(id);
  if (sel.options.length > (id === 'bk-filter-cat' ? 1 : 0)) return;
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = labels ? labels[v] ?? v : v;
    sel.appendChild(o);
  }
}

function bkPreview() {
  const box = document.getElementById('bk-preview');
  const color = document.getElementById('bk-color').value.trim();
  const accent = document.getElementById('bk-accent').value.trim();
  box.style.background = color;
  box.style.borderColor = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : '#6b7280';
  box.textContent = '';
  const image = document.getElementById('bk-image').value.trim();
  if (/^(\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)|\/media\/(blocks|icons)\/[a-f0-9]{16}\.webp)$/.test(image) && !image.includes('..')) {
    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    img.width = 88;
    img.height = 88;
    img.onerror = () => { box.textContent = document.getElementById('bk-icon').value; };
    box.appendChild(img);
  } else {
    box.textContent = document.getElementById('bk-icon').value;
  }
}

const BK_LANGS = ['fr', 'en', 'nl', 'es'];

function bkFillForm(t) {
  document.getElementById('bk-form-title').textContent = t ? `Modifier « ${t.id} »` : 'Nouveau bloc';
  const idEl = document.getElementById('bk-id');
  idEl.value = t ? t.id : '';
  idEl.readOnly = !!t;
  for (const l of BK_LANGS) document.getElementById(`bk-name-${l}`).value = t?.names?.[l] ?? '';
  document.getElementById('bk-name-fr').placeholder = t && _bk.legacyIds.includes(t.id) ? '(traduction intégrée)' : '';
  document.getElementById('bk-category').value = t ? t.category : 'minerai';
  document.getElementById('bk-rarity').value = t ? t.rarity : 'commun';
  document.getElementById('bk-icon').value = t ? t.icon : '';
  document.getElementById('bk-image').value = t?.image ?? '';
  document.getElementById('bk-color').value = t ? t.color : '#4b5563';
  document.getElementById('bk-accent').value = t ? t.accent : '#6b7280';
  document.getElementById('bk-hp').value = t ? t.hpBase : '';
  document.getElementById('bk-reward').value = t ? t.reward : '';
  document.getElementById('bk-min').value = t ? t.minDepth : '';
  document.getElementById('bk-weight').value = t ? t.weight : '';
  document.getElementById('bk-fade-from').value = t?.fadeFrom ?? '';
  document.getElementById('bk-fade-weight').value = t?.fadeWeight ?? '';
  document.getElementById('bk-gem-reward').checked = t ? t.gemReward !== false : true;
  document.getElementById('bk-active').checked = t ? t.active : true;
  document.getElementById('btn-bk-remove').disabled = !t || _bk.publishedIds.includes(t.id);
  bkPreview();
}

function bkReadForm() {
  const num = id => { const v = document.getElementById(id).value.trim(); return v === '' ? null : Number(v); };
  const names = {};
  for (const l of BK_LANGS) { const v = document.getElementById(`bk-name-${l}`).value.trim(); if (v) names[l] = v; }
  return {
    id: document.getElementById('bk-id').value.trim(),
    names: Object.keys(names).length ? names : null,
    category: document.getElementById('bk-category').value,
    rarity: document.getElementById('bk-rarity').value,
    icon: document.getElementById('bk-icon').value.trim(),
    image: document.getElementById('bk-image').value.trim() || null,
    color: document.getElementById('bk-color').value.trim(),
    accent: document.getElementById('bk-accent').value.trim(),
    hpBase: num('bk-hp'), reward: num('bk-reward'), minDepth: num('bk-min'), weight: num('bk-weight'),
    fadeFrom: num('bk-fade-from'), fadeWeight: num('bk-fade-weight'),
    gemReward: document.getElementById('bk-gem-reward').checked,
    active: document.getElementById('bk-active').checked,
  };
}

function bkFillList(el, items) {
  el.textContent = '';
  for (const x of items) { const li = document.createElement('li'); li.textContent = x; el.appendChild(li); }
}

function bkRenderTable() {
  const types = bkWorking();
  const text = document.getElementById('bk-filter-text').value.trim().toLowerCase();
  const cat = document.getElementById('bk-filter-cat').value;
  const status = document.getElementById('bk-filter-status').value;
  const depth = Math.max(1, Number(document.getElementById('bk-odds-depth').value) || 1);
  const odds = bkOdds(types, depth);
  const changed = new Set((_bk.draft?.changes ?? []).map(c => c.id));
  const tb = document.getElementById('bk-body');
  tb.textContent = '';
  for (const t of types) {
    if (text && !`${t.id} ${t.names?.fr ?? ''} ${t.names?.en ?? ''} ${t.names?.nl ?? ''} ${t.names?.es ?? ''}`.toLowerCase().includes(text)) continue;
    if (cat && t.category !== cat) continue;
    if (status === 'active' && !t.active) continue;
    if (status === 'inactive' && t.active) continue;
    if (status === 'changed' && !changed.has(t.id)) continue;
    const tr = document.createElement('tr');
    const range = t.fadeFrom != null ? `dès ${t.minDepth} m (atténué > ${t.fadeFrom} m : ${t.fadeWeight})`
      : t.maxDepth != null ? `dès ${t.minDepth} m (ancienne borne ${t.maxDepth} m, convertie en atténuation à la publication)`
      : `dès ${t.minDepth} m`;
    const state = `${t.active ? 'actif' : 'désactivé'}${changed.has(t.id) ? ' · modifié' : ''}${_bk.publishedIds.includes(t.id) ? '' : ' · nouveau'}`;
    [t.icon, t.id, t.names?.fr ?? '(intégré)', t.category, BK_RARITY[t.rarity] ?? t.rarity, t.hpBase, t.reward, range,
     t.weight, bkPct(odds.get(t.id)) + (BK_BOOSTED.has(t.rarity) ? ' ★' : ''), state].forEach(x => addCell(tr, x));
    addButtonCell(tr, 'Modifier', () => { bkFillForm(t); document.getElementById('bk-form-title').scrollIntoView({ behavior: 'smooth' }); });
    tb.appendChild(tr);
  }
}

function bkChangeLabel(c) {
  if (c.kind === 'added') return 'ajouté';
  return c.fields.map(f => `${f.field} : ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join(' ; ');
}

async function loadBlocks() {
  const { ok, data } = await api('GET', '/api/admin/blocks');
  if (!ok) { ptMessage('bk-form-msg', data.error || 'Erreur lors du chargement.', false); return; }
  _bk = data;
  bkFillSelect('bk-filter-cat', data.categories);
  bkFillSelect('bk-category', data.categories);
  bkFillSelect('bk-rarity', data.rarities, BK_RARITY);
  const p = data.published;
  const banner = document.getElementById('bk-banner');
  banner.className = `contest-banner contest-banner--${data.draft ? 'open' : 'locked'}`;
  banner.textContent = `Version en vigueur : v${p.version} (${p.createdAt} UTC, ${p.types.filter(t => t.active).length} blocs actifs / ${p.types.length}). `
    + (data.draft ? `Brouillon en cours (${data.draft.changes.length} changement(s), non visible des joueurs).` : 'Aucun brouillon.');
  document.getElementById('bk-list-source').textContent = data.draft ? '— brouillon' : `— version v${p.version}`;
  bkRenderTable();

  const d = data.draft;
  document.getElementById('bk-draft-state').textContent = d
    ? `Brouillon basé sur v${d.basedOn}, modifié le ${d.updatedAt} UTC.` : 'Aucun brouillon : modifiez un bloc pour en créer un.';
  bkFillList(document.getElementById('bk-draft-errors'), d ? d.errors : []);
  bkFillList(document.getElementById('bk-draft-warnings'), d ? d.warnings : []);
  const cb = document.getElementById('bk-changes-body');
  cb.textContent = '';
  for (const c of d ? d.changes : []) {
    const tr = document.createElement('tr');
    addCell(tr, c.id);
    addCell(tr, bkChangeLabel(c));
    cb.appendChild(tr);
  }
  document.getElementById('btn-bk-publish').disabled = !d || d.errors.length > 0 || !d.changes.length;
  document.getElementById('btn-bk-discard').disabled = !d;

  const vb = document.getElementById('bk-versions-body');
  vb.textContent = '';
  for (const v of data.versions) {
    const tr = document.createElement('tr');
    const src = { origin: 'origine', publish: 'publication', rollback: `retour à v${v.fromVersion}` }[v.source] ?? v.source;
    [`v${v.version}`, v.createdAt, src, `${v.types} (${v.active})`, v.note ?? ''].forEach(x => addCell(tr, x));
    if (v.version === p.version) addCell(tr, 'en vigueur');
    else addButtonCell(tr, `Revenir à v${v.version}`, () => bkRollback(v.version));
    vb.appendChild(tr);
  }
  document.getElementById('bk-antibot').textContent = data.antibotSegments
    .map(s => `${s.from}–${s.to ?? '∞'} m : ${s.hpBase}`).join(' · ');
  loadBlocksAudit();
}

async function loadBlocksAudit() {
  const { ok, data } = await api('GET', '/api/admin/blocks/audit?limit=100');
  const tb = document.getElementById('bk-audit-body');
  tb.textContent = '';
  if (!ok) return;
  for (const a of data.audit) {
    const tr = document.createElement('tr');
    [a.created_at, a.action, a.version ?? '', a.details ? JSON.stringify(a.details).slice(0, 300) : ''].forEach(x => addCell(tr, x));
    tb.appendChild(tr);
  }
}

async function bkRollback(version) {
  if (!confirm(`Revenir au contenu de la version v${version} ? Une nouvelle version sera publiée immédiatement pour tous les joueurs.`)) return;
  const { ok, data } = await api('POST', '/api/admin/blocks/rollback', { version });
  ptMessage('bk-rollback-msg', ok ? `Version v${data.version} publiée (contenu de v${data.restored}).` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) loadBlocks();
}

document.getElementById('btn-refresh-blocks').addEventListener('click', loadBlocks);

// ── Création de blocs assistée par IA (#37) ─────────────────────────────────

const AI_LANGS = [['fr', 'Français'], ['en', 'English'], ['nl', 'Nederlands'], ['es', 'Español']];

function aiEl(tag, attrs = {}, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function aiInput(label, value, attrs = {}) {
  const l = aiEl('label', {}, label);
  const i = aiEl('input', { type: 'text', ...attrs });
  i.value = value ?? '';
  l.appendChild(i);
  return [l, i];
}

async function loadAi() {
  const { ok, data } = await api('GET', '/api/admin/blocks/ai');
  const st = document.getElementById('ai-status');
  if (!ok) { st.textContent = data.error || 'Erreur.'; return; }
  const s = data.status;
  st.textContent = s.configured
    ? `API IA : texte ${s.textModel}, image ${s.imageModel}${s.fake ? ' (MODE TEST, aucun appel réel)' : ''} — dépense ${s.spentUsd} / ${s.budgetUsd} USD (≈ ${s.estImageUsd} USD par image)`
      + ` — ${s.callsToday}/${s.maxCallsPerDay} appels sur 24 h${s.imageProcessing ? '' : ' — traitement d\'image indisponible'}.`
    : `API IA non configurée : ${s.reason}. La génération est désactivée (la clé reste côté serveur, jamais dans le navigateur).`;
  document.getElementById('btn-ai-generate').disabled = !s.configured;
  const box = document.getElementById('ai-proposals');
  box.textContent = '';
  for (const p of data.proposals) box.appendChild(aiRenderProposal(p, s.configured));
  const cb = document.getElementById('ai-calls-body');
  cb.textContent = '';
  for (const c of data.calls) {
    const tr = document.createElement('tr');
    [c.created_at, c.proposal_id ? `#${c.proposal_id}` : '', c.kind, c.model, c.ok ? 'OK' : `Échec : ${c.error ?? ''}`,
     `${c.cost_usd} USD`, c.duration_ms != null ? `${(c.duration_ms / 1000).toFixed(1)} s` : ''].forEach(v => addCell(tr, v));
    cb.appendChild(tr);
  }
}

function aiRenderProposal(p, configured) {
  const card = aiEl('div', { class: 'overview-card', style: 'margin:0.6rem 0' });
  card.appendChild(aiEl('h4', {}, `Proposition #${p.id} — ${p.status === 'in_draft' ? `dans le brouillon (« ${p.blockId} »)` : 'à valider'}`));
  card.appendChild(aiEl('p', { class: 'muted', style: 'font-size:0.78rem' }, `Concept : ${p.concept}`));
  const row = aiEl('div', { style: 'display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start' });
  const prev = aiEl('div', { style: `width:128px;height:128px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:56px;border:3px solid ${/^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#6b7280'}` });
  prev.style.background = /^linear-gradient\(145deg,#[0-9a-f]{6},#[0-9a-f]{6}\)$/i.test(p.color) ? p.color : '#374151';
  if (p.image) { const img = aiEl('img', { src: p.image, alt: '', width: '112', height: '112' }); prev.appendChild(img); }
  else prev.textContent = p.icon || '⬜';
  row.appendChild(prev);
  const names = aiEl('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.5rem;flex:1' });
  const nameInputs = {};
  for (const [l, label] of AI_LANGS) {
    const [lab, inp] = aiInput(`${label} (${l.toUpperCase()})`, p.names?.[l], { maxlength: '40' });
    nameInputs[l] = inp;
    names.appendChild(lab);
  }
  row.appendChild(names);
  card.appendChild(row);

  const params = aiEl('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0.5rem;margin-top:0.5rem' });
  const fields = {};
  for (const [k, label] of [['idSuggestion', 'Identifiant technique'], ['category', 'Catégorie'], ['rarity', 'Rareté'], ['icon', 'Emoji'],
    ['hpBase', 'PV de base'], ['reward', 'Récompense'], ['minDepth', 'Dès (m)'], ['weight', 'Poids']]) {
    const [lab, inp] = aiInput(label, p[k]);
    fields[k] = inp;
    params.appendChild(lab);
  }
  card.appendChild(params);
  if (p.rationale) card.appendChild(aiEl('p', { class: 'muted', style: 'font-size:0.78rem' }, `Justification IA : ${p.rationale}`));
  if (p.category === 'gemme') card.appendChild(aiEl('p', { class: 'muted', style: 'font-size:0.78rem' }, 'Gemme : ne rapporte pas de gemme premium par défaut (étape D / #20).'));
  const warn = aiEl('ul', { class: 'form-msg' });
  for (const w of p.warnings ?? []) warn.appendChild(aiEl('li', {}, w));
  card.appendChild(warn);
  const impact = aiEl('div');
  card.appendChild(impact);
  const msg = aiEl('p', { class: 'form-msg' });

  const open = p.status === 'open';
  const actions = aiEl('div', { class: 'form-actions' });
  const button = (label, fn, { primary = false, disabled = false } = {}) => {
    const b = aiEl('button', { class: primary ? 'btn btn-primary' : 'btn' }, label);
    b.disabled = disabled;
    b.addEventListener('click', async () => {
      const all = actions.querySelectorAll('button');
      all.forEach(x => { x.disabled = true; });
      msg.textContent = '…';
      try { await fn(); } finally { all.forEach(x => { x.disabled = false; }); }
    });
    actions.appendChild(b);
  };
  const edits = () => {
    const body = { names: {} };
    for (const [l] of AI_LANGS) body.names[l] = nameInputs[l].value.trim();
    for (const [k, inp] of Object.entries(fields)) body[k] = ['hpBase', 'reward', 'minDepth', 'weight'].includes(k) ? Number(inp.value) : inp.value.trim();
    return body;
  };
  const save = async () => {
    const { ok, data } = await api('PUT', `/api/admin/blocks/ai/proposals/${p.id}`, edits());
    msg.textContent = ok ? 'Corrections enregistrées.' : (data.error || 'Erreur.');
    return ok;
  };
  const regen = what => async () => {
    msg.textContent = 'Génération en cours (jusqu\'à 1–2 min pour une image)…';
    const { ok, data } = await api('POST', `/api/admin/blocks/ai/proposals/${p.id}/regenerate`, { what });
    if (!ok) { msg.textContent = data.error || 'Erreur.'; return; }
    loadAi();
  };
  if (open) {
    button('Enregistrer les corrections', save);
    button('↻ Noms / traductions', regen('names'), { disabled: !configured });
    button('↻ Image seule', regen('image'), { disabled: !configured });
    button('↻ Tout le texte', regen('text'), { disabled: !configured });
    button('Impact', async () => {
      if (!(await save())) return;
      const { ok, data } = await api('GET', `/api/admin/blocks/ai/proposals/${p.id}/impact`);
      if (!ok) { msg.textContent = data.error || 'Erreur.'; return; }
      impact.textContent = '';
      const tbl = aiEl('table');
      const head = aiEl('tr');
      ['Profondeur', 'Part du nouveau bloc', 'PV moyens (avant → après)', 'Récompense moyenne (avant → après)'].forEach(h => head.appendChild(aiEl('th', {}, h)));
      tbl.appendChild(head);
      for (const r of data.impact) {
        const tr = document.createElement('tr');
        const pct = (a, b) => `${a.toFixed(1)} → ${b.toFixed(1)} (${b >= a ? '+' : ''}${((b / a - 1) * 100).toFixed(1)} %)`;
        [`${r.depth} m`, bkPct(r.share), pct(...r.avgHp), pct(...r.avgReward)].forEach(v => addCell(tr, v));
        tbl.appendChild(tr);
      }
      impact.appendChild(tbl);
      msg.textContent = 'Impact calculé sur le catalogue en vigueur (sans Chance).';
    });
    button('Ajouter au brouillon', async () => {
      if (!(await save())) return;
      const { ok, data } = await api('POST', `/api/admin/blocks/ai/proposals/${p.id}/draft`, { blockId: fields.idSuggestion.value.trim() });
      if (!ok) { msg.textContent = data.error || 'Erreur.'; return; }
      await loadBlocks();
      loadAi();
    }, { primary: true });
    button('Abandonner', async () => {
      if (!confirm(`Abandonner la proposition #${p.id} ?`)) return;
      const { ok, data } = await api('DELETE', `/api/admin/blocks/ai/proposals/${p.id}`);
      if (!ok) { msg.textContent = data.error || 'Erreur.'; return; }
      loadAi();
    });
  } else {
    actions.appendChild(aiEl('span', { class: 'muted' }, 'Dans le brouillon du catalogue : relisez, simulez puis publiez plus bas. Modifications ultérieures : bouton « Modifier » de la liste.'));
  }
  card.appendChild(actions);
  card.appendChild(msg);
  return card;
}

document.getElementById('btn-ai-generate').addEventListener('click', async () => {
  const concept = document.getElementById('ai-concept').value.trim();
  const msg = document.getElementById('ai-msg');
  const btn = document.getElementById('btn-ai-generate');
  btn.disabled = true;
  msg.textContent = 'Génération en cours (texte puis image : jusqu\'à 2 min)…';
  try {
    const { ok, data } = await api('POST', '/api/admin/blocks/ai/proposals', { concept, withImage: document.getElementById('ai-with-image').checked });
    msg.textContent = ok ? (data.proposal.imageError ? `Texte proposé ; image en échec : ${data.proposal.imageError}` : 'Proposition prête : vérifiez-la ci-dessous.') : (data.error || 'Erreur.');
    if (ok) document.getElementById('ai-concept').value = '';
  } finally {
    btn.disabled = false;
    loadAi();
  }
});
for (const id of ['bk-filter-text', 'bk-filter-cat', 'bk-filter-status', 'bk-odds-depth']) {
  document.getElementById(id).addEventListener('input', () => { if (_bk) bkRenderTable(); });
}
for (const id of ['bk-icon', 'bk-image', 'bk-color', 'bk-accent']) document.getElementById(id).addEventListener('input', bkPreview);
document.getElementById('btn-bk-new').addEventListener('click', () => bkFillForm(null));

document.getElementById('btn-bk-save').addEventListener('click', async () => {
  const type = bkReadForm();
  if (!type.id) { ptMessage('bk-form-msg', 'Identifiant requis.', false); return; }
  const { ok, data } = await api('PUT', `/api/admin/blocks/draft/types/${encodeURIComponent(type.id)}`, { type });
  ptMessage('bk-form-msg', ok ? `« ${data.type.id} » enregistré dans le brouillon (pas encore visible des joueurs).` : (data.error || 'Erreur.'), ok);
  if (ok) { await loadBlocks(); bkFillForm(bkWorking().find(t => t.id === data.type.id)); }
});

document.getElementById('btn-bk-remove').addEventListener('click', async () => {
  const id = document.getElementById('bk-id').value.trim();
  if (!id || !confirm(`Retirer « ${id} » du brouillon ?`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/blocks/draft/types/${encodeURIComponent(id)}`);
  ptMessage('bk-form-msg', ok ? `« ${id} » retiré du brouillon.` : (data.error || 'Erreur.'), ok);
  if (ok) { bkFillForm(null); loadBlocks(); }
});

document.getElementById('btn-bk-publish').addEventListener('click', async () => {
  if (!_bk?.draft) return;
  if (!confirm(`Publier le brouillon (${_bk.draft.changes.length} changement(s)) ? Il s'appliquera aux prochains blocs de tous les joueurs.`)) return;
  const note = document.getElementById('bk-publish-note').value;
  const { ok, data } = await api('POST', '/api/admin/blocks/publish', { note, basedOn: _bk.draft.basedOn });
  ptMessage('bk-publish-msg', ok ? `Version v${data.version} publiée.` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) { document.getElementById('bk-publish-note').value = ''; loadBlocks(); }
});

document.getElementById('btn-bk-discard').addEventListener('click', async () => {
  if (!confirm('Abandonner le brouillon ? Les modifications non publiées seront perdues.')) return;
  const { ok, data } = await api('DELETE', '/api/admin/blocks/draft');
  ptMessage('bk-publish-msg', ok ? 'Brouillon abandonné.' : (data.error || 'Erreur.'), ok);
  if (ok) { bkFillForm(null); loadBlocks(); }
});

document.getElementById('btn-bk-simulate').addEventListener('click', async () => {
  const depths = document.getElementById('bk-sim-depths').value.split(/[\s,;]+/).filter(Boolean).map(Number);
  const body = { source: document.getElementById('bk-sim-source').value, n: Number(document.getElementById('bk-sim-n').value),
    luckLevel: Number(document.getElementById('bk-sim-luck').value) || 0, depths };
  const { ok, data } = await api('POST', '/api/admin/blocks/simulate', body);
  const tb = document.getElementById('bk-sim-body');
  tb.textContent = '';
  if (!ok) { ptMessage('bk-sim-msg', [data.error, ...(data.details ?? [])].join(' '), false); return; }
  ptMessage('bk-sim-msg', `${body.n.toLocaleString('fr-BE')} tirages par profondeur, Chance ${body.luckLevel}.`, true);
  for (const r of data.results) {
    r.types.forEach((x, i) => {
      const tr = document.createElement('tr');
      [i === 0 ? `${r.depth} m` : '', i === 0 ? Math.round(r.avgHp) : '', i === 0 ? Math.round(r.avgReward) : '',
       x.id, BK_RARITY[x.rarity] ?? x.rarity, bkPct(x.p), bkPct(x.observed)].forEach(v => addCell(tr, v));
      tb.appendChild(tr);
    });
  }
});

// ── Collections saisonnières (#39) ────────────────────────────────────────────

const CO_LANGS = ['fr', 'en', 'nl', 'es'];
const CO_IMAGE_RE = /^(\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)|\/api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp)|\/media\/icons\/[a-f0-9]{16}\.webp)$/;
let _co = null;   // vue admin (GET /api/admin/collections)

function coWorking() {
  if (!_co) return { series: [], items: [] };
  return _co.draft ? { series: _co.draft.series, items: _co.draft.items } : { series: _co.published.series, items: _co.published.items };
}

function coSeasonLabel(id) {
  if (id == null) return 'Permanente';
  const s = _co.seasons.find(x => x.id === id);
  return s ? `#${s.id} ${s.name} (${s.status})` : `#${id}`;
}

function coSelect(id, entries, keepFirst = 0) {
  const sel = document.getElementById(id);
  const value = sel.value;
  while (sel.options.length > keepFirst) sel.remove(keepFirst);
  for (const [v, label] of entries) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  }
  if ([...sel.options].some(o => o.value === value)) sel.value = value;
}

function coTexts(prefix) {
  const out = {};
  for (const l of CO_LANGS) { const v = document.getElementById(`${prefix}-${l}`).value.trim(); if (v) out[l] = v; }
  return Object.keys(out).length ? out : null;
}

// Séries
function coFillSeriesForm(s) {
  document.getElementById('co-series-form-title').textContent = s ? `Modifier la série « ${s.id} »` : 'Nouvelle série';
  const idEl = document.getElementById('co-s-id');
  idEl.value = s ? s.id : '';
  idEl.readOnly = !!s;
  for (const l of CO_LANGS) document.getElementById(`co-s-name-${l}`).value = s?.names?.[l] ?? '';
  document.getElementById('co-s-season').value = s?.seasonId == null ? '' : String(s.seasonId);
  document.getElementById('co-s-icon').value = s ? s.icon : '📦';
  document.getElementById('co-s-active').checked = s ? s.active : true;
  document.getElementById('btn-co-s-remove').disabled = !s || _co.publishedIds.series.includes(s.id);
}

// Objets
function coFillItemForm(i) {
  document.getElementById('co-i-form-title').textContent = i ? `Modifier « ${i.id} »` : 'Nouvel objet';
  const idEl = document.getElementById('co-i-id');
  idEl.value = i ? i.id : '';
  idEl.readOnly = !!i;
  document.getElementById('co-i-series').value = i ? i.seriesId : (document.getElementById('co-filter-series').value || coWorking().series[0]?.id || '');
  document.getElementById('co-i-rarity').value = i ? i.rarity : 'commun';
  document.getElementById('co-i-icon').value = i ? i.icon : '';
  for (const l of CO_LANGS) {
    document.getElementById(`co-i-name-${l}`).value = i?.names?.[l] ?? '';
    document.getElementById(`co-i-story-${l}`).value = i?.stories?.[l] ?? '';
  }
  document.getElementById('co-i-image').value = i?.image ?? '';
  document.getElementById('co-i-upload').value = '';
  for (const c of _co.categories) document.getElementById(`co-i-from-${c}`).checked = !!i?.drop.from.includes(c);
  document.getElementById('co-i-min').value = i ? i.drop.minDepth : '';
  document.getElementById('co-i-chance').value = i ? +(i.drop.chance * 100).toFixed(4) : '';
  document.getElementById('co-i-drop').checked = i ? i.dropEnabled : false;
  document.getElementById('co-i-active').checked = i ? i.active : true;
  document.getElementById('btn-co-i-remove').disabled = !i || _co.publishedIds.items.includes(i.id);
  coPreview();
}

function coReadItem() {
  const num = id => { const v = document.getElementById(id).value.trim(); return v === '' ? null : Number(v); };
  const chance = num('co-i-chance');
  return {
    id: document.getElementById('co-i-id').value.trim(),
    seriesId: document.getElementById('co-i-series').value,
    names: coTexts('co-i-name'),
    stories: coTexts('co-i-story'),
    rarity: document.getElementById('co-i-rarity').value,
    icon: document.getElementById('co-i-icon').value.trim(),
    image: document.getElementById('co-i-image').value.trim() || null,
    drop: { from: _co.categories.filter(c => document.getElementById(`co-i-from-${c}`).checked),
      minDepth: num('co-i-min'), chance: chance === null ? null : chance / 100 },
    dropEnabled: document.getElementById('co-i-drop').checked,
    active: document.getElementById('co-i-active').checked,
  };
}

/** Aperçu de la fiche joueur dans la langue choisie (repli FR, comme en jeu). */
function coPreview() {
  if (!_co) return;
  const lang = document.getElementById('co-preview-lang').value;
  const pick = prefix => document.getElementById(`${prefix}-${lang}`).value.trim() || document.getElementById(`${prefix}-fr`).value.trim();
  const art = document.getElementById('co-preview-art');
  art.textContent = '';
  const image = document.getElementById('co-i-image').value.trim();
  if (CO_IMAGE_RE.test(image) && !image.includes('..')) {
    const img = document.createElement('img');
    img.src = image; img.alt = ''; img.width = 140; img.height = 140; img.style.objectFit = 'contain';
    img.onerror = () => { art.textContent = document.getElementById('co-i-icon').value; };
    art.appendChild(img);
  } else {
    art.textContent = document.getElementById('co-i-icon').value || '❔';
  }
  document.getElementById('co-preview-rarity').textContent = BK_RARITY[document.getElementById('co-i-rarity').value] ?? '';
  document.getElementById('co-preview-name').textContent = pick('co-i-name') || '(nom FR obligatoire)';
  const s = coWorking().series.find(x => x.id === document.getElementById('co-i-series').value);
  document.getElementById('co-preview-series').textContent = s ? `${s.icon} ${s.names?.[lang] || s.names?.fr || s.id} · ${coSeasonLabel(s.seasonId)}` : '';
  document.getElementById('co-preview-story').textContent = pick('co-i-story') || '(pas encore d\'histoire)';
}

function coRenderItems() {
  const { items, series } = coWorking();
  const text = document.getElementById('co-filter-text').value.trim().toLowerCase();
  const sf = document.getElementById('co-filter-series').value;
  const changed = new Set((_co.draft?.changes ?? []).filter(c => c.kind === 'items').map(c => c.id));
  const tb = document.getElementById('co-items-body');
  tb.textContent = '';
  for (const i of items) {
    if (sf && i.seriesId !== sf) continue;
    if (text && !`${i.id} ${Object.values(i.names ?? {}).join(' ')}`.toLowerCase().includes(text)) continue;
    const tr = document.createElement('tr');
    const s = series.find(x => x.id === i.seriesId);
    const drop = `${i.drop.from.join('/')} dès ${i.drop.minDepth} m · ${+(i.drop.chance * 100).toFixed(3)} %${i.dropEnabled ? '' : ' (inactif)'}`;
    const langs = CO_LANGS.map(l => (i.names?.[l] && i.stories?.[l] ? l : (i.names?.[l] ? `${l}*` : '—'))).join(' ');
    const state = `${i.active ? 'actif' : 'désactivé'}${changed.has(i.id) ? ' · modifié' : ''}${_co.publishedIds.items.includes(i.id) ? '' : ' · nouveau'}`;
    [i.icon, i.id, i.names?.fr ?? '', s ? s.names.fr : i.seriesId, BK_RARITY[i.rarity] ?? i.rarity, drop, langs, state].forEach(x => addCell(tr, x));
    addButtonCell(tr, 'Modifier', () => { coFillItemForm(i); document.getElementById('co-i-form-title').scrollIntoView({ behavior: 'smooth' }); });
    tb.appendChild(tr);
  }
}

async function loadCollections() {
  const { ok, data } = await api('GET', '/api/admin/collections');
  if (!ok) { ptMessage('co-i-msg', data.error || 'Erreur lors du chargement.', false); return; }
  _co = data;
  const w = coWorking();
  const p = data.published;

  // Sélecteurs
  coSelect('co-s-season', [['', 'Permanente (hors saison)'], ...data.seasons.map(s => [String(s.id), `#${s.id} ${s.name} (${s.status})`])]);
  coSelect('co-i-series', w.series.map(s => [s.id, `${s.icon} ${s.names.fr}`]));
  coSelect('co-filter-series', w.series.map(s => [s.id, `${s.icon} ${s.names.fr}`]), 1);
  coSelect('co-i-rarity', data.rarities.map(r => [r, BK_RARITY[r] ?? r]));
  const from = document.getElementById('co-i-from');
  if (!from.childElementCount) {
    for (const c of data.categories) {
      const label = document.createElement('label');
      label.style.marginRight = '12px';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = `co-i-from-${c}`;
      label.append(cb, ` ${c}`);
      from.appendChild(label);
    }
  }

  const banner = document.getElementById('co-banner');
  banner.className = `contest-banner contest-banner--${data.draft ? 'open' : 'locked'}`;
  banner.textContent = `Version en vigueur : v${p.version} (${p.createdAt} UTC) — ${p.series.length} série(s), ${p.items.length} objet(s), `
    + `${p.items.filter(i => i.active && i.dropEnabled).length} drop(s) actif(s). `
    + (data.draft ? `Brouillon en cours (${data.draft.changes.length} changement(s), non visible des joueurs).` : 'Aucun brouillon.');
  document.getElementById('co-source').textContent = data.draft ? '— brouillon' : `— version v${p.version}`;

  const sb = document.getElementById('co-series-body');
  sb.textContent = '';
  for (const s of w.series) {
    const tr = document.createElement('tr');
    [s.icon, s.id, s.names.fr, coSeasonLabel(s.seasonId), w.items.filter(i => i.seriesId === s.id).length,
     `${s.active ? 'active' : 'désactivée'}${data.publishedIds.series.includes(s.id) ? '' : ' · nouvelle'}`].forEach(x => addCell(tr, x));
    addButtonCell(tr, 'Modifier', () => coFillSeriesForm(s));
    sb.appendChild(tr);
  }
  coRenderItems();

  const d = data.draft;
  document.getElementById('co-draft-state').textContent = d
    ? `Brouillon basé sur v${d.basedOn}, modifié le ${d.updatedAt} UTC.` : 'Aucun brouillon : modifiez une série ou un objet pour en créer un.';
  bkFillList(document.getElementById('co-draft-errors'), d ? d.errors : []);
  bkFillList(document.getElementById('co-draft-warnings'), d ? d.warnings : []);
  const cb = document.getElementById('co-changes-body');
  cb.textContent = '';
  for (const c of d ? d.changes : []) {
    const tr = document.createElement('tr');
    addCell(tr, `${c.kind === 'series' ? 'Série' : 'Objet'} ${c.id}`);
    addCell(tr, c.change === 'added' ? 'ajouté' : c.fields.map(f => `${f.field} : ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join(' ; '));
    cb.appendChild(tr);
  }
  const drops = d ? d.drops : [];
  document.getElementById('co-drops-box').classList.toggle('hidden', !drops.length);
  bkFillList(document.getElementById('co-drops-list'), drops.map(x =>
    `${x.id} : ${x.drop.from.join('/')} dès ${x.drop.minDepth} m, ${+(x.drop.chance * 100).toFixed(3)} % par bloc — ${coSeasonLabel(x.seasonId)}`));
  document.getElementById('co-confirm-drops').checked = false;
  document.getElementById('btn-co-publish').disabled = !d || d.errors.length > 0 || !d.changes.length;
  document.getElementById('btn-co-discard').disabled = !d;

  const vb = document.getElementById('co-versions-body');
  vb.textContent = '';
  for (const v of data.versions) {
    const tr = document.createElement('tr');
    const src = { origin: 'origine', publish: 'publication', rollback: `retour à v${v.fromVersion}` }[v.source] ?? v.source;
    [`v${v.version}`, v.createdAt, src, v.series, `${v.items} (${v.dropping})`, v.note ?? ''].forEach(x => addCell(tr, x));
    if (v.version === p.version) addCell(tr, 'en vigueur');
    else addButtonCell(tr, `Revenir à v${v.version}`, () => coRollback(v.version));
    vb.appendChild(tr);
  }

  const ib = document.getElementById('co-images');
  ib.textContent = '';
  for (const img of data.images) {
    const fig = document.createElement('figure');
    fig.style.cssText = 'margin:0;text-align:center;font-size:0.7rem';
    const el = document.createElement('img');
    el.src = img.url; el.alt = img.label ?? ''; el.width = 64; el.height = 64; el.style.objectFit = 'contain';
    const cap = document.createElement('figcaption');
    cap.textContent = `${img.label ?? img.sha256.slice(0, 8)} · ${Math.round(img.bytes / 1024)} Ko`;
    const use = document.createElement('button');
    use.className = 'btn-ghost'; use.textContent = 'Utiliser';
    use.addEventListener('click', () => { document.getElementById('co-i-image').value = img.url; coPreview(); });
    fig.append(el, cap, use);
    ib.appendChild(fig);
  }
  loadCollectionsAudit();
}

async function loadCollectionsAudit() {
  const { ok, data } = await api('GET', '/api/admin/collections/audit?limit=100');
  const tb = document.getElementById('co-audit-body');
  tb.textContent = '';
  if (!ok) return;
  for (const a of data.audit) {
    const tr = document.createElement('tr');
    [a.created_at, a.action, a.version ?? '', a.details ? JSON.stringify(a.details).slice(0, 300) : ''].forEach(x => addCell(tr, x));
    tb.appendChild(tr);
  }
}

async function coRollback(version) {
  if (!confirm(`Revenir au contenu de la version v${version} ? Une nouvelle version sera publiée immédiatement pour tous les joueurs.`)) return;
  const { ok, data } = await api('POST', '/api/admin/collections/rollback', { version });
  ptMessage('co-rollback-msg', ok ? `Version v${data.version} publiée (contenu de v${data.restored}).` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) loadCollections();
}

document.getElementById('btn-refresh-collections').addEventListener('click', loadCollections);
document.getElementById('co-filter-text').addEventListener('input', () => { if (_co) coRenderItems(); });
document.getElementById('co-filter-series').addEventListener('change', () => { if (_co) coRenderItems(); });
for (const id of ['co-i-icon', 'co-i-image', 'co-i-rarity', 'co-i-series', 'co-preview-lang', ...CO_LANGS.flatMap(l => [`co-i-name-${l}`, `co-i-story-${l}`])]) {
  document.getElementById(id).addEventListener('input', coPreview);
}
document.getElementById('btn-co-s-new').addEventListener('click', () => coFillSeriesForm(null));
document.getElementById('btn-co-i-new').addEventListener('click', () => coFillItemForm(null));

document.getElementById('btn-co-s-save').addEventListener('click', async () => {
  const seasonVal = document.getElementById('co-s-season').value;
  const series = { id: document.getElementById('co-s-id').value.trim(), names: coTexts('co-s-name'),
    seasonId: seasonVal === '' ? null : Number(seasonVal), icon: document.getElementById('co-s-icon').value.trim(),
    active: document.getElementById('co-s-active').checked };
  if (!series.id) { ptMessage('co-s-msg', 'Identifiant requis.', false); return; }
  const { ok, data } = await api('PUT', `/api/admin/collections/draft/series/${encodeURIComponent(series.id)}`, { series });
  ptMessage('co-s-msg', ok ? `Série « ${data.series.id} » enregistrée dans le brouillon.` : (data.error || 'Erreur.'), ok);
  if (ok) { await loadCollections(); coFillSeriesForm(coWorking().series.find(s => s.id === data.series.id)); }
});

document.getElementById('btn-co-s-remove').addEventListener('click', async () => {
  const id = document.getElementById('co-s-id').value.trim();
  if (!id || !confirm(`Retirer la série « ${id} » du brouillon ?`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/collections/draft/series/${encodeURIComponent(id)}`);
  ptMessage('co-s-msg', ok ? `Série « ${id} » retirée du brouillon.` : (data.error || 'Erreur.'), ok);
  if (ok) { coFillSeriesForm(null); loadCollections(); }
});

document.getElementById('btn-co-i-save').addEventListener('click', async () => {
  const item = coReadItem();
  if (!item.id) { ptMessage('co-i-msg', 'Identifiant requis.', false); return; }
  const { ok, data } = await api('PUT', `/api/admin/collections/draft/items/${encodeURIComponent(item.id)}`, { item });
  ptMessage('co-i-msg', ok ? `« ${data.item.id} » enregistré dans le brouillon (pas encore visible des joueurs).` : (data.error || 'Erreur.'), ok);
  if (ok) { await loadCollections(); coFillItemForm(coWorking().items.find(i => i.id === data.item.id)); }
});

document.getElementById('btn-co-i-remove').addEventListener('click', async () => {
  const id = document.getElementById('co-i-id').value.trim();
  if (!id || !confirm(`Retirer « ${id} » du brouillon ?`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/collections/draft/items/${encodeURIComponent(id)}`);
  ptMessage('co-i-msg', ok ? `« ${id} » retiré du brouillon.` : (data.error || 'Erreur.'), ok);
  if (ok) { coFillItemForm(null); loadCollections(); }
});

document.getElementById('co-i-upload').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 350 * 1024) { ptMessage('co-i-msg', 'Image trop lourde (maximum 350 Ko).', false); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    const label = document.getElementById('co-i-id').value.trim() || file.name;
    const { ok, data } = await api('POST', '/api/admin/collections/images', { data: reader.result, label });
    ptMessage('co-i-msg', ok ? `Image téléversée (${Math.round(data.bytes / 1024)} Ko)${data.duplicate ? ', déjà présente' : ''}. Enregistrez l'objet pour l'utiliser.` : (data.error || 'Erreur.'), ok);
    if (ok) { document.getElementById('co-i-image').value = data.url; coPreview(); }
  };
  reader.readAsDataURL(file);
});

document.getElementById('btn-co-publish').addEventListener('click', async () => {
  if (!_co?.draft) return;
  const confirmDrops = document.getElementById('co-confirm-drops').checked;
  if (_co.draft.drops.length && !confirmDrops) { ptMessage('co-publish-msg', 'Cochez « barème validé » pour publier de nouveaux drops.', false); return; }
  if (!confirm(`Publier le brouillon (${_co.draft.changes.length} changement(s)) ? Il sera visible de tous les joueurs au prochain chargement.`)) return;
  const note = document.getElementById('co-publish-note').value;
  const { ok, data } = await api('POST', '/api/admin/collections/publish', { note, expectedBasedOn: _co.draft.basedOn, confirmDrops });
  ptMessage('co-publish-msg', ok ? `Version v${data.version} publiée.` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) { document.getElementById('co-publish-note').value = ''; loadCollections(); }
});

document.getElementById('btn-co-discard').addEventListener('click', async () => {
  if (!confirm('Abandonner le brouillon ? Les modifications non publiées seront perdues.')) return;
  const { ok, data } = await api('DELETE', '/api/admin/collections/draft');
  ptMessage('co-publish-msg', ok ? 'Brouillon abandonné.' : (data.error || 'Erreur.'), ok);
  if (ok) { coFillItemForm(null); coFillSeriesForm(null); loadCollections(); }
});


// ── Atelier d'icônes (#40) ────────────────────────────────────────────────────

let _ic = null;          // vue d'ensemble (GET /api/admin/icons)
let _icOpen = null;      // clé de la cible ouverte
let _icPoll = null;      // minuterie de suivi du lot
const _icSelected = new Set();
const IC_ACTIONS = { generated: 'Générée', uploaded: 'Téléversée', chosen: 'Retenue', rejected: 'Rejetée', restored: 'Remise en proposition',
  validated: 'VALIDÉE', applied: 'Appliquée au brouillon', reverted_to_emoji: 'Retour à l\'emoji (brouillon)', brief: 'Brief modifié' };
const IC_STATUS = { candidate: 'proposition', chosen: 'retenue', rejected: 'rejetée', validated: 'validée' };
const IC_BG_RE = /^linear-gradient\(\d+deg,\s*#[0-9a-f]{6},\s*#[0-9a-f]{6}\)$/i;

function icIconEl(t, size) {
  const box = aiEl('span', { style: `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.6)}px` });
  const src = t.image || t.v1?.url;
  if (src) box.appendChild(aiEl('img', { src, alt: '', width: String(size), height: String(size), style: 'object-fit:contain' }));
  else box.textContent = t.emoji || '⬜';
  return box;
}

function icStatusText(s) {
  if (!s.configured) return `API d'images non configurée : ${s.reason}. Génération désactivée (téléversement possible).`;
  const cap = s.studioCapUsd != null ? ` — atelier ${s.studioSpentUsd} / ${s.studioCapUsd} USD` : '';
  return `Modèle ${s.imageModel}${s.fake ? ' (MODE TEST, aucun appel réel)' : ''} — dépense globale ${s.globalSpentUsd} / ${s.globalCapUsd} USD${cap}`
    + ` — reste ${s.remainingUsd} USD (≈ ${s.estImageUsd} USD par image, soit ${Math.floor(s.remainingUsd / s.estImageUsd)} image(s))`
    + ` — ${s.imagesToday}/${s.maxImagesPerDay} images sur 24 h${s.reference ? ` — référence de style : ${s.reference}` : ''}.`;
}

async function loadIcons() {
  const { ok, data } = await api('GET', '/api/admin/icons');
  if (!ok) { document.getElementById('ic-status').textContent = data.error || 'Erreur.'; return; }
  _ic = data;
  document.getElementById('ic-status').textContent = icStatusText(data.status);
  const b = document.getElementById('ic-budget');
  if (document.activeElement !== b) b.value = data.status.studioCapUsd ?? '';
  document.getElementById('btn-ic-batch').disabled = !data.status.configured;
  icRenderJob(data.job);
  icRenderTable();
  const cb = document.getElementById('ic-calls-body');
  cb.textContent = '';
  for (const c of data.calls) {
    const tr = document.createElement('tr');
    [c.created_at, c.target, c.model, c.ok ? 'OK' : `Échec : ${c.error ?? ''}`, `${c.cost_usd} USD`,
     c.duration_ms != null ? `${(c.duration_ms / 1000).toFixed(1)} s` : ''].forEach(v => addCell(tr, v));
    cb.appendChild(tr);
  }
  if (_icOpen) icOpen(_icOpen);
}

function icFiltered() {
  const kind = document.getElementById('ic-kind').value;
  const state = document.getElementById('ic-state').value;
  const q = document.getElementById('ic-search').value.trim().toLowerCase();
  return (_ic?.targets ?? []).filter(t => (!kind || t.kind === kind) && (!state || t.state === state)
    && (!q || `${t.name} ${t.id}`.toLowerCase().includes(q)));
}

function icEstimate() {
  const n = _icSelected.size * Number(document.getElementById('ic-variants').value);
  const est = _ic?.status?.estImageUsd;
  document.getElementById('ic-estimate').textContent = n
    ? `${_icSelected.size} icône(s) × ${document.getElementById('ic-variants').value} = ${n} image(s)${est != null ? `, ≈ ${(n * est).toFixed(2)} USD estimés` : ''}`
    : 'Cochez des icônes pour un lot.';
}

function icRenderTable() {
  const body = document.getElementById('ic-body');
  body.textContent = '';
  for (const t of icFiltered()) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    const cb = aiEl('input', { type: 'checkbox', 'aria-label': `Sélectionner ${t.name}` });
    cb.checked = _icSelected.has(t.key);
    cb.addEventListener('change', () => { if (cb.checked) _icSelected.add(t.key); else _icSelected.delete(t.key); icEstimate(); });
    td.appendChild(cb);
    tr.appendChild(td);
    const ti = document.createElement('td');
    ti.appendChild(icIconEl(t, 40));
    tr.appendChild(ti);
    addCell(tr, `${t.name} (${t.id})`).title = t.extra ?? '';
    addCell(tr, t.kindLabel);
    addCell(tr, t.validated ? `🔒 validée (${t.validated.by === 'v1' ? 'v1' : 'atelier'})` : t.state);
    addCell(tr, t.candidates || '');
    addButtonCell(tr, 'Ouvrir', () => icOpen(t.key));
    body.appendChild(tr);
  }
  icEstimate();
}

function icRenderJob(job) {
  const el = document.getElementById('ic-job');
  clearTimeout(_icPoll);
  if (!job) { el.textContent = 'Aucun lot lancé depuis le dernier redémarrage du serveur.'; return; }
  const errors = job.items.flatMap(i => i.errors.map(e => `${i.name} : ${e}`));
  const head = job.status === 'running'
    ? `Lot #${job.id} en cours : ${job.done}/${job.total} image(s)${job.current ? ` — ${job.current}` : ''} (≈ 1 min par image).`
    : `Lot #${job.id} ${job.status === 'done' ? 'terminé' : 'interrompu'} : ${job.items.reduce((n, i) => n + i.results.length, 0)}/${job.total} image(s).`;
  el.textContent = `${head} Coût estimé ${job.estimatedUsd} USD, réel ${job.spentUsd} USD.${job.stopped ? ` Arrêt : ${job.stopped}` : ''}${errors.length ? ` Erreurs : ${errors.join(' | ')}` : ''}`;
  if (job.status === 'running') {
    _icPoll = setTimeout(async () => {
      const { ok, data } = await api('GET', '/api/admin/icons/job');
      if (!ok) return;
      if (data.job?.status !== 'running') loadIcons();
      else icRenderJob(data.job);
    }, 4000);
  }
}

async function icStartJob(targets, variants, msgEl) {
  msgEl.textContent = '…';
  const { ok, data } = await api('POST', '/api/admin/icons/jobs', { targets, variants });
  msgEl.textContent = ok ? `Lot #${data.job.id} lancé : ${data.job.total} image(s), ≈ ${data.job.estimatedUsd} USD estimés.` : (data.error || 'Erreur.');
  if (ok) icRenderJob(data.job);
}

/** Aperçu « taille réelle smartphone » (390 px) : bloc en jeu, case de collection, barre de navigation. */
function icMobilePreview(t, url) {
  const phone = aiEl('div', { style: 'width:390px;max-width:100%;background:#111827;border:1px solid #374151;border-radius:18px;padding:14px;display:flex;flex-direction:column;align-items:center;gap:12px' });
  phone.appendChild(aiEl('span', { class: 'muted', style: 'font-size:0.7rem' }, 'Aperçu taille réelle — smartphone 390 px'));
  if (t.kind === 'block') {
    const block = aiEl('div', { style: 'width:152px;height:152px;border-radius:20px;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.12);box-shadow:0 12px 40px rgba(0,0,0,0.65)' });
    block.style.background = IC_BG_RE.test(t.background?.color ?? '') ? t.background.color : 'linear-gradient(145deg,#4b5563,#374151)';
    if (/^#[0-9a-f]{6}$/i.test(t.background?.accent ?? '')) block.style.borderColor = t.background.accent;
    block.appendChild(aiEl('img', { src: url, alt: '', style: 'width:70%;height:70%;object-fit:contain;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))' }));
    phone.appendChild(block);
  } else if (t.kind === 'item') {
    const grid = aiEl('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%' });
    for (let i = 0; i < 4; i++) {
      const card = aiEl('div', { style: 'background:#1f2937;border:1px solid rgba(245,197,24,0.22);border-radius:12px;padding:12px 4px 10px;display:flex;flex-direction:column;align-items:center;gap:5px' });
      if (i === 0) card.appendChild(aiEl('img', { src: url, alt: '', width: '36', height: '36', style: 'object-fit:contain' }));
      else card.appendChild(aiEl('span', { style: 'font-size:1.2rem;opacity:0.3' }, '?'));
      card.appendChild(aiEl('span', { style: 'font-size:0.57rem;font-weight:600' }, i === 0 ? t.name : '???'));
      grid.appendChild(card);
    }
    phone.appendChild(grid);
    phone.appendChild(aiEl('img', { src: url, alt: '', width: '112', height: '112', style: 'object-fit:contain', title: 'Fiche détaillée' }));
  } else {
    const nav = aiEl('div', { style: 'display:flex;justify-content:space-around;width:100%;background:#0b1220;border-radius:10px;padding:8px 0' });
    for (let i = 0; i < 6; i++) {
      const cell = aiEl('span', { style: 'width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:20px' });
      if (i === 1) cell.appendChild(aiEl('img', { src: url, alt: '', width: '28', height: '28' }));
      else cell.textContent = ['⛏', '', '📦', '📅', '🛒', '🏆'][i];
      nav.appendChild(cell);
    }
    phone.appendChild(nav);
  }
  return phone;
}

async function icOpen(key, notice = '') {
  _icOpen = key;
  const { ok, data } = await api('GET', `/api/admin/icons/targets/${encodeURIComponent(key)}`);
  const box = document.getElementById('ic-detail');
  box.classList.remove('hidden');
  box.textContent = '';
  if (!ok) { box.appendChild(aiEl('p', { class: 'form-msg' }, data.error || 'Erreur.')); return; }
  const t = data.target;
  const head = aiEl('div', { class: 'section-header' });
  head.appendChild(aiEl('h3', { class: 'overview-card-title' }, `${t.kindLabel} — ${t.name} (${t.id})`));
  const close = aiEl('button', { class: 'btn' }, 'Fermer');
  close.addEventListener('click', () => { _icOpen = null; box.classList.add('hidden'); });
  head.appendChild(close);
  box.appendChild(head);
  box.appendChild(aiEl('p', { class: 'muted', style: 'font-size:0.78rem' },
    `${t.extra ?? ''} — actuel : ${t.image ? 'image appliquée' : t.v1 ? `bibliothèque v1 (${t.v1.status}, affichée par défaut)` : `emoji ${t.emoji}`}`
    + `${t.validated ? ` — 🔒 VALIDÉE (${t.validated.by === 'v1' ? 'bibliothèque v1' : 'atelier'}, ${t.validated.at}) : remplacement seulement avec accord explicite` : ''}`
    + ` — dépensé pour cette icône : ${t.costUsd} USD (${t.calls} appel(s)).${t.applicable ? '' : ' Pictogramme d\'interface : stocké ici, application en jeu avec le ticket #41.'}`));
  if (t.story) box.appendChild(aiEl('p', { class: 'muted', style: 'font-size:0.75rem' }, `Histoire : ${t.story}`));
  const msg = aiEl('p', { class: 'form-msg' }, notice);

  // Cohérence : actuel + icônes validées de référence
  const refs = aiEl('div', { style: 'display:flex;gap:0.8rem;align-items:center;flex-wrap:wrap;margin:0.4rem 0' });
  const cur = aiEl('div', { style: 'text-align:center;font-size:0.7rem' });
  cur.appendChild(icIconEl(t, 64)); cur.appendChild(aiEl('div', {}, 'actuel'));
  refs.appendChild(cur);
  for (const r of _ic?.references ?? []) {
    const d = aiEl('div', { style: 'text-align:center;font-size:0.7rem;opacity:0.85' });
    d.appendChild(aiEl('img', { src: r.url, alt: '', width: '64', height: '64' }));
    d.appendChild(aiEl('div', {}, `${r.id} ✓`));
    refs.appendChild(d);
  }
  box.appendChild(aiEl('p', { class: 'muted', style: 'font-size:0.75rem;margin-bottom:0' }, 'Icône actuelle et icônes validées (étalon de style) :'));
  box.appendChild(refs);

  // Brief
  const brief = aiEl('div', { style: 'display:grid;grid-template-columns:1fr;gap:0.4rem' });
  const [l1, subj] = aiInput('Sujet (anglais conseillé)', t.brief.subject, { maxlength: '300' });
  const [l2, det] = aiInput('Détails de forme / matière', t.brief.details, { maxlength: '600' });
  const [l3, pal] = aiInput('Palette', t.brief.palette, { maxlength: '300' });
  [l1, l2, l3].forEach(l => { l.style.display = 'flex'; l.style.flexDirection = 'column'; brief.appendChild(l); });
  box.appendChild(aiEl('h4', {}, `Brief de génération${t.brief.custom ? ' (personnalisé)' : ' (par défaut)'}`));
  box.appendChild(brief);
  const promptBox = aiEl('details');
  promptBox.appendChild(aiEl('summary', { class: 'muted' }, 'Prompt complet envoyé (style commun v1)'));
  promptBox.appendChild(aiEl('p', { class: 'muted', style: 'font-size:0.72rem' }, t.prompt));
  box.appendChild(promptBox);

  const actions = aiEl('div', { class: 'form-actions' });
  const button = (parent, label, fn, cls = 'btn') => {
    const b = aiEl('button', { class: cls }, label);
    b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } });
    parent.appendChild(b);
    return b;
  };
  button(actions, 'Enregistrer le brief', async () => {
    const { ok, data } = await api('PUT', `/api/admin/icons/targets/${encodeURIComponent(key)}/brief`, { subject: subj.value, details: det.value, palette: pal.value });
    msg.textContent = ok ? 'Brief enregistré.' : (data.error || 'Erreur.');
    if (ok) icOpen(key, msg.textContent);
  });
  button(actions, 'Brief par défaut', async () => {
    const { ok, data } = await api('PUT', `/api/admin/icons/targets/${encodeURIComponent(key)}/brief`, { reset: true });
    msg.textContent = ok ? 'Brief par défaut rétabli.' : (data.error || 'Erreur.');
    if (ok) icOpen(key, msg.textContent);
  });
  const variants = aiEl('select');
  ['1', '2', '3'].forEach(v => variants.appendChild(aiEl('option', { value: v }, `${v} variante(s)`)));
  actions.appendChild(variants);
  const gen = button(actions, '✨ Générer', async () => {
    if (subj.value !== t.brief.subject || det.value !== t.brief.details || pal.value !== t.brief.palette) {
      const { ok, data } = await api('PUT', `/api/admin/icons/targets/${encodeURIComponent(key)}/brief`, { subject: subj.value, details: det.value, palette: pal.value });
      if (!ok) { msg.textContent = data.error || 'Erreur.'; return; }
    }
    await icStartJob([key], Number(variants.value), msg);
  }, 'btn btn-primary');
  gen.disabled = !_ic?.status?.configured;
  const up = aiEl('label', { class: 'btn' }, '⬆ Téléverser (PNG/WebP transparent)');
  const file = aiEl('input', { type: 'file', accept: 'image/png,image/webp', style: 'display:none' });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { msg.textContent = 'Image trop lourde (maximum 4 Mo).'; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      msg.textContent = 'Contrôles en cours…';
      const { ok, data } = await api('POST', `/api/admin/icons/targets/${encodeURIComponent(key)}/upload`, { data: reader.result });
      msg.textContent = ok ? `Image acceptée${data.duplicate ? ' (déjà présente)' : ''} : contrôles réussis, normalisée.` : [data.error, ...(data.details ?? [])].join(' ');
      if (ok) icOpen(key, msg.textContent);
    };
    reader.readAsDataURL(f);
  });
  up.appendChild(file);
  actions.appendChild(up);
  if (t.applicable) {
    button(actions, 'Revenir à l\'emoji d\'origine', () => icApply(t, null, msg));
  }
  box.appendChild(actions);
  box.appendChild(msg);

  // Propositions
  box.appendChild(aiEl('h4', {}, `Propositions (${t.assets.length})`));
  const gallery = aiEl('div', { style: 'display:flex;flex-direction:column;gap:0.8rem' });
  for (const a of t.assets) {
    const card = aiEl('div', { style: `display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start;border:1px solid #374151;border-radius:10px;padding:0.6rem;${a.status === 'rejected' ? 'opacity:0.5' : ''}` });
    card.appendChild(icMobilePreview(t, a.url));
    const info = aiEl('div', { style: 'flex:1;min-width:220px;font-size:0.78rem' });
    info.appendChild(aiEl('p', {}, `${a.source === 'ai' ? `IA (${a.model}${a.variant ? `, variante ${a.variant}` : ''})` : 'Téléversée'} — ${a.createdAt} — statut : ${IC_STATUS[a.status] ?? a.status}${a.costUsd ? ` — ${a.costUsd} USD` : ''}`));
    const m = a.checks?.margins, lg = a.checks?.legibility;
    if (m) info.appendChild(aiEl('p', { class: 'muted' }, `Contrôles : fond transparent réel ✓, marges ${(m.left * 100).toFixed(0)}/${(m.top * 100).toFixed(0)}/${(m.right * 100).toFixed(0)}/${(m.bottom * 100).toFixed(0)} %, occupation ${(m.coverage * 100).toFixed(0)} %`
      + (lg ? `, contraste sur fond sombre ${Object.values(lg.contrast).map(v => v.toFixed(1)).join(' / ')}` : '')));
    const sizes = aiEl('div', { style: 'display:flex;gap:0.6rem;align-items:flex-end;margin:0.3rem 0' });
    for (const px of [24, 36, 64, 128]) {
      const s = aiEl('div', { style: 'text-align:center;font-size:0.65rem;background:#1f2937;border-radius:6px;padding:4px' });
      s.appendChild(aiEl('img', { src: a.url, alt: '', width: String(px), height: String(px) }));
      s.appendChild(aiEl('div', {}, `${px} px`));
      sizes.appendChild(s);
    }
    info.appendChild(sizes);
    const acts = aiEl('div', { class: 'form-actions' });
    const mark = status => async () => {
      const { ok, data } = await api('POST', `/api/admin/icons/targets/${encodeURIComponent(key)}/mark`, { sha: a.sha, status });
      msg.textContent = ok ? 'Statut enregistré.' : (data.error || 'Erreur.');
      if (ok) { icOpen(key, msg.textContent); loadIconsQuiet(); }
    };
    if (a.status !== 'chosen') button(acts, '★ Retenir', mark('chosen'));
    if (a.status !== 'rejected') button(acts, 'Rejeter', mark('rejected'));
    else button(acts, 'Remettre en proposition', mark('candidate'));
    if (a.status !== 'validated') button(acts, '🔒 Valider', async () => {
      if (!confirm('Marquer cette icône comme VALIDÉE ? Elle ne pourra ensuite être remplacée qu\'avec un accord explicite.')) return;
      await mark('validated')();
    });
    if (t.applicable) button(acts, 'Appliquer au brouillon', () => icApply(t, a.sha, msg), 'btn btn-primary');
    // #41 : emblème de logo simulé dans le véritable en-tête du jeu (aperçu non mémorisé, rien n'est activé).
    if (key === 'ui:logo') acts.appendChild(aiEl('a', { class: 'btn', href: `/?logo=media:${a.sha}`, target: '_blank', rel: 'noopener' }, 'Voir dans le vrai en-tête ↗'));
    info.appendChild(acts);
    card.appendChild(info);
    gallery.appendChild(card);
  }
  box.appendChild(gallery);

  // Historique et retour arrière
  const hist = aiEl('details');
  hist.appendChild(aiEl('summary', { class: 'muted' }, `Historique (${t.history.length}) et retour arrière`));
  const tbl = aiEl('table');
  const hb = aiEl('tbody');
  for (const h of t.history) {
    const tr = document.createElement('tr');
    addCell(tr, h.at);
    addCell(tr, IC_ACTIONS[h.action] ?? h.action);
    const ti = document.createElement('td');
    if (h.url) ti.appendChild(aiEl('img', { src: h.url, alt: '', width: '32', height: '32' }));
    tr.appendChild(ti);
    if (t.applicable && h.action === 'applied' && h.details?.before !== undefined) {
      addButtonCell(tr, 'Revenir à l\'icône d\'avant', () => {
        const prev = /\/media\/icons\/([a-f0-9]{16})\.webp$/.exec(h.details.before ?? '');
        if (h.details.before && !prev) { msg.textContent = `L'icône d'avant (${h.details.before}) ne vient pas de l'atelier : restaurez-la par « Revenir à vN » dans le catalogue.`; return; }
        icApply(t, prev ? prev[1] : null, msg);
      });
    } else addCell(tr, '');
    hb.appendChild(tr);
  }
  tbl.appendChild(hb);
  hist.appendChild(tbl);
  box.appendChild(hist);
}

async function icApply(t, sha, msg) {
  let override = false;
  if (t.validated) {
    if (!confirm(`L'icône de « ${t.name} » est VALIDÉE. La remplacer quand même (accord explicite, tracé) ?`)) return;
    override = true;
  }
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${encodeURIComponent(t.key)}/apply`, { sha, override });
  msg.textContent = ok
    ? `${sha ? 'Icône appliquée' : 'Emoji d\'origine rétabli'} dans le brouillon du catalogue ${data.catalog === 'blocks' ? '🧱 Blocs' : '📿 Collections'} : publiez-le dans cet onglet pour la mettre en jeu.`
    : (data.error || 'Erreur.');
  if (ok) { icOpen(t.key, msg.textContent); loadIconsQuiet(); }
}

async function loadIconsQuiet() {
  const { ok, data } = await api('GET', '/api/admin/icons');
  if (!ok) return;
  _ic = data;
  icRenderTable();
}

['ic-kind', 'ic-state'].forEach(id => document.getElementById(id).addEventListener('change', icRenderTable));
document.getElementById('ic-search').addEventListener('input', icRenderTable);
document.getElementById('ic-variants').addEventListener('change', icEstimate);
document.getElementById('ic-all').addEventListener('change', e => {
  for (const t of icFiltered()) { if (e.target.checked) _icSelected.add(t.key); else _icSelected.delete(t.key); }
  icRenderTable();
});
document.getElementById('btn-refresh-icons').addEventListener('click', loadIcons);
document.getElementById('btn-ic-batch').addEventListener('click', async () => {
  if (!_icSelected.size) { document.getElementById('ic-msg').textContent = 'Cochez au moins une icône.'; return; }
  const n = _icSelected.size * Number(document.getElementById('ic-variants').value);
  if (!confirm(`Lancer la génération de ${n} image(s) (${document.getElementById('ic-estimate').textContent}) ?`)) return;
  await icStartJob([..._icSelected], Number(document.getElementById('ic-variants').value), document.getElementById('ic-msg'));
});
document.getElementById('btn-ic-budget').addEventListener('click', async () => {
  const v = document.getElementById('ic-budget').value.trim();
  const { ok, data } = await api('PUT', '/api/admin/icons/budget', { studioBudgetUsd: v === '' ? null : Number(v) });
  document.getElementById('ic-msg').textContent = ok ? 'Plafond de l\'atelier enregistré.' : (data.error || 'Erreur.');
  if (ok) loadIcons();
});

// ── Badges et succès honorifiques (#38) ───────────────────────────────────────

const BG_LANGS = ['fr', 'en', 'nl', 'es'];
const BG_COND = {
  max_depth: 'Profondeur ≥ {n} m', blocks_of_type: '{block} ≥ {n}', blocks_total: 'Blocs minés ≥ {n}',
  distinct_types: 'Types différents ≥ {n}', chests_opened: 'Coffres ouverts ≥ {n}', play_days: 'Jours de jeu ≥ {n}',
};
const BG_STATUS = { active: 'actif', inactive: 'désactivé', archived: 'archivé' };
let _bgData = null;
let _bgEditing = null;

function bgCondLabel(b) {
  const bt = (_bgData?.blockTypes || []).find(t => t.id === b.blockId);
  return (BG_COND[b.condition] || b.condition).replace('{n}', Number(b.threshold).toLocaleString('fr'))
    .replace('{block}', bt ? `${bt.icon} ${bt.name}` : (b.blockId || '?'));
}

function bgReadForm() {
  const v = id => document.getElementById(id).value.trim();
  const names = {}, descriptions = {};
  for (const l of BG_LANGS) {
    if (v(`bg-${l}-name`)) names[l] = v(`bg-${l}-name`);
    if (v(`bg-${l}-desc`)) descriptions[l] = v(`bg-${l}-desc`);
  }
  return {
    id: v('bg-id'), category: v('bg-category'), condition: v('bg-condition'),
    blockId: v('bg-condition') === 'blocks_of_type' ? v('bg-block') : null,
    threshold: Number(v('bg-threshold')), icon: v('bg-icon'), image: v('bg-image') || null,
    visibility: v('bg-visibility'), status: v('bg-status'),
    startsAt: v('bg-starts') || null, endsAt: v('bg-ends') || null, sort: Number(v('bg-sort')) || 0,
    names, descriptions,
  };
}

function bgFillForm(b) {
  _bgEditing = b ? b.id : null;
  document.getElementById('bg-form-title').textContent = b ? `Modifier le badge « ${b.id} »` : 'Nouveau badge';
  const set = (id, val) => { document.getElementById(id).value = val ?? ''; };
  set('bg-id', b?.id); document.getElementById('bg-id').disabled = !!b;
  set('bg-category', b?.category ?? _bgData?.categories?.[0]);
  set('bg-condition', b?.condition ?? 'max_depth');
  set('bg-block', b?.blockId ?? 'pierre');
  set('bg-threshold', b?.threshold ?? 100); set('bg-icon', b?.icon ?? '🏅'); set('bg-image', b?.image);
  set('bg-visibility', b?.visibility ?? 'visible'); set('bg-status', b?.status ?? 'inactive');
  set('bg-starts', b?.startsAt); set('bg-ends', b?.endsAt); set('bg-sort', b?.sort ?? 0);
  for (const l of BG_LANGS) { set(`bg-${l}-name`, b?.names?.[l]); set(`bg-${l}-desc`, b?.descriptions?.[l]); }
  document.getElementById('bg-preview').textContent = '';
  bgToggleBlock();
}

function bgToggleBlock() {
  document.getElementById('bg-block').disabled = document.getElementById('bg-condition').value !== 'blocks_of_type';
}

function bgError(data) {
  return [data.error || 'Erreur.', ...(Array.isArray(data.details) ? data.details : [])].join(' ');
}

async function loadBadges() {
  const { ok, data } = await api('GET', '/api/admin/badges');
  if (!ok) { ptMessage('bg-msg', data.error || 'Erreur lors du chargement.', false); return; }
  _bgData = data;
  document.getElementById('bg-activated').textContent = data.activatedAt ? new Date(data.activatedAt).toLocaleString('fr') : '—';
  const cat = document.getElementById('bg-category');
  if (!cat.options.length) {
    for (const c of data.categories) { const o = document.createElement('option'); o.value = c; o.textContent = c; cat.appendChild(o); }
  }
  const blk = document.getElementById('bg-block');
  const keep = blk.value;
  blk.textContent = '';
  for (const t of data.blockTypes) { const o = document.createElement('option'); o.value = t.id; o.textContent = `${t.icon} ${t.name} (${t.id})`; blk.appendChild(o); }
  if (keep) blk.value = keep;
  if (!_bgEditing && !document.getElementById('bg-id').value) bgFillForm(null);

  const active = data.badges.filter(b => b.status === 'active').length;
  document.getElementById('bg-summary').textContent =
    `${data.badges.length} badge(s), dont ${active} actif(s) — ${data.playersTracked} joueur(s) suivi(s) depuis l'activation.`;
  const tb = document.getElementById('bg-body');
  tb.textContent = '';
  if (!data.badges.length) tb.innerHTML = '<tr><td colspan="10" class="muted">Aucun badge.</td></tr>';
  for (const b of data.badges) {
    const tr = document.createElement('tr');
    [b.sort, b.id, `${b.icon} ${b.names.fr}`, bgCondLabel(b)].forEach(x => addCell(tr, x));
    const td = document.createElement('td'); td.appendChild(statusBadge(BG_STATUS[b.status] || b.status)); tr.appendChild(td);
    addCell(tr, b.visibility === 'hidden' ? 'secret' : 'visible');
    addCell(tr, b.startsAt || b.endsAt ? `${b.startsAt || '…'} → ${b.endsAt || '…'}` : 'permanent');
    addCell(tr, b.earnedCount);
    addButtonCell(tr, 'Modifier', () => { bgFillForm(b); document.getElementById('bg-form-title').scrollIntoView({ behavior: 'smooth' }); });
    const next = b.status === 'active' ? 'inactive' : 'active';
    const act = document.createElement('td');
    const mk = (label, status, warn) => {
      const btn = document.createElement('button');
      btn.className = 'btn-ghost';
      btn.textContent = label;
      btn.addEventListener('click', async () => {
        if (warn && !confirm(warn)) return;
        const r = await api('POST', `/api/admin/badges/${encodeURIComponent(b.id)}/status`, { status });
        ptMessage('bg-msg', r.ok ? `Badge « ${b.id} » : ${BG_STATUS[status]}.` : bgError(r.data), r.ok);
        loadBadges();
      });
      act.appendChild(btn);
    };
    mk(next === 'active' ? 'Activer' : 'Désactiver', next,
      next === 'active' ? `Activer « ${b.id} » ? Les joueurs qui remplissent déjà la condition le recevront à leur prochaine sauvegarde.` : null);
    if (b.status !== 'archived') mk('Archiver', 'archived', `Archiver « ${b.id} » ? Il ne pourra plus être obtenu ; ceux qui l'ont le gardent.`);
    tr.appendChild(act);
    tb.appendChild(tr);
  }
  loadBadgeAudit();
}

async function loadBadgeAudit() {
  const { ok, data } = await api('GET', '/api/admin/badges/audit?limit=100');
  const tb = document.getElementById('bg-audit-body');
  tb.textContent = '';
  if (!ok) return;
  for (const a of data.entries) {
    const tr = document.createElement('tr');
    [a.createdAt, a.action, a.badgeId ?? '', a.details ? JSON.stringify(a.details).slice(0, 300) : ''].forEach(x => addCell(tr, x));
    tb.appendChild(tr);
  }
}

document.getElementById('bg-condition').addEventListener('change', bgToggleBlock);
document.getElementById('btn-refresh-badges').addEventListener('click', loadBadges);
document.getElementById('btn-bg-new').addEventListener('click', () => bgFillForm(null));
document.getElementById('btn-bg-preview').addEventListener('click', async () => {
  const { ok, data } = await api('POST', '/api/admin/badges/preview', bgReadForm());
  const el = document.getElementById('bg-preview');
  if (!ok) { el.textContent = ''; ptMessage('bg-msg', bgError(data), false); return; }
  const b = data.badge;
  el.textContent = `Aperçu : ${b.icon} « ${b.names.fr} » — ${b.descriptions.fr} — ${bgCondLabel(b)}. `
    + `Joueurs suivis : ${data.playersTracked} ; rempliraient déjà la condition : ${data.wouldEarnNow} ; à mi-chemin : ${data.halfway}. ${data.note}`;
  ptMessage('bg-msg', 'Badge valide.', true);
});
document.getElementById('btn-bg-save').addEventListener('click', async () => {
  const body = bgReadForm();
  if (body.status === 'active' && !confirm('Enregistrer ce badge comme ACTIF ? Il pourra être attribué dès la prochaine sauvegarde des joueurs.')) return;
  const r = _bgEditing
    ? await api('PUT', `/api/admin/badges/${encodeURIComponent(_bgEditing)}`, body)
    : await api('POST', '/api/admin/badges', body);
  if (!r.ok) { ptMessage('bg-msg', bgError(r.data), false); return; }
  ptMessage('bg-msg', `Badge « ${r.data.badge.id} » enregistré.`, true);
  bgFillForm(r.data.badge);
  loadBadges();
});

// ── Publicité (#45) ───────────────────────────────────────────────────────────

const AD_REASONS = {
  kill_switch: 'coupée par ADS_DISABLED', disabled: 'interrupteur général désactivé', no_provider: 'aucune régie',
  host_not_allowed: 'domaine non autorisé', no_slot: 'aucun emplacement actif et configuré', ad_free: 'joueur sans publicité',
};

function adMessage(id, text, ok) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = ok ? 'success' : 'error';
}

function renderAds(data) {
  const s = data.settings;
  const banner = document.getElementById('ad-banner');
  const live = data.effective.filter(e => e.enabled).map(e => e.host);
  banner.className = `contest-banner contest-banner--${live.length ? 'open' : 'locked'}`;
  banner.textContent = data.killSwitch ? '⛔ Publicité coupée par ADS_DISABLED (environnement).'
    : live.length ? `📢 Publicité ACTIVE sur : ${live.join(', ')} (après consentement du joueur).`
    : '🔒 Aucune publicité diffusée.';

  const sel = document.getElementById('ad-provider');
  sel.textContent = '';
  sel.appendChild(new Option('— aucune —', ''));
  for (const p of data.providers) sel.appendChild(new Option(p.label, p.id));
  sel.value = s.provider;
  document.getElementById('ad-hosts').value = s.allowedHosts.join(', ');
  document.getElementById('ad-contact').value = s.legalContact;
  document.getElementById('ad-adstxt').value = s.adsTxt;
  document.getElementById('ad-bump').checked = false;
  document.getElementById('ad-enabled').checked = s.enabled;
  document.getElementById('ad-confirm').value = '';

  const box = document.getElementById('ad-slots');
  box.textContent = '';
  for (const slot of data.slots) {
    const card = document.createElement('div');
    card.className = 'overview-card';
    const title = document.createElement('h4');
    title.textContent = `${slot.label} — ${slot.enabled ? 'activé' : 'désactivé'} — ${slot.configured ? `code enregistré (clé …${slot.adKey.slice(-6)}, script ${slot.scriptHost})` : 'aucun code'}`;
    card.appendChild(title);
    const ta = document.createElement('textarea');
    ta.rows = 4; ta.style.width = '100%'; ta.style.fontFamily = 'monospace';
    ta.placeholder = 'Coller ici le code « GET CODE » de l\u2019unité (atOptions + script). Il est analysé, jamais exécuté dans le panel.';
    card.appendChild(ta);
    const row = document.createElement('div');
    row.className = 'form-actions';
    const mk = (labelText, checked) => {
      const l = document.createElement('label'); const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = checked; l.append(c, ` ${labelText}`); row.appendChild(l); return c;
    };
    const en = mk('Emplacement activé', slot.enabled);
    const hide = mk('Masquer sur l\u2019écran de minage', slot.hideOnDig);
    const save = document.createElement('button');
    save.className = 'btn'; save.textContent = 'Enregistrer';
    save.addEventListener('click', async () => {
      const { ok, data: d } = await api('PUT', `/api/admin/ads/slots/${slot.slot}`, { snippet: ta.value, enabled: en.checked, hideOnDig: hide.checked });
      if (!ok) return adMessage('ad-slot-msg', d.error || 'Erreur.', false);
      adMessage('ad-slot-msg', 'Emplacement enregistré.', true);
      renderAds(d);
    });
    const clear = document.createElement('button');
    clear.className = 'btn-ghost'; clear.textContent = 'Effacer le code';
    clear.addEventListener('click', async () => {
      if (!confirm('Effacer le code de cet emplacement (il sera désactivé) ?')) return;
      const { ok, data: d } = await api('PUT', `/api/admin/ads/slots/${slot.slot}`, { clearCode: true, enabled: false });
      if (!ok) return adMessage('ad-slot-msg', d.error || 'Erreur.', false);
      renderAds(d);
    });
    row.append(save, clear);
    card.appendChild(row);
    box.appendChild(card);
  }

  const eb = document.getElementById('ad-effective');
  eb.textContent = '';
  for (const e of data.effective) {
    const tr = document.createElement('tr');
    [e.host, e.enabled ? 'oui' : 'non', e.reason ? (AD_REASONS[e.reason] || e.reason) : '—', e.slots.map(x => x.slot).join(', ') || '—']
      .forEach(x => addCell(tr, x));
    eb.appendChild(tr);
  }
  const sb = document.getElementById('ad-stats');
  sb.textContent = '';
  if (!data.stats.length) sb.innerHTML = '<tr><td colspan="3" class="muted">Aucun cadre servi.</td></tr>';
  for (const r of data.stats) {
    const tr = document.createElement('tr');
    [r.day, r.slot, r.frames].forEach(x => addCell(tr, x));
    sb.appendChild(tr);
  }
}

async function loadAds() {
  const { ok, data } = await api('GET', '/api/admin/ads');
  if (!ok) { adMessage('ad-settings-msg', data.error || 'Erreur lors du chargement.', false); return; }
  renderAds(data);
}

document.getElementById('btn-refresh-ads').addEventListener('click', loadAds);

document.getElementById('btn-ad-settings').addEventListener('click', async () => {
  const { ok, data } = await api('PUT', '/api/admin/ads/settings', {
    provider:     document.getElementById('ad-provider').value,
    allowedHosts: document.getElementById('ad-hosts').value,
    legalContact: document.getElementById('ad-contact').value,
    adsTxt:       document.getElementById('ad-adstxt').value,
    bumpConsent:  document.getElementById('ad-bump').checked,
  });
  if (!ok) return adMessage('ad-settings-msg', data.error || 'Erreur.', false);
  adMessage('ad-settings-msg', 'Réglages enregistrés.', true);
  renderAds(data);
});

document.getElementById('btn-ad-toggle').addEventListener('click', async () => {
  const { ok, data } = await api('PUT', '/api/admin/ads/settings', {
    enabled: document.getElementById('ad-enabled').checked,
    confirm: document.getElementById('ad-confirm').value.trim(),
  });
  if (!ok) return adMessage('ad-settings-msg', data.error || 'Erreur.', false);
  adMessage('ad-settings-msg', data.settings.enabled ? 'Interrupteur général ACTIVÉ.' : 'Interrupteur général désactivé.', true);
  renderAds(data);
});
