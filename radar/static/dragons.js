/* Collectible dragons (v2). Finishing the daily goal (5 quiet posts) hatches one egg a day into a dragon sticker.
   Streaks raise the chance of a rare holo dragon or a golden legend. Everything is kept in this browser
   (localStorage "pd:dex") and travels with the My progress backup code. */
(() => {
  "use strict";
  const D = window.PD_DEX;
  const $ = (id) => document.getElementById(id);
  const hatchEl = $("hatch"), dexEl = $("dex");
  if (!D || !hatchEl || !dexEl) return;
  const BASE = hatchEl.dataset.base || "https://res.cloudinary.com/gosbi0oh";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayGap = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const GOAL = 5;

  const ALL = [...D.dragons.map((d) => ({ ...d, kind: "egg" })), ...D.legends.map((d) => ({ ...d, kind: "legend" }))];
  const byId = Object.fromEntries(ALL.map((d) => [d.id, d]));
  const TOTAL = ALL.length;
  const RARITY = { common: "Common", rare: "Rare", legend: "Legendary" };

  // ---------- the collection ----------
  function load() {
    const d = store.get("pd:dex", null);
    const ok = d && typeof d === "object" && d.have && typeof d.have === "object";
    return ok ? { have: d.have, last: d.last || null, log: Array.isArray(d.log) ? d.log : [] } : { have: {}, last: null, log: [] };
  }
  let dex = load();
  const save = () => store.set("pd:dex", dex);
  const owned = (id) => { const h = dex.have[id]; return !!h && ((h.c || 0) + (h.r || 0) + (h.l || 0)) > 0; };
  const found = () => ALL.filter((d) => owned(d.id)).length;

  function goalDone() { const g = store.get("pd:goal", null); return !!g && g.day === today() && (g.n || 0) >= GOAL; }
  function streakNow() {
    const s = store.get("pd:streak", null) || {};
    return s.last && dayGap(s.last, today()) <= 1 ? s.count || 0 : 0;
  }
  const canHatch = () => goalDone() && dex.last !== today();

  // the odds: a streak makes the good ones more likely
  function odds(streak) {
    if (streak >= 7) return { legend: 0.10, rare: 0.30 };
    if (streak >= 3) return { legend: 0.04, rare: 0.22 };
    return { legend: 0.01, rare: 0.12 };
  }
  function pick(list) {
    // most of the time, favour one you do not have yet so the shelf keeps filling up
    const missing = list.filter((d) => !owned(d.id));
    const pool = missing.length && Math.random() < 0.7 ? missing : list;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function roll() {
    const o = odds(streakNow()), x = Math.random();
    const first = !dex.log.length;
    if (!first && x < o.legend) return { item: pick(ALL.filter((d) => d.kind === "legend")), rarity: "legend" };
    return { item: pick(ALL.filter((d) => d.kind === "egg")), rarity: !first && x < o.legend + o.rare ? "rare" : "common" };
  }
  function keep(item, rarity) {
    const h = dex.have[item.id] || {};
    const k = rarity === "legend" ? "l" : rarity === "rare" ? "r" : "c";
    h[k] = (h[k] || 0) + 1;
    dex.have[item.id] = h;
    dex.last = today();
    dex.log.push({ id: item.id, r: rarity, day: today() });
    dex.log = dex.log.slice(-90);
    save();
  }

  // ---------- sticker images: cut out of the art sheet on this device ----------
  const imgCache = new Map();
  function rawUrl(item, h) {
    const s = D.sheets[item.sheet], [x, y, w, hh] = s.boxes[item.slot];
    return `${BASE}/image/upload/c_crop,x_${x},y_${y},w_${w},h_${hh}/c_scale,h_${h}/f_png/${s.v}/dragon-radar/dex/sheet-${item.sheet}`;
  }
  const loadImg = (src) => new Promise((res) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  // the sheets sit on flat grey and every sticker has a white border, so the grey is lifted off from the edges in
  function cutOut(im) {
    const W = im.naturalWidth, H = im.naturalHeight;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
    let g;
    try { g = x.getImageData(0, 0, W, H); } catch (e) { return c; }
    const d = g.data, N = W * H;
    const s = [];
    for (let X = 0; X < W; X += 3) s.push(X * 4, ((H - 1) * W + X) * 4);
    for (let Y = 0; Y < H; Y += 3) s.push(Y * W * 4, (Y * W + W - 1) * 4);
    const med = (o) => { const v = s.map((i) => d[i + o]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const bg = [med(0), med(1), med(2)], bgl = (bg[0] + bg[1] + bg[2]) / 3;
    const isBg = (i) => {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3, dl = l - bgl;
      const chroma = Math.abs(d[i] - bg[0] - dl) + Math.abs(d[i + 1] - bg[1] - dl) + Math.abs(d[i + 2] - bg[2] - dl);
      return chroma < 14 && dl < 12 && dl > -70;
    };
    const seen = new Uint8Array(N), q = [];
    const push = (p) => { if (!seen[p] && isBg(p * 4)) { seen[p] = 1; q.push(p); } };
    for (let X = 0; X < W; X++) { push(X); push((H - 1) * W + X); }
    for (let Y = 0; Y < H; Y++) { push(Y * W); push(Y * W + W - 1); }
    while (q.length) { const p = q.pop(), X = p % W; if (X > 0) push(p - 1); if (X < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < N - W) push(p + W); }
    // keep the big piece, drop slivers of the neighbours
    const lab = new Int32Array(N), sizes = [0];
    let cur = 0, bestN = 0;
    for (let p = 0; p < N; p++) {
      if (seen[p] || lab[p]) continue;
      cur++; let n = 0; const st = [p]; lab[p] = cur;
      while (st.length) {
        const r = st.pop(); n++; const X = r % W;
        if (X > 0 && !seen[r - 1] && !lab[r - 1]) { lab[r - 1] = cur; st.push(r - 1); }
        if (X < W - 1 && !seen[r + 1] && !lab[r + 1]) { lab[r + 1] = cur; st.push(r + 1); }
        if (r >= W && !seen[r - W] && !lab[r - W]) { lab[r - W] = cur; st.push(r - W); }
        if (r < N - W && !seen[r + W] && !lab[r + W]) { lab[r + W] = cur; st.push(r + W); }
      }
      sizes.push(n); if (n > bestN) bestN = n;
    }
    for (let p = 0; p < N; p++) if (seen[p] || sizes[lab[p]] < bestN * 0.02) d[p * 4 + 3] = 0;
    for (let p = 0; p < N; p++) {   // soften the edge by one pixel
      if (!d[p * 4 + 3]) continue;
      const X = p % W; let n = 0;
      if (X > 0 && !d[(p - 1) * 4 + 3]) n++; if (X < W - 1 && !d[(p + 1) * 4 + 3]) n++;
      if (p >= W && !d[(p - W) * 4 + 3]) n++; if (p < N - W && !d[(p + W) * 4 + 3]) n++;
      if (n) d[p * 4 + 3] = 255 - n * 45;
    }
    x.putImageData(g, 0, 0);
    return c;
  }
  function sticker(item, h = 360) {
    const key = item.id + ":" + h;
    if (!imgCache.has(key)) imgCache.set(key, loadImg(rawUrl(item, h)).then((im) => (im ? cutOut(im) : null)));
    return imgCache.get(key);
  }
  async function stickerUrl(item, h, dark) {
    const c = await sticker(item, h);
    if (!c) return "";
    if (!dark) return c.toDataURL("image/png");
    const s = document.createElement("canvas"); s.width = c.width; s.height = c.height;
    const x = s.getContext("2d"); x.drawImage(c, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = "#2a3150"; x.fillRect(0, 0, s.width, s.height);
    return s.toDataURL("image/png");
  }

  // ---------- sheets ----------
  function openSheet(el) { el.hidden = false; requestAnimationFrame(() => el.classList.add("open")); document.body.classList.add("sheet-open"); }
  function closeSheet(el) {
    el.classList.remove("open");
    if (!document.querySelector(".sheet-wrap.open")) document.body.classList.remove("sheet-open");
    setTimeout(() => { if (!el.classList.contains("open")) el.hidden = true; }, 250);
  }
  for (const el of [hatchEl, dexEl]) el.addEventListener("click", (e) => { if (e.target === el) closeSheet(el); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!hatchEl.hidden) closeSheet(hatchEl); if (!dexEl.hidden) closeSheet(dexEl); } });

  // ---------- hatching ----------
  let shown = null;   // { item, rarity } on the hatch sheet right now
  const stage = $("hatch-stage"), egg = $("hatch-egg"), pic = $("hatch-dragon");

  function paintEgg(item, rarity) {
    const [body, spot] = rarity === "legend" ? ["#f5c542", "#fff1b8"] : item.egg || ["#f3e6cc", "#d08a4a"];
    egg.style.setProperty("--body", body); egg.style.setProperty("--spot", spot);
  }
  function setStage(state, rarity) { stage.dataset.state = state; stage.dataset.rarity = rarity || ""; }
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));

  function openHatch() {
    if (!canHatch()) { openDex(); return; }
    // the egg is decided now and saved straight away, so reloading cannot reroll it
    let pending = store.get("pd:dexEgg", null);
    if (!pending || pending.day !== today() || !byId[pending.id]) {
      const r = roll();
      pending = { day: today(), id: r.item.id, r: r.rarity };
      store.set("pd:dexEgg", pending);
    }
    shown = { item: byId[pending.id], rarity: pending.r };
    paintEgg(shown.item, shown.rarity);
    sticker(shown.item, 480);   // start loading while they look at the egg
    $("hatch-title").textContent = shown.rarity === "legend" ? "A golden egg!" : "Your egg is ready";
    $("hatch-sub").textContent = shown.rarity === "legend" ? "Something special is inside. Tap to hatch it."
      : "You gave 5 quiet posts some love today. Tap the egg to hatch it.";
    $("hatch-name").textContent = ""; $("hatch-name").hidden = true;
    $("hatch-actions").hidden = true; pic.hidden = true; egg.hidden = false; egg.disabled = false;
    setStage("egg", shown.rarity === "legend" ? "legend-egg" : shown.rarity === "rare" ? "rare-egg" : "");
    openSheet(hatchEl);
  }

  egg.addEventListener("click", async () => {
    if (!shown || egg.disabled) return;
    egg.disabled = true;
    const { item, rarity } = shown;
    const imgP = stickerUrl(item, 480);
    stage.dataset.state = "wobble"; await wait(1300);
    stage.dataset.state = "crack"; await wait(380);
    keep(item, rarity);
    try { localStorage.removeItem("pd:dexEgg"); } catch (e) {}
    pic.src = await imgP; pic.alt = `${RARITY[rarity]} ${item.name} dragon`;
    egg.hidden = true; pic.hidden = false;
    setStage("reveal", rarity);
    showName(item, rarity, true);
    refreshGoal();
    renderDex();
  });

  function showName(item, rarity, fresh) {
    const n = $("hatch-name");
    n.innerHTML = "";
    const tag = document.createElement("span"); tag.className = "hatch-tag " + rarity; tag.textContent = RARITY[rarity];
    const b = document.createElement("b"); b.textContent = `${item.name} dragon`;
    const p = document.createElement("small"); p.textContent = `${item.pose} · ${found()} of ${TOTAL} found`;
    n.append(tag, b, p); n.hidden = false;
    $("hatch-title").textContent = fresh ? (rarity === "legend" ? "A golden legend hatched!" : rarity === "rare" ? "A rare dragon hatched!" : "Your dragon hatched!") : "My dragon";
    $("hatch-sub").textContent = fresh ? "It is now on your shelf. Share it with the Keepers on X." : "Show it off on X.";
    $("hatch-post").href = `https://x.com/intent/post?text=${encodeURIComponent(postText(item, rarity))}`;
    $("hatch-actions").hidden = false;
    prepShare(item, rarity);
  }

  // look at one you already have
  async function viewOne(item, rarity) {
    shown = { item, rarity };
    egg.hidden = true; pic.hidden = true;
    setStage("reveal", rarity);
    openSheet(hatchEl);
    pic.src = await stickerUrl(item, 480); pic.alt = `${RARITY[rarity]} ${item.name} dragon`; pic.hidden = false;
    showName(item, rarity, false);
  }

  // ---------- sharing ----------
  const postText = (item, rarity) => {
    const a = rarity === "legend" ? "a golden legendary" : rarity === "rare" ? "a rare" : "a";
    return `I just hatched ${a} ${item.name} dragon on pdtools \u{1F409} ${found()} of ${TOTAL} found so far. Give 5 quiet Keeper posts some love each day and hatch yours at pdtools.xyz`;
  };
  async function card(item, rarity) {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 675;
    const x = c.getContext("2d");
    try { await document.fonts.load('700 60px "Fredoka"'); await document.fonts.load('800 20px "Nunito"'); } catch (e) {}
    const theme = rarity === "legend" ? ["#3a2406", "#120b02", "#ffd76a", "#fff4d0"]
      : rarity === "rare" ? ["#26306a", "#0f1430", "#9fd8ff", "#eef4ff"] : ["#fdf6e3", "#cfe9b8", "#2f6a3a", "#1b2130"];
    const g = x.createRadialGradient(330, 330, 40, 600, 340, 900); g.addColorStop(0, theme[0]); g.addColorStop(1, theme[1]);
    x.fillStyle = g; x.fillRect(0, 0, 1200, 675);
    if (rarity !== "common") {   // light rays behind the dragon
      x.save(); x.translate(330, 330); x.globalAlpha = rarity === "legend" ? 0.22 : 0.16; x.fillStyle = theme[2];
      for (let i = 0; i < 16; i++) { x.rotate(Math.PI / 8); x.beginPath(); x.moveTo(0, 0); x.lineTo(-40, -700); x.lineTo(40, -700); x.closePath(); x.fill(); }
      x.restore();
    }
    const s = await sticker(item, 480);
    if (s) {
      const h = 560, w = (s.width / s.height) * h;
      x.save(); x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 30; x.shadowOffsetY = 14;
      x.drawImage(s, 330 - w / 2, 337 - h / 2, w, h); x.restore();
    }
    const ink = theme[3], soft = rarity === "common" ? "#5b6476" : "rgba(255,255,255,.75)";
    x.textAlign = "left"; x.fillStyle = soft; x.font = '800 22px "Nunito", system-ui, sans-serif';
    x.fillText("I HATCHED A", 640, 230);
    x.fillStyle = rarity === "common" ? "#2f6a3a" : theme[2]; x.font = '800 26px "Nunito", system-ui, sans-serif';
    x.fillText(RARITY[rarity].toUpperCase(), 640, 280);
    x.fillStyle = ink; x.font = '700 72px "Fredoka", system-ui, sans-serif';
    x.fillText(item.name, 640, 358); x.fillText("dragon", 640, 434);
    x.fillStyle = soft; x.font = '800 24px "Nunito", system-ui, sans-serif';
    x.fillText(`${found()} of ${TOTAL} found so far`, 640, 492);
    x.textAlign = "right"; x.font = '800 22px "Nunito", system-ui, sans-serif'; x.fillStyle = ink;
    x.fillText("pdtools.xyz", 1168, 640);
    return c;
  }
  let shareFile = null;
  async function prepShare(item, rarity) {
    shareFile = null; $("hatch-share").hidden = true;
    const c = await card(item, rarity);
    const blob = await new Promise((r) => { try { c.toBlob(r, "image/png"); } catch (e) { r(null); } });
    if (!blob || !shown || shown.item !== item) return;
    shareFile = new File([blob], `pdtools-${item.id}-dragon.png`, { type: "image/png" });
    $("hatch-share").hidden = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
  }
  $("hatch-share").addEventListener("click", async () => {
    if (!shareFile || !shown) return;
    try { await navigator.share({ files: [shareFile], text: postText(shown.item, shown.rarity) }); } catch (e) {}
  });
  $("hatch-save").addEventListener("click", async () => {
    if (!shown) return;
    const c = await card(shown.item, shown.rarity);
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `pdtools-${shown.item.id}-dragon.png`;
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }, "image/png");
  });
  $("hatch-shelf").addEventListener("click", () => { closeSheet(hatchEl); setTimeout(openDex, 260); });
  $("hatch-close").addEventListener("click", () => closeSheet(hatchEl));

  // ---------- the shelf ----------
  async function renderDex() {
    $("dex-sub").textContent = found() ? `${found()} of ${TOTAL} found. One egg hatches each day you finish the daily goal.`
      : "No dragons yet. Give 5 quiet posts some love today and your first egg hatches.";
    $("dex-bar").style.setProperty("--p", `${(found() / TOTAL) * 100}%`);
    $("dex-hatch").hidden = !canHatch();
    for (const [grid, list] of [[$("dex-grid"), D.dragons], [$("dex-legends"), D.legends]]) {
      grid.innerHTML = "";
      for (const d of list) {
        const item = byId[d.id], h = dex.have[d.id] || {}, have = owned(d.id);
        const best = h.l ? "legend" : h.r ? "rare" : "common";
        const fig = document.createElement(have ? "button" : "div");
        fig.className = `dex-card ${have ? "have " + best : "missing"}${item.kind === "legend" ? " gold" : ""}`;
        if (have) { fig.type = "button"; fig.addEventListener("click", () => { closeSheet(dexEl); setTimeout(() => viewOne(item, best), 260); }); }
        const im = document.createElement("img"); im.alt = have ? `${item.name} dragon` : ""; im.loading = "lazy"; im.decoding = "async";
        const cap = document.createElement("span"); cap.className = "dex-cap";
        const b = document.createElement("b"); b.textContent = have || item.kind === "egg" ? item.name : "???";
        const sm = document.createElement("small"); sm.textContent = have ? item.pose : "Not found yet";
        cap.append(b, sm);
        fig.append(im, cap);
        const count = (h.c || 0) + (h.r || 0) + (h.l || 0);
        if (count > 1) { const n = document.createElement("i"); n.className = "dex-count"; n.textContent = "x" + count; fig.append(n); }
        if (have && best !== "common") { const t = document.createElement("i"); t.className = "dex-badge " + best; t.textContent = RARITY[best]; fig.append(t); }
        grid.append(fig);
        stickerUrl(item, 220, !have).then((u) => { if (u) im.src = u; });
      }
    }
  }
  function openDex() { renderDex(); openSheet(dexEl); }
  $("dex-hatch").addEventListener("click", () => { closeSheet(dexEl); setTimeout(openHatch, 260); });
  $("dex-close").addEventListener("click", () => closeSheet(dexEl));
  document.querySelectorAll("[data-dex]").forEach((b) => b.addEventListener("click", openDex));

  // ---------- the daily goal pill becomes "hatch your egg" ----------
  const goalBtn = $("goal");
  function refreshGoal() {
    if (!goalBtn) return;
    const ready = canHatch();
    goalBtn.classList.toggle("hatch-ready", ready);
    if (ready) $("goal-text").textContent = "Hatch your egg";
    else if (goalDone()) $("goal-text").textContent = "Daily goal done";
  }
  if (goalBtn) goalBtn.addEventListener("click", (e) => { if (canHatch()) { e.stopImmediatePropagation(); openHatch(); } }, true);
  addEventListener("pd:goaldone", () => { refreshGoal(); setTimeout(() => { if (canHatch() && hatchEl.hidden) openHatch(); }, 1600); });
  addEventListener("pd:goalshow", refreshGoal);
  addEventListener("pd:dexchange", () => { dex = load(); renderDex(); refreshGoal(); });
  addEventListener("storage", (e) => { if (e.key === "pd:dex" || e.key === "pd:goal") { dex = load(); refreshGoal(); } });
  refreshGoal();

  window.pdDex = { canHatch, openHatch, openDex };
  if (location.hash === "#dragons") { history.replaceState(null, "", location.pathname + location.search); setTimeout(openDex, 600); }
})();
