/* Curation: decide which lineups you keep and which you discard.
   - every nade can be Kept or Discarded (toggle); the choice is saved on the nade and survives data updates
   - view filter: hide discarded (default) / kept only / still to review / discarded only / everything
   - source filter (csnades / cs2util / mine); duplicates between sources are detected
   - Review mode: go through lineups one by one with Keep / Discard / Skip (K / D / S, U = undo)
   Uses globals from app.js / setups.js / practice.js. */
"use strict";

// ---------- state + filters ----------
S.view = localStorage.getItem("view") || "active";
S.src = localStorage.getItem("src") || "all";
S.review = null;

const srcOf = (n) => n.source || (n.id.startsWith("cn-") ? "csnades.gg" : n.id.startsWith("cu-") ? "cs2util.com" : "mine");
const srcLabel = (n) => ({ "csnades.gg": "csnades", "cs2util.com": "cs2util", mine: "mine" }[srcOf(n)] || srcOf(n));
function decisionOk(n) {
  const d = n.decision;
  switch (S.view) {
    case "kept": return d === "keep";
    case "new": return !d;
    case "discarded": return d === "discard";
    case "all": return true;
    default: return d !== "discard";
  }
}
const sourceOk = (n) => S.src === "all" || srcLabel(n) === S.src;

const VIEW_OPTIONS = [["active", "Hide discarded"], ["kept", "Kept only"], ["new", "To review"], ["discarded", "Discarded only"], ["all", "Everything"]];
const SRC_OPTIONS = [["all", "All sources"], ["csnades", "csnades"], ["cs2util", "cs2util"], ["mine", "my own"]];
$("#viewSel").innerHTML = VIEW_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
$("#srcSel").innerHTML = SRC_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
$("#viewSel").value = S.view;
$("#srcSel").value = S.src;
$("#viewSel").onchange = (ev) => { S.view = ev.target.value; localStorage.setItem("view", S.view); S.cluster = null; refresh(); };
$("#srcSel").onchange = (ev) => { S.src = ev.target.value; localStorage.setItem("src", S.src); S.cluster = null; refresh(); };

// ---------- decisions ----------
async function setDecision(nades, d) {           // d = "keep" | "discard" | null (clear)
  for (const n of nades) { if (d) n.decision = d; else delete n.decision; }
  await bulk(STORE, nades, []);
}
// lineups from the two sources that are (nearly) the same throw: same map + type, stand spot and landing close together
function similarOf(n) {
  if (!n.from) return [];
  return S.nades.filter((m) => m.id !== n.id && m.map === n.map && m.type === n.type && m.from && m.decision !== "discard" &&
    Math.hypot(m.from.x - n.from.x, m.from.y - n.from.y) <= 22 && Math.hypot(m.to.x - n.to.x, m.to.y - n.to.y) <= 45);
}
const decBadge = (n) => (n.decision === "keep" ? `<span class="decTag keepTag">kept</span>` : n.decision === "discard" ? `<span class="decTag discTag">discarded</span>` : "");
const decButtons = (n) => `<span class="decb"><b class="dec keep ${n.decision === "keep" ? "on" : ""}" data-dec="keep" data-id="${n.id}" title="Keep this lineup">✓</b><b class="dec discard ${n.decision === "discard" ? "on" : ""}" data-dec="discard" data-id="${n.id}" title="Discard this lineup">✗</b></span>`;
function decisionBlock(n) {
  const sim = similarOf(n);
  return `<div class="row decrow"><button class="dbtn ${n.decision === "keep" ? "on keepOn" : ""}" data-dec="keep" data-id="${n.id}">✓ Keep</button>
      <button class="dbtn ${n.decision === "discard" ? "on discOn" : ""}" data-dec="discard" data-id="${n.id}">✗ Discard</button></div>
    <div class="row"><button data-fix="${n.id}" title="Then click the map where it really lands">📍 Fix landing spot${n.landingFixed ? " (fixed ✓)" : ""}</button></div>
    <p class="dim" style="font-size:12px">Source: <b>${esc(srcLabel(n))}</b>${n.decision ? ` · marked <b>${n.decision === "keep" ? "kept" : "discarded"}</b>` : ""}</p>` + similarHtml(n, sim);
}
function similarHtml(n, sim) {
  if (!sim.length) return "";
  return `<div class="simbox"><b>${sim.length} similar lineup${sim.length === 1 ? "" : "s"}</b> (same spot)
    ${sim.slice(0, 4).map((m) => `<div class="simrow"><span class="tag">${esc(srcLabel(m))}</span> ${esc(m.name)}${hasCross(m) ? " 🎯" : ""}${m.decision === "keep" ? " · kept" : ""}</div>`).join("")}
    <button data-dec="keepbest" data-id="${n.id}">Keep this one, discard the similar</button></div>`;
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-dec]");
  if (!b) return;
  ev.stopPropagation(); ev.preventDefault();
  const n = nadeById(b.dataset.id); if (!n) return;
  const act = b.dataset.dec;
  if (act === "keepbest") await setDecision([n], "keep"), await setDecision(similarOf(n), "discard");
  else await setDecision([n], n.decision === act ? null : act);   // click again = undo
  refresh();
}, true);

