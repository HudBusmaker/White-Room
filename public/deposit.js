/* White Room: JSON Deposit (Head Staff only).
   Get questions from Gemini (or paste your own JSON), CHECK them, read the preview, then DEPOSIT.
   Deposited questions go live at once for daily quests and Practice. Everything is drawn with DOM nodes. */
(() => {
  const $ = (s) => document.querySelector(s);
  const token = () => sessionStorage.getItem('wr_token') || '';
  const api = async (url, body) => {
    const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-wr-token': token() }, body: body ? JSON.stringify(body) : undefined });
    return r.json().catch(() => ({ ok: false, problem: 'Could not read the server response.' }));
  };
  const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const math = (el, text) => { if (window.WRMath) window.WRMath.text(el, text); else el.textContent = text; return el; };
  let overview = null, lastJson = '';

  function fill(sel, rows, value) { sel.replaceChildren(); rows.forEach(([v, l]) => sel.append(new Option(l, v))); if (value != null) sel.value = value; }

  function drawCoverage() {
    const box = $('#dpCoverage'); box.replaceChildren();
    ['a-level', 'form-5'].forEach((lv) => {
      const rows = overview.coverage.filter((c) => c.level === lv); if (!rows.length) return;
      const wrap = node('div', 'dp-cov'); wrap.append(node('h4', '', rows[0].levelLabel));
      rows.forEach((c) => {
        const r = node('div', 'dp-cov-row' + (c.questions ? '' : ' empty'));
        r.append(node('span', '', c.subjectLabel), node('small', 'muted', `${c.topics}/${c.topicsTotal} topics`), node('b', '', `${c.questions} q`));
        wrap.append(r);
      });
      box.append(wrap);
    });
  }
  function drawSelectors() {
    const levels = [...new Set(overview.coverage.map((c) => c.level))].map((l) => [l, overview.coverage.find((c) => c.level === l).levelLabel]);
    const lvSel = $('#dpLevel'), subSel = $('#dpSubject'), topSel = $('#dpTopic');
    const keep = lvSel.value;
    fill(lvSel, levels, keep || levels[0][0]);
    const onLevel = () => { const subs = overview.coverage.filter((c) => c.level === lvSel.value).map((c) => [c.subject, c.subjectLabel]); const k = subSel.value; fill(subSel, subs, subs.some((s) => s[0] === k) ? k : subs[0][0]); onSubject(); };
    const onSubject = () => { const c = overview.coverage.find((x) => x.level === lvSel.value && x.subject === subSel.value); fill(topSel, [['', 'All topics (a spread)'], ...(c ? c.topicList.map((t) => [t.id, `${t.name} · ${t.questions} q${t.hasNote ? '' : ' · needs note'}`]) : [])], ''); };
    lvSel.onchange = onLevel; subSel.onchange = onSubject; onLevel();
    fill($('#dpDefaultLevel'), levels, $('#dpDefaultLevel').value || levels[0][0]);
  }
  function drawBatches() {
    const box = $('#dpBatches'); box.replaceChildren();
    if (!overview.batches.length) { box.append(node('p', 'muted', 'Nothing deposited yet.')); return; }
    overview.batches.forEach((b) => {
      const d = node('details', 'dp-batch'); d.append(node('summary', '', `${new Date(b.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${b.questions.length} question${b.questions.length === 1 ? '' : 's'}`));
      b.questions.forEach((q) => {
        const row = node('div', 'dp-q'); const t = node('div'); t.append(node('b', '', q.id), node('small', 'muted', ` ${q.subject} · ${q.level} · ${q.type}`)); const stem = node('p', 'muted small'); math(stem, q.stem); t.append(stem);
        const btn = node('button', 'btn ghost sm', 'Withdraw'); btn.type = 'button';
        btn.addEventListener('click', async () => { if (!confirm(`Withdraw ${q.id}? Students will no longer get it.`)) return; btn.disabled = true; const r = await api('/api/staff/deposit/withdraw', { id: q.id }); $('#dpNote').textContent = r.ok ? `${q.id} withdrawn.` : (r.problem || 'Could not withdraw.'); await load(); });
        row.append(t, btn); d.append(row);
      });
      box.append(d);
    });
  }
  async function load() {
    const j = await api('/api/staff/deposit');
    if (!j.ok) { $('#dpNote').textContent = j.problem || 'Head Staff access required.'; return; }
    overview = j; drawCoverage(); drawSelectors(); drawBatches();
  }

  /* ----- prompt / Gemini ----- */
  const genOpts = () => ({ level: $('#dpLevel').value, subject: $('#dpSubject').value, topic: $('#dpTopic').value, count: Number($('#dpCount').value) || 5, difficulty: $('#dpDifficulty').value });
  $('#dpBuild')?.addEventListener('click', async () => {
    const note = $('#dpPromptNote'); note.textContent = 'Building…';
    const r = await api('/api/staff/deposit/prompt', genOpts());
    if (!r.ok) { note.textContent = r.problem || 'Could not build the prompt.'; return; }
    $('#dpPrompt').value = r.prompt; $('#dpPromptWrap').hidden = false; note.textContent = 'Prompt ready. Copy it into Gemini, then paste Gemini\'s JSON reply into step 2.';
  });
  $('#dpCopy')?.addEventListener('click', async () => { const t = $('#dpPrompt'); try { await navigator.clipboard.writeText(t.value); $('#dpPromptNote').textContent = 'Copied.'; } catch { t.select(); $('#dpPromptNote').textContent = 'Press Ctrl+C to copy.'; } });
  $('#dpGenerate')?.addEventListener('click', async () => {
    const note = $('#dpPromptNote'); const btn = $('#dpGenerate'); btn.disabled = true; note.textContent = 'Asking Gemini… this can take up to a minute.';
    const r = await api('/api/staff/deposit/generate', genOpts()); btn.disabled = false;
    if (!r.ok) { note.textContent = (r.problem || 'Gemini did not answer.') + (r.detail ? ' (' + r.detail + ')' : ''); return; }
    $('#dpJson').value = r.text; note.textContent = `Gemini (${r.model || 'model'}) replied. Press Check below.`; $('#dpJson').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  /* ----- check / preview / deposit ----- */
  function previewQuestion(q) {
    const box = node('div', 'dp-preview');
    box.append(math(node('p', 'dq-stem'), q.stem));
    if (q.type === 'mcq') {
      (q.options || []).forEach((o) => { const r = node('div', 'dp-opt' + (o.correct ? ' right' : '')); r.append(node('b', '', o.id + '.'), math(node('span'), ' ' + o.text)); if (o.correct) r.append(node('small', '', ' ✓ correct')); else if (o.trap) { const t = node('small', 'muted'); math(t, ' · trap: ' + o.trap); r.append(t); } box.append(r); });
    } else {
      (q.steps || []).forEach((s) => { const r = node('div', 'dp-opt'); r.append(node('b', '', `(${s.id}) `), math(node('span'), s.prompt)); const a = node('small', 'dp-ans', `  → ${s.expected}${s.unit ? ' ' + s.unit : ''}  [${s.marks} mark${s.marks === 1 ? '' : 's'}, ${s.kind}]`); r.append(a); box.append(r); });
    }
    return box;
  }
  function drawCheck(r) {
    const box = $('#dpResult'); box.replaceChildren(); $('#dpCommitWrap').hidden = true;
    if (!r.ok) { box.append(node('p', 'form-note bad', r.problem || 'The check failed.')); return; }
    const head = node('div', 'dp-head'); head.append(node('b', '', `${r.valid} of ${r.total} questions passed`), node('span', 'pill ' + (r.invalid ? 'pill-warn' : ''), r.invalid ? `${r.invalid} need fixing` : 'all good')); box.append(head);
    (r.noteProblems || []).forEach((n) => box.append(node('p', 'muted small', 'Note: ' + n)));
    Object.keys(r.notes || {}).forEach((t) => box.append(node('p', 'muted small', `A reading note for ${t} will be added.`)));
    r.questions.forEach((q) => {
      const card = node('article', 'card dp-q-card ' + (q.ok ? 'ok' : 'bad'));
      const top = node('div', 'card-head'); top.append(node('b', '', `${q.index + 1}. ${q.id}`), node('span', 'pill ' + (q.ok ? '' : 'pill-warn'), q.ok ? 'Ready' : 'Rejected'));
      card.append(top, node('small', 'muted', [q.subject, q.level, q.topic].filter(Boolean).join(' · ')));
      q.errors.forEach((e) => card.append(node('p', 'dp-err', '✗ ' + e)));
      q.fixes.forEach((f) => card.append(node('p', 'muted small', '↺ ' + f)));
      if (q.question && q.question.stem) card.append(previewQuestion(q.question));
      box.append(card);
    });
    if (r.valid) { $('#dpCommitWrap').hidden = false; $('#dpDepositBtn').textContent = `Deposit ${r.valid} valid question${r.valid === 1 ? '' : 's'}`; $('#dpConfirm').checked = false; $('#dpDepositBtn').disabled = true; }
  }
  const payload = () => ({ json: $('#dpJson').value, defaultLevel: $('#dpDefaultLevel').value });
  $('#dpCheck')?.addEventListener('click', async () => {
    const note = $('#dpNote'); note.textContent = 'Checking…'; lastJson = $('#dpJson').value;
    if (window.WRMath) { try { await window.WRMath.ensure(); } catch { /* unformatted preview */ } }
    const r = await api('/api/staff/deposit/check', payload()); note.textContent = ''; drawCheck(r);
    $('#dpResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#dpConfirm')?.addEventListener('change', () => { $('#dpDepositBtn').disabled = !$('#dpConfirm').checked; });
  $('#dpDepositBtn')?.addEventListener('click', async () => {
    const note = $('#dpNote'); if ($('#dpJson').value !== lastJson) { note.textContent = 'The JSON changed since the check. Press Check again first.'; return; }
    $('#dpDepositBtn').disabled = true; note.textContent = 'Depositing…';
    const r = await api('/api/staff/deposit/commit', payload());
    if (!r.ok) { note.textContent = r.problem || 'Nothing was deposited.'; return; }
    note.textContent = `Deposited ${r.deposited} question${r.deposited === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} rejected ones were left out)` : ''}. They are live for daily quests and Practice now.`;
    $('#dpResult').replaceChildren(); $('#dpCommitWrap').hidden = true; $('#dpJson').value = ''; lastJson = ''; await load();
  });
  $('#dpFile')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 600 * 1024) { $('#dpNote').textContent = 'That file is too large (limit about 600 KB).'; return; }
    $('#dpJson').value = await f.text(); $('#dpNote').textContent = `Loaded ${f.name}. Press Check.`; e.target.value = '';
  });
  window.openDeposit = load;
})();
