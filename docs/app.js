// Burn Calendar front end. All analysis of the pre-aggregated cell x week data runs client-side.
const $ = s => document.querySelector(s);
const S = { data: null, aoiCells: [], series: null, rawSeries: null, mode: "value", aoiRect: null, corner: null, cellLayers: [] };
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const MONTH = w => new Date(Date.UTC(2001, 0, 1 + 7 * w)).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
let map;

async function init() {
  const regions = await (await fetch("data/regions.json")).json();
  $("#region").innerHTML = regions.map(r => `<option value="${r.file}">${r.name}</option>`).join("");
  $("#region").onchange = e => load(e.target.value);
  $("#reset").onclick = () => setAOI(null);
  $("#mode").onclick = e => { if (!e.target.dataset.m) return; S.mode = e.target.dataset.m;
    document.querySelectorAll("#mode button").forEach(b => b.classList.toggle("on", b === e.target)); drawCal(); };
  map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 12 }).addTo(map);
  map.on("click", e => {
    if (!S.corner) { S.corner = e.latlng; return; }
    const a = S.corner, b = e.latlng; S.corner = null;
    setAOI([Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)]);
  });
  addEventListener("resize", drawAll);
  // Re-fit when the map container (re)gains a real size, e.g. it was hidden at load time.
  new ResizeObserver(() => { map.invalidateSize(); if (S.fit && !S.aoiRect) map.fitBounds(S.fit, { animate: false }); drawAll(); }).observe($("#map"));
  load(regions[0].file);
}

async function load(file) {
  const d = await (await fetch(file)).json();
  S.data = d; d.nw = (d.end_year - d.start_year + 1) * d.weeks_per_year;
  const dense = tr => { const a = new Float32Array(d.cells.length * d.nw); for (const [c, w, v] of tr) a[c * d.nw + w] = v; return a; };
  S.harm = dense(d.harmonized); S.raw = dense(d.modis_raw);
  const tot = new Float32Array(d.cells.length);
  for (let c = 0; c < tot.length; c++) for (let w = 0; w < d.nw; w++) tot[c] += S.harm[c * d.nw + w];
  const max = Math.max(...tot);
  S.cellLayers.forEach(l => l.remove()); S.cellLayers = [];
  const h = d.cell / 2;
  d.cells.forEach(([lat, lon], i) => S.cellLayers.push(L.rectangle([[lat - h, lon - h], [lat + h, lon + h]],
    { weight: 0, fillColor: "#ea580c", fillOpacity: 0.08 + 0.75 * Math.sqrt(tot[i] / max), interactive: false }).addTo(map)));
  const [w, s, e, n] = d.bbox; S.fit = [[s, w], [n, e]]; map.invalidateSize(); map.fitBounds(S.fit, { animate: false });
  const v = d.validation, f = x => x.total_ratio.toFixed(2);
  $("#validation").innerHTML = `<h3>Harmonization check (held out ${v.test})</h3>
    <table><tr><th></th><th>Total vs VIIRS</th><th>Weekly error</th><th>Corr</th></tr>
    <tr><td>Raw MODIS</td><td>${f(v.raw_modis)}×</td><td>${v.raw_modis.weekly_mae}</td><td>${v.raw_modis.weekly_corr}</td></tr>
    <tr><td><b>Harmonized</b></td><td><b>${f(v.harmonized)}×</b></td><td><b>${v.harmonized.weekly_mae}</b></td><td><b>${v.harmonized.weekly_corr}</b></td></tr></table>
    <p class="hint">Mapping fit on ${v.train}, scored on ${v.test}. 1.00× = unbiased vs VIIRS.</p>`;
  const b = $("#banner"); b.style.display = d.synthetic ? "block" : "none";
  setAOI(null);
}

