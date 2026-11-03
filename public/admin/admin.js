/**
 * admin.js — Panel admin DIG!
 * Auth (#57, recette du 03/11) : la clé admin saisie est envoyée UNE fois (POST /api/admin/session)
 * puis oubliée ; le serveur pose un cookie de session admin HttpOnly à durée limitée, qui survit au
 * rechargement (F5). La clé n'est jamais gardée (ni variable, ni localStorage/sessionStorage, ni URL).
 */

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

/**
 * Confirmation stylée Dig (recette #50-E du 03/11) — remplace window.confirm() : <dialog> natif empilé au-dessus
 * des fiches, focus initial sur Annuler, Échap / fond / Annuler = refus, focus rendu à l'élément d'origine.
 * `impact` : lignes expliquant l'effet (réversible ou non, visible des joueurs…). Rend une promesse booléenne.
 */
function admConfirm({ title, text = '', impact = [], ok = 'Confirmer', cancel = 'Annuler', danger = false }) {
  let dlg = document.getElementById('adm-confirm');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'adm-confirm';
    dlg.className = 'bk-dialog adm-dialog adm-dialog--narrow adm-confirm';
    dlg.setAttribute('aria-labelledby', 'adm-confirm-title');
    dlg.setAttribute('aria-describedby', 'adm-confirm-text');
    const h = document.createElement('h3');
    h.className = 'overview-card-title';
    h.id = 'adm-confirm-title';
    const p = document.createElement('p');
    p.id = 'adm-confirm-text';
    const ul = document.createElement('ul');
    ul.id = 'adm-confirm-impact';
    ul.className = 'adm-confirm-impact';
    const act = document.createElement('div');
    act.className = 'form-actions';
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'btn btn-outline'; no.id = 'adm-confirm-no';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.id = 'adm-confirm-yes';
    act.append(no, yes);
    dlg.append(h, p, ul, act);
    document.body.appendChild(dlg);
    no.addEventListener('click', () => dlg.close('no'));
    yes.addEventListener('click', () => dlg.close('yes'));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close('no'); });
  }
  if (dlg.open) return Promise.resolve(false); // jamais deux confirmations à la fois (double clic)
  const opener = document.activeElement;
  dlg.querySelector('#adm-confirm-title').textContent = title;
  dlg.querySelector('#adm-confirm-text').textContent = text;
  const ul = dlg.querySelector('#adm-confirm-impact');
  ul.textContent = '';
  for (const line of impact) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
  ul.classList.toggle('hidden', !impact.length);
  dlg.querySelector('#adm-confirm-no').textContent = cancel;
  const yes = dlg.querySelector('#adm-confirm-yes');
  yes.textContent = ok;
  yes.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  dlg.returnValue = '';
  dlg.showModal();
  dlg.querySelector('#adm-confirm-no').focus();
  return new Promise(resolve => {
    dlg.addEventListener('close', () => {
      if (opener && document.contains(opener)) opener.focus();
      resolve(dlg.returnValue === 'yes');
    }, { once: true });
  });
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

// Dates des saisons : stockées en UTC (« YYYY-MM-DD HH:MM:SS »), affichées en heure de Bruxelles (#48).
const _admBxl = new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function admBrussels(utc) {
  if (!utc) return '—';
  const d = new Date(String(utc).replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(utc) : _admBxl.format(d);
}

/** Cellule de date : heure de Bruxelles, UTC du serveur en petit dessous. */
function addDateCell(tr, utc) {
  const td = addCell(tr, admBrussels(utc));
  td.title = `${utc ?? ''} UTC`;
  if (utc) td.appendChild(Object.assign(document.createElement('span'), { className: 'season-utc', textContent: `${utc} UTC` }));
  return td;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

// Version du panel chargée dans cet onglet (injectée par le serveur) : envoyée avec chaque demande pour
// qu'un onglet ouvert avant un déploiement ne lance pas de génération avec l'ancien code (#40, 02/11).
const ADMIN_BUILD = window.APP_VERSION ?? '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dig-Admin': '1', 'X-Dig-Admin-Build': ADMIN_BUILD },
    credentials: 'same-origin',
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: `Réponse inattendue du serveur (${res.status}).` }));
  if (res.status === 401 && data.code === 'admin_auth') adminSessionLost();
  return { ok: res.ok, data, status: res.status };
}

function adminShowApp(info) {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
  adminSessionInfo(info);
}

function adminShowLogin(message) {
  document.getElementById('admin-app').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  const err = document.getElementById('auth-error');
  err.textContent = message || '';
  err.classList.toggle('hidden', !message);
  document.getElementById('secret-input').focus();
}

function adminSessionInfo(info) {
  const el = document.getElementById('admin-session-info');
  if (!info?.idleMinutes) { el.textContent = ''; return; }
  el.textContent = `Session admin : fermée après ${Math.round(info.idleMinutes / 60)} h sans activité (12 h au plus)`;
}

// Session expirée ou révoquée pendant l'utilisation : retour à l'écran de connexion, une seule fois.
let _adminLostShown = false;
function adminSessionLost() {
  if (_adminLostShown || document.getElementById('admin-app').classList.contains('hidden')) return;
  _adminLostShown = true;
  adminShowLogin('Session admin expirée ou fermée : saisissez à nouveau la clé.');
}

async function adminLogin() {
  const input = document.getElementById('secret-input');
  const val = input.value.trim();
  if (!val) return;
  const btn = document.getElementById('secret-btn');
  btn.disabled = true;
  let res, data;
  try {
    res  = await fetch('/api/admin/session', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Authorization': `Bearer ${val}`, 'X-Dig-Admin-Build': ADMIN_BUILD },
    });
    data = await res.json().catch(() => ({}));
  } catch { res = null; data = {}; }
  btn.disabled = false;
  input.value = '';   // la clé n'est conservée nulle part
  if (res?.ok) {
    _adminLostShown = false;
    adminShowApp(data);
    loadAll();
  } else {
    adminShowLogin(res?.status === 429 ? (data.error || 'Trop de tentatives.') : res ? 'Clé incorrecte.' : 'Serveur inaccessible.');
  }
}

document.getElementById('secret-btn').addEventListener('click', adminLogin);

document.getElementById('secret-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') adminLogin();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await fetch('/api/admin/session', { method: 'DELETE', credentials: 'same-origin' }); } catch { /* hors ligne : le cookie expirera seul */ }
  adminShowLogin('Déconnecté.');
});

document.getElementById('logout-all-btn').addEventListener('click', async () => {
  if (!confirm('Fermer TOUTES les sessions admin (ce navigateur et tous les autres appareils) ?')) return;
  const { ok, data } = await api('POST', '/api/admin/session/revoke-all');
  if (!ok) return alert(data.error || 'Erreur.');
  adminShowLogin(`Toutes les sessions admin ont été fermées (${data.revoked}).`);
});

// Au chargement (F5) : reprise de la session admin si elle est encore valable.
(async () => {
  try {
    const res = await fetch('/api/admin/session', { headers: { 'X-Dig-Admin': '1' }, credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) { adminShowApp(await res.json()); loadAll(); return; }
  } catch { /* serveur inaccessible : écran de connexion */ }
  adminShowLogin('');
})();

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
    if (btn.dataset.tab === 'beta')            loadBeta();
    if (btn.dataset.tab === 'news')            loadNews();
    if (btn.dataset.tab === 'events')          loadEvents();
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
  if (!data.seasons.length) { tbody.innerHTML = '<tr><td colspan="7" class="muted">Aucune saison.</td></tr>'; return; }

  data.seasons.forEach(s => {
    if (s.status === 'active') { _currentSeasonId = s.id; document.getElementById('lb-season-name').textContent = s.name; }
    const tr = document.createElement('tr');
    [s.id, s.name].forEach(v => addCell(tr, v));
    addCell(tr, s.theme ? `${s.theme.icon ?? ''} ${s.theme.name ?? ''}`.trim() : '—').className = 'season-theme-cell';
    addDateCell(tr, s.start_at);
    addDateCell(tr, s.end_at);
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
    for (const [k, v] of [['Nom', s.name], ['Thème', s.theme ? `${s.theme.icon ?? ''} ${s.theme.name ?? ''}`.trim() : null],
      ['Début (Bruxelles)', admBrussels(s.start_at)], ['Fin (Bruxelles)', admBrussels(s.end_at)],
      ['Début (UTC)', s.start_at], ['Fin (UTC)', s.end_at], ['Statut', s.status]]) {
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
  min_active_players_per_league:'Joueurs actifs min dans une ligue pour qu\'il y ait des promus',
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
  loadSeasonThemes();   // thème actuel / suivant (#48), indépendant du résumé
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
  for (const [id, utc] of [['ov-season-start', season.start_at], ['ov-season-end', season.end_at]]) {
    const el = document.getElementById(id);
    el.textContent = admBrussels(utc);
    el.title = `${utc} UTC`;
  }
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
    + `Contrôle du registre : ${v.ok ? 'OK' : `ÉCART (${v.mismatches.length} portefeuille(s), ${v.orphanUsers} orphelin(s))`}. `
    + (data.audit ? `Contrôle des clôtures (classement figé ↔ attributions ↔ registre) : ${data.audit.ok
      ? `OK (${data.audit.checked} saison(s))`
      : `ÉCART — ${data.audit.problems.map(p => `saison ${p.seasonId} : ${p.problems.join(', ')}`).join(' ; ')}`}.` : '');

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

const SH_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)

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

const BK_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)

function bkFillForm(t) {
  document.getElementById('bk-form-title').textContent = t ? `Modifier « ${t.id} »` : 'Nouveau bloc';
  const idEl = document.getElementById('bk-id');
  idEl.value = t ? t.id : '';
  idEl.readOnly = !!t;
  for (const l of BK_LANGS) document.getElementById(`bk-name-${l}`).value = t?.names?.[l] ?? '';
  for (const l of BK_LANGS) {
    const b = t ? bkBuiltInName(t.id, l) : null;
    document.getElementById(`bk-name-${l}`).placeholder = b ? `${b} (traduction intégrée)` : '';
  }
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
  bkFillSheet(t);
  bkPreview();
  bkNamesSources();
  bkEffective();
  document.getElementById('bk-translate-msg').textContent = '';
  for (const l of BK_LANGS) document.getElementById(`bk-name-${l}`).classList.remove('bk-ai-filled');
  _bkSnapshot = JSON.stringify(bkReadForm());
  bkDirtyUpdate();
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

/** Résumé, état dans le brouillon et illustration en tête de fiche (t = null : nouveau bloc). */
function bkFillSheet(t) {
  const sum = document.getElementById('bk-sheet-summary');
  const art = document.getElementById('bk-sheet-art');
  bkFillDraftState(t);
  if (!t) { sum.textContent = 'Nouveau bloc : il sera ajouté au brouillon, invisible des joueurs jusqu\'à la publication.'; art.classList.add('hidden'); return; }
  const changed = (_bk.draft?.changes ?? []).some(c => c.id === t.id);
  sum.textContent = `${bkNameFr(t) ?? t.id} · ${BK_RARITY[t.rarity] ?? t.rarity} · ${t.category} · dès ${t.minDepth} m`
    + ` · ${t.active ? 'actif' : 'désactivé'}${changed ? ' · modifié dans le brouillon' : ''}${_bk.publishedIds.includes(t.id) ? '' : ' · nouveau (jamais publié)'}`;
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


// ── Fiche : état dans le brouillon, traductions, probabilités effectives, aide (recette du 02/11) ──

const BK_FIELD_LABELS = { names: 'Noms', category: 'Catégorie', rarity: 'Rareté', icon: 'Emoji de secours', image: 'Image personnalisée',
  color: 'Couleur', accent: 'Accent', hpBase: 'PV de base', reward: 'Récompense de base', minDepth: 'Profondeur minimale',
  maxDepth: 'Profondeur maximale', weight: 'Poids', fadeFrom: 'Atténué au-delà de', fadeWeight: 'Poids atténué',
  gemReward: 'Rapporte une gemme', active: 'Actif' };

const bkShow = v => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'oui' : 'non')
  : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k.toUpperCase()} ${x}`).join(', ') : String(v));

/** Encadré « Brouillon » de la fiche : publié / brouillon champ par champ, annulation de ce bloc ou de tout le brouillon. */
function bkFillDraftState(t) {
  const box = document.getElementById('bk-sheet-draft');
  const change = t ? (_bk.draft?.changes ?? []).find(c => c.id === t.id) : null;
  const isNew = t && !_bk.publishedIds.includes(t.id);
  const nChanges = _bk.draft?.changes?.length ?? 0;
  box.classList.toggle('hidden', !t || (!change && !isNew && !nChanges));
  if (!t) return;
  const body = document.getElementById('bk-sheet-diff-body');
  body.textContent = '';
  const text = document.getElementById('bk-sheet-draft-text');
  document.getElementById('bk-diff-pub').textContent = `Version publiée (v${_bk.published.version})`;
  if (change?.kind === 'changed') {
    text.textContent = `Ce bloc est modifié dans le brouillon (pas encore visible des joueurs). Les joueurs voient toujours la version publiée v${_bk.published.version}.`;
    for (const f of change.fields) {
      const tr = document.createElement('tr');
      [BK_FIELD_LABELS[f.field] ?? f.field, bkShow(f.before), bkShow(f.after)].forEach(x => addCell(tr, x));
      body.appendChild(tr);
    }
  } else if (isNew) {
    text.textContent = 'Nouveau bloc, présent uniquement dans le brouillon : il n\'a jamais été publié.';
  } else {
    text.textContent = `Ce bloc est identique à la version publiée v${_bk.published.version}. Le brouillon contient ${nChanges} changement(s) sur d'autres blocs.`;
  }
  body.closest('table').classList.toggle('hidden', !body.children.length);
  const revert = document.getElementById('btn-bk-revert');
  revert.classList.toggle('hidden', isNew);
  revert.disabled = change?.kind !== 'changed';
  document.getElementById('btn-bk-remove').classList.toggle('hidden', !isNew);
  document.getElementById('btn-bk-discard-all').disabled = !_bk.draft;
}

/** Traduction intégrée au jeu pour une langue (sans repli), ou null. */
function bkBuiltInName(id, l) {
  if (typeof I18n === 'undefined' || !id) return null;
  return typeof I18n.get === 'function' ? I18n.get(`block.${id}`, l) : (l === 'fr' && I18n.has(`block.${id}`, 'fr') ? I18n.t(`block.${id}`) : null);
}

/** Nom réellement affiché en jeu pour chaque langue, avec sa provenance (même repli que Blocks.displayName). */
function bkNameUsed(id, names, l) {
  if (names[l]) return { name: names[l], src: 'custom' };
  const b = bkBuiltInName(id, l);
  if (b) return { name: b, src: 'builtin' };
  const fr = names.fr || bkBuiltInName(id, 'fr');
  return { name: fr || null, src: 'missing' };
}

function bkNamesSources() {
  const id = document.getElementById('bk-id').value.trim();
  const names = {};
  for (const l of BK_LANGS) names[l] = document.getElementById(`bk-name-${l}`).value.trim();
  let missing = 0;
  for (const l of BK_LANGS) {
    const u = bkNameUsed(id, names, l);
    const el = document.getElementById(`bk-name-src-${l}`);
    el.className = `bk-name-src bk-name-src--${u.src}`;
    if (u.src === 'custom') el.textContent = '✓ personnalisée (prioritaire)';
    else if (u.src === 'builtin') el.textContent = `✓ intégrée au jeu : « ${u.name} »`;
    else if (l === 'fr') el.textContent = '⚠ manquante : nom FR obligatoire';
    else { missing++; el.textContent = u.name ? `⚠ manquante : le jeu affiche le nom FR « ${u.name} »` : '⚠ manquante'; }
  }
  const btn = document.getElementById('btn-bk-translate');
  btn.disabled = !missing || !(names.fr || bkBuiltInName(id, 'fr'));
  btn.title = missing ? `${missing} langue(s) sans traduction` : 'Toutes les langues ont une traduction (personnalisée ou intégrée).';
  return names;
}

const BK_CATEGORY_HELP = {
  terre: 'Terre : bloc ordinaire, rapporte des pièces. Peut faire tomber les trouvailles de collection prévues pour la terre.',
  pierre: 'Pierre : bloc ordinaire, rapporte des pièces. Peut faire tomber les trouvailles prévues pour la pierre.',
  minerai: 'Minerai : bloc ordinaire, rapporte des pièces (en général plus). Peut faire tomber les trouvailles prévues pour les minerais.',
  coffre: 'Coffre : le casser ouvre un coffre (pièces, fragments ou boost) dont la table dépend de la rareté ; compte pour les badges « coffres ouverts » ; peut faire tomber les trouvailles prévues pour les coffres.',
  gemme: 'Gemme : rapporte en plus 1 gemme si la case « Rapporte 1 gemme » est cochée (sinon le jeu le traite comme un minerai) ; compte dans les gemmes trouvées.',
};

function bkCategoryHelp() {
  const cat = document.getElementById('bk-category').value;
  document.getElementById('bk-h-cat').textContent = `${BK_CATEGORY_HELP[cat] ?? ''} Les catégories : `
    + Object.keys(BK_CATEGORY_HELP).join(', ') + '. Changer la catégorie change ce comportement (coffre ↔ bloc ordinaire, gemme, trouvailles de collection) '
    + 'et la forme proposée par l\'atelier d\'icônes ; c\'est indépendant de la rareté, qui règle la Chance et la table d\'un coffre.';
}

const BK_EFF_DEPTHS = [1, 25, 100, 250, 400];

/** Probabilités effectives du bloc tel que saisi (remplace sa version de travail), sans Chance et avec Chance 10. */
function bkEffective() {
  const box = document.getElementById('bk-eff');
  const f = bkReadForm();
  const gem = document.getElementById('bk-gem-note');
  const isGem = f.category === 'gemme';
  document.getElementById('bk-gem-reward').closest('label').classList.toggle('hidden', !isGem);
  bkCategoryHelp();
  box.textContent = '';
  if (!f.id || !(f.weight > 0) || !(f.minDepth >= 1)) {
    box.textContent = 'Renseignez la profondeur minimale et le poids pour voir la probabilité réelle.';
    gem.textContent = isGem ? 'Modèle actuel : 1 gemme à chaque bloc cassé (100 %). Probabilité × quantité : voir #49.' : 'Seuls les blocs de catégorie « gemme » rapportent une gemme.';
    return;
  }
  const types = bkWorking().filter(t => t.id !== f.id).concat([{ ...f, active: true }]);
  const depthIn = Math.max(1, Number(document.getElementById('bk-odds-depth').value) || 250);
  const depths = [...new Set([...BK_EFF_DEPTHS, depthIn])].sort((a, b) => a - b);
  const luckOdds = (depth, lvl) => {
    const mult = 1 + lvl * 0.10;
    const pool = types.filter(t => t.active && depth >= t.minDepth).map(t => [t.id, bkWeightAt(t, depth) * (BK_BOOSTED.has(t.rarity) ? mult : 1)]);
    const tot = pool.reduce((a, [, w]) => a + w, 0);
    return tot > 0 ? (pool.find(([id]) => id === f.id)?.[1] ?? 0) / tot : 0;
  };
  const p0 = luckOdds(depthIn, 0);
  const head = document.createElement('p');
  head.textContent = p0
    ? `À ${depthIn} m : ${bkPct(p0)} des blocs, soit environ 1 bloc sur ${Math.round(1 / p0).toLocaleString('fr-BE')} (sans Chance).`
    : `À ${depthIn} m : n'apparaît pas (profondeur minimale ${f.minDepth} m).`;
  if (!f.active) head.textContent += ' Bloc désactivé : en réalité il n\'apparaît pas ; calcul fait comme s\'il était actif.';
  box.appendChild(head);
  const tbl = document.createElement('table');
  tbl.className = 'bk-eff-table';
  const hr = document.createElement('tr');
  ['Profondeur', 'Poids utilisé', 'Probabilité', 'avec Chance 10'].forEach(x => { const th = document.createElement('th'); th.textContent = x; hr.appendChild(th); });
  const thead = document.createElement('thead'); thead.appendChild(hr); tbl.appendChild(thead);
  const tb = document.createElement('tbody');
  for (const d of depths) {
    const tr = document.createElement('tr');
    const avail = d >= f.minDepth;
    [`${d} m`, avail ? String(bkWeightAt(f, d)) : '—', avail ? bkPct(luckOdds(d, 0)) : 'absent', avail ? bkPct(luckOdds(d, 10)) : 'absent']
      .forEach(x => addCell(tr, x));
    if (d === depthIn) tr.className = 'bk-eff-cur';
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  box.appendChild(tbl);
  const note = document.createElement('small');
  note.className = 'muted';
  note.textContent = (BK_BOOSTED.has(f.rarity)
    ? `Rareté « ${BK_RARITY[f.rarity]} » : la Chance du joueur augmente son poids de 10 % par niveau (colonne « avec Chance 10 » : ×2).`
    : `Rareté « ${BK_RARITY[f.rarity] ?? f.rarity} » : non favorisée par la Chance (sa part baisse un peu quand la Chance favorise les blocs rares).`)
    + ' Les probabilités tiennent compte de tous les blocs du brouillon/catalogue de travail et de cette fiche telle que saisie. Profondeur de référence : champ « Probabilités à … m » de la liste.';
  box.appendChild(note);
  gem.textContent = !isGem ? 'Seuls les blocs de catégorie « gemme » rapportent une gemme.'
    : f.gemReward ? `Modèle actuel : 1 gemme à chaque bloc cassé (100 %). À ${depthIn} m, ≈ ${(p0 * 1000).toFixed(2)} gemme(s) pour 1 000 blocs cassés. Un modèle « probabilité × quantité » est en attente d'arbitrage économique (#49) : rien n'est modifié ici.`
      : 'Ne rapporte aucune gemme (traité comme un minerai en jeu).';
}

// Aide contextuelle : ⓘ ouvre/ferme l'explication (souris, clavier, tactile), sans activer le champ.
document.getElementById('bk-dialog').addEventListener('click', e => {
  const b = e.target.closest('.bk-info');
  if (!b) return;
  e.preventDefault();
  const h = document.getElementById(b.getAttribute('aria-controls'));
  h.hidden = !h.hidden;
  b.setAttribute('aria-expanded', String(!h.hidden));
});

// Modifications non enregistrées : confirmation avant toute fermeture (✕, Échap, fond, atelier, page).
let _bkSnapshot = null;
const bkDirty = () => document.getElementById('bk-dialog').open && _bkSnapshot !== null && JSON.stringify(bkReadForm()) !== _bkSnapshot;
function bkDirtyUpdate() { document.getElementById('bk-dirty').classList.toggle('hidden', !bkDirty()); }

function bkRequestClose(then) {
  const dlg = document.getElementById('bk-dialog');
  const go = () => { _bkSnapshot = null; dlg.close(); then?.(); };
  if (!bkDirty()) { go(); return; }
  const leave = document.getElementById('bk-leave-dialog');
  leave._then = go;
  leave.showModal();
  document.getElementById('btn-bk-leave-stay').focus();
}
document.getElementById('btn-bk-leave-stay').addEventListener('click', () => { const l = document.getElementById('bk-leave-dialog'); l._then = null; l.close(); });
document.getElementById('btn-bk-leave-go').addEventListener('click', () => {
  const l = document.getElementById('bk-leave-dialog');
  const then = l._then;
  l._then = null;
  l.close();
  then?.();
});
document.getElementById('bk-leave-dialog').addEventListener('close', () => {
  if (document.getElementById('bk-dialog').open) document.getElementById('btn-bk-save').focus();
});
document.getElementById('bk-dialog').addEventListener('cancel', e => {
  if (!bkDirty()) { _bkSnapshot = null; return; }
  e.preventDefault();
  bkRequestClose();
});
window.addEventListener('beforeunload', e => { if (bkDirty()) { e.preventDefault(); e.returnValue = ''; } });
document.getElementById('bk-dialog').addEventListener('input', e => {
  if (e.target.id?.startsWith('bk-name-') || e.target.id === 'bk-id') bkNamesSources();
  if (e.target.closest('.bk-sec') && !e.target.id?.startsWith('bk-name-')) bkEffective();
  bkDirtyUpdate();
});
document.getElementById('bk-dialog').addEventListener('change', () => { bkEffective(); bkDirtyUpdate(); });

document.getElementById('bk-dialog').addEventListener('close', () => {
  // Retour du focus sur la ligne d'origine (re-rendue après un enregistrement : retrouvée par identifiant).
  const id = _bkSheetOpener?.dataset?.id;
  const row = id ? document.querySelector(`#bk-body tr[data-id="${CSS.escape(id)}"]`) : null;
  (row ?? (document.contains(_bkSheetOpener) ? _bkSheetOpener : null))?.focus();
  _bkSheetOpener = null;
});
document.getElementById('btn-bk-close').addEventListener('click', () => bkRequestClose());
// Clic sur le fond (hors du contenu) : fermeture, avec confirmation si des valeurs ne sont pas enregistrées.
document.getElementById('bk-dialog').addEventListener('click', e => { if (e.target.id === 'bk-dialog') bkRequestClose(); });
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
  bkRequestClose(() => {
    document.querySelector('.tab-btn[data-tab="icons"]').click();
    if (id) icOpen(`block:${id}`);
  });
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

const AI_LANGS = DigLanguages.selectable().map(l => [l.code, l.nativeName]); // registre des langues (#59)

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
  if (!ok) { ptMessage('bk-form-msg', data.error || 'Erreur.', false); return; }
  // Message après le rechargement : la fiche affiche déjà l'état enregistré (plus de « non enregistré »).
  await loadBlocks();
  bkFillForm(bkWorking().find(t => t.id === data.type.id));
  ptMessage('bk-form-msg', _bk.draft?.changes.some(c => c.id === data.type.id)
    ? `« ${data.type.id} » enregistré dans le brouillon (pas encore visible des joueurs).`
    : `« ${data.type.id} » est identique à la version publiée : aucun changement en attente pour ce bloc.`, true);
});

/** Après une annulation ou un abandon : fiche rechargée sur l'état réel, sans demande de confirmation. */
async function bkAfterUndo(id, msg) {
  await loadBlocks();
  const t = id ? bkWorking().find(x => x.id === id) : null;
  if (t) bkFillForm(t); else { _bkSnapshot = null; document.getElementById('bk-dialog').close(); }
  ptMessage(t ? 'bk-form-msg' : 'bk-publish-msg', msg, true);
}

document.getElementById('btn-bk-revert').addEventListener('click', async () => {
  const id = document.getElementById('bk-id').value.trim();
  const change = (_bk.draft?.changes ?? []).find(c => c.id === id);
  if (!id || !change || change.kind !== 'changed') return;
  const what = change.fields.map(f => `${BK_FIELD_LABELS[f.field] ?? f.field} : ${bkShow(f.after)} → ${bkShow(f.before)}`).join('\n');
  if (!confirm(`Annuler les modifications de « ${id} » et revenir à la version publiée v${_bk.published.version} ?\n\n${what}\n\nRien n'est publié ; les autres blocs du brouillon ne changent pas.`)) return;
  const { ok, data } = await api('POST', `/api/admin/blocks/draft/types/${encodeURIComponent(id)}/revert`);
  if (!ok) { ptMessage('bk-form-msg', data.error || 'Erreur.', false); return; }
  await bkAfterUndo(id, `Modifications de « ${id} » annulées : version publiée rétablie, rien n'a été publié.`
    + (data.draftDropped ? ' Le brouillon ne contenait plus aucun changement : il a été supprimé.' : ''));
});

