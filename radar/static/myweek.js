/* My week: a personal card about the Keepers you supported in the last 7 days, to share on X.
   Everything is worked out in this browser from the posts you opened here; nothing new is stored on the server.
   The card is built from three layers: a scene (14 designs, day or night render, afternoon and sunset are
   graded from day), the visitor's own dragon (15 egg colors, each design has its own style of dragon),
   and the live numbers written onto the scene's plates. Choices are remembered on this device. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const cv = $("myweek-canvas"), wrap = $("myweek"), DATA = window.PD_CARDS;
  if (!cv || !wrap || !DATA) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const BASE = (cv.dataset.base || "").replace(/\/$/, "");
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  const TIMES = [["day", "Day"], ["afternoon", "Afternoon"], ["sunset", "Sunset"], ["night", "Night"]];
  const B = '"Nunito", system-ui, sans-serif';
  const short = (d) => d.toLocaleDateString("en", { month: "short", day: "numeric" }).toUpperCase();

  let choice = Object.assign({ design: 9, egg: "speed", time: "day" }, get("pd:card", {}) || {});
  if (!DATA.designs.some((d) => d.id === choice.design)) choice.design = 9;
  if (!DATA.eggs.some((e) => e.id === choice.egg)) choice.egg = "speed";
  if (!TIMES.some(([t]) => t === choice.time)) choice.time = "day";

  // ---------- images ----------
  const cache = {};
  const load = (src) => cache[src] || (cache[src] = new Promise((res) => {
    const im = new Image(); im.crossOrigin = "anonymous"; im.decoding = "async";
    im.onload = () => res(im); im.onerror = () => { delete cache[src]; res(null); }; im.src = src;
  }));
  const sceneUrl = (d, night) => `${BASE}/image/upload/c_fill,w_2400,h_1350/f_jpg/q_88/dragon-radar/cards/card-${d.id}-${night ? "night" : "day"}`;
  const thumbUrl = (d) => `${BASE}/image/upload/c_fill,w_320,h_180/f_auto/q_auto/dragon-radar/cards/card-${d.id}-day`;
  function dragonUrl(d, egg) {
    const key = `${d.fam}-${egg.sheet}`, b = DATA.boxes[key][egg.slot];
    return `${BASE}/image/upload/e_background_removal/c_crop,x_${b[0]},y_${b[1]},w_${b[2]},h_${b[3]}/c_scale,h_900/f_png/dragon-radar/cards/dragons-${key}`;
  }
  // keep only the dragon itself: drop slivers of a neighbour's wing that sneak in at the crop edges
  const cleaned = {};
  async function dragonImage(d, egg) {
    const url = dragonUrl(d, egg);
    if (cleaned[url]) return cleaned[url];
    const im = await load(url);
    if (!im) return null;
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const x = c.getContext("2d"); x.drawImage(im, 0, 0);
    try {
      const img = x.getImageData(0, 0, c.width, c.height), a = img.data, w = c.width, h = c.height;
      const lab = new Int32Array(w * h), sizes = [0], edge = [false];
      let n = 0;
      for (let i = 0; i < w * h; i++) {
        if (lab[i] || a[i * 4 + 3] < 40) continue;
        n++; let size = 0, touches = false; const st = [i]; lab[i] = n;
        while (st.length) {
          const p = st.pop(); size++; const px = p % w;
          if (px < 3 || px > w - 4) touches = true;
          for (const q of [p - 1, p + 1, p - w, p + w]) {
            if (q < 0 || q >= w * h || lab[q] || a[q * 4 + 3] < 40) continue;
            if ((q === p - 1 && px === 0) || (q === p + 1 && px === w - 1)) continue;
            lab[q] = n; st.push(q);
          }
        }
        sizes.push(size); edge.push(touches);
      }
      const big = Math.max(...sizes);
      for (let i = 0; i < w * h; i++) {
        const l = lab[i];
        if (l && (edge[l] && sizes[l] < big * 0.25 || sizes[l] < big * 0.002)) a[i * 4 + 3] = 0;
      }
      x.putImageData(img, 0, 0);
    } catch (e) { /* tainted canvas: use as is */ }
    cleaned[url] = c;
    return c;
  }

  // ---------- light ----------
  function grade(mode) {
    if (mode === "afternoon") {
      ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = "rgba(255,180,90,.7)"; ctx.fillRect(0, 0, 1200, 675);
      ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgba(255,226,180,.35)"; ctx.fillRect(0, 0, 1200, 675);
      ctx.globalCompositeOperation = "screen";
      const g = ctx.createRadialGradient(1120, 40, 10, 1120, 40, 760); g.addColorStop(0, "rgba(255,214,140,.55)"); g.addColorStop(1, "rgba(255,214,140,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 675);
    } else if (mode === "sunset") {
      ctx.globalCompositeOperation = "multiply";
      const g = ctx.createLinearGradient(0, 0, 0, 675);
      g.addColorStop(0, "rgb(255,128,96)"); g.addColorStop(0.45, "rgb(255,160,110)"); g.addColorStop(1, "rgb(130,80,120)");
      ctx.globalAlpha = 0.62; ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 675); ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "screen";
      const r = ctx.createRadialGradient(140, 150, 10, 140, 150, 820); r.addColorStop(0, "rgba(255,170,70,.6)"); r.addColorStop(1, "rgba(255,110,60,0)");
      ctx.fillStyle = r; ctx.fillRect(0, 0, 1200, 675);
      ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = "rgba(120,40,90,.35)"; ctx.fillRect(0, 0, 1200, 675);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  function placeDragon(d, img, mode) {
    if (!img) return;
    const h = d.spot.h, w = img.width * h / img.height, x = d.spot.x - w / 2, y = d.spot.y - h;
    const o = document.createElement("canvas"); o.width = Math.round(w * 2); o.height = Math.round(h * 2);
    const ox = o.getContext("2d"); ox.drawImage(img, 0, 0, o.width, o.height);
    const tint = { afternoon: "rgba(255,184,100,.18)", sunset: "rgba(255,110,70,.30)", night: "rgba(36,54,130,.44)" }[mode];
    if (tint) { ox.globalCompositeOperation = "source-atop"; ox.fillStyle = tint; ox.fillRect(0, 0, o.width, o.height); }
    if (mode === "night" || mode === "sunset") {   // a soft rim of light from the side, like the scene
      ox.globalCompositeOperation = "source-atop";
      const g = ox.createLinearGradient(o.width, 0, 0, 0);
      const c = mode === "night" ? "190,210,255" : "255,190,120";
      g.addColorStop(0, `rgba(${c},.38)`); g.addColorStop(0.4, `rgba(${c},0)`);
      ox.fillStyle = g; ox.fillRect(0, 0, o.width, o.height);
    }
    ctx.save(); ctx.filter = "blur(7px)"; ctx.fillStyle = mode === "night" ? "rgba(0,0,20,.35)" : "rgba(30,20,10,.28)";
    ctx.beginPath(); ctx.ellipse(d.spot.x, d.spot.y - 2, w * 0.36, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.drawImage(o, x, y, w, h);
  }

  // ---------- words ----------
  function fit(text, max) { if (ctx.measureText(text).width <= max) return text; let t = text; while (t.length && ctx.measureText(t + "...").width > max) t = t.slice(0, -1); return t.trimEnd() + "..."; }
  function write(text, x, y, color, light) {
    // light ink gets a dark shadow; dark ink gets a soft light catch, like engraving
    ctx.fillStyle = light ? "rgba(0,0,0,.55)" : "rgba(255,248,232,.8)"; ctx.fillText(text, x, y + (light ? 2 : 1.3));
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  const isLight = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150; };
  function words(d, s) {
    const DF = `"${d.font}", "Fredoka", "Trebuchet MS", sans-serif`, pixel = d.font === "Press Start 2P";
    const sz = (n) => pixel ? Math.round(n * 0.62) : n;
    const HF = `"Fredoka", "Trebuchet MS", sans-serif`;   // handles keep their real letters on every design
    const L = isLight(d.ink), LM = isLight(d.medalInk);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${sz(30)}px ${DF}`;
    write(fit("My week in the Hatchery", d.title.w), d.title.x, d.title.y + 4, d.ink, L);
    ctx.font = `800 13px ${B}`;
    write(`${short(s.from)} TO ${short(s.to)}`, d.title.x, d.title.y + 26, d.soft, L);
    [[s.keepers, "KEEPERS", "SUPPORTED"], [s.opened, "POSTS", "OPENED"], [s.streak, "DAY", "STREAK"]].forEach(([n, a, b], i) => {
      const [mx, my, r] = d.medals[i], num = String(n);
      const big = Math.min(r * 0.62, num.length > 3 ? 36 : 54);
      ctx.font = `700 ${sz(big)}px ${DF}`; write(num, mx, my + big * 0.18, d.medalInk, LM);
      ctx.font = `800 ${Math.max(10, Math.min(12.5, r * 0.15))}px ${B}`;
      write(a, mx, my + r * 0.42, d.medalInk, LM); write(b, mx, my + r * 0.42 + 14, d.medalInk, LM);
    });
    if (s.top.length) {
      ctx.font = `800 12.5px ${B}`; write("KEEPERS I CHEERED ON THIS WEEK", d.plate.x, d.plate.y - 10, d.soft, L);
      ctx.font = `700 22px ${HF}`; write(fit(s.top.map((u) => "@" + u).join("   "), d.plate.w - 40), d.plate.x, d.plate.y + 20, d.ink, L);
    } else {
      ctx.font = `700 22px ${HF}`; write("Every Keeper deserves some love", d.plate.x, d.plate.y + 2, d.ink, L);
      ctx.font = `800 12.5px ${B}`; write("COME SUPPORT THE COMMUNITY WITH ME", d.plate.x, d.plate.y + 24, d.soft, L);
    }
    ctx.font = `800 15px ${B}`; ctx.textAlign = "right";
    ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillText("pdtools.xyz", 1182, 662);
    ctx.fillStyle = "#fff8ea"; ctx.fillText("pdtools.xyz", 1181, 661);
    ctx.textAlign = "left";
  }

  // ---------- the card ----------
  let stats = null, drawing = 0;
  async function work() {
    const opened = get("radar:opened", {}) || {};
    const since = Date.now() - 7 * 864e5;
    const mine = Object.entries(opened).filter(([, ts]) => typeof ts === "number" && ts >= since).map(([id]) => id);
    const byId = {};
    try {
      const j = await (await fetch("/api/posts?range=7d&who=all&quotes=1")).json();
      for (const p of [...(j.posts || []), ...(j.pinned || [])]) byId[p.id] = p;
    } catch (e) { /* offline: numbers from this browser only */ }
    const fans = {};
    for (const id of mine) { const p = byId[id]; if (p && !p.team && p.user) fans[p.user] = (fans[p.user] || 0) + 1; }
    // the same streak the header shows (with the streak freeze), counted in calendar days
    let live = 0;
    if (window.pdFeed && window.pdFeed.streak) live = window.pdFeed.streak() | 0;
    else {
      const st = get("pd:streak", {}) || {};
      const day = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
      const n = new Date(), t = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 864e5;
      live = typeof st.last === "string" && t - day(st.last) <= 1 ? st.count | 0 : 0;
    }
    const top = Object.entries(fans).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u]) => u);
    return { keepers: Object.keys(fans).length, opened: mine.length, streak: live, top, from: new Date(Date.now() - 6 * 864e5), to: new Date() };
  }

  async function draw() {
    const ticket = ++drawing;
    const d = DATA.designs.find((x) => x.id === choice.design), egg = DATA.eggs.find((e) => e.id === choice.egg);
    cv.classList.add("busy");
    const fontLoads = [document.fonts.load(`700 30px "${d.font}"`), document.fonts.load('800 13px "Nunito"'), document.fonts.load('700 22px "Fredoka"')].map((p) => p.catch(() => {}));
    const [scene, dragon] = await Promise.all([load(sceneUrl(d, choice.time === "night")), dragonImage(d, egg), ...fontLoads]);
    if (ticket !== drawing) return;   // a newer choice came in while this one was loading
    ctx.setTransform(W / 1200, 0, 0, H / 675, 0, 0);
    if (scene) ctx.drawImage(scene, 0, 0, 1200, 675);
    else { ctx.fillStyle = "#1d3a24"; ctx.fillRect(0, 0, 1200, 675); }
    grade(choice.time);
    placeDragon(d, dragon, choice.time);
    words(d, stats);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    cv.classList.remove("busy");
    refreshShare();
  }

  // ---------- pickers ----------
  function pickers() {
    const ds = $("mw-designs"), es = $("mw-eggs"), ts = $("mw-times");
    if (!ds || ds.childElementCount) return;
    for (const kind of ["2D", "3D"]) {
      for (const d of DATA.designs.filter((x) => x.kind === kind)) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "mw-design"; b.dataset.id = d.id; b.setAttribute("aria-label", `${d.name} (${kind})`);
        b.innerHTML = `<img src="${thumbUrl(d)}" alt="" loading="lazy" width="160" height="90"><span>${d.name}</span><i>${kind}</i>`;
        b.onclick = () => set({ design: d.id });
        ds.append(b);
      }
    }
    for (const e of DATA.eggs) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "mw-egg"; b.dataset.id = e.id; b.title = e.name; b.setAttribute("aria-label", `${e.name} egg`);
      b.innerHTML = `<i style="--body:${e.body};--spot:${e.spot}"></i><span>${e.name}</span>`;
      b.onclick = () => set({ egg: e.id });
      es.append(b);
    }
    for (const [t, name] of TIMES) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tab mw-time"; b.dataset.id = t; b.textContent = name;
      b.onclick = () => set({ time: t });
      ts.append(b);
    }
  }
  function mark() {
    document.querySelectorAll(".mw-design").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.id === choice.design)));
    document.querySelectorAll(".mw-egg").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === choice.egg)));
    document.querySelectorAll(".mw-time").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === choice.time)));
  }
  function set(part) { Object.assign(choice, part); put("pd:card", choice); mark(); draw(); }

  // ---------- sharing ----------
  const postText = () => {
    const s = stats;
    const streak = s.streak > 1 ? ` with a ${s.streak} day streak` : "";
    return s.keepers
      ? `My week in the Pocket Dragons Hatchery \u{1F409} I supported ${s.keepers} Keeper${s.keepers === 1 ? "" : "s"} and opened ${s.opened} post${s.opened === 1 ? "" : "s"}${streak}. Come support the community with me at pdtools.xyz`
      : "Joining the Pocket Dragons Hatchery \u{1F409} come support the Keepers with me at pdtools.xyz";
  };
  const msg = (t) => { $("myweek-msg").textContent = t; };
  const blob = () => new Promise((res) => { try { cv.toBlob(res, "image/png"); } catch (e) { res(null); } });
  let shareTimer = 0;
  const track = (kind, ref) => { try { window.pdTrack && window.pdTrack(kind, ref); } catch (e) {} };
  function refreshShare() {
    clearTimeout(shareTimer);
    shareTimer = setTimeout(async () => {
      const b = await blob();
      const file = b && new File([b], "my-week-pdtools.png", { type: "image/png" });
      $("myweek-share").hidden = !(file && navigator.canShare && navigator.canShare({ files: [file] }));
      $("myweek-share").onclick = async () => { try { await navigator.share({ files: [file], text: postText() }); track("share", "myweek"); } catch (e) { /* cancelled */ } };
    }, 300);
  }

  async function open() {
    wrap.hidden = false; (void wrap.offsetWidth, wrap.classList.add("open")); document.body.classList.add("sheet-open");
    pickers(); mark();
    msg("Drawing your card...");
    stats = await work();
    await draw();
    msg(stats.opened ? "" : "Open a few posts this week and your card fills up.");
    $("myweek-post").href = `https://x.com/intent/post?text=${encodeURIComponent(postText())}`;
  }
  function close() { wrap.classList.remove("open"); (document.querySelector(".sheet-wrap.open") || document.body.classList.remove("sheet-open")); setTimeout(() => { if (!wrap.classList.contains("open")) wrap.hidden = true; }, 250); }
  document.querySelectorAll("[data-myweek]").forEach((b) => b.addEventListener("click", open));
  $("myweek-close").addEventListener("click", close);
  $("myweek-post").addEventListener("click", () => track("share", "myweek"));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  $("myweek-save").addEventListener("click", async () => {
    const b = await blob();
    if (!b) { msg("Long press the card to save it."); return; }
    track("save", "myweek");
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "my-week-pdtools.png";
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    msg("Saved. Attach it to your post on X.");
  });
  if (location.hash === "#myweek") { history.replaceState(null, "", location.pathname + location.search); setTimeout(open, 600); }
})();
