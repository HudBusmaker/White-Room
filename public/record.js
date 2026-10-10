/* White Room: the Record. Every completed task with its score beside it.
   Students see their own; Head Staff see everyone's, can filter, and can download a CSV. */
(() => {
  const $ = (s) => document.querySelector(s);
  const token = () => sessionStorage.getItem('wr_token') || '';
  const api = async (url) => { const r = await fetch(url, { headers: { 'x-wr-token': token() } }); return r.json().catch(() => ({ ok: false, problem: 'Could not read the server response.' })); };
  const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const KINDS = [['', 'All tasks'], ['daily-quest', 'Daily quests'], ['practice', 'Practice sets'], ['lesson', 'Lessons'], ['quest', 'Marked quests']];

  function scoreCell(r) {
    const c = node('div', 'rec-score');
    c.append(node('b', '', `${r.score}/${r.max}`));
    if (r.pct != null) { c.append(node('small', r.pct >= 70 ? 'rec-good' : r.pct >= 40 ? 'rec-mid' : 'rec-low', `${r.pct}%`)); }
    return c;
  }
  function summaryBar(box, s, extra) {
    box.replaceChildren();
    const tile = (label, value) => { const t = node('article', 'card rec-tile'); t.append(node('small', '', label), node('b', '', String(value))); return t; };
    box.append(tile('Tasks completed', s.tasks), tile('Marks', s.max ? `${s.score}/${s.max}` : '—'), tile('Average', s.pct == null ? '—' : s.pct + '%'), tile(extra ? extra.label : 'XP from tasks', extra ? extra.value : s.xp));
  }
  function bySubject(box, s) {
    box.replaceChildren();
    if (!s.bySubject.length) return;
    s.bySubject.forEach((b) => { const row = node('div', 'rec-subj'); row.append(node('span', '', b.label), node('small', 'muted', `${b.tasks} task${b.tasks === 1 ? '' : 's'}`), node('b', '', b.pct == null ? '—' : b.pct + '%')); box.append(row); });
  }
  function list(box, rows, withStudent) {
    box.replaceChildren();
    if (!rows.length) { box.append(node('p', 'muted', 'Nothing recorded yet. Finish a daily quest, a practice set or a lesson and it appears here with its score.')); return; }
    rows.forEach((r) => {
      const row = node('div', 'rec-row');
      const main = node('div', 'rec-main');
      main.append(node('b', '', r.title));
      const meta = [r.kindLabel, r.subjectLabel, r.levelLabel].filter(Boolean).join(' · ');
      main.append(node('small', 'muted', (withStudent ? `${r.studentName || r.studentId} (${r.studentId}) · ` : '') + meta + ' · ' + when(r.at)));
      row.append(main, scoreCell(r)); box.append(row);
    });
  }
  function fillSelect(sel, options, keep) { const cur = keep ? sel.value : ''; sel.replaceChildren(); options.forEach(([v, l]) => sel.append(new Option(l, v))); sel.value = cur; }

  /* ----- student ----- */
  async function openRecord() {
    const root = $('#recordList'); if (!root) return;
    fillSelect($('#recKind'), KINDS, true);
    const q = new URLSearchParams(); if ($('#recKind').value) q.set('kind', $('#recKind').value); if ($('#recSubject').value) q.set('subject', $('#recSubject').value);
    const j = await api('/api/records?' + q);
    if (!j.ok) { root.replaceChildren(node('p', 'muted', j.problem || 'Could not load your record.')); return; }
    const subjSel = $('#recSubject'); if (subjSel.options.length <= 1) fillSelect(subjSel, [['', 'All subjects'], ...j.summary.bySubject.filter((b) => b.subject !== 'other').map((b) => [b.subject, b.label])], true);
    summaryBar($('#recSummary'), j.summary); bySubject($('#recBySubject'), j.summary); list(root, j.records, false);
  }
  window.openRecord = openRecord;
  $('#recKind')?.addEventListener('change', openRecord); $('#recSubject')?.addEventListener('change', openRecord);

  /* ----- staff ----- */
  const staffQuery = () => { const q = new URLSearchParams(); [['kind', '#srKind'], ['subject', '#srSubject'], ['level', '#srLevel'], ['q', '#srSearch']].forEach(([k, s]) => { const v = $(s)?.value.trim(); if (v) q.set(k, v); }); return q; };
  let timer = null;
  async function openStaffRecords() {
    const root = $('#srList'); if (!root) return;
    fillSelect($('#srKind'), KINDS, true);
    const j = await api('/api/staff/records?' + staffQuery());
    if (!j.ok) { root.replaceChildren(node('p', 'muted', j.problem || 'Could not load records.')); return; }
    const subjSel = $('#srSubject'); if (subjSel.options.length <= 1) fillSelect(subjSel, [['', 'All subjects'], ['maths', 'Mathematics'], ['further-maths', 'Further Maths'], ['additional-maths', 'Additional Mathematics'], ['physics', 'Physics'], ['chemistry', 'Chemistry'], ['computer-science', 'Computer Science'], ['ict', 'ICT'], ['french', 'French'], ['english', 'English'], ['economics', 'Economics']], true);
    const lvl = $('#srLevel'); if (lvl.options.length <= 1) fillSelect(lvl, [['', 'All levels'], ['a-level', 'A Level'], ['form-5', 'Form 5']], true);
    summaryBar($('#srSummary'), j.summary, { label: 'Records shown', value: j.total }); bySubject($('#srBySubject'), j.summary); list(root, j.records, true);
  }
  window.openStaffRecords = openStaffRecords;
  ['#srKind', '#srSubject', '#srLevel'].forEach((s) => $(s)?.addEventListener('change', openStaffRecords));
  $('#srSearch')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(openStaffRecords, 250); });
  $('#srCsv')?.addEventListener('click', async () => {
    const r = await fetch('/api/staff/records.csv?' + staffQuery(), { headers: { 'x-wr-token': token() } });
    if (!r.ok) { $('#srNote').textContent = 'Could not download the CSV.'; return; }
    const url = URL.createObjectURL(await r.blob()); const a = node('a'); a.href = url; a.download = 'white-room-records.csv'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    $('#srNote').textContent = 'CSV downloaded.';
  });
})();
