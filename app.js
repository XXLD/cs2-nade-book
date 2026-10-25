/* CS2 Nade Book - local-first. Data lives in IndexedDB (nades) + localStorage (settings). */
"use strict";

// ---------- errors: never fail silently ----------
function showFatal(e) {
  let b = document.getElementById("fatal");
  if (!b) { b = document.createElement("div"); b.id = "fatal"; document.body.prepend(b); }
  b.textContent = "Something went wrong: " + (e && e.message ? e.message : e) + " - try Ctrl+F5, and close any other CS2 Nade Book tabs.";
}
window.addEventListener("error", (ev) => showFatal(ev.error || ev.message));
window.addEventListener("unhandledrejection", (ev) => showFatal(ev.reason));

// ---------- storage ----------
const DB_NAME = "nadebook", STORE = "nades", SSTORE = "setups";
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      for (const s of [STORE, SSTORE]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => showFatal("the database is in use by another CS2 Nade Book tab");
  });
}
const tx = (mode, store = STORE) => db.transaction(store, mode).objectStore(store);
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbAll = () => reqP(tx("readonly").getAll());
// every save you make counts as a change since the last backup (starter-data seeding uses bulk() and is not counted)
const markDirty = () => { try { localStorage.setItem("dirty", String((+localStorage.getItem("dirty") || 0) + 1)); } catch {} };
const dbPut = (n) => (markDirty(), reqP(tx("readwrite").put(n)));
const dbDel = (id) => (markDirty(), reqP(tx("readwrite").delete(id)));
function bulk(store, puts, dels) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, "readwrite"), os = t.objectStore(store);
    for (const id of dels || []) os.delete(id);
    for (const r of puts || []) os.put(r);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const sAll = () => reqP(tx("readonly", SSTORE).getAll());
const sPut = (s) => (markDirty(), reqP(tx("readwrite", SSTORE).put(s)));
const sDel = (id) => (markDirty(), reqP(tx("readwrite", SSTORE).delete(id)));

// saved age filter (older versions stored days: 92/183/366 -> 3/6/12 months). Default: 12 months.
function loadAge() {
  const v = localStorage.getItem("age");
  if (v === null) return "12";
  const n = +v;
  if (n === 0) return "0";
  const months = n > 24 ? Math.round(n / 30.4) : n;
  return String([3, 6, 9, 12, 15, 18, 21, 24].reduce((a, b) => (Math.abs(b - months) < Math.abs(a - months) ? b : a)));
}

// ---------- map pool: which maps are in the rotation ----------
// The default comes from maps.js (active:false); your own switches (Map pool button) override it and are remembered.
const famOf = (k) => k.replace(/_lower$/, "");
function loadPool() { try { return JSON.parse(localStorage.getItem("pool") || "{}"); } catch { return {}; } }
function mapActive(k) { const f = famOf(k); return f in S.pool ? !!S.pool[f] : (MAPS[f] || MAPS[k]).active !== false; }

// ---------- state ----------
const S = {
  nades: [], map: localStorage.getItem("map") || "dust2",
  types: new Set(Object.keys(NADE_TYPES)), side: "", q: "",
  selId: null, editing: null, picking: null, fileRadar: {},
  pool: loadPool(), mode: localStorage.getItem("mode") || "land", hoverId: null, hoverIds: null, hoverPos: null, clusterPos: null, xonly: localStorage.getItem("xonly") === "1", age: loadAge(), cluster: null, practice: null, setups: [], tab: "nades", selSetup: null, editSetup: null
};
if (!mapActive(S.map)) S.map = Object.keys(MAPS).find(mapActive) || "dust2";
// Auto-use radars/<map>.png if the file exists next to index.html
Object.keys(MAPS).forEach((k) => {
  const i = new Image();
  i.onload = () => { S.fileRadar[k] = true; if (typeof renderMap === "function" && db) renderMap(); };
  i.src = `radars/${k}.png`;
});
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Screenshots: [{src, label}]. Older plain-string entries still work (label guessed from position).
const SHOT_LABELS = ["Stand", "Aim", "Landing", "Full view", "Other"];
const imgs = (n) => (n.images || []).map((x, i) => (typeof x === "string" ? { src: x, label: SHOT_LABELS[i] || "Other" } : x));
// what to do when throwing: jump/no jump, movement, mouse button (from the stored technique + the source's instruction line)
function throwChips(n) {
  const t = (n.technique || "").toLowerCase(), line = ((n.notes || "").split("\n")[0] || "").toLowerCase();
  const btn = t.includes("left+right") ? "Left+Right click" : t.includes("right") ? "Right click" : "Left click";
  let move = "Standing";
  const mv = /movement: ([a-z ]+)/.exec(line), mvs = mv ? mv[1] : "";
  const shiftWalk = /shift|walk/.test(line) || t.startsWith("walk") || mvs.startsWith("walk") || /crouched walk/.test(mvs);
  if (/crouched walk/.test(mvs)) move = "Crouch-walk (Shift + Ctrl)";
  else if (shiftWalk) move = /tap w/.test(line) ? "Shift-walk, tap W" : "Shift-walk (hold Shift)";
  else if (/tap w|press w/.test(line)) move = "Tap W (don't hold)";
  else if (t.startsWith("run") || /run/.test(line) || /hold w/.test(line) || mvs.startsWith("run")) move = /one step/.test(line) ? "Run 1 step" : /two steps/.test(line) ? "Run 2 steps" : /four steps/.test(line) ? "Run 4 steps" : "Running";
  else if (t.startsWith("crouch") || /crouch|squat/.test(line) || mvs.startsWith("crouch")) move = "Crouching";
  return [t.includes("jump") ? "Jump throw" : "Throw", move, btn];
}
const chipsHtml = (n) => `<span class="chips">${throwChips(n).map((c) => `<span class="chip2">${esc(c)}</span>`).join("")}</span>`;
// CSNADES "Full view" shots are plain screenshots: the crosshair is exactly the screen centre
// cs2util pictures are [aim view | landing view], both centre crops of the game frame - measured against csnades pictures of the
// same throws: the crosshair is at the exact centre of the LEFT half (x 25%, y 50% of the whole picture)
const isUtilCover = (src, label) => label === "Aim" && !String(src).startsWith("data:") && String(src).indexOf("/cn-") < 0;
const xhairClass = (src, label) => (label === "Full view" ? "" : isUtilCover(src, label) ? " half" : null);
const xhairFor = (x) => { const c = xhairClass(x.src, x.label); return c === null ? "" : `<span class="xhair${c}"></span>`; };
const hasCross = (n) => (n.images || []).some((x) => x && x.label === "Full view");
const shotHtml = (n, x, i) => `<div class="shotwrap"><img class="shot" data-nid="${n.id}" src="${x.src}" alt="${esc(x.label)}" onerror="shotFailed(this)">${xhairFor(x)}${i === 0 ? chipsHtml(n) : ""}</div>`;
const galleryHtml = (n) => imgs(n).length
  ? `<div class="gallery">${imgs(n).map((x, i) => `<figure>${shotHtml(n, x, i)}<figcaption>${esc(x.label)}</figcaption></figure>`).join("")}</div>` : "";
