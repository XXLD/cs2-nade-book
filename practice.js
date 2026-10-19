/* Practice mode: drill nades, log hit/miss, track success rate. Uses globals from app.js / setups.js. */
"use strict";

// ---------- stats ----------
function pstats(n) {
  const log = n.log || [], last = log.slice(-10), hits = last.filter((x) => x.ok).length;
  return { att: log.length, n10: last.length, hits, rate: last.length ? hits / last.length : -1, lastT: log.length ? log[log.length - 1].t : 0 };
}
const pbadge = (n) => { const s = pstats(n); return s.att ? ` · 🎯 ${s.hits}/${s.n10}` : ""; };
function pdetail(n) {
  const s = pstats(n);
  if (!s.att) return `<p class="dim">Not practiced yet.</p>`;
  const dots = (n.log || []).slice(-15).map((x) => `<span class="pd ${x.ok ? "ok" : "no"}"></span>`).join("");
  return `<p class="dim">🎯 Last ${s.n10}: <b>${s.hits}/${s.n10}</b> (${Math.round(s.rate * 100)}%) · ${s.att} total <span class="pdots">${dots}</span>
    <button class="linkbtn" data-resetlog="${n.id}">reset</button></p>`;
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-resetlog]"); if (!b) return;
  const n = nadeById(b.dataset.resetlog);
  if (n && confirm("Reset practice history for this nade?")) { n.log = []; await dbPut(n); refresh(); }
});

// status follows practice results: unknown->practicing on first try, 4 of last 5 => learned, slipping => practicing
function autoStatus(n) {
  const log = n.log || [], l5 = log.slice(-5);
  if (log.length >= 5 && l5.filter((x) => x.ok).length >= 4) n.status = "learned";
  else if (n.status === "learned" && log.slice(-3).filter((x) => !x.ok).length >= 2) n.status = "practicing";
  else if (n.status === "unknown") n.status = "practicing";
}

// ---------- session ----------
const practiceHidden = () => !!(S.practice && !S.practice.done && S.practice.hide && !S.practice.revealed);
const curNade = () => S.practice && !S.practice.done ? nadeById(S.practice.queue[S.practice.i]) : null;

function startPractice(ids, mode, title) {
  ids = ids.filter((id) => nadeById(id));
  if (!ids.length) return alert("Nothing to practice here - add some nades first.");
  S.practice = { queue: [...ids], i: 0, hits: 0, misses: 0, missed: new Set(), requeued: {}, mode, title,
    revealed: false, hide: localStorage.getItem("pHide") !== "0", done: false };
  Object.assign(S, { editing: null, picking: null });
  syncPractice();
}
function syncPractice() { const n = curNade(); S.selId = n ? n.id : null; refresh(); }

// weakest / least-practiced first, random among equals
function drillOrder(nades) {
  return nades.map((n) => ({ id: n.id, k: pstats(n).rate + Math.random() * 0.05 })).sort((a, b) => a.k - b.k).map((x) => x.id);
}

async function answer(ok) {
  const p = S.practice, n = curNade(); if (!n) return;
  n.log = (n.log || []).concat({ t: Date.now(), ok }).slice(-30);
  autoStatus(n); await dbPut(n);
  if (ok) p.hits++; else {
    p.misses++; p.missed.add(n.id);
    if (p.mode === "drill" && (p.requeued[n.id] || 0) < 2) {   // come back to it in ~3 nades
      p.requeued[n.id] = (p.requeued[n.id] || 0) + 1;
      p.queue.splice(Math.min(p.i + 4, p.queue.length), 0, n.id);
    }
  }
  advance();
}
function advance() {
  const p = S.practice; p.i++; p.revealed = false;
  if (p.i >= p.queue.length) p.done = true;
  syncPractice();
}
function endPractice() { S.practice = null; S.selId = null; refresh(); }

