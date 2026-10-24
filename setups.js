/* Setups: ordered chains of nades (an execute, a retake, an afterplant...). Uses globals from app.js. */
"use strict";

const nadeById = (id) => S.nades.find((n) => n.id === id);
const setupSteps = (su) => su.steps.map((s) => ({ s, n: nadeById(s.nadeId) }));

function activeSetup() {
  if (S.editSetup) return S.editSetup;
  return S.tab === "setups" ? S.setups.find((x) => x.id === S.selSetup) || null : null;
}

// numbered badges + throw lines drawn on the map for the active setup
function setupOverlay(su) {
  let h = "";
  setupSteps(su).forEach(({ n }, i) => {
    if (!n) return;
    const c = NADE_TYPES[n.type].color;
    if (n.from) {
      h += `<line class="throw" stroke="${c}" x1="${n.from.x}" y1="${n.from.y}" x2="${n.to.x}" y2="${n.to.y}"/>
        <path fill="${c}" stroke="#0c0e11" stroke-width="2" d="M${n.from.x} ${n.from.y - 12} l10 20 h-20z"/>
        <text class="badgeTxt" x="${n.from.x}" y="${n.from.y + 28}">${i + 1}</text>`;
    }
    h += `<circle cx="${n.to.x + 17}" cy="${n.to.y - 17}" r="13" fill="#fff" stroke="#0c0e11" stroke-width="2"/>
      <text class="badgeNum" x="${n.to.x + 17}" y="${n.to.y - 12}">${i + 1}</text>`;
  });
  return h;
}

function addStep(nadeId) {
  if (!S.editSetup || !nadeById(nadeId)) return;
  S.editSetup.steps.push({ nadeId, player: "", note: "" });
  renderMap(); renderSetupForm();
}

