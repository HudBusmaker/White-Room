/* White Room: level + subject picker, used at registration, on the Profile page and on the Daily Quest page.
   The server decides what each level offers (engine/subjects.json); this file only draws it. */
(() => {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let catalog = null;
  async function load() {
    if (catalog) return catalog;
    try { const j = await (await fetch('/api/catalog')).json(); if (j.ok) catalog = j.levels; } catch { /* offline: picker stays empty */ }
    return catalog || [];
  }
  // mount(box, { level, subjects }) -> { get() -> { level, subjects[] }, onChange }
  async function mount(box, initial = {}) {
    const levels = await load();
    box.replaceChildren();
    const state = { level: initial.level && levels.some((l) => l.id === initial.level) ? initial.level : '', subjects: new Set(initial.subjects || []) };
    const api = { onChange: null, get: () => ({ level: state.level, subjects: [...state.subjects] }) };
    const changed = () => api.onChange && api.onChange(api.get());
    const lv = el('fieldset', 'field sp-level'); lv.append(el('legend', '', 'Level'));
    const row = el('div', 'radios');
    levels.forEach((l) => {
      const lab = el('label', 'radio'); const r = el('input'); r.type = 'radio'; r.name = 'sp-level-' + (box.id || 'x'); r.value = l.id; r.checked = state.level === l.id;
      r.addEventListener('change', () => { state.level = l.id; const ok = new Set(l.subjects.map((s) => s.id)); [...state.subjects].forEach((s) => { if (!ok.has(s)) state.subjects.delete(s); }); draw(); changed(); });
      lab.append(r, el('i'), document.createTextNode(l.label)); row.append(lab);
    });
    lv.append(row);
    const sf = el('fieldset', 'field sp-subjects'); const legend = el('legend', '', 'Subjects you are offering'); sf.append(legend);
    const grid = el('div', 'sp-grid'); sf.append(grid, el('small', 'hint', 'Tick every subject you study. You can change this later on your Profile.'));
    function draw() {
      grid.replaceChildren();
      const l = levels.find((x) => x.id === state.level);
      if (!l) { grid.append(el('p', 'muted', 'Choose your level first.')); return; }
      l.subjects.forEach((s) => {
        const lab = el('label', 'sp-chip'); const c = el('input'); c.type = 'checkbox'; c.value = s.id; c.checked = state.subjects.has(s.id);
        c.addEventListener('change', () => { if (c.checked) state.subjects.add(s.id); else state.subjects.delete(s.id); changed(); });
        lab.append(c, el('span', '', s.label)); grid.append(lab);
      });
    }
    draw(); box.append(lv, sf);
    return api;
  }
  window.WRSubjects = { load, mount };

  // ----- registration form -----
  let regPicker = null;
  const regBox = document.getElementById('regPicker');
  if (regBox) mount(regBox, {}).then((p) => { regPicker = p; });
  window.WRRegisterChoice = () => (regPicker ? regPicker.get() : { level: '', subjects: [] });

  // ----- profile: "My level and subjects" -----
  let profPicker = null;
  async function drawProfileSubjects() {
    const box = document.getElementById('profileSubjects'); if (!box) return;
    const me = window.__wrMe && window.__wrMe(); if (!me || me.role !== 'student') return;
    profPicker = await mount(box, { level: me.levelKey, subjects: me.subjects });
  }
  document.getElementById('saveSubjects')?.addEventListener('click', async () => {
    const note = document.getElementById('subjectsNote'); const pick = profPicker && profPicker.get();
    if (!pick) return;
    note.textContent = 'Saving…';
    const j = await window.wr.api('/api/me/subjects', { method: 'POST', body: JSON.stringify(pick) });
    note.textContent = j.ok ? 'Saved. Your daily quests now match these subjects.' : (j.problem || 'Could not save.');
    if (j.ok && window.refreshAccount) { await window.refreshAccount(); if (window.openDailyQuest) window.openDailyQuest(); }
  });
  window.drawProfileSubjects = drawProfileSubjects;
})();