// ---------- UI ----------
function renderPractice() {
  const p = S.practice, el = $("#pdrill");
  if (!p) { el.hidden = true; return injectPracticeBtn(); }
  for (const id of ["#list", "#detail", "#form", "#slist", "#sdetail", "#sform"]) $(id).hidden = true;
  $("#pickBanner").hidden = !S.fixLanding;
  el.hidden = false;

  if (p.done) {
    const total = p.hits + p.misses, missed = [...p.missed].map(nadeById).filter(Boolean);
    el.innerHTML = `<h2>Session done 🎉</h2>
      <p><b>${p.hits}</b> hit · <b>${p.misses}</b> missed${total ? ` · ${Math.round((p.hits / total) * 100)}%` : ""}</p>
      ${missed.length ? `<label class="lbl2">Still shaky</label>${missed.map((n) => `<div class="stepcard"><div class="dot" style="background:${NADE_TYPES[n.type].color}">${NADE_TYPES[n.type].icon}</div><b>${esc(n.name)}</b></div>`).join("")}` : `<p>Clean run - nothing missed.</p>`}
      <div class="row">${missed.length ? `<button id="pAgain" class="primary">Drill the misses</button>` : ""}<button id="pClose">Close</button></div>`;
    if (missed.length) $("#pAgain").onclick = () => startPractice(missed.map((n) => n.id), "drill", "Misses");
    $("#pClose").onclick = endPractice;
    return;
  }

  const n = curNade(), st = pstats(n), hid = practiceHidden();
  const pct = Math.round((p.i / p.queue.length) * 100);
  el.innerHTML = `<div class="row"><b>${esc(p.title)}</b><span class="dim" style="text-align:right">${p.i + 1} / ${p.queue.length}</span></div>
    <div class="pbar"><div style="width:${pct}%"></div></div>
    <h2>${esc(n.name)}</h2>
    <div><span class="tag">${esc(NADE_TYPES[n.type].label)}</span><span class="tag">${esc(n.variant)}</span><span class="tag">${esc(n.side)}</span><span class="tag">${esc(n.purpose)}</span>
      <span class="tag st-${n.status}">${esc(n.status)}</span>${st.att ? `<span class="tag">🎯 ${st.hits}/${st.n10}</span>` : ""}</div>
    <p class="dim">Lands <b>${esc(nearestCallout(n.to.x, n.to.y))}</b>${hid ? "" : `${n.from ? ` · from <b>${esc(nearestCallout(n.from.x, n.from.y))}</b>` : ""}${n.technique ? ` · ${esc(n.technique)}` : ""}`}</p>
    ${hid ? `<button id="pReveal" style="width:100%">👁 Reveal lineup <small>(R)</small></button>` : `
      ${n.setpos ? `<pre class="cmd">${esc(n.setpos)}</pre><button id="pCopy">Copy setpos <small>(C)</small></button>` : ""}
      ${n.notes ? `<p>${esc(n.notes).replace(/\n/g, "<br>")}</p>` : ""}
      ${galleryHtml(n)}`}
    <div class="row pbtns"><button id="pHit" class="primary">✓ Hit <small>(H)</small></button><button id="pMiss" class="danger">✗ Miss <small>(M)</small></button><button id="pSkip">Skip <small>(S)</small></button></div>
    <div class="row"><label style="flex:2"><input type="checkbox" id="pHide" ${p.hide ? "checked" : ""}> Hide lineup until I reveal it</label><button id="pEnd">End</button></div>`;
  const r = $("#pReveal"); if (r) r.onclick = () => { p.revealed = true; refresh(); };
  const c = $("#pCopy"); if (c) c.onclick = () => { navigator.clipboard.writeText(n.setpos); c.textContent = "Copied!"; };
  $("#pHit").onclick = () => answer(true);
  $("#pMiss").onclick = () => answer(false);
  $("#pSkip").onclick = advance;
  $("#pEnd").onclick = () => { if (!p.hits && !p.misses) endPractice(); else { p.done = true; syncPractice(); } };
  $("#pHide").onchange = (ev) => { p.hide = ev.target.checked; localStorage.setItem("pHide", p.hide ? "1" : "0"); refresh(); };
}

function injectPracticeBtn() {
  const list = $("#list");
  if (S.tab !== "nades" || list.hidden || list.querySelector("#pStart") || !panelList().length) return;
  list.insertAdjacentHTML("afterbegin", `<div class="row"><button id="pStart" class="primary">▶ Practice these (${panelList().length})</button></div>`);
  $("#pStart").onclick = () => startPractice(drillOrder(panelList()), "drill", "Drill - weakest first");
}

document.addEventListener("keydown", (ev) => {
  if (!S.practice || S.practice.done || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
  const k = ev.key.toLowerCase();
  if (k === "h") answer(true);
  else if (k === "m") answer(false);
  else if (k === "s" || k === "arrowright") advance();
  else if (k === "r") { S.practice.revealed = true; refresh(); }
  else if (k === "c") { const n = curNade(); if (n && n.setpos && !practiceHidden()) navigator.clipboard.writeText(n.setpos); }
  else if (k === "escape") { S.practice.done = true; syncPractice(); }
});
