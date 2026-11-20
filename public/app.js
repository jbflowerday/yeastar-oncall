'use strict';

/* =========================================================== helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
};
const icon = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'oncall' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/login') {
    state.user = null;
    renderLogin();
    throw new Error('Session expired – please sign in again');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

/* ---------- time formatting (always in the viewer's local time zone) ---------- */
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDateTime = (ms) => `${fmtDate(ms)}, ${fmtTime(ms)}`;
const dayKey = (ms) => new Date(ms).toDateString();
function dayLabel(ms) {
  const d = new Date(ms); const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}
function toLocalInput(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const relative = (ms) => {
  const diff = Math.round((ms - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat([], { numeric: 'auto' });
  if (Math.abs(diff) < 60) return rtf.format(diff, 'minute');
  if (Math.abs(diff) < 1440) return rtf.format(Math.round(diff / 60), 'hour');
  return rtf.format(Math.round(diff / 1440), 'day');
};

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const avClass = (id) => `av${(Number(id) || 0) % 6}`;
const prettyNum = (n) => esc(n || '');

/* =========================================================== state */

const state = { user: null, users: [], status: null, sched: null };
let refreshTimer, tickTimer;

/* =========================================================== login */

function renderLogin() {
  clearInterval(refreshTimer); clearInterval(tickTimer);
  const app = $('#app');
  app.className = '';
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand"><img src="/icon.svg" alt=""> On-Call Scheduler</div>
        <div class="card">
          <h2>Sign in</h2>
          <p class="muted small">Manage who receives after-hours calls.</p>
          <form id="login-form" autocomplete="on">
            <div class="form-error hidden" id="login-error"></div>
            <label class="field"><span>Username</span>
              <input class="input" name="username" autocomplete="username" autocapitalize="none" required autofocus></label>
            <label class="field"><span>Password</span>
              <input class="input" type="password" name="password" autocomplete="current-password" required></label>
            <button class="btn block" type="submit">Sign in</button>
          </form>
        </div>
      </div>
    </div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      const { user } = await api('POST', '/login', { username: f.get('username'), password: f.get('password') });
      state.user = user;
      if (!location.hash || location.hash === '#/') location.hash = '#/schedule';
      renderShell();
    } catch (err) {
      const el = $('#login-error');
      el.textContent = err.message; el.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

/* =========================================================== shell */

const NAV = [
  { id: 'schedule', label: 'Schedule', icon: 'calendar' },
  { id: 'users', label: 'Team', icon: 'users', admin: true },
  { id: 'settings', label: 'PBX', icon: 'settings', admin: true },
  { id: 'profile', label: 'Profile', icon: 'user' },
];

const currentRoute = () => {
  const r = (location.hash.replace(/^#\/?/, '') || 'schedule').split('/')[0];
  const item = NAV.find((n) => n.id === r);
  if (!item || (item.admin && !state.user.is_admin)) return 'schedule';
  return r;
};

function renderShell() {
  const nav = NAV.filter((n) => !n.admin || state.user.is_admin);
  const links = (cls) => nav.map((n) => `<a href="#/${n.id}" data-nav="${n.id}" class="${cls}">${icon(n.icon)}<span>${n.label}</span></a>`).join('');
  const app = $('#app');
  app.className = '';
  app.innerHTML = `
    <header class="topbar"><div class="topbar-inner">
      <a class="brand" href="#/schedule"><img src="/icon.svg" alt=""><span>On-Call</span></a>
      <nav class="topnav">${links('')}</nav>
    </div></header>
    <main id="view"></main>
    <nav class="bottomnav">${links('')}</nav>`;
  route();
}

function route() {
  if (!state.user) return;
  const r = currentRoute();
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r));
  clearInterval(refreshTimer); clearInterval(tickTimer);
  $('#view').onclick = null;
  window.scrollTo(0, 0);
  ({ schedule: viewSchedule, users: viewUsers, settings: viewSettings, profile: viewProfile })[r]();
}
window.addEventListener('hashchange', route);

/* =========================================================== schedule */

async function loadSchedule() {
  const [status, sched, users] = await Promise.all([api('GET', '/status'), api('GET', '/changeovers'), api('GET', '/users')]);
  state.status = status; state.sched = sched; state.users = users.users;
}

function syncPill(s) {
  if (!s.configured && !s.dry_run) return '<span class="pill danger"><span class="dot"></span>PBX not configured</span>';
  if (!s.route_id) return '<span class="pill warn"><span class="dot"></span>No route selected</span>';
  if (s.last_error) return `<span class="pill danger" title="${esc(s.last_error.message)}"><span class="dot"></span>Sync error</span>`;
  const want = s.active && s.active.target === 'mobile' ? { target: 'mobile', mobile: s.active.mobile } : { target: 'default', mobile: '' };
  const a = s.applied;
  const live = a && a.target === want.target && (a.mobile || '') === want.mobile;
  if (!live) return '<span class="pill warn"><span class="dot"></span>Syncing…</span>';
  if (s.dry_run) return '<span class="pill accent"><span class="dot"></span>Dry run</span>';
  return '<span class="pill ok"><span class="dot"></span>Live on PBX</span>';
}

function heroCard(s) {
  const a = s.active;
  const pill = syncPill(s).replace(/pill (ok|warn|danger|accent)/, 'pill');
  if (!a || a.target === 'default') {
    return `
      <section class="card hero normal">
        <div class="label">Right now</div>
        <div class="who">Normal routing</div>
        <div class="num">Calls follow the PBX's usual destination</div>
        <div class="meta">${pill}${a ? `<span>Since ${esc(fmtDateTime(a.start_at))}</span>` : ''}</div>
      </section>`;
  }
  return `
    <section class="card hero">
      <div class="label">On call now</div>
      <div class="who">${esc(a.user_name || 'On-call')}</div>
      <a class="num" href="tel:${esc(a.mobile)}">${icon('phone')} ${prettyNum(a.mobile)}</a>
      <div class="meta">${pill}<span>Since ${esc(fmtDateTime(a.start_at))}</span></div>
    </section>`;
}

function itemRow(c, { past = false } = {}) {
  const me = state.user;
  const editable = me.is_admin || ((c.created_by === me.id || c.user_id === me.id) && !past && c.start_at > Date.now());
  const isDefault = c.target === 'default';
  const title = isDefault ? 'Normal routing' : esc(c.user_name || 'External number');
  const sub = (c.series_id ? `${icon('repeat')} ` : '')
    + [isDefault ? 'Stop forwarding' : prettyNum(c.mobile), c.note ? esc(c.note) : ''].filter(Boolean).join(' · ');
  return `<li class="item ${isDefault ? 'default' : ''} ${past ? 'past' : ''}">
    <div class="time">${esc(fmtTime(c.start_at))}</div>
    <div class="body"><div class="title">${title}</div><div class="sub">${sub}</div></div>
    ${editable ? `<div class="actions">
      <button class="btn ghost icon-btn" data-edit="${c.id}" aria-label="Edit">${icon('edit')}</button>
      <button class="btn ghost icon-btn" data-del="${c.id}" aria-label="Delete">${icon('trash')}</button>
    </div>` : ''}
  </li>`;
}

function groupedList(items, opts) {
  let html = ''; let last = null;
  for (const c of items) {
    const k = dayKey(c.start_at);
    if (k !== last) {
      if (last !== null) html += '</ul>';
      html += `<div class="day-label">${esc(dayLabel(c.start_at))}</div><ul class="list">`;
      last = k;
    }
    html += itemRow(c, opts);
  }
  return html ? `${html}</ul>` : '';
}

async function viewSchedule() {
  const view = $('#view');
  if (!state.sched) view.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
  try { await loadSchedule(); } catch (err) { toast(err.message, true); return; }
  if (currentRoute() !== 'schedule') return;

  const s = state.status; const { upcoming, past } = state.sched;
  view.innerHTML = `
    <div class="page-head">
      <h1>Schedule</h1>
      <button class="btn desktop-only" id="add-btn">${icon('plus')} Add changeover</button>
    </div>
    ${heroCard(s)}
    ${quickCard(s)}
    ${s.last_error ? `<div class="card"><div class="form-error">PBX sync problem: ${esc(s.last_error.message)}</div>
      <div class="muted small">Retrying automatically. ${state.user.is_admin ? 'Check the PBX tab for details.' : 'Let an administrator know if this persists.'}</div></div>` : ''}
    <section class="card">
      <div class="card-head"><h2>Upcoming changeovers</h2><span class="muted small desktop-only">Times in your local time zone</span></div>
      ${upcoming.length ? groupedList(upcoming) : `<div class="empty">${icon('calendar')}<div>No upcoming changeovers.</div>
        <div class="small">Add one to hand over on-call at a set date and time.</div></div>`}
      ${past.length ? `<details class="history"><summary>Show recent history (${past.length})</summary>${groupedList(past, { past: true })}</details>` : ''}
    </section>
    <button class="btn fab mobile-only" id="fab" aria-label="Add changeover">${icon('plus')}</button>`;

  $('#add-btn')?.addEventListener('click', () => openChangeoverDialog());
  $('#fab')?.addEventListener('click', () => openChangeoverDialog());
  view.onclick = onScheduleClick;

  const sel = $('#quick-sel');
  sel.addEventListener('change', () => { state.quickSel = sel.value; $('#quick-go').disabled = !sel.value; });
  $('#quick-go').addEventListener('click', () => quickSwitch(sel.value));

  // Refresh shortly after the next scheduled changeover, and every 30s otherwise.
  const nextAt = s.next?.start_at;
  tickTimer = setInterval(() => {
    if (nextAt && nextAt <= Date.now() - 2500 && !$('dialog[open]')) viewSchedule();
  }, 1000);
  refreshTimer = setInterval(() => {
    if (!$('dialog[open]') && document.activeElement !== $('#quick-sel')) viewSchedule();
  }, 30000);
}

// People who can be put on call: everyone for admins, just yourself otherwise – never the built-in admin login.
function oncallCandidates() {
  const me = state.user;
  return (me.is_admin ? state.users : state.users.filter((u) => u.id === me.id)).filter((u) => !u.is_system);
}

function quickCard(s) {
  const me = state.user;
  const users = oncallCandidates();
  const a = s.active;
  const activeKey = !a || a.target === 'default' ? 'default' : String(a.user_id || '');
  const opt = (value, label, disabled = false) => `<option value="${esc(value)}" ${disabled ? 'disabled' : ''}
    ${state.quickSel === value ? 'selected' : ''}>${esc(label)}</option>`;
  const options = users.map((u) => {
    const name = u.display_name || u.username;
    if (!u.mobile) return opt(String(u.id), `${name} – no mobile set`, true);
    return opt(String(u.id), `${name} · ${u.mobile}${activeKey === String(u.id) ? '  (on call now)' : ''}`);
  }).join('');
  const until = s.next ? `until the next scheduled changeover (${fmtDateTime(s.next.start_at)})` : 'until the next scheduled changeover';
  return `
    <section class="card">
      <div class="card-head"><h2>Switch on-call now</h2></div>
      <div class="quick-row">
        <select class="input" id="quick-sel" aria-label="Who should be on call">
          ${opt('', 'Choose who takes calls…', true).replace('<option', `<option ${state.quickSel ? '' : 'selected'}`)}
          ${options}
        </select>
        <button class="btn" id="quick-go" ${state.quickSel ? '' : 'disabled'}>${icon('phone')} Switch now</button>
      </div>
      <p class="muted small">Takes effect immediately and stays ${esc(until)}.</p>
    </section>`;
}

async function quickSwitch(value) {
  if (!value) return;
  const u = state.users.find((x) => String(x.id) === value);
  if (!u || !confirm(`Forward calls to ${u.display_name || u.username} (${u.mobile}) now?`)) return;
  const btn = $('#quick-go');
  if (btn) btn.disabled = true;
  try {
    await api('POST', '/changeovers', { start_at: 'now', user_id: u.id, mobile: u.mobile, note: 'Manual switch' });
    state.quickSel = '';
    toast(`${u.display_name || u.username} is now on call`);
    viewSchedule();
  } catch (err) {
    toast(err.message, true);
    if (btn) btn.disabled = false;
  }
}

async function onScheduleClick(e) {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  const all = [...state.sched.upcoming, ...state.sched.past, state.sched.active].filter(Boolean);
  if (edit) openChangeoverDialog(all.find((c) => c.id === Number(edit.dataset.edit)));
  if (del) {
    const c = all.find((x) => x.id === Number(del.dataset.del));
    if (!c) return;
    const later = c.series_id ? state.sched.upcoming.filter((x) => x.series_id === c.series_id && x.start_at > c.start_at).length : 0;
    if (later) confirmSeriesDelete(c, later);
    else if (confirm(`Delete the changeover on ${fmtDateTime(c.start_at)}?`)) deleteChangeover(c, 'one');
  }
}

async function deleteChangeover(c, scope) {
  try {
    const r = await api('DELETE', `/changeovers/${c.id}${scope === 'following' ? '?scope=following' : ''}`);
    toast(r.deleted > 1 ? `${r.deleted} changeovers deleted` : 'Changeover deleted');
    viewSchedule();
  } catch (err) { toast(err.message, true); }
}

const REPEAT_LABELS = { weekly: 'weekly', fortnightly: 'fortnightly', monthly: 'monthly' };

function confirmSeriesDelete(c, later) {
  const dlg = dialog('Delete repeating changeover', `
    <form method="dialog">
      <p>This changeover on <b>${esc(fmtDateTime(c.start_at))}</b> repeats ${esc(REPEAT_LABELS[c.repeat_rule] || 'weekly')}.
        ${later} later ${later === 1 ? 'occurrence is' : 'occurrences are'} scheduled.</p>
      <div class="form-actions wrap">
        <button type="button" class="btn secondary" data-close>Cancel</button>
        <button type="button" class="btn secondary" data-scope="one">This one only</button>
        <button type="button" class="btn danger" data-scope="following">This &amp; following (${later + 1})</button>
      </div>
    </form>`);
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope]');
    if (!b) return;
    dlg.close();
    deleteChangeover(c, b.dataset.scope);
  });
}

/**
 * Start times of the later occurrences of a repeat, computed in local time so
 * daylight saving keeps the same clock time. Monthly repeats keep the day of the
 * month, falling back to the month's last day (e.g. the 31st -> 30 Apr).
 */
function repeatStarts(firstMs, rule, count) {
  const out = [];
  const first = new Date(firstMs);
  for (let i = 1; i < count; i++) {
    const d = new Date(firstMs);
    if (rule === 'monthly') {
      d.setDate(1);
      d.setMonth(first.getMonth() + i);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(first.getDate(), lastDay));
    } else {
      d.setDate(d.getDate() + (rule === 'fortnightly' ? 14 : 7) * i);
    }
    out.push(d.getTime());
  }
  return out;
}

