/* SuryaJal frontend — vanilla JS + Leaflet (no build step). */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Demo roof: a real house in Ward 27, Bhubaneswar (TPCODL zone), ~177 m².
  const DEMO = {
    name: 'Demo roof · Ward 27, Bhubaneswar',
    poly: [[20.2954465, 85.8139218], [20.2953165, 85.8139877], [20.2953639, 85.8140812], [20.2954939, 85.8140152]],
  };
  const ODISHA_CENTER = [20.2961, 85.8245];   // Bhubaneswar

  // ------------------------------------------------------------------ helpers
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtIN = (n, d = 0) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
  const rupees = n => Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} crore`
    : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(2)} lakh` : `₹${fmtIN(n)}`;
  const litres = n => n >= 1e5 ? `${(n / 1e5).toFixed(2)} lakh L` : `${fmtIN(n)} L`;
  const compact = v => v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${Math.round(v)}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let toastTimer;
  function toast(msg, kind = '', ms = 4000) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast ${kind}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  async function api(url, body) {
    const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    let res;
    try { res = await fetch(url, opt); } catch (e) { throw new Error('Cannot reach the SuryaJal server — is it running?'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok) {
      const d = data && data.detail;
      const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map(x => x.msg).join('; ') : `Server error ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  // encoded polyline, precision 6 (same as app/geo.py)
  function encodePolyline(pts, precision = 6) {
    const f = 10 ** precision;
    const enc = v => {
      v = v < 0 ? ~(v << 1) : (v << 1);
      let s = '';
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    };
    let out = '', plat = 0, plon = 0;
    for (const [lat, lon] of pts) {
      const a = Math.round(lat * f), b = Math.round(lon * f);
      out += enc(a - plat) + enc(b - plon);
      plat = a; plon = b;
    }
    return out;
  }
  function decodePolyline(str, precision = 6) {
    const f = 10 ** precision, pts = [];
    let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      const vals = [];
      for (let k = 0; k < 2; k++) {
        let shift = 0, result = 0, b;
        do {
          if (i >= str.length) throw new Error('bad polyline');
          b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5;
        } while (b >= 0x20);
        vals.push((result & 1) ? ~(result >> 1) : (result >> 1));
      }
      lat += vals[0]; lon += vals[1];
      pts.push([lat / f, lon / f]);
    }
    return pts;
  }

  // local-metre geometry (same as app/geo.py)
  const RE = 6371008.8;
  function toLocal(latlngs) {
    const lat0 = latlngs.reduce((s, p) => s + p[0], 0) / latlngs.length;
    const lon0 = latlngs.reduce((s, p) => s + p[1], 0) / latlngs.length;
    const k = Math.cos(lat0 * Math.PI / 180);
    return latlngs.map(([la, lo]) => [(lo - lon0) * Math.PI / 180 * RE * k, (la - lat0) * Math.PI / 180 * RE]);
  }
  function areaM2(latlngs) {
    if (latlngs.length < 3) return 0;
    const p = toLocal(latlngs);
    let a = 0;
    for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
    return Math.abs(a) / 2;
  }
  function perimeterM(latlngs) {
    const p = toLocal(latlngs);
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); }
    return s;
  }
  const centroid = ll => [ll.reduce((s, p) => s + p[0], 0) / ll.length, ll.reduce((s, p) => s + p[1], 0) / ll.length];

  function niceStep(v) {
    if (v <= 0) return 1;
    const e = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v - 1e-12) return m * e;
    return 10 * e;
  }

  // ------------------------------------------------------------------ state
  const S = {
    mode: 'ai', busy: false, roof: null, aiPoints: [], refineLabel: null, drawPts: [],
    addressAuto: true, lastRevKey: '', config: null, result: null, assessSeq: 0,
  };

  // ------------------------------------------------------------------ map
  const map = L.map('map', { zoomControl: true, maxZoom: 21, minZoom: 3, worldCopyJump: true })
    .setView(ODISHA_CENTER, 13);
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
    maxNativeZoom: 19, maxZoom: 21,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics | Search © OpenStreetMap',
  }).addTo(map);
  const labels = L.layerGroup([
    L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19, maxZoom: 21, opacity: 0.9 }),
    L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19, maxZoom: 21, opacity: 0.5 }),
  ]).addTo(map);
  L.control.layers(null, { 'Place & road labels': labels }, { position: 'bottomright', collapsed: true }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.getContainer().style.cursor = 'crosshair';

  const roofLayer = L.polygon([], { color: '#FACC15', weight: 3, fillColor: '#FACC15', fillOpacity: 0.12 }).addTo(map);
  const panelLayer = L.layerGroup().addTo(map);
  const handleLayer = L.layerGroup().addTo(map);
  const promptLayer = L.layerGroup().addTo(map);
  const drawLayer = L.layerGroup().addTo(map);
  let rubber = null, pulse = null, meMarker = null;
  const areaTip = L.tooltip({ permanent: true, direction: 'top', className: 'area-tip', offset: [0, -8], interactive: false });
  const icon = (cls) => L.divIcon({ className: '', html: `<div class="${cls}"></div>`, iconSize: [0, 0] });

  function setHint(html, busy = false) {
    const h = $('#hint');
    h.innerHTML = html;
    h.classList.toggle('busy', busy);
  }
  function idleHint() {
    if (S.mode === 'draw') return;
    if (S.roof) setHint('Tap another roof, drag the <b>yellow dots</b> to fine-tune, or use ＋/－');
    else if (map.getZoom() < 17) setHint('Zoom in closer to your house, then <b>tap its roof</b>');
    else setHint('Tap the <b>middle of your roof</b> 👆');
  }
  map.on('zoomend', () => { if (!S.busy) idleHint(); });

  // ------------------------------------------------------------------ modes / toolbar
  function setMode(m) {
    S.mode = m;
    $$('.tool[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    if (m === 'draw') {
      map.doubleClickZoom.disable();
      $('#refineBar').hidden = true;
      setRefine(null);
      setHint('Click each <b>corner</b> of your roof — click the first corner to finish');
    } else {
      map.doubleClickZoom.enable();
      S.drawPts = [];
      drawLayer.clearLayers();
      if (rubber) { rubber.remove(); rubber = null; }
      $('#refineBar').hidden = !(S.roof && S.roof.method !== 'manual');
      idleHint();
    }
    updateToolbar();
  }
  function updateToolbar() {
    const draw = S.mode === 'draw';
    $('#undoBtn').hidden = !((draw && S.drawPts.length) || (!draw && S.aiPoints.length > 1));
    $('#finishBtn').hidden = !(draw && S.drawPts.length >= 3);
  }
  function setRefine(label) {
    S.refineLabel = label;
    $$('[data-refine]').forEach(b => b.classList.toggle('on', label !== null && +b.dataset.refine === label));
    if (label === 1) setHint('Tap the part of the roof that was <b>missed</b>');
    else if (label === 0) setHint('Tap the area that is <b>not</b> your roof');
    else idleHint();
  }
  $$('.tool[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('[data-refine]').forEach(b => b.addEventListener('click', () => {
    const v = +b.dataset.refine;
    setRefine(S.refineLabel === v ? null : v);
  }));
  $('#newRoofBtn').addEventListener('click', () => { setRefine(null); S.aiPoints = []; promptLayer.clearLayers(); updateToolbar(); setHint('Tap a roof 👆'); });
  $('#undoBtn').addEventListener('click', undo);
  $('#finishBtn').addEventListener('click', finishDraw);
  $('#clearBtn').addEventListener('click', clearAll);

  function undo() {
    if (S.mode === 'draw') {
      S.drawPts.pop();
      renderDraw();
    } else if (S.aiPoints.length > 1 && !S.busy) {
      S.aiPoints.pop();
      runSegment();
    }
  }

  function clearAll() {
    S.roof = null; S.aiPoints = []; S.drawPts = []; S.result = null; S.addressAuto = true; S.lastRevKey = '';
    roofLayer.setLatLngs([]); areaTip.remove();
    [panelLayer, handleLayer, promptLayer, drawLayer].forEach(l => l.clearLayers());
    if (rubber) { rubber.remove(); rubber = null; }
    $('#results').hidden = true; $('#roofCard').hidden = true; $('#introCard').hidden = false;
    $('#refineBar').hidden = true; $('#addressInput').value = '';
    setRefine(null); updateToolbar(); idleHint();
    history.replaceState(null, '', location.pathname);
  }

  // ------------------------------------------------------------------ map clicks
  map.on('click', e => {
    if (S.mode === 'draw') return addDrawPoint(e.latlng);
    if (S.busy) return toast('Still tracing the roof… one second ⏳');
    if (map.getZoom() < 16) {
      map.flyTo(e.latlng, 19, { duration: 0.9 });
      setHint('Now tap the <b>middle of your roof</b> 👆');
      return;
    }
    const pt = { lat: e.latlng.lat, lon: e.latlng.lng, label: 1 };
    if (S.roof && S.refineLabel !== null && S.aiPoints.length) {
      pt.label = S.refineLabel;
      S.aiPoints.push(pt);
    } else {
      S.aiPoints = [pt];
    }
    runSegment();
  });

  function showPrompts() {
    promptLayer.clearLayers();
    if (S.aiPoints.length < 2 && S.refineLabel === null) return;
    S.aiPoints.forEach(p => L.marker([p.lat, p.lon], { icon: icon(`prompt-pt ${p.label ? 'pos' : 'neg'}`), interactive: false }).addTo(promptLayer));
  }

  async function runSegment() {
    const pts = S.aiPoints.slice();
    if (!pts.length) return;
    S.busy = true;
    showPrompts();
    const last = pts[pts.length - 1];
    pulse = L.marker([last.lat, last.lon], { icon: icon('pulse'), interactive: false }).addTo(map);
    setHint('🤖 MobileSAM is tracing your roof…', true);
    const zoom = clamp(Math.round(map.getZoom()), 17, 19);
    const t0 = performance.now();
    try {
      const r = await api('/api/segment', { points: pts, zoom });
      if (!r.ok) {
        toast(r.message, 'warn', 5500);
        if (S.aiPoints.length > 1) S.aiPoints.pop();
        idleHint();
        return;
      }
      setRoof(r.polygon, 'ai', r.score);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      setHint(`✅ Roof found in ${secs}s — drag the <b>yellow dots</b> to fine-tune`);
      (r.warnings || []).forEach(w => toast(w, 'warn', 7000));
      if (r.method !== 'mobilesam' && !S.warnedEngine) {
        S.warnedEngine = true;
        toast('Basic OpenCV mode — for best accuracy run: python scripts/download_models.py', 'warn', 7000);
      }
      $('#refineBar').hidden = false;
    } catch (err) {
      toast(err.message, 'err', 6500);
      if (S.aiPoints.length > 1) S.aiPoints.pop();
      idleHint();
    } finally {
      S.busy = false;
      if (pulse) { pulse.remove(); pulse = null; }
      showPrompts();
      updateToolbar();
    }
  }

  // ------------------------------------------------------------------ manual drawing
  function addDrawPoint(latlng) {
    if (S.drawPts.length >= 3) {
      const p0 = map.latLngToContainerPoint(S.drawPts[0]);
      if (p0.distanceTo(map.latLngToContainerPoint(latlng)) < 14) return finishDraw();
    }
    S.drawPts.push([latlng.lat, latlng.lng]);
    renderDraw();
  }
  function renderDraw() {
    drawLayer.clearLayers();
    if (S.drawPts.length) {
      L.polyline(S.drawPts, { color: '#FACC15', weight: 3, dashArray: '6 6', interactive: false }).addTo(drawLayer);
      S.drawPts.forEach((p, i) => {
        const mk = L.marker(p, { icon: icon(`vtx ${i === 0 ? 'first' : ''}`), keyboard: false });
        if (i === 0) mk.on('click', () => { if (S.drawPts.length >= 3) finishDraw(); });
        mk.addTo(drawLayer);
      });
    }
    if (!S.drawPts.length && rubber) { rubber.remove(); rubber = null; }
    updateToolbar();
    if (S.mode === 'draw') {
      setHint(S.drawPts.length < 3 ? `Click the roof corners (${S.drawPts.length} so far)`
        : 'Click the <b>first corner</b> (or ✓ Finish) to close the outline');
    }
  }
  map.on('mousemove', e => {
    if (S.mode !== 'draw' || !S.drawPts.length) { if (rubber) { rubber.remove(); rubber = null; } return; }
    const last = S.drawPts[S.drawPts.length - 1];
    if (!rubber) rubber = L.polyline([last, e.latlng], { color: '#FACC15', weight: 2, dashArray: '2 6', interactive: false }).addTo(map);
    else rubber.setLatLngs([last, e.latlng]);
  });
  function finishDraw() {
    if (S.drawPts.length < 3) return toast('Add at least 3 corners first');
    const pts = S.drawPts.slice();
    S.drawPts = [];
    drawLayer.clearLayers();
    if (rubber) { rubber.remove(); rubber = null; }
    S.aiPoints = [];
    promptLayer.clearLayers();
    setRoof(pts, 'manual');
    updateToolbar();
    setHint('✅ Outline saved — drag the <b>yellow dots</b> to adjust, or draw again');
  }

  // ------------------------------------------------------------------ roof
  function setRoof(latlngs, method, conf = null, opts = {}) {
    S.roof = { latlngs: latlngs.map(p => [p[0], p[1]]), method, conf };
    roofLayer.setLatLngs(S.roof.latlngs);
    drawHandles();
    updateRoofInfo();
    if (opts.fit) map.fitBounds(roofLayer.getBounds(), { maxZoom: 19, padding: [60, 60] });
    $('#introCard').hidden = true;
    $('#roofCard').hidden = false;
    maybeReverse();
    scheduleAssess();
  }

  function drawHandles() {
    handleLayer.clearLayers();
    if (!S.roof) return;
    S.roof.latlngs.forEach((ll, i) => {
      const m = L.marker(ll, { draggable: true, icon: icon('vtx'), keyboard: false, zIndexOffset: 1000 });
      m.on('drag', e => {
        const p = e.target.getLatLng();
        S.roof.latlngs[i] = [p.lat, p.lng];
        roofLayer.setLatLngs(S.roof.latlngs);
        panelLayer.clearLayers();
        updateRoofInfo();
      });
      m.on('dragend', () => {
        if (S.roof.method === 'ai') S.roof.method = 'ai-edited';
        updateRoofInfo();
        maybeReverse();
        scheduleAssess();
      });
      m.addTo(handleLayer);
    });
  }

  function updateRoofInfo() {
    if (!S.roof) return;
    const a = areaM2(S.roof.latlngs);
    $('#areaM2').textContent = fmtIN(a);
    $('#areaSqft').textContent = `(${fmtIN(a * 10.7639)} sq ft)`;
    const north = S.roof.latlngs.reduce((m, q) => (q[0] > m[0] ? q : m), S.roof.latlngs[0]);
    const lngC = S.roof.latlngs.reduce((t, q) => t + q[1], 0) / S.roof.latlngs.length;
    areaTip.setLatLng([north[0], lngC]).setContent(`${fmtIN(a)} m²`);
    if (!map.hasLayer(areaTip)) areaTip.addTo(map);
    const b = $('#methodBadge');
    const m = S.roof.method;
    b.textContent = m === 'ai' ? '🤖 AI · MobileSAM' : m === 'ai-edited' ? '🤖 AI + hand-tuned' : '✏️ Drawn by hand';
    b.classList.toggle('manual', m === 'manual');
    const conf = S.roof.conf != null && m === 'ai' ? `AI confidence ${(Math.min(1, S.roof.conf) * 100).toFixed(0)}% · ` : '';
    $('#roofNote').textContent = `${conf}${S.roof.latlngs.length} corners · perimeter ${fmtIN(perimeterM(S.roof.latlngs))} m`;
  }

  async function maybeReverse() {
    if (!S.roof || !S.addressAuto) return;
    const [lat, lon] = centroid(S.roof.latlngs);
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (key === S.lastRevKey) return;
    S.lastRevKey = key;
    try {
      const r = await api(`/api/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
      if (r.name && S.addressAuto) { $('#addressInput').value = r.name; updateLinksSoon(); }
    } catch (e) { /* offline: leave blank */ }
  }

  function drawPanels(panels) {
    panelLayer.clearLayers();
    (panels || []).forEach(p => L.polygon(p, {
      color: '#93c5fd', weight: 0.8, fillColor: '#1e3a8a', fillOpacity: 0.92, interactive: false,
    }).addTo(panelLayer));
  }

  // ------------------------------------------------------------------ inputs
  function num(id, def) { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : def; }
  function opt(id) { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; }
  function collectInputs() {
    const d = S.config.defaults;
    const rn = opt('#rainOverride');
    return {
      monthly_units: clamp(num('#units', d.monthly_units), 0, 100000),
      family_size: clamp(Math.round(num('#family', d.family_size)), 1, 100),
      roof_type: $('#roofType').value || d.roof_type,
      floors: clamp(Math.round(num('#floors', d.floors)), 1, 30),
      usable_fraction: clamp(num('#usable', 70), 5, 100) / 100,
      // blank tariff = bill with the OERC domestic slabs for the units entered
      tariff: opt('#tariff') === null ? null : clamp(opt('#tariff'), 0, 50),
      sanctioned_load_kw: clamp(num('#loadKw', d.sanctioned_load_kw), 0, 500),
      cost_per_kw: clamp(num('#costKw', d.cost_per_kw), 10000, 300000),
      panel_w: clamp(Math.round(num('#panelW', d.panel_w)), 100, 800),
      subsidy: $('#subsidy').checked,
      state_subsidy: $('#stateSubsidy').checked,
      export_rate: opt('#exportRate') === null ? null : clamp(opt('#exportRate'), 0, 20),
      tanker_price: clamp(num('#tankerPrice', d.tanker_price), 0, 20000),
      design_rain_mm: clamp(num('#designRain', d.design_rain_mm), 5, 300),
      rwh_l_per_m2: clamp(num('#rwhL', d.rwh_l_per_m2), 0, 1000),
      chhata: $('#chhata').checked,
      rrhs_cost_per_m2: clamp(num('#rrhsCost', d.rrhs_cost_per_m2), 0, 100000),
      rain_override_mm: rn !== null && rn >= 50 ? Math.min(rn, 12000) : null,
    };
  }

  const scheduleAssess = debounce(runAssess, 260);
  async function runAssess() {
    if (!S.roof || S.roof.latlngs.length < 3 || !S.config) return;
    const body = { ...collectInputs(), polygon: S.roof.latlngs };
    const seq = ++S.assessSeq;
    try {
      const r = await api('/api/assess', body);
      if (seq !== S.assessSeq) return;
      S.result = r;
      renderResults(r);
      drawPanels(r.layout.panels);
      updateLinks();
    } catch (err) {
      if (seq === S.assessSeq) toast(err.message, 'err', 6000);
    }
  }

  // ------------------------------------------------------------------ results
  function kpi(l, v, s, hero = false, right = null) {
    if (hero) {
      return `<div class="kpi hero"><div><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>` +
        (right ? `<div style="text-align:right"><div class="l">${right[0]}</div><div class="v">${right[1]}</div><div class="s">${right[2]}</div></div>` : '') + '</div>';
    }
    return `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  }

  function barChart(values, { color, line, barName, lineName, unit }) {
    const W = 360, H = 150, L0 = 32, T = 10, B = 20, R0 = 4;
    const top = Math.max(...values, ...(line || [0])) * 1.08 || 1;
    const step = niceStep(top / 4), vmax = step * 4;
    const cw = W - L0 - R0, ch = H - T - B, slot = cw / 12, bw = slot * 0.62;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(barName)} by month">`;
    for (let i = 0; i <= 4; i++) {
      const y = T + ch - ch * i / 4;
      s += `<line x1="${L0}" x2="${W - R0}" y1="${y}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>` +
        `<text x="${L0 - 5}" y="${y + 3}" text-anchor="end" font-size="8.5" fill="#64748b">${compact(step * i)}</text>`;
    }
    values.forEach((v, i) => {
      const h = Math.max(0, ch * v / vmax), x = L0 + i * slot + (slot - bw) / 2, y = T + ch - h;
      s += `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}" style="animation-delay:${i * 30}ms">` +
        `<title>${MONTHS[i]}: ${fmtIN(v)} ${unit}${line ? ` (use: ${fmtIN(line[i])})` : ''}</title></rect>` +
        `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="8.5" fill="#64748b">${MONTHS[i]}</text>`;
    });
    if (line) {
      const pts = line.map((v, i) => `${(L0 + i * slot + slot / 2).toFixed(1)},${(T + ch - ch * v / vmax).toFixed(1)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="#475569" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    }
    s += '</svg>';
    const legend = `<div class="legend"><span><i style="background:${color}"></i>${esc(barName)}</span>` +
      (line ? `<span><i class="dash"></i>${esc(lineName)}</span>` : '') + '</div>';
    return legend + s;
  }

  function renderResults(r) {
    const s = r.solar, w = r.rain, g = r.score, p = r.params;
    $('#results').hidden = false;
    // score
    const ring = $('#ringFg');
    ring.style.strokeDashoffset = (314.16 * (1 - g.score / 100)).toFixed(1);
    ring.style.stroke = g.score >= 75 ? '#16A34A' : g.score >= 50 ? '#F59E0B' : '#EF4444';
    $('#scoreNum').textContent = g.score;
    $('#scoreGrade').textContent = `Grade ${g.grade}`;
    $('#scoreGrade').style.color = ring.style.stroke;
    $('#solarBar').style.width = `${(g.solar_pts / 55) * 100}%`;
    $('#waterBar').style.width = `${(g.water_pts / 35) * 100}%`;
    $('#ruleBar').style.width = `${((g.rule_pts || 0) / 10) * 100}%`;
    $('#solarPts').textContent = `${g.solar_pts}/55`;
    $('#waterPts').textContent = `${g.water_pts}/35`;
    $('#rulePts').textContent = `${g.rule_pts || 0}/10`;
    const water = w.coverage >= 1 ? `all of your family’s water (${Math.round(w.coverage * 100)}% of yearly use)`
      : `${Math.round(w.coverage * 100)}% of your family’s yearly water`;
    const loc = r.location || {};
    $('#scoreLine').textContent = (s.panels
      ? `Your roof can cover ${Math.round(s.coverage * 100)}% of your electricity and ${water}.`
      : `Too small for solar panels, but it can still provide ${water}.`) +
      (loc.district ? ` ${loc.district} district · ${loc.discom}.` : '');

    // solar
    const lim = s.limited_by === 'roof' ? 'roof space' : 'your electricity use';
    $('#solarHead').textContent = s.panels ? `${s.kw.toFixed(2)} kW · ${s.panels} panels` : 'not enough space';
    if (s.panels) {
      const payback = s.payback_years ? `${s.payback_years.toFixed(1)} yrs` : '—';
      $('#solarKpis').innerHTML = [
        kpi('Bill savings / year', rupees(s.annual_savings), `≈ ₹${fmtIN(s.monthly_savings_avg)} per month`, true,
          ['Payback', payback, 'then free power']),
        kpi('System size', `${s.kw.toFixed(2)} kW`, `${s.panels} × ${p.panel_w} Wp panels`),
        kpi('Units / year', fmtIN(s.annual_gen), `≈ ${fmtIN(s.annual_gen / 12)} units/month`),
        kpi('Cost after subsidy', rupees(s.net_cost),
          `${rupees(s.gross_cost)} − ${rupees(s.subsidy_central)} central − ${rupees(s.subsidy_state)} Odisha SFA`),
        kpi('PM Surya Ghar subsidy', rupees(s.subsidy_central), s.subsidy_central ? 'central subsidy (homes)' : 'not applied'),
        kpi('Odisha SFA subsidy', rupees(s.subsidy_state), s.subsidy_state ? 'state top-up · Cabinet Jan 2025' : 'not applied'),
        kpi('Your bill today', rupees(s.bill_before),
          `${fmtIN(s.annual_units)} units/yr → ${rupees(s.bill_after)} with solar`),
        kpi(`${s.lifetime_years}-year savings`, rupees(s.lifetime_savings), `net gain ${rupees(s.lifetime_profit)}`),
        kpi('CO₂ avoided', `${s.co2_t_year.toFixed(1)} t/yr`, `${fmtIN(s.co2_t_life)} t in ${s.lifetime_years} yrs`),
        kpi('Like planting', `${fmtIN(s.trees_equiv)} trees`, '≈ 20 kg CO₂ per tree per year'),
        kpi('Full-roof potential', `${s.full_roof_kw.toFixed(1)} kW`, `${fmtIN(s.full_roof_gen)} units/yr max`),
      ].join('');
      $('#solarChart').innerHTML = barChart(s.monthly_gen, {
        color: '#F59E0B', line: s.monthly_consumption, barName: 'Solar units', lineName: 'Your monthly use', unit: 'units',
      });
      const extra = s.limited_by === 'roof'
        ? `Your roof space limits the size (needs ~${p.m2_per_kw} m² per kW).`
        : (s.full_roof_kw > s.kw + 0.2 ? `Your roof could hold up to ${s.full_roof_kw.toFixed(1)} kW if you want to sell more power.` : '');
      $('#solarFoot').textContent = `Sized by ${lim}. Here 1 kW makes ~${s.daily_units_per_kw.toFixed(1)} units/day. ` +
        `OERC net metering: surplus carries forward inside the year and what is left on 31 March is settled at ` +
        `₹${s.export_rate.toFixed(2)}/unit, credited up to ${Math.round(s.net_meter_cap * 100)}% of your yearly use. ${extra}`;
    } else {
      $('#solarKpis').innerHTML = kpi('Roof too small', `${fmtIN(s.usable_area_m2)} m² usable`,
        `one ${p.panel_w} Wp panel needs ~${(p.panel_w / 1000 * p.m2_per_kw).toFixed(1)} m² — try a bigger usable %`, true);
      $('#solarChart').innerHTML = '';
      $('#solarFoot').textContent = '';
    }

    // rain
    const wl = w.recharge_well;
    $('#rainHead').textContent = `${fmtIN(w.annual_rain_mm)} mm rain / year`;
    $('#rainKpis').innerHTML = [
      kpi('Rainwater / year', litres(w.annual_harvest_l), `area × ${fmtIN(w.annual_rain_mm)} mm × ${w.runoff_c}`, true,
        ['Tankers avoided', `${fmtIN(w.tankers_saved)}`, `of ${fmtIN(p.tanker_litres)} L / year`]),
      kpi('Water for', `${fmtIN(w.days_of_water)} days`, `family of ${p.family_size} @ ${p.lpcd} L/day each`),
      kpi('Storage tank', `${fmtIN(w.tank.litres)} L`, `${w.tank.text} · holds a ${p.design_rain_mm} mm rain day`),
      kpi('Recharge well', `${wl.wells > 1 ? wl.wells + ' × ' : ''}${wl.diameter_m} m Ø × ${wl.depth_m} m`, `holds ${fmtIN(wl.capacity_l)} L`),
      kpi('Odisha rule', `${fmtIN(w.rule_min_l)} L`,
        `${w.rule.l_per_m2} L per m² of roof · ODA Rules 2020 · ${w.meets_rule ? 'met' : 'short by ' + litres(w.rule_gap_l)}`),
      kpi('CHHATA subsidy', w.chhata.eligible ? rupees(w.chhata.subsidy) : 'not eligible',
        w.chhata.eligible
          ? `50% of ~${rupees(w.chhata.est_cost)} · Govt. of Odisha`
          : (w.chhata.reasons[0] || 'see the scheme rules')),
      kpi('Water money saved', rupees(w.tanker_savings), `at ₹${fmtIN(p.tanker_price)} per tanker`),
      kpi('Downpipes needed', `${w.downpipes.count} × ${w.downpipes.diameter_mm} mm`, 'ODA Rules: 2 per 100 m² of roof'),
    ].join('');
    $('#rainChart').innerHTML = barChart(w.monthly_harvest_l, {
      color: '#0EA5E9', line: w.monthly_demand_l, barName: 'Rainwater harvest (L)', lineName: 'Family water use', unit: 'L',
    });
    $('#rainFoot').textContent = 'Solar panels don’t reduce rainwater — rain runs off the panels into the same pipes. ' +
      `${Math.round(w.monsoon_share * 100)}% of your harvest lands in the Jul–Oct monsoon. Climate: ${r.climate.source}.`;
    $('#climateSrc').textContent = `Climate for this roof: ${r.climate.source}. Average sunlight ${r.climate.ghi_avg.toFixed(2)} kWh/m²/day, ` +
      `performance ratio ${s.pr_avg.toFixed(2)} (temperature-corrected).`;
  }

  // ------------------------------------------------------------------ share / report links
  function stateParams() {
    const i = collectInputs(), d = S.config.defaults, q = new URLSearchParams();
    q.set('p', encodePolyline(S.roof.latlngs));
    q.set('u', i.monthly_units); q.set('f', i.family_size); q.set('rt', i.roof_type);
    q.set('uf', Math.round(i.usable_fraction * 100));
    if (i.tariff !== null) q.set('t', i.tariff);
    if (i.sanctioned_load_kw !== d.sanctioned_load_kw) q.set('sl', i.sanctioned_load_kw);
    if (i.floors !== d.floors) q.set('fl', i.floors);
    if (i.cost_per_kw !== d.cost_per_kw) q.set('c', i.cost_per_kw);
    if (i.panel_w !== d.panel_w) q.set('pw', i.panel_w);
    if (!i.subsidy) q.set('s', '0');
    if (!i.state_subsidy) q.set('ss', '0');
    if (i.export_rate !== null) q.set('ex', i.export_rate);
    if (i.tanker_price !== d.tanker_price) q.set('tp', i.tanker_price);
    if (i.design_rain_mm !== d.design_rain_mm) q.set('dr', i.design_rain_mm);
    if (i.rwh_l_per_m2 !== d.rwh_l_per_m2) q.set('rl', i.rwh_l_per_m2);
    if (!i.chhata) q.set('ch', '0');
    if (i.rrhs_cost_per_m2 !== d.rrhs_cost_per_m2) q.set('rc', i.rrhs_cost_per_m2);
    if (i.rain_override_mm !== null) q.set('rn', i.rain_override_mm);
    const a = $('#addressInput').value.trim();
    if (a) q.set('a', a.slice(0, 120));
    q.set('m', S.roof.method.startsWith('ai') ? 'ai' : 'manual');
    if (S.roof.method === 'ai' && S.roof.conf != null) q.set('cf', Math.min(1, S.roof.conf).toFixed(2));
    return q;
  }
  let lastQr = '';
  let lastReportQ = '';
  function updateLinks() {
    if (!S.roof || !S.config) return;
    const q = stateParams().toString();
    const origin = location.origin;
    lastReportQ = q;
    $('#shareUrl').value = `${origin}/app?${q}`;
    const reportAbs = `${origin}/r?${q}`;
    if (reportAbs !== lastQr) {
      lastQr = reportAbs;
      $('#qrImg').src = `/api/qr.svg?data=${encodeURIComponent(reportAbs)}`;
    }
    try { history.replaceState(null, '', `${location.pathname}?${q}`); } catch (e) { /* sandboxed */ }
  }
  const updateLinksSoon = debounce(updateLinks, 400);

  // Robust PDF download: fetch a blob and hand it to the browser. Plain <a href> links
  // to an "attachment" response are blocked inside embedded preview iframes, which made
  // the button silently do nothing there.
  async function downloadReport() {
    if (!lastReportQ) return;
    const btn = $('#dlBtn');
    const old = btn.textContent;
    btn.textContent = '⏳ Building…';
    btn.style.pointerEvents = 'none';
    try {
      const res = await fetch(`/r?${lastReportQ}&dl=1`);
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j && j.detail) msg = String(j.detail); } catch (e) { /* not json */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '');
      const name = m ? decodeURIComponent(m[1].trim()) : 'SuryaJal_Green_Roof_Report.pdf';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('Report downloaded ✓ (check Downloads)', 'ok');
    } catch (e) {
      toast('Download failed (' + e.message + ') — use “Open” instead', 'warn', 9000);
    } finally {
      btn.textContent = old;
      btn.style.pointerEvents = '';
    }
  }
  $('#dlBtn').addEventListener('click', (e) => { e.preventDefault(); downloadReport(); refreshStatsSoon(); });
  $('#openBtn').addEventListener('click', refreshStatsSoon);

  // ------------------------------------------------------------------ search / locate
  const results = $('#searchResults');
  function flyTo(lat, lon, z) { map.flyTo([lat, lon], z, { duration: 1.2 }); }
  function zoomFor(type) {
    if (['house', 'building', 'apartments', 'residential', 'yes', 'detached', 'school', 'college', 'university'].includes(type)) return 19;
    if (['road', 'street', 'tertiary', 'secondary', 'primary', 'service', 'living_street'].includes(type)) return 18;
    if (['neighbourhood', 'suburb', 'quarter', 'hamlet'].includes(type)) return 16;
    if (['city', 'town', 'administrative', 'county', 'state_district'].includes(type)) return 13;
    return 17;
  }
  function pickResult(r) {
    results.hidden = true;
    flyTo(r.lat, r.lon, zoomFor(r.type));
    setHint(r.discom
      ? `Zoom in to your house in <b>${esc(r.district || 'Odisha')}</b> (${esc(r.discom)}) and <b>tap its roof</b> 👆`
      : 'Zoom in to your house and <b>tap its roof</b> 👆');
  }
  $('#searchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) return;
    const m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (m) { results.hidden = true; flyTo(+m[1], +m[2], 19); return; }
    try {
      const res = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.length) return toast('No place found in Odisha — try a town, landmark or PIN code', 'warn');
      if (res.length === 1) return pickResult(res[0]);
      results.innerHTML = res.map((r, i) => {
        const [head, ...rest] = r.name.split(', ');
        const where = r.district ? `${r.district} district · ${r.discom} · ` : '';
        return `<li data-i="${i}"><b>${esc(head)}</b><small>${esc(where + rest.slice(0, 3).join(', '))}</small></li>`;
      }).join('');
      results.hidden = false;
      $$('li', results).forEach(li => li.addEventListener('click', () => pickResult(res[+li.dataset.i])));
    } catch (err) { toast(err.message, 'err'); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) results.hidden = true; });

  $('#locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser — please search instead', 'warn');
    toast('Finding you…');
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      flyTo(lat, lon, 19);
      if (meMarker) meMarker.remove();
      meMarker = L.marker([lat, lon], { icon: icon('me-dot'), interactive: false }).addTo(map);
      // which district / Odisha DISCOM serves this spot?
      api(`/api/odisha/locate?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`)
        .then(l => {
          if (!l.in_odisha) {
            return toast('SuryaJal is built for Odisha — tariffs, subsidies and rainwater rules are Odisha’s. ' +
              'You can still explore, but the numbers won’t apply here.', 'warn', 8000);
          }
          toast(`You are here (±${Math.round(accuracy)} m) — ${l.district} district, ${l.discom}. Now tap your roof!`, 'ok');
        })
        .catch(() => toast(`You are here (±${Math.round(accuracy)} m). Now tap your roof!`, 'ok'));
    }, () => toast('Could not get your location — allow location access, or search instead', 'warn'),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  // ------------------------------------------------------------------ keyboard
  document.addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      results.hidden = true;
      if (S.mode === 'draw' && S.drawPts.length) { S.drawPts = []; renderDraw(); }
      else if (S.refineLabel !== null) setRefine(null);
    }
    if (typing) return;
    if (e.key === 'Enter' && S.mode === 'draw') finishDraw();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  // ------------------------------------------------------------------ inputs wiring
  // all-in ₹/unit: your own flat rate if you typed one, else the OERC slab bill the backend computed
  function allInRate() {
    const own = opt('#tariff');
    if (own !== null && own > 0) return own * 1.04 + 20 / Math.max(1, num('#units', 250)) * 1.04;
    const s = S.result && S.result.solar;
    return s && s.tariff > 0 ? s.tariff : 5.05;
  }
  $('#usable').addEventListener('input', () => { $('#usableVal').textContent = `${$('#usable').value}%`; });
  $('#billAmt').addEventListener('input', () => {
    const b = parseFloat($('#billAmt').value);
    if (Number.isFinite(b) && b > 0) { $('#units').value = Math.round(b / allInRate()); scheduleAssess(); }
  });
  $('#tariff').addEventListener('input', () => { $('#allInRate').textContent = allInRate().toFixed(1); });
  $$('#roofCard input:not(#addressInput), #roofCard select, #homeCard input:not(#billAmt), #assumptions input')
    .forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', scheduleAssess));
  $('#addressInput').addEventListener('input', () => { S.addressAuto = false; updateLinksSoon(); });

  $('#demoBtn').addEventListener('click', () => {
    clearAll();
    S.addressAuto = false;
    $('#addressInput').value = DEMO.name;
    setRoof(DEMO.poly, 'ai', 1.0, { fit: true });
    $('#refineBar').hidden = true;
    setHint('✨ Demo roof loaded — now search and tap <b>your own</b> roof!');
  });

  // ------------------------------------------------------------------ stats + config + boot
  async function loadStats() {
    try {
      const st = await api('/api/stats');
      const t = st.today;
      const box = $('#festCounter');
      if (t.roofs > 0) {
        box.innerHTML = `🌍 Today at SuryaJal: <b>${fmtIN(t.roofs)}</b> roof${t.roofs > 1 ? 's' : ''} checked · ` +
          `<b>${t.kw.toFixed(1)} kW</b> solar · <b>${litres(t.litres)}</b> rainwater · <b>${t.co2_t.toFixed(1)} t</b> CO₂/yr`;
        box.hidden = false;
      }
    } catch (e) { /* ignore */ }
  }

  function applyDefaults(d) {
    $('#tariff').value = d.tariff === null ? '' : d.tariff;   // blank = OERC slabs
    $('#loadKw').value = d.sanctioned_load_kw;
    $('#floors').value = d.floors;
    $('#costKw').value = d.cost_per_kw;
    $('#panelW').value = d.panel_w;
    $('#tankerPrice').value = d.tanker_price;
    $('#designRain').value = d.design_rain_mm;
    $('#rwhL').value = d.rwh_l_per_m2;
    $('#rrhsCost').value = d.rrhs_cost_per_m2;
    $('#subsidy').checked = !!d.subsidy;
    $('#stateSubsidy').checked = !!d.state_subsidy;
    $('#chhata').checked = !!d.chhata;
    $('#units').value = d.monthly_units;
    $('#family').value = d.family_size;
    $('#usable').value = Math.round(d.usable_fraction * 100);
    $('#usableVal').textContent = `${$('#usable').value}%`;
    $('#allInRate').textContent = allInRate().toFixed(1);
  }

  function restoreFromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.get('p')) return false;
    let poly;
    try { poly = decodePolyline(q.get('p')); } catch (e) { return false; }
    if (poly.length < 3) return false;
    const set = (id, k) => { if (q.has(k)) $(id).value = q.get(k); };
    set('#units', 'u'); set('#family', 'f'); set('#tariff', 't'); set('#costKw', 'c'); set('#panelW', 'pw');
    set('#exportRate', 'ex'); set('#tankerPrice', 'tp'); set('#designRain', 'dr'); set('#rainOverride', 'rn');
    set('#loadKw', 'sl'); set('#floors', 'fl'); set('#rwhL', 'rl'); set('#rrhsCost', 'rc');
    if (q.has('rt')) $('#roofType').value = q.get('rt');
    if (q.has('uf')) { $('#usable').value = q.get('uf'); $('#usableVal').textContent = `${q.get('uf')}%`; }
    if (q.get('s') === '0') $('#subsidy').checked = false;
    if (q.get('ss') === '0') $('#stateSubsidy').checked = false;
    if (q.get('ch') === '0') $('#chhata').checked = false;
    if (q.has('a')) { $('#addressInput').value = q.get('a'); S.addressAuto = false; }
    setRoof(poly, q.get('m') === 'ai' ? 'ai' : 'manual', q.has('cf') ? +q.get('cf') : null, { fit: true });
    $('#refineBar').hidden = true;
    return true;
  }

  async function boot() {
    try {
      S.config = await api('/api/config');
    } catch (e) {
      toast(e.message, 'err', 10000);
      return;
    }
    const c = S.config;
    $('#roofType').innerHTML = Object.entries(c.roof_types)
      .map(([k, v]) => `<option value="${k}">${esc(v.label)} (runoff ${v.c})</option>`).join('');
    $('#roofType').value = c.defaults.roof_type;
    applyDefaults(c.defaults);
    $('#sourcesList').innerHTML = c.sources.map(([k, v, u]) =>
      `<li><b>${esc(k)}:</b> ${esc(v)}${u ? ` — <a href="${esc(u)}" target="_blank" rel="noopener">link</a>` : ''}</li>`).join('');
    const eb = $('#engineBadge');
    eb.textContent = c.engine === 'mobilesam' ? 'AI: MobileSAM (Segment Anything)' : 'AI: basic OpenCV mode';
    eb.classList.add(c.engine === 'mobilesam' ? 'ok' : 'warn');
    if (c.engine_note) eb.title = c.engine_note;
    if (!restoreFromUrl()) idleHint();
    loadStats();
    setInterval(loadStats, 60000);
  }
  boot();
})();