function shotFailed(img) {
  const d = document.createElement("div"); d.className = "noshot";
  d.innerHTML = "Screenshot could not be loaded<br><small>" + esc(img.getAttribute("src") || "") + "</small>";
  img.replaceWith(d);
}
function fileToDataURL(file) {
  return new Promise((res) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1400 / img.width), c = document.createElement("canvas");
      c.width = img.width * k; c.height = img.height * k;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.85));
    };
    img.src = url;
  });
}
// Enlarge a screenshot in two steps:  click picture -> big view;  click it again (or press F) -> true fullscreen.
// Esc steps back: fullscreen -> big view -> closed (back to the small preview).
function openLightbox(src, label, n) {
  const d = document.createElement("div"); d.id = "lightbox";
  const hint = "click the picture again for fullscreen \u00b7 Esc to go back";
  // how it is thrown: throw type / movement / mouse button + the source's own instruction line + where from -> where to
  const how = n ? `<div class="lbinfo"><div class="lbtitle"><b>${esc(n.name)}</b><span> \u00b7 ${n.from ? `from <b>${esc(nearestCallout(n.from.x, n.from.y))}</b> \u2192 ` : ""}lands <b>${esc(nearestCallout(n.to.x, n.to.y))}</b></span></div>
      <div class="lbchips">${throwChips(n).map((c) => `<span class="chip2">${esc(c)}</span>`).join("")}</div>
      <div class="lbhow">${esc((n.notes || "").split("\n")[0])}</div></div>` : "";
  d.innerHTML = `<div class="lbwrap"><img src="${src}">${xhairClass(src, label) === null ? "" : `<span class="xhair big${xhairClass(src, label)}"></span>`}</div><span class="lbcap">${esc(label || "")}</span>${how}<span class="lbhint">${hint}</span>`;
  let leftFsAt = 0;
  const isFull = () => document.fullscreenElement === d || d.classList.contains("lbfull");
  const goFull = () => {
    if (d.requestFullscreen) d.requestFullscreen().catch(() => d.classList.add("lbfull"));   // browsers that refuse -> fill the window instead
    else d.classList.add("lbfull");
  };
  const leaveFull = () => { d.classList.remove("lbfull"); if (document.fullscreenElement === d) document.exitFullscreen(); };
  const close = () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("fullscreenchange", onFs); if (document.fullscreenElement === d) document.exitFullscreen(); d.remove(); };
  const onFs = () => { if (!document.fullscreenElement) leftFsAt = Date.now(); };   // the browser's own Esc just left fullscreen
  const onKey = (ev) => {
    const k = ev.key.toLowerCase();
    if (k === "escape") {
      ev.stopPropagation();
      if (Date.now() - leftFsAt < 350) return;           // that Esc already stepped out of fullscreen: stay in the big view
      if (d.classList.contains("lbfull")) leaveFull(); else if (!document.fullscreenElement) close();
    } else if (k === "f") { ev.stopPropagation(); isFull() ? leaveFull() : goFull(); }
  };
  d.onclick = (ev) => { if (ev.target.closest(".lbwrap img")) (isFull() ? leaveFull() : goFull()); else close(); };
  document.addEventListener("keydown", onKey, true); document.addEventListener("fullscreenchange", onFs); document.body.appendChild(d);
}
document.addEventListener("click", (ev) => { const i = ev.target.closest("img.shot"); if (i) openLightbox(i.src, i.alt, nadeById(i.dataset.nid)); });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const nearestCallout = (x, y) => {
  let best = "—", bd = 1e9;
  for (const [n, cx, cy] of MAPS[S.map].callouts) { const d = (cx - x) ** 2 + (cy - y) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
};

// ---------- seed: landing spots only, YOU fill in the lineups ----------
function seed() {
  const mk = (name, type, variant, side, purpose, lx, ly) => ({
    id: uid(), map: "dust2", name, type, variant, side, purpose, technique: "", status: "unknown",
    from: null, to: { x: lx, y: ly }, setpos: "", video: "", notes: "Template - add your lineup, technique and screenshots.",
    tags: [], images: [], created: Date.now()
  });
  return [
    mk("Xbox smoke", "smoke", "standard", "T", "execute", 510, 425),
    mk("CT spawn smoke", "smoke", "standard", "T", "execute", 580, 250),
    mk("Long doors smoke", "smoke", "standard", "CT", "default", 700, 620),
    mk("B window smoke", "smoke", "standard", "T", "execute", 262, 150),
    mk("B doors smoke", "smoke", "standard", "T", "execute", 150, 270),
    mk("Pop flash over B doors", "flash", "pop-flash", "T", "execute", 160, 250),
    mk("A site molly - goose", "molly", "clear", "T", "execute", 700, 115)
  ];
}

// ---------- filtering ----------
// lineups from a source carry an "updated" date; your own nades (no date) always show
// S.age = max age in whole months ("0" = any age). Dates are compared against "today minus N calendar months".
const AGE_OPTIONS = [3, 6, 9, 12, 15, 18, 21, 24];
function olderThan(n, months) {
  if (!n.updated || !(+months > 0)) return false;
  const cut = new Date(); cut.setMonth(cut.getMonth() - +months);
  return new Date(n.updated) < cut;
}
const tooOld = (n) => olderThan(n, S.age);
function hiddenByAge() { const a = S.age; S.age = "0"; const rest = visible().filter((n) => olderThan(n, a)); S.age = a; return rest.length; }
// what the side panel lists: the visible nades, narrowed to the clicked cluster if any
const panelList = () => (S.cluster ? visible().filter((n) => S.cluster.includes(n.id)) : visible());
function visible() {
  const q = S.q.toLowerCase();
  return S.nades.filter((n) => n.map === S.map && S.types.has(n.type) && !tooOld(n) && (!S.xonly || hasCross(n)) && decisionOk(n) && sourceOk(n) && testOk(n) &&
    (!S.side || n.side === S.side || n.side === "Both") &&
    (!q || [n.name, n.variant, n.purpose, n.notes, (n.tags || []).join(" "), nearestCallout(n.to.x, n.to.y)].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

// ---------- map rendering ----------
function radarKey() { return "radar:" + S.map; }
// nades of the same type landing close together collapse into one marker with a count
const CLUSTER_R = 14;   // grid units (map is 1000 wide): lineups landing within ~1.4% of the map merge into one icon
function clusterList(list, key = "to") {
  const cl = [];
  for (const n of list) {
    const p = n[key];
    const c = cl.find((k) => k.type === n.type && Math.hypot(k.x - p.x, k.y - p.y) <= CLUSTER_R / S.mapView.z);
    if (c) { c.items.push(n); c.x = c.items.reduce((s, i) => s + i[key].x, 0) / c.items.length; c.y = c.items.reduce((s, i) => s + i[key].y, 0) / c.items.length; }
    else cl.push({ id: "c:" + n.id, type: n.type, x: p.x, y: p.y, items: [n] });
  }
  cl.forEach((c) => { c.x = Math.round(c.x); c.y = Math.round(c.y); });
  return cl;
}
// icons stay exactly on their spot; only when two icons would overlap the later one is nudged a short step (and tethered back)
function spread(items) {
  const z = S.mapView.z, pos = {}, placed = [], near = (q, t) => Math.hypot(q.x - t.x, q.y - t.y) < 13 / z;
  for (const it of items) {
    let p = { x: it.to.x, y: it.to.y };
    if (placed.some((q) => near(q, p))) {
      let found = false;
      for (let ring = 1; ring <= 3 && !found; ring++) {
        for (let k = 0; k < 6 && !found; k++) {
          const ang = (k * Math.PI) / 3 - Math.PI / 2, t = { x: Math.round(it.to.x + Math.cos(ang) * 15 * ring / z), y: Math.round(it.to.y + Math.sin(ang) * 15 * ring / z) };
          if (!placed.some((q) => near(q, t))) { p = t; found = true; }
        }
      }
    }
    placed.push(p); pos[it.id] = p;
  }
  return pos;
}
// hover preview of one lineup: stand-spot arrow, line of flight and a ring on the landing spot, drawn on top of the map
function drawPreview(id) {
  const layer = document.getElementById("previewLayer"); if (!layer) return;
  const n = id ? nadeById(id) : null;
  if (!n || !n.to) { layer.innerHTML = ""; return; }
  const c = NADE_TYPES[n.type].color;
  let h = "";
  if (n.from) h += `<line class="pvline" stroke="${c}" x1="${n.from.x}" y1="${n.from.y}" x2="${n.to.x}" y2="${n.to.y}"/>` + pin(n.from.x, n.from.y, `<path class="pvfrom" fill="${c}" d="M${n.from.x} ${n.from.y - 15} l13 25 h-26 z"/>`);
  h += pin(n.to.x, n.to.y, `<circle class="pvring" stroke="${c}" cx="${n.to.x}" cy="${n.to.y}" r="14"/><circle cx="${n.to.x}" cy="${n.to.y}" r="3.5" fill="${c}"/>`);
  layer.innerHTML = h;
}
// branches: a merged icon (hovered or clicked) shows a thin line to each member's exact landing spot
function drawBranches() {
  const layer = document.getElementById("branchLayer"); if (!layer) return;
  const key = S.mode === "throw" ? "from" : "to";
  const want = [S.hoverIds, S.cluster].filter(Boolean).map((a) => a.join(","));
  let h = "";
  for (const c of S._clusters || []) {
    if (c.items.length < 2 || !want.includes(c.items.map((i) => i.id).join(","))) continue;
    const col = NADE_TYPES[c.type].color;
    for (const n of c.items) { const q = n[key]; h += `<line class="branch" stroke="${col}" x1="${c.px}" y1="${c.py}" x2="${q.x}" y2="${q.y}"/><circle class="bdot" cx="${q.x}" cy="${q.y}" r="${4.5 / S.mapView.z}" fill="${col}"/>`; }
  }
  layer.innerHTML = h;
}
// ---------- zoom + pan: the svg viewBox is a window of w x w grid units ----------
S.mapView = { z: 1, x: 0, y: 0 };
const ZMAX = 6;
// anything that must stay the same size on screen is drawn scaled by 1/zoom around its own centre
const pin = (x, y, inner) => `<g transform="translate(${x} ${y}) scale(${1 / S.mapView.z}) translate(${-x} ${-y})">${inner}</g>`;
function applyView() {
  const v = S.mapView, w = 1000 / v.z;
  v.x = Math.max(0, Math.min(1000 - w, v.x)); v.y = Math.max(0, Math.min(1000 - w, v.y));
  const svg = $("#map");
  svg.setAttribute("viewBox", `${v.x} ${v.y} ${w} ${w}`);
  svg.style.setProperty("--zs", 1 / v.z);
  const l = $("#zoomLbl"); if (l) l.textContent = Math.round(v.z * 100) + "%";
}
let _vrf = 0;
function afterView(full) {                     // redraw on the next frame (icons depend on zoom), or just move the popup when only panning
  if (_vrf) return; _vrf = requestAnimationFrame(() => { _vrf = 0; if (full) renderMap(); renderLineupCard(); });
}
function setZoom(nz, cx, cy) {
  const v = S.mapView, w0 = 1000 / v.z;
  nz = Math.max(1, Math.min(ZMAX, nz));
  if (cx == null) { cx = v.x + w0 / 2; cy = v.y + w0 / 2; }
  const fx = (cx - v.x) / w0, fy = (cy - v.y) / w0, w1 = 1000 / nz;
  v.z = nz; v.x = cx - fx * w1; v.y = cy - fy * w1;
  applyView(); afterView(true);
}
function renderMap() {
  const m = MAPS[S.map], svg = $("#map");
  if (S._viewMap !== S.map) { S.mapView = { z: 1, x: 0, y: 0 }; S._viewMap = S.map; }
  applyView();
  const radar = localStorage.getItem(radarKey()) || (S.fileRadar[S.map] ? `radars/${S.map}.png` : null);
  let h = radar ? `<image href="${radar}" width="1000" height="1000" opacity=".9"/>` : (m.shapes || "");
  if ($("#showLabels").checked) h += m.callouts.map(([n, x, y]) => `<text class="lbl" x="${x}" y="${y}">${esc(n)}</text>`).join("");
  const throwMode = S.mode === "throw", key = throwMode ? "from" : "to";
  const list = visible(), sel = S.nades.find((n) => n.id === S.selId);
  const clusters = clusterList(throwMode ? list.filter((n) => n.from) : list, key);
  const P = spread(clusters.map((c) => ({ id: c.id, to: { x: c.x, y: c.y } })));
  const cpos = (c) => P[c.id] || { x: c.x, y: c.y };
  const selCl = clusters.find((c) => c.items.some((i) => i.id === S.selId));
  if (sel && sel.from && !practiceHidden()) {
    const c = NADE_TYPES[sel.type].color;   // the line always ends exactly on this lineup's own landing spot
    h += `<line class="throw" stroke="${c}" x1="${sel.from.x}" y1="${sel.from.y}" x2="${sel.to.x}" y2="${sel.to.y}"/>`;
    h += pin(sel.to.x, sel.to.y, `<circle cx="${sel.to.x}" cy="${sel.to.y}" r="12" fill="none" stroke="${c}" stroke-width="3"/><circle cx="${sel.to.x}" cy="${sel.to.y}" r="3" fill="${c}"/>`);
    if (!throwMode) h += pin(sel.from.x, sel.from.y, `<path class="from" fill="${c}" d="M${sel.from.x} ${sel.from.y - 12} l10 20 h-20z"/>`);
  }
  const su = activeSetup(), inSu = new Set(su ? su.steps.map((s) => s.nadeId) : []);
  clusters.forEach((c) => { const q = cpos(c); c.px = q.x; c.py = q.y; });
  S._clusters = clusters;
  h += `<g id="branchLayer"></g>`;
  h += clusters.map((c) => {
    const p = cpos(c), k = c.items.length, ids = c.items.map((i) => i.id), col = NADE_TYPES[c.type].color, ic = NADE_TYPES[c.type].icon;
    const isSel = ids.includes(S.selId), inCl = S.cluster && ids.some((i) => S.cluster.includes(i));
    const dim = (S.selId && !isSel) || (S.cluster && !inCl && !isSel) || (su && !ids.some((i) => inSu.has(i)));
    const shape = throwMode
      ? `<path d="M${p.x} ${p.y - 14} l${k > 1 ? 15 : 12} ${k > 1 ? 26 : 22} h-${k > 1 ? 30 : 24} z" fill="${col}"/><text x="${p.x}" y="${p.y + 7}">${ic}</text>`
      : `<circle cx="${p.x}" cy="${p.y}" r="${k > 1 ? 13 : 11}" fill="${col}"/><text x="${p.x}" y="${p.y + 4}">${ic}</text>`;
    const off = Math.hypot(p.x - c.x, p.y - c.y) > 2 ? `<line class="branch" stroke="${col}" x1="${c.x}" y1="${c.y}" x2="${p.x}" y2="${p.y}"/><circle class="bdot" cx="${c.x}" cy="${c.y}" r="3" fill="${col}"/>` : "";
    return `<g class="mk ${isSel ? "sel" : ""} ${dim ? "dim" : ""} ${c.items.some((i) => i.decision === "keep") ? "kept" : ""}" data-ids="${ids.join(",")}" data-x="${p.x}" data-y="${p.y}" transform="translate(${p.x} ${p.y}) scale(${1 / S.mapView.z}) translate(${-p.x} ${-p.y})">${off}${shape}
      ${k > 1 ? `<circle class="cnt" cx="${p.x + 11}" cy="${p.y - 11}" r="8"/><text class="cntTxt" x="${p.x + 11}" y="${p.y - 7.5}">${k}</text>` : ""}</g>`;
  }).join("");
  if (su) h += setupOverlay(su);
  h += `<g id="previewLayer"></g>`;
  // in-progress points while editing
  const e = S.editing;
  if (e) {
    if (e.from) h += pin(e.from.x, e.from.y, `<path fill="#fff" d="M${e.from.x} ${e.from.y - 12} l10 20 h-20z"/>`);
    if (e.to) h += pin(e.to.x, e.to.y, `<circle cx="${e.to.x}" cy="${e.to.y}" r="15" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="5 4"/>`);
  }
  svg.innerHTML = h;
  svg.classList.toggle("picking", !!S.picking || !!S.fixLanding);
  drawBranches();
}

function svgPoint(ev) {
  const svg = $("#map"), p = svg.createSVGPoint();
  p.x = ev.clientX; p.y = ev.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse());
  return { x: Math.round(q.x), y: Math.round(q.y) };
}

// ---------- list / detail ----------
function renderList() {
  const list = panelList(), hid = S.cluster ? 0 : hiddenByAge();
  $("#list").innerHTML = (S.cluster ? `<div class="row"><b>${list.length} nades of the same type land here</b><button id="clearCluster" style="flex:none">Show all</button></div>` : "") +
    (hid ? `<p class="dim" style="font-size:12px">${hid} older lineup${hid === 1 ? "" : "s"} hidden (source updated more than ${S.age} months ago). <button class="linkbtn" id="showOld">Show them</button></p>` : "") +
    (list.length ? "" : `<p class="dim">No nades match. Click <b>+ New nade</b>${+S.age ? ", or widen the age filter" : ""}.</p>`) +
    list.map((n) => `<div class="item ${n.decision === "keep" ? "kept" : n.decision === "discard" ? "discarded" : ""} ${n.tested === "broken" ? "broken" : ""}" data-id="${n.id}">
      <div class="dot" style="background:${NADE_TYPES[n.type].color}">${NADE_TYPES[n.type].icon}</div>
      <div style="flex:1"><b>${esc(n.name)}</b><br><small>${esc(n.variant)} · ${esc(n.side)} · ${esc(n.purpose)} · → ${esc(nearestCallout(n.to.x, n.to.y))}${pbadge(n)}${hasCross(n) ? " \u00b7 \ud83c\udfaf crosshair" : ""} \u00b7 ${esc(srcLabel(n))}${testNote(n)}</small></div>
      ${decButtons(n)}</div>`).join("");
}

function renderDetail() {
  const n = S.nades.find((x) => x.id === S.selId), el = $("#detail");
  $("#list").hidden = !!(n || S.editing);
  el.hidden = !n || !!S.editing;
  if (el.hidden) return;
  el.innerHTML = `<button id="back">← All nades</button>
    <h2>${esc(n.name)} ${decBadge(n)}</h2>
    ${decisionBlock(n)}
    <div><span class="tag">${esc(NADE_TYPES[n.type].label)}</span><span class="tag">${esc(n.variant)}</span><span class="tag">${esc(n.side)}</span><span class="tag">${esc(n.purpose)}</span>${(n.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>
    <p class="dim">${n.from ? `From <b>${esc(nearestCallout(n.from.x, n.from.y))}</b> → ` : ""}lands <b>${esc(nearestCallout(n.to.x, n.to.y))}</b>${n.technique ? ` · ${esc(n.technique)}` : ""} · <span class="st-${n.status}">${esc(n.status)}</span>${n.updated ? ` · updated ${esc(n.updated)}` : ""}</p>
    ${galleryHtml(n)}
    <div class="row"><label class="linkbtn" style="flex:none">📷 Add screenshot<input type="file" id="addShot" accept="image/*" multiple hidden></label><span class="dim" style="font-size:12px">or press Ctrl+V to paste one here</span></div>
    ${pdetail(n)}
    ${n.setpos ? `<pre class="cmd">${esc(n.setpos)}</pre><button id="copySet">Copy setpos</button>` : ""}
    ${n.notes ? `<p>${esc(n.notes).replace(/\n/g, "<br>")}</p>` : ""}
    ${n.video ? `<p><a href="${esc(n.video)}" target="_blank" rel="noopener" style="color:var(--acc)">▶ Video</a></p>` : ""}
    <div class="row"><button id="edit">Edit</button><button id="dup">Duplicate</button><button id="del" class="danger">Delete</button></div>`;
  $("#back").onclick = () => select(null);
  $("#edit").onclick = () => startEdit(n);
  $("#dup").onclick = async () => { const c = { ...structuredClone(n), id: uid(), name: n.name + " (copy)", created: Date.now() }; await dbPut(c); S.nades.push(c); select(c.id); };
  $("#del").onclick = async () => { if (confirm(`Delete "${n.name}"?`)) { await dbDel(n.id); S.nades = S.nades.filter((x) => x.id !== n.id); select(null); } };
  const cs = $("#copySet"); if (cs) cs.onclick = () => { navigator.clipboard.writeText(n.setpos); cs.textContent = "Copied!"; };
  $("#addShot").onchange = async (ev) => { for (const f of ev.target.files) await quickAddShot(n, f); ev.target.value = ""; };
}

// big lineup preview on the map for the selected nade
// popup for an arrow that stands for several lineups: a screenshot of each
function clusterCardHtml(ids) {
  const ns = ids.map(nadeById).filter(Boolean), more = ns.length - 12;
  return `<div class="cardtitle"><b>${ns.length} lineups from here</b><br><small class="dim">Click one to open it</small></div>
    <div class="cgrid">${ns.slice(0, 12).map((n) => { const p = imgs(n)[0]; return `<div class="citem" data-id="${n.id}">
      ${p ? `<img src="${p.src}" alt="" onerror="shotFailed(this)">` : `<div class="noshot">no screenshot</div>`}
      <span class="cname">${esc(n.name)}</span>${hasCross(n) ? `<span class="cx">\ud83c\udfaf</span>` : ""}</div>`; }).join("")}</div>
    ${more > 0 ? `<div class="dim cardhint">+${more} more in the list on the right</div>` : ""}`;
}
function placeCard(el, a) {
  const svg = $("#map"), wrap = $("#mapWrap").getBoundingClientRect();
  const pt = svg.createSVGPoint(); pt.x = a.x; pt.y = a.y;
  const sp = pt.matrixTransform(svg.getScreenCTM()), px = sp.x - wrap.left, py = sp.y - wrap.top;
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = px + 28; if (left + w > wrap.width - 8) left = px - 28 - w;
  left = Math.max(8, Math.min(left, wrap.width - w - 8));
  const top = Math.max(8, Math.min(py - h / 2, wrap.height - h - 40));
  el.style.left = left + "px"; el.style.top = top + "px";
}
function renderLineupCard() {
  baseRenderLineupCard();
  const el = $("#lineupCard");
  if (S.cardPos && !el.hidden && !el.classList.contains("hover")) { el.style.left = S.cardPos.x + "px"; el.style.top = S.cardPos.y + "px"; }
}
// drag the popup by its title or empty background; the place is remembered until you reload
(() => {
  const el = $("#lineupCard"); let d = null;
  el.addEventListener("pointerdown", (ev) => {
    if (ev.button || el.classList.contains("hover") || ev.target.closest("button,img,input,select,textarea,.citem,a")) return;
    d = { dx: ev.clientX - el.offsetLeft, dy: ev.clientY - el.offsetTop, moved: false };
    el.setPointerCapture(ev.pointerId); ev.preventDefault();
  });
  el.addEventListener("pointermove", (ev) => {
    if (!d) return; d.moved = true;
    const wrap = $("#mapWrap").getBoundingClientRect();
    const x = Math.max(0, Math.min(ev.clientX - d.dx, wrap.width - 60)), y = Math.max(0, Math.min(ev.clientY - d.dy, wrap.height - 40));
    S.cardPos = { x, y }; el.style.left = x + "px"; el.style.top = y + "px";
  });
  const end = () => { d = null; };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
})();
function baseRenderLineupCard() {
  const el = $("#lineupCard"), hov = S.hoverId ? nadeById(S.hoverId) : null;
  const allowed = !S.editing && !S.practice && !S.review && !S.verify && S.tab === "nades" && $("#showCard").checked;
  const sel = nadeById(S.selId), n = hov || sel;
  // which card? single nade (hover or selected) > merged arrow under the mouse > merged arrow you clicked (nothing selected yet)
  let mode = null, ids = null, pos = null;
  if (n && (hov || S.cardClosed !== n.id)) mode = "nade";
  else if (S.hoverIds) { mode = "cluster"; ids = S.hoverIds; pos = S.hoverPos; }
  else if (!sel && S.cluster && S.clusterPos && S.cardClosed !== "cluster") { mode = "cluster"; ids = S.cluster; pos = S.clusterPos; }
  if (!allowed || !mode) { el.hidden = true; return; }
  el.hidden = false;
  if (mode === "cluster") {
    el.classList.toggle("hover", !!S.hoverIds);
    el.classList.add("wide");
    el.innerHTML = `<button class="cardx" title="Close">\u00d7</button>` + clusterCardHtml(ids);
    el.querySelector(".cardx").onclick = () => { S.cardClosed = "cluster"; S.hoverIds = null; el.hidden = true; };
    el.querySelectorAll(".citem").forEach((c) => {
      c.onclick = () => select(c.dataset.id);
      c.onmouseenter = () => drawPreview(c.dataset.id);
      c.onmouseleave = () => drawPreview(null);
    });
    return placeCard(el, pos);
  }
  el.classList.remove("wide");
  const pics = imgs(n);
  el.classList.toggle("hover", !!hov && hov.id !== S.selId);
  el.innerHTML = `<button class="cardx" title="Close">\u00d7</button>
    <div class="cardtitle"><b>${esc(n.name)}</b><br><small class="dim">${n.from ? `Throw from <b>${esc(nearestCallout(n.from.x, n.from.y))}</b> \u2192 lands <b>${esc(nearestCallout(n.to.x, n.to.y))}</b>` : `Lands <b>${esc(nearestCallout(n.to.x, n.to.y))}</b>`} \u00b7 ${esc(n.technique || "")}</small></div>
    ${pics.length ? shotHtml(n, pics[0], 0) : `<div class="noshot">No screenshot yet.<br><small>Select this nade and press Ctrl+V to paste one.</small></div>`}
    ${pics.length > 1 ? `<div class="cardthumbs">${pics.slice(1).map((x, i) => shotHtml(n, x, i + 1)).join("")}</div>` : ""}
    ${n.setpos ? `<div class="dim cardhint">Copy setpos \u2192 puts you on the exact spot with the exact crosshair angle.</div>` : ""}
    ${n.setpos ? `<button class="cardcopy">Copy setpos</button>` : ""}
    <div class="row" style="margin-top:6px"><button class="dbtn ${n.decision === "keep" ? "on keepOn" : ""}" data-dec="keep" data-id="${n.id}">✓ Keep</button><button class="dbtn ${n.decision === "discard" ? "on discOn" : ""}" data-dec="discard" data-id="${n.id}">✗ Discard</button></div>
    <div class="row" style="margin-top:6px"><button class="dbtn ${n.tested === "ok" ? "on keepOn" : ""}" data-test="ok" data-id="${n.id}" style="font-size:12px">✓ Works in game</button><button class="dbtn ${n.tested === "broken" ? "on discOn" : ""}" data-test="broken" data-id="${n.id}" style="font-size:12px">✗ Broken</button></div>
    <div class="row" style="margin-top:6px"><button data-fix="${n.id}" style="font-size:12px" title="Then click the map where it really lands">📍 Fix landing spot</button></div>`;
  el.querySelector(".cardx").onclick = () => { S.cardClosed = n.id; S.hoverId = null; el.hidden = true; };
  const c = el.querySelector(".cardcopy"); if (c) c.onclick = () => { navigator.clipboard.writeText(n.setpos); c.textContent = "Copied!"; };
  placeCard(el, n.from || n.to);
}
window.addEventListener("resize", () => renderLineupCard());
function select(id) { S.selId = id; S.editing = null; S.picking = null; refresh(); }

// ---------- editor ----------
function startEdit(n) {
  S.editing = n ? { ...structuredClone(n), images: imgs(structuredClone(n)) } : {
    id: uid(), map: S.map, name: "", type: "smoke", variant: "standard", side: "T", purpose: "execute", technique: "",
    status: "unknown", from: null, to: null, setpos: "", video: "", notes: "", tags: [], images: [], created: Date.now(), _new: true
  };
  S.selId = n ? n.id : null; S.picking = null; refresh();
}

function renderForm() {
  const e = S.editing, el = $("#form");
  el.hidden = !e;
  $("#pickBanner").hidden = !(S.picking || S.fixLanding);
  if (S.picking) $("#pickBanner").textContent = S.picking === "from" ? "Click the map where you STAND" : "Click the map where the nade LANDS";
  if (S.fixLanding) $("#pickBanner").textContent = S.verify ? "Click the map where it really lands - or press Enter if the marker is already right" : "Click the map where this nade really LANDS (Esc to cancel)";
  if (!e) return;
  if (el.dataset.eid === e.id && el.children.length) { syncPointLabels(); return; } // don't wipe inputs mid-edit
  el.dataset.eid = e.id;
  const opt = (arr, v) => arr.map((a) => `<option ${a === v ? "selected" : ""}>${a}</option>`).join("");
  el.innerHTML = `<h2>${e._new ? "New nade" : "Edit nade"}</h2>
    <label class="lbl2">Name</label><input id="f_name" value="${esc(e.name)}" placeholder="e.g. Xbox smoke from T spawn">
    <div class="row">
      <div><label class="lbl2">Type</label><select id="f_type">${Object.entries(NADE_TYPES).map(([k, v]) => `<option value="${k}" ${k === e.type ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
      <div><label class="lbl2">Side</label><select id="f_side">${opt(["T", "CT", "Both"], e.side)}</select></div>
      <div><label class="lbl2">Status</label><select id="f_status">${opt(["unknown", "practicing", "learned"], e.status)}</select></div>
    </div>
    <div class="row">
      <div><label class="lbl2">Variant</label><input id="f_variant" list="dl_var" value="${esc(e.variant)}"></div>
      <div><label class="lbl2">Purpose</label><input id="f_purpose" list="dl_pur" value="${esc(e.purpose)}"></div>
    </div>
    <label class="lbl2">Throw technique</label><input id="f_tech" list="dl_tech" value="${esc(e.technique)}">
    <datalist id="dl_var">${VARIANTS.map((v) => `<option>${v}`).join("")}</datalist>
    <datalist id="dl_pur">${PURPOSES.map((v) => `<option>${v}`).join("")}</datalist>
    <datalist id="dl_tech">${TECHNIQUES.map((v) => `<option>${v}`).join("")}</datalist>
    <label class="lbl2">Positions</label>
    <div class="row"><button id="pickFrom">📍 Set stand spot</button><button id="pickTo">🎯 Set landing spot</button></div>
    <div class="dim" id="ptLabels"></div>
    <label class="lbl2">setpos / setang (for practice server)</label><input id="f_setpos" value="${esc(e.setpos)}" placeholder="setpos 0 0 0; setang 0 0 0">
    <label class="lbl2">Video / link</label><input id="f_video" value="${esc(e.video)}" placeholder="https://…">
    <label class="lbl2">Notes</label><textarea id="f_notes" placeholder="Aim point, timing, what it blocks, tricks…">${esc(e.notes)}</textarea>
    <label class="lbl2">Tags (comma separated)</label><input id="f_tags" value="${esc((e.tags || []).join(", "))}">
    <label class="lbl2">Screenshots - where you stand, crosshair aim, landing (upload, or Ctrl+V)</label>
    <div class="thumbs" id="thumbs"></div>
    <input type="file" id="f_img" accept="image/*" multiple>
    <div class="row" style="margin-top:12px"><button id="save" class="primary">Save</button><button id="cancel">Cancel</button></div>`;
  $("#pickFrom").onclick = () => { S.picking = "from"; refresh(); };
  $("#pickTo").onclick = () => { S.picking = "to"; refresh(); };
  $("#f_img").onchange = async (ev) => { for (const f of ev.target.files) await addImage(f); ev.target.value = ""; };
  $("#cancel").onclick = () => select(e._new ? null : e.id);
  $("#save").onclick = save;
  renderThumbs(); syncPointLabels();
}

function syncPointLabels() {
  const e = S.editing; if (!e || !$("#ptLabels")) return;
  $("#ptLabels").textContent = `Stand: ${e.from ? nearestCallout(e.from.x, e.from.y) + " (near)" : "not set"}  ·  Lands: ${e.to ? nearestCallout(e.to.x, e.to.y) + " (near)" : "not set"}`;
}
function renderThumbs() {
  $("#thumbs").innerHTML = S.editing.images.map((x, i) => `<div><img src="${x.src}"><b data-i="${i}">×</b>
    <select data-l="${i}">${SHOT_LABELS.map((l) => `<option ${l === x.label ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("");
  $("#thumbs").querySelectorAll("b").forEach((b) => (b.onclick = () => { S.editing.images.splice(+b.dataset.i, 1); renderThumbs(); }));
  $("#thumbs").querySelectorAll("select").forEach((s) => (s.onchange = () => (S.editing.images[+s.dataset.l].label = s.value)));
}
async function addImage(file) {
  const im = S.editing.images;
  im.push({ src: await fileToDataURL(file), label: SHOT_LABELS[Math.min(im.length, 2)] });   // 1st=Stand, 2nd=Aim, then Landing
  renderThumbs();
}
// add a screenshot straight from the nade page (no need to open Edit)
async function quickAddShot(n, file) {
  n.images = imgs(n);
  n.images.push({ src: await fileToDataURL(file), label: SHOT_LABELS[Math.min(n.images.length, 2)] });
  await dbPut(n); refresh();
}
document.addEventListener("paste", (ev) => {
  const files = [...ev.clipboardData.items].filter((it) => it.type.startsWith("image/")).map((it) => it.getAsFile());
  if (!files.length) return;
  if (S.editing) return files.forEach(addImage);
  const n = S.tab === "nades" && !S.practice && nadeById(S.selId);
  if (n) files.forEach((f) => quickAddShot(n, f));
});

async function save() {
  const e = S.editing;
  if (!$("#f_name").value.trim()) return alert("Give it a name.");
  if (!e.to) return alert("Set the landing spot on the map.");
  Object.assign(e, {
    name: $("#f_name").value.trim(), type: $("#f_type").value, side: $("#f_side").value, status: $("#f_status").value,
    variant: $("#f_variant").value.trim(), purpose: $("#f_purpose").value.trim(), technique: $("#f_tech").value.trim(),
    setpos: $("#f_setpos").value.trim(), video: $("#f_video").value.trim(), notes: $("#f_notes").value.trim(),
    tags: $("#f_tags").value.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean)
  });
  delete e._new;
  await dbPut(e);
  const i = S.nades.findIndex((x) => x.id === e.id);
  if (i >= 0) S.nades[i] = e; else S.nades.push(e);
  select(e.id);
}

// ---------- wiring ----------
function refresh() {
  if (typeof backupBanner === "function" && db) { backupBanner(); renderBackupInfo(); }
  if (!S.editing) $("#form").dataset.eid = "";
  renderMap(); renderList(); renderDetail(); renderForm(); renderSetups(); renderPractice(); renderReview(); renderVerify(); renderLineupCard();
}

$("#map").addEventListener("click", async (ev) => {
  if (S._dragged) return;                                 // that was a pan, not a click
  if (S.fixLanding) {                                     // "Fix landing spot": the next click on the map is the real landing spot
    const n = nadeById(S.fixLanding); S.fixLanding = null;
    const prev = n ? { to: { ...n.to }, tags: [...(n.tags || [])], fixed: n.landingFixed } : null;
    if (n) { n.to = svgPoint(ev); n.landingFixed = true; n.tags = (n.tags || []).filter((t) => !t.startsWith("landing-")); await dbPut(n); }
    if (n && S.verify) return verifyAfterFix(n, prev);
    return refresh();
  }
  if (S.picking && S.editing) {
    S.editing[S.picking] = svgPoint(ev); S.picking = null; refresh(); return;
  }
  const g = ev.target.closest(".mk");
  if (!g || S.practice || S.review) return;
  const ids = g.dataset.ids.split(",");
  if (S.editSetup) return addStep(ids[0]);                // while building a setup: click = add step
  if (S.tab === "setups") { S.tab = "nades"; S.selSetup = null; }
  if (ids.length === 1) {
    if (S.selId === ids[0]) {                             // same nade again: toggle its popup window
      const open = !$("#lineupCard").hidden && S.cardClosed !== ids[0];
      S.cardClosed = open ? ids[0] : null; S.hoverId = null; S.noHover = open ? ids[0] : null;
      return renderLineupCard();
    }
    S.cardClosed = null; S.noHover = null;
    return select(ids[0]);
  }
  if (S.cluster && !S.selId && S.cluster.join(",") === ids.join(",")) {   // same merged icon again: toggle its popup
    const open = !$("#lineupCard").hidden && S.cardClosed !== "cluster";
    S.cardClosed = open ? "cluster" : null; S.hoverIds = null; S.noHoverKey = open ? ids.join(",") : null;
    return renderLineupCard();
  }
  S.noHoverKey = null;
  S.cluster = ids; S.clusterPos = { x: +g.dataset.x, y: +g.dataset.y }; S.cardClosed = null; S.selId = null; S.editing = null; S.picking = null; refresh();   // several nades here: list them + popup
});
$("#list").addEventListener("mouseover", (ev) => { const it = ev.target.closest(".item"); drawPreview(it ? it.dataset.id : null); });
$("#list").addEventListener("mouseleave", () => drawPreview(null));
$("#list").addEventListener("click", (ev) => {
  if (ev.target.closest("#clearCluster")) { S.cluster = null; return refresh(); }
  if (ev.target.closest("#showOld")) { S.age = "0"; $("#ageFilter").value = "0"; localStorage.setItem("age", "0"); return refresh(); }
  const it = ev.target.closest(".item"); if (it) select(it.dataset.id);
});
$("#ageFilter").innerHTML = AGE_OPTIONS.map((m) => `<option value="${m}">Updated ≤ ${m} months</option>`).join("") + `<option value="0">Any age</option>`;
$("#ageFilter").value = S.age;
$("#ageFilter").onchange = (ev) => { S.age = ev.target.value; localStorage.setItem("age", S.age); S.cluster = null; refresh(); };
$("#addBtn").onclick = () => startEdit(null);
$("#search").oninput = (ev) => { S.q = ev.target.value; refresh(); };
$("#sideFilter").onchange = (ev) => { S.side = ev.target.value; refresh(); };
$("#markMode").value = S.mode;
$("#markMode").onchange = (ev) => { S.mode = ev.target.value; localStorage.setItem("mode", S.mode); S.cluster = null; refresh(); };
{
  const svg = $("#map"), pts = new Map();
  let drag = null, pinch = null;
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const p = svgPoint(ev);
    setZoom(S.mapView.z * (ev.deltaY < 0 ? 1.2 : 1 / 1.2), p.x, p.y);
  }, { passive: false });
  svg.addEventListener("pointerdown", (ev) => {
    S._dragged = false; pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 1) drag = { x: ev.clientX, y: ev.clientY, vx: S.mapView.x, vy: S.mapView.y };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: S.mapView.z }; drag = null; }
  });
  window.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const r = svg.getBoundingClientRect();
    if (pts.size === 2 && pinch) {                                           // two fingers: zoom
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = svgPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      S._dragged = true; setZoom(pinch.z * (d / pinch.d), mid.x, mid.y); return;
    }
    if (!drag || S.mapView.z <= 1) return;                                      // one pointer: pan (only when zoomed in)
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) S._dragged = true;
    if (!S._dragged) return;
    const k = (1000 / S.mapView.z) / r.width;                                   // screen px -> grid units
    S.mapView.x = drag.vx - dx * k; S.mapView.y = drag.vy - dy * k;
    applyView(); afterView(false);
  });
  const up = (ev) => { pts.delete(ev.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };
  window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  $("#zoomIn").onclick = () => setZoom(S.mapView.z * 1.4);
  $("#zoomOut").onclick = () => setZoom(S.mapView.z / 1.4);
  $("#zoomReset").onclick = () => { S.mapView = { z: 1, x: 0, y: 0 }; applyView(); afterView(true); };
  window.addEventListener("keydown", (ev) => {
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "0" && !S.review && !S.practice) { S.mapView = { z: 1, x: 0, y: 0 }; applyView(); afterView(true); }
  });
}
$("#map").addEventListener("mouseover", (ev) => {
  const g = ev.target.closest(".mk");
  const ids = g ? g.dataset.ids.split(",") : null;
  let one = ids && ids.length === 1 ? ids[0] : null, many = ids && ids.length > 1 ? ids : null;
  const key = (many || []).join(",");
  if (one !== S.noHover && key !== S.noHoverKey) { S.noHover = null; S.noHoverKey = null; }   // left the icon: hover works again
  if (one && one === S.noHover) one = null;
  if (many && key === S.noHoverKey) many = null;
  const key2 = (many || []).join(",");
  if (one !== S.hoverId || key2 !== (S.hoverIds || []).join(",")) {
    S.hoverId = one; S.hoverIds = many; S.hoverPos = many ? { x: +g.dataset.x, y: +g.dataset.y } : null;
    drawBranches(); renderLineupCard();
  }
});
$("#map").addEventListener("mouseleave", () => { S.noHover = null; S.noHoverKey = null; if (S.hoverId || S.hoverIds) { S.hoverId = null; S.hoverIds = null; drawBranches(); renderLineupCard(); } });
$("#xonly").checked = S.xonly;
$("#xonly").onchange = (ev) => { S.xonly = ev.target.checked; localStorage.setItem("xonly", S.xonly ? "1" : "0"); S.cluster = null; refresh(); };
$("#showLabels").onchange = renderMap;
$("#showCard").onchange = renderLineupCard;
$("#mapSel").onchange = (ev) => { S.map = ev.target.value; localStorage.setItem("map", S.map); S.selSetup = null; S.editSetup = null; S.practice = null; S.cluster = null; select(null); };
$("#radarFile").onchange = (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { localStorage.setItem(radarKey(), r.result); } catch { alert("Image too large."); } renderMap(); };
  r.readAsDataURL(f);
};
$("#radarReset").onclick = () => { localStorage.removeItem(radarKey()); renderMap(); };

$("#typeFilters").innerHTML = Object.entries(NADE_TYPES).map(([k, v]) =>
  `<button class="chip on" data-t="${k}" style="border-color:${v.color};color:${v.color}">${v.label}</button>`).join("");
$("#typeFilters").onclick = (ev) => {
  const b = ev.target.closest(".chip"); if (!b) return;
  const t = b.dataset.t; S.types.has(t) ? S.types.delete(t) : S.types.add(t);
  b.classList.toggle("on", S.types.has(t)); refresh();
};
function buildMapSelect() {
  const opt = (k) => `<option value="${k}" ${k === S.map ? "selected" : ""} ${mapActive(k) ? "" : "disabled"}>${MAPS[k].name}${mapActive(k) ? "" : " (out of rotation)"}</option>`;
  const keys = Object.keys(MAPS), on = keys.filter(mapActive), off = keys.filter((k) => !mapActive(k));
  $("#mapSel").innerHTML = on.map(opt).join("") + (off.length ? `<optgroup label="Out of rotation - greyed out">${off.map(opt).join("")}</optgroup>` : "");
}
buildMapSelect();

// Map pool panel: tick the maps that are in the rotation. Saved lineups of unticked maps are kept.
function renderPool() {
  const fams = Object.keys(MAPS).filter((k) => !k.endsWith("_lower"));
  $("#poolPanel").innerHTML = `<b>Map pool</b><p class="dim">Untick a map that left the rotation. It is greyed out, but its saved lineups stay and come back when you tick it again.</p>` +
    fams.map((f) => {
      const n = S.nades.filter((x) => famOf(x.map) === f).length, on = mapActive(f);
      return `<label class="poolrow ${on ? "" : "off"}"><input type="checkbox" data-fam="${f}" ${on ? "checked" : ""}> ${esc(MAPS[f].name)} <span class="dim">${n} saved</span></label>`;
    }).join("") + `<button id="poolReset" class="linkbtn">Reset to default</button>`;
}
$("#poolBtn").onclick = (ev) => { ev.stopPropagation(); const p = $("#poolPanel"); p.hidden = !p.hidden; if (!p.hidden) renderPool(); };
document.addEventListener("click", (ev) => { const p = $("#poolPanel"); if (!p.hidden && !ev.target.closest("#poolPanel")) p.hidden = true; });
$("#poolPanel").addEventListener("click", (ev) => {
  const c = ev.target.closest("[data-fam]"), r = ev.target.closest("#poolReset");
  if (!c && !r) return;
  if (r) S.pool = {}; else S.pool[c.dataset.fam] = c.checked;
  localStorage.setItem("pool", JSON.stringify(S.pool));
  if (!mapActive(S.map)) {   // the map you were on just left the pool: move to the first active one
    S.map = Object.keys(MAPS).find(mapActive) || "dust2"; localStorage.setItem("map", S.map);
    S.selSetup = null; S.editSetup = null; S.practice = null; S.cluster = null; S.selId = null; S.editing = null;
  }
  buildMapSelect(); renderPool(); refresh();
});

// ---------- backup ----------
// Your keep/discard choices, tested flags, fixed landing spots and own nades live only in this browser. A backup file keeps them safe.
const DAY = 864e5, lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
function backupBanner() {
  const el = $("#backupBar"), dirty = +lsGet("dirty") || 0, last = +lsGet("lastBackup") || 0, snooze = +lsGet("backupSnooze") || 0;
  const age = last ? Math.floor((Date.now() - last) / DAY) : null;
  const due = dirty >= 25 || (dirty > 0 && (age === null || age >= 7));
  if (!due || Date.now() < snooze) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span>\u26a0 <b>${dirty} change${dirty === 1 ? "" : "s"}</b> of yours ${age === null ? "have never been backed up" : `since the last backup (${age} day${age === 1 ? "" : "s"} ago)`}. They live only in this browser.</span>
    <button id="bkNow" class="primary">Back up now</button><button id="bkLater">Later</button>`;
  $("#bkNow").onclick = doBackup;
  $("#bkLater").onclick = () => { try { localStorage.setItem("backupSnooze", String(Date.now() + DAY)); } catch {} backupBanner(); };
}
function doBackup() {
  const blob = new Blob([JSON.stringify({ version: 2, saved: new Date().toISOString(), nades: S.nades, setups: S.setups }, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `nadebook-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  try { localStorage.setItem("lastBackup", String(Date.now())); localStorage.setItem("dirty", "0"); } catch {}
  backupBanner(); renderBackupInfo();
}
function renderBackupInfo() {
  const last = +lsGet("lastBackup") || 0, dirty = +lsGet("dirty") || 0;
  $("#exportBtn").title = last ? `Last backup ${new Date(last).toLocaleDateString()} \u00b7 ${dirty} change${dirty === 1 ? "" : "s"} since` : "Save all your choices to a file (never backed up yet)";
  $("#exportBtn").textContent = dirty ? `Back up (${dirty})` : "Back up";
}
$("#exportBtn").onclick = doBackup;
$("#importBtn").onclick = () => $("#importFile").click();
$("#importFile").onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    // Merge: a choice you already made in this browser is kept; choices only the file has are added.
    const MINE = ["decision", "tested", "testedAt", "landingFixed", "log"];
    let added = 0, filled = 0, kept = 0;
    const putN = [], putS = [];
    for (const n of data.nades || []) {
      const cur = S.nades.find((x) => x.id === n.id);
      if (!cur) { S.nades.push(n); putN.push(n); added++; continue; }
      let changed = false;
      for (const k of MINE) {
        if (n[k] === undefined || n[k] === null) continue;
        if (cur[k] === undefined || cur[k] === null || (Array.isArray(cur[k]) && !cur[k].length)) {
          cur[k] = n[k]; changed = true;
          if (k === "landingFixed" && n.to) { cur.to = n.to; cur.tags = n.tags; }   // the fixed landing spot comes along
        } else if (JSON.stringify(cur[k]) !== JSON.stringify(n[k])) kept++;
      }
      if (n.images && cur.images && n.images.length > cur.images.length) { cur.images = n.images; changed = true; }   // pasted screenshots
      if (changed) { putN.push(cur); filled++; }
    }
    for (const s of data.setups || []) if (!S.setups.some((x) => x.id === s.id)) { S.setups.push(s); putS.push(s); added++; }
    if (putN.length) await bulk(STORE, putN);
    if (putS.length) await bulk(SSTORE, putS);
    alert(`Imported: ${added} new, ${filled} lineups updated with your choices from the file, ${kept} conflicts where your current choice was kept.`);
  } catch { alert("Not a valid CS2 Nade Book file."); }
  ev.target.value = ""; refresh();
};

(async () => {
  try {
    db = await openDB();
    S.nades = await dbAll();
    S.setups = await sAll();
    backupBanner(); renderBackupInfo();
    refresh();                       // show what is already saved right away
    await seedStarterData();         // then add / refresh the starter lineups in a single batch
    refresh();
  } catch (e) { showFatal(e); }
})();

async function seedStarterData() {
  const SEED_KEY = SEED_VERSION + "|" + SEED_MORE_VERSION, ALL_SEED = SEED_NADES.concat(SEED_MORE);
  const putN = [], delN = [], putS = [], delS = [];
  // drop the old blank placeholders
  for (const n of S.nades) if ((n.notes || "").startsWith("Template -")) delN.push(n.id);
  if (localStorage.getItem("seed") !== SEED_KEY) {
    // retire the earlier (2024-era) starter set - but keep any of them you already worked on
    const untouched = (n) => !(n.images || []).length && !n.setpos && !(n.log || []).length && !n.decision && !n.landingFixed && !n.tested;
    for (const n of S.nades) if (n.id.startsWith("cs-d2-") && untouched(n)) delN.push(n.id);
    for (const su of S.setups) if (su.id.startsWith("cs-d2-su-")) delS.push(su.id);
    const byId = new Map(S.nades.map((n) => [n.id, n]));
    for (const n of ALL_SEED) {
      const cur = byId.get(n.id);
      // add new starter nades; refresh an existing one only if you haven't touched it
      if (!cur || (cur.status === "unknown" && !cur.decision && !cur.landingFixed && !cur.tested && !(cur.log || []).length && (cur.images || []).length <= 1 && cur.setpos === n.setpos)) putN.push(n);
    }
    // starter nades that were dropped from the list (e.g. no screenshot): remove them unless you practiced them
    const seedIds = new Set(ALL_SEED.map((n) => n.id));
    for (const n of S.nades) if (/^c[un]-/.test(n.id) && !seedIds.has(n.id) && n.status === "unknown" && !n.decision && !n.landingFixed && !n.tested && !(n.log || []).length) delN.push(n.id);
    for (const su of SEED_SETUPS.concat(typeof SEED_MORE_SETUPS !== "undefined" ? SEED_MORE_SETUPS : [])) if (!S.setups.some((x) => x.id === su.id)) putS.push(su);
  }
  if (!putN.length && !delN.length && !putS.length && !delS.length) { localStorage.setItem("seed", SEED_KEY); return; }
  await bulk(STORE, putN, delN);
  await bulk(SSTORE, putS, delS);
  const gone = new Set(delN), goneS = new Set(delS), repl = new Map(putN.map((n) => [n.id, n]));
  S.nades = S.nades.filter((n) => !gone.has(n.id) || repl.has(n.id)).map((n) => repl.get(n.id) || n);
  const have = new Set(S.nades.map((n) => n.id));
  for (const n of putN) if (!have.has(n.id)) S.nades.push(n);
  S.setups = S.setups.filter((x) => !goneS.has(x.id)).concat(putS);
  localStorage.setItem("seed", SEED_KEY);
}
