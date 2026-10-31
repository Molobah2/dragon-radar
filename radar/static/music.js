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
.mp-wrap[hidden],.mp [hidden]{display:none!important}.mp-wrap:not(.open){pointer-events:none}
.mp-wrap.open{background:rgba(8,10,28,.5)}
.mp{width:min(460px,100%);max-height:min(640px,calc(100dvh - 32px));display:flex;flex-direction:column;border-radius:26px;color:#f4f6ff;
 background:linear-gradient(160deg,#2a2160,#141235 60%,#0c0b24);box-shadow:0 30px 70px -20px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.12);
 transform:translateY(16px) scale(.98);opacity:0;transition:transform .28s cubic-bezier(.2,.9,.3,1.1),opacity .2s;font-family:inherit}
.mp-wrap.open .mp{transform:none;opacity:1}
.mp-head{display:flex;align-items:center;gap:10px;padding:18px 18px 8px}
.mp-head h3{margin:0;flex:1;font:700 21px/1.15 var(--font-display,var(--display,inherit))}
.mp-x{width:38px;height:38px;border-radius:50%;border:0;cursor:pointer;background:rgba(255,255,255,.12);color:#fff;font-weight:700;font-size:20px;line-height:1;font-family:inherit}
.mp-now{margin:4px 18px 10px;padding:12px 14px;border-radius:18px;background:rgba(255,255,255,.08);display:grid;grid-template-columns:1fr;gap:2px;align-items:center}
.mp-now small{grid-column:1/-1;font-weight:800;font-size:11px;line-height:1;font-family:inherit;letter-spacing:.08em;text-transform:uppercase;color:#ffd76a}
.mp-now b{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mp-now span{color:rgba(244,246,255,.7);font-weight:700;font-size:13px}
.mp-ctrls{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.mp-next{border:0;cursor:pointer;padding:9px 14px;border-radius:999px;font-weight:800;font-size:13px;line-height:1;font-family:inherit;color:#2a1a00;background:linear-gradient(180deg,#ffe08a,#ffb347)}
.mp-btn{display:inline-flex;align-items:center;gap:6px;border:0;cursor:pointer;padding:9px 13px;border-radius:999px;font-weight:800;font-size:13px;line-height:1;font-family:inherit;color:#f4f6ff;background:rgba(255,255,255,.12);text-decoration:none}
.mp-btn svg{width:15px;height:15px;flex:none}
.mp-now .mp-btn span{color:inherit;font-size:13px;font-weight:800}
.mp-btn[aria-pressed="true"]{background:#f4f6ff;color:#1b1840}
.mp-btn:focus-visible,.mp-next:focus-visible,.mp-dl:focus-visible{outline:2px solid #ffd76a;outline-offset:2px}
.mp-item{display:flex;align-items:center;gap:4px}.mp-item .mp-row{flex:1;min-width:0}
.mp-dl{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:rgba(244,246,255,.75);text-decoration:none}
.mp-dl:hover{background:rgba(255,255,255,.1);color:#fff}.mp-dl svg{width:17px;height:17px}
.mp-head,.mp-now,.mp-chips{flex:none}
.mp-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 18px 10px;scrollbar-width:none}.mp-chips::-webkit-scrollbar{display:none}
.mp-chip{flex:none;border:0;cursor:pointer;padding:8px 13px;border-radius:999px;font-weight:800;font-size:13px;line-height:1;font-family:inherit;color:#f4f6ff;background:rgba(255,255,255,.1)}
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
  const ICON = {
    rep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M12 9.5v5"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/></svg>',
  };
  // the file name a song saves as: "Title - Maker.m4a"
  const fileName = (x) => `${x.title}${x.by ? " - " + x.by : ""}.${((x.src || "").split("?")[0].split(".").pop() || "m4a")}`.replace(/[\\/:*?"<>|]+/g, "");
  function build() {
    css();
    panel = document.createElement("div");
    panel.className = "mp-wrap"; panel.hidden = true;
    panel.innerHTML = `<div class="mp" role="dialog" aria-modal="true" aria-labelledby="mp-title">
      <div class="mp-head"><h3 id="mp-title">Music by the community</h3><button class="mp-x" type="button" aria-label="Close">&times;</button></div>
      <div class="mp-now" aria-live="polite"><small>Now playing</small><b class="mp-title" id="mp-now-title"></b><span class="mp-by" id="mp-now-by"></span>
        <div class="mp-ctrls"><button class="mp-btn" type="button" id="mp-rep" aria-pressed="false">${ICON.rep}<span>Repeat</span></button>
        <a class="mp-btn" id="mp-dl" href="#" download>${ICON.dl}<span>Download</span></a>
        <button class="mp-next" type="button" id="mp-next">Next song</button></div></div>
      <div class="mp-chips" role="group" aria-label="Music makers"></div>
      <ul class="mp-list"></ul>
      <p class="mp-foot"></p></div>`;
    document.body.append(panel);
    panel.addEventListener("click", (e) => { if (e.target === panel) closePanel(); });
    panel.querySelector(".mp-x").addEventListener("click", closePanel);
    panel.querySelector("#mp-next").addEventListener("click", () => {
      S().skip();
    });
    panel.querySelector("#mp-rep").addEventListener("click", () => { S().setRepeat(!S().repeat()); paint(); });
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
      const rep = panel.querySelector("#mp-rep"), on = S().repeat();
      rep.setAttribute("aria-pressed", String(on));
      rep.setAttribute("aria-label", on ? "Repeat is on" : "Repeat this song");
      const dl = panel.querySelector("#mp-dl"), cs = SONGS[playing];
      dl.href = cs.src; dl.setAttribute("download", fileName(cs)); dl.setAttribute("aria-label", `Download ${cs.title}`);
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
      li.className = "mp-item";
      const d = document.createElement("a"); d.className = "mp-dl"; d.href = x.src; d.setAttribute("download", fileName(x));
      d.setAttribute("aria-label", `Download ${x.title}`); d.title = `Download ${x.title}`; d.innerHTML = ICON.dl;
      li.append(b, d); list.append(li);
    });
    const foot = panel.querySelector(".mp-foot");
    foot.textContent = "";
    const m = view && makers().find((k) => k.key === view);
    foot.append(document.createTextNode(S().repeat && S().repeat() && playing >= 0 ? "This song plays again when it ends."
      : only && playing >= 0 ? "Playing only these songs. When one ends, the next one plays." : "When a song ends, the next one plays."));
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
    opener = document.activeElement;
    panel.hidden = false; void panel.offsetWidth; panel.classList.add("open");
    paint();
    setTimeout(() => { const x = panel.querySelector(".mp-x"); if (x) x.focus({ preventScroll: true }); }, 60);
  }
  let opener = null;
  function closePanel() {
    if (!panel) return;
    if (opener && opener.focus && panel.contains(document.activeElement)) opener.focus({ preventScroll: true });
    panel.classList.remove("open"); setTimeout(() => { if (!panel.classList.contains("open")) panel.hidden = true; }, 250); }
  addEventListener("pd:song", paint);
  // a quiet check: the list is only rebuilt when the song or the mode really changed, so taps and focus stay put
  let lastSig = "";
  setInterval(() => {
    if (!panel || panel.hidden) return;
    const sig = `${S().playing()}|${S().only()}|${view}|${S().songs().length}|${S().repeat && S().repeat()}`;
    if (sig !== lastSig) { lastSig = sig; paint(); }
  }, 2000);
  window.pdMusicPicker = { open: openPanel, close: closePanel };
})();