// ---------- list header: stats, bulk buttons, start review ----------
function reviewStats() {
  const keep = S.view; S.view = "all"; const all = visible(); S.view = keep;
  return { kept: all.filter((n) => n.decision === "keep").length, discarded: all.filter((n) => n.decision === "discard").length, todo: all.filter((n) => !n.decision).length, all };
}
function injectReviewBar() {
  const list = $("#list");
  if (S.tab !== "nades" || list.hidden || list.querySelector("#rvBar")) return;
  const st = reviewStats(), shown = panelList();
  list.insertAdjacentHTML("afterbegin", `<div id="rvBar">
    <div class="dim" style="font-size:12px;margin-bottom:6px">This map · <b style="color:var(--acc)">${st.kept}</b> kept · <b style="color:#ff6b78">${st.discarded}</b> discarded · <b>${st.todo}</b> to review</div>
    <div class="row"><button id="rvStart" class="primary" ${st.todo ? "" : "disabled"}>▶ Review lineups (${st.todo})</button></div>
    <div class="row"><button id="rvKeepAll" ${shown.length ? "" : "disabled"}>✓ Keep all shown (${shown.length})</button><button id="rvDiscAll" ${shown.length ? "" : "disabled"}>✗ Discard all shown (${shown.length})</button></div></div>`);
  $("#rvStart").onclick = startReview;
  $("#rvKeepAll").onclick = async () => { if (confirm(`Keep all ${shown.length} lineups currently shown?`)) { await setDecision(shown, "keep"); refresh(); } };
  $("#rvDiscAll").onclick = async () => {
    const target = shown.filter((n) => n.decision !== "keep"), spared = shown.length - target.length;   // never override a lineup you kept on purpose
    if (!target.length) return alert("Everything shown is already kept.");
    if (confirm(`Discard ${target.length} lineups currently shown?${spared ? ` (${spared} you kept are left alone.)` : ""} You can bring them back with "Discarded only" in the view filter.`)) { await setDecision(target, "discard"); refresh(); }
  };
}

// ---------- review mode ----------
function startReview() {
  const keep = S.view; S.view = "new";                       // only lineups you have not decided on yet
  const ids = visible().sort((a, b) => (hasCross(b) - hasCross(a)) || String(b.updated || "").localeCompare(String(a.updated || ""))).map((n) => n.id);
  S.view = keep;
  if (!ids.length) return alert("Nothing left to review with the current filters.");
  Object.assign(S, { review: { ids, i: 0, kept: 0, discarded: 0, hist: [] }, editing: null, picking: null, cluster: null });
  syncReview();
}
const curReview = () => (S.review && S.review.i < S.review.ids.length ? nadeById(S.review.ids[S.review.i]) : null);
function syncReview() { const n = curReview(); S.selId = n ? n.id : null; refresh(); }
async function reviewAct(act) {
  const r = S.review, n = curReview(); if (!r || !n) return;
  if (act === "undo") {
    const h = r.hist.pop(); if (!h) return;
    const m = nadeById(h.id); await setDecision([m], h.prev || null);
    if (h.act === "keep") r.kept--; if (h.act === "discard") r.discarded--;
    for (const o of h.others || []) await setDecision([nadeById(o.id)], o.prev || null);
    r.i = h.i; return syncReview();
  }
  const entry = { id: n.id, prev: n.decision, act, i: r.i, others: [] };
  if (act === "keep") { await setDecision([n], "keep"); r.kept++; }
  else if (act === "discard") { await setDecision([n], "discard"); r.discarded++; }
  else if (act === "keepbest") {
    const sim = similarOf(n); entry.others = sim.map((m) => ({ id: m.id, prev: m.decision }));
    await setDecision([n], "keep"); await setDecision(sim, "discard"); r.kept++; r.discarded += sim.length; entry.act = "keep";
  }
  r.hist.push(entry);
  // similar lineups you just discarded no longer need review
  r.i++;
  while (r.i < r.ids.length && nadeById(r.ids[r.i]) && nadeById(r.ids[r.i]).decision) r.i++;
  syncReview();
}
function endReview() { S.review = null; S.selId = null; refresh(); }

