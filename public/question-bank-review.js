/* White Room — staff-only OCR question bank review. */
(() => {
  const $ = (s) => document.querySelector(s);
  const { api } = window.wr;
  const state = { questions: [], topics: [], currentId: null, filtered: [] };
  const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value == null ? '' : String(value); };
  const escapeText = (s) => String(s || '');
  const topicLabel = (id) => (state.topics.find(t => t.id === id)?.label) || String(id || 'Unclassified').replaceAll('-', ' ');
  const sourceLabel = (q) => `${q.source?.set || 'source'} · ${q.source?.filename || 'unknown image'}`;
  function note(text, error = false) { const n = $('#qbNote'); n.textContent = text; n.classList.toggle('err', error); }
  function topicOptions(select, chosen, all = false) {
    select.innerHTML = '';
    if (all) { const o = document.createElement('option'); o.value = 'all'; o.textContent = 'All topics'; select.append(o); }
    state.topics.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; select.append(o); });
    select.value = chosen || (all ? 'all' : state.topics[0]?.id || 'unclassified');
  }
  async function load(keepId = state.currentId) {
    note('Loading review queue…');
    const params = new URLSearchParams({ q: $('#qbSearch').value.trim(), topic: $('#qbTopic').value || 'all', status: $('#qbStatus').value || 'all' });
    const j = await api('/api/staff/question-bank?' + params.toString());
    if (!j.ok) { note(j.problem || 'Could not load the question bank.', true); return; }
    state.topics = j.topics || [];
    if (!$('#qbTopic').options.length || $('#qbTopic').options.length === 1) topicOptions($('#qbTopic'), $('#qbTopic').value || 'all', true);
    topicOptions($('#qbEditTopic'), $('#qbEditTopic').value || 'unclassified');
    state.filtered = j.questions || [];
    setText('qbTotal', j.total); setText('qbPending', j.counts?.pending || 0); setText('qbApproved', j.counts?.approved || 0); setText('qbRejected', j.counts?.rejected || 0);
    const sel = $('#qbSelect'); sel.innerHTML = '';
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = state.filtered.length ? 'Choose a candidate…' : 'No matching candidates'; sel.append(blank);
    state.filtered.forEach((q, i) => { const o = document.createElement('option'); o.value = q.id; const status = q.review_status || 'pending'; o.textContent = `${String(i + 1).padStart(3, '0')} · ${status.toUpperCase()} · ${q.source?.filename || q.id} · ${topicLabel(q.topic)}`; sel.append(o); });
    let selected = state.filtered.find(q => q.id === keepId) || state.filtered[0];
    if (selected) { sel.value = selected.id; showQuestion(selected); }
    else { state.currentId = null; clearEditor(); }
    note(`${state.filtered.length} candidate(s) in this view.`);
  }
  function clearEditor() {
    state.currentId = null; $('#qbEditor').reset(); setText('qbRecordId', 'Not selected'); setText('qbSourceLabel', 'No question selected'); setText('qbMeta', ''); $('#qbImageWrap').replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Select a question to view its source image.' }));
  }
  function showQuestion(q) {
    state.currentId = q.id; $('#qbSelect').value = q.id; setText('qbRecordId', q.id); setText('qbSourceLabel', sourceLabel(q));
    $('#qbStem').value = q.stem || ''; topicOptions($('#qbEditTopic'), q.topic || 'unclassified');
    $('#qbOptions').value = Array.isArray(q.options) ? q.options.join('\n') : (typeof q.options === 'string' ? q.options : '');
    $('#qbAnswer').value = typeof q.answer_key === 'string' ? q.answer_key : (q.answer_key == null ? '' : JSON.stringify(q.answer_key, null, 2));
    $('#qbMarkScheme').value = typeof q.mark_scheme === 'string' ? q.mark_scheme : (q.mark_scheme == null ? '' : JSON.stringify(q.mark_scheme, null, 2));
    $('#qbReviewStatus').value = q.review_status || 'pending'; $('#qbFlags').value = (q.review_flags || []).join('\n');
    const wrap = $('#qbImageWrap'); wrap.innerHTML = '';
    const img = document.createElement('img'); img.alt = 'Original source page: ' + (q.source?.filename || 'examination page');
    img.src = '/api/staff/question-bank/image?' + new URLSearchParams({ set: q.source?.set || '', filename: q.source?.filename || '' }).toString();
    img.addEventListener('error', () => { wrap.innerHTML = '<p class="muted">Source image could not be loaded. Check the source archive in the project.</p>'; });
    img.loading = 'lazy'; wrap.append(img);
    const meta = [q.source?.filename, q.source?.question_number_ocr ? 'OCR number: ' + q.source.question_number_ocr : '', q.source?.exam_board || 'Exam board unverified', q.source?.qualification_level || 'Level unverified', q.source?.year || 'Year unverified', q.source?.paper || 'Paper unverified', 'OCR confidence: ' + (q.extraction_confidence || 'not recorded')].filter(Boolean);
    setText('qbMeta', meta.join(' · ')); note('');
  }
  $('#qbEditor').addEventListener('submit', async (e) => {
    e.preventDefault(); const q = state.filtered.find(x => x.id === state.currentId); if (!q) return note('Select a question first.', true);
    const save = $('#qbSave'); save.disabled = true; note('Saving review…');
    const opts = $('#qbOptions').value.split('\n').map(x => x.trim()).filter(Boolean);
    const body = { id: q.id, stem: $('#qbStem').value, topic: $('#qbEditTopic').value, options: opts.length ? opts : null, answer_key: $('#qbAnswer').value.trim(), mark_scheme: $('#qbMarkScheme').value.trim(), review_status: $('#qbReviewStatus').value, review_flags: $('#qbFlags').value.split('\n').map(x => x.trim()).filter(Boolean) };
    const j = await api('/api/staff/question-bank/save', { method: 'POST', body: JSON.stringify(body) }); save.disabled = false;
    if (!j.ok) return note(j.problem || 'Save failed.', true);
    note('Saved. This record remains in staging and is not visible to students.'); await load(q.id);
  });
  $('#qbSelect').addEventListener('change', () => { const q = state.filtered.find(x => x.id === $('#qbSelect').value); if (q) showQuestion(q); else clearEditor(); });
  $('#qbRefresh').addEventListener('click', () => load());
  $('#qbSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); load(null); } });
  $('#qbTopic').addEventListener('change', () => load(null)); $('#qbStatus').addEventListener('change', () => load(null));
  function move(delta) { const i = state.filtered.findIndex(q => q.id === state.currentId); const next = state.filtered[i + delta]; if (next) showQuestion(next); }
  $('#qbPrev').addEventListener('click', () => move(-1)); $('#qbNext').addEventListener('click', () => move(1));
  $('#qbExport').addEventListener('click', async () => {
    const j = await api('/api/staff/question-bank/export-approved'); if (!j.ok) return note(j.problem || 'Export failed.', true);
    const blob = new Blob([JSON.stringify({ schema_version: 1, status: 'approved_staging_export_not_live', count: j.count, questions: j.questions }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'white-room-approved-question-candidates.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); note(`Exported ${j.count} approved candidate(s). They remain outside the live bank.`);
  });
  let lastLoaded = false;
  function maybeLoad() { if (location.hash.split('/')[0] === '#staff-question-bank' && !lastLoaded) { lastLoaded = true; load(); } else if (location.hash.split('/')[0] !== '#staff-question-bank') lastLoaded = false; }
  window.addEventListener('hashchange', maybeLoad); document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeLoad(); });
  maybeLoad();
})();
