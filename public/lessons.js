(() => {
  const $ = (s) => document.querySelector(s);
  const el = (cls, html, tag) => {
    const e = document.createElement(tag || "div");
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const calm = matchMedia("(prefers-reduced-motion:reduce)").matches;

  /* ---------- saved progress (this phone only) ---------- */
  const KEY = "wr_progress";
  const store = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(KEY) || "{}");
      } catch {
        return {};
      }
    },
    save(o) {
      try {
        localStorage.setItem(KEY, JSON.stringify(o));
      } catch {}
    },
  };

  /* ---------- lesson list ---------- */
  const DAY = 86400000;
  const LIFE_DAYS = 10;
  let lessons = [];
  let expiredCount = 0;
  let skew = 0; // server clock minus this device's clock, so a wrong phone clock can't reopen a note
  const nowMs = () => Date.now() + skew;
  let loaded = false;
  let pending = null;
  const GLYPHS = ["α", "∑", "π", "ƒ", "∫", "√"];
  const COLORS = ["green", "blue", "violet", "orange", "cyan", "gold"];

  const when = (iso) =>
    new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const today = () => dayKey(new Date(nowMs()));

  const relOf = (l) => (l.release ? Date.parse(l.release) : NaN);
  const expOf = (l) => (l.expires ? Date.parse(l.expires) : Number.isFinite(relOf(l)) ? relOf(l) + LIFE_DAYS * DAY : Infinity);
  function leftText(l) {
    const ms = expOf(l) - nowMs();
    if (!isFinite(ms)) return "No expiry";
    if (ms < 3600000) return "Expires in under an hour";
    if (ms < DAY) return "Expires in " + Math.floor(ms / 3600000) + "h";
    const d = Math.floor(ms / DAY);
    return "Expires in " + d + " day" + (d === 1 ? "" : "s");
  }

  function stateOf(l, done) {
    if (done[l.id] && done[l.id].done) return "done";
    const r = relOf(l), n = nowMs();
    if (l.locked || (Number.isFinite(r) && n < r)) return "scheduled";
    if (expOf(l) - n < 2 * DAY) return "soon";
    if (Number.isFinite(r) && n - r < 2 * DAY) return "new";
    return "open";
  }
  const STATE_LABEL = { new: "New", open: "To complete", soon: "Expiring soon", scheduled: "Scheduled", done: "Completed" };
  const STATE_CLASS = { new: "live", open: "todo", soon: "missed", scheduled: "scheduled", done: "done" };
  const ORDER = { soon: 0, new: 1, open: 2, scheduled: 3, done: 4 };
  const isOpen = (st) => st === "new" || st === "open" || st === "soon";
  const alive = (l) => expOf(l) > nowMs();

  function lessonRow(l, st, done) {
    const idx = Math.max(0, lessons.indexOf(l));
    let acts = "";
    if (isOpen(st)) acts = '<a class="btn primary sm" href="#lesson/' + esc(l.id) + '">Start</a>';
    else if (st === "scheduled") acts = '<span class="lock">Opens ' + when(l.release) + "</span>";
    else if (l.format === "section-document") acts = '<a class="link" href="#lesson/' + esc(l.id) + '">Read again</a>';
    else acts = '<a class="btn ghost sm" href="#practice/' + esc(l.id) + '">Exercises</a><a class="link" href="#lesson/' + esc(l.id) + '">Redo</a>';
    const doneText = st !== "done" ? "" : l.format === "section-document" || !done[l.id] ? "Completed on this device · " + leftText(l) : done[l.id].marks + " / " + done[l.id].max + " marks · " + leftText(l);
    const sub = [l.subject, l.level, st === "done" ? doneText : st === "scheduled" ? "Opens " + when(l.release) : leftText(l)].filter(Boolean).join(" · ");
    return el(
      "card lesson-row",
      '<span class="tile ' + COLORS[idx % COLORS.length] + '" aria-hidden="true">' + GLYPHS[idx % GLYPHS.length] + "</span>" +
        '<div class="lr-body"><h4>' + esc(l.title) + '</h4><p class="muted">' + esc(sub) + "</p></div>" +
        '<span class="pill state-' + STATE_CLASS[st] + '">' + STATE_LABEL[st] + "</span>" +
        '<div class="acts">' + acts + "</div>",
      "article",
    );
  }

  function fillFilters() {
    const fill = (sel, vals) => {
      const s = $(sel);
      [...new Set(vals.filter(Boolean))].sort().forEach((v) => { const o = document.createElement("option"); o.value = v; o.textContent = v; s.append(o); });
    };
    fill("#lessonSubject", lessons.map((l) => l.subject));
    fill("#lessonLevel", lessons.map((l) => l.level));
    ["#lessonSearch", "#lessonSubject", "#lessonLevel"].forEach((s) => $(s).addEventListener("input", renderList));
  }

  function renderList() {
    const box = $("#lessonList");
    if (!box) return;
    const done = store.get();
    const q = $("#lessonSearch").value.trim().toLowerCase();
    const sub = $("#lessonSubject").value;
    const lvl = $("#lessonLevel").value;
    const items = lessons
      .filter(alive)
      .map((l) => ({ l, st: stateOf(l, done) }))
      .filter(({ l }) => (!q || (l.title + " " + (l.subject || "")).toLowerCase().includes(q)) && (!sub || l.subject === sub) && (!lvl || l.level === lvl))
      .sort((a, b) => ORDER[a.st] - ORDER[b.st] || expOf(a.l) - expOf(b.l));
    box.innerHTML = "";
    if (!items.length) box.append(el("card", '<p class="muted">' + (lessons.length || expiredCount ? "No notes match. Try clearing the search or filters." : "No notes yet. Your tutor will add some soon.") + "</p>"));
    items.forEach(({ l, st }) => box.append(lessonRow(l, st, done)));
    if (expiredCount) box.append(el("", '<p class="muted small">' + expiredCount + " older note" + (expiredCount === 1 ? " has" : "s have") + " expired (notes stay open for " + LIFE_DAYS + " days).</p>"));
  }

  /* days (Mon..Sun of this week) on which the student finished something */
  function doneDays() {
    const days = new Set();
    Object.values(store.get()).forEach((v) => v && v.done && v.when && days.add(dayKey(new Date(v.when))));
    const me = window.__wrMe && window.__wrMe();
    ((me && me.achievements) || []).forEach((a) => /^(lesson|quest)-/.test(a.id) && a.at && days.add(dayKey(new Date(a.at))));
    return days;
  }
  function renderCalendar() {
    const box = $("#calendar");
    if (!box) return;
    const now = new Date(nowMs());
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const days = doneDays();
    box.innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      const key = dayKey(d);
      const cls = "day" + (days.has(key) ? " done" : "") + (key === today() ? " today" : "") + (key > today() ? " future" : "");
      box.append(el(cls, "<small>" + d.toLocaleDateString("en-GB", { weekday: "short" }) + "</small><b>" + d.getDate() + '</b><span class="mark"><svg class="i"><use href="#i-check"/></svg></span>'));
    }
    $("#calWeek").textContent = mon.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " – " + new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function tickReset() {
    const c = $("#resetClock");
    if (!c) return;
    const n = new Date(nowMs());
    const ms = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1) - n;
    c.textContent = Math.floor(ms / 3600000) + "h " + String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0") + "m";
  }
  setInterval(tickReset, 30000);

  function refresh() {
    if (!loaded) return;
    const done = store.get();
    const by = { new: [], open: [], soon: [], scheduled: [], done: [] };
    lessons.filter(alive).forEach((l) => by[stateOf(l, done)].push(l));
    const byExpiry = (a, b) => expOf(a) - expOf(b);
    by.scheduled.sort((a, b) => relOf(a) - relOf(b));
    renderList();

    /* dashboard: continue learning (soonest to expire first) */
    const open = by.soon.concat(by.new, by.open).sort(byExpiry);
    const next = open[0] || by.scheduled[0];
    if ($("#contTitle")) {
      if (next) {
        const nst = stateOf(next, done);
        $("#contTitle").textContent = next.title;
        $("#contSub").textContent = [next.subject, nst === "scheduled" ? "Opens " + when(next.release) : leftText(next)].filter(Boolean).join(" · ");
        $("#contBtn").href = nst === "scheduled" ? "#lessons" : "#lesson/" + next.id;
        $("#contBtn").firstChild.textContent = nst === "scheduled" ? "View notes " : "Continue ";
      } else {
        $("#contTitle").textContent = lessons.length ? "You're all caught up" : "No notes yet";
        $("#contSub").textContent = lessons.length ? "Redo a recent note or try the exercises." : "Your tutor will add notes soon.";
        $("#contBtn").href = "#lessons";
        $("#contBtn").firstChild.textContent = "Browse notes ";
      }
    }

    /* today's quest (dashboard card + quest page) */
    const todays = lessons.filter((l) => l.daily === today() && alive(l) && !l.locked);
    const pendingQ = todays.filter((l) => stateOf(l, done) !== "done");
    const q = pendingQ[0];
    const set = (title, sub, href, btn) => {
      ["dq", "tq"].forEach((p) => {
        // the old "tq" quest card was replaced by the Daily Quest engine, so each element may be missing
        const t = $("#" + p + "Title"), u = $("#" + p + "Sub"), b = $("#" + p + "Btn");
        if (t) t.textContent = title;
        if (u) u.textContent = sub;
        if (b) { b.href = href; b.textContent = btn; }
      });
    };
    if (q) set(q.title, [q.subject, "Up to 100 XP"].filter(Boolean).join(" · "), "#lesson/" + q.id, "Start Quest");
    else if (todays.length) set("Quest complete", "You finished today's quest. Nice work.", "#lessons", "Browse notes");
    else set("No quest set today", "Your tutor has not set a daily note yet.", "#lessons", "Browse notes");
    const me = window.__wrMe && window.__wrMe();
    if ($("#tqStreak")) $("#tqStreak").lastChild.textContent = ((me && me.stats && me.stats.streak) || 0) + " day streak";
    renderCalendar();
    tickReset();

    const todo = $("#tTodo");
    if (todo) {
      todo.innerHTML = "";
      const list = open;
      if (!list.length) todo.append(el("empty", "Nothing waiting. Great work.", "p"));
      list.forEach((l) => todo.append(el("mini", '<div><b>' + esc(l.title) + "</b><small>" + esc(leftText(l)) + "</small></div>" + '<span class="btn primary sm">Start</span>', "a")));
      todo.querySelectorAll("a.mini").forEach((a, i) => { a.href = "#lesson/" + list[i].id; });
    }
  }

  /* ---------- session screen ---------- */
  function setMarks(got, max) {
    $("#sMarks").textContent = got + " / " + max + " marks";
  }
  function setProg(f) {
    $("#sProg").style.width = Math.round(f * 100) + "%";
  }
  function clearWork(title) {
    $("#sLines").innerHTML =
      '<p class="muted" id="sEmpty">Each block you finish is written here, line by line.</p>';
    $("#sWorkTitle").textContent = title;
  }
  function dropEmpty() {
    const e = $("#sEmpty");
    if (e) e.remove();
  }
  function say(html) {
    $("#sCur").innerHTML = "";
    $("#sCur").append(el("blk", html));
  }

  function buildTask(k, onOk) {
    const t = el("task");
    const fb = el("");
    fb.setAttribute("aria-live", "polite");
    let wrong = 0;
    t.append(el("tq", k.q));
    const ok = (msg) => {
      t.classList.add("ok");
      const extra = k.explain
        ? '<div class="explain">' + k.explain + "</div>"
        : "";
      fb.className = "fb good";
      fb.innerHTML = msg + extra;
      t.querySelectorAll("button,input").forEach((x) => {
        x.disabled = true;
      });
      onOk(wrong === 0);
    };
    const bad = (msg) => {
      fb.className = "fb bad";
      fb.innerHTML = msg;
    };

    if (k.t === "mc") {
      const o = el("opts");
      k.o.forEach((txt, n) => {
        const b = el("opt", txt, "button");
        b.onclick = () => {
          if (n === k.a) {
            b.classList.add("ok");
            o.querySelectorAll("button").forEach((x) => {
              x.disabled = true;
            });
            ok("Correct. " + k.why[n]);
          } else {
            wrong++;
            b.classList.add("no");
            b.disabled = true;
            bad("Not quite. " + k.why[n] + " Try another.");
          }
        };
        o.append(b);
      });
      t.append(o);
    } else {
      const r = el("row");
      const ins = [];
      k.f.forEach((f) => {
        const i = el("", null, "input");
        i.inputMode = "text";
        i.autocomplete = "off";
        i.setAttribute("aria-label", f.l);
        ins.push(i);
        r.append(el("", esc(f.l) + " =", "label"), i);
      });
      const c = el("go", "Check", "button");
      c.onclick = () => {
        const v = ins.map((x) =>
          parseFloat(x.value.replace(/[−–]/g, "-").replace(",", ".")),
        );
        if (v.some(isNaN)) return bad("Enter a number in each box.");
        if (v.every((n, q) => Math.abs(n - k.f[q].v) < 1e-6))
          return ok("Correct. " + (k.ex || ""));
        wrong++;
        bad(
          (k.fb && (k.fb[v.join(",")] || k.fb[String(v[0])])) ||
            "Not quite. Check each value.",
        );
        if (wrong > 1) {
          const rv = el("alt", "Show the answer", "button");
          rv.onclick = () => {
            ins.forEach((x, q) => {
              x.value = k.f[q].v;
            });
            ok("Answer shown. " + (k.ex || ""));
          };
          fb.append(el("", "", "br"), rv);
        }
      };
      r.append(c);
      t.append(r);
    }
    t.append(fb);
    return t;
  }

  // One solution card. Each finished block is a shaded section inside it:
  // yellow, green, blue, then the cycle repeats. No separate cards or headers.
  function reveal(i, title, got, max, lines) {
    dropEmpty();
    const box = $("#sLines");
    let card = box.querySelector(".wcard");
    if (!card) {
      card = el("wcard");
      box.append(card);
    }
    card.querySelectorAll(".new").forEach((x) => x.classList.remove("new"));
    const s = el("ws c" + (i % 3) + " new");
    s.setAttribute("aria-label", title.replace(/<[^>]+>/g, "") + ": " + got + " of " + max + " marks");
    lines.forEach((t, k) => {
      const l = el("wl" + (k === lines.length - 1 ? " res" : ""), t);
      l.style.animationDelay = (calm ? 0 : k * 350) + "ms";
      s.append(l);
    });
    card.append(s);
    setTimeout(
      () =>
        $("#sWork").scrollTo({
          top: $("#sWork").scrollHeight,
          behavior: calm ? "auto" : "smooth",
        }),
      calm ? 0 : lines.length * 350,
    );
  }

  /* A different, checked example every time; multiple-choice answers in a random order. */
  const W = WRLesson; // global from lesson-engine.js
  function shuffleTask(k) {
    if (k.t !== "mc" || !Array.isArray(k.o)) return k;
    const order = W.shuffle(k.o.map((_, i) => i));
    return { ...k, o: order.map((i) => k.o[i]), why: order.map((i) => (k.why || [])[i] || ""), a: order.indexOf(k.a) };
  }
  const prepare = (spec) => { const x = W.instantiate(spec); (x.tasks || [x]).forEach((t, i, arr) => { arr[i] = shuffleTask(t); if (!x.tasks) Object.assign(x, arr[0]); }); return x; };

  function finishLesson(L, earned, total) {
    const p = store.get();
    if (!p[L.id] || earned >= p[L.id].marks) p[L.id] = { done: true, marks: earned, max: total, when: Date.now() };
    store.save(p);
    const e = el("end", "<b>Notes complete.</b> Marks on the first try: <b>" + earned + " of " + total + '</b>.<div class="acts"></div><p class="muted small" id="sPost"></p>');
    fetch("/api/activity/lesson", { method: "POST", headers: { "content-type": "application/json", "x-wr-token": sessionStorage.getItem("wr_token") || "" }, body: JSON.stringify({ lessonId: L.id, marks: earned, max: total }) })
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) window.refreshAccount && window.refreshAccount(); else if (j && j.problem) e.querySelector("#sPost").textContent = j.problem; })
      .catch(() => {});
    const acts = e.querySelector(".acts");
    if (L.exercises && L.exercises.length) {
      const pr = el("btn blue", "Try the exercises", "a");
      pr.href = "#practice/" + L.id;
      acts.append(pr);
    }
    const back = el("btn white", "Back to notes", "a");
    back.href = "#lessons";
    acts.append(back);
    $("#sCur").append(e);
  }

  function runNotes(L) {
    const cur = $("#sCur");
    const notes = L.notes || [];
    const total = notes.reduce((a, n) => a + (n.tasks || []).reduce((x, t) => x + (t.m || 1), 0), 0);
    let earned = 0;
    setMarks(0, total);

    function note(i) {
      let b;
      try { b = prepare(notes[i]); } catch (err) { return say("<b>This note could not be built.</b> " + esc(err.message) + ' <a class="link" href="#lessons">Back</a>'); }
      cur.innerHTML = "";
      setProg(i / notes.length);
      const c = el("blk");
      c.append(el("meta", "Note " + (i + 1) + " of " + notes.length), el("", b.title, "h2"), el("note-text", b.text || ""));
      if (Array.isArray(b.points) && b.points.length) {
        const ul = document.createElement("ul");
        ul.className = "step-list";
        b.points.forEach((pt) => { const li = document.createElement("li"); li.innerHTML = pt; ul.appendChild(li); });
        c.append(ul);
      }
      if (b.hint) {
        const hb = el("alt", "Hint", "button");
        const hx = el("");
        hb.onclick = () => { hx.className = "fb hint"; hx.innerHTML = b.hint; };
        c.append(hb, hx);
      }
      let got = 0, done = 0;
      const max = b.tasks.reduce((a, k) => a + (k.m || 1), 0);
      b.tasks.forEach((k) =>
        c.append(
          buildTask(k, (first) => {
            if (first) got += k.m || 1;
            if (++done < b.tasks.length) return;
            earned += got;
            setMarks(earned, total);
            reveal(i, b.title, got, max, b.working || []);
            setProg((i + 1) / notes.length);
            if (i < notes.length - 1) {
              const nx = el("go", "Next note", "button");
              nx.onclick = () => note(i + 1);
              c.append(nx);
              nx.focus();
            } else finishLesson(L, earned, total);
          }),
        ),
      );
      cur.append(c);
      $("#sPrompt").scrollTop = 0;
    }
    note(0);
  }

  function runPractice(L) {
    const cur = $("#sCur");
    let ex = [];
    try { ex = (L.exercises || []).map(prepare); } catch (err) { return say("<b>The exercises could not be built.</b> " + esc(err.message)); }
    if (!ex.length) return say("<b>No exercises yet</b> for this note.");
    const total = ex.reduce((a, k) => a + (k.m || 1), 0);
    let earned = 0;
    setMarks(0, total);

    function q(i) {
      const k = ex[i];
      cur.innerHTML = "";
      setProg(i / ex.length);
      const c = el("blk");
      c.append(el("meta", "Exercise " + (i + 1) + " of " + ex.length));
      c.append(
        buildTask(k, (first) => {
          if (first) earned += k.m || 1;
          setMarks(earned, total);
          reveal(i, "Exercise " + (i + 1), first ? k.m || 1 : 0, k.m || 1, [
            k.ex || k.why[k.a],
          ]);
          setProg((i + 1) / ex.length);
          if (i < ex.length - 1) {
            const nx = el("go", "Next exercise", "button");
            nx.onclick = () => q(i + 1);
            c.append(nx);
            nx.focus();
          } else {
            const e = el(
              "end",
              "<b>Exercises done.</b> First-try marks: <b>" +
                earned +
                " of " +
                total +
                '</b>.<div class="acts"></div>',
            );
            const back = el("btn white", "Back to completed", "a");
            back.href = "#completed";
            e.querySelector(".acts").append(back);
            cur.append(e);
          }
        }),
      );
      cur.append(c);
    }
    q(0);
  }

  async function openLesson(id, mode) {
    if (!loaded) {
      pending = [id, mode];
      return;
    }
    const l = lessons.find((x) => x.id === id);
    $("#session").classList.remove("section-document-session");
    $("#sWork").hidden = false;
    $("#sTitle").textContent = l ? l.title : "Note";
    $("#sMarks").textContent = "";
    setProg(0);
    clearWork(mode === "practice" ? "Your answers" : "Your working");
    $("#sQBox").style.display = "none";
    const back = ' <a class="link" href="#lessons">Back to notes</a>';
    if (!l) return say("<b>That note was not found.</b> It may have expired." + back);
    if (!alive(l)) return say("<b>This note has expired.</b> Notes stay open for " + LIFE_DAYS + " days after they are released." + back);
    if (stateOf(l, store.get()) === "scheduled") return say("<b>Not open yet.</b> This note opens " + when(l.release) + "." + back);
    say("Loading note...");
    let L;
    try {
      const r = await fetch("content/lessons/" + l.file, { cache: "no-store" });
      if (r.status === 410) return say("<b>This note has expired.</b> Notes stay open for " + LIFE_DAYS + " days after they are released." + back);
      if (r.status === 403) return say("<b>Not open yet.</b> Check back later." + back);
      L = await r.json();
    } catch {
      return say("<b>Could not load this note.</b> Check your connection and try again." + back);
    }
    if (mode === "practice") return runPractice(L);
    if (l.format === "section-document") {
      if (!window.WRSectionLesson || !Array.isArray(L.sections)) {
        return say("<b>This revision document could not be displayed.</b> Check its format and try again." + back);
      }
      $("#sQBox").style.display = "none";
      $("#session").classList.add("section-document-session");
      $("#sWork").hidden = true;
      $("#sMarks").textContent = "Revision notes · No XP";
      clearWork("Revision notes");
      const saved = store.get();
      window.WRSectionLesson.render($("#sCur"), L, {
        completed: !!(saved[L.id] && saved[L.id].done),
        onComplete() {
          const progress = store.get();
          progress[L.id] = { done: true, when: Date.now() };
          store.save(progress);
          setProg(1);
          renderList();
        },
      });
      return;
    }
    $("#sQuestion").innerHTML = L.summary || "";
    $("#sQBox").style.display = L.summary ? "" : "none";
    runNotes(L);
  }

  window.openLesson = openLesson;
  window.refreshLessons = refresh;

  fetch("content/lessons/index.json", { cache: "no-store" })
    .then((r) => r.json())
    .then((m) => {
      if (m.now) skew = Number(m.now) - Date.now();
      lessons = m.lessons || [];
      expiredCount = m.expiredCount || 0;
      loaded = true;
      fillFilters();
      refresh();
      setInterval(refresh, 60000);
      if (pending) {
        const p = pending;
        pending = null;
        openLesson(p[0], p[1]);
      }
    })
    .catch(() => {
      $("#lessonList").innerHTML = '<div class="card"><p class="muted">Could not load the notes. Check your connection and try again.</p></div>';
    });
})();