function setAOI(box) {
  const d = S.data; if (S.aoiRect) S.aoiRect.remove(); S.aoiRect = null; S.corner = null;
  const bb = box || d.bbox;
  if (box) S.aoiRect = L.rectangle([[bb[1], bb[0]], [bb[3], bb[2]]], { color: "#2563eb", weight: 2, dashArray: "5 4", fill: false, interactive: false }).addTo(map);
  S.aoiCells = d.cells.map((c, i) => i).filter(i => d.cells[i][1] >= bb[0] && d.cells[i][1] <= bb[2] && d.cells[i][0] >= bb[1] && d.cells[i][0] <= bb[3]);
  const sum = arr => { const o = new Float32Array(d.nw); for (const c of S.aoiCells) for (let w = 0; w < d.nw; w++) o[w] += arr[c * d.nw + w]; return o; };
  S.series = sum(S.harm); S.rawSeries = sum(S.raw);
  analyze(); drawAll();
}

function analyze() {
  const d = S.data, W = d.weeks_per_year, Y = d.end_year - d.start_year + 1, s = S.series;
  const clim = new Float32Array(W), sd = new Float32Array(W);
  for (let w = 0; w < W; w++) { let m = 0; for (let y = 0; y < Y; y++) m += s[y * W + w]; m /= Y;
    let v = 0; for (let y = 0; y < Y; y++) v += (s[y * W + w] - m) ** 2; clim[w] = m; sd[w] = Math.sqrt(v / Y); }
  S.clim = clim; S.sd = sd;
  S.z = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) { const w = i % W; S.z[i] = sd[w] > 0 ? (s[i] - clim[w]) / sd[w] : 0; }
  // critical period: contiguous weeks where climatology >= 50% of its peak
  const peak = Math.max(...clim), runs = []; let st = -1;
  for (let w = 0; w <= W; w++) { const on = w < W && clim[w] >= 0.5 * peak && peak > 0;
    if (on && st < 0) st = w; if (!on && st >= 0) { runs.push([st, w - 1]); st = -1; } }
  $("#crit").innerHTML = `<h3>Critical period(s)</h3>` + (runs.length ? `<ul>${runs.map(([a, b]) => `<li>${MONTH(a)} – ${MONTH(b + 1)} (weeks ${a + 1}–${b + 1})</li>`).join("")}</ul>
    <p class="hint">Weeks where typical activity ≥ 50% of the seasonal peak (${peak.toFixed(0)} hot spots/week).</p>` : "<p>No fire activity in this area.</p>");
  const top = [...s.keys()].filter(i => sd[i % W] > 0 && clim[i % W] >= 0.1 * peak).sort((a, b) => Math.abs(S.z[b]) - Math.abs(S.z[a])).slice(0, 5);
  $("#unusual").innerHTML = `<h3>Most unusual weeks</h3><ul>${top.map(i => `<li>${d.start_year + Math.floor(i / W)}, ${MONTH(i % W)}: ${s[i].toFixed(0)} hot spots (z = ${S.z[i].toFixed(1)})</li>`).join("")}</ul>`;
}

function setup(canvas, h) {
  const r = devicePixelRatio || 1, w = canvas.clientWidth; canvas.width = w * r; canvas.height = h * r; canvas.style.height = h + "px";
  const c = canvas.getContext("2d"); c.scale(r, r); c.clearRect(0, 0, w, h); c.font = "11px system-ui"; return [c, w, h];
}
function heat(t) { t = Math.max(0, Math.min(1, t)); const a = [255, 247, 236], b = [253, 187, 132], c = [179, 0, 0], k = t < .5 ? [a, b, t * 2] : [b, c, t * 2 - 1];
  return `rgb(${k[0].map((v, i) => Math.round(v + (k[1][i] - v) * k[2])).join(",")})`; }
function div(z) { const t = Math.max(-3, Math.min(3, z)) / 3, n = [37, 99, 235], p = [194, 65, 12], m = [240, 240, 240], e = t < 0 ? n : p, a = Math.abs(t);
  return `rgb(${m.map((v, i) => Math.round(v + (e[i] - v) * a)).join(",")})`; }

