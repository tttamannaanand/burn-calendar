"use strict";
// Burn Calendar front end. Pre-aggregated cell x week data is analysed in the browser.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const root = document.documentElement;
  const W = 52;                                   // weeks per year in the data
  const FONT = "Inter, system-ui, sans-serif";
  const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MSTART = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

  const META = {
    california: {
      short: "California", blurb: "Western US, late-summer season",
      presets: [["North Coast and Klamath", [-124.0, 40.0, -121.5, 42.0]], ["Sierra Nevada", [-121.5, 35.5, -118.0, 40.0]], ["Los Angeles basin", [-119.5, 33.5, -117.0, 34.8]]],
      note: "California reads low mainly in the extreme 2020 and 2021 seasons, when the link between the two instruments shifted."
    },
    amazon_arc: {
      short: "Amazon arc", blurb: "Brazil, deforestation fires",
      presets: [["Northern half", [-62.0, -10.0, -50.0, -6.0]], ["Southern half", [-62.0, -14.0, -50.0, -10.0]]]
    },
    arnhem_land: {
      short: "Northern Australia", blurb: "Arnhem Land, long dry season",
      presets: [["North-west coast", [130.0, -13.5, 133.0, -11.0]], ["Southern inland", [130.0, -17.0, 138.0, -14.5]]]
    }
  };

  // Colour system shared by the map, calendar and charts.
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const SC = {
    light: { heat: ["#fff4e4", "#fcd6a2", "#f6a05a", "#e2572b", "#a11f10", "#470e08"].map(hex), neg: hex("#2563eb"), mid: hex("#f1f3f6"), pos: hex("#d9480f") },
    dark: { heat: ["#1a2029", "#46201e", "#962c14", "#e2581f", "#fbab4e", "#fff1c6"].map(hex), neg: hex("#4f8df7"), mid: hex("#1a2029"), pos: hex("#ff7a3d") }
  };
  const isDark = () => { const t = root.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
  const TH = () => (isDark() ? SC.dark : SC.light);
  const rgb = a => `rgb(${a.map(Math.round).join(",")})`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ramp = (stops, t) => { t = clamp(t, 0, 1); const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i; return rgb(stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f)); };
  const heatT = (v, max) => (max > 0 ? Math.pow(clamp(v / max, 0, 1), 0.45) : 0);
  const heat = (v, max) => ramp(TH().heat, heatT(v, max));
  const diverge = z => { const t = clamp(z / 3, -1, 1), th = TH(), e = t < 0 ? th.neg : th.pos, a = Math.abs(t); return rgb(th.mid.map((v, k) => v + (e[k] - v) * a)); };
  const cssv = n => getComputedStyle(root).getPropertyValue(n).trim();

  // Formatting
  const fmtI = n => Math.round(n).toLocaleString("en-US");
  const fmtN = n => { if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"; if (n >= 1e3) return (n / 1e3).toFixed(2).replace(/\.?0+$/, "") + "k"; return String(Math.round(n * 10) / 10).replace(/\.0$/, ""); };
  const dayDate = d => new Date(Date.UTC(2001, 0, d));
  const fmtMD = d => `${MN[d.getUTCMonth()]}\u00a0${d.getUTCDate()}`;   // non-breaking so a date never splits across lines
  const wStart = w => 7 * w + 1, wEnd = w => (w === W - 1 ? 365 : 7 * w + 7);
  const weekRange = w => { const a = dayDate(wStart(w)), b = dayDate(wEnd(w)); return a.getUTCMonth() === b.getUTCMonth() ? `${MN[a.getUTCMonth()]}\u00a0${a.getUTCDate()}–${b.getUTCDate()}` : `${fmtMD(a)} – ${fmtMD(b)}`; };
  const seasonLabel = (a, b) => `${fmtMD(dayDate(wStart(a)))} – ${fmtMD(dayDate(wEnd(b)))}`;
  const niceMax = m => { if (m <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))); for (const f of [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 4.8, 6, 8, 10]) if (f * p >= m) return f * p; return 10 * p; };
  const zWord = (z, ok) => (!ok ? "No variation across years" : z >= 2 ? "Unusually high" : z >= 1 ? "Above normal" : z <= -2 ? "Unusually low" : z <= -1 ? "Below normal" : "About normal");

  const S = { regions: [], cache: {}, id: null, d: null, aoi: null, cells: [], inAOI: null, series: null, rawSeries: null, z: null, clim: null, sd: null,
    mode: "value", sel: null, drawing: false, corner: null, preview: null, aoiRect: null, layers: [], tileLayer: null, geo: {} };
  let map;

  // ---------- small UI helpers ----------
  const status = (msg, kind) => { const el = $("#status"); el.textContent = msg; el.classList.toggle("warn", kind === "warn"); };
  const busy = on => { $("#progress").hidden = !on; $("#layout").setAttribute("aria-busy", on ? "true" : "false"); };
  const tip = $("#tip");
  const showTip = (html, x, y) => {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect(); let L = x + 14, T = y + 16;
    if (L + r.width > innerWidth - 8) L = x - r.width - 14;
    if (T + r.height > innerHeight - 8) T = y - r.height - 14;
    tip.style.left = Math.max(8, L) + "px"; tip.style.top = Math.max(8, T) + "px";
  };
  const hideTip = () => { tip.hidden = true; };

  // Canvas helpers: each chart is a base canvas plus an overlay canvas for hover marks.
  function prep(cv, h) {
    const wrap = cv.parentElement, w = Math.max(240, wrap.clientWidth), dpr = devicePixelRatio || 1;
    wrap.querySelectorAll("canvas").forEach(c => { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + "px"; c.style.height = h + "px"; });
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); return [c, w, h];
  }
  function overlay(cv) {
    const o = cv.parentElement.querySelector(".ov"), dpr = devicePixelRatio || 1, c = o.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, o.width / dpr, o.height / dpr); return c;
  }
  function pill(c, text, x, y, fill, ink) {
    c.font = `600 11px ${FONT}`; const w = c.measureText(text).width + 12;
    c.fillStyle = fill; c.beginPath(); c.roundRect(x, y - 11, w, 16, 8); c.fill(); c.fillStyle = ink; c.fillText(text, x + 6, y + 1);
  }

  // ---------- data ----------
  async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
  function prepare(d) {
    d.nw = (d.end_year - d.start_year + 1) * W;
    const dense = tr => { const a = new Float32Array(d.cells.length * d.nw); for (const [c, w, v] of tr) a[c * d.nw + w] = v; return a; };
    d.harm = dense(d.harmonized); d.raw = dense(d.modis_raw);
    d.tot = new Float32Array(d.cells.length); d.totMax = 0;
    for (let c = 0; c < d.tot.length; c++) { let s = 0; for (let w = 0; w < d.nw; w++) s += d.harm[c * d.nw + w]; d.tot[c] = s; if (s > d.totMax) d.totMax = s; }
    const km = 0.5 * 111.32;
    d.km2 = d.cells.map(([lat]) => km * km * Math.cos(lat * Math.PI / 180));
    delete d.harmonized; delete d.modis_raw;
  }

  // ---------- map ----------
  function initMap() {
    map = L.map("map", { scrollWheelZoom: false, dragging: !L.Browser.mobile, zoomSnap: 0.25, attributionControl: true });
    S.tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 12 }).addTo(map);
    map.on("click", e => {
      if (!S.drawing) return;
      if (!S.corner) { S.corner = e.latlng; S.preview = L.rectangle([e.latlng, e.latlng], { color: cssv("--ember"), weight: 2, dashArray: "5 4", fillOpacity: 0.08, interactive: false }).addTo(map); status("Now click the opposite corner."); return; }
      const a = S.corner, b = e.latlng, box = [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
      setDrawing(false); setAOI(box);
    });
    map.on("mousemove", e => { if (S.drawing && S.corner && S.preview) S.preview.setBounds([S.corner, e.latlng]); });
  }
  function buildCells() {
    S.layers.forEach(l => l.remove()); S.layers = [];
    const d = S.d, h = d.cell / 2;
    d.cells.forEach(([lat, lon]) => S.layers.push(L.rectangle([[lat - h, lon - h], [lat + h, lon + h]], { weight: 0, fillOpacity: 0.8, interactive: false }).addTo(map)));
    const [w, s, e, n] = d.bbox; S.fit = [[s, w], [n, e]];
    S.layers.push(L.rectangle(S.fit, { color: cssv("--mut"), weight: 1.5, dashArray: "2 4", fill: false, interactive: false }).addTo(map));   // region outline
    map.invalidateSize(); map.fitBounds(S.fit, { animate: false });
  }
  function styleCells() {
    const d = S.d; if (!d) return;
    // Cells are the first d.cells.length layers; the last layer is the region outline.
    d.cells.forEach((_, i) => S.layers[i].setStyle({ fillColor: ramp(TH().heat, 0.16 + 0.84 * Math.pow(d.tot[i] / d.totMax, 0.5)), fillOpacity: S.inAOI[i] ? 0.85 : 0.2 }));
    S.layers[d.cells.length].setStyle({ color: cssv("--mut") });
    if (S.aoiRect) S.aoiRect.setStyle({ color: cssv("--ember") });
  }
  function setDrawing(on) {
    S.drawing = on; S.corner = null; if (S.preview) { S.preview.remove(); S.preview = null; }
    $("#draw").textContent = on ? "Cancel drawing" : "Draw an area"; $("#map").classList.toggle("drawing", on);
    status(on ? "Click one corner on the map, then the opposite corner. Press Esc to cancel." : defaultStatus());
  }
  const defaultStatus = () => (S.aoi ? `Showing ${S.cells.length} cells, about ${fmtI(roundSig(S.km2, 2))} km².` : "Pick a preset or draw a box to look at one place.");
  const roundSig = (n, s) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(n, 1))) - s + 1); return Math.round(n / p) * p; };

  // ---------- AOI + analysis ----------
  function setAOI(box) {
    const d = S.d;
    const idx = d.cells.map((_, i) => i).filter(i => !box || (d.cells[i][1] >= box[0] && d.cells[i][1] <= box[2] && d.cells[i][0] >= box[1] && d.cells[i][0] <= box[3]));
    if (!idx.length) { status("No data cells inside that area. Try a larger box.", "warn"); return false; }
    S.aoi = box; S.cells = idx; S.inAOI = new Uint8Array(d.cells.length); idx.forEach(i => (S.inAOI[i] = 1));
    S.km2 = idx.reduce((a, i) => a + d.km2[i], 0);
    const sum = arr => { const o = new Float32Array(d.nw); for (const c of idx) { const off = c * d.nw; for (let w = 0; w < d.nw; w++) o[w] += arr[off + w]; } return o; };
    S.series = sum(d.harm); S.rawSeries = sum(d.raw); S.sel = null; hideTip();
    if (S.aoiRect) { S.aoiRect.remove(); S.aoiRect = null; }
    if (box) S.aoiRect = L.rectangle([[box[1], box[0]], [box[3], box[2]]], { color: cssv("--ember"), weight: 2, dashArray: "5 4", fill: false, interactive: false }).addTo(map);
    analyze(); renderAll(); status(defaultStatus()); updateHash(); return true;
  }
  function analyze() {
    const d = S.d, Y = d.end_year - d.start_year + 1, s = S.series;
    const clim = new Float32Array(W), sd = new Float32Array(W);
    for (let w = 0; w < W; w++) { let m = 0; for (let y = 0; y < Y; y++) m += s[y * W + w]; m /= Y; let v = 0; for (let y = 0; y < Y; y++) v += (s[y * W + w] - m) ** 2; clim[w] = m; sd[w] = Math.sqrt(v / Y); }
    const z = new Float32Array(s.length); for (let i = 0; i < s.length; i++) { const w = i % W; z[i] = sd[w] > 0 ? (s[i] - clim[w]) / sd[w] : 0; }
    S.clim = clim; S.sd = sd; S.z = z; S.Y = Y;
    S.peak = Math.max(...clim); S.peakWeek = clim.indexOf(S.peak);
    S.runs = []; let st = -1;
    for (let w = 0; w <= W; w++) { const on = w < W && S.peak > 0 && clim[w] >= 0.5 * S.peak; if (on && st < 0) st = w; if (!on && st >= 0) { S.runs.push([st, w - 1]); st = -1; } }
    S.yearTot = Array.from({ length: Y }, (_, y) => { let t = 0; for (let w = 0; w < W; w++) t += s[y * W + w]; return t; });
    S.busiest = S.yearTot.indexOf(Math.max(...S.yearTot));
    const per = {}; S.extreme = [...s.keys()].filter(i => S.sd[i % W] > 0 && S.clim[i % W] >= 0.1 * S.peak && z[i] > 0).sort((a, b) => z[b] - z[a])
      .filter(i => { const y = Math.floor(i / W); per[y] = (per[y] || 0) + 1; return per[y] <= 2; }).slice(0, 5);
  }

  // ---------- rendering ----------
  function renderRegions() {
    const box = $("#regions"); box.innerHTML = "";
    S.regions.forEach(r => {
      const m = META[r.id] || { short: r.name, blurb: "" }, b = document.createElement("button");
      b.type = "button"; b.className = "region"; b.setAttribute("aria-pressed", String(r.id === S.id));
      b.innerHTML = `<b>${m.short}</b><span>${m.blurb}</span>`; b.onclick = () => { if (r.id !== S.id) load(r.id); }; box.appendChild(b);
    });
  }
  function renderPresets() {
    const box = $("#presets"); box.innerHTML = "";
    const m = META[S.id] || { presets: [] };
    const mk = (label, box_) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = label;
      b.setAttribute("aria-pressed", String(JSON.stringify(S.aoi) === JSON.stringify(box_))); b.onclick = () => { setDrawing(false); setAOI(box_); }; box.appendChild(b); };
    m.presets.forEach(([label, b]) => mk(label, b));
  }
  function renderLabel() { const p = $("#aoiLabel"); p.textContent = S.aoi ? `${S.cells.length} cells · ~${fmtI(roundSig(S.km2, 2))} km²` : "Whole region"; p.classList.toggle("on", !!S.aoi); }

  function renderInsights() {
    const card = $("#insights"), d = S.d;
    if (S.peak <= 0) { card.innerHTML = `<div class="card-h"><h2 id="h-ins">This area</h2></div><div class="empty">No fire hot spots were detected in this area. Try a different box.</div>`; return; }
    const season = S.runs.slice(0, 2).map(([a, b]) => seasonLabel(a, b)).join(" and ");
    const chips = S.extreme.map(i => { const y = Math.floor(i / W), k = i % W; return `<button class="chip" type="button" data-y="${y}" data-k="${k}">${d.start_year + y} · ${weekRange(k)}</button>`; }).join("");
    card.innerHTML = `<div class="card-h"><h2 id="h-ins">What this area looks like</h2></div>
      <div class="tiles">
        <div class="tile"><small>Fire season</small><b>${season}</b><span>Weeks at or above half the peak</span></div>
        <div class="tile"><small>Typical peak week</small><b>${weekRange(S.peakWeek)}</b><span>About ${fmtI(S.peak)} hot spots</span></div>
        <div class="tile"><small>Busiest year</small><b>${d.start_year + S.busiest}</b><span>${fmtI(S.yearTot[S.busiest])} hot spots</span></div>
        <div class="tile"><small>${S.aoi ? "Area" : "Area covered"}</small><b>~${fmtI(roundSig(S.km2, 2))} km²</b><span>${S.aoi ? `${S.cells.length} half-degree cells` : `A box around the region, ${S.cells.length} cells`}</span></div>
      </div>
      <div class="unusual"><h3>Most extreme weeks (select one to find it on the calendar)</h3><div class="chips">${chips}</div></div>`;
    card.querySelectorAll(".chip").forEach(b => b.onclick = () => jumpTo(+b.dataset.y, +b.dataset.k));
  }
  function renderTrust() {
    const v = S.d.validation, m = META[S.id] || {}, r = v.raw_modis, h = v.harmonized;
    const pct = x => Math.round(x * 100), w = x => Math.min(100, (x / 1.25) * 100);
    const off = Math.abs(h.total_ratio - 1), dir = h.total_ratio < 1 ? "low" : "high";
    const verdict = off <= 0.05 ? `Within ${Math.max(1, pct(off))}% of VIIRS over the held-out years.` : `Reads about ${pct(off)}% ${dir} over the held-out years. ${m.note || ""}`;
    $("#trust").innerHTML = `<div class="card-h"><h2 id="h-trust">How far can you trust this?</h2></div>
      <p class="lead">We scored the method on ${v.test}, years it was not fitted on, against real VIIRS counts for the whole region.</p>
      <div class="bars">
        <div class="bar"><span>Raw MODIS</span><div class="track"><i style="width:${w(r.total_ratio)}%"></i><b class="mark" style="left:80%"></b></div><em>${pct(r.total_ratio)}%</em></div>
        <div class="bar good"><span>Harmonized</span><div class="track"><i style="width:${w(h.total_ratio)}%"></i><b class="mark" style="left:80%"></b></div><em>${pct(h.total_ratio)}%</em></div>
      </div>
      <p class="cap">Share of the VIIRS hot-spot total each version recovers. The line marks a perfect 100%.</p>
      <dl class="kv"><dt>Typical weekly error</dt><dd>${fmtI(r.weekly_mae)} → ${fmtI(h.weekly_mae)} (${(r.weekly_mae / h.weekly_mae).toFixed(1)}× lower)</dd>
      <dt>Week-to-week match</dt><dd>${r.weekly_corr.toFixed(3)} → ${h.weekly_corr.toFixed(3)}</dd></dl>
      <p class="note ${off > 0.05 ? "warn" : ""}">${verdict}</p>
      <details><summary>How was this checked?</summary><p>The mapping was fitted on ${v.train}, when both instruments were flying, then applied to ${v.test} and compared with what VIIRS actually counted. The numbers describe the whole region, not the area you have selected. The published record fits on every overlap year.</p></details>`;
  }
  function renderScale() {
    const el = $("#scale"), th = TH(); let grad, l, r;
    if (S.mode === "value") { grad = Array.from({ length: 12 }, (_, i) => ramp(th.heat, i / 11)).join(","); l = "No fire"; r = `${fmtI(Math.max(...S.series))} hot spots in the busiest week`; }
    else { grad = Array.from({ length: 13 }, (_, i) => diverge((i - 6) / 2)).join(","); l = "Below normal"; r = "Above normal"; }
    el.innerHTML = `<span>${l}</span><div class="ramp" style="background:linear-gradient(90deg,${grad})"></div><span>${r}</span>`;
    $("#modeHelp").textContent = S.mode === "value" ? "Hot spots detected each week, on the VIIRS scale. Brighter means more fire." : "How each week compares with the same week in other years. Orange is more fire than usual, blue is less.";
  }

  function drawCal() {
    const d = S.d, cv = $("#cal"), wrapW = cv.parentElement.clientWidth, small = wrapW < 520, rh = small ? 12 : 15, L0 = small ? 30 : 42, T0 = small ? 18 : 22;
    const Y = S.Y, [c, w] = prep(cv, T0 + Y * rh + 4), cw = (w - L0 - 4) / W, mut = cssv("--mut"), max = Math.max(...S.series, 1);
    c.font = `500 ${small ? 10 : 11}px ${FONT}`; c.fillStyle = mut;
    MN.forEach((m, i) => { const x = L0 + Math.floor(MSTART[i] / 7) * cw; if (small && i % 2) return; c.fillText(small ? m[0] + "" : m, x, T0 - 7); });
    for (let y = 0; y < Y; y++) {
      if (rh >= 15 || y % 2 === 0) { c.fillStyle = mut; c.textAlign = "right"; c.fillText(d.start_year + y, L0 - 6, T0 + y * rh + rh - 3); c.textAlign = "left"; }
      for (let k = 0; k < W; k++) { const i = y * W + k; c.fillStyle = S.mode === "value" ? heat(S.series[i], max) : diverge(S.z[i]); c.fillRect(L0 + k * cw, T0 + y * rh, cw + 0.4, rh - 1); }
    }
    const yv = Math.floor(d.viirs_start_week / W), ly = T0 + yv * rh - 0.5, ink = cssv("--ink"), surf = cssv("--surface");
    c.fillStyle = ink; c.globalAlpha = 0.55; c.fillRect(L0, ly, w - L0 - 4, 1.5); c.globalAlpha = 1;
    const bg = isDark() ? "rgba(22,27,34,.88)" : "rgba(255,255,255,.9)";
    pill(c, "MODIS, harmonized", L0 + 6, ly - 4, bg, ink); pill(c, "VIIRS, measured", L0 + 6, ly + 17, bg, ink);
    S.geo.cal = { L0, T0, cw, rh, Y }; drawCalSel();
  }
  function drawCalSel() {
    const c = overlay($("#cal")), g = S.geo.cal; if (!g || !S.sel) return;
    const { y, k } = S.sel; c.strokeStyle = cssv("--ink"); c.lineWidth = 2; c.strokeRect(g.L0 + k * g.cw - 1, g.T0 + y * g.rh - 1, g.cw + 2, g.rh + 1);
  }
  function calTip(y, k) {
    const d = S.d, i = y * W + k, v = S.series[i], z = S.z[i], cl = S.clim[k], ok = S.sd[k] > 0;
    const rel = cl > 0 ? ` (${(v / cl).toFixed(1)}× a typical week)` : "";
    return `<b>${weekRange(k)}, ${d.start_year + y}</b>${fmtI(v)} hot spots${rel}<br>${zWord(z, ok)}${ok ? ` (z = ${z > 0 ? "+" : ""}${z.toFixed(1)})` : ""}<br><span style="opacity:.75">${i < d.viirs_start_week ? "MODIS, harmonized to VIIRS" : "VIIRS, measured"}</span>`;
  }
  function selectCell(y, k, anchor) {
    S.sel = { y, k }; drawCalSel();
    const g = S.geo.cal, r = $("#cal").getBoundingClientRect(), x = anchor ? anchor[0] : r.left + g.L0 + (k + 0.5) * g.cw, yy = anchor ? anchor[1] : r.top + g.T0 + (y + 0.5) * g.rh;
    showTip(calTip(y, k), x, yy); $("#calLive").textContent = `${weekRange(k)}, ${S.d.start_year + y}: ${fmtI(S.series[y * W + k])} hot spots. ${zWord(S.z[y * W + k], S.sd[k] > 0)}.`;
  }
  // Scroll the calendar into view, wait until the page stops moving, then mark the cell.
  function jumpTo(y, k) {
    S.jumping = true; hideTip(); $("#calWrap").scrollIntoView({ block: "center", behavior: "smooth" });
    let last = -1, still = 0;
    const tick = () => { if (scrollY === last) still++; else { still = 0; last = scrollY; } if (still >= 6) { selectCell(y, k); setTimeout(() => { S.jumping = false; }, 500); /* ignore trailing scroll events */ } else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  function axes(c, w, h, L, R, T, B, ymax, xLabels) {
    c.font = `500 11px ${FONT}`; c.textAlign = "right"; c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const v = (ymax * i) / 4, y = h - B - (v / ymax) * (h - B - T); c.strokeStyle = cssv("--line"); c.beginPath(); c.moveTo(L, y + 0.5); c.lineTo(w - R, y + 0.5); c.stroke(); c.fillStyle = cssv("--mut"); c.fillText(fmtN(v), L - 6, y + 4); }
    c.textAlign = "left"; c.fillStyle = cssv("--mut"); xLabels.forEach(([x, t]) => c.fillText(t, x, h - 6));
  }
  function drawClim() {
    const cv = $("#clim"), [c, w, h] = prep(cv, 200), L = 46, R = 12, T = 12, B = 26, plotW = w - L - R;
    const ymax = niceMax(Math.max(...S.clim.map((v, i) => v + S.sd[i]), 1)), x = k => L + (k / (W - 1)) * plotW, y = v => h - B - (v / ymax) * (h - B - T);
    const small = w < 480, labs = MN.map((m, i) => [x(Math.floor(MSTART[i] / 7)), small ? (i % 2 ? "" : m) : m]);
    axes(c, w, h, L, R, T, B, ymax, labs);
    c.fillStyle = cssv("--ember"); c.globalAlpha = 0.13; S.runs.forEach(([a, b]) => c.fillRect(x(a) - plotW / (W - 1) / 2, T, (b - a + 1) * (plotW / (W - 1)), h - B - T)); c.globalAlpha = 1;
    c.beginPath(); S.clim.forEach((v, k) => { const u = y(v + S.sd[k]); k ? c.lineTo(x(k), u) : c.moveTo(x(k), u); });
    for (let k = W - 1; k >= 0; k--) c.lineTo(x(k), y(Math.max(0, S.clim[k] - S.sd[k]))); c.closePath(); c.fillStyle = cssv("--mut"); c.globalAlpha = 0.2; c.fill(); c.globalAlpha = 1;
    c.beginPath(); S.clim.forEach((v, k) => (k ? c.lineTo(x(k), y(v)) : c.moveTo(x(k), y(v)))); c.strokeStyle = cssv("--ember"); c.lineWidth = 2.2; c.lineJoin = "round"; c.stroke();
    if (S.runs.length) pill(c, "Fire season", clamp(x(S.runs[0][0]), L + 2, w - R - 90), T + 12, cssv("--ember-soft"), cssv("--ember"));
    S.geo.clim = { L, R, T, B, plotW, w, h, ymax, x, y };
  }
  function drawTS() {
    const d = S.d, cv = $("#ts"), [c, w, h] = prep(cv, 210), L = 46, R = 12, T = 12, B = 26, plotW = w - L - R, N = d.nw;
    const ymax = niceMax(Math.max(...S.series, ...S.rawSeries, 1)), x = i => L + (i / (N - 1)) * plotW, y = v => h - B - (v / ymax) * (h - B - T);
    const step = Math.max(1, Math.ceil(S.Y / Math.floor(plotW / 62))), labs = []; for (let yr = 0; yr < S.Y; yr += step) labs.push([x(yr * W) - 12, String(d.start_year + yr)]);
    axes(c, w, h, L, R, T, B, ymax, labs);
    c.fillStyle = cssv("--blue"); c.globalAlpha = 0.09; c.fillRect(x(d.viirs_start_week), T, w - R - x(d.viirs_start_week), h - B - T); c.globalAlpha = 1;
    const line = (arr, col, wd, dash) => { c.beginPath(); c.setLineDash(dash || []); arr.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v)))); c.strokeStyle = col; c.lineWidth = wd; c.lineJoin = "round"; c.stroke(); c.setLineDash([]); };
    line(S.rawSeries, cssv("--mut"), 1.2, [4, 3]); line(S.series, cssv("--ember"), 1.4);
    S.geo.ts = { L, R, T, B, plotW, w, h, ymax, x, y, N };
  }
  function drawAll() { if (!S.d || !S.series) return; renderScale(); drawCal(); drawClim(); drawTS(); }
  function renderAll() { renderLabel(); renderPresets(); renderInsights(); renderTrust(); styleCells(); drawAll(); }

  // ---------- hover + keyboard ----------
  function bind(wrap, move, leave) {
    wrap.addEventListener("pointermove", e => { const r = wrap.getBoundingClientRect(); move(e.clientX - r.left, e.clientY - r.top, e); });
    wrap.addEventListener("pointerdown", e => { const r = wrap.getBoundingClientRect(); move(e.clientX - r.left, e.clientY - r.top, e); });
    wrap.addEventListener("pointerleave", e => { if (e.pointerType && e.pointerType !== "mouse") return; leave(); hideTip(); });   // touch fires leave right after lift
  }
  function clearMarks() { hideTip(); if (S.sel) { S.sel = null; drawCalSel(); } ["#clim", "#ts"].forEach(id => overlay($(id))); }
  function bindCharts() {
    document.addEventListener("pointerdown", e => { if (e.target.closest && e.target.closest(".cv, .chip")) return; clearMarks(); }, { passive: true });
    bind($("#calWrap"), (x, y, e) => { const g = S.geo.cal; if (!g || !S.series) return; const k = Math.floor((x - g.L0) / g.cw), yr = Math.floor((y - g.T0) / g.rh);
      if (k < 0 || k >= W || yr < 0 || yr >= g.Y) { S.sel = null; drawCalSel(); hideTip(); return; } selectCell(yr, k, [e.clientX, e.clientY]); }, () => { S.sel = null; drawCalSel(); });
    $("#calWrap").addEventListener("keydown", e => {
      const k = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (e.key === "Escape") { S.sel = null; drawCalSel(); hideTip(); return; }
      if (!k) return; e.preventDefault();
      const cur = S.sel || { y: S.busiest, k: S.peakWeek }; selectCell(clamp(cur.y + k[0], 0, S.Y - 1), clamp(cur.k + k[1], 0, W - 1));
    });
    $("#calWrap").addEventListener("blur", () => { S.sel = null; drawCalSel(); hideTip(); });
    bind($("#climWrap"), (x, y, e) => { const g = S.geo.clim; if (!g) return; const k = clamp(Math.round(((x - g.L) / g.plotW) * (W - 1)), 0, W - 1), c = overlay($("#clim"));
      c.strokeStyle = cssv("--ink"); c.globalAlpha = 0.5; c.beginPath(); c.moveTo(g.x(k), g.T); c.lineTo(g.x(k), g.h - g.B); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = cssv("--ember"); c.beginPath(); c.arc(g.x(k), g.y(S.clim[k]), 4, 0, 7); c.fill();
      const inSeason = S.runs.some(([a, b]) => k >= a && k <= b), lo = Math.max(0, S.clim[k] - S.sd[k]), hi = S.clim[k] + S.sd[k];
      showTip(`<b>Weeks of ${weekRange(k)}</b>Typical: ${fmtI(S.clim[k])} hot spots<br>Normal range: ${fmtI(lo)} to ${fmtI(hi)}${inSeason ? "<br>In the fire season" : ""}`, e.clientX, e.clientY); }, () => overlay($("#clim")));
    bind($("#tsWrap"), (x, y, e) => { const g = S.geo.ts; if (!g) return; const i = clamp(Math.round(((x - g.L) / g.plotW) * (g.N - 1)), 0, g.N - 1), c = overlay($("#ts")), d = S.d;
      c.strokeStyle = cssv("--ink"); c.globalAlpha = 0.5; c.beginPath(); c.moveTo(g.x(i), g.T); c.lineTo(g.x(i), g.h - g.B); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = cssv("--ember"); c.beginPath(); c.arc(g.x(i), g.y(S.series[i]), 4, 0, 7); c.fill(); c.fillStyle = cssv("--mut"); c.beginPath(); c.arc(g.x(i), g.y(S.rawSeries[i]), 3, 0, 7); c.fill();
      showTip(`<b>${weekRange(i % W)}, ${d.start_year + Math.floor(i / W)}</b>Harmonized: ${fmtI(S.series[i])}<br>Raw MODIS: ${fmtI(S.rawSeries[i])}<br><span style="opacity:.75">${i < d.viirs_start_week ? "Before VIIRS" : "VIIRS era"}</span>`, e.clientX, e.clientY); }, () => overlay($("#ts")));
  }

  // ---------- state, loading ----------
  function readHash() {
    const p = location.hash.slice(1).split("&").filter(Boolean), id = p[0] && !p[0].includes("=") ? p[0] : null; let aoi = null;
    p.forEach(x => { if (x.startsWith("aoi=")) { const a = x.slice(4).split(",").map(Number); if (a.length === 4 && a.every(Number.isFinite)) aoi = a; } });
    return { id, aoi };
  }
  function updateHash() { try { history.replaceState(null, "", "#" + S.id + (S.aoi ? "&aoi=" + S.aoi.map(v => +v.toFixed(2)).join(",") : "")); } catch (e) { /* ignore */ } }
  async function load(id, aoi) {
    S.id = id; setDrawing(false); renderRegions(); busy(true);
    try {
      if (!S.cache[id]) { const r = S.regions.find(x => x.id === id); const d = await fetchJSON(r.file); prepare(d); S.cache[id] = d; }
      S.d = S.cache[id]; $("#banner").hidden = !S.d.synthetic; buildCells();
      const b = S.d.bbox, ok = aoi && aoi[0] >= b[0] - 0.01 && aoi[2] <= b[2] + 0.01 && aoi[1] >= b[1] - 0.01 && aoi[3] <= b[3] + 0.01;
      if (!(ok && setAOI(aoi))) setAOI(null);
    } catch (err) {
      $("#insights").innerHTML = `<div class="card-h"><h2 id="h-ins">Could not load the data</h2></div><div class="empty">Something went wrong while loading this region. Check your connection and try again.<br><br><button class="btn primary" id="retry" type="button">Try again</button></div>`;
      $("#retry").onclick = () => load(id, aoi); console.error(err);
    } finally { busy(false); }
  }

  function setTheme(t) { root.dataset.theme = t; try { localStorage.setItem("theme", t); } catch (e) { /* ignore */ } redrawAll(); }
  function redrawAll() { styleCells(); drawAll(); }
  const debounce = (f, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(f, ms); }; };

  async function init() {
    try { const t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch (e) { /* ignore */ }
    $("#theme").onclick = () => setTheme(isDark() ? "light" : "dark");
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!root.dataset.theme) redrawAll(); });
    document.querySelectorAll('a[href="#how"],a.brand').forEach(a => a.addEventListener("click", e => { e.preventDefault(); (a.hash === "#how" ? $("#how") : document.body).scrollIntoView({ behavior: "smooth", block: "start" }); }));
    $("#draw").onclick = () => setDrawing(!S.drawing);
    $("#reset").onclick = () => { setDrawing(false); setAOI(null); };
    document.addEventListener("keydown", e => { if (e.key === "Escape" && S.drawing) setDrawing(false); });
    $("#mode").onclick = e => { const m = e.target.dataset && e.target.dataset.m; if (!m || m === S.mode) return; S.mode = m; document.querySelectorAll("#mode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === m))); S.sel = null; hideTip(); drawAll(); };
    addEventListener("scroll", () => { if (!S.jumping) clearMarks(); }, { passive: true });
    if (matchMedia("(hover: none)").matches) $("#calHint").textContent = "Each row is a year, each column a week. Tap a week to read it.";
    initMap(); bindCharts();
    // Re-fit whenever the map box changes size (layout settling, rotation, hidden at load).
    new ResizeObserver(() => { map.invalidateSize(); if (S.fit && !S.aoi) map.fitBounds(S.fit, { animate: false }); }).observe($("#map"));
    addEventListener("resize", debounce(() => { map.invalidateSize(); if (S.fit && !S.aoi) map.fitBounds(S.fit, { animate: false }); drawAll(); }, 120));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawAll());
    try { S.regions = await fetchJSON("data/regions.json"); } catch (e) { $("#insights").innerHTML = `<div class="empty">Could not load the region list.</div>`; return; }
    const h = readHash(), id = S.regions.some(r => r.id === h.id) ? h.id : S.regions[0].id;
    await load(id, h.aoi);
  }
  init();
})();
