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
// ── Fiches modales communes (UX du panel, 31/10) : la page montre d'abord les données ; « ＋ Ajouter »
// ou un clic sur une ligne ouvre une fiche <dialog> (Échap, clic sur le fond, Annuler : fermeture sans
// effet ; le focus revient à l'élément d'origine, retrouvé par data-adm-key si la liste a été re-rendue).
function admDialogSetup(id) {
  const dlg = document.getElementById(id);
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    const o = dlg._admOpener;
    dlg._admOpener = null;
    if (!o) return;
    const key = o.dataset?.admKey;
    const again = !document.contains(o) && key ? document.querySelector(`[data-adm-key="${CSS.escape(key)}"]`) : null;
    (again ?? (document.contains(o) ? o : null))?.focus();
  });
  return dlg;
}

function admDialogOpen(id, opener, focusEl) {
  const dlg = document.getElementById(id);
  dlg._admOpener = opener ?? document.activeElement;
  if (!dlg.open) dlg.showModal();
  (typeof focusEl === 'string' ? document.getElementById(focusEl) : focusEl)?.focus();
  return dlg;
}

/** Ligne de liste cliquable (souris, Entrée, Espace) qui ouvre une fiche ; rien n'est modifié à l'ouverture. */
function admRowOpen(tr, key, label, onOpen) {
  tr.classList.add('bk-row');
  tr.tabIndex = 0;
  tr.dataset.admKey = key;
  tr.title = 'Cliquez pour ouvrir la fiche';
  tr.setAttribute('aria-haspopup', 'dialog');
  tr.setAttribute('aria-label', `${label} — ouvrir la fiche`);
  tr.addEventListener('click', () => onOpen(tr));
  tr.addEventListener('keydown', e => {
    if (e.target !== tr || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onOpen(tr);
  });
  addCell(tr, '›').className = 'bk-open';
}

function admShowError(el, text) { el.textContent = text; el.classList.toggle('hidden', !text); }

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
    if (btn.dataset.tab === 'config')          loadAiBudget();
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
    admRowOpen(tr, `season:${s.id}`, s.name, row => openSeasonSheet(s, row));
    tbody.appendChild(tr);
  });
}

// Fiche d'une saison : consultation (aucune édition de dates ici : la fin de la saison active a sa
// procédure dédiée, #44) ; seule action : « Clore » pour la saison active, avec confirmation.
let _seasonSheet = null;
admDialogSetup('season-dialog');

function openSeasonSheet(s, opener) {
  _seasonSheet = s;
  const isNew = !s;
  document.getElementById('season-dialog-title').textContent = isNew ? 'Nouvelle saison' : `Saison #${s.id} — ${s.name}`;
  document.getElementById('new-season-form').classList.toggle('hidden', !isNew);
  document.getElementById('btn-create-season').classList.toggle('hidden', !isNew);
  document.getElementById('btn-season-close').classList.toggle('hidden', isNew || s.status !== 'active');
  document.getElementById('btn-cancel-season').textContent = isNew ? 'Annuler' : 'Fermer';
  admShowError(document.getElementById('season-form-error'), '');
  const view = document.getElementById('season-view');
  view.classList.toggle('hidden', isNew);
  view.textContent = '';
  if (isNew) {
    for (const id of ['ns-name', 'ns-start', 'ns-end']) document.getElementById(id).value = '';
  } else {
    const dl = document.createElement('dl');
    for (const [k, v] of [['Nom', s.name], ['Début (UTC)', s.start_at], ['Fin (UTC)', s.end_at], ['Statut', s.status]]) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v ?? '—';
      dl.append(dt, dd);
    }
    view.appendChild(dl);
    if (s.status === 'active') {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.fontSize = '0.78rem';
      p.textContent = 'Pour changer la date de fin sans clore : 📊 Ligues & Saisons → « Date de fin de la saison active ».';
      view.appendChild(p);
    }
  }
  admDialogOpen('season-dialog', opener, isNew ? 'ns-name' : 'btn-cancel-season');
}

document.getElementById('btn-new-season').addEventListener('click', e => openSeasonSheet(null, e.currentTarget));
document.getElementById('btn-season-close').addEventListener('click', async () => {
  if (!_seasonSheet) return;
  if (await endSeason(_seasonSheet.id)) document.getElementById('season-dialog').close();
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
  document.getElementById('season-dialog').close();
  loadSeasons();
});

async function endSeason(id) {
  if (!confirm('Clore cette saison ?')) return false;
  const { ok, data } = await api('PUT', `/api/admin/seasons/${id}`, { status: 'closed' });
  if (!ok) admShowError(document.getElementById('season-form-error'), data.error ?? 'Erreur.');
  loadSeasons();
  return ok;
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
    admRowOpen(tr, `league:${l.id}`, l.name, row => openLeagueSheet(l, row));
    tbody.appendChild(tr);
  });
}

// Fiche d'une ligue : création, ou consultation/modification (PUT existant) et suppression confirmée.
admDialogSetup('league-dialog');
const NL_FIELDS = { name: 'nl-name', icon: 'nl-icon', level: 'nl-level', rank_min: 'nl-rmin', rank_max: 'nl-rmax', sort_order: 'nl-order' };

function openLeagueSheet(l, opener) {
  document.getElementById('nl-id').value = l ? l.id : '';
  document.getElementById('league-dialog-title').textContent = l ? `Ligue #${l.id} — ${l.icon} ${l.name}` : 'Nouvelle ligue';
  document.getElementById('btn-create-league').textContent = l ? 'Enregistrer' : 'Créer la ligue';
  document.getElementById('btn-league-delete').classList.toggle('hidden', !l);
  for (const [k, id] of Object.entries(NL_FIELDS)) document.getElementById(id).value = l?.[k] ?? '';
  admShowError(document.getElementById('league-form-error'), '');
  admDialogOpen('league-dialog', opener, l ? 'btn-cancel-league' : 'nl-name');
}

document.getElementById('btn-new-league').addEventListener('click', e => openLeagueSheet(null, e.currentTarget));
document.getElementById('btn-league-delete').addEventListener('click', async () => {
  const id = document.getElementById('nl-id').value;
  if (id && await deleteLeague(id, document.getElementById('nl-name').value)) document.getElementById('league-dialog').close();
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
  const id = document.getElementById('nl-id').value;
  const body = { name, icon, level, rank_min, rank_max, sort_order };
  const { ok, data } = id
    ? await api('PUT', `/api/admin/leagues/${encodeURIComponent(id)}`, body)
    : await api('POST', '/api/admin/leagues', body);
  if (!ok) { errEl.textContent = data.error ?? 'Erreur.'; errEl.classList.remove('hidden'); return; }
  document.getElementById('league-dialog').close();
  loadLeagues();
});

async function deleteLeague(id, name) {
  if (!confirm(`Supprimer la ligue "${name}" ?`)) return false;
  const { ok, data } = await api('DELETE', `/api/admin/leagues/${id}`);
  if (!ok) admShowError(document.getElementById('league-form-error'), data.error ?? 'Erreur.');
  loadLeagues();
  return ok;
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
    admRowOpen(tr, `shop:${it.id}`, it.texts.fr.title, row => shOpenSheet(it, row));
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
admDialogSetup('sh-dialog');
function shOpenSheet(item, opener) {
  shFillForm(item);
  document.getElementById('sh-item-msg').classList.add('hidden');
  admDialogOpen('sh-dialog', opener, item ? document.querySelector('#sh-dialog [data-close]') : 'sh-cost');
}
document.getElementById('btn-sh-new').addEventListener('click', e => shOpenSheet(null, e.currentTarget));

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
  if (!ok) return shMessage('sh-item-msg', data.error || 'Erreur.', false);
  document.getElementById('sh-dialog').close();
  shMessage('sh-list-msg', `Article #${data.item.id} enregistré.`, true);
  loadShop();
});

// ── Catalogue de blocs (#37) ──────────────────────────────────────────────────

const BK_RARITY = { commun: 'Commun', 'peu-commun': 'Peu commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire' };
const BK_BOOSTED = new Set(['rare', 'epique', 'legendaire']);
let _bk = null;   // vue admin (GET /api/admin/blocks)
// Tri visuel de la liste (le catalogue n'est pas modifié) : colonne + sens ; défaut = apparition croissante.
let _bkSort = { key: 'minDepth', dir: 'asc' };
const BK_RARITY_ORDER = ['commun', 'peu-commun', 'rare', 'epique', 'legendaire'];   // ordre métier, pas alphabétique
const BK_VISUAL_ORDER = { catalog: 0, v1: 1, emoji: 2, missing: 3 };                // image perso → v1 → emoji → absente

/** Nom FR affiché : catalogue, sinon traduction intégrée du jeu (14 blocs d'origine), sinon null. */
function bkNameFr(t) {
  if (t.names?.fr) return t.names.fr;
  return typeof I18n !== 'undefined' && I18n.has(`block.${t.id}`, 'fr') ? I18n.t(`block.${t.id}`) : null;
}

const bkNum = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Statut sous forme de rang : actifs avant désactivés ; puis inchangé, modifié, nouveau. */
function bkStatusRank(t, changed) {
  return (t.active ? 0 : 4) + (_bk.publishedIds.includes(t.id) ? 0 : 2) + (changed.has(t.id) ? 1 : 0);
}

/** Valeur de tri d'une colonne (nombre ou texte ; null = valeur absente, toujours en fin de liste). */
function bkSortValue(t, key, ctx) {
  switch (key) {
    case 'visual': return BK_VISUAL_ORDER[bkVisual(t).kind] ?? 9;
    case 'id': return t.id;
    case 'name': return bkNameFr(t);
    case 'category': return t.category ?? null;
    case 'rarity': { const i = BK_RARITY_ORDER.indexOf(t.rarity); return i < 0 ? null : i; }
    case 'hpBase': case 'reward': case 'minDepth': case 'weight': return bkNum(t[key]);
    case 'prob': return ctx.odds.get(t.id) ?? 0;
    case 'status': return bkStatusRank(t, ctx.changed);
    default: return null;
  }
}

/** Tri stable : nombres numériquement, textes en ordre français ; égalité → nom FR puis identifiant. */
function bkSortTypes(types, { key = 'minDepth', dir = 'asc' } = {}, ctx = { odds: new Map(), changed: new Set() }) {
  const sign = dir === 'desc' ? -1 : 1;
  const text = (x, y) => String(x).localeCompare(String(y), 'fr', { sensitivity: 'base', numeric: true });
  const tie = (a, b) => text(bkNameFr(a) ?? a.id, bkNameFr(b) ?? b.id) || a.id.localeCompare(b.id);
  return types.map(t => ({ t, v: bkSortValue(t, key, ctx) })).sort((x, y) => {
    if (x.v === null || y.v === null) return x.v === y.v ? tie(x.t, y.t) : x.v === null ? 1 : -1;
    const c = typeof x.v === 'number' && typeof y.v === 'number' ? x.v - y.v : text(x.v, y.v);
    return c ? sign * c : tie(x.t, y.t);
  }).map(x => x.t);
}

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

