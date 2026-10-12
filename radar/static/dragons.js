/* Collectible dragons (v2). Finishing the daily goal (20 posts from fellow Keepers) hatches one egg a day.
   35 to collect on a fixed pace (about half in 30 goal days, all in 90); rares need a goal streak of 3, legends 7. Everything is kept in this browser
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
  const GOAL = (() => { try { return JSON.parse($("radar-data").textContent).goal || 20; } catch (e) { return 20; } })();
  const TIERS = ["common", "rare", "legend"], TK = { common: "c", rare: "r", legend: "l" };
  const RARITY = { common: "Common", rare: "Rare holo", legend: "Golden legend" };

  // every collectible: 15 commons, 15 rare holo versions of the same species, 5 golden legends = 35
  const ENTRIES = [
    ...D.dragons.map((d) => ({ key: d.id + "-c", sp: d, tier: "common", pose: d.pose.c })),
    ...D.dragons.map((d) => ({ key: d.id + "-r", sp: d, tier: "rare", pose: d.pose.r })),
    ...D.legends.map((d) => ({ key: d.id + "-l", sp: d, tier: "legend", pose: d.pose })),
  ];
  const byKey = Object.fromEntries(ENTRIES.map((e) => [e.key, e]));
  const TOTAL = ENTRIES.length;

  // The pace: one egg a day, and a fixed number of completed goal days brings each new dragon.
  // A Keeper who finishes the goal every day has about half the shelf after 30 days and all of it after 90.
  // Rares wait for a 3 day goal streak and legends for a 7 day one, so steady Keepers pull ahead.
  const SCHEDULE = {
    common: [1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 24, 27, 33],
    rare: [10, 20, 29, 36, 40, 44, 48, 52, 56, 64, 68, 72, 76, 80, 85],
    legend: [30, 45, 60, 75, 90],
  };
  const NEED = { common: 0, rare: 3, legend: 7 };

  // ---------- the collection ----------
  function load() {
    const d = store.get("pd:dex", null);
    const ok = d && typeof d === "object" && d.have && typeof d.have === "object";
    const out = ok ? { have: d.have, last: d.last || null, log: Array.isArray(d.log) ? d.log : [], n: d.n | 0, g: d.g || null }
      : { have: {}, last: null, log: [], n: 0, g: null };
    if (!out.n) out.n = new Set(out.log.map((l) => l.day)).size;   // older saves: count the days already hatched
    return out;
  }
  let dex = load();
  const save = () => store.set("pd:dex", dex);
  const owned = (e) => ((dex.have[e.sp.id] || {})[TK[e.tier]] || 0) > 0;
  const found = () => ENTRIES.filter(owned).length;
  const foundIn = (tier) => ENTRIES.filter((e) => e.tier === tier && owned(e)).length;

  function goalDone() { const g = store.get("pd:goal", null); return !!g && g.day === today() && (g.n || 0) >= GOAL; }
  // the goal streak: days in a row with the daily goal finished
  function goalStreak() { const g = dex.g; return g && g.last && dayGap(g.last, today()) <= 1 ? g.count || 0 : 0; }
  function markGoalDay() {
    if (!goalDone()) return;
    const g = dex.g || { last: null, count: 0, best: 0 };
    if (g.last === today()) return;
    g.count = g.last && dayGap(g.last, today()) === 1 ? (g.count || 0) + 1 : 1;
    g.best = Math.max(g.best || 0, g.count); g.last = today();
    dex.g = g; save();
  }
  const canHatch = () => goalDone() && dex.last !== today();
  const due = (tier, n) => SCHEDULE[tier].filter((d) => d <= n).length - foundIn(tier);
  const rand = (list) => list[Math.floor(Math.random() * list.length)];

  function roll() {
    const n = dex.n + 1, gs = goalStreak();
    for (const tier of ["legend", "rare", "common"]) {
      if (due(tier, n) > 0 && gs >= NEED[tier]) {
        const missing = ENTRIES.filter((e) => e.tier === tier && !owned(e));
        if (missing.length) return { entry: rand(missing), fresh: true };
      }
    }
    // no new one today: a copy of one you have (rares only while your streak holds)
    const mine = ENTRIES.filter((e) => owned(e) && e.tier !== "legend" && (e.tier === "common" || gs >= NEED.rare));
    const commons = mine.filter((e) => e.tier === "common"), rares = mine.filter((e) => e.tier === "rare");
    const pool = rares.length && Math.random() < 0.2 ? rares : commons.length ? commons : ENTRIES.filter((e) => e.tier === "common");
    return { entry: rand(pool), fresh: false };
  }
  function keep(entry) {
    const h = dex.have[entry.sp.id] || {}, k = TK[entry.tier];
    h[k] = (h[k] || 0) + 1;
    dex.have[entry.sp.id] = h;
    dex.last = today(); dex.n = (dex.n || 0) + 1;
    dex.log.push({ k: entry.key, day: today() });
    dex.log = dex.log.slice(-120);
    save();
  }
  // what to look forward to, for the shelf
  function nextNews() {
    const n = dex.n, gs = goalStreak();
    const waiting = ["legend", "rare"].find((t) => due(t, n) > 0 && gs < NEED[t]);
    if (waiting) return `A ${waiting === "legend" ? "golden legend" : "rare holo dragon"} is waiting for you. It hatches once your goal streak reaches ${NEED[waiting]} days.`;
    if (TIERS.some((t) => due(t, n + 1) > 0 && gs + 1 >= NEED[t] && ENTRIES.some((e) => e.tier === t && !owned(e)))) return "Your next egg brings a new dragon.";
    const all = [...SCHEDULE.common, ...SCHEDULE.rare, ...SCHEDULE.legend].filter((d) => d > n).sort((a, b) => a - b);
    if (!all.length) return found() >= TOTAL ? "You found every dragon. A true Keeper legend." : "";
    const k = all[0] - n;
    return k <= 1 ? "Your next egg brings a new dragon." : "More dragons are on the way. Keep your streak going.";
  }

  // ---------- sticker images: cut out of the art sheet on this device ----------
  const imgCache = new Map();
  // each dragon is its own square render on flat grey; it is cut out here and trimmed to the sticker
  function rawUrl(entry, h) {
    return `${BASE}/image/upload/c_scale,w_${Math.round(h * 1.25)}/f_png/${D.art[entry.key] || "v1"}/dragon-radar/dex3/${entry.key}`;
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
    // a die-cut sticker is one piece: keep the biggest, drop any stray specks
    const lab = new Int32Array(N);
    let cur = 0, bestN = 0, best = 0;
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
      if (n > bestN) { bestN = n; best = cur; }
    }
    // the sticker sits in the middle of the render: prefer the piece that fills the centre most
    const inMid = new Map();
    for (let Y = Math.floor(H * 0.3); Y < H * 0.7; Y += 2) for (let X = Math.floor(W * 0.3); X < W * 0.7; X += 2) {
      const l = lab[Y * W + X]; if (l) inMid.set(l, (inMid.get(l) || 0) + 1);
    }
    let midN = 0;
    for (const [l, n] of inMid) if (n > midN) { midN = n; best = l; }
    for (let p = 0; p < N; p++) if (seen[p] || lab[p] !== best) d[p * 4 + 3] = 0;
    for (let p = 0; p < N; p++) {   // soften the edge by one pixel
      if (!d[p * 4 + 3]) continue;
      const X = p % W; let n = 0;
      if (X > 0 && !d[(p - 1) * 4 + 3]) n++; if (X < W - 1 && !d[(p + 1) * 4 + 3]) n++;
      if (p >= W && !d[(p - W) * 4 + 3]) n++; if (p < N - W && !d[(p + W) * 4 + 3]) n++;
      if (n) d[p * 4 + 3] = 255 - n * 45;
    }
    x.putImageData(g, 0, 0);
    // trim to the sticker
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let p = 0; p < N; p++) if (d[p * 4 + 3] > 40) { const X = p % W, Y = (p / W) | 0; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
    if (x1 <= x0 || y1 <= y0) return c;
    const t = document.createElement("canvas"); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
    t.getContext("2d").drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
    return t;
  }
  function sticker(entry, h = 360) {
    const key = entry.key + ":" + h;
    if (!imgCache.has(key)) imgCache.set(key, loadImg(rawUrl(entry, h)).then((im) => (im ? cutOut(im) : null)));
    return imgCache.get(key);
  }
  async function stickerUrl(entry, h, dark) {
    const c = await sticker(entry, h);
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
  let shown = null;   // { entry, fresh } on the hatch sheet right now
  const stage = $("hatch-stage"), egg = $("hatch-egg"), pic = $("hatch-dragon");
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
  function setStage(state, look) { stage.dataset.state = state; stage.dataset.rarity = look || ""; }
  function paintEgg(entry) {
    const [body, spot] = entry.tier === "legend" ? ["#f5c542", "#fff1b8"] : entry.sp.egg;
    egg.style.setProperty("--body", body); egg.style.setProperty("--spot", spot);
  }

  function openHatch() {
    if (!canHatch()) { openDex(); return; }
    markGoalDay();
    // decided now and saved straight away, so reloading cannot reroll it
    let pending = store.get("pd:dexEgg", null);
    if (!pending || pending.day !== today() || !byKey[pending.k]) {
      const r = roll();
      pending = { day: today(), k: r.entry.key, fresh: r.fresh };
      store.set("pd:dexEgg", pending);
    }
    shown = { entry: byKey[pending.k], fresh: !!pending.fresh };
    const t = shown.entry.tier;
    paintEgg(shown.entry);
    sticker(shown.entry, 520);   // start loading while they look at the egg
    $("hatch-title").textContent = t === "legend" ? "A golden egg!" : t === "rare" ? "A shimmering egg!" : "Your egg is ready";
    $("hatch-sub").textContent = t === "legend" ? "Something legendary is inside. Tap to hatch it."
      : `You cheered on ${GOAL} fellow Keepers today. Tap the egg to hatch it.`;
    $("hatch-name").textContent = ""; $("hatch-name").hidden = true;
    $("hatch-actions").hidden = true; pic.hidden = true; egg.hidden = false; egg.disabled = false;
    setStage("egg", t === "legend" ? "legend-egg" : t === "rare" ? "rare-egg" : "");
    openSheet(hatchEl);
  }

  egg.addEventListener("click", async () => {
    if (!shown || egg.disabled) return;
    egg.disabled = true;
    const { entry, fresh } = shown;
    const imgP = stickerUrl(entry, 520);
    stage.dataset.state = "wobble"; await wait(1300);
    stage.dataset.state = "crack"; await wait(380);
    keep(entry);
    try { localStorage.removeItem("pd:dexEgg"); } catch (e) {}
    pic.src = await imgP; pic.alt = `${RARITY[entry.tier]} ${entry.sp.name} dragon`;
    egg.hidden = true; pic.hidden = false;
    setStage("reveal", entry.tier);
    showName(entry, fresh ? "new" : "copy");
    refreshGoal();
    renderDex();
  });

  function showName(entry, mode) {
    const n = $("hatch-name"), have = (dex.have[entry.sp.id] || {})[TK[entry.tier]] || 1;
    n.innerHTML = "";
    const tag = document.createElement("span"); tag.className = "hatch-tag " + entry.tier; tag.textContent = RARITY[entry.tier];
    const b = document.createElement("b"); b.textContent = `${entry.sp.name} dragon`;
    const p = document.createElement("small");
    p.textContent = `${entry.pose} · ${found()} of ${TOTAL} found${mode === "copy" ? ` · you have ${have}` : ""}`;
    n.append(tag, b, p); n.hidden = false;
    const t = entry.tier;
    $("hatch-title").textContent = mode === "view" ? "My dragon"
      : mode === "copy" ? "Another one joins the family"
      : t === "legend" ? "A golden legend hatched!" : t === "rare" ? "A rare holo dragon hatched!" : "A new dragon hatched!";
    $("hatch-sub").textContent = mode === "view" ? "Show it off on X." : mode === "copy"
      ? `No new dragon today, but your ${entry.sp.name} has company. ${nextNews()}` : "It is now on your shelf. Show it off on X.";
    $("hatch-post").href = `https://x.com/intent/post?text=${encodeURIComponent(postText(entry, mode))}`;
    $("hatch-actions").hidden = false;
    prepShare(entry);
  }

  // look at one you already have
  async function viewOne(entry) {
    shown = { entry, fresh: false };
    egg.hidden = true; pic.hidden = true;
    setStage("reveal", entry.tier);
    openSheet(hatchEl);
    pic.src = await stickerUrl(entry, 520); pic.alt = `${RARITY[entry.tier]} ${entry.sp.name} dragon`; pic.hidden = false;
    showName(entry, "view");
  }

  // ---------- sharing ----------
  const postText = (entry, mode) => {
    const what = entry.tier === "legend" ? `a golden legendary ${entry.sp.name} dragon` : entry.tier === "rare" ? `a rare holo ${entry.sp.name} dragon` : `a ${entry.sp.name} dragon`;
    const gs = goalStreak(), streak = gs > 1 ? ` with a ${gs} day streak` : "";
    const lead = mode === "view" ? `Look at my ${what.replace(/^an? /, "")}` : `I just hatched ${what}`;
    return `${lead} on pdtools \u{1F409} ${found()} of ${TOTAL} found${streak}. Cheer on ${GOAL} fellow Keepers a day and hatch yours at pdtools.xyz`;
  };
  async function card(entry) {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 675;
    const x = c.getContext("2d"), t = entry.tier;
    try { await document.fonts.load('700 60px "Fredoka"'); await document.fonts.load('800 20px "Nunito"'); } catch (e) {}
    const theme = t === "legend" ? ["#4a300a", "#120b02", "#ffd76a", "#fff4d0"]
      : t === "rare" ? ["#2c3a86", "#0d1130", "#a8dcff", "#f1f6ff"] : ["#fff8e8", "#cde8b4", "#2f6a3a", "#1b2130"];
    const g = x.createRadialGradient(330, 330, 40, 600, 340, 900); g.addColorStop(0, theme[0]); g.addColorStop(1, theme[1]);
    x.fillStyle = g; x.fillRect(0, 0, 1200, 675);
    x.save(); x.translate(330, 337); x.globalAlpha = t === "legend" ? 0.24 : t === "rare" ? 0.18 : 0.35;
    x.fillStyle = t === "common" ? "#ffffff" : theme[2];
    for (let i = 0; i < 16; i++) { x.rotate(Math.PI / 8); x.beginPath(); x.moveTo(0, 0); x.lineTo(-46, -760); x.lineTo(46, -760); x.closePath(); x.fill(); }
    x.restore();
    if (t === "rare") {   // a holo shimmer band
      const h = x.createLinearGradient(0, 0, 1200, 675);
      ["#ff8ad8", "#8fd3ff", "#b77bff", "#6ee7d8", "#ffd76a"].forEach((col, i) => h.addColorStop(i / 4, col));
      x.save(); x.globalAlpha = 0.12; x.fillStyle = h; x.fillRect(0, 0, 1200, 675); x.restore();
    }
    const s = await sticker(entry, 520);
    if (s) {
      const k = Math.min(590 / s.height, 560 / s.width), w = s.width * k, hh = s.height * k;
      x.save(); x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 34; x.shadowOffsetY = 16;
      x.drawImage(s, 330 - w / 2, 337 - hh / 2, w, hh); x.restore();
    }
    const ink = theme[3], soft = t === "common" ? "#5b6476" : "rgba(255,255,255,.78)";
    x.textAlign = "left"; x.fillStyle = soft; x.font = '800 22px "Nunito", system-ui, sans-serif';
    x.fillText("I HATCHED A", 650, 214);
    x.fillStyle = t === "common" ? "#2f6a3a" : theme[2]; x.font = '800 26px "Nunito", system-ui, sans-serif';
    x.fillText(RARITY[t].toUpperCase(), 650, 262);
    x.fillStyle = ink; x.font = '700 76px "Fredoka", system-ui, sans-serif';
    x.fillText(entry.sp.name, 650, 344); x.fillText("dragon", 650, 422);
    x.fillStyle = soft; x.font = '800 24px "Nunito", system-ui, sans-serif';
    x.fillText(`${found()} of ${TOTAL} found`, 650, 482);
    const gs = goalStreak(); if (gs > 1) x.fillText(`\u{1F525} ${gs} day goal streak`, 650, 518);
    x.textAlign = "right"; x.font = '800 22px "Nunito", system-ui, sans-serif'; x.fillStyle = ink;
    x.fillText("pdtools.xyz", 1168, 640);
    return c;
  }
  let shareFile = null, cardBlob = null;
  async function prepShare(entry) {
    shareFile = null; cardBlob = null; $("hatch-share").hidden = true;
    const c = await card(entry);
    const blob = await new Promise((r) => { try { c.toBlob(r, "image/png"); } catch (e) { r(null); } });
    if (!blob || !shown || shown.entry !== entry) return;
    cardBlob = blob;
    shareFile = new File([blob], `pdtools-${entry.key}-dragon.png`, { type: "image/png" });
    $("hatch-share").hidden = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
  }
  $("hatch-share").addEventListener("click", async () => {
    if (!shareFile || !shown) return;
    try { await navigator.share({ files: [shareFile], text: postText(shown.entry, "view") }); } catch (e) {}
  });
  $("hatch-save").addEventListener("click", async () => {
    if (!shown) return;
    const entry = shown.entry, btn = $("hatch-save"), label = btn.textContent;
    let b = cardBlob;
    if (!b) {
      btn.textContent = "Making your picture..."; btn.disabled = true;
      const c = await card(entry);
      b = await new Promise((r) => { try { c.toBlob(r, "image/png"); } catch (e) { r(null); } });
      btn.textContent = label; btn.disabled = false;
    }
    if (!b) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `pdtools-${entry.key}-dragon.png`;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $("hatch-shelf").addEventListener("click", () => { closeSheet(hatchEl); setTimeout(openDex, 260); });
  $("hatch-close").addEventListener("click", () => closeSheet(hatchEl));

  // ---------- the shelf ----------
  function renderDex() {
    const f = found(), gs = goalStreak();
    $("dex-sub").textContent = f ? `${f} of ${TOTAL} found${gs ? ` · \u{1F525} ${gs} day goal streak` : ""}`
      : `No dragons yet. Cheer on ${GOAL} fellow Keepers today and your first egg hatches.`;
    $("dex-next").textContent = f ? nextNews() : "";
    $("dex-bar").style.setProperty("--p", `${(f / TOTAL) * 100}%`);
    $("dex-hatch").hidden = !canHatch();
    const grids = { common: $("dex-grid"), rare: $("dex-rares"), legend: $("dex-legends") };
    for (const tier of TIERS) {
      const grid = grids[tier]; grid.innerHTML = "";
      $(`dex-count-${tier}`).textContent = `${foundIn(tier)} of ${ENTRIES.filter((e) => e.tier === tier).length}`;
      for (const entry of ENTRIES.filter((e) => e.tier === tier)) {
        const have = owned(entry), count = (dex.have[entry.sp.id] || {})[TK[tier]] || 0;
        const fig = document.createElement(have ? "button" : "div");
        fig.className = `dex-card ${tier} ${have ? "have" : "missing"}`;
        if (have) { fig.type = "button"; fig.addEventListener("click", () => { closeSheet(dexEl); setTimeout(() => viewOne(entry), 260); }); }
        const im = document.createElement("img"); im.alt = have ? `${entry.sp.name} dragon` : ""; im.decoding = "async";
        const cap = document.createElement("span"); cap.className = "dex-cap";
        const b = document.createElement("b"); b.textContent = have || tier !== "legend" ? entry.sp.name : "???";
        const sm = document.createElement("small"); sm.textContent = have ? entry.pose : "Not found yet";
        cap.append(b, sm); fig.append(im, cap);
        if (count > 1) { const n = document.createElement("i"); n.className = "dex-count"; n.textContent = "x" + count; fig.append(n); }
        grid.append(fig);
        stickerUrl(entry, 220, !have).then((u) => { if (u) im.src = u; });
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
    markGoalDay();
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
