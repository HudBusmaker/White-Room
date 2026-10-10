/* White Room: Practice (question bank). Sets are built on the server per student; answers are marked
   on the server in code. The browser never receives an answer key. */
(function () {
  const { api, el, icon, fmt } = window.wr;
  const root = () => document.querySelector('#drillRoot');
  const M = window.WRMath;
  let overview = null, current = null;            // current = { set, answers }
  const KEY = (id) => 'wr_drill_' + id;
  const SUBJECT_ICON = { 'computer-science': 'dash', maths: 'target', 'further-maths': 'star', physics: 'bolt', chemistry: 'flame' };

  const math = (tag, cls, str) => { const n = el(tag, cls); M.text(n, str); return n; };
  const pips = (n, max = 5) => { const w = el('span', 'dr-pips'); w.setAttribute('role', 'img'); w.setAttribute('aria-label', 'Strength ' + n + ' of ' + max); for (let i = 0; i < max; i++) w.append(el('i', i < n ? 'on' : '')); return w; };
  const fmtDay = (iso) => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const say = (box, text, bad) => { box.textContent = text || ''; box.classList.toggle('err', !!bad); };

  window.openDrill = async function (arg) {
    const r = root(); if (!r) return;
    try { await M.ensure(); } catch { /* maths falls back to plain $...$ text */ }
    if (arg) return openSet(arg);
    return home();
  };

  /* ---------------- overview ---------------- */
  async function home() {
    const r = root(); r.textContent = ''; r.append(el('p', 'muted', 'Loading your practice...'));
    const [o, p] = await Promise.all([api('/api/practice/overview'), api('/api/practice/photos')]);
    if (!o.ok) { r.textContent = ''; r.append(el('p', 'err', o.problem || 'Could not load practice.')); return; }
    overview = o; r.textContent = '';
    const rec = o.subjects.find((s) => s.id === o.recommended);

    const start = el('article', 'card dr-start');
    start.append(el('small', 'eyebrow', 'Recommended next'));
    start.append(el('h2', '', rec ? rec.label : 'Practice'));
    start.append(el('p', 'muted', rec ? 'This is where your practice is needed most: topics you have not met yet come first, then your weakest.' : 'There are no practice questions yet.'));
    const note = el('p', 'dr-note');
    if (rec) {
      const go = el('button', 'btn primary', 'Start ' + rec.label + ' set'); go.type = 'button';
      go.onclick = () => begin(rec.id, go, note);
      start.append(go);
    }
    const others = o.subjects.filter((s) => s.drillable && s.id !== o.recommended);
    if (others.length) {
      const row = el('div', 'dr-chips'); row.append(el('span', 'muted', 'Or choose:'));
      others.forEach((s) => { const b = el('button', 'btn ghost sm', s.label); b.type = 'button'; b.onclick = () => begin(s.id, b, note); row.append(b); });
      start.append(row);
    }
    start.append(el('p', 'muted dr-xp', 'Practice XP today: ' + o.xp.today + ' / ' + o.xp.cap + '. Each question pays XP once, so repeats train you but do not pay.'), note);
    r.append(start);

    const mast = el('article', 'card');
    mast.append(el('div', 'card-head')); mast.firstChild.append(el('h3', '', 'Your mastery'), el('span', 'muted', 'Strength 0 to 5'));
    o.subjects.forEach((s) => {
      const d = el('details', 'dr-subj'); if (s.id === o.recommended) d.open = true;
      const sum = el('summary'); sum.append(el('b', '', s.label), pips(Math.round(s.avgStrength)), s.dueCount ? el('span', 'pill', s.dueCount + ' due') : el('span', 'muted', s.drillable ? '' : 'coming soon'));
      d.append(sum);
      s.topics.forEach((t) => {
        const row = el('div', 'dr-topic');
        const nm = el('span', 'dr-tname', t.name);
        const meta = !t.questions ? el('small', 'muted', 'no questions yet') : !t.lastSeen ? el('small', 'muted', 'new') : el('small', t.due ? 'dr-due' : 'muted', t.due ? 'due now' : 'next ' + fmtDay(t.nextDue));
        row.append(nm, pips(t.strength), meta); d.append(row);
      });
      mast.append(d);
    });
    r.append(mast);

    const ph = el('article', 'card');
    ph.append(el('div', 'card-head')); ph.firstChild.append(el('h3', '', 'Photo submissions'));
    const list = (p.ok && p.photos) || [];
    if (!list.length) ph.append(el('p', 'muted', 'When you send a photo of handwritten working, it appears here. Head Staff review it before you see a mark.'));
    list.forEach((x) => {
      const d = el('details', 'dr-photo');
      const sum = el('summary'); sum.append(el('b', '', x.topicName || x.questionId), el('span', 'pill', x.status === 'released' ? 'Released' : 'Awaiting review'));
      d.append(sum);
      if (x.status === 'released') {
        d.append(el('p', 'dr-final', 'Final mark: ' + x.final.total + ' / ' + x.final.max + (x.final.comment ? ' · ' + x.final.comment : '')));
        const body = el('div', 'dr-md'); body.innerHTML = M.md(x.correctionMd); d.append(body);
      } else d.append(el('p', 'muted', 'Sent ' + new Date(x.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '. Your result appears here once Head Staff release it.'));
      ph.append(d);
    });
    r.append(ph);
  }

  async function begin(subject, btn, noteBox) {
    btn.disabled = true; say(noteBox, 'Building your set...');
    const j = await api('/api/practice/set', { method: 'POST', body: JSON.stringify({ subject }) });
    btn.disabled = false;
    if (!j.ok) { say(noteBox, j.problem || 'Could not start a set.', true); return; }
    current = { set: j.set, answers: restore(j.set.id) };
    location.hash = '#drill/' + j.set.id;
  }

  /* ---------------- a set ---------------- */
  const restore = (id) => { try { return JSON.parse(sessionStorage.getItem(KEY(id)) || '{}'); } catch { return {}; } };
  const persist = () => { try { sessionStorage.setItem(KEY(current.set.id), JSON.stringify(current.answers)); } catch { /* private mode */ } };
  function remember(qid, key, val) { (current.answers[qid] ||= {})[key] = val; persist(); }

  async function openSet(id) {
    const r = root(); r.textContent = '';
    if (!current || current.set.id !== id) {
      r.append(el('p', 'muted', 'Loading your set...'));
      const j = await api('/api/practice/set?id=' + encodeURIComponent(id));
      r.textContent = '';
      if (!j.ok) { r.append(back(), el('p', 'err', j.problem || 'Set not found.')); return; }
      current = { set: j.set, answers: restore(id) };
    }
    drawSet();
  }
  const back = () => { const a = el('a', 'dr-back'); a.href = '#drill'; a.append(icon('arrow', 'flip'), document.createTextNode(' Practice')); return a; };

  function drawSet() {
    const { set } = current, r = root(); r.textContent = '';
    const marks = set.questions.reduce((n, q) => n + q.total, 0);
    const top = el('div', 'dr-top'); top.append(back(), el('b', '', set.subjectLabel + ' set'), el('span', 'pill', set.questions.length + ' questions · ' + marks + ' marks'));
    r.append(top);

    if (set.notes.length) {
      const nb = el('article', 'card dr-notes'); nb.append(el('small', 'eyebrow', 'Read first: new topics'));
      set.notes.forEach((n, i) => {
        const d = el('details', 'dr-notebox'); if (i === 0) d.open = true;
        d.append(el('summary', '', n.title)); const body = el('div', 'dr-md'); body.innerHTML = M.md(n.body); d.append(body); nb.append(d);
      });
      r.append(nb);
    }
    set.questions.forEach((q, i) => r.append(questionCard(q, i)));

    const foot = el('article', 'card dr-submit');
    const msg = el('p', 'dr-note');
    const go = el('button', 'btn primary block', 'Submit set'); go.type = 'button';
    foot.append(el('p', 'muted', 'A set counts only when you submit it. You can leave unknown parts blank.'), go, msg);
    go.onclick = () => submit(go, msg);
    r.append(foot);
  }

  function questionCard(q, idx) {
    const c = el('article', 'card dr-q'); c.id = 'q-' + q.id;
    const head = el('div', 'dr-qhead');
    head.append(el('b', '', 'Q' + (idx + 1)), el('span', 'dr-topicname', q.topicName), el('span', 'pill', q.total + (q.total > 1 ? ' marks' : ' mark')));
    c.append(head);
    const tags = el('div', 'dr-tags'); tags.append(el('span', 'chip', q.skillName)); if (q.role === 'compound') tags.append(el('span', 'chip warn', 'Revision: an earlier weak skill')); c.append(tags);
    c.append(math('p', 'dr-stem', q.stem));
    if (q.image) { const im = el('img', 'dr-img'); im.src = q.image; im.alt = 'Diagram for question ' + (idx + 1); c.append(im); }
    const saved = current.answers[q.id] || {};

    if (q.type === 'mcq') {
      const grp = el('div', 'dr-opts'); grp.setAttribute('role', 'radiogroup');
      q.options.forEach((o) => grp.append(optionRow(q.id, 'choice', o, saved.choice === o.id)));
      c.append(grp);
    } else {
      q.steps.forEach((s) => c.append(stepRow(q, s, saved[s.id])));
      c.append(photoBox(q));
    }
    return c;
  }
  function optionRow(qid, key, o, checked) {
    const lab = el('label', 'dr-opt');
    const inp = el('input'); inp.type = 'radio'; inp.name = qid + '-' + key; inp.value = o.id; inp.checked = !!checked;
    inp.onchange = () => remember(qid, key, o.id);
    lab.append(inp, el('b', '', o.id), math('span', 'dr-opttext', o.text));
    return lab;
  }
  function stepRow(q, s, val) {
    const w = el('div', 'dr-step');
    const lab = el('div', 'dr-steplab'); lab.append(el('b', '', '(' + s.id + ')'), math('span', '', s.prompt), el('em', '', s.marks + (s.marks > 1 ? ' marks' : ' mark')));
    w.append(lab);
    if (s.kind === 'choice') {
      const g = el('div', 'dr-opts'); g.setAttribute('role', 'radiogroup');
      s.options.forEach((o) => g.append(optionRow(q.id, s.id, o, val === o.id)));
      w.append(g);
    } else {
      const row = el('div', 'dr-inrow');
      const inp = el('input', 'dr-input'); inp.type = 'text'; inp.value = val || ''; inp.maxLength = 80;
      inp.autocomplete = 'off'; inp.autocapitalize = 'none'; inp.spellcheck = false; inp.setAttribute('autocorrect', 'off');
      inp.setAttribute('aria-label', 'Answer for part ' + s.id);
      inp.placeholder = s.kind === 'number' ? 'Number' + (s.unit ? ' (' + s.unit + ')' : '') : s.kind === 'sequence' ? 'e.g. 1 2 3' : 'Your answer';
      inp.oninput = () => remember(q.id, s.id, inp.value);
      row.append(inp);
      if (s.hint) {
        const hb = el('button', 'btn ghost sm', 'Hint'); hb.type = 'button';
        const ht = math('p', 'dr-hint', s.hint); ht.hidden = true;
        hb.onclick = () => { ht.hidden = !ht.hidden; hb.textContent = ht.hidden ? 'Hint' : 'Hide hint'; };
        row.append(hb); w.append(row, ht);
      } else w.append(row);
    }
    return w;
  }

  /* ---------------- submit ---------------- */
  async function submit(btn, msg) {
    const answers = {};
    current.set.questions.forEach((q) => { const a = current.answers[q.id]; if (a) answers[q.id] = a; });
    btn.disabled = true; say(msg, 'Marking...');
    const j = await api('/api/practice/submit', { method: 'POST', body: JSON.stringify({ setId: current.set.id, answers }) });
    if (!j.ok) { btn.disabled = false; say(msg, j.problem || 'Could not submit.', true); return; }
    try { sessionStorage.removeItem(KEY(current.set.id)); } catch { /* ignore */ }
    const set = current.set; current = null;
    drawResults(set, j);
    if (window.refreshAccount) window.refreshAccount();
  }

  const MARK = { correct: '\u2713', partial: '~', wrong: '\u2717', blank: '\u2013' };
  function drawResults(set, j) {
    const r = root(); r.textContent = ''; window.scrollTo(0, 0);
    r.append(back());
    const s = j.summary, sum = el('article', 'card dr-score');
    sum.append(el('small', 'eyebrow', set.subjectLabel + ' set marked'), el('h2', '', s.got + ' / ' + s.total), el('p', 'muted', s.pct + '% correct'));
    const chips = el('div', 'chips'); chips.append(el('span', 'chip', '+' + s.xp + ' XP' + (s.xpCapped ? ' (daily cap reached)' : '')));
    sum.append(chips);
    if (j.mastery.length) {
      const m = el('div', 'dr-mastery');
      j.mastery.forEach((x) => {
        const arrow = x.to > x.from ? 'up' : x.to < x.from ? 'down' : 'same';
        const line = el('p', 'dr-m ' + arrow);
        line.textContent = x.name + ': strength ' + x.from + (x.to === x.from ? ' (unchanged)' : ' \u2192 ' + x.to) + '. ' +
          (x.gated ? 'You practised this before it was due, so it cannot rise yet; it is next due ' + fmtDay(x.nextDue) + '.' : 'Practise again on ' + fmtDay(x.nextDue) + '.');
        m.append(line);
      });
      sum.append(m);
    }
    r.append(sum);

    j.results.forEach((res, i) => {
      const q = set.questions.find((x) => x.id === res.id); if (!q) return;
      const c = el('article', 'card dr-q'); const head = el('div', 'dr-qhead');
      head.append(el('b', '', 'Q' + (i + 1)), el('span', 'dr-topicname', q.topicName), el('span', 'pill ' + (res.awarded === res.total ? 'good' : res.awarded ? 'mid' : 'bad'), res.awarded + ' / ' + res.total));
      c.append(head, math('p', 'dr-stem', q.stem));
      if (res.type === 'mcq') {
        const right = q.options.find((o) => o.id === res.correctId);
        if (res.status === 'correct') c.append(el('p', 'dr-ok', MARK.correct + ' Correct: ' + res.correctId));
        else {
          c.append(el('p', 'dr-bad', (res.status === 'blank' ? MARK.blank + ' No answer. ' : MARK.wrong + ' You chose ' + res.chosen + '. ') + 'The answer is ' + res.correctId + '.'));
          if (res.trap) c.append(math('p', 'dr-trap', 'Why that option is tempting: ' + res.trap));
        }
        c.append(math('p', 'dr-answer', res.correctId + '. ' + right.text));
      } else {
        res.steps.forEach((st) => {
          const qs = q.steps.find((x) => x.id === st.id);
          const row = el('div', 'dr-res ' + st.status);
          const top = el('div', 'dr-restop'); top.append(el('b', '', MARK[st.status] + ' (' + st.id + ')'), math('span', '', qs.prompt), el('em', '', st.awarded + '/' + st.max));
          row.append(top);
          if (st.status !== 'correct') {
            if (st.answer !== undefined) row.append(el('p', 'dr-answer', 'Answer: ' + st.answer));
            if (st.note) row.append(el('p', 'dr-trap', st.note));
          }
          c.append(row);
        });
      }
      r.append(c);
    });
    const acts = el('div', 'dr-acts');
    const next = el('button', 'btn primary', 'Next set'); next.type = 'button';
    const nm = el('p', 'dr-note');
    next.onclick = () => begin(set.subject === overview?.recommended || !overview ? set.subject : set.subject, next, nm);
    const home2 = el('a', 'btn ghost', 'Back to Practice'); home2.href = '#drill';
    acts.append(next, home2); r.append(acts, nm);
  }

  /* ---------------- photo instead of typing ---------------- */
  function shrink(file) {
    return new Promise((ok, no) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { const k = Math.min(1, 1200 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.8)); };
      img.onerror = () => { URL.revokeObjectURL(url); no(new Error('That file is not a readable image.')); };
      img.src = url;
    });
  }
  function photoBox(q) {
    const d = el('details', 'dr-photobox');
    d.append(el('summary', '', 'Prefer to write it on paper? Send a photo instead'));
    if (q.photoSent) { d.append(el('p', 'dr-ok', 'A photo for this question is with Head Staff. Check Practice for the result.')); return d; }
    d.append(el('p', 'muted', 'Photograph your full working (1 to 3 photos). An AI drafts a mark, then Head Staff check it. You see the result after they release it.'));
    const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.multiple = true;
    const msg = el('p', 'dr-note'), btn = el('button', 'btn ghost sm', 'Send photo for marking'); btn.type = 'button';
    btn.onclick = async () => {
      const files = [...file.files].slice(0, 3);
      if (!files.length) { say(msg, 'Choose a photo first.', true); return; }
      btn.disabled = true; say(msg, 'Preparing photos...');
      try {
        const images = await Promise.all(files.map(shrink));
        say(msg, 'Sending to be marked. This can take a minute...');
        const j = await api('/api/practice/photo', { method: 'POST', body: JSON.stringify({ setId: current.set.id, questionId: q.id, images }) });
        if (!j.ok) { btn.disabled = false; say(msg, j.problem || 'Could not send the photo.', true); return; }
        q.photoSent = true; say(msg, j.message || 'Sent to Head Staff.'); file.disabled = true;
      } catch (e) { btn.disabled = false; say(msg, e.message, true); }
    };
    d.append(file, btn, msg); return d;
  }
})();
