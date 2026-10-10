// Marking quest page: photo (or typed) working -> AI reads it -> student checks -> AI drafts a mark.
// The marking guide never reaches this file; it stays on the server.
(() => {
  const $ = (s) => document.querySelector(s);
  let QUEST_ID = new URLSearchParams(location.hash.includes("?") ? location.hash.split("?")[1] : "").get("id") || localStorage.getItem("wr_quest_id") || "quadratic-basic";
  let loaded = false;
  let submissionId = localStorage.getItem("wr_last_submission") || "";
  let photos = []; // resized JPEG data URLs

  function mk(cls, text, tag) {
    const e = document.createElement(tag || "div");
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // model output is always shown as text, never HTML
    return e;
  }

  // Shrink a phone photo to about 1200 px on the long side, JPEG quality 0.8
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1200 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not open that picture."));
      };
      img.src = url;
    });
  }

  function drawThumbs() {
    const box = $("#qThumbs");
    box.innerHTML = "";
    photos.forEach((src, i) => {
      const w = mk("thumb");
      const im = document.createElement("img");
      im.src = src;
      im.alt = "Photo " + (i + 1) + " of your working";
      const x = mk("", "Remove", "button");
      x.type = "button";
      x.onclick = () => {
        photos.splice(i, 1);
        drawThumbs();
      };
      w.append(im, x);
      box.append(w);
    });
    $("#qRead").disabled = photos.length === 0;
  }

  async function post(body) {
    const r = await fetch("/api/mark", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wr-token": sessionStorage.getItem("wr_token") || "" },
      body: JSON.stringify(body),
    });
    return r.json().catch(() => ({ ok: false, problem: "The server sent a reply that could not be read." }));
  }

  // Show maths text safely: ^2 becomes a real superscript, everything else stays plain text
  function mathInto(node, text) {
    const re = /\^(\{[^}]*\}|-?[A-Za-z0-9]+)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      node.append(document.createTextNode(text.slice(last, m.index)));
      const sup = document.createElement("sup");
      sup.textContent = m[1].replace(/^\{|\}$/g, "");
      node.append(sup);
      last = re.lastIndex;
    }
    node.append(document.createTextNode(text.slice(last)));
    return node;
  }

  const KIND = {
    correct: { label: "" },
    error: { label: "Error", title: "Where it went wrong" },
    slip: { label: "Slip", title: "Right idea, fix the wording" },
    missing: { label: "Missing", title: "A step is missing" },
  };

  // Correction popup. Opened by tapping any line that is not green.
  let opener = null;
  function closePop() {
    const p = $("#qPop");
    if (p) p.remove();
    document.removeEventListener("keydown", onKey);
    if (opener) opener.focus();
    opener = null;
  }
  function onKey(e) {
    if (e.key === "Escape") closePop();
  }
  function openPop(kind, item, btn) {
    closePop();
    opener = btn;
    const back = mk("pop-back");
    back.id = "qPop";
    back.onclick = (e) => {
      if (e.target === back) closePop();
    };
    const card = mk("pop pop-" + kind);
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", KIND[kind].title);
    card.append(mk("pop-tag", KIND[kind].label), mk("", KIND[kind].title, "h3"));
    if (kind !== "missing") {
      card.append(mk("pop-k", "You wrote"), mathInto(mk("pop-line wrong"), item.text));
      card.append(mk("pop-k", "Should be"));
    } else {
      card.append(mk("pop-k", "Write this step"));
    }
    card.append(mathInto(mk("pop-line right"), item.fix || "Check this step again."));
    if (item.why) card.append(mk("pop-why", item.why));
    const x = mk("go", "Close", "button");
    x.type = "button";
    x.onclick = closePop;
    card.append(x);
    back.append(card);
    document.body.append(back);
    document.addEventListener("keydown", onKey);
    x.focus();
  }

  function legend() {
    const l = mk("legend");
    [["correct", "Correct"], ["error", "Where it went wrong"], ["slip", "Wording or notation"], ["missing", "Missing step"]].forEach(([k, t]) => {
      const i = mk("lg");
      i.append(mk("sw sw-" + k), mk("", t, "span"));
      l.append(i);
    });
    return l;
  }

  function showResult(res) {
    const box = $("#qResult");
    box.hidden = false;
    box.innerHTML = "";
    const chips = mk("chips");
    res.criteria.forEach((c) => chips.append(mk("chip " + (c.awarded === c.max ? "yes" : "no"), c.id + " " + c.awarded + "/" + c.max)));
    box.append(
      mk("", "Your draft mark", "h3"),
      mk("qbanner", "Draft mark. Awaiting tutor review. It is not final."),
      mk("qscore", res.total + " / " + res.max + " marks"),
      chips,
      legend(),
      mk("note", "Tap any coloured line to see the correction."),
    );
    const paper = mk("paper");
    const addMissing = (m) => {
      const b = mk("ln missing", null, "button");
      b.type = "button";
      b.append(mk("lt", "", "span"), mk("tg", KIND.missing.label, "span"));
      b.setAttribute("aria-label", "Missing step. Tap to see what to write.");
      b.onclick = () => openPop("missing", m, b);
      paper.append(b);
    };
    const gaps = res.missing || [];
    res.lines.forEach((l) => {
      gaps.filter((m) => m.before === l.n).forEach(addMissing);
      const clickable = l.status === "error" || l.status === "slip";
      const row = mk("ln " + l.status, null, clickable ? "button" : "div");
      if (clickable) {
        row.type = "button";
        row.onclick = () => openPop(l.status, l, row);
      }
      row.append(mathInto(mk("lt", "", "span"), l.text));
      if (clickable) row.append(mk("tg", KIND[l.status].label, "span"));
      paper.append(row);
    });
    gaps.filter((m) => m.before > res.lines.length).forEach(addMissing);
    box.append(paper);
    if (res.flags && res.flags.length) box.append(mk("note", "Flags for the tutor: " + res.flags.join("; ")));
    submissionId = res._submissionId || submissionId;
    if (submissionId) localStorage.setItem("wr_last_submission", submissionId);
    const status = mk("note", "Still awaiting tutor review. Your draft is not final.", "p");
    status.id = "qStatus";
    const check = mk("btn ghost sm", "Check tutor status", "button");
    check.type = "button";
    check.onclick = checkSubmission;
    box.append(check, status);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshQuestPicker() {
    const host = $("#qPicker");
    if (!host) return;
    try {
      const j = await (await fetch("/api/quests", { headers: { "x-wr-token": sessionStorage.getItem("wr_token") || "" } })).json();
      if (!Array.isArray(j.quests)) return;
      host.innerHTML="";
      const label=document.createElement("label"); label.className="qselect-label"; label.textContent="Quest";
      const sel=document.createElement("select"); sel.id="qSelect"; sel.className="qselect"; sel.setAttribute("aria-label","Choose marking quest");
      j.quests.forEach(q=>{ const o=document.createElement("option"); o.value=q.id; o.textContent=`${q.title} · ${q.level}`; o.selected=q.id===QUEST_ID; sel.append(o); });
      sel.onchange=()=>{ QUEST_ID=sel.value; localStorage.setItem("wr_quest_id",QUEST_ID); loaded=false; submissionId=""; localStorage.removeItem("wr_last_submission"); location.hash="quest"; location.reload(); };
      label.append(sel); host.append(label);
    } catch {}
  }
  async function checkSubmission() {
    const r=await fetch("/api/submission?id="+encodeURIComponent(submissionId),{headers:{"x-wr-token":sessionStorage.getItem("wr_token")||""}});
    const j=await r.json().catch(()=>({}));
    const box=$("#qStatus");
    if(!box) return;
    if(!j.ok){ box.textContent=""; return; }
    if(j.status==="released" && j.final) {
      box.textContent=`Tutor released: ${j.final.total} / ${j.final.max} marks${j.final.comment ? " — "+j.final.comment : ""}`;
      box.className="q-release";
    } else {
      box.textContent="Still awaiting tutor review. Your draft is not final.";
      box.className="note";
    }
  }
  async function openQuest() {
    if (loaded) return;
    try {
      const q = await (await fetch("/api/quest?id=" + encodeURIComponent(QUEST_ID), { headers: { "x-wr-token": sessionStorage.getItem("wr_token") || "" } })).json();
      if (!q.question) throw new Error();
      $("#qMeta").textContent = q.subject + " · " + q.level + " · " + q.total + " marks";
      $("#qTitle").textContent = q.title;
      $("#qText").innerHTML = q.question; // author-controlled HTML
      loaded = true;
      await refreshQuestPicker();
      if (submissionId) await checkSubmission();
    } catch {
      $("#qTitle").textContent = "Could not load the quest. Is the server running?";
    }
  }

  $("#qFile").onchange = async (e) => {
    const note = $("#qNote1");
    note.textContent = "Preparing photo...";
    try {
      for (const f of [...e.target.files].slice(0, 3 - photos.length)) photos.push(await shrink(f));
      note.textContent = photos.length >= 3 ? "Three photos is the most. Remove one to add another." : "";
    } catch (err) {
      note.textContent = err.message;
    }
    e.target.value = "";
    drawThumbs();
  };

  $("#qRead").onclick = async () => {
    const btn = $("#qRead");
    const note = $("#qNote1");
    btn.disabled = true;
    note.textContent = "Reading your handwriting...";
    const j = await post({ step: "transcribe", images: photos }).catch((e) => ({ ok: false, problem: e.message }));
    btn.disabled = photos.length === 0;
    if (!j.ok) {
      note.textContent = j.problem + (j.detail ? " (" + j.detail + ")" : "");
      return;
    }
    note.textContent = j.legibility === "good" ? "Read. Please check it." : "Some of it was hard to read (" + j.legibility + "). Check carefully.";
    $("#qBox").value = j.transcription;
    $("#qStep2").hidden = false;
    $("#qBox").focus();
  };

  $("#qType").onclick = () => {
    $("#qStep2").hidden = false;
    $("#qNote2").textContent = "";
    $("#qBox").focus();
  };

  $("#qMark").onclick = async () => {
    const btn = $("#qMark");
    const note = $("#qNote2");
    if (!$("#qBox").value.trim()) {
      note.textContent = "Write or paste your working first.";
      return;
    }
    btn.disabled = true;
    note.textContent = "Marking...";
    const j = await post({ step: "mark", questId: QUEST_ID, transcription: $("#qBox").value }).catch((e) => ({ ok: false, problem: e.message }));
    btn.disabled = false;
    if (!j.ok) {
      note.textContent = j.problem + (j.detail ? " (" + j.detail + ")" : "");
      return;
    }
    note.textContent = "";
    j.result._submissionId=j.id || ""; showResult(j.result);
  };

  window.openQuest = openQuest;
})();
