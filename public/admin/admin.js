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
// ── Saisies protégées (#61) ─────────────────────────────────────────────────────
// Suivi générique des modifications d'une zone (fiche <dialog> ou formulaire de page) : la valeur d'un champ est
// relevée juste avant la première action de l'utilisateur (focus, clic, touche), puis comparée à la valeur actuelle.
// Un remplissage par le code (chargement, IA) n'est donc jamais pris pour une saisie ; revenir à la valeur
// d'origine = plus de modification. Les champs de recherche et ceux marqués data-adm-noguard sont ignorés.
const ADM_FIELD = 'input, select, textarea';
function admFieldValue(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '0';
  if (el.type === 'file') return [...(el.files ?? [])].map(f => `${f.name}:${f.size}:${f.lastModified}`).join('|');
  if (el.multiple && el.selectedOptions) return [...el.selectedOptions].map(o => o.value).join('|');
  return el.value;
}
function admTrack(root) {
  if (root._admTrack) return root._admTrack;
  const base = new Map(), touched = new Set();
  const field = e => {
    const t = e.target instanceof Element ? e.target : null;
    const f = t?.closest(ADM_FIELD) ?? t?.closest('label')?.control ?? null;
    return f && root.contains(f) && f.type !== 'search' && !f.closest('[data-adm-noguard]') ? f : null;
  };
  const arm = e => { const f = field(e); if (f && !touched.has(f)) base.set(f, admFieldValue(f)); };
  const mark = e => {
    const f = field(e);
    if (!f) return;
    // Case cochée sans relevé préalable (Safari ne donne pas le focus) : l'état d'origine est l'inverse.
    if (!base.has(f)) base.set(f, f.type === 'checkbox' ? (f.checked ? '0' : '1') : null);
    touched.add(f);
  };
  for (const t of ['focusin', 'pointerdown', 'keydown', 'beforeinput']) root.addEventListener(t, arm, true);
  for (const t of ['input', 'change']) root.addEventListener(t, mark, true);
  root._admTrack = {
    dirty: () => [...touched].some(f => f.isConnected && admFieldValue(f) !== base.get(f)),
    clean: () => { base.clear(); touched.clear(); },
  };
  return root._admTrack;
}

/** Confirmation commune « Modifications non enregistrées » : Continuer à modifier (par défaut) / Abandonner. */
function admConfirmDiscard({ text = 'Cette fiche contient des saisies qui ne sont pas enregistrées.', keep = '', effect = 'ferme la fiche et perd ces saisies ; rien n\'est enregistré ni publié.' } = {}) {
  return admConfirm({
    title: 'Modifications non enregistrées', text,
    impact: [`« Abandonner les modifications » ${effect}`, `Pour les garder : « Continuer à modifier », puis ${keep ? `« ${keep} »` : 'enregistrez'}.`],
    ok: 'Abandonner les modifications', cancel: 'Continuer à modifier', danger: true,
  });
}

/** Clic réellement sur le fond (hors du cadre de la fiche, marge intérieure comprise). */
function admOnBackdrop(dlg, e) {
  if (e.target !== dlg) return false;
  const r = dlg.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

// ── Fiches modales communes (UX du panel, 31/10) : la page montre d'abord les données ; « ＋ Ajouter »
// ou un clic sur une ligne ouvre une fiche <dialog> (Échap, clic sur le fond, Annuler : fermeture sans
// effet ; le focus revient à l'élément d'origine, retrouvé par data-adm-key si la liste a été re-rendue).
// #61 : toute fiche est protégée. ✕ / Annuler / [data-close] / fond / Échap passent par la même demande de fermeture :
// fiche sans modification → fermeture ; sinon confirmation Dig (Continuer à modifier par défaut).
// `dirty` (facultatif) : détection propre au module (instantané) ; à défaut, suivi générique des champs (admTrack).
// `canClose` (facultatif) : fonction asynchrone appelée avant la fermeture ; false = la fiche reste ouverte.
// Un clic commencé dans la fiche et relâché sur le fond (sélection de texte) ne ferme rien. Échap est intercepté dès
// la touche (keydown) : Chrome rend sinon un second Échap non annulable. Les fermetures du code (après un
// enregistrement réussi) appellent dlg.close() directement et ne demandent rien.
function admDialogSetup(id, { canClose, dirty, keep } = {}) {
  const dlg = document.getElementById(id);
  const track = admTrack(dlg);
  dlg._admDirty = () => dlg.open && (dirty ? dirty() : track.dirty());
  const guard = canClose ?? (async () => !dlg._admDirty() || admConfirmDiscard({ keep: typeof keep === 'function' ? keep() : keep }));
  let pending = null;
  // Rend true si la fiche est fermée (ou l'était déjà).
  dlg._admRequestClose = () => pending ?? (pending = (async () => {
    try { if (dlg.open && await guard()) dlg.close(); return !dlg.open; } finally { pending = null; }
  })());
  const request = () => { dlg._admRequestClose(); };
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', request));
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', e => { downOnBackdrop = admOnBackdrop(dlg, e); });
  dlg.addEventListener('click', e => {
    const ok = downOnBackdrop && admOnBackdrop(dlg, e);
    downOnBackdrop = false;
    if (ok) request();
  });
  dlg.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    e.preventDefault();
    request();
  });
  dlg.addEventListener('cancel', e => { e.preventDefault(); request(); });
  dlg.addEventListener('close', () => {
    track.clean();
    const o = dlg._admOpener;
    dlg._admOpener = null;
    if (!o) return;
    const key = o.dataset?.admKey;
    const again = !document.contains(o) && key ? document.querySelector(`[data-adm-key="${CSS.escape(key)}"]`) : null;
    (again ?? (document.contains(o) ? o : null))?.focus();
  });
  return dlg;
}

/** Fiche ouverte avec des modifications non enregistrées (ou zone de page, voir admZone). */
function admAnyDirty() {
  return [...document.querySelectorAll('dialog[open]')].some(d => d._admDirty?.()) || _admZones.some(z => z.dirty());
}
window.addEventListener('beforeunload', e => { if (admAnyDirty()) { e.preventDefault(); e.returnValue = ''; } });

// Formulaires de page (#61) : réglages hors fiche (Configuration, Économie, Boutique, Publicité, Actualités…).
// Changer d'onglet ne perd rien (le contenu reste en place) ; le rechargement de l'onglet ou « Rafraîchir » ne
// réécrit pas une zone en cours de saisie (admZoneDirty), et quitter la page avec des saisies demande confirmation.
// Après un enregistrement réussi, admZoneClean() rend la zone de nouveau rechargeable.
const _admZones = [];
function admZone(el, { dirty } = {}) {
  if (!el) return null;
  const track = admTrack(el);
  const z = { el, dirty: dirty ?? (() => track.dirty()), clean: () => track.clean() };
  el._admZone = z;
  _admZones.push(z);
  return el;
}
function admZoneDirty(el) { return !!el?._admZone?.dirty(); }
function admZoneClean(el) { el?._admZone?.clean(); }

function admDialogOpen(id, opener, focusEl) {
  const dlg = document.getElementById(id);
  dlg._admOpener = opener ?? document.activeElement;
  dlg._admTrack?.clean();   // valeurs chargées = état de référence (#61)
  if (!dlg.open) dlg.showModal();
  (typeof focusEl === 'string' ? document.getElementById(focusEl) : focusEl)?.focus();
  return dlg;
}

/**
 * Confirmation stylée Dig (recette #50-E du 03/11) — remplace window.confirm() : <dialog> natif empilé au-dessus
 * des fiches, focus initial sur Annuler, Échap / fond / Annuler = refus, focus rendu à l'élément d'origine.
 * `impact` : lignes expliquant l'effet (réversible ou non, visible des joueurs…). Rend une promesse booléenne.
 */
// #61 : `cancel: null` = simple information (un seul bouton) ; `field` = petite fiche de saisie (voir admPrompt).
function admConfirm({ title, text = '', impact = [], ok = 'Confirmer', cancel = 'Annuler', danger = false, field = null }) {
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
    const lab = document.createElement('label');
    lab.id = 'adm-confirm-field';
    lab.className = 'adm-confirm-field';
    const labText = document.createElement('span');
    const input = document.createElement('input');
    input.id = 'adm-confirm-input';
    input.autocomplete = 'off';
    const area = document.createElement('textarea');
    area.id = 'adm-confirm-area';
    area.rows = 8;
    lab.append(labText, input, area);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); dlg.close('yes'); } });
    const act = document.createElement('div');
    act.className = 'form-actions';
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'btn btn-outline'; no.id = 'adm-confirm-no';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.id = 'adm-confirm-yes';
    act.append(no, yes);
    dlg.append(h, p, ul, lab, act);
    document.body.appendChild(dlg);
    no.addEventListener('click', () => dlg.close('no'));
    yes.addEventListener('click', () => dlg.close('yes'));
    let down = false;   // clic commencé dans la boîte et relâché dehors : ignoré
    dlg.addEventListener('pointerdown', e => { down = admOnBackdrop(dlg, e); });
    dlg.addEventListener('click', e => { if (down && admOnBackdrop(dlg, e)) dlg.close('no'); down = false; });
  }
  if (dlg.open) return Promise.resolve(false); // jamais deux confirmations à la fois (double clic)
  const opener = document.activeElement;
  dlg.querySelector('#adm-confirm-title').textContent = title;
  dlg.querySelector('#adm-confirm-text').textContent = text;
  const ul = dlg.querySelector('#adm-confirm-impact');
  ul.textContent = '';
  for (const line of impact) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
  ul.classList.toggle('hidden', !impact.length);
  dlg.querySelector('#adm-confirm-no').textContent = cancel ?? '';
  dlg.querySelector('#adm-confirm-no').classList.toggle('hidden', cancel === null);
  const yes = dlg.querySelector('#adm-confirm-yes');
  yes.textContent = ok;
  yes.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  const lab = dlg.querySelector('#adm-confirm-field'), area = dlg.querySelector('#adm-confirm-area');
  const multi = field?.type === 'textarea';
  let input = dlg.querySelector('#adm-confirm-input');
  lab.classList.toggle('hidden', !field);
  lab.firstChild.textContent = field?.label ?? '';
  input.classList.toggle('hidden', multi);
  area.classList.toggle('hidden', !multi);
  if (!multi) input.type = field?.type ?? 'text';
  if (multi) input = area;
  input.value = field?.value ?? '';
  input.placeholder = field?.placeholder ?? '';
  dlg.returnValue = '';
  dlg.showModal();
  if (field) input.select();
  else if (cancel === null) yes.focus();
  else dlg.querySelector('#adm-confirm-no').focus();
  return new Promise(resolve => {
    dlg.addEventListener('close', () => {
      if (opener && document.contains(opener)) opener.focus();
      resolve(dlg.returnValue === 'yes');
    }, { once: true });
  });
}

/** Remplace confirm(message) (#61) : 1re ligne = titre, le reste = détail. Rend une promesse booléenne. */
function admAsk(message, opts = {}) {
  const [title, ...rest] = String(message).split('\n');
  return admConfirm({ title, text: rest.join('\n').trim(), ...opts });
}
/** Remplace alert() (#61) : information Dig à un seul bouton, jamais bloquante pour le script. */
function admAlert(message, title = 'Information') {
  return admConfirm({ title, text: String(message), ok: 'OK', cancel: null });
}
/** Remplace prompt() (#61) : petite fiche de saisie Dig ; rend la valeur saisie, ou null si Annuler / Échap / fond. */
async function admPrompt({ title, text = '', label = '', value = '', type = 'text', ok = 'Valider', placeholder = '' }) {
  if (!await admConfirm({ title, text, ok, field: { label, value, type, placeholder } })) return null;
  return document.getElementById(type === 'textarea' ? 'adm-confirm-area' : 'adm-confirm-input').value;
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

/** Tableau « adm-rtable » (#76) : chaque cellule reçoit l'intitulé de sa colonne, affiché en carte sur smartphone. */
function admTableLabels(table) {
  const heads = [...table.tHead.rows[0].cells].map(th => th.textContent.trim());
  for (const tr of table.tBodies[0].rows) {
    [...tr.cells].forEach((td, i) => { if (heads[i] && td.colSpan === 1) td.dataset.label = heads[i]; });
  }
}

/** Pagination côté navigateur (#76) : n lignes par page, barre « a–b sur n » ; aucune ligne retirée du tableau. */
function admTablePage(table, pager, size, page = 0) {
  const rows = [...table.tBodies[0].rows];
  const pages = Math.max(1, Math.ceil(rows.length / size));
  page = Math.min(Math.max(0, page), pages - 1);
  rows.forEach((r, i) => { r.hidden = Math.floor(i / size) !== page; });
  pager.textContent = '';
  pager.hidden = pages <= 1;
  pager.dataset.page = String(page);
  if (pages <= 1) return;
  const btn = (label, to, disabled) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-outline btn-sm', textContent: label, disabled });
    b.addEventListener('click', () => admTablePage(table, pager, size, to));
    return b;
  };
  pager.append(btn('‹ Précédents', page - 1, page === 0),
    Object.assign(document.createElement('span'), { className: 'muted', textContent: `${page * size + 1}–${Math.min(rows.length, (page + 1) * size)} sur ${rows.length} · page ${page + 1}/${pages}` }),
    btn('Suivants ›', page + 1, page >= pages - 1));
}

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
    cache: 'no-store',
  };
  if (body) opts.body = JSON.stringify(body);
  // Réseau coupé ou réponse interrompue (#61) : échec ordinaire (ok: false, status 0) ; l'appelant affiche l'erreur
  // et laisse la fiche ouverte avec ses saisies, pour une nouvelle tentative.
  let res;
  try { res = await fetch(path, opts); }
  catch {
    admRefreshNote(method, path, false, { error: 'serveur injoignable' });
    return { ok: false, status: 0, data: { error: 'Serveur injoignable ou réponse interrompue : rien n\'est perdu, la fiche reste ouverte ; réessayez.' } };
  }
  const data = await res.json().catch(() => ({ error: `Réponse inattendue du serveur (${res.status}).` }));
  if (res.status === 401 && data.code === 'admin_auth') adminSessionLost();
  admRefreshNote(method, path, res.ok, data);
  return { ok: res.ok, data, status: res.status };
}

// ── Boutons « Rafraîchir » communs (#60) ─────────────────────────────────────
// Même retour partout que la bêta #57 (validé) : clic → bouton indisponible et « ↻ Actualisation… »
// → « ✓ Données à jour à HH:MM:SS » (avec « aucun changement » ou « nouvelles données ») ou
// « ⚠️ Échec de l'actualisation (raison) ». Les lectures (GET, sans cache) faites pendant le
// rechargement sont relevées par api() : un échec n'est jamais présenté comme « à jour ». Les
// chargeurs ne remplacent pas les saisies en cours (#61) : filtres, fiche ouverte et brouillons restent.
const admClock = d => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const _admRefreshRuns = new Set();
const _admGetSigs = new Map();   // chemin GET → empreinte de la dernière réponse reçue

function admSig(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${(h >>> 0).toString(36)}:${text.length}`;
}

/** Relevé par api() : lectures, échecs et écritures pendant un « Rafraîchir » en cours. */
function admRefreshNote(method, path, ok, data) {
  if (method !== 'GET') { for (const run of _admRefreshRuns) run.writes++; return; }
  let sig = null;
  if (ok) { try { sig = admSig(JSON.stringify(data)); } catch { sig = null; } }
  const prev = _admGetSigs.get(path);
  if (sig) _admGetSigs.set(path, sig);
  for (const run of _admRefreshRuns) {
    run.reads++;
    if (!ok) run.errors.push(data?.error || 'erreur du serveur');
    else if (prev === undefined || !sig) run.unknown++;
    else if (prev !== sig) run.changed++;
  }
}

/**
 * Branche un bouton « ↻ Rafraîchir » sur son chargeur, avec l'état visible commun. La ligne d'état
 * (aria-live) est celle qui suit le bouton (`.refresh-status`), créée au besoin.
 */
function admRefreshButton(id, loader, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const idle = btn.textContent;
  let st = btn.nextElementSibling?.classList.contains('refresh-status') ? btn.nextElementSibling : null;
  if (!st) {
    st = document.createElement('span');
    st.className = 'refresh-status';
    st.setAttribute('role', 'status');
    st.setAttribute('aria-live', 'polite');
    btn.after(st);
  }
  if (!st.id) st.id = `${id}-status`;
  btn.setAttribute('aria-describedby', st.id);
  let loadedAt = null, toastAt = 0;
  btn.addEventListener('click', async () => {
    // Bouton indisponible sans `disabled` : le focus clavier reste sur le bouton pendant l'attente
    if (btn.getAttribute('aria-disabled') === 'true') return;
    const run = { reads: 0, changed: 0, unknown: 0, writes: 0, errors: [] };
    _admRefreshRuns.add(run);
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('is-busy');
    btn.textContent = '↻ Actualisation…';
    st.className = 'refresh-status';
    st.textContent = 'Chargement…';
    const started = Date.now();
    let thrown = null;
    try { await loader({ manual: true }); }
    catch (e) { thrown = e; console.error(`[Rafraîchir ${label}]`, e); }
    _admRefreshRuns.delete(run);
    // Attente visible au moins un instant, même quand le serveur répond en quelques millisecondes
    const wait = 400 - (Date.now() - started);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    btn.removeAttribute('aria-disabled');
    btn.removeAttribute('aria-busy');
    btn.classList.remove('is-busy');
    btn.textContent = idle;
    const now = new Date();
    const error = thrown ? 'erreur inattendue de l’affichage' : run.errors[0];
    // Toast de réussite bref, pas plus d'un toutes les 5 s par bouton (la ligne d'état suffit lors de clics
    // rapides) ; un échec est toujours signalé et remplace un toast de réussite encore affiché.
    const toast = text => { if (Date.now() - toastAt > 5000) { toastAt = Date.now(); admToast(text); } };
    if (error) {
      st.className = 'refresh-status is-err';
      st.textContent = `⚠️ Échec de l’actualisation (${error}) — ${loadedAt ? `données affichées : ${admClock(loadedAt)}` : 'données affichées non actualisées'}`;
      toastAt = 0;
      admToast(`⚠️ ${label} : échec de l’actualisation.`, { error: true });
      return;
    }
    loadedAt = now;
    const change = run.changed ? ' — nouvelles données affichées' : run.unknown || !run.reads ? '' : ' — aucun changement';
    st.className = 'refresh-status';
    st.textContent = `✓ Données à jour à ${admClock(now)}${change}`;
    toast(`${label} : données à jour à ${admClock(now)}${change ? ` (${change.slice(3)})` : ''}.`);
  });
}

function adminShowApp(info) {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
  adminSessionInfo(info);
  admRestoreTab();
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
  if (!await admAsk('Fermer TOUTES les sessions admin (ce navigateur et tous les autres appareils) ?')) return;
  const { ok, data } = await api('POST', '/api/admin/session/revoke-all');
  if (!ok) return admAlert(data.error || 'Erreur.');
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

// ── Navigation (#70) ──────────────────────────────────────────────────────────

// Registre UNIQUE des rubriques : le menu (groupes, ordre, recherche, icônes) est construit à partir de ces deux
// tableaux, plus aucun lien codé en dur dans index.html. Une nouvelle rubrique = une section <section id="tab-<id>">
// + une ligne ici : { id, group, order, icon, label, keywords?, load?, available? }.
// - load : chargement de la rubrique à chaque ouverture (comme avant) ;
// - available : condition de disponibilité (rubrique masquée du menu ET des liens directs si elle renvoie false).
// Choix de regroupement documentés dans docs/claude-reports/2026-11-04_ticket-70-navigation-admin.md.
const ADM_NAV_GROUPS = [
  { id: 'players',     icon: '👥', label: 'Joueurs & testeurs' },
  { id: 'game',        icon: '⛏', label: 'Jeu & progression' },
  { id: 'competition', icon: '🏆', label: 'Saisons & compétition' },
  { id: 'content',     icon: '📰', label: 'Contenu & événements' },
  { id: 'visuals',     icon: '🎨', label: 'Visuels' },
  { id: 'ops',         icon: '🛠', label: 'Exploitation & paramètres' },
];
const ADM_NAV = [
  { id: 'players',         group: 'players',     order: 10, icon: '👤', label: 'Joueurs',                  keywords: 'gestion joueur pseudo fiche recherche debug essais test reset réinitialiser progression sauvegarde' },
  { id: 'security',        group: 'players',     order: 20, icon: '🛡', label: 'Anti-bot',                 keywords: 'sécurité triche autoclic sanctions risque',     load: () => loadSecurity() },
  { id: 'beta',            group: 'players',     order: 30, icon: '🧪', label: 'Bêta fermée',              keywords: 'invitations testeurs retours',                  load: () => loadBeta() },
  { id: 'blocks',          group: 'game',        order: 10, icon: '🧱', label: 'Blocs',                    keywords: 'catalogue minerais matériaux ia',               load: () => { loadBlocks(); loadAi(); } },
  { id: 'rewards',         group: 'game',        order: 20, icon: '🎲', label: 'Coffres & drops',          keywords: 'récompenses tables butin loot',                 load: () => loadRewards() },
  { id: 'upgrades',        group: 'game',        order: 30, icon: '⬆', label: 'Améliorations',            keywords: 'niveaux barème suspension urgence',             load: () => loadUpgrades() },
  { id: 'pickaxe',         group: 'game',        order: 35, icon: '🔋', label: 'Pioche à charges',         keywords: 'réserve coups charges recharge usure durabilité drapeau testeurs', load: () => loadPickaxe() },
  { id: 'relics',          group: 'game',        order: 40, icon: '🔮', label: 'Reliques',                 keywords: 'effets coûts',                                  load: () => loadRelics() },
  { id: 'missions',        group: 'game',        order: 50, icon: '🎯', label: 'Missions quotidiennes',    keywords: 'quêtes journalières',                           load: () => loadMissions() },
  { id: 'economy',         group: 'game',        order: 60, icon: '💰', label: 'Économie',                 keywords: 'gemmes barèmes',                                load: () => { loadEconomy(); loadGemLedger(); loadEconomyRules(); loadGemShop(); },
    subs: [
      { id: 'gains',   label: 'Gains & coûts des coffres', keywords: 'multiplicateurs pièces fragments prix coffres' },
      { id: 'ledger',  label: 'Registre de gemmes',        keywords: 'soldes référence anomalies mode' },
      { id: 'rules',   label: 'Règles économiques',        keywords: 'barème plafond auto-dig courbe simulation publication versions' },
      { id: 'gemshop', label: 'Boutique en gemmes',        keywords: 'articles prix ouverture' },
    ] },
  { id: 'season-overview', group: 'competition', order: 10, icon: '📊', label: 'Saison en cours',          keywords: 'ligues & saisons pilotage thèmes date de fin zone critique anti-autoclicker journal', load: () => { loadSeasonOverview(); loadAntiCheatLogs(); } },
  { id: 'seasons',         group: 'competition', order: 20, icon: '🗓', label: 'Historique des saisons',   keywords: 'saisons liste' },
  { id: 'leagues',         group: 'competition', order: 30, icon: '🏅', label: 'Ligues',                   keywords: 'divisions' },
  { id: 'leaderboard',     group: 'competition', order: 40, icon: '🏆', label: 'Classement',               keywords: 'top scores',                                    load: () => loadLeaderboard() },
  { id: 'points',          group: 'competition', order: 50, icon: '⭐', label: 'Points de récompense',     keywords: 'mérite portefeuille',                           load: () => loadPoints() },
  { id: 'shop',            group: 'competition', order: 60, icon: '🛍', label: 'Boutique de cadeaux',      keywords: 'lots échange commandes',                        load: () => loadShop() },
  { id: 'contest',         group: 'competition', order: 70, icon: '🎁', label: 'Concours',                 keywords: 'gagnants lots hebdomadaire',                    load: () => loadContest() },
  { id: 'news',            group: 'content',     order: 10, icon: '📰', label: 'Actualités',               keywords: 'annonces cloche discord',                       load: () => loadNews() },
  { id: 'microbonus',      group: 'content',     order: 25, icon: '✨', label: 'Micro-bonus (brouillons)', keywords: 'dégâts décimaux fractionnaires souvenirs effets bonus', load: () => loadMicroBonus() },
  { id: 'events',          group: 'content',     order: 20, icon: '🎉', label: 'Événements',               keywords: 'mensuels calendrier souvenirs',                 load: () => loadEvents() },
  { id: 'collections',     group: 'content',     order: 30, icon: '📿', label: 'Collections',              keywords: 'objets séries fiches narratives',               load: () => loadCollections() },
  { id: 'badges',          group: 'content',     order: 40, icon: '🎖', label: 'Badges',                   keywords: 'succès honorifiques',                           load: () => loadBadges() },
  { id: 'icons',           group: 'visuals',     order: 10, icon: '🎨', label: 'Atelier d\'icônes',        keywords: 'images ia pictogrammes visuels coffres souvenirs', load: () => loadIcons() },
  { id: 'ads',             group: 'ops',         order: 30, icon: '📢', label: 'Publicité',                keywords: 'adsense annonces',                              load: () => loadAds() },
  { id: 'config',          group: 'ops',         order: 40, icon: '⚙', label: 'Configuration',            keywords: 'config réglages paramètres budget ia',          load: () => loadAiBudget() },
];
const ADM_NAV_DEFAULT = 'seasons';   // rubrique affichée sans fragment d'URL (inchangée)

// Actions courantes (recette du 05/11) : trouvées par la recherche du menu et listées dans le plan (🧭). Une action
// NE FAIT QU'AMENER au bon endroit : ouvrir la rubrique (et sa sous-rubrique), déplier la section, placer le curseur
// sur le champ ou le bouton (target). Elle ne clique jamais, ne publie, n'enregistre ni ne réinitialise rien.
// player : l'endroit est dans la fiche d'un joueur → sans fiche ouverte, curseur sur la recherche de pseudo puis,
// une fois le joueur choisi, la fiche s'ouvre directement sur cette section. Lien direct : #a/<id>.
const ADM_NAV_ACTIONS = [
  { id: 'find-player',    tab: 'players',  target: 'player-search-input',  label: 'Trouver un joueur (ouvrir sa fiche)',             keywords: 'pseudo chercher recherche debug joueur fiche gabpok', help: 'Tapez le pseudo et choisissez la suggestion : la fiche s\'ouvre sous la recherche.' },
  { id: 'reset-test',     tab: 'players',  target: 'pd-sec-tests', player: true, label: 'Recommencer un test à zéro (joueur)', keywords: 'reset réinitialiser rejouer essai remise à zéro tentative snapshot instantané', help: 'Fiche du joueur → 🧪 Essais de test → « Recommencer un test à zéro ». Confirmation avec motif et pseudo ; instantané archivé avant.' },
  { id: 'export-tests',   tab: 'players',  target: 'pd-sec-tests', player: true, label: 'Exporter l\'historique des essais d\'un joueur', keywords: 'csv json tentatives historique', help: 'Fiche du joueur → 🧪 Essais de test → « Exporter CSV » ou « Exporter JSON complet ».' },
  { id: 'partial-reset',  tab: 'players',  target: 'pd-sec-partial', player: true, label: 'Réinitialisation saisonnière partielle (joueur)', keywords: 'reset sauvegarde seule saisonnier', help: 'Fiche du joueur → ⚠ Réinitialisation saisonnière partielle (sauvegarde seule, classement et anti-bot inchangés). Confirmation obligatoire.' },
  { id: 'player-antibot', tab: 'security', target: 'sec-player-q',         label: 'Voir l\'anti-bot d\'un joueur',                  keywords: 'risque score triche contrôle sécurité fiche joueur', help: 'Pseudo ou #ID puis « Ouvrir la fiche » (lecture seule). Aussi : fiche Joueurs → 🛡 Anti-bot de ce joueur.' },
  { id: 'sec-journal',    tab: 'security', target: 'sec-journal-card',     label: 'Consulter le journal de sécurité',               keywords: 'anomalies audit connexions admin', help: 'Filtres par type d\'événement et par période.' },
  { id: 'invite',         tab: 'beta',     target: 'btn-beta-invite-open', label: 'Préparer une invitation bêta',                   keywords: 'inviter testeur code lien accès', help: 'Bouton « ➕ Inviter un testeur » : rien n\'est créé avant « Créer » dans la fiche.' },
  { id: 'beta-feedback',  tab: 'beta',     target: 'beta-feedback-card',   label: 'Lire les retours des testeurs',                  keywords: 'feedback signalements bugs', help: 'Retours envoyés depuis le jeu par les testeurs.' },
  { id: 'beta-manage',    tab: 'beta',     target: 'btn-beta-manage',      label: 'Révoquer ou archiver un lien, retirer un testeur', keywords: 'gérer invitations testeurs révoquer archiver masquer supprimer retirer lien code bêta', help: 'Bouton « 🗂️ Gérer les invitations et testeurs » : listes filtrables ; chaque retrait demande une confirmation et reste réversible (archives, « Réintégrer »).' },
  { id: 'beta-archive',   tab: 'beta',     target: 'beta-reports-view',    label: 'Archiver un retour de test traité',              keywords: 'archives retours signalements masquer ranger bêta', help: 'Retours des testeurs → bouton « 🗄️ Archiver » d\'un retour ; « Afficher : Archives » pour les retrouver et les réafficher. Rien n\'est supprimé.' },
  { id: 'gains',          tab: 'economy',  sub: 'gains', target: 'eco-coin-gain', label: 'Modifier les gains (multiplicateurs)',     keywords: 'gain pièces fragments multiplicateur économie', help: 'Économie → Gains & coûts : saisir puis « Enregistrer les paramètres économiques ».' },
  { id: 'chest-costs',    tab: 'economy',  sub: 'gains', target: 'eco-cost-simple', label: 'Changer le prix des coffres',           keywords: 'coût coffre simple rare antique', help: 'Économie → Gains & coûts → Coûts des coffres (vide = valeur par défaut).' },
  { id: 'gem-ledger',     tab: 'economy',  sub: 'ledger', target: 'gem-ledger-card', label: 'Vérifier le registre de gemmes',       keywords: 'gemmes soldes écart', help: 'Économie → Registre de gemmes (lecture ; changer le mode demande une note).' },
  { id: 'season-end',     tab: 'season-overview', target: 'season-end-card', label: 'Changer la date de fin de la saison',        keywords: 'prolonger avancer fin saison date', help: 'Saison en cours → « Date de fin de la saison active » (journalisé).' },
  { id: 'season-close',   tab: 'season-overview', target: 'season-critical-card', label: 'Clore la saison (zone critique)',      keywords: 'terminer fermer saison', help: 'Saison en cours → Zone critique. Confirmation obligatoire.' },
  { id: 'points-adjust',  tab: 'points',   target: 'pt-adjust-card',       label: 'Ajuster les points de récompense d\'un joueur',  keywords: 'corriger points mérite manuel', help: 'Ajustement motivé et tracé.' },
  { id: 'contest-winners',tab: 'contest',  target: 'ct-winners-card',      label: 'Gagnants du concours et remise des lots',        keywords: 'tirage attribution lot remise', help: 'Concours → Gagnants et remise des lots.' },
  { id: 'shop-orders',    tab: 'shop',     target: 'sh-orders-card',       label: 'Traiter les commandes de cadeaux',               keywords: 'commande expédition livraison', help: 'Boutique de cadeaux → Commandes.' },
  { id: 'upgrade-suspend',tab: 'upgrades', target: 'up-ctl-card',          label: 'Suspendre une amélioration en urgence',          keywords: 'désactiver bloquer urgence', help: 'Améliorations → 🚨 Suspension d\'urgence (motif demandé).' },
  { id: 'news-add',       tab: 'news',     target: 'btn-news-add',         label: 'Rédiger une actualité',                          keywords: 'annonce publier nouvelle', help: '« ＋ Ajouter » ouvre la fiche ; la publication se fait dans la fiche.' },
  { id: 'event-add',      tab: 'events',   target: 'btn-ev-add',           label: 'Préparer un événement',                          keywords: 'mensuel calendrier', help: '« ＋ Ajouter » ouvre la fiche de l\'événement.' },
  { id: 'block-add',      tab: 'blocks',   target: 'btn-bk-add',           label: 'Ajouter un bloc',                                keywords: 'minerai matériau nouveau', help: 'Le bloc entre dans le brouillon ; « Publier » le met en jeu.' },
  { id: 'mission-add',    tab: 'missions', target: 'btn-mq-add',           label: 'Ajouter une mission quotidienne',                keywords: 'quête nouvelle', help: '« ＋ Ajouter une mission » ouvre la fiche.' },
  { id: 'ai-budget',      tab: 'config',   target: 'ai-budget-card',       label: 'Voir les dépenses IA (budget)',                  keywords: 'openai coût plafond', help: 'Configuration → 🤖 Budget IA.' },
  { id: 'antibot-mode',   tab: 'config',   target: 'config-rows',          label: 'Régler le mode anti-bot',                        keywords: 'off shadow observation protection', help: 'Configuration → 🛡 Protections (anti-triche) → Mode anti-bot.' },
];
const admNavItem = id => ADM_NAV.find(t => t.id === id && (!t.available || t.available())) ?? null;

// Préférences d'affichage du menu (replié aux icônes, groupes fermés) : seul état gardé dans le navigateur, purement
// visuel ; la rubrique courante reste dans le fragment d'URL (#50-F). Aucune donnée d'administration n'y est stockée.
const ADM_NAV_PREFS = 'dig-admin-nav';
function admNavPrefs() {
  try { const p = JSON.parse(localStorage.getItem(ADM_NAV_PREFS) || '{}'); return { collapsed: !!p.collapsed, closed: Array.isArray(p.closed) ? p.closed : [] }; }
  catch { return { collapsed: false, closed: [] }; }
}
function admNavSavePrefs(p) { try { localStorage.setItem(ADM_NAV_PREFS, JSON.stringify(p)); } catch { /* stockage indisponible : préférences non retenues */ } }

const admNavFold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const admNavSpan = (cls, txt) => {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = txt;
  if (cls !== 'nav-lbl') s.setAttribute('aria-hidden', 'true');
  return s;
};

function admNavBuild() {
  const host = document.getElementById('nav-groups');
  const prefs = admNavPrefs();
  host.textContent = '';
  for (const g of ADM_NAV_GROUPS) {
    const items = ADM_NAV.filter(t => t.group === g.id && (!t.available || t.available())).sort((a, b) => a.order - b.order);
    if (!items.length) continue;
    const wrap = document.createElement('div');
    wrap.className = 'nav-group';
    wrap.dataset.group = g.id;
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'nav-group-btn';
    head.setAttribute('aria-controls', `nav-g-${g.id}`);
    head.title = g.label;
    head.append(admNavSpan('nav-ico', g.icon), admNavSpan('nav-lbl', g.label), admNavSpan('nav-flag hidden', '⚠'), admNavSpan('nav-chev', '▾'));
    const list = document.createElement('div');
    list.className = 'nav-group-items';
    list.id = `nav-g-${g.id}`;
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', g.label);
    for (const t of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.dataset.tab = t.id;
      btn.title = t.label;
      btn.append(admNavSpan('nav-ico', t.icon), admNavSpan('nav-lbl', t.label), admNavSpan('nav-flag hidden', '⚠'));
      list.appendChild(btn);
      if (t.subs) list.appendChild(admNavSubBar(t, 'nav-subs'));
    }
    head.addEventListener('click', () => {
      const open = head.getAttribute('aria-expanded') !== 'true';
      admNavSetGroup(g.id, open);
      const p = admNavPrefs();
      p.closed = open ? p.closed.filter(x => x !== g.id) : [...new Set([...p.closed, g.id])];
      admNavSavePrefs(p);
    });
    wrap.append(head, list);
    host.appendChild(wrap);
    admNavSetGroup(g.id, !prefs.closed.includes(g.id));
  }
  // Sous-rubriques : même barre en tête de la rubrique (visible aussi sur smartphone, menu fermé).
  for (const t of ADM_NAV) {
    if (!t.subs) continue;
    const sec = document.getElementById(`tab-${t.id}`);
    const head = sec.querySelector(':scope > .section-header');
    const bar = admNavSubBar(t, 'sub-nav');
    if (head) head.after(bar); else sec.prepend(bar);
  }
  admNavCollapse(prefs.collapsed);
}

/** Barre de sous-rubriques d'une rubrique (menu latéral : cls nav-subs ; en tête de page : cls sub-nav). */
function admNavSubBar(t, cls) {
  const bar = document.createElement('div');
  bar.className = cls;
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', `Sous-rubriques : ${t.label}`);
  for (const s of t.subs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-sub-btn';
    b.dataset.subnav = t.id;
    b.dataset.subid = s.id;
    b.textContent = s.label;
    b.addEventListener('click', () => {
      admNavOpen(t.id, s.id);
      if (cls === 'nav-subs' && admNavNarrow()) admNavMenu(false);
    });
    bar.appendChild(b);
  }
  return bar;
}

// Sous-rubrique affichée par rubrique (mémoire de la page) : les autres blocs [data-sub] sont seulement masqués, leurs
// saisies restent en place (#61).
const _admSub = {};
function admSubShow(id, sub) {
  const t = admNavItem(id);
  if (!t?.subs) return;
  const s = t.subs.find(x => x.id === sub) ?? t.subs.find(x => x.id === _admSub[id]) ?? t.subs[0];
  _admSub[id] = s.id;
  for (const el of document.querySelectorAll(`#tab-${id} [data-sub]`)) el.classList.toggle('sub-hidden', el.dataset.sub !== s.id);
  for (const b of document.querySelectorAll(`.nav-sub-btn[data-subnav="${id}"]`)) {
    const on = b.dataset.subid === s.id;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  }
  if (document.querySelector('.tab-btn.active')?.dataset.tab === id) admRememberTab(id);
}

/** Ouvre une rubrique (et sa sous-rubrique) comme un clic dans le menu. */
function admNavOpen(id, sub) {
  const btn = admTabBtn(id);
  if (!btn) return false;
  if (sub) _admSub[id] = sub;
  if (!btn.classList.contains('active')) btn.click();
  else admSubShow(id, sub);
  return true;
}

let _pdPending = null;   // section de la fiche joueur à montrer dès qu'un joueur est choisi (action « player »)
/** Amène à l'endroit d'une action (voir ADM_NAV_ACTIONS) : aucune action n'est déclenchée. */
function admNavRun(a) {
  if (!admNavOpen(a.tab, a.sub)) return;
  const hint = document.getElementById('players-hint');
  hint.classList.add('hidden');
  let el = document.getElementById(a.target);
  if (a.player && document.getElementById('player-detail-card').classList.contains('hidden')) {
    _pdPending = a.target;
    hint.textContent = `${a.label} : choisissez d'abord le joueur. ${a.help}`;
    hint.classList.remove('hidden');
    el = document.getElementById('player-search-input');
  }
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  admNavPoint(el);
}

/** Fait défiler jusqu'à l'élément, le signale brièvement et y place le focus (sans rien activer). */
function admNavPoint(el) {
  el.scrollIntoView({ block: 'center' });
  el.classList.remove('adm-flash');
  void el.offsetWidth;
  el.classList.add('adm-flash');
  setTimeout(() => el.classList.remove('adm-flash'), 1800);
  const f = el.matches('input, select, textarea, button') ? el : el.tagName === 'DETAILS' ? el.querySelector('summary') : el;
  if (f === el && !el.matches('input, select, textarea, button')) el.setAttribute('tabindex', '-1');
  f.focus({ preventScroll: true });
}

function admNavSetGroup(id, open) {
  const wrap = document.querySelector(`.nav-group[data-group="${id}"]`);
  if (!wrap) return;
  wrap.querySelector('.nav-group-btn').setAttribute('aria-expanded', String(open));
  wrap.classList.toggle('is-closed', !open);
}

/** Menu réduit aux icônes (ordinateur). */
function admNavCollapse(on) {
  document.getElementById('admin-shell').classList.toggle('nav-collapsed', on);
  const b = document.getElementById('nav-collapse-btn');
  const label = on ? 'Déplier le menu' : 'Réduire le menu aux icônes';
  b.setAttribute('aria-pressed', String(on));
  b.title = label;
  b.setAttribute('aria-label', label);
  b.firstElementChild.textContent = on ? '»' : '«';
}

/** Menu déroulant (smartphone / fenêtre étroite). */
function admNavMenu(open) {
  document.getElementById('admin-nav').classList.toggle('is-open', open);
  document.getElementById('nav-menu-btn').setAttribute('aria-expanded', String(open));
}
const admNavNarrow = () => getComputedStyle(document.getElementById('nav-menu-btn')).display !== 'none';

/**
 * Signal d'exploitation sur une rubrique (anomalie réelle uniquement, jamais de compteur décoratif) : petit ⚠ sur la
 * rubrique et sur son groupe (visible même groupe fermé ou menu réduit), explication en infobulle. text = null : retiré.
 */
function admNavFlag(id, text) {
  const btn = admTabBtn(id);
  if (!btn) return;
  const f = btn.querySelector('.nav-flag');
  f.classList.toggle('hidden', !text);
  btn.title = text ? `${admNavItem(id).label} — ${text}` : admNavItem(id).label;
  btn.dataset.flag = text || '';
  const wrap = btn.closest('.nav-group');
  const any = [...wrap.querySelectorAll('.tab-btn')].filter(b => b.dataset.flag);
  wrap.querySelector('.nav-group-btn .nav-flag').classList.toggle('hidden', !any.length);
  wrap.querySelector('.nav-group-btn').title = any.length ? `${ADM_NAV_GROUPS.find(g => g.id === wrap.dataset.group).label} — ${any.map(b => b.dataset.flag).join(' ; ')}` : ADM_NAV_GROUPS.find(g => g.id === wrap.dataset.group).label;
}

/**
 * Résultats « actions » de la recherche : sous-rubriques puis actions courantes, chacune avec son chemin. Texte cherché :
 * libellé, mots-clés, rubrique et groupe (sans accents).
 */
function admNavTargets() {
  const out = [];
  for (const t of ADM_NAV) {
    if (!t.subs || !admNavItem(t.id)) continue;
    for (const s of t.subs) out.push({ kind: 'sub', tab: t.id, sub: s.id, label: s.label, keywords: s.keywords, path: t.label });
  }
  for (const a of ADM_NAV_ACTIONS) if (admNavItem(a.tab)) out.push({ kind: 'action', ...a, path: admNavItem(a.tab).label });
  return out;
}
const admNavHay = r => admNavFold(`${r.label} ${r.keywords ?? ''} ${r.path} ${ADM_NAV_GROUPS.find(g => g.id === admNavItem(r.tab).group).label}`);
const admNavGoTarget = r => r.kind === 'sub' ? admNavOpen(r.tab, r.sub) : admNavRun(r);

function admNavFilter(q) {
  const f = admNavFold(q.trim());
  let shown = 0;
  for (const wrap of document.querySelectorAll('.nav-group')) {
    const g = ADM_NAV_GROUPS.find(x => x.id === wrap.dataset.group);
    let n = 0;
    for (const btn of wrap.querySelectorAll('.tab-btn')) {
      const t = admNavItem(btn.dataset.tab);
      const subs = (t.subs ?? []).map(s => `${s.label} ${s.keywords ?? ''}`).join(' ');
      const hit = !f || admNavFold(`${t.label} ${t.id} ${g.label} ${t.keywords ?? ''} ${subs}`).includes(f);
      btn.classList.toggle('nav-miss', !hit);
      if (hit) n++;
    }
    wrap.classList.toggle('nav-miss', !n);
    wrap.classList.toggle('is-searching', !!f);
    shown += n;
  }
  // Actions et sous-rubriques trouvées : en tête des résultats (Entrée ouvre la première).
  const box = document.getElementById('nav-actions');
  box.textContent = '';
  const hits = f ? admNavTargets().filter(r => admNavHay(r).includes(f)).slice(0, 8) : [];
  for (const r of hits) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-act-btn';
    b.append(admNavSpan('nav-ico', r.kind === 'sub' ? '↳' : '➜'), admNavSpan('nav-lbl', r.label), admNavSpan('nav-act-path', r.path));
    b.title = r.help ? `${r.path} — ${r.help}` : r.path;
    b.addEventListener('click', () => {
      _navSearch.value = '';
      admNavFilter('');
      if (admNavNarrow()) admNavMenu(false);
      admNavGoTarget(r);
    });
    box.appendChild(b);
  }
  box.classList.toggle('hidden', !hits.length);
  document.getElementById('nav-search-empty').classList.toggle('hidden', !f || shown + hits.length > 0);
}

// Rubrique retenue après F5 (recette #50-F) : fragment d'URL (#news, #economy/ledger : lien direct possible ; #a/<action>
// amène à une action). replaceState : aucune entrée d'historique, le retour navigateur ne saute pas de rubrique en
// rubrique (et ne contourne donc pas les fiches protégées). Restauration = simple affichage de la rubrique et de sa
// liste : aucune fiche rouverte, aucune action relancée ; fragment inconnu ou rubrique indisponible → rubrique par
// défaut. Changer de rubrique ne perd aucune saisie : les rubriques sont seulement masquées (formulaires de page
// conservés, #60/#61) et une fiche ouverte est modale (menu inaccessible tant qu'elle n'est pas fermée, avec
// confirmation si elle est modifiée).
const admTabBtn = id => id && /^[a-z-]+$/.test(id) && admNavItem(id) ? document.querySelector(`.tab-btn[data-tab="${id}"]`) : null;
function admRememberTab(id) {
  const sub = admNavItem(id)?.subs ? `/${_admSub[id] ?? admNavItem(id).subs[0].id}` : '';
  if (location.hash.slice(1) !== `${id}${sub}`) history.replaceState(null, '', `${location.pathname}${location.search}#${id}${sub}`);
}
function admRestoreTab() {
  const [id, sub] = location.hash.slice(1).split('/');
  const act = id === 'a' && ADM_NAV_ACTIONS.find(a => a.id === sub && admNavItem(a.tab));
  if (act) { admNavRun(act); return; }
  const btn = admTabBtn(id);
  if (btn) admNavOpen(id, sub);
  else admNavMark(document.querySelector('.tab-btn.active')?.dataset.tab ?? ADM_NAV_DEFAULT);
}
window.addEventListener('hashchange', () => {
  if (document.querySelector('dialog[open]') || document.getElementById('admin-app').classList.contains('hidden')) return;
  admRestoreTab();
});

/** Rubrique active : bouton, aria-current, groupe ouvert, intitulé du bouton de menu (smartphone). */
function admNavMark(id) {
  const t = admNavItem(id);
  if (!t) return;
  for (const b of document.querySelectorAll('.tab-btn')) {
    const on = b.dataset.tab === id;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  for (const w of document.querySelectorAll('.nav-group')) w.classList.toggle('has-active', w.dataset.group === t.group);
  admNavSetGroup(t.group, true);
  document.getElementById('nav-current').textContent = `${t.icon} ${t.label}`;
}

admNavBuild();
for (const t of ADM_NAV) if (t.subs) admSubShow(t.id);
admNavMark(document.querySelector('.tab-content:not(.hidden)')?.id.slice(4) ?? ADM_NAV_DEFAULT);

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = admNavItem(btn.dataset.tab);   // boutons construits depuis le registre : rubrique toujours disponible
    document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
    document.getElementById(`tab-${t.id}`).classList.remove('hidden');
    admNavMark(t.id);
    admSubShow(t.id);
    admRememberTab(t.id);
    if (admNavNarrow() && document.getElementById('admin-nav').classList.contains('is-open')) {
      admNavMenu(false);
      document.getElementById('admin-nav').scrollIntoView({ block: 'start' });
    }
    t.load?.();
  });
});

// Plan du panel (🧭) : construit à chaque ouverture depuis les registres, donc toujours à jour. Liens = mêmes
// destinations que le menu et la recherche (fragment d'URL copiable), jamais une action.
admDialogSetup('nav-plan-dialog', { dirty: () => false });
function admNavPlanLink(text, href, go, cls = 'nav-plan-link') {
  const a = document.createElement('a');
  a.className = cls;
  a.href = href;
  a.textContent = text;
  a.addEventListener('click', e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;   // nouvel onglet : lien direct
    e.preventDefault();
    const dlg = document.getElementById('nav-plan-dialog');
    dlg._admOpener = null;
    dlg.close();
    if (admNavNarrow()) admNavMenu(false);
    go();
  });
  return a;
}
function admNavPlanOpen(opener) {
  const acts = document.getElementById('nav-plan-actions');
  acts.textContent = '';
  for (const a of ADM_NAV_ACTIONS) {
    const t = admNavItem(a.tab);
    if (!t) continue;
    const row = document.createElement('div');
    row.className = 'nav-plan-row';
    const sub = a.sub ? ` › ${t.subs.find(s => s.id === a.sub).label}` : '';
    const where = document.createElement('span');
    where.className = 'nav-plan-where';
    where.textContent = `${ADM_NAV_GROUPS.find(g => g.id === t.group).label} › ${t.icon} ${t.label}${sub}`;
    const help = document.createElement('span');
    help.className = 'nav-plan-help muted';
    help.textContent = a.help;
    row.append(admNavPlanLink(a.label, `#a/${a.id}`, () => admNavRun(a)), where, help);
    acts.appendChild(row);
  }
  const tree = document.getElementById('nav-plan-tree');
  tree.textContent = '';
  for (const g of ADM_NAV_GROUPS) {
    const items = ADM_NAV.filter(t => t.group === g.id && admNavItem(t.id)).sort((a, b) => a.order - b.order);
    if (!items.length) continue;
    const box = document.createElement('div');
    box.className = 'nav-plan-group';
    const h = document.createElement('strong');
    h.textContent = `${g.icon} ${g.label}`;
    const ul = document.createElement('ul');
    for (const t of items) {
      const li = document.createElement('li');
      li.appendChild(admNavPlanLink(`${t.icon} ${t.label}`, `#${t.id}`, () => admNavOpen(t.id)));
      if (t.subs) {
        const sul = document.createElement('ul');
        for (const s of t.subs) {
          const sli = document.createElement('li');
          sli.appendChild(admNavPlanLink(s.label, `#${t.id}/${s.id}`, () => admNavOpen(t.id, s.id)));
          sul.appendChild(sli);
        }
        li.appendChild(sul);
      }
      ul.appendChild(li);
    }
    box.append(h, ul);
    tree.appendChild(box);
  }
  admDialogOpen('nav-plan-dialog', opener, acts.querySelector('a'));
}
document.getElementById('nav-plan-btn').addEventListener('click', e => admNavPlanOpen(e.currentTarget));

document.getElementById('nav-menu-btn').addEventListener('click', () => {
  admNavMenu(!document.getElementById('admin-nav').classList.contains('is-open'));
});
document.getElementById('nav-collapse-btn').addEventListener('click', () => {
  const p = admNavPrefs();
  p.collapsed = !p.collapsed;
  admNavSavePrefs(p);
  admNavCollapse(p.collapsed);
});
const _navSearch = document.getElementById('nav-search');
_navSearch.addEventListener('input', () => admNavFilter(_navSearch.value));
_navSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    // premier résultat : action / sous-rubrique trouvée, sinon première rubrique
    const first = document.querySelector('#nav-actions:not(.hidden) .nav-act-btn, .nav-group:not(.nav-miss) .tab-btn:not(.nav-miss)');
    if (!first || !_navSearch.value.trim()) return;
    if (first.classList.contains('tab-btn')) {
      _navSearch.value = '';
      admNavFilter('');
      first.click();
      first.focus();
    } else first.click();
  } else if (e.key === 'Escape' && _navSearch.value) {
    e.preventDefault();
    e.stopPropagation();
    _navSearch.value = '';
    admNavFilter('');
  }
});
// Clavier dans le menu : ↑/↓ d'une entrée visible à l'autre, Échap ferme le menu déroulant (smartphone).
document.getElementById('admin-nav').addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('admin-nav').classList.contains('is-open')) {
    admNavMenu(false);
    document.getElementById('nav-menu-btn').focus();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [_navSearch, ...document.querySelectorAll('#nav-plan-btn, .nav-act-btn, .nav-group-btn, .tab-btn, .nav-subs .nav-sub-btn')].filter(b => b.offsetParent !== null);
  const i = all.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
});
// « / » (hors champ de saisie) : aller à une rubrique.
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (document.getElementById('admin-app').classList.contains('hidden')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
  if (admNavNarrow()) admNavMenu(true);
  if (admNavPrefs().collapsed) { admNavSavePrefs({ ...admNavPrefs(), collapsed: false }); admNavCollapse(false); }
  _navSearch.focus();
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
  if (!await admAsk('Clore cette saison ?')) return false;
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
  if (!await admAsk(`Supprimer la ligue "${name}" ?`)) return false;
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
      r.rank != null ? `#${r.rank}` : '— (non classé)', r.username, r.manualBlocks, `${r.maxDepth}m`, reported,
      r.league ? `${r.league.icon} ${r.league.name}` : '—',
    ].forEach(v => addCell(tr, v));
    addButtonCell(tr, 'Corriger', () => correctRanking(r));
    tbody.appendChild(tr);
  });
}

/** Corrige une ligne du classement (profondeur retenue et/ou blocs effectifs). */
async function correctRanking(r) {
  // Petites fiches Dig successives (#61) : Annuler / Échap à n'importe quelle étape = aucune correction.
  const title = `Corriger le classement de ${r.username}`;
  const depthStr = await admPrompt({ title, text: `Profondeur actuelle : ${r.maxDepth} m, déclarée : ${r.reportedMaxDepth ?? '?'} m.`,
    label: 'Profondeur retenue (m)', type: 'number', value: String(r.maxDepth), ok: 'Suivant' });
  if (depthStr === null) return;
  const blocksStr = await admPrompt({ title, text: `Blocs manuels actuels : ${r.manualBlocks}.`,
    label: 'Blocs manuels effectifs', type: 'number', value: String(r.manualBlocks), ok: 'Suivant' });
  if (blocksStr === null) return;
  const maxDepth = Number(depthStr), effectiveManualBlocks = Number(blocksStr);
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(effectiveManualBlocks) || effectiveManualBlocks < 0) {
    admAlert('Valeurs invalides : entiers ≥ 0 attendus. Rien n\'a été modifié.', 'Correction refusée'); return;
  }
  const reason = await admPrompt({ title, text: `Profondeur ${maxDepth} m · blocs ${effectiveManualBlocks}.`, label: 'Motif (journalisé)', ok: 'Corriger le classement' });
  if (reason === null) return;
  const { ok, data } = await api('PUT', `/api/admin/seasons/${_currentSeasonId}/rankings/${r.userId}`, { maxDepth, effectiveManualBlocks, reason });
  if (!ok) { admAlert(data.error ?? 'Erreur.'); return; }
  loadLeaderboard();
}

admRefreshButton('btn-refresh-lb', loadLeaderboard, 'Classement');

// ── Config ────────────────────────────────────────────────────────────────────

// #62 : réglages groupés par thème, libellé en clair + explication, clé technique en petit (et en infobulle).
// La présentation ne change aucune valeur : seuls les champs modifiés sont envoyés à l'enregistrement.
// `type` : 'bool' (true/false), 'enum' (options), 'number' (bornes = celles du serveur, pour guider la saisie).
const CONFIG_GROUPS = [
  { id: 'leagues', title: '🏅 Saisons et ligues', fields: {
    promotion_rate:                { label: 'Taux de promotion entre ligues', hint: 'Part des joueurs actifs promus à la clôture (0 à 1 ; 0,5 = la moitié).', type: 'number', min: 0, max: 1, step: 0.01 },
    difficulty_coefficient:        { label: 'Coefficient de difficulté par ligue', hint: 'Difficulté ajoutée à chaque ligue supérieure (0 ou plus).', type: 'number', min: 0, step: 0.01 },
    min_active_players_per_league: { label: 'Joueurs actifs minimum pour promouvoir', hint: 'En dessous de ce nombre de joueurs actifs, une ligue n\'a pas de promus (entier ≥ 1).', type: 'number', min: 1, step: 1 },
    gems_cap:                      { label: 'Plafond de gemmes en fin de saison', hint: 'Gemmes conservées au maximum par joueur à la clôture.', type: 'number', min: 0, step: 1 },
  } },
  { id: 'themes', title: '🎭 Thèmes de saison', fields: {
    season_themes_public:  { label: 'Thèmes visibles des joueurs', hint: 'Affiche le nom et le thème de la saison dans le jeu.', type: 'bool' },
    season_prep_days:      { label: 'Préparation du thème (jours avant)', hint: 'Le thème de la saison suivante est préparé ce nombre de jours avant son début (3 à 14).', type: 'number', min: 3, max: 14, step: 1 },
    season_announce_hours: { label: 'Annonce aux joueurs (heures avant)', hint: 'Délai d\'annonce de la saison suivante (0 à 168 ; 0 = pas d\'annonce).', type: 'number', min: 0, max: 168, step: 1 },
  } },
  { id: 'economy', title: '💰 Progression et économie', fields: {
    upgrade_cost_multiplier:  { label: 'Coût des améliorations', hint: 'Multiplie le coût en pièces des améliorations (0,1 à 10 ; 1 = normal).', type: 'number', min: 0.1, max: 10, step: 0.1 },
    coin_gain_multiplier:     { label: 'Pièces gagnées', hint: 'Multiplie les pièces gagnées par bloc et hors ligne (0,1 à 10).', type: 'number', min: 0.1, max: 10, step: 0.1 },
    fragment_drop_multiplier: { label: 'Fragments des coffres', hint: 'Multiplie les fragments des coffres de la boutique (0,1 à 10).', type: 'number', min: 0.1, max: 10, step: 0.1 },
    chest_cost_simple:        { label: 'Prix du coffre simple', hint: 'En pièces (entier ≥ 1).', type: 'number', min: 1, step: 1 },
    chest_cost_rare:          { label: 'Prix du coffre rare', hint: 'En pièces (entier ≥ 1).', type: 'number', min: 1, step: 1 },
    chest_cost_antique:       { label: 'Prix du coffre antique', hint: 'En pièces (entier ≥ 1).', type: 'number', min: 1, step: 1 },
  } },
  { id: 'protection', title: '🛡 Protections (anti-triche)', fields: {
    anti_autoclick_enabled:   { label: 'Anti-autoclicker', hint: 'Contrôle la cadence de clics des sauvegardes.', type: 'bool' },
    max_effective_cps:        { label: 'Clics/s max avant exclusion du classement', hint: 'Au-delà, le joueur est retiré du classement de la saison.', type: 'number', min: 1, step: 1 },
    depth_validation_enabled: { label: 'Validation serveur de la profondeur', hint: 'Le serveur recalcule la profondeur atteignable.', type: 'bool' },
    depth_max_cps:            { label: 'Clics/s max retenus pour la profondeur', hint: 'Cadence maximale prise en compte par la validation de profondeur.', type: 'number', min: 1, step: 1 },
    manual_hit_rate:          { label: 'Coups/s max (cadence de frappe)', hint: 'Au-delà, un coup ne fait aucun dégât ni gain et n\'est pas crédité par le serveur (#74). 4 à 30.', type: 'number', min: 4, max: 30, step: 1 },
    manual_hit_burst:         { label: 'Rafale de coups tolérée', hint: 'Coups rapides acceptés d\'affilée avant le plafond de cadence (#74). 1 à 200.', type: 'number', min: 1, max: 200, step: 1 },
    antibot_mode:             { label: 'Mode anti-bot', hint: 'off = arrêt ; shadow = observation seule, aucune sanction (#25).', type: 'enum', options: ['off', 'shadow'] },
    damage_budget_mode:       { label: 'Budget de dégâts (profondeur)', hint: 'off = arrêt ; shadow = observation ; enforce = profondeur plafonnée (#25).', type: 'enum', options: ['off', 'shadow', 'enforce'] },
    exact_hp_mode:            { label: 'Budget aux PV réels des blocs', hint: 'PV de chaque bloc recalculés par le serveur (#77). shadow = calcul et journal seuls (aucun joueur freiné) ; enforce = profondeur plafonnée ; off = arrêt.', type: 'enum', options: ['off', 'shadow', 'enforce'] },
  } },
];
// Paramètres obsolètes : affichés en lecture seule dans « Avancé », valeur et comportement inchangés.
const CONFIG_LEGACY = {
  cps_limit:       { label: 'Ancien nom de « Clics/s max avant exclusion »', hint: 'Alias conservé pour compatibilité : il n\'est lu que si max_effective_cps est absent. Modifiez max_effective_cps (Protections).' },
  season_duration: { label: 'Durée de saison (inutilisé)', hint: 'Les saisons sont hebdomadaires, du lundi au dimanche UTC (#16). Ce réglage n\'a plus d\'effet.' },
};

function cfgField(key, value, def, readOnly) {
  const row = document.createElement('div');
  row.className = 'config-row';
  const id = `cfg-${key}`;
  const text = document.createElement('div');
  text.className = 'config-text';
  const label = document.createElement('label');
  label.className = 'config-label';
  label.htmlFor = id;
  label.textContent = def?.label ?? key;
  text.appendChild(label);
  if (def?.hint) {
    const hint = document.createElement('span');
    hint.className = 'muted config-hint';
    hint.id = `${id}-hint`;
    hint.textContent = def.hint;
    text.appendChild(hint);
  }
  const keyEl = document.createElement('code');
  keyEl.className = 'config-key';
  keyEl.title = 'Clé technique';
  keyEl.textContent = key;
  text.appendChild(keyEl);
  const v = value ?? '';
  let input;
  if (def?.type === 'bool' || def?.type === 'enum') {
    input = document.createElement('select');
    const opts = def.type === 'bool' ? [['true', 'Activé'], ['false', 'Désactivé']] : def.options.map(o => [o, o]);
    if (!opts.some(([o]) => o === v)) opts.unshift([v, `${v} (valeur actuelle)`]);   // valeur inattendue conservée telle quelle
    for (const [o, t] of opts) input.appendChild(new Option(t, o));
    input.value = v;
  } else {
    input = document.createElement('input');
    input.type = def?.type === 'number' && v !== '' && Number.isFinite(Number(v)) ? 'number' : 'text';
    if (input.type === 'number') for (const a of ['min', 'max', 'step']) if (def[a] != null) input[a] = String(def[a]);
    input.value = v;
  }
  input.id = id;
  input.className = 'config-value';
  if (def?.hint) input.setAttribute('aria-describedby', `${id}-hint`);
  if (readOnly) input.disabled = true;
  else { input.dataset.key = key; input.dataset.orig = v; }
  row.dataset.search = `${def?.label ?? ''} ${def?.hint ?? ''} ${key}`.toLowerCase();
  row.append(text, input);
  return row;
}

function cfgGroup(id, title, rows, intro) {
  const sec = document.createElement('section');
  sec.className = 'overview-card cfg-group';
  sec.id = `cfg-g-${id}`;
  const h = document.createElement('h3');
  h.className = 'overview-card-title';
  h.textContent = title;
  sec.appendChild(h);
  if (intro) { const p = document.createElement('p'); p.className = 'muted config-hint'; p.textContent = intro; sec.appendChild(p); }
  sec.append(...rows);
  return sec;
}

// Saisies en cours conservées (#61) : un rechargement ne réécrit pas les valeurs modifiées et non enregistrées.
const _cfgZone = admZone(document.getElementById('config-rows'));
async function loadConfig() {
  const { ok, data } = await api('GET', '/api/admin/config');
  if (!ok || admZoneDirty(_cfgZone)) return;
  const container = document.getElementById('config-rows');
  const jump = document.getElementById('cfg-jump');
  container.textContent = '';
  jump.textContent = '';
  const cfg = data.config, known = new Set(Object.keys(CONFIG_LEGACY));
  const groups = CONFIG_GROUPS.map(g => {
    Object.keys(g.fields).forEach(k => known.add(k));
    return { id: g.id, title: g.title, rows: Object.entries(g.fields).filter(([k]) => cfg[k] !== undefined).map(([k, def]) => cfgField(k, cfg[k], def)) };
  });
  // Clé absente de la liste (ajoutée par un futur ticket) : modifiable comme avant, en texte libre.
  groups.push({ id: 'other', title: '🔧 Autres réglages', rows: Object.keys(cfg).filter(k => !known.has(k)).map(k => cfgField(k, cfg[k], null)) });
  for (const g of groups) if (g.rows.length) container.appendChild(cfgGroup(g.id, g.title, g.rows));
  const legacy = Object.entries(CONFIG_LEGACY).filter(([k]) => cfg[k] !== undefined);
  if (legacy.length) {
    const det = document.createElement('details');
    det.className = 'overview-card cfg-group cfg-advanced';
    det.id = 'cfg-g-advanced';
    const sum = document.createElement('summary');
    sum.className = 'overview-card-title';
    sum.textContent = `⚙ Avancé — paramètres obsolètes (${legacy.length}, lecture seule)`;
    const p = document.createElement('p');
    p.className = 'muted config-hint';
    p.textContent = 'Conservés pour compatibilité, non modifiables ici : leur valeur n\'est ni changée ni envoyée à l\'enregistrement.';
    det.append(sum, p, ...legacy.map(([k, def]) => cfgField(k, cfg[k], def, true)));
    container.appendChild(det);
  }
  for (const sec of container.querySelectorAll('.cfg-group')) {
    const a = document.createElement('a');
    a.href = `#${sec.id}`;
    a.className = 'btn-ghost';
    a.textContent = sec.querySelector('.overview-card-title').textContent.replace(/ —.*$/, '');
    jump.appendChild(a);
  }
  const ai = document.createElement('a');
  ai.href = '#ai-budget-card'; ai.className = 'btn-ghost'; ai.textContent = '🤖 Budget IA';
  jump.appendChild(ai);
  cfgFilter();
  cfgPending();
}

/** Liens de catégorie : défilement dans la page sans modifier le fragment d'URL (onglet retenu, #50-F). */
document.getElementById('cfg-jump').addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  const t = document.getElementById(a.getAttribute('href').slice(1));
  if (t?.tagName === 'DETAILS') t.open = true;
  t?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/** Recherche : masque les réglages et catégories sans correspondance (les valeurs restent en place). */
function cfgFilter() {
  const q = document.getElementById('cfg-search').value.trim().toLowerCase();
  let shown = 0;
  for (const sec of document.querySelectorAll('#config-rows .cfg-group')) {
    let n = 0;
    for (const row of sec.querySelectorAll('.config-row')) {
      const hit = !q || row.dataset.search.includes(q);
      row.classList.toggle('hidden', !hit);
      if (hit) n++;
    }
    sec.classList.toggle('hidden', !n);
    if (q && n && sec.tagName === 'DETAILS') sec.open = true;
    shown += n;
  }
  document.getElementById('cfg-empty').classList.toggle('hidden', shown > 0);
}
document.getElementById('cfg-search').addEventListener('input', cfgFilter);

const cfgChanged = () => [...document.querySelectorAll('#config-rows .config-value[data-key]')].filter(i => i.value !== i.dataset.orig);
/** Modifications en attente : ligne marquée + compteur à côté du bouton Enregistrer. */
function cfgPending() {
  const changed = new Set(cfgChanged());
  for (const i of document.querySelectorAll('#config-rows .config-value[data-key]')) i.closest('.config-row').classList.toggle('is-changed', changed.has(i));
  document.getElementById('cfg-pending').textContent = changed.size
    ? `${changed.size} modification${changed.size > 1 ? 's' : ''} non enregistrée${changed.size > 1 ? 's' : ''}` : '';
}
document.getElementById('config-rows').addEventListener('input', cfgPending);
document.getElementById('config-rows').addEventListener('change', cfgPending);

document.getElementById('btn-save-config').addEventListener('click', async () => {
  const msgEl  = document.getElementById('config-msg');
  msgEl.classList.add('hidden');
  const errors = [];
  for (const input of cfgChanged()) {   // seuls les réglages modifiés sont envoyés (#62)
    const { ok, data } = await api('PUT', '/api/admin/config', { key: input.dataset.key, value: input.value });
    if (!ok) errors.push(data.error ?? `Erreur pour "${input.dataset.key}".`);
    else input.dataset.orig = input.value;
  }
  cfgPending();
  if (errors.length) { admShowError(document.getElementById('config-err'), errors.join(' · ')); return; }
  admShowError(document.getElementById('config-err'), '');
  admZoneClean(_cfgZone);
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
  const { ok, data, status } = await api('GET', '/api/admin/seasons/active/summary');

  const noSeasonEl = document.getElementById('no-active-season');
  const statsEl    = document.getElementById('season-stats');

  // Seul signal d'exploitation calculé au chargement du panel (#70) : la rotation continue (#16) doit toujours
  // laisser une saison active. Serveur injoignable : pas de faux signal.
  if (ok || status === 404) admNavFlag('season-overview', ok ? null : 'aucune saison active');
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

admRefreshButton('btn-refresh-overview', loadSeasonOverview, 'Saison en cours');

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
  if (!await admAsk(`Annuler la fin exceptionnelle et revenir à la fin hebdomadaire (${_seBoth(_seState.weeklyEnd)}) ?`)) return;
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
    [`#${r.rank}`, r.username, r.manualBlocks, `${r.maxDepth}m`].forEach(v => addCell(tr, v));
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

  // Filtre appliqué en SQL par le serveur (toutes les lignes, pas seulement les 100 dernières)
  const logs = data.logs ?? [];
  const cov  = data.coverage;
  document.getElementById('ac-coverage').textContent = cov && cov.seasonId != null
    ? `Saison ${cov.seasonId} : ${cov.players} joueur(s) suivi(s), ${cov.checkedLast24h} contrôlé(s) dans les 24 dernières heures` +
      (cov.lastCheckAt ? ` — dernier contrôle le ${cov.lastCheckAt.replace('T', ' ').substring(0, 16)} UTC.` : '.')
    : 'Aucune saison active.';
  const last = logs[0]?.logged_at ? ` — dernière anomalie le ${logs[0].logged_at.replace('T', ' ').substring(0, 16)} UTC` : '';
  totalEl.textContent = action
    ? `${data.matching ?? 0} anomalie(s) de ce type sur ${data.total ?? 0} au total — ${logs.length} affichée(s)${last}`
    : `${data.total ?? 0} anomalie(s) consignée(s) au total — ${logs.length} affichée(s)${last}`;

  if (!logs.length) {
    if (action) tbody.innerHTML = '<tr><td colspan="6" class="muted">Aucune anomalie de ce type consignée.</td></tr>';
    else tbody.innerHTML = '<tr><td colspan="6" class="muted">Aucune anomalie consignée. Les sauvegardes normales ne sont pas journalisées.</td></tr>';
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
      rejected:       ['badge-flagged', '✖ rejected'],
      depth_capped:   ['badge-reduced', '↓ profondeur plafonnée'],
      depth_rejected: ['badge-flagged', '✖ profondeur rejetée'],
      damage_capped:  ['badge-reduced', '↓ budget de dégâts'],
      exact_capped:   ['badge-reduced', '↓ PV réels des blocs'],
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

admRefreshButton('btn-refresh-ac', loadAntiCheatLogs, 'Journal anti-autoclicker');
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

const _ecoZone = admZone(document.getElementById('eco-upgrade-cost').closest('.overview-card'));
async function loadEconomy() {
  const { ok, data } = await api('GET', '/api/admin/config');
  if (!ok || admZoneDirty(_ecoZone)) return;   // paramètres en cours de saisie conservés (#61)
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

  admZoneClean(_ecoZone);
  msgEl.classList.remove('hidden');
  setTimeout(() => msgEl.classList.add('hidden'), 3000);
});

// ── Registre de gemmes de référence (#49) ─────────────────────────────────────

const GL_MODES   = { off: 'Désactivé', observe: 'Observation', enforce: 'Fait foi' };
const GL_REASONS = { opening: 'Ouverture (solde repris)', blocks: 'Blocs gemmes validés', declared: 'Série / missions (allocation)',
  autodig: 'Dépense Auto-Dig', season_cap: 'Plafond de saison', purchase: 'Achat', gem_shop: 'Achat boutique en gemmes', admin_credit: 'Crédit admin' };
const GL_KINDS   = { excess_declared: 'Gemmes déclarées au-delà de l\'allocation', client_loss: 'Baisse inexpliquée côté client',
  spend_over_balance: 'Dépense supérieure au solde' };

function _glRows(tbodySel, rows, cells) {
  const tb = document.querySelector(tbodySel);
  tb.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = 4; td.className = 'muted'; td.textContent = 'Aucune ligne.';
    tr.append(td); tb.append(tr); return;
  }
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const v of cells(r)) { const td = document.createElement('td'); td.textContent = String(v ?? '—'); tr.append(td); }
    tb.append(tr);
  }
}

async function loadGemLedger() {
  const { ok, data } = await api('GET', '/api/admin/economy/gems');
  if (!ok) return;
  document.getElementById('gl-mode').textContent = GL_MODES[data.mode] ?? data.mode;
  document.getElementById('gl-allowance').textContent = data.dailyAllowance;
  document.getElementById('gl-accounts').textContent = data.totals.accounts;
  document.getElementById('gl-balance').textContent = data.totals.balance;
  document.getElementById('gl-opening').textContent = data.totals.opening;
  document.getElementById('gl-above').textContent = data.totals.aboveReference;
  document.getElementById('gl-maxdrift').textContent = data.totals.maxDrift;
  _glRows('#gl-reasons-table tbody', data.byReason, r => [GL_REASONS[r.reason] ?? r.reason, r.n, r.total]);
  _glRows('#gl-anomalies-table tbody', data.anomalies, r => [r.createdAt, `${r.username ?? '?'} (#${r.userId})`, GL_KINDS[r.kind] ?? r.kind, r.amount]);
  const sel = document.getElementById('gl-mode-select');
  if (!admZoneDirty(_glZone)) sel.value = data.mode;
}
const _glZone = admZone(document.getElementById('gem-ledger-card'));
admRefreshButton('btn-refresh-gem-ledger', loadGemLedger, 'Registre de gemmes');

document.getElementById('btn-gl-mode').addEventListener('click', async () => {
  const msgEl = document.getElementById('gl-msg'), errEl = document.getElementById('gl-err');
  msgEl.classList.add('hidden'); errEl.classList.add('hidden');
  const mode = document.getElementById('gl-mode-select').value;
  const note = document.getElementById('gl-mode-note').value.trim();
  const body = { mode, note, confirm: true };
  if (mode === 'enforce') {
    const typed = await admPrompt({ title: 'Registre de gemmes : mode « fait foi »',
      text: 'Le solde de référence remplacera les gemmes envoyées aux joueurs (la sauvegarde stockée n\'est pas réécrite). Réservé à la décision du propriétaire après recette du mode Observation.',
      label: 'Saisir ENFORCE pour confirmer', ok: 'Activer' });
    if (typed === null) return;
    body.confirmText = typed.trim();
  } else if (!await admConfirm({ title: `Registre de gemmes : mode « ${GL_MODES[mode]} »`,
    impact: mode === 'observe' ? ['Le serveur enregistre un solde de référence et note les écarts.', 'Aucune sauvegarde ni solde de joueur n\'est modifié ; réversible (Désactivé).']
      : ['Plus aucun mouvement enregistré ; le journal existant est conservé.'] })) return;
  const { ok, data } = await api('POST', '/api/admin/economy/gems/mode', body);
  if (!ok) { errEl.textContent = data.error ?? 'Erreur.'; errEl.classList.remove('hidden'); return; }
  admZoneClean(_glZone);
  document.getElementById('gl-mode-note').value = '';
  msgEl.textContent = data.changed ? `Mode : ${GL_MODES[data.mode]}.` : 'Mode inchangé.';
  msgEl.classList.remove('hidden');
  loadGemLedger();
});

// ── Règles économiques versionnées (#49, lot 1.2) ────────────────────────────
// Référence pilotable, sans effet en jeu tant que l'application n'est pas livrée (voir le serveur).

const ER_GEM_ITEMS = { skin_golden: 'Pioche dorée (cosmétique)', skin_diamond: 'Pioche diamant (cosmétique)',
  auto_collect: 'Ramassage automatique des coffres de la mine', coin_boost_30: 'Boost ×2 pièces 30 min' };
const ER_SOURCES = { origin: 'Valeurs d\'origine', publish: 'Publication', rollback: 'Retour arrière' };
let _erView = null;

/** Libellé lisible d'un chemin de règle (gems.perBlock.rubis → « Gemmes par bloc · rubis »). */
function _erLabel(path) {
  const [a, b, c, d] = path.split('.');
  if (a === 'gems') {
    if (b === 'perBlock') return `Gemmes par bloc · ${c}`;
    if (b === 'mineChest') return `Coffre de la mine ${c} · ${d === 'chance' ? 'chance (%)' : 'gemmes'}`;
    if (b === 'dailyStreak') return `Série quotidienne · jour ${Number(c) + 1}`;
    if (b === 'autodig') return `Auto-Dig niveau ${c} (💎)`;
    if (b === 'missionSetBonus') return 'Bonus trois missions (💎)';
    if (b === 'seasonCap') return 'Plafond de fin de saison (💎)';
  }
  if (a === 'coins') return 'Courbe des pièces';
  if (a === 'shopChests') return `Coffre ${c === undefined ? b : b} · limite par saison`;
  if (a === 'gemShop') return `${ER_GEM_ITEMS[c] ?? c} · ${d === 'price' ? 'prix 💎' : 'disponible'}`;
  return path;
}
function _erCurveText(curve) {
  return curve.length ? curve.map(s => `${s.until ?? '∞'}:${s.slope}`).join(', ') : '';
}
function _erParseCurve(txt) {
  const t = txt.trim();
  if (!t) return [];
  return t.split(',').map(part => {
    const [u, sl] = part.split(':').map(x => x.trim());
    return { until: u === '∞' || u === '' ? null : Number(u), slope: Number(sl) };
  });
}
function _erValue(v) {
  if (v === null) return 'illimité';
  if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? (_erCurveText(v) || '+5 %/m sans limite') : v.join(' / ');
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  return String(v);
}

/** Formulaire du brouillon (ou de la version publiée s'il n'y en a pas). */
function _erRenderForm(r) {
  const form = document.getElementById('er-form');
  form.replaceChildren();
  const group = (title, fields) => {
    const fs = document.createElement('fieldset');
    fs.className = 'er-group';
    const lg = document.createElement('legend'); lg.textContent = title; fs.append(lg);
    for (const [path, label, value, kind = 'number'] of fields) {
      const lab = document.createElement('label');
      lab.className = 'er-field';
      lab.append(document.createTextNode(label + ' '));
      const inp = document.createElement('input');
      inp.dataset.path = path;
      if (kind === 'checkbox') { inp.type = 'checkbox'; inp.checked = value; }
      else { inp.type = kind; inp.value = value ?? ''; if (kind === 'number') inp.step = 'any'; inp.style.width = kind === 'text' ? '220px' : '80px'; }
      if (kind === 'number' && path.startsWith('shopChests.')) inp.placeholder = 'illimité';
      lab.append(inp);
      fs.append(lab);
    }
    form.append(fs);
  };
  const g = r.gems;
  group('Gemmes par bloc détruit', Object.entries(g.perBlock).map(([id, n]) => [`gems.perBlock.${id}`, id, n]));
  group('Gemmes des coffres de la mine', Object.entries(g.mineChest).flatMap(([id, c]) => [
    [`gems.mineChest.${id}.chance`, `${id} : chance %`, c.chance], [`gems.mineChest.${id}.gems`, `${id} : 💎`, c.gems]]));
  group('Série, missions, plafond', [
    ...g.dailyStreak.map((n, i) => [`gems.dailyStreak.${i}`, `Jour ${i + 1}`, n]),
    ['gems.missionSetBonus', 'Bonus trois missions', g.missionSetBonus],
    ['gems.seasonCap', 'Plafond de fin de saison', g.seasonCap]]);
  group('Auto-Dig (coût en 💎) — simulation ; prix appliqués au jeu : ⬆ Améliorations', Object.entries(g.autodig).map(([l, n]) => [`gems.autodig.${l}`, `Niveau ${l}`, n]));
  group('Pièces et coffres de la boutique', [
    ['coins.curve', 'Courbe (fin:pente, … ; vide = +5 %/m sans limite ; ex. 200:0.05, ∞:0.02)', _erCurveText(r.coins.curve), 'text'],
    ...Object.entries(r.shopChests).map(([id, c]) => [`shopChests.${id}.maxPerSeason`, `${id} : limite / saison`, c.maxPerSeason])]);
  group('Boutique en gemmes (prix de simulation)', Object.entries(r.gemShop.items).flatMap(([id, it]) => [
    [`gemShop.items.${id}.price`, `${ER_GEM_ITEMS[id] ?? id} : prix`, it.price], [`gemShop.items.${id}.enabled`, 'disponible', it.enabled, 'checkbox']]));
}

function _erCollect() {
  const r = structuredClone((_erView.draft ?? _erView.published).rules);
  for (const inp of document.querySelectorAll('#er-form input[data-path]')) {
    const path = inp.dataset.path.split('.');
    let o = r;
    for (const k of path.slice(0, -1)) o = o[k];
    const last = path[path.length - 1];
    if (inp.dataset.path === 'coins.curve') o[last] = _erParseCurve(inp.value);
    else if (inp.type === 'checkbox') o[last] = inp.checked;
    else if (inp.value.trim() === '') o[last] = inp.dataset.path.startsWith('shopChests.') ? null : '';
    else o[last] = Number(inp.value);
  }
  return r;
}

function _erMsg(text, isErr = false, details = null) {
  const msgEl = document.getElementById('er-msg'), errEl = document.getElementById('er-err');
  msgEl.classList.add('hidden'); errEl.classList.add('hidden');
  if (!text) return;
  const el = isErr ? errEl : msgEl;
  el.textContent = text + (details?.length ? ` — ${details.join(' ')}` : '');
  el.classList.remove('hidden');
}

async function loadEconomyRules() {
  const { ok, data } = await api('GET', '/api/admin/economy/rules');
  if (!ok) return;
  _erView = data;
  document.getElementById('er-version').textContent = `v${data.published.version} (${data.published.createdAt})`;
  document.getElementById('er-draft-state').textContent = data.draft
    ? `basé sur v${data.draft.basedOn}, ${data.draft.changes.length} écart(s)${data.draft.errors.length ? `, ${data.draft.errors.length} erreur(s)` : ''}`
    : 'aucun';
  const gap = document.getElementById('er-game-gap');
  gap.textContent = data.gameVsPublished.length
    ? `⚠ Le jeu applique encore ${data.gameVsPublished.length} valeur(s) différente(s) de la version publiée (application non livrée) : ${data.gameVsPublished.slice(0, 6).map(c => `${_erLabel(c.path)} = ${_erValue(c.before)}`).join(' ; ')}${data.gameVsPublished.length > 6 ? '…' : ''}.`
    : '';
  gap.classList.toggle('hidden', !data.gameVsPublished.length);
  const sel = document.getElementById('er-preset');
  if (!sel.options.length) for (const p of data.presets) sel.append(new Option(p.label, p.id));
  if (!admZoneDirty(_erZone)) { _erRenderForm((data.draft ?? data.published).rules); admZoneClean(_erZone); }
  _glRows('#er-changes-table tbody', data.draft?.changes ?? [], c => [_erLabel(c.path), _erValue(c.before), _erValue(c.after)]);
  const tb = document.querySelector('#er-versions-table tbody');
  tb.replaceChildren();
  for (const v of data.versions) {
    const tr = document.createElement('tr');
    for (const x of [`v${v.version}`, v.createdAt, ER_SOURCES[v.source] ?? v.source, v.note ?? '']) {
      const td = document.createElement('td'); td.textContent = x; tr.append(td);
    }
    const td = document.createElement('td');
    if (v.version !== data.published.version) {
      const b = document.createElement('button');
      b.className = 'btn btn-outline btn-sm'; b.textContent = 'Revenir à cette version…';
      b.addEventListener('click', () => _erRollback(v.version));
      td.append(b);
    }
    tr.append(td); tb.append(tr);
  }
}
const _erZone = admZone(document.getElementById('eco-rules-card'));
admRefreshButton('btn-refresh-eco-rules', loadEconomyRules, 'Règles économiques');

document.getElementById('btn-er-save').addEventListener('click', async () => {
  _erMsg('');
  const { ok, data } = await api('PUT', '/api/admin/economy/rules/draft', { rules: _erCollect() });
  if (!ok) return _erMsg(data.error ?? 'Erreur.', true, data.details);
  admZoneClean(_erZone);
  _erMsg(data.draft ? `Brouillon enregistré (${data.changes.length} écart(s)). Rien n'est publié.` : 'Identique à la version publiée : brouillon supprimé.');
  loadEconomyRules();
});

document.getElementById('btn-er-preset').addEventListener('click', async () => {
  _erMsg('');
  if (admZoneDirty(_erZone) && !await admConfirmDiscard({ effect: 'applique le préréglage au brouillon enregistré ; les saisies non enregistrées sont perdues.' })) return;
  const { ok, data } = await api('POST', '/api/admin/economy/rules/preset', { preset: document.getElementById('er-preset').value });
  if (!ok) return _erMsg(data.error ?? 'Erreur.', true, data.details);
  admZoneClean(_erZone);
  _erMsg('Préréglage appliqué au brouillon. Rien n\'est publié.');
  loadEconomyRules();
});

document.getElementById('btn-er-discard').addEventListener('click', async () => {
  _erMsg('');
  if (!await admConfirm({ title: 'Abandonner le brouillon des règles économiques', impact: ['Le brouillon est supprimé ; la version publiée ne change pas.'], danger: true })) return;
  const { ok, data } = await api('DELETE', '/api/admin/economy/rules/draft');
  if (!ok) return _erMsg(data.error ?? 'Erreur.', true);
  admZoneClean(_erZone);
  _erMsg(data.discarded ? 'Brouillon abandonné.' : 'Aucun brouillon.');
  loadEconomyRules();
});

const _pct = (a, b) => (a ? `${b >= a ? '+' : ''}${Math.round((b - a) / a * 100)} %` : (b ? 'nouveau' : '='));
const _fmtN = n => (n == null ? '—' : Number(n).toLocaleString('fr-FR'));
document.getElementById('btn-er-simulate').addEventListener('click', async () => {
  _erMsg('');
  if (admZoneDirty(_erZone)) return _erMsg('Enregistrez d\'abord le brouillon : la simulation compare le brouillon enregistré.', true);
  const state = document.getElementById('er-sim-state');
  const btn = document.getElementById('btn-er-simulate');
  btn.disabled = true; state.textContent = 'Simulation en cours (processus séparé, quelques secondes)…';
  const { ok, data } = await api('POST', '/api/admin/economy/rules/simulate', { runs: Number(document.getElementById('er-sim-runs').value) });
  btn.disabled = false;
  if (!ok) { state.textContent = ''; return _erMsg(data.error ?? 'Erreur.', true, data.details); }
  state.textContent = `${data.runs} joueurs par profil, mêmes graines, ${(data.ms / 1000).toFixed(1)} s. Chaque case : publiée → brouillon (écart).`;
  const keys = ['gemsEarned', 'gemsPerH', 'gemsLostCap', 'fragsEarned', 'relicLevels', 'coinsEarned', 'maxDepthP50', 'shopChests'];
  _glRows('#er-sim-table tbody', data.profiles, p => [p.label,
    ...keys.map(k => `${_fmtN(p.before[k])} → ${_fmtN(p.after[k])} (${_pct(p.before[k], p.after[k])})`)]);
  document.querySelectorAll('#er-sim-table tbody td.muted').forEach(td => { td.colSpan = 9; });
  document.getElementById('er-sim-table').classList.remove('hidden');
});

document.getElementById('btn-er-publish').addEventListener('click', async () => {
  _erMsg('');
  if (!_erView?.draft) return _erMsg('Aucun brouillon à publier.', true);
  if (admZoneDirty(_erZone)) return _erMsg('Enregistrez d\'abord le brouillon.', true);
  const note = document.getElementById('er-publish-note').value.trim();
  if (!note) return _erMsg('Une note de publication est obligatoire.', true);
  if (!await admConfirm({ title: `Publier les règles économiques v${_erView.published.version + 1}`,
    impact: [`${_erView.draft.changes.length} règle(s) changent dans la référence.`,
      'Aucun effet en jeu aujourd\'hui : le jeu n\'applique pas encore ces règles (application séparée, après validation du propriétaire).',
      'Réversible : « Revenir à cette version » publie une nouvelle version au contenu d\'une ancienne.'] })) return;
  const { ok, data } = await api('POST', '/api/admin/economy/rules/publish', { note, basedOn: _erView.draft.basedOn, confirm: true });
  if (!ok) return _erMsg(data.error ?? 'Erreur.', true, data.details);
  document.getElementById('er-publish-note').value = '';
  admZoneClean(_erZone);
  _erMsg(`Version ${data.version} publiée (${data.changes.length} écart(s)).`);
  loadEconomyRules(); loadGemShop();
});

async function _erRollback(version) {
  _erMsg('');
  if (!await admConfirm({ title: `Revenir aux règles économiques v${version}`,
    impact: [`Publie une nouvelle version au contenu de la v${version} ; les versions existantes sont conservées.`, 'Aucun effet en jeu aujourd\'hui.'] })) return;
  const { ok, data } = await api('POST', '/api/admin/economy/rules/rollback', { version, confirm: true });
  if (!ok) return _erMsg(data.error ?? 'Erreur.', true, data.details);
  _erMsg(`Version ${data.version} publiée (contenu de la v${data.restored}).`);
  loadEconomyRules(); loadGemShop();
}

// ── Boutique en gemmes (#49, lot 2.6) ────────────────────────────────────────

let _gsView = null;
async function loadGemShop() {
  const { ok, data } = await api('GET', '/api/admin/economy/gem-shop');
  if (!ok) return;
  _gsView = data;
  document.getElementById('gs-state').textContent = data.open ? 'ouverte aux joueurs' : (data.flag ? 'drapeau activé, mais fermée (registre pas en « fait foi »)' : 'fermée');
  document.getElementById('gs-ledger').textContent = GL_MODES[data.ledgerMode] ?? data.ledgerMode;
  document.getElementById('gs-version').textContent = data.version;
  const totals = Object.fromEntries(data.totals.map(t => [t.item_id, t.n]));
  const KINDS = { cosmetic: 'Cosmétique', comfort: 'Confort', boost: 'Temporaire' };
  _glRows('#gs-items-table tbody', data.items, i => [ER_GEM_ITEMS[i.id] ?? i.id, KINDS[i.kind] ?? i.kind, i.price, i.enabled ? 'oui' : 'non', totals[i.id] ?? 0]);
  document.querySelectorAll('#gs-items-table tbody td.muted').forEach(td => { td.colSpan = 5; });
  document.getElementById('btn-gs-toggle').textContent = data.flag ? 'Fermer la boutique…' : 'Ouvrir la boutique…';
}
admRefreshButton('btn-refresh-gem-shop', loadGemShop, 'Boutique en gemmes');

document.getElementById('btn-gs-toggle').addEventListener('click', async () => {
  const msgEl = document.getElementById('gs-msg'), errEl = document.getElementById('gs-err');
  msgEl.classList.add('hidden'); errEl.classList.add('hidden');
  const enabled = !_gsView?.flag;
  const body = { enabled, confirm: true, note: document.getElementById('gs-note').value.trim() };
  if (enabled) {
    const typed = await admPrompt({ title: 'Ouvrir la boutique en gemmes',
      text: 'Les joueurs pourront dépenser leurs gemmes de référence aux prix publiés. Réservé à la décision du propriétaire (prix validés, registre en « fait foi »).',
      label: 'Saisir OUVRIR pour confirmer', ok: 'Ouvrir' });
    if (typed === null) return;
    body.confirmText = typed.trim();
  } else if (!await admConfirm({ title: 'Fermer la boutique en gemmes', impact: ['Plus aucun achat possible ; les achats passés sont conservés.'] })) return;
  const { ok, data } = await api('POST', '/api/admin/economy/gem-shop/flag', body);
  if (!ok) { errEl.textContent = data.error ?? 'Erreur.'; errEl.classList.remove('hidden'); return; }
  document.getElementById('gs-note').value = '';
  msgEl.textContent = data.changed ? (data.enabled ? 'Boutique ouverte.' : 'Boutique fermée.') : 'Inchangé.';
  msgEl.classList.remove('hidden');
  loadGemShop();
});

// ── Recherche de joueurs ──────────────────────────────────────────────────────

let _currentPlayerId   = null;
let _currentPlayerName = null;

document.getElementById('btn-player-search').addEventListener('click', searchPlayers);

/**
 * Autocomplétion des pseudos (#37, recette du 03/11), réutilisable par d'autres écrans
 * (ex. événements TEST #56) : suggestions « pseudo · ID » sans e-mail, sélection par
 * identifiant stable. ↑/↓ pour parcourir, Entrée pour choisir, Échap pour fermer.
 * onEnter() est appelé sur Entrée quand aucune suggestion n'est surlignée.
 */
function attachPlayerAutocomplete(input, list, { onSelect, onEnter, minChars = 2 } = {}) {
  let items = [], active = -1, timer = null, seqNo = 0;
  const close = () => {
    list.classList.add('hidden'); list.innerHTML = ''; items = []; active = -1;
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
  };
  const highlight = i => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', list.children[i].id); list.children[i].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const choose = u => { close(); input.value = u.username; onSelect(u); };
  const render = (users, q) => {
    list.innerHTML = ''; items = users; active = -1;
    if (!users.length) {
      const li = document.createElement('li');
      li.className = 'player-ac-empty muted';
      li.textContent = `Aucun pseudo ne contient « ${q} ».`;
      list.appendChild(li);
    }
    users.forEach((u, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.dataset.userId = String(u.id);
      const name = document.createElement('strong'); name.textContent = u.username;
      const id   = document.createElement('span');   id.className = 'muted'; id.textContent = ` · ID ${u.id}`;
      li.append(name, id);
      li.addEventListener('mousedown', e => { e.preventDefault(); choose(u); });
      list.appendChild(li);
    });
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < minChars) { close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seqNo;
      const { ok, data } = await api('GET', `/api/admin/players/suggest?q=${encodeURIComponent(q)}`);
      if (mine !== seqNo || input.value.trim() !== q) return; // réponse périmée
      if (ok) render(data.users ?? [], q); else close();
    }, 200);
  });
  input.addEventListener('keydown', e => {
    const open = !list.classList.contains('hidden') && items.length > 0;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); highlight((active + 1) % items.length); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); highlight(active <= 0 ? items.length - 1 : active - 1); }
    else if (e.key === 'Escape' && !list.classList.contains('hidden')) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0) choose(items[active]);
      else { close(); onEnter?.(); }
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return { close };
}

attachPlayerAutocomplete(
  document.getElementById('player-search-input'),
  document.getElementById('player-search-suggest'),
  { onSelect: u => viewPlayerSave(u.id, u.username), onEnter: searchPlayers },
);

/** Date SQLite UTC (« AAAA-MM-JJ HH:MM:SS ») → « JJ/MM/AAAA HH:MM (Bruxelles) — HH:MM UTC ». */
function pdSavedAt(s) {
  if (!s) return '—';
  const d = new Date(`${String(s).replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'}`);
  if (isNaN(d)) return String(s);
  const local = d.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' });
  return `${local} (${d.toISOString().slice(11, 16)} UTC)`;
}

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
    addButtonCell(tr, 'Ouvrir la fiche', () => viewPlayerSave(u.id, u.username));
    tbody.appendChild(tr);
  });
  const table = document.getElementById('player-results-table');
  admTableLabels(table);
  admTablePage(table, document.getElementById('player-results-pager'), 10);
  resultsDiv.classList.remove('hidden');
  // Un seul joueur trouvé (#76) : la fiche s'ouvre directement.
  if (data.users.length === 1) viewPlayerSave(data.users[0].id, data.users[0].username);
}

async function viewPlayerSave(userId, username) {
  if (userId !== _currentPlayerId) document.getElementById('tr-done').classList.add('hidden');
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
  pdSummary(s);
  if (!s) { card.classList.remove('hidden'); loadTestRuns(userId); pdReveal(card); return; }

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
  document.getElementById('pd-chest-simple').textContent  = cb.simple  ?? 0;
  document.getElementById('pd-chest-rare').textContent    = cb.rare    ?? 0;
  document.getElementById('pd-chest-antique').textContent = cb.antique ?? 0;
  document.getElementById('pd-updated').textContent  = pdSavedAt(s.updatedAt);
  document.getElementById('pd-revision').textContent = s.revision != null ? `n° ${s.revision}` : '—';
  document.getElementById('pd-version').textContent  = s.saveVersion != null ? `v${s.saveVersion}` : '—';

  // Reset UI de confirmation
  document.getElementById('player-reset-confirm').classList.add('hidden');
  document.getElementById('player-reset-msg').classList.add('hidden');
  document.getElementById('player-reset-err').classList.add('hidden');
  document.getElementById('btn-season-reset-player').classList.remove('hidden');
  document.getElementById('pr-confirm-name').textContent = username;

  card.classList.remove('hidden');
  loadTestRuns(userId);
  pdReveal(card);
}

/** Résumé compact de la fiche (#76) : l'essentiel d'un coup d'œil ; le détail reste dans « Progression détaillée ». */
function pdSummary(s) {
  const ul = document.getElementById('pd-summary');
  ul.textContent = '';
  const item = (label, value, id) => {
    const li = document.createElement('li');
    if (id) li.id = id;
    li.append(Object.assign(document.createElement('span'), { className: 'pd-sum-label', textContent: label }),
      Object.assign(document.createElement('strong'), { textContent: value }));
    ul.appendChild(li);
  };
  item('🧪 Essai', '…', 'pd-sum-run');
  if (!s) { item('📈 Sauvegarde', 'aucune sauvegarde cloud'); return; }
  item('⛏ Profondeur', `${s.depth ?? 1} m`);
  item('💰 Pièces', (s.coins ?? 0).toLocaleString());
  item('💎 Gemmes', String(s.gems ?? 0));
  item('🪨 Pioche', `niv. ${s.pickaxeLevel ?? 1}`);
  item('⬆ Auto-Dig', `niv. ${s.upgrades?.autodig ?? 0}`);
  item('⏱ Sauvegarde', pdSavedAt(s.updatedAt));
  item('🔁 Révision', s.revision != null ? `n° ${s.revision}` : '—');
}

/** Montre la fiche ; action du menu en attente (ex. « Recommencer un test à zéro ») : directement sur sa section. */
function pdReveal(card) {
  const pending = _pdPending && document.getElementById(_pdPending);
  _pdPending = null;
  document.getElementById('players-hint').classList.add('hidden');
  if (pending) { pending.open = true; admNavPoint(pending); }
  else card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('btn-pd-goto-tests').addEventListener('click', () => {
  const sec = document.getElementById('pd-sec-tests');
  sec.open = true;
  admNavPoint(sec);
});
// Fiche anti-bot du même joueur (lecture seule, #25), ouverte par-dessus sans quitter la rubrique Joueurs.
document.getElementById('btn-pd-antibot').addEventListener('click', e => {
  if (_currentPlayerId != null) secOpenPlayer(String(_currentPlayerId), e.currentTarget);
});

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

// ── Essais de test : reset complet, historique, restauration (#75) ───────────
// Aperçu serveur (impact + révision) → fiche de confirmation : motif + pseudo exact saisi → envoi avec un
// identifiant de requête (un double clic ou un renvoi réseau ne réinitialise jamais deux fois). Le serveur
// refuse si la sauvegarde a changé depuis l'aperçu. Rendu en textContent uniquement (#15).

const TR_END = { test_reset: 'Recommencé à zéro', restore: 'Restauration d\'un essai', season_reset_partial: 'Réinit. saisonnière partielle' };
const TR_KEYS = { depth: 'Profondeur actuelle (m)', rankedMaxDepth: 'Profondeur classée (m)', manualBlocksValidated: 'Blocs manuels validés',
  manualClicks: 'Clics manuels', blocksDestroyed: 'Blocs détruits', pickaxeLevel: 'Niveau de pioche', autodigLevelEnd: 'Niveau Auto-Dig',
  autodigLevel: 'Niveau Auto-Dig', coins: 'Pièces', gems: 'Gemmes', relics: 'Reliques', riskScore: 'Score de risque', riskLevel: 'Niveau de risque' };
const TR_PAGE = 5;   // essais par page (#76)
let _trCtx = null;   // { mode: 'reset'|'restore', userId, runId, username, expectedRevision, requestId }

function trDuration(sec) {
  if (sec === null || sec === undefined) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
const trNum = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-BE'));
function trDecisions(st) {
  const parts = Object.entries(st.serverDecisions ?? {}).filter(([k]) => !k.startsWith('admin_')).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`);
  const ac = Object.entries(st.anticheatActions ?? {}).map(([k, n]) => `autoclic ${k} ×${n}`);
  return [...parts, ...ac];
}
/** Décisions serveur d'un essai (#76) : la plus fréquente visible, la liste complète dépliable, une par ligne. */
function trDecisionsCell(tr, st) {
  const all = trDecisions(st);
  const td = addCell(tr, all.length < 2 ? (all[0] ?? 'aucune') : '');
  td.style.fontSize = '0.8rem';
  if (all.length < 2) return;
  td.title = all.join(', ');
  const det = document.createElement('details');
  det.className = 'tr-dec';
  const sum = document.createElement('summary');
  sum.textContent = `${all[0]} +${all.length - 1}`;
  sum.title = 'Afficher toutes les décisions de cet essai';
  const ul = document.createElement('ul');
  for (const d of all) { const li = document.createElement('li'); li.textContent = d; ul.appendChild(li); }
  det.append(sum, ul);
  td.appendChild(det);
}

function trRow(tbody, label, run, st, endLabel) {
  const tr = document.createElement('tr');
  addCell(tr, label);
  const from = admBrussels(st.startedAt), to = run ? admBrussels(st.endedAt) : 'en cours';
  const cut = s => s.slice(0, s.lastIndexOf(' '));   // même jour : l'heure de fin seule (#76), période complète en infobulle
  addCell(tr, `${from} → ${run && cut(from) === cut(to) ? to.slice(to.lastIndexOf(' ') + 1) : to}`).title = `${from} → ${to}`;
  addCell(tr, trDuration(st.durationSec));
  addCell(tr, endLabel);
  addCell(tr, `${trNum(st.rankedMaxDepth)} / ${trNum(st.depth)}`);
  addCell(tr, `${trNum(st.manualBlocksValidated)} / ${trNum(st.manualBlocksDeclared)}`);
  addCell(tr, `${trNum(st.manualClicks)} (${trNum(st.suspiciousClicks)})`);
  addCell(tr, `${trNum(st.autodigLevelEnd)} / ${st.autodigLevelMaxSeen === null || st.autodigLevelMaxSeen === undefined ? 'non journalisé' : trNum(st.autodigLevelMaxSeen)}`);
  addCell(tr, `${trNum(st.coins)} / ${trNum(st.gems)}`);
  addCell(tr, `${st.riskScore ?? 0} (niv. ${st.riskLevel ?? 0})`);
  trDecisionsCell(tr, st);
  if (run) addButtonCell(tr, 'Restaurer…', e => trOpenRestore(run, e.currentTarget));
  else addCell(tr, '');
  tbody.appendChild(tr);
}

async function loadTestRuns(userId) {
  const tbody = document.querySelector('#tr-table tbody');
  const { ok, data } = await api('GET', `/api/admin/players/${userId}/test-runs`);
  if (userId !== _currentPlayerId) return;
  tbody.textContent = '';
  admShowError(document.getElementById('tr-err'), ok ? '' : (data.error ?? 'Historique des essais indisponible.'));
  if (!ok) return;
  // #76 : l'essai en cours d'abord, puis les essais archivés du plus récent au plus ancien, 5 par page.
  trRow(tbody, `n° ${data.current.runNo} (en cours)`, null, data.current.stats, '—');
  for (const r of [...data.runs].reverse()) {
    trRow(tbody, `n° ${r.runNo}`, r, r.stats, `${TR_END[r.endKind] ?? r.endKind}${r.reason ? ` — ${r.reason}` : ''}`);
  }
  const table = document.getElementById('tr-table');
  admTableLabels(table);
  admTablePage(table, document.getElementById('tr-pager'), TR_PAGE);
  const run = document.querySelector('#pd-sum-run strong');
  if (run) run.textContent = `n° ${data.current.runNo} en cours depuis ${trDuration(data.current.stats.durationSec)}${data.runs.length ? ` · ${data.runs.length} archivé(s)` : ''}`;
  const g = document.getElementById('tr-guard');
  g.textContent = data.guard ? `Garde active depuis le dernier ${data.guard.kind === 'restore' ? 'retour à un essai' : 'reset'} : une sauvegarde d'un ancien onglet ou d'un client sans révision est refusée (révision minimale ${data.guard.revision}).` : '';
  g.classList.toggle('hidden', !data.guard);
  const a = data.auditChain;
  document.getElementById('tr-audit').textContent = `Journal d'audit des essais : ${a.entries} entrée(s), chaîne d'empreintes ${a.ok ? 'intacte ✓' : `ROMPUE à l'entrée ${a.brokenAt} ⚠`}.`
    + (data.runs.length ? '' : ' Aucun essai archivé : l\'essai n° 1 court depuis l\'inscription ; ses détails antérieurs non journalisés ne sont pas reconstitués.');
}

function trFillDialog({ title, text, diff, impact, confirmLabel, username }) {
  document.getElementById('tr-dialog-title').textContent = title;
  document.getElementById('tr-dialog-text').textContent = text;
  const tbody = document.querySelector('#tr-diff tbody');
  tbody.textContent = '';
  for (const d of diff) {
    const tr = document.createElement('tr');
    addCell(tr, TR_KEYS[d.key] ?? d.key);
    addCell(tr, trNum(d.current));
    const after = addCell(tr, trNum(d.restored));
    if (d.current !== d.restored) after.style.fontWeight = '700';
    tbody.appendChild(tr);
  }
  // Résumé des valeurs qui changent (#76) ; le tableau complet reste dans les détails repliés.
  const changed = diff.filter(d => d.current !== d.restored);
  document.getElementById('tr-dialog-changes').textContent = changed.length
    ? `Change : ${changed.slice(0, 5).map(d => `${TR_KEYS[d.key] ?? d.key} ${trNum(d.current)} → ${trNum(d.restored)}`).join(' · ')}${changed.length > 5 ? ` · et ${changed.length - 5} autre(s)` : ''}.`
    : `Aucune des ${diff.length} valeurs comparées ne change (personnage déjà à l'état visé).`;
  document.getElementById('tr-dialog-details').open = false;
  document.getElementById('tr-dialog-details-sum').textContent = `Détails : ${diff.length} valeurs avant / après, ce qui est archivé et conservé (${impact.length} points)`;
  const ul = document.getElementById('tr-impact');
  ul.textContent = '';
  for (const line of impact) ul.appendChild(Object.assign(document.createElement('li'), { textContent: line }));
  document.getElementById('tr-confirm-name').textContent = username;
  document.getElementById('tr-confirm-input').value = '';
  document.getElementById('tr-reason').value = '';
  const btn = document.getElementById('btn-tr-confirm');
  btn.textContent = confirmLabel;
  btn.disabled = true;
  admShowError(document.getElementById('tr-msg'), '');
}

function trCheck() {
  const ok = _trCtx && document.getElementById('tr-confirm-input').value === _trCtx.username
    && document.getElementById('tr-reason').value.trim().length >= 3;
  document.getElementById('btn-tr-confirm').disabled = !ok;
}

async function trOpenReset(opener) {
  const userId = _currentPlayerId;
  if (!userId) return;
  const { ok, data } = await api('GET', `/api/admin/players/${userId}/test-runs/reset-preview`);
  if (!ok) { admShowError(document.getElementById('tr-err'), data.error ?? 'Aperçu indisponible.'); return; }
  const c = data.current, a = data.after;
  _trCtx = { mode: 'reset', userId, username: data.username, expectedRevision: data.expectedRevision, requestId: crypto.randomUUID() };
  const rows = Object.entries(data.rowsToArchive).filter(([, n]) => n > 0).map(([k, n]) => `${k} (${n})`).join(', ') || 'aucune ligne serveur';
  trFillDialog({
    title: `Recommencer un test à zéro — ${data.username}`,
    text: `L'essai n° ${data.currentRunNo} (révision de sauvegarde ${data.expectedRevision ?? 'aucune'}) est archivé avec un instantané complet et restaurable, puis le personnage repart comme une inscription neuve (essai n° ${data.currentRunNo + 1}).`,
    diff: ['depth', 'rankedMaxDepth', 'manualBlocksValidated', 'coins', 'gems', 'pickaxeLevel', 'relics', 'riskScore']
      .map(k => ({ key: k, current: c[k], restored: a[k] ?? 0 })).concat([{ key: 'autodigLevel', current: c.autodigLevelEnd, restored: a.autodigLevel }]),
    impact: [
      `Archivé puis remis à zéro : sauvegarde, ${rows}.`,
      'Le joueur disparaît du classement de la saison active jusqu\'à son prochain bloc cassé à la main ; ligue de départ.',
      'Score de risque : l\'ancien est archivé et journalisé (security_events « admin_test_reset »), le nouvel essai repart à 0 ; aucun journal anti-bot n\'est effacé.',
      ...data.kept.map(k => `Conservé : ${k}.`),
      'Toutes les pages ouvertes du joueur (onglets, PWA, autres appareils) perdent la main avec un message et doivent recharger ; aucune ancienne sauvegarde ne peut revenir.',
    ],
    confirmLabel: `Archiver l'essai n° ${data.currentRunNo} et remettre à zéro`,
    username: data.username,
  });
  admDialogOpen('tr-dialog', opener, 'tr-reason');
}

async function trOpenRestore(run, opener) {
  const userId = _currentPlayerId;
  if (!userId) return;
  const { ok, data } = await api('GET', `/api/admin/players/${userId}/test-runs/${run.id}/restore-preview`);
  if (!ok) { admShowError(document.getElementById('tr-err'), data.error ?? 'Aperçu indisponible.'); return; }
  _trCtx = { mode: 'restore', userId, runId: run.id, username: data.username, expectedRevision: data.expectedRevision, requestId: crypto.randomUUID() };
  trFillDialog({
    title: `Restaurer l'essai n° ${data.runNo} — ${data.username}`,
    text: `Remet l'état archivé de l'essai n° ${data.runNo} (${TR_END[run.endKind] ?? run.endKind}, ${admBrussels(run.endedAt)}). ${data.seasonNote}`,
    diff: data.diff,
    impact: [
      'L\'essai en cours est d\'abord archivé avec un instantané complet (il reste restaurable : rien n\'est détruit).',
      'Saisons clôturées, points de récompense, commandes et journaux anti-bot inchangés ; aucun gain ni cadeau n\'est crédité en plus de l\'état archivé.',
      'Toutes les pages ouvertes du joueur perdent la main et doivent recharger.',
    ],
    confirmLabel: `Restaurer l'essai n° ${data.runNo}`,
    username: data.username,
  });
  admDialogOpen('tr-dialog', opener, 'tr-reason');
}

async function trConfirm() {
  const ctx = _trCtx;
  if (!ctx) return;
  const btn = document.getElementById('btn-tr-confirm');
  btn.disabled = true;
  const body = { confirmUsername: document.getElementById('tr-confirm-input').value, expectedRevision: ctx.expectedRevision,
    requestId: ctx.requestId, reason: document.getElementById('tr-reason').value.trim() };
  const path = ctx.mode === 'reset' ? `/api/admin/players/${ctx.userId}/test-runs/reset` : `/api/admin/players/${ctx.userId}/test-runs/${ctx.runId}/restore`;
  const { ok, data } = await api('POST', path, body);
  if (!ok) { admShowError(document.getElementById('tr-msg'), data.error ?? 'Erreur : aucune modification appliquée.'); trCheck(); return; }
  _trCtx = null;
  document.getElementById('tr-dialog').close();
  const done = document.getElementById('tr-done');
  done.textContent = ctx.mode === 'reset'
    ? `Essai n° ${data.runNo} archivé (${data.testRunId}) ; essai n° ${data.newRunNo} commencé — révision ${data.revision}.${data.replayed ? ' (requête déjà traitée : rien de plus n\'a été modifié)' : ''}`
    : `Essai n° ${data.restoredRunNo} restauré ; l'essai précédent est archivé sous le n° ${data.runNo} — révision ${data.revision}.`;
  done.classList.remove('hidden');
  if (ctx.userId === _currentPlayerId) viewPlayerSave(_currentPlayerId, _currentPlayerName);
}

/** Export : téléchargement via fetch (la session admin exige l'en-tête X-Dig-Admin, un lien simple ne suffit pas). */
async function trExport(format) {
  const userId = _currentPlayerId;
  if (!userId) return;
  const q = format === 'csv' ? 'format=csv' : 'format=json&full=1';
  let res;
  try { res = await fetch(`/api/admin/players/${userId}/test-runs/export?${q}`, { headers: { 'X-Dig-Admin': '1' }, credentials: 'same-origin', cache: 'no-store' }); }
  catch { admShowError(document.getElementById('tr-err'), 'Export impossible : serveur injoignable.'); return; }
  if (!res.ok) { admShowError(document.getElementById('tr-err'), `Export refusé (${res.status}).`); return; }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `essais-${userId}.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

admDialogSetup('tr-dialog');
document.getElementById('tr-confirm-input').addEventListener('input', trCheck);
document.getElementById('tr-reason').addEventListener('input', trCheck);
document.getElementById('btn-tr-confirm').addEventListener('click', trConfirm);
document.getElementById('btn-tr-reset').addEventListener('click', e => trOpenReset(e.currentTarget));
document.getElementById('btn-tr-export-csv').addEventListener('click', () => trExport('csv'));
document.getElementById('btn-tr-export-json').addEventListener('click', () => trExport('json'));

// ── Anti-bot (#25) ───────────────────────────────────────────────────────────

const SEC_LEVELS = ['0 — rien', '1 — journaliser', '2 — limiter', '3 — défi', '4 — suspension'];

const SEC_GROUP_LABELS = { player: 'Anomalies joueur', admin: 'Audit admin', system: 'Système', other: 'Autres' };

async function loadSecurity() {
  const filter = document.getElementById('sec-filter-type').value;
  const days   = document.getElementById('sec-filter-days').value;
  const params = new URLSearchParams({ limit: '100' });
  if (filter.startsWith('group:')) params.set('group', filter.slice(6));
  else if (filter) params.set('type', filter);
  if (days) params.set('days', days);
  const [sum, ev] = await Promise.all([
    api('GET', '/api/admin/security/summary'),
    api('GET', '/api/admin/security/events?' + params),
  ]);

  const status = document.getElementById('sec-status');
  status.innerHTML = '';
  if (sum.ok) {
    const s = sum.data;
    const g = s.eventsByGroup ?? {};
    const per = k => { const v = g[k] ?? { d1: 0, d7: 0, d30: 0 }; return `${v.d1} (24 h) · ${v.d7} (7 j) · ${v.d30} (30 j)`; };
    const lines = [
      `Mode observation : ${s.antibotMode}${s.envOverride ? ' (forcé par ANTIBOT=off)' : ''} — sanctions : ${s.sanctionsApplied ? 'appliquées' : 'désactivées (aucun niveau appliqué)'}`,
      `Budget de dégâts : ${s.damageBudgetMode}`,
      `Saison : ${s.seasonId ?? '—'} — ${s.trackedAccounts} compte(s) suivi(s), ${s.checkedLast24h} contrôlé(s) dans les 24 dernières heures`,
      `Comptes par niveau de risque (non appliqués) : ${s.levels.map((n, i) => `N${i} ${n}`).join(' · ')}`,
      `Anomalies joueur : ${per('player')}`,
      `Audit admin : ${per('admin')} — système : ${per('system')}`,
      `Calcul par sauvegarde : ${s.timings.avgMs.toFixed(2)} ms en moyenne, ${s.timings.maxMs.toFixed(2)} ms max (${s.timings.saves} sauvegardes depuis ${s.timings.since.slice(0, 16).replace('T', ' ')})`,
    ];
    for (const l of lines) {
      const p = document.createElement('p');
      p.textContent = l;
      status.appendChild(p);
    }

    const checks = document.getElementById('sec-checks-body');
    checks.innerHTML = '';
    if (!s.checks.length) checks.innerHTML = '<tr><td colspan="8" class="muted">Aucun joueur contrôlé dans la saison active.</td></tr>';
    for (const c of s.checks) {
      const tr = document.createElement('tr');
      secPlayerCell(tr, c.username, c.userId);
      addCell(tr, c.lastCheck.replace('T', ' ').substring(0, 19)).className = 'muted';
      addCell(tr, `${c.acceptedDepth} m`);
      addCell(tr, c.depthGap ? `${c.depthGap} m` : '0');
      addCell(tr, c.budgetGap ? `${c.budgetGap} m` : '0');
      addCell(tr, c.clicks == null ? '—' : `${c.clicks} / ${c.acceptedBlocks}`);
      addCell(tr, c.score);
      addCell(tr, c.score > 0 ? `indices (N${c.level}, non appliqué)` : c.depthGap > 0 ? 'en attente de crédit' : 'normal');
      checks.appendChild(tr);
    }

    const body = document.getElementById('sec-accounts-body');
    body.innerHTML = '';
    if (!s.accounts.length) body.innerHTML = '<tr><td colspan="4" class="muted">Aucun compte à risque : aucun indice ni preuve sur la saison (score 0 pour tous).</td></tr>';
    for (const a of s.accounts) {
      const tr = document.createElement('tr');
      secPlayerCell(tr, a.username, a.userId);
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

  const groups = (sum.ok && sum.data.eventGroups) || {};
  const tbody = document.getElementById('sec-events-body');
  tbody.innerHTML = '';
  if (!ev.ok) { tbody.innerHTML = '<tr><td colspan="5" class="error">Erreur lors du chargement.</td></tr>'; return; }
  const sel     = document.getElementById('sec-filter-type');
  const label   = filter ? sel.options[sel.selectedIndex].textContent : 'tous types';
  const period  = days ? document.getElementById('sec-filter-days').selectedOptions[0].textContent.toLowerCase() : 'tout l\'historique';
  document.getElementById('sec-events-total').textContent =
    `${ev.data.total} événement(s) — filtre : ${label}, ${period} — ${ev.data.events.length} affiché(s)`;
  if (!ev.data.events.length) {
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'muted';
    td.textContent = filter.startsWith('group:admin') || filter.startsWith('admin')
      ? 'Aucune action administrative sur cette période.'
      : `Aucune anomalie détectée dans cette catégorie sur cette période (${label}, ${period}). Les sauvegardes normales ne créent pas d'entrée.`;
    const tr = document.createElement('tr');
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  for (const e of ev.data.events) {
    const tr = document.createElement('tr');
    addCell(tr, (e.created_at ?? '').substring(0, 19)).className = 'muted';
    const group = Object.entries(groups).find(([, types]) => types.includes(e.type))?.[0];
    addCell(tr, group ? `${e.type} (${SEC_GROUP_LABELS[group]})` : e.type);
    if (e.user_id) secPlayerCell(tr, e.username ?? `user_${e.user_id}`, e.user_id);
    else addCell(tr, group === 'player' ? '' : 'admin / système');
    addCell(tr, e.score_after == null ? '' : `${e.score_before ?? 0} → ${e.score_after}`);
    addCell(tr, e.details ?? '').style.fontSize = '0.75rem';
    tbody.appendChild(tr);
  }
}

admRefreshButton('btn-refresh-sec', loadSecurity, 'Anti-bot');

// ── Fiche joueur anti-bot (#25, demande du 04/11) — lecture seule ────────────

/** Cellule « pseudo + bouton Fiche ». */
function secPlayerCell(tr, username, userId) {
  const td = addCell(tr, username + ' ');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm btn-outline';
  b.textContent = 'Fiche';
  b.dataset.admKey = `sec-fiche-${userId}`;
  b.setAttribute('aria-label', `Fiche anti-bot de ${username}`);
  b.addEventListener('click', () => secOpenPlayer(String(userId), b));
  td.appendChild(b);
  return td;
}

const SEC_SRC = { server: ['serveur', 'Calculé ou mesuré par le serveur'], client: ['déclaré', 'Déclaré par la sauvegarde du navigateur, non vérifié'],
  tele: ['télémétrie', 'Indice envoyé par le navigateur, falsifiable'], derived: ['déduit', 'Calculé ici à partir de valeurs déclarées'] };

function secEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}
function secSrc(kind) {
  const [label, title] = SEC_SRC[kind];
  const sp = secEl('span', `sec-src sec-src--${kind === 'derived' ? 'client' : kind}`, label);
  sp.title = title;
  return sp;
}
function secFmt(v, unit = '') {
  if (v === null || v === undefined || v === '') return 'non disponible';
  return typeof v === 'number' ? v.toLocaleString('fr-BE') + unit : String(v) + unit;
}
const secDate = iso => (iso ? String(iso).replace('T', ' ').substring(0, 19) + ' UTC' : 'non disponible');
/** Liste de [libellé, valeur, source]. */
function secKv(items) {
  const dl = secEl('dl', 'sec-kv');
  for (const [label, value, src] of items) {
    const d = document.createElement('div');
    d.appendChild(secEl('dt', '', label));
    const dd = secEl('dd', '', value);
    if (src) dd.appendChild(secSrc(src));
    d.appendChild(dd);
    dl.appendChild(d);
  }
  return dl;
}
function secTable(headers, rows, empty) {
  const wrap = secEl('div', 'sec-wrap');
  const t = document.createElement('table');
  const tr = document.createElement('tr');
  headers.forEach(h => tr.appendChild(secEl('th', '', h)));
  const thead = document.createElement('thead');
  thead.appendChild(tr);
  t.appendChild(thead);
  const tb = document.createElement('tbody');
  if (!rows.length) {
    const r = document.createElement('tr');
    const td = secEl('td', 'muted', empty ?? 'Aucune donnée.');
    td.colSpan = headers.length;
    r.appendChild(td);
    tb.appendChild(r);
  }
  for (const row of rows) {
    const r = document.createElement('tr');
    row.forEach(v => addCell(r, v));
    tb.appendChild(r);
  }
  t.appendChild(tb);
  wrap.appendChild(t);
  return wrap;
}

let _secPlayer = { q: null, seasonId: null };
/** Sections techniques ouvertes par l'admin (repliées par défaut, conservées entre rafraîchissements). */
const _secOpenSections = new Set();
/** Onglet de la fiche (vue essentielle par défaut), conservé au rafraîchissement et au changement de saison. */
let _secTab = 'essential';

async function secOpenPlayer(q, opener, seasonId = null) {
  const err = document.getElementById('sec-player-err');
  err.classList.add('hidden');
  const params = new URLSearchParams({ q });
  if (seasonId) params.set('seasonId', seasonId);
  const { ok, data } = await api('GET', '/api/admin/security/player?' + params);
  if (!ok) {
    err.textContent = data?.error ?? 'Erreur lors du chargement de la fiche.';
    err.classList.remove('hidden');
    return false;
  }
  _secPlayer = { q: String(data.player.userId), seasonId: data.season?.id ?? null };
  secRenderPlayer(data);
  const dlg = document.getElementById('sec-player-dialog');
  if (!dlg.open) admDialogOpen('sec-player-dialog', opener, dlg.querySelector('[data-close]'));
  return true;
}

function secRenderPlayer(d) {
  document.getElementById('sec-player-title').textContent = `Fiche joueur — ${d.player.username} (#${d.player.userId})`;
  const sel = document.getElementById('sec-player-season');
  sel.innerHTML = '';
  for (const se of d.seasons) {
    const o = secEl('option', '', `Saison ${se.id} — ${se.name} (${se.status})`);
    o.value = se.id;
    if (d.season && se.id === d.season.id) o.selected = true;
    sel.appendChild(o);
  }
  sel.disabled = d.seasons.length < 2;

  const body = document.getElementById('sec-player-body');
  body.innerHTML = '';
  const root = secEl('div', 'sec-fiche');
  const m = d.modes;
  const r = d.ranking;
  const ss = d.save?.seasonStats;
  const alertsTotal = d.events.byType.reduce((a, e) => a + (Number(e.n) || 0), 0);
  const cpsMax = d.samples.rows.reduce((a, x) => (typeof x.serverCps === 'number' && x.serverCps > a ? x.serverCps : a), 0);

  // Recette UX du 05/11 (#76) : deux onglets. « Vue essentielle » répond aux questions courantes
  // sans rien ouvrir ; « Diagnostic avancé » garde TOUTES les métriques (sections repliables).
  const tabs = secEl('div', 'sec-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Vues de la fiche');
  const ess = secEl('div', 'sec-pane');
  const adv = secEl('div', 'sec-pane');
  const panes = { essential: ess, advanced: adv };
  const tabBtns = {};
  const showTab = key => {
    _secTab = key;
    for (const [k, pane] of Object.entries(panes)) {
      pane.hidden = k !== key;
      tabBtns[k].setAttribute('aria-selected', String(k === key));
      tabBtns[k].classList.toggle('is-active', k === key);
    }
  };
  for (const [key, label] of [['essential', 'Vue essentielle'], ['advanced', 'Diagnostic avancé — toutes les métriques']]) {
    const btn = secEl('button', 'btn btn-sm sec-tab', label);
    btn.type = 'button';
    btn.id = `sec-tab-${key}`;
    btn.dataset.secTab = key;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `sec-pane-${key}`);
    btn.addEventListener('click', () => showTab(key));
    tabBtns[key] = btn;
    tabs.appendChild(btn);
    panes[key].id = `sec-pane-${key}`;
    panes[key].setAttribute('role', 'tabpanel');
    panes[key].setAttribute('aria-labelledby', btn.id);
  }
  root.append(tabs, ess, adv);

  // ── Vue essentielle ──
  const exactMode = m.exactHpMode ?? 'shadow';
  const declaredDepth = r?.reportedDepth ?? ss?.maxDepth;
  const acceptedDepth = r?.acceptedDepth ?? d.depth?.acceptedDepth;
  const notRanked = r ? Math.max(0, (r.manualBlocks ?? 0) - (r.validatedManualBlocks ?? 0)) : null;
  ess.appendChild(secEl('p', 'sec-summary-verdict',
    `Risque N${d.risk.level} (score ${d.risk.score}) · ${alertsTotal ? `${alertsTotal} alerte(s) sur la saison` : 'aucune alerte sur la saison'} · aucune sanction appliquée au joueur.`));
  const cards = secEl('div', 'sec-cards');
  const card = (title, value, lines, warn) => {
    const c = secEl('section', `sec-card${warn ? ' sec-card--warn' : ''}`);
    c.appendChild(secEl('h4', 'sec-card-title', title));
    c.appendChild(secEl('p', 'sec-card-value', value));
    for (const [text, src] of lines) {
      const l = secEl('p', 'sec-card-line', text);
      if (src) l.appendChild(secSrc(src));
      c.appendChild(l);
    }
    cards.appendChild(c);
  };
  card('Progression de la saison', `${secFmt(declaredDepth, ' m')} déclarés`, [
    [`Validée (classement) : ${secFmt(acceptedDepth, ' m')}`, 'server'],
    [`Écart déclaré − validé : ${secFmt(d.depth?.depthGap ?? 0, ' m')}`, 'server'],
  ], (d.depth?.depthGap ?? 0) > 0);
  card('PV réels des blocs (#77)', d.depth?.exactDepth == null ? 'non disponible' : `${secFmt(d.depth.exactDepth, ' m')} couverts`, [
    [`Écart à la dernière sauvegarde : ${d.depth?.exactDepth == null ? 'non disponible' : secFmt(d.depth.exactGap ?? 0, ' m')}`, 'server'],
    [`Mode ${exactMode} — ${exactMode === 'enforce' ? 'profondeur classée plafonnée' : exactMode === 'shadow' ? 'observation, aucun joueur freiné' : 'calcul arrêté'}`],
  ], (d.depth?.exactGap ?? 0) > 0);
  card('Classement (👆 blocs manuels)', r ? `${secFmt(r.validatedManualBlocks)} validés` : 'pas encore classé', [
    [`Déclarés : ${secFmt(ss?.manualBlocks ?? r?.manualBlocks)} · non retenus : ${secFmt(notRanked)}`, 'client'],
    [`Coups de pioche manuels : ${secFmt(ss?.manualClicks ?? r?.manualClicks)}`, 'client'],
  ], notRanked > 0);
  card('Risque, alertes, sanctions', `N${d.risk.level} — score ${d.risk.score}`, [
    [`Alertes : ${alertsTotal ? `${alertsTotal} (${d.events.byType.map(e => `${e.type} ×${e.n}`).join(', ')})` : 'aucune'}`, 'server'],
    [`Sanctions : aucune (anti-bot ${m.antibotMode}, applied:false)`],
    [`Coups/s max (horloge serveur) : ${d.samples.rows.length ? secFmt(cpsMax) : 'non disponible'}`, 'derived'],
  ], d.risk.level > 0 || alertsTotal > 0);
  ess.appendChild(cards);

  // Origine des blocs détruits : rien n'est caché, chaque part est chiffrée et expliquée
  const og = d.blockOrigin;
  const orig = secEl('section', 'sec-origin');
  orig.appendChild(secEl('h4', '', 'Blocs détruits : d’où viennent-ils ?'));
  if (og) {
    const parts = [
      ['manual', '👆 Manuels (cette saison)', og.manual],
      ['auto', '🤖 Auto-Dig (cette saison)', og.auto],
      ['susp', '⚠ Coups jugés suspects (cette saison)', og.suspicious],
      ['outside', '📦 Ni manuels ni Auto-Dig (hors saison en cours)', og.outsideSeason],
    ];
    const bar = secEl('div', 'sec-origin-bar');
    bar.setAttribute('aria-hidden', 'true');
    for (const [k, , n] of parts) {
      if (!n) continue;
      const seg = secEl('span', `sec-origin-seg sec-origin-seg--${k}`);
      seg.style.width = `${(n * 100 / (og.total || 1)).toFixed(2)}%`;
      bar.appendChild(seg);
    }
    orig.appendChild(bar);
    const ul = secEl('ul', 'sec-origin-list');
    for (const [k, label, n] of parts) {
      const li = secEl('li', '');
      li.appendChild(secEl('span', `sec-origin-dot sec-origin-seg--${k}`));
      li.appendChild(secEl('span', '', `${label} : `));
      li.appendChild(secEl('strong', '', n == null ? 'non transmis (version du jeu antérieure à #74)' : secFmt(n)));
      ul.appendChild(li);
    }
    const tot = secEl('li', 'sec-origin-total');
    tot.appendChild(secEl('span', '', 'Total de la partie (toutes saisons) : '));
    tot.appendChild(secEl('strong', '', secFmt(og.total)));
    tot.appendChild(secSrc('client'));
    ul.appendChild(tot);
    orig.appendChild(ul);
    orig.appendChild(secEl('p', 'sec-origin-why',
      `Pourquoi « ni l’un ni l’autre » ? Le total (${secFmt(og.total)}) compte toute la partie depuis la création du compte et n’est jamais remis à zéro, alors que les compteurs manuels, Auto-Dig et coups suspects repartent à 0 à chaque saison. Les ${secFmt(og.outsideSeason)} blocs restants sont donc surtout ceux des saisons précédentes. Avant le correctif #74 (05/11), un bloc cassé par un coup jugé suspect n’était compté nulle part : ces blocs-là sont aussi dans ce reste.`));
    if (og.seasonDepthBlocks != null) {
      const diff = og.seasonDepthBlocks - og.season;
      orig.appendChild(secEl('p', `sec-origin-check${Math.abs(diff) > 1 ? ' sec-origin-check--warn' : ''}`,
        `Contrôle de cohérence (déduit) : la profondeur repart à 1 m à chaque saison ; ${secFmt(ss?.maxDepth, ' m')} atteints ≈ ${secFmt(og.seasonDepthBlocks)} blocs cassés cette saison, ${secFmt(og.season)} comptés (manuels + Auto-Dig + suspects). `
        + (Math.abs(diff) <= 1 ? '✓ Tous les blocs de la saison sont attribués.'
          : diff > 0 ? `⚠ ${secFmt(diff)} bloc(s) de la saison non attribué(s) (coups suspects d’avant #74, ou compteur à vérifier dans le diagnostic avancé).`
            : `⚠ ${secFmt(-diff)} bloc(s) compté(s) de plus que la profondeur (retour en arrière ou compteur à vérifier dans le diagnostic avancé).`)));
    }
  } else orig.appendChild(secEl('p', 'muted', 'Non disponible : aucune sauvegarde de cette saison.'));
  ess.appendChild(orig);
  ess.appendChild(secEl('p', 'muted sec-summary-modes',
    `Dernière sauvegarde : ${d.save ? `${secDate(d.save.savedAt)} (révision ${d.save.revision})` : 'aucune'} · anti-bot ${m.antibotMode} (journal seulement) · budget de dégâts ${m.damageBudgetMode}${m.damageBudgetMode === 'enforce' ? ' (plafonne la profondeur classée)' : ''} · PV réels ${exactMode}. Toutes les autres métriques : onglet « Diagnostic avancé ».`));

  const tools = secEl('div', 'sec-acc-tools');
  for (const [label, open] of [['Tout déplier', true], ['Tout replier', false]]) {
    const btn = secEl('button', 'btn btn-sm btn-outline', label);
    btn.type = 'button';
    btn.addEventListener('click', () => adv.querySelectorAll('details.sec-acc').forEach(x => { x.open = open; }));
    tools.appendChild(btn);
  }
  adv.appendChild(tools);
  showTab(_secTab);

  // Sections repliables : leur état ouvert/fermé est conservé au rafraîchissement et au changement de saison.
  let cur = adv;
  const section = (key, title, hint) => {
    const det = secEl('details', 'bk-acc sec-acc');
    det.dataset.sec = key;
    det.open = _secOpenSections.has(key);
    det.addEventListener('toggle', () => { if (det.open) _secOpenSections.add(key); else _secOpenSections.delete(key); });
    const s = document.createElement('summary');
    s.appendChild(secEl('span', 'bk-acc-title', title));
    if (hint) s.appendChild(secEl('span', 'bk-acc-sum', hint));
    det.appendChild(s);
    adv.appendChild(det);
    cur = det;
  };
  const note = t => cur.appendChild(secEl('p', 'muted', t)).style.fontSize = '0.76rem';
  const add = el => cur.appendChild(el);

  section('modes', 'Modes et lecture des valeurs', `anti-bot ${m.antibotMode}, budget ${m.damageBudgetMode}`);
  const banner = secEl('div', 'sec-banner');
  banner.appendChild(secEl('p', '', `Anti-bot : ${m.antibotMode} — sanctions désactivées (applied:false) : les scores et niveaux sont seulement journalisés.`));
  banner.appendChild(secEl('p', '', `Budget de dégâts : ${m.damageBudgetMode}${m.damageBudgetMode === 'enforce' ? ' — plafonne la profondeur CLASSÉE ; ne réduit ni les coups, ni les gains, ni les achats.' : ' — calcul et journal seulement.'}`));
  banner.appendChild(secEl('p', '', '👆 du classement = blocs détruits manuellement et validés par le serveur, pas des coups de pioche.'));
  add(banner);

  section('account', 'Compte et activité', `inscrit le ${secDate(d.player.createdAt)}`);
  add(secKv([
    ['Inscrit le', secDate(d.player.createdAt), 'server'],
    ['Saison', d.season ? `${d.season.id} — ${d.season.name}` : 'aucune'],
    ['Première activité de la saison', secDate(r?.firstSeen), 'server'],
    ['Dernière mise à jour du classement', secDate(r?.lastUpdate), 'server'],
    ['Dernière sauvegarde reçue', d.save ? `${secDate(d.save.savedAt)} (révision ${d.save.revision})` : 'aucune', 'server'],
    ['Dernier contrôle de profondeur', secDate(d.depth?.lastCheck), 'server'],
  ]));

  section('progress', 'Progression de la saison (détail)', 'profondeurs, budget, coups, blocs manuels / Auto-Dig');
  add(secKv([
    ['Profondeur retenue (classement)', secFmt(r?.acceptedDepth ?? d.depth?.acceptedDepth, ' m'), 'server'],
    ['Profondeur déclarée', secFmt(r?.reportedDepth ?? ss?.maxDepth, ' m'), 'client'],
    ['Profondeur couverte par le budget de dégâts', secFmt(d.depth?.budgetDepth, ' m'), 'server'],
    ['Profondeur couverte aux PV réels des blocs (#77)', secFmt(d.depth?.exactDepth, ' m'), 'server'],
    ['Écart PV réels à la dernière sauvegarde', secFmt(d.depth?.exactGap, ' m'), 'server'],
    ['Écart déclaré − retenu', secFmt(d.depth?.depthGap, ' m'), 'server'],
    ['Écart inexpliqué du budget', secFmt(d.depth?.budgetGap, ' m'), 'server'],
    ['Coups de pioche manuels (manualClicks)', secFmt(ss?.manualClicks ?? r?.manualClicks), 'client'],
    ['Blocs manuels déclarés', secFmt(ss?.manualBlocks ?? r?.manualBlocks), 'client'],
    ['Blocs manuels validés (👆 classement)', secFmt(r?.validatedManualBlocks), 'server'],
    ['Blocs Auto-Dig', secFmt(ss?.autoBlocks ?? r?.autoBlocks), 'client'],
    ['Blocs détruits au total (partie)', secFmt(d.save?.blocksDestroyed), 'client'],
    ['Blocs coups jugés suspects (saison, depuis #74)', secFmt(ss?.suspiciousBlocks), 'client'],
    ['Blocs ni manuels ni Auto-Dig (total partie − manuels − Auto-Dig)', secFmt(d.uncountedBlocks), 'derived'],
    ['Clics jugés suspects par le navigateur', secFmt(ss?.suspiciousScore ?? r?.suspiciousClicks), 'client'],
  ]));
  note('« Blocs détruits au total » vaut pour la partie entière (toutes saisons, jamais remis à zéro) ; manuels, Auto-Dig et coups suspects sont comptés par saison. « Ni manuels ni Auto-Dig » regroupe donc les saisons précédentes et, avant le correctif #74, les blocs cassés par un coup jugé suspect. Détail chiffré : onglet « Vue essentielle ».');

  section('save', 'Partie déclarée (dernière sauvegarde)', d.save ? `révision ${d.save.revision}` : 'aucune sauvegarde');
  if (d.save) {
    const sv = d.save;
    const lv = o => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucune';
    add(secKv([
      ['Profondeur de la partie', secFmt(sv.depth, ' m'), 'client'],
      ['Pièces', secFmt(sv.coins), 'client'],
      ['Gemmes', secFmt(sv.gems), 'client'],
      ['Fragments de relique', secFmt(sv.relicFragments), 'client'],
      ['Pioche (niveau / dégâts)', `${secFmt(sv.pickaxeLevel)} / ${secFmt(sv.damage)}`, 'client'],
      ['Améliorations (niveaux)', lv(sv.upgrades), 'client'],
      ['Reliques (niveaux)', lv(sv.relics), 'client'],
      ['Pièces gagnées (cumul)', secFmt(sv.totalCoinsEarned), 'client'],
      ['Améliorations achetées (cumul)', secFmt(sv.totalUpgradesBought), 'client'],
      ['Coffres trouvés', secFmt(sv.chestsFound), 'client'],
    ]));
    note('La sauvegarde est remplacée à chaque envoi : aucun historique des achats n’existe côté serveur. Les sauvegardes de la base (avant déploiement, quotidiennes) contiennent les états antérieurs.');
  } else note('Aucune sauvegarde cloud.');

  section('risk', `Score de risque : ${d.risk.score} — niveau N${d.risk.level} (non appliqué)`, 'décomposition par catégorie');
  add(secTable(['Catégorie', 'Valeur actuelle', 'Plafond', 'Signaux (points)'],
    d.risk.components.map(c => [c.cat, c.value, c.cap, c.signals.join(', ')])));
  note(`Chaque signal ajoute ses points à sa catégorie, plafonnée ; le score est la somme (100 max), divisée par deux toutes les ${d.risk.halfLifeHours} h. Seuils : N1 ≥ 30, N2 ≥ 60, N3 ≥ 80, N4 ≥ 90. Ex. : rafales (4 pts, plafond 15) + CPS très élevé (6 pts, plafond 25) = 40 → N1. Le passage de niveau est journalisé avec applied:false : rien n’est appliqué au joueur.`);

  section('responses', 'Contrôles : observation → action prévue → action effectivement appliquée', `${d.responses.length} contrôles`);
  add(secTable(['Contrôle', 'Mode', 'Observation pour ce joueur', 'Action prévue', 'Action appliquée'],
    d.responses.map(x => [x.control, x.mode, x.observation, x.planned, x.applied])));

  section('alerts', 'Alertes du joueur par type', alertsTotal ? `${alertsTotal} alerte(s), ${d.events.byType.length} type(s)` : 'aucune');
  add(secTable(['Type', 'Nombre', 'Première (UTC)', 'Dernière (UTC)'],
    d.events.byType.map(e => [e.type, e.n, e.first, e.last]), 'Aucune alerte pour ce joueur sur cette saison.'));

  section('telemetry', 'Télémétrie des clics', d.samples.telemetry ? `${secFmt(d.samples.telemetry.clicks)} coups reçus` : 'non disponible');
  const tel = d.samples.telemetry;
  if (tel) {
    const bins = ['<40', '40–60', '60–80', '80–100', '100–150', '150–250', '250–500', '≥500'];
    const total = tel.h.reduce((a, b) => a + b, 0) || 1;
    add(secKv([
      ['Sauvegardes avec télémétrie', secFmt(tel.saves), 'tele'],
      ['Coups reçus en télémétrie', secFmt(tel.clicks), 'tele'],
      ['Événements non fiables (isTrusted = false)', secFmt(tel.untrusted), 'tele'],
      ['Origine souris / tactile / clavier / autre', `${tel.p.m} / ${tel.p.t} / ${tel.p.k} / ${tel.p.o}`, 'tele'],
    ]));
    add(secTable(['Intervalle (ms)', ...bins], [['Coups', ...tel.h.map(v => `${v} (${Math.round(v * 100 / total)} %)`)]]));
  } else note('Histogramme et origine des clics : non disponibles pour cette session (enregistrés seulement depuis la mise en service de la fiche).');
  const b = d.burstFromEvents;
  if (b.batches) note(`Rafales journalisées : ${b.batches} lot(s), ${b.clicks} coups dont ${b.under40ms} intervalles < 40 ms sur ${b.intervals}. « clicks » d'un lot = coups envoyés avec UNE sauvegarde (depuis la précédente réussie), pas des clics par seconde.`);

  section('samples', 'Sauvegardes contrôlées (échantillons agrégés, plus récentes en premier)', `${d.samples.rows.length} échantillon(s)`);
  const rows = d.samples.rows.slice().reverse().slice(0, 60).map(x => [
    secDate(x.at).replace(' UTC', ''), secFmt(x.dtSecs, ' s'), secFmt(x.dClicks), secFmt(x.serverCps),
    `${secFmt(x.dManualBlocks)} / ${secFmt(x.dAutoBlocks)} / ${secFmt(x.dBlocksDestroyed)}`,
    `${secFmt(x.reportedDepth)} / ${secFmt(x.acceptedDepth)} / ${secFmt(x.budgetDepth)} / ${secFmt(x.exactDepth)}`,
    secFmt(x.autodigLevel), x.tel ? `${x.tel.n} (<40 ms : ${x.tel.under40 ?? '—'}, non fiables ${x.tel.u})` : '—', x.acAction ?? '',
  ]);
  add(secTable(['Heure (UTC)', 'Δt serveur', 'Δ coups', 'Coups/s (horloge serveur)', 'Δ blocs manuels / auto / total',
    'Profondeur déclarée / retenue / budget / PV réels', 'Auto-Dig', 'Télémétrie (coups)', 'Anti-autoclic'], rows,
    'Non disponible pour cette session : les échantillons sont enregistrés à chaque sauvegarde depuis la mise en service de la fiche.'));
  note('Δ coups et Δ blocs sont des compteurs déclarés ; Δt est mesuré par le serveur. Coups/s = Δ coups ÷ Δt serveur (fiable pour la durée, pas pour le compteur).');

  section('anticheat', 'Fenêtres anti-autoclic (#10)', `${d.anticheat.recent.length} fenêtre(s)`);
  add(secTable(['Date (UTC)', 'Action', 'Durée (s)', 'Coups', 'Coups/s', 'Part retenue'],
    d.anticheat.recent.map(a => [a.logged_at, a.action, a.secs, a.clicks, a.cps, a.ratio]), 'Aucune fenêtre journalisée.'));

  section('timeline', 'Chronologie des alertes (100 dernières)', `${d.events.recent.length} entrée(s)`);
  add(secTable(['Date (UTC)', 'Type', 'Score', 'Détails'],
    d.events.recent.map(e => [e.created_at, e.type, e.score_after == null ? '' : `${e.score_before ?? 0} → ${e.score_after}`, e.details ?? '']),
    'Aucune alerte.'));

  body.appendChild(root);
}

admDialogSetup('sec-player-dialog', { dirty: () => false });   // lecture seule : rien à perdre (cf. #72)
document.getElementById('sec-player-form').addEventListener('submit', e => {
  e.preventDefault();
  const q = document.getElementById('sec-player-q').value.trim();
  if (q) secOpenPlayer(q, e.submitter);
});
document.getElementById('sec-player-season').addEventListener('change', e => {
  if (_secPlayer.q) secOpenPlayer(_secPlayer.q, null, e.target.value);
});
/** Recharge la fiche ouverte (même joueur, même saison). */
function loadSecPlayer() { return _secPlayer.q ? secOpenPlayer(_secPlayer.q, null, _secPlayer.seasonId) : null; }
admRefreshButton('btn-sec-player-refresh', loadSecPlayer, 'Fiche joueur');
document.getElementById('sec-filter-type').addEventListener('change', loadSecurity);
document.getElementById('sec-filter-days').addEventListener('change', loadSecurity);

// ── Concours au mérite (#30) ──────────────────────────────────────────────────

const CT_STATUS = {
  designated: 'Désigné', contacted: 'Contacté', identity_verified: 'Identité vérifiée',
  sent: 'Lot envoyé', confirmed: 'Confirmé', expired: 'Expiré',
};
const CT_REASON = {
  depth_zero: 'profondeur nulle', no_validated_blocks: 'aucun bloc manuel validé', account_deleted: 'compte supprimé', not_eligible: 'non éligible',
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

let _ctSettings = null;
let _ctDirty = false;
admZone(document.getElementById('ct-form'), { dirty: () => _ctDirty });   // départ de la page protégé (#61)

const ctRisk = v => (v === null || v === undefined ? 'aucune exclusion' : `≤ N${v}`);
const ctWhen = v => (v ? `${v.slice(0, 16)} UTC` : null);

/** Résumés : synthèse toujours visible et en-têtes des accordéons de la fiche. */
function ctRenderSummary(s) {
  const re = s.realEligibility || {};
  const prize = `${s.prize.label || '—'} ${(s.prize.valueCents / 100).toFixed(2)} ${s.prize.currency}${s.prize.provider ? ` (${s.prize.provider})` : ''}`;
  const calendar = s.startsAt || s.endsAt
    ? `${ctWhen(s.startsAt) || 'sans début'} → ${ctWhen(s.endsAt) || 'sans fin'}` : 'sans limite';
  const real = s.realPrizesUnlocked ? '⚠ déverrouillés' : '🔒 verrouillés';
  const facts = [
    ['État', s.enabled ? '✅ actif' : '⏸ inactif'],
    ['Lot', prize],
    ['Lots par saison', String(s.lotsPerSeason)],
    ['Profondeur minimale', `${s.minDepth} m`],
    ['Risque anti-bot', ctRisk(s.maxRiskLevel)],
    ['Délai entre deux gains', s.cooldownSeasons ? `${s.cooldownSeasons} saison(s)` : 'aucun'],
    ['Délai de remise', `${s.claimDays} jours`],
    ['Calendrier', calendar],
    ['Cadeaux réels', `${real} — stock ${s.prize.stock}`],
  ];
  const dl = document.getElementById('ct-summary');
  dl.textContent = '';
  for (const [k, v] of facts) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    div.append(dt, dd);
    dl.appendChild(div);
  }
  document.getElementById('ct-acc-main-sum').textContent =
    `${s.enabled ? 'actif' : 'inactif'} · ${prize} · ${s.lotsPerSeason} lot(s)/saison`;
  document.getElementById('ct-acc-rules-sum').textContent =
    `≥ ${s.minDepth} m · risque ${ctRisk(s.maxRiskLevel)} · ${s.cooldownSeasons ? `${s.cooldownSeasons} saison(s) entre gains` : 'aucun délai entre gains'} · remise ${s.claimDays} j · ${calendar}`;
  document.getElementById('ct-acc-real-sum').textContent =
    `${real} · stock ${s.prize.stock}${(re.countries || []).length ? ` · ${re.countries.join(', ')}` : ''}${re.minAge ? ` · ${re.minAge} ans min.` : ''}`;
}

/** Remplit la fiche avec les réglages enregistrés. */
function ctFillForm(s) {
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
}

function ctSetDirty(v) {
  _ctDirty = v;
  document.getElementById('ct-dirty').classList.toggle('hidden', !v);
}

/** Ouvre ou referme la fiche ; la synthèse reste visible au-dessus. */
function ctShowForm(open) {
  document.getElementById('ct-form').classList.toggle('hidden', !open);
  document.getElementById('btn-ct-edit').classList.toggle('hidden', open);
  if (open) {
    document.getElementById('ct-acc-main').open = true;
    document.getElementById('ct-acc-rules').open = false;
    document.getElementById('ct-acc-real').open = false;
  }
}

async function ctCancelEdit() {
  if (_ctDirty && !await admConfirmDiscard({ text: 'Les réglages du concours contiennent des saisies non enregistrées.', keep: 'Enregistrer', effect: 'referme la fiche et revient aux réglages enregistrés.' })) return;
  if (_ctSettings) ctFillForm(_ctSettings);
  ctSetDirty(false);
  ctShowForm(false);
  document.getElementById('ct-settings-msg').className = 'hidden';
}

async function loadContest() {
  const { ok, data } = await api('GET', '/api/admin/contest');
  if (!ok) { ctMessage('ct-settings-msg', data.error || 'Erreur lors du chargement.', false); return; }
  const s = data.settings;
  _ctSettings = s;

  const lock = document.getElementById('ct-lock');
  lock.className = `contest-banner contest-banner--${s.realPrizesUnlocked ? 'open' : 'locked'}`;
  lock.textContent = s.realPrizesUnlocked
    ? '⚠ Cadeaux réels DÉVERROUILLÉS sur ce serveur (CONTEST_REAL_PRIZES=on).'
    : `🔒 Simulation uniquement : cadeaux réels verrouillés. Concours ${s.enabled ? 'actif' : 'inactif'}.`;

  ctRenderSummary(s);
  // Un rafraîchissement n'écrase pas une saisie en cours dans la fiche.
  if (!_ctDirty) ctFillForm(s);
  document.querySelector('#ct-mode option[value="real"]').textContent = s.realPrizesUnlocked ? 'Réel' : 'Réel (verrouillé)';

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
  if (!ok) {
    // Refus du serveur : toutes les sections dépliées pour retrouver le champ en cause.
    for (const d of document.querySelectorAll('#ct-form details')) d.open = true;
    return;
  }
  ctSetDirty(false);
  ctShowForm(false);
  loadContest();
}

/** Carte de synthèse de l'aperçu : petit libellé, valeur lisible, détail facultatif. */
function ctPvCard(label, value, detail, tone) {
  const c = document.createElement('div');
  c.className = `ct-pv-card${tone ? ` ct-pv-card--${tone}` : ''}`;
  c.append(Object.assign(document.createElement('span'), { className: 'ct-pv-label', textContent: label }),
    Object.assign(document.createElement('strong'), { className: 'ct-pv-value', textContent: value }));
  if (detail) c.appendChild(Object.assign(document.createElement('span'), { className: 'ct-pv-detail', textContent: detail }));
  return c;
}

/** Cellule libellée : sur téléphone, le tableau devient une liste et chaque valeur garde son libellé. */
function ctPvCell(tr, label, value) {
  const td = addCell(tr, value);
  td.dataset.label = label;
  return td;
}

const ctPlural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

async function loadContestPreview() {
  const seasonId = document.getElementById('ct-season').value;
  const mode = document.getElementById('ct-mode').value;
  const cards = document.getElementById('ct-pv-cards');
  const blockersEl = document.getElementById('ct-pv-blockers');
  const tech = document.getElementById('ct-pv-tech');
  const tbody = document.getElementById('ct-preview-body');
  const btn = document.getElementById('btn-ct-attribute');
  btn.disabled = true;
  _ctPreview = null;
  cards.textContent = '';
  blockersEl.textContent = '';
  tech.textContent = '';
  if (!seasonId) { tbody.innerHTML = '<tr><td colspan="8" class="muted">Aucune saison.</td></tr>'; return; }
  const { ok, data } = await api('GET', `/api/admin/contest/seasons/${encodeURIComponent(seasonId)}/preview?mode=${encodeURIComponent(mode)}`);
  tbody.innerHTML = '';
  if (!ok) { tbody.innerHTML = '<tr><td colspan="8" class="error">Erreur lors du chargement.</td></tr>'; return; }
  _ctPreview = data;
  const real = data.mode === 'real';
  const who = x => x.username ?? `#${x.userId}`;

  // 1. Synthèse humaine en cartes (dates de Bruxelles) ; le technique va dans « Preuve et détails ».
  const frozen = data.source === 'snapshot';
  const winners = data.participants.filter(x => x.lotNo);
  const recorded = data.winners?.length ?? 0;
  cards.append(
    ctPvCard('Saison', frozen ? 'Saison figée' : 'Saison non figée',
      `${data.season.name} · ${admBrussels(data.season.startAt)} → ${admBrussels(data.season.endAt)}`, frozen ? 'ok' : 'warn'),
    ctPvCard('Participants', `${ctPlural(data.counts.participants, 'participant', 'participants')} · ${ctPlural(data.counts.eligible, 'éligible', 'éligibles')}`,
      `profondeur min. ${data.criteria.minDepth} m · risque ${ctRisk(data.criteria.maxRiskLevel)}`),
    ctPvCard(winners.length > 1 ? 'Bénéficiaires potentiels' : 'Bénéficiaire potentiel',
      winners.length ? winners.map(who).join(', ') : 'aucun', 'selon cet aperçu, rien n\'est attribué', winners.length ? 'win' : ''),
    ctPvCard(real ? 'Lots réels' : 'Lots simulables', real ? ctPlural(data.counts.lots, 'lot réel', 'lots réels') : ctPlural(data.counts.lots, 'lot simulable', 'lots simulables'),
      `${ctPlural(data.criteria.lotsPerSeason, 'prévu', 'prévus')} par saison${recorded ? ` · ${ctPlural(recorded, 'déjà enregistré', 'déjà enregistrés')}` : ''}`),
    ctPvCard('Source du classement', frozen ? 'Classement figé' : 'Classement vivant',
      frozen ? (data.blockers.includes('snapshot_verification_failed') ? 'empreinte NON vérifiée' : 'empreinte vérifiée') : 'indicatif, peut encore changer',
      frozen && !data.blockers.includes('snapshot_verification_failed') ? 'ok' : 'warn'),
  );
  for (const b of data.blockers) {
    blockersEl.appendChild(Object.assign(document.createElement('p'), { className: 'ct-pv-blocker', textContent: `⛔ ${CT_BLOCKER[b] || b}` }));
  }

  // 2. Preuve et détails techniques (repliés par défaut).
  const techRows = [
    ['Période (UTC)', `${data.season.startAt} → ${data.season.endAt}`],
    ['Source', frozen ? 'classement figé (#29)' : 'classement vivant'],
    ['Empreinte SHA-256 du classement figé', data.snapshot ? data.snapshot.hash : 'pas encore de classement figé'],
    ['Figé le (UTC)', data.snapshot ? data.snapshot.createdAt : '—'],
    ['Critères appliqués', `profondeur ≥ ${data.criteria.minDepth} m · risque ${ctRisk(data.criteria.maxRiskLevel)} · ${data.criteria.cooldownSeasons ? `${data.criteria.cooldownSeasons} saison(s) sans nouveau gain` : 'aucun délai entre gains'}`],
    ['Identifiant de saison', String(data.season.id)],
  ];
  for (const [k, v] of techRows) {
    const d = document.createElement('div');
    d.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
    tech.appendChild(d);
  }

  // 3. Tableau : ligne du bénéficiaire potentiel mise en valeur ; exclusion protégée par une fiche de confirmation.
  if (!data.participants.length) tbody.innerHTML = '<tr><td colspan="8" class="muted">Aucun participant.</td></tr>';
  for (const x of data.participants) {
    const tr = document.createElement('tr');
    if (x.lotNo) tr.className = 'ct-pv-win';
    else if (x.reason) tr.className = 'ct-pv-out';
    ctPvCell(tr, 'Place', x.rank ? `${x.rank}${x.rank === 1 ? 'er' : 'e'}` : `${x.position}`).title = `Position ${x.position} · rang ${x.rank ?? '—'}`;
    ctPvCell(tr, 'Joueur', who(x)).classList.add('ct-pv-player');
    ctPvCell(tr, 'Profondeur max.', `${x.maxDepth} m`);
    ctPvCell(tr, 'Blocs minés', x.manualBlocks);
    ctPvCell(tr, 'Risque anti-bot', `N${x.riskLevel}`);
    const why = x.reason ? (CT_REASON[x.reason] || x.reason) : 'éligible';
    ctPvCell(tr, 'Concours', x.exclusion ? `${why} : ${x.exclusion}` : why);
    ctPvCell(tr, 'Lot (aperçu)', x.lotNo ? `🎁 lot ${x.lotNo} — potentiel` : '—');
    const td = ctPvCell(tr, 'Action', '');
    if (frozen) {
      const b = document.createElement('button');
      b.className = 'btn-ghost btn-sm';
      if (x.reason === 'admin_excluded') {
        b.textContent = 'Réintégrer';
        b.addEventListener('click', () => contestUnexclude(x, b));
      } else {
        b.textContent = 'Exclure…';
        b.title = 'Retirer ce joueur du concours pour cette saison (confirmation et motif demandés)';
        b.addEventListener('click', () => contestExclude(x, b));
      }
      td.appendChild(b);
    }
    tbody.appendChild(tr);
  }

  // 4. Action persistante, séparée de l'aperçu.
  btn.disabled = !data.attributable;
  btn.className = real ? 'btn btn-danger' : 'btn';
  btn.textContent = real ? 'Attribuer les lots RÉELS' : 'Enregistrer une attribution simulée';
  document.getElementById('ct-commit-text').textContent = real
    ? 'Attribue les lots RÉELS : stock consommé, gagnant à contacter. Une seule fois par saison, ligne non supprimable.'
    : 'Inscrit le résultat de cet aperçu dans l\'historique des gagnants, en simulation : aucun cadeau, message, point ni stock. Une seule fois par saison, ligne non supprimable.';
}

function contestExclude(x, opener) {
  const dlg = document.getElementById('ct-exclude-dialog');
  const reason = document.getElementById('ct-exclude-reason');
  dlg._ctTarget = x;
  document.getElementById('ct-exclude-text').textContent =
    `Exclure ${x.username ?? '#' + x.userId} du concours de la saison ${_ctPreview.season.name} ?`;
  reason.value = '';
  document.getElementById('btn-ct-exclude-yes').disabled = true;
  admShowError(document.getElementById('ct-exclude-msg'), '');
  admDialogOpen('ct-exclude-dialog', opener, reason);
}

async function contestExcludeConfirm() {
  const dlg = document.getElementById('ct-exclude-dialog');
  const x = dlg._ctTarget;
  const reason = document.getElementById('ct-exclude-reason').value.trim();
  if (!x || !_ctPreview || reason.length < 3) return;
  const yes = document.getElementById('btn-ct-exclude-yes');
  yes.disabled = true;
  const { ok, data } = await api('POST', `/api/admin/contest/seasons/${_ctPreview.season.id}/exclusions`, { userId: x.userId, reason });
  if (!ok) { admShowError(document.getElementById('ct-exclude-msg'), data.error || 'Erreur.'); yes.disabled = false; return; }
  dlg._ctTarget = null;
  dlg.close();
  loadContestPreview();
  loadContestAudit();
}

async function contestUnexclude(x) {
  const name = x.username ?? '#' + x.userId;
  if (!await admConfirm({
    title: 'Réintégrer au concours',
    text: `Réintégrer ${name} au concours de la saison ${_ctPreview.season.name} ?`,
    impact: ['Le joueur redevient éligible pour cette saison (selon les critères).', 'Retrait inscrit au journal ; une attribution déjà enregistrée n\'est pas modifiée.'],
    ok: 'Réintégrer',
  })) return;
  const { ok, data } = await api('DELETE', `/api/admin/contest/seasons/${_ctPreview.season.id}/exclusions/${x.userId}`);
  if (!ok) { admAlert(data.error || 'Erreur.'); return; }
  loadContestPreview();
  loadContestAudit();
}

async function contestAttribute() {
  if (!_ctPreview || !_ctPreview.attributable) return;
  const p = _ctPreview;
  const real = p.mode === 'real';
  const names = p.participants.filter(x => x.lotNo).map(x => x.username ?? `#${x.userId}`).join(', ');
  if (!await admConfirm({
    title: real ? 'Attribuer les lots RÉELS' : 'Enregistrer une attribution simulée',
    text: `${p.season.name} : ${p.counts.lots} lot(s) ${real ? 'RÉEL(S)' : 'simulé(s)'} pour ${names}.`,
    impact: real
      ? ['Stock consommé, gagnant(s) à contacter pour la remise.', 'Définitif : une saison ne peut pas être attribuée deux fois, ligne non supprimable.']
      : ['Écrit une ligne « simulation » dans l\'historique des gagnants et le journal.',
         'Aucun cadeau réel, aucun message au joueur, aucun point, aucun stock consommé.',
         'Définitif : une seule fois par saison, ligne non supprimable (seulement passable à « expiré »).'],
    ok: real ? 'Attribuer les lots réels' : 'Enregistrer la simulation',
    danger: true,
  })) return;
  const { ok, data } = await api('POST', `/api/admin/contest/seasons/${p.season.id}/attribute`, { mode: p.mode });
  ctMessage('ct-attr-msg', ok ? `${data.winners.length} lot(s) ${real ? 'attribué(s)' : 'simulé(s) enregistré(s)'}.` : (data.error || 'Erreur.'), ok);
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
  const note = await admPrompt({ title: `${w.username ?? '#' + w.userId} : ${CT_STATUS[w.status]} → ${CT_STATUS[to]}`,
    label: 'Note facultative (jamais d\'e-mail ni de code cadeau)', ok: 'Changer le statut' });
  if (note === null) return;
  const { ok, data } = await api('POST', `/api/admin/contest/winners/${w.id}/status`, { status: to, note });
  if (!ok) { admAlert(data.error || 'Erreur.'); return; }
  loadContestWinners();
  loadContestAudit();
}

async function contestContact(w) {
  if (!await admAsk(`Afficher l'adresse e-mail de ${w.username ?? '#' + w.userId} ? La consultation est journalisée.`)) return;
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

admRefreshButton('btn-refresh-contest', loadContest, 'Concours');
document.getElementById('btn-save-contest').addEventListener('click', saveContestSettings);
document.getElementById('btn-ct-edit').addEventListener('click', () => ctShowForm(true));
document.getElementById('btn-ct-cancel').addEventListener('click', ctCancelEdit);
document.getElementById('ct-form').addEventListener('input', () => ctSetDirty(true));
document.getElementById('btn-ct-preview').addEventListener('click', loadContestPreview);
document.getElementById('ct-season').addEventListener('change', loadContestPreview);
document.getElementById('ct-mode').addEventListener('change', loadContestPreview);
document.getElementById('btn-ct-attribute').addEventListener('click', contestAttribute);
admDialogSetup('ct-exclude-dialog');
document.getElementById('btn-ct-exclude-no').addEventListener('click', () => document.getElementById('ct-exclude-dialog').close());
document.getElementById('btn-ct-exclude-yes').addEventListener('click', contestExcludeConfirm);
document.getElementById('ct-exclude-reason').addEventListener('input', e => {
  document.getElementById('btn-ct-exclude-yes').disabled = e.target.value.trim().length < 3;
});
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

// Rafraîchir relit les portefeuilles et attributions ; un barème en cours de saisie est conservé (#60)
admRefreshButton('btn-refresh-points', loadPoints, 'Points');
document.getElementById('pt-scale').addEventListener('input', e => { e.target.dataset.dirty = '1'; });
admZone(document.getElementById('pt-scale'), { dirty: () => !!document.getElementById('pt-scale').dataset.dirty });   // départ de la page (#61)

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
  if (!await admAsk('Enregistrer cette version du barème ? Elle s\'appliquera aux prochaines clôtures.')) return;
  const note = document.getElementById('pt-scale-note').value;
  const { ok, data } = await api('PUT', '/api/admin/points/scale', { scale, note });
  ptMessage('pt-scale-msg', ok ? `Barème v${data.scaleVersion} enregistré.` : (data.error || 'Erreur.'), ok);
  if (ok) { delete document.getElementById('pt-scale').dataset.dirty; loadPoints(); }
});

async function setPointsMode(mode) {
  const msg = mode === 'live'
    ? 'Activer le crédit réel des points ? Le barème en vigueur sera appliqué aux saisons qui se terminent à partir de maintenant.'
    : 'Revenir en simulation ? Les points déjà crédités restent acquis.';
  if (!await admAsk(msg)) return;
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
  if (!await admAsk(`Ajuster de ${amount} point(s) le joueur #${userId} ?`)) return;
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
  document.getElementById('sh-adv-box').open = false;
  document.getElementById('sh-real-box').open = (item?.kind === 'real');
  shEmojiToggle(false);
  shLang('fr');
  shRefresh();
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

// Une langue à la fois (onglets FR/EN/NL/ES) ; ● titre saisi · ○ à traduire. Le français reste visible en rappel.
let _shLang = 'fr';
function shLang(l, focus = false) {
  _shLang = l;
  for (const b of document.querySelectorAll('#sh-langs .co-lang-btn')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
  for (const d of document.querySelectorAll('#sh-dialog .sh-lang-fields')) d.classList.toggle('hidden', d.dataset.lang !== l);
  if (focus) document.querySelector(`#sh-langs .co-lang-btn[data-lang="${l}"]`).focus();
  shRefresh();
}
document.querySelectorAll('#sh-langs .co-lang-btn').forEach((b, k, all) => {
  b.addEventListener('click', () => shLang(b.dataset.lang));
  b.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    shLang(all[(k + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].dataset.lang, true);
  });
});

const shPts = n => `${Number(n).toLocaleString('fr-BE')} ${Math.abs(Number(n)) < 2 ? 'pt' : 'pts'}`;

/** Sorte, résumés des sections repliées, états des langues, aperçu joueur et indicateur de modifications. */
function shRefresh() {
  const it = shReadForm();
  const real = it.kind === 'real';
  // Champs du cadeau réel : affichés seulement pour un article réel ; leurs valeurs restent intactes sinon.
  const realBox = document.getElementById('sh-real-box');
  realBox.classList.toggle('hidden', !real);
  const realSet = it.face_value_cents !== null || it.currency || it.territories || it.min_age !== null;
  document.getElementById('sh-real-kept').classList.toggle('hidden', real || !realSet);
  document.getElementById('sh-real-sum').textContent = `— ${[
    it.face_value_cents !== null ? `${(it.face_value_cents / 100).toFixed(2)} ${it.currency || '?'}` : 'valeur non précisée',
    it.territories ? `pays ${it.territories}` : '', it.min_age !== null ? `dès ${it.min_age} ans` : ''].filter(Boolean).join(' · ')}`;
  document.getElementById('sh-adv-sum').textContent = `— ${[
    it.valid_from || it.valid_until ? `du ${it.valid_from || '…'} au ${it.valid_until || '…'}` : 'toujours valable',
    `ordre ${it.sort ?? 0}`, it.image_url ? 'image personnalisée' : ''].filter(Boolean).join(' · ')}`;
  for (const b of document.querySelectorAll('#sh-langs .co-lang-btn')) {
    b.querySelector('.sh-lang-state').textContent = it.texts[b.dataset.lang].title.trim() ? '●' : '○';
  }
  const ref = document.getElementById('sh-fr-ref');
  ref.classList.toggle('hidden', _shLang === 'fr' || !it.texts.fr.title.trim());
  document.getElementById('sh-fr-ref-text').textContent = [it.texts.fr.title, it.texts.fr.description].filter(s => s.trim()).join(' — ');
  document.getElementById('sh-icon-show').textContent = it.icon || '🎁';
  for (const b of document.querySelectorAll('#sh-emoji-grid button')) b.setAttribute('aria-pressed', String(b.textContent === it.icon));
  shPreview(it);
  document.getElementById('sh-dirty').classList.toggle('hidden', !shDirty());
}

/** Aperçu de la carte vue par un joueur (langue éditée, repli sur le français comme dans le jeu). */
function shPreview(it) {
  const tx = f => it.texts[_shLang][f].trim() || it.texts.fr[f].trim();
  const li = document.getElementById('sh-preview');
  li.textContent = '';
  document.getElementById('sh-prev-lang').textContent = `(${_shLang.toUpperCase()})`;
  if (it.image_url) li.appendChild(aiEl('img', { class: 'sh-prev-icon', src: it.image_url, alt: '' }));
  else li.appendChild(aiEl('span', { class: 'sh-prev-icon', 'aria-hidden': 'true' }, it.icon || '🎁'));
  li.appendChild(aiEl('div', { class: 'sh-prev-title' }, tx('title') || '(titre français manquant)'));
  const body = aiEl('div', {});
  if (tx('description')) body.appendChild(aiEl('div', { class: 'sh-prev-desc' }, tx('description')));
  const facts = [it.stock_remaining !== null ? `Stock : ${it.stock_remaining}` : '', it.max_per_user ? `Max. ${it.max_per_user} par joueur` : '',
    it.valid_until ? `Jusqu'au ${it.valid_until.slice(0, 10)}` : ''].filter(Boolean).join(' · ');
  if (facts) body.appendChild(aiEl('div', { class: 'sh-prev-facts' }, facts));
  li.appendChild(body);
  // Recette #34-L : un article incomplet ou masqué ne montre pas « Échanger » (le joueur ne pourrait pas l'échanger).
  const missing = [!(it.cost >= 1) ? 'prix' : '', !it.texts.fr.title.trim() ? 'titre français' : ''].filter(Boolean);
  const label = missing.length ? 'À compléter' : !it.visible ? 'Masqué' : it.kind === 'real' ? 'Bientôt'
    : it.unavailable ? 'Indisponible' : it.stock_remaining === 0 ? 'Épuisé' : 'Échanger';
  const buy = aiEl('div', { class: 'sh-prev-buy' });
  buy.appendChild(aiEl('span', { class: `sh-prev-cost${it.cost >= 1 ? '' : ' unset'}` }, it.cost >= 1 ? shPts(it.cost) : 'Prix à définir'));
  buy.appendChild(aiEl('span', { class: `sh-prev-btn${label === 'Échanger' ? '' : ' off'}` }, label));
  li.appendChild(buy);
  document.getElementById('sh-prev-state').textContent = [
    missing.length ? `✏️ À compléter : ${missing.join(', ')}` : '',
    it.visible ? '✅ Visible dans Saison → Boutique de cadeaux' : '🙈 Masqué : les joueurs ne le voient pas',
    it.kind === 'real' ? 'cadeau réel : non échangeable tant que #27 est verrouillé' : '',
    'Un joueur sans assez de points voit « Il manque … ».'].filter(Boolean).join(' · ');
}

// Sélecteur d'emoji (#34-F) : catégories, recherche par mot-clé, choix au clic ; saisie ou collage libre toujours possible.
const SH_EMOJIS = {
  'Cadeaux': [['🎁', 'cadeau paquet'], ['🎀', 'ruban noeud'], ['🎉', 'fête confettis'], ['🎊', 'fête boule'], ['🎈', 'ballon'], ['🛍️', 'sac boutique achat'], ['🎫', 'ticket billet'], ['🎟️', 'ticket entrée'], ['💌', 'lettre carte'], ['📦', 'colis boîte coffre']],
  'Honneur': [['🏆', 'trophée coupe victoire'], ['🥇', 'médaille or premier'], ['🥈', 'médaille argent deuxième'], ['🥉', 'médaille bronze troisième'], ['🏅', 'médaille sport'], ['🎖️', 'décoration militaire médaille'], ['👑', 'couronne roi reine'], ['📜', 'parchemin titre diplôme'], ['🔰', 'débutant badge'], ['🎗️', 'ruban mémoire']],
  'Trésor': [['💎', 'diamant gemme'], ['💍', 'bague anneau'], ['🪙', 'pièce monnaie'], ['💰', 'sac argent trésor'], ['🗝️', 'clé ancienne'], ['🔑', 'clé'], ['⚱️', 'urne relique'], ['🏺', 'amphore relique'], ['🔮', 'boule cristal magie'], ['🧿', 'amulette talisman']],
  'Mine': [['⛏️', 'pioche mine'], ['⚒️', 'marteau pioche'], ['🪓', 'hache'], ['🛠️', 'outils'], ['🔦', 'lampe torche'], ['🪨', 'pierre roche'], ['🧱', 'brique bloc'], ['🪵', 'bois'], ['🧨', 'dynamite explosif'], ['🗺️', 'carte trésor']],
  'Étoiles': [['⭐', 'étoile'], ['🌟', 'étoile brillante'], ['✨', 'étincelles brillant'], ['💫', 'vertige étoile'], ['🔥', 'feu flamme'], ['⚡', 'éclair énergie'], ['❤️', 'coeur rouge'], ['💜', 'coeur violet'], ['💙', 'coeur bleu'], ['💚', 'coeur vert']],
  'Objets': [['🎮', 'manette jeu vidéo'], ['🕹️', 'joystick jeu'], ['🎲', 'dé jeu'], ['🧩', 'puzzle'], ['🎨', 'palette art peinture'], ['🖼️', 'tableau cadre image'], ['👕', 't-shirt vêtement'], ['🧢', 'casquette'], ['🎧', 'casque audio'], ['📱', 'téléphone']],
};
const shNorm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let _shEmojiCat = 'Cadeaux';
function shEmojiRender() {
  const q = shNorm(document.getElementById('sh-emoji-search').value.trim());
  const cats = document.getElementById('sh-emoji-cats');
  cats.textContent = '';
  for (const c of Object.keys(SH_EMOJIS)) {
    const b = aiEl('button', { type: 'button', 'aria-pressed': String(!q && c === _shEmojiCat) }, c);
    b.addEventListener('click', () => { _shEmojiCat = c; document.getElementById('sh-emoji-search').value = ''; shEmojiRender(); });
    cats.appendChild(b);
  }
  const list = q ? Object.values(SH_EMOJIS).flat().filter(([, k]) => shNorm(k).includes(q)) : SH_EMOJIS[_shEmojiCat];
  const grid = document.getElementById('sh-emoji-grid');
  grid.textContent = '';
  if (!list.length) grid.appendChild(aiEl('p', { class: 'muted sh-help' }, 'Aucun emoji pour cette recherche : collez-en un dans le champ.'));
  const cur = document.getElementById('sh-icon').value.trim();
  for (const [e, k] of list) {
    const b = aiEl('button', { type: 'button', title: k, 'aria-label': `${e} ${k}`, 'aria-pressed': String(e === cur) }, e);
    b.addEventListener('click', () => {
      document.getElementById('sh-icon').value = e;
      shEmojiToggle(false);
      document.getElementById('btn-sh-emoji').focus();
      shRefresh();
    });
    grid.appendChild(b);
  }
}
function shEmojiToggle(open) {
  const btn = document.getElementById('btn-sh-emoji');
  document.getElementById('sh-emoji-panel').classList.toggle('hidden', !open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) { document.getElementById('sh-emoji-search').value = ''; shEmojiRender(); document.getElementById('sh-emoji-search').focus(); }
}
document.getElementById('btn-sh-emoji').addEventListener('click', e => shEmojiToggle(e.currentTarget.getAttribute('aria-expanded') !== 'true'));
document.getElementById('sh-emoji-search').addEventListener('input', shEmojiRender);
document.getElementById('sh-emoji-panel').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation();   // Échap ferme le sélecteur, pas la fiche
  shEmojiToggle(false);
  document.getElementById('btn-sh-emoji').focus();
});

// Saisies non enregistrées (#61) : confirmation Dig avant ✕, Annuler, clic sur le fond, Échap ou départ de la page.
let _shSnap = null;
const shDirty = () => document.getElementById('sh-dialog').open && _shSnap !== null && JSON.stringify(shReadForm()) !== _shSnap;
async function shCanClose() {
  if (shDirty() && !await admConfirm({
    title: 'Modifications non enregistrées',
    text: 'Cette fiche d\'article contient des saisies qui ne sont pas enregistrées.',
    impact: ['« Abandonner » ferme la fiche et perd ces saisies ; le catalogue ne change pas.', 'Pour les garder : « Continuer à modifier », puis « Enregistrer l\'article ».'],
    ok: 'Abandonner les modifications', cancel: 'Continuer à modifier', danger: true,
  })) return false;
  _shSnap = null;
  return true;
}

const _shSetZone = admZone(document.getElementById('sh-open').closest('.overview-card'));
async function loadShop() {
  const status = document.getElementById('sh-order-filter').value;
  const { ok, data } = await api('GET', `/api/admin/shop${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  if (!ok) { shMessage('sh-item-msg', data.error || 'Erreur lors du chargement.', false); return; }
  const s = data.settings;
  const banner = document.getElementById('sh-banner');
  banner.className = `contest-banner contest-banner--${s.exchangesOpen ? 'open' : 'locked'}`;
  banner.textContent = `${s.exchangesOpen ? '✅ Échanges ouverts' : '⛔ Échanges fermés'} — cadeaux réels : ${s.realEnabled ? 'DÉVERROUILLÉS' : 'verrouillés (#27)'}. `
    + `Registre des points : ${data.ledger.ok ? 'OK' : 'ÉCART'}.`;
  if (!admZoneDirty(_shSetZone)) {   // réglages en cours de saisie conservés (#61)
    document.getElementById('sh-open').checked = s.exchangesOpen;
    document.getElementById('sh-notice').value = s.notice || '';
  }

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
    ? data.totals.map(x => `${SH_STATUS[x.status] || x.status} : ${x.n} (${shPts(x.points)})`).join(' · ')
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
  const cancel = to === 'cancelled';
  if (!await admConfirm({
    title: cancel ? `Annuler la commande n° ${o.id} ?` : `Passer la commande n° ${o.id} à « ${SH_STATUS[to]} » ?`,
    text: `${o.icon || '🎁'} ${o.texts.fr.title} — ${o.username ?? `joueur #${o.userId}`} — ${shPts(o.cost)}`,
    impact: cancel
      ? [`Le joueur est remboursé de ${shPts(o.cost)} et l'article revient en stock.`, 'La commande reste dans l\'historique (« Annulé »).']
      : [`Le joueur verra le statut « ${SH_STATUS[to]} » dans « Mes échanges ».`, 'La note facultative ci-dessus est jointe au journal.'],
    ok: cancel ? 'Annuler et rembourser' : `Passer à « ${SH_STATUS[to]} »`, cancel: 'Ne rien changer', danger: cancel,
  })) return;
  const note = document.getElementById('sh-order-note').value;
  const { ok, data } = await api('POST', `/api/admin/shop/orders/${encodeURIComponent(o.id)}/status`, { status: to, note });
  shMessage('sh-order-msg', ok ? `Commande n° ${o.id} : ${SH_STATUS[data.order.status]}.` : (data.error || 'Erreur.'), ok);
  if (ok) { document.getElementById('sh-order-note').value = ''; loadShop(); }
}

admRefreshButton('btn-refresh-shop', loadShop, 'Boutique');
document.getElementById('sh-order-filter').addEventListener('change', loadShop);
admDialogSetup('sh-dialog', { canClose: shCanClose, dirty: () => shDirty() });
document.getElementById('sh-dialog').addEventListener('input', shRefresh);
document.getElementById('sh-dialog').addEventListener('change', shRefresh);
document.getElementById('sh-kind').addEventListener('change', () => {
  if (document.getElementById('sh-kind').value === 'real') document.getElementById('sh-real-box').open = true;
});
function shOpenSheet(item, opener) {
  _shSnap = null;
  shFillForm(item);
  document.getElementById('sh-item-msg').classList.add('hidden');
  admDialogOpen('sh-dialog', opener, item ? document.querySelector('#sh-dialog [data-close]') : 'sh-fr-title');
  _shSnap = JSON.stringify(shReadForm());
  shRefresh();
}
document.getElementById('btn-sh-new').addEventListener('click', e => shOpenSheet(null, e.currentTarget));

document.getElementById('btn-sh-settings').addEventListener('click', async () => {
  const body = { exchangesOpen: document.getElementById('sh-open').checked, notice: document.getElementById('sh-notice').value };
  const { ok, data } = await api('PUT', '/api/admin/shop/settings', body);
  shMessage('sh-settings-msg', ok ? 'Réglages enregistrés.' : (data.error || 'Erreur.'), ok);
  if (ok) { admZoneClean(_shSetZone); loadShop(); }
});

document.getElementById('btn-sh-save').addEventListener('click', async () => {
  const id = document.getElementById('sh-id').value;
  const item = shReadForm();
  const { ok, data } = id
    ? await api('PUT', `/api/admin/shop/items/${encodeURIComponent(id)}`, { item })
    : await api('POST', '/api/admin/shop/items', { item });
  if (!ok) return shMessage('sh-item-msg', data.error || 'Erreur.', false);
  _shSnap = null;
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
  const v = bkDrawVisual(document.getElementById('bk-preview'), caption, t);
  bkDrawVisual(document.getElementById('bk-ov-thumb'), null, t);
  const vis = { v1: 'Icône v1 validée', catalog: 'Image personnalisée', emoji: 'Emoji de secours (pas d\'illustration)' }[v.kind] ?? v.label;
  document.getElementById('bk-ov-visual').textContent = `Visuel : ${vis}`;
  document.getElementById('bk-acc-visual-sum').textContent = vis;
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
  // Consultation d'abord : fiche existante repliée ; nouveau bloc : sections à remplir ouvertes.
  // (À l'ouverture seulement : après un enregistrement, les sections dépliées le restent.)
  for (const d of document.querySelectorAll('#bk-dialog details')) d.open = !t && ['bk-acc-spawn', 'bk-acc-reward', 'bk-acc-names'].includes(d.id);
  for (const h of document.querySelectorAll('#bk-dialog .bk-hint')) bkHint(h, false);
  bkLang('fr');
  document.getElementById('bk-ov-depth').value = Math.max(1, Number(document.getElementById('bk-odds-depth').value) || 250);
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
  if (!t) { sum.textContent = '· nouveau : ajouté au brouillon, invisible des joueurs jusqu\'à la publication'; art.classList.add('hidden'); return; }
  const changed = (_bk.draft?.changes ?? []).some(c => c.id === t.id);
  sum.textContent = `· ${t.id} · ${t.active ? 'actif' : 'désactivé'}${changed ? ' · modifié dans le brouillon' : ''}${_bk.publishedIds.includes(t.id) ? '' : ' · nouveau (jamais publié)'}`;
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
  const marks = { custom: '●', builtin: '✓', missing: '○' };
  const states = [];
  for (const b of document.querySelectorAll('#bk-langs .co-lang-btn')) {
    const l = b.dataset.lang;
    const u = bkNameUsed(id, names, l);
    b.textContent = `${marks[u.src]} ${l.toUpperCase()}`;
    b.title = document.getElementById(`bk-name-src-${l}`).textContent;
    states.push(`${marks[u.src]} ${l.toUpperCase()}`);
  }
  document.getElementById('bk-acc-names-sum').textContent = `${id || 'identifiant à saisir'} · ${states.join(' ')}`;
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
  const detail = document.getElementById('bk-eff-detail');
  detail.textContent = '';
  const depthIn = Math.max(1, Number(document.getElementById('bk-ov-depth').value) || 250);
  const ov = (id, v) => { document.getElementById(id).textContent = v ?? '—'; };
  const catSel = document.getElementById('bk-category');
  ov('bk-ov-name', f.names?.fr || bkBuiltInName(f.id, 'fr') || f.id || 'Nouveau bloc');
  ov('bk-ov-cat', catSel.selectedOptions[0]?.textContent || f.category);
  ov('bk-ov-rarity', BK_RARITY[f.rarity] ?? f.rarity);
  ov('bk-ov-min', f.minDepth != null ? `${f.minDepth} m` : null);
  ov('bk-ov-hp', f.hpBase != null ? `${f.hpBase} PV` : null);
  ov('bk-ov-reward', f.reward != null ? `${f.reward} pièces` + (isGem && f.gemReward ? ' + 1 gemme' : '') : null);
  ov('bk-ov-odds', null);
  document.getElementById('bk-acc-reward-sum').textContent = [f.hpBase != null ? `${f.hpBase} PV` : null,
    f.reward != null ? `${f.reward} pièces` : null, isGem ? (f.gemReward ? '1 gemme' : 'sans gemme') : null].filter(Boolean).join(' · ');
  document.getElementById('bk-acc-adv-sum').textContent = `emoji ${f.icon || '—'}${f.image ? ' · image personnalisée' : ''} · ${f.active ? 'actif' : 'désactivé'}`;
  const spawnSum = document.getElementById('bk-acc-spawn-sum');
  spawnSum.textContent = [f.minDepth != null ? `dès ${f.minDepth} m` : null, f.weight != null ? `poids ${f.weight}` : null,
    f.fadeFrom != null ? `atténué > ${f.fadeFrom} m` : null].filter(Boolean).join(' · ');
  if (!f.id || !(f.weight > 0) || !(f.minDepth >= 1)) {
    box.textContent = 'Renseignez l\'identifiant, la profondeur minimale et le poids pour voir la probabilité réelle.';
    gem.textContent = isGem ? 'Modèle actuel : 1 gemme à chaque bloc cassé (100 %). Probabilité × quantité : voir #49.' : 'Seuls les blocs de catégorie « gemme » rapportent une gemme.';
    return;
  }
  const types = bkWorking().filter(t => t.id !== f.id).concat([{ ...f, active: true }]);
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
  const p10 = luckOdds(depthIn, 10);
  ov('bk-ov-odds', p0 ? `${bkPct(p0)} · Chance 10 : ${bkPct(p10)}` : 'absent');
  spawnSum.textContent += ` · ${p0 ? bkPct(p0) : 'absent'} à ${depthIn} m`;
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
  detail.appendChild(tbl);
  const note = document.createElement('small');
  note.className = 'muted';
  note.textContent = (BK_BOOSTED.has(f.rarity)
    ? `Rareté « ${BK_RARITY[f.rarity]} » : la Chance du joueur augmente son poids de 10 % par niveau (colonne « avec Chance 10 » : ×2).`
    : `Rareté « ${BK_RARITY[f.rarity] ?? f.rarity} » : non favorisée par la Chance (sa part baisse un peu quand la Chance favorise les blocs rares).`)
    + ' Calcul sur tous les blocs du catalogue de travail et cette fiche telle que saisie ; profondeur surlignée : celle choisie dans la synthèse.';
  detail.appendChild(note);
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
  const show = h.hidden;
  for (const o of document.querySelectorAll('#bk-dialog .bk-hint')) bkHint(o, false);   // une seule aide à la fois
  bkHint(h, show);
});
function bkHint(h, show) {
  h.hidden = !show;
  document.querySelector(`#bk-dialog .bk-info[aria-controls="${h.id}"]`)?.setAttribute('aria-expanded', String(show));
}

// Traductions : une langue à la fois (comme les Actualités #50) ; ← → entre les langues.
function bkLang(l, focus = false) {
  for (const b of document.querySelectorAll('#bk-langs .co-lang-btn')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
  for (const d of document.querySelectorAll('#bk-dialog .bk-lang-field')) d.classList.toggle('hidden', d.dataset.lang !== l);
  if (focus) document.querySelector(`#bk-langs .co-lang-btn[data-lang="${l}"]`).focus();
}
document.querySelectorAll('#bk-langs .co-lang-btn').forEach((b, k, all) => {
  b.addEventListener('click', () => bkLang(b.dataset.lang));
  b.addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); bkLang(all[(k + d + all.length) % all.length].dataset.lang, true); }
  });
});
document.getElementById('bk-ov-depth').addEventListener('input', () => bkEffective());
document.getElementById('btn-bk-cancel').addEventListener('click', () => bkRequestClose());

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
// Échap : intercepté dès la touche (#61, sinon Chrome rend un second Échap non annulable) puis via « cancel ».
document.getElementById('bk-dialog').addEventListener('cancel', e => { e.preventDefault(); bkRequestClose(); });
document.getElementById('bk-dialog').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  e.preventDefault();
  bkRequestClose();
});
document.getElementById('bk-dialog')._admDirty = bkDirty;   // départ de la page : admAnyDirty
document.getElementById('bk-dialog').addEventListener('input', e => {
  if (e.target.id?.startsWith('bk-name-') || e.target.id === 'bk-id') bkNamesSources();
  if (e.target.closest('.bk-sec') && e.target.id !== 'bk-ov-depth') bkEffective();
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
// Un clic commencé dans la fiche (sélection de texte) et relâché sur le fond ne compte pas (#61).
{
  const dlg = document.getElementById('bk-dialog');
  let down = false;
  dlg.addEventListener('pointerdown', e => { down = admOnBackdrop(dlg, e); });
  dlg.addEventListener('click', e => { if (down && admOnBackdrop(dlg, e)) bkRequestClose(); down = false; });
}
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
  if (!await admAsk(`Revenir au contenu de la version v${version} ? Une nouvelle version sera publiée immédiatement pour tous les joueurs.`)) return;
  const { ok, data } = await api('POST', '/api/admin/blocks/rollback', { version });
  ptMessage('bk-rollback-msg', ok ? `Version v${data.version} publiée (contenu de v${data.restored}).` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) loadBlocks();
}

admRefreshButton('btn-refresh-blocks', loadBlocks, 'Blocs');

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
    ? `API IA : texte ${s.textModel}, image ${s.imageModel}${s.fake ? ' (MODE TEST, aucun appel réel)' : ''} — dépensé ${s.spentUsd} USD (cumul de tout Dig)${s.capEnabled ? ` sur un plafond de ${s.budgetUsd} USD` : ', aucun plafond bloquant'} (≈ ${s.estImageUsd} USD par image)`
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
      if (!await admAsk(`Abandonner la proposition #${p.id} ?`)) return;
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
  if (!type.id) {
    document.getElementById('bk-acc-names').open = true;
    document.getElementById('bk-id').focus();
    ptMessage('bk-form-msg', 'Identifiant requis.', false);
    return;
  }
  const { ok, data } = await api('PUT', `/api/admin/blocks/draft/types/${encodeURIComponent(type.id)}`, { type });
  // Refus : sections dépliées pour que le champ en cause soit visible (aucune valeur n'est perdue).
  if (!ok) { for (const d of document.querySelectorAll('#bk-dialog .bk-acc, #bk-acc-eff')) d.open = true; ptMessage('bk-form-msg', data.error || 'Erreur.', false); return; }
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
  if (!await admAsk(`Annuler les modifications de « ${id} » et revenir à la version publiée v${_bk.published.version} ?\n\n${what}\n\nRien n'est publié ; les autres blocs du brouillon ne changent pas.`)) return;
  const { ok, data } = await api('POST', `/api/admin/blocks/draft/types/${encodeURIComponent(id)}/revert`);
  if (!ok) { ptMessage('bk-form-msg', data.error || 'Erreur.', false); return; }
  await bkAfterUndo(id, `Modifications de « ${id} » annulées : version publiée rétablie, rien n'a été publié.`
    + (data.draftDropped ? ' Le brouillon ne contenait plus aucun changement : il a été supprimé.' : ''));
});

document.getElementById('btn-bk-remove').addEventListener('click', async () => {
  const id = document.getElementById('bk-id').value.trim();
  if (!id || !await admAsk(`Retirer le nouveau bloc « ${id} » du brouillon ? Il n'a jamais été publié.`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/blocks/draft/types/${encodeURIComponent(id)}`);
  if (!ok) { ptMessage('bk-form-msg', data.error || 'Erreur.', false); return; }
  await bkAfterUndo(null, `« ${id} » retiré du brouillon.`);
});

async function bkDiscardAll() {
  if (!_bk?.draft) return false;
  const ids = [...new Set(_bk.draft.changes.map(c => c.id))];
  if (!await admAsk(`Abandonner TOUT le brouillon ?\n\n${_bk.draft.changes.length} changement(s) non publié(s) seront perdus : ${ids.join(', ') || '—'}.\n`
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
  if (filled.length) bkLang(filled[0].toLowerCase());   // première proposition affichée pour relecture
  msg.textContent = (filled.length ? `Proposition IA dans ${filled.join(', ')} (champs surlignés) : relisez, corrigez, puis « Enregistrer dans le brouillon ». Rien n'est enregistré.` : 'Aucune proposition utilisable.')
    + (data.warnings.length ? ` ⚠ ${data.warnings.join(' ')}` : '');
  bkNamesSources();
  bkDirtyUpdate();
});

document.getElementById('btn-bk-publish').addEventListener('click', async () => {
  if (!_bk?.draft) return;
  if (!await admAsk(`Publier le brouillon (${_bk.draft.changes.length} changement(s)) ? Il s'appliquera aux prochains blocs de tous les joueurs.`)) return;
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

/** Barème lisible : « 3 % » (fixe) ou « 3 % + 0,3 pt/échec » (chance croissante, #39). */
const coPct = v => `${+(v * 100).toFixed(3)}`.replace('.', ',');
const coDropRate = d => `${coPct(d.chance)} %${d.pityStep ? ` + ${coPct(d.pityStep)} pt/échec` : ''}`;

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
admDialogSetup('co-series-dialog', { keep: 'Enregistrer la série dans le brouillon' });
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
admDialogSetup('co-item-dialog', { dirty: () => coItemDirty(), keep: 'Enregistrer l\'objet dans le brouillon' });
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
  document.getElementById('co-i-pity').value = i?.drop.pityStep ? +(i.drop.pityStep * 100).toFixed(4) : '';
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
// Modifications non enregistrées : confirmation Dig avant de fermer (✕, Annuler, Échap, clic hors fiche), voir admDialogSetup.
document.getElementById('co-item-dialog').addEventListener('close', () => { _coItemSnap = null; });
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
  const chance = num('co-i-chance'), pity = num('co-i-pity');
  return {
    id: document.getElementById('co-i-id').value.trim(),
    seriesId: document.getElementById('co-i-series').value,
    names: coTexts('co-i-name'),
    stories: coTexts('co-i-story'),
    rarity: document.getElementById('co-i-rarity').value,
    icon: document.getElementById('co-i-icon').value.trim(),
    image: document.getElementById('co-i-image').value.trim() || null,
    drop: { from: _co.categories.filter(c => document.getElementById(`co-i-from-${c}`).checked),
      minDepth: num('co-i-min'), chance: chance === null ? null : chance / 100, ...(pity ? { pityStep: pity / 100 } : {}) },
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
    chance.textContent = `${coDropRate(i.drop)}${i.dropEnabled ? '' : ' · inactif'}`;
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

const coClock = admClock;
let _coLoadedAt = null;

// Chaque chargement relit la base (GET /api/admin/collections, sans cache). « Rafraîchir » : état
// commun (admRefreshButton, #60) ; filtres, recherche et fiche ouverte sont conservés.
async function loadCollections({ manual = false } = {}) {
  const st = document.getElementById('co-refresh-status');
  const { ok, data } = await api('GET', '/api/admin/collections');
  if (!ok) {
    if (!manual) {
      st.className = 'refresh-status is-err';
      st.textContent = `⚠️ Échec du chargement (${data.error || 'erreur'})${_coLoadedAt ? ` — données affichées : ${coClock(_coLoadedAt)}` : ''}`;
      coNotice(data.error || 'Erreur lors du chargement.', false);
    }
    return;
  }
  _co = data;
  _coLoadedAt = new Date();
  if (!_coPity) coLoadPity();
  if (!manual) { st.className = 'refresh-status'; st.textContent = `✓ Données à jour à ${coClock(_coLoadedAt)}`; }
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
  coRenderPity();

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
    `${x.id} : ${x.drop.from.join('/')} dès ${x.drop.minDepth} m, ${coDropRate(x.drop)} par bloc — ${coSeasonLabel(x.seasonId, x.seasonWeek)}`));
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
      if (!await admAsk(`Publier la série « ${s?.names?.fr ?? r.seriesId} » seule ?\n${r.info.join('\n')}`
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
  if (!await admAsk(`Revenir au contenu de la version v${version} ? Une nouvelle version sera publiée immédiatement pour tous les joueurs.`)) return;
  const { ok, data } = await api('POST', '/api/admin/collections/rollback', { version });
  ptMessage('co-rollback-msg', ok ? `Version v${data.version} publiée (contenu de v${data.restored}).` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) loadCollections();
}

admRefreshButton('btn-refresh-collections', loadCollections, 'Collections');
// ── Barème et simulation (#39, décision du propriétaire du 04/11 : chance croissante) ──────────
// Le modèle ne touche qu'au BROUILLON ; la simulation tourne sur le serveur (processus enfant) et
// compare la version publiée, le brouillon (avec et sans hausse) et le modèle « chance croissante ».
let _coPity = null;      // dernier état GET /api/admin/collections/simulation
let _coPityPoll = null;
const CO_PITY_PRESET = 'croissant';

function coPresetDrop(i) {
  const r = _co?.pityPresets?.[CO_PITY_PRESET]?.rarities?.[i.rarity];
  if (!r) return i.drop;
  const { pityStep: _p, ...drop } = i.drop;
  return { ...drop, chance: r.chance, ...(r.pityStep ? { pityStep: r.pityStep } : {}) };
}

function coRenderPity() {
  if (!_co) return;
  const w = coWorking();
  coSelect('co-pity-series', w.series.map(s => [s.id, `${s.icon} ${s.names.fr}`]));
  const sel = document.getElementById('co-pity-series');
  if (!sel.dataset.touched) {   // série saisonnière la plus récente par défaut
    const seasonal = w.series.filter(s => s.seasonId != null || s.seasonWeek);
    if (seasonal.length) sel.value = seasonal[seasonal.length - 1].id;
  }
  const items = w.items.filter(i => i.seriesId === sel.value);
  const counters = _coPity?.counters ?? {};
  const body = document.getElementById('co-pity-body');
  body.replaceChildren();
  for (const i of items) {
    const tr = document.createElement('tr');
    const target = coPresetDrop(i);
    const c = counters[i.id];
    [`${i.icon} ${i.names?.fr ?? i.id}`, BK_RARITY[i.rarity] ?? i.rarity, `${i.drop.from.join(' / ')} · dès ${i.drop.minDepth} m`,
      `${i.drop.pityStep ? '↗ Chance croissante' : 'Fixe'} : ${coDropRate(i.drop)}${i.dropEnabled ? '' : ' · inactif'}`,
      JSON.stringify(target) === JSON.stringify(i.drop) ? '= déjà appliqué' : `${target.pityStep ? '↗' : 'Fixe'} ${coDropRate(target)}`,
      c ? `${c.players} · ${c.found} trouvé(s) · max ${c.maxFails} échecs` : '—'].forEach(x => addCell(tr, x));
    body.appendChild(tr);
  }
  coRenderPitySim();
}

const coPityPct = v => (v == null ? '—' : v >= 0.995 && v < 1 ? '> 99 %' : v > 0 && v < 0.005 ? '< 1 %' : `${Math.round(v * 100)} %`);

function coRenderPitySim() {
  const box = document.getElementById('co-pity-result');
  const job = _coPity?.simulation;
  const btn = document.getElementById('btn-co-pity-sim');
  btn.disabled = job?.status === 'running';
  box.replaceChildren();
  if (!job) return;
  const head = document.createElement('p');
  head.className = job.status === 'error' ? 'error' : 'muted';
  head.textContent = job.status === 'running'
    ? `↻ Simulation en cours (série ${job.seriesId}, ${job.runs} joueurs par profil)${job.progress ? ` — ${job.progress.done}/${job.progress.total} profils` : ''}…`
    : job.status === 'error' ? `⚠️ ${job.error}`
    : `✓ Simulation du ${String(job.finishedAt).slice(0, 16).replace('T', ' ')} UTC — série ${job.seriesId}, ${job.runs} joueurs par profil (simulateur #49 : vrai code du jeu, 7 jours). Rien n'est publié.`;
  box.appendChild(head);
  if (job.status !== 'done') return;
  const legend = document.createElement('ul');
  legend.className = 'muted';
  legend.style.fontSize = '0.78rem';
  for (const sc of job.scales) {
    const li = document.createElement('li');
    li.textContent = `${sc.label}${sc.also.length ? ` (= ${sc.also.join(', ')})` : ''} : ${sc.items.map(i => `${i.id.split('_')[0]} ${coDropRate(i)}`).join(' · ')}`;
    legend.appendChild(li);
  }
  box.appendChild(legend);
  const wrap = document.createElement('div');
  wrap.className = 'bk-table-wrap';
  const table = document.createElement('table');
  table.className = 'bk-table';
  const thead = document.createElement('thead');
  const h1 = document.createElement('tr'), h2 = document.createElement('tr');
  for (const t of ['Profil', 'Saison']) { const th = document.createElement('th'); th.rowSpan = 2; th.textContent = t; h1.appendChild(th); }
  for (const sc of job.scales) {
    const th = document.createElement('th'); th.colSpan = 4; th.textContent = sc.label; h1.appendChild(th);
    for (const t of ['Série complète (7 j)', 'Rare', 'Légendaire', 'Légendaire fin J1']) { const x = document.createElement('th'); x.textContent = t; h2.appendChild(x); }
  }
  thead.append(h1, h2);
  const tb = document.createElement('tbody');
  for (const r of job.result.rows) {
    const tr = document.createElement('tr');
    addCell(tr, r.label);
    addCell(tr, r.season === 1 ? '1 (compte neuf)' : `${r.season} (installé)`);
    for (const sc of job.scales) {
      const v = r.scales[sc.key];
      [v.all, v.rare, v.legendary, v.legendaryJ1].forEach(x => { addCell(tr, coPityPct(x)).className = 'num'; });
    }
    tb.appendChild(tr);
  }
  table.append(thead, tb);
  wrap.appendChild(table);
  box.appendChild(wrap);
}

async function coLoadPity() {
  const { ok, data } = await api('GET', '/api/admin/collections/simulation');
  if (!ok) return;
  _coPity = data;
  coRenderPity();
  clearTimeout(_coPityPoll);
  if (data.simulation?.status === 'running') _coPityPoll = setTimeout(coLoadPity, 3000);
}

document.getElementById('co-pity-series').addEventListener('change', e => { e.target.dataset.touched = '1'; coRenderPity(); });
document.getElementById('btn-co-pity-preset').addEventListener('click', async () => {
  const seriesId = document.getElementById('co-pity-series').value;
  const s = coWorking().series.find(x => x.id === seriesId);
  if (!s) return;
  const changes = coWorking().items.filter(i => i.seriesId === seriesId && JSON.stringify(coPresetDrop(i)) !== JSON.stringify(i.drop));
  if (!changes.length) return ptMessage('co-pity-msg', 'Le modèle « chance croissante » est déjà appliqué à cette série.', true);
  if (!await admConfirm({ title: `Appliquer la chance croissante à « ${s.names.fr} » ?`,
    text: 'Seul le brouillon change : rien n\'est publié, aucun drop n\'est activé, images et textes restent identiques.',
    impact: changes.map(i => `${i.names?.fr ?? i.id} : ${coDropRate(i.drop)} → ${coDropRate(coPresetDrop(i))}`), ok: 'Appliquer au brouillon' })) return;
  const { ok, data } = await api('POST', `/api/admin/collections/draft/series/${encodeURIComponent(seriesId)}/preset`, { preset: CO_PITY_PRESET });
  ptMessage('co-pity-msg', ok ? `✓ Brouillon mis à jour : ${data.changed.length} objet(s). Rien n'est publié.` : (data.error || 'Erreur.'), ok);
  if (ok) await loadCollections();
});
document.getElementById('btn-co-pity-sim').addEventListener('click', async () => {
  const seriesId = document.getElementById('co-pity-series').value;
  const runs = Number(document.getElementById('co-pity-runs').value) || 2000;
  const { ok, data } = await api('POST', '/api/admin/collections/simulation', { seriesId, runs });
  if (!ok) return ptMessage('co-pity-msg', data.error || 'Erreur.', false);
  document.getElementById('co-pity-msg').className = 'hidden';
  _coPity = { ...(_coPity ?? {}), ...data };
  coRenderPitySim();
  clearTimeout(_coPityPoll);
  _coPityPoll = setTimeout(coLoadPity, 3000);
});

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
  if (!id || !await admAsk(`Retirer la série « ${id} » du brouillon ?`)) return;
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
  if (!id || !await admAsk(`Retirer « ${id} » du brouillon ?`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/collections/draft/items/${encodeURIComponent(id)}`);
  if (!ok) { ptMessage('co-i-msg', data.error || 'Erreur.', false); return; }
  document.getElementById('co-item-dialog').close();
  coNotice(`« ${id} » retiré du brouillon.`);
  loadCollections();
});

document.getElementById('btn-co-i-studio').addEventListener('click', async () => {
  const id = document.getElementById('co-i-id').value.trim();
  if (coItemDirty() && !await admConfirmDiscard({ keep: 'Enregistrer l\'objet dans le brouillon', effect: 'ferme la fiche, perd ces saisies et ouvre l\'atelier d\'icônes.' })) return;
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
  if (!await admAsk(`Publier TOUT le brouillon (${_co.draft.changes.length} changement(s), série(s) : ${touched.join(', ') || '—'}) ? `
    + 'Il sera visible de tous les joueurs au prochain chargement. Pour une seule série, utilisez « Publier cette série seule ».')) return;
  const note = document.getElementById('co-publish-note').value;
  const { ok, data } = await api('POST', '/api/admin/collections/publish', { note, expectedBasedOn: _co.draft.basedOn, confirmDrops, confirmIncomplete });
  ptMessage('co-publish-msg', ok ? `Version v${data.version} publiée.` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) { document.getElementById('co-publish-note').value = ''; loadCollections(); }
});

document.getElementById('btn-co-discard').addEventListener('click', async () => {
  const lost = (_co?.draft?.items ?? []).filter(i => i.image && !(_co.published.items.find(p => p.id === i.id)?.image === i.image)).length;
  if (!await admAsk('Abandonner le brouillon ? Les modifications non publiées seront perdues'
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
  const limited = st.configured && ((st.capEnabled && st.remainingUsd < st.estTextUsd) || st.callsToday >= st.maxCallsPerDay);
  document.getElementById('co-ai-status').textContent = !st.configured
    ? 'IA non configurée : création manuelle seulement.'
    : limited ? 'Limite IA atteinte pour le moment (détails : ⚙ Config → Budget IA). La création manuelle reste possible.'
    : 'La génération IA peut entraîner un coût ; rien n\'est publié automatiquement.';
  document.getElementById('co-ai-status-2').textContent = st.configured
    ? `Modèle ${st.textModel}${st.fake ? ' (mode test)' : ''} — ${st.capEnabled ? `budget restant ≈ ${st.remainingUsd.toFixed(2)} / ${st.budgetUsd} USD` : `dépensé ${st.spentUsd} USD, aucun plafond bloquant`}, texte ≈ ${st.estTextUsd} USD par proposition ; ${st.callsToday}/${st.maxCallsPerDay} appels sur 24 h.`
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
// Corrections non enregistrées : confirmation Dig avant de fermer (✕, Fermer, Échap, clic hors fiche), voir admDialogSetup.
admDialogSetup('co-prop-dialog', { dirty: () => !!_coPropWork?.dirty, keep: 'Enregistrer les corrections' });
document.getElementById('co-prop-dialog').addEventListener('close', () => { _coProp = null; _coPropWork = null; });

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
    rm.addEventListener('click', async () => {
      if (!await admAsk(`Retirer « ${it.names.fr || it.id} » de la proposition ? (effectif à l'enregistrement)`)) return;
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
  if (miss && !await admAsk(`${miss} objet(s) ont un nom ou une histoire manquant dans une langue (pastilles jaunes ou —). Enregistrer quand même dans le brouillon ? Vous pourrez compléter avant de publier.`)) return;
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
  if (!_coProp || !await admAsk('Abandonner cette proposition ? Elle disparaîtra de la liste (le catalogue n\'est pas modifié).')) return;
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
// #67 : pictogrammes d'interface, appliqués directement en jeu (pas de brouillon)
const IC_UI_ACTIONS = { applied: 'Appliquée en jeu', reverted_to_emoji: 'Retour au pictogramme d\'origine (en jeu)' };
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
  else if (t.emoji && icEmojiShown(t.emoji)) { box.textContent = t.emoji; box.classList.add('bk-thumb--emoji'); }
  else {
    // Recette du 03/11 : pas de carré ⬜/□ — emoji absent ou non affichable sur cet appareil (ex. 🪶 sous Windows 10)
    box.classList.add('ic-thumb--none');
    box.appendChild(aiEl('span', { class: 'ic-thumb-none', style: `font-size:${Math.max(9, Math.round(size * 0.14))}px` }, 'Pas encore d\'image'));
    if (t.emoji) box.title = `Emoji ${t.emoji} non affichable sur cet appareil`;
  }
  return box;
}

/** Vrai si l'emoji est dessiné en couleur par une police de l'appareil (sinon carré de remplacement). */
const _icEmojiOk = new Map();
function icEmojiShown(e) {
  if (_icEmojiOk.has(e)) return _icEmojiOk.get(e);
  // Dessiné en couleur, ou du moins différent du carré d'un caractère inexistant (U+10FFFD) : affichable
  let ok = true;
  try {
    const draw = ch => {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#000'; g.textBaseline = 'top'; g.font = '20px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      g.fillText(ch, 0, 0);
      return g.getImageData(0, 0, 24, 24).data;
    };
    const d = draw(e), tofu = draw('\u{10FFFD}');
    let colored = false, same = true;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] && (d[i] || d[i + 1] || d[i + 2])) colored = true;
      if (d[i + 3] !== tofu[i + 3]) same = false;
    }
    ok = colored || !same;
  } catch (_) { ok = true; }
  _icEmojiOk.set(e, ok);
  return ok;
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

/** Réservation (estimation avant l'appel), distincte du coût réel journalisé après l'appel (retours du 03/11). */
function icReserveText(s) {
  const r = s.reserve;
  if (!r) return '';
  const check = s.checkEstUsd ? ` + contrôle du sujet ${s.checkEstUsd.toFixed(4)} USD` : '';
  return r.basis === 'measured'
    ? `estimation avant l'appel : ${r.usd.toFixed(4)} USD par image${check} (coût réel le plus élevé des ${r.samples} dernières, ${r.measuredMaxUsd.toFixed(4)} USD, + 25 %)`
    : `estimation avant l'appel : ${r.usd.toFixed(4)} USD par image${check} (estimation configurée, en attendant 2 coûts réels mesurés)`;
}
/** Plafond réactivé dans ⚙ Config et atteint : montants non arrondis, réservation détaillée. */
function icBudgetHelp(s) {
  const last = s.lastImage ? ` Coût réel de la dernière image : ${Number(s.lastImage.cost_usd).toFixed(4)} USD.` : '';
  return `Plafond de dépense atteint (réglé dans ⚙ Config → Budget IA) : ${s.globalSpentUsd.toFixed(4)} USD dépensés par tout Dig sur ${Number(s.capUsd).toFixed(2)} USD, `
    + `il reste ${s.remainingUsd.toFixed(4)} USD ; ${icReserveText(s)}.${last} Pour continuer, relevez ou désactivez ce plafond dans ⚙ Config → Budget IA.`;
}

async function loadIcons() {
  const { ok, data } = await api('GET', '/api/admin/icons');
  if (!ok) { icNotice(document.getElementById('ic-notice'), data.error || 'Erreur.', 'error'); return; }
  _ic = data;
  icSetJob(data.job);
  icRenderGrid();
  const s = data.status;
  document.getElementById('ic-tech').textContent = s.configured
    ? `Modèle ${s.imageModel}${s.fake ? ' (mode test)' : ''} · ${s.lastImage ? `coût réel de la dernière image : ${Number(s.lastImage.cost_usd).toFixed(4)} USD · ` : ''}${icReserveText(s)} · `
      + `${s.capEnabled ? `plafond ${Number(s.capUsd).toFixed(2)} USD (⚙ Config)` : 'aucun plafond bloquant'} · ${s.imagesToday}/${s.maxImagesPerDay} images sur 24 h · référence de style : ${s.reference ?? 'aucune'}.`
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
  const zone = document.getElementById('ic-zone')?.value ?? '';
  return (_ic?.targets ?? []).filter(t => (!kind || t.kind === kind) && (!state || icState(t).key === state) && (!zone || t.zone === zone)
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
    card.appendChild(aiEl('span', { class: 'ic-card-kind' }, t.kind === 'ui' ? `${t.kindLabel} · ${t.zoneLabel ?? ''}${t.deployable === false ? ' · stockage seul' : ''}` : t.kindLabel));
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
  // Décision du 03/11 : sans plafond de dépense actif, aucun lot (une image par clic, objet par objet)
  const batch = !!_ic.status?.capEnabled;
  head.appendChild(aiEl('strong', {}, batch ? 'Collections : une image par objet, enchaînées automatiquement' : 'Collections : images à faire'));
  head.appendChild(aiEl('span', { class: 'muted' }, batch
    ? ' — seuls les objets sans image ni proposition à examiner sont générés ; vous ne corrigez ensuite que ceux signalés.'
    : ' — ouvrez un objet et cliquez « Générer une image » : une image par clic. Génération en lot désactivée tant qu\'aucun plafond de dépense n\'est actif (⚙ Config → Budget IA).'));
  box.appendChild(head);
  for (const p of _ic.series) {
    const row = aiEl('div', { class: 'ic-series-row' });
    row.appendChild(aiEl('span', { class: 'ic-series-name' }, `${p.icon ?? ''} ${p.name}`));
    const n = k => p.items.filter(i => i.state === k).length;
    const parts = [`${p.items.length} objets`, p.todo ? `${p.todo} à générer` : 'aucun à générer',
      n('has_image') && `${n('has_image')} avec image`, n('has_proposal') && `${n('has_proposal')} à examiner`, n('conflict') && `${n('conflict')} en conflit de sujet`].filter(Boolean);
    row.appendChild(aiEl('span', { class: 'muted' }, parts.join(' · ')));
    if (p.todo && batch) {
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
    `• Reste sous le plafond (⚙ Config) : ${icUsd(p.remainingUsd)} → ${p.affordable >= todo.length ? 'suffisant' : `au moins ${p.affordable} image(s) ; la génération s'arrêtera d'elle-même au plafond, qui n'est jamais relevé automatiquement`}.`,
    `• Durée : ${p.measuredSeconds ? `≈ ${p.measuredSeconds} s` : 'environ 40 s'} par image, l'une après l'autre ; vous pouvez quitter la page.`,
    '• Chaque image est contrôlée automatiquement (objet reconnu ?). Rien n\'est conservé ni publié sans vous.'].filter(Boolean).join('\n');
  if (!await admAsk(msg)) return;
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
  event: 'ex. ruban plus rouge, vue de trois quarts',
  badge: 'ex. médaille plus brillante, symbole plus simple',
  ui: 'ex. trait plus épais, couleurs plus vives',
  chest: 'ex. couvercle plus bombé, ferrures plus brillantes',
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
      paint(); refresh();
      if (edit.classList.contains('hidden')) toggle.click(); else els.subject.focus();
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
  // Recette du 03/11 (« trop de texte à vérifier ») : résumé en quatre champs par défaut, champs modifiables
  // sur demande, texte exact envoyé à l'IA replié et copiable.
  const sum = t.promptSummary ?? {};
  const summary = aiEl('dl', { class: 'ic-summary' });
  const edit = aiEl('div', { class: 'ic-brief-edit hidden' });
  const row = (label, value, cls = '') => {
    summary.appendChild(aiEl('dt', {}, label));
    const dd = aiEl('dd', { class: cls }, value || '—');
    summary.appendChild(dd);
    return dd;
  };
  const show = {};
  show.subject = row('Sujet', '');
  show.details = row('Forme et matière', '');
  show.palette = row('Couleurs', '');
  row('Style et contraintes', sum.style ?? '', 'muted');
  const paint = () => {
    const v = k => els[k]?.value.trim() ?? '';
    show.subject.textContent = (sum.object ? `${sum.object} — ` : '') + (v('subject') || '—');
    show.details.textContent = v('details') || '—';
    show.palette.textContent = v('palette').replace(/^\s*palette\s*:\s*/i, '') || '—';
  };
  for (const [k, label, max] of [['subject', 'Sujet', 300], ['details', 'Forme et matière', 600], ['palette', 'Couleurs', 300]]) {
    const [l, el] = aiInput(label, memo[k] ?? t.brief[k], { maxlength: String(max) });
    l.classList.add('ic-field');
    el.addEventListener('input', () => { memo[k] = el.value; refresh(); paint(); icLiveConflict(); });
    els[k] = el;
    edit.appendChild(l);
  }
  wrap.appendChild(summary);
  const tools = aiEl('div', { class: 'form-actions ic-summary-tools' });
  const toggle = icButton(tools, '✎ Modifier la consigne', () => {
    const open = edit.classList.toggle('hidden') === false;
    toggle.textContent = open ? 'Masquer les champs' : '✎ Modifier la consigne';
    toggle.setAttribute('aria-expanded', String(open));
    if (open) els.subject.focus();
  }, 'btn btn-outline');
  toggle.setAttribute('aria-expanded', 'false');
  wrap.appendChild(tools);
  wrap.appendChild(edit);
  // Modification en cours (non enregistrée) : champs ouverts d'office
  if (['subject', 'details', 'palette'].some(k => memo[k] !== undefined && memo[k] !== (t.brief[k] ?? ''))) toggle.click();
  paint();
  refresh();
  wrap.appendChild(state);
  wrap.appendChild(icExactPrompt(t));
  parent.appendChild(wrap);
  return els;
}

/** Texte exact envoyé à l'IA (consigne enregistrée, hors précision ponctuelle), replié et copiable. */
function icExactPrompt(t) {
  const d = aiEl('details', { class: 'ic-exact' });
  d.appendChild(aiEl('summary', { class: 'muted' }, 'Texte exact envoyé à l\'IA'));
  d.appendChild(aiEl('p', { class: 'muted ic-hint' }, 'Inutile de le relire pour générer : il assemble la consigne ci-dessus (telle qu\'enregistrée) et le style commun. '
    + 'Une précision saisie pour une génération s\'ajoute à la fin.'));
  const pre = aiEl('pre', { class: 'ic-prompt' }, t.prompt ?? '');
  d.appendChild(pre);
  const tools = aiEl('div', { class: 'form-actions' });
  const msg = aiEl('span', { class: 'muted', role: 'status' });
  icButton(tools, '📋 Copier le texte', async () => {
    try { await navigator.clipboard.writeText(t.prompt ?? ''); msg.textContent = 'Copié.'; }
    catch (_) { getSelection().selectAllChildren(pre); msg.textContent = 'Texte sélectionné : Ctrl+C pour copier.'; }
  }, 'btn btn-outline');
  tools.appendChild(msg);
  d.appendChild(tools);
  return d;
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
  const sel = t.assets.find(a => a.sha === _icSel) ?? icReuseAsset(t, _icSel);

  // En-tête : retour, nom, état
  const head = aiEl('div', { class: 'ic-sheet-head' });
  icButton(head, '← Toutes les icônes', async () => icShowList());
  if (_icFrom?.kind === 'item' && t.key === `item:${_icFrom.id}`) icButton(head, '← Retour à la fiche de l\'objet', () => icBackToItem(_icFrom.id));
  if (_icFrom?.kind === 'relic' && t.key === `relic:${_icFrom.id}`) icButton(head, '← Retour à la fiche de la relique', () => rlBackTo(_icFrom.id));
  if (_icFrom?.kind === 'upgrade' && t.key === `ui:upgrade_${_icFrom.id}`) icButton(head, '← Retour à la fiche de l\'amélioration', () => upBackTo(_icFrom.id));
  if (_icFrom?.kind === 'mission' && t.key === `mission:${_icFrom.id}`) icButton(head, '← Retour à la fiche de la mission', () => mqBackTo(_icFrom.id));
  if (_icFrom?.kind === 'rewards' && t.key === _icFrom.key) icButton(head, '← Retour à Coffres & drops', () => rwBackFromStudio());
  if (t.kind === 'event' && t.event) icButton(head, '← Retour à la fiche de l\'objet d\'événement', () => evBackTo(t.event.id, t.event.itemId));
  const title = aiEl('div', { class: 'ic-sheet-title' });
  title.appendChild(aiEl('h3', {}, t.name));
  title.appendChild(icBadge(st));
  head.appendChild(title);
  head.appendChild(aiEl('p', { class: 'muted ic-sheet-sub' }, `${t.kindLabel}${t.extra ? ` · ${t.extra}` : ''}`));
  box.appendChild(head);
  if (t.validated) box.appendChild(aiEl('p', { class: 'ic-notice ic-notice--info' }, '🔒 Icône validée : elle ne sera remplacée qu\'avec votre accord explicite.'));
  // #67 : pictogramme d'interface raccordé au jeu (application immédiate, confirmée) ou seulement stocké
  if (t.kind === 'ui' && !t.applicable) box.appendChild(aiEl('p', { class: 'ic-notice ic-notice--warn' }, `Stockage seulement : ${t.notDeployable ?? 'ce pictogramme n\'est pas raccordé au jeu.'} Aucune image n'est appliquée automatiquement.`));
  // #66 : coffre de la boutique, même cycle que les pictogrammes (application en jeu confirmée, pas de brouillon)
  if (t.kind === 'chest') box.appendChild(aiEl('p', { class: 'ic-notice ic-notice--info' }, `Emplacement en jeu : ${t.where}. Seul le visuel change : récompenses, prix et chances restent ceux de 🎲 Coffres & drops. `
    + 'Une proposition n\'est jamais appliquée automatiquement : « Appliquer cette image dans le jeu » la rend visible pour tous les joueurs après confirmation, « Revenir à l\'icône précédente » ou « Revenir à l\'emoji d\'origine » l\'annule.'));
  if (t.kind === 'block' && t.background && /^block:(vieille_caisse|coffre_bois|coffre_fer)$/.test(t.key)) box.appendChild(aiEl('p', { class: 'ic-notice ic-notice--info' },
    'Coffre trouvé en minant : « Conserver » met l\'image dans le brouillon du catalogue de blocs ; les joueurs la voient après publication dans 🧱 Blocs. Récompenses et chances inchangées.'));
  if (t.kind === 'ui' && t.applicable) box.appendChild(aiEl('p', { class: 'ic-notice ic-notice--info' }, `Emplacement en jeu : ${t.where}. Une proposition n'est jamais appliquée automatiquement : `
    + '« Appliquer cette image » la met en jeu pour tous les joueurs après confirmation (aucune publication séparée), et « Revenir à l\'icône précédente » ou « Revenir au pictogramme d\'origine » l\'annule.'));

  // Comparaison : icône actuelle ↔ proposition affichée
  const cmp = aiEl('div', { class: 'ic-compare' });
  const fig = (node, caption) => {
    const f = aiEl('figure', { class: 'ic-fig' });
    f.appendChild(node);
    f.appendChild(aiEl('figcaption', {}, caption));
    cmp.appendChild(f);
    return f;
  };
  fig(icThumb(t, 160), t.kind === 'chest' ? (t.image ? 'Actuelle en jeu (image appliquée)' : `Actuelle en jeu (emoji d'origine ${t.emoji})`)
    : t.kind === 'ui' ? (t.applicable ? (t.image ? 'Actuelle en jeu (image appliquée)' : `Actuelle en jeu (pictogramme d'origine ${t.emoji})`) : 'Actuelle')
    : !t.applicable ? 'Actuelle' : t.neverPublished ? 'Actuelle (objet en brouillon, jamais publié)'
    : t.unpublished ? 'Actuelle (brouillon, pas encore en jeu)' : 'Actuelle en jeu');
  if (mine) {
    const wait = aiEl('span', { class: 'bk-thumb ic-thumb ic-wait', style: 'width:160px;height:160px;border-radius:26px' });
    wait.appendChild(aiEl('span', { class: 'ic-spinner', 'aria-hidden': 'true' }));
    fig(wait, 'Génération en cours… (environ une minute)');
  } else if (sel) {
    const where = sel.published ? 'en jeu' : sel.inDraft ? 'dans le brouillon' : sel.status === 'rejected' ? 'écartée' : 'proposition';
    const f = fig(icThumb(t, 160, sel.url), `${sel.source === 'reuse' ? `Image de « ${sel.reusedFrom} », réutilisée` : sel.source === 'ai' ? 'Proposition' : 'Image téléversée'} du ${icWhen(sel.createdAt)} (heure de Bruxelles) — ${where}`);
    if (sel.source === 'ai') {
      // Provenance lisible : objet demandé (catalogue), version du prompt, précision de cette génération
      f.appendChild(aiEl('p', { class: 'muted ic-fig-note' }, sel.uiTarget
        ? `Pictogramme demandé à l'IA : « ${sel.uiTarget.name} » (${sel.uiTarget.en}), avec son emplacement dans le jeu · prompt ${sel.promptVersion}`
        : t.kind === 'ui' ? `Prompt ${sel.promptVersion ?? 'v1.1'} : ancienne version, le nom et l'emplacement du pictogramme n'étaient pas transmis à l'IA. L'image reste utilisable ; « Refaire » utilise la version actuelle.`
        : sel.identity
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
    const briefEls = t.kind === 'item' || t.kind === 'event' ? icItemBrief(step, t) : null;
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
    if (t.kind === 'ui' || t.kind === 'chest') icUiActions(row, t, sel);
    else if (t.applicable && !sel.inDraft) {
      icButton(row, '✓ Conserver cette image', () => icApply(t, sel.sha, { doubtful: !!sel.warning }), sel.warning ? 'btn btn-outline' : 'btn ic-main');
    } else if (t.applicable && sel.inDraft) {
      row.appendChild(aiEl('span', { class: 'ic-kept' }, sel.published ? '✓ Cette image est en jeu.' : '✓ Conservée dans le brouillon.'));
      // Recette du 03/11 : ce bouton ne publie rien, il ouvre l'onglet où la publication reste une décision manuelle
      if (!sel.published && t.kind === 'event') {
        // #65 : publication par l'action explicite de l'événement (« Publier les images » dans sa fiche)
        icButton(row, 'Ouvrir la fiche de l\'événement →', () => evBackTo(t.event.id, null), 'btn btn-outline');
        row.appendChild(aiEl('span', { class: 'muted' }, 'Rien n\'est publié ici : « Publier les images » dans la fiche de l\'événement (statut et drops inchangés).'));
      } else if (!sel.published) {
        const tab = t.kind === 'block' ? '🧱 Blocs' : '📿 Collections';
        const go = icButton(row, `Ouvrir l'onglet ${tab} →`, async () => {
          document.querySelector(`.tab-btn[data-tab="${t.kind === 'block' ? 'blocks' : 'collections'}"]`).click();
        }, 'btn btn-outline');
        go.title = `Ne publie rien : ouvre ${tab}, où le brouillon se relit et se publie manuellement (la série et ses drops restent inchangés).`;
        row.appendChild(aiEl('span', { class: 'muted' }, `Rien n'est publié ici : la publication se décide dans l'onglet ${tab}.`));
      }
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

  // #67 : réutiliser l'image d'un autre pictogramme (aucune génération)
  if (t.kind === 'ui' && t.applicable && t.reusable?.length) box.appendChild(icReuseStrip(t));

  // Aperçu en jeu, taille réelle
  if (sel && t.kind === 'ui' && t.applicable) box.appendChild(icUiBeforeAfter(t, sel));
  else if (sel) {
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
  if (sel && sel.source !== 'reuse' && sel.status !== 'validated') icButton(acts, '🔒 Verrouiller cette image (validée)', async () => {
    if (!await admAsk('Verrouiller cette image comme VALIDÉE ? Elle ne pourra ensuite être remplacée qu\'avec votre accord explicite.')) return;
    await icMark(t, sel.sha, 'validated', 'Image verrouillée.');
  });
  if (sel && sel.source !== 'reuse' && sel.status !== 'rejected' && !sel.inDraft) icButton(acts, 'Écarter cette proposition', () => icMark(t, sel.sha, 'rejected', 'Proposition écartée (conservée dans l\'historique).'));
  if (sel && sel.status === 'rejected') icButton(acts, 'Remettre en proposition', () => icMark(t, sel.sha, 'candidate', 'Proposition rétablie.'));
  if (t.applicable && t.image && t.kind !== 'ui' && t.kind !== 'chest') icButton(acts, 'Revenir à l\'emoji d\'origine', () => icApply(t, null));   // ui, coffre : dans les actions principales
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
  if (t.kind !== 'item') brief.appendChild(icExactPrompt(t));   // objets : déjà sous leur consigne
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
    const label = t.kind === 'ui' || t.kind === 'chest' ? IC_UI_ACTIONS[h.action] ?? IC_ACTIONS[h.action] : IC_ACTIONS[h.action];
    addCell(tr, `${label ?? h.action}${h.details?.reusedFrom ? ` (image de ${h.details.reusedFrom})` : ''}${h.details?.identity ? ` (objet demandé : ${h.details.identity})` : ''}${h.details?.instruction ? ` — précision « ${h.details.instruction} »` : ''}`);
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
  if (doubtful && !await admAsk(`Cette proposition est douteuse (sa demande citait un autre objet). La conserver quand même pour « ${t.name} » ?`)) return;
  let override = false;
  if (t.validated) {
    if (!await admAsk(`L'icône de « ${t.name} » est VALIDÉE. La remplacer quand même (accord explicite, tracé) ?`)) return;
    override = true;
  }
  // Badge (#38) : pas de brouillon ; sur un badge actif, l'image est visible tout de suite → confirmation
  if (t.kind === 'ui' || t.kind === 'chest') return icApplyUi(t, sha, { override, doubtful });
  const live = t.kind === 'badge' && / active$/.test(String(t.extra ?? ''));
  if (live && !await admAsk(`Le badge « ${t.name} » est ACTIF : cette image sera visible immédiatement par les joueurs. Continuer ?`)) return;
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(t.key)}/apply`, { sha, override, live, doubtful });
  const where = data.catalog === 'blocks' ? '🧱 Blocs' : data.catalog === 'relics' ? '🔮 Reliques' : data.catalog === 'missions' ? '🎯 Missions' : '📿 Collections';
  const done = data.catalog === 'missions'
    ? `${sha ? 'Image conservée' : 'Emoji d\'origine rétabli'} dans le brouillon des missions (🎯 Missions). Le jeu n'utilise pas encore ce catalogue : rien ne change pour les joueurs.`
    : data.catalog === 'events'
    ? `${sha ? 'Image conservée' : 'Emoji d\'origine rétabli'} dans la fiche de l'événement (brouillon). Les joueurs la verront après « Publier les images » dans 🎉 Événements.`
    : data.catalog === 'badges'
    ? `${sha ? 'Image enregistrée' : 'Emoji rétabli'} sur le badge${data.draft ? ' (désactivé : les joueurs la verront après son activation dans 🏅 Badges)' : ' (actif : visible par les joueurs)'}.`
    : `${sha ? 'Image conservée' : 'Emoji d\'origine rétabli'} dans le brouillon. Les joueurs la verront après la publication dans l'onglet ${where}.`;
  _icNote = { text: ok ? done : (data.error || 'Erreur.'), ok };
  if (ok) { await icOpen(t.key, { keepSel: true }); loadIconsQuiet(); } else icRenderSheet();
}

// ── Pictogrammes d'interface (#67) : Prévisualiser → Appliquer (confirmé) → Revenir ──

/** Image d'un autre pictogramme sélectionnée pour réutilisation (aucune génération). */
function icReuseAsset(t, sha) {
  const r = t.kind === 'ui' && sha ? t.reusable?.find(x => x.sha === sha) : null;
  return r ? { sha: r.sha, url: r.url, source: 'reuse', reusedFrom: r.name, createdAt: r.createdAt, status: 'candidate',
    published: r.url === t.image, inDraft: r.url === t.image } : null;
}

/** Image précédente d'un pictogramme (avant la dernière application) : { sha } (null = pictogramme d'origine), ou null. */
function icUiPrevious(t) {
  const last = t.history.find(h => h.action === 'applied' || h.action === 'reverted_to_emoji');
  if (!last || last.details?.before === undefined) return null;
  const m = /\/media\/icons\/([a-f0-9]{16})\.webp$/.exec(last.details.before ?? '');
  return { sha: m ? m[1] : null, url: last.details.before ?? null };
}

/** Actions d'un pictogramme d'interface sur la proposition affichée (distinctes de « Refaire »). */
function icUiActions(row, t, sel) {
  if (!t.applicable) {
    row.appendChild(aiEl('span', { class: 'muted' }, 'Stockage seulement : cette image ne peut pas être appliquée depuis l\'atelier.'));
    return;
  }
  if (sel.published) row.appendChild(aiEl('span', { class: 'ic-kept' }, '✓ Cette image est en jeu.'));
  else {
    icButton(row, '✓ Appliquer cette image dans le jeu…', () => icApplyUi(t, sel.sha, { doubtful: !!sel.warning }), sel.warning ? 'btn btn-outline' : 'btn ic-main');
    row.appendChild(aiEl('a', { class: 'btn btn-outline', href: `/?uiicon=${encodeURIComponent(t.gameIconId ?? t.id)}:${sel.sha}`, target: '_blank', rel: 'noopener',
      title: 'Ouvre le vrai jeu avec cette image à cet emplacement, pour vous seul et pour cette page seulement : rien n\'est appliqué.' }, 'Prévisualiser dans le jeu ↗'));
  }
  if (t.image) {
    const prev = icUiPrevious(t);
    if (prev && prev.url) icButton(row, '↩ Revenir à l\'icône précédente', () => icApply(t, prev.sha));
    icButton(row, `${t.kind === 'chest' ? 'Revenir à l\'emoji d\'origine' : 'Revenir au pictogramme d\'origine'} ${t.emojiOriginal ?? t.emoji ?? ''}`, () => icApply(t, null));
  }
}

/** Confirmation explicite puis application en jeu (ou retour au pictogramme d'origine si `sha` est null). */
async function icApplyUi(t, sha, { override = false, doubtful = false } = {}) {
  if (doubtful && !await admAsk(`Cette proposition est douteuse. L'appliquer quand même à « ${t.name} » ?`)) return;
  const orig = `${t.kind === 'chest' ? 'l\'emoji d\'origine' : 'le pictogramme d\'origine'} ${t.emojiOriginal ?? t.emoji ?? ''}`;   // #66 : coffre de la boutique
  const msg = [sha ? `Appliquer cette image à « ${t.name} » ?` : `Revenir à ${orig} pour « ${t.name} » ?`, '',
    `• Emplacement : ${t.where}.`,
    '• Visible par tous les joueurs à leur prochain chargement de page (ordinateur, smartphone, application installée).',
    `• Actuellement : ${t.image ? 'une image appliquée' : orig}.`,
    ...(t.kind === 'chest' ? ['• Seul le visuel change : récompenses, prix et chances du coffre restent identiques.'] : []),
    `• Annulable à tout moment : « Revenir à l'icône précédente » ou « ${t.kind === 'chest' ? 'Revenir à l\'emoji d\'origine' : 'Revenir au pictogramme d\'origine'} ». Aucune image n'est supprimée.`].join('\n');
  if (!await admAsk(msg)) return;
  const { ok, data } = await api('POST', `/api/admin/icons/targets/${icEnc(t.key)}/apply`, { sha, override, live: true, doubtful });
  _icNote = { text: ok ? (sha ? `Image appliquée en jeu (${t.where}). Les joueurs la verront au prochain chargement.` : `${orig.charAt(0).toUpperCase()}${orig.slice(1)} rétabli en jeu (${t.where}).`) : (data.error || 'Erreur.'), ok };
  if (ok) { if (sha) _icSel = sha; await icOpen(t.key, { keepSel: true }); loadIconsQuiet(); } else icRenderSheet();
}

/** Images des autres pictogrammes, réutilisables sans nouvelle génération. */
function icReuseStrip(t) {
  const d = aiEl('details', { class: 'ic-more' });
  d.appendChild(aiEl('summary', {}, `Réutiliser l'image d'un autre pictogramme (${t.reusable.length}) — sans nouvelle génération`));
  d.appendChild(aiEl('p', { class: 'muted ic-hint' }, 'Choisir une image l\'affiche ici pour comparaison ; elle n\'est appliquée qu\'avec « Appliquer cette image ». L\'image d\'origine reste à son pictogramme.'));
  const row = aiEl('div', { class: 'ic-strip' });
  for (const r of t.reusable) {
    const b = aiEl('button', { type: 'button', class: `ic-strip-item${r.sha === _icSel ? ' is-sel' : ''}`, 'aria-pressed': String(r.sha === _icSel), title: `Image de « ${r.name} »` });
    b.appendChild(icThumb(t, 64, r.url));
    b.appendChild(aiEl('span', {}, r.name));
    b.addEventListener('click', () => { _icSel = r.sha; _icNote = null; icRenderSheet(); });
    row.appendChild(b);
  }
  d.appendChild(row);
  if (t.reusable.some(r => r.sha === _icSel)) d.open = true;
  return d;
}

/** Pictogramme `id` tel qu'affiché en jeu : `url` (aperçu), sinon image appliquée, sinon emoji d'origine. */
function icUiGlyph(id, px, url = null) {
  const o = (_ic?.targets ?? []).find(x => x.key === `ui:${id}`);
  const src = url ?? o?.image ?? null;
  if (src) return aiEl('img', { src, alt: '', width: String(px), height: String(px), style: `width:${px}px;height:${px}px;object-fit:contain;vertical-align:middle` });
  return aiEl('span', { style: `font-size:${Math.round(px * 0.8)}px;line-height:1;vertical-align:middle` }, o?.emoji ?? '');
}

/** Rendu d'un emplacement du jeu (même tailles que le jeu) avec le pictogramme de `t` remplacé par `url`. */
function icUiScene(t, url) {
  const g = (id, px) => icUiGlyph(id, px, id === t.id ? url : null);
  const line = aiEl('div', { style: 'display:flex;align-items:center;gap:8px;width:100%;background:#1f2937;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:10px;font-size:14px;color:#e5e7eb' });
  if (t.zone === 'nav') {
    const nav = aiEl('div', { style: 'display:flex;justify-content:space-around;width:100%;background:#0b1220;border-radius:10px;padding:8px 0' });
    for (const [id, label] of [['creuser', 'Dig'], ['ameliorations', 'Amélios'], ['collection', 'Collection'], ['quotidien', 'Quotidien'], ['boutique', 'Boutique'], ['saison', 'Saison']]) {
      const c = aiEl('span', { style: `display:flex;flex-direction:column;align-items:center;gap:4px;font-size:8px;font-weight:600;color:${id === t.id ? '#f5c518' : '#9ca3af'}` });
      c.appendChild(g(id, 26));
      c.appendChild(aiEl('span', {}, label));
      nav.appendChild(c);
    }
    return nav;
  }
  if (t.zone === 'header') {
    const h = aiEl('div', { style: 'display:flex;align-items:center;justify-content:space-between;width:100%;background:#0b1220;border-radius:10px;padding:6px 10px' });
    h.appendChild(g('actualites', 26));
    h.appendChild(aiEl('strong', { style: 'color:#f5c518;font-size:18px' }, 'DIG!'));
    const r = aiEl('span', { style: 'display:flex;gap:10px' });
    r.appendChild(g('profil', 30));
    r.appendChild(g('parametres', 26));
    h.appendChild(r);
    return h;
  }
  if (t.zone === 'ranking') {
    line.appendChild(g(t.id === 'blocs_mines' ? 'medaille_or' : t.id, 18));
    line.appendChild(aiEl('span', { style: 'flex:1;font-weight:600' }, 'Pseudo'));
    line.appendChild(aiEl('span', { style: 'color:#f5c518' }, '120 m'));
    const b = aiEl('span', { style: 'color:#9ca3af;font-size:12px' });
    b.appendChild(g('blocs_mines', 15));
    b.appendChild(document.createTextNode('345'));
    line.appendChild(b);
    return line;
  }
  if (t.zone === 'currency') {
    for (const [id, txt] of [['pieces', '150'], ['gemmes', '2']]) {
      line.appendChild(g(id, 17));
      line.appendChild(aiEl('span', {}, txt));
    }
    if (!['pieces', 'gemmes'].includes(t.id)) { line.appendChild(aiEl('span', { class: 'muted' }, '·')); line.appendChild(g(t.id, 24)); }
    return line;
  }
  // Cartes : missions, améliorations, objectifs
  line.appendChild(g(t.id, 30));
  line.appendChild(aiEl('span', { style: 'flex:1;font-weight:600' }, t.name.replace(/^[^:]+ : /, '')));
  const rew = aiEl('span', { style: 'font-size:12px' });
  rew.appendChild(g('pieces', 15));
  rew.appendChild(document.createTextNode(' 100'));
  line.appendChild(rew);
  return line;
}

/** Aperçu comparatif avant / après, smartphone et ordinateur (rien n'est appliqué). */
function icUiBeforeAfter(t, sel) {
  const wrap = aiEl('section', { class: 'ic-uiprev', 'aria-label': 'Aperçu avant et après' });
  wrap.appendChild(aiEl('h4', {}, sel.published ? 'En jeu actuellement' : 'Aperçu avant / après — rien n\'est appliqué'));
  const frames = aiEl('div', { style: 'display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start' });
  for (const [label, w] of [['Smartphone (390 px)', 390], ['Ordinateur (colonne du jeu, 440 px)', 440]]) {
    const f = aiEl('div', { style: `width:${w}px;max-width:100%;background:#111827;border:1px solid #374151;border-radius:18px;padding:12px;display:flex;flex-direction:column;gap:8px` });
    f.appendChild(aiEl('span', { class: 'muted', style: 'font-size:0.72rem' }, label));
    f.appendChild(aiEl('span', { style: 'font-size:0.7rem;color:#9ca3af' }, 'Avant'));
    f.appendChild(icUiScene(t, t.image ?? null));
    if (!sel.published) {
      f.appendChild(aiEl('span', { style: 'font-size:0.7rem;color:#f5c518' }, 'Après'));
      f.appendChild(icUiScene(t, sel.url));
    }
    frames.appendChild(f);
  }
  wrap.appendChild(frames);
  return wrap;
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
  } else if (t.kind === 'item' || t.kind === 'event') {
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

['ic-kind', 'ic-state', 'ic-zone'].forEach(id => document.getElementById(id).addEventListener('change', icRenderGrid));
document.getElementById('ic-search').addEventListener('input', icRenderGrid);
admRefreshButton('btn-refresh-icons', loadIcons, 'Atelier d’icônes');
// Ctrl+Entrée (ou ⌘+Entrée) dans le champ de consigne = action principale ; Entrée seule = retour à la ligne
document.getElementById('ic-sheet').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.target.id !== 'ic-instruction') return;
  e.preventDefault();
  // « Refaire » quand il existe (jamais « Conserver cette image », placé avant dans la page), sinon « Générer »
  const step = e.target.closest('.ic-step');
  (step?.querySelector('.ic-redo .btn') ?? step?.querySelector('.ic-main'))?.click();
});

// ── Budget IA (⚙ Config) : dépenses journalisées, plafond facultatif (désactivé par défaut, décision du 03/11) ──

const _aibZone = admZone(document.getElementById('ai-budget-card'));
async function loadAiBudget() {
  const { ok, data } = await api('GET', '/api/admin/icons/job');
  const state = document.getElementById('aib-cap-state');
  const dl = document.getElementById('aib-totals');
  if (!ok) { state.textContent = data.error || 'Erreur.'; return; }
  const s = data.status;
  const reached = document.getElementById('aib-reached');
  const input = document.getElementById('ic-budget');
  const on = document.getElementById('aib-cap-on');
  if (!admZoneDirty(_aibZone)) {   // plafond en cours de saisie conservé (#61)
    if (document.activeElement !== input) input.value = s.capUsd ?? '';
    if (document.activeElement !== on) on.checked = !!s.capEnabled;
  }
  dl.textContent = '';
  const meter = document.getElementById('aib-meter-wrap');
  if (!s.configured) {
    state.textContent = 'API IA non configurée sur le serveur : aucune dépense possible.';
    state.className = 'aib-state aib-state--blocked';
    meter.classList.add('hidden');
    icNotice(reached, '');
    return;
  }
  // #62 : d'abord l'état (ce qui bloque ou non), puis les coûts observés avec leur période et leur périmètre.
  const usd = v => `${Number(v).toFixed(4)} USD`;
  const tt = s.totals ?? {};
  const month = tt.month ? new Date(`${tt.month}-15T00:00:00Z`).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const quotaFull = s.imagesToday >= s.maxImagesPerDay;
  const [kind, text] = data.job?.status === 'running' ? ['busy', `⏳ Une génération est en cours (${data.job.name ?? 'image'}) : une seule à la fois.`]
    : s.budgetReached ? ['blocked', '⛔ Génération bloquée par le plafond de dépense (détail ci-dessous).']
    : quotaFull ? ['blocked', `⛔ Images bloquées jusqu'à demain : quota de ${s.maxImagesPerDay} images sur 24 h atteint.`]
    : ['ok', '✅ Génération possible. Rien ne part sans votre clic : une image par clic, un appel à la fois, aucune génération en lot.'];
  state.textContent = text;
  state.className = `aib-state aib-state--${kind}`;
  const row = (k, v) => { dl.appendChild(aiEl('dt', {}, k)); dl.appendChild(aiEl('dd', {}, v)); };
  row(`Coût observé — ${month || 'ce mois-ci'} (mois UTC, tout Dig)`, `${usd(tt.monthUsd ?? 0)} — ${tt.monthCalls ?? 0} appel(s)`);
  row('Cumul journalisé', `${usd(tt.totalUsd ?? s.globalSpentUsd)} — ${tt.calls ?? 0} appel(s)${tt.since ? ` depuis le ${icWhen(tt.since)}` : ''} · images ${usd(tt.imagesUsd ?? 0)}, textes ${usd(tt.textUsd ?? 0)}, dont atelier d'icônes ${usd(s.studioSpentUsd)}`);
  row('Dernière image', s.lastImage ? `${usd(s.lastImage.cost_usd)} (calculé après l'appel)` : 'aucune');
  row('Limites', `${s.capEnabled ? `plafond bloquant ${Number(s.capUsd).toFixed(2)} USD (il reste ${usd(s.remainingUsd)})` : 'aucun plafond bloquant'} · ${s.imagesToday}/${s.maxImagesPerDay} images sur 24 h`);
  if (s.capEnabled) row('Avant chaque image', icReserveText(s) || '—');
  meter.classList.toggle('hidden', !s.capEnabled);
  document.getElementById('aib-meter').style.width = `${Math.min(100, s.capEnabled && s.capUsd ? (s.globalSpentUsd / s.capUsd) * 100 : 0)}%`;
  icNotice(reached, s.budgetReached ? icBudgetHelp(s) : '', 'warn');
}

document.getElementById('btn-ic-budget').addEventListener('click', async () => {
  const v = document.getElementById('ic-budget').value.trim();
  const enabled = document.getElementById('aib-cap-on').checked;
  const { ok, data } = await api('PUT', '/api/admin/icons/budget', { enabled, ...(v === '' ? {} : { capUsd: Number(v) }) });
  ptMessage('aib-msg', ok ? (enabled ? 'Plafond activé.' : 'Plafond désactivé : aucun appel n\'est bloqué par le montant.') : (data.error || 'Erreur.'), ok);
  if (ok) { admZoneClean(_aibZone); loadAiBudget(); }
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
let _bgLang = 'fr';      // langue éditée dans la fiche (une seule visible à la fois, recette #38-A)
let _bgRO = false;       // fiche en lecture seule (proposition déjà traitée)

/** Critère lisible, dans la langue demandée (recette #38-C) : mêmes textes que la fiche du joueur
 *  (clés badges.cond.* du jeu, repli français), nom du bloc traduit si le catalogue le fournit. */
function bgCondLabel(b, lang = 'fr') {
  if (!b.condition) return '⚠ critère non pris en charge';
  const bt = (_bgData?.blockTypes || []).find(t => t.id === b.blockId);
  const tpl = I18n.get(`badges.cond.${b.condition}`, lang) || I18n.get(`badges.cond.${b.condition}`, 'fr') || BG_COND[b.condition] || b.condition;
  const blockName = bt ? (bt.names?.[lang] || I18n.get(`block.${bt.id}`, lang) || bt.name) : '';
  const intl = DigLanguages.get(lang)?.intl || lang;
  return tpl.replace('{n}', Number(b.threshold).toLocaleString(intl))
    .replace('{block}', bt ? `${bt.icon} ${blockName}` : (b.blockId || '?'));
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
  document.getElementById('bg-block').disabled = cond !== 'blocks_of_type' || _bgRO;
  document.getElementById('bg-block-label').classList.toggle('hidden', cond !== 'blocks_of_type');
  document.getElementById('bg-metric-help').textContent = BG_METRIC_FR[cond] ?? '';
  bgLivePreview();
}

/** Langue éditée : une seule visible à la fois (comme la fiche Actualités #50) ; les autres gardent leurs saisies. */
function bgLang(l, focus = false) {
  _bgLang = l;
  for (const b of document.querySelectorAll('#bg-langs .co-lang-btn')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
  for (const d of document.querySelectorAll('#bg-dialog .nw-lang-fields')) d.classList.toggle('hidden', d.dataset.lang !== l);
  bgLivePreview();
  if (focus) document.querySelector(`#bg-langs .co-lang-btn[data-lang="${l}"]`).focus();
}

/** Aperçu tel que le joueur le verra dans la langue éditée (repli sur le français, comme dans le jeu). */
function bgLivePreview() {
  const f = bgReadForm();
  const l = _bgLang;
  bgArt(document.getElementById('bg-pv-art'), f.image, f.icon || '🏅', 56);
  document.getElementById('bg-pv-h').textContent = `Aperçu joueur (${l.toUpperCase()})${l !== 'fr' && !f.names[l] ? ' — texte français affiché' : ''}`;
  document.getElementById('bg-pv-name').textContent = f.names[l] || f.names.fr || '(nom FR obligatoire)';
  document.getElementById('bg-pv-desc').textContent = f.descriptions[l] || f.descriptions.fr || '(description FR obligatoire)';
  document.getElementById('bg-pv-cond').textContent = `${bgCondLabel(f, l)}${f.visibility === 'hidden' ? ' · secret' : ''}${f.startsAt || f.endsAt ? ` · événement ${f.startsAt || '…'} → ${f.endsAt || '…'}` : ''}`;
  // Pastilles des langues
  for (const b of document.querySelectorAll('#bg-langs .co-lang-btn')) {
    const x = b.dataset.lang;
    const st = !f.names[x] ? 'none' : f.descriptions[x] ? 'ok' : 'name';
    b.className = `co-lang-btn co-lang--${st}`;
    b.textContent = `${{ ok: '●', name: '◐', none: '○' }[st]} ${x.toUpperCase()}`;
    b.title = { ok: 'nom et description', name: 'nom seul : description manquante', none: 'à traduire (le français sera affiché)' }[st];
  }
  // Référence française quand on traduit
  const ref = [f.names.fr, f.descriptions.fr].filter(Boolean).join(' — ');
  document.getElementById('bg-fr-ref').classList.toggle('hidden', l === 'fr' || !ref);
  document.getElementById('bg-fr-ref-text').textContent = ref;
  // Résumé des options avancées, lisible sans les déplier
  document.getElementById('bg-adv-sum').textContent = `— ${f.visibility === 'hidden' ? 'secret' : 'visible'} · ordre ${f.sort}`
    + ` · ${f.startsAt || f.endsAt ? `période ${f.startsAt || '…'} → ${f.endsAt || '…'}` : 'permanent'}`;
  const dlg = document.getElementById('bg-dialog');
  document.getElementById('bg-dirty').classList.toggle('hidden', !dlg._admDirty?.());
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
  _bgRO = !editable;
  for (const el of document.querySelectorAll('#bg-dialog .bg-ro')) el.inert = _bgRO;
  document.getElementById('bg-id').disabled = mode === 'edit';
  bgLang('fr');
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
  show('bg-status-sec', mode === 'edit' || (mode === 'proposal' && ['open', 'error'].includes(p.status)));
  show('btn-bg-toggle', mode === 'edit');
  show('btn-bg-archive', mode === 'edit' && b.status !== 'archived');
  show('btn-bg-studio', mode === 'edit' && b.status !== 'archived');
  show('btn-bg-prop-discard', mode === 'proposal' && ['open', 'error'].includes(p.status));
  if (mode === 'edit') document.getElementById('btn-bg-toggle').textContent = b.status === 'active' ? 'Désactiver' : 'Activer…';
  ptMessage('bg-form-msg', '', true);
  document.getElementById('bg-dirty').classList.add('hidden');
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
document.getElementById('bg-dialog').addEventListener('input', bgLivePreview);
document.getElementById('bg-dialog').addEventListener('change', bgLivePreview);
document.querySelectorAll('#bg-langs .co-lang-btn').forEach((b, k, all) => {
  b.addEventListener('click', () => bgLang(b.dataset.lang));
  b.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    bgLang(all[(k + step + all.length) % all.length].dataset.lang, true);
  });
});
for (const id of ['bg-filter-text', 'bg-filter-category', 'bg-filter-status']) document.getElementById(id).addEventListener('input', bgRenderList);
admRefreshButton('btn-refresh-badges', loadBadges, 'Badges');

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
  if (!body.names.fr || !body.descriptions.fr) bgLang('fr');
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
    && !await admAsk('Ce badge est ACTIF : les modifications seront visibles immédiatement par les joueurs. Enregistrer ?')) return;
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
  if (!b || (warn && !await admAsk(warn))) return;
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
document.getElementById('btn-bg-studio').addEventListener('click', async () => {
  const id = _bgSheet?.badge?.id;
  if (!await document.getElementById('bg-dialog')._admRequestClose()) return;   // saisies non enregistrées : confirmation (#61)
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  if (id) icOpen(`badge:${id}`);
});
document.getElementById('btn-bg-prop-discard').addEventListener('click', async () => {
  const p = _bgSheet?.proposal;
  if (!p || !await admAsk('Abandonner cette proposition ? Aucun badge n\'est créé.')) return;
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
    ? `IA : ${st.textModel}${st.fake ? ' (mode test)' : ''} — ${st.capEnabled ? `budget restant ≈ ${st.remainingUsd.toFixed(2)} / ${st.budgetUsd} USD` : `dépensé ${st.spentUsd} USD, aucun plafond bloquant`}, texte ≈ ${st.estTextUsd} USD par proposition ; ${st.callsToday}/${st.maxCallsPerDay} appels sur 24 h.`
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
  if (!p || !await admAsk('Annuler cette proposition ? Aucun badge n\'est créé.')) return;
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

// Réglages et codes collés non enregistrés conservés au rechargement (#61) ; interrupteur général hors suivi.
const _adSetZone = admZone(document.getElementById('ad-provider').closest('.overview-card'));
const _adPromoZone = admZone(document.getElementById('ad-promo-card'));
const _adSlotsZone = admZone(document.getElementById('ad-slots'), {
  dirty: () => [...document.querySelectorAll('#ad-slots textarea')].some(t => t.value.trim()),
});
function renderAds(data, savedSlot = null) {
  const s = data.settings;
  const banner = document.getElementById('ad-banner');
  const live = data.effective.filter(e => e.enabled).map(e => e.host);
  banner.className = `contest-banner contest-banner--${live.length ? 'open' : 'locked'}`;
  banner.textContent = data.killSwitch ? '⛔ Publicité coupée par ADS_DISABLED (environnement).'
    : live.length ? `📢 Publicité ACTIVE sur : ${live.join(', ')} (après consentement du joueur).`
    : '🔒 Aucune publicité diffusée.';

  if (!admZoneDirty(_adSetZone)) {
    const sel = document.getElementById('ad-provider');
    sel.textContent = '';
    sel.appendChild(new Option('— aucune —', ''));
    for (const p of data.providers) sel.appendChild(new Option(p.label, p.id));
    sel.value = s.provider;
    document.getElementById('ad-hosts').value = s.allowedHosts.join(', ');
    document.getElementById('ad-contact').value = s.legalContact;
    document.getElementById('ad-adstxt').value = s.adsTxt;
    document.getElementById('ad-bump').checked = false;
  }
  document.getElementById('ad-enabled').checked = s.enabled;
  document.getElementById('ad-confirm').value = '';
  renderAdPromo(data.promo);

  const box = document.getElementById('ad-slots');
  // Code collé dans un autre emplacement (jamais réaffiché par le serveur) : conservé au re-rendu.
  const pasted = Object.fromEntries([...box.querySelectorAll('textarea[data-slot]')].map(t => [t.dataset.slot, t.value]));
  box.textContent = '';
  for (const slot of data.slots) {
    const card = document.createElement('div');
    card.className = 'overview-card adm-slot';
    const title = document.createElement('h4');
    title.textContent = `${slot.label} — ${slot.enabled ? 'activé' : 'désactivé'} — ${slot.configured ? `code enregistré (clé …${slot.adKey.slice(-6)}, script ${slot.scriptHost})` : 'aucun code'}`;
    card.appendChild(title);
    const ta = document.createElement('textarea');
    ta.rows = 4; ta.className = 'adm-code';
    ta.setAttribute('aria-label', `Code de l\u2019unité — ${slot.label}`);
    ta.placeholder = 'Coller ici le code « GET CODE » de l\u2019unité (atOptions + script). Il est analysé, jamais exécuté dans le panel.';
    ta.dataset.slot = slot.slot;
    if (String(slot.slot) !== String(savedSlot) && pasted[slot.slot]) ta.value = pasted[slot.slot];
    card.appendChild(ta);
    // Recette du 04/11 : case et libellé sur une même ligne cliquable, actions regroupées dessous.
    const row = document.createElement('div');
    row.className = 'adm-toggles';
    const mk = (labelText, checked) => {
      const l = document.createElement('label'); const c = document.createElement('input'); const span = document.createElement('span');
      l.className = 'adm-toggle'; c.type = 'checkbox'; c.checked = checked; span.textContent = labelText;
      l.append(c, span); row.appendChild(l); return c;
    };
    const en = mk('Emplacement activé', slot.enabled);
    const hide = mk('Masquer sur l\u2019écran de minage', slot.hideOnDig);
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'btn'; save.textContent = 'Enregistrer l\u2019emplacement';
    save.addEventListener('click', async () => {
      const { ok, data: d } = await api('PUT', `/api/admin/ads/slots/${slot.slot}`, { snippet: ta.value, enabled: en.checked, hideOnDig: hide.checked });
      if (!ok) return adMessage('ad-slot-msg', d.error || 'Erreur.', false);
      adMessage('ad-slot-msg', 'Emplacement enregistré.', true);
      renderAds(d, slot.slot);
    });
    const clear = document.createElement('button');
    clear.type = 'button'; clear.className = 'btn btn-outline'; clear.textContent = 'Effacer le code';
    clear.disabled = !slot.configured;
    clear.addEventListener('click', async () => {
      if (!await admAsk('Effacer le code de cet emplacement (il sera désactivé) ?')) return;
      const { ok, data: d } = await api('PUT', `/api/admin/ads/slots/${slot.slot}`, { clearCode: true, enabled: false });
      if (!ok) return adMessage('ad-slot-msg', d.error || 'Erreur.', false);
      renderAds(d, slot.slot);
    });
    const actions = document.createElement('div');
    actions.className = 'adm-action-bar';
    const spacer = document.createElement('span');
    spacer.className = 'adm-action-spacer';
    actions.append(clear, spacer, save);
    card.append(row, actions);
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

// Promotion interne DIG! (04/11) : état, réglages et aperçu aux deux tailles (même création que le jeu).
function renderAdPromo(promo) {
  const state = document.getElementById('ad-promo-state');
  state.textContent = promo.killSwitch ? '⛔ Coupée par PROMO_DISABLED (environnement).'
    : promo.enabled ? '✅ Promotion ACTIVE : visible dans les emplacements hauts sans annonce de régie.'
    : '🔒 Promotion désactivée : rien ne s\u2019affiche.';
  if (!admZoneDirty(_adPromoZone)) {
    document.getElementById('ad-promo-enabled').checked = promo.enabled;
    for (const sl of promo.slots) document.getElementById(`ad-promo-hide-${sl.slot}`).checked = sl.hideOnDig;
    admZoneClean(_adPromoZone);
  }
  const fr = k => (typeof I18n !== 'undefined' && I18n.get(`promo.${k}`, 'fr')) || k;
  const labels = { tag: fr('tag'), title: fr('title'), text: fr('text'), cta: fr('cta'), ctaShort: fr('cta_short') };
  for (const sl of promo.slots) {
    const frame = document.getElementById(`ad-promo-preview-${sl.slot}`);
    if (!frame || typeof DigGemCallout === 'undefined') continue;
    frame.textContent = '';
    frame.appendChild(DigGemCallout.create(sl.slot, labels));
  }
}

document.getElementById('btn-ad-promo').addEventListener('click', async () => {
  const hideOnDig = Object.fromEntries(['top_mobile', 'top_desktop']
    .map(sl => [sl, document.getElementById(`ad-promo-hide-${sl}`).checked]));
  const { ok, data } = await api('PUT', '/api/admin/ads/promo', {
    enabled: document.getElementById('ad-promo-enabled').checked, hideOnDig,
  });
  if (!ok) return adMessage('ad-promo-msg', data.error || 'Erreur.', false);
  adMessage('ad-promo-msg', data.promo.enabled ? 'Promotion enregistrée — ACTIVE pour les joueurs (au prochain chargement de page).' : 'Promotion enregistrée — désactivée.', true);
  admZoneClean(_adPromoZone);
  renderAds(data);
});

async function loadAds() {
  const { ok, data } = await api('GET', '/api/admin/ads');
  if (!ok) { adMessage('ad-settings-msg', data.error || 'Erreur lors du chargement.', false); return; }
  renderAds(data);
}

admRefreshButton('btn-refresh-ads', loadAds, 'Publicité');

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
  admZoneClean(_adSetZone);
  renderAds(data);
});

document.getElementById('btn-ad-toggle').addEventListener('click', async () => {
  const { ok, data } = await api('PUT', '/api/admin/ads/settings', {
    enabled: document.getElementById('ad-enabled').checked,
    confirm: document.getElementById('ad-confirm').value.trim(),
  });
  if (!ok) return adMessage('ad-toggle-msg', data.error || 'Erreur.', false);
  adMessage('ad-toggle-msg', data.settings.enabled ? 'Interrupteur général ACTIVÉ.' : 'Interrupteur général désactivé.', true);
  renderAds(data);
});

// ── Coffres & drops (#37, objectif 4) ─────────────────────────────────────────
// Tables de récompenses versionnées (server/rewardTables.js) : la page montre la version en vigueur
// (ou le brouillon s'il existe) ; clic sur un coffre → fiche d'édition de ses lignes → « Enregistrer
// dans le brouillon » ; publication et retour arrière comme pour les blocs.

const RW_NAMES = {
  shop:  { simple: '📦 Coffre simple', rare: '💎 Coffre rare', antique: '🏺 Coffre antique' },
  mined: { commun: '🧰 Vieille caisse (bloc commun)', rare: '🪵 Coffre en bois (bloc rare)', epique: '🔩 Coffre en fer (bloc épique)' },
};
const RW_TYPES = { coins: '💰 Pièces', relics: '🔮 Fragments', boost: '⚡ Boost de gains', collection: '📿 Objet de collection' };
const RW_ACTIONS = { migrate: 'création v1', draft_save: 'brouillon enregistré', draft_clean: 'brouillon identique retiré',
  draft_discard: 'brouillon abandonné', publish: 'publication', rollback: 'retour arrière' };
let _rw = null;          // vue GET /api/admin/rewards
let _rwEdit = null;      // { family, id } du coffre ouvert dans la fiche

const rwFmt = n => Number(n).toLocaleString('fr-BE');

function rwRowLabel(r) {
  if (r.type === 'coins')  return `${RW_TYPES.coins} ${rwFmt(r.min)}–${rwFmt(r.max)}${r.jackpot ? ' · gros lot' : ''}`;
  if (r.type === 'relics') return `${RW_TYPES.relics} × ${rwFmt(r.amount)}`;
  if (r.type === 'boost')  return `${RW_TYPES.boost} ×${r.mult}, ${r.minutes} min`;
  return RW_TYPES.collection;
}

/** Tables affichées : brouillon s'il existe (et lisible), sinon version en vigueur. */
function rwCurrentTables() {
  return structuredClone(_rw.draft?.tables ?? _rw.published.tables);
}

function rwStats(table) {
  const total = table.reduce((s, r) => s + (Number(r.weight) > 0 ? Number(r.weight) : 0), 0) || 1;
  let coins = 0, fragments = 0;
  const chances = table.map(r => {
    const p = (Number(r.weight) > 0 ? Number(r.weight) : 0) / total;
    if (r.type === 'coins') coins += p * (Number(r.min) + Number(r.max)) / 2;
    if (r.type === 'relics') fragments += p * Number(r.amount);
    return p * 100;
  });
  return { chances, coins: Math.round(coins), fragments: Math.round(fragments * 100) / 100 };
}

function rwChanged(family, id) {
  return (_rw.draft?.changes ?? []).some(c => c.family === family && c.id === id);
}

function rwRenderFamily(family, el) {
  const tables = rwCurrentTables();
  el.textContent = '';
  for (const id of (family === 'shop' ? _rw.shopIds : _rw.minedIds)) {
    const def = family === 'shop' ? tables.shop[id] : { table: tables.mined[id] };
    const st = rwStats(def.table);
    const wrap = document.createElement('div');
    wrap.className = 'rw-chest';
    const h = document.createElement('h4');
    const cost = family === 'shop' ? _rw.costs[id] : null;
    h.textContent = `${RW_NAMES[family][id]}${rwChanged(family, id) ? ' — modifié dans le brouillon' : ''}`;
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.style.fontSize = '0.8rem';
    meta.textContent = [
      cost ? `Prix ${rwFmt(cost)} pièces` : null,
      family === 'shop' ? (def.maxPerSeason ? `max ${def.maxPerSeason} par saison` : 'illimité') : null,
      `en moyenne ${rwFmt(st.coins)} pièces${cost ? ` (${Math.round(st.coins / cost * 100)} % du prix)` : ''} et ${st.fragments} fragments par ouverture`,
    ].filter(Boolean).join(' · ');
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Chance</th><th>Récompense</th></tr></thead>';
    const tb = document.createElement('tbody');
    def.table.forEach((r, i) => {
      const tr = document.createElement('tr');
      addCell(tr, `${st.chances[i].toFixed(2)} %`);
      addCell(tr, rwRowLabel(r));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = '✎ Modifier ce coffre';
    btn.dataset.admKey = `rw-${family}-${id}`;
    btn.addEventListener('click', () => rwOpen(family, id, btn));
    wrap.append(h, meta, table, btn);
    el.appendChild(wrap);
  }
}

function rwRender() {
  const d = _rw.draft;
  document.getElementById('rw-banner').textContent = `Version en vigueur : v${_rw.published.version}` +
    (d ? ` — brouillon en cours (${d.changes.length} coffre(s) modifié(s), non visible en jeu)` : ' — aucun brouillon');
  rwRenderFamily('shop', document.getElementById('rw-shop'));
  rwRenderFamily('mined', document.getElementById('rw-mined'));

  const box = document.getElementById('rw-draft');
  box.textContent = '';
  if (!d) {
    box.innerHTML = '<p class="muted">Aucun brouillon : modifiez un coffre pour en créer un.</p>';
  } else {
    const ul = document.createElement('ul');
    for (const c of d.changes) {
      const li = document.createElement('li');
      const parts = c.rows.map(r => `ligne ${r.row} : ${r.before ? rwRowLabel(r.before) + ` (poids ${r.before.weight})` : '—'} → ${r.after ? rwRowLabel(r.after) + ` (poids ${r.after.weight})` : 'supprimée'}`);
      if (c.maxPerSeason) parts.push(`limite par saison : ${c.maxPerSeason[0] ?? 'illimité'} → ${c.maxPerSeason[1] ?? 'illimité'}`);
      li.textContent = `${RW_NAMES[c.family][c.id]} — ${parts.join(' ; ')}`;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    for (const [list, cls] of [[d.errors, 'error'], [d.warnings, 'muted']]) {
      for (const e of list) { const p = document.createElement('p'); p.className = cls; p.textContent = (cls === 'error' ? '⛔ ' : '⚠ ') + e; box.appendChild(p); }
    }
  }
  document.getElementById('btn-rw-sim-draft').disabled = !d;
  document.getElementById('btn-rw-publish').disabled = !d || d.errors.length > 0;
  document.getElementById('btn-rw-discard').disabled = !d;

  const vb = document.getElementById('rw-versions');
  vb.textContent = '';
  for (const v of _rw.versions) {
    const tr = document.createElement('tr');
    const src = { origin: 'origine', publish: 'publication', rollback: `retour à v${v.fromVersion}` }[v.source] ?? v.source;
    [`v${v.version}${v.version === _rw.published.version ? ' (en vigueur)' : ''}`, src, v.note ?? '', v.createdAt].forEach(x => addCell(tr, x));
    const td = document.createElement('td');
    if (v.version !== _rw.published.version) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-outline'; b.textContent = `Revenir à v${v.version}`;
      b.addEventListener('click', () => rwRollback(v.version));
      td.appendChild(b);
    }
    tr.appendChild(td);
    vb.appendChild(tr);
  }
}

async function loadRewards() {
  const [view, audit] = await Promise.all([api('GET', '/api/admin/rewards'), api('GET', '/api/admin/rewards/audit')]);
  if (!view.ok) { ptMessage('rw-msg', view.data.error || 'Erreur lors du chargement.', false); return; }
  _rw = view.data;
  rwRender();
  loadRewardVisuals();   // #66 : indépendant des tables (une erreur ici n'empêche pas leur affichage)
  const ab = document.getElementById('rw-audit');
  ab.textContent = '';
  for (const a of (audit.ok ? audit.data.audit : [])) {
    const tr = document.createElement('tr');
    const det = a.details?.changes ? a.details.changes.map(c => RW_NAMES[c.family]?.[c.id] ?? c.id).join(', ') : (a.details?.to ? `contenu de v${a.details.to}` : '');
    [a.created_at, RW_ACTIONS[a.action] ?? a.action, a.version ? `v${a.version}` : '', det].forEach(x => addCell(tr, x));
    ab.appendChild(tr);
  }
}

admRefreshButton('btn-refresh-rewards', loadRewards, 'Coffres & drops');

// ── Visuels des six coffres (#66) : lien direct vers la cible de l'atelier d'icônes ──
// Aucune écriture ici : l'état vient de GET /api/admin/icons/chests, les actions se font dans l'atelier.

/** Où en est le visuel : proposition (jamais vue des joueurs), conservée (brouillon des blocs), en jeu. */
function rwVisualState(t) {
  const props = t.candidates ? `${t.candidates} proposition${t.candidates > 1 ? 's' : ''}` : 'aucune proposition';
  if (t.kind === 'chest') return `${props} · ${t.image ? 'image appliquée en jeu' : `en jeu : emoji d'origine ${t.emoji}`}`;
  const live = t.publishedImage ? 'image de l\'atelier en jeu' : t.v1 ? `en jeu : image v1 (${t.v1.status})` : `en jeu : emoji d'origine ${t.emoji}`;
  return `${props} · ${t.unpublished ? (t.image ? 'image conservée dans le brouillon, à publier dans 🧱 Blocs' : 'retour à l\'emoji dans le brouillon, à publier') : 'brouillon identique au jeu'} · ${live}`;
}

async function loadRewardVisuals() {
  const box = document.getElementById('rw-visuals');
  if (!box) return;
  const { ok, data } = await api('GET', '/api/admin/icons/chests');
  box.textContent = '';
  if (!ok) { box.appendChild(aiEl('p', { class: 'error' }, data.error || 'Visuels indisponibles.')); return; }
  for (const c of data.chests) {
    const tile = aiEl('div', { class: 'rw-visual', 'data-adm-key': `rw-visual:${c.key}` });
    const t = c.target;
    tile.appendChild(t ? icThumb(t, 56) : aiEl('span', { class: 'bk-thumb ic-thumb ic-thumb--none', style: 'width:56px;height:56px' }, '?'));
    const info = aiEl('div', { class: 'rw-visual-info' });
    info.appendChild(aiEl('strong', {}, `${c.family === 'shop' ? '🛍' : '⛏'} ${c.name}`));
    if (t) info.appendChild(icBadge(icState(t)));
    info.appendChild(aiEl('span', { class: 'muted rw-visual-state' }, t ? rwVisualState(t) : (c.error || 'Cible introuvable.')));
    info.appendChild(aiEl('code', { class: 'muted rw-visual-key' }, `Atelier : ${c.key}`));
    const b = aiEl('button', { type: 'button', class: 'btn btn-outline', 'aria-label': `Ouvrir le visuel de ${c.name} dans l'atelier d'icônes` }, '🎨 Ouvrir dans l\'atelier');
    b.disabled = !t;
    b.addEventListener('click', () => rwOpenStudio(c.key));
    info.appendChild(b);
    tile.appendChild(info);
    box.appendChild(tile);
  }
}

/** Ouvre la fiche du coffre dans l'atelier (consigne préremplie, rien n'est généré ni appliqué). */
async function rwOpenStudio(key) {
  const dlg = document.getElementById('rw-dialog');
  if (dlg?.open) {
    if (dlg._admDirty?.() && !await admConfirmDiscard({ keep: 'Enregistrer dans le brouillon', effect: 'ferme la fiche, perd ces saisies et ouvre l\'atelier d\'icônes.' })) return;
    dlg.close();
  }
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  _icFrom = { kind: 'rewards', key };
  icOpen(key);
}

/** Retour de l'atelier vers Coffres & drops (visuels rechargés), sur la carte des visuels. */
async function rwBackFromStudio() {
  _icFrom = null;
  document.querySelector('.tab-btn[data-tab="rewards"]').click();
  document.getElementById('rw-visuals-card')?.scrollIntoView({ block: 'start' });
}

// ── Fiche d'un coffre ─────────────────────────────────────────────────────────

const RW_FIELDS = {
  coins:      [['min', 'Pièces min'], ['max', 'Pièces max']],
  relics:     [['amount', 'Fragments']],
  boost:      [['mult', 'Multiplicateur'], ['minutes', 'Minutes']],
  collection: [],
};

function rwRowEditor(row) {
  const tr = document.createElement('tr');
  const chance = document.createElement('td');
  chance.className = 'rw-chance';
  const tdW = document.createElement('td');
  const w = document.createElement('input');
  w.type = 'number'; w.min = '0'; w.step = 'any'; w.value = row.weight; w.dataset.f = 'weight'; w.style.width = '6em';
  w.setAttribute('aria-label', 'Poids de tirage');
  tdW.appendChild(w);
  const tdT = document.createElement('td');
  const sel = document.createElement('select');
  sel.dataset.f = 'type';
  sel.setAttribute('aria-label', 'Type de récompense');
  for (const t of (_rwEdit.family === 'shop' ? _rw.shopTypes : _rw.minedTypes)) sel.add(new Option(RW_TYPES[t], t, false, t === row.type));
  tdT.appendChild(sel);
  const tdV = document.createElement('td');
  const fill = () => {
    tdV.textContent = '';
    for (const [k, label] of RW_FIELDS[sel.value]) {
      const l = document.createElement('label');
      l.className = 'rw-inline';
      const i = document.createElement('input');
      i.type = 'number'; i.step = k === 'mult' ? '0.1' : '1'; i.min = '0'; i.dataset.f = k; i.style.width = '7em';
      i.value = row[k] ?? '';
      l.append(`${label} `, i);
      tdV.appendChild(l);
    }
    if (sel.value === 'coins' && _rwEdit.family === 'shop') {
      const l = document.createElement('label');
      l.className = 'rw-inline';
      const c = document.createElement('input');
      c.type = 'checkbox'; c.dataset.f = 'jackpot'; c.checked = !!row.jackpot;
      l.append(c, ' gros lot');
      tdV.appendChild(l);
    }
    if (sel.value === 'collection') tdV.append('1 objet manquant au hasard (sinon 5 fragments)');
  };
  sel.addEventListener('change', () => { fill(); rwDlgRefresh(); });
  fill();
  const tdX = document.createElement('td');
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'btn btn-outline'; x.textContent = '✕'; x.title = 'Retirer cette ligne';
  x.setAttribute('aria-label', 'Retirer cette ligne');
  x.addEventListener('click', () => { tr.remove(); rwDlgRefresh(); tr._rwRemoved = true; });
  tdX.appendChild(x);
  tr.append(chance, tdW, tdT, tdV, tdX);
  return tr;
}

function rwDlgRows() {
  return [...document.querySelectorAll('#rw-dlg-rows tr')].map(tr => {
    const row = {};
    for (const el of tr.querySelectorAll('[data-f]')) {
      const f = el.dataset.f;
      if (f === 'type') row.type = el.value;
      else if (f === 'jackpot') { if (el.checked) row.jackpot = true; }
      else row[f] = el.value === '' ? null : Number(el.value);
    }
    if (row.type === 'collection') row.amount = 1;
    return row;
  });
}

function rwDlgRefresh() {
  const rows = rwDlgRows();
  const st = rwStats(rows);
  [...document.querySelectorAll('#rw-dlg-rows tr')].forEach((tr, i) => { tr.querySelector('.rw-chance').textContent = `${st.chances[i].toFixed(2)} %`; });
  const cost = _rwEdit.family === 'shop' ? _rw.costs[_rwEdit.id] : null;
  const sum = rows.reduce((s, r) => s + (Number(r.weight) > 0 ? Number(r.weight) : 0), 0);
  document.getElementById('rw-dlg-summary').textContent = `Somme des poids : ${rwFmt(Math.round(sum * 10000) / 10000)} (convertie en 100 %) · en moyenne ${rwFmt(st.coins)} pièces` +
    `${cost ? ` pour un prix de ${rwFmt(cost)} (${Math.round(st.coins / cost * 100)} %)` : ''} et ${st.fragments} fragments par ouverture.`;
}

function rwOpen(family, id, opener) {
  _rwEdit = { family, id };
  const tables = rwCurrentTables();
  const def = family === 'shop' ? tables.shop[id] : { table: tables.mined[id] };
  document.getElementById('rw-dialog-title').textContent = RW_NAMES[family][id];
  document.getElementById('rw-dlg-max-wrap').classList.toggle('hidden', family !== 'shop');
  document.getElementById('rw-dlg-max').value = def.maxPerSeason ?? '';
  const tb = document.getElementById('rw-dlg-rows');
  tb.textContent = '';
  def.table.forEach(r => tb.appendChild(rwRowEditor(r)));
  document.getElementById('rw-dlg-error').classList.add('hidden');
  rwDlgRefresh();
  admDialogOpen('rw-dialog', opener);
}

const _rwDlg = admDialogSetup('rw-dialog', { keep: 'Enregistrer dans le brouillon' });
let _rwStructural = false;   // ligne ajoutée ou retirée (le suivi générique ne voit que les champs)
_rwDlg.addEventListener('close', () => { _rwStructural = false; });
_rwDlg._admDirty = (orig => () => _rwDlg.open && (_rwStructural || orig()))(_rwDlg._admDirty);
document.getElementById('rw-dlg-rows').addEventListener('input', rwDlgRefresh);
document.getElementById('rw-dlg-rows').addEventListener('click', e => { if (e.target.closest('button')) _rwStructural = true; });
document.getElementById('btn-rw-add-row').addEventListener('click', () => {
  _rwStructural = true;
  document.getElementById('rw-dlg-rows').appendChild(rwRowEditor({ weight: 1, type: 'relics', amount: 1 }));
  rwDlgRefresh();
});

document.getElementById('btn-rw-save').addEventListener('click', async () => {
  const tables = rwCurrentTables();
  const rows = rwDlgRows();
  if (_rwEdit.family === 'shop') {
    const max = document.getElementById('rw-dlg-max').value;
    tables.shop[_rwEdit.id] = { maxPerSeason: max === '' ? null : Number(max), table: rows };
  } else {
    tables.mined[_rwEdit.id] = rows;
  }
  const err = document.getElementById('rw-dlg-error');
  const { ok, data } = await api('PUT', '/api/admin/rewards/draft', { tables });
  if (!ok) { err.textContent = [data.error, ...(data.details ?? [])].join(' '); err.classList.remove('hidden'); return; }
  const mine = data.errors.filter(e => e.includes(_rwEdit.id));
  _rwStructural = false;
  _rwDlg.close();
  await loadRewards();
  admToast(data.draft ? (mine.length ? `Enregistré dans le brouillon, à corriger avant publication : ${mine.join(' ')}` : 'Enregistré dans le brouillon (rien ne change en jeu avant publication).')
    : 'Identique à la version en vigueur : aucun brouillon.', { error: mine.length > 0 });
});

// ── Simulation, publication, retour arrière ───────────────────────────────────

async function rwSimulate(source) {
  const n = Number(document.getElementById('rw-sim-n').value);
  const { ok, data } = await api('POST', '/api/admin/rewards/simulate', { source, n });
  const box = document.getElementById('rw-sim');
  box.textContent = '';
  if (!ok) { ptMessage('rw-msg', [data.error, ...(data.details ?? [])].join(' '), false); return; }
  const h = document.createElement('h4');
  h.textContent = `Simulation ${source === 'draft' ? 'du brouillon' : 'de la version en vigueur'} — ${rwFmt(n)} ouvertures par coffre`;
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Coffre</th><th>Récompense</th><th>Probabilité</th><th>Observé</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const r of data.results) {
    r.rows.forEach((row, i) => {
      const tr = document.createElement('tr');
      [i === 0 ? RW_NAMES[r.family][r.id] : '', rwRowLabel(row), `${row.chance.toFixed(2)} %`, `${row.observed.toFixed(2)} %`].forEach(x => addCell(tr, x));
      tb.appendChild(tr);
    });
    const tr = document.createElement('tr');
    tr.className = 'muted';
    ['', 'Moyenne par ouverture', `${rwFmt(r.expectedCoins)} pièces · ${r.expectedFragments} fragments`, `${rwFmt(r.observedCoins)} pièces · ${r.observedFragments} fragments`].forEach(x => addCell(tr, x));
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  const wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';
  wrap.appendChild(table);
  box.append(h, wrap);
}
document.getElementById('btn-rw-sim-pub').addEventListener('click', () => rwSimulate('published'));
document.getElementById('btn-rw-sim-draft').addEventListener('click', () => rwSimulate('draft'));

document.getElementById('btn-rw-publish').addEventListener('click', async () => {
  const d = _rw?.draft;
  if (!d) return;
  const note = await admPrompt({ title: 'Publier les tables de coffres',
    text: `Version v${_rw.published.version + 1} : ${d.changes.map(c => RW_NAMES[c.family][c.id]).join(', ')}. Visible des joueurs dès la publication (prochaines ouvertures) ; retour arrière possible.`,
    label: 'Note (facultative)', ok: 'Publier' });
  if (note === null) return;
  const { ok, data } = await api('POST', '/api/admin/rewards/publish', { note, basedOn: _rw.published.version });
  ptMessage('rw-msg', ok ? `Version v${data.version} publiée.` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) loadRewards();
});

document.getElementById('btn-rw-discard').addEventListener('click', async () => {
  if (!_rw?.draft) return;
  if (!await admConfirm({ title: 'Abandonner le brouillon', text: 'Toutes les modifications non publiées des coffres sont perdues.',
    impact: ['La version en vigueur ne change pas.'], ok: 'Abandonner le brouillon', danger: true })) return;
  const { ok, data } = await api('DELETE', '/api/admin/rewards/draft');
  ptMessage('rw-msg', ok ? 'Brouillon abandonné.' : data.error, ok);
  if (ok) loadRewards();
});

async function rwRollback(version) {
  if (!await admConfirm({ title: `Revenir à v${version}`, text: `Publie une nouvelle version reprenant le contenu de v${version}.`,
    impact: ['Visible des joueurs dès la publication (prochaines ouvertures).', 'Les versions existantes ne sont pas modifiées : on peut revenir de nouveau.'],
    ok: `Revenir à v${version}`, danger: true })) return;
  const { ok, data } = await api('POST', '/api/admin/rewards/rollback', { version });
  ptMessage('rw-msg', ok ? `Version v${data.version} publiée (contenu de v${data.restored}).` : [data.error, ...(data.details ?? [])].join(' '), ok);
  if (ok) loadRewards();
}

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
  catch { admPrompt({ title: 'Copie impossible ici', text: 'Sélectionnez le texte ci-dessous puis copiez-le (Ctrl+C).', label: 'À copier', value: text, type: 'textarea', ok: 'Fermer' }); return false; }
  btn.textContent = '✓ Copié';
  setTimeout(() => { btn.textContent = label; }, 1800);
  admToast('Copié dans le presse-papiers.');
  return true;
}

/** Confirmation brève en bas de l'écran (aucune action requise). */
function admToast(text, { error = false } = {}) {
  let el = document.getElementById('adm-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'adm-toast';
    el.className = 'adm-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.toggle('is-err', error);
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

  if (document.getElementById('beta-manage-dialog').open) betaManageRender();

  const c = data.reports.counts;
  const showArchived = document.getElementById('beta-reports-view').value === 'archived';
  const reports = data.reports.reports.filter(r => !!r.archivedAt === showArchived);
  document.getElementById('beta-reports-counts').textContent = `${Object.entries(BETA_STATUS).map(([k, l]) => `${l} : ${c[k] || 0}`).join(' · ')} · archivés : ${c.archived || 0}`;
  const list = document.getElementById('beta-reports-list');
  // Rafraîchir ne doit rien faire perdre : fiches ouvertes/fermées et saisies non enregistrées
  // (statut, lien, note) sont reportées sur la nouvelle liste.
  const before = new Map([...list.querySelectorAll('details.beta-report')].map(card => [card.dataset.reportId, {
    open: card.open,
    edits: [...card.querySelectorAll('[data-field]')].filter(el => el.value !== el.dataset.saved).map(el => [el.dataset.field, el.value]),
  }]));
  list.textContent = '';
  if (!reports.length) {
    const p = document.createElement('p'); p.className = 'muted';
    p.textContent = showArchived ? 'Aucun retour archivé.'
      : s.reportsEnabled ? 'Aucun retour actif.' : 'Aucun retour actif. Le bouton « Signaler un bug » est désactivé (« Configurer la bêta » pour l’activer).';
    list.appendChild(p);
  }
  for (const r of reports) {
    const card = document.createElement('details');
    card.className = 'beta-report';
    card.dataset.reportId = r.id;
    const prev = before.get(String(r.id));
    card.open = prev ? prev.open : r.status === 'new' && !r.archivedAt;
    const h = document.createElement('summary');
    h.textContent = `n°${r.id} — ${r.username || 'invité'} — ${BETA_STATUS[r.status]}${r.archivedAt ? ` — archivé le ${r.archivedAt} UTC` : ''} — ${r.createdAt} UTC — ${(r.observed || '').slice(0, 80)}`;
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
    // #80 : archiver range le retour (rien n'est supprimé : texte, diagnostic, statut, note restent) ; réversible.
    const arch = document.createElement('button');
    arch.className = 'btn btn-outline';
    arch.textContent = r.archivedAt ? '↩️ Réafficher' : '🗄️ Archiver';
    arch.addEventListener('click', async () => {
      const pending = [sel, gh, note].some(el => el.value !== el.dataset.saved);
      if (pending && !await admConfirm({ title: `Archiver le retour n°${r.id} ?`, text: 'Ce retour a des modifications non enregistrées : elles seront perdues.', ok: 'Archiver sans enregistrer' })) return;
      arch.disabled = true;
      const { ok, data: d } = await api('POST', `/api/admin/beta/reports/${r.id}/${r.archivedAt ? 'unarchive' : 'archive'}`);
      arch.disabled = false;
      if (!ok) return adMessage('beta-report-msg', d.error || 'Erreur.', false);
      admToast(r.archivedAt ? `Retour n°${r.id} réaffiché dans les retours actifs.` : `Retour n°${r.id} archivé — « Afficher : Archives » pour le retrouver.`);
      loadBeta();
    });
    row.append(sel, gh, note, save, arch);
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

const betaClock = admClock;
let _betaLoadedAt = null;

// Chaque chargement relit l'état depuis la base (GET /api/admin/beta, sans cache). « Rafraîchir » :
// état commun (admRefreshButton, #60) ; notes et statuts en cours de saisie sont conservés.
async function loadBeta({ manual = false } = {}) {
  const st = document.getElementById('beta-refresh-status');
  const res = await api('GET', '/api/admin/beta');
  if (!res.ok) {
    if (!manual) {
      st.className = 'refresh-status is-err';
      st.textContent = `⚠️ Échec du chargement (${res.data.error || 'erreur'})${_betaLoadedAt ? ` — données affichées : ${betaClock(_betaLoadedAt)}` : ''}`;
    }
    return;
  }
  renderBeta(res.data);
  _betaLoadedAt = new Date();
  if (!manual) { st.className = 'refresh-status'; st.textContent = `✓ Données à jour à ${betaClock(_betaLoadedAt)}`; }
}

admRefreshButton('btn-refresh-beta', loadBeta, 'Bêta');
document.getElementById('beta-reports-view').addEventListener('change', () => { if (_beta) renderBeta(_beta); });

// ── Fiche « Gérer les invitations et testeurs » (#80) ────────────────────────────────────────────────────
// Ouvrir, changer d'onglet, filtrer ou chercher ne modifie rien. Les actions passent par le serveur (autorisation
// admin, journal beta_audit) ; seules celles qui retirent quelque chose (révoquer, retirer un testeur) demandent
// confirmation — archiver / réafficher / réintégrer sont réversibles en un clic. Les codes complets ne sont pas
// affichés (fin du code seulement) ; « Copier le lien » reste disponible pour un lien actif.
const BETA_LINK_FILTERS = [
  ['current', 'Liste courante (hors archives)'], ['active', 'Actifs'], ['used', 'Utilisés'], ['revoked', 'Révoqués'],
  ['expired', 'Expirés'], ['archived', 'Archives'], ['all', 'Tous, archives comprises'],
];
const BETA_TESTER_FILTERS = [['in', 'Dans le programme'], ['removed', 'Hors programme (retraits)'], ['all', 'Tous']];
const BETA_AUDIT_FILTERS = [['all', '30 dernières actions']];
let _betaView = 'invites';
const _betaFilter = { invites: 'current', testers: 'in', audit: 'all' };
const betaCodeHint = code => `${code.slice(0, 3)}-••••-${code.slice(-4)}`;
// Fiche de consultation : la recherche et le filtre ne sont pas des saisies à protéger (pas de faux avertissement, #72).
admDialogSetup('beta-manage-dialog', { dirty: () => false });

function betaManageBtn(text, onClick, cls = 'btn btn-outline') {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.textContent = text;
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await onClick(b); } finally { if (document.contains(b)) b.disabled = false; }
  });
  return b;
}

async function betaManageAction(method, path, body, done) {
  const st = document.getElementById('beta-manage-status');
  admShowError(document.getElementById('beta-manage-error'), '');
  admShowError(st, '');
  const { ok, data } = await api(method, path, body);
  if (!ok) { admShowError(document.getElementById('beta-manage-error'), data.error || 'Erreur.'); return false; }
  // La fiche est modale (couche supérieure) : la confirmation s'affiche dans la fiche, pas seulement en toast.
  admShowError(st, `✓ ${data.changed === false ? 'Déjà fait : rien n’a changé.' : done}`);
  await loadBeta();
  return true;
}

function betaItem(title, badges, meta, actions) {
  const li = document.createElement('li');
  li.className = 'beta-item';
  const main = document.createElement('div');
  main.className = 'beta-item-main';
  const t = document.createElement('div');
  t.className = 'beta-item-title';
  const strong = document.createElement('strong'); strong.textContent = title;
  t.appendChild(strong);
  for (const [txt, kind] of badges) { const b = document.createElement('span'); b.className = `beta-badge beta-badge--${kind}`; b.textContent = txt; t.appendChild(b); }
  const m = document.createElement('div');
  m.className = 'beta-item-meta muted';
  m.textContent = meta.filter(Boolean).join(' · ');
  main.append(t, m);
  const act = document.createElement('div');
  act.className = 'beta-item-actions';
  act.append(...actions);
  li.append(main, act);
  return li;
}

function betaInviteItem(inv) {
  const who = inv.label ? `pour ${inv.label}` : 'sans destinataire noté';
  const badges = [[BETA_STATES[inv.state] || inv.state, inv.state]];
  if (inv.archivedAt) badges.push(['archivé', 'archived']);
  const actions = [];
  if (inv.state === 'active') {
    actions.push(betaManageBtn('📋 Copier le lien', b => betaCopy(betaInviteLink(inv.code), b, '📋 Copier le lien')));
    actions.push(betaManageBtn('Révoquer', async () => {
      const used = inv.uses ? `Les ${inv.uses} compte(s) déjà créé(s) avec ce lien continuent de jouer normalement.` : 'Aucun compte n’a été créé avec ce lien.';
      if (!await admConfirm({ title: `Révoquer le lien ${betaCodeHint(inv.code)} (${who}) ?`, danger: true, ok: 'Révoquer le lien',
        impact: ['Le lien ne permet plus de créer de compte, immédiatement.', used,
          'Définitif pour ce lien : pour réinviter la personne, crée un nouveau lien. Il pourra ensuite être archivé.'] })) return;
      await betaManageAction('POST', `/api/admin/beta/invites/${inv.id}/revoke`, undefined, `Lien ${betaCodeHint(inv.code)} révoqué.`);
    }, 'btn btn-outline btn-danger-text'));
  } else if (!inv.archivedAt) {
    actions.push(betaManageBtn('🗄️ Archiver', () => betaManageAction('POST', `/api/admin/beta/invites/${inv.id}/archive`, undefined,
      `Lien ${betaCodeHint(inv.code)} archivé — filtre « Archives » pour le retrouver.`)));
  } else {
    actions.push(betaManageBtn('↩️ Réafficher', () => betaManageAction('POST', `/api/admin/beta/invites/${inv.id}/unarchive`, undefined,
      `Lien ${betaCodeHint(inv.code)} réaffiché dans la liste courante.`)));
  }
  return betaItem(`${betaCodeHint(inv.code)} — ${who}`, badges, [
    `vague ${inv.wave}`, `${inv.uses} / ${inv.maxUses} inscription(s)`, `créé le ${inv.createdAt} UTC${inv.createdBy ? ` par ${inv.createdBy}` : ''}`,
    inv.revokedAt ? `révoqué le ${inv.revokedAt} UTC` : inv.expiresAt ? `expire le ${inv.expiresAt} UTC` : 'sans expiration',
    inv.archivedAt ? `archivé le ${inv.archivedAt} UTC` : '',
  ], actions);
}

function betaTesterItem(x) {
  const badges = x.removedAt ? [['hors programme', 'revoked']] : [[x.activated ? 'a joué' : 'pas encore de sauvegarde', x.activated ? 'active' : 'used']];
  const actions = [];
  if (!x.removedAt) {
    actions.push(betaManageBtn('Retirer du programme', async () => {
      const inv = _beta.invites.find(i => i.code === x.code);
      const impact = [
        `${x.username} sort de la liste des testeurs et des compteurs de la bêta.`,
        'Son compte, sa connexion, sa progression, son classement et ses retours ne changent PAS : le compte reste jouable normalement (la bêta ne contrôle que la création de compte).',
        'Réversible : filtre « Hors programme » → « Réintégrer ».',
      ];
      if (inv?.state === 'active') impact.push(`Son lien ${betaCodeHint(inv.code)} sert encore à d’autres inscriptions : révoque-le dans « Liens » si besoin.`);
      if (!await admConfirm({ title: `Retirer ${x.username} du programme bêta ?`, impact, ok: 'Retirer du programme', danger: true })) return;
      await betaManageAction('POST', `/api/admin/beta/testers/${x.userId}/remove`, { confirm: true }, `Retrait du programme bêta enregistré pour ${x.username} (compte intact).`);
    }, 'btn btn-outline btn-danger-text'));
  } else {
    actions.push(betaManageBtn('↩️ Réintégrer', () => betaManageAction('POST', `/api/admin/beta/testers/${x.userId}/restore`, undefined,
      `${x.username} est de nouveau dans le programme bêta.`)));
  }
  return betaItem(x.username, badges, [
    x.label ? `invité « ${x.label} »` : '', `vague ${x.wave}`, `lien ${betaCodeHint(x.code)}`, `inscription le ${x.createdAt} UTC`,
    x.lastSaveAt ? `dernière sauvegarde ${x.lastSaveAt} UTC` : '', x.returnedD7 ? 'retour après J+7' : x.returnedD1 ? 'retour après J+1' : '',
    `${x.reports} signalement(s)`, x.removedAt ? `retrait le ${x.removedAt} UTC` : '',
  ], actions);
}

function betaManageRender() {
  if (!_beta) return;
  const view = _betaView;
  for (const b of document.querySelectorAll('#beta-manage-dialog .beta-tab')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  const inv = _beta.invites, ts = _beta.testers;
  document.getElementById('beta-tab-invites').textContent = `🔗 Liens (${inv.filter(i => !i.archivedAt).length})`;
  document.getElementById('beta-tab-testers').textContent = `👥 Testeurs (${_beta.summary.total})`;
  const sel = document.getElementById('beta-manage-filter');
  const opts = { invites: BETA_LINK_FILTERS, testers: BETA_TESTER_FILTERS, audit: BETA_AUDIT_FILTERS }[view];
  if (sel.dataset.view !== view) {
    sel.textContent = '';
    for (const [v, l] of opts) sel.appendChild(new Option(l, v));
    sel.dataset.view = view;
  }
  sel.value = _betaFilter[view];
  const q = admNavFold(document.getElementById('beta-manage-q').value.trim());
  document.getElementById('beta-manage-q').closest('label').classList.toggle('hidden', view === 'audit');
  const f = _betaFilter[view];
  const hint = document.getElementById('beta-manage-hint');
  const list = document.getElementById('beta-manage-list');
  list.textContent = '';
  let items = [];
  if (view === 'invites') {
    const counts = Object.fromEntries(Object.keys(BETA_STATES).map(k => [k, inv.filter(i => i.state === k && !i.archivedAt).length]));
    hint.textContent = `${counts.active} actif(s) · ${counts.used} utilisé(s) · ${counts.revoked} révoqué(s) · ${counts.expired} expiré(s) · ${inv.filter(i => i.archivedAt).length} archivé(s). `
      + 'Révoquer coupe un lien inutilisé ; archiver range un lien qui ne sert plus. Les comptes déjà créés ne sont jamais touchés.';
    items = inv.filter(i => f === 'all' || (f === 'archived' ? !!i.archivedAt : !i.archivedAt && (f === 'current' || i.state === f)))
      .filter(i => !q || admNavFold(`${i.label} ${i.code}`).includes(q) || admNavFold(i.code.replace(/-/g, '')).includes(q.replace(/[^a-z0-9]/g, '')))
      .map(betaInviteItem);
  } else if (view === 'testers') {
    const sm = _beta.summary;
    hint.textContent = `${sm.total} testeur(s) dans le programme${sm.removed ? `, ${sm.removed} hors programme` : ''} · ${sm.activated} ont sauvegardé au moins une fois · `
      + `retour J+1 : ${sm.d1.returned}/${sm.d1.eligible} · J+7 : ${sm.d7.returned}/${sm.d7.eligible} (dernière sauvegarde cloud ≥ 1 ou 7 jours après l’inscription). `
      + 'Retirer un testeur ne touche jamais à son compte.';
    items = ts.filter(x => f === 'all' || (f === 'removed' ? !!x.removedAt : !x.removedAt))
      .filter(x => !q || admNavFold(`${x.username} ${x.label} ${x.code}`).includes(q))
      .map(betaTesterItem);
  } else {
    hint.textContent = 'Qui a fait quoi et quand (heure UTC). Journal en ajout seul : il ne peut être ni modifié ni effacé.';
    items = (_beta.audit || []).map(e => betaItem(e.label, [], [`${e.createdAt} UTC`, e.target, e.actor], []));
  }
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted beta-empty';
    li.textContent = view === 'audit' ? 'Aucune action de gestion pour le moment.' : q ? 'Aucun résultat pour cette recherche.' : 'Rien à afficher avec ce filtre.';
    items.push(li);
  }
  list.append(...items);
}

document.getElementById('btn-beta-manage').addEventListener('click', e => {
  if (!_beta) return;
  admShowError(document.getElementById('beta-manage-error'), '');
  admShowError(document.getElementById('beta-manage-status'), '');
  admDialogOpen('beta-manage-dialog', e.currentTarget);
  betaManageRender();
  document.getElementById(`beta-tab-${_betaView}`).focus();
});
for (const b of document.querySelectorAll('#beta-manage-dialog .beta-tab')) {
  b.addEventListener('click', () => { _betaView = b.dataset.view; betaManageRender(); });
}
document.getElementById('beta-manage-filter').addEventListener('change', e => { _betaFilter[_betaView] = e.target.value; betaManageRender(); });
document.getElementById('beta-manage-q').addEventListener('input', () => betaManageRender());
document.getElementById('btn-beta-feedback').addEventListener('click', () => {
  const card = document.getElementById('beta-feedback-card');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.querySelector('summary, select, button')?.focus({ preventScroll: true });
});

// ── Fiche « Inviter un testeur » : un champ facultatif, valeurs sûres (1 inscription, 14 jours, vague courante).
// #72 : deux étapes, deux protections. Étape 1 (formulaire) : suivi générique #61, rien n'est encore créé.
// Étape 2 (résultat) : l'invitation est déjà enregistrée ; seule une retouche manuelle du message est une saisie
// à perdre, et la confirmation le dit (l'invitation reste valide). Sans retouche : fermeture directe.
let _betaInviteMsg = null;   // message proposé à l'étape 2 (null = étape 1)
const betaInviteMsgEdited = () => _betaInviteMsg !== null && document.getElementById('beta-invite-message').value !== _betaInviteMsg;
function betaInviteKeepMsg(effect) {
  if (!betaInviteMsgEdited()) return Promise.resolve(true);
  return admConfirm({
    title: 'Message personnalisé non copié', text: 'Tu as modifié le texte du message.',
    impact: ['L’invitation est déjà créée et reste valide : seul ton texte personnalisé sera perdu.',
      `« Abandonner le texte » ${effect}`, 'Pour le garder : « Revenir au message », puis « ✉️ Copier un message prêt à envoyer ».'],
    ok: 'Abandonner le texte', cancel: 'Revenir au message',
  });
}
function betaInviteDirty() {
  return _betaInviteMsg === null ? document.getElementById('beta-invite-dialog')._admTrack.dirty() : betaInviteMsgEdited();
}
async function betaInviteCanClose() {
  if (_betaInviteMsg !== null) return betaInviteKeepMsg('ferme la fiche.');
  return !betaInviteDirty() || admConfirmDiscard({ keep: 'Créer le lien' });
}
admDialogSetup('beta-invite-dialog', { dirty: betaInviteDirty, canClose: betaInviteCanClose });

function betaInviteReset() {
  _betaInviteMsg = null;
  document.getElementById('beta-invite-dialog')._admTrack.clean();
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
document.getElementById('btn-beta-invite-again').addEventListener('click', async () => {
  if (!await betaInviteKeepMsg('prépare une nouvelle invitation ; la précédente reste dans « Liens d’invitation créés ».')) return;
  betaInviteReset();
  document.getElementById('beta-invite-name').focus();
});

document.getElementById('btn-beta-invite-create').addEventListener('click', async () => {
  const btn = document.getElementById('btn-beta-invite-create');
  const name = document.getElementById('beta-invite-name').value.trim();
  if (btn.disabled) return;   // un seul lien par clic
  btn.disabled = true;
  const { ok, data } = await api('POST', '/api/admin/beta/invites', { label: name });
  btn.disabled = false;
  if (!ok) return admShowError(document.getElementById('beta-invite-error'), data.error || 'Erreur.');
  const link = betaInviteLink(data.invites[0].code);
  document.getElementById('beta-invite-done').textContent = `✓ Lien créé${name ? ` pour ${name}` : ''}. Copie-le et envoie-le toi-même.`;
  document.getElementById('beta-invite-link').value = link;
  _betaInviteMsg = betaInviteMessage(link, name);
  document.getElementById('beta-invite-message').value = _betaInviteMsg;
  document.getElementById('beta-invite-dialog')._admTrack.clean();   // le prénom est enregistré avec l'invitation
  document.getElementById('beta-invite-step1').classList.add('hidden');
  document.getElementById('beta-invite-step2').classList.remove('hidden');
  document.getElementById('btn-beta-copy-link').focus();
  loadBeta();
});
document.getElementById('btn-beta-copy-link').addEventListener('click', e =>
  betaCopy(document.getElementById('beta-invite-link').value, e.currentTarget, '📋 Copier le lien'));
document.getElementById('btn-beta-copy-msg').addEventListener('click', async e => {
  const text = document.getElementById('beta-invite-message').value;
  // Texte copié = plus rien à perdre (la copie manuelle de secours, elle, n'est pas vérifiable).
  if (await betaCopy(text, e.currentTarget, '✉️ Copier un message prêt à envoyer') && _betaInviteMsg !== null) _betaInviteMsg = text;
});

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
  if (next.registrationMode === 'closed' && !await admAsk('Fermer les inscriptions ? Plus personne ne pourra créer de compte, même avec un lien d’invitation (les joueurs existants continuent de jouer).')) return;
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
  const confirmName = await admPrompt({ title: `Remplacer le mot de passe de « ${user.username} » et fermer ses sessions ?`,
    label: 'Saisir son nom exact pour confirmer', ok: 'Remplacer le mot de passe' });
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
        if (!await admAsk(confirmText)) return;
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
      if (!await admAsk(`Préparer dès maintenant la saison du ${stDate(n.startAt)} ?\n\nUn nom inédit est réservé et, si un pack rédigé est disponible, sa collection est importée en BROUILLON (non publiée, drops inactifs). Rien n'est illustré, publié ni annoncé. Sans cette action, la préparation est ${stPrepWhen(n.prepareAt)}.`)) return;
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
    : `Dépensé atelier : ${b.studioSpentUsd ?? 0} $ · ${b.capEnabled ? `plafond ${b.capUsd} $, reste ${b.remainingUsd ?? '—'} $` : 'aucun plafond bloquant'} · aujourd'hui ${b.imagesToday ?? 0}/${b.maxImagesPerDay ?? '—'} images. Aucune image n'est générée automatiquement : lancement par « Illustrer ».`));
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

admRefreshButton('btn-st-refresh', loadSeasonThemes, 'Thèmes de saison');

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
  if (!admZoneDirty(document.getElementById('news-settings-card'))) {   // réglages en cours de saisie conservés (#61)
    document.getElementById('news-auto-seasons').checked = s.autoSeasons;
    document.getElementById('news-player-events').checked = s.playerEvents;
    document.getElementById('news-depths').value = s.depthMilestones.join(', ');
    document.getElementById('news-rank-top').value = s.rankTop;
    document.getElementById('news-daily-max').value = s.playerDailyMax;
  }
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

async function nwCanClose() {
  if (nwDirty() && !await admConfirm({
    title: 'Modifications non enregistrées',
    text: 'Cette fiche contient des saisies qui ne sont pas enregistrées (notes, textes ou réglages).',
    impact: ['« Abandonner » ferme la fiche et perd ces saisies (une mise en forme IA non enregistrée serait à refaire).', `Pour les garder : « Continuer à modifier », puis « ${document.getElementById('btn-nw-save').textContent} ».`],
    ok: 'Abandonner les modifications', cancel: 'Continuer à modifier', danger: true,
  })) return false;
  _nwSnap = null;
  return true;
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
    state.textContent = `✅ Fiche remplie : relis chaque langue (FR, EN, NL, ES), corrige si besoin, puis « ${document.getElementById('btn-nw-save').textContent} ».`;
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

admZone(document.getElementById('news-settings-card'));
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
  admZoneClean(document.getElementById('news-settings-card'));
  loadNews();
});

if (document.getElementById('news-dialog')) {
  // Fermeture protégée (✕ / Annuler / fond hors cadre / Échap / page) : mécanisme commun admDialogSetup (#61).
  const dlg = admDialogSetup('news-dialog', { canClose: nwCanClose, dirty: () => nwDirty() });
  dlg.addEventListener('close', () => { _nwSnap = null; });
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
  admRefreshButton('btn-news-refresh', loadNews, 'Actualités');
  document.getElementById('news-filter').addEventListener('change', loadNews);
}

// ── Événements mensuels (#56) ─────────────────────────────────────────────────
// Recettes #56-B/C/D (03/11) : liste compacte (clic sur une ligne → fiche modale), « ＋ Ajouter » →
// manuel / TEST / IA, objets dans leur propre fiche (une langue à la fois, aperçu joueur), testeurs
// choisis dans une liste (ID stable, jamais de saisie libre), dates JJ/MM/AAAA HH:mm (Bruxelles),
// confirmations Dig (jamais la boîte native), période vérifiée avant planification, « Démarrer maintenant ».

let _ev = null;          // vue admin (GET /api/admin/events)
let _evCur = null;       // fiche ouverte : { ev (serveur ou null), draft, readOnly }
let _evSnap = null;      // instantané de la fiche à l'ouverture / après enregistrement (#61)
let _evLang = 'fr';
const EV_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const EV_STATES = { draft: '📝 Brouillon', planned: '🗓️ Planifié', active: '🟢 Actif', ended: '🏁 Terminé' };
const EV_STATE_CHIP = { draft: 'muted', planned: 'info', active: 'ok', ended: 'muted' };
const EV_RARITIES = { commun: 'Commun', 'peu-commun': 'Peu commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire' };
const EV_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const EV_ITEM_ID_RE = /^[a-z][a-z0-9_]{2,39}$/;
// Image d'un objet (#65) : la fiche (brouillon) ≠ l'image vue des joueurs (publiée par une action de l'événement)
const EV_IMG_STATES = { none: ['Sans image', 'muted'], proposal: ['Proposition dans l\'atelier', 'info'], draft: ['Conservée dans le brouillon', 'warn'], published: ['Publiée', 'ok'] };
const evImgChip = it => { const [label, cls] = EV_IMG_STATES[it.imageState] ?? EV_IMG_STATES.none; return evChip(`🖼 ${label}`, cls); };
const evImgPending = ev => (ev?.items ?? []).filter(i => i.imageState === 'draft');

/** « 2026-12-01T00:00 » (Bruxelles) → « 01/12/2026 00:00 ». */
function evFmt(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '—';
}
const evFmtRange = (a, b) => `${evFmt(a)} → ${evFmt(b)}`;
function evDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 120) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 6) / 10} h`;
  return `${Math.round(min / 144) / 10} j`;
}
const evChip = (text, kind) => aiEl('span', { class: `st-chip st-chip--${kind}` }, text);
const evTesterNames = ev => ev.testers.map(t => t.username).join(', ') || 'aucun testeur';

// Bruxelles ↔ UTC dans le navigateur (affichage des durées restantes ; le serveur reste la référence).
function evTzOffset(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Brussels', hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
function evLocalToMs(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local ?? '');
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return guess - evTzOffset(guess - evTzOffset(guess));
}
const evMsToLocal = ms => new Date(ms + evTzOffset(ms)).toISOString().slice(0, 16);

/**
 * Champs Début / Fin en clair (JJ/MM/AAAA + HH:mm, heure de Bruxelles), jamais le datetime-local
 * natif (affiché MM/DD/YYYY selon le navigateur). get() → { startsAt, endsAt, error }.
 */
function evWhenField(box, { onChange } = {}) {
  box.textContent = '';
  const make = label => {
    const row = aiEl('div', { class: 'ev-when-row' });
    row.appendChild(aiEl('span', { class: 'ev-label' }, label));
    const d = aiEl('input', { type: 'text', inputmode: 'numeric', placeholder: 'JJ/MM/AAAA', maxlength: '10', 'aria-label': `${label} : date (JJ/MM/AAAA)`, class: 'ev-date' });
    const t = aiEl('input', { type: 'text', inputmode: 'numeric', placeholder: 'HH:mm', maxlength: '5', 'aria-label': `${label} : heure (HH:mm)`, class: 'ev-time' });
    row.append(d, t);
    box.appendChild(row);
    return { d, t };
  };
  const s = make('Début'), e = make('Fin');
  const info = aiEl('p', { class: 'muted ev-help', 'aria-live': 'polite' });
  box.appendChild(info);
  const parse = ({ d, t }, label) => {
    const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.value.trim());
    const tm = /^(\d{1,2})[:hH](\d{2})$/.exec(t.value.trim() || '00:00');
    if (!dm || !tm) return { error: `${label} : date JJ/MM/AAAA et heure HH:mm attendues.` };
    const [day, mon, yr, hh, mm] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2]];
    const chk = new Date(Date.UTC(yr, mon - 1, day));
    if (chk.getUTCDate() !== day || chk.getUTCMonth() !== mon - 1 || hh > 23 || mm > 59) return { error: `${label} : date ou heure inexistante.` };
    return { local: `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
  };
  const api_ = {
    get() {
      const a = parse(s, 'Début'), b = parse(e, 'Fin');
      const error = a.error || b.error || (evLocalToMs(b.local) - evLocalToMs(a.local) < 10 * 60000 ? 'La fin doit suivre le début d\'au moins 10 minutes.' : '');
      return { startsAt: a.local ?? '', endsAt: b.local ?? '', error };
    },
    set(start, end) {
      for (const [f, v] of [[s, start], [e, end]]) {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v ?? '');
        f.d.value = m ? `${m[3]}/${m[2]}/${m[1]}` : '';
        f.t.value = m ? `${m[4]}:${m[5]}` : '';
      }
      refresh();
    },
    disable(on) { for (const f of [s.d, s.t, e.d, e.t]) f.disabled = on; },
  };
  function refresh() {
    const v = api_.get();
    info.classList.toggle('error', !!v.error && !!(s.d.value || e.d.value));
    if (v.error) { info.textContent = s.d.value || e.d.value ? v.error : 'Heure de Bruxelles.'; return; }
    const a = evLocalToMs(v.startsAt), b = evLocalToMs(v.endsAt), now = Date.now();
    const when = b <= now ? '⚠ période déjà terminée' : a < now ? `⚠ déjà commencée : il reste ${evDuration(b - now)}` : `commence dans ${evDuration(a - now)}`;
    info.textContent = `Durée ${evDuration(b - a)} · heure de Bruxelles · ${when}.`;
  }
  for (const f of [s.d, s.t, e.d, e.t]) f.addEventListener('input', () => { refresh(); onChange?.(); });
  return api_;
}

/**
 * Sélecteur de testeurs (recette #56-B) : recherche serveur par pseudo partiel (/api/admin/players/suggest :
 * pseudo + ID, jamais d'e-mail), comptes bêta et testeurs déjà utilisés proposés d'un clic, pastilles
 * retirables, multisélection. Valeur = [{ id, username }] : le serveur contrôle par ID stable.
 */
let _evPickerSeq = 0;
function evTesterPicker(box, { onChange, emptyText = 'Aucun testeur choisi : personne ne verrait cet événement.', suggestions = () => _ev?.testerSuggestions ?? [], label = 'Ajouter un testeur' } = {}) {
  const uid = `ev-pick-${++_evPickerSeq}`;
  box.textContent = '';
  box.classList.add('ev-picker');
  let list = [], disabled = false;
  const chips = aiEl('div', { class: 'ev-chips', 'aria-live': 'polite' });
  const ac = aiEl('div', { class: 'player-ac' });
  const input = aiEl('input', { type: 'text', id: `${uid}-input`, autocomplete: 'off', placeholder: 'Rechercher un pseudo (2 lettres ou plus)…',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${uid}-list`, 'aria-label': label });
  const ul = aiEl('ul', { id: `${uid}-list`, class: 'player-ac-list hidden', role: 'listbox', 'aria-label': 'Comptes trouvés' });
  ac.append(input, ul);
  const sugg = aiEl('div', { class: 'ev-sugg' });
  const msg = aiEl('p', { class: 'muted ev-help', 'aria-live': 'polite' });
  box.append(chips, ac, sugg, msg);
  const add = u => {
    if (!list.some(t => t.id === u.id)) list.push({ id: u.id, username: u.username });
    input.value = '';
    msg.textContent = '';
    render(); onChange?.();
  };
  function render() {
    chips.textContent = '';
    if (!list.length) chips.appendChild(aiEl('span', { class: 'muted ev-help' }, emptyText));
    for (const t of list) {
      const c = aiEl('span', { class: `ev-chip${t.missing ? ' ev-chip--bad' : ''}`, title: t.missing ? 'Compte introuvable : retirez-le' : `ID ${t.id}` },
        `${t.missing ? '⚠ ' : ''}${t.username}${t.id ? ` · ID ${t.id}` : ' (introuvable)'}`);
      const x = aiEl('button', { type: 'button', class: 'ev-chip-x', 'aria-label': `Retirer ${t.username}` }, '✕');
      x.disabled = disabled;
      x.addEventListener('click', () => { list = list.filter(o => o !== t); render(); onChange?.(); input.focus(); });
      c.appendChild(x);
      chips.appendChild(c);
    }
    sugg.textContent = '';
    const free = (suggestions() ?? []).filter(u => !list.some(t => t.id === u.id));
    if (free.length && !disabled) {
      sugg.appendChild(aiEl('span', { class: 'muted ev-help' }, 'Proposés :'));
      for (const u of free.slice(0, 12)) {
        const b = aiEl('button', { type: 'button', class: 'btn-ghost ev-sugg-btn', title: `ID ${u.id} · ${u.why}` }, `＋ ${u.username}`);
        b.addEventListener('click', () => add(u));
        sugg.appendChild(b);
      }
    }
    input.disabled = disabled;
  }
  attachPlayerAutocomplete(input, ul, {
    onSelect: add,
    onEnter: () => { if (input.value.trim()) msg.textContent = `Choisissez un compte dans la liste : « ${input.value.trim()} » n'est pas sélectionné.`; },
  });
  render();
  return {
    get: () => list.map(t => (t.id ? { id: t.id } : t.username)),
    names: () => list.map(t => t.username),
    set: l => { list = (l ?? []).map(t => (typeof t === 'string' ? { id: null, username: t, missing: true } : { ...t })); msg.textContent = ''; render(); },
    disable: on => { disabled = on; render(); },
  };
}

async function loadEvents() {
  const { ok, data } = await api('GET', '/api/admin/events');
  if (!ok) return nwMessage('ev-msg', data.error ?? 'Chargement impossible.', true);
  _ev = data;
  renderEvents();
}

/** Avertissements groupés (« 5 illustrations absentes » plutôt que 5 lignes). */
function evGroupedWarnings(ev) {
  const img = ev.readiness.warnings.filter(w => /pas d'illustration/.test(w)).length;
  const rest = ev.readiness.warnings.filter(w => !/pas d'illustration/.test(w));
  return [...(img ? [`${img} illustration(s) absente(s)`] : []), ...rest];
}

function renderEvents() {
  const tb = document.getElementById('ev-list');
  tb.textContent = '';
  if (!_ev.events.length) {
    const tr = document.createElement('tr');
    addCell(tr, 'Aucun événement. « ＋ Ajouter » ou le calendrier pour en créer un (toujours en brouillon).').colSpan = 6;
    tb.appendChild(tr);
  }
  for (const ev of _ev.events) {
    const tr = aiEl('tr', { class: 'ev-row', tabindex: '0', 'data-adm-key': `ev:${ev.id}`, title: 'Ouvrir la fiche' });
    addCell(tr, '').appendChild(evChip(EV_STATES[ev.state] ?? ev.state, EV_STATE_CHIP[ev.state] ?? 'muted'));
    const name = addCell(tr, '');
    name.appendChild(aiEl('strong', {}, `${ev.icon} ${ev.names.fr}`));
    name.appendChild(aiEl('div', { class: 'muted ev-sub' }, `${ev.id} · rév. ${ev.revision}`));
    const notes = [];
    if (ev.status === 'draft' && ev.readiness.blocking.length) notes.push(`❌ ${ev.readiness.blocking.length} point(s) à régler`);
    for (const w of evGroupedWarnings(ev)) notes.push(`⚠ ${w}`);
    if (notes.length) name.appendChild(aiEl('div', { class: 'muted ev-sub', title: [...ev.readiness.blocking, ...ev.readiness.warnings].join('\n') }, notes.join(' · ')));
    const aud = addCell(tr, '');
    aud.appendChild(ev.audience === 'public' ? evChip('🌍 Public', 'warn') : evChip('🧪 TEST', 'info'));
    if (ev.audience === 'test') aud.appendChild(aiEl('div', { class: 'muted ev-sub' }, evTesterNames(ev)));
    addCell(tr, evFmtRange(ev.startsLocal, ev.endsLocal)).classList.add('ev-nowrap');
    const it = addCell(tr, '');
    const thumbs = aiEl('div', { class: 'ev-thumbs' });
    for (const i of ev.items.slice(0, 6)) {
      if (i.image) thumbs.appendChild(aiEl('img', { src: i.image, alt: '', width: '20', height: '20', loading: 'lazy' }));
      else thumbs.appendChild(aiEl('span', { 'aria-hidden': 'true' }, i.icon));
    }
    it.append(thumbs, aiEl('div', { class: 'muted ev-sub' }, `${ev.items.filter(i => i.enabled).length} actif(s) / ${ev.items.length}`));
    const found = Object.values(ev.stats.finds).reduce((a, b) => a + b, 0);
    addCell(tr, `${ev.stats.players} joueur(s) · ${found} objet(s)`);
    tr.addEventListener('click', () => evOpen(ev, tr));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); evOpen(ev, tr); } });
    tb.appendChild(tr);
  }
  renderEvCalendar();
  const jobs = document.getElementById('ev-ai-jobs');
  jobs.textContent = '';
  for (const j of _ev.ai) {
    const label = j.status === 'pending' ? '⏳ en cours…' : j.status === 'done' ? `✅ brouillon « ${j.eventId} » créé` : `❌ ${j.error}`;
    jobs.appendChild(aiEl('li', {}, `IA #${j.id} « ${j.concept.slice(0, 60)} » : ${label}`));
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
    if (m.alternatives.length) prop.appendChild(aiEl('div', { class: 'muted ev-sub' }, `Autres : ${m.alternatives.map(a => `${a.name} (${a.date})`).join(', ')}`));
    addCell(tr, m.suggested ? evFmtRange(m.suggested.startsAt, m.suggested.endsAt) : 'à choisir');
    addCell(tr, m.prepareBy ? `${m.prepareBy}${m.late ? ' ⚠️ en retard' : ''}` : '—');
    addCell(tr, m.events.length ? m.events.map(e => `${e.icon} ${e.name} (${EV_STATES[e.state] ?? e.state})`).join(', ') : '—');
    const act = addCell(tr, '');
    if (!m.events.length) {
      const b = aiEl('button', { class: 'btn-ghost', type: 'button' }, 'Préparer un brouillon');
      b.addEventListener('click', () => evOpen(null, b, {
        id: m.holiday ? `${m.holiday.key}_${m.year}` : '', icon: '🎉', audience: 'public', testers: [],
        names: { fr: m.holiday ? m.holiday.name : '' }, taglines: {},
        startsLocal: m.suggested?.startsAt ?? `${m.year}-${String(m.month).padStart(2, '0')}-01T00:00`,
        endsLocal: m.suggested?.endsAt ?? '', items: [],
      }));
      act.appendChild(b);
    }
    tb.appendChild(tr);
  }
}

// ── Fiche événement ───────────────────────────────────────────────────────────

let _evWhen = null, _evPicker = null;

function evLangTabs(boxId, current, isDone, onPick) {
  const box = document.getElementById(boxId);
  box.textContent = '';
  for (const l of EV_LANGS) {
    const done = isDone(l);
    const b = aiEl('button', { type: 'button', class: `co-lang-btn co-lang--${done ? 'ok' : 'none'}`, 'data-lang': l, 'aria-pressed': String(l === current),
      title: done ? 'Traduction complète' : 'Traduction à compléter' }, `${l.toUpperCase()} ${done ? '✓' : '·'}`);
    b.addEventListener('click', () => onPick(l));
    box.appendChild(b);
  }
}

function evRenderTexts() {
  const d = _evCur.draft;
  evLangTabs('ev-langs', _evLang, l => !!(d.names[l] && d.taglines[l]), l => { _evLang = l; evRenderTexts(); document.querySelector(`#ev-langs [data-lang="${l}"]`).focus(); });
  const L = _evLang.toUpperCase();
  document.getElementById('ev-name-label').textContent = `Nom (${L})${_evLang === 'fr' ? ' — obligatoire' : ''}`;
  document.getElementById('ev-tag-label').textContent = `Accroche (${L})`;
  document.getElementById('ev-name').value = d.names[_evLang] ?? '';
  document.getElementById('ev-tag').value = d.taglines[_evLang] ?? '';
}

function evRenderItems() {
  const tb = document.getElementById('ev-items');
  tb.textContent = '';
  const items = _evCur.draft.items;
  if (!items.length) {
    const tr = document.createElement('tr');
    addCell(tr, 'Aucun objet : « ＋ Objet » pour en ajouter.').colSpan = 7;
    tb.appendChild(tr);
  }
  items.forEach((it, i) => {
    const tr = aiEl('tr', { class: 'ev-row', tabindex: '0', 'data-adm-key': `evi:${i}`, title: _evCur.readOnly ? 'Consulter l\'objet' : 'Modifier l\'objet' });
    const art = addCell(tr, '');
    if (it.image) art.appendChild(aiEl('img', { src: it.image, alt: '', width: '28', height: '28', loading: 'lazy' }));
    else art.textContent = it.icon;
    const nm = addCell(tr, '');
    nm.appendChild(aiEl('strong', {}, it.names.fr || '(sans nom)'));
    nm.appendChild(aiEl('div', { class: 'muted ev-sub' }, it.id || '—'));
    // État de l'image enregistrée côté serveur (objet pas encore enregistré : aucun)
    const saved = _evCur.ev?.items.find(x => x.id === it.id);
    if (saved) nm.appendChild(aiEl('div', { class: 'ev-sub' })).appendChild(evImgChip(saved));
    addCell(tr, EV_RARITIES[it.rarity] ?? it.rarity);
    addCell(tr, it.dropFrom.length ? it.dropFrom.join(', ') : 'tous les blocs');
    addCell(tr, `${it.chancePct} %${it.minDepth ? ` · ≥ ${it.minDepth} m` : ''}`);
    const langs = addCell(tr, '');
    for (const l of EV_LANGS) langs.appendChild(aiEl('span', { class: `co-lang co-lang--${it.names[l] && it.descs[l] ? 'ok' : it.names[l] ? 'name' : 'none'}` }, l.toUpperCase()));
    addCell(tr, it.enabled ? '✅' : '—');
    tr.addEventListener('click', () => eviOpen(i, tr));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); eviOpen(i, tr); } });
    tb.appendChild(tr);
  });
}

function evCollect() {
  const d = _evCur.draft;
  const w = _evWhen.get();
  return {
    id: document.getElementById('ev-id').value.trim(), icon: document.getElementById('ev-icon').value.trim(),
    audience: document.getElementById('ev-audience').value, testers: _evPicker.get(),
    startsAt: w.startsAt, endsAt: w.endsAt,
    names: Object.fromEntries(EV_LANGS.map(l => [l, (d.names[l] ?? '').trim()])),
    taglines: Object.fromEntries(EV_LANGS.map(l => [l, (d.taglines[l] ?? '').trim()])),
    items: d.items.map(it => ({ ...it })),
  };
}
const evDirty = () => document.getElementById('ev-dialog').open && _evCur && !_evCur.readOnly && _evSnap !== null && JSON.stringify(evCollect()) !== _evSnap;

function evRenderState() {
  const ev = _evCur.ev;
  const st = document.getElementById('ev-dialog-state');
  st.textContent = '';
  if (ev) {
    st.appendChild(evChip(EV_STATES[ev.state] ?? ev.state, EV_STATE_CHIP[ev.state] ?? 'muted'));
    st.appendChild(ev.audience === 'public' ? evChip('🌍 Public', 'warn') : evChip(`🧪 TEST · ${evTesterNames(ev)}`, 'info'));
    st.appendChild(aiEl('span', { class: 'muted ev-sub' }, `rév. ${ev.revision} · ${ev.stats.players} joueur(s), ${Object.values(ev.stats.finds).reduce((a, b) => a + b, 0)} objet(s) trouvé(s)`));
    if (_evCur.readOnly) st.appendChild(aiEl('span', { class: 'muted ev-sub' }, 'Planifié : lecture seule. « Repasser en brouillon » pour modifier (les drops s\'arrêtent).'));
  } else st.appendChild(evChip('Nouveau brouillon (non enregistré)', 'muted'));
  const draft = !ev || ev.status === 'draft';
  const isTest = document.getElementById('ev-audience').value === 'test';
  document.getElementById('btn-ev-save').classList.toggle('hidden', !draft);
  document.getElementById('btn-ev-schedule').classList.toggle('hidden', !ev || !draft);
  document.getElementById('ev-now-box').classList.toggle('hidden', !ev || !draft || ev.audience !== 'test');
  document.getElementById('btn-ev-unschedule').classList.toggle('hidden', !ev || draft);
  document.getElementById('btn-ev-revisions').classList.toggle('hidden', !ev);
  const pending = evImgPending(ev);
  const pb = document.getElementById('btn-ev-publish-images');
  pb.classList.toggle('hidden', !pending.length);
  pb.textContent = `🖼 Publier les images (${pending.length})…`;
  document.getElementById('ev-testers-box').classList.toggle('hidden', !isTest);
  const rd = document.getElementById('ev-readiness');
  rd.textContent = '';
  if (ev && draft) for (const b of ev.readiness.blocking) rd.appendChild(aiEl('li', { class: 'ev-bad' }, `❌ ${b}`));
  if (ev) for (const w of evGroupedWarnings(ev)) rd.appendChild(aiEl('li', {}, `⚠ ${w}`));
}

function evOpen(ev, opener, preset = null) {
  const src = ev ?? preset ?? { icon: '🎉', audience: 'test', testers: [], names: {}, taglines: {}, items: [] };
  const readOnly = !!ev && ev.status !== 'draft';
  _evCur = { ev, readOnly, draft: {
    names: { ...(src.names ?? {}) }, taglines: { ...(src.taglines ?? {}) },
    items: (src.items ?? []).map(it => ({ ...it, names: { ...it.names }, descs: { ...it.descs }, dropFrom: [...(it.dropFrom ?? [])] })),
  } };
  _evLang = 'fr';
  document.getElementById('ev-id').value = src.id ?? '';
  document.getElementById('ev-id').disabled = !!ev;
  document.getElementById('ev-icon').value = src.icon ?? '🎉';
  document.getElementById('ev-audience').value = src.audience ?? 'test';
  _evWhen = evWhenField(document.getElementById('ev-when'), { onChange: () => {} });
  _evWhen.set(src.startsLocal, src.endsLocal);
  _evPicker = evTesterPicker(document.getElementById('ev-testers'));
  _evPicker.set(src.testers ?? []);
  evRenderTexts();
  evRenderItems();
  document.getElementById('ev-dialog-title').textContent = ev ? `${ev.icon} ${ev.names.fr}` : 'Nouvel événement';
  for (const el of document.querySelectorAll('#ev-dialog .ev-sheet input, #ev-dialog .ev-sheet select, #ev-dialog .ev-sheet textarea')) {
    if (!el.closest('#ev-sim-box')) el.disabled = readOnly || (el.id === 'ev-id' && !!ev);
  }
  _evWhen.disable(readOnly);
  _evPicker.disable(readOnly);
  document.getElementById('btn-ev-item-add').classList.toggle('hidden', readOnly);
  document.getElementById('ev-sim').textContent = '';
  document.getElementById('ev-sim-box').open = false;
  nwMessage('ev-editor-msg', '');
  evRenderState();
  _evSnap = JSON.stringify(evCollect());
  admDialogOpen('ev-dialog', opener, ev ? null : 'ev-id');
}

async function evCanClose() {
  if (evDirty() && !await admConfirm({
    title: 'Modifications non enregistrées',
    text: 'Cette fiche d\'événement contient des saisies qui ne sont pas enregistrées.',
    impact: ['« Abandonner » ferme la fiche et perd ces saisies ; l\'événement enregistré ne change pas.', 'Pour les garder : « Continuer à modifier », puis « Enregistrer le brouillon ».'],
    ok: 'Abandonner les modifications', cancel: 'Continuer à modifier', danger: true,
  })) return false;
  _evSnap = null;
  return true;
}
admDialogSetup('ev-dialog', { canClose: evCanClose, dirty: () => evDirty() });

/** Recharge la liste et la fiche ouverte depuis le serveur (après enregistrement ou action). */
async function evReloadOpen(id) {
  await loadEvents();
  const ev = _ev.events.find(e => e.id === id);
  if (!ev || !document.getElementById('ev-dialog').open) return;
  const opener = document.getElementById('ev-dialog')._admOpener;
  _evSnap = null;
  evOpen(ev, opener);
}

async function evSave() {
  const w = _evWhen.get();
  if (w.error) return nwMessage('ev-editor-msg', w.error, true);
  const body = evCollect();
  const editing = _evCur.ev?.id;
  const btn = document.getElementById('btn-ev-save');
  btn.disabled = true;
  try {
    const { ok, data } = editing ? await api('PUT', `/api/admin/events/${encodeURIComponent(editing)}`, body) : await api('POST', '/api/admin/events', body);
    if (!ok) return nwMessage('ev-editor-msg', data.error ?? 'Enregistrement impossible.', true);
    admToast(`« ${data.event.names.fr} » enregistré en brouillon (révision ${data.event.revision}). Rien n'est visible des joueurs.`);
    await evReloadOpen(data.event.id);
  } finally { btn.disabled = false; }
}

async function evSimulate() {
  const w = _evWhen.get();
  if (w.error) return nwMessage('ev-editor-msg', w.error, true);
  const body = evCollect();
  if (!body.id) body.id = 'simulation';
  if (!body.names.fr) body.names.fr = 'Simulation';
  body.testers = [];   // le public n'influe pas sur les chances

  const { ok, data } = await api('POST', '/api/admin/events/simulate', { event: body,
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
  box.appendChild(aiEl('p', { class: 'muted ev-help' }, `Profondeur ${data.depth} m, poids du catalogue de blocs publié. Seuls les blocs validés par le serveur comptent.`));
}

async function evAction(id, action, okText, body = {}) {
  const { ok, data } = await api('POST', `/api/admin/events/${encodeURIComponent(id)}/${action}`, body);
  if (!ok) { nwMessage(document.getElementById('ev-dialog').open ? 'ev-editor-msg' : 'ev-msg', data.error ?? 'Action impossible.', true); return null; }
  admToast(okText);
  nwMessage('ev-msg', '');
  await evReloadOpen(id);
  return data;
}

/** Lignes communes des confirmations : public, dates, objets. */
function evImpactLines(ev, startLocal = ev.startsLocal, endLocal = ev.endsLocal) {
  return [
    ev.audience === 'public' ? '🌍 Public : TOUS les joueurs verront l\'événement et pourront trouver ses objets.' : `🧪 TEST : visible uniquement par ${evTesterNames(ev)}.`,
    `📅 ${evFmtRange(startLocal, endLocal)} (heure de Bruxelles) — ${evDuration(evLocalToMs(endLocal) - evLocalToMs(startLocal))}.`,
    `🎁 ${ev.items.filter(i => i.enabled).length} objet(s) : ${ev.items.filter(i => i.enabled).map(i => `${i.icon} ${i.names.fr} (${i.chancePct} %, ${i.dropFrom.length ? i.dropFrom.join('/') : 'tous blocs'})`).join(' · ')}.`,
  ];
}

async function evSchedule() {
  const ev = _evCur.ev;
  if (evDirty()) return nwMessage('ev-editor-msg', 'Modifications non enregistrées : « Enregistrer le brouillon » d\'abord, puis planifiez.', true);
  if (!ev.readiness.ready) return nwMessage('ev-editor-msg', `Planification impossible : ${ev.readiness.blocking.join(' ')}`, true);
  const now = Date.now(), a = evLocalToMs(ev.startsLocal), b = evLocalToMs(ev.endsLocal);
  if (b <= now) {
    return nwMessage('ev-editor-msg', ev.audience === 'test'
      ? 'Période expirée : utilisez « Démarrer le test maintenant » (les dates sont recalées), ou changez les dates puis enregistrez.'
      : 'Période expirée : changez les dates puis enregistrez.', true);
  }
  const elapsed = a < now;
  const impact = [...evImpactLines(ev),
    elapsed ? `⚠ La période a déjà commencé : il ne reste que ${evDuration(b - now)}.${ev.audience === 'test' ? ' Pour une durée complète : Annuler, puis « Démarrer le test maintenant ».' : ''}`
      : `Début dans ${evDuration(a - now)} : rien ne change pour les joueurs avant.`,
    'Réversible : « Repasser en brouillon » arrête les drops ; les objets trouvés restent acquis.'];
  if (ev.audience === 'public') {
    if (!await admConfirm({ title: `Publier « ${ev.names.fr} » pour tous les joueurs ?`, text: 'À faire seulement après validation du propriétaire (textes, barème, illustrations).',
      impact, ok: 'Continuer', danger: true })) return;
    if (!await admConfirm({ title: 'Barème des drops validé ?', text: 'Confirmez que les chances et profondeurs ont été simulées et validées.',
      impact: evImpactLines(ev).slice(2), ok: '🗓️ Planifier pour tous', danger: true })) return;
    return evAction(ev.id, 'schedule', `« ${ev.names.fr} » planifié pour tous les joueurs.`, { confirmRates: true, confirmPublic: true, confirmElapsed: elapsed });
  }
  if (!await admConfirm({ title: `Planifier l'événement TEST « ${ev.names.fr} » ?`, text: 'Les testeurs choisis pourront trouver ses objets en minant pendant la période.',
    impact, ok: elapsed ? `Planifier (reste ${evDuration(b - now)})` : '🗓️ Planifier' })) return;
  return evAction(ev.id, 'schedule', 'Événement TEST planifié : seuls les testeurs le voient.', { confirmElapsed: elapsed });
}

async function evStartNow() {
  const ev = _evCur.ev;
  if (evDirty()) return nwMessage('ev-editor-msg', 'Modifications non enregistrées : « Enregistrer le brouillon » d\'abord.', true);
  const minutes = Math.round(Number(document.getElementById('ev-now-min').value));
  if (!(minutes >= 10 && minutes <= 10080)) return nwMessage('ev-editor-msg', 'Durée : de 10 minutes à 7 jours (10080 min).', true);
  if (!ev.readiness.ready) return nwMessage('ev-editor-msg', `Démarrage impossible : ${ev.readiness.blocking.join(' ')}`, true);
  const now = Date.now(), s = evMsToLocal(now), e = evMsToLocal(now + minutes * 60000);
  if (!await admConfirm({ title: `Démarrer le test « ${ev.names.fr} » maintenant ?`, text: 'Les dates sont recalées sur maintenant et l\'événement est planifié en une seule opération.',
    impact: [...evImpactLines(ev, s, e), `Anciennes dates : ${evFmtRange(ev.startsLocal, ev.endsLocal)} (conservées dans les révisions).`, 'L\'audience reste TEST : aucun joueur public ne le voit.'],
    ok: `▶ Démarrer pour ${minutes} min` })) return;
  return evAction(ev.id, 'start-now', `Test démarré pour ${minutes} min : seuls les testeurs le voient.`, { minutes });
}

async function evUnschedule() {
  const ev = _evCur.ev;
  if (!await admConfirm({ title: `Repasser « ${ev.names.fr} » en brouillon ?`, text: 'Les drops s\'arrêtent aussitôt.',
    impact: ['Les objets déjà trouvés restent acquis (souvenirs).', 'L\'événement redevient modifiable ; il faudra le planifier à nouveau.'],
    ok: '⏸ Repasser en brouillon', danger: true })) return;
  return evAction(ev.id, 'unschedule', 'Événement repassé en brouillon : drops arrêtés.');
}

async function evRevisions() {
  const ev = _evCur.ev;
  const { ok, data } = await api('GET', `/api/admin/events/${encodeURIComponent(ev.id)}/revisions`);
  if (!ok) return nwMessage('ev-editor-msg', data.error ?? 'Révisions indisponibles.', true);
  document.getElementById('ev-revisions-title').textContent = `Révisions : ${ev.icon} ${ev.names.fr}`;
  const tb = document.getElementById('ev-revisions');
  tb.textContent = '';
  for (const r of data.revisions) {
    const tr = document.createElement('tr');
    [r.revision, r.at, r.action, r.status, r.items].forEach(x => addCell(tr, x));
    const act = addCell(tr, '');
    if (ev.status === 'draft' && r.revision !== ev.revision) {
      const b = aiEl('button', { class: 'btn-ghost', type: 'button' }, 'Restaurer');
      b.addEventListener('click', async () => {
        if (evDirty()) return admToast('Enregistrez ou annulez d\'abord les modifications de la fiche.');
        if (!await admConfirm({ title: `Restaurer la révision ${r.revision} ?`, text: 'Son contenu remplace la fiche, en brouillon (jamais planifié automatiquement).',
          impact: ['La version actuelle reste dans les révisions.'], ok: 'Restaurer' })) return;
        document.getElementById('ev-revisions-dialog').close();
        evAction(ev.id, 'restore', `Révision ${r.revision} restaurée en brouillon.`, { revision: r.revision });
      });
      act.appendChild(b);
    }
    tb.appendChild(tr);
  }
  admDialogOpen('ev-revisions-dialog', document.getElementById('btn-ev-revisions'));
}

// ── Fiche objet (une à la fois, une langue à la fois, aperçu joueur) ──────────

let _evi = null;         // { idx (-1 = nouveau), item }
let _eviSnap = null;
let _eviLang = 'fr';

function eviRead() {
  const it = _evi.item;
  return { ...it, id: document.getElementById('evi-id').value.trim(), icon: document.getElementById('evi-icon').value.trim() || '🎁',
    rarity: document.getElementById('evi-rarity').value, enabled: document.getElementById('evi-enabled').checked,
    chancePct: Number(document.getElementById('evi-chance').value), minDepth: Number(document.getElementById('evi-depth').value) || 0,
    image: document.getElementById('evi-image').value.trim() || null, brief: document.getElementById('evi-brief').value.trim(),
    dropFrom: [...document.querySelectorAll('#evi-cats input:checked')].map(c => c.value),
    names: { ...it.names }, descs: { ...it.descs } };
}
const eviDirty = () => document.getElementById('ev-item-dialog').open && _evi && !_evCur.readOnly && _eviSnap !== null && JSON.stringify(eviRead()) !== _eviSnap;

function eviRenderLang() {
  const it = _evi.item;
  evLangTabs('evi-langs', _eviLang, l => !!(it.names[l] && it.descs[l]), l => { _eviLang = l; eviRenderLang(); document.querySelector(`#evi-langs [data-lang="${l}"]`).focus(); });
  const L = _eviLang.toUpperCase();
  document.getElementById('evi-name-label').textContent = `Nom (${L})${_eviLang === 'fr' ? ' — obligatoire' : ''}`;
  document.getElementById('evi-desc-label').textContent = `Description humoristique (${L})`;
  document.getElementById('evi-name').value = it.names[_eviLang] ?? '';
  document.getElementById('evi-desc').value = it.descs[_eviLang] ?? '';
  eviPreview();
}

function eviPreview() {
  const it = eviRead();
  const art = document.getElementById('evi-pv-art');
  art.textContent = '';
  if (it.image) art.appendChild(aiEl('img', { src: it.image, alt: '', width: '72', height: '72' }));
  else art.textContent = it.icon;
  document.getElementById('evi-pv-lang').textContent = _eviLang.toUpperCase();
  document.getElementById('evi-pv-name').textContent = it.names[_eviLang] || it.names.fr || '(sans nom)';
  document.getElementById('evi-pv-rarity').textContent = EV_RARITIES[it.rarity] ?? it.rarity;
  document.getElementById('evi-pv-desc').textContent = it.descs[_eviLang] || '…';
  const p = it.chancePct / 100;
  document.getElementById('evi-chance-help').textContent = p > 0 && p <= 1
    ? `≈ 1 chance sur ${Math.max(1, Math.round(1 / p))} par bloc éligible : ${Math.round((1 - Math.pow(1 - p, 100)) * 100)} % de l'avoir en 100 blocs éligibles, ${Math.round((1 - Math.pow(1 - p, 1000)) * 100)} % en 1 000. Le simulateur de la fiche tient compte de la part réelle des blocs.`
    : 'Chance entre 0,001 et 100 %.';
}

function eviOpen(idx, opener) {
  const src = idx >= 0 ? _evCur.draft.items[idx] : { id: '', icon: '🎁', rarity: 'commun', chancePct: 0.5, minDepth: 0, dropFrom: [], enabled: true, names: {}, descs: {}, image: null, brief: '' };
  _evi = { idx, item: { ...src, names: { ...src.names }, descs: { ...src.descs }, dropFrom: [...src.dropFrom] } };
  _eviLang = 'fr';
  const ro = _evCur.readOnly;
  const sel = document.getElementById('evi-rarity');
  if (!sel.options.length) for (const [k, v] of Object.entries(EV_RARITIES)) sel.appendChild(aiEl('option', { value: k }, v));
  const it = _evi.item;
  document.getElementById('evi-id').value = it.id;
  document.getElementById('evi-icon').value = it.icon;
  sel.value = it.rarity;
  document.getElementById('evi-enabled').checked = it.enabled !== false;
  document.getElementById('evi-chance').value = it.chancePct;
  document.getElementById('evi-depth').value = it.minDepth ?? 0;
  document.getElementById('evi-image').value = it.image ?? '';
  document.getElementById('evi-brief').value = it.brief ?? '';
  document.getElementById('evi-upload').value = '';
  const cats = document.getElementById('evi-cats');
  cats.textContent = '';
  for (const c of _ev.categories) {
    const l = aiEl('label', { class: 'ev-cat' });
    const cb = aiEl('input', { type: 'checkbox', value: c });
    cb.checked = it.dropFrom.includes(c);
    cb.addEventListener('change', eviPreview);
    l.append(cb, aiEl('span', {}, c));
    cats.appendChild(l);
  }
  const found = idx >= 0 ? (_evCur.ev?.stats.finds[it.id] ?? 0) : 0;
  document.getElementById('evi-id').disabled = ro || found > 0;
  for (const el of document.querySelectorAll('#ev-item-dialog .co-prop-fields input, #ev-item-dialog .co-prop-fields select, #ev-item-dialog .co-prop-fields textarea')) {
    if (el.id !== 'evi-id') el.disabled = ro;
  }
  document.getElementById('btn-evi-apply').classList.toggle('hidden', ro);
  document.getElementById('btn-evi-remove').classList.toggle('hidden', ro || idx < 0);
  eviRenderImageState();
  document.getElementById('ev-item-title').textContent = idx >= 0 ? `${it.icon} ${it.names.fr || it.id}${ro ? ' (consultation)' : ''}${found ? ` — trouvé ${found} fois` : ''}` : 'Nouvel objet';
  nwMessage('evi-msg', '');
  eviRenderLang();
  _eviSnap = JSON.stringify(eviRead());
  admDialogOpen('ev-item-dialog', opener, idx >= 0 ? null : 'evi-id');
}

/** #65 : état de l'image de l'objet ENREGISTRÉ (sans image, proposition, brouillon, publiée). */
function eviRenderImageState() {
  const box = document.getElementById('evi-img-state');
  box.textContent = '';
  const saved = _evi.idx >= 0 ? _evCur.ev?.items.find(x => x.id === _evi.item.id) : null;
  if (!saved) { box.textContent = 'Enregistrez d\'abord l\'objet dans le brouillon de l\'événement pour lui créer une image.'; return; }
  box.appendChild(evImgChip(saved));
  const why = { none: ' Les joueurs voient l\'emoji.', proposal: ` ${saved.proposals} image(s) dans l'atelier, aucune conservée : les joueurs voient l'emoji.`,
    draft: ' Pas encore vue des joueurs : « Publier les images » dans la fiche de l\'événement.', published: ' C\'est l\'image que voient les joueurs.' }[saved.imageState] ?? '';
  box.appendChild(document.createTextNode(why));
}

/** #65 : ouvre la cible `event:<événement>/<objet>` de l'atelier (fiche préremplie), sans rien générer. */
async function eviOpenStudio() {
  const ev = _evCur.ev;
  const saved = _evi.idx >= 0 ? ev?.items.find(x => x.id === _evi.item.id) : null;
  if (!saved) return nwMessage('evi-msg', 'Enregistrez d\'abord l\'objet (« Appliquer à la fiche » puis « Enregistrer le brouillon ») : l\'atelier travaille sur un objet enregistré.', true);
  if ((eviDirty() || evDirty()) && !await admConfirmDiscard({ keep: 'Enregistrer le brouillon', effect: 'ferme la fiche, perd ces saisies et ouvre l\'atelier d\'icônes.' })) return;
  _eviSnap = null; _evSnap = null;
  document.getElementById('ev-item-dialog').close();
  document.getElementById('ev-dialog').close();
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  _icFrom = { kind: 'event', id: saved.studioKey, eventId: ev.id, itemId: saved.id };
  icOpen(saved.studioKey);
}

/** Retour de l'atelier vers la fiche de l'événement puis de l'objet (rechargées : image de la fiche à jour). */
async function evBackTo(eventId, itemId) {
  document.querySelector('.tab-btn[data-tab="events"]').click();
  await loadEvents();
  const ev = _ev?.events.find(e => e.id === eventId);
  if (!ev) return;
  evOpen(ev, document.querySelector(`[data-adm-key="${CSS.escape(`ev:${eventId}`)}"]`));
  const idx = _evCur.draft.items.findIndex(i => i.id === itemId);
  if (idx >= 0) eviOpen(idx, document.querySelector(`#ev-items [data-adm-key="evi:${idx}"]`));
}

/** #65 : images de la fiche → images vues des joueurs ; ni statut, ni dates, ni drops ne changent. */
async function evPublishImages() {
  const ev = _evCur.ev;
  const pending = evImgPending(ev);
  if (!pending.length) return;
  const found = Object.values(ev.stats.finds).reduce((a, b) => a + b, 0);
  if (evDirty() && !await admConfirmDiscard({ keep: 'Enregistrer le brouillon', effect: 'publie les images enregistrées ; les saisies non enregistrées de cette fiche sont perdues.' })) return;
  if (!await admConfirm({ title: `Publier ${pending.length} image(s) de « ${ev.names.fr} » ?`,
    text: pending.map(i => `${i.icon} ${i.names.fr} : ${i.image ? 'nouvelle image' : 'retour à l\'emoji'}`).join(' · '),
    impact: [found ? `${found} souvenir(s) déjà trouvé(s) : les joueurs concernés verront la nouvelle image à leur prochain chargement.` : 'Aucun souvenir trouvé pour l\'instant.',
      'Le statut, les dates, les testeurs et les drops ne changent pas.', 'Retour arrière : remettre l\'image précédente dans l\'atelier (historique), puis republier.'],
    ok: '🖼 Publier les images' })) return;
  _evSnap = null;
  await evAction(ev.id, 'publish-images', `${pending.length} image(s) publiée(s) : visibles des joueurs.`);
}

async function eviCanClose() {
  if (eviDirty() && !await admConfirm({
    title: 'Modifications de l\'objet non appliquées',
    text: 'Cette fiche d\'objet contient des saisies qui ne sont pas appliquées à l\'événement.',
    impact: ['« Abandonner » ferme la fiche objet et perd ces saisies.', 'Pour les garder : « Continuer à modifier », puis « Appliquer à la fiche ».'],
    ok: 'Abandonner les modifications', cancel: 'Continuer à modifier', danger: true,
  })) return false;
  _eviSnap = null;
  return true;
}
admDialogSetup('ev-item-dialog', { canClose: eviCanClose, dirty: () => eviDirty() });

function eviApply() {
  const it = eviRead();
  if (!EV_ITEM_ID_RE.test(it.id)) return nwMessage('evi-msg', 'Identifiant : minuscules, chiffres et _ (3 à 40 caractères, commence par une lettre).', true);
  if (_evCur.draft.items.some((o, k) => o.id === it.id && k !== _evi.idx)) return nwMessage('evi-msg', `Un autre objet utilise déjà « ${it.id} ».`, true);
  if (!it.names.fr) return nwMessage('evi-msg', 'Nom FR obligatoire.', true);
  if (!(it.chancePct >= 0.001 && it.chancePct <= 100)) return nwMessage('evi-msg', 'Chance entre 0,001 et 100 %.', true);
  if (_evi.idx >= 0) _evCur.draft.items[_evi.idx] = it; else _evCur.draft.items.push(it);
  _eviSnap = null;
  document.getElementById('ev-item-dialog').close();
  evRenderItems();
  nwMessage('ev-editor-msg', 'Objet appliqué : « Enregistrer le brouillon » pour l\'enregistrer.');
}

async function eviRemove() {
  const it = _evi.item;
  const found = _evCur.ev?.stats.finds[it.id] ?? 0;
  if (found) return nwMessage('evi-msg', `Objet déjà trouvé ${found} fois : impossible de le retirer (décochez « Objet activé » à la place).`, true);
  if (!await admConfirm({ title: `Retirer « ${it.names.fr || it.id} » ?`, text: 'L\'objet disparaît de la fiche.',
    impact: ['Rien n\'est enregistré avant « Enregistrer le brouillon » ; les révisions conservent l\'ancienne version.'], ok: '🗑 Retirer', danger: true })) return;
  _evCur.draft.items.splice(_evi.idx, 1);
  _eviSnap = null;
  document.getElementById('ev-item-dialog').close();
  evRenderItems();
}

// ── Création : « ＋ Ajouter » → manuel / TEST / IA ─────────────────────────────

let _evTestPicker = null, _evAiWhen = null;
admDialogSetup('ev-add-dialog');
admDialogSetup('ev-test-dialog');
admDialogSetup('ev-ai-dialog');
admDialogSetup('ev-revisions-dialog');

document.getElementById('btn-ev-add')?.addEventListener('click', e => admDialogOpen('ev-add-dialog', e.currentTarget, 'btn-ev-add-manual'));
document.getElementById('btn-ev-add-manual')?.addEventListener('click', () => {
  const opener = document.getElementById('ev-add-dialog')._admOpener;
  document.getElementById('ev-add-dialog').close();
  evOpen(null, opener);
});
document.getElementById('btn-ev-add-test')?.addEventListener('click', () => {
  const opener = document.getElementById('ev-add-dialog')._admOpener;
  document.getElementById('ev-add-dialog').close();
  _evTestPicker = evTesterPicker(document.getElementById('ev-test-testers'));
  nwMessage('ev-test-msg', '');
  admDialogOpen('ev-test-dialog', opener, document.querySelector('#ev-test-testers input'));
});
document.getElementById('btn-ev-add-ai')?.addEventListener('click', () => {
  const opener = document.getElementById('ev-add-dialog')._admOpener;
  document.getElementById('ev-add-dialog').close();
  _evAiWhen = evWhenField(document.getElementById('ev-ai-when'));
  nwMessage('ev-ai-msg', '');
  admDialogOpen('ev-ai-dialog', opener, 'ev-ai-concept');
});
document.getElementById('btn-ev-test')?.addEventListener('click', async () => {
  const testers = _evTestPicker.get();
  if (!testers.length) return nwMessage('ev-test-msg', 'Choisissez au moins un compte testeur dans la liste.', true);
  const { ok, data } = await api('POST', '/api/admin/events/test', { testers, minutes: Number(document.getElementById('ev-test-minutes').value) });
  if (!ok) return nwMessage('ev-test-msg', data.error ?? 'Création impossible.', true);
  const opener = document.getElementById('ev-test-dialog')._admOpener;
  document.getElementById('ev-test-dialog').close();
  admToast(`Brouillon TEST « ${data.event.id} » créé : « Démarrer le test maintenant » dans la fiche pour l'activer.`);
  await loadEvents();
  const ev = _ev.events.find(x => x.id === data.event.id);
  if (ev) { evOpen(ev, opener); document.getElementById('ev-now-min').value = String(document.getElementById('ev-test-minutes').value); }
});
document.getElementById('btn-ev-ai')?.addEventListener('click', async () => {
  const w = _evAiWhen.get();
  if (w.error) return nwMessage('ev-ai-msg', w.error, true);
  const { ok, data } = await api('POST', '/api/admin/events-ai', { concept: document.getElementById('ev-ai-concept').value,
    startsAt: w.startsAt, endsAt: w.endsAt, itemCount: Number(document.getElementById('ev-ai-count').value) });
  if (!ok) return nwMessage('ev-ai-msg', data.error ?? 'Proposition impossible.', true);
  document.getElementById('ev-ai-dialog').close();
  admToast('Proposition IA lancée : le brouillon TEST apparaîtra dans la liste.');
  loadEvents();
});

admRefreshButton('btn-ev-refresh', loadEvents, 'Événements');
document.getElementById('btn-ev-item-add')?.addEventListener('click', e => eviOpen(-1, e.currentTarget));
document.getElementById('btn-ev-save')?.addEventListener('click', evSave);
document.getElementById('btn-ev-sim')?.addEventListener('click', evSimulate);
document.getElementById('btn-ev-schedule')?.addEventListener('click', evSchedule);
document.getElementById('btn-ev-start-now')?.addEventListener('click', evStartNow);
document.getElementById('btn-ev-unschedule')?.addEventListener('click', evUnschedule);
document.getElementById('btn-ev-revisions')?.addEventListener('click', evRevisions);
document.getElementById('btn-evi-apply')?.addEventListener('click', eviApply);
document.getElementById('btn-evi-remove')?.addEventListener('click', eviRemove);
document.getElementById('btn-evi-studio')?.addEventListener('click', eviOpenStudio);
document.getElementById('btn-ev-publish-images')?.addEventListener('click', evPublishImages);
document.getElementById('ev-cal-year')?.addEventListener('change', renderEvCalendar);
document.getElementById('ev-audience')?.addEventListener('change', evRenderState);
document.getElementById('ev-name')?.addEventListener('input', e => { _evCur.draft.names[_evLang] = e.target.value; });
document.getElementById('ev-tag')?.addEventListener('input', e => { _evCur.draft.taglines[_evLang] = e.target.value; });
document.getElementById('evi-name')?.addEventListener('input', e => { _evi.item.names[_eviLang] = e.target.value; eviPreview(); });
document.getElementById('evi-desc')?.addEventListener('input', e => { _evi.item.descs[_eviLang] = e.target.value; eviPreview(); });
for (const id of ['evi-icon', 'evi-rarity', 'evi-chance', 'evi-image']) document.getElementById(id)?.addEventListener('input', eviPreview);
document.getElementById('evi-upload')?.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    const { ok, data } = await api('POST', '/api/admin/collections/images', { data: r.result, label: `event ${_evi.item.id}` });
    if (!ok) return nwMessage('evi-msg', data.error ?? 'Téléversement impossible.', true);
    document.getElementById('evi-image').value = data.url;
    eviPreview();
    admToast('Image téléversée : « Appliquer à la fiche » puis « Enregistrer le brouillon ».');
  };
  r.readAsDataURL(f);
});

// ── 🔮 Reliques (#64) ──────────────────────────────────────────────────────────
// Catalogue versionné côté serveur (server/relicCatalog.js). La version 1 = les six reliques du jeu à l'identique.
// Les fiches écrivent dans un brouillon ; seule « Publier… » change le jeu (comparaison avant/après, note, journal),
// et « Revenir à cette version » republie une version antérieure. Aucun appel IA ici : l'image passe par 🎨 Icônes.
let _rl = null;          // vue admin (published, draft, versions, holders, effects…)
let _rlCur = null;       // { id, isNew } de la fiche ouverte
let _rlLang = 'fr';
let _rlSnap = '';        // instantané de la fiche à l'ouverture (#61)
const RL_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const RL_FIELDS = { names: 'Noms', descs: 'Descriptions', icon: 'Icône', image: 'Image', active: 'Active', maxLevel: 'Niveaux',
  costs: 'Coûts', effect: 'Effet', values: 'Bonus' };
const RL_SIM_BASE = {
  damage_flat:          ['Niveau de pioche', 10],
  coins_pct:            ['Pièces d\'un bloc (référence)', 100],
  relic_fragment_bonus: ['Fragments tirés dans un coffre', 4],
  luck_pct:             ['Niveau de Chance', 5],
  hp_reduction:         ['PV d\'un bloc (référence)', 1000],
  autodig_bonus:        ['Niveau d\'Auto-Dig', 4],
};

const rlWorking = () => _rl?.draft?.relics ?? _rl?.published?.relics ?? [];
const rlPublished = id => _rl?.published?.relics.find(r => r.id === id) ?? null;
const rlFx = effect => _rl?.effects?.[effect] ?? null;
const rlPct = v => Math.round(v * 10000) / 100;
function rlFormat(effect, v) {
  const fx = rlFx(effect);
  if (v == null || !fx) return '—';
  if (effect === 'hp_reduction') return `−${rlPct(v)} % PV`;
  return fx.pct ? `+${rlPct(v)} % ${fx.label.toLowerCase()}` : `+${v} ${fx.unit}`;
}
const rlHolders = id => _rl?.holders?.byRelic?.[id] ?? {};
const rlHolderTotal = id => Object.values(rlHolders(id)).reduce((s, n) => s + n, 0);
function rlFieldText(field, v, r) {
  if (v == null) return '—';
  if (field === 'values') return v.map(x => rlFormat(r.effect, x)).join(' / ');
  if (field === 'costs') return v.join(' / ');
  if (field === 'names' || field === 'descs') return RL_LANGS.map(l => `${l.toUpperCase()} : ${v[l] || '—'}`).join(' · ');
  if (field === 'effect') return rlFx(v)?.label ?? v;
  if (field === 'active') return v ? 'oui' : 'non (archivée)';
  return String(v);
}

async function loadRelics() {
  const { ok, data } = await api('GET', '/api/admin/relics');
  if (!ok) { ptMessage('rl-msg', data.error || 'Erreur lors du chargement.', false); return; }
  _rl = data;
  document.getElementById('rl-obtain').textContent = `Obtention : ${data.obtainRule}`;
  const fxList = document.getElementById('rl-effects');
  fxList.textContent = '';
  for (const [k, fx] of Object.entries(data.effects)) {
    fxList.appendChild(aiEl('li', {}, `${fx.label} (${k}) — ${fx.formula}${fx.antibot ? ` ${fx.antibot}` : ''}`));
  }
  const sel = document.getElementById('rl-effect');
  if (!sel.options.length) coSelect('rl-effect', Object.entries(data.effects).map(([k, fx]) => [k, fx.label]));
  const pub = data.published;
  document.getElementById('rl-version').textContent = `— version ${pub.version} en vigueur`;
  const active = pub.relics.filter(r => r.active).length;
  document.getElementById('rl-summary').textContent =
    `Version ${pub.version} en vigueur : ${pub.relics.length} relique(s), dont ${active} active(s). ${data.holders.saves} sauvegarde(s) cloud analysée(s) pour les détenteurs.`;
  rlRenderDraft();
  rlRenderList();
  rlRenderVersions();
  loadRelicAudit();
}

function rlRenderDraft() {
  const box = document.getElementById('rl-draft');
  const d = _rl?.draft;
  box.classList.toggle('hidden', !d);
  if (!d) return;
  document.getElementById('rl-draft-meta').textContent = `— basé sur la version ${d.basedOn}, modifié le ${admBrussels(d.updatedAt)}`;
  const errs = document.getElementById('rl-draft-errors'), warns = document.getElementById('rl-draft-warnings');
  errs.textContent = ''; warns.textContent = '';
  for (const e of d.errors) errs.appendChild(aiEl('li', {}, e));
  for (const w of d.warnings) warns.appendChild(aiEl('li', {}, w));
  errs.classList.toggle('hidden', !d.errors.length);
  warns.classList.toggle('hidden', !d.warnings.length);
  const body = document.getElementById('rl-draft-body');
  body.textContent = '';
  for (const c of d.changes) {
    const r = d.relics.find(x => x.id === c.id) ?? {};
    const name = `${r.icon ?? ''} ${r.names?.fr ?? c.id}`;
    if (c.kind === 'added') {
      const tr = body.insertRow();
      addCell(tr, name); addCell(tr, 'nouvelle relique'); addCell(tr, '—'); addCell(tr, `${r.maxLevel} niveaux · ${rlFormat(r.effect, r.values?.at(-1))} au max`);
      continue;
    }
    const before = rlPublished(c.id) ?? r;
    for (const f of c.fields) {
      const tr = body.insertRow();
      addCell(tr, name); addCell(tr, RL_FIELDS[f.field] ?? f.field);
      addCell(tr, rlFieldText(f.field, f.before, before)); addCell(tr, rlFieldText(f.field, f.after, r));
    }
  }
  document.getElementById('btn-rl-publish').disabled = !!d.errors.length || !d.changes.length;
}

function rlRenderList() {
  if (!_rl) return;
  const text = document.getElementById('rl-filter-text').value.trim().toLowerCase();
  const status = document.getElementById('rl-filter-status').value;
  const changed = new Set((_rl.draft?.changes ?? []).map(c => c.id));
  const list = rlWorking().filter(r => {
    if (status === 'active' && !r.active) return false;
    if (status === 'archived' && r.active) return false;
    if (status === 'draft' && !changed.has(r.id)) return false;
    if (!text) return true;
    return [r.id, ...Object.values(r.names ?? {}), rlFx(r.effect)?.label ?? ''].some(s => String(s).toLowerCase().includes(text));
  });
  document.getElementById('rl-count').textContent = `(${list.length}/${rlWorking().length})`;
  const body = document.getElementById('rl-body');
  body.textContent = '';
  if (!list.length) { const tr = body.insertRow(); addCell(tr, 'Aucune relique.').colSpan = 9; return; }
  for (const r of list) {
    const tr = body.insertRow();
    const art = addCell(tr, '');
    if (r.image) art.appendChild(aiEl('img', { src: r.image, alt: '', width: '32', height: '32', loading: 'lazy' }));
    else art.textContent = r.icon;
    const nameCell = addCell(tr, r.names?.fr ?? r.id);
    nameCell.appendChild(aiEl('div', { class: 'muted', style: 'font-size:0.72rem' }, r.id));
    addCell(tr, rlFx(r.effect)?.label ?? r.effect);
    addCell(tr, String(r.maxLevel)).className = 'num';
    addCell(tr, r.costs.join(' / '));
    addCell(tr, `${rlFormat(r.effect, r.values[0])} → ${rlFormat(r.effect, r.values.at(-1))}`);
    addCell(tr, String(rlHolderTotal(r.id))).className = 'num';
    const pubR = rlPublished(r.id);
    addCell(tr, `${r.active ? 'Active' : 'Archivée'}${!pubR ? ' · nouvelle (brouillon)' : changed.has(r.id) ? ' · modifiée (brouillon)' : ''}`);
    admRowOpen(tr, `rl:${r.id}`, r.names?.fr ?? r.id, opener => rlOpen(r, opener));
  }
}

function rlRenderVersions() {
  const body = document.getElementById('rl-versions-body');
  body.textContent = '';
  const current = _rl.published.version;
  for (const v of _rl.versions) {
    const tr = body.insertRow();
    addCell(tr, `v${v.version}${v.version === current ? ' (en vigueur)' : ''}`);
    addCell(tr, { origin: 'origine', publish: 'publication', rollback: `retour à v${v.fromVersion}` }[v.source] ?? v.source);
    addCell(tr, v.note ?? '');
    addCell(tr, v.createdAt);
    if (v.version === current) addCell(tr, '');
    else addButtonCell(tr, 'Revenir à cette version…', () => rlRollback(v.version));
  }
}

async function loadRelicAudit() {
  const { ok, data } = await api('GET', '/api/admin/relics/audit?limit=100');
  const body = document.getElementById('rl-audit-body');
  body.textContent = '';
  if (!ok) return;
  const labels = { migrate: 'version d\'origine', draft_add: 'ajout (brouillon)', draft_update: 'modification (brouillon)', draft_revert: 'modification annulée',
    draft_remove: 'retrait du brouillon', draft_discard: 'brouillon abandonné', draft_clean: 'brouillon identique supprimé', publish: 'publication', rollback: 'retour arrière' };
  for (const a of data.audit) {
    const tr = body.insertRow();
    addCell(tr, a.created_at); addCell(tr, labels[a.action] ?? a.action); addCell(tr, a.version ? `v${a.version}` : '');
    const d = a.details;
    const fields = d?.changes?.map?.(c => (c.field ? RL_FIELDS[c.field] ?? c.field : `${c.id} ${c.kind === 'added' ? '(nouvelle)' : `(${(c.fields ?? []).map(f => RL_FIELDS[f.field] ?? f.field).join(', ')})`}`)) ?? [];
    addCell(tr, [d?.id, d?.to ? `vers v${d.to}` : '', fields.join(', ')].filter(Boolean).join(' — '));
  }
}

// ── Fiche ──

function rlSetLang(l, focus = false) {
  _rlLang = l;
  for (const b of document.querySelectorAll('#rl-langs .co-lang-btn')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
  for (const f of document.querySelectorAll('#rl-dialog .nw-lang-fields')) f.classList.toggle('hidden', f.dataset.lang !== l);
  if (focus) document.querySelector(`#rl-langs .co-lang-btn[data-lang="${l}"]`).focus();
}
function rlLangStates() {
  for (const b of document.querySelectorAll('#rl-langs .co-lang-btn')) {
    const l = b.dataset.lang;
    const n = document.getElementById(`rl-${l}-name`).value.trim(), d = document.getElementById(`rl-${l}-desc`).value.trim();
    const st = n && d ? 'full' : n ? 'name' : 'none';
    b.className = `co-lang-btn co-lang--${st}`;
    b.textContent = `${{ full: '●', name: '◐', none: '○' }[st]} ${l.toUpperCase()}`;
  }
}

/** Lignes de niveaux : garde les saisies existantes quand le nombre de niveaux change. */
function rlRenderLevels(costs, values) {
  const fx = rlFx(document.getElementById('rl-effect').value);
  const max = Math.min(10, Math.max(1, Number(document.getElementById('rl-max').value) || 1));
  const body = document.getElementById('rl-levels-body');
  const prev = rlReadLevels();
  costs = costs ?? prev.costs; values = values ?? prev.values;
  body.textContent = '';
  const holders = _rlCur ? rlHolders(_rlCur.id) : {};
  for (let i = 0; i < max; i++) {
    const tr = body.insertRow();
    addCell(tr, String(i + 1)).className = 'num';
    const c = aiEl('input', { type: 'number', min: '1', step: '1', 'data-rl': 'cost', 'aria-label': `Coût du niveau ${i + 1}` });
    c.value = costs[i] ?? '';
    addCell(tr, '').appendChild(c);
    const v = aiEl('input', { type: 'number', min: '0', step: fx?.integer ? '1' : 'any', 'data-rl': 'value', 'aria-label': `Bonus total au niveau ${i + 1}` });
    v.value = values[i] == null ? '' : fx?.pct ? rlPct(values[i]) : values[i];
    const vc = addCell(tr, '');
    vc.appendChild(v);
    vc.appendChild(aiEl('span', { class: 'muted' }, ` ${fx?.pct ? '%' : fx?.unit ?? ''}`));
    addCell(tr, '').className = 'num rl-cum';
    addCell(tr, String(holders[i + 1] ?? 0)).className = 'num';
  }
  rlRefresh();
}
function rlReadLevels() {
  const fx = rlFx(document.getElementById('rl-effect').value);
  const num = el => (el.value.trim() === '' ? null : Number(el.value));
  const costs = [...document.querySelectorAll('#rl-levels-body [data-rl="cost"]')].map(num);
  const values = [...document.querySelectorAll('#rl-levels-body [data-rl="value"]')].map(el => {
    const n = num(el);
    return n == null ? null : fx?.pct ? Math.round(n * 100) / 10000 : n;
  });
  return { costs, values };
}

function rlRead() {
  const names = {}, descs = {};
  for (const l of RL_LANGS) {
    names[l] = document.getElementById(`rl-${l}-name`).value.trim();
    descs[l] = document.getElementById(`rl-${l}-desc`).value.trim();
  }
  const { costs, values } = rlReadLevels();
  return {
    id: document.getElementById('rl-id').value.trim(),
    active: document.getElementById('rl-active').checked,
    icon: document.getElementById('rl-icon').value.trim(),
    image: document.getElementById('rl-image').value.trim() || null,
    names, descs,
    maxLevel: Number(document.getElementById('rl-max').value),
    costs, effect: document.getElementById('rl-effect').value, values,
  };
}

function rlArt() {
  const box = document.getElementById('rl-art');
  box.textContent = '';
  const img = document.getElementById('rl-image').value.trim();
  if (img) box.appendChild(aiEl('img', { src: img, alt: '', width: '56', height: '56' }));
  else box.textContent = document.getElementById('rl-icon').value || '🔮';
  document.getElementById('btn-rl-noimage').classList.toggle('hidden', !img);
}

/** Aperçu réel (mêmes formules que le moteur, public/js/relics.js → applyBonuses) et comparaison publiée. */
function rlRefresh() {
  const r = rlRead();
  const fx = rlFx(r.effect);
  let cum = 0;
  document.querySelectorAll('#rl-levels-body .rl-cum').forEach((td, i) => { cum += r.costs[i] ?? 0; td.textContent = String(cum); });
  document.getElementById('rl-effect-help').textContent = fx ? `${fx.formula}${fx.antibot ? ` ${fx.antibot}` : ''} Bornes par niveau : ${fx.pct ? `${rlPct(fx.min)} % à ${rlPct(fx.max)} %` : `${fx.min} à ${fx.max}`}.` : '';
  document.getElementById('rl-formula').textContent = fx ? `Calcul : ${fx.formula}` : '';
  const lvSel = document.getElementById('rl-sim-level');
  const keep = lvSel.value;
  lvSel.textContent = '';
  for (let l = 0; l <= r.maxLevel; l++) lvSel.appendChild(aiEl('option', { value: String(l) }, l === 0 ? '0 — verrouillée' : `${l}${l === r.maxLevel ? ' (max)' : ''}`));
  lvSel.value = keep !== '' && Number(keep) <= r.maxLevel ? keep : '0';
  const [baseLabel, baseDef] = RL_SIM_BASE[r.effect] ?? ['Référence', 0];
  document.getElementById('rl-sim-base-label').firstChild.textContent = baseLabel;
  const baseEl = document.getElementById('rl-sim-base');
  if (baseEl.dataset.fx !== r.effect) { baseEl.value = baseDef; baseEl.dataset.fx = r.effect; }
  const L = Number(lvSel.value), base = Number(baseEl.value) || 0;
  const b = L > 0 ? r.values[L - 1] ?? 0 : 0;
  const next = L < r.maxLevel ? r.values[L] : null;
  const calc = v => {
    switch (r.effect) {
      case 'damage_flat': return `${base + v} dégâts par clic (pioche ${base} + ${v})`;
      case 'coins_pct': return `${Math.round(base * (1 + v))} pièces (${base} × ${(1 + v).toFixed(2)}, hors Sac et boosts)`;
      case 'relic_fragment_bonus': return `${base + v} fragments par coffre (${base} + ${v})`;
      case 'luck_pct': return `poids des blocs rares × ${(1 + 0.1 * base + v).toFixed(2)} (Chance ${base} : 1 + ${(0.1 * base).toFixed(2)} + ${v})`;
      case 'hp_reduction': return `${Math.ceil(base * (1 - Math.min(v, 0.9)))} PV (${base} × ${(1 - Math.min(v, 0.9)).toFixed(2)})`;
      case 'autodig_bonus': return `${base + v} dégâts auto/s (Auto-Dig ${base} + ${v})`;
      default: return '';
    }
  };
  const holders = _rlCur ? rlHolders(_rlCur.id)[L] ?? 0 : 0;
  const sim = document.getElementById('rl-sim');
  sim.textContent = '';
  sim.appendChild(aiEl('div', {}, `Niveau ${L} : ${L ? rlFormat(r.effect, b) : 'aucun bonus'} → ${calc(b)}.`));
  if (next != null) {
    sim.appendChild(aiEl('div', {}, `Niveau ${L + 1} : ${rlFormat(r.effect, next)} → ${calc(next)} — ${L === 0 ? 'déblocage' : 'amélioration'} pour ${r.costs[L] ?? '?'} fragments.`));
  } else sim.appendChild(aiEl('div', {}, 'Niveau maximum : aucune amélioration.'));
  if (_rlCur && !_rlCur.isNew) sim.appendChild(aiEl('div', { class: 'muted' }, `${holders} joueur(s) à ce niveau (sauvegardes cloud).`));
  // Comparaison avec la version en vigueur
  const pub = _rlCur ? rlPublished(_rlCur.id) : null;
  const cmp = document.getElementById('rl-compare'), ul = document.getElementById('rl-compare-list');
  ul.textContent = '';
  if (pub) {
    for (const f of Object.keys(RL_FIELDS)) {
      if (JSON.stringify(pub[f] ?? null) === JSON.stringify(r[f] ?? null)) continue;
      ul.appendChild(aiEl('li', {}, `${RL_FIELDS[f]} : ${rlFieldText(f, pub[f], pub)} → ${rlFieldText(f, r[f], r)}`));
    }
  }
  cmp.classList.toggle('hidden', !ul.children.length);
  rlLangStates();
  rlArt();
}

function rlOpen(relic, opener, isNew = false) {
  _rlCur = { id: relic.id, isNew };
  const r = relic;
  document.getElementById('rl-form-title').textContent = isNew ? 'Nouvelle relique' : `${r.icon} ${r.names?.fr ?? r.id}`;
  for (const l of RL_LANGS) {
    document.getElementById(`rl-${l}-name`).value = r.names?.[l] ?? '';
    document.getElementById(`rl-${l}-desc`).value = r.descs?.[l] ?? '';
  }
  const idEl = document.getElementById('rl-id');
  idEl.value = r.id ?? '';
  idEl.readOnly = !isNew;
  document.getElementById('rl-active').checked = r.active !== false;
  document.getElementById('rl-icon').value = r.icon ?? '';
  document.getElementById('rl-image').value = r.image ?? '';
  document.getElementById('rl-effect').value = r.effect;
  document.getElementById('rl-max').value = r.maxLevel;
  document.getElementById('rl-max').min = String(_rl.publishedMaxLevels?.[r.id] ?? 1);
  document.getElementById('rl-sim-level').value = '';
  document.getElementById('rl-sim-base').dataset.fx = '';
  rlRenderLevels(r.costs, r.values);
  const pub = rlPublished(r.id);
  const changed = !!pub && !isNew && (_rl.draft?.changes ?? []).some(c => c.id === r.id);
  const draftOnly = !isNew && !_rl.publishedIds.includes(r.id);
  const state = document.getElementById('rl-state');
  state.textContent = isNew ? 'Nouvelle relique : enregistrée dans le brouillon, invisible des joueurs avant publication.'
    : draftOnly ? 'Relique du brouillon, jamais publiée.'
    : changed ? 'Cette relique a des modifications dans le brouillon (pas encore en jeu) : la comparaison ci-dessous montre l\'écart avec la version en vigueur.'
    : `Valeurs en vigueur (version ${_rl.published.version}), identiques à celles du jeu.`;
  state.classList.remove('hidden');
  document.getElementById('rl-issues').classList.add('hidden');
  document.getElementById('btn-rl-revert').classList.toggle('hidden', !changed);
  document.getElementById('btn-rl-remove').classList.toggle('hidden', !draftOnly);
  rlSetLang('fr');
  _rlSnap = JSON.stringify(rlRead());
  admDialogOpen('rl-dialog', opener, isNew ? 'rl-fr-name' : null);
}

admDialogSetup('rl-dialog', { dirty: () => JSON.stringify(rlRead()) !== _rlSnap, keep: 'Enregistrer dans le brouillon' });

function rlIssues(data) {
  const ul = document.getElementById('rl-issues');
  ul.textContent = '';
  for (const e of [data.error, ...(data.details ?? [])].filter(Boolean)) ul.appendChild(aiEl('li', {}, e));
  ul.classList.toggle('hidden', !ul.children.length);
  ul.scrollIntoView?.({ block: 'nearest' });
}

document.getElementById('btn-rl-add').addEventListener('click', e => {
  if (!_rl) return;
  rlOpen({ id: '', active: true, icon: '🔮', image: null, names: {}, descs: {}, maxLevel: 5, costs: [10, 20, 35, 55, 80],
    effect: 'coins_pct', values: [0.05, 0.1, 0.15, 0.2, 0.25] }, e.currentTarget, true);
});
document.getElementById('rl-langs').addEventListener('click', e => { const b = e.target.closest('.co-lang-btn'); if (b) rlSetLang(b.dataset.lang); });
document.getElementById('rl-max').addEventListener('input', () => rlRenderLevels());
document.getElementById('rl-effect').addEventListener('change', () => rlRenderLevels());
document.getElementById('rl-dialog').addEventListener('input', e => { if (e.target.id !== 'rl-max') rlRefresh(); });
document.getElementById('rl-sim-level').addEventListener('change', rlRefresh);
document.getElementById('rl-filter-text').addEventListener('input', rlRenderList);
document.getElementById('rl-filter-status').addEventListener('change', rlRenderList);
document.getElementById('btn-rl-noimage').addEventListener('click', () => { document.getElementById('rl-image').value = ''; rlRefresh(); });

document.getElementById('btn-rl-save').addEventListener('click', async () => {
  const relic = rlRead();
  if (!relic.id) return rlIssues({ error: 'Identifiant obligatoire (a-z, 0-9, _).' });
  if (_rlCur.isNew && rlWorking().some(r => r.id === relic.id)) return rlIssues({ error: `« ${relic.id} » existe déjà.` });
  const { ok, data } = await api('PUT', `/api/admin/relics/draft/relics/${encodeURIComponent(relic.id)}`, { relic });
  if (!ok) return rlIssues(data);
  _rlSnap = JSON.stringify(rlRead());
  document.getElementById('rl-dialog').close();
  ptMessage('rl-msg', data.draftDropped
    ? `« ${relic.id} » : identique à la version en vigueur, aucun brouillon en attente.`
    : `« ${relic.id} » enregistrée dans le brouillon. Rien ne change pour les joueurs avant « Publier… ».`, true);
  loadRelics();
});

document.getElementById('btn-rl-revert').addEventListener('click', async () => {
  const id = _rlCur?.id;
  if (!id || !await admAsk(`Annuler les modifications de « ${id} » ?\nElle reprend dans le brouillon ses valeurs en vigueur ; les autres reliques du brouillon ne bougent pas.`)) return;
  const { ok, data } = await api('POST', `/api/admin/relics/draft/relics/${encodeURIComponent(id)}/revert`);
  if (!ok) return rlIssues(data);
  document.getElementById('rl-dialog').close();
  ptMessage('rl-msg', `« ${id} » : modifications annulées${data.draftDropped ? ' ; plus aucun brouillon en attente.' : '.'}`, true);
  loadRelics();
});

document.getElementById('btn-rl-remove').addEventListener('click', async () => {
  const id = _rlCur?.id;
  if (!id || !await admAsk(`Retirer « ${id} » du brouillon ?\nElle n'a jamais été publiée : aucun joueur ne la possède.`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/relics/draft/relics/${encodeURIComponent(id)}`);
  if (!ok) return rlIssues(data);
  document.getElementById('rl-dialog').close();
  ptMessage('rl-msg', `« ${id} » retirée du brouillon.`, true);
  loadRelics();
});

document.getElementById('btn-rl-discard').addEventListener('click', async () => {
  if (!await admConfirm({ title: 'Abandonner le brouillon des reliques ?', text: 'Toutes les modifications non publiées sont perdues.',
    impact: ['Rien ne change pour les joueurs : la version en vigueur reste appliquée.', 'L\'action est tracée dans le journal.'], ok: 'Abandonner le brouillon', danger: true })) return;
  const { ok, data } = await api('DELETE', '/api/admin/relics/draft');
  ptMessage('rl-msg', ok ? 'Brouillon abandonné : aucun changement pour les joueurs.' : (data.error || 'Erreur.'), ok);
  loadRelics();
});

document.getElementById('btn-rl-publish').addEventListener('click', async () => {
  const d = _rl?.draft;
  if (!d) return;
  const ids = d.changes.map(c => c.id);
  const note = await admPrompt({ title: `Publier le brouillon (version ${_rl.published.version + 1}) ?`,
    text: `Reliques concernées : ${ids.join(', ')}. Les nouvelles valeurs (coûts, bonus, textes, images) s'appliquent à TOUS les joueurs à leur prochain chargement ; les niveaux possédés et les fragments ne sont jamais modifiés. Retour arrière possible : « Versions publiées → Revenir à cette version ».`,
    label: 'Note de publication (raison, accord du propriétaire)', ok: 'Publier' });
  if (note === null) return;
  const { ok, data } = await api('POST', '/api/admin/relics/publish', { note, basedOn: d.basedOn });
  if (!ok) { ptMessage('rl-msg', [data.error, ...(data.details ?? [])].filter(Boolean).join(' '), false); return; }
  ptMessage('rl-msg', `Version ${data.version} publiée (${data.changes.length} relique(s) modifiée(s)).`, true);
  loadRelics();
});

async function rlRollback(version) {
  if (!await admConfirm({ title: `Revenir à la version ${version} ?`, text: 'Une NOUVELLE version reprenant ce contenu est publiée immédiatement.',
    impact: ['Les joueurs reçoivent ces valeurs à leur prochain chargement ; niveaux possédés et fragments inchangés.',
      'Les reliques ajoutées depuis sont gardées mais archivées ; le nombre de niveaux ne baisse jamais.', 'Le brouillon éventuel est abandonné.'],
    ok: `Revenir à la version ${version}`, danger: true })) return;
  const { ok, data } = await api('POST', '/api/admin/relics/rollback', { version });
  ptMessage('rl-msg', ok ? `Version ${data.version} publiée (retour au contenu de la version ${data.restored}).` : [data.error, ...(data.details ?? [])].filter(Boolean).join(' '), ok);
  loadRelics();
}

document.getElementById('btn-rl-studio').addEventListener('click', async () => {
  const id = _rlCur?.id;
  if (!id || !_rl.draft?.relics?.some(r => r.id === id) && !rlPublished(id)) {
    return rlIssues({ error: 'Enregistrez d\'abord la relique dans le brouillon : l\'atelier travaille sur une relique existante.' });
  }
  const dlg = document.getElementById('rl-dialog');
  if (dlg._admDirty() && !await admConfirmDiscard({ keep: 'Enregistrer dans le brouillon', effect: 'ferme la fiche, perd ces saisies et ouvre l\'atelier d\'icônes.' })) return;
  _rlSnap = JSON.stringify(rlRead());
  dlg.close();
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  _icFrom = { kind: 'relic', id };
  icOpen(`relic:${id}`);
});

/** Retour de l'atelier d'icônes vers la fiche de la relique (catalogue rechargé : image du brouillon). */
async function rlBackTo(id) {
  _rl = null;
  document.querySelector('.tab-btn[data-tab="relics"]').click();
  for (let k = 0; k < 50 && !_rl; k++) await new Promise(r => setTimeout(r, 100));
  const r = rlWorking().find(x => x.id === id);
  if (r) rlOpen(r, document.querySelector(`[data-adm-key="${CSS.escape(`rl:${id}`)}"]`));
}

admRefreshButton('btn-refresh-relics', loadRelics, 'Reliques');

// ── ⬆ Améliorations (#69) ──────────────────────────────────────────────────────
// Barème versionné côté serveur (server/upgradeCatalog.js) : la version 1 = les six améliorations du jeu à l'identique.
// Les fiches écrivent dans un brouillon ; seule « Publier… » change le jeu. La suspension d'urgence est séparée, immédiate
// (nouveaux achats / effets / affichage), avec aperçu, motif et confirmation ; niveaux et sauvegardes jamais modifiés.
let _up = null;          // vue admin (published, draft, versions, holders, controls, types…)
let _upCur = null;       // identifiant de la fiche ouverte
let _upLang = 'fr';
let _upSnap = '';        // instantané de la fiche à l'ouverture (#61)
let _upCtlId = null;     // amélioration de la boîte de suspension
const UP_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const UP_FIELDS = { names: 'Noms', icon: 'Icône', maxLevel: 'Niveaux', costs: 'Prix (pièces)', gems: 'Prix (gemmes)', perLevel: 'Effet par niveau', reroll: 'Paliers du reroll' };
const UP_CTL = [['purchases', 'Nouveaux achats'], ['effects', 'Effets'], ['hidden', 'Affichage']];

const upWorking = () => _up?.draft?.upgrades ?? _up?.published?.upgrades ?? [];
const upPublished = id => _up?.published?.upgrades.find(u => u.id === id) ?? null;
const upType = id => _up?.types?.[id] ?? {};
const upHolders = id => _up?.holders?.byUpgrade?.[id] ?? {};
const upHolderTotal = id => Object.values(upHolders(id)).reduce((s, n) => s + n, 0);
const upNum = n => Number(n).toLocaleString('fr-FR');
const upScale = c => (c > 0 ? Math.ceil(c * (_up?.costMultiplier ?? 1)) : c);

/** Prix du niveau `lvl` atteint (pièces brutes et gemmes), mêmes règles que public/js/upgrades.js. */
function upCostAt(u, lvl) {
  const ty = upType(u.id);
  if (u.reroll) return { coins: u.reroll.base * Math.pow(2, Math.floor((lvl - 1) / u.reroll.every)), gems: 0 };
  const i = lvl - ty.firstLevel - 1;
  return { coins: u.costs?.[i] ?? 0, gems: u.gems?.[i] ?? 0 };
}
/** Effet réel au niveau donné (hors reliques et réglages), en texte. */
function upEffectAt(u, lvl) {
  switch (u.id) {
    case 'pickaxe': return `${lvl} dégât${lvl > 1 ? 's' : ''}/clic`;
    case 'luck': return `poids rares × ${(1 + lvl * (u.perLevel ?? 0)).toFixed(2)}`;
    case 'bag': return `pièces × ${(1 + lvl * (u.perLevel ?? 0)).toFixed(2)}`;
    case 'autodig': return lvl ? `${lvl} dégât${lvl > 1 ? 's' : ''}/s` : 'arrêté';
    case 'fragment_shop': return `${lvl} fragment${lvl > 1 ? 's' : ''} acheté${lvl > 1 ? 's' : ''}`;
    case 'block_reroll': return `${lvl} reroll${lvl > 1 ? 's' : ''}`;
    default: return '';
  }
}
/** Cumul des prix réels (×Config) du niveau de départ jusqu'à `upTo`. */
function upTotals(u, upTo = u.maxLevel) {
  let coins = 0, gems = 0;
  for (let l = upType(u.id).firstLevel + 1; l <= upTo; l++) { const c = upCostAt(u, l); coins += upScale(c.coins); gems += c.gems; }
  return { coins, gems };
}
function upDuration(min) {
  if (!Number.isFinite(min)) return '—';
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  if (min < 60 * 48) return `${(Math.round(min / 6) / 10).toLocaleString('fr-FR')} h`;
  return `${(Math.round(min / 144) / 10).toLocaleString('fr-FR')} j`;
}
function upCtlText(c) {
  const on = UP_CTL.filter(([k]) => c?.[k]).map(([, l]) => l.toLowerCase());
  return on.length ? `Suspendue : ${on.join(', ')}` : 'Active';
}
function upFieldText(field, v) {
  if (v == null) return '—';
  if (field === 'costs' || field === 'gems') return v.map(upNum).join(' / ');
  if (field === 'names') return UP_LANGS.map(l => `${l.toUpperCase()} : ${v[l] || '—'}`).join(' · ');
  if (field === 'reroll') return `base ${upNum(v.base)}, ×2 tous les ${v.every} achats`;
  return String(v);
}
function upArtNode(u, size = 32) {
  const url = _up?.pictos?.[`upgrade_${u.id}`];
  return url ? aiEl('img', { src: url, alt: '', width: String(size), height: String(size), loading: 'lazy' }) : document.createTextNode(u.icon);
}

async function loadUpgrades() {
  const { ok, status, data } = await api('GET', '/api/admin/upgrades');
  // ⚠ du menu : incident serveur à traiter, jamais une suspension volontaire connue (ni une coupure réseau).
  if (ok || status >= 500) admNavFlag('upgrades', ok ? null : 'chargement du catalogue impossible (erreur serveur)');
  if (!ok) { ptMessage('up-msg', data.error || 'Erreur lors du chargement.', false); return; }
  _up = data;
  const pub = data.published;
  document.getElementById('up-version').textContent = `— version ${pub.version} en vigueur`;
  document.getElementById('up-mult').textContent = `×${data.costMultiplier}`;
  const suspended = Object.values(data.controls).filter(c => c.purchases || c.effects || c.hidden).length;
  document.getElementById('up-summary').textContent =
    `Version ${pub.version} en vigueur : ${pub.upgrades.length} améliorations, ${suspended ? `${suspended} désactivée(s) volontairement` : 'aucune désactivée'}. ${data.holders.saves} sauvegarde(s) cloud analysée(s) pour l'usage.`;
  upRenderControls();
  upRenderDraft();
  upRenderList();
  upRenderVersions();
  loadUpgradeAudit();
}

function upRenderControls() {
  const body = document.getElementById('up-ctl-body');
  body.textContent = '';
  let n = 0;
  for (const u of _up.published.upgrades) {
    const c = _up.controls[u.id] ?? {};
    const any = c.purchases || c.effects || c.hidden;
    if (any) n++;
    const tr = body.insertRow();
    if (any) tr.className = 'up-row-suspended';
    const name = addCell(tr, '');
    name.append(upArtNode(u, 24), ` ${u.names?.fr ?? u.id}`);
    for (const [k] of UP_CTL) {
      const na = k === 'effects' && !upType(u.id).suspend;
      addCell(tr, na ? '— (effet immédiat)' : c[k] ? '⏸ suspendu' : '✓ actif');
    }
    addCell(tr, String(upHolderTotal(u.id))).className = 'num';
    addCell(tr, any ? `${c.reason ?? ''}${c.updatedAt ? ` (${admBrussels(c.updatedAt)})` : ''}` : '');
    addButtonCell(tr, any ? 'Réactiver / modifier…' : 'Suspendre…', () => upCtlOpen(u.id));
  }
  document.getElementById('up-ctl-count').textContent = n ? `— ${n} désactivée(s)` : '— aucune suspension';
}

function upRenderDraft() {
  const box = document.getElementById('up-draft');
  const d = _up?.draft;
  box.classList.toggle('hidden', !d);
  if (!d) return;
  document.getElementById('up-draft-meta').textContent = `— basé sur la version ${d.basedOn}, modifié le ${admBrussels(d.updatedAt)}`;
  const errs = document.getElementById('up-draft-errors'), warns = document.getElementById('up-draft-warnings');
  errs.textContent = ''; warns.textContent = '';
  for (const e of d.errors) errs.appendChild(aiEl('li', {}, e));
  for (const w of d.warnings) warns.appendChild(aiEl('li', {}, w));
  errs.classList.toggle('hidden', !d.errors.length);
  warns.classList.toggle('hidden', !d.warnings.length);
  const body = document.getElementById('up-draft-body');
  body.textContent = '';
  for (const c of d.changes) {
    const u = d.upgrades.find(x => x.id === c.id) ?? {};
    for (const f of c.fields ?? []) {
      const tr = body.insertRow();
      addCell(tr, `${u.icon ?? ''} ${u.names?.fr ?? c.id}`); addCell(tr, UP_FIELDS[f.field] ?? f.field);
      addCell(tr, upFieldText(f.field, f.before)); addCell(tr, upFieldText(f.field, f.after));
    }
  }
  document.getElementById('btn-up-publish').disabled = !!d.errors.length || !d.changes.length;
}

function upRenderList() {
  if (!_up) return;
  const text = document.getElementById('up-filter-text').value.trim().toLowerCase();
  const status = document.getElementById('up-filter-status').value;
  const kind = document.getElementById('up-filter-kind').value;
  const changed = new Set((_up.draft?.changes ?? []).map(c => c.id));
  const isSusp = id => { const c = _up.controls[id] ?? {}; return c.purchases || c.effects || c.hidden; };
  const list = upWorking().filter(u => {
    const ty = upType(u.id);
    if (status === 'active' && isSusp(u.id)) return false;
    if (status === 'suspended' && !isSusp(u.id)) return false;
    if (status === 'draft' && !changed.has(u.id)) return false;
    if (kind && ty.kind !== kind) return false;
    if (!text) return true;
    return [u.id, ...Object.values(u.names ?? {}), ty.effect ?? '', ty.label ?? ''].some(s => String(s).toLowerCase().includes(text));
  });
  document.getElementById('up-count').textContent = `(${list.length}/${upWorking().length})`;
  const body = document.getElementById('up-body');
  body.textContent = '';
  if (!list.length) { const tr = body.insertRow(); addCell(tr, 'Aucune amélioration.').colSpan = 10; return; }
  for (const u of list) {
    const ty = upType(u.id);
    const tr = body.insertRow();
    addCell(tr, '').appendChild(upArtNode(u));
    const nameCell = addCell(tr, u.names?.fr ?? u.id);
    nameCell.appendChild(aiEl('div', { class: 'muted', style: 'font-size:0.72rem' }, u.id));
    addCell(tr, `${ty.kind === 'instant' ? 'Achat immédiat' : 'Permanent (saison)'} · ${ty.effect}`);
    addCell(tr, String(u.maxLevel)).className = 'num';
    const first = upCostAt(u, ty.firstLevel + 1), last = upCostAt(u, u.maxLevel);
    const fmt = c => [c.coins ? `${upNum(upScale(c.coins))} 🪙` : '', c.gems ? `${c.gems} 💎` : ''].filter(Boolean).join(' + ') || '0';
    addCell(tr, `${fmt(first)} → ${fmt(last)}`);
    const tot = upTotals(u);
    addCell(tr, `${upNum(tot.coins)} 🪙${tot.gems ? ` + ${tot.gems} 💎` : ''}`).className = 'num';
    addCell(tr, `${upEffectAt(u, ty.firstLevel)} → ${upEffectAt(u, u.maxLevel)}`);
    addCell(tr, String(upHolderTotal(u.id))).className = 'num';
    addCell(tr, `${upCtlText(_up.controls[u.id])}${changed.has(u.id) ? ' · modifiée (brouillon)' : ''}`);
    admRowOpen(tr, `up:${u.id}`, u.names?.fr ?? u.id, opener => upOpen(u, opener));
  }
}

function upRenderVersions() {
  const body = document.getElementById('up-versions-body');
  body.textContent = '';
  const current = _up.published.version;
  for (const v of _up.versions) {
    const tr = body.insertRow();
    addCell(tr, `v${v.version}${v.version === current ? ' (en vigueur)' : ''}`);
    addCell(tr, { origin: 'origine', publish: 'publication', rollback: `retour à v${v.fromVersion}` }[v.source] ?? v.source);
    addCell(tr, v.note ?? '');
    addCell(tr, v.createdAt);
    if (v.version === current) addCell(tr, '');
    else addButtonCell(tr, 'Revenir à cette version…', () => upRollback(v.version));
  }
}

async function loadUpgradeAudit() {
  const { ok, data } = await api('GET', '/api/admin/upgrades/audit?limit=100');
  const body = document.getElementById('up-audit-body');
  body.textContent = '';
  if (!ok) return;
  const labels = { migrate: 'version d\'origine', draft_update: 'modification (brouillon)', draft_revert: 'modification annulée',
    draft_discard: 'brouillon abandonné', draft_clean: 'brouillon identique supprimé', publish: 'publication', rollback: 'retour arrière' };
  const rows = [
    ...data.audit.map(a => ({ at: a.created_at, action: labels[a.action] ?? a.action, what: a.version ? `v${a.version}` : (a.details?.id ?? ''),
      details: [a.details?.to ? `vers v${a.details.to}` : '', (a.details?.changes ?? []).map(c => (c.field ? UP_FIELDS[c.field] ?? c.field : `${c.id} (${(c.fields ?? []).map(f => UP_FIELDS[f.field] ?? f.field).join(', ')})`)).join(', ')].filter(Boolean).join(' — ') })),
    ...data.controls.map(c => {
      const ch = UP_CTL.filter(([k]) => c.before[k] !== c.after[k]).map(([k, l]) => `${l} ${c.after[k] ? 'suspendu' : 'réactivé'}`);
      return { at: c.created_at, action: '🚨 suspension', what: c.upgrade_id, details: `${ch.join(', ')} — motif : ${c.reason} (${c.holders ?? 0} joueur(s), via ${c.via ?? '?'})` };
    }),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  for (const r of rows) {
    const tr = body.insertRow();
    addCell(tr, r.at); addCell(tr, r.action); addCell(tr, r.what); addCell(tr, r.details);
  }
}

// ── Fiche ──

function upSetLang(l) {
  _upLang = l;
  for (const b of document.querySelectorAll('#up-langs .co-lang-btn')) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
  for (const f of document.querySelectorAll('#up-dialog .nw-lang-fields')) f.classList.toggle('hidden', f.dataset.lang !== l);
}
function upLangStates() {
  for (const b of document.querySelectorAll('#up-langs .co-lang-btn')) {
    const l = b.dataset.lang;
    const st = document.getElementById(`up-${l}-name`).value.trim() ? 'full' : 'none';
    b.className = `co-lang-btn co-lang--${st}`;
    b.textContent = `${st === 'full' ? '●' : '○'} ${l.toUpperCase()}`;
  }
}

function upRead() {
  const id = _upCur;
  const ty = upType(id);
  const names = {};
  for (const l of UP_LANGS) names[l] = document.getElementById(`up-${l}-name`).value.trim();
  const u = { id, icon: document.getElementById('up-icon').value.trim(), names, maxLevel: Number(document.getElementById('up-max').value) };
  if (ty.reroll) {
    u.reroll = { base: Number(document.getElementById('up-rr-base').value), every: Number(document.getElementById('up-rr-every').value) };
    return u;
  }
  u.costs = [...document.querySelectorAll('#up-levels-body [data-up="cost"]')].map(el => (el.value.trim() === '' ? null : Number(el.value)));
  if (ty.gems) u.gems = [...document.querySelectorAll('#up-levels-body [data-up="gem"]')].map(el => (el.value.trim() === '' ? null : Number(el.value)));
  if (ty.perLevel) u.perLevel = Number(document.getElementById('up-per').value);
  return u;
}

/** Lignes de niveaux : conserve les prix saisis quand le nombre de niveaux change. */
function upRenderLevels(costs, gems) {
  const id = _upCur, ty = upType(id);
  const body = document.getElementById('up-levels-body');
  const prev = ty.reroll ? {} : upRead();
  costs = costs ?? prev.costs ?? [];
  gems = gems ?? prev.gems ?? [];
  body.textContent = '';
  if (ty.reroll) { upRefresh(); return; }
  const max = Math.min(ty.levels[1], Math.max(ty.levels[0], Number(document.getElementById('up-max').value) || ty.levels[0]));
  const holders = upHolders(id);
  for (let lvl = ty.firstLevel + 1; lvl <= max; lvl++) {
    const i = lvl - ty.firstLevel - 1;
    const tr = body.insertRow();
    addCell(tr, String(lvl)).className = 'num';
    const c = aiEl('input', { type: 'number', min: '0', step: '1', 'data-up': 'cost', 'aria-label': `Prix du niveau ${lvl} en pièces` });
    c.value = costs[i] ?? '';
    addCell(tr, '').appendChild(c);
    if (ty.gems) {
      // Prix en gemmes éditables (#69) : lus par le jeu ET débités par le registre serveur (#49)
      const g = aiEl('input', { type: 'number', min: '0', max: String(_up.limits?.gemMax ?? 1000), step: '1', 'data-up': 'gem', 'aria-label': `Prix du niveau ${lvl} en gemmes` });
      g.value = gems[i] ?? 0;
      addCell(tr, '').appendChild(g);
    } else addCell(tr, '—').className = 'num';
    addCell(tr, '').className = 'num up-real';
    addCell(tr, '').className = 'num up-cum';
    addCell(tr, '').className = 'up-fx';
    addCell(tr, String(holders[lvl] ?? 0)).className = 'num';
  }
  upRefresh();
}

/** Prix réels, cumuls, effets, simulation avant/après et comparaison (mêmes règles que le jeu). */
function upRefresh() {
  const u = upRead();
  const ty = upType(u.id);
  const pub = upPublished(u.id);
  if (!ty.reroll) {
    let cum = 0;
    const rows = document.querySelectorAll('#up-levels-body tr');
    rows.forEach((tr, i) => {
      const lvl = ty.firstLevel + i + 1;
      const real = upScale(u.costs[i] ?? 0);
      cum += real;
      tr.querySelector('.up-real').textContent = upNum(real);
      tr.querySelector('.up-cum').textContent = upNum(cum);
      tr.querySelector('.up-fx').textContent = upEffectAt(u, lvl);
    });
  }
  // Simulation : coût total, temps pour les deux rythmes simulés, effet au maximum (#69-D : libellés + résumé)
  const weak = Math.max(1, Number(document.getElementById('up-sim-weak').value) || 1);
  const strong = Math.max(1, Number(document.getElementById('up-sim-strong').value) || 1);
  const sim = document.getElementById('up-sim-body');
  sim.textContent = '';
  const changes = document.getElementById('up-sim-changes');
  changes.textContent = '';
  const safe = x => { try { return upTotals(x); } catch (_) { return { coins: NaN, gems: 0 }; } };
  const upTo = ty.reroll ? 20 : null;
  const a = pub ? (upTo ? upTotals(pub, upTo) : upTotals(pub)) : null;
  const b = upTo ? safe({ ...u, maxLevel: upTo }) : safe(u);
  const pct = (av, bv) => {
    const r = (bv / av - 1) * 100;
    const d = Math.abs(r) < 1 ? Math.round(r * 100) / 100 : Math.round(r * 10) / 10;
    return `${r > 0 ? '+' : ''}${d.toLocaleString('fr-FR')} %`;
  };
  const labelCell = (tr, label, hint) => {
    const td = addCell(tr, label);
    if (hint) {
      td.append(' ');
      td.appendChild(aiEl('button', { type: 'button', class: 'bk-info', 'aria-expanded': 'false', 'aria-controls': hint, 'aria-label': `Aide : ${label}` }, 'ⓘ'));
    }
  };
  const line = (label, av, bv, fmt = upNum, hint = null) => {
    const tr = sim.insertRow();
    labelCell(tr, label, hint);
    addCell(tr, av == null ? '—' : fmt(av)).className = 'num';
    addCell(tr, Number.isFinite(bv) ? fmt(bv) : '—').className = 'num';
    const known = av != null && Number.isFinite(bv);
    const same = known && fmt(av) === fmt(bv);
    addCell(tr, !known ? '—' : same ? 'inchangé' : av ? pct(av, bv) : 'nouveau').className = 'num up-sim-gap';
    if (known && !same) changes.appendChild(aiEl('li', {}, `${label} : ${fmt(av)} → ${fmt(bv)}${av ? ` (${pct(av, bv)})` : ''}`));
  };
  const label = upTo ? 'Coût des 20 premiers rerolls, en pièces' : 'Coût total de tous les niveaux, en pièces';
  line(label, a?.coins, b.coins, upNum, 'up-h-total');
  if (ty.gems) line('Gemmes pour tous les niveaux', a?.gems, b.gems, upNum, 'up-h-gems');
  line(`Temps estimé, joueur qui gagne peu (${upNum(weak)} pièces/min)`, a ? a.coins / weak : null, b.coins / weak, upDuration, 'up-h-time');
  line(`Temps estimé, joueur qui gagne beaucoup (${upNum(strong)} pièces/min)`, a ? a.coins / strong : null, b.coins / strong, upDuration, 'up-h-time');
  if (!ty.reroll) {
    const tr = sim.insertRow();
    labelCell(tr, 'Effet au niveau maximum');
    const av = pub ? upEffectAt(pub, pub.maxLevel) : null, bv = upEffectAt(u, u.maxLevel);
    addCell(tr, av ?? '—').className = 'num';
    addCell(tr, bv).className = 'num';
    addCell(tr, av == null ? '—' : av === bv ? 'inchangé' : 'modifié').className = 'num up-sim-gap';
    if (av != null && av !== bv) changes.appendChild(aiEl('li', {}, `Effet au niveau maximum : ${av} → ${bv}`));
  }
  // Comparaison avec la version en vigueur
  const ul = document.getElementById('up-compare-list');
  ul.textContent = '';
  if (pub) {
    for (const f of Object.keys(UP_FIELDS)) {
      if (JSON.stringify(pub[f] ?? null) === JSON.stringify(u[f] ?? null)) continue;
      ul.appendChild(aiEl('li', {}, `${UP_FIELDS[f]} : ${upFieldText(f, pub[f])} → ${upFieldText(f, u[f])}`));
    }
  }
  document.getElementById('up-compare').classList.toggle('hidden', !ul.children.length);
  // Résumé « ce qui change » (#69-D) : chiffres d'abord ; s'il n'y en a pas, dire clairement qu'il n'y a rien
  if (!pub) changes.appendChild(aiEl('li', {}, 'Pas encore de version en jeu pour cette amélioration : rien à comparer.'));
  else if (!changes.children.length) {
    changes.appendChild(aiEl('li', {}, ul.children.length
      ? `Aucun changement de coût, de temps ni d'effet. Autres champs modifiés : ${ul.children.length} (voir le détail).`
      : 'Aucun changement proposé : la fiche correspond aux paramètres utilisés en jeu.'));
  }
  const noChange = !!pub && !ul.children.length;
  document.getElementById('up-sim-summary').classList.toggle('up-sim-same', noChange);
  for (const el of document.querySelectorAll('#up-dialog .up-sim-gap')) el.classList.toggle('hidden', noChange);
  const art = document.getElementById('up-art');
  art.textContent = '';
  art.appendChild(upArtNode({ ...u, icon: u.icon || '⬆' }, 56));
  upLangStates();
}

function upOpen(upgrade, opener) {
  const u = upgrade;
  const ty = upType(u.id);
  _upCur = u.id;
  document.getElementById('up-form-title').textContent = `${u.icon} ${u.names?.fr ?? u.id}`;
  for (const l of UP_LANGS) document.getElementById(`up-${l}-name`).value = u.names?.[l] ?? '';
  document.getElementById('up-id').value = u.id;
  document.getElementById('up-kind').value = ty.kind === 'instant' ? 'Achat à effet immédiat (compteur remis à zéro chaque saison)' : 'Effet permanent pendant la saison (niveau remis à zéro chaque saison)';
  document.getElementById('up-icon').value = u.icon ?? '';
  document.getElementById('up-studio-key').textContent = `ui:upgrade_${u.id}`;
  document.getElementById('up-formula').textContent = `Calcul : ${ty.formula}`;
  const locked = document.getElementById('up-locked');
  locked.textContent = [ty.locked ? `🔒 ${ty.locked}` : '', ty.gemNote ? `💎 ${ty.gemNote}` : ''].filter(Boolean).join('\n');
  locked.style.whiteSpace = 'pre-line';
  locked.classList.toggle('hidden', !ty.locked && !ty.gemNote);
  const max = document.getElementById('up-max');
  max.min = String(Math.max(ty.levels[0], _up.publishedMaxLevels?.[u.id] ?? 0));
  max.max = String(ty.levels[1]);
  max.value = u.maxLevel;
  max.readOnly = ty.levels[0] === ty.levels[1];
  document.getElementById('up-per-wrap').classList.toggle('hidden', !ty.perLevel);
  if (ty.perLevel) {
    document.getElementById('up-per-label').textContent = `Effet par niveau (${ty.unit}, ${ty.perLevel.min} à ${ty.perLevel.max})`;
    const per = document.getElementById('up-per');
    per.min = String(ty.perLevel.min); per.max = String(ty.perLevel.max);
    per.value = u.perLevel;
  }
  for (const w of ['up-rr-base-wrap', 'up-rr-every-wrap']) document.getElementById(w).classList.toggle('hidden', !ty.reroll);
  if (ty.reroll) {
    document.getElementById('up-rr-base').value = u.reroll.base;
    document.getElementById('up-rr-every').value = u.reroll.every;
  }
  upRenderLevels(u.costs ?? [], u.gems ?? []);
  const changed = (_up.draft?.changes ?? []).some(c => c.id === u.id);
  const state = document.getElementById('up-state');
  state.textContent = changed ? 'Cette amélioration a des modifications dans le brouillon (pas encore en jeu) : la comparaison montre l\'écart avec la version en vigueur.'
    : `Valeurs en vigueur (version ${_up.published.version}), identiques à celles du jeu.`;
  state.classList.remove('hidden');
  const c = _up.controls[u.id] ?? {};
  const cs = document.getElementById('up-ctl-state');
  cs.textContent = `🚨 État : ${upCtlText(c)}${c.reason && (c.purchases || c.effects || c.hidden) ? ` — motif : ${c.reason}` : ''}. Si ses effets sont suspendus : ${ty.suspend ?? 'sans objet (effet immédiat à l\'achat)'}`;
  cs.classList.remove('hidden');
  document.getElementById('up-issues').classList.add('hidden');
  document.getElementById('btn-up-revert').classList.toggle('hidden', !changed);
  upSetLang('fr');
  _upSnap = JSON.stringify(upRead());
  admDialogOpen('up-dialog', opener, null);
}

// Aides ⓘ de la fiche Amélioration (#69-D) : une seule aide ouverte à la fois
document.getElementById('up-dialog').addEventListener('click', e => {
  const b = e.target.closest('.bk-info');
  if (!b) return;
  e.preventDefault();
  const h = document.getElementById(b.getAttribute('aria-controls'));
  if (!h) return;
  const show = h.hidden;
  for (const o of document.querySelectorAll('#up-dialog .bk-hint')) o.hidden = true;
  for (const o of document.querySelectorAll('#up-dialog .bk-info')) o.setAttribute('aria-expanded', 'false');
  h.hidden = !show;
  b.setAttribute('aria-expanded', String(show));
});
admDialogSetup('up-dialog', { dirty: () => JSON.stringify(upRead()) !== _upSnap, keep: 'Enregistrer dans le brouillon' });

function upIssues(data, id = 'up-issues') {
  const ul = document.getElementById(id);
  ul.textContent = '';
  for (const e of [data.error, ...(data.details ?? [])].filter(Boolean)) ul.appendChild(aiEl('li', {}, e));
  ul.classList.toggle('hidden', !ul.children.length);
  ul.scrollIntoView?.({ block: 'nearest' });
}

document.getElementById('btn-up-add').addEventListener('click', () => admAlert(
  'Chaque amélioration correspond à du code dans le moteur du jeu (dégâts, Chance, Sac, Auto-Dig, fragments, reroll). Une fiche sans code associé n\'aurait aucun effet réel : un nouveau type d\'amélioration se demande par un ticket (spécification de l\'effet, impact anti-bot #25 et économie #49), puis apparaît ici avec son barème.\n\nEn attendant, vous pouvez modifier prix, niveaux, effets et noms des six améliorations existantes (brouillon → publication), ou les suspendre en urgence.',
  'Ajouter une amélioration'));
document.getElementById('up-langs').addEventListener('click', e => { const b = e.target.closest('.co-lang-btn'); if (b) upSetLang(b.dataset.lang); });
document.getElementById('up-max').addEventListener('input', () => upRenderLevels());
document.getElementById('up-dialog').addEventListener('input', e => { if (e.target.id !== 'up-max') upRefresh(); });
document.getElementById('up-filter-text').addEventListener('input', upRenderList);
document.getElementById('up-filter-status').addEventListener('change', upRenderList);
document.getElementById('up-filter-kind').addEventListener('change', upRenderList);

document.getElementById('btn-up-save').addEventListener('click', async () => {
  const upgrade = upRead();
  const { ok, data } = await api('PUT', `/api/admin/upgrades/draft/upgrades/${encodeURIComponent(upgrade.id)}`, { upgrade });
  if (!ok) return upIssues(data);
  _upSnap = JSON.stringify(upRead());
  document.getElementById('up-dialog').close();
  ptMessage('up-msg', data.draftDropped
    ? `« ${upgrade.id} » : identique à la version en vigueur, aucun brouillon en attente.`
    : `« ${upgrade.id} » enregistrée dans le brouillon. Rien ne change pour les joueurs avant « Publier… ».`, true);
  loadUpgrades();
});

document.getElementById('btn-up-revert').addEventListener('click', async () => {
  const id = _upCur;
  if (!id || !await admAsk(`Annuler les modifications de « ${id} » ?\nElle reprend dans le brouillon ses valeurs en vigueur ; les autres améliorations du brouillon ne bougent pas.`)) return;
  const { ok, data } = await api('POST', `/api/admin/upgrades/draft/upgrades/${encodeURIComponent(id)}/revert`);
  if (!ok) return upIssues(data);
  document.getElementById('up-dialog').close();
  ptMessage('up-msg', `« ${id} » : modifications annulées${data.draftDropped ? ' ; plus aucun brouillon en attente.' : '.'}`, true);
  loadUpgrades();
});

document.getElementById('btn-up-discard').addEventListener('click', async () => {
  if (!await admConfirm({ title: 'Abandonner le brouillon des améliorations ?', text: 'Toutes les modifications non publiées sont perdues.',
    impact: ['Rien ne change pour les joueurs : la version en vigueur reste appliquée.', 'L\'action est tracée dans le journal.'], ok: 'Abandonner le brouillon', danger: true })) return;
  const { ok, data } = await api('DELETE', '/api/admin/upgrades/draft');
  ptMessage('up-msg', ok ? 'Brouillon abandonné : aucun changement pour les joueurs.' : (data.error || 'Erreur.'), ok);
  loadUpgrades();
});

document.getElementById('btn-up-publish').addEventListener('click', async () => {
  const d = _up?.draft;
  if (!d) return;
  const note = await admPrompt({ title: `Publier le barème (version ${_up.published.version + 1}) ?`,
    text: `Améliorations concernées : ${d.changes.map(c => c.id).join(', ')}. Les nouveaux prix, niveaux et effets s'appliquent à TOUS les joueurs en moins d'une minute ; les niveaux possédés, pièces et gemmes ne sont jamais modifiés. Retour arrière possible : « Versions publiées → Revenir à cette version ».`,
    label: 'Note de publication — obligatoire (raison, accord du propriétaire)', ok: 'Publier' });
  if (note === null) return;
  const { ok, data } = await api('POST', '/api/admin/upgrades/publish', { note, basedOn: d.basedOn });
  if (!ok) { ptMessage('up-msg', [data.error, ...(data.details ?? [])].filter(Boolean).join(' '), false); return; }
  ptMessage('up-msg', `Version ${data.version} publiée (${data.changes.length} amélioration(s) modifiée(s)).`, true);
  loadUpgrades();
});

async function upRollback(version) {
  if (!await admConfirm({ title: `Revenir à la version ${version} ?`, text: 'Une NOUVELLE version reprenant ce contenu est publiée immédiatement.',
    impact: ['Les joueurs reçoivent ces prix et effets en moins d\'une minute ; niveaux possédés, pièces et gemmes inchangés.',
      'Le nombre de niveaux ne baisse jamais.', 'Le brouillon éventuel est abandonné.'],
    ok: `Revenir à la version ${version}`, danger: true })) return;
  const { ok, data } = await api('POST', '/api/admin/upgrades/rollback', { version });
  ptMessage('up-msg', ok ? `Version ${data.version} publiée (retour au contenu de la version ${data.restored}).` : [data.error, ...(data.details ?? [])].filter(Boolean).join(' '), ok);
  loadUpgrades();
}

document.getElementById('btn-up-studio').addEventListener('click', async () => {
  const id = _upCur;
  const dlg = document.getElementById('up-dialog');
  if (dlg._admDirty() && !await admConfirmDiscard({ keep: 'Enregistrer dans le brouillon', effect: 'ferme la fiche, perd ces saisies et ouvre l\'atelier d\'icônes.' })) return;
  _upSnap = JSON.stringify(upRead());
  dlg.close();
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  _icFrom = { kind: 'upgrade', id };
  icOpen(`ui:upgrade_${id}`);
});

/** Retour de l'atelier d'icônes vers la fiche de l'amélioration (vue rechargée : pictogramme appliqué). */
async function upBackTo(id) {
  _up = null;
  document.querySelector('.tab-btn[data-tab="upgrades"]').click();
  for (let k = 0; k < 50 && !_up; k++) await new Promise(r => setTimeout(r, 100));
  const u = upWorking().find(x => x.id === id);
  if (u) upOpen(u, document.querySelector(`[data-adm-key="${CSS.escape(`up:${id}`)}"]`));
}

// ── Suspension d'urgence ──

function upCtlRead() {
  return Object.fromEntries(UP_CTL.map(([k]) => [k, document.getElementById(`up-ctl-${k}`).checked]));
}

let _upCtlSeq = 0;
/** Aperçu serveur des conséquences (rien n'est appliqué) ; affiche la confirmation par identifiant si nécessaire. */
async function upCtlPreview() {
  const id = _upCtlId;
  const seq = ++_upCtlSeq;
  const { ok, data } = await api('POST', `/api/admin/upgrades/${encodeURIComponent(id)}/controls/preview`, { controls: upCtlRead() });
  if (seq !== _upCtlSeq) return;   // réponse périmée (cases recochées entre-temps)
  const ul = document.getElementById('up-ctl-preview');
  ul.textContent = '';
  if (!ok) { ul.appendChild(aiEl('li', {}, data.error || 'Aperçu indisponible.')); return; }
  if (data.after.hidden) document.getElementById('up-ctl-purchases').checked = true;
  for (const line of data.consequences.length ? data.consequences : ['Aucun changement : cet état est déjà en vigueur.']) ul.appendChild(aiEl('li', {}, line));
  document.getElementById('up-ctl-confirm-wrap').classList.toggle('hidden', !data.requiresConfirm);
  document.getElementById('btn-up-ctl-apply').disabled = !data.changed.length;
  const any = data.after.purchases || data.after.effects || data.after.hidden;
  document.getElementById('btn-up-ctl-apply').textContent = any ? 'Appliquer maintenant' : 'Réactiver maintenant';
}

function upCtlOpen(id) {
  _upCtlId = id;
  const u = upPublished(id), ty = upType(id);
  const c = _up.controls[id] ?? {};
  document.getElementById('up-ctl-title').textContent = `🚨 ${u?.icon ?? ''} ${u?.names?.fr ?? id} — suspension d'urgence`;
  for (const [k] of UP_CTL) document.getElementById(`up-ctl-${k}`).checked = !!c[k];
  const fx = document.getElementById('up-ctl-effects');
  fx.disabled = !ty.suspend;
  document.getElementById('up-ctl-effects-help').textContent = ty.suspend ?? 'sans objet : l\'effet est immédiat à l\'achat (suspendez les nouveaux achats).';
  document.getElementById('up-ctl-reason').value = '';
  document.getElementById('up-ctl-confirm').value = '';
  document.getElementById('up-ctl-confirm-label').textContent = `Recopiez « ${id} » pour confirmer`;
  document.getElementById('up-ctl-issues').classList.add('hidden');
  const sheet = document.getElementById('up-dialog');
  if (sheet.open) sheet.close();   // fiche refermée (saisies déjà protégées) : la suspension est une action séparée
  admDialogOpen('up-ctl-dialog', document.activeElement, 'up-ctl-purchases');
  upCtlPreview();
}

admDialogSetup('up-ctl-dialog', { dirty: () => !!document.getElementById('up-ctl-reason').value.trim(), keep: 'Appliquer maintenant' });

document.getElementById('up-ctl-dialog').addEventListener('change', e => { if (e.target.type === 'checkbox') upCtlPreview(); });
document.getElementById('btn-up-ctl-open').addEventListener('click', async () => {
  const dlg = document.getElementById('up-dialog');
  if (dlg._admDirty() && !await admConfirmDiscard({ keep: 'Enregistrer dans le brouillon', effect: 'ferme la fiche, perd ces saisies et ouvre la suspension d\'urgence.' })) return;
  _upSnap = JSON.stringify(upRead());
  upCtlOpen(_upCur);
});

document.getElementById('btn-up-ctl-apply').addEventListener('click', async () => {
  const id = _upCtlId;
  const controls = upCtlRead();
  const reason = document.getElementById('up-ctl-reason').value.trim();
  if (reason.length < 5) return upIssues({ error: 'Motif obligatoire (au moins 5 caractères) : il figure au journal.' }, 'up-ctl-issues');
  const { ok, data } = await api('POST', `/api/admin/upgrades/${encodeURIComponent(id)}/controls`,
    { controls, reason, confirm: document.getElementById('up-ctl-confirm').value.trim() });
  if (!ok) return upIssues(data, 'up-ctl-issues');
  document.getElementById('up-ctl-reason').value = '';
  document.getElementById('up-ctl-dialog').close();
  const any = data.after.purchases || data.after.effects || data.after.hidden;
  ptMessage('up-msg', `« ${id} » : ${any ? upCtlText(data.after).toLowerCase() : 'réactivée'}. Appliqué par le jeu en moins d'une minute ; niveaux des joueurs inchangés.`, true);
  loadUpgrades();
});

admRefreshButton('btn-refresh-upgrades', loadUpgrades, 'Améliorations');

// ── 🎯 Missions quotidiennes (#68, étape A) ─────────────────────────────────────
// Catalogue versionné côté serveur (server/missionCatalog.js). La version 1 = les six missions du jeu à l'identique.
// Le jeu n'utilise PAS encore ce catalogue : on prépare, illustre et simule ; « Publier… » ne change rien en jeu
// tant que l'activation n'est pas livrée (décision du propriétaire). Aucun appel IA ici : l'image passe par 🎨 Icônes.
let _mq = null;          // vue admin (published, draft, versions, types, proposal, profiles…)
let _mqCur = null;       // { id, isNew } de la fiche ouverte
let _mqSnap = '';        // instantané de la fiche à l'ouverture (#61)
let _mqRotSnap = '';
let _mqPrevTimer = null;
let _mqPrevSeq = 0;
const MQ_LANGS = [...DigLanguages.ACTIVE]; // registre des langues (#59)
const MQ_FIELDS = { names: 'Noms', descs: 'Textes', icon: 'Icône', image: 'Image', active: 'Active', type: 'Type', category: 'Catégorie',
  weight: 'Poids', minAccountDays: 'Ancienneté min.', maxAccountDays: 'Ancienneté max.', bands: 'Objectifs par profondeur', reward: 'Récompense' };
const MQ_ROT_LABELS = { mode: 'Mode', perDay: 'Missions par jour', maxPerCategory: 'Au plus par catégorie', repeatDays: 'Anti-répétition (jours)',
  repeatFactor: 'Anti-répétition (poids)', perPlayer: 'Propre à chaque joueur', dayBlocks: 'Journée de référence (blocs)', timezone: 'Changement de jour' };

const mqWorking = () => _mq?.draft?.missions ?? _mq?.published?.missions ?? [];
const mqRotation = () => _mq?.draft?.rotation ?? _mq?.published?.rotation ?? null;
const mqPublished = id => _mq?.published?.missions.find(m => m.id === id) ?? null;
const mqType = type => _mq?.types?.[type] ?? null;
const mqFill = (desc, n) => String(desc ?? '').replace(/\{t\}/g, String(n)).replace(/\{s\}/g, n > 1 ? 's' : '');
const mqBandsText = bands => (bands ?? []).map(b => `dès ${b.fromDepth} m : ${b.targets.join(', ')}`).join(' · ');
function mqRewardText(r) {
  if (!r) return '—';
  const parts = [`${r.coinsPerUnit} 💰 par unité`];
  if (r.gems) parts.push(`+${r.gems} 💎${r.gemsFromTarget > 1 ? ` dès ${r.gemsFromTarget}` : ''}`);
  return parts.join(' ');
}
function mqRotValue(k, v) {
  if (v == null) return '—';
  if (k === 'mode') return v === 'adaptive' ? 'adaptative' : 'origine (jeu actuel)';
  if (k === 'perPlayer') return v ? 'oui' : 'non (même rotation pour tous)';
  if (k === 'timezone') return v === 'browser' ? 'minuit du navigateur' : 'minuit Europe/Bruxelles';
  if (k === 'dayBlocks') return v ? `${v} blocs` : 'aucun plafond';
  return String(v);
}
function mqFieldText(field, v) {
  if (v == null) return '—';
  if (field === 'names' || field === 'descs') return MQ_LANGS.map(l => `${l.toUpperCase()} : ${v[l] || '—'}`).join(' · ');
  if (field === 'bands') return mqBandsText(v);
  if (field === 'reward') return mqRewardText(v);
  if (field === 'type') return mqType(v)?.label ?? v;
  if (field === 'category') return _mq?.categories?.[v] ?? v;
  if (field === 'active') return v ? 'oui' : 'non (archivée)';
  if (field in MQ_ROT_LABELS) return mqRotValue(field, v);
  return String(v);
}

async function loadMissions() {
  const { ok, data } = await api('GET', '/api/admin/missions');
  if (!ok) { ptMessage('mq-msg', data.error || 'Erreur lors du chargement.', false); return; }
  _mq = data;
  document.getElementById('mq-live').classList.toggle('hidden', !!data.live);
  const types = document.getElementById('mq-types');
  types.textContent = '';
  for (const [k, t] of Object.entries(data.types)) {
    types.appendChild(aiEl('li', {}, `${t.label} (${k}) — événement : ${t.event} Validation : ${t.validation}${t.limits ? ` Limite : ${t.limits}` : ''}`));
  }
  const un = document.getElementById('mq-unavailable');
  un.textContent = '';
  for (const u of data.unavailable) un.appendChild(aiEl('li', {}, `${u.label} — ${u.reason}`));
  if (!document.getElementById('mq-type').options.length) {
    coSelect('mq-type', Object.entries(data.types).map(([k, t]) => [k, t.label]));
    coSelect('mq-category', Object.entries(data.categories));
    coSelect('mq-filter-type', Object.entries(data.types).map(([k, t]) => [k, t.label]), 1);
    const box = document.getElementById('mq-sim-profiles');
    for (const p of data.profiles) {
      const lab = aiEl('label', { class: 'adm-check' });
      const cb = aiEl('input', { type: 'checkbox', value: p.id });
      cb.checked = p.id === 'debutant' || p.id === 'avance';
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(` ${p.label} — ${p.depth} m, ${p.blocksPerDay} blocs/jour`));
      box.appendChild(lab);
    }
    const start = document.getElementById('mq-sim-start');
    if (!start.value) start.value = new Date().toISOString().slice(0, 10);
  }
  const pub = data.published;
  document.getElementById('mq-version').textContent = `— version ${pub.version} en vigueur`;
  const active = pub.missions.filter(m => m.active).length;
  document.getElementById('mq-summary').textContent =
    `Version ${pub.version} en vigueur : ${pub.missions.length} mission(s), dont ${active} active(s). Rotation : ${mqRotValue('mode', pub.rotation.mode)}, ${pub.rotation.perDay} par jour.`;
  mqRenderDraft();
  mqRenderList();
  mqRenderRotation();
  mqRenderBonus();
  mqRenderVersions();
  loadMissionAudit();
  loadMissionActivation();
}

// ── Activation en jeu (#68, étape B) : drapeau off / pilot / on ───────────────
const MQ_ACT_LABELS = { off: 'désactivé — jeu inchangé', pilot: 'pilote — comptes listés seulement', on: 'actif pour tous les joueurs' };

const MQ_SRC_REASON = {
  on: 'actif pour tous les joueurs',
  pilot: 'compte listé dans le pilote',
  off: 'activation désactivée : tout le monde garde les missions du navigateur',
  not_pilot: 'joueur non autorisé au pilote (compte absent de la liste)',
};
let _mqPilots = null;    // sélecteur des comptes pilotes (pastilles)
let _mqInspect = null;   // { id, username } du joueur choisi pour l'inspection

function mqRenderActivation(data) {
  const st = data.settings;
  document.getElementById('mq-act-state').textContent = `— ${MQ_ACT_LABELS[st.mode] ?? st.mode}${st.mode === 'pilot' ? ` (${st.pilots.length} compte(s))` : ''}`;
  document.getElementById('mq-act-mode').value = st.mode;
  if (!_mqPilots) {
    _mqPilots = evTesterPicker(document.getElementById('mq-act-pilots'), {
      emptyText: 'Aucun compte pilote : en mode Pilote, personne ne recevrait les missions du serveur.',
      suggestions: () => [], label: 'Ajouter un compte pilote',
    });
  }
  _mqPilots.set(st.pilotAccounts ?? st.pilots);
  const ul = document.getElementById('mq-act-audit');
  ul.textContent = '';
  for (const e of data.audit) {
    const d = e.details ?? {};
    ul.appendChild(aiEl('li', {}, `${admBrussels(e.createdAt)} — ${d.from ?? '?'} → ${d.to ?? '?'}${d.pilots ? ` · pilotes : ${d.pilots.join(', ') || 'aucun'}` : ''}${d.note ? ` · « ${d.note} »` : ''}`));
  }
  if (!data.audit.length) ul.appendChild(aiEl('li', { class: 'muted' }, 'Aucun changement : désactivé depuis l\'origine.'));
  const notice = document.getElementById('mq-live');
  if (st.mode === 'pilot') {
    notice.classList.remove('hidden');
    notice.textContent = `Mode pilote : seuls ${st.pilots.join(', ') || 'aucun compte'} reçoivent les missions du serveur (version publiée). Tous les autres joueurs gardent les six missions actuelles.`;
  }
}

async function loadMissionActivation() {
  const { ok, data } = await api('GET', '/api/admin/missions/live');
  if (!ok) { ptMessage('mq-act-msg', data.error || 'Erreur lors du chargement de l\'activation.', false); return; }
  mqRenderActivation(data);
}

document.getElementById('btn-mq-act-save').addEventListener('click', async () => {
  const mode = document.getElementById('mq-act-mode').value;
  const pilots = _mqPilots?.get() ?? [];
  const names = _mqPilots?.names() ?? [];
  const impact = mode === 'on'
    ? ['Tous les joueurs connectés recevront les missions de la version publiée, attribuées et réclamées par le serveur.',
      'Réservé à la décision du propriétaire sur le barème (#68, #49). Réversible : repasser en « Désactivé ».']
    : mode === 'pilot'
      ? [`Seuls ces comptes reçoivent les missions du serveur : ${names.join(', ') || 'aucun'}.`, 'Les autres joueurs ne voient aucun changement. Réversible.']
      : ['Tous les joueurs reviennent aux missions calculées par leur navigateur. Les réclamations déjà faites restent acquises.'];
  let note = '';
  if (mode === 'on') {
    const v = await admPrompt({ title: 'Activer pour tous les joueurs ?', text: impact.join(' '), label: 'Note (décision, obligatoire)', ok: 'Activer pour tous' });
    if (v == null) return;
    note = v;
  } else if (!await admConfirm({ title: `Enregistrer : ${MQ_ACT_LABELS[mode]} ?`, impact, ok: 'Enregistrer' })) return;
  const { ok, data } = await api('PUT', '/api/admin/missions/live', { mode, pilots, note });
  if (!ok) { ptMessage('mq-act-msg', data.error || 'Erreur.', false); return; }
  mqRenderActivation(data);
  ptMessage('mq-act-msg', `Enregistré : ${MQ_ACT_LABELS[data.settings.mode]}.`, true);
});

attachPlayerAutocomplete(document.getElementById('mq-act-user'), document.getElementById('mq-act-user-list'), {
  onSelect: u => { _mqInspect = { id: u.id, username: u.username }; mqInspectPlayer(); },
  onEnter: () => mqInspectPlayer(),
});
document.getElementById('mq-act-user').addEventListener('input', e => {
  if (_mqInspect && e.target.value.trim().toLowerCase() !== _mqInspect.username.toLowerCase()) _mqInspect = null;
});

/** Inspection en lecture seule (#68-E) : source des missions, attribution du jour, progression, réclamations. */
async function mqInspectPlayer() {
  const out = document.getElementById('mq-act-out');
  const name = document.getElementById('mq-act-user').value.trim();
  out.textContent = '';
  if (!_mqInspect && !name) { out.appendChild(aiEl('p', { class: 'muted' }, 'Tapez au moins 2 lettres du pseudo puis choisissez le joueur dans la liste.')); return; }
  const qs = _mqInspect ? `userId=${encodeURIComponent(_mqInspect.id)}` : `username=${encodeURIComponent(name)}`;
  const { ok, status, data } = await api('GET', `/api/admin/missions/live/player?${qs}`);
  if (!ok) {
    out.appendChild(aiEl('p', { class: 'error' }, status === 404
      ? `Compte inexistant : aucun joueur ne s'appelle exactement « ${name} ». Tapez 2 lettres et choisissez-le dans la liste.`
      : `Erreur de l'API (${status || 'réseau'}) : ${data?.error || 'réessayez.'}`));
    return;
  }
  const server = data.source === 'server';
  // En-tête lisible (#68-F) : joueur, source des missions, journée de Bruxelles, version et profondeur
  const label = !server ? 'Missions du navigateur · standard' : data.reason === 'on' ? 'Missions serveur · Tous les joueurs' : 'Missions serveur · Pilote';
  const head = aiEl('div', { class: `mq-src ${server ? 'mq-src--server' : 'mq-src--browser'}` });
  const title = aiEl('div', { class: 'mq-insp-title' });
  title.append(aiEl('strong', { class: 'mq-insp-name' }, data.username), aiEl('span', { class: `mq-insp-badge${server ? ' mq-insp-badge--server' : ''}` }, label));
  head.appendChild(title);
  const t = data.today;
  head.appendChild(aiEl('div', { class: 'mq-insp-sub' }, [`Journée du ${data.day} (Bruxelles)`, t && `catalogue v${t.catalogVersion}`, t && `${t.profile.depth} m à l'attribution`].filter(Boolean).join(' · ')));
  head.appendChild(aiEl('div', { class: 'muted' }, `Source des missions : ${!server ? 'Navigateur (standard)' : data.reason === 'on' ? 'Serveur (tous les joueurs)' : 'Serveur (Pilote)'} — ${MQ_SRC_REASON[data.reason] ?? data.reason}`));
  out.appendChild(head);
  if (!t) {
    out.appendChild(aiEl('p', { class: 'muted' }, server
      ? 'Aucune attribution encore aujourd\'hui : le serveur attribuera les missions à la prochaine ouverture de l\'écran Missions par ce joueur.'
      : 'Aucune attribution serveur aujourd\'hui : ses missions sont calculées par son navigateur (non visibles ici).'));
  } else {
    if (!server) out.appendChild(aiEl('p', { class: 'muted' }, 'Attribution conservée d\'une période où le compte recevait les missions du serveur ; son jeu affiche actuellement celles du navigateur.'));
    const grid = aiEl('div', { class: 'mq-insp-cards' });
    for (const m of t.missions) grid.appendChild(mqInspectCard(m));
    out.appendChild(grid);
  }
  // Métadonnées techniques repliées : identifiants, heures, compte, historique brut
  const det = aiEl('details', { class: 'mq-insp-details' });
  det.appendChild(aiEl('summary', {}, 'Détails'));
  const dl = aiEl('ul');
  dl.appendChild(aiEl('li', {}, `Joueur : ${data.username} · ID ${data.id}`));
  if (t) {
    dl.appendChild(aiEl('li', {}, `Attribuées le ${t.assignedAt ? admBrussels(t.assignedAt) : '—'}${t.updatedAt ? ` · progression lue le ${admBrussels(t.updatedAt)}` : ''}`));
    dl.appendChild(aiEl('li', {}, `Profil à l'attribution : ${t.profile.depth} m, compte de ${t.profile.accountDays} jour(s)`));
    dl.appendChild(aiEl('li', {}, `Missions (identifiant:objectif) : ${t.missions.map(m => `${m.id}:${m.target}`).join(', ')}`));
  }
  for (const h of data.history) {
    dl.appendChild(aiEl('li', {}, `${h.day} (v${h.catalogVersion}) : ${(h.items ?? []).map(x => `${x.name ?? x.id} ${x.target}`).join(' · ') || h.missions.join(', ')} — ${h.missions.join(', ')}`));
  }
  if (!data.history.length) dl.appendChild(aiEl('li', { class: 'muted' }, 'Aucune attribution serveur sur les 7 derniers jours.'));
  det.appendChild(dl);
  out.appendChild(det);
}

const MQ_INSP_STATE = { claimed: 'Réclamée', done: 'Terminée — à réclamer', progress: 'En cours' };

/** Carte compacte d'une mission inspectée : nom et objectif tels que dans le jeu, progression, récompense, statut (#68-F). */
function mqInspectCard(m) {
  const r = m.claimReward ?? m.reward;
  const st = m.claimed ? 'claimed' : m.progress >= m.target ? 'done' : 'progress';
  const card = aiEl('div', { class: `mq-insp-card mq-insp-card--${st}` });
  const top = aiEl('div', { class: 'mq-insp-card-top' });
  const ico = aiEl('span', { class: 'mq-insp-ico', 'aria-hidden': 'true' });
  if (m.image) ico.appendChild(aiEl('img', { src: m.image, alt: '' })); else ico.textContent = m.icon ?? '🎯';
  const txt = aiEl('div', { class: 'mq-insp-card-txt' });
  txt.append(aiEl('strong', {}, m.name ?? m.id), aiEl('div', { class: 'muted' }, m.text ?? `Objectif : ${m.target}`));
  top.append(ico, txt);
  card.appendChild(top);
  const pct = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 100;
  const bar = aiEl('div', { class: 'mq-insp-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(m.target), 'aria-valuenow': String(Math.min(m.progress, m.target)), 'aria-label': `Progression ${m.progress}/${m.target}` });
  const fill = aiEl('span');
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  card.appendChild(bar);
  const foot = aiEl('div', { class: 'mq-insp-card-foot' });
  foot.append(aiEl('span', {}, `${m.progress}/${m.target}`), aiEl('span', { class: 'mq-insp-reward' }, `💰 ${r.coins}${r.gems ? ` + 💎 ${r.gems}` : ''}`));
  card.appendChild(foot);
  card.appendChild(aiEl('div', { class: `mq-insp-state mq-insp-state--${st}` }, `${st === 'claimed' ? '✓ ' : ''}${MQ_INSP_STATE[st]}${m.claimed && m.claimedAt ? ` le ${admBrussels(m.claimedAt)}` : ''}`));
  if (m.claimDetails?.overValidated) card.appendChild(aiEl('div', { class: 'mq-insp-warn' }, '⚠ Gain déclaré supérieur aux blocs validés (observation)'));
  card.appendChild(aiEl('div', { class: 'mq-insp-id' }, `ID ${m.id}`));
  return card;
}

document.getElementById('btn-mq-act-inspect').addEventListener('click', () => mqInspectPlayer());

function mqRenderDraft() {
  const box = document.getElementById('mq-draft');
  const d = _mq?.draft;
  box.classList.toggle('hidden', !d);
  if (!d) return;
  document.getElementById('mq-draft-meta').textContent = `— basé sur la version ${d.basedOn}, modifié le ${admBrussels(d.updatedAt)}`;
  const errs = document.getElementById('mq-draft-errors'), warns = document.getElementById('mq-draft-warnings');
  errs.textContent = ''; warns.textContent = '';
  for (const e of d.errors) errs.appendChild(aiEl('li', {}, e));
  for (const w of d.warnings) warns.appendChild(aiEl('li', {}, w));
  errs.classList.toggle('hidden', !d.errors.length);
  warns.classList.toggle('hidden', !d.warnings.length);
  const body = document.getElementById('mq-draft-body');
  body.textContent = '';
  for (const c of d.changes) {
    const m = d.missions.find(x => x.id === c.id) ?? {};
    const name = c.kind === 'rotation' ? '🔁 Rotation' : c.kind === 'setBonus' ? '🎁 Bonus trois missions' : `${m.icon ?? ''} ${m.names?.fr ?? c.id}`;
    if (c.kind === 'added') {
      const tr = body.insertRow();
      addCell(tr, name); addCell(tr, 'nouvelle mission'); addCell(tr, '—'); addCell(tr, `${mqType(m.type)?.label ?? m.type} · ${mqBandsText(m.bands)}`);
      continue;
    }
    for (const f of c.fields) {
      const tr = body.insertRow();
      if (c.kind === 'setBonus') {
        addCell(tr, name); addCell(tr, f.field === 'enabled' ? 'Activé' : 'Paliers');
        addCell(tr, mqBonusText(f.field, f.before)); addCell(tr, mqBonusText(f.field, f.after));
        continue;
      }
      addCell(tr, name); addCell(tr, (c.kind === 'rotation' ? MQ_ROT_LABELS : MQ_FIELDS)[f.field] ?? f.field);
      addCell(tr, mqFieldText(f.field, f.before)); addCell(tr, mqFieldText(f.field, f.after));
    }
  }
  document.getElementById('btn-mq-publish').disabled = !!d.errors.length || !d.changes.length;
}

function mqRenderList() {
  if (!_mq) return;
  const text = document.getElementById('mq-filter-text').value.trim().toLowerCase();
  const type = document.getElementById('mq-filter-type').value;
  const status = document.getElementById('mq-filter-status').value;
  const changed = new Set((_mq.draft?.changes ?? []).map(c => c.id));
  const list = mqWorking().filter(m => {
    if (type && m.type !== type) return false;
    if (status === 'active' && !m.active) return false;
    if (status === 'archived' && m.active) return false;
    if (status === 'draft' && !changed.has(m.id)) return false;
    if (!text) return true;
    return [m.id, ...Object.values(m.names ?? {}), ...Object.values(m.descs ?? {})].some(s => String(s).toLowerCase().includes(text));
  });
  document.getElementById('mq-count').textContent = `(${list.length}/${mqWorking().length})`;
  const body = document.getElementById('mq-body');
  body.textContent = '';
  if (!list.length) { const tr = body.insertRow(); addCell(tr, 'Aucune mission.').colSpan = 8; return; }
  for (const m of list) {
    const tr = body.insertRow();
    const art = addCell(tr, '');
    if (m.image) art.appendChild(aiEl('img', { src: m.image, alt: '', width: '32', height: '32', loading: 'lazy' }));
    else art.textContent = m.icon;
    const nameCell = addCell(tr, m.names?.fr ?? m.id);
    nameCell.appendChild(aiEl('div', { class: 'muted', style: 'font-size:0.72rem' }, `${m.id} · « ${mqFill(m.descs?.fr, m.bands[0]?.targets[0] ?? 1)} »`));
    addCell(tr, mqType(m.type)?.label ?? m.type);
    addCell(tr, _mq.categories[m.category] ?? m.category);
    addCell(tr, mqBandsText(m.bands));
    addCell(tr, mqRewardText(m.reward));
    addCell(tr, String(m.weight)).className = 'num';
    const pubM = mqPublished(m.id);
    addCell(tr, `${m.active ? 'Active' : 'Archivée'}${!pubM ? ' · nouvelle (brouillon)' : changed.has(m.id) ? ' · modifiée (brouillon)' : ''}`);
    admRowOpen(tr, `mq:${m.id}`, m.names?.fr ?? m.id, opener => mqOpen(m, opener));
  }
}

function mqRenderRotation() {
  const rot = mqRotation();
  document.getElementById('mq-rot-src').textContent = _mq.draft?.changes?.some(c => c.kind === 'rotation') ? '— brouillon (non publié)' : `— version ${_mq.published.version}`;
  const ul = document.getElementById('mq-rot-view');
  ul.textContent = '';
  for (const k of Object.keys(MQ_ROT_LABELS)) ul.appendChild(aiEl('li', {}, `${MQ_ROT_LABELS[k]} : ${mqRotValue(k, rot[k])}`));
}

// ── Bonus trois missions (05/11) : brouillon seulement, non lu par le jeu ──

const mqSetBonus = () => _mq?.draft?.setBonus ?? _mq?.published?.setBonus ?? { enabled: false, bands: [] };
const mqBandText = b => `à partir de ${b.fromDepth} m : ${b.coins.toLocaleString('fr-BE')} 💰${b.gems ? ` + ${b.gems} 💎` : ''}`;
function mqBonusText(field, v) {
  if (field === 'enabled') return v ? 'oui' : 'non';
  return Array.isArray(v) && v.length ? v.map(mqBandText).join(' · ') : 'aucun palier';
}
function mqRenderBonus() {
  const b = mqSetBonus();
  document.getElementById('mq-bonus-src').textContent = _mq.draft?.changes?.some(c => c.kind === 'setBonus') ? '— brouillon (non publié)' : `— version ${_mq.published.version}`;
  document.getElementById('mq-bonus-state').textContent = !b.bands.length ? 'Aucun bonus (jeu actuel).'
    : b.enabled ? 'Marqué activé dans le catalogue — le jeu ne l\'applique pas encore (branchement après validation du barème).' : 'Désactivé (préparation) — chiffré dans le simulateur.';
  const ul = document.getElementById('mq-bonus-view');
  ul.textContent = '';
  for (const band of b.bands) ul.appendChild(aiEl('li', {}, mqBandText(band)));
}
let _mqBonusSnap = '';
function mqBonusRow(band = { fromDepth: '', coins: 0, gems: 0 }) {
  const tr = document.getElementById('mq-bonus-rows').insertRow();
  for (const [k, max, label] of [['fromDepth', 100000, 'À partir de (m)'], ['coins', 1000000, 'Pièces'], ['gems', 3, 'Gemmes']]) {
    const td = tr.insertCell();
    td.appendChild(aiEl('input', { type: 'number', min: k === 'fromDepth' ? '1' : '0', max: String(max), step: '1', value: String(band[k]), 'data-k': k, 'aria-label': label }));
  }
  const td = tr.insertCell();
  const del = aiEl('button', { type: 'button', class: 'btn btn-outline btn-sm', 'aria-label': 'Retirer ce palier' }, '✕');
  del.addEventListener('click', () => tr.remove());
  td.appendChild(del);
}
function mqBonusFill(b) {
  document.getElementById('mq-bonus-enabled').checked = !!b.enabled;
  document.getElementById('mq-bonus-rows').textContent = '';
  for (const band of b.bands) mqBonusRow(band);
}
function mqBonusRead() {
  return { enabled: document.getElementById('mq-bonus-enabled').checked,
    bands: [...document.querySelectorAll('#mq-bonus-rows tr')].map(tr => Object.fromEntries(
      [...tr.querySelectorAll('input[data-k]')].map(i => [i.dataset.k, i.value === '' ? null : Number(i.value)]))) };
}
admDialogSetup('mq-bonus-dialog', { dirty: () => JSON.stringify(mqBonusRead()) !== _mqBonusSnap, keep: 'Enregistrer dans le brouillon' });
document.getElementById('btn-mq-bonus').addEventListener('click', e => {
  if (!_mq) return;
  mqBonusFill(mqSetBonus());
  document.getElementById('mq-bonus-issues').classList.add('hidden');
  _mqBonusSnap = JSON.stringify(mqBonusRead());
  admDialogOpen('mq-bonus-dialog', e.currentTarget, 'mq-bonus-enabled');
});
document.getElementById('btn-mq-bonus-add').addEventListener('click', () => {
  if (document.querySelectorAll('#mq-bonus-rows tr').length < (_mq?.setBonusLimits?.maxBands ?? 6)) mqBonusRow();
});
document.getElementById('btn-mq-bonus-proposal').addEventListener('click', () => {
  mqBonusFill({ enabled: document.getElementById('mq-bonus-enabled').checked, bands: _mq.proposal.setBonus.bands });
});
document.getElementById('btn-mq-bonus-save').addEventListener('click', async () => {
  const { ok, data } = await api('PUT', '/api/admin/missions/draft/set-bonus', { setBonus: mqBonusRead() });
  if (!ok) return mqIssues(data, 'mq-bonus-issues');
  _mqBonusSnap = JSON.stringify(mqBonusRead());
  document.getElementById('mq-bonus-dialog').close();
  ptMessage('mq-msg', data.draftDropped ? 'Bonus identique à la version en vigueur : aucun brouillon en attente.' : 'Bonus enregistré dans le brouillon. Rien ne change en jeu.', true);
  loadMissions();
});

function mqRenderVersions() {
  const body = document.getElementById('mq-versions-body');
  body.textContent = '';
  const current = _mq.published.version;
  for (const v of _mq.versions) {
    const tr = body.insertRow();
    addCell(tr, `v${v.version}${v.version === current ? ' (en vigueur)' : ''}`);
    addCell(tr, { origin: 'origine', publish: 'publication', rollback: `retour à v${v.fromVersion}` }[v.source] ?? v.source);
    addCell(tr, v.note ?? '');
    addCell(tr, v.createdAt);
    if (v.version === current) addCell(tr, '');
    else addButtonCell(tr, 'Revenir à cette version…', () => mqRollback(v.version));
  }
}

async function loadMissionAudit() {
  const { ok, data } = await api('GET', '/api/admin/missions/audit?limit=100');
  const body = document.getElementById('mq-audit-body');
  body.textContent = '';
  if (!ok) return;
  const labels = { migrate: 'version d\'origine', draft_add: 'ajout (brouillon)', draft_update: 'modification (brouillon)', draft_revert: 'modification annulée',
    draft_remove: 'retrait du brouillon', draft_discard: 'brouillon abandonné', draft_clean: 'brouillon identique supprimé', draft_rotation: 'rotation (brouillon)', draft_set_bonus: 'bonus trois missions (brouillon)',
    draft_proposal: 'proposition adaptative chargée (brouillon)', publish: 'publication', rollback: 'retour arrière' };
  for (const a of data.audit) {
    const tr = body.insertRow();
    addCell(tr, a.created_at); addCell(tr, labels[a.action] ?? a.action); addCell(tr, a.version ? `v${a.version}` : '');
    const d = a.details;
    const fields = d?.changes?.map?.(c => (c.field ? MQ_FIELDS[c.field] ?? MQ_ROT_LABELS[c.field] ?? c.field
      : `${c.id} ${c.kind === 'added' ? '(nouvelle)' : `(${(c.fields ?? []).map(f => MQ_FIELDS[f.field] ?? MQ_ROT_LABELS[f.field] ?? f.field).join(', ')})`}`)) ?? [];
    addCell(tr, [d?.id, d?.to ? `vers v${d.to}` : '', fields.join(', ')].filter(Boolean).join(' — '));
  }
}

// ── Fiche ──

/** Résumé des traductions dans l'en-tête replié : ● nom + texte, ◐ nom seul, ○ vide. */
function mqLangStates() {
  const parts = [];
  for (const l of MQ_LANGS.filter(x => x !== 'fr')) {
    const n = document.getElementById(`mq-${l}-name`)?.value.trim(), d = document.getElementById(`mq-${l}-desc`)?.value.trim();
    parts.push(`${n && d ? '●' : n ? '◐' : '○'} ${l.toUpperCase()}`);
  }
  document.getElementById('mq-acc-langs-sum').textContent = `${parts.join(' · ')} — ● complet, ◐ nom seul, ○ vide`;
}
/** Raison d'écart en français courant (la raison technique reste visible dans le détail). */
function mqReasonText(reason) {
  const r = String(reason ?? '');
  let m;
  if (/aucun bloc « gemme »/.test(r)) return 'gemmes inaccessibles (aucun bloc gemme à cette profondeur)';
  if (/aucun bloc « coffre »/.test(r)) return 'aucun coffre à miner à cette profondeur';
  if ((m = r.match(/aucun bloc « (.+?) »/))) return `aucun bloc « ${m[1]} » à cette profondeur`;
  if ((m = r.match(/profondeur < (\d+) m/))) return `trop peu profond (à partir de ${m[1]} m)`;
  if (/améliorations sont au maximum/.test(r)) return 'toutes les améliorations sont déjà achetées';
  if (/atteignable en une journée/.test(r)) return 'objectif trop élevé pour une journée de jeu';
  if (r === 'archivée') return 'mission archivée';
  return r || 'non tirable';
}
const mqNum = n => Number(n ?? 0).toLocaleString('fr-BE', { maximumFractionDigits: 1 });
const mqGain = (coins, gems) => `${mqNum(coins)} 💰${gems ? ` + ${gems} 💎` : ''}`;

function mqBandRow(b = { fromDepth: '', targets: [] }) {
  const tr = document.getElementById('mq-bands-body').insertRow();
  const from = aiEl('input', { type: 'number', min: '1', step: '1', 'data-mq': 'from', 'aria-label': 'À partir de (m)' });
  from.value = b.fromDepth;
  addCell(tr, '').appendChild(from);
  const tg = aiEl('input', { type: 'text', 'data-mq': 'targets', 'aria-label': 'Objectifs possibles', placeholder: '20, 40, 75' });
  tg.value = (b.targets ?? []).join(', ');
  addCell(tr, '').appendChild(tg);
  const td = addCell(tr, '');
  const rm = aiEl('button', { type: 'button', class: 'btn-ghost', 'aria-label': 'Retirer cette tranche' }, '✕');
  rm.addEventListener('click', () => { tr.remove(); mqRefresh(); });
  td.appendChild(rm);
}

function mqRead() {
  const names = {}, descs = {};
  for (const l of MQ_LANGS) {
    names[l] = document.getElementById(`mq-${l}-name`).value.trim();
    descs[l] = document.getElementById(`mq-${l}-desc`).value.trim();
  }
  const bands = [...document.querySelectorAll('#mq-bands-body tr')].map(tr => ({
    fromDepth: Number(tr.querySelector('[data-mq="from"]').value),
    targets: tr.querySelector('[data-mq="targets"]').value.split(/[,;\s]+/).filter(Boolean).map(Number),
  }));
  const maxDays = document.getElementById('mq-max-days').value.trim();
  return {
    id: document.getElementById('mq-id').value.trim(),
    active: document.getElementById('mq-active').checked,
    type: document.getElementById('mq-type').value,
    category: document.getElementById('mq-category').value,
    icon: document.getElementById('mq-icon').value.trim(),
    image: document.getElementById('mq-image').value.trim() || null,
    names, descs,
    weight: Number(document.getElementById('mq-weight').value),
    minAccountDays: Number(document.getElementById('mq-min-days').value || 0),
    maxAccountDays: maxDays === '' ? null : Number(maxDays),
    bands,
    reward: { coinsPerUnit: Number(document.getElementById('mq-coins').value), gems: Number(document.getElementById('mq-gems').value || 0),
      gemsFromTarget: Number(document.getElementById('mq-gems-from').value || 1) },
  };
}

function mqArt() {
  const box = document.getElementById('mq-art');
  box.textContent = '';
  const img = document.getElementById('mq-image').value.trim();
  if (img) box.appendChild(aiEl('img', { src: img, alt: '', width: '56', height: '56' }));
  else box.textContent = document.getElementById('mq-icon').value || '🎯';
  document.getElementById('btn-mq-noimage').classList.toggle('hidden', !img);
}

/** Aide du type, comparaison avec la version en vigueur, aperçu serveur par profondeur (différé). */
function mqRefresh() {
  const m = mqRead();
  const t = mqType(m.type);
  document.getElementById('mq-type-help').textContent = t
    ? `Compteur : ${t.stat}. Événement suivi : ${t.event} Validation : ${t.validation}${t.limits ? ` Limite : ${t.limits}` : ''} Objectif maximal : ${t.cap} ${t.unit}.` : '';
  document.getElementById('mq-studio-key').textContent = `mission:${m.id || '…'}`;
  const pub = _mqCur ? mqPublished(_mqCur.id) : null;
  const ul = document.getElementById('mq-compare-list');
  ul.textContent = '';
  if (pub && !_mqCur.isNew) {
    for (const f of Object.keys(MQ_FIELDS)) {
      if (JSON.stringify(pub[f] ?? null) === JSON.stringify(m[f] ?? null)) continue;
      ul.appendChild(aiEl('li', {}, `${MQ_FIELDS[f]} : ${mqFieldText(f, pub[f])} → ${mqFieldText(f, m[f])}`));
    }
  }
  document.getElementById('mq-compare').classList.toggle('hidden', !ul.children.length);
  // Essentiel et résumés des sections repliées (lecture seule, recalculés à chaque saisie)
  const goal = m.bands.length ? mqBandsText(m.bands) : 'aucune tranche';
  document.getElementById('mq-ov-goal').textContent = goal;
  document.getElementById('mq-acc-goals-sum').textContent = goal;
  document.getElementById('mq-ov-reward').textContent = mqRewardText(m.reward);
  document.getElementById('mq-acc-reward-sum').textContent = mqRewardText(m.reward);
  document.getElementById('mq-acc-visual-sum').textContent = m.image ? 'image de l\'atelier' : `emoji ${m.icon || '🎯'} (pas d'image)`;
  document.getElementById('mq-acc-adv-sum').textContent = [m.id || 'identifiant à choisir', t?.label ?? m.type, _mq?.categories?.[m.category] ?? m.category,
    `poids ${m.weight}`, m.minAccountDays || m.maxAccountDays != null ? `compte de ${m.minAccountDays} à ${m.maxAccountDays ?? '∞'} j` : 'tous les comptes'].join(' · ');
  mqLangStates();
  mqArt();
  clearTimeout(_mqPrevTimer);
  _mqPrevTimer = setTimeout(mqPreview, 300);
}

async function mqPreview() {
  const seq = ++_mqPrevSeq;
  const m = mqRead();
  const body = document.getElementById('mq-preview-body');
  const note = document.getElementById('mq-preview-note');
  const { ok, data } = await api('POST', '/api/admin/missions/preview', { mission: { ...m, id: m.id || 'apercu', names: { ...m.names, fr: m.names.fr || 'Aperçu' } } });
  if (seq !== _mqPrevSeq) return;   // une saisie plus récente a relancé l'aperçu
  body.textContent = '';
  const sum = document.getElementById('mq-acc-preview-sum');
  if (!ok) { note.textContent = `Aperçu indisponible : ${data.error ?? 'erreur'}`; sum.textContent = ''; return; }
  note.textContent = data.rotationIsProposal
    ? 'La rotation en vigueur est celle d\'origine (sans adaptation) : l\'aperçu applique les règles de la proposition adaptative (journée de référence de '
      + `${data.rotationUsed.dayBlocks} blocs) pour montrer ce que verrait chaque joueur après activation.`
    : `Rotation adaptative du brouillon (journée de référence de ${data.rotationUsed.dayBlocks} blocs).`;
  // Une ligne lisible par profil (« 20 m : indisponible — … », « 100 m : disponible — objectifs 1 / 2 / 3 »), détail replié.
  for (const r of data.rows) {
    const row = aiEl('details', { class: `mq-pv ${r.ok ? 'mq-pv--ok' : 'mq-pv--no'}` });
    const s = aiEl('summary');
    s.appendChild(aiEl('span', { class: 'mq-pv-who' }, `${r.profile.depth} m`));
    s.appendChild(aiEl('span', { class: `mq-badge ${r.ok ? 'mq-badge--ok' : 'mq-badge--no'}` }, r.ok ? 'disponible' : 'indisponible'));
    s.appendChild(aiEl('span', { class: 'mq-pv-what' }, r.ok ? `objectifs ${r.targets.join(' / ')}` : mqReasonText(r.reason)));
    row.appendChild(s);
    const d = aiEl('div', { class: 'mq-pv-detail' });
    d.appendChild(aiEl('p', {}, `Profil ${r.profile.label} : ${r.profile.depth} m, compte de ${r.profile.accountDays} jour(s).`));
    if (r.ok) {
      const ul = aiEl('ul');
      for (const x of r.rewards) ul.appendChild(aiEl('li', {}, `« ${x.text} » → ${mqGain(x.coins, x.gems)}`));
      d.appendChild(ul);
      d.appendChild(aiEl('p', { class: 'muted' }, `Tranche utilisée : dès ${r.bandFrom} m${r.cap != null ? ` · objectifs plafonnés à ${r.cap} (ce qu'une journée de référence permet)` : ''}.`));
    } else d.appendChild(aiEl('p', { class: 'muted' }, `Raison technique : ${r.reason}.`));
    row.appendChild(d);
    body.appendChild(row);
  }
  const n = data.rows.filter(r => r.ok).length;
  sum.textContent = `disponible pour ${n} profil${n > 1 ? 's' : ''} sur ${data.rows.length}`;
}

function mqOpen(mission, opener, isNew = false) {
  _mqCur = { id: mission.id, isNew };
  const m = mission;
  document.getElementById('mq-form-title').textContent = isNew ? 'Nouvelle mission' : `${m.icon} ${m.names?.fr ?? m.id}`;
  for (const l of MQ_LANGS) {
    document.getElementById(`mq-${l}-name`).value = m.names?.[l] ?? '';
    document.getElementById(`mq-${l}-desc`).value = m.descs?.[l] ?? '';
  }
  const idEl = document.getElementById('mq-id');
  idEl.value = m.id ?? '';
  idEl.readOnly = !isNew;
  document.getElementById('mq-active').checked = m.active !== false;
  document.getElementById('mq-type').value = m.type;
  document.getElementById('mq-category').value = m.category;
  document.getElementById('mq-icon').value = m.icon ?? '';
  document.getElementById('mq-image').value = m.image ?? '';
  document.getElementById('mq-weight').value = m.weight;
  document.getElementById('mq-min-days').value = m.minAccountDays ?? 0;
  document.getElementById('mq-max-days').value = m.maxAccountDays ?? '';
  document.getElementById('mq-coins').value = m.reward?.coinsPerUnit ?? 0;
  document.getElementById('mq-gems').value = m.reward?.gems ?? 0;
  document.getElementById('mq-gems-from').value = m.reward?.gemsFromTarget ?? 1;
  document.getElementById('mq-bands-body').textContent = '';
  document.getElementById('mq-preview-body').textContent = '';   // pas d'aperçu d'une fiche précédente
  document.getElementById('mq-acc-preview-sum').textContent = '';
  // Sections : aperçu ouvert, le reste replié ; une nouvelle mission ouvre ce qu'il faut remplir (identifiant, type, objectifs)
  for (const d of document.querySelectorAll('#mq-dialog details.bk-acc')) d.open = d.id === 'mq-acc-preview' || (isNew && ['mq-acc-adv', 'mq-acc-goals'].includes(d.id));
  for (const b of m.bands ?? []) mqBandRow(b);
  const pub = mqPublished(m.id);
  const changed = !!pub && !isNew && (_mq.draft?.changes ?? []).some(c => c.id === m.id);
  const draftOnly = !isNew && !_mq.publishedIds.includes(m.id);
  const state = document.getElementById('mq-state');
  state.textContent = isNew ? 'Nouvelle mission : enregistrée dans le brouillon, jamais tirée avant publication ET activation du catalogue en jeu.'
    : draftOnly ? 'Mission du brouillon, jamais publiée.'
    : changed ? 'Cette mission a des modifications dans le brouillon : la comparaison montre l\'écart avec la version en vigueur.'
    : `Valeurs en vigueur (version ${_mq.published.version}).`;
  state.classList.remove('hidden');
  document.getElementById('mq-issues').classList.add('hidden');
  document.getElementById('btn-mq-revert').classList.toggle('hidden', !changed);
  document.getElementById('btn-mq-remove').classList.toggle('hidden', !draftOnly);
  document.getElementById('btn-mq-duplicate').classList.toggle('hidden', isNew);
  for (const h of document.querySelectorAll('#mq-dialog .bk-hint')) h.hidden = true;
  mqRefresh();
  _mqSnap = JSON.stringify(mqRead());
  admDialogOpen('mq-dialog', opener, isNew ? 'mq-fr-name' : null);
}

admDialogSetup('mq-dialog', { dirty: () => JSON.stringify(mqRead()) !== _mqSnap, keep: 'Enregistrer dans le brouillon' });

function mqIssues(data, id = 'mq-issues') {
  const ul = document.getElementById(id);
  ul.textContent = '';
  for (const e of [data.error, ...(data.details ?? [])].filter(Boolean)) ul.appendChild(aiEl('li', {}, e));
  ul.classList.toggle('hidden', !ul.children.length);
  // Erreur sur la fiche : ouvrir les sections repliées pour que le champ en cause soit visible (saisies conservées)
  if (id === 'mq-issues' && ul.children.length) for (const d of document.querySelectorAll('#mq-dialog details.bk-acc')) d.open = true;
  ul.scrollIntoView?.({ block: 'nearest' });
}

document.getElementById('mq-dialog').addEventListener('click', e => {
  const b = e.target.closest('.bk-info');
  if (!b) return;
  e.preventDefault();
  const h = document.getElementById(b.getAttribute('aria-controls'));
  const show = h.hidden;
  for (const o of document.querySelectorAll('#mq-dialog .bk-hint')) { o.hidden = true; }
  for (const o of document.querySelectorAll('#mq-dialog .bk-info')) o.setAttribute('aria-expanded', 'false');
  h.hidden = !show;
  b.setAttribute('aria-expanded', String(show));
});

document.getElementById('btn-mq-add').addEventListener('click', e => {
  if (!_mq) return;
  mqOpen({ id: '', active: true, type: 'break_blocks', category: 'minage', icon: '🎯', image: null, names: {}, descs: { fr: 'Casser {t} blocs' },
    weight: 10, minAccountDays: 0, maxAccountDays: null, bands: [{ fromDepth: 1, targets: [20, 40, 60] }],
    reward: { coinsPerUnit: 4, gems: 0, gemsFromTarget: 1 } }, e.currentTarget, true);
});
document.getElementById('btn-mq-duplicate').addEventListener('click', async () => {
  const dlg = document.getElementById('mq-dialog');
  const src = mqRead();
  if (dlg._admDirty() && !await admConfirmDiscard({ keep: 'Enregistrer dans le brouillon', effect: 'ouvre une copie de ces saisies ; la mission d\'origine n\'est pas modifiée.' })) return;
  let id = `${src.id}_copie`.slice(0, 40);
  for (let k = 2; mqWorking().some(m => m.id === id); k++) id = `${src.id.slice(0, 34)}_copie${k}`;
  dlg.close();
  mqOpen({ ...src, id, image: null, names: { ...src.names, fr: `${src.names.fr} (copie)`.slice(0, 40) } }, document.getElementById('btn-mq-add'), true);
});
document.getElementById('mq-dialog').addEventListener('input', mqRefresh);
document.getElementById('mq-type').addEventListener('change', () => {
  const t = mqType(document.getElementById('mq-type').value);
  if (t && _mqCur?.isNew) document.getElementById('mq-category').value = t.category;
  mqRefresh();
});
document.getElementById('btn-mq-band-add').addEventListener('click', () => {
  const rows = mqRead().bands;
  mqBandRow({ fromDepth: (rows.at(-1)?.fromDepth || 0) + 50, targets: rows.at(-1)?.targets ?? [] });
  mqRefresh();
});
document.getElementById('mq-filter-text').addEventListener('input', mqRenderList);
document.getElementById('mq-filter-type').addEventListener('change', mqRenderList);
document.getElementById('mq-filter-status').addEventListener('change', mqRenderList);
document.getElementById('btn-mq-noimage').addEventListener('click', () => { document.getElementById('mq-image').value = ''; mqRefresh(); });

document.getElementById('btn-mq-save').addEventListener('click', async () => {
  const mission = mqRead();
  if (!mission.id) return mqIssues({ error: 'Identifiant obligatoire (a-z, 0-9, _).' });
  if (_mqCur.isNew && mqWorking().some(m => m.id === mission.id)) return mqIssues({ error: `« ${mission.id} » existe déjà.` });
  const { ok, data } = await api('PUT', `/api/admin/missions/draft/missions/${encodeURIComponent(mission.id)}`, { mission });
  if (!ok) return mqIssues(data);
  _mqSnap = JSON.stringify(mqRead());
  document.getElementById('mq-dialog').close();
  ptMessage('mq-msg', data.draftDropped
    ? `« ${mission.id} » : identique à la version en vigueur, aucun brouillon en attente.`
    : `« ${mission.id} » enregistrée dans le brouillon. Rien ne change en jeu.`, true);
  loadMissions();
});

document.getElementById('btn-mq-revert').addEventListener('click', async () => {
  const id = _mqCur?.id;
  if (!id || !await admAsk(`Annuler les modifications de « ${id} » ?\nElle reprend dans le brouillon ses valeurs en vigueur ; le reste du brouillon ne bouge pas.`)) return;
  const { ok, data } = await api('POST', `/api/admin/missions/draft/missions/${encodeURIComponent(id)}/revert`);
  if (!ok) return mqIssues(data);
  document.getElementById('mq-dialog').close();
  ptMessage('mq-msg', `« ${id} » : modifications annulées${data.draftDropped ? ' ; plus aucun brouillon en attente.' : '.'}`, true);
  loadMissions();
});

document.getElementById('btn-mq-remove').addEventListener('click', async () => {
  const id = _mqCur?.id;
  if (!id || !await admAsk(`Retirer « ${id} » du brouillon ?\nElle n'a jamais été publiée.`)) return;
  const { ok, data } = await api('DELETE', `/api/admin/missions/draft/missions/${encodeURIComponent(id)}`);
  if (!ok) return mqIssues(data);
  document.getElementById('mq-dialog').close();
  ptMessage('mq-msg', `« ${id} » retirée du brouillon.`, true);
  loadMissions();
});

// ── Rotation ──

const MQ_ROT_KEYS = ['perDay', 'maxPerCategory', 'repeatDays', 'repeatFactor', 'dayBlocks'];
function mqRotRead() {
  const r = { mode: document.getElementById('mq-rot-mode').value, timezone: document.getElementById('mq-rot-timezone').value,
    perPlayer: document.getElementById('mq-rot-perPlayer').checked };
  for (const k of MQ_ROT_KEYS) r[k] = Number(document.getElementById(`mq-rot-${k}`).value);
  return r;
}
admDialogSetup('mq-rot-dialog', { dirty: () => JSON.stringify(mqRotRead()) !== _mqRotSnap, keep: 'Enregistrer dans le brouillon' });
document.getElementById('btn-mq-rotation').addEventListener('click', e => {
  if (!_mq) return;
  const rot = mqRotation();
  document.getElementById('mq-rot-mode').value = rot.mode;
  document.getElementById('mq-rot-timezone').value = rot.timezone;
  document.getElementById('mq-rot-perPlayer').checked = !!rot.perPlayer;
  for (const k of MQ_ROT_KEYS) document.getElementById(`mq-rot-${k}`).value = rot[k];
  const help = document.getElementById('mq-rot-help');
  help.textContent = '';
  for (const [k, txt] of Object.entries(_mq.rotationFields)) help.appendChild(aiEl('li', {}, `${MQ_ROT_LABELS[k] ?? k} : ${txt}`));
  document.getElementById('mq-rot-issues').classList.add('hidden');
  _mqRotSnap = JSON.stringify(mqRotRead());
  admDialogOpen('mq-rot-dialog', e.currentTarget, 'mq-rot-mode');
});
document.getElementById('btn-mq-rot-save').addEventListener('click', async () => {
  const { ok, data } = await api('PUT', '/api/admin/missions/draft/rotation', { rotation: mqRotRead() });
  if (!ok) return mqIssues(data, 'mq-rot-issues');
  _mqRotSnap = JSON.stringify(mqRotRead());
  document.getElementById('mq-rot-dialog').close();
  ptMessage('mq-msg', data.draftDropped ? 'Rotation identique à la version en vigueur : aucun brouillon en attente.' : 'Rotation enregistrée dans le brouillon. Rien ne change en jeu.', true);
  loadMissions();
});
document.getElementById('btn-mq-proposal').addEventListener('click', async () => {
  if (!await admConfirm({ title: 'Charger la proposition adaptative dans le brouillon ?',
    text: 'Objectifs par tranche de profondeur, poids et rotation adaptative (par joueur, anti-répétition, journée de référence) sont écrits dans le BROUILLON des six missions d\'origine.',
    impact: ['Rien n\'est publié ni visible en jeu.', 'Récompenses par unité inchangées ; textes, icônes et missions ajoutées conservés.', 'Annulable : « Abandonner le brouillon ».'],
    ok: 'Charger dans le brouillon' })) return;
  const { ok, data } = await api('POST', '/api/admin/missions/draft/proposal');
  ptMessage('mq-msg', ok ? 'Proposition chargée dans le brouillon : comparez-la dans le simulateur (source « Brouillon »).' : [data.error, ...(data.details ?? [])].filter(Boolean).join(' '), ok);
  loadMissions();
});

// ── Brouillon : publier, abandonner, revenir ──

document.getElementById('btn-mq-discard').addEventListener('click', async () => {
  if (!await admConfirm({ title: 'Abandonner le brouillon des missions ?', text: 'Toutes les modifications non publiées sont perdues.',
    impact: ['Rien ne change pour les joueurs.', 'L\'action est tracée dans le journal.'], ok: 'Abandonner le brouillon', danger: true })) return;
  const { ok, data } = await api('DELETE', '/api/admin/missions/draft');
  ptMessage('mq-msg', ok ? 'Brouillon abandonné.' : (data.error || 'Erreur.'), ok);
  loadMissions();
});

document.getElementById('btn-mq-publish').addEventListener('click', async () => {
  const d = _mq?.draft;
  if (!d) return;
  const note = await admPrompt({ title: `Publier le brouillon (version ${_mq.published.version + 1}) ?`,
    text: `Éléments concernés : ${d.changes.map(c => c.id).join(', ')}. ${_mq.live ? 'Les missions des PROCHAINS jours suivront cette version ; les missions déjà attribuées aujourd\'hui ne changent pas.' : 'Le jeu n\'utilise pas encore ce catalogue : aucun joueur ne voit de changement.'} Retour arrière possible : « Versions publiées → Revenir à cette version ».`,
    label: 'Note de publication (raison, accord du propriétaire)', ok: 'Publier' });
  if (note === null) return;
  const { ok, data } = await api('POST', '/api/admin/missions/publish', { note, basedOn: d.basedOn });
  if (!ok) { ptMessage('mq-msg', [data.error, ...(data.details ?? [])].filter(Boolean).join(' '), false); return; }
  ptMessage('mq-msg', `Version ${data.version} publiée (${data.changes.length} élément(s) modifié(s)).`, true);
  loadMissions();
});

async function mqRollback(version) {
  if (!await admConfirm({ title: `Revenir à la version ${version} ?`, text: 'Une NOUVELLE version reprenant ce contenu est publiée immédiatement.',
    impact: ['Les missions ajoutées depuis sont gardées mais archivées.', 'Le brouillon éventuel est abandonné.'],
    ok: `Revenir à la version ${version}`, danger: true })) return;
  const { ok, data } = await api('POST', '/api/admin/missions/rollback', { version });
  ptMessage('mq-msg', ok ? `Version ${data.version} publiée (retour au contenu de la version ${data.restored}).` : [data.error, ...(data.details ?? [])].filter(Boolean).join(' '), ok);
  loadMissions();
}

// ── Simulateur ──

// Recette #68-B (06/11) : synthèse par profil d'abord, journées repliables, bonus hypothétique séparé, détails techniques repliés.
// Présentation seule : la réponse du serveur (calculs de rotation, objectifs, barèmes) n'est pas modifiée.
const mqDay = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
function mqSimCard(value, label, warn = false) {
  const c = aiEl('div', { class: `mq-sim-card${warn ? ' mq-sim-card--warn' : ''}` });
  c.appendChild(aiEl('strong', {}, value));
  c.appendChild(aiEl('span', {}, label));
  return c;
}
function mqSimProfile(p, data, nameOf) {
  const s = p.stats, sb = s.setBonus, days = p.plan.length;
  const box = aiEl('section', { class: 'mq-sim-profile', 'aria-label': `Profil ${p.profile.label}` });
  box.appendChild(aiEl('h4', {}, `${p.profile.label} — ${p.profile.depth} m · ${mqNum(p.profile.blocksPerDay)} blocs/jour`));
  const cards = aiEl('div', { class: 'mq-sim-cards' });
  cards.appendChild(mqSimCard(`${s.distinctDays}/${days}`, 'journées différentes'));
  cards.appendChild(mqSimCard(`${s.completed}/${s.assigned}`, 'missions atteignables', s.completed < s.assigned));
  cards.appendChild(mqSimCard(String(s.repeatsFromYesterday), `répétition${s.repeatsFromYesterday > 1 ? 's' : ''} de la veille`));
  cards.appendChild(mqSimCard(mqGain(s.coinsIfCompleted, s.gemsIfCompleted),
    `récompenses des missions sur ${days} jour${days > 1 ? 's' : ''} (≈ ${mqGain(Math.round(s.coinsIfCompleted / days), Math.round(s.gemsIfCompleted / days * 10) / 10)} par jour)`));
  box.appendChild(cards);

  // Bonus trois missions : toujours à part, jamais additionné aux récompenses normales sans le dire
  if (sb?.band) {
    const bx = aiEl('div', { class: 'mq-sim-bonus' });
    bx.appendChild(aiEl('span', { class: `mq-badge ${sb.enabled ? 'mq-badge--ok' : 'mq-badge--sim'}` }, sb.enabled ? 'Bonus activé dans cette source (le jeu ne l\'applique pas encore)' : 'Simulation uniquement — bonus désactivé'));
    bx.appendChild(aiEl('p', {}, `🎁 Bonus trois missions${sb.enabled ? '' : ' (hypothèse : s\'il était activé)'} : ${sb.daysAllDone}/${days} journée${days > 1 ? 's' : ''} complète${sb.daysAllDone > 1 ? 's' : ''} → ${mqGain(sb.coins, sb.gems)} en plus.`));
    bx.appendChild(aiEl('p', { class: 'muted' }, `Sans bonus : ${mqGain(s.coinsIfCompleted, s.gemsIfCompleted)} · avec bonus : ${mqGain(s.coinsIfCompleted + sb.coins, s.gemsIfCompleted + sb.gems)} (sur ${days} jour${days > 1 ? 's' : ''}).`));
    box.appendChild(bx);
  }

  for (const [i, d] of p.plan.entries()) {
    const ok = d.missions.filter(m => m.done).length;
    const coins = d.missions.filter(m => m.done).reduce((t, m) => t + m.reward.coins, 0), gems = d.missions.filter(m => m.done).reduce((t, m) => t + m.reward.gems, 0);
    const day = aiEl('details', { class: 'mq-sim-day' });
    day.open = days <= 3 || i === 0;
    const sum = aiEl('summary');
    sum.appendChild(aiEl('span', { class: 'mq-sim-day-date' }, mqDay(d.date)));
    sum.appendChild(aiEl('span', { class: `mq-badge ${ok === d.missions.length ? 'mq-badge--ok' : 'mq-badge--no'}` }, `${ok}/${d.missions.length} atteignables`));
    sum.appendChild(aiEl('span', { class: 'mq-sim-day-gain' }, mqGain(coins, gems)));
    day.appendChild(sum);
    const ul = aiEl('ul', { class: 'mq-sim-missions' });
    for (const m of d.missions) {
      const li = aiEl('li', { class: m.done ? '' : 'mq-sim-miss' });
      li.appendChild(aiEl('span', { class: 'mq-sim-ico', 'aria-hidden': 'true' }, m.icon || '🎯'));
      const t = aiEl('div', { class: 'mq-sim-txt' });
      t.appendChild(aiEl('strong', {}, m.name || nameOf(m.id)));
      t.appendChild(aiEl('span', {}, m.text));
      const tags = aiEl('span', { class: 'mq-sim-tags' });
      tags.appendChild(aiEl('span', { class: `mq-badge ${m.done ? 'mq-badge--ok' : 'mq-badge--no'}` }, m.done ? '✓ atteignable' : '✗ non atteignable'));
      if (m.repeated) tags.appendChild(aiEl('span', { class: 'mq-badge' }, 'reprise de la veille'));
      t.appendChild(tags);
      if (!m.done) t.appendChild(aiEl('small', { class: 'mq-sim-why' }, m.expected == null ? 'Activité estimée inconnue pour ce type : comptée non atteignable.'
        : `Activité estimée : ${mqNum(m.expected)} sur un objectif de ${mqNum(m.target)}.`));
      li.appendChild(t);
      li.appendChild(aiEl('span', { class: 'mq-sim-rew' }, mqGain(m.reward.coins, m.reward.gems)));
      ul.appendChild(li);
    }
    day.appendChild(ul);
    if (d.setBonus) day.appendChild(aiEl('p', { class: 'mq-sim-day-bonus' }, `🎁 Journée complète — bonus ${sb?.enabled ? '' : 'hypothétique (désactivé) '}: ${mqGain(d.setBonus.coins, d.setBonus.gems)}, non compté ci-dessus.`));
    box.appendChild(day);
  }

  const det = aiEl('details', { class: 'mq-sim-more' });
  det.appendChild(aiEl('summary', {}, 'Détails / Pourquoi ?'));
  const dl = aiEl('ul');
  dl.appendChild(aiEl('li', {}, `Activité estimée par jour : ${mqNum(p.activity.meters)} m, ${mqNum(p.activity.chests)} coffres minés, ${mqNum(p.activity.gems)} gemmes, ${mqNum(p.activity.coins)} pièces (hors reliques et boosts ; hypothèse 1 bloc = 1 m).`));
  dl.appendChild(aiEl('li', {}, `Profil : compte de ${p.profile.accountDays} jour(s).`));
  for (const d of p.plan) {
    if (!d.excluded.length) continue;
    dl.appendChild(aiEl('li', {}, `Écartées le ${mqDay(d.date)} : ${d.excluded.map(x => `${nameOf(x.id)} — ${mqReasonText(x.reason)} (${x.reason})`).join(' · ')}.`));
  }
  dl.appendChild(aiEl('li', {}, `Nombre de tirages par mission : ${Object.entries(s.frequency).map(([k, n]) => `${nameOf(k)} ${n}`).join(', ') || '—'}.`));
  if (sb?.band) {
    const pct = x => (x == null ? '—' : `${(x * 100).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} %`);
    dl.appendChild(aiEl('li', {}, `Bonus : palier ${mqBandText(sb.band)} ; il représenterait ${pct(sb.coinsVsMining)} des pièces et ${pct(sb.gemsVsMining)} des gemmes gagnées en minant sur la période.`));
  }
  det.appendChild(dl);
  box.appendChild(det);
  return box;
}

document.getElementById('btn-mq-simulate').addEventListener('click', async () => {
  const out = document.getElementById('mq-sim-out');
  const ids = [...document.querySelectorAll('#mq-sim-profiles input:checked')].map(c => c.value);
  if (!ids.length) { out.textContent = 'Cochez au moins un profil.'; return; }
  const body = { source: document.getElementById('mq-sim-source').value, days: Number(document.getElementById('mq-sim-days').value) || 2,
    start: document.getElementById('mq-sim-start').value || null, profiles: ids.map(id => ({ id })) };
  out.textContent = 'Simulation…';
  const { ok, data } = await api('POST', '/api/admin/missions/simulate', body);
  out.textContent = '';
  if (!ok) { out.appendChild(aiEl('p', { class: 'error' }, [data.error, ...(data.details ?? [])].filter(Boolean).join(' '))); return; }
  // Noms lisibles à la place des identifiants techniques (find_gems, buy_upgrades…)
  const names = new Map();
  for (const m of [...(_mq?.published?.missions ?? []), ...mqWorking()]) names.set(m.id, m.names?.fr ?? m.id);
  for (const p of data.profiles) for (const d of p.plan) for (const m of d.missions) if (m.name) names.set(m.id, m.name);
  const nameOf = id => names.get(id) ?? id;
  const bonusOn = data.profiles.some(p => p.stats.setBonus?.enabled);
  out.appendChild(aiEl('p', { class: 'mq-sim-note' }, `🧪 Simulation uniquement — rien ne change en jeu.${bonusOn ? '' : ' Bonus trois missions désactivé : chiffré à part, à titre d\'hypothèse.'}`));
  const help = aiEl('details', { class: 'mq-sim-help' });
  help.appendChild(aiEl('summary', {}, 'Comment lire ces résultats ?'));
  const hl = aiEl('ul');
  for (const t of [
    '✓ atteignable : avec l\'activité estimée du profil, l\'objectif est rempli dans la journée (ex. 60 blocs cassés pour « Casser 40 blocs »).',
    '✗ non atteignable : l\'activité estimée ne suffit pas ; la mission est quand même proposée au joueur.',
    'Activité estimée : ce que le profil fait en une journée (blocs cassés, mètres, coffres, gemmes, pièces), avec l\'hypothèse 1 bloc = 1 m.',
    'Reprise de la veille : la mission était déjà proposée la veille. Journées différentes : nombre de jours dont les 3 missions ne sont pas exactement les mêmes.',
    'Écartée : la mission n\'est pas tirée pour ce profil (ex. trop peu profond, gemmes inaccessibles, améliorations déjà toutes achetées).',
    '100 % atteignable : toutes les missions proposées sur la période sont faisables par ce profil.',
  ]) hl.appendChild(aiEl('li', {}, t));
  help.appendChild(hl);
  help.appendChild(aiEl('p', { class: 'muted' }, `Source : ${data.version} · rotation ${mqRotValue('mode', data.rotation.mode)}, ${data.rotation.perDay}/jour${data.rotation.mode === 'adaptive' ? `, au plus ${data.rotation.maxPerCategory} par catégorie, anti-répétition ${data.rotation.repeatDays} j × ${data.rotation.repeatFactor}, journée de référence ${data.rotation.dayBlocks} blocs, ${data.rotation.perPlayer ? 'par joueur' : 'commune'}` : ''}.`));
  out.appendChild(help);
  for (const p of data.profiles) out.appendChild(mqSimProfile(p, data, nameOf));
});

// ── Atelier d'icônes ──

document.getElementById('btn-mq-studio').addEventListener('click', async () => {
  const id = _mqCur?.id;
  if (!id || _mqCur.isNew || (!_mq.draft?.missions?.some(m => m.id === id) && !mqPublished(id))) {
    return mqIssues({ error: 'Enregistrez d\'abord la mission dans le brouillon : l\'atelier travaille sur une mission existante.' });
  }
  const dlg = document.getElementById('mq-dialog');
  if (dlg._admDirty() && !await admConfirmDiscard({ keep: 'Enregistrer dans le brouillon', effect: 'ferme la fiche, perd ces saisies et ouvre l\'atelier d\'icônes.' })) return;
  _mqSnap = JSON.stringify(mqRead());
  dlg.close();
  document.querySelector('.tab-btn[data-tab="icons"]').click();
  _icFrom = { kind: 'mission', id };
  icOpen(`mission:${id}`);
});

/** Retour de l'atelier d'icônes vers la fiche de la mission (catalogue rechargé : image du brouillon). */
async function mqBackTo(id) {
  _mq = null;
  document.querySelector('.tab-btn[data-tab="missions"]').click();
  for (let k = 0; k < 50 && !_mq; k++) await new Promise(r => setTimeout(r, 100));
  const m = mqWorking().find(x => x.id === id);
  if (!m) return;
  mqOpen(m, document.querySelector(`[data-adm-key="${CSS.escape(`mq:${id}`)}"]`));
  document.getElementById('mq-acc-visual').open = true;   // retour de l'atelier : on montre l'image choisie
}

admRefreshButton('btn-refresh-missions', loadMissions, 'Missions');

// ── Pioche à charges (#71) ───────────────────────────────────────────────────
// Drapeau (off / testeurs / tous) appliqué à part ; réglages protégés contre la perte de saisie (#61).

const PK_KIND = {
  over_capacity: 'Réserve au-dessus de la capacité', fast_regen: 'Recharge trop rapide',
  full_hits: 'Coups pleins sans charge', tree_level: 'Niveau d\'arbre hors barème',
};
const _pkZone = admZone(document.getElementById('pk-settings-card'));
let _pk = null;

const pkList = arr => arr.map(v => String(v).replace('.', ',')).join(' ; ');
function pkRows(tbodyId, rows) {
  const tb = document.getElementById(tbodyId);
  tb.textContent = '';
  for (const cells of rows) {
    const tr = document.createElement('tr');
    for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
    tb.appendChild(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = tb.closest('table').querySelectorAll('th').length;
    td.className = 'muted';
    td.textContent = 'Aucun élément.';
    tr.appendChild(td);
    tb.appendChild(tr);
  }
}

function renderPickaxe(data) {
  _pk = data;
  const s = data.settings;
  const banner = document.getElementById('pk-banner');
  banner.className = `contest-banner contest-banner--${s.mode === 'off' ? 'locked' : 'open'}`;
  banner.textContent = s.mode === 'on' ? '🔋 Pioche à charges ACTIVE pour tous les joueurs.'
    : s.mode === 'testers' ? `🧪 Pioche à charges active pour ${data.testers.length} testeur(s) : ${data.testers.map(x => x.username).join(', ') || 'aucun'}.`
    : '🔒 Pioche à charges désactivée : jeu inchangé.';
  document.getElementById('pk-mode').value = s.mode;
  document.getElementById('pk-testers').value = data.testers.map(x => x.username).join(', ');
  if (!admZoneDirty(_pkZone)) {
    document.getElementById('pk-capacity').value = s.capacity;
    document.getElementById('pk-regen').value = s.regenSeconds;
    document.getElementById('pk-threshold').value = Math.round(s.resumeThreshold * 100);
    document.getElementById('pk-coins').value = s.refillCoinsPerCharge;
    document.getElementById('pk-cap-mult').value = pkList(s.capacityMult);
    document.getElementById('pk-cap-prices').value = pkList(s.capacityPrices);
    document.getElementById('pk-speed-mult').value = pkList(s.speedMult);
    document.getElementById('pk-speed-prices').value = pkList(s.speedPrices);
    document.getElementById('pk-packs').value = pkList(s.refillPacks);
    document.getElementById('pk-refill-enabled').checked = s.refillEnabled;
    document.getElementById('pk-note').value = '';
    admZoneClean(_pkZone);
  }
  const pv = data.preview;
  document.getElementById('pk-preview-summary').textContent =
    `Réserve de base ${s.capacity.toLocaleString('fr-BE')} coups, +1 toutes les ${String(s.regenSeconds).replace('.', ',')} s : pleine en ${pv.fullRefillMinutes} min ; `
    + `bonus de retour à ${Math.round(s.resumeThreshold * 100)} % de la réserve. Recharges en pièces : ${s.refillEnabled ? 'proposées' : 'masquées'}.`;
  pkRows('pk-prev-cap', pv.capacity.map(r => [r.level, r.value.toLocaleString('fr-BE'), r.level ? r.price : '—']));
  pkRows('pk-prev-speed', pv.speed.map(r => [r.level, String(r.value).replace('.', ','), r.level ? r.price : '—']));
  pkRows('pk-prev-refill', pv.refill100m.map(r => [`+${r.pct} %`, r.add.toLocaleString('fr-BE'), `${r.coins.toLocaleString('fr-BE')} 🪙`]));
  pkRows('pk-anomalies', data.anomalies.map(a => [a.created_at, a.username ?? `#${a.user_id}`, PK_KIND[a.kind] ?? a.kind, a.amount, a.details ?? '']));
  pkRows('pk-players', data.players.map(p => [p.username ?? `#${p.user_id}`, Math.floor(p.charges).toLocaleString('fr-BE'), p.cap_level, p.speed_level,
    p.full_hits.toLocaleString('fr-BE'), p.refilled.toLocaleString('fr-BE'), p.updated_at]));
  const ul = document.getElementById('pk-audit');
  ul.textContent = '';
  for (const a of data.audit) {
    const li = document.createElement('li');
    let mode = '';
    try { mode = JSON.parse(a.new_value).mode; } catch { /* valeur illisible : date seule */ }
    li.textContent = `${a.created_at} UTC — mode ${mode}${a.note ? ` — ${a.note}` : ''}`;
    ul.appendChild(li);
  }
  if (!data.audit.length) { const li = document.createElement('li'); li.textContent = 'Aucune modification depuis l\'installation (valeurs par défaut).'; ul.appendChild(li); }
}

async function loadPickaxe() {
  const { ok, data } = await api('GET', '/api/admin/pickaxe');
  if (!ok) { adMessage('pk-settings-msg', data.error || 'Erreur lors du chargement.', false); return; }
  renderPickaxe(data);
}

admRefreshButton('btn-refresh-pickaxe', loadPickaxe, 'Pioche à charges');

document.getElementById('btn-pk-mode').addEventListener('click', async () => {
  const mode = document.getElementById('pk-mode').value;
  const testers = document.getElementById('pk-testers').value;
  if (mode === 'on' && _pk?.settings.mode !== 'on') {
    const yes = await admConfirm({
      title: 'Activer la pioche à charges pour tous ?',
      text: 'Tous les joueurs (y compris sans compte) verront la réserve de coups dans la minute.',
      impact: ['Réglages bêta non validés : la descente des joueurs actifs est ralentie (voir le rapport #71).', 'Retour arrière : repasser en OFF (aucune donnée effacée).'],
      ok: 'Activer pour tous', danger: true,
    });
    if (!yes) return;
  }
  const { ok, data } = await api('PUT', '/api/admin/pickaxe/settings', { mode, testers, note: `activation : ${mode}` });
  if (!ok) return adMessage('pk-mode-msg', data.error || 'Erreur.', false);
  adMessage('pk-mode-msg', data.changed ? 'Activation enregistrée.' : 'Aucun changement.', true);
  renderPickaxe(data);
});

document.getElementById('btn-pk-settings').addEventListener('click', async () => {
  const v = id => document.getElementById(id).value;
  const body = {
    capacity: Number(v('pk-capacity')), regenSeconds: Number(v('pk-regen')), resumeThreshold: Number(v('pk-threshold')) / 100,
    refillCoinsPerCharge: Number(v('pk-coins')),
    capacityMult: v('pk-cap-mult'), capacityPrices: v('pk-cap-prices'), speedMult: v('pk-speed-mult'), speedPrices: v('pk-speed-prices'),
    refillPacks: v('pk-packs'), refillEnabled: document.getElementById('pk-refill-enabled').checked, note: v('pk-note'),
  };
  if (_pk?.settings.mode !== 'off') {
    const yes = await admConfirm({
      title: 'Appliquer ces réglages ?',
      text: `La pioche à charges est active (${_pk.settings.mode === 'on' ? 'tous les joueurs' : 'testeurs'}) : les nouveaux réglages s'appliquent dans la minute.`,
      ok: 'Enregistrer',
    });
    if (!yes) return;
  }
  const { ok, data } = await api('PUT', '/api/admin/pickaxe/settings', body);
  if (!ok) return adMessage('pk-settings-msg', data.error || 'Erreur.', false);
  adMessage('pk-settings-msg', data.changed ? 'Réglages enregistrés et journalisés.' : 'Aucun changement.', true);
  admZoneClean(_pkZone);
  renderPickaxe(data);
});

// ── Micro-bonus de dégâts fractionnaires (#81, étape C) ──────────────────────
// Brouillons seulement : le serveur refuse tout autre statut et ne transmet aucun bonus au jeu.
let _mb = null;          // dernier résumé reçu
let _mbEditing = null;   // id du brouillon ouvert (null : nouveau)
const MB_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MB_DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const mbFr = v => Number(v).toLocaleString('fr-BE', { maximumFractionDigits: 2 });

function mbChecks(id, labels) {
  const box = document.getElementById(id);
  box.textContent = '';
  labels.forEach((l, i) => {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = String(i + 1);
    lab.append(cb, ` ${l}`);
    box.appendChild(lab);
  });
}
mbChecks('mb-months', MB_MONTHS);
mbChecks('mb-weekdays', MB_DAYS);
const mbChecked = id => [...document.querySelectorAll(`#${id} input:checked`)].map(cb => Number(cb.value));

function mbCell(tr, text) { const td = document.createElement('td'); td.textContent = text ?? ''; tr.appendChild(td); return td; }

function mbFillTargets() {
  const sel = document.getElementById('mb-target');
  const cur = sel.value;
  sel.textContent = '';
  const add = (value, text, parent = sel) => { const o = document.createElement('option'); o.value = value; o.textContent = text; parent.appendChild(o); };
  add('all', 'Tous les blocs');
  const cats = document.createElement('optgroup'); cats.label = 'Catégorie'; sel.appendChild(cats);
  for (const c of _mb?.categories ?? []) add(`category:${c}`, c, cats);
  const blocks = document.createElement('optgroup'); blocks.label = 'Bloc'; sel.appendChild(blocks);
  for (const b of _mb?.blocks ?? []) add(`block:${b.id}`, `${b.name} (${b.id})`, blocks);
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  // Souvenir lié : liste lisible des objets d'événements (plus d'identifiants internes à saisir)
  const src = document.getElementById('mb-source');
  src.textContent = '';
  add('', 'Aucun', src);
  for (const x of _mb?.souvenirs ?? []) add(`${x.eventId}|${x.itemId}`, x.label, src);
}

function mbRead() {
  const v = id => document.getElementById(id).value.trim();
  const [type, id] = v('mb-target').split(':');
  const schedule = {};
  if (v('mb-from')) schedule.from = v('mb-from');
  if (v('mb-to')) schedule.to = v('mb-to');
  const months = mbChecked('mb-months'), weekdays = mbChecked('mb-weekdays');
  if (months.length) schedule.months = months;
  if (weekdays.length) schedule.weekdays = weekdays;
  const effect = { kind: 'damage_flat', value: Number(v('mb-value').replace(',', '.')), target: id ? { type, id } : { type: 'all' }, schedule };
  const [eventId, itemId] = v('mb-source').split('|');
  if (eventId && itemId) effect.source = { eventId, itemId };
  return { label: v('mb-label'), note: v('mb-note'), effect };
}

function mbWrite(d) {
  const e = d?.effect ?? { value: 0.25, target: { type: 'all' }, schedule: {} };
  const set = (id, val) => { document.getElementById(id).value = val ?? ''; };
  set('mb-label', d?.label); set('mb-note', d?.note); set('mb-value', e.value);
  set('mb-target', e.target?.type && e.target.type !== 'all' ? `${e.target.type}:${e.target.id}` : 'all');
  set('mb-from', e.schedule?.from); set('mb-to', e.schedule?.to);
  const src = document.getElementById('mb-source');
  const sv = e.source ? `${e.source.eventId}|${e.source.itemId}` : '';
  if (sv && ![...src.options].some(o => o.value === sv)) {   // lien vers un souvenir supprimé : conservé, signalé
    const o = document.createElement('option'); o.value = sv; o.textContent = `Introuvable (${e.source.eventId} / ${e.source.itemId})`; src.appendChild(o);
  }
  src.value = sv;
  for (const [box, list] of [['mb-months', e.schedule?.months], ['mb-weekdays', e.schedule?.weekdays]]) {
    document.querySelectorAll(`#${box} input`).forEach(cb => { cb.checked = (list ?? []).includes(Number(cb.value)); });
  }
}

function renderMicroBonus(data) {
  _mb = data;
  document.getElementById('mb-limit-min').textContent = mbFr(data.limits.min);
  document.getElementById('mb-limit-max').textContent = mbFr(data.limits.max);
  document.getElementById('mb-limit-cap').textContent = mbFr(data.limits.stackCap);
  mbFillTargets();
  const body = document.getElementById('mb-list');
  body.textContent = '';
  for (const d of data.drafts) {
    const tr = document.createElement('tr');
    tr.className = 'adm-row-link';
    tr.tabIndex = 0;
    tr.dataset.admKey = `mb-${d.id}`;
    mbCell(tr, `${d.label}${d.archived ? ' (archivé)' : ''}`);
    mbCell(tr, d.text);
    mbCell(tr, d.state ? d.state.would : '—');
    mbCell(tr, '🔒 Brouillon — jamais appliqué');
    mbCell(tr, d.updatedAt);
    const open = () => mbOpen(d, tr);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    body.appendChild(tr);
  }
  if (!data.drafts.length) { const tr = document.createElement('tr'); mbCell(tr, 'Aucun brouillon.').colSpan = 5; body.appendChild(tr); }
  const log = document.getElementById('mb-log');
  log.textContent = '';
  for (const l of data.log) {
    const tr = document.createElement('tr');
    mbCell(tr, l.created_at); mbCell(tr, `#${l.draft_id}`); mbCell(tr, l.action); mbCell(tr, l.effect ?? '');
    log.appendChild(tr);
  }
  const ex = document.getElementById('mb-examples');
  ex.textContent = '';
  for (const x of data.examples) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-outline btn-sm'; b.textContent = x.label.replace(/^Exemple — /, '');
    b.addEventListener('click', () => { mbWrite({ label: x.label, effect: x.effect }); document.getElementById('mb-label').dispatchEvent(new Event('input', { bubbles: true })); mbPreview(); });
    ex.append(b, ' ');
  }
}

async function loadMicroBonus() {
  const { ok, data } = await api('GET', '/api/admin/micro-bonuses');
  if (!ok) { adMessage('mb-msg', data.error || 'Erreur lors du chargement.', false); return; }
  renderMicroBonus(data);
}
admRefreshButton('btn-mb-refresh', loadMicroBonus, 'Micro-bonus');

admDialogSetup('mb-dialog', { keep: 'Enregistrer le brouillon' });

function mbOpen(d, opener) {
  _mbEditing = d?.id ?? null;
  mbWrite(d);
  document.getElementById('mb-title').textContent = d ? `Micro-bonus #${d.id} (brouillon)` : 'Nouveau micro-bonus (brouillon)';
  const arch = document.getElementById('btn-mb-archive');
  arch.classList.toggle('hidden', !d);
  arch.textContent = d?.archived ? 'Désarchiver' : 'Archiver';
  document.getElementById('mb-preview').classList.add('hidden');
  document.getElementById('mb-dlg-msg').className = 'hidden';
  admDialogOpen('mb-dialog', opener, 'mb-label');
}

// Aides ⓘ de la fiche Micro-bonus (recette #81-B) : une seule aide ouverte à la fois
document.getElementById('mb-dialog').addEventListener('click', e => {
  const b = e.target.closest('.bk-info');
  if (!b) return;
  e.preventDefault();
  const h = document.getElementById(b.getAttribute('aria-controls'));
  if (!h) return;
  const show = h.hidden;
  for (const o of document.querySelectorAll('#mb-dialog .bk-hint')) o.hidden = true;
  for (const o of document.querySelectorAll('#mb-dialog .bk-info')) o.setAttribute('aria-expanded', 'false');
  h.hidden = !show;
  b.setAttribute('aria-expanded', String(show));
});

/** « Coups en moins » : vrai zéro, gain minuscule et gain normal se distinguent. */
function mbPct(r) {
  if (r.zero) return '0 % (aucun)';
  if (r.fewerHitsPct < 0.01) return '< 0,01 %';
  return `−${mbFr(r.fewerHitsPct)} %`;
}
document.getElementById('btn-mb-add').addEventListener('click', e => mbOpen(null, e.currentTarget));

async function mbPreview() {
  const { ok, data } = await api('POST', '/api/admin/micro-bonuses/preview', { effect: mbRead().effect, depth: Number(document.getElementById('mb-depth').value), luck: Number(document.getElementById('mb-luck').value) });
  const box = document.getElementById('mb-preview');
  if (!ok) { box.classList.add('hidden'); return adMessage('mb-dlg-msg', data.error || 'Erreur.', false); }
  document.getElementById('mb-dlg-msg').className = 'hidden';
  document.getElementById('mb-prev-fr').textContent = data.text.fr;
  document.getElementById('mb-prev-en').textContent = `EN : ${data.text.en}`;
  document.getElementById('mb-prev-state').textContent = `📅 Calendrier : aujourd'hui, ce bonus ${data.state.code === 'active' ? 'serait actif s\'il était publié.' : `serait inactif s'il était publié (${data.state.text}).`}`;
  const warn = document.getElementById('mb-prev-warn');
  warn.textContent = '';
  for (const w of data.warnings) { const li = document.createElement('li'); li.textContent = `⚠️ ${w}`; warn.appendChild(li); }
  const samples = document.getElementById('mb-prev-samples');
  samples.textContent = '';
  for (const s of data.samples) { const tr = document.createElement('tr'); mbCell(tr, s.label); mbCell(tr, s.text); samples.appendChild(tr); }
  const sm = data.simulation;
  document.getElementById('mb-prev-sim-title').textContent = `Simulation à ${sm.depth} m${sm.luck ? `, Chance niveau ${sm.luck}` : ', sans Chance'} — bonus supposé actif (moyennes exactes)`;
  const sim = document.getElementById('mb-prev-sim');
  sim.textContent = '';
  for (const r of sm.rows) {
    const tr = document.createElement('tr');
    mbCell(tr, mbFr(r.base)); mbCell(tr, mbFr(r.hitsBefore)); mbCell(tr, mbFr(r.hitsAfter));
    mbCell(tr, mbPct(r)).classList.toggle('mb-zero', r.zero);
    mbCell(tr, r.zero ? '0' : `≈ ${r.savedPer100.toLocaleString('fr-BE', { maximumFractionDigits: 1 })}`).classList.toggle('mb-zero', r.zero);
    mbCell(tr, `${mbFr(r.targetShare)} %`);
    sim.appendChild(tr);
  }
  const fill = (id, list) => { const ul = document.getElementById(id); ul.textContent = ''; for (const t of list) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); } };
  fill('mb-prev-explain', data.explain);
  fill('mb-prev-hyp', data.hypotheses);
  document.getElementById('mb-prev-pool-title').textContent = `Blocs possibles à ${sm.depth} m (${sm.blocks.length})`;
  const pool = document.getElementById('mb-prev-pool');
  pool.textContent = '';
  for (const b of sm.blocks) {
    const tr = document.createElement('tr');
    mbCell(tr, b.name);
    mbCell(tr, sm.luck ? `${mbFr(b.chanceLuck)} % (sans Chance : ${mbFr(b.chance)} %)` : `${mbFr(b.chance)} %`);
    mbCell(tr, b.hp.toLocaleString('fr-BE'));
    mbCell(tr, b.targeted ? '✓ oui' : '—');
    pool.appendChild(tr);
  }
  box.classList.remove('hidden');
}
document.getElementById('btn-mb-preview').addEventListener('click', mbPreview);

document.getElementById('btn-mb-save').addEventListener('click', async () => {
  const body = mbRead();
  const { ok, data } = _mbEditing
    ? await api('PUT', `/api/admin/micro-bonuses/${_mbEditing}`, body)
    : await api('POST', '/api/admin/micro-bonuses', body);
  if (!ok) return adMessage('mb-dlg-msg', data.error || 'Erreur.', false);
  document.getElementById('mb-dialog').close();
  renderMicroBonus(data);
  adMessage('mb-msg', `Brouillon « ${data.draft.label} » enregistré (inactif en jeu).`, true);
});

document.getElementById('btn-mb-archive').addEventListener('click', async () => {
  if (!_mbEditing) return;
  const cur = _mb?.drafts.find(d => d.id === _mbEditing);
  const { ok, data } = await api('POST', `/api/admin/micro-bonuses/${_mbEditing}/archive`, { archived: !cur?.archived });
  if (!ok) return adMessage('mb-dlg-msg', data.error || 'Erreur.', false);
  document.getElementById('mb-dialog').close();
  renderMicroBonus(data);
  adMessage('mb-msg', data.draft.archived ? 'Brouillon archivé (conservé).' : 'Brouillon désarchivé.', true);
});
