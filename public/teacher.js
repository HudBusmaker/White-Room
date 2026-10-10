// Tutor review queue. PIN is exchanged for a short-lived in-memory token.
(() => {
  const $ = s => document.querySelector(s);
  let token = sessionStorage.getItem("wr_teacher_token") || "";

  function escText(v) { return String(v ?? ""); }
  function mk(tag, cls, text) {
    const e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e;
  }
  async function api(url, options={}) {
    const headers={"content-type":"application/json",...(options.headers||{})};
    if(token) headers["x-teacher-token"]=token;
    const r=await fetch(url,{...options,headers});
    const j=await r.json().catch(()=>({ok:false,problem:"Unreadable server response."}));
    if(r.status===401){ token=""; sessionStorage.removeItem("wr_teacher_token"); }
    return j;
  }
  function showLogin(note="") {
    $("#teacherLogin").hidden=false; $("#teacherQueue").hidden=true; $("#teacherLoginNote").textContent=note;
  }
  async function login() {
    const pin=$("#teacherPin").value;
    if(!pin){ $("#teacherLoginNote").textContent="Enter the teacher PIN."; return; }
    const j=await api("/api/teacher/login",{method:"POST",body:JSON.stringify({pin})});
    if(!j.ok){ $("#teacherLoginNote").textContent=j.problem||"Login failed."; return; }
    token=j.token; sessionStorage.setItem("wr_teacher_token",token);
    $("#teacherPin").value=""; await loadQueue();
  }
  function renderItem(item) {
    const card=mk("article","review-card");
    const q=mk("div","review-head");
    q.append(mk("div","",item.questId),mk("time","",new Date(item.time).toLocaleString()));
    card.append(q);
    card.append(mk("h3","",item.status==="released"?"Released":"Awaiting tutor review"));
    const score=mk("div","review-score",`${item.result.total} / ${item.result.max} draft marks`);
    card.append(score);
    const criteria=mk("div","review-criteria");
    item.result.criteria.forEach(c=>{
      const row=mk("div","review-criterion");
      row.append(mk("b","",`${c.id} · ${c.awarded}/${c.max}`),mk("span","",c.reason||"No reason supplied."));
      criteria.append(row);
    });
    card.append(criteria);
    const work=mk("details","review-work");
    work.append(mk("summary","","Student checked working"));
    work.append(mk("pre","",item.transcription));
    card.append(work);
    if(item.status==="released"){
      card.append(mk("p","review-release",`Released: ${item.final.total} / ${item.final.max}${item.final.comment ? " — "+item.final.comment : ""}`));
      return card;
    }
    const controls=mk("div","review-controls");
    const mark=mk("input","teacher-mark"); mark.type="number"; mark.min=0; mark.max=item.result.max; mark.step=1; mark.value=item.result.total; mark.setAttribute("aria-label","Final mark");
    const comment=document.createElement("textarea"); comment.className="teacher-comment"; comment.rows=2; comment.placeholder="Optional tutor comment";
    const release=mk("button","btn blue","Release final mark"); release.type="button";
    release.onclick=async()=>{
      release.disabled=true;
      const n=Number(mark.value);
      if(!Number.isFinite(n)||n<0||n>item.result.max){ alert(`Enter a mark from 0 to ${item.result.max}.`); release.disabled=false; return; }
      const j=await api("/api/teacher/release",{method:"POST",body:JSON.stringify({id:item.id,total:n,comment:comment.value})});
      if(!j.ok){ alert(j.problem||"Could not release."); release.disabled=false; return; }
      await loadQueue();
    };
    controls.append(mark,release); card.append(controls,comment);
    return card;
  }
  async function loadQueue() {
    const j=await api("/api/teacher/submissions");
    if(!j.ok){ showLogin(j.problem||"Tutor login required."); return; }
    $("#teacherLogin").hidden=true; $("#teacherQueue").hidden=false;
    const box=$("#teacherItems"); box.innerHTML="";
    const items=j.submissions||[];
    $("#teacherCount").textContent=`${items.filter(x=>x.status==="awaiting_review").length} awaiting review · ${items.length} total`;
    if(!items.length){ box.append(mk("p","note","No marking submissions yet.")); return; }
    items.forEach(x=>box.append(renderItem(x)));
  }
  $("#teacherLoginBtn").onclick=login;
  $("#teacherPin").addEventListener("keydown",e=>{if(e.key==="Enter")login();});
  $("#teacherRefresh").onclick=loadQueue;
  window.openTeacher=async()=>{ if(token) await loadQueue(); else showLogin(); };
})();