function drawCal() {
  const d = S.data, W = d.weeks_per_year, Y = d.end_year - d.start_year + 1, cv = $("#cal"), cell = 14;
  const [c, w] = setup(cv, Y * cell + 34), L0 = 40, cw = (w - L0 - 6) / W, txt = css("--mut");
  const vals = S.mode === "value" ? S.series : S.z; const mx = S.mode === "value" ? Math.max(...S.series.map(Math.sqrt)) : 3;
  c.fillStyle = txt;
  for (let y = 0; y < Y; y++) {
    if (y % 2 === 0) c.fillText(d.start_year + y, 4, 28 + y * cell + 10);
    for (let k = 0; k < W; k++) { const v = vals[y * W + k];
      c.fillStyle = S.mode === "value" ? heat(Math.sqrt(v) / (mx || 1)) : div(v); c.fillRect(L0 + k * cw, 24 + y * cell, cw + .6, cell + .5); }
  }
  c.fillStyle = txt; for (let m = 0; m < 12; m++) c.fillText(["J","F","M","A","M","J","J","A","S","O","N","D"][m], L0 + (m * 4.33) * cw, 14);
  c.fillStyle = css("--blue"); c.fillRect(L0, 24 + (d.viirs_start_week / W | 0) * cell - 1, w - L0 - 6, 1); // sensor transition marker
  cv.onmousemove = e => { const r = cv.getBoundingClientRect(), k = Math.floor((e.clientX - r.left - L0) / cw), y = Math.floor((e.clientY - r.top - 24) / cell);
    if (k < 0 || k >= W || y < 0 || y >= Y) return; const i = y * W + k;
    $("#tip").textContent = `${d.start_year + y}, ${MONTH(k)}: ${S.series[i].toFixed(1)} hot spots (VIIRS-equivalent), z = ${S.z[i].toFixed(2)}${i >= d.viirs_start_week ? "" : " · MODIS-harmonized"}`; };
}

function line(c, arr, x, y, color, dash) { c.beginPath(); c.setLineDash(dash || []); c.strokeStyle = color; c.lineWidth = 1.2;
  arr.forEach((v, i) => i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))); c.stroke(); c.setLineDash([]); }

function drawClim() {
  const W = S.data.weeks_per_year, [c, w, h] = setup($("#clim"), 170), L0 = 40, R = 8, T = 10, B = 20;
  const mx = Math.max(...S.clim.map((v, i) => v + S.sd[i]), 1), x = i => L0 + i * (w - L0 - R) / (W - 1), y = v => h - B - v / mx * (h - B - T);
  const peak = Math.max(...S.clim);
  c.fillStyle = "rgba(234,88,12,.12)"; S.clim.forEach((v, i) => { if (peak > 0 && v >= .5 * peak) c.fillRect(x(i) - 2, T, 5, h - B - T); });
  c.beginPath(); S.clim.forEach((v, i) => { const u = y(v + S.sd[i]); i ? c.lineTo(x(i), u) : c.moveTo(x(i), u); });
  for (let i = W - 1; i >= 0; i--) c.lineTo(x(i), y(Math.max(0, S.clim[i] - S.sd[i]))); c.fillStyle = "rgba(100,116,139,.2)"; c.fill();
  line(c, S.clim, x, y, css("--acc")); c.fillStyle = css("--mut");
  for (let m = 0; m < 12; m += 1) c.fillText(MONTH(m * 4.33 | 0).split(" ")[0], x(m * 4.33), h - 5);
  c.fillText("mean ± 1 sd; shaded band = critical period", L0 + 4, T + 8);
}

function drawTS() {
  const d = S.data, [c, w, h] = setup($("#ts"), 190), L0 = 40, R = 8, T = 14, B = 22, N = d.nw;
  const mx = Math.max(...S.series, 1), x = i => L0 + i * (w - L0 - R) / (N - 1), y = v => h - B - v / mx * (h - B - T);
  c.fillStyle = "rgba(37,99,235,.06)"; c.fillRect(x(d.viirs_start_week), T, w - R - x(d.viirs_start_week), h - B - T);
  line(c, S.rawSeries, x, y, css("--mut"), [4, 3]); line(c, S.series, x, y, css("--acc"));
  c.fillStyle = css("--mut");
  for (let yr = d.start_year; yr <= d.end_year; yr += 4) c.fillText(yr, x((yr - d.start_year) * d.weeks_per_year) - 10, h - 6);
  c.fillText("grey dashed = raw MODIS · orange = harmonized (VIIRS-equivalent) · blue band = VIIRS native", L0 + 4, 11);
}
const drawAll = () => { if (S.data) { drawCal(); drawClim(); drawTS(); } };
init();