const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

function repeatSummary(firstMs, rule, count) {
  const first = new Date(firstMs);
  const last = repeatStarts(firstMs, rule, count).pop();
  const day = first.toLocaleDateString([], { weekday: 'long' });
  const when = rule === 'monthly' ? `Monthly on the ${ordinal(first.getDate())}${first.getDate() > 28 ? ' (or the last day of shorter months)' : ''}`
    : rule === 'fortnightly' ? `Every second ${day}` : `Every ${day}`;
  return `${when} at ${fmtTime(firstMs)}, ${count} times – last on ${fmtDate(last)}.`;
}

function dialog(title, bodyHtml) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2>
    <button class="btn ghost icon-btn" data-close aria-label="Close">${icon('x')}</button></div>${bodyHtml}`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  dlg.showModal();
  return dlg;
}

function openChangeoverDialog(existing) {
  const me = state.user;
  const users = oncallCandidates();
  const defStart = existing ? existing.start_at : (() => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d.getTime(); })();
  const wanted = existing?.user_id || me.id;
  const selUser = users.some((u) => u.id === wanted) ? wanted : users[0]?.id;

  // Editing an occurrence of a series: offer "this one" or "this & following".
  const inSeries = !!existing?.series_id;
  const seriesLeft = inSeries
    ? state.sched.upcoming.filter((x) => x.series_id === existing.series_id && x.start_at >= existing.start_at).length || 1
    : 0;
  const initialRule = inSeries ? (existing.repeat_rule || 'weekly') : '';
  const initialCount = inSeries ? Math.max(2, seriesLeft) : 4;
  const ruleOpt = (v, label) => `<option value="${v}" ${initialRule === v ? 'selected' : ''}>${label}</option>`;

  const dlg = dialog(existing ? 'Edit changeover' : 'New changeover', `
    <form>
      <div class="form-error hidden"></div>
      ${inSeries ? `
      <div class="field"><span class="muted small">${icon('repeat')} Repeats ${esc(REPEAT_LABELS[initialRule])} – apply changes to</span></div>
      <div class="seg">
        <label><input type="radio" name="scope" value="one" checked>This one</label>
        <label><input type="radio" name="scope" value="following">This &amp; following (${seriesLeft})</label>
      </div>` : ''}
      <label class="field"><span>Who is on call</span>
        <select class="input" name="user_id" ${users.length < 2 ? 'disabled' : ''}>
          ${users.map((u) => `<option value="${u.id}" data-mobile="${esc(u.mobile)}" ${u.id === selUser ? 'selected' : ''}>${esc(u.display_name || u.username)}</option>`).join('')
            || '<option value="">No team members yet – add them on the Team tab</option>'}
        </select></label>
      <label class="field"><span>Mobile number to forward to</span>
        <input class="input" name="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="e.g. 0412 345 678"
          value="${esc(existing?.mobile || '')}"></label>
      ${existing ? '' : '<label class="check"><input type="checkbox" name="now"> Start immediately</label>'}
      <label class="field start-field"><span>Changeover date &amp; time</span>
        <input class="input" type="datetime-local" name="start_at" value="${toLocalInput(defStart)}" required></label>
      <div class="repeat-block">
        <label class="field"><span>Repeat</span>
          <select class="input" name="repeat">
            ${ruleOpt('', 'Does not repeat')}${ruleOpt('weekly', 'Weekly')}${ruleOpt('fortnightly', 'Fortnightly')}${ruleOpt('monthly', 'Monthly')}
          </select></label>
        <div class="repeat-fields hidden">
          <label class="field"><span>Number of times (including the first)</span>
            <input class="input" type="number" name="count" min="2" max="52" value="${initialCount}" inputmode="numeric"></label>
        </div>
        <p class="muted small repeat-summary"></p>
      </div>
      <label class="field"><span>Note (optional)</span>
        <input class="input" name="note" maxlength="200" placeholder="e.g. Weekend cover" value="${esc(existing?.note || '')}"></label>
      <p class="muted small">Stays in effect until the next changeover.</p>
      <div class="form-actions">
        <button type="button" class="btn secondary" data-close>Cancel</button>
        <button type="submit" class="btn">${existing ? 'Save' : 'Schedule'}</button>
      </div>
    </form>`);

  const form = $('form', dlg);
  const f = form.elements;
  const userSel = f.user_id;
  const mobileIn = f.mobile;
  const fillMobile = () => { mobileIn.value = userSel.selectedOptions[0]?.dataset.mobile || ''; };
  if (!existing) fillMobile();
  userSel.addEventListener('change', fillMobile);

  const scope = () => (inSeries ? f.scope.value : 'one');
  const count = () => Math.min(52, Math.max(2, Number(f.count.value) || 2));
  const firstStart = () => (f.now?.checked ? Date.now() : Date.parse(f.start_at.value));

  const sync = () => {
    const now = f.now?.checked;
    $('.start-field', form).classList.toggle('hidden', !!now);
    f.start_at.required = !now;
    // A single-occurrence edit of a series can't change the repeat.
    const showRepeat = !inSeries || scope() === 'following';
    $('.repeat-block', form).classList.toggle('hidden', !showRepeat);
    const rule = f.repeat.value;
    $('.repeat-fields', form).classList.toggle('hidden', !rule);
    const first = firstStart();
    let summary = '';
    if (showRepeat && rule && Number.isFinite(first)) summary = repeatSummary(first, rule, count());
    else if (showRepeat && inSeries && !rule) summary = 'The later occurrences of this series will be removed.';
    $('.repeat-summary', form).textContent = summary;
  };
  form.addEventListener('change', sync);
  form.addEventListener('input', sync);
  sync();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form); btn.disabled = true;
    const now = f.now?.checked;
    const body = {
      user_id: Number(userSel.value),
      mobile: mobileIn.value,
      note: f.note.value,
      start_at: now ? 'now' : new Date(f.start_at.value).toISOString(),
      scope: scope(),
    };
    const rule = f.repeat.value;
    if (rule && (!inSeries || scope() === 'following')) {
      // Leave a little slack after "now" so the server sees the repeats as later than the first.
      const first = now ? Date.now() + 60_000 : Date.parse(f.start_at.value);
      body.repeat_rule = rule;
      body.repeat_starts = repeatStarts(first, rule, count()).map((t) => new Date(t).toISOString());
    }
    try {
      const r = await api(existing ? 'PUT' : 'POST', existing ? `/changeovers/${existing.id}` : '/changeovers', body);
      dlg.close();
      toast(existing
        ? (r.count > 1 ? `Updated – ${r.count} changeovers in the series` : 'Changeover updated')
        : (r.count > 1 ? `${r.count} changeovers scheduled` : 'Changeover scheduled'));
      viewSchedule();
    } catch (err) {
      const el = $('.form-error', form); el.textContent = err.message; el.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

/* =========================================================== team (admin) */

async function viewUsers() {
  const view = $('#view');
  let users;
  try { users = (await api('GET', '/users')).users; } catch (err) { toast(err.message, true); return; }
  state.users = users;
  view.innerHTML = `
    <div class="page-head"><h1>Team</h1>
      <button class="btn" id="add-user">${icon('plus')} <span>Add user</span></button></div>
    <section class="card"><ul class="list">
      ${users.map((u) => `<li class="item">
        <div class="avatar ${avClass(u.id)}">${esc(initials(u.display_name || u.username))}</div>
        <div class="body"><div class="title">${esc(u.display_name || u.username)} ${u.is_admin ? '<span class="pill accent">Admin</span>' : ''}</div>
          <div class="sub">@${esc(u.username)}${u.mobile ? ` · ${prettyNum(u.mobile)}` : ' · no mobile set'}</div></div>
        <div class="actions">
          <button class="btn ghost icon-btn" data-edit-user="${u.id}" aria-label="Edit">${icon('edit')}</button>
          ${u.id !== state.user.id ? `<button class="btn ghost icon-btn" data-del-user="${u.id}" aria-label="Delete">${icon('trash')}</button>` : ''}
        </div></li>`).join('')}
    </ul></section>`;
  $('#add-user').addEventListener('click', () => openUserDialog());
  view.onclick = async (e) => {
    const ed = e.target.closest('[data-edit-user]');
    const del = e.target.closest('[data-del-user]');
    if (ed) openUserDialog(users.find((u) => u.id === Number(ed.dataset.editUser)));
    if (del) {
      const u = users.find((x) => x.id === Number(del.dataset.delUser));
      if (!confirm(`Delete user ${u.display_name || u.username}? Their scheduled changeovers stay in place.`)) return;
      try { await api('DELETE', `/users/${u.id}`); toast('User deleted'); viewUsers(); } catch (err) { toast(err.message, true); }
    }
  };
}

function openUserDialog(u) {
  const dlg = dialog(u ? 'Edit user' : 'Add user', `
    <form autocomplete="off">
      <div class="form-error hidden"></div>
      <label class="field"><span>Username</span>
        <input class="input" name="username" value="${esc(u?.username || '')}" ${u ? 'disabled' : 'required'} autocapitalize="none"></label>
      <label class="field"><span>Display name</span><input class="input" name="display_name" value="${esc(u?.display_name || '')}"></label>
      <label class="field"><span>Mobile number</span>
        <input class="input" name="mobile" type="tel" inputmode="tel" value="${esc(u?.mobile || '')}" placeholder="Used as the default forward number"></label>
      <label class="field"><span>${u ? 'New password (leave blank to keep)' : 'Password'}</span>
        <input class="input" name="password" type="password" autocomplete="new-password" minlength="8" ${u ? '' : 'required'}></label>
      <label class="check"><input type="checkbox" name="is_admin" ${u?.is_admin ? 'checked' : ''}> Administrator</label>
      <div class="form-actions">
        <button type="button" class="btn secondary" data-close>Cancel</button>
        <button type="submit" class="btn">${u ? 'Save' : 'Create'}</button>
      </div>
    </form>`);
  const form = $('form', dlg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const body = { display_name: f.display_name.value, mobile: f.mobile.value, is_admin: f.is_admin.checked };
    if (f.password.value) body.password = f.password.value;
    if (!u) body.username = f.username.value;
    try {
      await api(u ? 'PUT' : 'POST', u ? `/users/${u.id}` : '/users', body);
      dlg.close(); toast(u ? 'User updated' : 'User created'); viewUsers();
    } catch (err) {
      const el = $('.form-error', form); el.textContent = err.message; el.classList.remove('hidden');
    }
  });
}

/* =========================================================== PBX settings (admin) */

async function viewSettings() {
  const view = $('#view');
  let s, st, log;
  try {
    [s, st, log] = await Promise.all([api('GET', '/settings'), api('GET', '/status'), api('GET', '/audit')]);
  } catch (err) { toast(err.message, true); return; }
  const a = st.applied;

  view.innerHTML = `
    <div class="page-head"><h1>PBX</h1>${syncPill(st)}</div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Inbound route</h2></div>
        <p class="muted small">The route whose destination is switched to the on-call mobile.</p>
        <div class="row">
          <select class="input" id="route-sel"><option value="${esc(s.route_id)}">${s.route_id ? `Route #${esc(s.route_id)}${st.route_name ? ` – ${esc(st.route_name)}` : ''}` : '— none selected —'}</option></select>
        </div>
        <div class="form-actions">
          <button class="btn secondary" id="load-routes">${icon('refresh')} Load from PBX</button>
          <button class="btn" id="save-route">Save</button>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Sync</h2></div>
        <dl class="kv">
          <dt>Current</dt><dd>${a ? (a.target === 'mobile' ? `Forwarding to <b>${prettyNum(a.mobile)}</b>` : 'Normal routing') : '—'}</dd>
          <dt>Pushed</dt><dd>${a?.at ? esc(relative(a.at)) : '—'}</dd>
          <dt>Last check</dt><dd>${st.last_check ? esc(relative(st.last_check)) : '—'}</dd>
          ${st.last_error ? `<dt>Error</dt><dd class="small">${esc(st.last_error.message)}</dd>` : ''}
        </dl>
        <div class="form-actions"><button class="btn" id="apply-now">${icon('refresh')} Apply now</button></div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h2>Connection</h2></div>
      <dl class="kv">
        <dt>PBX</dt><dd class="mono">${esc(s.base_url || 'not set')}</dd>
        <dt>Mode</dt><dd>${s.dry_run ? '<span class="pill accent">Dry run – nothing sent</span>' : s.configured ? '<span class="pill ok">Live</span>' : '<span class="pill danger">Missing credentials</span>'}</dd>
        <dt>Check every</dt><dd>${s.check_interval_seconds}s</dd>
        <dt>Forward as</dt><dd class="mono">${esc(s.mapping.dest_field)}=${esc(s.mapping.external_dest_type)}, ${esc(s.mapping.dest_value_field)}=${esc(s.mapping.number_prefix)}&lt;mobile&gt;</dd>
      </dl>
      <p class="muted small">Credentials and field mapping are set in the server's <span class="mono">.env</span> file.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Activity</h2></div>
      <ul class="list log">${log.entries.map((l) => `<li><time>${esc(fmtDateTime(l.at))}</time>
        <div><b>${esc(l.action)}</b> <span class="muted">${esc(l.user_name || 'system')}</span>
        <div class="detail">${esc(l.detail.length > 240 ? `${l.detail.slice(0, 240)}…` : l.detail)}</div></div></li>`).join('') || '<li class="muted">No activity yet</li>'}</ul>
    </section>`;

  $('#load-routes').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const { routes } = await api('GET', '/yeastar/routes');
      $('#route-sel').innerHTML = '<option value="">— none —</option>' + routes.map((r) =>
        `<option value="${esc(r.id)}" ${r.id === s.route_id ? 'selected' : ''}>#${esc(r.id)} – ${esc(r.name)}${r.did ? ` (${esc(r.did)})` : ''}</option>`).join('');
      toast(`Loaded ${routes.length} route(s)`);
    } catch (err) { toast(err.message, true); }
    e.currentTarget.disabled = false;
  });
  $('#save-route').addEventListener('click', async () => {
    const id = $('#route-sel').value;
    if (id !== s.route_id && s.route_id && !confirm('Switch route? If the current route is being forwarded it will be restored first.')) return;
    try { await api('PUT', '/settings/route', { route_id: id }); toast('Route saved'); viewSettings(); } catch (err) { toast(err.message, true); }
  });
  $('#apply-now').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await api('POST', '/apply'); toast('Pushed to PBX'); } catch (err) { toast(err.message, true); }
    viewSettings();
  });
}

