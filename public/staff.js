/* White Room — Head Staff screens */
(() => {
  const $ = (s) => document.querySelector(s);
  const { api, el, icon, hex, fmt, timeAgo, initials } = window.wr;
  const RANK_COLORS = { S: '#37d0ff', A: '#7c5cff', B: '#f5b335', C: '#ff8a3d', D: '#2f6bff', E: '#8a98bd' };
  let students = [];
  let submissions = [];
  let selected = null;
  let tab = 'pending';

  const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const note = (sel, text, err) => { const n = $(sel); if (!n) return; n.textContent = text || ''; n.classList.toggle('err', !!err); };

  /* ---------- dashboard ---------- */
  function drawOverview(j) {
    const m = j.metrics || {};
    setText('mTotal', fmt(m.totalStudents)); setText('mActive', fmt(m.activeStudents)); setText('mPending', fmt(m.pendingAdmissions));
    setText('mAwaiting', fmt(m.awaitingMarking)); setText('mReleased', fmt(m.releasedMarking));
    const perf = m.averagePerformance || 0;
    setText('mPerformance', perf + '%'); $('#perfRing').style.setProperty('--p', perf);

    const counts = m.rankCounts || {}; const total = m.totalStudents || 0;
    setText('rankTotal', total);
    let at = 0; const stops = [];
    ['S', 'A', 'B', 'C', 'D', 'E'].forEach((r) => { const n = counts[r] || 0; if (!n) return; const from = at / total * 100; at += n; stops.push(RANK_COLORS[r] + ' ' + from + '% ' + (at / total * 100) + '%'); });
    $('#rankDonut').style.background = stops.length ? 'conic-gradient(' + stops.join(',') + ')' : '#e4ebff';
    const lg = $('#rankLegend'); lg.innerHTML = '';
    ['S', 'A', 'B', 'C', 'D', 'E'].forEach((r) => { const li = el('li'); const sw = el('i'); sw.style.background = RANK_COLORS[r]; li.append(sw, document.createTextNode('Rank ' + r), el('b', '', String(counts[r] || 0))); lg.append(li); });

    const recent = $('#staffRecent'); recent.innerHTML = '';
    (j.recentStudents || []).forEach((s) => {
      const row = el('div', 'act'); row.append(hex(s.rank, 'sm'));
      const d = el('div'); d.append(el('b', '', s.name), el('small', '', s.id + ' · ' + s.className)); row.append(d, el('strong', '', fmt(s.xp) + ' XP')); recent.append(row);
    });
    if (!(j.recentStudents || []).length) recent.append(el('p', 'empty', 'No students yet.'));
  }

  /* ---------- marking review ---------- */
  const isReleased = (x) => x.status === 'released';
  function drawReviewList() {
    const pend = submissions.filter((x) => !isReleased(x)); const rel = submissions.filter(isReleased);
    setText('queuePending', pend.length); setText('queueReleased', rel.length);
    $('#revTabPending').classList.toggle('on', tab === 'pending'); $('#revTabReleased').classList.toggle('on', tab === 'released');
    const list = tab === 'pending' ? pend : rel; const box = $('#staffItems'); box.innerHTML = '';
    if (!list.length) box.append(el('p', 'muted', tab === 'pending' ? 'No submissions are waiting for review.' : 'No released submissions yet.'));
    list.forEach((x) => {
      const b = el('button', 'rv-item' + (selected && selected.id === x.id ? ' on' : '')); b.type = 'button';
      const top = el('div', 'rv-top'); top.append(el('b', '', x.studentId || 'Unknown student'), el('span', 'pill', isReleased(x) ? 'Released' : 'Awaiting'));
      b.append(top, el('small', '', x.questId + ' · AI draft ' + x.result.total + '/' + x.result.max), el('small', '', new Date(x.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
      b.onclick = () => { selected = x; drawReviewList(); drawDetail(); };
      box.append(b);
    });
    if (!selected || !list.some((x) => x.id === selected.id)) { selected = list[0] || null; if (selected) { drawReviewList(); } }
  }
  function drawDetail() {
    const box = $('#reviewDetail'); box.innerHTML = '';
    const x = selected; if (!x) { box.append(el('p', 'muted', 'Select a submission to review it.')); return; }
    box.append(el('small', 'eyebrow', 'Submission ' + x.id), el('h3', '', (x.studentId || 'Student') + ' · ' + x.questId));
    if (x.correctionMd) {
      box.append(el('p', 'eyebrow', 'AI correction (a draft: check it, then set the final mark)'));
      const cm = el('div', 'dr-md'); cm.textContent = 'Loading...'; box.append(cm);
      (window.WRMath ? window.WRMath.ensure().catch(() => {}).then(() => { cm.innerHTML = window.WRMath.md(x.correctionMd); }) : Promise.resolve().then(() => { cm.textContent = x.correctionMd; }));
      (x.result.flags || []).forEach((f) => box.append(el('p', 'err', 'Flag: ' + f)));
    }
    const crit = el('div', 'crit');
    (x.result.criteria || []).forEach((c) => { const r = el('div', 'crit-row'); r.append(el('b', '', c.id), el('span', '', c.reason || 'No reason supplied.'), el('em', '', c.awarded + '/' + c.max)); crit.append(r); });
    box.append(el('p', 'eyebrow', 'AI draft · ' + x.result.total + ' / ' + x.result.max), crit);
    const work = el('details'); work.open = true; work.append(el('summary', 'eyebrow', 'Student-checked working'), el('pre', '', x.transcription || ''));
    box.append(work);
    if (isReleased(x)) { box.append(el('p', 'review-release', 'Final: ' + x.final.total + '/' + x.final.max + (x.final.comment ? ' — ' + x.final.comment : ''))); return; }
    const ctl = el('div', 'review-controls'); const row = el('div', 'row2');
    const n = el('input', 'teacher-mark'); n.type = 'number'; n.min = 0; n.max = x.result.max; n.step = 1; n.value = x.result.total; n.setAttribute('aria-label', 'Final mark');
    row.append(n, el('span', 'muted', '/ ' + x.result.max + ' marks'));
    const c = el('textarea', 'teacher-comment'); c.rows = 2; c.placeholder = 'Tutor comment (shown to the student)';
    const b = el('button', 'btn primary block', 'Release final mark'); b.type = 'button';
    b.onclick = async () => {
      const v = Number(n.value); if (!Number.isFinite(v) || v < 0 || v > x.result.max) { alert('Enter a mark from 0 to ' + x.result.max + '.'); return; }
      b.disabled = true; const j = await api('/api/staff/release', { method: 'POST', body: JSON.stringify({ id: x.id, total: v, comment: c.value }) });
      if (!j.ok) { alert(j.problem || 'Could not release.'); b.disabled = false; return; }
      selected = null; await loadStaff();
    };
    ctl.append(row, c, b); box.append(ctl);
  }
  $('#revTabPending').onclick = () => { tab = 'pending'; selected = null; drawReviewList(); drawDetail(); };
  $('#revTabReleased').onclick = () => { tab = 'released'; selected = null; drawReviewList(); drawDetail(); };

  /* ---------- students ---------- */
  function drawStudents() {
    const q = $('#studentSearch').value.trim().toLowerCase(), cl = $('#studentClass').value, rk = $('#studentRank').value;
    const body = $('#staffStudents'); body.innerHTML = '';
    const rows = students.filter((s) => (!q || [s.name, s.id, s.school].join(' ').toLowerCase().includes(q)) && (!cl || s.className === cl) && (!rk || s.rank === rk));
    rows.forEach((s) => {
      const tr = el('tr'); const rkCell = el('td'); rkCell.append(hex(s.rank, 'sm'));
      const nm = el('td'); const w = el('span', 'act'); w.style.border = '0'; w.style.padding = '0'; w.append(el('span', 'avatar', initials(s.name)), el('b', '', s.name)); nm.append(w);
      tr.append(nm, el('td', '', s.id), el('td', '', s.className), el('td', '', s.school), rkCell, el('td', 'r', fmt(s.xp))); body.append(tr);
    });
    if (!rows.length) { const tr = el('tr'); const td = el('td', 'muted', students.length ? 'No students match.' : 'No students yet.'); td.colSpan = 6; tr.append(td); body.append(tr); }
  }
  function fillClassFilter() {
    const sel = $('#studentClass'); const cur = sel.value; sel.innerHTML = '<option value="">All Classes</option>';
    [...new Set(students.map((s) => s.className).filter(Boolean))].sort().forEach((c) => { const o = el('option', '', c); o.value = c; sel.append(o); });
    sel.value = cur;
  }
  ['#studentSearch', '#studentClass', '#studentRank'].forEach((s) => $(s).addEventListener('input', drawStudents));

  /* ---------- admissions ---------- */
  const issued = [];
  function drawKeys() {
    const body = $('#keyTable'); body.innerHTML = '';
    if (!issued.length) { body.innerHTML = '<tr><td colspan="3" class="muted">No keys generated yet.</td></tr>'; return; }
    issued.forEach((k) => {
      const tr = el('tr'); const act = el('td', 'r'); const b = el('button', 'btn ghost sm'); b.type = 'button'; b.append(icon('copy'), document.createTextNode('Copy'));
      b.onclick = async () => { try { await navigator.clipboard.writeText(k.key); b.lastChild.textContent = 'Copied'; } catch { b.lastChild.textContent = 'Select & copy'; } };
      act.append(b); tr.append(el('td', '', k.key), el('td', '', timeAgo(k.issuedAt)), act); body.append(tr);
    });
  }
  async function issue(count, quiet) {
    const j = await api('/api/staff/admissions', { method: 'POST', body: JSON.stringify({ count }) });
    if (!j.ok) { note('#staffNote', j.problem, true); note('#admNote', j.problem, true); return; }
    (j.keys || []).forEach((k) => issued.unshift(k));
    const msg = (j.keys || []).length + ' admission key(s) issued.';
    note('#staffNote', msg); note('#admNote', msg); drawKeys();
    const box = $('#newKeys'); box.innerHTML = ''; (j.keys || []).forEach((k) => box.append(el('span', 'key-chip', k.key)));
    if (!quiet) await loadStaff();
    return j;
  }

  /* ---------- load ---------- */
  async function loadStaff() {
    const [o, q, s] = await Promise.all([api('/api/staff/overview'), api('/api/staff/submissions'), api('/api/staff/students')]);
    if (!o.ok || !q.ok || !s.ok) { note('#staffNote', o.problem || q.problem || s.problem || 'Staff access required.', true); return; }
    submissions = q.submissions || []; students = s.students || [];
    drawOverview(o); fillClassFilter(); drawStudents(); drawReviewList(); drawDetail(); drawKeys();
  }
  $('#issueKey').onclick = async () => { await issue(1); location.hash = '#staff-admissions'; };
  $('#genOne').onclick = () => issue(1);
  $('#issueFive').onclick = () => issue(5);
  $('#staffRefresh').onclick = loadStaff;
  window.openStaff = loadStaff;
})();
