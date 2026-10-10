/* White Room — shell, auth, dashboard, rankings, profile */
const $ = (s) => document.querySelector(s);
const VIEWS = ['home','lessons','tasks','compete','drill','rankings','profile','staff','staff-review','staff-students','staff-admissions','staff-lessons','staff-daily-quests','staff-compete','staff-question-bank','staff-deposit','staff-records','record','quest','session'];
const TOKEN_KEY = 'wr_token';
const REMEMBER_KEY = 'wr_remember_id';
const RANKS = [
  { id: 'E', min: 100,   title: 'Novice' },
  { id: 'D', min: 500,   title: 'Awakened' },
  { id: 'C', min: 2500,  title: 'Hunter' },
  { id: 'B', min: 5000,  title: 'Elite' },
  { id: 'A', min: 10000, title: 'Master' },
  { id: 'S', min: 20000, title: 'S-Rank' },
];
let me = null;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (id, cls = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'i ' + cls); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + id); s.append(u); return s; };
const hex = (rank, size = '') => { const h = el('span', 'hex ' + size); h.dataset.rank = rank; h.append(el('b', '', rank)); return h; };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const fmt = (n) => Number(n || 0).toLocaleString('en-GB');
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
const token = () => sessionStorage.getItem(TOKEN_KEY) || '';
async function api(url, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (token()) headers['x-wr-token'] = token();
  const r = await fetch(url, { ...opts, headers });
  const j = await r.json().catch(() => ({ ok: false, problem: 'Unreadable server response.' }));
  if (r.status === 401 && !url.startsWith('/api/auth/')) logout(false);
  return j;
}
function note(sel, text, isErr) { const n = $(sel); if (!n) return; n.textContent = text || ''; n.classList.toggle('err', !!isErr); }

/* ---------- auth screens ---------- */
function logout(go = true) {
  const t = token(); if (t && go) fetch('/api/auth/logout', { method: 'POST', headers: { 'x-wr-token': t } }).catch(() => {});
  sessionStorage.removeItem(TOKEN_KEY); me = null;
  $('#appShell').hidden = true; $('#auth').hidden = false; $('#sidebar').classList.remove('open');
  if (go) location.hash = '';
}
function showAuth(kind) {
  const reg = kind === 'register';
  $('#authLogin').hidden = reg; $('#authRegister').hidden = !reg;
  $('#studentLogin').hidden = kind !== 'studentLogin'; $('#staffLogin').hidden = kind !== 'staffLogin';
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.auth === kind));
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); showAuth(b.dataset.auth); }));
document.querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', () => {
  const inp = document.getElementById(b.dataset.eye); const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password'; b.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
  b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}));
try { const saved = localStorage.getItem(REMEMBER_KEY); if (saved) { $('#loginId').value = saved; $('#rememberId').checked = true; } } catch {}

$('#studentLogin').onsubmit = async (e) => {
  e.preventDefault(); note('#loginNote', 'Signing in…');
  const id = $('#loginId').value.trim();
  const j = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ type: 'student', id, password: $('#loginPassword').value }) });
  if (!j.ok) return note('#loginNote', j.problem || 'Login failed.', true);
  try { if ($('#rememberId').checked) localStorage.setItem(REMEMBER_KEY, id); else localStorage.removeItem(REMEMBER_KEY); } catch {}
  $('#loginPassword').value = ''; sessionStorage.setItem(TOKEN_KEY, j.token); note('#loginNote', ''); await boot();
};
$('#register').onsubmit = async (e) => {
  e.preventDefault(); note('#regNote', 'Creating account…');
  const gender = (document.querySelector('input[name="regGender"]:checked') || {}).value || 'Prefer not to say';
  const body = { admissionKey: $('#regKey').value, name: $('#regName').value, className: $('#regClass').value, school: $('#regSchool').value, gender, level: (window.WRRegisterChoice ? window.WRRegisterChoice().level : ''), subjects: (window.WRRegisterChoice ? window.WRRegisterChoice().subjects : []), password: $('#regPassword').value };
  const j = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
  if (!j.ok) return note('#regNote', j.problem || 'Registration failed.', true);
  $('#regPassword').value = ''; sessionStorage.setItem(TOKEN_KEY, j.token); note('#regNote', ''); await boot();
};
$('#staffLogin').onsubmit = async (e) => {
  e.preventDefault(); note('#staffLoginNote', 'Opening staff room…');
  const j = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ type: 'staff', code: $('#staffCode').value }) });
  if (!j.ok) return note('#staffLoginNote', j.problem || 'Staff login failed.', true);
  $('#staffCode').value = ''; sessionStorage.setItem(TOKEN_KEY, j.token); note('#staffLoginNote', ''); await boot();
};
$('#logoutBtn').onclick = () => logout();