/* =========================================================== profile */

function viewProfile() {
  const u = state.user;
  $('#view').innerHTML = `
    <div class="page-head"><h1>Profile</h1></div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Your details</h2></div>
        <form id="profile-form">
          <label class="field"><span>Display name</span><input class="input" name="display_name" value="${esc(u.display_name)}"></label>
          <label class="field"><span>Mobile number</span>
            <input class="input" name="mobile" type="tel" inputmode="tel" value="${esc(u.mobile)}" placeholder="Default number when you're on call"></label>
          <div class="form-actions"><button class="btn" type="submit">Save</button></div>
        </form>
      </section>
      <section class="card">
        <div class="card-head"><h2>Change password</h2></div>
        <form id="pw-form">
          <input type="text" name="username" autocomplete="username" value="${esc(u.username)}" class="hidden" readonly>
          <label class="field"><span>Current password</span><input class="input" type="password" name="current_password" autocomplete="current-password" required></label>
          <label class="field"><span>New password</span><input class="input" type="password" name="new_password" autocomplete="new-password" minlength="8" required></label>
          <div class="form-actions"><button class="btn" type="submit">Update password</button></div>
        </form>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><div><h2>${esc(u.display_name || u.username)}</h2><div class="muted small">Signed in as @${esc(u.username)}${u.is_admin ? ' · Administrator' : ''}</div></div>
      <button class="btn secondary" id="logout">${icon('logout')} Sign out</button></div>
    </section>`;

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      state.user = (await api('PUT', '/me', { display_name: f.display_name.value, mobile: f.mobile.value })).user;
      toast('Profile saved');
    } catch (err) { toast(err.message, true); }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api('PUT', '/me', { current_password: f.current_password.value, new_password: f.new_password.value });
      e.target.reset(); toast('Password updated');
    } catch (err) { toast(err.message, true); }
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('POST', '/logout'); } catch { /* ignore */ }
    state.user = null; state.sched = null; location.hash = '';
    renderLogin();
  });
}

/* =========================================================== boot */

(async function boot() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.ok) {
      state.user = (await res.json()).user;
      renderShell();
      return;
    }
  } catch { /* fall through */ }
  renderLogin();
}());
