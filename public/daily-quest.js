/* White Room: Daily Quest (student) and Daily Quest Planner (Head Staff).
   A student sees only the quests for the level and subjects they chose. Questions are drawn with DOM nodes
   (never innerHTML) and maths is typeset by WRMath (KaTeX), which loads only when a quest is opened. */
(() => {
  const $ = (s) => document.querySelector(s);
  const token = () => sessionStorage.getItem('wr_token') || '';
  const api = async (url, options = {}) => { const r = await fetch(url, { ...options, headers: { 'content-type': 'application/json', 'x-wr-token': token(), ...(options.headers || {}) } }); return r.json().catch(() => ({ ok: false, problem: 'Could not read the server response.' })); };
  const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const math = (el, text) => { if (window.WRMath) window.WRMath.text(el, text); else el.textContent = text; return el; };
  const mdBox = (el, text) => { if (window.WRMath) el.innerHTML = window.WRMath.md(text); else el.textContent = text; return el; };  // md() removes raw HTML and builds only safe markup
  const ensureMath = async () => { try { if (window.WRMath) await window.WRMath.ensure(); } catch { /* the text still shows, just unformatted */ } };
  const when = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  /* ----- photo of handwritten working ----- */
  function shrink(file) {
    return new Promise((ok, no) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { const k = Math.min(1, 1200 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.8)); };
      img.onerror = () => { URL.revokeObjectURL(url); no(new Error('That file is not a readable image.')); };
      img.src = url;
    });
  }
  function photoBox(quest, q, box) {
    const d = node('details', 'dq-photobox'); d.append(node('summary', '', 'Prefer to write it on paper? Send a photo of your working'));
    d.open = window.matchMedia('(max-width: 640px)').matches;
    const lock = () => { box.querySelectorAll('[data-step]').forEach((i) => { i.disabled = true; }); box.classList.add('has-photo'); };
    if ((quest.photoSent || []).includes(q.id)) { d.append(node('p', 'dq-ok', 'Photo received and marked. Your mark and correction appear when you submit the quest. It replaces your typed answers for this question.')); lock(); return d; }
    d.append(node('p', 'muted', 'Photograph your full working (1 to 3 photos). An AI marks it at once and the mark counts when you submit the quest. It replaces any typed answers for this question, and you can send only one photo per question.'));
    const file = node('input'); file.type = 'file'; file.accept = 'image/*'; file.multiple = true;
    const msg = node('p', 'form-note', ''); const btn = node('button', 'btn ghost sm', 'Send photo for marking'); btn.type = 'button';
    btn.addEventListener('click', async () => {
      const files = [...file.files].slice(0, 3);
      if (!files.length) { msg.textContent = 'Choose a photo first.'; return; }
      btn.disabled = true; msg.textContent = 'Marking your photo… this can take up to a minute.';
      try {
        const images = await Promise.all(files.map(shrink));
        const out = await api('/api/daily-quests/photo', { method: 'POST', body: JSON.stringify({ questId: quest.id, questionId: q.id, images }) });
        if (!out.ok) { msg.textContent = out.problem || 'Could not mark the photo.'; btn.disabled = false; return; }
        msg.textContent = out.message; file.remove(); btn.remove(); lock(); (quest.photoSent ||= []).push(q.id);
      } catch (e) { msg.textContent = e.message || 'Could not read the photo.'; btn.disabled = false; }
    });
    d.append(file, btn, msg); return d;
  }

  /* ----- ranking of everyone who took the quest ----- */
  function rankBox(quest) {
    const d = node('details', 'dq-rank'); d.append(node('summary', '', 'See ranking'));
    const body = node('div', 'dq-rank-body'); d.append(body); let loaded = false;
    d.addEventListener('toggle', async () => {
      if (!d.open || loaded) return; body.replaceChildren(node('p', 'muted', 'Loading…'));
      const r = await api('/api/daily-quests/ranking?questId=' + encodeURIComponent(quest.id));
      if (!r.ok) { body.replaceChildren(node('p', 'muted', r.problem || 'Could not load the ranking.')); return; }
      loaded = true; body.replaceChildren(node('p', 'muted small', `${r.total} student${r.total === 1 ? '' : 's'} took this quest. Ties are ordered by who finished first.`));
      const list = node('ol', 'dq-rank-list');
      r.top.forEach((x) => { const li = node('li', x.me ? 'me' : ''); li.append(node('span', 'dq-rank-pos', String(x.rank)), node('span', 'dq-rank-name', x.name + (x.me ? ' (you)' : '')), node('b', '', `${x.score}/${x.max}`)); list.append(li); });
      body.append(list);
      if (r.me && r.me.rank > r.top.length) body.append(node('p', 'muted small', `You are number ${r.me.rank}.`));
    });
    return d;
  }

  function questionForm(q, idx, quest) {
    const box = node('article', 'card dq-question');
    box.append(node('small', 'eyebrow', `QUESTION ${idx + 1} · ${q.topicName || q.topic} · ${q.total} mark${q.total === 1 ? '' : 's'}`));
    box.append(math(node('p', 'dq-stem'), q.stem));
    if (q.type === 'mcq') {
      const group = node('div', 'dq-options'); const name = `${q.id}-choice`;
      (q.options || []).forEach((o) => { const lab = node('label', 'dq-option'); const radio = node('input'); radio.type = 'radio'; radio.name = name; radio.value = o.id; lab.append(radio, node('b', 'dq-letter', o.id), math(node('span'), o.text)); group.append(lab); });
      box.append(group);
      box.getAnswer = () => { const x = box.querySelector(`input[name="${name}"]:checked`); return { choice: x ? x.value : '' }; };
    } else {
      (q.steps || []).forEach((st) => {
        const lab = node('label', 'field dq-step');
        const p = node('span', 'dq-prompt'); math(p, st.prompt); p.append(node('small', 'muted', ` (${st.marks} mark${st.marks === 1 ? '' : 's'})`)); lab.append(p);
        let input;
        if (st.kind === 'choice' && Array.isArray(st.options)) { input = node('select', 'input'); input.append(new Option('Choose an answer', '')); st.options.forEach((o) => input.append(new Option(o.text || o.label || o.id, o.id))); }
        else { input = node('input', 'input'); input.type = 'text'; input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false; input.placeholder = st.unit ? `Answer (${st.unit})` : 'Your answer'; }
        input.dataset.step = st.id; lab.append(input);
        if (st.hint) { const h = node('details', 'dq-hint'); h.append(node('summary', '', 'Hint')); h.append(math(node('p', 'muted'), st.hint)); lab.append(h); }
        box.append(lab);
      });
      box.getAnswer = () => { const a = {}; box.querySelectorAll('[data-step]').forEach((i) => { a[i.dataset.step] = i.value; }); return a; };
      if (quest) box.append(photoBox(quest, q, box));
    }
    return box;
  }

  function renderResult(container, quest, r) {
    const box = node('article', 'card dq-result');
    box.append(node('h3', '', `Quest complete · ${r.score}/${r.max}`));
    box.append(node('p', '', `XP earned: ${r.xp}. Summary: ${r.summaryChoice === 'skip' ? 'skipped (bonus XP)' : 'read'}.`));
    const list = node('div', 'dq-feedback');
    (r.feedback || []).forEach((f) => {
      const idx = quest.questions.findIndex((x) => x.id === f.questionId);
      const row = node('div', 'dq-fb-row ' + (f.correct ? 'ok' : f.blank ? 'blank' : 'bad'));
      row.append(node('b', '', `Question ${idx + 1}`), node('span', 'pill', `${f.score}/${f.max}`));
      list.append(row);
      (f.steps || []).filter((s) => s.note && s.status !== 'blank').forEach((s) => { const n = node('p', 'muted small dq-fb-note'); math(n, `Step ${s.id}: ${s.note}`); list.append(n); });
      if (f.blank) list.append(node('p', 'muted small dq-fb-note', 'Not answered.'));
      if (f.photo) {
        row.append(node('span', 'pill', f.adjustedBy ? 'photo · adjusted by staff' : 'photo marked'));
        const det = node('details', 'dq-fb-photo'); det.append(node('summary', '', 'See the correction')); det.append(mdBox(node('div', 'dq-note-body'), f.correctionMd || ''));
        (f.flags || []).forEach((fl) => det.append(node('p', 'muted small', 'Note: ' + fl))); list.append(det);
      }
    });
    box.append(list, rankBox(quest)); container.append(box);
  }

  function questCard(q, root) {
    const card = node('article', 'card dq-card');
    const head = node('div', 'card-head'); const title = node('div');
    title.append(node('small', 'eyebrow', `${q.mode === 'exam' ? 'EXAM PREPARATION' : 'GENERAL PRACTICE'} · ${q.levelLabel} · ${q.day}`), node('h2', '', q.subjectLabel));
    head.append(title, node('span', 'pill', q.attempted ? 'Completed' : `Open until ${when(q.expiresAt)}`)); card.append(head);
    card.append(node('p', 'muted', `Topics: ${q.topicNames.join(', ') || 'Mixed practice'}`));
    if (q.attempted) { renderResult(card, q, q.result); return card; }

    const choiceWrap = node('div', 'dq-summary-choice');
    choiceWrap.append(node('h3', '', 'Before you begin'), node('p', 'muted', 'Read the summary to prepare (standard XP), or skip it and earn a bonus if you can answer unaided.'));
    const radios = node('div', 'dq-options');
    const mk = (value, label, checked) => { const lab = node('label', 'dq-option'); const r = node('input'); r.type = 'radio'; r.name = q.id + '-summary'; r.value = value; r.checked = checked; lab.append(r, node('span', '', label)); radios.append(lab); return r; };
    const readRadio = mk('read', 'Read summary · standard XP', false), skipRadio = mk('skip', 'Skip summary · bonus XP', true);
    choiceWrap.append(radios);
    const notes = node('div', 'dq-notes'); notes.hidden = true;
    (q.notes || []).forEach((n) => { const a = node('article', 'dq-note'); a.append(node('h4', '', n.title || n.topic)); a.append(mdBox(node('div', 'dq-note-body'), n.body || '')); notes.append(a); });
    readRadio.addEventListener('change', () => { notes.hidden = !readRadio.checked; });
    skipRadio.addEventListener('change', () => { notes.hidden = true; });
    card.append(choiceWrap, notes);

    const forms = node('div', 'dq-questions'); const qForms = (q.questions || []).map((x, i) => questionForm(x, i, q)); qForms.forEach((f) => forms.append(f)); card.append(forms);
    const submit = node('button', 'btn primary', 'Submit quest'); submit.type = 'button'; const status = node('p', 'form-note', '');
    submit.addEventListener('click', async () => {
      const choice = card.querySelector(`input[name="${q.id}-summary"]:checked`)?.value || 'skip';
      const answers = {}; qForms.forEach((f, i) => { answers[q.questions[i].id] = f.getAnswer(); });
      submit.disabled = true; status.textContent = 'Marking your answers…';
      const out = await api('/api/daily-quests/submit', { method: 'POST', body: JSON.stringify({ questId: q.id, answers, summaryChoice: choice }) });
      if (!out.ok) { status.textContent = out.problem || 'Could not submit.'; submit.disabled = false; return; }
      forms.remove(); choiceWrap.remove(); notes.remove(); submit.remove(); status.remove();
      renderResult(card, q, out.result);
      await ensureMath();
      head.querySelector('.pill').textContent = 'Completed';
      if (window.refreshAccount) window.refreshAccount();
    });
    card.append(submit, status);
    return card;
  }

  async function loadStudent() {
    const root = $('#dailyQuestRoot'); if (!root) return;
    if (!token()) return;
    root.replaceChildren(node('p', 'muted', 'Loading daily quests…'));
    const j = await api('/api/daily-quests');
    root.replaceChildren();
    if (!j.ok) { root.append(node('article', 'card', j.problem || 'Sign in to view daily quests.')); return; }
    if (j.needsSubjects) {
      const gate = node('article', 'card'); gate.append(node('h2', '', 'Which subjects are you offering?'), node('p', 'muted', 'Daily quests are set for each level and subject. Choose yours to see your quests.'));
      const pickBox = node('div'); pickBox.id = 'dqPick'; gate.append(pickBox);
      const save = node('button', 'btn primary', 'Save and show my quests'); save.type = 'button'; const note = node('p', 'form-note', ''); gate.append(save, note); root.append(gate);
      const me = window.__wrMe && window.__wrMe();
      const picker = await window.WRSubjects.mount(pickBox, { level: me?.levelKey, subjects: me?.subjects });
      save.addEventListener('click', async () => {
        note.textContent = 'Saving…'; const r = await api('/api/me/subjects', { method: 'POST', body: JSON.stringify(picker.get()) });
        if (!r.ok) { note.textContent = r.problem || 'Could not save.'; return; }
        if (window.refreshAccount) await window.refreshAccount(); loadStudent();
      });
      return;
    }
    await ensureMath();
    const bar = node('div', 'card dq-bar'); bar.append(node('b', '', j.levelLabel));
    (j.subjects || []).forEach((s) => bar.append(node('span', 'pill ' + (s.hasQuest ? '' : 'pill-dim'), s.label + (s.hasQuest ? '' : ' · no quest yet'))));
    const change = node('a', 'btn ghost sm', 'Change subjects'); change.href = '#profile'; bar.append(change); root.append(bar);
    if (!j.quests?.length) { root.append(node('article', 'card', 'No daily quests are published for your subjects yet. They appear as soon as Head Staff add questions for them.')); return; }
    j.quests.forEach((q) => root.append(questCard(q, root)));
  }
  window.openDailyQuest = loadStudent;

  /* ---------- Head Staff: Daily Quest Planner ---------- */
  async function loadStaff() {
    const root = $('#dqTopicConfig'); if (!root) return;
    const j = await api('/api/staff/daily-quests');
    if (!j.ok) { $('#dqStaffNote').textContent = j.problem || 'Staff access required.'; return; }
    const settings = j.settings || {};
    $('#dqMode').value = settings.mode || 'general'; $('#dqCount').value = String(settings.questionCount || 3);
    root.replaceChildren();
    (j.subjects || []).forEach((s) => {
      const details = node('details', 'dq-subject');
      details.append(node('summary', '', `${s.label} · ${s.questions} question${s.questions === 1 ? '' : 's'}`));
      const list = node('div', 'dq-topic-list');
      const withQ = s.topics.filter((t) => t.hasQuestions);
      if (!withQ.length) list.append(node('p', 'muted small', 'No questions yet. Add some in JSON Deposit.'));
      withQ.forEach((t) => {
        const lab = node('label', 'dq-topic'); const input = node('input'); input.type = 'checkbox'; input.value = t.id; input.dataset.key = s.key;
        const chosen = settings.examTopics?.[s.key] ?? (s.level === 'a-level' ? settings.examTopics?.[s.id] : []) ?? [];
        input.checked = chosen.includes(t.id); lab.append(input, node('span', '', t.name)); list.append(lab);
      });
      details.append(list); root.append(details);
    });
    drawPublished(j.quests || []); drawPhotos();
  }
  function drawPublished(quests) {
    const box = $('#dqPublished'); if (!box) return; box.replaceChildren();
    if (!quests.length) { box.append(node('p', 'muted', 'No quests generated yet.')); return; }
    quests.slice(0, 40).forEach((q) => {
      const row = node('div', 'dq-published');
      row.append(node('div', '', `${q.subjectLabel} (${q.levelLabel}) · ${q.day}`), node('small', 'muted', `${q.mode === 'exam' ? 'Exam' : 'General'} · ${q.questions} questions · expires ${when(q.expiresAt)}`), node('p', 'muted', q.topicNames.join(', ')));
      box.append(row);
    });
  }
  async function drawPhotos() {
    const box = $('#dqPhotos'); if (!box) return; const j = await api('/api/staff/daily-quests/photos'); box.replaceChildren();
    if (!j.ok) { box.append(node('p', 'muted', j.problem || 'Could not load.')); return; }
    if (!j.photos.length) { box.append(node('p', 'muted', 'No photo-marked answers yet.')); return; }
    await ensureMath();
    j.photos.forEach((p) => {
      const row = node('details', 'dq-published'); row.append(node('summary', '', `${p.studentName || p.studentId} · ${p.subject} · ${p.day} · ${p.got}/${p.max}${p.adjusted ? ' (adjusted, AI gave ' + p.aiGot + ')' : ''}${p.submitted ? '' : ' · not submitted yet'}`));
      row.append(mdBox(node('div', 'dq-note-body'), p.correctionMd || ''));
      (p.flags || []).forEach((fl) => row.append(node('p', 'muted small', 'Note: ' + fl)));
      if (p.submitted) {
        const inp = node('input', 'input'); inp.type = 'number'; inp.min = '0'; inp.max = String(p.max); inp.value = String(p.got); inp.style.maxWidth = '90px';
        const btn = node('button', 'btn ghost sm', 'Set mark'); btn.type = 'button'; const note = node('span', 'form-note', '');
        btn.addEventListener('click', async () => { const o = await api('/api/staff/daily-quests/adjust', { method: 'POST', body: JSON.stringify({ studentId: p.studentId, questId: p.questId, questionId: p.questionId, score: inp.value }) }); note.textContent = o.ok ? ' Saved.' : ' ' + (o.problem || 'Could not save.'); if (o.ok) drawPhotos(); });
        const line = node('div', 'row'); line.append(node('span', 'muted', 'Mark out of ' + p.max + ': '), inp, btn, note); row.append(line);
      }
      box.append(row);
    });
  }
  async function refreshPublished() { const j = await api('/api/staff/daily-quests'); if (j.ok) drawPublished(j.quests || []); }
  async function saveSettings() {
    const examTopics = {};
    document.querySelectorAll('#dqTopicConfig input[type=checkbox]').forEach((i) => { if (i.checked) (examTopics[i.dataset.key] ||= []).push(i.value); });
    const out = await api('/api/staff/daily-quests/settings', { method: 'POST', body: JSON.stringify({ mode: $('#dqMode').value, questionCount: Number($('#dqCount').value), examTopics }) });
    $('#dqStaffNote').textContent = out.ok ? 'Quest plan saved. Exam mode uses the selected topics; general mode rotates through every banked topic.' : (out.problem || 'Could not save settings.');
  }
  async function generate() {
    const out = await api('/api/staff/daily-quests/generate', { method: 'POST', body: '{}' });
    $('#dqStaffNote').textContent = out.ok ? `Today's shared quests are ready. Newly created: ${out.created?.length || 0}.` : (out.problem || 'Could not generate quests.');
    await refreshPublished();
  }
  $('#dqSave')?.addEventListener('click', saveSettings); $('#dqGenerate')?.addEventListener('click', generate); $('#dqRefresh')?.addEventListener('click', () => { refreshPublished(); drawPhotos(); });
  window.openDailyPlanner = loadStaff;
})();