/* ---------- routing ---------- */
function setMenu(open) { $('#sidebar').classList.toggle('open', open); $('#menuBtn').setAttribute('aria-expanded', String(open)); }
$('#menuBtn').onclick = () => setMenu(!$('#sidebar').classList.contains('open'));
function route() {
  if (!me) return;
  const raw = (location.hash || '#home').slice(1);
  const [head, arg] = raw.split('/');
  const inSession = head === 'lesson' || head === 'practice';
  const staff = me.role === 'head_staff';
  let page = inSession ? 'session' : VIEWS.includes(head) ? head : (staff ? 'staff' : 'home');
  if (staff && !page.startsWith('staff')) page = 'staff';
  if (!staff && page.startsWith('staff')) page = 'home';
  VIEWS.forEach((v) => $('#' + v)?.classList.toggle('on', v === page));
  document.querySelectorAll('.tabs a').forEach((a) => { if (a.dataset.r === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  setMenu(false); window.scrollTo(0, 0);
  if (inSession && window.openLesson) window.openLesson(arg, head);
  else if (page === 'drill' && window.openDrill) window.openDrill(arg);
  else if (page === 'quest' && window.openQuest) window.openQuest();
  else if (page.startsWith('staff') && window.openStaff) window.openStaff();
  else if (window.refreshLessons && !staff) window.refreshLessons();
  const OPEN = { tasks: 'openDailyQuest', 'staff-daily-quests': 'openDailyPlanner', record: 'openRecord', 'staff-records': 'openStaffRecords', 'staff-deposit': 'openDeposit' };
  if (OPEN[page] && window[OPEN[page]]) window[OPEN[page]]();
  if (page === 'rankings') loadRankings();
  if (page === 'compete') loadLeaderboard();
  if (page === 'profile') { drawProfile(); if (window.drawProfileSubjects) window.drawProfileSubjects(); }
}
window.addEventListener('hashchange', route);

/* ---------- data ---------- */
async function loadMe() { const j = await api('/api/me'); if (!j.ok) return false; me = j.user; return true; }
function rankInfo(xp) {
  const idx = RANKS.reduce((n, r, i) => (xp >= r.min ? i : n), 0);
  const cur = RANKS[idx], next = RANKS[idx + 1] || null;
  const pct = next ? Math.max(0, Math.min(100, ((xp - cur.min) / (next.min - cur.min)) * 100)) : 100;
  return { idx, cur, next, pct };
}
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

function hexRow(box, xp, withXp) {
  box.innerHTML = '';
  const idx = xp == null ? -1 : rankInfo(xp).idx;
  RANKS.forEach((r, i) => {
    const cell = el('div', 'hexcell' + (i === idx ? ' current' : '') + (xp != null && i > idx ? ' locked' : ''));
    cell.append(hex(r.id), el('small', '', withXp ? fmt(r.min) + ' XP' : r.title));
    box.append(cell);
  });
}
const achIcon = (a) => (String(a.id).startsWith('lesson-') ? 'book' : String(a.id).startsWith('quest-') ? 'target' : a.id === 'arrival' ? 'star' : 'crown');
const TILE_COLORS = ['blue', 'violet', 'cyan', 'gold', 'green', 'orange'];

function drawDashboard() {
  if (!me) return;
  const staff = me.role === 'head_staff';
  $('#studentNavGroup').hidden = staff; $('#staffNavGroup').hidden = !staff; $('#staffChip').hidden = !staff;
  if (staff) return;
  const first = me.name.split(' ')[0];
  const { cur, next, pct } = rankInfo(me.xp);
  $('#dashGreeting').textContent = greeting(); $('#dashName').textContent = first;
  $('#dashAvatar').textContent = initials(me.name); $('#chipName').textContent = me.name; $('#dashId').textContent = me.id;
  $('#dashHex').dataset.rank = cur.id; $('#dashRank').textContent = cur.id;
  $('#dashRankLetter').textContent = cur.id; $('#dashRankTitle').textContent = cur.title;
  $('#xpBar').style.width = pct + '%';
  $('#dashXp').textContent = fmt(me.xp);
  $('#xpNext').textContent = next ? '/ ' + fmt(next.min) + ' XP' : 'XP · top rank reached';
  $('#statStreak').textContent = me.stats.streak || 0; $('#statXp').textContent = fmt(me.xp); $('#statAchievements').textContent = (me.achievements || []).length;
  hexRow($('#hexRow'), me.xp, true);
  $('#progNote').textContent = next ? fmt(next.min - me.xp) + ' XP to Rank ' + next.id : 'Highest rank';

  const list = $('#activityList'); list.innerHTML = '';
  const recent = (me.achievements || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
  if (!recent.length) list.append(el('li', 'empty', 'Nothing yet. Finish a lesson to start your story.'));
  recent.forEach((a, i) => {
    const li = el('li', 'act'); const t = el('span', 'tile sm ' + TILE_COLORS[i % TILE_COLORS.length]); t.append(icon(achIcon(a)));
    const d = el('div'); d.append(el('b', '', a.title), el('small', '', a.description)); li.append(t, d, el('time', '', a.at ? timeAgo(a.at) : ''));
    list.append(li);
  });
}

async function loadRankings() {
  const box = $('#rankList'); const j = await api('/api/rankings'); box.innerHTML = '';
  hexRow($('#badgeRow'), null, false);
  if (!j.ok) { box.append(el('p', 'note', j.problem)); return; }
  j.rankings.forEach((r) => {
    const row = el('div', 'rank-row' + (r.me ? ' me' : ''));
    const nm = el('span', 'rank-name', r.name); if (r.me) nm.append(el('small', '', 'You'));
    row.append(el('span', 'rank-pos', '#' + r.position), hex(r.rank, 'sm'), nm, el('span', 'rank-xp', fmt(r.xp) + ' XP')); box.append(row);
  });
  if (!j.rankings.length) box.append(el('p', 'muted', 'No ranked students yet.'));
}
async function loadLeaderboard() {
  const body = $('#leaderBody'); const j = await api('/api/rankings'); body.innerHTML = '';
  if (!j.ok) { body.innerHTML = '<tr><td colspan="4" class="muted">Could not load standings.</td></tr>'; return; }
  j.rankings.slice(0, 5).forEach((r) => {
    const tr = el('tr', r.me ? 'me' : ''); const rk = el('td'); rk.append(hex(r.rank, 'sm'));
    tr.append(el('td', '', String(r.position)), el('td', '', r.name + (r.me ? ' (you)' : '')), rk, el('td', 'r', fmt(r.xp))); body.append(tr);
  });
  if (!j.rankings.length) body.innerHTML = '<tr><td colspan="4" class="muted">No ranked students yet.</td></tr>';
}
function drawProfile() {
  if (!me || me.role !== 'student') return;
  const { cur, next, pct } = rankInfo(me.xp);
  $('#pAvatar').textContent = initials(me.name); $('#pName').textContent = me.name; $('#pId').textContent = me.id; $('#pXp').textContent = fmt(me.xp);
  $('#pHex').dataset.rank = cur.id; $('#pHex').firstChild.textContent = cur.id;
  $('#pBar').style.width = pct + '%'; $('#pLevel').textContent = 'Rank ' + cur.id + ' · ' + cur.title; $('#pNext').textContent = next ? fmt(me.xp) + ' / ' + fmt(next.min) + ' XP' : 'Top rank';
  const f = $('#profileCard'); f.innerHTML = '';
  [['Class', me.className], ['School', me.school], ['Gender', me.gender], ['Level', me.level], ['Subjects', (me.subjects || []).map((x) => x.replace(/-/g, ' ')).join(', ')]].forEach(([a, b]) => { const d = el('div'); d.append(el('dt', '', a), el('dd', '', b || '—')); f.append(d); });
  const a = $('#achievementList'); a.innerHTML = '';
  (me.achievements || []).forEach((x, i) => { const c = el('div', 'ach'); const t = el('span', 'tile ' + TILE_COLORS[i % TILE_COLORS.length]); t.append(icon(achIcon(x))); c.append(t, el('b', '', x.title), el('small', '', x.description)); a.append(c); });
  const s = me.stats || {}; const g = $('#profileStats'); g.innerHTML = '';
  [[s.lessons || 0, 'Lessons completed'], [s.quests || 0, 'Quests done'], [s.maxMarks ? Math.round((s.marks / s.maxMarks) * 100) + '%' : '—', 'Average mark'], [fmt(me.xp), 'Total XP']].forEach(([v, l]) => { const d = el('div'); d.append(el('b', '', String(v)), el('small', '', l)); g.append(d); });
}
async function loadPosts() {
  try {
    const posts = await (await fetch('content/posts.json')).json();
    posts.sort((a, b) => b.date.localeCompare(a.date));
    ['#posts', '#staffPosts'].forEach((sel) => {
      const box = $(sel); if (!box) return; box.innerHTML = '';
      posts.slice(0, 4).forEach((p) => {
        const row = el('article', 'post');
        const tag = el('span', 'tag ' + String(p.tag).toLowerCase(), p.tag);
        const h = el('h3'); h.append(tag, document.createTextNode(p.title));
        row.append(el('time', '', new Date(p.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })), h, el('p', '', p.body)); box.append(row);
      });
    });
  } catch { /* news is optional */ }
}

async function refreshMe() { if (await loadMe()) { drawDashboard(); if ($('#profile').classList.contains('on')) drawProfile(); } }
async function boot() {
  if (!token() || !(await loadMe())) { logout(false); return; }
  $('#auth').hidden = true; $('#appShell').hidden = false;
  drawDashboard(); loadPosts();
  if (me.role === 'head_staff') { if (!location.hash.startsWith('#staff')) location.hash = '#staff'; }
  else if (!location.hash) location.hash = '#home';
  route();
}
window.refreshAccount = refreshMe;
window.__wrMe = () => me;
window.wr = { api, el, icon, hex, fmt, timeAgo, initials, TILE_COLORS };
showAuth('studentLogin');
boot();