// Visuel effectif d'un bloc, comme le jeu (public/js/iconLibrary.js, réutilisé tel quel) :
// 1. image personnalisée du catalogue ; 2. bibliothèque par défaut de library.json (v1) si le
// matériau y figure ; 3. emoji de secours. Le panel montre le rendu par défaut des joueurs
// (une préférence ?icons=… propre à ce navigateur est ignorée).
let _bkIcons = null;   // library.json ; null (absent ou illisible) → emoji, comme le jeu

async function bkLoadIcons() {
  try {
    const r = await fetch('/assets/icons/library.json', { cache: 'no-store' });
    _bkIcons = r.ok ? await r.json() : null;
  } catch (_) { _bkIcons = null; }
  if (typeof IconLibrary !== 'undefined') IconLibrary.config = _bkIcons;
}

const bkAbs = (base, file) => `${base.startsWith('/') ? '' : '/'}${base}${file}`;

function bkVisual(t) {
  if (typeof IconLibrary === 'undefined') return { kind: 'emoji', label: 'Emoji (bibliothèque d\'icônes non chargée)' };
  const own = IconLibrary.catalogImage(t);
  if (own) return { kind: 'catalog', src: own, label: 'Image personnalisée (prioritaire)', short: 'image' };
  const a = _bkIcons?.defaultLibrary === 'v1' ? IconLibrary.asset(t) : null;
  if (a) {
    return { kind: 'v1', src: bkAbs(a.base, a.entry.webp['128']), srcset: `${bkAbs(a.base, a.entry.webp['128'])} 1x, ${bkAbs(a.base, a.entry.webp['256'])} 2x`,
      label: 'Bibliothèque v1 validée (affichée en jeu)', short: 'v1' };
  }
  return { kind: 'emoji', label: 'Aucune image : emoji de secours', short: 'emoji' };
}

