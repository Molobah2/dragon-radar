/* The music picker (loaded only when someone opens it): every community song in one list, with a chip for each
   maker. Tapping a song plays it; when it ends the next one in the list plays. Tapping a maker shows only their
   songs, and picking one of those keeps the music on that maker's songs. The playing itself lives in sound.js. */
(() => {
  "use strict";
  const S = () => window.pdSound;
  if (!S()) return;
  const fmt = (secs) => { const n = Math.round(secs || 0); return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}` : ""; };
  let panel = null, view = null;          // view: the maker shown in the list, or null for all songs
  function css() {
    if (document.getElementById("mp-css")) return;
    const st = document.createElement("style"); st.id = "mp-css";
    st.textContent = `
.mp-wrap{position:fixed;inset:0;z-index:140;display:grid;place-items:center;padding:16px;background:rgba(8,10,28,0);transition:background .25s}
.mp-wrap.open{background:rgba(8,10,28,.5)}
.mp{width:min(460px,100%);max-height:min(640px,calc(100dvh - 32px));display:flex;flex-direction:column;border-radius:26px;color:#f4f6ff;
 background:linear-gradient(160deg,#2a2160,#141235 60%,#0c0b24);box-shadow:0 30px 70px -20px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.12);
 transform:translateY(16px) scale(.98);opacity:0;transition:transform .28s cubic-bezier(.2,.9,.3,1.1),opacity .2s;font-family:inherit}
.mp-wrap.open .mp{transform:none;opacity:1}
.mp-head{display:flex;align-items:center;gap:10px;padding:18px 18px 8px}
.mp-head h3{margin:0;flex:1;font:700 21px/1.15 var(--font-display,var(--display,inherit))}
.mp-x{width:38px;height:38px;border-radius:50%;border:0;cursor:pointer;background:rgba(255,255,255,.12);color:#fff;font:700 20px/1 inherit}
.mp-now{margin:4px 18px 10px;padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.08);display:grid;grid-template-columns:1fr auto;gap:2px 12px;align-items:center}
.mp-now small{grid-column:1/-1;font:800 11px/1 inherit;letter-spacing:.08em;text-transform:uppercase;color:#ffd76a}
.mp-now b{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mp-now span{color:rgba(244,246,255,.7);font-weight:700;font-size:13px}
.mp-next{grid-row:2/4;grid-column:2;border:0;cursor:pointer;padding:9px 14px;border-radius:999px;font:800 13px/1 inherit;color:#2a1a00;background:linear-gradient(180deg,#ffe08a,#ffb347)}
.mp-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 18px 10px;scrollbar-width:none}.mp-chips::-webkit-scrollbar{display:none}
.mp-chip{flex:none;border:0;cursor:pointer;padding:8px 13px;border-radius:999px;font:800 13px/1 inherit;color:#f4f6ff;background:rgba(255,255,255,.1)}
.mp-chip.on{background:#f4f6ff;color:#1b1840}
.mp-list{list-style:none;margin:0;padding:0 10px 8px;overflow-y:auto;overscroll-behavior:contain}
.mp-row{width:100%;display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:center;text-align:left;border:0;cursor:pointer;padding:10px 10px;border-radius:16px;background:none;color:inherit;font:inherit}
.mp-row:hover{background:rgba(255,255,255,.06)}.mp-row.now{background:rgba(255,215,106,.14)}
.mp-ico{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.1);font-size:15px}
.mp-row.now .mp-ico{background:#ffd76a;color:#2a1a00}
.mp-title{display:block;font-weight:800;font-size:15px;line-height:1.2}.mp-by{display:block;color:rgba(244,246,255,.65);font-weight:700;font-size:12.5px;margin-top:2px}
.mp-len{color:rgba(244,246,255,.55);font-weight:700;font-size:12.5px}
.mp-bars{display:inline-flex;gap:2px;align-items:flex-end;height:14px}.mp-bars i{width:3px;height:6px;border-radius:2px;background:currentColor;animation:mpEq 1s ease-in-out infinite}
.mp-bars i:nth-child(2){animation-delay:-.3s}.mp-bars i:nth-child(3){animation-delay:-.6s}
@keyframes mpEq{0%,100%{height:4px}50%{height:14px}}
.mp-foot{margin:0;padding:8px 18px 18px;color:rgba(244,246,255,.6);font-weight:700;font-size:12.5px}
.mp-foot a{color:#ffd76a}
@media (max-width:640px){.mp-wrap{place-items:end stretch;padding:0}.mp{width:100%;border-radius:24px 24px 0 0;max-height:86dvh;padding-bottom:env(safe-area-inset-bottom,0px);transform:translateY(100%)}.mp-row{padding:12px 10px}}
@media (prefers-reduced-motion:reduce){.mp,.mp-wrap{transition:none}.mp-bars i{animation:none;height:10px}}`;
    document.head.append(st);
  }
  const makers = () => {
    const seen = new Map();
    S().songs().forEach((x) => { const k = (x.x || x.by || "").toLowerCase(); if (k && !seen.has(k)) seen.set(k, { key: k, name: x.by || x.x, x: x.x || "" }); });
    return [...seen.values()];
  };
  const keyOf = (x) => (x.x || x.by || "").toLowerCase();
  function build() {
    css();
    panel = document.createElement("div");
    panel.className = "mp-wrap"; panel.hidden = true;
    panel.innerHTML = `<div class="mp" role="dialog" aria-modal="true" aria-labelledby="mp-title">
      <div class="mp-head"><h3 id="mp-title">Music by the community</h3><button class="mp-x" type="button" aria-label="Close">&times;</button></div>
      <div class="mp-now" aria-live="polite"><small>Now playing</small><b class="mp-title" id="mp-now-title"></b><span class="mp-by" id="mp-now-by"></span>
        <button class="mp-next" type="button" id="mp-next">Next song</button></div>
      <div class="mp-chips" role="group" aria-label="Music makers"></div>
      <ul class="mp-list"></ul>
      <p class="mp-foot"></p></div>`;
    document.body.append(panel);
    panel.addEventListener("click", (e) => { if (e.target === panel) closePanel(); });
    panel.querySelector(".mp-x").addEventListener("click", closePanel);
    panel.querySelector("#mp-next").addEventListener("click", () => {
      S().skip();
    });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && panel && !panel.hidden) closePanel(); });
  }
  function paint() {
    if (!panel || panel.hidden) return;
    const SONGS = S().songs(), playing = S().playing(), only = S().only();
    const nowBox = panel.querySelector(".mp-now");
    nowBox.hidden = playing < 0;
    if (playing >= 0) {
      panel.querySelector("#mp-now-title").textContent = SONGS[playing].title;
      panel.querySelector("#mp-now-by").textContent = SONGS[playing].by || "";
      panel.querySelector("#mp-next").hidden = SONGS.length < 2;
    }
    const chips = panel.querySelector(".mp-chips");
    chips.innerHTML = "";
    const all = document.createElement("button"); all.type = "button"; all.className = "mp-chip" + (view ? "" : " on"); all.textContent = "All songs";
    all.addEventListener("click", () => { view = null; paint(); });
    chips.append(all);
    for (const m of makers()) {
      const c = document.createElement("button"); c.type = "button"; c.className = "mp-chip mp-by-chip" + (view === m.key ? " on" : ""); c.textContent = m.name;
      c.addEventListener("click", () => { view = m.key; paint(); });
      chips.append(c);
    }
    const list = panel.querySelector(".mp-list");
    list.innerHTML = "";
    SONGS.forEach((x, i) => {
      if (view && keyOf(x) !== view) return;
      const li = document.createElement("li");
      const b = document.createElement("button"); b.type = "button"; b.className = "mp-row" + (i === playing ? " now" : "");
      const ico = document.createElement("span"); ico.className = "mp-ico"; ico.setAttribute("aria-hidden", "true");
      if (i === playing) ico.innerHTML = '<span class="mp-bars"><i></i><i></i><i></i></span>'; else ico.textContent = "▶";
      const txt = document.createElement("span");
      const t = document.createElement("span"); t.className = "mp-title"; t.textContent = x.title;
      const by = document.createElement("span"); by.className = "mp-by"; by.textContent = x.by || "";
      txt.append(t, by);
      const len = document.createElement("span"); len.className = "mp-len"; len.textContent = fmt(x.dur);
      b.append(ico, txt, len);
      b.setAttribute("aria-label", `${x.title}, ${x.by || ""}`);
      b.addEventListener("click", () => { S().pick(i, view); setTimeout(paint, 400); });
      li.append(b); list.append(li);
    });
    const foot = panel.querySelector(".mp-foot");
    foot.textContent = "";
    const m = view && makers().find((k) => k.key === view);
    foot.append(document.createTextNode(only && playing >= 0 ? "Playing only these songs. When one ends, the next one plays." : "When a song ends, the next one plays."));
    if (m && m.x) {
      foot.append(document.createTextNode(" "));
      const a = document.createElement("a"); a.href = `https://x.com/${m.x}`; a.target = "_blank"; a.rel = "noopener"; a.className = "mp-by"; a.style.display = "inline";
      a.textContent = `@${m.x}`; foot.append(a);
    }
  }
  function openPanel(by) {
    if (!S().songs().length) return;
    if (!panel) build();
    view = by ? String(by).toLowerCase() : null;
    if (view && !makers().some((m) => m.key === view)) view = null;
    panel.hidden = false; void panel.offsetWidth; panel.classList.add("open");
    paint();
  }
  function closePanel() { if (!panel) return; panel.classList.remove("open"); setTimeout(() => { if (!panel.classList.contains("open")) panel.hidden = true; }, 250); }
  addEventListener("pd:song", paint);
  setInterval(() => { if (panel && !panel.hidden) paint(); }, 2000);
  window.pdMusicPicker = { open: openPanel, close: closePanel };
})();