// ---------- list ----------
function renderSetupList() {
  const q = S.q.toLowerCase();
  const list = S.setups.filter((x) => x.map === S.map && (!S.side || x.side === S.side || x.side === "Both") &&
    (!q || [x.name, x.goal, x.notes].join(" ").toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const el = $("#slist"); el.hidden = false;
  el.innerHTML = `<div class="row"><button id="newSetup" class="primary">+ New setup</button></div>` +
    (list.length ? "" : `<p class="dim">No setups for this map yet. A setup chains nades into an execute, retake or afterplant.</p>`) +
    list.map((x) => `<div class="item" data-sid="${x.id}">
      <div style="flex:1"><b>${esc(x.name)}</b><br><small>${esc(x.side)} · ${esc(x.goal)} · ${x.steps.length} step${x.steps.length === 1 ? "" : "s"}</small>
      <div class="strip">${setupSteps(x).map(({ n }) => n ? `<span class="dot sm" style="background:${NADE_TYPES[n.type].color}">${NADE_TYPES[n.type].icon}</span>` : "").join("")}</div></div></div>`).join("");
  el.onclick = (ev) => {
    const it = ev.target.closest("[data-sid]");
    if (it) { S.selSetup = it.dataset.sid; refresh(); }
  };
  $("#newSetup").onclick = () => {
    S.editSetup = { id: uid(), map: S.map, name: "", side: "T", goal: "", notes: "", steps: [], created: Date.now(), _new: true };
    S.selSetup = null; refresh();
  };
}

// ---------- detail ----------
function setupText(su) {
  const lines = [`${su.name} (${MAPS[su.map].name}, ${su.side}${su.goal ? ", " + su.goal : ""})`];
  if (su.notes) lines.push(su.notes);
  setupSteps(su).forEach(({ s, n }, i) => {
    lines.push(`${i + 1}. ${n ? `${n.name} [${NADE_TYPES[n.type].label}${n.variant ? ", " + n.variant : ""}]` : "(deleted nade)"}` +
      `${s.player ? ` - ${s.player}` : ""}${s.note ? ` - ${s.note}` : ""}`);
  });
  return lines.join("\n");
}

function renderSetupDetail(su) {
  const el = $("#sdetail"); el.hidden = false;
  el.innerHTML = `<button id="sBack">← All setups</button>
    <h2>${esc(su.name)}</h2>
    <div><span class="tag">${esc(su.side)}</span>${su.goal ? `<span class="tag">${esc(su.goal)}</span>` : ""}</div>
    ${su.notes ? `<p>${esc(su.notes).replace(/\n/g, "<br>")}</p>` : ""}
    ${setupSteps(su).map(({ s, n }, i) => n ? `<div class="stepcard">
        <div class="dot" style="background:${NADE_TYPES[n.type].color}">${i + 1}</div>
        <div style="flex:1">
          <b>${esc(n.name)}</b> <small class="dim">${esc(NADE_TYPES[n.type].label)} · ${esc(n.variant)}</small><br>
          <small class="dim">${n.from ? `${esc(nearestCallout(n.from.x, n.from.y))} → ` : ""}${esc(nearestCallout(n.to.x, n.to.y))}${n.technique ? ` · ${esc(n.technique)}` : ""}</small>
          ${galleryHtml(n)}
          ${s.player ? `<div>👤 ${esc(s.player)}</div>` : ""}${s.note ? `<div>⏱ ${esc(s.note)}</div>` : ""}
          <div class="row" style="margin:4px 0 0">${n.setpos ? `<button data-copy="${i}">Copy setpos</button>` : ""}<button data-open="${n.id}">Open nade</button></div>
        </div></div>` : `<div class="stepcard"><div class="dot" style="background:#555">${i + 1}</div><div class="dim">(this nade was deleted)</div></div>`).join("")}
    <div class="row"><button id="sPractice" class="primary">▶ Practice</button></div>
    <div class="row"><button id="sEdit">Edit</button><button id="sCopy">Copy as text</button><button id="sDup">Duplicate</button><button id="sDel" class="danger">Delete</button></div>`;
  $("#sBack").onclick = () => { S.selSetup = null; refresh(); };
  $("#sPractice").onclick = () => startPractice(su.steps.map((s) => s.nadeId), "setup", su.name);
  $("#sEdit").onclick = () => { S.editSetup = structuredClone(su); refresh(); };
  $("#sCopy").onclick = (ev) => { navigator.clipboard.writeText(setupText(su)); ev.target.textContent = "Copied!"; };
  $("#sDup").onclick = async () => { const c = { ...structuredClone(su), id: uid(), name: su.name + " (copy)", created: Date.now() }; await sPut(c); S.setups.push(c); S.selSetup = c.id; refresh(); };
  $("#sDel").onclick = async () => { if (confirm(`Delete setup "${su.name}"?`)) { await sDel(su.id); S.setups = S.setups.filter((x) => x.id !== su.id); S.selSetup = null; refresh(); } };
  el.onclick = (ev) => {
    const c = ev.target.closest("[data-copy]"), o = ev.target.closest("[data-open]");
    if (c) { navigator.clipboard.writeText(nadeById(su.steps[+c.dataset.copy].nadeId).setpos); c.textContent = "Copied!"; }
    if (o) { S.tab = "nades"; S.selSetup = null; select(o.dataset.open); }
  };
}

// ---------- editor ----------
function renderSetupForm() {
  const e = S.editSetup, el = $("#sform"); el.hidden = false;
  const mine = S.nades.filter((n) => n.map === S.map).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const opt = (arr, v) => arr.map((a) => `<option ${a === v ? "selected" : ""}>${a}</option>`).join("");
  el.innerHTML = `<h2>${e._new ? "New setup" : "Edit setup"}</h2>
    <label class="lbl2">Name</label><input id="s_name" value="${esc(e.name)}" placeholder="e.g. A execute - long control">
    <div class="row">
      <div><label class="lbl2">Side</label><select id="s_side">${opt(["T", "CT", "Both"], e.side)}</select></div>
      <div><label class="lbl2">Goal</label><input id="s_goal" list="dl_pur" value="${esc(e.goal)}" placeholder="A execute, B retake…"></div>
    </div>
    <label class="lbl2">Notes</label><textarea id="s_notes" placeholder="Economy, when to call it, fallback plan…">${esc(e.notes)}</textarea>
    <label class="lbl2">Steps (in order)</label>
    <div id="steps">${e.steps.map((s, i) => {
      const n = nadeById(s.nadeId);
      return `<div class="stepcard" data-i="${i}">
        <div class="dot" style="background:${n ? NADE_TYPES[n.type].color : "#555"}">${i + 1}</div>
        <div style="flex:1;min-width:0"><b>${n ? esc(n.name) : "(deleted nade)"}</b>
          <input class="s_player" placeholder="Who throws it (e.g. Player 2, lurker)" value="${esc(s.player)}">
          <input class="s_note" placeholder="Timing / note (e.g. throw together with #1)" value="${esc(s.note)}"></div>
        <div class="stepbtns"><button data-act="up" ${i === 0 ? "disabled" : ""}>↑</button><button data-act="down" ${i === e.steps.length - 1 ? "disabled" : ""}>↓</button><button data-act="rm">×</button></div></div>`;
    }).join("") || `<p class="dim">No steps yet.</p>`}</div>
    <select id="s_add"><option value="">+ Add a nade…</option>${mine.map((n) => `<option value="${n.id}">${esc(NADE_TYPES[n.type].label)} · ${esc(n.name)}</option>`).join("")}</select>
    <p class="dim">Tip: you can also click a nade marker on the map to add it.</p>
    <div class="row" style="margin-top:12px"><button id="s_save" class="primary">Save</button><button id="s_cancel">Cancel</button></div>`;

  $("#s_name").oninput = (ev) => (e.name = ev.target.value);
  $("#s_side").onchange = (ev) => (e.side = ev.target.value);
  $("#s_goal").oninput = (ev) => (e.goal = ev.target.value);
  $("#s_notes").oninput = (ev) => (e.notes = ev.target.value);
  $("#s_add").onchange = (ev) => addStep(ev.target.value);
  $("#s_cancel").onclick = () => { S.editSetup = null; S.selSetup = e._new ? null : e.id; refresh(); };
  $("#s_save").onclick = async () => {
    if (!e.name.trim()) return alert("Give the setup a name.");
    if (!e.steps.length) return alert("Add at least one nade.");
    e.name = e.name.trim(); e.map = S.map; delete e._new;
    await sPut(e);
    const i = S.setups.findIndex((x) => x.id === e.id);
    i >= 0 ? (S.setups[i] = e) : S.setups.push(e);
    S.selSetup = e.id; S.editSetup = null; refresh();
  };
  const steps = $("#steps");
  steps.oninput = (ev) => {
    const row = ev.target.closest(".stepcard"); if (!row) return;
    const s = e.steps[+row.dataset.i];
    if (ev.target.classList.contains("s_player")) s.player = ev.target.value;
    if (ev.target.classList.contains("s_note")) s.note = ev.target.value;
  };
  steps.onclick = (ev) => {
    const b = ev.target.closest("[data-act]"); if (!b) return;
    const i = +b.closest(".stepcard").dataset.i, a = b.dataset.act;
    if (a === "rm") e.steps.splice(i, 1);
    else { const j = a === "up" ? i - 1 : i + 1; [e.steps[i], e.steps[j]] = [e.steps[j], e.steps[i]]; }
    renderMap(); renderSetupForm();
  };
}

// ---------- tabs + dispatcher (called from refresh() in app.js) ----------
function renderSetups() {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  for (const id of ["#slist", "#sdetail", "#sform"]) $(id).hidden = true;
  if (S.tab !== "setups") return;
  for (const id of ["#list", "#detail", "#form"]) $(id).hidden = true;
  if (S.editSetup) return renderSetupForm();
  const su = S.setups.find((x) => x.id === S.selSetup);
  if (su) return renderSetupDetail(su);
  renderSetupList();
}

$("#tabs").onclick = (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  Object.assign(S, { tab: b.dataset.tab, selId: null, editing: null, picking: null, selSetup: null, editSetup: null, practice: null, review: null, verify: null });
  refresh();
};