/** Remplit `box` (classe bk-thumb) avec le visuel effectif ; `caption` (facultatif) reçoit la source. */
function bkDrawVisual(box, caption, t) {
  const v = bkVisual(t);
  const color = String(t.color ?? '');
  box.style.background = /^(#[0-9a-fA-F]{3,8}|linear-gradient\([#0-9a-fA-F, a-z.%()]+\))$/.test(color) ? color : '#374151';
  box.style.borderColor = /^#[0-9a-fA-F]{3,8}$/.test(t.accent ?? '') ? t.accent : '#6b7280';
  box.textContent = '';
  const setCaption = (kind, label, short) => {
    box.className = `bk-thumb bk-thumb--${kind}`;
    box.title = label;
    if (caption) {
      caption.textContent = caption.dataset.long ? label : short;
      caption.classList.toggle('bk-src--warn', kind === 'missing');
    }
  };
  setCaption(v.kind, v.label, v.short);
  if (!v.src) { box.textContent = t.icon || '❔'; return v; }
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.src = v.src;
  if (v.srcset) img.srcset = v.srcset;
  img.onerror = () => {
    if (!box.contains(img)) return;
    box.textContent = t.icon || '❔';
    setCaption('missing', `Image introuvable (${v.src}) : emoji de secours`, '⚠ absente');
  };
  box.appendChild(img);
  return v;
}

function bkPreview() {
  const caption = document.getElementById('bk-preview-src');
  caption.dataset.long = '1';
  const image = document.getElementById('bk-image').value.trim();
  const t = {
    id: document.getElementById('bk-id').value.trim(), image: image || null,
    icon: document.getElementById('bk-icon').value, color: document.getElementById('bk-color').value.trim(),
    accent: document.getElementById('bk-accent').value.trim(),
  };
  bkDrawVisual(document.getElementById('bk-preview'), caption, t);
  if (image && (typeof IconLibrary === 'undefined' || !IconLibrary.catalogImage(t))) {
    caption.textContent = `Chemin d'image non accepté (attendu /assets/….webp|png|svg ou /media/blocks/….webp) — ${caption.textContent}`;
    caption.classList.add('bk-src--warn');
  }
}

const BK_LANGS = ['fr', 'en', 'nl', 'es'];

function bkFillForm(t) {
  document.getElementById('bk-form-title').textContent = t ? `Modifier « ${t.id} »` : 'Nouveau bloc';
  const idEl = document.getElementById('bk-id');
  idEl.value = t ? t.id : '';
  idEl.readOnly = !!t;
  for (const l of BK_LANGS) document.getElementById(`bk-name-${l}`).value = t?.names?.[l] ?? '';
  document.getElementById('bk-name-fr').placeholder = t && _bk.legacyIds.includes(t.id) ? `${bkNameFr(t) ?? ''} (traduction intégrée)`.trim() : '';
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
  bkFillSheet(t);
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

function bkRenderSortHeaders() {
  for (const th of document.querySelectorAll('.bk-table th[data-sort]')) {
    const on = th.dataset.sort === _bkSort.key;
    th.setAttribute('aria-sort', on ? (_bkSort.dir === 'desc' ? 'descending' : 'ascending') : 'none');
    th.classList.toggle('bk-sorted', on);
    th.querySelector('.bk-sort-ind').textContent = on ? (_bkSort.dir === 'desc' ? '▼' : '▲') : '↕';
  }
}

function bkRenderTable() {
  const text = document.getElementById('bk-filter-text').value.trim().toLowerCase();
  const cat = document.getElementById('bk-filter-cat').value;
  const status = document.getElementById('bk-filter-status').value;
  const depth = Math.max(1, Number(document.getElementById('bk-odds-depth').value) || 1);
  const all = bkWorking();
  const odds = bkOdds(all, depth);
  const changed = new Set((_bk.draft?.changes ?? []).map(c => c.id));
  const types = bkSortTypes(all, _bkSort, { odds, changed });
  bkRenderSortHeaders();
  const tb = document.getElementById('bk-body');
  tb.textContent = '';
  for (const t of types) {
    const nameFr = bkNameFr(t);
    if (text && !`${t.id} ${nameFr ?? ''} ${t.names?.en ?? ''} ${t.names?.nl ?? ''} ${t.names?.es ?? ''}`.toLowerCase().includes(text)) continue;
    if (cat && t.category !== cat) continue;
    if (status === 'active' && !t.active) continue;
    if (status === 'inactive' && t.active) continue;
    if (status === 'changed' && !changed.has(t.id)) continue;
    if (status === 'emoji' && !['emoji', 'missing'].includes(bkVisual(t).kind)) continue;
    const tr = document.createElement('tr');
    // Ligne entière = ouverture de la fiche (souris, Entrée, Espace) ; rien n'est modifié à l'ouverture.
    tr.className = 'bk-row';
    tr.tabIndex = 0;
    tr.dataset.id = t.id;
    tr.title = 'Cliquez pour consulter ou modifier ce bloc';
    tr.setAttribute('aria-haspopup', 'dialog');
    tr.setAttribute('aria-label', `${nameFr ?? t.id} (${t.id}) — ouvrir la fiche`);
    tr.addEventListener('click', () => bkOpenSheet(t, tr));
    tr.addEventListener('keydown', e => {
      if (e.target !== tr || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      bkOpenSheet(t, tr);
    });
    const rangeNote = t.fadeFrom != null ? `atténué > ${t.fadeFrom} m : ${t.fadeWeight}`
      : t.maxDepth != null ? `ancienne borne ${t.maxDepth} m, convertie en atténuation à la publication` : '';
    const state = `${t.active ? 'actif' : 'désactivé'}${changed.has(t.id) ? ' · modifié' : ''}${_bk.publishedIds.includes(t.id) ? '' : ' · nouveau'}`;
    // Classes de colonne : nombres alignés à droite, sans retour à la ligne (le texte reste identique).
    const vis = document.createElement('td');
    vis.className = 'bk-visual';
    const box = document.createElement('div');
    const cap = document.createElement('small');
    cap.className = 'bk-src';
    vis.append(box, cap);
    const v = bkDrawVisual(box, cap, t);
    if (v.kind === 'emoji') cap.textContent = 'emoji · à illustrer';
    box.addEventListener('mouseenter', () => bkZoomShow(box, t));
    box.addEventListener('mouseleave', bkZoomHide);
    tr.addEventListener('focus', () => { if (tr.matches(':focus-visible')) bkZoomShow(box, t); });
    tr.addEventListener('blur', bkZoomHide);
    tr.appendChild(vis);
    [[t.id, 'bk-id'], [nameFr ?? '(intégré)', ''], [t.category, ''], [BK_RARITY[t.rarity] ?? t.rarity, 'nowrap'],
     [t.hpBase, 'num'], [t.reward, 'num'], [`dès ${t.minDepth} m`, 'bk-range'], [t.weight, 'num'],
     [bkPct(odds.get(t.id)) + (BK_BOOSTED.has(t.rarity) ? ' ★' : ''), 'num'], [state, 'bk-state']]
      .forEach(([x, cls]) => {
        const td = addCell(tr, x);
        if (cls) td.className = cls;
        if (cls === 'bk-range' && rangeNote) {
          const note = document.createElement('small');
          note.className = 'muted';
          note.textContent = rangeNote;
          td.appendChild(note);
        }
      });
    addCell(tr, '›').className = 'bk-open';
    tb.appendChild(tr);
  }
}

// ── Aperçu agrandi au survol (souris) ou au focus clavier ; sur écran tactile, la fiche le remplace.
// Même visuel que la miniature, en 256 px, proportions conservées (object-fit: contain, jamais recadré).
function bkZoomShow(anchor, t) {
  if (!window.matchMedia('(hover: hover)').matches && !anchor.closest('tr')?.matches(':focus-visible')) return;
  const zoom = document.getElementById('bk-zoom');
  const box = document.createElement('div');
  const cap = document.createElement('small');
  cap.className = 'bk-src';
  cap.dataset.long = '1';
  const v = bkDrawVisual(box, cap, t);
  const img = box.querySelector('img');
  if (img && v.kind === 'v1') { img.removeAttribute('srcset'); img.src = bkAbs(..._bkV1Big(t)); }
  zoom.textContent = '';
  const title = document.createElement('strong');
  title.textContent = `${bkNameFr(t) ?? t.id} (${t.id})`;
  zoom.append(title, box, cap);
  zoom.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const w = zoom.offsetWidth, h = zoom.offsetHeight;
  let left = r.right + 12, top = r.top + r.height / 2 - h / 2;
  if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 12);
  top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
  zoom.style.left = `${left}px`;
  zoom.style.top = `${top}px`;
}

function bkZoomHide() { document.getElementById('bk-zoom').classList.add('hidden'); }
window.addEventListener('scroll', bkZoomHide, { passive: true });
document.getElementById('bk-body').closest('.bk-table-wrap').addEventListener('scroll', bkZoomHide, { passive: true });

/** [base, fichier] du visuel v1 en 256 px. */
function _bkV1Big(t) {
  const a = IconLibrary.asset(t);
  return [a.base, a.entry.webp['256'] ?? a.entry.webp['128']];
}

// ── Fiche d'un bloc (dialogue modal) : consultation, puis modification dans le brouillon.
let _bkSheetOpener = null;

function bkOpenSheet(t, opener) {
  bkZoomHide();
  _bkSheetOpener = opener ?? document.activeElement;
  document.getElementById('bk-form-msg').classList.add('hidden');
  bkFillForm(t);
  const dlg = document.getElementById('bk-dialog');
  if (!dlg.open) dlg.showModal();
  (t ? document.getElementById('btn-bk-close') : document.getElementById('bk-id')).focus();
}

/** Résumé et état de l'illustration en tête de fiche (t = null : nouveau bloc). */
function bkFillSheet(t) {
  const sum = document.getElementById('bk-sheet-summary');
  const art = document.getElementById('bk-sheet-art');
  if (!t) { sum.textContent = 'Nouveau bloc : il sera ajouté au brouillon, invisible des joueurs jusqu\'à la publication.'; art.classList.add('hidden'); return; }
  const depth = Math.max(1, Number(document.getElementById('bk-odds-depth').value) || 1);
  const p = bkOdds(bkWorking(), depth).get(t.id);
  const changed = (_bk.draft?.changes ?? []).some(c => c.id === t.id);
  const names = BK_LANGS.map(l => `${l.toUpperCase()} : ${t.names?.[l] ?? (l === 'fr' && bkNameFr(t) ? `${bkNameFr(t)} (intégré)` : '—')}`).join(' · ');
  sum.textContent = `${BK_RARITY[t.rarity] ?? t.rarity} · ${t.category} · dès ${t.minDepth} m · ${bkPct(p)} à ${depth} m`
    + ` · ${t.active ? 'actif' : 'désactivé'}${changed ? ' · modifié dans le brouillon' : ''}${_bk.publishedIds.includes(t.id) ? '' : ' · nouveau (jamais publié)'} — ${names}`;
  const v = bkVisual(t);
  art.classList.remove('hidden');
  art.classList.toggle('bk-sheet-art--todo', v.kind === 'emoji' || v.kind === 'missing');
  document.getElementById('bk-sheet-art-text').textContent = v.kind === 'v1'
    ? '🔒 Icône v1 validée, affichée en jeu. L\'atelier ne la remplace qu\'avec votre accord explicite.'
    : v.kind === 'catalog'
      ? 'Image personnalisée du catalogue, prioritaire en jeu. Historique et variantes dans l\'atelier d\'icônes.'
      : 'Pas encore d\'illustration : l\'emoji de secours est affiché en jeu. Créez-la dans l\'atelier d\'icônes (#40), '
        + 'validez-la, appliquez-la au brouillon, puis publiez ici. Rien n\'est appliqué ni publié automatiquement.';
}

document.getElementById('bk-dialog').addEventListener('close', () => {
  // Retour du focus sur la ligne d'origine (re-rendue après un enregistrement : retrouvée par identifiant).
  const id = _bkSheetOpener?.dataset?.id;
  const row = id ? document.querySelector(`#bk-body tr[data-id="${CSS.escape(id)}"]`) : null;
  (row ?? (document.contains(_bkSheetOpener) ? _bkSheetOpener : null))?.focus();
  _bkSheetOpener = null;
});
document.getElementById('btn-bk-close').addEventListener('click', () => document.getElementById('bk-dialog').close());
// Clic sur le fond (hors du contenu) : fermeture.
document.getElementById('bk-dialog').addEventListener('click', e => { if (e.target.id === 'bk-dialog') e.target.close(); });
// « ＋ Ajouter un bloc » : choix « Créer avec l'IA » / « Créer manuellement » (Annuler : aucun effet).
admDialogSetup('bk-add-dialog');
admDialogSetup('ai-dialog');
document.getElementById('btn-bk-add').addEventListener('click', e => {
  admDialogOpen('bk-add-dialog', e.currentTarget, document.getElementById('btn-bk-add-ai').disabled ? 'btn-bk-add-manual' : 'btn-bk-add-ai');
});
document.getElementById('btn-bk-add-manual').addEventListener('click', () => {
  document.getElementById('bk-add-dialog').close();
  bkOpenSheet(null, document.getElementById('btn-bk-add'));
});
document.getElementById('btn-bk-add-ai').addEventListener('click', () => {
  document.getElementById('bk-add-dialog').close();
  document.getElementById('ai-msg').textContent = '';
  admDialogOpen('ai-dialog', document.getElementById('btn-bk-add'), 'ai-concept');
});
document.getElementById('btn-bk-studio').addEventListener('click', () => {
  const id = document.getElementById('bk-id').value.trim();
  document.getElementById('bk-dialog').close();
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  if (id) icOpen(`block:${id}`);
});

function bkChangeLabel(c) {
  if (c.kind === 'added') return 'ajouté';
  return c.fields.map(f => `${f.field} : ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join(' ; ');
}

async function loadBlocks() {
  const [{ ok, data }] = await Promise.all([api('GET', '/api/admin/blocks'), bkLoadIcons()]);
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

let _aiPoll = null;

/** État de l'image d'une proposition IA (serveur : imageStatus / imageError). */
const AI_IMAGE_STATE = {
  ok: ['✓ Image IA générée (stockée ; visible en jeu seulement après ajout au brouillon et publication).', ''],
  pending: ['⏳ Image en cours de génération (≈ 1 min) : cette carte se met à jour seule.', ''],
  error: ['⚠ Image en échec', ' — emoji de secours affiché. « ↻ Image seule » pour réessayer.'],
  none: ['Aucune image générée pour cette proposition — emoji de secours affiché. « ↻ Image seule » pour la créer.', ''],
};

async function loadAi() {
  const { ok, data } = await api('GET', '/api/admin/blocks/ai');
  const st = document.getElementById('ai-status');
  const st2 = document.getElementById('ai-status-2');
  if (!ok) { st.textContent = st2.textContent = data.error || 'Erreur.'; return; }
  const s = data.status;
  st.textContent = st2.textContent = s.configured
    ? `API IA : texte ${s.textModel}, image ${s.imageModel}${s.fake ? ' (MODE TEST, aucun appel réel)' : ''} — dépense ${s.spentUsd} / ${s.budgetUsd} USD (≈ ${s.estImageUsd} USD par image)`
      + ` — ${s.callsToday}/${s.maxCallsPerDay} appels sur 24 h${s.imageProcessing ? '' : ' — traitement d\'image indisponible'}.`
    : `API IA non configurée : ${s.reason}. La génération est désactivée (la clé reste côté serveur, jamais dans le navigateur).`;
  document.getElementById('btn-ai-generate').disabled = !s.configured;
  document.getElementById('btn-bk-add-ai').disabled = !s.configured;
  const box = document.getElementById('ai-proposals');
  box.textContent = '';
  for (const p of data.proposals) box.appendChild(aiRenderProposal(p, s.configured));
  // Propositions existantes = données : la carte n'apparaît que s'il y en a (ou un journal d'appels),
  // repliée (aucun formulaire affiché d'office) ; elle s'ouvre après une nouvelle proposition.
  const pending = data.proposals.filter(p => p.status === 'open').length;
  const card = document.getElementById('ai-card');
  card.classList.toggle('hidden', !data.proposals.length && !data.calls.length);
  document.getElementById('ai-card-title').textContent = `✨ Propositions IA — ${pending} à valider, ${data.proposals.length - pending} dans le brouillon`;
  // Image générée en arrière-plan : état rafraîchi tant qu'une génération est en cours
  clearTimeout(_aiPoll);
  if (data.proposals.some(p => p.imageStatus === 'pending')) _aiPoll = setTimeout(loadAi, 4000);
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
  const state = p.imageStatus ?? (p.image ? 'ok' : 'none');
  const visual = aiEl('div', { class: 'ai-visual' });
  const prev = aiEl('div', { class: `bk-thumb bk-thumb--${p.image ? 'ai' : state}` });
  prev.style.borderColor = /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#6b7280';
  prev.style.background = /^linear-gradient\(145deg,#[0-9a-f]{6},#[0-9a-f]{6}\)$/i.test(p.color) ? p.color : '#374151';
  const [stLabel, stTail] = AI_IMAGE_STATE[state] ?? AI_IMAGE_STATE.none;
  const caption = aiEl('small', { class: `bk-src${state === 'error' ? ' bk-src--warn' : ''}` },
    state === 'error' ? `${stLabel} : ${p.imageError ?? 'erreur inconnue'}${p.image ? ' (image précédente conservée)' : stTail}` : stLabel);
  if (p.image) {
    const img = aiEl('img', { src: p.image, alt: '' });
    img.onerror = () => { prev.textContent = p.icon || '❔'; caption.textContent = `⚠ Image IA introuvable (${p.image}) — emoji de secours affiché.`; caption.classList.add('bk-src--warn'); };
    prev.appendChild(img);
  } else {
    prev.textContent = state === 'pending' ? '⏳' : (p.icon || '❔');
  }
  visual.append(prev, caption);
  row.appendChild(visual);
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
    msg.textContent = what === 'image' ? 'Lancement de la génération de l\'image…' : 'Génération en cours…';
    const { ok, data } = await api('POST', `/api/admin/blocks/ai/proposals/${p.id}/regenerate`, { what });
    if (!ok) { msg.textContent = data.error || 'Erreur.'; return; }
    loadAi();
  };
  if (open) {
    button('Enregistrer les corrections', save);
    const busy = state === 'pending';
    button('↻ Noms / traductions', regen('names'), { disabled: !configured || busy });
    button('↻ Image seule', regen('image'), { disabled: !configured || busy });
    button('↻ Tout le texte', regen('text'), { disabled: !configured || busy });
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
    }, { primary: true, disabled: state === 'pending' });
    button('Abandonner', async () => {
      if (!confirm(`Abandonner la proposition #${p.id} ?`)) return;
      const { ok, data } = await api('DELETE', `/api/admin/blocks/ai/proposals/${p.id}`);
      if (!ok) { msg.textContent = data.error || 'Erreur.'; return; }
      loadAi();
    });
  } else {
    actions.appendChild(aiEl('span', { class: 'muted' }, 'Dans le brouillon du catalogue : relisez, simulez puis publiez plus bas. Modifications ultérieures : cliquez sur sa ligne dans la liste des blocs.'));
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
  const withImage = document.getElementById('ai-with-image').checked;
  msg.textContent = `Génération du texte en cours (≈ 30 s)${withImage ? ', puis de l\'image (≈ 1 min, suivie dans la carte de la proposition)' : ''}…`;
  try {
    const { ok, data } = await api('POST', '/api/admin/blocks/ai/proposals', { concept, withImage });
    if (!ok) msg.textContent = data.error || 'Erreur.';
    else {
      // Proposition créée : la fiche se ferme et la carte « Propositions IA » s'ouvre sur elle.
      document.getElementById('ai-concept').value = '';
      msg.textContent = '';
      document.getElementById('ai-dialog').close();
      await loadAi();
      const card = document.getElementById('ai-card');
      card.open = true;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  } catch (_) {
    msg.textContent = 'Réponse du serveur interrompue : l\'état réel de la proposition est rechargé dans « ✨ Propositions IA ».';
  } finally {
    btn.disabled = false;
  }
  loadAi();
});
for (const th of document.querySelectorAll('.bk-table th[data-sort]')) {
  th.querySelector('.bk-sort-btn').addEventListener('click', () => {
    const key = th.dataset.sort;
    _bkSort = { key, dir: _bkSort.key === key && _bkSort.dir === 'asc' ? 'desc' : 'asc' };
    if (_bk) bkRenderTable();
  });
}
for (const id of ['bk-filter-text', 'bk-filter-cat', 'bk-filter-status', 'bk-odds-depth']) {
  document.getElementById(id).addEventListener('input', () => { if (_bk) bkRenderTable(); });
}
for (const id of ['bk-id', 'bk-icon', 'bk-image', 'bk-color', 'bk-accent']) document.getElementById(id).addEventListener('input', bkPreview);

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
// UX commune du panel (31/10) : la page montre d'abord séries et objets ; « ＋ Ajouter » ouvre un choix
// (✨ collection avec l'IA, série ou objet manuel) ; un clic sur une ligne ouvre sa fiche.

const CO_LANGS = ['fr', 'en', 'nl', 'es'];
const CO_IMAGE_RE = /^(\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)|\/api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp)|\/media\/icons\/[a-f0-9]{16}\.webp)$/;
let _co = null;   // vue admin (GET /api/admin/collections)
let _coAi = null; // propositions IA (GET /api/admin/collections/ai)
let _coAiTimer = null;
let _coProp = null; // proposition ouverte dans la fiche de relecture

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