function renderReview() {
  const r = S.review, el = $("#rdrill");
  if (!r) { el.hidden = true; return injectReviewBar(); }
  for (const id of ["#list", "#detail", "#form", "#slist", "#sdetail", "#sform", "#pdrill"]) $(id).hidden = true;
  $("#pickBanner").hidden = !S.fixLanding; el.hidden = false;
  const n = curReview();
  if (!n) {
    el.innerHTML = `<h2>Review finished</h2><p><b style="color:var(--acc)">${r.kept}</b> kept · <b style="color:#ff6b78">${r.discarded}</b> discarded this session.</p>
      <div class="row"><button id="rvDone" class="primary">Back to the list</button></div>`;
    $("#rvDone").onclick = endReview; return;
  }
  const pics = imgs(n), sim = similarOf(n), pct = Math.round((r.i / r.ids.length) * 100);
  el.innerHTML = `<div class="row"><b>Review lineups</b><span class="dim" style="text-align:right">${r.i + 1} / ${r.ids.length}</span></div>
    <div class="pbar"><div style="width:${pct}%"></div></div>
    <h2>${esc(n.name)}</h2>
    <div><span class="tag">${esc(NADE_TYPES[n.type].label)}</span><span class="tag">${esc(n.side)}</span><span class="tag">${esc(n.variant)}</span><span class="tag">${esc(srcLabel(n))}</span>${n.updated ? `<span class="tag">updated ${esc(n.updated)}</span>` : ""}${hasCross(n) ? `<span class="tag">🎯 crosshair</span>` : ""}${(n.tags || []).includes("landing-approx") ? `<span class="tag">landing approx</span>` : ""}</div>
    <p class="dim">${n.from ? `Throw from <b>${esc(nearestCallout(n.from.x, n.from.y))}</b> → ` : ""}lands <b>${esc(nearestCallout(n.to.x, n.to.y))}</b>${n.technique ? ` · ${esc(n.technique)}` : ""}</p>
    ${pics.length ? pics.slice(0, 2).map((x, i) => shotHtml(n, x, i)).join("") : `<div class="noshot">No screenshot.</div>`}
    <div class="row">${n.setpos ? `<button id="rvCopy">Copy setpos</button>` : ""}<button data-fix="${n.id}" title="Then click the map where it really lands">📍 Fix landing spot</button></div>
    ${similarHtml(n, sim).replace('data-dec="keepbest"', 'data-rv="keepbest"').replace(' data-id="' + n.id + '"', "")}
    <div class="rsticky"><div class="row rbtns"><button data-rv="keep" class="primary">✓ Keep <small>(K)</small></button><button data-rv="discard" class="danger">✗ Discard <small>(D)</small></button><button data-rv="skip">Skip <small>(S)</small></button></div>
    <div class="row"><button data-rv="undo" ${r.hist.length ? "" : "disabled"}>↶ Undo <small>(U)</small></button><button data-rv="end">Finish <small>(Esc)</small></button></div></div>`;
  const c = $("#rvCopy"); if (c) c.onclick = () => { navigator.clipboard.writeText(n.setpos); c.textContent = "Copied!"; };
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-rv]"); if (!b || !S.review) return;
  const a = b.dataset.rv;
  if (a === "end") return endReview();
  if (a === "skip") { S.review.i++; return syncReview(); }
  reviewAct(a);
});
document.addEventListener("keydown", (ev) => {
  if (!S.review || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
  const k = ev.key.toLowerCase();
  if (k === "k") reviewAct("keep");
  else if (k === "d") reviewAct("discard");
  else if (k === "s" || k === "arrowright") { S.review.i++; syncReview(); }
  else if (k === "u" || k === "backspace") reviewAct("undo");
  else if (k === "escape") endReview();
});
// leaving the map ends a review
$("#mapSel").addEventListener("change", () => { if (S.review) { S.review = null; refresh(); } });

// crosshair colour (saved): drives the --xh CSS variable used by every crosshair overlay
(function () {
  const saved = localStorage.getItem("xh") || "#ff2b2b";
  document.documentElement.style.setProperty("--xh", saved);
  const p = $("#xhColor"); p.value = saved;
  p.oninput = () => { document.documentElement.style.setProperty("--xh", p.value); localStorage.setItem("xh", p.value); };
})();

// crosshair size (saved): scales every crosshair overlay via --xhs
(function () {
  const saved = localStorage.getItem("xhs") || "1";
  document.documentElement.style.setProperty("--xhs", saved);
  const s = $("#xhSize"); s.value = saved;
  s.onchange = () => { document.documentElement.style.setProperty("--xhs", s.value); localStorage.setItem("xhs", s.value); };
})();

// Fix landing spot: the button arms it, the next map click sets the spot (handled in app.js), Esc cancels
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-fix]"); if (!b) return;
  ev.stopPropagation(); S.fixLanding = b.dataset.fix; refresh();
}, true);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && S.fixLanding) { ev.stopPropagation(); S.fixLanding = null; refresh(); }
}, true);