document.getElementById('btn-bk-remove').addEventListener('click', async () => {
  const id = document.getElementById('bk-id').value.trim();
  if (!id || !confirm(`Retirer le nouveau bloc « ${id} » du brouillon ? Il n'a jamais été publié.`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/blocks/draft/types/${encodeURIComponent(id)}`);
  if (!ok) { ptMessage('bk-form-msg', data.error || 'Erreur.', false); return; }
  await bkAfterUndo(null, `« ${id} » retiré du brouillon.`);
});

async function bkDiscardAll() {
  if (!_bk?.draft) return false;
  const ids = [...new Set(_bk.draft.changes.map(c => c.id))];
  if (!confirm(`Abandonner TOUT le brouillon ?\n\n${_bk.draft.changes.length} changement(s) non publié(s) seront perdus : ${ids.join(', ') || '—'}.\n`
    + 'La version publiée n\'est pas modifiée ; rien n\'est publié.')) return false;
  const { ok, data } = await api('DELETE', '/api/admin/blocks/draft');
  ptMessage('bk-publish-msg', ok ? 'Brouillon abandonné : le catalogue de travail est revenu à la version publiée.' : (data.error || 'Erreur.'), ok);
  return ok;
}

document.getElementById('btn-bk-discard-all').addEventListener('click', async () => {
  const id = document.getElementById('bk-id').value.trim();
  if (await bkDiscardAll()) await bkAfterUndo(id, 'Tout le brouillon a été abandonné : ce bloc est revenu à la version publiée.');
});

document.getElementById('btn-bk-translate').addEventListener('click', async () => {
  const id = document.getElementById('bk-id').value.trim();
  const names = bkNamesSources();
  const langs = BK_LANGS.filter(l => l !== 'fr' && bkNameUsed(id, names, l).src === 'missing');
  if (!langs.length) return;
  const btn = document.getElementById('btn-bk-translate');
  const msg = document.getElementById('bk-translate-msg');
  btn.disabled = true;
  msg.textContent = `Traduction en cours (${langs.join(', ').toUpperCase()})…`;
  const { ok, data } = await api('POST', '/api/admin/blocks/translate',
    { id, names: { ...names, fr: names.fr || bkBuiltInName(id, 'fr') }, category: document.getElementById('bk-category').value, langs });
  if (!ok) { msg.textContent = data.error || 'Erreur.'; bkNamesSources(); return; }
  const filled = [];
  for (const [l, v] of Object.entries(data.names)) {
    const el = document.getElementById(`bk-name-${l}`);
    if (el.value.trim()) continue;   // jamais d'écrasement d'un champ saisi entre-temps
    el.value = v;
    el.classList.add('bk-ai-filled');
    filled.push(l.toUpperCase());
  }
  msg.textContent = (filled.length ? `Proposition IA dans ${filled.join(', ')} (champs surlignés) : relisez, corrigez, puis « Enregistrer dans le brouillon ». Rien n'est enregistré.` : 'Aucune proposition utilisable.')
    + (data.warnings.length ? ` ⚠ ${data.warnings.join(' ')}` : '');
  bkNamesSources();
  bkDirtyUpdate();
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
  if (await bkDiscardAll()) loadBlocks();
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

const CO_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const CO_IMAGE_RE = /^(\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)|\/api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp)|\/media\/icons\/[a-f0-9]{16}\.webp)$/;
let _co = null;   // vue admin (GET /api/admin/collections)
let _coAi = null; // propositions IA (GET /api/admin/collections/ai)
let _coAiTimer = null;
let _coProp = null; // proposition ouverte dans la fiche de relecture

function coWorking() {
  if (!_co) return { series: [], items: [] };
  return _co.draft ? { series: _co.draft.series, items: _co.draft.items } : { series: _co.published.series, items: _co.published.items };
}

function coSeasonLabel(id, week = null) {
  if (id == null && week) {
    const f = (_co.futureWeeks ?? []).find(x => x.week === week);
    return f ? `🗓️ Saison future ${f.label}${f.themeName ? ` « ${f.themeName} »` : ''}` : `🗓️ Semaine ${week}`;
  }
  if (id == null) return 'Permanente (aucune saison)';
  const s = _co.seasons.find(x => x.id === id);
  return s ? `#${s.id} ${s.name} (${s.status})` : `#${id}`;
}

// Choix de saison (03/11) : '' = permanente, '<id>' = saison existante, 'week:2026-W46' = saison future
// pas encore créée (rattachement automatique à sa création, aucun drop avant).
const coSeasonValue = s => (s?.seasonId != null ? String(s.seasonId) : s?.seasonWeek ? `week:${s.seasonWeek}` : '');
function coSeasonFromValue(v) {
  if (v.startsWith('week:')) return { seasonId: null, seasonWeek: v.slice(5) };
  return { seasonId: v === '' ? null : Number(v), seasonWeek: null };
}
/** Options du choix de saison : permanente, saisons futures (semaines), saisons existantes. */
function coSeasonOptions(sel, { weeks = true } = {}) {
  const value = sel.value;
  sel.textContent = '';
  const opt = (parent, v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; parent.appendChild(o); };
  opt(sel, '', 'Permanente (hors saison) — tombe chaque semaine, sans fin');
  if (weeks && _co.futureWeeks?.length) {
    const g = document.createElement('optgroup');
    g.label = 'Saisons futures (pas encore créées : rattachement automatique)';
    for (const f of _co.futureWeeks) opt(g, `week:${f.week}`, `🗓️ ${f.label}${f.themeName ? ` — « ${f.themeName} » (thème préparé)` : ''}`);
    sel.appendChild(g);
  }
  const g = document.createElement('optgroup');
  g.label = 'Saisons existantes';
  for (const x of _co.seasons) opt(g, String(x.id), `#${x.id} ${x.name} (${x.status})`);
  sel.appendChild(g);
  if ([...sel.options].some(o => o.value === value)) sel.value = value;
}
/** Sélectionne la valeur d'une série ; une semaine absente de la liste (passée ou déjà créée) est ajoutée. */
function coSeasonSet(sel, s) {
  const v = coSeasonValue(s);
  if (![...sel.options].some(o => o.value === v)) {
    const o = document.createElement('option');
    o.value = v; o.textContent = coSeasonLabel(s.seasonId ?? null, s.seasonWeek ?? null);
    sel.appendChild(o);
  }
  sel.value = v;
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

/** Miniature d'objet au format des blocs (#37) : image entière (jamais recadrée) ou emoji en pointillés. */
function coThumb(box, image, icon) {
  const hasImage = image && CO_IMAGE_RE.test(image) && !image.includes('..');
  box.className = `bk-thumb bk-thumb--${hasImage ? 'image' : 'emoji'}`;
  box.title = hasImage ? '' : 'Pas encore d\'image (emoji affiché)';
  coArt(box, hasImage ? image : null, icon, 256);
  const img = box.querySelector('img');
  if (img) {
    img.removeAttribute('width'); img.removeAttribute('height');
    img.addEventListener('error', () => { box.className = 'bk-thumb bk-thumb--error'; });
  }
}

// Aperçu agrandi au survol (souris) ou au focus clavier, comme pour les blocs ; sur écran tactile, la fiche le remplace.
function coZoomShow(anchor, d) {
  if (!window.matchMedia('(hover: hover)').matches && !anchor.closest('tr')?.matches(':focus-visible')) return;
  const zoom = document.getElementById('co-zoom');
  const box = document.createElement('span');
  coThumb(box, d.image, d.icon);
  const title = document.createElement('strong');
  title.textContent = d.title;
  const cap = document.createElement('small');
  cap.className = 'bk-src';
  cap.textContent = `${d.sub} · ${box.classList.contains('bk-thumb--image') ? 'image' : 'emoji · à illustrer'}`;
  zoom.textContent = '';
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
function coZoomHide() { document.getElementById('co-zoom').classList.add('hidden'); }
window.addEventListener('scroll', coZoomHide, { passive: true });
document.getElementById('co-items-body').closest('.bk-table-wrap').addEventListener('scroll', coZoomHide, { passive: true });

function coNotice(text, ok = true) { ptMessage('co-notice', text, ok); }

// Séries
admDialogSetup('co-series-dialog');
function coFillSeriesForm(s) {
  document.getElementById('co-series-form-title').textContent = s ? `Série « ${s.names?.fr ?? s.id} »` : 'Nouvelle série';
  const idEl = document.getElementById('co-s-id');
  idEl.value = s ? s.id : '';
  idEl.readOnly = !!s;
  for (const l of CO_LANGS) document.getElementById(`co-s-name-${l}`).value = s?.names?.[l] ?? '';
  coSeasonOptions(document.getElementById('co-s-season'));
  coSeasonSet(document.getElementById('co-s-season'), s);
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
  coItemLang('fr');
  _coItemSnap = JSON.stringify(coReadItem());
}
function coOpenItem(i, opener) {
  coZoomHide();
  coFillItemForm(i);
  admDialogOpen('co-item-dialog', opener, i ? 'co-i-name-fr' : 'co-i-id');
}

// Fiche objet : nom + histoire d'une seule langue à la fois (les autres restent dans leurs champs)
let _coItemSnap = null; // état de la fiche à l'ouverture (modifications non enregistrées)
const coItemDirty = () => _coItemSnap !== null && JSON.stringify(coReadItem()) !== _coItemSnap;
function coItemLangState(l) {
  const n = document.getElementById(`co-i-name-${l}`).value.trim(), st = document.getElementById(`co-i-story-${l}`).value.trim();
  return n && st ? 'ok' : (n ? 'name' : 'none');
}
function coItemLangTags() {
  for (const b of document.querySelectorAll('#co-i-langs .co-lang-btn')) {
    const st = coItemLangState(b.dataset.lang);
    b.className = `co-lang-btn co-lang--${st}`;
    b.title = { ok: 'complet', name: 'histoire manquante', none: 'à traduire' }[st];
  }
}
/** Change la langue éditée ; l'aperçu suit la même langue. */
function coItemLang(l, focus = false) {
  for (const b of document.querySelectorAll('#co-i-langs .co-lang-btn')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
  for (const d of document.querySelectorAll('#co-item-dialog .co-i-lang')) d.classList.toggle('hidden', d.dataset.lang !== l);
  const ref = [document.getElementById('co-i-name-fr').value.trim(), document.getElementById('co-i-story-fr').value.trim()].filter(Boolean).join(' — ');
  document.getElementById('co-i-fr-ref').classList.toggle('hidden', l === 'fr' || !ref);
  document.getElementById('co-i-fr-ref-text').textContent = ref;
  document.getElementById('co-preview-lang').value = l;
  coItemLangTags();
  coPreview();
  if (focus) document.querySelector(`#co-i-langs .co-lang-btn[data-lang="${l}"]`).focus();
}
// Modifications non enregistrées : confirmation avant de fermer (✕, Annuler, Échap, clic hors fiche)
{
  const dlg = document.getElementById('co-item-dialog');
  const keep = () => coItemDirty() && !confirm('Des modifications de cet objet ne sont pas enregistrées. Fermer quand même (elles seront perdues) ?');
  dlg.addEventListener('click', e => {
    if ((e.target === dlg || e.target.closest('[data-close]')) && keep()) e.stopPropagation();
  }, true);
  dlg.addEventListener('cancel', e => { if (keep()) e.preventDefault(); });
  dlg.addEventListener('close', () => { _coItemSnap = null; });
}
document.querySelectorAll('#co-i-langs .co-lang-btn').forEach((b, k, all) => {
  b.addEventListener('click', () => coItemLang(b.dataset.lang));
  b.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    coItemLang(all[(k + step + all.length) % all.length].dataset.lang, true);
  });
});

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
  document.getElementById('co-preview-series').textContent = s ? `${s.icon} ${s.names?.[lang] || s.names?.fr || s.id} · ${coSeasonLabel(s.seasonId, s.seasonWeek)}` : '';
  document.getElementById('co-preview-story').textContent = pick('co-i-story') || '(pas encore d\'histoire)';
}

/**
 * Statut d'une ligne : d'abord la PUBLICATION (ce que voient les joueurs), puis, à part, l'indicateur
 * de contenu « activé / désactivé » (indépendant de la publication).
 */
function coStateCell(tr, published, changed, active, what) {
  const cell = addCell(tr, '');
  cell.className = 'bk-state';
  const pub = document.createElement('span');
  pub.className = `co-pub co-pub--${!published ? 'draft' : changed ? 'changed' : 'live'}`;
  pub.textContent = !published ? 'Brouillon — non publié' : changed ? 'Publié · modifié dans le brouillon' : 'Publié';
  pub.title = !published ? 'Nouveau : n\'existe que dans le brouillon, invisible des joueurs tant que le brouillon n\'est pas publié.'
    : changed ? 'Les joueurs voient la version publiée ; les modifications du brouillon s\'appliqueront à la publication.'
    : 'Identique à la version en jeu.';
  const flag = document.createElement('small');
  const fem = what === 'Série';
  flag.className = active ? 'muted' : 'co-flag-off';
  flag.textContent = `${what} ${active ? (fem ? 'activée' : 'activé') : (fem ? 'désactivée' : 'désactivé')}`;
  flag.title = 'Indicateur de contenu, indépendant de la publication : désactivé = n\'apparaît plus et ne tombe plus (les objets déjà trouvés restent).';
  cell.append(pub, document.createElement('br'), flag);
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
    const cell = addCell(tr, '');
    cell.className = 'bk-visual';
    const box = document.createElement('span');
    coThumb(box, i.image, i.icon);
    cell.appendChild(box);
    addCell(tr, i.id).className = 'bk-id';
    addCell(tr, i.names?.fr ?? '');
    addCell(tr, s ? `${s.icon} ${s.names.fr}` : i.seriesId).className = 'co-series-cell';
    addCell(tr, BK_RARITY[i.rarity] ?? i.rarity).className = 'nowrap';
    // Drop sur deux lignes courtes : sources et profondeur, puis chance (et « inactif »).
    const drop = addCell(tr, `${i.drop.from.join(' / ')} · dès ${i.drop.minDepth} m`);
    drop.className = 'bk-range';
    const chance = document.createElement('small');
    chance.textContent = `${+(i.drop.chance * 100).toFixed(3)} %${i.dropEnabled ? '' : ' · inactif'}`;
    if (!i.dropEnabled) chance.className = 'muted';
    drop.appendChild(chance);
    const langs = addCell(tr, '');
    langs.className = 'co-langs';
    for (const l of CO_LANGS) {
      const full = i.names?.[l] && i.stories?.[l];
      const tag = document.createElement('span');
      tag.className = `co-lang co-lang--${full ? 'ok' : (i.names?.[l] ? 'name' : 'none')}`;
      tag.textContent = full ? l.toUpperCase() : (i.names?.[l] ? `${l.toUpperCase()}*` : '—');
      tag.title = `${l.toUpperCase()} : ${full ? 'nom et histoire' : (i.names?.[l] ? 'nom seul, histoire manquante' : 'absent')}`;
      langs.appendChild(tag);
    }
    coStateCell(tr, _co.publishedIds.items.includes(i.id), changed.has(i.id), i.active, 'Objet');
    admRowOpen(tr, `co-item:${i.id}`, i.names?.fr ?? i.id, row => coOpenItem(coWorking().items.find(x => x.id === i.id) ?? i, row));
    const zoomData = { image: i.image, icon: i.icon, title: `${i.names?.fr ?? i.id} (${i.id})`, sub: BK_RARITY[i.rarity] ?? i.rarity };
    box.addEventListener('mouseenter', () => coZoomShow(box, zoomData));
    box.addEventListener('mouseleave', coZoomHide);
    tr.addEventListener('focus', () => { if (tr.matches(':focus-visible')) coZoomShow(box, zoomData); });
    tr.addEventListener('blur', coZoomHide);
    tb.appendChild(tr);
  }
  document.getElementById('co-items-count').textContent = `— ${shown} / ${items.length}`;
}

const coClock = d => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
let _coLoadedAt = null;

// Chaque chargement relit la base (GET /api/admin/collections, sans cache). « Rafraîchir » montre
// l'attente, puis l'heure de mise à jour ou l'erreur ; filtres, recherche et fiche ouverte sont
// conservés (même retour que la bêta #57, recette du 03/11).
async function loadCollections({ manual = false } = {}) {
  const btn = document.getElementById('btn-refresh-collections');
  const st  = document.getElementById('co-refresh-status');
  if (manual) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '↻ Actualisation…';
    st.className = 'refresh-status';
    st.textContent = 'Chargement…';
  }
  let res;
  try { res = await api('GET', '/api/admin/collections'); }
  catch { res = { ok: false, data: { error: 'serveur inaccessible' } }; }
  if (manual) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = '↻ Rafraîchir';
  }
  const { ok, data } = res;
  if (!ok) {
    st.className = 'refresh-status is-err';
    st.textContent = `⚠️ Échec de l’actualisation (${data.error || 'erreur'})${_coLoadedAt ? ` — données affichées : ${coClock(_coLoadedAt)}` : ''}`;
    if (!manual) coNotice(data.error || 'Erreur lors du chargement.', false);
    return;
  }
  _co = data;
  _coLoadedAt = new Date();
  st.className = 'refresh-status';
  st.textContent = `✓ Données à jour à ${coClock(_coLoadedAt)}`;
  if (manual) admToast(`Collections : données à jour à ${coClock(_coLoadedAt)}.`);
  const w = coWorking();
  const p = data.published;

  // Sélecteurs (le choix de la fiche Série est reconstruit à son ouverture : saisie en cours conservée)
  coSeasonOptions(document.getElementById('co-ai-season'), { weeks: false });
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
  const seriesChanged = new Set((data.draft?.changes ?? []).filter(c => c.kind === 'series').map(c => c.id));
  for (const s of w.series) {
    const tr = document.createElement('tr');
    [s.icon, s.id, s.names.fr, coSeasonLabel(s.seasonId, s.seasonWeek), w.items.filter(i => i.seriesId === s.id).length].forEach(x => addCell(tr, x));
    ['co-series-icon', 'bk-id', '', 'nowrap', 'num'].forEach((c, k) => { if (c) tr.children[k].className = c; });
    coStateCell(tr, data.publishedIds.series.includes(s.id), seriesChanged.has(s.id), s.active, 'Série');
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
  document.getElementById('co-changes-details').classList.toggle('hidden', !d?.changes.length);
  document.getElementById('co-changes-summary').textContent = `Détail des ${d?.changes.length ?? 0} changement(s) du brouillon`;
  for (const c of d ? d.changes : []) {
    const tr = document.createElement('tr');
    addCell(tr, `${c.kind === 'series' ? 'Série' : 'Objet'} ${c.id}`);
    addCell(tr, c.change === 'added' ? 'ajouté' : c.fields.map(f => `${f.field} : ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join(' ; '));
    cb.appendChild(tr);
  }
  const drops = d ? d.drops : [];
  document.getElementById('co-drops-box').classList.toggle('hidden', !drops.length);
  bkFillList(document.getElementById('co-drops-list'), drops.map(x =>
    `${x.id} : ${x.drop.from.join('/')} dès ${x.drop.minDepth} m, ${+(x.drop.chance * 100).toFixed(3)} % par bloc — ${coSeasonLabel(x.seasonId, x.seasonWeek)}`));
  document.getElementById('co-confirm-drops').checked = false;
  coRenderReadiness(d);
  const incomplete = (d?.readiness ?? []).filter(r => r.blocking.length);
  document.getElementById('co-incomplete-box').classList.toggle('hidden', !incomplete.length);
  document.getElementById('co-confirm-incomplete').checked = false;
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

// Publication ciblée (03/11) : état de chaque série touchée par le brouillon, publiable seule si complète.
const _coReadyOpen = new Set();
const CO_SCHEDULE = { permanent: '♾️ Permanente', future: '🗓️ Saison future (pas encore créée)', scheduled: '🗓️ Saison programmée', live: '🟢 Saison en cours', over: '⏹️ Saison terminée', unknown: '❔ Saison inconnue' };
function coRenderReadiness(d) {
  const list = document.getElementById('co-ready-list');
  list.textContent = '';
  const rows = d?.readiness ?? [];
  document.getElementById('co-ready-box').classList.toggle('hidden', !rows.length);
  for (const r of rows) {
    const s = d.series.find(x => x.id === r.seriesId);
    const ready = !r.blocking.filter(b => !(r.needsPermanent && b.startsWith('Permanente'))).length;
    const box = document.createElement('details');
    box.className = `co-ready co-ready--${r.blocking.length ? 'blocked' : 'ok'}`;
    box.open = _coReadyOpen.has(r.seriesId);   // replié par défaut (résumé sur une ligne), état conservé
    box.addEventListener('toggle', () => { if (box.open) _coReadyOpen.add(r.seriesId); else _coReadyOpen.delete(r.seriesId); });
    const sum = document.createElement('summary');
    sum.textContent = `${s?.icon ?? ''} ${s?.names?.fr ?? r.seriesId} — ${CO_SCHEDULE[r.schedule] ?? r.schedule}`
      + `${r.season ? ` ${r.season.name}` : s?.seasonWeek ? ` ${s.seasonWeek}` : ''} · `
      + `${r.illustrated}/${r.active} illustré(s) · ${r.dropping}/${r.active} drop(s) actif(s) · `
      + (r.blocking.length ? `❌ ${r.blocking.length} point(s) à régler` : '✅ prête à publier seule');
    box.appendChild(sum);
    const ul = (items, cls) => {
      if (!items.length) return;
      const u = document.createElement('ul');
      u.className = cls;
      for (const x of items) { const li = document.createElement('li'); li.textContent = x; u.appendChild(li); }
      box.appendChild(u);
    };
    ul(r.blocking, 'error');
    ul(r.warnings, 'co-ready-warn');
    ul(r.info, 'muted');
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const drops = d.drops.filter(x => d.items.find(i => i.id === x.id)?.seriesId === r.seriesId);
    const check = (label) => {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      l.append(cb, ` ${label}`);
      actions.appendChild(l);
      return cb;
    };
    const cbDrops = drops.length ? check(`Barème validé : j'active ${drops.length} drop(s) de cette série`) : null;
    const cbPerm = r.needsPermanent && ready ? check('Série permanente voulue (décision métier)') : null;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = 'Publier cette série seule';
    btn.disabled = !ready || d.errors.length > 0;
    btn.title = ready ? '' : 'Série incomplète : réglez d\'abord les points en rouge.';
    btn.addEventListener('click', async () => {
      if (cbDrops && !cbDrops.checked) { ptMessage('co-publish-msg', 'Cochez « barème validé » pour activer les drops de cette série.', false); return; }
      if (cbPerm && !cbPerm.checked) { ptMessage('co-publish-msg', 'Nouvelle série sans saison : confirmez qu\'elle doit être permanente, ou rattachez-la à une saison.', false); return; }
      const others = rows.filter(x => x.seriesId !== r.seriesId).map(x => x.seriesId);
      if (!confirm(`Publier la série « ${s?.names?.fr ?? r.seriesId} » seule ?\n${r.info.join('\n')}`
        + (others.length ? `\nRestent en brouillon (non publiées) : ${others.join(', ')}.` : ''))) return;
      const { ok, data } = await api('POST', `/api/admin/collections/series/${encodeURIComponent(r.seriesId)}/publish`, {
        note: document.getElementById('co-publish-note').value, expectedBasedOn: d.basedOn,
        confirmDrops: !!cbDrops?.checked, confirmPermanent: !!cbPerm?.checked });
      ptMessage('co-publish-msg', ok ? `Version v${data.version} publiée : série « ${r.seriesId} » seule.` : [data.error, ...(data.details ?? [])].join(' '), ok);
      if (ok) { document.getElementById('co-publish-note').value = ''; loadCollections(); }
    });
    actions.appendChild(btn);
    box.appendChild(actions);
    list.appendChild(box);
  }
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

document.getElementById('btn-refresh-collections').addEventListener('click', () => loadCollections({ manual: true }));
document.getElementById('co-filter-text').addEventListener('input', () => { if (_co) coRenderItems(); });
document.getElementById('co-filter-series').addEventListener('change', () => { if (_co) coRenderItems(); });
document.getElementById('co-filter-state').addEventListener('change', () => { if (_co) coRenderItems(); });
for (const id of ['co-i-icon', 'co-i-image', 'co-i-rarity', 'co-i-series', 'co-preview-lang']) {
  document.getElementById(id).addEventListener('input', coPreview);
}
for (const id of CO_LANGS.flatMap(l => [`co-i-name-${l}`, `co-i-story-${l}`])) {
  document.getElementById(id).addEventListener('input', () => { coItemLangTags(); coPreview(); });
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
  const series = { id: document.getElementById('co-s-id').value.trim(), names: coTexts('co-s-name'),
    ...coSeasonFromValue(document.getElementById('co-s-season').value), icon: document.getElementById('co-s-icon').value.trim(),
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
  if (!item.names?.fr) { coItemLang('fr'); document.getElementById('co-i-name-fr').focus(); ptMessage('co-i-msg', 'Nom FR obligatoire.', false); return; }
  const { ok, data } = await api('PUT', `/api/admin/collections/draft/items/${encodeURIComponent(item.id)}`, { item });
  if (!ok) { ptMessage('co-i-msg', data.error || 'Erreur.', false); return; }
  _coItemSnap = null;
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
  if (coItemDirty() && !confirm('Modifications non enregistrées dans cette fiche : les abandonner pour ouvrir l\'atelier ?\n(Annuler, puis « Enregistrer l\'objet dans le brouillon » pour les garder.)')) return;
  _coItemSnap = null;
  document.getElementById('co-item-dialog').close();
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  if (id) { _icFrom = { kind: 'item', id }; icOpen(`item:${id}`); }
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
  const confirmIncomplete = document.getElementById('co-confirm-incomplete').checked;
  const touched = (_co.draft.readiness ?? []).map(r => r.seriesId);
  if (!confirm(`Publier TOUT le brouillon (${_co.draft.changes.length} changement(s), série(s) : ${touched.join(', ') || '—'}) ? `
    + 'Il sera visible de tous les joueurs au prochain chargement. Pour une seule série, utilisez « Publier cette série seule ».')) return;
  const note = document.getElementById('co-publish-note').value;
  const { ok, data } = await api('POST', '/api/admin/collections/publish', { note, expectedBasedOn: _co.draft.basedOn, confirmDrops, confirmIncomplete });
  ptMessage('co-publish-msg', ok ? `Version v${data.version} publiée.` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) { document.getElementById('co-publish-note').value = ''; loadCollections(); }
});

document.getElementById('btn-co-discard').addEventListener('click', async () => {
  const lost = (_co?.draft?.items ?? []).filter(i => i.image && !(_co.published.items.find(p => p.id === i.id)?.image === i.image)).length;
  if (!confirm('Abandonner le brouillon ? Les modifications non publiées seront perdues'
    + (lost ? ` (dont ${lost} illustration(s) appliquée(s) à des objets non publiés — les images restent dans l'atelier).` : '.'))) return;
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
  // Recette du 02/11 : mention simple dans les fiches ; modèle, budget et quota dans l'aide technique repliée
  // (et ⚙ Config → Budget IA). Les limites restent appliquées par le serveur.
  const limited = st.configured && (st.remainingUsd < st.estTextUsd || st.callsToday >= st.maxCallsPerDay);
  document.getElementById('co-ai-status').textContent = !st.configured
    ? 'IA non configurée : création manuelle seulement.'
    : limited ? 'Limite IA atteinte pour le moment (détails : ⚙ Config → Budget IA). La création manuelle reste possible.'
    : 'La génération IA peut entraîner un coût ; rien n\'est publié automatiquement.';
  document.getElementById('co-ai-status-2').textContent = st.configured
    ? `Modèle ${st.textModel}${st.fake ? ' (mode test)' : ''} — budget restant ≈ ${st.remainingUsd.toFixed(2)} / ${st.budgetUsd} USD, texte ≈ ${st.estTextUsd} USD par proposition ; ${st.callsToday}/${st.maxCallsPerDay} appels sur 24 h.`
    : `IA non configurée : ${st.reason}.`;
  document.getElementById('co-ai-limit').textContent = limited ? 'Limite IA atteinte pour le moment : la demande sera refusée (détails dans l\'aide technique).' : '';
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
document.getElementById('co-prop-dialog').addEventListener('close', () => { _coProp = null; _coPropWork = null; });
// Corrections non enregistrées : confirmation avant de fermer (✕, Fermer, Échap, clic hors fiche)
{
  const dlg = document.getElementById('co-prop-dialog');
  const keep = () => _coPropWork?.dirty && !confirm('Des corrections ne sont pas enregistrées. Fermer quand même (elles seront perdues) ?');
  dlg.addEventListener('click', e => {
    if ((e.target === dlg || e.target.closest('[data-close]')) && keep()) e.stopPropagation();
  }, true);
  dlg.addEventListener('cancel', e => { if (keep()) e.preventDefault(); });
}

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

// Recette du 02/11 : synthèse compacte des objets (une ligne chacun), puis fiche d'un seul objet
// éditée langue par langue (FR par défaut, aperçu en face). Les corrections restent dans une copie
// de travail quand on change d'objet ou de langue ; rien n'est envoyé avant « Enregistrer ».
let _coPropWork = null; // { series, items, lang, idx (null = synthèse), dirty, rationale }

function coPropRender(p) {
  _coProp = p;
  const editable = p.status === 'open';
  document.getElementById('co-prop-title').textContent = `✨ Proposition n° ${p.id}`;
  const state = document.getElementById('co-prop-state');
  state.textContent = {
    pending: '⏳ Génération en cours (≈ 30 à 60 s) : vous pouvez fermer cette fiche, la proposition restera dans « ✨ Propositions IA ».',
    open: 'À relire : ouvrez chaque objet pour corriger son nom et son histoire langue par langue, puis « Enregistrer dans le brouillon ». Rien n\'est publié ; les drops restent inactifs ; aucune image n\'est générée.',
    error: `Échec : ${p.error ?? 'erreur inconnue'}. Aucune donnée n'a été modifiée ; vous pouvez relancer une proposition depuis « ＋ Ajouter ».`,
    in_draft: `Déjà enregistrée dans le brouillon (série « ${p.seriesId} ») : modifiez-la dans les listes Séries et Objets, illustrez chaque objet dans 🎨 Atelier d'icônes, puis publiez.`,
  }[p.status] ?? p.status;
  for (const b of ['btn-co-prop-save', 'btn-co-prop-draft']) document.getElementById(b).classList.toggle('hidden', !editable);
  document.getElementById('btn-co-prop-discard').classList.toggle('hidden', p.status === 'pending' || p.status === 'in_draft');
  admShowError(document.getElementById('co-prop-msg'), '');
  bkFillList(document.getElementById('co-prop-warnings'), p.warnings ?? []);
  const d = p.data ? structuredClone(p.data) : null;
  // _k : position d'origine (pour retrouver le drop pré-rempli de l'objet)
  _coPropWork = d && { series: d.series, items: d.items.map((it, k) => ({ ...it, _k: k })), rationale: d.rationale, review: d.review,
    lang: _coPropWork?.lang ?? 'fr', idx: null, dirty: false, editable };
  coPropDraw();
}

/** Pastilles FR/EN/NL/ES : vert = nom et histoire, jaune = nom seul. */
function coLangState(it, l) { return it.names?.[l] && it.stories?.[l] ? 'ok' : (it.names?.[l] ? 'name' : 'none'); }

function coLangTags(parent, it) {
  const box = document.createElement('span');
  box.className = 'co-langs';
  for (const l of CO_LANGS) {
    const s = coLangState(it, l);
    const tag = document.createElement('span');
    tag.className = `co-lang co-lang--${s}`;
    tag.textContent = s === 'ok' ? l.toUpperCase() : (s === 'name' ? `${l.toUpperCase()}*` : '—');
    tag.title = `${l.toUpperCase()} : ${{ ok: 'nom et histoire', name: 'nom seul, histoire manquante', none: 'absent' }[s]}`;
    box.appendChild(tag);
  }
  parent.appendChild(box);
}

/** Sélecteur de langue (boutons à bascule, flèches gauche/droite). */
function coLangSwitch(parent, stateOf, onPick) {
  const w = _coPropWork;
  const g = document.createElement('div');
  g.className = 'co-lang-switch';
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', 'Langue éditée');
  CO_LANGS.forEach((l, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.lang = l;
    b.className = `co-lang-btn co-lang--${stateOf(l)}`;
    b.textContent = l.toUpperCase();
    b.title = { ok: 'complet', name: 'histoire manquante', none: 'à traduire' }[stateOf(l)];
    b.setAttribute('aria-pressed', String(w.lang === l));
    b.addEventListener('click', () => onPick(l));
    b.addEventListener('keydown', e => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      onPick(CO_LANGS[(k + step + CO_LANGS.length) % CO_LANGS.length]);
    });
    g.appendChild(b);
  });
  parent.appendChild(g);
  return g;
}

function coPropTouch() { _coPropWork.dirty = true; admShowError(document.getElementById('co-prop-msg'), ''); }

/** Champ lié à la copie de travail : obj[key] suit la saisie. */
function coBind(parent, label, obj, key, opts = {}) {
  const w = _coPropWork;
  const el = coField(parent, label, obj[key], { ...opts, readOnly: !w.editable });
  el.addEventListener('input', () => { obj[key] = el.value; coPropTouch(); opts.onInput?.(); });
  return el;
}

function coPropDraw(focus) {
  const body = document.getElementById('co-prop-body');
  body.textContent = '';
  const p = _coProp, w = _coPropWork;
  if (!w) {
    const concept = document.createElement('p');
    concept.className = 'muted';
    concept.textContent = `Description : ${p.concept}`;
    body.appendChild(concept);
    return;
  }
  document.getElementById('co-prop-warnings').classList.toggle('hidden', w.idx != null);
  if (w.idx == null) coPropDrawList(body, focus); else coPropDrawItem(body, focus);
}

function coPropDrawList(body, focus) {
  const p = _coProp, w = _coPropWork, s = w.series;
  const concept = document.createElement('p');
  concept.className = 'muted co-prop-concept';
  concept.textContent = `Description : ${p.concept}`;
  body.appendChild(concept);

  // Série : identifiant, icône, saison, puis nom dans la langue choisie
  const fs = document.createElement('fieldset');
  fs.className = 'co-fs';
  const lg = document.createElement('legend');
  lg.textContent = 'Série';
  fs.appendChild(lg);
  const g = coGrid(fs);
  coBind(g, 'Identifiant', s, 'id', { max: 40 });
  coBind(g, 'Icône', s, 'icon', { max: 8 });
  const sl = document.createElement('label');
  sl.append('Saison');
  const sel = document.createElement('select');
  coSeasonOptions(sel);
  coSeasonSet(sel, s);
  sel.disabled = !w.editable;
  sel.addEventListener('change', () => { Object.assign(s, coSeasonFromValue(sel.value)); coPropTouch(); });
  sl.appendChild(sel);
  g.appendChild(sl);
  const nameRow = document.createElement('div');
  nameRow.className = 'co-lang-row co-span';
  g.appendChild(nameRow);
  coLangSwitch(nameRow, l => (s.names?.[l] ? 'ok' : 'none'), l => { w.lang = l; coPropDraw({ lang: l }); });
  coBind(nameRow, `Nom de la série (${w.lang.toUpperCase()})`, s.names, w.lang, { max: 60 });
  if (w.review) {
    // Relecture synthétique (variété, humour, références à surveiller) : visible d'emblée
    const rv = document.createElement('p');
    rv.className = 'muted co-prop-review';
    rv.textContent = `Relecture : ${w.review}`;
    fs.appendChild(rv);
  }
  if (s.theme || w.rationale) {
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.className = 'muted';
    sum.textContent = 'Thème et raisonnement de l\'IA';
    det.appendChild(sum);
    for (const [k, v] of [['Thème', s.theme], ['Raisonnement', w.rationale]]) {
      if (!v) continue;
      const t = document.createElement('p'); t.className = 'muted'; t.textContent = `${k} : ${v}`; det.appendChild(t);
    }
    fs.appendChild(det);
  }
  body.appendChild(fs);

  // Synthèse : une ligne par objet ; clic / Entrée = fiche de l'objet
  const h = document.createElement('h4');
  h.className = 'co-prop-h';
  h.textContent = `Objets (${w.items.length}) — cliquez sur un objet pour le relire`;
  body.appendChild(h);
  const wrap = document.createElement('div');
  wrap.className = 'bk-table-wrap';
  const table = document.createElement('table');
  table.className = 'bk-table co-items-table co-prop-table';
  const head = table.createTHead().insertRow();
  for (const t of ['Visuel', 'Nom (FR)', 'Rareté', 'Image', 'Drop', 'Langues', '']) {
    const th = document.createElement('th'); th.textContent = t; head.appendChild(th);
  }
  head.lastChild.innerHTML = '<span class="visually-hidden">Ouvrir</span>';
  const tb = table.createTBody();
  w.items.forEach((it, k) => {
    const tr = document.createElement('tr');
    const cell = addCell(tr, '');
    cell.className = 'bk-visual';
    const box = document.createElement('span');
    coThumb(box, null, it.icon);
    cell.appendChild(box);
    const nm = addCell(tr, it.names?.fr || '');
    if (!it.names?.fr) { nm.textContent = '(nom FR manquant)'; nm.className = 'error'; }
    const id = document.createElement('small');
    id.className = 'bk-id muted';
    id.textContent = it.id;
    nm.append(document.createElement('br'), id);
    addCell(tr, BK_RARITY[it.rarity] ?? it.rarity).className = 'nowrap';
    const img = addCell(tr, 'emoji · à illustrer');
    const brief = document.createElement('small');
    brief.className = 'muted';
    brief.textContent = it.image?.subject ? 'consigne prête' : 'sans consigne';
    img.append(document.createElement('br'), brief);
    const drop = addCell(tr, `${it.drop.from.join(' / ')} · dès ${it.drop.minDepth} m`);
    drop.className = 'bk-range';
    const ch = document.createElement('small');
    ch.className = 'muted';
    ch.textContent = `${+(it.drop.chance * 100).toFixed(3)} % · inactif`;
    drop.appendChild(ch);
    coLangTags(addCell(tr, ''), it);
    admRowOpen(tr, `co-prop-item:${k}`, it.names?.fr || it.id, () => { w.idx = k; coPropDraw({ first: true }); });
    tr.removeAttribute('aria-haspopup');
    tr.title = 'Ouvrir la fiche de cet objet';
    tb.appendChild(tr);
  });
  wrap.appendChild(table);
  body.appendChild(wrap);
  if (focus?.row != null) tb.rows[focus.row]?.focus();
  else if (focus?.lang) body.querySelector(`.co-lang-btn[data-lang="${focus.lang}"]`)?.focus();
}

function coPropDrawItem(body, focus) {
  const w = _coPropWork, s = w.series, k = w.idx, it = w.items[k], n = w.items.length;
  const back = () => { w.idx = null; coPropDraw({ row: k }); };

  const nav = document.createElement('div');
  nav.className = 'co-prop-nav';
  const bBack = document.createElement('button');
  bBack.type = 'button'; bBack.className = 'btn btn-outline'; bBack.textContent = '← Tous les objets';
  bBack.addEventListener('click', back);
  const pos = document.createElement('span');
  pos.className = 'muted';
  pos.textContent = `Objet ${k + 1} / ${n}`;
  const bPrev = document.createElement('button');
  bPrev.type = 'button'; bPrev.className = 'btn btn-ghost'; bPrev.textContent = '‹ Précédent'; bPrev.disabled = k === 0;
  bPrev.addEventListener('click', () => { w.idx = k - 1; coPropDraw({ nav: 'prev' }); });
  const bNext = document.createElement('button');
  bNext.type = 'button'; bNext.className = 'btn btn-ghost'; bNext.textContent = 'Suivant ›'; bNext.disabled = k === n - 1;
  bNext.addEventListener('click', () => { w.idx = k + 1; coPropDraw({ nav: 'next' }); });
  nav.append(bBack, pos, bPrev, bNext);
  body.appendChild(nav);

  const wrap = document.createElement('div');
  wrap.className = 'co-prop-wrap';
  const left = document.createElement('div');
  left.className = 'co-prop-fields';

  const fi = document.createElement('fieldset');
  fi.className = 'co-fs';
  const li = document.createElement('legend'); li.textContent = 'Identité'; fi.appendChild(li);
  const gi = coGrid(fi);
  coBind(gi, 'Identifiant', it, 'id', { max: 40 });
  const rl = document.createElement('label');
  rl.append('Rareté');
  const rs = document.createElement('select');
  for (const r of _co?.rarities ?? Object.keys(BK_RARITY)) { const o = document.createElement('option'); o.value = r; o.textContent = BK_RARITY[r] ?? r; rs.appendChild(o); }
  rs.value = it.rarity; rs.disabled = !w.editable;
  rl.appendChild(rs);
  gi.appendChild(rl);
  coBind(gi, 'Icône (emoji)', it, 'icon', { max: 8, onInput: () => refresh() });
  it.reference ??= '';
  coBind(gi, 'Clin d\'œil (référence, pour la relecture)', it, 'reference', { max: 300, cls: 'co-span' });
  left.appendChild(fi);

  // Nom et histoire : une langue à la fois (les autres restent en mémoire)
  const ft = document.createElement('fieldset');
  ft.className = 'co-fs';
  const lt = document.createElement('legend'); lt.textContent = 'Nom et histoire'; ft.appendChild(lt);
  const sw = coLangSwitch(ft, l => coLangState(it, l), l => { w.lang = l; coPropDraw({ lang: l }); });
  const gt = coGrid(ft);
  const updTags = () => sw.querySelectorAll('.co-lang-btn').forEach(b => {
    const st = coLangState(it, b.dataset.lang);
    b.className = `co-lang-btn co-lang--${st}`;
    b.title = { ok: 'complet', name: 'histoire manquante', none: 'à traduire' }[st];
  });
  const nameEl = coBind(gt, `Nom (${w.lang.toUpperCase()})`, it.names, w.lang, { max: 60, cls: 'co-span', onInput: () => { refresh(); updTags(); } });
  const storyEl = coBind(gt, `Histoire (${w.lang.toUpperCase()})`, it.stories, w.lang, { textarea: true, max: 1200, cls: 'co-span', onInput: () => { refresh(); updTags(); } });
  storyEl.rows = 7;
  if (w.lang !== 'fr' && (it.names.fr || it.stories.fr)) {
    const ref = document.createElement('details');
    const rs2 = document.createElement('summary');
    rs2.className = 'muted';
    rs2.textContent = 'Voir le texte FR (référence)';
    const rp = document.createElement('p');
    rp.className = 'muted co-prop-ref';
    rp.textContent = `${it.names.fr} — ${it.stories.fr}`;
    ref.append(rs2, rp);
    ft.appendChild(ref);
  }
  left.appendChild(ft);

  const img = document.createElement('details');
  img.className = 'co-fs';
  const is = document.createElement('summary');
  is.textContent = 'Consigne d\'illustration (reprise par l\'atelier, image générée seulement à votre demande)';
  img.appendChild(is);
  const gm = coGrid(img);
  it.image ??= { subject: '', details: '', palette: '' };
  coBind(gm, 'Sujet', it.image, 'subject', { max: 300, cls: 'co-span' });
  coBind(gm, 'Détails', it.image, 'details', { max: 600, cls: 'co-span' });
  coBind(gm, 'Palette', it.image, 'palette', { max: 300, cls: 'co-span' });
  left.appendChild(img);

  const dp = document.createElement('p');
  dp.className = 'muted';
  dp.style.fontSize = '0.75rem';
  const dropText = () => {
    const orig = _coProp.data.items[it._k];
    dp.textContent = it.rarity === orig.rarity
      ? `Drop pré-rempli (barème proposé, non validé) : ${it.drop.from.join('/')} dès ${it.drop.minDepth} m · ${+(it.drop.chance * 100).toFixed(3)} % — inactif. Modifiable ensuite dans la fiche de l'objet.`
      : 'Rareté changée : le drop suivra le barème proposé de la nouvelle rareté à l\'enregistrement — inactif.';
  };
  dropText();
  rs.addEventListener('change', () => { it.rarity = rs.value; coPropTouch(); dropText(); refresh(); });
  left.appendChild(dp);
  if (w.editable && n > 1) {
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'btn btn-ghost'; rm.textContent = 'Retirer cet objet de la proposition';
    rm.addEventListener('click', () => {
      if (!confirm(`Retirer « ${it.names.fr || it.id} » de la proposition ? (effectif à l'enregistrement)`)) return;
      w.items.splice(k, 1);
      coPropTouch();
      w.idx = null;
      coPropDraw({ row: Math.min(k, w.items.length - 1) });
    });
    left.appendChild(rm);
  }

  // Aperçu de la fiche joueur, dans la langue éditée
  const prev = document.createElement('div');
  prev.className = 'co-prop-preview';
  prev.setAttribute('aria-live', 'polite');
  const cap = document.createElement('div');
  cap.className = 'muted co-prop-cap';
  cap.textContent = `Aperçu joueur — ${w.lang.toUpperCase()}`;
  const art = document.createElement('div'); art.className = 'co-prop-art';
  const rar = document.createElement('div'); rar.className = 'muted';
  const nm = document.createElement('strong');
  const se = document.createElement('div'); se.className = 'muted'; se.style.fontSize = '0.72rem';
  const sto = document.createElement('p');
  prev.append(cap, art, rar, nm, se, sto);
  const refresh = () => {
    const l = w.lang;
    art.textContent = it.icon || '❔';
    rar.textContent = BK_RARITY[it.rarity] ?? it.rarity;
    nm.textContent = it.names[l] || `${it.names.fr || '(nom FR obligatoire)'}${l === 'fr' ? '' : ` (${l.toUpperCase()} manquant : FR affiché)`}`;
    se.textContent = `${s.icon} ${s.names?.[l] || s.names?.fr || ''}`;
    sto.textContent = it.stories[l] || it.stories.fr || '(pas d\'histoire)';
  };
  refresh();
  wrap.append(left, prev);
  body.appendChild(wrap);

  if (focus?.lang) sw.querySelector(`[data-lang="${focus.lang}"]`)?.focus();
  else if (focus?.nav === 'prev') (bPrev.disabled ? bNext : bPrev).focus();
  else if (focus?.nav === 'next') (bNext.disabled ? bPrev : bNext).focus();
  else if (focus?.first) (w.editable ? nameEl : bBack).focus();
}

/** Corrections de la copie de travail, au format de l'API. */
function coPropRead() {
  const w = _coPropWork, s = w.series;
  const t = (o, l) => String(o?.[l] ?? '').trim();
  const texts = o => Object.fromEntries(CO_LANGS.map(l => [l, t(o, l)]));
  return {
    series: { id: t(s, 'id'), icon: t(s, 'icon'), names: texts(s.names), seasonId: s.seasonId ?? null, seasonWeek: s.seasonWeek ?? null },
    items: w.items.map(it => {
      const orig = _coProp.data.items[it._k];
      return { id: t(it, 'id'), rarity: it.rarity, icon: t(it, 'icon'), names: texts(it.names), stories: texts(it.stories),
        reference: t(it, 'reference'),
        image: { subject: t(it.image, 'subject'), details: t(it.image, 'details'), palette: t(it.image, 'palette') },
        // Drop pré-rempli conservé sauf si la rareté change (il suit alors le barème proposé de la nouvelle rareté)
        drop: it.rarity === orig.rarity ? orig.drop : null };
    }),
  };
}

async function coPropSave() {
  const { ok, data } = await api('PUT', `/api/admin/collections/ai/proposals/${_coProp.id}`, coPropRead());
  if (!ok) { ptMessage('co-prop-msg', data.error || 'Erreur.', false); return null; }
  return data.proposal;
}

/** Réaffiche la proposition enregistrée en restant sur l'objet et la langue en cours. */
function coPropRefresh(p) {
  const { idx, lang } = _coPropWork;
  coPropRender(p);
  if (!_coPropWork) return;
  _coPropWork.lang = lang;
  if (idx != null && idx < _coPropWork.items.length) _coPropWork.idx = idx;
  coPropDraw();
}

document.getElementById('btn-co-prop-save').addEventListener('click', async () => {
  const p = await coPropSave();
  if (!p) return;
  coPropRefresh(p);
  ptMessage('co-prop-msg', 'Corrections enregistrées dans la proposition (pas encore dans le brouillon).', true);
  coAiLoad();
});

document.getElementById('btn-co-prop-draft').addEventListener('click', async () => {
  // Contrôle avant enregistrement : nom FR obligatoire ; traductions manquantes signalées (le serveur revalide tout)
  const w = _coPropWork;
  const k = w.items.findIndex(it => !String(it.names?.fr ?? '').trim());
  if (k >= 0) {
    w.idx = k; w.lang = 'fr'; coPropDraw({ first: true });
    ptMessage('co-prop-msg', `Objet ${k + 1} : le nom FR est obligatoire.`, false);
    return;
  }
  const miss = w.items.filter(it => CO_LANGS.some(l => coLangState(it, l) !== 'ok')).length;
  if (miss && !confirm(`${miss} objet(s) ont un nom ou une histoire manquant dans une langue (pastilles jaunes ou —). Enregistrer quand même dans le brouillon ? Vous pourrez compléter avant de publier.`)) return;
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
let _icFrom = null;      // fiche d'origine quand l'atelier est ouvert depuis Collections { kind: 'item', id }
const _icTyped = {};     // saisies non envoyées, rangées par clé d'icône : chaque fiche ne retrouve que les siennes
const IC_INSTRUCTION_MAX = 1000;   // = serveur (INSTRUCTION_MAX, iconStudio.js)
let _icConflict = null;  // génération refusée pour conflit de sujet { key, instruction, basedOn, conflicts }
let _icBriefEls = null;  // champs de la consigne d'illustration de la fiche affichée (objets)
const IC_ACTIONS = { generated: 'Image générée', uploaded: 'Image téléversée', chosen: 'Retenue', rejected: 'Écartée', restored: 'Remise en proposition',
  validated: 'Verrouillée (validée)', applied: 'Conservée dans le brouillon', reverted_to_emoji: 'Retour à l\'emoji (brouillon)', brief: 'Description modifiée' };
const IC_BG_RE = /^linear-gradient\(\d+deg,\s*#[0-9a-f]{6},\s*#[0-9a-f]{6}\)$/i;
const icEnc = k => encodeURIComponent(k);
/** Date de la base (UTC, « AAAA-MM-JJ HH:MM:SS ») affichée à l'heure de Bruxelles. */
const _icFmt = new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function icWhen(utc, short = false) {
  const d = new Date(`${String(utc ?? '').replace(' ', 'T').replace(/Z?$/, 'Z')}`);
  if (Number.isNaN(d.getTime())) return String(utc ?? '');
  const s = _icFmt.format(d).replace(',', '');
  return short ? s.replace(/\/\d{4}/, '') : s;
}

/** Bandeau « nouvelle version en ligne » : le panel ouvert avant un déploiement doit être rechargé. */
function admStaleBanner(version) {
  if (document.getElementById('adm-stale')) return;
  const b = aiEl('div', { id: 'adm-stale', class: 'adm-stale', role: 'alert' });
  b.appendChild(aiEl('span', {}, `Une nouvelle version du jeu est en ligne (${version}) ; ce panel date de ${ADMIN_BUILD || 'une version précédente'}. `
    + 'Rechargez la page avant de générer ou d\'enregistrer.'));
  const r = aiEl('button', { type: 'button', class: 'btn' }, 'Recharger');
  r.addEventListener('click', () => location.reload());
  b.appendChild(r);
  document.body.prepend(b);
}
setInterval(async () => {
  try {
    const v = (await (await fetch('/api/version', { cache: 'no-store' })).json()).version;
    if (v && ADMIN_BUILD && v !== ADMIN_BUILD) admStaleBanner(v);
  } catch (_) { /* hors ligne : on réessaiera */ }
}, 60000);

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
  if (_icJob?.status === 'running' && _icJob.kind === 'series') {
    const todo = _icJob.items.filter(i => ['pending', 'running', 'done', 'review', 'failed'].includes(i.state));
    const cur = todo.findIndex(i => i.state === 'running');
    return icNotice(el, `⏳ Collection « ${_icJob.name} » : image ${cur + 1}/${todo.length}${cur >= 0 ? ` (« ${todo[cur].name} »)` : ''} en cours. `
      + 'La génération continue sur le serveur si vous quittez cette page.', 'info');
  }
  if (_icJob?.status === 'running') return icNotice(el, `⏳ Génération en cours pour « ${_icJob.name} »… (environ une minute)`, 'info');
  if (s && !s.configured) return icNotice(el, 'Génération d\'images indisponible : l\'API n\'est pas configurée sur le serveur. Le téléversement d\'une image reste possible.', 'warn');
  if (s?.budgetReached) return icNotice(el, icBudgetHelp(s), 'warn');
  if (s?.fake) return icNotice(el, 'Mode test : aucune image réelle n\'est générée.', 'info');
  icNotice(el, '');
}

/** Trois chiffres distincts (retour du 03/11) : coût réel d'une image, cumul de toutes les générations, plafond. */
function icReserveText(s) {
  const r = s.reserve;
  if (!r) return '';
  return r.basis === 'measured'
    ? `réservation ${r.usd.toFixed(2)} USD par image (coût réel le plus élevé des ${r.samples} dernières : ${r.measuredMaxUsd.toFixed(3)} USD, + 25 %)`
    : `réservation ${r.usd.toFixed(2)} USD par image (estimation configurée, en attendant 2 coûts réels mesurés)`;
}
function icBudgetHelp(s) {
  const last = s.lastImage ? ` Coût réel de la dernière image : ${Number(s.lastImage.cost_usd).toFixed(3)} USD.` : '';
  const head = `Plafond atteint : la prochaine image n'est pas lancée (${icReserveText(s)}, il reste ${s.remainingUsd.toFixed(2)} USD).${last} `;
  return head + (s.limitedBy === 'studio'
    ? `Limite de l'atelier : ${s.studioSpentUsd.toFixed(2)} / ${s.studioCapUsd} USD cumulés. Pour continuer, relevez cette limite dans ⚙ Config → Budget IA.`
    : `Plafond du serveur : ${s.globalSpentUsd.toFixed(2)} / ${s.globalCapUsd} USD cumulés depuis le début (toutes les générations, scripts et blocs compris ; ce n'est pas le coût d'une image). `
      + 'Pour continuer, relevez DIG_IMAGE_BUDGET_USD dans ~/.config/dig/openai.env (pris en compte sans redémarrage).');
}

async function loadIcons() {
  const { ok, data } = await api('GET', '/api/admin/icons');
  if (!ok) { icNotice(document.getElementById('ic-notice'), data.error || 'Erreur.', 'error'); return; }
  _ic = data;
  icSetJob(data.job);
  icRenderGrid();
  const s = data.status;
  document.getElementById('ic-tech').textContent = s.configured
    ? `Modèle ${s.imageModel}${s.fake ? ' (mode test)' : ''} · ${s.lastImage ? `dernière image : ${Number(s.lastImage.cost_usd).toFixed(3)} USD · ` : ''}${icReserveText(s)} · ${s.imagesToday}/${s.maxImagesPerDay} images sur 24 h · référence de style : ${s.reference ?? 'aucune'}.`
    : `API non configurée : ${s.reason}.`;
  const cb = document.getElementById('ic-calls-body');
  cb.textContent = '';
  for (const c of data.calls) {
    const tr = document.createElement('tr');
    [icWhen(c.created_at), c.target.startsWith('check:') ? `${c.target.slice(6)} (contrôle du sujet)` : c.target, c.model, c.ok ? 'OK' : `Échec : ${c.error ?? ''}`, `${c.cost_usd} USD`,
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
  icRenderSeries();
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

// ── Collection entière : une image par objet sans image, enchaînées (demande du 02/11) ──

const IC_BATCH_STATES = {
  pending: ['En attente', ''], running: ['⏳ En cours', 'info'], done: ['✓ À examiner', 'ok'], review: ['⚠ À revoir', 'warn'],
  failed: ['✗ Échec', 'error'], conflict: ['⚠ Conflit de sujet', 'warn'], not_run: ['⏸ Non lancée', 'warn'], cancelled: ['⏹ Arrêtée', ''],
  has_image: ['Image déjà dans le brouillon', ''], has_proposal: ['Proposition à examiner', ''],
};
const icUsd = v => (v == null ? '?' : `${Number(v).toFixed(2).replace('.', ',')} USD`);

function icRenderSeries() {
  const box = document.getElementById('ic-series');
  if (!box) return;
  box.textContent = '';
  const kind = document.getElementById('ic-kind').value;
  if ((kind && kind !== 'item') || !_ic?.series?.length) return;
  const running = _icJob?.status === 'running';
  const head = aiEl('div', { class: 'ic-series-head' });
  head.appendChild(aiEl('strong', {}, 'Collections : une image par objet, enchaînées automatiquement'));
  head.appendChild(aiEl('span', { class: 'muted' }, ' — seuls les objets sans image ni proposition à examiner sont générés ; vous ne corrigez ensuite que ceux signalés.'));
  box.appendChild(head);
  for (const p of _ic.series) {
    const row = aiEl('div', { class: 'ic-series-row' });
    row.appendChild(aiEl('span', { class: 'ic-series-name' }, `${p.icon ?? ''} ${p.name}`));
    const n = k => p.items.filter(i => i.state === k).length;
    const parts = [`${p.items.length} objets`, p.todo ? `${p.todo} à générer` : 'aucun à générer',
      n('has_image') && `${n('has_image')} avec image`, n('has_proposal') && `${n('has_proposal')} à examiner`, n('conflict') && `${n('conflict')} en conflit de sujet`].filter(Boolean);
    row.appendChild(aiEl('span', { class: 'muted' }, parts.join(' · ')));
    if (p.todo) {
      const b = icButton(row, `Générer les ${p.todo} image${p.todo > 1 ? 's' : ''} manquante${p.todo > 1 ? 's' : ''}`, () => icSeriesStart(p.seriesId), 'btn ic-main');
      b.disabled = running || !_ic.status?.configured;
    }
    box.appendChild(row);
  }
  const j = _icJob?.kind === 'series' ? _icJob : null;
  if (j) box.appendChild(icBatchPanel(j));
}

function icBatchPanel(j) {
  const panel = aiEl('div', { class: 'ic-batch', role: 'region', 'aria-label': `Génération de la collection ${j.name}` });
  const c = k => j.items.filter(i => i.state === k).length;
  const made = c('done') + c('review');
  const title = j.status === 'running' ? `⏳ Collection « ${j.name} » en cours`
    : j.status === 'cancelled' ? `⏹ Collection « ${j.name} » arrêtée à votre demande`
    : j.status === 'stopped' ? `⏸ Collection « ${j.name} » arrêtée avant la fin` : `✓ Collection « ${j.name} » terminée`;
  panel.appendChild(aiEl('p', { class: 'ic-batch-title' }, title));
  const sum = [`${made} image${made > 1 ? 's' : ''} générée${made > 1 ? 's' : ''} (${icUsd(j.spentUsd)})`,
    c('review') && `${c('review')} à revoir`, c('failed') && `${c('failed')} en échec`, c('conflict') && `${c('conflict')} en conflit`,
    c('not_run') && `${c('not_run')} non lancée${c('not_run') > 1 ? 's' : ''}`, c('cancelled') && `${c('cancelled')} arrêtée${c('cancelled') > 1 ? 's' : ''}`].filter(Boolean);
  panel.appendChild(aiEl('p', { class: 'muted' }, `${sum.join(' · ')}. Commencé le ${icWhen(j.startedAt)} (heure de Bruxelles). Ouvrez un objet pour conserver, refaire ou écarter son image : rien n'est conservé ni publié automatiquement.`));
  if (j.stopReason) panel.appendChild(aiEl('p', { class: 'ic-notice ic-notice--warn' }, j.stopReason));
  if (j.status === 'running') {
    const bar = aiEl('div', { class: 'ic-row' });
    icButton(bar, j.cancelRequested ? 'Arrêt demandé…' : '⏹ Arrêter après l\'image en cours', async () => {
      const { ok, data } = await api('POST', '/api/admin/icons/job/cancel', {});
      if (ok) icSetJob(data.job);
    }).disabled = !!j.cancelRequested;
    panel.appendChild(bar);
  }
  const grid = aiEl('div', { class: 'ic-batch-grid' });
  for (const it of j.items) {
    const [label, tone] = IC_BATCH_STATES[it.state] ?? [it.state, ''];
    const t = (_ic?.targets ?? []).find(x => x.key === it.key) ?? { kind: 'item', emoji: '⬜' };
    const card = aiEl('button', { type: 'button', class: `ic-batch-item${tone ? ` ic-batch-item--${tone}` : ''}`, 'aria-label': `Ouvrir la fiche ${it.name} : ${label}` });
    card.appendChild(icThumb(t, 64, it.url));
    card.appendChild(aiEl('span', { class: 'ic-card-name' }, it.name));
    card.appendChild(aiEl('span', { class: 'ic-batch-state' }, label));
    const detail = it.check?.seen ? `Contrôle : « ${it.check.seen} »` : it.error ?? (['conflict', 'not_run'].includes(it.state) ? it.reason : '');
    if (detail) card.appendChild(aiEl('span', { class: 'muted ic-batch-detail', title: detail }, detail));
    if (it.durationMs) card.appendChild(aiEl('span', { class: 'muted ic-batch-detail' }, `${Math.round(it.durationMs / 1000)} s · ${icUsd(it.costUsd)}`));
    card.addEventListener('click', () => icOpen(it.key));
    grid.appendChild(card);
  }
  panel.appendChild(grid);
  return panel;
}

async function icSeriesStart(seriesId) {
  const { ok, data } = await api('GET', `/api/admin/icons/series/${icEnc(seriesId)}`);
  const el = document.getElementById('ic-notice');
  if (!ok) return icNotice(el, data.error || 'Erreur.', 'error');
  const p = data.plan;
  const todo = p.items.filter(i => i.state === 'todo');
  const skipped = p.items.filter(i => i.state !== 'todo').map(i => `${i.name} (${IC_BATCH_STATES[i.state]?.[0] ?? i.state}${i.state === 'conflict' ? ' : à corriger dans sa fiche' : ''})`);
  const measured = p.measuredPerImageUsd != null ? `≈ ${icUsd(p.measuredPerImageUsd)} par image constatés, soit ≈ ${icUsd(p.measuredPerImageUsd * todo.length)}` : 'coût réel encore inconnu';
  const msg = [`Générer UNE image pour chacun des ${todo.length} objets de « ${p.name} » ?`, '',
    `• Objets : ${todo.map(i => i.name).join(', ')}.`,
    skipped.length ? `• Ignorés : ${skipped.join(' ; ')}.` : '',
    `• Coût : ${measured} (réservé avant chaque image : ${icUsd(p.estPerImageUsd)}, contrôle compris).`,
    `• Budget restant sous le plafond : ${icUsd(p.remainingUsd)} → ${p.affordable >= todo.length ? 'suffisant' : `au moins ${p.affordable} image(s) ; la génération s'arrêtera d'elle-même au plafond, qui n'est jamais relevé automatiquement`}.`,
    `• Durée : ${p.measuredSeconds ? `≈ ${p.measuredSeconds} s` : 'environ 40 s'} par image, l'une après l'autre ; vous pouvez quitter la page.`,
    '• Chaque image est contrôlée automatiquement (objet reconnu ?). Rien n\'est conservé ni publié sans vous.'].filter(Boolean).join('\n');
  if (!confirm(msg)) return;
  const r = await api('POST', `/api/admin/icons/series/${icEnc(seriesId)}/generate`, { target: `series:${seriesId}` });
  if (!r.ok) {
    if (r.data.details?.code === 'stale_client') admStaleBanner(r.data.details.version);
    return icNotice(el, r.data.error || 'Erreur.', 'error');
  }
  icSetJob(r.data.job);
}

function icShowList() {
  _icOpen = null; _icSel = null; _icTarget = null; _icNote = null; _icConflict = null;
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
  icRenderSeries();
  if (_icTarget) icRenderSheet();
}

/**
 * Lance UNE génération pour la fiche `key` (jamais « la fiche ouverte au retour de la requête ») ; la
 * clé est aussi envoyée dans le corps et vérifiée par le serveur. Conflit de sujet ou panel obsolète :
 * refus sans dépense, expliqué dans la fiche.
 */
async function icGenerate(key, instruction, basedOn, acknowledge = []) {
  _icConflict = null;
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(key)}/generate`, { target: key, instruction, basedOn, acknowledge });
  if (!ok) {
    if (data.details?.code === 'stale_client') admStaleBanner(data.details.version);
    if (data.details?.code === 'subject_conflict') _icConflict = { key, instruction, basedOn, conflicts: data.details.conflicts };
    if (_icOpen === key) { _icNote = { text: data.error || 'Erreur.', ok: false }; icRenderSheet(); }
    return;
  }
  if (_icTyped[key]) delete _icTyped[key].instruction;   // précision envoyée : elle n'est pas réutilisée
  if (_icOpen === key) {
    _icNote = null;
    const box = document.getElementById('ic-sheet');
    const field = box.dataset.key === key ? box.querySelector('#ic-instruction') : null;
    if (field) field.value = '';
  }
  icSetJob(data.job);
}

// ── Fiche d'une icône ──

async function icOpen(key, { keepSel = false } = {}) {
  if (_icOpen !== key) { _icSel = null; _icNote = null; _icConflict = null; }
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

const IC_HINTS = {
  block: 'ex. minerai bleu vif aux reflets métalliques',
  item: 'ex. vue de trois quarts, reflets plus chauds',
  badge: 'ex. médaille plus brillante, symbole plus simple',
  ui: 'ex. trait plus épais, couleurs plus vives',
};

/** Retour à la fiche de l'objet d'origine, rechargée (l'atelier a pu changer son image dans le brouillon). */
async function icBackToItem(id) {
  _co = null;
  document.querySelector('.tab-btn[data-tab="collections"]').click();
  for (let k = 0; k < 50 && !_co; k++) await new Promise(r => setTimeout(r, 100));
  const it = _co && coWorking().items.find(x => x.id === id);
  if (it) coOpenItem(it, document.querySelector(`[data-adm-key="${CSS.escape(`co-item:${id}`)}"]`));
}

/**
 * Consigne d'illustration d'un objet (sujet, forme, couleurs) : celle préparée avec la collection, ou à
 * défaut tirée du nom et de l'histoire. Modifiable ; enregistrée seulement au clic sur « Générer ».
 */
function icItemBrief(parent, t) {
  const memo = (_icTyped[t.key] ??= {});
  const wrap = aiEl('div', { class: 'ic-item-brief' });
  wrap.appendChild(aiEl('h4', {}, 'Consigne d\'illustration de cet objet'));
  wrap.appendChild(aiEl('p', { class: 'muted ic-hint' }, t.brief.custom
    ? 'Préparée avec la collection, modifiable. Elle accompagne chaque génération ; aucune image n\'est créée sans clic sur « Générer ».'
    : 'Tirée du nom et de l\'histoire de l\'objet, modifiable. Aucune image n\'est créée sans clic sur « Générer ».'));
  const els = {};
  if (t.briefIgnored) {
    // Consigne répétée pour plusieurs objets (importation d'une collection) : jamais utilisée, la fiche repart du nom
    wrap.appendChild(aiEl('p', { class: 'ic-notice ic-notice--warn' }, `⚠ La consigne enregistrée pour cet objet est la même que pour ${t.briefSharedWith.join(', ')} `
      + `(« ${t.brief.ignored?.subject ?? ''} ») : elle n'est pas utilisée. La consigne ci-dessous repart du nom et de l'histoire de « ${t.name} » ; complétez-la si besoin.`));
  } else if (t.briefSharedWith?.length) {
    const w = aiEl('div', { class: 'ic-notice ic-notice--info' });
    w.appendChild(aiEl('p', {}, `ℹ ${t.briefSharedWith.join(', ')} portent encore cette même consigne : elle n'est utilisée que pour « ${t.name} », eux repartent de leur nom et de leur histoire.`));
    icButton(w, 'Repartir du nom et de l\'histoire', async () => {
      for (const k of Object.keys(els)) { els[k].value = t.defaultBrief?.[k] ?? ''; memo[k] = els[k].value; }
      els.subject.focus();
    });
    wrap.appendChild(w);
  }
  const state = aiEl('p', { class: 'muted ic-hint ic-brief-state' });
  const refresh = () => {
    const changed = Object.entries(els).some(([k, el]) => el.value.trim() !== String(t.brief[k] ?? '').trim());
    state.textContent = changed ? '✎ Modifiée, pas encore enregistrée : elle sera enregistrée pour cet objet au clic sur « Générer ».'
      : t.brief.custom ? '✓ Enregistrée pour cet objet.' : 'Consigne par défaut (nom et histoire de l\'objet), rien d\'enregistré.';
    state.classList.toggle('is-dirty', changed);
  };
  for (const [k, label, max] of [['subject', 'Sujet', 300], ['details', 'Forme et matière', 600], ['palette', 'Couleurs', 300]]) {
    const [l, el] = aiInput(label, memo[k] ?? t.brief[k], { maxlength: String(max) });
    l.classList.add('ic-field');
    el.addEventListener('input', () => { memo[k] = el.value; refresh(); icLiveConflict(); });
    els[k] = el;
    wrap.appendChild(l);
  }
  refresh();
  wrap.appendChild(state);
  parent.appendChild(wrap);
  return els;
}

/** Enregistre la consigne de l'objet si elle a été modifiée (avant de générer). */
async function icSaveItemBrief(t, els) {
  const b = Object.fromEntries(Object.entries(els).map(([k, el]) => [k, el.value.trim()]));
  if (b.subject === t.brief.subject && b.details === (t.brief.details ?? '') && b.palette === (t.brief.palette ?? '')) return true;
  const { ok, data } = await api('PUT', `/api/admin/icons/targets/${icEnc(t.key)}/brief`, b);
  if (!ok) { if (_icOpen === t.key) { _icNote = { text: data.error || 'Erreur.', ok: false }; icRenderSheet(); } return false; }
  t.brief = data.brief;
  t.briefSharedWith = data.brief.sharedWith ?? [];
  t.briefIgnored = false;
  for (const k of Object.keys(els)) delete _icTyped[t.key]?.[k];
  return true;
}

/**
 * Lecture du sujet pendant la saisie (recettes des 02 et 03/11) : le serveur applique la même règle qu'à
 * la génération (référence de style et motif autorisés, demande de dessiner un autre objet refusée).
 * Aucun appel IA ; le serveur reste seul juge au clic sur « Générer ».
 */
let _icLiveTimer = null, _icLiveSeq = 0;
function icLiveConflict() {
  clearTimeout(_icLiveTimer);
  _icLiveTimer = setTimeout(icLiveConflictNow, 350);
}
async function icLiveConflictNow() {
  const out = document.getElementById('ic-live-conflict');
  const t = _icTarget;
  if (!out || !t?.identity) return;
  const key = t.key, seq = ++_icLiveSeq;
  const instruction = document.getElementById('ic-instruction')?.value ?? '';
  const els = _icBriefEls ?? {};
  const body = { instruction, ...(els.subject ? { subject: els.subject.value, details: els.details?.value ?? '' } : {}) };
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(key)}/subject-check`, body);
  if (!ok || seq !== _icLiveSeq || _icTarget?.key !== key || !document.body.contains(out)) return;
  const lines = [];
  if (data.conflicts?.length) {
    lines.push(`⚠ ${data.conflicts.map(c => `« ${c.term} » (objet « ${c.name} »)${c.context === 'replace' ? ' : demande de dessiner un autre objet' : ''}`).join(', ')}. `
      + `Cette fiche est « ${t.name} » : la génération sera refusée sans dépense${data.conflicts.every(c => !c.strict) ? ' (sauf confirmation)' : ''}.`);
  }
  if (data.references?.length) {
    lines.push(`✓ Autorisé : ${data.references.map(r => `« ${r.term} » lu comme ${r.reason}`).join(', ')}.`);
  }
  out.textContent = lines.join(' ');
  out.classList.toggle('hidden', !lines.length);
  out.classList.toggle('ic-notice--warn', !!data.conflicts?.length);
  out.classList.toggle('ic-notice--info', !data.conflicts?.length);
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
  // Saisie en cours reprise seulement si la fiche affichée est celle du même objet (jamais d'un objet à l'autre)
  const typed = box.dataset.key === t.key ? box.querySelector('#ic-instruction')?.value ?? '' : '';
  box.textContent = '';
  box.dataset.key = t.key;
  const st = icState(t);
  const running = _icJob?.status === 'running';
  const mine = running && (_icJob.target === t.key || (_icJob.kind === 'series' && _icJob.items.some(i => i.key === t.key && i.state === 'running')));
  const canGenerate = !!_ic?.status?.configured && !_ic?.status?.budgetReached && !running;
  const sel = t.assets.find(a => a.sha === _icSel) ?? null;

  // En-tête : retour, nom, état
  const head = aiEl('div', { class: 'ic-sheet-head' });
  icButton(head, '← Toutes les icônes', async () => icShowList());
  if (_icFrom?.kind === 'item' && t.key === `item:${_icFrom.id}`) icButton(head, '← Retour à la fiche de l\'objet', () => icBackToItem(_icFrom.id));
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
  fig(icThumb(t, 160), !t.applicable ? 'Actuelle' : t.neverPublished ? 'Actuelle (objet en brouillon, jamais publié)'
    : t.unpublished ? 'Actuelle (brouillon, pas encore en jeu)' : 'Actuelle en jeu');
  if (mine) {
    const wait = aiEl('span', { class: 'bk-thumb ic-thumb ic-wait', style: 'width:160px;height:160px;border-radius:26px' });
    wait.appendChild(aiEl('span', { class: 'ic-spinner', 'aria-hidden': 'true' }));
    fig(wait, 'Génération en cours… (environ une minute)');
  } else if (sel) {
    const where = sel.published ? 'en jeu' : sel.inDraft ? 'dans le brouillon' : sel.status === 'rejected' ? 'écartée' : 'proposition';
    const f = fig(icThumb(t, 160, sel.url), `${sel.source === 'ai' ? 'Proposition' : 'Image téléversée'} du ${icWhen(sel.createdAt)} (heure de Bruxelles) — ${where}`);
    if (sel.source === 'ai') {
      // Provenance lisible : objet demandé (catalogue), version du prompt, précision de cette génération
      f.appendChild(aiEl('p', { class: 'muted ic-fig-note' }, sel.identity
        ? `Objet demandé à l'IA : « ${sel.identity.fr ?? sel.identity.name} » (${sel.identity.name}) · prompt ${sel.promptVersion}`
        : `Prompt ${sel.promptVersion ?? 'v1.0'} : ancienne version, le nom de l'objet n'était pas transmis à l'IA.`));
    }
    if (sel.instruction) f.appendChild(aiEl('p', { class: 'muted ic-fig-note' }, `Précision de cette génération : « ${sel.instruction} »`));
    const sc = sel.subjectCheck;
    if (sc?.error) f.appendChild(aiEl('p', { class: 'muted ic-fig-note' }, 'Contrôle automatique du sujet indisponible pour cette image : vérifiez-la vous-même.'));
    else if (sc?.matches) f.appendChild(aiEl('p', { class: 'success ic-fig-note' }, `✓ Contrôle automatique : l'image montre « ${sc.seen} ».`));
    else if (sc) f.appendChild(aiEl('p', { class: 'ic-notice ic-notice--warn' }, `⚠ Contrôle automatique : l'image semble montrer « ${sc.seen} », pas « ${t.name} ». Refaites-la (précisez la forme attendue) ou écartez-la.`));
    if (sel.warning) f.appendChild(aiEl('p', { class: 'ic-notice ic-notice--warn' }, `⚠ ${sel.warning.text} Ne la conservez pas : générez-en une nouvelle.`));
  } else {
    const empty = aiEl('span', { class: 'bk-thumb ic-thumb bk-thumb--none', style: 'width:160px;height:160px;border-radius:26px;font-size:2.2rem' }, '＋');
    fig(empty, 'Aucune proposition pour l\'instant');
  }
  box.appendChild(cmp);

  // Étape en cours : une seule action principale
  const step = aiEl('div', { class: 'ic-step' });
  const note = aiEl('p', { class: _icNote ? (_icNote.ok ? 'success' : 'error') : 'form-msg', role: 'status' }, _icNote?.text ?? '');
  // Consigne multiligne qui s'agrandit avec le texte, compteur visible (recette du 02/11 : une ligne trop étroite)
  const field = (label, placeholder) => {
    const l = aiEl('label', { class: 'ic-field' }, label);
    const i = aiEl('textarea', { id: 'ic-instruction', class: 'ic-textarea', rows: '3', maxlength: String(IC_INSTRUCTION_MAX), placeholder });
    i.value = _icTyped[t.key]?.instruction ?? typed;
    const count = aiEl('span', { class: 'muted ic-charcount', 'aria-live': 'polite' });
    const grow = () => {
      i.style.height = 'auto';
      i.style.height = `${Math.min(i.scrollHeight + 2, 420)}px`;
      count.textContent = `${i.value.length} / ${IC_INSTRUCTION_MAX} caractères · Ctrl+Entrée pour lancer`;
      count.classList.toggle('is-full', i.value.length >= IC_INSTRUCTION_MAX);
    };
    i.addEventListener('input', () => { (_icTyped[t.key] ??= {}).instruction = i.value; grow(); icLiveConflict(); });
    l.appendChild(i);
    l.appendChild(count);
    step.appendChild(l);
    requestAnimationFrame(grow);
    return i;
  };
  const why = running && !mine ? `Une autre icône est en cours de génération (« ${_icJob.name} »).`
    : !_ic?.status?.configured ? 'Génération indisponible (API non configurée) : utilisez « Téléverser une image » dans les options.'
    : _ic?.status?.budgetReached ? icBudgetHelp(_ic.status) : '';
  if (!sel || mine) {
    // Objet de collection : la consigne d'illustration préparée est affichée ici, préremplie et modifiable
    const briefEls = t.kind === 'item' ? icItemBrief(step, t) : null;
    _icBriefEls = briefEls;
    const i = field(briefEls ? 'Précision supplémentaire (facultative, pour cette seule génération, non enregistrée)' : 'Consigne (facultative)', IC_HINTS[t.kind] ?? IC_HINTS.ui);
    if (t.identity) step.appendChild(aiEl('p', { class: 'muted ic-hint' }, `L'IA reçoit toujours en premier l'objet du catalogue : « ${t.identity.fr ?? t.identity.name} » (${t.identity.name}). `
      + 'Une précision ou une consigne qui cite un autre objet est refusée avant toute dépense.'));
    step.appendChild(aiEl('p', { class: 'ic-notice ic-notice--warn hidden', id: 'ic-live-conflict', role: 'status' }));
    const key = t.key;
    const g = icButton(step, '✨ Générer une image', async () => {
      if (briefEls && !(await icSaveItemBrief(t, briefEls))) return;
      if (_icOpen !== key) return;   // fiche quittée pendant l'enregistrement : rien n'est lancé
      await icGenerate(key, i.value, null);
    }, 'btn ic-main');
    g.disabled = !canGenerate;
  } else {
    const row = aiEl('div', { class: 'form-actions' });
    if (t.applicable && !sel.inDraft) {
      icButton(row, '✓ Conserver cette image', () => icApply(t, sel.sha, { doubtful: !!sel.warning }), sel.warning ? 'btn btn-outline' : 'btn ic-main');
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
    const r = icButton(redo, '↻ Refaire', () => icGenerate(t.key, i.value, sel.sha));
    r.disabled = !canGenerate;
    _icBriefEls = null;
    step.appendChild(aiEl('p', { class: 'ic-notice ic-notice--warn hidden', id: 'ic-live-conflict', role: 'status' }));
    step.appendChild(redo);
  }
  if (why && !mine) step.appendChild(aiEl('p', { class: 'muted ic-why' }, why));
  step.appendChild(note);
  // Conflit de sujet probable (nom principal d'un autre objet) : confirmation explicite possible ;
  // nom complet d'un autre objet : aucun contournement, il faut retirer la mention.
  const cf = _icConflict?.key === t.key ? _icConflict : null;
  if (cf && cf.conflicts.every(c => !c.strict)) {
    icButton(step, `Ce n'est pas un autre objet : générer « ${t.name} » quand même`,
      () => icGenerate(t.key, cf.instruction, cf.basedOn, cf.conflicts.map(c => c.id)));
  }
  if (t.subjectReferences?.length && !t.subjectConflicts?.length) step.appendChild(aiEl('p', { class: 'muted ic-hint' },
    `✓ La consigne enregistrée cite ${t.subjectReferences.map(r => `« ${r.term} » (${r.reason})`).join(', ')} : autorisé, ce n'est pas un changement de sujet.`));
  if (t.subjectConflicts?.length) step.appendChild(aiEl('p', { class: 'ic-notice ic-notice--warn' },
    `⚠ La consigne d'illustration enregistrée mentionne ${t.subjectConflicts.map(c => `« ${c.term} » (objet « ${c.name} »)`).join(', ')} : corrigez-la avant de générer.`));
  box.appendChild(step);

  // Propositions précédentes : comparer et revenir à l'une d'elles
  if (t.assets.length) {
    const strip = aiEl('div', { class: 'ic-strip-wrap' });
    strip.appendChild(aiEl('h4', {}, `Propositions (${t.assets.length})`));
    const row = aiEl('div', { class: 'ic-strip' });
    for (const a of t.assets) {
      const b = aiEl('button', { type: 'button', class: `ic-strip-item${a.sha === _icSel ? ' is-sel' : ''}${a.status === 'rejected' ? ' is-rejected' : ''}`,
        'aria-pressed': String(a.sha === _icSel), title: [a.warning?.text, a.instruction ? `Précision : ${a.instruction}` : ''].filter(Boolean).join(' — ') });
      b.appendChild(icThumb(t, 64, a.url));
      b.appendChild(aiEl('span', {}, a.published ? 'En jeu' : a.inDraft ? 'Brouillon' : a.status === 'rejected' ? 'Écartée' : `${a.warning || a.subjectCheck?.matches === false ? '⚠ ' : ''}${icWhen(a.createdAt, true)}`));
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
  icLiveConflict();
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
    if (ok) delete _icTyped[t.key];
    say(ok ? 'Description enregistrée.' : (data.error || 'Erreur.'), ok);
    if (ok) icOpen(t.key, { keepSel: true }); else icRenderSheet();
  });
  if (t.brief.custom) icButton(ba, 'Description par défaut', async () => {
    const { ok, data } = await api('PUT', `/api/admin/icons/targets/${icEnc(t.key)}/brief`, { reset: true });
    if (ok) delete _icTyped[t.key];
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
    addCell(tr, icWhen(h.at));
    addCell(tr, `${IC_ACTIONS[h.action] ?? h.action}${h.details?.identity ? ` (objet demandé : ${h.details.identity})` : ''}${h.details?.instruction ? ` — précision « ${h.details.instruction} »` : ''}`);
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
async function icApply(t, sha, { doubtful = false } = {}) {
  if (doubtful && !confirm(`Cette proposition est douteuse (sa demande citait un autre objet). La conserver quand même pour « ${t.name} » ?`)) return;
  let override = false;
  if (t.validated) {
    if (!confirm(`L'icône de « ${t.name} » est VALIDÉE. La remplacer quand même (accord explicite, tracé) ?`)) return;
    override = true;
  }
  // Badge (#38) : pas de brouillon ; sur un badge actif, l'image est visible tout de suite → confirmation
  const live = t.kind === 'badge' && / active$/.test(String(t.extra ?? ''));
  if (live && !confirm(`Le badge « ${t.name} » est ACTIF : cette image sera visible immédiatement par les joueurs. Continuer ?`)) return;
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(t.key)}/apply`, { sha, override, live, doubtful });
  const where = data.catalog === 'blocks' ? '🧱 Blocs' : '📿 Collections';
  const done = data.catalog === 'badges'
    ? `${sha ? 'Image enregistrée' : 'Emoji rétabli'} sur le badge${data.draft ? ' (désactivé : les joueurs la verront après son activation dans 🏅 Badges)' : ' (actif : visible par les joueurs)'}.`
    : `${sha ? 'Image conservée' : 'Emoji d\'origine rétabli'} dans le brouillon. Les joueurs la verront après la publication dans l'onglet ${where}.`;
  _icNote = { text: ok ? done : (data.error || 'Erreur.'), ok };
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
  } else if (t.kind === 'badge') {
    // Ligne de la section « 🏅 Badges et succès » (Collection) et grande taille
    const row = aiEl('div', { style: 'display:flex;gap:10px;align-items:center;width:100%;background:#1f2937;border:1px solid rgba(245,197,24,0.22);border-radius:12px;padding:10px' });
    row.appendChild(aiEl('img', { src: url, alt: '', width: '40', height: '40', style: 'object-fit:contain' }));
    row.appendChild(aiEl('span', { style: 'font-size:0.8rem;font-weight:600' }, t.name));
    phone.appendChild(row);
    phone.appendChild(aiEl('img', { src: url, alt: '', width: '112', height: '112', style: 'object-fit:contain' }));
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
// Ctrl+Entrée (ou ⌘+Entrée) dans le champ de consigne = action principale ; Entrée seule = retour à la ligne
document.getElementById('ic-sheet').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.target.id !== 'ic-instruction') return;
  e.preventDefault();
  // « Refaire » quand il existe (jamais « Conserver cette image », placé avant dans la page), sinon « Générer »
  const step = e.target.closest('.ic-step');
  (step?.querySelector('.ic-redo .btn') ?? step?.querySelector('.ic-main'))?.click();
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
    + ` · reste ${usd(s.remainingUsd)}, soit au moins ${Math.floor(s.remainingUsd / (s.perImageUsd || s.estImageUsd) + 1e-9)} image(s).`
    + ` Le montant dépensé est le cumul de toutes les générations depuis le début, pas le coût d'une image`
    + `${s.lastImage ? ` (dernière image : ${Number(s.lastImage.cost_usd).toFixed(3)} USD)` : ''} ; ${icReserveText(s)}.`;
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
// UX commune (31/10) : la page montre d'abord les badges ; « ＋ Ajouter un badge » → choix IA / manuel ;
// clic sur une ligne → fiche (consultation, modification, activation). Un nouveau badge est toujours
// enregistré DÉSACTIVÉ. La même fiche sert à relire une proposition IA (mode « proposition »).

const BG_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const BG_COND = {
  max_depth: 'Profondeur ≥ {n} m', blocks_of_type: '{block} ≥ {n}', blocks_total: 'Blocs minés ≥ {n}',
  distinct_types: 'Types différents ≥ {n}', chests_opened: 'Coffres ouverts ≥ {n}', play_days: 'Jours de jeu ≥ {n}',
};
const BG_METRIC_FR = {
  max_depth: 'Profondeur maximale retenue par le serveur (mètres).',
  blocks_total: 'Nombre total de blocs minés (crédités dans la limite des mètres validés).',
  blocks_of_type: 'Blocs d\'un type précis minés (type publié et atteignable).',
  distinct_types: 'Nombre de types de blocs différents minés au moins une fois.',
  chests_opened: 'Coffres ouverts en minant (les coffres achetés en boutique ne comptent pas).',
  play_days: 'Jours calendaires distincts (Bruxelles, pas forcément consécutifs) avec au moins un bloc miné.',
};
const BG_STATUS = { active: 'actif', inactive: 'désactivé', archived: 'archivé' };
const BG_AI_STATE = { pending: '⏳ génération en cours', open: 'à relire', error: 'échec', in_draft: 'badge créé (désactivé)' };
const BG_IMAGE_RE = /^(\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)|\/media\/(blocks|icons)\/[a-f0-9]{16}\.webp|\/api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp))$/;
let _bgData = null;
let _bgAi = null;
let _bgAiTimer = null;
let _bgSheet = null;     // { mode: 'new' | 'edit' | 'proposal', badge?, proposal? }

function bgCondLabel(b) {
  if (!b.condition) return '⚠ critère non pris en charge';
  const bt = (_bgData?.blockTypes || []).find(t => t.id === b.blockId);
  return (BG_COND[b.condition] || b.condition).replace('{n}', Number(b.threshold).toLocaleString('fr'))
    .replace('{block}', bt ? `${bt.icon} ${bt.name}` : (b.blockId || '?'));
}

function bgArt(el, image, icon, size) {
  el.textContent = '';
  if (image && BG_IMAGE_RE.test(image) && !image.includes('..')) {
    const img = document.createElement('img');
    img.src = image; img.alt = ''; img.width = size; img.height = size; img.style.objectFit = 'contain';
    img.onerror = () => { el.textContent = icon || '🏅'; };
    el.appendChild(img);
  } else {
    el.textContent = icon || '🏅';
  }
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
    visibility: v('bg-visibility'),
    startsAt: v('bg-starts') || null, endsAt: v('bg-ends') || null, sort: Number(v('bg-sort')) || 0,
    names, descriptions,
  };
}

function bgFillForm(b) {
  const set = (id, val) => { document.getElementById(id).value = val ?? ''; };
  set('bg-id', b?.id);
  set('bg-category', b?.category ?? _bgData?.categories?.[0]);
  set('bg-condition', b?.condition ?? 'max_depth');
  set('bg-block', b?.blockId ?? 'pierre');
  set('bg-threshold', b?.threshold ?? 100); set('bg-icon', b?.icon ?? '🏅'); set('bg-image', b?.image);
  set('bg-visibility', b?.visibility ?? 'visible');
  set('bg-starts', b?.startsAt); set('bg-ends', b?.endsAt); set('bg-sort', b?.sort ?? 0);
  for (const l of BG_LANGS) { set(`bg-${l}-name`, b?.names?.[l]); set(`bg-${l}-desc`, b?.descriptions?.[l]); }
  document.getElementById('bg-preview').textContent = '';
  document.getElementById('bg-period-box').open = !!(b?.startsAt || b?.endsAt);
  bgToggleBlock();
}

function bgToggleBlock() {
  const cond = document.getElementById('bg-condition').value;
  document.getElementById('bg-block').disabled = cond !== 'blocks_of_type' || !!document.getElementById('bg-form').inert;
  document.getElementById('bg-metric-help').textContent = BG_METRIC_FR[cond] ?? '';
  bgLivePreview();
}

/** Aperçu tel que le joueur le verra (FR), mis à jour à chaque saisie. */
function bgLivePreview() {
  const f = bgReadForm();
  bgArt(document.getElementById('bg-pv-art'), f.image, f.icon || '🏅', 56);
  document.getElementById('bg-pv-name').textContent = f.names.fr || '(nom FR obligatoire)';
  document.getElementById('bg-pv-desc').textContent = f.descriptions.fr || '(description FR obligatoire)';
  document.getElementById('bg-pv-cond').textContent = `${bgCondLabel(f)}${f.visibility === 'hidden' ? ' · secret' : ''}${f.startsAt || f.endsAt ? ` · événement ${f.startsAt || '…'} → ${f.endsAt || '…'}` : ''}`;
}

function bgError(data) {
  return [data.error || 'Erreur.', ...(Array.isArray(data.details) ? data.details : [])].join(' ');
}

function bgList(id, items) {
  const ul = document.getElementById(id);
  ul.textContent = '';
  for (const t of items) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
  ul.classList.toggle('hidden', !items.length);
}

/** Ouvre la fiche : badge existant (consultation/édition), nouveau badge, ou proposition IA. */
function bgOpenSheet(sheet, opener) {
  _bgSheet = sheet;
  const { mode, badge: b, proposal: p } = sheet;
  const editable = mode !== 'proposal' || p.status === 'open';
  const src = mode === 'proposal' ? (p.data?.badge ?? null) : b;
  bgFillForm(src);
  if (mode === 'proposal' && src && !src.condition) document.getElementById('bg-condition').value = '';
  document.getElementById('bg-form').inert = !editable;
  document.getElementById('bg-id').disabled = mode === 'edit';
  bgToggleBlock();
  document.getElementById('bg-form-title').textContent = mode === 'edit' ? `${b.icon} ${b.names.fr} — fiche du badge`
    : mode === 'new' ? 'Nouveau badge (manuel)' : '✨ Modifier la proposition IA';
  const state = document.getElementById('bg-state');
  const stateText = mode === 'edit'
    ? `Statut : ${BG_STATUS[b.status]}${b.status === 'active' ? ' — les modifications enregistrées sont visibles immédiatement par les joueurs.' : ' — invisible des joueurs.'}`
    : mode === 'new' ? 'Le badge sera enregistré désactivé : activez-le ensuite depuis sa fiche.'
    : {
      pending: '⏳ Génération en cours (≈ 20 à 60 s) : vous pouvez fermer cette fiche, la proposition restera dans « ✨ Propositions IA ».',
      open: `Demande : « ${p.concept} » (proposition n° ${p.id}). Corrigez ce qui doit l'être, puis « Enregistrer comme badge désactivé ». Rien n'est activé ; aucune image n'est générée.`,
      error: `Échec : ${p.error ?? 'erreur inconnue'}. Aucune donnée n'a été modifiée ; relancez une proposition depuis « ＋ Ajouter un badge ».`,
      in_draft: `Déjà enregistrée comme badge désactivé « ${p.badgeId} » : ouvrez-le dans la liste pour l'illustrer et l'activer.`,
    }[p.status] ?? p.status;
  icNotice(state, stateText, mode === 'proposal' && p.status === 'error' ? 'warn' : 'info');
  bgList('bg-issues', mode === 'proposal' ? p.errors ?? [] : []);
  bgList('bg-warnings', mode === 'proposal' ? p.warnings ?? [] : []);
  const rat = document.getElementById('bg-rationale');
  rat.textContent = mode === 'proposal' && p.data?.rationale ? `Pourquoi ce critère : ${p.data.rationale}` : '';
  rat.classList.toggle('hidden', !rat.textContent);
  document.getElementById('bg-brief-box').classList.toggle('hidden', mode !== 'proposal' || !p.data);
  for (const k of ['subject', 'details', 'palette']) document.getElementById(`bg-brief-${k}`).value = p?.data?.image?.[k] ?? '';
  document.getElementById('bg-meta').textContent = mode === 'edit'
    ? `Obtenu par ${b.earnedCount ?? 0} joueur(s). Créé le ${b.createdAt} UTC, modifié le ${b.updatedAt} UTC.` : '';

  const show = (id, on) => document.getElementById(id).classList.toggle('hidden', !on);
  const save = document.getElementById('btn-bg-save');
  save.textContent = mode === 'proposal' ? 'Enregistrer comme badge désactivé' : mode === 'new' ? 'Enregistrer (désactivé)' : 'Enregistrer les modifications';
  show('btn-bg-save', editable);
  show('btn-bg-preview', editable);
  show('btn-bg-toggle', mode === 'edit');
  show('btn-bg-archive', mode === 'edit' && b.status !== 'archived');
  show('btn-bg-studio', mode === 'edit' && b.status !== 'archived');
  show('btn-bg-prop-discard', mode === 'proposal' && ['open', 'error'].includes(p.status));
  if (mode === 'edit') document.getElementById('btn-bg-toggle').textContent = b.status === 'active' ? 'Désactiver' : 'Activer';
  ptMessage('bg-form-msg', '', true);
  admDialogOpen('bg-dialog', opener, editable ? (mode === 'new' ? 'bg-id' : 'bg-fr-name') : document.querySelector('#bg-dialog [data-close]'));
}

async function loadBadges() {
  const { ok, data } = await api('GET', '/api/admin/badges');
  if (!ok) { ptMessage('bg-msg', data.error || 'Erreur lors du chargement.', false); return; }
  _bgData = data;
  document.getElementById('bg-activated').textContent = data.activatedAt ? new Date(data.activatedAt).toLocaleString('fr') : '—';
  const cat = document.getElementById('bg-category');
  if (!cat.options.length) {
    for (const c of data.categories) { const o = document.createElement('option'); o.value = c; o.textContent = c; cat.appendChild(o); }
    coSelect('bg-filter-category', data.categories.map(c => [c, c]), 1);
  }
  const blk = document.getElementById('bg-block');
  const keep = blk.value;
  blk.textContent = '';
  for (const t of data.blockTypes) { const o = document.createElement('option'); o.value = t.id; o.textContent = `${t.icon} ${t.name} (${t.id})`; blk.appendChild(o); }
  if (keep) blk.value = keep;
  const active = data.badges.filter(b => b.status === 'active').length;
  document.getElementById('bg-summary').textContent =
    `${data.badges.length} badge(s), dont ${active} actif(s) — ${data.playersTracked} joueur(s) suivi(s) depuis l'activation.`;
  bgRenderList();
  loadBadgeAudit();
  bgAiLoad();
}

function bgRenderList() {
  if (!_bgData) return;
  const text = document.getElementById('bg-filter-text').value.trim().toLowerCase();
  const cf = document.getElementById('bg-filter-category').value;
  const sf = document.getElementById('bg-filter-status').value;
  const tb = document.getElementById('bg-body');
  tb.textContent = '';
  let shown = 0;
  for (const b of _bgData.badges) {
    if (cf && b.category !== cf) continue;
    if (sf === 'noimage' ? !!b.image : sf && b.status !== sf) continue;
    if (text && !`${b.id} ${Object.values(b.names).join(' ')}`.toLowerCase().includes(text)) continue;
    shown++;
    const tr = document.createElement('tr');
    const art = addCell(tr, '');
    art.className = 'co-thumb';
    art.title = b.image ? 'Image' : 'Pas encore d\'image (emoji affiché)';
    bgArt(art, b.image, b.icon, 40);
    addCell(tr, b.names.fr);
    addCell(tr, b.id).className = 'muted';
    addCell(tr, bgCondLabel(b));
    const td = document.createElement('td'); td.appendChild(statusBadge(BG_STATUS[b.status] || b.status)); tr.appendChild(td);
    addCell(tr, b.visibility === 'hidden' ? 'secret' : 'visible');
    addCell(tr, b.startsAt || b.endsAt ? `${b.startsAt || '…'} → ${b.endsAt || '…'}` : 'permanent');
    addCell(tr, b.earnedCount).className = 'num';
    admRowOpen(tr, `badge:${b.id}`, b.names.fr, row => bgOpenSheet({ mode: 'edit', badge: _bgData.badges.find(x => x.id === b.id) ?? b }, row));
    tb.appendChild(tr);
  }
  if (!shown) tb.innerHTML = '<tr><td colspan="9" class="muted">Aucun badge.</td></tr>';
  document.getElementById('bg-count').textContent = `— ${shown} / ${_bgData.badges.length}`;
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

admDialogSetup('bg-dialog');
admDialogSetup('bg-add-dialog');
admDialogSetup('bg-ai-dialog');
admDialogSetup('bg-review-dialog');
document.getElementById('bg-dialog').addEventListener('close', () => { _bgSheet = null; });
document.getElementById('bg-condition').addEventListener('change', bgToggleBlock);
for (const id of ['bg-icon', 'bg-image', 'bg-threshold', 'bg-block', 'bg-visibility', 'bg-starts', 'bg-ends', 'bg-fr-name', 'bg-fr-desc']) {
  document.getElementById(id).addEventListener('input', bgLivePreview);
}
for (const id of ['bg-filter-text', 'bg-filter-category', 'bg-filter-status']) document.getElementById(id).addEventListener('input', bgRenderList);
document.getElementById('btn-refresh-badges').addEventListener('click', loadBadges);

document.getElementById('btn-bg-add').addEventListener('click', e => {
  const ai = document.getElementById('btn-bg-add-ai');
  admDialogOpen('bg-add-dialog', e.currentTarget, ai.disabled ? 'btn-bg-add-manual' : ai);
  bgAiLoad();
});
document.getElementById('btn-bg-add-manual').addEventListener('click', () => {
  document.getElementById('bg-add-dialog').close();
  bgOpenSheet({ mode: 'new' }, document.getElementById('btn-bg-add'));
});
document.getElementById('btn-bg-add-ai').addEventListener('click', () => {
  document.getElementById('bg-add-dialog').close();
  ptMessage('bg-ai-msg', '', true);
  admDialogOpen('bg-ai-dialog', document.getElementById('btn-bg-add'), 'bg-ai-concept');
});

document.getElementById('btn-bg-preview').addEventListener('click', async () => {
  const body = bgReadForm();
  if (!body.condition) { ptMessage('bg-form-msg', 'Choisissez une condition prise en charge.', false); return; }
  const { ok, data } = await api('POST', '/api/admin/badges/preview', body);
  const el = document.getElementById('bg-preview');
  if (!ok) { el.textContent = ''; ptMessage('bg-form-msg', bgError(data), false); return; }
  el.textContent = `Joueurs suivis : ${data.playersTracked} ; rempliraient déjà la condition : ${data.wouldEarnNow} ; à mi-chemin : ${data.halfway}. ${data.note}`;
  ptMessage('bg-form-msg', 'Badge valide.', true);
});

document.getElementById('btn-bg-save').addEventListener('click', async () => {
  const sheet = _bgSheet;
  if (!sheet) return;
  const body = bgReadForm();
  if (sheet.mode === 'proposal') {
    const image = Object.fromEntries(['subject', 'details', 'palette'].map(k => [k, document.getElementById(`bg-brief-${k}`).value.trim()]));
    const put = await api('PUT', `/api/admin/badges/ai/proposals/${sheet.proposal.id}`, { badge: body, image });
    if (!put.ok) { ptMessage('bg-form-msg', bgError(put.data), false); return; }
    const r = await api('POST', `/api/admin/badges/ai/proposals/${sheet.proposal.id}/draft`);
    if (!r.ok) {
      // Corrections gardées : la fiche affiche ce qui bloque encore
      bgOpenSheet({ mode: 'proposal', proposal: put.data.proposal, opener: sheet.opener }, sheet.opener ?? document.getElementById('btn-bg-add'));
      ptMessage('bg-form-msg', bgError(r.data), false);
      return;
    }
    document.getElementById('bg-dialog').close();
    ptMessage('bg-msg', `Badge « ${r.data.badge.id} » créé, désactivé (invisible des joueurs). Illustrez-le dans 🎨 Atelier d'icônes puis activez-le depuis sa fiche.`, true);
    loadBadges();
    return;
  }
  if (sheet.mode === 'edit' && sheet.badge.status === 'active'
    && !confirm('Ce badge est ACTIF : les modifications seront visibles immédiatement par les joueurs. Enregistrer ?')) return;
  const r = sheet.mode === 'edit'
    ? await api('PUT', `/api/admin/badges/${encodeURIComponent(sheet.badge.id)}`, body)
    : await api('POST', '/api/admin/badges', { ...body, status: 'inactive' });
  if (!r.ok) { ptMessage('bg-form-msg', bgError(r.data), false); return; }
  document.getElementById('bg-dialog').close();
  ptMessage('bg-msg', sheet.mode === 'edit' ? `Badge « ${r.data.badge.id} » enregistré.` : `Badge « ${r.data.badge.id} » créé, désactivé : activez-le depuis sa fiche.`, true);
  loadBadges();
});

async function bgSetStatus(status, warn) {
  const b = _bgSheet?.badge;
  if (!b || (warn && !confirm(warn))) return;
  const r = await api('POST', `/api/admin/badges/${encodeURIComponent(b.id)}/status`, { status });
  if (!r.ok) { ptMessage('bg-form-msg', bgError(r.data), false); return; }
  document.getElementById('bg-dialog').close();
  ptMessage('bg-msg', `Badge « ${b.id} » : ${BG_STATUS[status]}.`, true);
  loadBadges();
}
document.getElementById('btn-bg-toggle').addEventListener('click', () => {
  const b = _bgSheet?.badge;
  if (!b) return;
  if (b.status === 'active') bgSetStatus('inactive', null);
  else bgSetStatus('active', `Activer « ${b.id} » ? Les joueurs qui remplissent déjà la condition le recevront à leur prochaine sauvegarde.`);
});
document.getElementById('btn-bg-archive').addEventListener('click', () => {
  const b = _bgSheet?.badge;
  if (b) bgSetStatus('archived', `Archiver « ${b.id} » ? Il ne pourra plus être obtenu ; ceux qui l'ont le gardent.`);
});
document.getElementById('btn-bg-studio').addEventListener('click', () => {
  const id = _bgSheet?.badge?.id;
  document.getElementById('bg-dialog').close();
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  if (id) icOpen(`badge:${id}`);
});
document.getElementById('btn-bg-prop-discard').addEventListener('click', async () => {
  const p = _bgSheet?.proposal;
  if (!p || !confirm('Abandonner cette proposition ? Aucun badge n\'est créé.')) return;
  const r = await api('DELETE', `/api/admin/badges/ai/proposals/${p.id}`);
  if (!r.ok) { ptMessage('bg-form-msg', bgError(r.data), false); return; }
  document.getElementById('bg-dialog').close();
  ptMessage('bg-msg', 'Proposition abandonnée.', true);
  bgAiLoad();
});

// ── Badges : création assistée par IA (#38, 31/10) ────────────────────────────

async function bgAiLoad() {
  const { ok, data } = await api('GET', '/api/admin/badges/ai');
  if (!ok) return;
  _bgAi = data;
  const st = data.status;
  document.getElementById('btn-bg-add-ai').disabled = !st.configured;
  document.getElementById('btn-bg-ai-generate').disabled = !st.configured;
  const txt = st.configured
    ? `IA : ${st.textModel}${st.fake ? ' (mode test)' : ''} — budget restant ≈ ${st.remainingUsd.toFixed(2)} / ${st.budgetUsd} USD, texte ≈ ${st.estTextUsd} USD par proposition ; ${st.callsToday}/${st.maxCallsPerDay} appels sur 24 h.`
    : `IA non configurée : ${st.reason}. Création manuelle seulement.`;
  document.getElementById('bg-ai-status').textContent = txt;
  document.getElementById('bg-ai-status-2').textContent = txt;
  const ul = document.getElementById('bg-metrics');
  if (!ul.childElementCount) for (const k of Object.keys(data.metrics)) {
    const li = document.createElement('li');
    li.textContent = `${k} — ${BG_METRIC_FR[k] ?? data.metrics[k]}`;
    ul.appendChild(li);
  }

  const list = data.proposals;
  document.getElementById('bg-ai-card').classList.toggle('hidden', !list.length);
  const n = s => list.filter(p => p.status === s).length;
  document.getElementById('bg-ai-card-title').textContent = `✨ Propositions IA — ${n('open')} à relire`
    + (n('pending') ? `, ${n('pending')} en cours` : '') + (n('in_draft') ? `, ${n('in_draft')} enregistrée(s)` : '');
  const tb = document.getElementById('bg-ai-body');
  tb.textContent = '';
  for (const p of list) {
    const tr = document.createElement('tr');
    const b = p.data?.badge;
    [`n° ${p.id} · ${p.createdAt}`, p.concept.length > 70 ? `${p.concept.slice(0, 70)}…` : p.concept, b ? `${b.icon} ${b.names.fr || b.id}` : '—',
     b ? bgCondLabel(b) : '', BG_AI_STATE[p.status] ?? p.status].forEach(x => addCell(tr, x));
    admRowOpen(tr, `bg-prop:${p.id}`, `Proposition ${p.id}`, row => bgPropOpen(p.id, row));
    tb.appendChild(tr);
  }
  clearTimeout(_bgAiTimer);
  if (list.some(p => p.status === 'pending')) _bgAiTimer = setTimeout(bgAiPoll, 3000);
}

async function bgAiPoll() {
  await bgAiLoad();
  // Seule la vue de relecture (sans champ de saisie) suit le job : la fiche « Modifier » n'est jamais remplacée.
  const id = _bgReview?.id;
  if (!id || !document.getElementById('bg-review-dialog').open) return;
  const p = _bgAi.proposals.find(x => x.id === id);
  if (p && p.status !== _bgReview.status) bgReviewRender(p, true);
}

async function bgPropOpen(id, opener) {
  const { ok, data } = await api('GET', `/api/admin/badges/ai/proposals/${id}`);
  if (!ok) { ptMessage('bg-msg', data.error || 'Erreur.', false); return; }
  bgReviewOpen(data.proposal, opener);
}

// ── Badges : vue d'attente puis relecture synthétique d'une proposition IA (recette du 02/11) ──
// Après « Proposer » : vue d'attente légère (demande, statut, durée) que l'on peut fermer sans perdre
// le job ; à la fin, fiche de relecture (aperçu, condition exacte, état désactivé, traductions et visuel
// repliés). Le formulaire complet n'apparaît qu'après « Modifier ».

let _bgReview = null;      // proposition affichée dans la vue de relecture
let _bgReviewClock = null;

const bgUtc = s => new Date(`${String(s).replace(' ', 'T')}Z`);

function bgReviewTick() {
  const p = _bgReview;
  if (!p || p.status !== 'pending') { clearInterval(_bgReviewClock); return; }
  const sec = Math.max(0, Math.round((Date.now() - bgUtc(p.createdAt).getTime()) / 1000));
  document.getElementById('bg-rv-wait-text').textContent = `Demandée il y a ${sec} s (en général 20 à 60 s). `
    + 'Vous pouvez fermer cette fenêtre : la génération continue et la proposition restera dans « ✨ Propositions IA ». Aucun badge n\'est créé sans votre action.';
}

function bgReviewRender(p, refresh) {
  _bgReview = p;
  const b = p.data?.badge;
  const show = (id, on) => document.getElementById(id).classList.toggle('hidden', !on);
  const others = (_bgAi?.proposals ?? []).filter(x => x.id !== p.id && x.concept === p.concept).map(x => `n° ${x.id}`);
  document.getElementById('bg-rv-ref').textContent = `Demande : « ${p.concept} » — proposition n° ${p.id}, ${bgUtc(p.createdAt).toLocaleString('fr')}.`
    + (others.length ? ` Même demande déjà proposée : ${others.join(', ')} (chaque « Proposer » ou « Refaire » crée une nouvelle proposition).` : '');
  show('bg-rv-wait', p.status === 'pending');
  clearInterval(_bgReviewClock);
  if (p.status === 'pending') {
    bgReviewTick();
    _bgReviewClock = setInterval(bgReviewTick, 1000);
    // Suivi garanti même si la liste a été chargée avant le lancement du job
    clearTimeout(_bgAiTimer);
    _bgAiTimer = setTimeout(bgAiPoll, 3000);
  }
  icNotice(document.getElementById('bg-rv-state'), {
    open: refresh ? 'Proposition prête : relisez-la ci-dessous.' : '',
    error: `Échec : ${p.error ?? 'erreur inconnue'}. Aucune donnée n'a été modifiée.`,
    in_draft: `Déjà conservée : badge désactivé « ${p.badgeId} ». Ouvrez-le pour l'illustrer et l'activer.`,
  }[p.status] ?? '', p.status === 'error' ? 'warn' : 'info');

  show('bg-rv-body', p.status === 'open' && !!b);
  if (p.status === 'open' && b) {
    bgArt(document.getElementById('bg-rv-art'), b.image, b.icon, 56);
    document.getElementById('bg-rv-name').textContent = b.names.fr || '(nom FR manquant)';
    document.getElementById('bg-rv-desc').textContent = b.descriptions.fr || '(description FR manquante)';
    document.getElementById('bg-rv-cond').textContent = b.condition
      ? `${bgCondLabel(b)} — ${BG_METRIC_FR[b.condition] ?? ''}` : '⚠ Aucun critère pris en charge : « Modifier » pour en choisir un.';
    document.getElementById('bg-rv-vis').textContent = b.visibility === 'hidden' ? 'Secret (révélé une fois obtenu)' : 'Visible';
    document.getElementById('bg-rv-period').textContent = b.startsAt || b.endsAt
      ? `⚠ Événement : ${b.startsAt || '…'} → ${b.endsAt || '…'} (UTC)` : 'Permanent (aucune période)';
    document.getElementById('bg-rv-id').textContent = `${b.category} · ${b.id}`;
    bgList('bg-rv-issues', p.errors ?? []);
    bgList('bg-rv-warnings', p.warnings ?? []);
    const rat = document.getElementById('bg-rv-rationale');
    rat.textContent = p.data.rationale ? `Pourquoi ce critère : ${p.data.rationale}` : '';
    show('bg-rv-rationale', !!rat.textContent);
    const tb = document.getElementById('bg-rv-tr');
    tb.textContent = '';
    for (const l of BG_LANGS.filter(x => x !== 'fr')) {
      const tr = document.createElement('tr');
      [l.toUpperCase(), b.names[l] || '— (FR affiché)', b.descriptions[l] || '—'].forEach(x => addCell(tr, x));
      tb.appendChild(tr);
    }
    const dl = document.getElementById('bg-rv-brief');
    dl.textContent = '';
    for (const [k, label] of [['subject', 'Sujet'], ['details', 'Détails'], ['palette', 'Palette']]) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = p.data.image?.[k] || '—';
      dl.append(dt, dd);
    }
  }
  const keep = document.getElementById('btn-bg-rv-keep');
  keep.disabled = !!(p.errors ?? []).length;
  keep.title = keep.disabled ? 'À corriger d\'abord via « Modifier »' : 'Crée le badge désactivé (invisible des joueurs)';
  show('btn-bg-rv-keep', p.status === 'open');
  show('btn-bg-rv-edit', p.status === 'open');
  show('btn-bg-rv-redo', ['open', 'error'].includes(p.status));
  show('btn-bg-rv-cancel', ['open', 'error'].includes(p.status));
  show('btn-bg-rv-open', p.status === 'in_draft');
  document.getElementById('btn-bg-rv-close').textContent = p.status === 'pending' ? 'Fermer (la génération continue)' : 'Fermer';
  if (!refresh) ptMessage('bg-rv-msg', '', true);
  // Un bouton masqué ne garde pas le focus : il revient au titre de la fiche.
  const dlg = document.getElementById('bg-review-dialog');
  if (dlg.open && (!dlg.contains(document.activeElement) || document.activeElement.closest('.hidden'))) document.getElementById('bg-rv-title').focus();
  // Fin de génération : du titre (focus d'attente) à l'action principale, sans quitter la fiche
  if (dlg.open && refresh && p.status === 'open' && document.activeElement.id === 'bg-rv-title' && !keep.disabled) keep.focus();
}

function bgReviewOpen(p, opener) {
  bgReviewRender(p, false);
  admDialogOpen('bg-review-dialog', opener, p.status === 'open' && !(p.errors ?? []).length ? 'btn-bg-rv-keep' : 'bg-rv-title');
}

document.getElementById('bg-review-dialog').addEventListener('close', () => { clearInterval(_bgReviewClock); _bgReview = null; });

document.getElementById('btn-bg-rv-keep').addEventListener('click', async e => {
  const p = _bgReview;
  if (!p) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  const r = await api('POST', `/api/admin/badges/ai/proposals/${p.id}/draft`);
  btn.disabled = false;
  if (!r.ok) { ptMessage('bg-rv-msg', bgError(r.data), false); return; }
  document.getElementById('bg-review-dialog').close();
  ptMessage('bg-msg', `Badge « ${r.data.badge.id} » conservé en brouillon, désactivé (invisible des joueurs). Illustrez-le dans 🎨 Atelier d'icônes puis activez-le depuis sa fiche.`, true);
  loadBadges();
});

document.getElementById('btn-bg-rv-edit').addEventListener('click', () => {
  const p = _bgReview;
  if (!p) return;
  const dlg = document.getElementById('bg-review-dialog');
  const opener = dlg._admOpener;
  dlg._admOpener = null;   // le focus passe à la fiche complète, pas à la liste
  dlg.close();
  bgOpenSheet({ mode: 'proposal', proposal: p, opener }, opener);
});

document.getElementById('btn-bg-rv-redo').addEventListener('click', async e => {
  const p = _bgReview;
  if (!p) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  const r = await api('POST', `/api/admin/badges/ai/proposals/${p.id}/redo`);
  btn.disabled = false;
  if (!r.ok) { ptMessage('bg-rv-msg', r.data.error || 'Erreur.', false); return; }
  await bgAiLoad();
  bgReviewRender(r.data.proposal, false);
  ptMessage('bg-rv-msg', `Nouvelle proposition n° ${r.data.proposal.id} demandée ; la n° ${p.id} est abandonnée.`, true);
});

document.getElementById('btn-bg-rv-cancel').addEventListener('click', async () => {
  const p = _bgReview;
  if (!p || !confirm('Annuler cette proposition ? Aucun badge n\'est créé.')) return;
  const r = await api('DELETE', `/api/admin/badges/ai/proposals/${p.id}`);
  if (!r.ok) { ptMessage('bg-rv-msg', bgError(r.data), false); return; }
  document.getElementById('bg-review-dialog').close();
  ptMessage('bg-msg', 'Proposition annulée : aucun badge créé.', true);
  bgAiLoad();
});

document.getElementById('btn-bg-rv-open').addEventListener('click', () => {
  const id = _bgReview?.badgeId;
  const b = _bgData?.badges.find(x => x.id === id);
  const dlg = document.getElementById('bg-review-dialog');
  const opener = dlg._admOpener;
  dlg._admOpener = null;
  dlg.close();
  if (b) bgOpenSheet({ mode: 'edit', badge: b }, opener);
  else ptMessage('bg-msg', `Badge « ${id} » introuvable (archivé ?).`, false);
});

document.getElementById('btn-bg-ai-generate').addEventListener('click', async e => {
  const btn = e.currentTarget;
  const concept = document.getElementById('bg-ai-concept').value.trim();
  if (concept.length < 3) { ptMessage('bg-ai-msg', 'Décrivez le badge (au moins 3 caractères).', false); return; }
  btn.disabled = true;
  const { ok, data } = await api('POST', '/api/admin/badges/ai/proposals', { concept });
  btn.disabled = false;
  if (!ok) { ptMessage('bg-ai-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('bg-ai-dialog').close();
  document.getElementById('bg-ai-concept').value = '';
  ptMessage('bg-msg', `✨ Proposition n° ${data.proposal.id} demandée : elle apparaîtra dans « ✨ Propositions IA » ; aucun badge n'est créé sans votre action.`, true);
  await bgAiLoad();
  document.getElementById('bg-ai-card').open = true;
  bgReviewOpen(data.proposal, document.getElementById('btn-bg-add'));
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

// ── Bêta fermée (#57) ─────────────────────────────────────────────────────────
// Recette du 03/11 : le tableau de bord ne montre que l'état ENREGISTRÉ sur le serveur ; inviter
// quelqu'un = « Inviter un testeur » → « Créer le lien » → « Copier » ; la configuration passe par
// une fiche qui montre ce qui va changer avant d'enregistrer ; le reste est replié (avancé).

const BETA_MODES  = { open: 'Inscriptions ouvertes à tous', invite: 'Sur invitation', closed: 'Inscriptions fermées' };
const BETA_MODE_SHORT = { open: 'tout le monde', invite: 'seulement les invités', closed: 'personne' };
const BETA_STATES = { active: 'actif', used: 'utilisé', expired: 'expiré', revoked: 'révoqué' };
const BETA_STATUS = { new: 'nouveau', seen: 'vu', fixed: 'corrigé', wontfix: 'non retenu' };
let _beta = null;   // dernière vue enregistrée (GET /api/admin/beta)

function betaInviteLink(code) {
  return `${location.origin}/?invite=${encodeURIComponent(code)}`;
}

/** Message prêt à envoyer à un invité (le lien Discord seulement s'il est configuré). */
function betaInviteMessage(link, name) {
  const discord = _beta?.settings.discordUrl;
  return [
    `Salut${name ? ` ${name}` : ''} ! Je t'invite à tester DIG!, mon petit jeu de minage, en avant-première.`,
    '',
    `1. Ouvre ce lien (ordinateur ou téléphone) : ${link}`,
    '2. Choisis un pseudo, ton e-mail et un mot de passe : c\'est tout.',
    '',
    'Le lien ne sert qu\'une fois et reste valable 14 jours. C\'est une bêta : la progression peut encore être ajustée.',
    discord ? `Un souci ou une idée ? Viens en parler sur Discord (facultatif) : ${discord}` : 'Un souci ou une idée ? Dis-le-moi, ou utilise « 🐞 Signaler un bug » dans le jeu.',
  ].join('\n');
}

async function betaCopy(text, btn, label) {
  try { await navigator.clipboard.writeText(text); }
  catch { prompt('À copier :', text); return; }
  btn.textContent = '✓ Copié';
  setTimeout(() => { btn.textContent = label; }, 1800);
  admToast('Copié dans le presse-papiers.');
}

/** Confirmation brève en bas de l'écran (aucune action requise). */
function admToast(text) {
  let el = document.getElementById('adm-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'adm-toast';
    el.className = 'adm-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('is-shown');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('is-shown'), 3200);
}

function renderBeta(data) {
  _beta = data;
  const s = data.settings;
  const active = data.invites.filter(i => i.state === 'active').length;
  const newReports = data.reports.counts.new || 0;

  const st = document.getElementById('beta-state');
  st.className = `beta-state beta-state--${s.registrationMode}`;
  st.textContent = `${BETA_MODES[s.registrationMode]}`;
  const small = document.createElement('small');
  small.textContent = ` · bandeau ${s.bannerEnabled ? 'affiché' : 'masqué'} · signalements ${s.reportsEnabled ? 'ouverts' : 'fermés'} · Discord ${s.discordUrl ? 'configuré' : 'non configuré'} — état enregistré`;
  st.appendChild(small);

  const stats = document.getElementById('beta-stats');
  stats.textContent = '';
  for (const [n, l] of [[data.summary.total, 'testeur(s) inscrit(s)'], [active, 'lien(s) d\'invitation actif(s)'], [newReports, 'nouveau(x) retour(s)']]) {
    const li = document.createElement('li');
    const b = document.createElement('strong'); b.textContent = n;
    li.append(b, ` ${l}`);
    stats.appendChild(li);
  }

  // Avertissements : seulement ce qui empêche une invitation de fonctionner, ou l'ouvre à tous.
  const warns = [];
  if (s.registrationMode === 'closed') warns.push('Inscriptions fermées : un lien d\'invitation ne permet PAS de créer un compte. Ouvre « Configurer la bêta » → « Seulement les invités ».');
  if (s.registrationMode === 'open') warns.push('Tout le monde peut encore créer un compte sans invitation. Pour une bêta privée : « Configurer la bêta » → « Seulement les invités ».');
  const wl = document.getElementById('beta-warnings');
  wl.textContent = '';
  for (const w of warns) { const li = document.createElement('li'); li.textContent = `⚠️ ${w}`; wl.appendChild(li); }
  document.getElementById('btn-beta-feedback').textContent = `💬 Voir les retours${newReports ? ` (${newReports} nouveau${newReports > 1 ? 'x' : ''})` : ''}`;

  betaSetUnlessEdited(document.getElementById('beta-known'), s.knownIssues);
  betaSetUnlessEdited(document.getElementById('beta-inv-wave'), data.currentWave);
  document.getElementById('beta-invite-wave').textContent = data.currentWave;

  const ib = document.getElementById('beta-invites');
  ib.textContent = '';
  if (!data.invites.length) ib.innerHTML = '<tr><td colspan="8" class="muted">Aucun lien créé.</td></tr>';
  for (const inv of data.invites) {
    const tr = document.createElement('tr');
    addCell(tr, inv.code).style.fontFamily = 'monospace';
    const linkTd = addCell(tr, '');
    if (inv.state === 'active') {
      const copy = document.createElement('button');
      copy.className = 'btn-ghost'; copy.textContent = '📋 Copier le lien';
      copy.addEventListener('click', () => betaCopy(betaInviteLink(inv.code), copy, '📋 Copier le lien'));
      linkTd.appendChild(copy);
    }
    [inv.label || '—', inv.wave, `${inv.uses} / ${inv.maxUses}`, inv.expiresAt || 'jamais', BETA_STATES[inv.state] || inv.state].forEach(x => addCell(tr, x));
    const act = addCell(tr, '');
    if (inv.state === 'active') {
      const rev = document.createElement('button');
      rev.className = 'btn-ghost'; rev.textContent = 'Révoquer';
      rev.addEventListener('click', async () => {
        if (!confirm(`Révoquer ${inv.code} ? Le lien ne marchera plus. Les comptes déjà créés avec ce lien ne sont pas touchés.`)) return;
        const { ok, data: d } = await api('POST', `/api/admin/beta/invites/${inv.id}/revoke`);
        if (!ok) return adMessage('beta-invite-msg', d.error || 'Erreur.', false);
        admToast(`Lien ${inv.code} révoqué.`);
        loadBeta();
      });
      act.appendChild(rev);
    }
    ib.appendChild(tr);
  }

  const sm = data.summary;
  document.getElementById('beta-testers-summary').textContent = `${sm.total} testeur(s) · ${sm.activated} ont sauvegardé au moins une fois · `
    + `retour J+1 : ${sm.d1.returned}/${sm.d1.eligible} · retour J+7 : ${sm.d7.returned}/${sm.d7.eligible} `
    + '(approximation : dernière sauvegarde cloud au moins 1 ou 7 jours après l’inscription).';
  const tb = document.getElementById('beta-testers');
  tb.textContent = '';
  if (!data.testers.length) tb.innerHTML = '<tr><td colspan="8" class="muted">Aucun compte créé avec une invitation.</td></tr>';
  for (const x of data.testers) {
    const tr = document.createElement('tr');
    [x.username, x.label || '—', x.wave, x.createdAt, x.lastSaveAt || '—', x.returnedD1 ? 'oui' : '—', x.returnedD7 ? 'oui' : '—', x.reports]
      .forEach(v => addCell(tr, v));
    tb.appendChild(tr);
  }

  const c = data.reports.counts;
  document.getElementById('beta-reports-counts').textContent = Object.entries(BETA_STATUS).map(([k, l]) => `${l} : ${c[k] || 0}`).join(' · ');
  const list = document.getElementById('beta-reports-list');
  // Rafraîchir ne doit rien faire perdre : fiches ouvertes/fermées et saisies non enregistrées
  // (statut, lien, note) sont reportées sur la nouvelle liste.
  const before = new Map([...list.querySelectorAll('details.beta-report')].map(card => [card.dataset.reportId, {
    open: card.open,
    edits: [...card.querySelectorAll('[data-field]')].filter(el => el.value !== el.dataset.saved).map(el => [el.dataset.field, el.value]),
  }]));
  list.textContent = '';
  if (!data.reports.reports.length) {
    const p = document.createElement('p'); p.className = 'muted';
    p.textContent = s.reportsEnabled ? 'Aucun retour pour le moment.' : 'Aucun retour. Le bouton « Signaler un bug » est désactivé (« Configurer la bêta » pour l’activer).';
    list.appendChild(p);
  }
  for (const r of data.reports.reports) {
    const card = document.createElement('details');
    card.className = 'beta-report';
    card.dataset.reportId = r.id;
    const prev = before.get(String(r.id));
    card.open = prev ? prev.open : r.status === 'new';
    const h = document.createElement('summary');
    h.textContent = `n°${r.id} — ${r.username || 'invité'} — ${BETA_STATUS[r.status]} — ${r.createdAt} UTC — ${(r.observed || '').slice(0, 80)}`;
    card.appendChild(h);
    for (const [label, val] of [['Appareil', r.device], ['Étape', r.step], ['Attendu', r.expected], ['Constaté', r.observed]]) {
      const p = document.createElement('p');
      p.style.whiteSpace = 'pre-wrap'; p.style.margin = '2px 0';
      const b = document.createElement('strong'); b.textContent = `${label} : `;
      p.append(b, val || '—');
      card.appendChild(p);
    }
    const diag = document.createElement('pre');
    diag.style.cssText = 'font-size:0.72rem;white-space:pre-wrap;word-break:break-all';
    diag.textContent = r.diagnostics ? JSON.stringify(r.diagnostics, null, 1) : 'Diagnostic : non joint (le joueur n’a pas coché la case).';
    card.appendChild(diag);
    const row = document.createElement('div');
    row.className = 'form-actions';
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Statut');
    for (const [k, l] of Object.entries(BETA_STATUS)) sel.appendChild(new Option(l, k));
    sel.value = r.status;
    const gh = document.createElement('input');
    gh.type = 'url'; gh.maxLength = 200; gh.placeholder = 'Lien du ticket GitHub (facultatif)'; gh.value = r.githubUrl || '';
    const note = document.createElement('input');
    note.type = 'text'; note.maxLength = 1000; note.placeholder = 'Note interne'; note.value = r.adminNote || '';
    const save = document.createElement('button');
    save.className = 'btn'; save.textContent = 'Enregistrer';
    save.addEventListener('click', async () => {
      const { ok, data: d } = await api('PUT', `/api/admin/beta/reports/${r.id}`, { status: sel.value, githubUrl: gh.value.trim(), adminNote: note.value });
      if (!ok) return adMessage('beta-report-msg', d.error || 'Erreur.', false);
      admToast(`Retour n°${r.id} enregistré (${BETA_STATUS[sel.value]}).`);
      loadBeta();
    });
    for (const [el, field] of [[sel, 'status'], [gh, 'githubUrl'], [note, 'adminNote']]) { el.dataset.field = field; el.dataset.saved = el.value; }
    for (const [field, value] of prev?.edits || []) ({ status: sel, githubUrl: gh, adminNote: note })[field].value = value;
    row.append(sel, gh, note, save);
    card.appendChild(row);
    list.appendChild(card);
  }
}

/** Met à jour un champ avec la valeur enregistrée, sauf si l'admin l'a modifié sans l'enregistrer. */
function betaSetUnlessEdited(el, value) {
  const edited = el.dataset.saved !== undefined && el.value !== el.dataset.saved;
  if (!edited) el.value = value;
  el.dataset.saved = String(value);
}

const betaClock = d => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
let _betaLoadedAt = null;

// Chaque chargement relit l'état depuis la base (GET /api/admin/beta, sans cache). « Rafraîchir »
// montre l'attente (bouton désactivé), puis l'heure de mise à jour ou l'erreur (recette du 03/11).
async function loadBeta({ manual = false } = {}) {
  const btn = document.getElementById('btn-refresh-beta');
  const st  = document.getElementById('beta-refresh-status');
  if (manual) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '↻ Actualisation…';
    st.className = 'refresh-status';
    st.textContent = 'Chargement…';
  }
  let res;
  try { res = await api('GET', '/api/admin/beta'); }
  catch { res = { ok: false, data: { error: 'serveur inaccessible' } }; }
  if (manual) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = '↻ Rafraîchir';
  }
  if (!res.ok) {
    st.className = 'refresh-status is-err';
    st.textContent = `⚠️ Échec de l’actualisation (${res.data.error || 'erreur'})${_betaLoadedAt ? ` — données affichées : ${betaClock(_betaLoadedAt)}` : ''}`;
    return;
  }
  renderBeta(res.data);
  _betaLoadedAt = new Date();
  st.className = 'refresh-status';
  st.textContent = `✓ Données à jour à ${betaClock(_betaLoadedAt)}`;
  if (manual) admToast(`Données à jour à ${betaClock(_betaLoadedAt)}.`);
}

document.getElementById('btn-refresh-beta').addEventListener('click', () => loadBeta({ manual: true }));
document.getElementById('btn-beta-feedback').addEventListener('click', () => {
  const card = document.getElementById('beta-feedback-card');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.querySelector('summary, select, button')?.focus({ preventScroll: true });
});

// ── Fiche « Inviter un testeur » : un champ facultatif, valeurs sûres (1 inscription, 14 jours, vague courante).
admDialogSetup('beta-invite-dialog');

function betaInviteReset() {
  document.getElementById('beta-invite-step1').classList.remove('hidden');
  document.getElementById('beta-invite-step2').classList.add('hidden');
  document.getElementById('beta-invite-name').value = '';
  admShowError(document.getElementById('beta-invite-error'), '');
  const mode = _beta?.settings.registrationMode;
  const warn = document.getElementById('beta-invite-warn');
  warn.textContent = mode === 'closed'
    ? '⚠️ Les inscriptions sont fermées : ce lien ne permettra pas de créer un compte tant que tu n’as pas choisi « Seulement les invités » dans « Configurer la bêta ».'
    : '';
  warn.classList.toggle('hidden', mode !== 'closed');
}

document.getElementById('btn-beta-invite-open').addEventListener('click', e => {
  betaInviteReset();
  admDialogOpen('beta-invite-dialog', e.currentTarget, 'beta-invite-name');
});
document.getElementById('btn-beta-invite-again').addEventListener('click', () => {
  betaInviteReset();
  document.getElementById('beta-invite-name').focus();
});

document.getElementById('btn-beta-invite-create').addEventListener('click', async () => {
  const btn = document.getElementById('btn-beta-invite-create');
  const name = document.getElementById('beta-invite-name').value.trim();
  btn.disabled = true;
  const { ok, data } = await api('POST', '/api/admin/beta/invites', { label: name });
  btn.disabled = false;
  if (!ok) return admShowError(document.getElementById('beta-invite-error'), data.error || 'Erreur.');
  const link = betaInviteLink(data.invites[0].code);
  document.getElementById('beta-invite-done').textContent = `✓ Lien créé${name ? ` pour ${name}` : ''}. Copie-le et envoie-le toi-même.`;
  document.getElementById('beta-invite-link').value = link;
  document.getElementById('beta-invite-message').value = betaInviteMessage(link, name);
  document.getElementById('beta-invite-step1').classList.add('hidden');
  document.getElementById('beta-invite-step2').classList.remove('hidden');
  document.getElementById('btn-beta-copy-link').focus();
  loadBeta();
});
document.getElementById('btn-beta-copy-link').addEventListener('click', e =>
  betaCopy(document.getElementById('beta-invite-link').value, e.currentTarget, '📋 Copier le lien'));
document.getElementById('btn-beta-copy-msg').addEventListener('click', e =>
  betaCopy(document.getElementById('beta-invite-message').value, e.currentTarget, '✉️ Copier un message prêt à envoyer'));

// ── Fiche « Configurer la bêta » : formulaire = brouillon ; la liste « ce qui va changer » compare
// au dernier état enregistré ; rien ne change tant que « Enregistrer » n'est pas cliqué.
admDialogSetup('beta-config-dialog');

function betaConfigForm() {
  return {
    registrationMode: document.querySelector('input[name="beta-mode"]:checked')?.value,
    bannerEnabled:    document.getElementById('beta-banner').checked,
    reportsEnabled:   document.getElementById('beta-reports').checked,
    discordUrl:       document.getElementById('beta-discord').value.trim(),
    resetPolicy:      document.getElementById('beta-policy').value.trim(),
  };
}

function betaConfigDiff() {
  const cur = _beta.settings, next = betaConfigForm();
  const out = [];
  if (next.registrationMode !== cur.registrationMode) out.push(`Création de compte : ${BETA_MODE_SHORT[cur.registrationMode]} → ${BETA_MODE_SHORT[next.registrationMode]} (les comptes existants continuent de jouer).`);
  if (next.bannerEnabled !== cur.bannerEnabled) out.push(next.bannerEnabled ? 'Le bandeau « 🧪 BÊTA » et la section « Bêta » apparaîtront dans le jeu.' : 'Le bandeau « 🧪 BÊTA » sera retiré du jeu.');
  if (next.reportsEnabled !== cur.reportsEnabled) out.push(next.reportsEnabled ? 'Les joueurs pourront « Signaler un bug ».' : 'Le bouton « Signaler un bug » sera retiré.');
  if (next.discordUrl !== cur.discordUrl) out.push(next.discordUrl ? `Lien Discord affiché dans le jeu : ${next.discordUrl}` : 'Plus aucun lien Discord affiché.');
  if (next.resetPolicy !== cur.resetPolicy) out.push(next.resetPolicy ? 'Nouveau texte de politique de progression.' : 'Politique de progression : texte par défaut.');
  const ul = document.getElementById('beta-config-diff');
  ul.textContent = '';
  if (!out.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Rien (identique à l’état enregistré).'; ul.appendChild(li); }
  for (const t of out) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
  document.getElementById('btn-beta-settings').disabled = !out.length;
  return out;
}

document.getElementById('btn-beta-config-open').addEventListener('click', e => {
  if (!_beta) return;
  const s = _beta.settings;
  const radio = document.querySelector(`input[name="beta-mode"][value="${s.registrationMode}"]`);
  if (radio) radio.checked = true;
  document.getElementById('beta-banner').checked = s.bannerEnabled;
  document.getElementById('beta-reports').checked = s.reportsEnabled;
  document.getElementById('beta-discord').value = s.discordUrl;
  document.getElementById('beta-policy').value = s.resetPolicy;
  admShowError(document.getElementById('beta-settings-msg'), '');
  betaConfigDiff();
  admDialogOpen('beta-config-dialog', e.currentTarget, document.querySelector('input[name="beta-mode"]:checked'));
});
document.getElementById('beta-config-dialog').addEventListener('input', betaConfigDiff);
document.getElementById('beta-config-dialog').addEventListener('change', betaConfigDiff);

document.getElementById('btn-beta-recommended').addEventListener('click', () => {
  document.querySelector('input[name="beta-mode"][value="invite"]').checked = true;
  document.getElementById('beta-banner').checked = true;
  document.getElementById('beta-reports').checked = true;
  betaConfigDiff();
});

document.getElementById('btn-beta-settings').addEventListener('click', async () => {
  const changes = betaConfigDiff();
  if (!changes.length) return;
  const next = betaConfigForm();
  if (next.registrationMode === 'closed' && !confirm('Fermer les inscriptions ? Plus personne ne pourra créer de compte, même avec un lien d’invitation (les joueurs existants continuent de jouer).')) return;
  const { ok, data } = await api('PUT', '/api/admin/beta/settings', next);
  if (!ok) return admShowError(document.getElementById('beta-settings-msg'), data.error || 'Erreur.');
  document.getElementById('beta-config-dialog').close();
  admToast(`Enregistré : ${BETA_MODES[data.settings.registrationMode]}. Visible par les joueurs au prochain chargement de page.`);
  loadBeta();
});

document.getElementById('btn-beta-known').addEventListener('click', async () => {
  const { ok, data } = await api('PUT', '/api/admin/beta/settings', { knownIssues: document.getElementById('beta-known').value });
  if (!ok) return adMessage('beta-known-msg', data.error || 'Erreur.', false);
  adMessage('beta-known-msg', 'Bugs connus enregistrés.', true);
  admToast('Bugs connus enregistrés.');
  _beta.settings = data.settings;
  document.getElementById('beta-known').dataset.saved = document.getElementById('beta-known').value;
});

document.getElementById('btn-beta-invite').addEventListener('click', async () => {
  const num = id => Number(document.getElementById(id).value);
  const { ok, data } = await api('POST', '/api/admin/beta/invites', {
    label: document.getElementById('beta-inv-label').value.trim(),
    wave: num('beta-inv-wave'), maxUses: num('beta-inv-uses'), expiresInDays: num('beta-inv-days'), count: num('beta-inv-count'),
  });
  if (!ok) return adMessage('beta-batch-msg', data.error || 'Erreur.', false);
  adMessage('beta-batch-msg', `${data.invites.length} code(s) créé(s) : ${data.invites.map(i => i.code).join(', ')} — liens à copier dans « Liens d'invitation créés ».`, true);
  loadBeta();
});

document.getElementById('btn-beta-pw').addEventListener('click', async () => {
  const name = document.getElementById('beta-pw-user').value.trim();
  if (!name) return;
  const { ok, data } = await api('GET', `/api/admin/players/search?q=${encodeURIComponent(name)}`);
  const user = ok && data.users.find(u => u.username.toLowerCase() === name.toLowerCase());
  if (!user) return adMessage('beta-pw-msg', 'Joueur introuvable (nom exact attendu).', false);
  const confirmName = prompt(`Remplacer le mot de passe de « ${user.username} » et fermer ses sessions ?\nSaisir son nom exact pour confirmer :`);
  if (confirmName === null) return;
  const r = await api('POST', `/api/admin/players/${user.id}/temp-password`, { confirm: confirmName.trim() });
  if (!r.ok) return adMessage('beta-pw-msg', r.data.error || 'Erreur.', false);
  adMessage('beta-pw-msg', `Mot de passe temporaire de ${r.data.username} : ${r.data.tempPassword} — affiché une seule fois, à transmettre en privé.`, true);
});

// ── Saisons thématiques (#48) : saison actuelle / suivante ───────────────────
// Écran léger : préparation automatique (serveur), édition facultative. Rendu par textContent uniquement.

const _stFmt = new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function stDate(utc) {
  if (!utc) return '—';
  const d = new Date(String(utc).replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(utc) : `${_stFmt.format(d)} (Bruxelles)`;
}
const ST_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const ST_SOURCE = { pack: 'pack de saison rédigé', fallback: 'nom de repli automatique (sans collection)' };
const ST_STATUS = { prepared: 'préparé', active: 'en cours', archived: 'archivé', rejected: 'rejeté (nom réservé)' };
const ST_EVENTS = {
  created_active: 'Thème attribué à la saison active', prepared: 'Saison suivante préparée', attached: 'Thème rattaché à la saison qui démarre',
  collection: 'Collection importée en brouillon', edited: 'Thème modifié', rejected: 'Nom remplacé (reste réservé)',
  excluded: 'Mot ou nom exclu', exclusion_removed: 'Exclusion retirée',
};

function stMessage(id, text) {
  for (const k of ['st-msg', 'st-err']) document.getElementById(k).classList.add('hidden');
  if (!text) return;
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.remove('hidden');
}

/** « dans 5 j 14 h » / « il y a 2 h » à partir d'une date UTC du serveur. */
function stUntil(utc, now = Date.now()) {
  const t = new Date(String(utc).replace(' ', 'T') + 'Z').getTime();
  if (isNaN(t)) return '';
  const m = Math.round(Math.abs(t - now) / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mn = m % 60;
  const txt = d ? `${d} j ${h} h` : h ? `${h} h ${String(mn).padStart(2, '0')}` : `${mn} min`;
  return t >= now ? `dans ${txt}` : `il y a ${txt}`;
}

/** Date en heure de Bruxelles, l'UTC du serveur en infobulle ; option compte à rebours (rafraîchi chaque minute). */
function stWhen(utc, { countdown = false } = {}) {
  const span = aiEl('span', { class: 'st-when', title: utc ? `${utc} UTC (heure du serveur)` : '' }, admBrussels(utc));
  if (countdown && utc) {
    const c = aiEl('span', { class: 'st-countdown', 'data-until': utc }, ` · ${stUntil(utc)}`);
    span.appendChild(c);
  }
  return span;
}
setInterval(() => {
  for (const el of document.querySelectorAll('#st-card [data-until]')) el.textContent = ` · ${stUntil(el.dataset.until)}`;
}, 60_000);

function stChip(text, tone) { return aiEl('span', { class: `st-chip st-chip--${tone}` }, text); }

/** Ligne « libellé / valeur » d'une liste de faits compacte. */
function stFact(dl, label, value) {
  dl.appendChild(aiEl('dt', {}, label));
  const dd = aiEl('dd');
  if (value instanceof Node) dd.appendChild(value); else dd.textContent = value ?? '—';
  dl.appendChild(dd);
  return dd;
}

function stDetails(parent, summary) {
  const d = aiEl('details', { class: 'st-fold' });
  d.appendChild(aiEl('summary', {}, summary));
  parent.appendChild(d);
  return d;
}

function stButton(parent, label, onClick, cls = 'btn btn-sm btn-outline') {
  const b = aiEl('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

/** Ouvre l'onglet Collections filtré sur la série du thème (aucune modification). */
async function stGoCollection(seriesId) {
  document.querySelector('.tab-btn[data-tab="collections"]')?.click();
  await loadCollections();
  const f = document.getElementById('co-filter-series');
  if (f && [...f.options].some(o => o.value === seriesId)) { f.value = seriesId; f.dispatchEvent(new Event('change')); }
}

/** Préparation automatique : date à venir, ou passe imminente du planificateur si l'horizon est atteint. */
function stPrepWhen(utc) {
  const t = new Date(String(utc).replace(' ', 'T') + 'Z').getTime();
  return t > Date.now() ? `automatique à partir du ${stDate(utc)}` : 'automatique, à la prochaine passe du planificateur';
}

/** État de la collection : publiée / brouillon (non distribuée) / aucune, et images n/m. */
function stCollectionState(col) {
  if (!col) return { chip: stChip('Aucune collection', 'muted'), text: 'Thème seul : aucun objet à collectionner cette semaine.' };
  if (col.problem) return { chip: stChip('Introuvable', 'bad'), text: col.problem };
  if (col.published) return { chip: stChip('Publiée', 'ok'), text: 'Visible et collectionnable en jeu.' };
  return { chip: stChip('Brouillon — non distribuée', 'warn'), text: 'Invisible pour les joueurs, aucun drop actif tant qu\'elle n\'est pas publiée dans Collections.' };
}

function stCollectionBox(parent, col) {
  const box = aiEl('div', { class: 'st-coll' });
  const head = aiEl('p', { class: 'st-coll-head' });
  head.appendChild(aiEl('span', { class: 'st-coll-name' }, col ? `${col.icon ?? ''} ${col.names?.fr ?? col.id}` : 'Collection'));
  const st = stCollectionState(col);
  head.appendChild(st.chip);
  box.appendChild(head);
  if (col && !col.problem) {
    const img = aiEl('p', { class: 'st-coll-images' });
    img.appendChild(aiEl('strong', {}, `${col.withImage}/${col.items}`));
    img.appendChild(document.createTextNode(' objets illustrés'
      + (col.proposals ? ` · ${col.proposals} proposition(s) à examiner` : '')));
    const meter = aiEl('span', { class: 'st-meter', 'aria-hidden': 'true' });
    meter.appendChild(aiEl('span', { style: `width:${col.items ? Math.round(100 * col.withImage / col.items) : 0}%` }));
    box.append(img, meter);
  }
  box.appendChild(aiEl('p', { class: 'muted st-small' }, st.text));
  if (col?.missing?.length) {
    const d = stDetails(box, `Objets sans image (${col.missing.length})`);
    d.appendChild(aiEl('p', { class: 'st-small' }, col.missing.map(m => m.name).join(' · ')));
  }
  parent.appendChild(box);
}

/** Étapes de la saison suivante : préparer → illustrer → publier → annoncer (aucune n'en déclenche une autre). */
function stSteps(parent, data) {
  const n = data.next, t = n.theme, col = t?.collection;
  const steps = [
    ['Préparer', t ? 'fait' : stPrepWhen(n.prepareAt), t ? 'ok' : 'todo'],
    ['Illustrer', !col ? 'sans objet (pas de collection)' : col.withImage >= col.items ? 'toutes les images sont prêtes'
      : `${col.items - col.withImage} image(s) manquante(s)${col.estTotalUsd != null && col.toGenerate ? ` · ≈ ${col.estTotalUsd} $, lancement manuel` : ' · lancement manuel'}`,
    !col ? 'muted' : col.withImage >= col.items ? 'ok' : 'todo'],
    ['Publier', !col ? 'sans objet' : col.published ? 'publiée' : 'non publiée — décision manuelle dans Collections', !col ? 'muted' : col.published ? 'ok' : 'todo'],
    ['Annoncer', !data.settings.public ? 'désactivé (réglage)' : !n.announceAt ? 'désactivé (0 h)'
      : n.announced ? `affichée aux joueurs depuis le ${stDate(n.announceAt)}` : `automatique le ${stDate(n.announceAt)}`,
    !data.settings.public || !n.announceAt ? 'muted' : n.announced ? 'ok' : 'todo'],
  ];
  const ol = aiEl('ol', { class: 'st-steps' });
  for (const [label, text, tone] of steps) {
    const li = aiEl('li', { class: `st-step st-step--${tone}` });
    li.appendChild(aiEl('span', { class: 'st-step-mark', 'aria-hidden': 'true' }, tone === 'ok' ? '✓' : tone === 'muted' ? '–' : '•'));
    const body = aiEl('span');
    body.appendChild(aiEl('strong', {}, label));
    body.appendChild(aiEl('span', { class: 'muted' }, ` — ${text}`));
    li.appendChild(body);
    ol.appendChild(li);
  }
  parent.appendChild(ol);
}

function stEditForm(theme, box) {
  const form = aiEl('div', { class: 'st-edit' });
  const inputs = { names: {}, taglines: {} };
  for (const l of ST_LANGS) {
    const [ln, n] = aiInput(`Nom ${l.toUpperCase()}`, theme.names[l], { maxlength: '40' });
    const [lt, tg] = aiInput(`Accroche ${l.toUpperCase()}`, theme.taglines[l], { maxlength: '160' });
    inputs.names[l] = n; inputs.taglines[l] = tg;
    form.append(ln, lt);
  }
  const [li, icon] = aiInput('Icône (emoji)', theme.icon, { maxlength: '8' });
  form.appendChild(li);
  const actions = aiEl('div', { class: 'form-actions st-edit-actions' });
  stButton(actions, 'Enregistrer', async () => {
    const body = { names: {}, taglines: {}, icon: icon.value };
    for (const l of ST_LANGS) { body.names[l] = inputs.names[l].value; body.taglines[l] = inputs.taglines[l].value; }
    const { ok, data } = await api('PUT', `/api/admin/season-themes/${theme.id}`, body);
    if (!ok) return stMessage('st-err', data.error ?? 'Enregistrement refusé.');
    stMessage('st-msg', `Thème enregistré : « ${data.theme.names.fr} ».`);
    loadSeasonThemes();
  }, 'btn btn-sm');
  stButton(actions, 'Annuler', () => { form.remove(); box.querySelector('[data-st-edit]')?.removeAttribute('disabled'); });
  form.appendChild(actions);
  box.appendChild(form);
}

/** Traductions, actions secondaires et détails techniques d'un thème : repliés par défaut. */
function stThemeFolds(parent, theme, { canReroll }) {
  const tr = stDetails(parent, `Traductions (${ST_LANGS.map(l => l.toUpperCase()).join(' · ')})`);
  const table = aiEl('table', { class: 'st-langs' });
  for (const l of ST_LANGS) {
    const row = aiEl('tr');
    row.appendChild(aiEl('th', { scope: 'row' }, l.toUpperCase()));
    const td = aiEl('td');
    td.appendChild(aiEl('strong', {}, theme.names[l] ?? '—'));
    td.appendChild(aiEl('span', { class: 'muted st-small' }, theme.taglines[l] ? ` — ${theme.taglines[l]}` : ''));
    row.appendChild(td);
    table.appendChild(row);
  }
  tr.appendChild(table);

  const act = stDetails(parent, 'Actions secondaires');
  act.appendChild(aiEl('p', { class: 'muted st-small' }, canReroll
    ? 'Changer le nom avant le début : l\'ancien nom reste réservé à vie et n\'est jamais réutilisé. La collection préparée ne change pas.'
    : 'Corriger un texte de la saison en cours (nom, accroche, icône). Le nouveau nom doit être inédit.'));
  const row = aiEl('div', { class: 'form-actions st-actions' });
  const edit = stButton(row, '✏️ Modifier les textes', () => { edit.disabled = true; stEditForm(theme, act); });
  edit.dataset.stEdit = '1';
  if (canReroll) {
    for (const [label, exclude, confirmText] of [
      ['🎲 Tirer un autre nom', false, `Remplacer « ${theme.names.fr} » par un autre nom inédit ? L'ancien nom restera réservé.`],
      ['🚫 Autre nom et exclure celui-ci', true, `Remplacer « ${theme.names.fr} » et exclure durablement ses mots des futurs noms ?`],
    ]) {
      stButton(row, label, async () => {
        if (!confirm(confirmText)) return;
        const { ok, data } = await api('POST', `/api/admin/season-themes/${theme.id}/reroll`, { exclude });
        if (!ok) return stMessage('st-err', data.error ?? 'Refusé.');
        stMessage('st-msg', `Nouveau nom : « ${data.theme.names.fr} » (l'ancien reste réservé, il ne sera jamais réutilisé).`);
        loadSeasonThemes();
      });
    }
  }
  act.appendChild(row);

  const tech = stDetails(parent, 'Détails techniques');
  const dl = aiEl('dl', { class: 'st-facts st-small' });
  stFact(dl, 'Origine', `${ST_SOURCE[theme.source] ?? theme.source}${theme.pack ? ` (${theme.pack})` : ''}`);
  stFact(dl, 'État du thème', `${ST_STATUS[theme.status] ?? theme.status} · n° ${theme.id} · semaine ${theme.weekKey ?? '—'}`);
  if (theme.collection) stFact(dl, 'Série', `${theme.collection.id}${theme.collection.seasonId ? ` · rattachée à la saison n° ${theme.collection.seasonId}` : ''}`);
  if (theme.notes) stFact(dl, 'Notes', theme.notes);
  tech.appendChild(dl);
}

function stThemeHead(parent, theme) {
  parent.appendChild(aiEl('p', { class: 'st-theme-name' }, `${theme.icon} ${theme.names.fr}`));
  if (theme.taglines?.fr) parent.appendChild(aiEl('p', { class: 'st-tagline' }, theme.taglines.fr));
}

function stCurrentCard(data) {
  const card = aiEl('section', { class: 'st-col', 'aria-label': 'Saison en cours' });
  const head = aiEl('div', { class: 'st-card-head' });
  head.appendChild(aiEl('h4', {}, 'Saison en cours'));
  card.appendChild(head);
  if (!data.current) { head.appendChild(stChip('Aucune', 'muted')); card.appendChild(aiEl('p', { class: 'muted' }, 'Aucune saison active.')); return card; }
  const { season, theme } = data.current;
  head.appendChild(stChip('En cours', 'ok'));
  if (theme) stThemeHead(card, theme);
  else card.appendChild(aiEl('p', { class: 'muted' }, 'Pas encore de thème : il sera attribué automatiquement.'));
  const dl = aiEl('dl', { class: 'st-facts' });
  stFact(dl, 'Saison', season.name);
  stFact(dl, 'Début', stWhen(season.startAt));
  stFact(dl, 'Fin', stWhen(season.endAt, { countdown: true }));
  card.appendChild(dl);
  if (theme) {
    stCollectionBox(card, theme.collection);
    if (theme.collection && !theme.collection.problem) {
      const row = aiEl('div', { class: 'form-actions st-main' });
      stButton(row, '📚 Voir la collection', () => stGoCollection(theme.collection.id));
      card.appendChild(row);
    }
    stThemeFolds(card, theme, { canReroll: false });
  }
  return card;
}

function stNextCard(data) {
  const card = aiEl('section', { class: 'st-col', 'aria-label': 'Prochaine saison' });
  const head = aiEl('div', { class: 'st-card-head' });
  head.appendChild(aiEl('h4', {}, 'Prochaine saison'));
  card.appendChild(head);
  const n = data.next;
  if (!n) { head.appendChild(stChip('Date inconnue', 'muted')); card.appendChild(aiEl('p', { class: 'muted' }, 'Date de la saison suivante indisponible (aucune saison active).')); return card; }
  const t = n.theme;
  head.appendChild(!t ? stChip('À préparer', 'muted') : n.announced ? stChip('Annoncée aux joueurs', 'ok') : stChip('Préparée', 'info'));
  if (t) stThemeHead(card, t);
  else card.appendChild(aiEl('p', { class: 'muted' }, `Pas encore de thème : préparation ${stPrepWhen(n.prepareAt)}.`));
  const dl = aiEl('dl', { class: 'st-facts' });
  stFact(dl, 'Début', stWhen(n.startAt, { countdown: true }));
  stFact(dl, 'Annonce', !data.settings.public ? 'désactivée (réglage)' : n.announceAt ? stWhen(n.announceAt, { countdown: !n.announced }) : 'désactivée (0 h)');
  card.appendChild(dl);
  if (t) stCollectionBox(card, t.collection);
  stSteps(card, data);

  const row = aiEl('div', { class: 'form-actions st-main' });
  if (!t) {
    stButton(row, 'Préparer maintenant', async () => {
      if (!confirm(`Préparer dès maintenant la saison du ${stDate(n.startAt)} ?\n\nUn nom inédit est réservé et, si un pack rédigé est disponible, sa collection est importée en BROUILLON (non publiée, drops inactifs). Rien n'est illustré, publié ni annoncé. Sans cette action, la préparation est ${stPrepWhen(n.prepareAt)}.`)) return;
      const { ok, data: d } = await api('POST', '/api/admin/season-themes/prepare');
      if (!ok) return stMessage('st-err', d.error ?? 'Préparation impossible.');
      stMessage('st-msg', d.next?.theme ? `Saison suivante préparée : « ${d.next.theme.names.fr} ».` : 'Rien à préparer pour l\'instant.');
      loadSeasonThemes();
    }, 'btn btn-sm');
  } else if (t.collection && !t.collection.problem) {
    stButton(row, '📚 Voir / préparer la collection', () => stGoCollection(t.collection.id), 'btn btn-sm');
    if (t.collection.toGenerate) {
      stButton(row, `🎨 Illustrer (${t.collection.toGenerate} image${t.collection.toGenerate > 1 ? 's' : ''})`,
        () => document.querySelector('.tab-btn[data-tab="icons"]')?.click());
    }
  }
  if (row.childElementCount) card.appendChild(row);
  if (t) {
    card.appendChild(aiEl('p', { class: 'muted st-small' }, 'Déjà préparée : une nouvelle préparation ne la remplacerait pas. Pour changer le nom, voir « Actions secondaires ».'));
    stThemeFolds(card, t, { canReroll: true });
  }
  return card;
}

function stSettings(box, data) {
  const s = data.settings;
  const cfg = aiEl('div', { class: 'st-settings' });
  const sw = aiEl('label', { class: 'st-switch' });
  const pub = aiEl('input', { type: 'checkbox', role: 'switch' });
  pub.checked = !!s.public;
  sw.append(pub, aiEl('span', {}, 'Afficher thèmes et annonces aux joueurs'));
  cfg.appendChild(sw);
  cfg.appendChild(aiEl('p', { class: 'muted st-small' }, 'Désactivé : l\'onglet Saison du jeu n\'affiche ni thème, ni annonce, ni historique. La préparation continue.'));
  const num = (label, value, min, max, help) => {
    const l = aiEl('label', {}, label);
    const i = aiEl('input', { type: 'number', min: String(min), max: String(max), step: '1', inputmode: 'numeric' });
    i.value = String(value);
    l.appendChild(i);
    cfg.append(l, aiEl('p', { class: 'muted st-small' }, help));
    return i;
  };
  const prep = num('Préparer la saison suivante (jours avant son début)', s.prepDays, 3, 14, 'De 3 à 14 jours. Nom, textes et collection en brouillon.');
  const ann = num('Annoncer aux joueurs (heures avant le début)', s.announceHours, 0, 168, 'De 0 à 168 heures ; 0 = pas d\'annonce.');
  const actions = aiEl('div', { class: 'form-actions' });
  stButton(actions, 'Enregistrer les réglages', async () => {
    const wanted = [['season_themes_public', String(pub.checked), String(s.public)],
      ['season_prep_days', prep.value.trim(), String(s.prepDays)], ['season_announce_hours', ann.value.trim(), String(s.announceHours)]];
    for (const [i, lo, hi, label] of [[prep, 3, 14, 'Préparation'], [ann, 0, 168, 'Annonce']]) {
      const v = i.value.trim();
      if (!/^\d+$/.test(v) || +v < lo || +v > hi) { i.focus(); return stMessage('st-err', `${label} : nombre entier de ${lo} à ${hi} attendu.`); }
    }
    const changed = wanted.filter(([, v, old]) => v !== old);
    if (!changed.length) return stMessage('st-msg', 'Aucun changement.');
    for (const [key, value] of changed) {
      const { ok, data: d } = await api('PUT', '/api/admin/config', { key, value });
      if (!ok) return stMessage('st-err', d.error ?? 'Réglage refusé.');
    }
    stMessage('st-msg', `Réglages enregistrés (${changed.length}).`);
    loadSeasonThemes();
  }, 'btn btn-sm');
  cfg.appendChild(actions);
  box.appendChild(aiEl('h4', {}, 'Réglages'));
  box.appendChild(cfg);
}

function stMore(data) {
  const box = document.getElementById('st-more');
  box.textContent = '';
  stSettings(box, data);
  // Mots exclus
  box.appendChild(aiEl('h4', {}, 'Mots ou noms exclus'));
  box.appendChild(aiEl('p', { class: 'muted st-small' }, 'Un nom contenant tous les mots d\'une exclusion n\'est jamais proposé. Les noms déjà attribués restent réservés à vie (non listés ici).'));
  const ul = aiEl('ul', { class: 'st-list' });
  for (const ex of data.exclusions) {
    const li = aiEl('li', {}, `${ex.label} `);
    stButton(li, 'Retirer', async () => {
      const { ok, data: d } = await api('DELETE', `/api/admin/season-themes/exclusions/${encodeURIComponent(ex.key)}`);
      if (!ok) return stMessage('st-err', d.error ?? 'Refusé.');
      loadSeasonThemes();
    });
    ul.appendChild(li);
  }
  if (!data.exclusions.length) ul.appendChild(aiEl('li', { class: 'muted' }, 'Aucune exclusion.'));
  box.appendChild(ul);
  const ex = aiEl('div', { class: 'form-actions st-inline' });
  const [lx, ix] = aiInput('Exclure un mot ou un nom', '', { maxlength: '60' });
  ex.appendChild(lx);
  stButton(ex, 'Exclure', async () => {
    const { ok, data: d } = await api('POST', '/api/admin/season-themes/exclusions', { label: ix.value });
    if (!ok) return stMessage('st-err', d.error ?? 'Refusé.');
    loadSeasonThemes();
  }, 'btn btn-sm');
  box.appendChild(ex);
  // Packs de saison
  box.appendChild(aiEl('h4', {}, 'Packs de saison rédigés'));
  box.appendChild(aiEl('p', { class: 'muted st-small' }, 'Fichiers server/content/seasons : un pack fournit nom, textes et collection. Sans pack disponible, la saison reçoit un nom de repli, sans collection.'));
  const pk = aiEl('ul', { class: 'st-list' });
  for (const p of data.packs) {
    pk.appendChild(aiEl('li', {}, `${p.icon} ${p.name} — ${p.items} objets${p.preferredWeek ? ` — semaine ${p.preferredWeek}` : ''} — ${p.used ? 'utilisé' : 'disponible'}`));
  }
  if (!data.packs.length) pk.appendChild(aiEl('li', { class: 'muted' }, 'Aucun pack : les prochaines saisons recevront un nom de repli (sans collection).'));
  box.appendChild(pk);
  // Dépense images (#40)
  const b = data.imageBudget;
  box.appendChild(aiEl('h4', {}, 'Images (atelier d\'icônes)'));
  box.appendChild(aiEl('p', { class: 'muted st-small' }, !b ? 'Atelier indisponible.' : b.configured === false ? `API d'images non configurée : ${b.reason ?? ''}`
    : `Dépensé atelier : ${b.studioSpentUsd ?? 0} $${b.studioCapUsd != null ? ` / plafond ${b.studioCapUsd} $` : ''} · reste ${b.remainingUsd ?? '—'} $ · aujourd'hui ${b.imagesToday ?? 0}/${b.maxImagesPerDay ?? '—'} images. Aucune image n'est générée automatiquement : lancement par « Illustrer ».`));
  // Journal
  box.appendChild(aiEl('h4', {}, 'Journal'));
  const jl = aiEl('ul', { class: 'st-list st-journal' });
  for (const e of data.events) {
    const li = aiEl('li', {}, `${stDate(e.createdAt)} — ${ST_EVENTS[e.action] ?? e.action}${e.themeId ? ` (thème n° ${e.themeId})` : ''}`);
    if (e.details) li.appendChild(aiEl('code', { class: 'st-small' }, ` ${JSON.stringify(e.details).slice(0, 160)}`));
    jl.appendChild(li);
  }
  if (!data.events.length) jl.appendChild(aiEl('li', { class: 'muted' }, 'Rien pour l\'instant.'));
  box.appendChild(jl);
}

async function loadSeasonThemes() {
  const body = document.getElementById('st-body');
  if (!body) return;
  const { ok, data } = await api('GET', '/api/admin/season-themes');
  body.textContent = '';
  if (!ok) { stMessage('st-err', data.error ?? 'Thèmes indisponibles.'); return; }
  body.append(stCurrentCard(data), stNextCard(data));
  stMore(data);
}

document.getElementById('btn-st-refresh')?.addEventListener('click', loadSeasonThemes);

// ── Centre d'actualités (#50) ─────────────────────────────────────────────────
// Liste d'abord ; « ＋ Ajouter » ouvre la fiche. Toute annonce est enregistrée en BROUILLON (y compris
// celles mises en forme par l'IA) ; « Publier » / « Programmer » sont des actions séparées.

const NW_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const NW_STATES = { draft: '📝 Brouillon', scheduled: '⏰ Programmée', live: '✅ En ligne', expired: '⌛ Expirée', archived: '🗄 Archivée' };
const NW_CATS = { news: 'Annonce', season: 'Saison', event: 'Événement', update: 'Mise à jour', maintenance: 'Maintenance', community: 'Communauté', player: 'Fait joueur' };
const NW_SOURCES = { manual: 'Manuelle', ai: 'Mise en forme IA', auto: 'Automatique' };
let _news = null;
let _nwEditing = null;      // annonce ouverte dans la fiche (null = nouvelle)
let _nwProposal = null;     // proposition IA appliquée à la fiche (consommée à l'enregistrement)

/** ISO UTC → valeur d'un champ datetime-local (heure locale du navigateur). */
function nwToLocal(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const nwToUtc = v => (v ? new Date(v).toISOString().replace(/\.\d+Z$/, 'Z') : null);
const nwDate = isoStr => (isoStr ? new Date(isoStr).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function nwMessage(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = isError ? 'error' : 'success';
  el.classList.toggle('hidden', !text);
}

async function loadNews() {
  const status = document.getElementById('news-filter').value;
  const { ok, data } = await api('GET', `/api/admin/news?status=${encodeURIComponent(status)}`);
  if (!ok) return nwMessage('news-msg', data.error ?? 'Chargement impossible.', true);
  _news = data;
  renderNews();
}

function renderNews() {
  const d = _news;
  document.getElementById('news-counts').textContent =
    `${d.counts.draft} brouillon(s) · ${d.counts.published} publiée(s) ou programmée(s) · ${d.counts.archived} archivée(s)`;
  const tb = document.getElementById('news-list');
  tb.textContent = '';
  if (!d.items.length) {
    const tr = document.createElement('tr');
    addCell(tr, 'Aucune annonce. « ＋ Ajouter » pour en créer une (enregistrée en brouillon).').colSpan = 7;
    tb.appendChild(tr);
  }
  for (const it of d.items) {
    const tr = document.createElement('tr');
    const cell = (label, value, cls) => { const td = addCell(tr, value); td.dataset.label = label; if (cls) td.className = cls; return td; };
    cell('État', NW_STATES[it.state] ?? it.state, 'nw-c-state');
    const t = cell('Annonce', `${it.icon} ${it.titles.fr}`, 'nw-c-title');
    if (it.subject) t.appendChild(aiEl('div', { class: 'muted nw-sub' }, `joueur cité : ${it.subject}`));
    for (const w of it.warnings) t.appendChild(aiEl('div', { class: 'muted nw-sub' }, `⚠️ ${w}`));
    cell('Catégorie', NW_CATS[it.category] ?? it.category, 'nw-c-nowrap');
    cell('Publication', it.status === 'draft' ? '—' : nwDate(it.publishAt), 'nw-c-nowrap');
    cell('Événement', nwDate(it.eventAt), 'nw-c-nowrap');
    cell('Source', NW_SOURCES[it.source] ?? it.source, 'nw-c-nowrap');
    const act = cell('Actions', '', 'nw-c-actions');
    const btn = (label, fn, key) => {
      const b = aiEl('button', { class: 'btn-ghost', type: 'button' }, label);
      b.dataset.admKey = `nw-${it.id}-${key}`;
      b.addEventListener('click', fn);
      act.appendChild(b);
      return b;
    };
    if (it.source !== 'auto' || it.status === 'draft') btn('Modifier', e => nwOpen(it, e.currentTarget), 'edit');
    if (it.status === 'draft') btn('Publier…', () => nwConfirmAction(it, 'publish'), 'publish');
    if (it.status === 'published') btn('Dépublier…', () => nwConfirmAction(it, 'unpublish'), 'unpublish');
    if (it.status !== 'archived') btn('Archiver…', () => nwConfirmAction(it, 'archive'), 'archive');
    else btn('Restaurer en brouillon…', () => nwConfirmAction(it, 'restore'), 'restore');
    tb.appendChild(tr);
  }

  const s = d.settings;
  document.getElementById('news-auto-seasons').checked = s.autoSeasons;
  document.getElementById('news-player-events').checked = s.playerEvents;
  document.getElementById('news-depths').value = s.depthMilestones.join(', ');
  document.getElementById('news-rank-top').value = s.rankTop;
  document.getElementById('news-daily-max').value = s.playerDailyMax;
  document.getElementById('news-discord-state').textContent = d.discordUrl
    ? `Discord : le panneau du jeu affiche « Rejoindre le Discord » vers ${d.discordUrl} (lien réglé dans l'onglet 🧪 Bêta → Configurer la bêta).`
    : 'Discord : aucun lien configuré, le panneau du jeu n\'en affiche pas. Pour l\'ajouter : onglet 🧪 Bêta → Configurer la bêta → « Lien d\'invitation Discord ».';

  const lb = document.getElementById('news-log');
  lb.textContent = '';
  for (const l of d.log) {
    const tr = document.createElement('tr');
    [nwDate(l.at), l.news_id ?? '—', l.action, l.details ? JSON.stringify(l.details) : ''].forEach(x => addCell(tr, x));
    lb.appendChild(tr);
  }
}

const _nwBusy = new Set(); // actions en cours (pas de double envoi sur un double clic)
async function nwAction(id, action, okText, body = {}) {
  const key = `${id}:${action}`;
  if (_nwBusy.has(key)) return false;
  _nwBusy.add(key);
  try {
    const { ok, data } = await api('POST', `/api/admin/news/${id}/${action}`, body);
    if (!ok) { admToast(`❌ ${data.error ?? 'Action impossible.'}`); nwMessage('news-msg', data.error ?? 'Action impossible.', true); return false; }
    admToast(okText);
    nwMessage('news-msg', '');
    loadNews();
    return true;
  } finally { _nwBusy.delete(key); }
}

/** Textes des confirmations : effet exact de l'action, réversible ou non, visible des joueurs ou non. */
function nwConfirmText(it, kind, at) {
  const name = `« ${it.titles.fr || 'sans titre'} »`;
  return {
    publish: { title: 'Publier cette annonce ?', text: name, ok: '📣 Publier maintenant',
      impact: ['Visible tout de suite dans le jeu par tous les joueurs (cloche et panneau Actualités).', 'Réversible : « Dépublier » la retire du jeu et la remet en brouillon.'] },
    schedule: { title: 'Programmer la publication ?', text: name, ok: '⏰ Programmer',
      impact: [`Visible dans le jeu à partir du ${nwDate(at)} (heure de ce navigateur).`, 'Jusque-là, invisible des joueurs ; « Dépublier » annule la programmation.'] },
    unpublish: { title: 'Dépublier cette annonce ?', text: name, ok: 'Dépublier', danger: true,
      impact: ['Retirée du jeu immédiatement et remise en brouillon.', 'Rien n\'est supprimé : elle peut être republiée.'] },
    archive: { title: 'Archiver cette annonce ?', text: name, ok: '🗄 Archiver', danger: true,
      impact: ['Elle disparaît du jeu si elle y était (et n\'y sera pas publiée).', 'Réversible : « Restaurer en brouillon » sur sa ligne. Rien n\'est supprimé.'] },
    restore: { title: 'Restaurer en brouillon ?', text: name, ok: 'Restaurer en brouillon',
      impact: ['Elle redevient un brouillon, invisible des joueurs.', 'Rien n\'est publié : la publication reste une action séparée.'] },
  }[kind];
}
const NW_DONE = {
  publish: it => `« ${it.titles.fr} » est publiée : visible tout de suite dans le jeu.`,
  unpublish: () => 'Annonce repassée en brouillon (retirée du jeu).',
  archive: () => 'Annonce archivée.',
  restore: () => 'Annonce restaurée en brouillon.',
};
async function nwConfirmAction(it, kind) {
  if (!await admConfirm(nwConfirmText(it, kind))) return false;
  return nwAction(it.id, kind === 'restore' ? 'unpublish' : kind, NW_DONE[kind](it));
}

function nwFill(item) {
  const v = (id, x) => { document.getElementById(id).value = x ?? ''; };
  v('nw-category', item?.category && NW_CATS[item.category] && item.category !== 'player' ? item.category : 'news');
  v('nw-icon', item?.icon ?? '📰');
  v('nw-event', nwToLocal(item?.eventAt));
  v('nw-expires', nwToLocal(item?.expiresAt));
  v('nw-link', item?.linkUrl ?? '');
  for (const l of NW_LANGS) {
    v(`nw-title-${l}`, item?.titles?.[l]);
    v(`nw-summary-${l}`, item?.summaries?.[l]);
    v(`nw-body-${l}`, item?.bodies?.[l]);
    v(`nw-linklabel-${l}`, item?.linkLabels?.[l]);
  }
  nwPreview();
}

function nwCollect() {
  const g = id => document.getElementById(id).value;
  const texts = prefix => Object.fromEntries(NW_LANGS.map(l => [l, g(`${prefix}-${l}`).trim()]));
  return {
    category: g('nw-category'), icon: g('nw-icon').trim(), linkUrl: g('nw-link').trim() || null,
    eventAt: nwToUtc(g('nw-event')), expiresAt: nwToUtc(g('nw-expires')),
    titles: texts('nw-title'), summaries: texts('nw-summary'), bodies: texts('nw-body'), linkLabels: texts('nw-linklabel'),
  };
}

// Langue éditée : une seule visible à la fois (comme les fiches Collections #39) ; les autres gardent leurs saisies.
let _nwLang = 'fr';
function nwLangState(it, l) {
  if (!it.titles[l]) return 'none';
  return it.summaries[l] || it.bodies[l] ? 'ok' : 'name';
}
function nwLang(l, focus = false) {
  _nwLang = l;
  for (const b of document.querySelectorAll('#nw-langs .co-lang-btn')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
  for (const d of document.querySelectorAll('#news-dialog .nw-lang-fields')) d.classList.toggle('hidden', d.dataset.lang !== l);
  nwPreview();
  if (focus) document.querySelector(`#nw-langs .co-lang-btn[data-lang="${l}"]`).focus();
}

/** Élément d'aperçu d'une annonce dans une langue (repli sur le français, comme dans le jeu). */
function nwPreviewItem(it, l) {
  const tx = k => it[k][l] || it[k].fr;
  const li = aiEl('li', { class: 'news-admin-item' });
  li.appendChild(aiEl('strong', {}, `${it.icon || '📰'} ${tx('titles') || '(titre français manquant)'}`));
  if (it.eventAt) li.appendChild(aiEl('div', { class: 'muted' }, `📅 ${nwDate(it.eventAt)} — rangée dans « À venir » jusqu'à cette date`));
  if (tx('summaries')) li.appendChild(aiEl('div', {}, tx('summaries')));
  for (const p of tx('bodies').split(/\n{2,}/)) if (p.trim()) li.appendChild(aiEl('p', { style: 'margin:4px 0 0;white-space:pre-line' }, p.trim()));
  if (it.linkUrl) li.appendChild(aiEl('div', { class: 'muted' }, `🔗 ${tx('linkLabels') || 'En savoir plus'} → ${it.linkUrl}`));
  return li;
}

function nwPreview() {
  const it = nwCollect();
  const l = _nwLang;
  const ul = document.getElementById('nw-preview');
  ul.textContent = '';
  ul.appendChild(nwPreviewItem(it, l));
  document.getElementById('nw-preview-h').textContent = `Aperçu joueur (${l.toUpperCase()})${l !== 'fr' && !it.titles[l] ? ' — texte français affiché' : ''}`;
  // Pastilles des langues
  for (const b of document.querySelectorAll('#nw-langs .co-lang-btn')) {
    const st = nwLangState(it, b.dataset.lang);
    b.className = `co-lang-btn co-lang--${st}`;
    b.textContent = `${{ ok: '●', name: '◐', none: '○' }[st]} ${b.dataset.lang.toUpperCase()}`;
    b.title = { ok: 'complet', name: 'titre seul : résumé et texte manquants', none: 'à traduire (le français sera affiché)' }[st];
  }
  // Référence française quand on traduit
  const ref = [it.titles.fr, it.summaries.fr].filter(Boolean).join(' — ');
  document.getElementById('nw-fr-ref').classList.toggle('hidden', l === 'fr' || !ref);
  document.getElementById('nw-fr-ref-text').textContent = ref;
  // Libellé de lien seulement s'il y a un lien
  for (const el of document.querySelectorAll('#news-dialog .nw-linklabel')) el.classList.toggle('hidden', !it.linkUrl);
  // Résumé des réglages repliés
  const opts = [NW_CATS[it.category] ?? it.category, it.icon || '📰', it.eventAt ? `📅 ${nwDate(it.eventAt)}` : 'sans date',
    it.expiresAt ? `expire ${nwDate(it.expiresAt)}` : null, it.linkUrl ? '🔗 lien' : 'sans lien'].filter(Boolean);
  document.getElementById('nw-opts-sum').textContent = `— ${opts.join(' · ')}`;
  const miss = NW_LANGS.filter(x => x !== 'fr' && !it.titles[x]);
  const w = document.getElementById('nw-warn');
  w.textContent = miss.length ? `Titre manquant en ${miss.join(', ').toUpperCase()} : le français sera affiché à ces joueurs.` : '';
  w.classList.toggle('hidden', !miss.length);
  nwDirtyUpdate();
}

// Saisies non enregistrées (notes brutes comprises) : confirmation avant toute fermeture (✕, Annuler, Échap, fond, page).
let _nwSnap = null;
const nwSnapshot = () => JSON.stringify([nwCollect(), document.getElementById('nw-raw').value.trim()]);
const nwDirty = () => document.getElementById('news-dialog').open && _nwSnap !== null && nwSnapshot() !== _nwSnap;
function nwDirtyUpdate() { document.getElementById('nw-dirty').classList.toggle('hidden', !nwDirty()); }

async function nwRequestClose() {
  const dlg = document.getElementById('news-dialog');
  if (nwDirty() && !await admConfirm({
    title: 'Modifications non enregistrées',
    text: 'Cette fiche contient des saisies qui ne sont pas enregistrées (notes, textes ou réglages).',
    impact: ['« Abandonner » ferme la fiche et perd ces saisies (une mise en forme IA non enregistrée serait à refaire).', 'Pour les garder : « Continuer à modifier », puis « 💾 Enregistrer le brouillon ».'],
    ok: 'Abandonner les modifications', cancel: 'Continuer à modifier', danger: true,
  })) return;
  _nwSnap = null;
  dlg.close();
}

function nwOpen(item, opener) {
  _nwEditing = item ?? null;
  _nwProposal = null;
  document.getElementById('news-dialog-title').textContent = item ? `Modifier l'annonce n° ${item.id}` : '＋ Nouvelle annonce';
  document.getElementById('nw-ai-box').open = !item;
  document.getElementById('nw-opts').open = false;
  document.getElementById('nw-raw').value = '';
  document.getElementById('nw-ai-state').textContent = '';
  nwAiNotes(null);
  document.getElementById('nw-publish-at').value = '';
  document.getElementById('nw-publish-row').classList.toggle('hidden', !item || item.status === 'archived');
  document.getElementById('btn-nw-save').textContent = item && item.status !== 'draft' ? '💾 Enregistrer les modifications' : '💾 Enregistrer le brouillon';
  nwMessage('nw-error', '');
  nwFill(item);
  nwLang('fr');
  admDialogOpen('news-dialog', opener, item ? 'nw-title-fr' : 'nw-raw');
  document.querySelector('#news-dialog .nw-scroll').scrollTop = 0;
  _nwSnap = nwSnapshot();
  nwDirtyUpdate();
}

/** Remarques de l'IA : au premier plan seulement ce qui manque vraiment ou pose problème ; le reste replié. */
function nwAiNotes(p) {
  const notes = document.getElementById('nw-ai-notes');
  const more = document.getElementById('nw-ai-more');
  const sug = document.getElementById('nw-ai-suggestions');
  notes.textContent = '';
  sug.textContent = '';
  more.open = false;
  for (const m of p?.missing ?? []) notes.appendChild(aiEl('li', {}, `❓ À compléter : ${m}`));
  for (const m of p?.doubts ?? []) notes.appendChild(aiEl('li', {}, `⚠️ À vérifier : ${m}`));
  for (const m of p?.suggestions ?? []) sug.appendChild(aiEl('li', {}, m));
  more.classList.toggle('hidden', !(p?.suggestions ?? []).length);
  document.getElementById('nw-ai-more-sum').textContent = `Autres suggestions facultatives (${(p?.suggestions ?? []).length})`;
}

/** Enregistre la fiche ; rend l'annonce enregistrée ou null. */
let _nwSaving = false;
async function nwSave() {
  if (_nwSaving) return null;
  _nwSaving = true;
  const save = document.getElementById('btn-nw-save');
  save.disabled = true;
  try {
    const body = nwCollect();
    if (_nwProposal && !_nwEditing) body.aiProposalId = _nwProposal;
    const { ok, data } = _nwEditing
      ? await api('PUT', `/api/admin/news/${_nwEditing.id}`, body)
      : await api('POST', '/api/admin/news', body);
    if (!ok) { nwMessage('nw-error', (data.details ?? [data.error ?? 'Enregistrement impossible.']).join(' '), true); return null; }
    _nwEditing = data.item;
    _nwProposal = null;
    document.getElementById('news-dialog-title').textContent = `Modifier l'annonce n° ${data.item.id}`;
    document.getElementById('nw-publish-row').classList.toggle('hidden', data.item.status === 'archived');
    nwMessage('nw-error', '');
    _nwSnap = nwSnapshot();
    nwDirtyUpdate();
    loadNews();
    return data.item;
  } finally { _nwSaving = false; save.disabled = false; }
}

async function nwPoll(id) {
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const { ok, data } = await api('GET', `/api/admin/news-ai/${id}`);
    if (!ok) return { status: 'error', error: data.error };
    if (data.proposal.status !== 'pending') return data.proposal;
  }
  return { status: 'error', error: 'Toujours en cours après 3 minutes : rouvre la fiche plus tard.' };
}

/** Fiche complète (toutes les langues + réglages) sur une page, pour impression ou PDF, sans zone tronquée. */
function nwPrint() {
  const it = nwCollect();
  const root = document.getElementById('nw-print');
  root.textContent = '';
  root.appendChild(aiEl('h1', {}, document.getElementById('news-dialog-title').textContent));
  const st = _nwEditing ? (NW_STATES[_nwEditing.state] ?? _nwEditing.state) : '📝 Non enregistrée';
  const dl = aiEl('dl', {});
  for (const [k, v] of [['État', `${st}${nwDirty() ? ' — modifications non enregistrées' : ''}`], ['Catégorie', NW_CATS[it.category] ?? it.category],
    ['Icône', it.icon || '📰'], ['Événement', nwDate(it.eventAt)], ['Expiration', nwDate(it.expiresAt)], ['Lien', it.linkUrl ?? '—']]) {
    dl.append(aiEl('dt', {}, k), aiEl('dd', {}, v));
  }
  root.appendChild(dl);
  for (const l of NW_LANGS) {
    root.appendChild(aiEl('h2', {}, `${l.toUpperCase()}${l !== 'fr' && !it.titles[l] ? ' — non traduit (français affiché)' : ''}`));
    const ul = aiEl('ul', { class: 'news-admin-preview' });
    ul.appendChild(nwPreviewItem(it, l));
    root.appendChild(ul);
  }
  document.body.classList.add('nw-printing');
  window.addEventListener('afterprint', () => document.body.classList.remove('nw-printing'), { once: true });
  window.print();
}

document.getElementById('btn-nw-ai')?.addEventListener('click', async e => {
  const b = e.currentTarget;
  const state = document.getElementById('nw-ai-state');
  nwAiNotes(null);
  b.disabled = true;
  state.textContent = '⏳ Mise en forme en cours (10 à 40 s)…';
  try {
    const { ok, data } = await api('POST', '/api/admin/news-ai', { text: document.getElementById('nw-raw').value });
    if (!ok) { state.textContent = `❌ ${data.error ?? 'Impossible de lancer la mise en forme.'}`; return; }
    const p = await nwPoll(data.proposal.id);
    if (p.status !== 'open') { state.textContent = `❌ ${p.error ?? 'Échec de la mise en forme.'}`; return; }
    nwFill({ ...nwCollect(), ...p.data.item });
    _nwProposal = _nwEditing ? null : p.id;
    state.textContent = '✅ Fiche remplie : relis chaque langue (FR, EN, NL, ES), corrige si besoin, puis « 💾 Enregistrer le brouillon ».';
    nwAiNotes(p.data);
  } finally { b.disabled = false; }
});

document.getElementById('btn-nw-save')?.addEventListener('click', async () => {
  const it = await nwSave();
  if (it) admToast(it.status === 'draft' ? 'Brouillon enregistré (invisible dans le jeu).' : 'Modifications enregistrées.');
});
document.getElementById('btn-nw-publish')?.addEventListener('click', async () => {
  const cur = { ...(_nwEditing ?? {}), titles: nwCollect().titles };
  if (!await admConfirm(nwConfirmText(cur, 'publish'))) return;
  const it = await nwSave();
  if (it && await nwAction(it.id, 'publish', NW_DONE.publish(it))) { _nwSnap = null; document.getElementById('news-dialog').close(); }
});
document.getElementById('btn-nw-schedule')?.addEventListener('click', async () => {
  const at = nwToUtc(document.getElementById('nw-publish-at').value);
  if (!at) return nwMessage('nw-error', 'Choisis la date et l\'heure de publication.', true);
  const cur = { ...(_nwEditing ?? {}), titles: nwCollect().titles };
  if (!await admConfirm(nwConfirmText(cur, 'schedule', at))) return;
  const it = await nwSave();
  if (it && await nwAction(it.id, 'publish', `Publication programmée le ${nwDate(at)}.`, { at })) { _nwSnap = null; document.getElementById('news-dialog').close(); }
});

document.getElementById('btn-news-settings')?.addEventListener('click', async () => {
  const { ok, data } = await api('PUT', '/api/admin/news/settings', {
    autoSeasons: document.getElementById('news-auto-seasons').checked,
    playerEvents: document.getElementById('news-player-events').checked,
    depthMilestones: document.getElementById('news-depths').value.split(',').map(x => x.trim()).filter(Boolean).join(','),
    rankTop: document.getElementById('news-rank-top').value,
    playerDailyMax: document.getElementById('news-daily-max').value,
  });
  if (!ok) return nwMessage('news-settings-msg', data.error ?? 'Réglages refusés.', true);
  nwMessage('news-settings-msg', 'Réglages enregistrés.');
  loadNews();
});

if (document.getElementById('news-dialog')) {
  const dlg = admDialogSetup('news-dialog');
  // Fermeture protégée : ✕ / Annuler / fond interceptés avant admDialogSetup, Échap via « cancel ».
  dlg.addEventListener('click', e => {
    const closeBtn = e.target.closest('[data-close]');
    if (e.target === dlg) {
      // Clic dans la marge intérieure de la fiche : ignoré ; seul un clic sur le fond (hors cadre) demande la fermeture.
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      e.stopImmediatePropagation();
      if (!inside) nwRequestClose();
      return;
    }
    if (!closeBtn) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    nwRequestClose();
  }, true);
  dlg.addEventListener('cancel', e => { e.preventDefault(); nwRequestClose(); });
  dlg.addEventListener('close', () => { _nwSnap = null; });
  window.addEventListener('beforeunload', e => { if (nwDirty()) { e.preventDefault(); e.returnValue = ''; } });
  dlg.addEventListener('input', () => nwPreview());
  dlg.addEventListener('change', () => nwPreview());
  document.querySelectorAll('#nw-langs .co-lang-btn').forEach((b, k, all) => {
    b.addEventListener('click', () => nwLang(b.dataset.lang));
    b.addEventListener('keydown', e => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      nwLang(all[(k + step + all.length) % all.length].dataset.lang, true);
    });
  });
  document.getElementById('btn-nw-print').addEventListener('click', nwPrint);
  document.getElementById('btn-news-add').addEventListener('click', e => nwOpen(null, e.currentTarget));
  document.getElementById('btn-news-refresh').addEventListener('click', loadNews);
  document.getElementById('news-filter').addEventListener('change', loadNews);
}

// ── Événements mensuels (#56) ─────────────────────────────────────────────────
// Liste, fiche (brouillon), objets, simulation, planification, révisions, TEST, IA, calendrier.

let _ev = null;          // vue admin (GET /api/admin/events)
let _evEditing = null;   // identifiant en cours de modification (null = création)
const EV_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const EV_STATES = { draft: '📝 Brouillon', planned: '🗓️ Planifié', active: '🟢 Actif', ended: '🏁 Terminé' };
const EV_RARITIES = { commun: 'Commun', 'peu-commun': 'Peu commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire' };
const EV_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const evFmt = local => (local ? local.replace('T', ' ') : '—');

async function loadEvents() {
  const { ok, data } = await api('GET', '/api/admin/events');
  if (!ok) return nwMessage('ev-msg', data.error ?? 'Chargement impossible.', true);
  _ev = data;
  renderEvents();
}

function renderEvents() {
  const tb = document.getElementById('ev-list');
  tb.textContent = '';
  if (!_ev.events.length) {
    const tr = document.createElement('tr');
    addCell(tr, 'Aucun événement. « ＋ Ajouter », le calendrier ou l\'IA pour en créer un (toujours en brouillon).').colSpan = 7;
    tb.appendChild(tr);
  }
  for (const ev of _ev.events) {
    const tr = document.createElement('tr');
    addCell(tr, EV_STATES[ev.state] ?? ev.state);
    const name = addCell(tr, `${ev.icon} ${ev.names.fr}`);
    name.appendChild(aiEl('div', { class: 'muted', style: 'font-size:0.75rem' }, `${ev.id} · rév. ${ev.revision} · source ${ev.source}`));
    if (ev.status === 'draft') {
      for (const b of ev.readiness.blocking) name.appendChild(aiEl('div', { class: 'muted', style: 'font-size:0.75rem' }, `❌ ${b}`));
    }
    for (const w of ev.readiness.warnings) name.appendChild(aiEl('div', { class: 'muted', style: 'font-size:0.75rem' }, `⚠️ ${w}`));
    addCell(tr, ev.audience === 'public' ? '🌍 Public' : `🧪 TEST (${ev.testers.join(', ') || 'aucun testeur'})`);
    addCell(tr, `${evFmt(ev.startsLocal)} → ${evFmt(ev.endsLocal)}`);
    addCell(tr, `${ev.items.filter(i => i.enabled).length} actif(s) / ${ev.items.length}`);
    const found = Object.values(ev.stats.finds).reduce((a, b) => a + b, 0);
    addCell(tr, `${ev.stats.players} joueur(s) · ${found} objet(s) trouvé(s)`);
    const act = addCell(tr, '');
    const btn = (label, fn) => { const b = aiEl('button', { class: 'btn-ghost', type: 'button' }, label); b.addEventListener('click', fn); act.appendChild(b); return b; };
    if (ev.status === 'draft') {
      btn('Modifier', () => evOpen(ev));
      btn('Planifier', () => evSchedule(ev));
    } else {
      btn('Voir', () => evOpen(ev, true));
      btn('Repasser en brouillon', () => {
        if (confirm(`Repasser « ${ev.names.fr} » en brouillon ? Les drops s'arrêtent aussitôt ; les objets déjà trouvés restent acquis.`)) evAction(ev.id, 'unschedule', 'Événement repassé en brouillon : drops arrêtés.');
      });
    }
    btn('Révisions', () => evRevisions(ev));
    tb.appendChild(tr);
  }
  renderEvCalendar();
  const jobs = document.getElementById('ev-ai-jobs');
  jobs.textContent = '';
  for (const j of _ev.ai) {
    const label = j.status === 'pending' ? '⏳ en cours…' : j.status === 'done' ? `✅ brouillon « ${j.eventId} » créé` : `❌ ${j.error}`;
    jobs.appendChild(aiEl('li', {}, `#${j.id} « ${j.concept.slice(0, 60)} » : ${label}`));
  }
  if (_ev.ai.some(j => j.status === 'pending')) setTimeout(() => { if (!document.getElementById('tab-events').classList.contains('hidden')) loadEvents(); }, 4000);
  const lb = document.getElementById('ev-log');
  lb.textContent = '';
  for (const l of _ev.log) {
    const tr = document.createElement('tr');
    [l.at, l.eventId ?? '—', l.action, l.details ? JSON.stringify(l.details) : ''].forEach(x => addCell(tr, x));
    lb.appendChild(tr);
  }
}

function renderEvCalendar() {
  const sel = document.getElementById('ev-cal-year');
  const years = _ev.calendar.map(c => c.year);
  if (!sel.options.length || [...sel.options].map(o => +o.value).join() !== years.join()) {
    sel.textContent = '';
    for (const y of years) sel.appendChild(aiEl('option', { value: String(y) }, String(y)));
  }
  const cal = _ev.calendar.find(c => c.year === +sel.value) ?? _ev.calendar[0];
  const tb = document.getElementById('ev-calendar');
  tb.textContent = '';
  for (const m of cal.months) {
    const tr = document.createElement('tr');
    addCell(tr, `${EV_MONTHS[m.month - 1]} ${m.year}`);
    const prop = addCell(tr, m.holiday ? `${m.holiday.name} (${m.holiday.date})` : `Idées : ${m.ideas.join(' · ')}`);
    if (m.alternatives.length) prop.appendChild(aiEl('div', { class: 'muted', style: 'font-size:0.75rem' }, `Autres : ${m.alternatives.map(a => `${a.name} (${a.date})`).join(', ')}`));
    addCell(tr, m.suggested ? `${evFmt(m.suggested.startsAt)} → ${evFmt(m.suggested.endsAt)}` : 'à choisir');
    addCell(tr, m.prepareBy ? `${m.prepareBy}${m.late ? ' ⚠️ en retard' : ''}` : '—');
    addCell(tr, m.events.length ? m.events.map(e => `${e.icon} ${e.name} (${EV_STATES[e.state] ?? e.state})`).join(', ') : '—');
    const act = addCell(tr, '');
    if (!m.events.length) {
      const b = aiEl('button', { class: 'btn-ghost', type: 'button' }, 'Préparer un brouillon');
      b.addEventListener('click', () => evOpen(null, false, {
        id: m.holiday ? `${m.holiday.key}_${m.year}` : '', icon: '🎉', audience: 'public', testers: [],
        names: { fr: m.holiday ? m.holiday.name : '', en: '', nl: '', es: '' }, taglines: {},
        startsLocal: m.suggested?.startsAt ?? `${m.year}-${String(m.month).padStart(2, '0')}-01T00:00`,
        endsLocal: m.suggested?.endsAt ?? '', items: [],
      }));
      act.appendChild(b);
    }
    tb.appendChild(tr);
  }
}

function evItemRow(it = {}) {
  const box = aiEl('fieldset', { class: 'overview-card ev-item', style: 'margin:6px 0' });
  box.appendChild(aiEl('legend', {}, it.names?.fr || 'Nouvel objet'));
  const grid = aiEl('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px' });
  const field = (label, key, input) => { const l = aiEl('label', {}, label); input.dataset.k = key; l.appendChild(input); grid.appendChild(l); return input; };
  field('Identifiant', 'id', aiEl('input', { maxlength: '40' })).value = it.id ?? '';
  field('Icône', 'icon', aiEl('input', { maxlength: '8' })).value = it.icon ?? '🎁';
  const rar = field('Rareté', 'rarity', aiEl('select'));
  for (const [k, v] of Object.entries(EV_RARITIES)) rar.appendChild(aiEl('option', { value: k }, v));
  rar.value = it.rarity ?? 'commun';
  field('Chance par bloc éligible (%)', 'chancePct', aiEl('input', { type: 'number', step: '0.001', min: '0.001', max: '100' })).value = it.chancePct ?? 0.5;
  field('Profondeur minimale (m)', 'minDepth', aiEl('input', { type: 'number', min: '0' })).value = it.minDepth ?? 0;
  const en = field('Activé', 'enabled', aiEl('input', { type: 'checkbox' }));
  en.checked = it.enabled !== false;
  box.appendChild(grid);
  const cats = aiEl('div', { class: 'form-actions', style: 'align-items:center' });
  cats.appendChild(aiEl('span', { class: 'muted', style: 'font-size:0.8rem' }, 'Blocs (aucun coché = tous) :'));
  for (const c of _ev.categories) {
    const l = aiEl('label', { class: 'adm-check' });
    const cb = aiEl('input', { type: 'checkbox', 'data-cat': c });
    cb.checked = (it.dropFrom ?? []).includes(c);
    l.append(cb, document.createTextNode(` ${c}`));
    cats.appendChild(l);
  }
  box.appendChild(cats);
  const texts = aiEl('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px' });
  for (const l of EV_LANGS) {
    const n = aiEl('input', { maxlength: '60', 'data-k': `name-${l}`, placeholder: `Nom ${l.toUpperCase()}` });
    n.value = it.names?.[l] ?? '';
    const d = aiEl('textarea', { rows: '2', maxlength: '320', 'data-k': `desc-${l}`, placeholder: `Description humoristique ${l.toUpperCase()}` });
    d.value = it.descs?.[l] ?? '';
    const lab = aiEl('label', {}, l.toUpperCase());
    lab.append(n, d);
    texts.appendChild(lab);
  }
  box.appendChild(texts);
  const brief = aiEl('textarea', { rows: '2', maxlength: '600', 'data-k': 'brief', placeholder: 'Consigne d\'illustration (anglais) pour l\'atelier' });
  brief.value = it.brief ?? '';
  const bl = aiEl('label', {}, 'Consigne d\'illustration');
  bl.appendChild(brief);
  box.appendChild(bl);
  const imgRow = aiEl('div', { class: 'form-actions', style: 'align-items:center' });
  const img = aiEl('input', { 'data-k': 'image', placeholder: '/api/collections/images/… ou /media/icons/…', style: 'min-width:280px' });
  img.value = it.image ?? '';
  const file = aiEl('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      const { ok, data } = await api('POST', '/api/admin/collections/images', { data: r.result, label: `event ${it.id ?? ''}` });
      if (!ok) return nwMessage('ev-editor-msg', data.error ?? 'Téléversement impossible.', true);
      img.value = data.url;
      admToast('Image téléversée : enregistrez la fiche pour l\'appliquer.');
    };
    r.readAsDataURL(f);
  });
  const del = aiEl('button', { class: 'btn-ghost', type: 'button' }, '🗑 Retirer l\'objet');
  del.addEventListener('click', () => box.remove());
  imgRow.append(aiEl('span', { class: 'muted', style: 'font-size:0.8rem' }, 'Image :'), img, file, del);
  box.appendChild(imgRow);
  document.getElementById('ev-items').appendChild(box);
}

function evOpen(ev, readOnly = false, preset = null) {
  const src = ev ?? preset ?? { icon: '🎉', audience: 'test', testers: [], names: {}, taglines: {}, items: [] };
  _evEditing = ev ? ev.id : null;
  const v = (id, x) => { document.getElementById(id).value = x ?? ''; };
  v('ev-id', src.id); v('ev-icon', src.icon); v('ev-audience', src.audience); v('ev-testers', (src.testers ?? []).join(', '));
  v('ev-start', src.startsLocal); v('ev-end', src.endsLocal);
  document.getElementById('ev-id').disabled = !!ev;
  const texts = document.getElementById('ev-texts');
  texts.textContent = '';
  for (const l of EV_LANGS) {
    const lab = aiEl('label', {}, `Nom et accroche ${l.toUpperCase()}`);
    const n = aiEl('input', { id: `ev-name-${l}`, maxlength: '60' }); n.value = src.names?.[l] ?? '';
    const t = aiEl('textarea', { id: `ev-tag-${l}`, rows: '2', maxlength: '240' }); t.value = src.taglines?.[l] ?? '';
    lab.append(n, t);
    texts.appendChild(lab);
  }
  document.getElementById('ev-items').textContent = '';
  for (const it of src.items ?? []) evItemRow(it);
  document.getElementById('ev-editor-title').textContent = ev ? `${readOnly ? 'Consultation' : 'Modification'} : ${ev.icon} ${ev.names.fr}${readOnly ? ' (planifié : repassez-le en brouillon pour le modifier)' : ''}` : 'Nouvel événement (brouillon)';
  const rd = document.getElementById('ev-readiness');
  rd.textContent = '';
  if (ev) for (const b of ev.readiness.blocking) rd.appendChild(aiEl('li', {}, `❌ ${b}`));
  document.getElementById('btn-ev-save').disabled = readOnly;
  document.getElementById('ev-sim').textContent = '';
  nwMessage('ev-editor-msg', '');
  const card = document.getElementById('ev-editor');
  card.classList.remove('hidden');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function evCollect() {
  const g = id => document.getElementById(id).value;
  const items = [...document.querySelectorAll('#ev-items .ev-item')].map(box => {
    const q = k => box.querySelector(`[data-k="${k}"]`);
    return {
      id: q('id').value.trim(), icon: q('icon').value.trim(), rarity: q('rarity').value, chancePct: Number(q('chancePct').value),
      minDepth: Number(q('minDepth').value), enabled: q('enabled').checked, brief: q('brief').value.trim(), image: q('image').value.trim() || null,
      dropFrom: [...box.querySelectorAll('[data-cat]')].filter(c => c.checked).map(c => c.dataset.cat),
      names: Object.fromEntries(EV_LANGS.map(l => [l, q(`name-${l}`).value.trim()])),
      descs: Object.fromEntries(EV_LANGS.map(l => [l, q(`desc-${l}`).value.trim()])),
    };
  });
  return {
    id: g('ev-id').trim(), icon: g('ev-icon').trim(), audience: g('ev-audience'),
    testers: g('ev-testers').split(',').map(x => x.trim()).filter(Boolean), startsAt: g('ev-start'), endsAt: g('ev-end'),
    names: Object.fromEntries(EV_LANGS.map(l => [l, g(`ev-name-${l}`).trim()])),
    taglines: Object.fromEntries(EV_LANGS.map(l => [l, g(`ev-tag-${l}`).trim()])),
    items,
  };
}

async function evSave() {
  const body = evCollect();
  const { ok, data } = _evEditing ? await api('PUT', `/api/admin/events/${encodeURIComponent(_evEditing)}`, body) : await api('POST', '/api/admin/events', body);
  if (!ok) return nwMessage('ev-editor-msg', data.error ?? 'Enregistrement impossible.', true);
  _evEditing = data.event.id;
  document.getElementById('ev-id').disabled = true;
  admToast(`« ${data.event.names.fr} » enregistré en brouillon (révision ${data.event.revision}). Rien n'est visible des joueurs.`);
  nwMessage('ev-editor-msg', '');
  await loadEvents();
  const ev = _ev.events.find(e => e.id === data.event.id);
  const rd = document.getElementById('ev-readiness');
  rd.textContent = '';
  if (ev) for (const b of ev.readiness.blocking) rd.appendChild(aiEl('li', {}, `❌ ${b}`));
}

async function evSimulate() {
  const { ok, data } = await api('POST', '/api/admin/events/simulate', { event: evCollect(),
    depth: Number(document.getElementById('ev-sim-depth').value), blocksPerDay: Number(document.getElementById('ev-sim-bpd').value) });
  const box = document.getElementById('ev-sim');
  box.textContent = '';
  if (!ok) return nwMessage('ev-editor-msg', data.error ?? 'Simulation impossible.', true);
  const table = aiEl('table');
  const head = aiEl('tr');
  ['Objet', 'Part des blocs éligibles', 'Chance réelle par bloc', 'Blocs (médiane)', 'Blocs (moyenne)', `Obtenu sur ${data.days} j à ${data.blocksPerDay} blocs/j`].forEach(h => head.appendChild(aiEl('th', {}, h)));
  table.appendChild(head);
  for (const it of data.items) {
    const tr = document.createElement('tr');
    [it.name, `${Math.round(it.eligibleShare * 1000) / 10} %`, `${Math.round(it.perBlock * 100000) / 1000} %`, it.medianBlocks ?? '—', it.meanBlocks ?? '—', `${it.chanceOverEvent} %`].forEach(x => addCell(tr, x));
    table.appendChild(tr);
  }
  box.appendChild(table);
  box.appendChild(aiEl('p', { class: 'muted', style: 'font-size:0.75rem' }, `Profondeur ${data.depth} m, poids du catalogue de blocs publié. Seuls les blocs validés par le serveur comptent.`));
}

async function evAction(id, action, okText, body = {}) {
  const { ok, data } = await api('POST', `/api/admin/events/${encodeURIComponent(id)}/${action}`, body);
  if (!ok) { nwMessage('ev-msg', data.error ?? 'Action impossible.', true); return false; }
  admToast(okText);
  nwMessage('ev-msg', '');
  document.getElementById('ev-editor').classList.add('hidden');
  loadEvents();
  return true;
}

function evSchedule(ev) {
  if (ev.audience === 'public') {
    if (!confirm(`PUBLIER « ${ev.names.fr} » pour TOUS les joueurs du ${evFmt(ev.startsLocal)} au ${evFmt(ev.endsLocal)} (heure de Bruxelles) ?\n\nÀ faire seulement après validation du propriétaire.`)) return;
    if (!confirm('Confirmez que le barème des drops (chances, profondeurs) est validé.')) return;
    return evAction(ev.id, 'schedule', `« ${ev.names.fr} » planifié pour tous les joueurs.`, { confirmRates: true, confirmPublic: true });
  }
  if (confirm(`Planifier l'événement TEST « ${ev.names.fr} » pour ${ev.testers.join(', ')} ?`)) evAction(ev.id, 'schedule', 'Événement TEST planifié : seuls les testeurs le voient.');
}

async function evRevisions(ev) {
  const { ok, data } = await api('GET', `/api/admin/events/${encodeURIComponent(ev.id)}/revisions`);
  if (!ok) return nwMessage('ev-msg', data.error ?? 'Révisions indisponibles.', true);
  document.getElementById('ev-revisions-title').textContent = `Révisions : ${ev.icon} ${ev.names.fr}`;
  const tb = document.getElementById('ev-revisions');
  tb.textContent = '';
  for (const r of data.revisions) {
    const tr = document.createElement('tr');
    [r.revision, r.at, r.action, r.status, r.items].forEach(x => addCell(tr, x));
    const act = addCell(tr, '');
    if (ev.status === 'draft' && r.revision !== ev.revision) {
      const b = aiEl('button', { class: 'btn-ghost', type: 'button' }, 'Restaurer en brouillon');
      b.addEventListener('click', () => { if (confirm(`Restaurer la révision ${r.revision} (en brouillon) ?`)) evAction(ev.id, 'restore', `Révision ${r.revision} restaurée en brouillon.`, { revision: r.revision }); });
      act.appendChild(b);
    }
    tb.appendChild(tr);
  }
  document.getElementById('ev-revisions-card').classList.remove('hidden');
}

document.getElementById('btn-ev-add')?.addEventListener('click', () => evOpen(null));
document.getElementById('btn-ev-refresh')?.addEventListener('click', loadEvents);
document.getElementById('btn-ev-item-add')?.addEventListener('click', () => evItemRow());
document.getElementById('btn-ev-save')?.addEventListener('click', evSave);
document.getElementById('btn-ev-sim')?.addEventListener('click', evSimulate);
document.getElementById('btn-ev-cancel')?.addEventListener('click', () => document.getElementById('ev-editor').classList.add('hidden'));
document.getElementById('ev-cal-year')?.addEventListener('change', renderEvCalendar);
document.getElementById('btn-ev-test')?.addEventListener('click', async () => {
  const testers = document.getElementById('ev-test-testers').value.split(',').map(x => x.trim()).filter(Boolean);
  if (!testers.length) return nwMessage('ev-msg', 'Indiquez au moins un pseudo testeur.', true);
  const { ok, data } = await api('POST', '/api/admin/events/test', { testers, minutes: Number(document.getElementById('ev-test-minutes').value) });
  if (!ok) return nwMessage('ev-msg', data.error ?? 'Création impossible.', true);
  admToast(`Événement TEST « ${data.event.id} » créé en brouillon : « Planifier » pour l'activer.`);
  loadEvents();
});
document.getElementById('btn-ev-ai')?.addEventListener('click', async () => {
  const { ok, data } = await api('POST', '/api/admin/events-ai', { concept: document.getElementById('ev-ai-concept').value,
    startsAt: document.getElementById('ev-ai-start').value, endsAt: document.getElementById('ev-ai-end').value,
    itemCount: Number(document.getElementById('ev-ai-count').value) });
  if (!ok) return nwMessage('ev-msg', data.error ?? 'Proposition impossible.', true);
  admToast('Proposition IA lancée : le brouillon apparaîtra dans la liste.');
  loadEvents();
});