/** Visuel d'un objet : image si elle est valide (repli emoji si elle ne charge pas), sinon emoji. */
function coArt(el, image, icon, size) {
  el.textContent = '';
  if (image && CO_IMAGE_RE.test(image) && !image.includes('..')) {
    const img = document.createElement('img');
    img.src = image; img.alt = ''; img.width = size; img.height = size; img.style.objectFit = 'contain';
    img.onerror = () => { el.textContent = icon || '❔'; };
    el.appendChild(img);
  } else {
    el.textContent = icon || '❔';
  }
}

function coNotice(text, ok = true) { ptMessage('co-notice', text, ok); }

// Séries
admDialogSetup('co-series-dialog');
function coFillSeriesForm(s) {
  document.getElementById('co-series-form-title').textContent = s ? `Série « ${s.names?.fr ?? s.id} »` : 'Nouvelle série';
  const idEl = document.getElementById('co-s-id');
  idEl.value = s ? s.id : '';
  idEl.readOnly = !!s;
  for (const l of CO_LANGS) document.getElementById(`co-s-name-${l}`).value = s?.names?.[l] ?? '';
  document.getElementById('co-s-season').value = s?.seasonId == null ? '' : String(s.seasonId);
  document.getElementById('co-s-icon').value = s ? s.icon : '📦';
  document.getElementById('co-s-active').checked = s ? s.active : true;
  const rm = document.getElementById('btn-co-s-remove');
  rm.classList.toggle('hidden', !s || _co.publishedIds.series.includes(s.id));
  admShowError(document.getElementById('co-s-msg'), '');
}
function coOpenSeries(s, opener) {
  coFillSeriesForm(s);
  admDialogOpen('co-series-dialog', opener, s ? 'co-s-name-fr' : 'co-s-id');
}

// Objets
admDialogSetup('co-item-dialog');
function coFillItemForm(i) {
  document.getElementById('co-i-form-title').textContent = i ? `Objet « ${i.names?.fr ?? i.id} »` : 'Nouvel objet';
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
  document.getElementById('btn-co-i-remove').classList.toggle('hidden', !i || _co.publishedIds.items.includes(i.id));
  document.getElementById('btn-co-i-studio').disabled = !i;
  document.getElementById('btn-co-i-studio').title = i ? 'Ouvre l\'atelier d\'icônes sur cet objet : une image par action, jamais automatique'
    : 'Enregistrez d\'abord l\'objet dans le brouillon';
  admShowError(document.getElementById('co-i-msg'), '');
  coPreview();
}
function coOpenItem(i, opener) {
  coFillItemForm(i);
  admDialogOpen('co-item-dialog', opener, i ? 'co-i-name-fr' : 'co-i-id');
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
  coArt(document.getElementById('co-preview-art'), document.getElementById('co-i-image').value.trim(), document.getElementById('co-i-icon').value, 140);
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
  const st = document.getElementById('co-filter-state').value;
  const changed = new Set((_co.draft?.changes ?? []).filter(c => c.kind === 'items').map(c => c.id));
  const tb = document.getElementById('co-items-body');
  tb.textContent = '';
  let shown = 0;
  for (const i of items) {
    if (sf && i.seriesId !== sf) continue;
    if (text && !`${i.id} ${Object.values(i.names ?? {}).join(' ')}`.toLowerCase().includes(text)) continue;
    if (st === 'noimage' && i.image) continue;
    if (st === 'nostory' && CO_LANGS.every(l => i.stories?.[l])) continue;
    if (st === 'changed' && !changed.has(i.id) && _co.publishedIds.items.includes(i.id)) continue;
    if (st === 'drop' && !(i.active && i.dropEnabled)) continue;
    shown++;
    const tr = document.createElement('tr');
    const s = series.find(x => x.id === i.seriesId);
    const drop = `${i.drop.from.join('/')} dès ${i.drop.minDepth} m · ${+(i.drop.chance * 100).toFixed(3)} %${i.dropEnabled ? '' : ' (inactif)'}`;
    const langs = CO_LANGS.map(l => (i.names?.[l] && i.stories?.[l] ? l : (i.names?.[l] ? `${l}*` : '—'))).join(' ');
    const state = `${i.active ? 'actif' : 'désactivé'}${changed.has(i.id) ? ' · modifié' : ''}${_co.publishedIds.items.includes(i.id) ? '' : ' · nouveau'}`;
    const art = addCell(tr, '');
    art.className = 'co-thumb';
    art.title = i.image ? 'Image' : 'Pas encore d\'image (emoji affiché)';
    coArt(art, i.image, i.icon, 40);
    [i.id, i.names?.fr ?? '', s ? s.names.fr : i.seriesId, BK_RARITY[i.rarity] ?? i.rarity, drop, langs, state].forEach(x => addCell(tr, x));
    admRowOpen(tr, `co-item:${i.id}`, i.names?.fr ?? i.id, row => coOpenItem(coWorking().items.find(x => x.id === i.id) ?? i, row));
    tb.appendChild(tr);
  }
  document.getElementById('co-items-count').textContent = `— ${shown} / ${items.length}`;
}

