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
const decBadge = (n) => (n.decision === "keep" ? `<span class="decTag keepTag">kept</span>` : n.decision === "discard" ? `<span class="decTag discTag">discarded</span>` : "") + testBadge(n);
// "works in game" flag: tested = "ok" | "broken", testedAt = date you set it (a Hit in practice mode sets it to ok)
const testBadge = (n) => (n.tested === "ok" ? `<span class="decTag keepTag">✓ works \u00b7 ${esc(n.testedAt || "")}</span>` : n.tested === "broken" ? `<span class="decTag discTag">✗ broken \u00b7 ${esc(n.testedAt || "")}</span>` : "");
const testNote = (n) => (n.tested === "ok" ? ` \u00b7 ✓ tested ${esc(n.testedAt || "")}` : n.tested === "broken" ? ` \u00b7 ✗ broken ${esc(n.testedAt || "")}` : "");
S.test = localStorage.getItem("test") || "any";
const testOk = (n) => S.test === "any" || (S.test === "ok" && n.tested === "ok") || (S.test === "broken" && n.tested === "broken") || (S.test === "none" && !n.tested);
const TEST_OPTIONS = [["any", "Tested: any"], ["ok", "✓ Works"], ["broken", "✗ Broken"], ["none", "Untested"]];
$("#testSel").innerHTML = TEST_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
$("#testSel").value = S.test;
$("#testSel").onchange = (ev) => { S.test = ev.target.value; localStorage.setItem("test", S.test); S.cluster = null; refresh(); };
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-test]"); if (!b) return;
  ev.stopPropagation(); ev.preventDefault();
  const n = nadeById(b.dataset.id); if (!n) return;
  const v = b.dataset.test;
  if (n.tested === v) { delete n.tested; delete n.testedAt; } else { n.tested = v; n.testedAt = new Date().toISOString().slice(0, 10); }   // click again = clear
  await dbPut(n); refresh();
}, true);
const decButtons = (n) => `<span class="decb"><b class="dec keep ${n.decision === "keep" ? "on" : ""}" data-dec="keep" data-id="${n.id}" title="Keep this lineup">✓</b><b class="dec discard ${n.decision === "discard" ? "on" : ""}" data-dec="discard" data-id="${n.id}" title="Discard this lineup">✗</b></span>`;
function decisionBlock(n) {
  const sim = similarOf(n);
  return `<div class="row decrow"><button class="dbtn ${n.decision === "keep" ? "on keepOn" : ""}" data-dec="keep" data-id="${n.id}">✓ Keep</button>
      <button class="dbtn ${n.decision === "discard" ? "on discOn" : ""}" data-dec="discard" data-id="${n.id}">✗ Discard</button></div>
    <div class="row"><button class="dbtn ${n.tested === "ok" ? "on keepOn" : ""}" data-test="ok" data-id="${n.id}" title="You threw it in game and it works">✓ Works in game</button><button class="dbtn ${n.tested === "broken" ? "on discOn" : ""}" data-test="broken" data-id="${n.id}" title="It no longer works (game update, moved object...)">✗ Broken</button></div>
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
  const _vk = S.view; S.view = "active"; const _vis = visible(); S.view = _vk;
  const nGuess = _vis.filter(guessed).length, nEst = _vis.filter(estimated).length, vq = S.verifyAim ? verifyQueue() : _vis.filter(guessed);
  list.insertAdjacentHTML("afterbegin", `<div id="rvBar">
    <div class="dim" style="font-size:12px;margin-bottom:6px">This map · <b style="color:var(--acc)">${st.kept}</b> kept · <b style="color:#ff6b78">${st.discarded}</b> discarded · <b>${st.todo}</b> to review</div>
    <div class="row"><button id="rvStart" class="primary" ${st.todo ? "" : "disabled"}>▶ Review lineups (${st.todo})</button></div>
    <div class="row"><button id="vfStart" ${vq.length ? "" : "disabled"}>📍 Verify landing spots (${vq.length})</button></div>
    <label class="dim" style="font-size:12px;display:flex;gap:6px;align-items:center;margin:2px 0 6px"><input type="checkbox" id="vfAim" ${S.verifyAim ? "checked" : ""} style="width:auto"> also check the aim-line estimates (${nEst})</label>
    <div class="row"><button id="rvKeepAll" ${shown.length ? "" : "disabled"}>✓ Keep all shown (${shown.length})</button><button id="rvDiscAll" ${shown.length ? "" : "disabled"}>✗ Discard all shown (${shown.length})</button></div></div>`);
  $("#rvStart").onclick = startReview;
  $("#vfStart").onclick = startVerify;
  $("#vfAim").onchange = (ev) => { S.verifyAim = ev.target.checked; localStorage.setItem("verifyAim", S.verifyAim ? "1" : "0"); refresh(); };
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
  if (ev.key === "Escape" && S.fixLanding) { ev.stopPropagation(); if (S.verify) endVerify(); else { S.fixLanding = null; refresh(); } }
}, true);

// ---------- Verify landing spots ----------
// Steps through lineups whose landing spot is only a guess (landing-approx) - optionally also the aim-line estimates.
// For each one the map zooms onto the marker and shows the screenshot. Click the real landing spot, or confirm the marker.
S.verify = null;
S.verifyAim = localStorage.getItem("verifyAim") === "1";
const guessed = (n) => !!n.to && !n.landingFixed && (n.tags || []).includes("landing-approx");
const estimated = (n) => !!n.to && !n.landingFixed && (n.tags || []).includes("landing-aimline");
function verifyQueue() {
  const keep = S.view; S.view = "active";                   // never ask about discarded lineups
  const all = visible(); S.view = keep;
  return all.filter(guessed).concat(S.verifyAim ? all.filter(estimated) : []);
}
const curVerify = () => (S.verify && S.verify.i < S.verify.ids.length ? nadeById(S.verify.ids[S.verify.i]) : null);
function startVerify() {
  const ids = verifyQueue().map((n) => n.id);
  if (!ids.length) return alert("No guessed landing spots left to check with the current filters.");
  Object.assign(S, { verify: { ids, i: 0, ok: 0, fixed: 0, hist: [] }, review: null, editing: null, picking: null, cluster: null });
  syncVerify();
}
function syncVerify() {
  const n = curVerify();
  S.selId = n ? n.id : null; S.fixLanding = n ? n.id : null;
  if (n) { const z = 3, w = 1000 / z; S.mapView = { z, x: n.to.x - w / 2, y: n.to.y - w / 2 }; }   // zoom onto the marker
  refresh();
}
function endVerify() {
  Object.assign(S, { verify: null, fixLanding: null, selId: null, mapView: { z: 1, x: 0, y: 0 } });
  refresh();
}
function verifyAdvance() { S.verify.i++; syncVerify(); }
async function verifyAfterFix(n, prev) {                  // called by the map click handler after you clicked the real spot
  const v = S.verify; v.hist.push({ id: n.id, prev, i: v.i, act: "set" }); v.fixed++;
  verifyAdvance();
}
async function verifyAct(act) {
  const v = S.verify, n = curVerify(); if (!v) return;
  if (act === "end") return endVerify();
  if (act === "skip") return verifyAdvance();
  if (act === "undo") {
    const h = v.hist.pop(); if (!h) return;
    const m = nadeById(h.id); m.to = h.prev.to; m.tags = h.prev.tags;
    if (h.prev.fixed === undefined) delete m.landingFixed; else m.landingFixed = h.prev.fixed;
    await dbPut(m); if (h.act === "set") v.fixed--; else v.ok--;
    v.i = h.i; return syncVerify();
  }
  if (act === "ok" && n) {                                // the marker is already right
    const prev = { to: { ...n.to }, tags: [...(n.tags || [])], fixed: n.landingFixed };
    n.landingFixed = true; n.tags = (n.tags || []).filter((t) => !t.startsWith("landing-")); await dbPut(n);
    v.hist.push({ id: n.id, prev, i: v.i, act: "ok" }); v.ok++; verifyAdvance();
  }
}
function renderVerify() {
  const v = S.verify, el = $("#vdrill");
  if (!v) { el.hidden = true; return; }
  for (const id of ["#list", "#detail", "#form", "#slist", "#sdetail", "#sform", "#pdrill", "#rdrill"]) $(id).hidden = true;
  $("#pickBanner").hidden = !S.fixLanding; el.hidden = false;
  const n = curVerify();
  if (!n) {
    el.innerHTML = `<h2>Landing spots checked</h2><p><b style="color:var(--acc)">${v.ok}</b> confirmed \u00b7 <b>${v.fixed}</b> moved by you this session.</p>
      <div class="row"><button id="vfDone" class="primary">Back to the list</button></div>`;
    $("#vfDone").onclick = endVerify; return;
  }
  const pics = imgs(n), pct = Math.round((v.i / v.ids.length) * 100);
  const first = pics[0] ? pics[0].src : "";
  const hint = isUtilCover(first, "Aim") ? "In the picture, the <b>right half</b> shows where it lands." : first.indexOf("/cn-") >= 0 ? "In the picture, the <b>left half</b> shows where it lands (the right half is the aim)." : "Look for where the smoke / flash / molly ends up in the picture.";
  const kind = (n.tags || []).includes("landing-approx") ? "guessed from the name" : "estimated along the aim line";
  el.innerHTML = `<div class="row"><b>Verify landing spots</b><span class="dim" style="text-align:right">${v.i + 1} / ${v.ids.length}</span></div>
    <div class="pbar"><div style="width:${pct}%"></div></div>
    <h2>${esc(n.name)}</h2>
    <div><span class="tag">${esc(NADE_TYPES[n.type].label)}</span><span class="tag">${esc(n.side)}</span><span class="tag">${esc(srcLabel(n))}</span><span class="tag">landing ${kind}</span></div>
    <p class="dim">${n.from ? `Thrown from <b>${esc(nearestCallout(n.from.x, n.from.y))}</b> \u00b7 ` : ""}marker is near <b>${esc(nearestCallout(n.to.x, n.to.y))}</b></p>
    <p style="margin:6px 0"><b>Where does it really land?</b> ${hint} Then <b>click that spot on the map</b>, or confirm the marker if it is already right.</p>
    ${pics.length ? shotHtml(n, pics[0], 0) : `<div class="noshot">No screenshot.</div>`}
    <div class="rsticky"><div class="row rbtns"><button data-vf="ok" class="primary">\u2713 Looks right <small>(Enter)</small></button><button data-vf="skip">Skip <small>(S)</small></button></div>
      <div class="row"><button data-vf="undo" ${v.hist.length ? "" : "disabled"}>\u21b6 Undo <small>(U)</small></button><button data-vf="end">Finish <small>(Esc)</small></button></div></div>`;
}
document.addEventListener("click", (ev) => { const b = ev.target.closest("[data-vf]"); if (b && S.verify) verifyAct(b.dataset.vf); });
document.addEventListener("keydown", (ev) => {
  if (!S.verify || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
  const k = ev.key.toLowerCase();
  if (k === "enter" || k === "y") { ev.preventDefault(); verifyAct("ok"); }
  else if (k === "s" || k === "arrowright") verifyAct("skip");
  else if (k === "u" || k === "backspace") verifyAct("undo");
});
