/* v2: This week's top posts, in 7 hand made 2D styles. The art is a painting of Blinky with open space
   on the right; the board is drawn here, large and crisp, in each style's own colours and fonts. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const cv = $("weekly-canvas"), wrap = $("weekly"), picker = $("wk-designs");
  if (!cv || !wrap || !picker) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const BASE = cv.dataset.base || "https://res.cloudinary.com/gosbi0oh";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const F = { round: '"Fredoka", "Trebuchet MS", sans-serif', body: '"Nunito", system-ui, sans-serif', serif: '"Cinzel", Georgia, serif' };

  // panel: fill, line (border), ink, soft, accent, row (row tint), medals [gold, silver, bronze, other], title font, border style
  const DESIGNS = [
    { id: 1, name: "Golden meadow", art: "v1791811256", panel: "rgba(255,250,236,.9)", line: "rgba(160,110,40,.35)", ink: "#3a2a14", soft: "#7a5a32",
      accent: "#c2410c", row: "rgba(214,170,90,.13)", title: F.round, frame: "soft" },
    { id: 2, name: "Ink and gold", art: "v1791811259", panel: "rgba(251,248,240,.86)", line: "rgba(176,136,42,.7)", ink: "#1e1d1b", soft: "#6a6458",
      accent: "#a8761e", row: "rgba(30,30,30,.05)", title: F.serif, frame: "hair" },
    { id: 3, name: "Art nouveau", art: "v1791811261", panel: "rgba(250,244,226,.94)", line: "#a8843c", ink: "#3b3226", soft: "#7c6a4c",
      accent: "#8a5a2b", row: "rgba(132,150,110,.14)", title: F.serif, frame: "double" },
    { id: 4, name: "Paper cut", art: "v1791811263", panel: "#fffdf8", line: "rgba(0,0,0,0)", ink: "#23404a", soft: "#5d7a82",
      accent: "#e2674f", row: "rgba(80,170,160,.12)", title: F.round, frame: "paper" },
    { id: 5, name: "Riso print", art: "v1791811267", panel: "#fbf6ea", line: "#1f2a5a", ink: "#1f2a5a", soft: "#4a5690",
      accent: "#ff4f8b", row: "rgba(42,184,170,.14)", title: F.round, frame: "riso" },
    { id: 6, name: "Celestial", art: "v1791811269", panel: "rgba(9,14,38,.78)", line: "#d9b562", ink: "#f6e9c6", soft: "#c9b68a",
      accent: "#e8c36a", row: "rgba(232,195,106,.08)", title: F.serif, frame: "double" },
    { id: 7, name: "Illuminated", art: "v1791811273", panel: "rgba(248,240,220,.93)", line: "#b48a2c", ink: "#3a1f12", soft: "#7a5236",
      accent: "#b3261e", row: "rgba(36,72,150,.07)", title: F.serif, frame: "double" },
  ];
  (window.PD_WEEKLY_ART || []).forEach((v, i) => { if (DESIGNS[i]) DESIGNS[i].art = v; });
  const MEDALS = [["#f7d774", "#c99a1e"], ["#eef1f5", "#a7b0bd"], ["#f0b07a", "#b0632a"], ["#cfe7d6", "#6fa385"]];

  let choice = store.get("pd:weeklyDesign", 1);
  if (!DESIGNS.some((d) => d.id === choice)) choice = 1;
  let top = [], ticket = 0;

  const artUrl = (d, w, h) => `${BASE}/image/upload/c_fill,w_${w},h_${h}/f_jpg/q_88/${d.art}/dragon-radar/weekly2/design-${d.id}`;
  const load = (src) => new Promise((res) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const decoder = document.createElement("textarea");
  const clean = (t) => { decoder.innerHTML = t || ""; return decoder.value.replace(/https:\/\/t\.co\/\S+/g, "").replace(/\s+/g, " ").trim(); };
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function fit(text, max) { if (ctx.measureText(text).width <= max) return text; let t = text; while (t.length && ctx.measureText(t + "...").width > max) t = t.slice(0, -1); return t.trimEnd() + "..."; }

  // the board
  const P = { x: 470, y: 34, w: 696, h: 607, r: 26 };
  function panel(d) {
    ctx.save();
    if (d.frame === "paper") { ctx.shadowColor = "rgba(20,50,60,.35)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 12; }
    if (d.frame === "riso") { rr(P.x + 10, P.y + 10, P.w, P.h, P.r); ctx.fillStyle = d.accent; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; }
    if (d.frame === "soft") { ctx.shadowColor = "rgba(60,40,10,.3)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; }
    rr(P.x, P.y, P.w, P.h, P.r); ctx.fillStyle = d.panel; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = d.line;
    if (d.frame === "double") {
      ctx.lineWidth = 2.2; rr(P.x + 8, P.y + 8, P.w - 16, P.h - 16, P.r - 6); ctx.stroke();
      ctx.lineWidth = 1; rr(P.x + 14, P.y + 14, P.w - 28, P.h - 28, P.r - 10); ctx.stroke();
    } else if (d.frame === "hair" || d.frame === "soft") {
      ctx.lineWidth = 1.4; rr(P.x + 10, P.y + 10, P.w - 20, P.h - 20, P.r - 8); ctx.stroke();
    } else if (d.frame === "riso") {
      ctx.lineWidth = 3; rr(P.x, P.y, P.w, P.h, P.r); ctx.stroke();
    }
    ctx.restore();
  }

  async function draw() {
    const my = ++ticket;
    const d = DESIGNS.find((x) => x.id === choice) || DESIGNS[0];
    cv.classList.add("busy");
    const fonts = ['700 40px "Fredoka"', '800 20px "Nunito"', '700 40px "Cinzel"'].map((f) => document.fonts.load(f).catch(() => {}));
    const [bg] = await Promise.all([load(artUrl(d, 2400, 1350)), ...fonts]);
    if (my !== ticket) return;
    ctx.setTransform(W / 1200, 0, 0, H / 675, 0, 0);
    ctx.clearRect(0, 0, 1200, 675);
    if (bg) ctx.drawImage(bg, 0, 0, 1200, 675);
    else { const g = ctx.createLinearGradient(0, 0, 1200, 675); g.addColorStop(0, "#fdf3dc"); g.addColorStop(1, "#e7d3a8"); ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 675); }
    panel(d);

    // title
    const cx = P.x + P.w / 2;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = d.ink;
    ctx.font = `700 ${d.title === F.serif ? 34 : 38}px ${d.title}`;
    ctx.fillText(fit("This week in the Hatchery", P.w - 80), cx, P.y + 66);
    ctx.fillStyle = d.soft; ctx.font = `800 14px ${F.body}`;
    ctx.fillText("THE COMMUNITY POSTS KEEPERS OPENED MOST", cx, P.y + 92);
    ctx.fillStyle = d.accent; ctx.fillRect(cx - 40, P.y + 104, 80, 3);

    // rows
    const rowX = P.x + 28, rowW = P.w - 56, rowH = 88, gap = 8, top0 = P.y + 122;
    if (!top.length) {
      ctx.fillStyle = d.ink; ctx.font = `700 24px ${F.round}`;
      ctx.fillText("Quiet week so far. Go show some love!", cx, top0 + 120);
    }
    ctx.textAlign = "left";
    top.forEach((p, i) => {
      const y = top0 + i * (rowH + gap);
      rr(rowX, y, rowW, rowH, 16); ctx.fillStyle = d.row; ctx.fill();
      // rank medal
      const mx = rowX + 42, my2 = y + rowH / 2, [m1, m2] = MEDALS[Math.min(i, 3)];
      const g = ctx.createRadialGradient(mx - 8, my2 - 10, 4, mx, my2, 28); g.addColorStop(0, m1); g.addColorStop(1, m2);
      ctx.beginPath(); ctx.arc(mx, my2, 26, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.stroke();
      ctx.textAlign = "center"; ctx.font = `700 26px ${F.round}`; ctx.fillStyle = "#2a1c08"; ctx.fillText(String(i + 1), mx, my2 + 9);
      ctx.textAlign = "left";
      // keepers count, right
      const label = `${p.opens} ${p.opens === 1 ? "Keeper" : "Keepers"}`;
      ctx.font = `800 15px ${F.body}`;
      const lw = ctx.measureText(label).width, pillX = rowX + rowW - lw - 34;
      rr(pillX, y + 14, lw + 22, 28, 14); ctx.fillStyle = d.accent; ctx.fill();
      ctx.fillStyle = d.id === 6 ? "#1a1407" : "#fff"; ctx.fillText(label, pillX + 11, y + 33);
      // who
      const left = rowX + 84;
      ctx.fillStyle = d.ink; ctx.font = `700 25px ${F.round}`;
      const name = fit(p.name || p.user, Math.min(300, pillX - left - 120));
      ctx.fillText(name, left, y + 37);
      const nw = ctx.measureText(name).width;
      ctx.fillStyle = d.soft; ctx.font = `700 16px ${F.body}`;
      ctx.fillText(fit("@" + p.user, Math.max(40, pillX - left - nw - 22)), left + nw + 10, y + 36);
      // what
      ctx.fillStyle = d.ink; ctx.globalAlpha = 0.86; ctx.font = `600 17px ${F.body}`;
      ctx.fillText(fit(clean(p.text) || "A post with pictures", rowX + rowW - left - 20), left, y + 68);
      ctx.globalAlpha = 1;
    });
    // address
    ctx.textAlign = "right"; ctx.font = `800 15px ${F.body}`; ctx.fillStyle = d.soft;
    ctx.fillText("pdtools.xyz", P.x + P.w - 30, P.y + P.h - 16);
    ctx.textAlign = "left";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    cv.classList.remove("busy");
  }

  function pickers() {
    if (picker.childElementCount) return;
    for (const d of DESIGNS) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "mw-design"; b.dataset.id = d.id; b.setAttribute("aria-label", d.name);
      b.innerHTML = `<img src="${artUrl(d, 320, 180)}" alt="" loading="lazy" width="160" height="90"><span>${d.name}</span>`;
      b.onclick = () => { choice = d.id; store.set("pd:weeklyDesign", choice); mark(); draw(); };
      picker.append(b);
    }
    mark();
  }
  function mark() { picker.querySelectorAll(".mw-design").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.id === choice))); }

  async function open() {
    wrap.hidden = false; requestAnimationFrame(() => wrap.classList.add("open")); document.body.classList.add("sheet-open");
    pickers();
    $("weekly-msg").textContent = "Drawing the card...";
    try {
      const r = await fetch("/api/posts?range=7d&who=community&quotes=1");
      const j = await r.json();
      top = (j.posts || []).filter((p) => p.opens > 0).sort((a, b) => b.opens - a.opens || (a.t < b.t ? 1 : -1)).slice(0, 5);
    } catch (e) { top = []; }
    await draw();
    $("weekly-msg").textContent = "";
    const text = "This week in the Pocket Dragons Hatchery \u{1F409} the community posts Keepers loved most. See them all at pdtools.xyz";
    $("weekly-post").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  }
  function close() { wrap.classList.remove("open"); document.body.classList.remove("sheet-open"); setTimeout(() => { if (!wrap.classList.contains("open")) wrap.hidden = true; }, 250); }
  $("weekly-open").addEventListener("click", open);
  $("weekly-close").addEventListener("click", close);
  const track = (kind) => { try { window.pdTrack && window.pdTrack(kind, "weekly"); } catch (e) {} };
  $("weekly-post").addEventListener("click", () => track("share"));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  $("weekly-save").addEventListener("click", () => {
    cv.toBlob((blob) => {
      if (!blob) { $("weekly-msg").textContent = "Long press the card to save it."; return; }
      track("save");
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "pdtools-week.png";
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      $("weekly-msg").textContent = "Saved. Attach it to your post on X.";
    }, "image/png");
  });
  window.__weekly2 = { draw, set(id) { choice = id; mark(); return draw(); }, setTop(t) { top = t; } };
})();