async function loadCollections() {
  const { ok, data } = await api('GET', '/api/admin/collections');
  if (!ok) { coNotice(data.error || 'Erreur lors du chargement.', false); return; }
  _co = data;
  const w = coWorking();
  const p = data.published;

  // Sélecteurs
  const seasonOpts = [['', 'Permanente (hors saison)'], ...data.seasons.map(s => [String(s.id), `#${s.id} ${s.name} (${s.status})`])];
  coSelect('co-s-season', seasonOpts);
  coSelect('co-ai-season', seasonOpts);
  coSelect('co-i-series', w.series.map(s => [s.id, `${s.icon} ${s.names.fr}`]));
  coSelect('co-filter-series', w.series.map(s => [s.id, `${s.icon} ${s.names.fr}`]), 1);
  coSelect('co-i-rarity', data.rarities.map(r => [r, BK_RARITY[r] ?? r]));
  const from = document.getElementById('co-i-from');
  if (!from.childElementCount) {
    for (const c of data.categories) {
      const label = document.createElement('label');
      label.className = 'co-inline-check';
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
    tr.children[4].className = 'num';
    admRowOpen(tr, `co-series:${s.id}`, s.names.fr, row => coOpenSeries(coWorking().series.find(x => x.id === s.id) ?? s, row));
    sb.appendChild(tr);
  }
  coRenderItems();

  const d = data.draft;
  document.getElementById('co-draft-state').textContent = d
    ? `Brouillon basé sur v${d.basedOn}, modifié le ${d.updatedAt} UTC.` : 'Aucun brouillon : ajoutez ou modifiez une série ou un objet pour en créer un.';
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
    fig.append(el, cap);
    ib.appendChild(fig);
  }
  if (!data.images.length) ib.textContent = 'Aucune image téléversée.';
  loadCollectionsAudit();
  coAiLoad();
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
document.getElementById('co-filter-state').addEventListener('change', () => { if (_co) coRenderItems(); });
for (const id of ['co-i-icon', 'co-i-image', 'co-i-rarity', 'co-i-series', 'co-preview-lang', ...CO_LANGS.flatMap(l => [`co-i-name-${l}`, `co-i-story-${l}`])]) {
  document.getElementById(id).addEventListener('input', coPreview);
}

// « ＋ Ajouter » : choix IA / manuel (aucune écriture à l'ouverture ni à l'annulation)
admDialogSetup('co-add-dialog');
admDialogSetup('co-ai-dialog');
document.getElementById('btn-co-add').addEventListener('click', e => {
  const ai = document.getElementById('btn-co-add-ai');
  admDialogOpen('co-add-dialog', e.currentTarget, ai.disabled ? 'btn-co-add-series' : ai);
  coAiLoad();
});
document.getElementById('btn-co-add-series').addEventListener('click', () => {
  document.getElementById('co-add-dialog').close();
  coOpenSeries(null, document.getElementById('btn-co-add'));
});
document.getElementById('btn-co-add-item').addEventListener('click', () => {
  document.getElementById('co-add-dialog').close();
  coOpenItem(null, document.getElementById('btn-co-add'));
});
document.getElementById('btn-co-add-ai').addEventListener('click', () => {
  document.getElementById('co-add-dialog').close();
  ptMessage('co-ai-msg', '', true);
  admDialogOpen('co-ai-dialog', document.getElementById('btn-co-add'), 'co-ai-concept');
});

document.getElementById('btn-co-s-save').addEventListener('click', async () => {
  const seasonVal = document.getElementById('co-s-season').value;
  const series = { id: document.getElementById('co-s-id').value.trim(), names: coTexts('co-s-name'),
    seasonId: seasonVal === '' ? null : Number(seasonVal), icon: document.getElementById('co-s-icon').value.trim(),
    active: document.getElementById('co-s-active').checked };
  if (!series.id) { ptMessage('co-s-msg', 'Identifiant requis.', false); return; }
  const { ok, data } = await api('PUT', `/api/admin/collections/draft/series/${encodeURIComponent(series.id)}`, { series });
  if (!ok) { ptMessage('co-s-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('co-series-dialog').close();
  coNotice(`Série « ${data.series.id} » enregistrée dans le brouillon (pas encore visible des joueurs).`);
  loadCollections();
});

document.getElementById('btn-co-s-remove').addEventListener('click', async () => {
  const id = document.getElementById('co-s-id').value.trim();
  if (!id || !confirm(`Retirer la série « ${id} » du brouillon ?`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/collections/draft/series/${encodeURIComponent(id)}`);
  if (!ok) { ptMessage('co-s-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('co-series-dialog').close();
  coNotice(`Série « ${id} » retirée du brouillon.`);
  loadCollections();
});

document.getElementById('btn-co-i-save').addEventListener('click', async () => {
  const item = coReadItem();
  if (!item.id) { ptMessage('co-i-msg', 'Identifiant requis.', false); return; }
  const { ok, data } = await api('PUT', `/api/admin/collections/draft/items/${encodeURIComponent(item.id)}`, { item });
  if (!ok) { ptMessage('co-i-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('co-item-dialog').close();
  coNotice(`« ${data.item.id} » enregistré dans le brouillon (pas encore visible des joueurs).`);
  loadCollections();
});

document.getElementById('btn-co-i-remove').addEventListener('click', async () => {
  const id = document.getElementById('co-i-id').value.trim();
  if (!id || !confirm(`Retirer « ${id} » du brouillon ?`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/collections/draft/items/${encodeURIComponent(id)}`);
  if (!ok) { ptMessage('co-i-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('co-item-dialog').close();
  coNotice(`« ${id} » retiré du brouillon.`);
  loadCollections();
});

document.getElementById('btn-co-i-studio').addEventListener('click', () => {
  const id = document.getElementById('co-i-id').value.trim();
  document.getElementById('co-item-dialog').close();
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  if (id) icOpen(`item:${id}`);
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
  if (ok) loadCollections();
});

// ── Collections : création assistée par IA (#39, 31/10) ───────────────────────
// Une proposition texte (série + objets) en arrière-plan → relecture et corrections → brouillon.
// Jamais publiée automatiquement ; drops inactifs ; images une par une dans l'atelier (#40).

const CO_AI_STATE = { pending: '⏳ génération en cours', open: 'à relire', error: 'échec', in_draft: 'dans le brouillon' };

async function coAiLoad() {
  const { ok, data } = await api('GET', '/api/admin/collections/ai');
  if (!ok) return;
  _coAi = data;
  const st = data.status;
  const aiBtn = document.getElementById('btn-co-add-ai');
  aiBtn.disabled = !st.configured;
  const txt = st.configured
    ? `IA : ${st.textModel}${st.fake ? ' (mode test)' : ''} — budget restant ≈ ${st.remainingUsd.toFixed(2)} / ${st.budgetUsd} USD, texte ≈ ${st.estTextUsd} USD par proposition ; ${st.callsToday}/${st.maxCallsPerDay} appels sur 24 h.`
    : `IA non configurée : ${st.reason}. Création manuelle seulement.`;
  document.getElementById('co-ai-status').textContent = txt;
  document.getElementById('co-ai-status-2').textContent = txt;
  document.getElementById('btn-co-ai-generate').disabled = !st.configured;

  const list = data.proposals;
  const card = document.getElementById('co-ai-card');
  card.classList.toggle('hidden', !list.length);
  const counts = s => list.filter(p => p.status === s).length;
  document.getElementById('co-ai-card-title').textContent = `✨ Propositions IA — ${counts('open')} à relire`
    + (counts('pending') ? `, ${counts('pending')} en cours` : '') + (counts('in_draft') ? `, ${counts('in_draft')} dans le brouillon` : '');
  const tb = document.getElementById('co-ai-body');
  tb.textContent = '';
  for (const p of list) {
    const tr = document.createElement('tr');
    const s = p.data?.series;
    [p.createdAt, p.concept.length > 70 ? `${p.concept.slice(0, 70)}…` : p.concept, s ? `${s.icon} ${s.names.fr || s.id}` : '—',
     p.data ? p.data.items.length : (p.params.itemCount ?? ''), CO_AI_STATE[p.status] ?? p.status].forEach(x => addCell(tr, x));
    tr.children[3].className = 'num';
    admRowOpen(tr, `co-prop:${p.id}`, `Proposition ${p.id}`, row => coPropOpen(p.id, row));
    tb.appendChild(tr);
  }
  // Suivi d'une génération en cours (arrêté dès qu'il n'y en a plus)
  clearTimeout(_coAiTimer);
  if (list.some(p => p.status === 'pending')) _coAiTimer = setTimeout(coAiPoll, 4000);
}

async function coAiPoll() {
  const before = new Set((_coAi?.proposals ?? []).filter(p => p.status === 'pending').map(p => p.id));
  await coAiLoad();
  const dlg = document.getElementById('co-prop-dialog');
  if (dlg.open && _coProp && before.has(_coProp.id)) {
    const p = _coAi.proposals.find(x => x.id === _coProp.id);
    if (p && p.status !== 'pending') coPropRender(p);
  }
}

document.getElementById('btn-co-ai-generate').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const concept = document.getElementById('co-ai-concept').value.trim();
  if (concept.length < 3) { ptMessage('co-ai-msg', 'Décrivez la collection (au moins 3 caractères).', false); return; }
  const season = document.getElementById('co-ai-season').value;
  btn.disabled = true;
  const { ok, data } = await api('POST', '/api/admin/collections/ai/proposals', {
    concept, itemCount: Number(document.getElementById('co-ai-count').value), seasonId: season === '' ? null : Number(season) });
  btn.disabled = false;
  if (!ok) { ptMessage('co-ai-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('co-ai-dialog').close();
  document.getElementById('co-ai-concept').value = '';
  coNotice('✨ Proposition demandée : génération en cours (≈ 30 à 60 s). Elle apparaît dans « ✨ Propositions IA » ; rien n\'est ajouté au brouillon sans votre action.');
  await coAiLoad();
  document.getElementById('co-ai-card').open = true;
  coPropOpen(data.proposal.id, document.getElementById('btn-co-add'));
});

// Fiche de relecture d'une proposition
admDialogSetup('co-prop-dialog');
document.getElementById('co-prop-dialog').addEventListener('close', () => { _coProp = null; });

async function coPropOpen(id, opener) {
  const { ok, data } = await api('GET', `/api/admin/collections/ai/proposals/${id}`);
  if (!ok) { coNotice(data.error || 'Erreur.', false); return; }
  coPropRender(data.proposal);
  admDialogOpen('co-prop-dialog', opener, document.querySelector('#co-prop-dialog [data-close]'));
}

function coField(parent, label, value, { textarea = false, max = 60, cls = '', readOnly = false } = {}) {
  const l = document.createElement('label');
  if (cls) l.className = cls;
  l.append(label);
  const el = document.createElement(textarea ? 'textarea' : 'input');
  if (textarea) el.rows = 3; else el.type = 'text';
  el.maxLength = max;
  el.value = value ?? '';
  el.readOnly = readOnly;
  l.appendChild(el);
  parent.appendChild(l);
  return el;
}

function coGrid(parent) {
  const g = document.createElement('div');
  g.className = 'co-grid';
  parent.appendChild(g);
  return g;
}

function coPropRender(p) {
  _coProp = p;
  const editable = p.status === 'open';
  document.getElementById('co-prop-title').textContent = `✨ Proposition n° ${p.id}`;
  const state = document.getElementById('co-prop-state');
  state.textContent = {
    pending: '⏳ Génération en cours (≈ 30 à 60 s) : vous pouvez fermer cette fiche, la proposition restera dans « ✨ Propositions IA ».',
    open: 'À relire : corrigez ce qui doit l\'être, puis « Enregistrer dans le brouillon ». Rien n\'est publié ; les drops restent inactifs ; aucune image n\'est générée.',
    error: `Échec : ${p.error ?? 'erreur inconnue'}. Aucune donnée n'a été modifiée ; vous pouvez relancer une proposition depuis « ＋ Ajouter ».`,
    in_draft: `Déjà enregistrée dans le brouillon (série « ${p.seriesId} ») : modifiez-la dans les listes Séries et Objets, illustrez chaque objet dans 🎨 Atelier d'icônes, puis publiez.`,
  }[p.status] ?? p.status;
  for (const b of ['btn-co-prop-save', 'btn-co-prop-draft']) document.getElementById(b).classList.toggle('hidden', !editable);
  document.getElementById('btn-co-prop-discard').classList.toggle('hidden', p.status === 'pending' || p.status === 'in_draft');
  admShowError(document.getElementById('co-prop-msg'), '');
  bkFillList(document.getElementById('co-prop-warnings'), p.warnings ?? []);

  const body = document.getElementById('co-prop-body');
  body.textContent = '';
  const concept = document.createElement('p');
  concept.className = 'muted';
  concept.textContent = `Description : ${p.concept}`;
  body.appendChild(concept);
  if (!p.data) return;
  const d = p.data;

  // Série
  const fs = document.createElement('fieldset');
  fs.className = 'co-fs';
  const lg = document.createElement('legend');
  lg.textContent = 'Série';
  fs.appendChild(lg);
  const g = coGrid(fs);
  const ro = { readOnly: !editable };
  const sId = coField(g, 'Identifiant', d.series.id, { max: 40, ...ro });
  sId.dataset.f = 'series.id';
  const sIcon = coField(g, 'Icône', d.series.icon, { max: 8, ...ro });
  sIcon.dataset.f = 'series.icon';
  const sl = document.createElement('label');
  sl.append('Saison');
  const sel = document.getElementById('co-ai-season').cloneNode(true);
  sel.removeAttribute('id');
  sel.value = d.series.seasonId == null ? '' : String(d.series.seasonId);
  sel.disabled = !editable;
  sel.dataset.f = 'series.seasonId';
  sl.appendChild(sel);
  g.appendChild(sl);
  for (const l of CO_LANGS) coField(g, `Nom ${l.toUpperCase()}`, d.series.names[l], ro).dataset.f = `series.names.${l}`;
  if (d.series.theme) { const t = document.createElement('p'); t.className = 'muted'; t.textContent = `Thème : ${d.series.theme}`; fs.appendChild(t); }
  if (d.rationale) { const t = document.createElement('p'); t.className = 'muted'; t.textContent = `Raisonnement : ${d.rationale}`; fs.appendChild(t); }
  body.appendChild(fs);

  // Aperçu : langue commune à toutes les fiches
  const pl = document.createElement('label');
  pl.className = 'co-inline-check';
  pl.append('Aperçu des fiches en ');
  const lang = document.createElement('select');
  lang.id = 'co-prop-lang';
  for (const l of CO_LANGS) { const o = document.createElement('option'); o.value = l; o.textContent = l; lang.appendChild(o); }
  pl.appendChild(lang);
  body.appendChild(pl);

  // Objets
  d.items.forEach((it, k) => {
    const det = document.createElement('details');
    det.className = 'co-prop-item';
    det.dataset.item = String(k);
    det.open = k === 0;
    const sum = document.createElement('summary');
    sum.textContent = `${it.icon} ${it.names.fr || it.id} · ${BK_RARITY[it.rarity] ?? it.rarity}`;
    det.appendChild(sum);
    const wrap = document.createElement('div');
    wrap.className = 'co-prop-wrap';
    const left = document.createElement('div');
    left.className = 'co-prop-fields';
    const gi = coGrid(left);
    coField(gi, 'Identifiant', it.id, { max: 40, ...ro }).dataset.f = 'id';
    const rl = document.createElement('label');
    rl.append('Rareté');
    const rs = document.createElement('select');
    for (const r of _co?.rarities ?? Object.keys(BK_RARITY)) { const o = document.createElement('option'); o.value = r; o.textContent = BK_RARITY[r] ?? r; rs.appendChild(o); }
    rs.value = it.rarity; rs.disabled = !editable; rs.dataset.f = 'rarity';
    rl.appendChild(rs);
    gi.appendChild(rl);
    coField(gi, 'Icône', it.icon, { max: 8, ...ro }).dataset.f = 'icon';
    for (const l of CO_LANGS) coField(gi, `Nom ${l.toUpperCase()}`, it.names[l], ro).dataset.f = `names.${l}`;
    for (const l of CO_LANGS) coField(gi, `Histoire ${l.toUpperCase()}`, it.stories[l], { textarea: true, max: 1200, cls: 'co-span', ...ro }).dataset.f = `stories.${l}`;
    const img = document.createElement('details');
    const is = document.createElement('summary');
    is.textContent = 'Consigne d\'illustration (reprise par l\'atelier, image générée seulement à votre demande)';
    img.appendChild(is);
    const gm = coGrid(img);
    coField(gm, 'Sujet', it.image?.subject, { max: 300, cls: 'co-span', ...ro }).dataset.f = 'image.subject';
    coField(gm, 'Détails', it.image?.details, { max: 600, cls: 'co-span', ...ro }).dataset.f = 'image.details';
    coField(gm, 'Palette', it.image?.palette, { max: 300, cls: 'co-span', ...ro }).dataset.f = 'image.palette';
    left.appendChild(img);
    const dp = document.createElement('p');
    dp.className = 'muted';
    dp.style.fontSize = '0.75rem';
    dp.textContent = `Drop pré-rempli (barème proposé, non validé) : ${it.drop.from.join('/')} dès ${it.drop.minDepth} m · ${+(it.drop.chance * 100).toFixed(3)} % — inactif. Modifiable ensuite dans la fiche de l'objet.`;
    left.appendChild(dp);
    if (editable && d.items.length > 1) {
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'btn btn-ghost'; rm.textContent = 'Retirer cet objet de la proposition';
      rm.addEventListener('click', () => { det.remove(); coPropDirty(); });
      left.appendChild(rm);
    }
    // Aperçu de la fiche joueur
    const prev = document.createElement('div');
    prev.className = 'co-prop-preview';
    const art = document.createElement('div'); art.className = 'co-prop-art';
    const rar = document.createElement('div'); rar.className = 'muted';
    const nm = document.createElement('strong');
    const se = document.createElement('div'); se.className = 'muted'; se.style.fontSize = '0.72rem';
    const sto = document.createElement('p');
    prev.append(art, rar, nm, se, sto);
    const refresh = () => {
      const v = f => det.querySelector(`[data-f="${f}"]`)?.value.trim() ?? '';
      const l = lang.value;
      art.textContent = v('icon') || '❔';
      rar.textContent = BK_RARITY[v('rarity')] ?? '';
      nm.textContent = v(`names.${l}`) || v('names.fr') || '(nom FR obligatoire)';
      const sv = f => body.querySelector(`[data-f="series.${f}"]`)?.value.trim() ?? '';
      se.textContent = `${sv('icon')} ${sv(`names.${l}`) || sv('names.fr')}`;
      sto.textContent = v(`stories.${l}`) || v('stories.fr') || '(pas d\'histoire)';
      sum.textContent = `${v('icon')} ${v('names.fr') || v('id')} · ${BK_RARITY[v('rarity')] ?? v('rarity')}`;
    };
    det._refresh = refresh;
    wrap.append(left, prev);
    det.appendChild(wrap);
    det.addEventListener('input', refresh);
    det.addEventListener('change', refresh);
    body.appendChild(det);
    refresh();
  });
  const all = () => body.querySelectorAll('.co-prop-item').forEach(x => x._refresh());
  lang.addEventListener('change', all);
  fs.addEventListener('input', all);
}

function coPropDirty() { admShowError(document.getElementById('co-prop-msg'), ''); }

/** Lit les corrections de la fiche de relecture. */
function coPropRead() {
  const body = document.getElementById('co-prop-body');
  const val = (root, f) => root.querySelector(`[data-f="${f}"]`)?.value.trim() ?? '';
  const texts = (root, prefix) => Object.fromEntries(CO_LANGS.map(l => [l, val(root, `${prefix}.${l}`)]));
  const season = val(body, 'series.seasonId');
  return {
    series: { id: val(body, 'series.id'), icon: val(body, 'series.icon'), names: texts(body, 'series.names'), seasonId: season === '' ? null : Number(season) },
    items: [...body.querySelectorAll('.co-prop-item')].map(det => {
      const orig = _coProp.data.items[Number(det.dataset.item)];
      return { id: val(det, 'id'), rarity: val(det, 'rarity'), icon: val(det, 'icon'), names: texts(det, 'names'), stories: texts(det, 'stories'),
        image: { subject: val(det, 'image.subject'), details: val(det, 'image.details'), palette: val(det, 'image.palette') },
        // Drop pré-rempli conservé sauf si la rareté change (il suit alors le barème proposé de la nouvelle rareté)
        drop: val(det, 'rarity') === orig.rarity ? orig.drop : null };
    }),
  };
}

async function coPropSave() {
  const { ok, data } = await api('PUT', `/api/admin/collections/ai/proposals/${_coProp.id}`, coPropRead());
  if (!ok) { ptMessage('co-prop-msg', data.error || 'Erreur.', false); return null; }
  return data.proposal;
}

document.getElementById('btn-co-prop-save').addEventListener('click', async () => {
  const p = await coPropSave();
  if (!p) return;
  coPropRender(p);
  ptMessage('co-prop-msg', 'Corrections enregistrées dans la proposition (pas encore dans le brouillon).', true);
  coAiLoad();
});

document.getElementById('btn-co-prop-draft').addEventListener('click', async () => {
  const p = await coPropSave();
  if (!p) return;
  const { ok, data } = await api('POST', `/api/admin/collections/ai/proposals/${p.id}/draft`);
  if (!ok) { coPropRender(p); ptMessage('co-prop-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('co-prop-dialog').close();
  coNotice(`Série « ${data.series.id} » et ${data.items.length} objet(s) enregistrés dans le brouillon, drops inactifs. Illustrez chaque objet (🎨 sur sa fiche, une image à la fois), puis publiez le brouillon.`);
  document.getElementById('co-filter-series').value = '';
  loadCollections();
});

document.getElementById('btn-co-prop-discard').addEventListener('click', async () => {
  if (!_coProp || !confirm('Abandonner cette proposition ? Elle disparaîtra de la liste (le catalogue n\'est pas modifié).')) return;
  const { ok, data } = await api('DELETE', `/api/admin/collections/ai/proposals/${_coProp.id}`);
  if (!ok) { ptMessage('co-prop-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('co-prop-dialog').close();
  coNotice('Proposition abandonnée.');
  coAiLoad();
});


// ── Atelier d'icônes (#40) ────────────────────────────────────────────────────
// Refonte UX du 31/10 : une icône → une fiche → une image par action (« Générer » puis « Refaire »
// avec consigne), « Conserver » dans le brouillon, publication séparée dans Blocs/Collections.
// Plus de lots ni de variantes multiples ; le budget se règle dans ⚙ Config → Budget IA.

let _ic = null;          // vue d'ensemble (GET /api/admin/icons)
let _icOpen = null;      // clé de la fiche ouverte
let _icSel = null;       // proposition affichée dans la fiche (sha)
let _icTarget = null;    // détail de la fiche ouverte
let _icJob = null;       // génération en cours ou dernière terminée
let _icPoll = null;      // minuterie de suivi de la génération
let _icNote = null;      // message de la fiche { text, ok }
const IC_ACTIONS = { generated: 'Image générée', uploaded: 'Image téléversée', chosen: 'Retenue', rejected: 'Écartée', restored: 'Remise en proposition',
  validated: 'Verrouillée (validée)', applied: 'Conservée dans le brouillon', reverted_to_emoji: 'Retour à l\'emoji (brouillon)', brief: 'Description modifiée' };
const IC_BG_RE = /^linear-gradient\(\d+deg,\s*#[0-9a-f]{6},\s*#[0-9a-f]{6}\)$/i;
const icEnc = k => encodeURIComponent(k);

/** État lisible d'une icône : une seule étiquette, du plus fort au plus faible. */
function icState(t) {
  if (t.validated) return { key: 'locked', label: '🔒 Validée', cls: 'ok' };
  if (t.unpublished) return { key: 'draft', label: 'À publier', cls: 'warn' };
  if (t.image) return { key: 'live', label: 'En jeu', cls: 'ok' };
  if (t.candidates) return { key: 'proposal', label: `${t.candidates} proposition${t.candidates > 1 ? 's' : ''}`, cls: 'info' };
  if (t.v1) return { key: 'live', label: `v1 ${t.v1.status}`, cls: 'info' };
  return { key: 'todo', label: 'À créer', cls: 'muted' };
}

function icBadge(st) { return aiEl('span', { class: `ic-badge ic-badge--${st.cls}` }, st.label); }

/** Miniature : image appliquée, sinon v1, sinon emoji ; blocs sur leur fond de jeu. */
function icThumb(t, size, url = null) {
  const box = aiEl('span', { class: 'bk-thumb ic-thumb', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px;border-radius:${Math.round(size / 6)}px` });
  const bg = t.background?.color;
  if (t.kind === 'block' && IC_BG_RE.test(bg ?? '')) box.style.background = bg;
  if (t.kind === 'block' && /^#[0-9a-f]{6}$/i.test(t.background?.accent ?? '')) box.style.borderColor = t.background.accent;
  const src = url ?? t.image ?? t.v1?.url;
  if (src) box.appendChild(aiEl('img', { src, alt: '', style: t.kind === 'block' ? 'width:78%;height:78%' : '' }));
  else { box.textContent = t.emoji || '⬜'; box.classList.add('bk-thumb--emoji'); }
  return box;
}

function icNotice(el, text, cls = '') {
  el.textContent = text ?? '';
  el.className = `ic-notice${cls ? ` ic-notice--${cls}` : ''}`;
  el.classList.toggle('hidden', !text);
}

/** Bandeau de l'atelier : seulement ce qui empêche ou retarde une génération. */
function icRenderNotice() {
  const s = _ic?.status;
  const el = document.getElementById('ic-notice');
  if (_icJob?.status === 'running') return icNotice(el, `⏳ Génération en cours pour « ${_icJob.name} »… (environ une minute)`, 'info');
  if (s && !s.configured) return icNotice(el, 'Génération d\'images indisponible : l\'API n\'est pas configurée sur le serveur. Le téléversement d\'une image reste possible.', 'warn');
  if (s?.budgetReached) return icNotice(el, icBudgetHelp(s), 'warn');
  if (s?.fake) return icNotice(el, 'Mode test : aucune image réelle n\'est générée.', 'info');
  icNotice(el, '');
}

function icBudgetHelp(s) {
  return s.limitedBy === 'studio'
    ? `Budget IA atteint (limite de l'atelier : ${s.studioSpentUsd.toFixed(2)} / ${s.studioCapUsd} USD). Pour continuer, relevez cette limite dans ⚙ Config → Budget IA.`
    : `Budget IA atteint (${s.globalSpentUsd.toFixed(2)} / ${s.globalCapUsd} USD). Pour continuer, relevez le plafond du serveur : DIG_IMAGE_BUDGET_USD dans ~/.config/dig/openai.env (voir ⚙ Config → Budget IA).`;
}

async function loadIcons() {
  const { ok, data } = await api('GET', '/api/admin/icons');
  if (!ok) { icNotice(document.getElementById('ic-notice'), data.error || 'Erreur.', 'error'); return; }
  _ic = data;
  icSetJob(data.job);
  icRenderGrid();
  const s = data.status;
  document.getElementById('ic-tech').textContent = s.configured
    ? `Modèle ${s.imageModel}${s.fake ? ' (mode test)' : ''} · ≈ ${s.estImageUsd} USD par image · ${s.imagesToday}/${s.maxImagesPerDay} images sur 24 h · référence de style : ${s.reference ?? 'aucune'}.`
    : `API non configurée : ${s.reason}.`;
  const cb = document.getElementById('ic-calls-body');
  cb.textContent = '';
  for (const c of data.calls) {
    const tr = document.createElement('tr');
    [c.created_at, c.target, c.model, c.ok ? 'OK' : `Échec : ${c.error ?? ''}`, `${c.cost_usd} USD`,
     c.duration_ms != null ? `${(c.duration_ms / 1000).toFixed(1)} s` : ''].forEach(v => addCell(tr, v));
    cb.appendChild(tr);
  }
  if (_icOpen) icOpen(_icOpen, { keepSel: true });
}

function icFiltered() {
  const kind = document.getElementById('ic-kind').value;
  const state = document.getElementById('ic-state').value;
  const q = document.getElementById('ic-search').value.trim().toLowerCase();
  return (_ic?.targets ?? []).filter(t => (!kind || t.kind === kind) && (!state || icState(t).key === state)
    && (!q || `${t.name} ${t.id}`.toLowerCase().includes(q)));
}

function icRenderGrid() {
  const grid = document.getElementById('ic-grid');
  grid.textContent = '';
  const list = icFiltered();
  document.getElementById('ic-count').textContent = `${list.length} icône${list.length > 1 ? 's' : ''}`;
  for (const t of list) {
    const card = aiEl('button', { type: 'button', class: 'ic-card', 'aria-label': `Ouvrir la fiche ${t.name}` });
    card.appendChild(icThumb(t, 72));
    card.appendChild(aiEl('span', { class: 'ic-card-name' }, t.name));
    card.appendChild(aiEl('span', { class: 'ic-card-kind' }, t.kindLabel));
    card.appendChild(icBadge(icState(t)));
    // Survol : aperçu agrandi (appareils à pointeur seulement, voir CSS)
    const zoom = aiEl('span', { class: 'ic-zoom', 'aria-hidden': 'true' });
    zoom.appendChild(icThumb(t, 192));
    card.appendChild(zoom);
    card.addEventListener('click', () => icOpen(t.key));
    grid.appendChild(card);
  }
  if (!list.length) grid.appendChild(aiEl('p', { class: 'muted' }, 'Aucune icône ne correspond à cette recherche.'));
}

function icShowList() {
  _icOpen = null; _icSel = null; _icTarget = null; _icNote = null;
  document.getElementById('ic-sheet').classList.add('hidden');
  document.getElementById('ic-list-view').classList.remove('hidden');
  icRenderGrid();
}

// ── Suivi de la génération (≈ 1 min, en arrière-plan côté serveur) ──

function icSetJob(job) {
  const was = _icJob?.status === 'running' ? _icJob : null;
  _icJob = job;
  clearTimeout(_icPoll);
  if (job?.status === 'running') {
    _icPoll = setTimeout(async () => {
      const { ok, data } = await api('GET', '/api/admin/icons/job');
      if (ok) { if (_ic) _ic.status = data.status; icSetJob(data.job); }
      else _icPoll = setTimeout(() => icSetJob(_icJob), 5000);
    }, 3000);
  } else if (was && job && job.id === was.id) {
    // Génération terminée : la fiche concernée affiche le résultat (ou l'échec)
    if (_icOpen === job.target) {
      _icNote = job.status === 'done' ? { text: 'Nouvelle proposition prête.', ok: true } : { text: job.error || 'La génération a échoué.', ok: false };
      if (job.result) _icSel = job.result.sha;
    }
    loadIcons();
    return;
  }
  icRenderNotice();
  if (_icTarget) icRenderSheet();
}

async function icGenerate(instruction, basedOn) {
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(_icOpen)}/generate`, { instruction, basedOn });
  if (!ok) { _icNote = { text: data.error || 'Erreur.', ok: false }; icRenderSheet(); return; }
  _icNote = null;
  const field = document.getElementById('ic-instruction');
  if (field) field.value = '';   // consigne envoyée : le champ repart vide pour la prochaine
  icSetJob(data.job);
}

// ── Fiche d'une icône ──

async function icOpen(key, { keepSel = false } = {}) {
  if (_icOpen !== key) { _icSel = null; _icNote = null; }
  _icOpen = key;
  document.getElementById('ic-list-view').classList.add('hidden');
  const box = document.getElementById('ic-sheet');
  box.classList.remove('hidden');
  const { ok, data } = await api('GET', `/api/admin/icons/targets/${icEnc(key)}`);
  if (_icOpen !== key) return;
  if (!ok) { box.textContent = ''; box.appendChild(aiEl('p', { class: 'error' }, data.error || 'Erreur.')); return; }
  _icTarget = data.target;
  const visible = _icTarget.assets.filter(a => a.status !== 'rejected');
  if (!keepSel || !_icTarget.assets.some(a => a.sha === _icSel)) _icSel = (visible[0] ?? _icTarget.assets[0])?.sha ?? null;
  icRenderSheet();
}

function icButton(parent, label, fn, cls = 'btn btn-outline') {
  const b = aiEl('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } });
  parent.appendChild(b);
  return b;
}

function icRenderSheet() {
  const t = _icTarget;
  const box = document.getElementById('ic-sheet');
  const typed = box.querySelector('#ic-instruction')?.value ?? '';
  box.textContent = '';
  const st = icState(t);
  const running = _icJob?.status === 'running';
  const mine = running && _icJob.target === t.key;
  const canGenerate = !!_ic?.status?.configured && !_ic?.status?.budgetReached && !running;
  const sel = t.assets.find(a => a.sha === _icSel) ?? null;

  // En-tête : retour, nom, état
  const head = aiEl('div', { class: 'ic-sheet-head' });
  icButton(head, '← Toutes les icônes', async () => icShowList());
  const title = aiEl('div', { class: 'ic-sheet-title' });
  title.appendChild(aiEl('h3', {}, t.name));
  title.appendChild(icBadge(st));
  head.appendChild(title);
  head.appendChild(aiEl('p', { class: 'muted ic-sheet-sub' }, `${t.kindLabel}${t.extra ? ` · ${t.extra}` : ''}`));
  box.appendChild(head);
  if (t.validated) box.appendChild(aiEl('p', { class: 'ic-notice ic-notice--info' }, '🔒 Icône validée : elle ne sera remplacée qu\'avec votre accord explicite.'));
  if (!t.applicable) box.appendChild(aiEl('p', { class: 'ic-notice ic-notice--info' }, 'Pictogramme d\'interface : les images sont conservées ici ; leur mise en place dans le jeu viendra avec le logo et la navigation (#41).'));

  // Comparaison : icône actuelle ↔ proposition affichée
  const cmp = aiEl('div', { class: 'ic-compare' });
  const fig = (node, caption) => {
    const f = aiEl('figure', { class: 'ic-fig' });
    f.appendChild(node);
    f.appendChild(aiEl('figcaption', {}, caption));
    cmp.appendChild(f);
    return f;
  };
  fig(icThumb(t, 160), t.applicable ? (t.unpublished ? 'Actuelle (brouillon, pas encore en jeu)' : 'Actuelle en jeu') : 'Actuelle');
  if (mine) {
    const wait = aiEl('span', { class: 'bk-thumb ic-thumb ic-wait', style: 'width:160px;height:160px;border-radius:26px' });
    wait.appendChild(aiEl('span', { class: 'ic-spinner', 'aria-hidden': 'true' }));
    fig(wait, 'Génération en cours… (environ une minute)');
  } else if (sel) {
    const where = sel.published ? 'en jeu' : sel.inDraft ? 'dans le brouillon' : sel.status === 'rejected' ? 'écartée' : 'proposition';
    const f = fig(icThumb(t, 160, sel.url), `${sel.source === 'ai' ? 'Proposition' : 'Image téléversée'} du ${sel.createdAt.slice(0, 16).replace('T', ' ')} — ${where}`);
    if (sel.instruction) f.appendChild(aiEl('p', { class: 'muted ic-fig-note' }, `Consigne : « ${sel.instruction} »`));
  } else {
    const empty = aiEl('span', { class: 'bk-thumb ic-thumb bk-thumb--none', style: 'width:160px;height:160px;border-radius:26px;font-size:2.2rem' }, '＋');
    fig(empty, 'Aucune proposition pour l\'instant');
  }
  box.appendChild(cmp);

  // Étape en cours : une seule action principale
  const step = aiEl('div', { class: 'ic-step' });
  const note = aiEl('p', { class: _icNote ? (_icNote.ok ? 'success' : 'error') : 'form-msg', role: 'status' }, _icNote?.text ?? '');
  const field = (label, placeholder) => {
    const l = aiEl('label', { class: 'ic-field' }, label);
    const i = aiEl('input', { type: 'text', id: 'ic-instruction', maxlength: '300', placeholder });
    i.value = typed;
    l.appendChild(i);
    step.appendChild(l);
    return i;
  };
  const why = running && !mine ? `Une autre icône est en cours de génération (« ${_icJob.name} »).`
    : !_ic?.status?.configured ? 'Génération indisponible (API non configurée) : utilisez « Téléverser une image » dans les options.'
    : _ic?.status?.budgetReached ? icBudgetHelp(_ic.status) : '';
  if (!sel || mine) {
    const i = field('Consigne (facultative)', 'ex. minerai bleu vif aux reflets métalliques');
    const g = icButton(step, '✨ Générer une image', () => icGenerate(i.value, null), 'btn ic-main');
    g.disabled = !canGenerate;
  } else {
    const row = aiEl('div', { class: 'form-actions' });
    if (t.applicable && !sel.inDraft) {
      icButton(row, '✓ Conserver cette image', () => icApply(t, sel.sha), 'btn ic-main');
    } else if (t.applicable && sel.inDraft) {
      row.appendChild(aiEl('span', { class: 'ic-kept' }, sel.published ? '✓ Cette image est en jeu.' : '✓ Conservée dans le brouillon.'));
      if (!sel.published) icButton(row, `Publier dans ${t.kind === 'block' ? '🧱 Blocs' : '📿 Collections'} →`, async () => {
        document.querySelector(`.tab-btn[data-tab="${t.kind === 'block' ? 'blocks' : 'collections'}"]`).click();
      }, 'btn ic-main');
    }
    step.appendChild(row);
    const redo = aiEl('div', { class: 'ic-redo' });
    const i = field('Refaire : que faut-il changer ?', 'ex. plus sombre, forme plus irrégulière');
    redo.appendChild(i.parentElement);
    const r = icButton(redo, '↻ Refaire', () => icGenerate(i.value, sel.sha));
    r.disabled = !canGenerate;
    step.appendChild(redo);
  }
  if (why && !mine) step.appendChild(aiEl('p', { class: 'muted ic-why' }, why));
  step.appendChild(note);
  box.appendChild(step);

  // Propositions précédentes : comparer et revenir à l'une d'elles
  if (t.assets.length) {
    const strip = aiEl('div', { class: 'ic-strip-wrap' });
    strip.appendChild(aiEl('h4', {}, `Propositions (${t.assets.length})`));
    const row = aiEl('div', { class: 'ic-strip' });
    for (const a of t.assets) {
      const b = aiEl('button', { type: 'button', class: `ic-strip-item${a.sha === _icSel ? ' is-sel' : ''}${a.status === 'rejected' ? ' is-rejected' : ''}`,
        'aria-pressed': String(a.sha === _icSel), title: a.instruction ? `Consigne : ${a.instruction}` : '' });
      b.appendChild(icThumb(t, 64, a.url));
      b.appendChild(aiEl('span', {}, a.published ? 'En jeu' : a.inDraft ? 'Brouillon' : a.status === 'rejected' ? 'Écartée' : a.createdAt.slice(5, 16).replace('T', ' ')));
      b.addEventListener('click', () => { _icSel = a.sha; _icNote = null; icRenderSheet(); });
      row.appendChild(b);
    }
    strip.appendChild(row);
    box.appendChild(strip);
  }

  // Aperçu en jeu, taille réelle
  if (sel) {
    const prev = aiEl('details', { class: 'ic-more' });
    prev.appendChild(aiEl('summary', {}, 'Aperçu en jeu (taille réelle smartphone)'));
    const wrap = aiEl('div', { class: 'ic-preview' });
    wrap.appendChild(icMobilePreview(t, sel.url));
    const sizes = aiEl('div', { class: 'ic-sizes' });
    for (const px of [24, 36, 64, 128]) {
      const s = aiEl('div', {});
      s.appendChild(aiEl('img', { src: sel.url, alt: '', width: String(px), height: String(px) }));
      s.appendChild(aiEl('span', {}, `${px} px`));
      sizes.appendChild(s);
    }
    wrap.appendChild(sizes);
    prev.appendChild(wrap);
    box.appendChild(prev);
  }

  box.appendChild(icOptions(t, sel));
  box.appendChild(icHistory(t));
}

/** Actions secondaires, repliées : téléversement, description, verrou, écarter, retour à l'emoji. */
function icOptions(t, sel) {
  const more = aiEl('details', { class: 'ic-more' });
  more.appendChild(aiEl('summary', {}, 'Plus d\'options'));
  const say = (text, ok) => { _icNote = { text, ok }; };
  const acts = aiEl('div', { class: 'form-actions' });
  const up = aiEl('label', { class: 'btn btn-outline' }, '⬆ Téléverser une image');
  const file = aiEl('input', { type: 'file', accept: 'image/png,image/webp', class: 'visually-hidden' });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { say('Image trop lourde (4 Mo maximum).', false); icRenderSheet(); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(t.key)}/upload`, { data: reader.result });
      say(ok ? 'Image acceptée : elle apparaît dans les propositions.' : [data.error, ...(data.details ?? [])].join(' '), ok);
      if (ok) { _icSel = data.sha; icOpen(t.key, { keepSel: true }); loadIconsQuiet(); } else icRenderSheet();
    };
    reader.readAsDataURL(f);
  });
  up.appendChild(file);
  acts.appendChild(up);
  if (sel && sel.status !== 'validated') icButton(acts, '🔒 Verrouiller cette image (validée)', async () => {
    if (!confirm('Verrouiller cette image comme VALIDÉE ? Elle ne pourra ensuite être remplacée qu\'avec votre accord explicite.')) return;
    await icMark(t, sel.sha, 'validated', 'Image verrouillée.');
  });
  if (sel && sel.status !== 'rejected' && !sel.inDraft) icButton(acts, 'Écarter cette proposition', () => icMark(t, sel.sha, 'rejected', 'Proposition écartée (conservée dans l\'historique).'));
  if (sel && sel.status === 'rejected') icButton(acts, 'Remettre en proposition', () => icMark(t, sel.sha, 'candidate', 'Proposition rétablie.'));
  if (t.applicable && t.image) icButton(acts, 'Revenir à l\'emoji d\'origine', () => icApply(t, null));
  if (t.key === 'ui:logo' && sel) acts.appendChild(aiEl('a', { class: 'btn btn-outline', href: `/?logo=media:${sel.sha}`, target: '_blank', rel: 'noopener' }, 'Voir dans le vrai en-tête ↗'));
  more.appendChild(acts);

  // Description de base de l'icône (anglais conseillé) — utilisée à chaque génération
  const brief = aiEl('div', { class: 'ic-brief' });
  brief.appendChild(aiEl('h4', {}, `Description de l'icône${t.brief.custom ? ' (personnalisée)' : ''}`));
  const [l1, subj] = aiInput('Sujet', t.brief.subject, { maxlength: '300' });
  const [l2, det] = aiInput('Forme et matière', t.brief.details, { maxlength: '600' });
  const [l3, pal] = aiInput('Couleurs', t.brief.palette, { maxlength: '300' });
  [l1, l2, l3].forEach(l => { l.classList.add('ic-field'); brief.appendChild(l); });
  const ba = aiEl('div', { class: 'form-actions' });
  icButton(ba, 'Enregistrer la description', async () => {
    const { ok, data } = await api('PUT', `/api/admin/icons/targets/${icEnc(t.key)}/brief`, { subject: subj.value, details: det.value, palette: pal.value });
    say(ok ? 'Description enregistrée.' : (data.error || 'Erreur.'), ok);
    if (ok) icOpen(t.key, { keepSel: true }); else icRenderSheet();
  });
  if (t.brief.custom) icButton(ba, 'Description par défaut', async () => {
    const { ok, data } = await api('PUT', `/api/admin/icons/targets/${icEnc(t.key)}/brief`, { reset: true });
    say(ok ? 'Description par défaut rétablie.' : (data.error || 'Erreur.'), ok);
    if (ok) icOpen(t.key, { keepSel: true }); else icRenderSheet();
  });
  brief.appendChild(ba);
  const pr = aiEl('details');
  pr.appendChild(aiEl('summary', { class: 'muted' }, 'Texte complet envoyé à l\'IA'));
  pr.appendChild(aiEl('p', { class: 'muted ic-prompt' }, t.prompt));
  brief.appendChild(pr);
  more.appendChild(brief);
  return more;
}

function icHistory(t) {
  const hist = aiEl('details', { class: 'ic-more' });
  hist.appendChild(aiEl('summary', {}, `Historique (${t.history.length})`));
  if (t.costUsd) hist.appendChild(aiEl('p', { class: 'muted' }, `Dépensé pour cette icône : ${t.costUsd} USD (${t.calls} appel${t.calls > 1 ? 's' : ''}).`));
  const wrap = aiEl('div', { class: 'bk-table-wrap' });
  const tbl = aiEl('table');
  const hb = aiEl('tbody');
  for (const h of t.history) {
    const tr = document.createElement('tr');
    addCell(tr, h.at);
    addCell(tr, `${IC_ACTIONS[h.action] ?? h.action}${h.details?.instruction ? ` — « ${h.details.instruction} »` : ''}`);
    const ti = document.createElement('td');
    if (h.url) ti.appendChild(aiEl('img', { src: h.url, alt: '', width: '32', height: '32' }));
    tr.appendChild(ti);
    if (t.applicable && h.action === 'applied' && h.details?.before !== undefined) {
      addButtonCell(tr, 'Revenir à l\'icône d\'avant', () => {
        const prev = /\/media\/icons\/([a-f0-9]{16})\.webp$/.exec(h.details.before ?? '');
        if (h.details.before && !prev) { _icNote = { text: `L'icône d'avant (${h.details.before}) ne vient pas de l'atelier : restaurez-la par « Revenir à vN » dans le catalogue.`, ok: false }; icRenderSheet(); return; }
        icApply(t, prev ? prev[1] : null);
      });
    } else addCell(tr, '');
    hb.appendChild(tr);
  }
  tbl.appendChild(hb);
  wrap.appendChild(tbl);
  hist.appendChild(wrap);
  return hist;
}

async function icMark(t, sha, status, text) {
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(t.key)}/mark`, { sha, status });
  _icNote = { text: ok ? text : (data.error || 'Erreur.'), ok };
  if (ok) { await icOpen(t.key, { keepSel: true }); loadIconsQuiet(); } else icRenderSheet();
}

/** « Conserver » : écrit dans le BROUILLON du catalogue (jamais publié ici). */
async function icApply(t, sha) {
  let override = false;
  if (t.validated) {
    if (!confirm(`L'icône de « ${t.name} » est VALIDÉE. La remplacer quand même (accord explicite, tracé) ?`)) return;
    override = true;
  }
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(t.key)}/apply`, { sha, override });
  const where = data.catalog === 'blocks' ? '🧱 Blocs' : '📿 Collections';
  _icNote = { text: ok ? `${sha ? 'Image conservée' : 'Emoji d\'origine rétabli'} dans le brouillon. Les joueurs la verront après la publication dans l'onglet ${where}.` : (data.error || 'Erreur.'), ok };
  if (ok) { await icOpen(t.key, { keepSel: true }); loadIconsQuiet(); } else icRenderSheet();
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

async function loadIconsQuiet() {
  const { ok, data } = await api('GET', '/api/admin/icons');
  if (!ok) return;
  _ic = data;
  if (!_icOpen) icRenderGrid();
}

['ic-kind', 'ic-state'].forEach(id => document.getElementById(id).addEventListener('change', icRenderGrid));
document.getElementById('ic-search').addEventListener('input', icRenderGrid);
document.getElementById('btn-refresh-icons').addEventListener('click', loadIcons);
// Entrée dans le champ de consigne = action principale de l'étape
document.getElementById('ic-sheet').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.id !== 'ic-instruction') return;
  e.preventDefault();
  e.target.closest('.ic-step')?.querySelector('.ic-redo .btn, .ic-main')?.click();
});

// ── Budget IA (⚙ Config) : consommé, plafond du serveur, limite facultative de l'atelier ──

async function loadAiBudget() {
  const { ok, data } = await api('GET', '/api/admin/icons/job');
  const sum = document.getElementById('aib-summary');
  if (!ok) { sum.textContent = data.error || 'Erreur.'; return; }
  const s = data.status;
  const reached = document.getElementById('aib-reached');
  const input = document.getElementById('ic-budget');
  if (document.activeElement !== input) input.value = s.studioCapUsd ?? '';
  if (!s.configured) {
    sum.textContent = 'API d\'images non configurée sur le serveur : aucune dépense possible.';
    document.getElementById('aib-meter').style.width = '0';
    icNotice(reached, '');
    return;
  }
  const usd = v => `${Number(v).toFixed(2)} USD`;
  sum.textContent = `Dépensé : ${usd(s.globalSpentUsd)} sur ${usd(s.globalCapUsd)} (plafond du serveur)`
    + (s.studioCapUsd != null ? ` · atelier d'icônes : ${usd(s.studioSpentUsd)} sur ${usd(s.studioCapUsd)}` : '')
    + ` · reste ${usd(s.remainingUsd)}, soit environ ${Math.floor(s.remainingUsd / s.estImageUsd + 1e-9)} image(s).`;
  document.getElementById('aib-meter').style.width = `${Math.min(100, s.globalCapUsd ? (s.globalSpentUsd / s.globalCapUsd) * 100 : 100)}%`;
  icNotice(reached, s.budgetReached ? icBudgetHelp(s) : '', 'warn');
}

document.getElementById('btn-ic-budget').addEventListener('click', async () => {
  const v = document.getElementById('ic-budget').value.trim();
  const { ok, data } = await api('PUT', '/api/admin/icons/budget', { studioBudgetUsd: v === '' ? null : Number(v) });
  ptMessage('aib-msg', ok ? 'Limite enregistrée.' : (data.error || 'Erreur.'), ok);
  if (ok) loadAiBudget();
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
