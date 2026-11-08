/* Dragon Guard: one short safety lesson a day, then a quiz on your honour.
   No wallet code anywhere: pdtools never asks for a wallet, a seed phrase or a signature.
   Progress lives only in this browser (with a memory fallback and a progress code to move it). */
(() => {
"use strict";
const CFG = Object.assign({
  dates: {1:"2026-11-08",2:"2026-11-08",3:"2026-11-09",4:"2026-11-10",5:"2026-11-11",6:"2026-11-12",7:"2026-11-14",8:"2026-11-15",9:"2026-11-17",10:"2026-11-18",11:"2026-11-19",12:"2026-11-20",13:"2026-11-21",14:"2026-11-22"},
  drills: {"2026-11-13":"Raffle closes and the top 500 snapshot is taken today at 1 PM UTC.","2026-11-16":"The community presale opens today at 1 PM UTC.","2026-11-30":"The public auction runs today from 1 PM UTC for 24 hours."},
  events: [["2026-11-13","Raffle closes · snapshot"],["2026-11-16","Community presale"],["2026-11-30","Public auction"]],
  official: [], serverNow: 0, now: "", tally: "/api/guard/tally", ver: "1", base: "/guard/"
}, window.GUARD || {});
const N = 14, $ = (s, r = document) => r.querySelector(s), main = $("#main");
const RM = matchMedia("(prefers-reduced-motion: reduce)");

/* ---------- time: the server's clock (or a test override), so a wrong phone clock cannot open lessons early ---------- */
const skew = CFG.serverNow ? CFG.serverNow - Date.now() : 0;
const t0 = Date.now(), nowOverride = CFG.now ? Date.parse(CFG.now) : NaN;
const now = () => isNaN(nowOverride) ? Date.now() + skew : nowOverride + (Date.now() - t0);
const pad = (n) => String(n).padStart(2, "0");
const localKey = (ms = now()) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const utcKey = (ms = now()) => new Date(ms).toISOString().slice(0, 10);
const dayNo = (key) => Math.round(Date.parse(key + "T00:00:00Z") / 864e5);
const opensAt = (m) => Date.parse(CFG.dates[m] + "T00:00:00Z");
const isOpen = (m) => now() >= opensAt(m);
const lang = (() => { let l = null; try { l = localStorage.getItem("radar:lang"); } catch (e) {} if (!l) l = (navigator.language || "en").slice(0, 2); return ["en","es","fr","pt","tr","ru","vi","id","ko","zh"].includes(l) ? l : "en"; })();
const fmtDate = (ms, o = { weekday: "short", day: "numeric", month: "short" }) => { try { return new Intl.DateTimeFormat(lang, o).format(new Date(ms)); } catch (e) { return new Date(ms).toDateString(); } };

/* ---------- words: English here; other languages load a small pack ---------- */
let TX = {};
const T = (k, en, vars) => { let s = TX[k] || en; if (vars) for (const v in vars) s = s.split("{" + v + "}").join(vars[v]); return s; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- storage that never breaks the course ---------- */
const KEY = "pd:guard";
const mem = {};
let canStore = true;
try { localStorage.setItem("pd:guard:t", "1"); localStorage.removeItem("pd:guard:t"); } catch (e) { canStore = false; }
const store = {
  get() { try { const v = canStore ? localStorage.getItem(KEY) : mem[KEY]; return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(o) { const v = JSON.stringify(o); try { if (canStore) localStorage.setItem(KEY, v); else mem[KEY] = v; } catch (e) { canStore = false; mem[KEY] = v; showRibbon(); } }
};
// EP: the course start every device shares. 8 Nov 2026 is day 1 for everyone: progress saved before it starts fresh
// (the notice already read and the timer choice are kept).
const EP = 2;
const fresh = () => ({ v: 1, ep: EP, id: Math.random().toString(36).slice(2, 10), seen: 0, mods: {}, items: {}, days: {}, checks: {}, drills: {}, timer: "", quiz: null, first: localKey() });
let S = store.get() || fresh();
if (!S.v) S = fresh();
if (S.ep !== EP) { const keep = { seen: S.seen ? 1 : 0, timer: typeof S.timer === "string" ? S.timer : "" }; S = Object.assign(fresh(), keep); store.set(S); }
const save = () => store.set(S);
const touchDay = () => { S.days[localKey()] = 1; };
function showRibbon() {
  const r = $("#ribbon"); r.hidden = false;
  r.textContent = T("ribbon", "This browser is not saving your progress. Use Move my progress at the bottom to keep it.");
}
if (!canStore) showRibbon();
const inApp = /Twitter|FBAN|FBAV|Instagram|Discord|Telegram|Line\//i.test(navigator.userAgent);

/* ---------- tiny helpers ---------- */
const tally = (m, ev, s) => { try { const b = JSON.stringify({ m, ev, s }); if (navigator.sendBeacon) navigator.sendBeacon(CFG.tally, new Blob([b], { type: "application/json" })); } catch (e) {} };
const say = (t) => { const l = $("#live"); l.textContent = ""; setTimeout(() => { l.textContent = t; }, 40); };
function rng(seed) { let a = 0; for (const c of String(seed)) a = Math.imul(a ^ c.charCodeAt(0), 2654435761) >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = (arr, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const art = (k, w = 640) => `${CFG.base}art/${k}-${w}.webp`;
const ico = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></svg>',
  lock: '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4z"/></svg>',
  helm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3zm-1 6h2v3h3v2h-3v5h-2v-5H8v-2h3z"/></svg>'
};
/* the guard seal: drawn, so it is sharp at any size and costs nothing */
const seal = (cls = "seal") => `<svg class="${cls}" viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="sg" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#e2574a"/><stop offset=".6" stop-color="#9e2418"/><stop offset="1" stop-color="#5e130b"/></radialGradient></defs><path d="M60 4c7 0 9 6 15 8s12-1 16 4 1 11 4 16 9 6 9 14-6 9-8 15 2 12-3 16-11 1-16 4-7 9-14 9-9-6-15-8-12 1-16-4-1-11-4-16-9-7-9-14 6-9 8-15-2-12 3-16 11-1 16-4S53 4 60 4z" fill="url(#sg)"/><circle cx="60" cy="60" r="36" fill="none" stroke="#f3b6a6" stroke-opacity=".55" stroke-width="2"/><path d="M60 30 38 39v17c0 14 9 26 22 31 13-5 22-17 22-31V39z" fill="#f6c9b9" fill-opacity=".9"/><path d="M60 40c-6 4-10 9-10 15 0 3 2 6 5 7-1-3 0-6 3-8 0 4 2 7 6 8 2-2 3-5 2-8 3 2 4 5 3 8 3-1 5-4 5-7 0-6-6-11-14-15z" fill="#8f2015"/></svg>`;

/* ---------- content ---------- */
const MODS = {};
async function mod(m) {
  if (MODS[m]) return MODS[m];
  const r = await fetch(`${CFG.base}content/m${pad(m)}.json?v=${CFG.ver}`);
  if (!r.ok) throw new Error("content " + m);
  return (MODS[m] = await r.json());
}
let IDX = [];   // titles, tags and takeaways for all 14, from one small file
async function loadIdx() { try { const r = await fetch(`${CFG.base}content/index.json?v=${CFG.ver}`); if (r.ok) IDX = await r.json(); } catch (e) {} }
const meta = (m) => IDX[m - 1] || { title: T("lessonN", "Lesson {n} of 14", { n: m }), tag: "", minutes: 5, art: "shield", takeaway: "" };

/* ---------- progress, rank, check days ---------- */
const st = (m) => S.mods[m] || (S.mods[m] = { read: 0, tries: 0, best: -1, done: 0, need: 0, swift: 0, pass: 0 });
const modsDone = () => Object.values(S.mods).filter((x) => x.done).length;
const guardDays = () => Object.keys(S.days).length;
const checksKept = () => Object.keys(S.checks).length;
const weeksOnGuard = () => new Set(Object.keys(S.days).map((k) => isoWeek(Date.parse(k + "T12:00:00")))).size;
const RANKS = [["Recruit", 0], ["Sentry", 3], ["Centurion", 6], ["Praetorian", 10], ["Dragon Guard", 14]];
function rank() {
  const d = modsDone(); let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (d >= RANKS[k][1]) i = k;
  if (i === 4 && checksKept() < 4) i = 3;
  const next = RANKS[i + 1];
  return { name: T("rank" + i, RANKS[i][0]), i, next: next ? T("rank" + (i + 1), next[0]) : null, need: next ? Math.max(0, next[1] - d) : 0, frac: next ? Math.min(1, (d - RANKS[i][1]) / (next[1] - RANKS[i][1])) : 1 };
}
const isCheckDay = (ms = now()) => [1, 4].includes(new Date(ms).getDay());
const checkDue = () => isCheckDay() && !S.checks[localKey()];
function todayModule() {
  let best = null;
  for (let m = 1; m <= N; m++) { if (!isOpen(m)) break; if (!st(m).done) { best = m; break; } }
  return best;
}
function openCount() { let c = 0; for (let m = 1; m <= N; m++) if (isOpen(m)) c++; return c; }

/* ---------- routing: every screen is its own history entry ---------- */
let route = "", quizActive = false, leaving = false;
function go(h) { if (location.hash !== "#" + h) location.hash = h; else render(); }
window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1) || "home";
  if (quizActive && !leaving && !/^q$/.test(h) && route === "q") { history.pushState(null, "", "#q"); leaveSheet(); return; }
  leaving = false; render();
});
document.addEventListener("click", (e) => { const a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); go(a.dataset.go); } });

function render() {
  const h = location.hash.slice(1) || "home";
  route = h;
  const [v, a] = h.split("/");
  document.body.dataset.view = v;
  $("#links-btn").hidden = v === "q";
  quizActive = v === "q" && !!S.quiz;
  if (v === "home") home();
  else if (/^m\d+$/.test(v)) lesson(+v.slice(1), +(a || 0));
  else if (v === "honour") honour(a);
  else if (v === "daily") { if (openCount()) honour("daily"); else go("home"); }
  else if (v === "q") quizView();
  else if (v === "done") resultView();
  else if (v === "help") helpView();
  else if (v === "promise") promiseView();
  else if (v === "progress") progressView();
  else if (v === "check") checkView();
  else if (v === "links") linksView();
  else home();
  main.focus({ preventScroll: true });
  if (v !== "m" && !/^m\d+$/.test(v)) window.scrollTo(0, 0);
  hallOn(v === "home");
}
function hallOn(on) {
  const h = $("#hall");
  if (on && !h.dataset.set) { const tall = innerHeight > innerWidth; const i = new Image(); i.onload = () => { h.style.backgroundImage = `url(${i.src})`; h.classList.add("on"); }; i.src = art(tall ? "hall-tall" : "hall", tall ? 640 : 1280); h.dataset.set = 1; }
}

/* ---------- home ---------- */
function home() {
  touchDay(); save();
  const tm = todayModule(), rk = rank(), oc = openCount();
  const dk = utcKey(), drill = CFG.drills[dk];
  const daysToStart = Math.ceil((opensAt(1) - now()) / 864e5);
  let todayHtml;
  if (!oc) {
    todayHtml = `<div class="parch today"><div class="art" style="background-image:url(${art("shield")})"></div><div class="body"><span class="eyebrow" style="color:#7a4a16">${esc(T("soon", "Opens soon"))}</span><h2>${esc(T("firstOn", "The first lessons open {d}", { d: fmtDate(opensAt(1), { weekday: "long", day: "numeric", month: "long" }) }))}</h2><p class="muted">${esc(T("firstOn2", "Two lessons on day one, then one a day. Come back then and start your guard."))}</p></div></div>`;
  } else if (tm) {
    const s = st(tm);
    const label = s.read ? T("takeQuiz", "Take the quiz") : T("startLesson", "Start the lesson");
    const mt = meta(tm);
    todayHtml = `<div class="parch today" id="todaycard"><div class="art" style="background-image:url(${art(mt.art)})"></div><div class="body"><span class="eyebrow" style="color:#7a4a16">${esc(T("lessonN", "Lesson {n} of 14", { n: tm }))}</span><h2>${esc(mt.title)}</h2><div class="meta"><span>${esc(T("min", "{n} min", { n: mt.minutes }))} · ${esc(T("then6", "then 6 questions"))}</span>${s.need ? `<span class="chip need">${esc(T("needs", "Needs review"))}</span>` : ""}</div><p class="muted">${esc(mt.takeaway)}</p><a class="btn main wide" href="#${s.read ? "honour/" + tm : "m" + tm}">${esc(label)}</a></div></div>`;
  } else {
    todayHtml = `<div class="parch today"><div class="art" style="background-image:url(${art("shield")})"></div><div class="body"><span class="eyebrow" style="color:#7a4a16">${esc(T("allDone", "All open lessons done"))}</span><h2>${esc(oc < N ? T("nextOn", "Next lesson opens {d}", { d: fmtDate(opensAt(oc + 1)) }) : T("wellGuarded", "Your hoard is well guarded"))}</h2><p class="muted">${esc(oc < N ? T("comeBack", "Come back then. Until then, practise any lesson again.") : T("weekly", "Keep sharp with the weekly Guard Drill and Check Day."))}</p>${oc >= N || weeklyDue() ? `<a class="btn main wide" href="#honour/drill">${esc(T("drillBtn", "Start the Guard Drill"))}</a>` : ""}</div></div>`;
  }
  const drillHtml = drill && oc ? `<div class="panel check"><h3>${esc(T("mintReady", "Mint Ready drill"))}</h3><p>${esc(T("drill_" + dk, drill))} ${esc(T("drillWhy", "Five quick questions to make sure you are ready."))}</p>${S.drills[dk] ? `<p class="chip good">${esc(T("drillDone", "Done for today"))}</p>` : `<a class="btn main" href="#honour/drill">${esc(T("drillGo", "Start the drill"))}</a>`}</div>` : "";
  const qdone = !!(S.qd && S.qd[localKey()]);
  const dailyHtml = oc ? `<div class="panel check" id="dailycard"><h3>${esc(T("dailyT", "Today's guard questions"))}</h3><p>${esc(T("dailyWhy", "Three quick questions from the lessons you have opened. Any Dragon Guard quiz you finish today fills the Dragon Guard step of your daily goal on pdtools."))}</p>${qdone ? `<p class="chip good">${esc(T("drillDone", "Done for today"))}</p>` : `<a class="btn main" href="#daily">${esc(T("dailyBtn", "Answer 3 questions"))}</a>`}</div>` : "";
  const checkHtml = checkDue() ? `<div class="panel check" id="checkday"><h3>${esc(T("checkDay", "Check Day"))}</h3><p>${esc(T("checkWhy", "Look at what your wallet has approved. You can search by your address on revoke.cash without connecting anything. Revoke only the approvals you do not use or do not recognise. Each revoke costs a small gas fee."))}</p><div class="btn-row"><a class="btn main" href="https://revoke.cash/" target="_blank" rel="noopener noreferrer">${esc(T("openRevoke", "Open revoke.cash"))}</a><a class="btn ghost" href="#check">${esc(T("howCheck", "How to check"))}</a><button class="btn ghost" type="button" id="checked">${esc(T("iChecked", "I checked"))}</button></div></div>` : "";
  const inAppHtml = inApp ? `<div class="panel small">${esc(T("inapp", "You are inside an app's browser. Open pdtools.xyz/guard in your phone's own browser so your progress is kept."))}</div>` : "";
  const cal = CFG.events.map(([d, l]) => { const ms = Date.parse(d + "T13:00:00Z"), soon = ms > now() && ms - now() < 4 * 864e5; return `<div class="${soon ? "soon" : ""}"><b>${esc(fmtDate(ms, { day: "numeric", month: "short" }))}</b>${esc(T("ev_" + d, l))}</div>`; }).join("");
  let path = "";
  for (let m = 1; m <= N; m++) {
    const s = st(m), open = isOpen(m);
    const cls = !open ? "locked" : s.done && !s.need ? "done" : s.need ? "need" : m === tm ? "open today" : "open";
    const status = !open ? T("opensOn", "Opens {d}", { d: fmtDate(opensAt(m)) }) : s.done && !s.need ? T("doneLbl", "Done") : s.need ? T("needs", "Needs review") : s.read ? T("quizNext", "Quiz next") : s.started ? T("inProgress", "In progress") : T("openNow", "Open now · not started");
    const mt = meta(m);
    const inner = `<span class="n">${s.done && !s.need ? "✓" : m}</span><span class="t"><b>${esc(mt.title)}</b><small>${esc(mt.tag)} · ${esc(T("min", "{n} min", { n: mt.minutes }))}</small></span><span class="s">${esc(status)}</span>`;
    path += open ? `<li><a class="stone ${cls}" href="#m${m}">${inner}</a></li>` : `<li><div class="stone ${cls}" aria-disabled="true">${inner}</div></li>`;
  }
  main.innerHTML = `
  <section class="hero"><span class="eyebrow">pdtools · ${esc(T("course", "Safety course"))}</span><h1 class="kin" aria-label="${esc(T("title", "Dragon Guard"))}">${kinetic(T("title", "Dragon Guard"))}</h1><p>${esc(T("tag", "One short lesson a day. Spot the scams before they reach your dragons."))}</p></section>
  <div class="stack-l">
    ${inAppHtml}${checkHtml}${drillHtml}${todayHtml}${dailyHtml}
    <section class="stack" aria-labelledby="calh"><h3 id="calh">${esc(T("calendar", "Mint calendar"))}</h3><div class="cal">${cal}</div><p class="small muted">${esc(T("calNote", "From the official Pocket Dragons mint post. Trust only links from the official accounts, checked on two channels. pdtools will never post a mint link."))}</p></section>
    <section class="stack" aria-labelledby="pathh"><h3 id="pathh">${esc(T("path", "Your path"))}</h3><ol class="path">${path}</ol></section>
    <section class="panel stack" aria-labelledby="meh"><div class="rank"><div class="badge">${ico.helm}</div><div style="flex:1"><span class="eyebrow">${esc(T("yourRank", "Your rank"))}</span><h3 id="meh">${esc(rk.name)}</h3><div class="bar" aria-hidden="true"><i style="width:${Math.round(rk.frac * 100)}%"></i></div><p class="small muted">${esc(!rk.next ? T("topRank", "The highest rank. Keep guarding.") : rk.need > 0 ? (rk.need === 1 ? T("toNext1", "1 more lesson to {r}", { r: rk.next }) : T("toNext", "{n} more lessons to {r}", { n: rk.need, r: rk.next })) : T("toNextCheck", "Keep {n} more Check Day to reach {r}", { n: Math.max(1, 4 - checksKept()), r: rk.next }))}</p></div></div>
      <div class="stats"><div><b>${modsDone()}</b><span>${esc(T("lessonsDone", "Lessons done"))}</span></div>${modsDone() >= N ? `<div><b>${weeksOnGuard()}</b><span>${esc(T("weeks", "Weeks on guard"))}</span></div>` : `<div><b>${guardDays()}</b><span>${esc(T("guardDays", "Guard days"))}</span></div>`}<div><b>${checksKept()}</b><span>${esc(T("checksKept", "Check Days kept"))}</span></div></div>
      ${modsDone() ? `<button class="btn ghost" type="button" id="share">${esc(T("shareCard", "Make my guard card"))}</button>` : ""}</section>
    <section class="tools"><a class="tool alarm" href="#help">${esc(T("drained", "I think I got drained"))}<small>${esc(T("drainedS", "What to do in the first minutes"))}</small></a><a class="tool" href="#links">${esc(T("links", "Trusted links"))}<small>${esc(T("linksS", "Tools to check your wallet"))}</small></a><a class="tool" href="#check">${esc(T("checkDay", "Check Day"))}<small>${esc(T("checkS", "Mondays and Thursdays"))}</small></a><a class="tool" href="#promise">${esc(T("promise", "pdtools safety promise"))}<small>${esc(T("promiseS", "What we will never ask"))}</small></a></section>
  </div>`;
  const c = $("#checked"); if (c) c.onclick = () => { S.checks[localKey()] = 1; touchDay(); save(); tally(0, "check"); say(T("checkedSay", "Check Day kept. See you on the next one.")); home(); };
  const sh = $("#share"); if (sh) sh.onclick = shareCard;
  if (!S.seen) scrollNotice(true);
}
function weeklyDue() { const wk = isoWeek(); return modsDone() >= N && !S.drills["w" + wk]; }
function isoWeek(ms = now()) { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(d.getFullYear(), 0, 4); return d.getFullYear() + "-" + (1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7)); }

// kinetic type: each letter its own span, staggered in by CSS (once per visit, never under reduced motion)
let kinDone = false;
function kinetic(s) {
  const on = !kinDone && !RM.matches; kinDone = true;
  let i = 0;
  return s.split(" ").map((w) => `<span class="kword" aria-hidden="true">${[...w].map((ch) => `<span class="kl${on ? " go" : ""}" style="--i:${i++}">${esc(ch)}</span>`).join("")}</span>`).join(" ");
}
// embers rising behind a passed result (a small canvas, stops by itself)
function embers(host) {
  if (RM.matches) return; const c = document.createElement("canvas"); c.className = "embers"; c.setAttribute("aria-hidden", "true"); host.appendChild(c);
  const x = c.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1); let W = 0, H = 0;
  const size = () => { W = c.clientWidth; H = c.clientHeight; c.width = W * dpr; c.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0); }; size();
  const P = Array.from({ length: 46 }, (_, i) => ({ x: Math.random(), y: 1 + Math.random() * .3, v: .12 + Math.random() * .22, r: 1.2 + Math.random() * 2.6, w: Math.random() * 6.28, d: Math.random() * 1.2 }));
  const s0 = performance.now(); let raf = 0;
  const step = (now) => { if (!c.isConnected) return; const t = (now - s0) / 1000; x.clearRect(0, 0, W, H);
    for (const p of P) { const tt = Math.max(0, t - p.d), y = (p.y - tt * p.v) * H, xx = (p.x + Math.sin(tt * 2 + p.w) * .02) * W, a = Math.max(0, Math.min(1, tt * 2)) * Math.max(0, 1 - (t - 3.2) / 1.2);
      if (y < -10 || a <= 0) continue; x.globalAlpha = a; x.fillStyle = p.r > 2.6 ? "#ffd59a" : "#ffb257"; x.beginPath(); x.arc(xx, y, p.r, 0, 6.29); x.fill(); }
    if (t < 4.6) raf = requestAnimationFrame(step); else c.remove(); };
  raf = requestAnimationFrame(step);
}
// a number counting up to its value
function countUp(el, to, ms = 900) { if (!el || RM.matches) return; const s0 = performance.now(); const step = (now) => { const p = Math.min(1, (now - s0) / ms); el.firstChild.nodeValue = String(Math.round(to * easeOut(p))); if (p < 1) requestAnimationFrame(step); }; el.firstChild.nodeValue = "0"; requestAnimationFrame(step); }

/* ---------- the scroll notice ---------- */
function scrollNotice(first) {
  const w = $("#sheet");
  w.innerHTML = `<div class="scroll ${RM.matches ? "" : "unroll"}" role="dialog" aria-modal="true" aria-labelledby="ave"><div class="rod"></div><div class="paper">
    ${seal()}<p class="tag">${esc(T("sTag", "A notice from pdtools"))}</p><h2 class="ave" id="ave">${esc(T("sAve", "Ave, Keeper."))}</h2>
    <p class="ln"><b>${esc(T("s1", "Dragon Guard trains you to see the scams that empty wallets before they reach you."))}</b></p>
    <p class="ln">${esc(T("s2", "Each day brings one short lesson, then a quick quiz you take on your honour, without AI."))}</p>
    <p class="ln">${esc(T("s3", "Twice a week, Check Day reminds you to review your wallet approvals."))}</p>
    <p class="ln"><b>${esc(T("s4", "pdtools will never ask for your wallet, your seed phrase or a signature."))}</b></p>
    <p class="motto">${esc(T("s5", "Guard daily. Stay sharp. Keep your hoard."))}</p>
    <button class="btn ink" type="button" id="swear">${esc(T("sBtn", "I will guard my hoard"))}</button></div><div class="rod b"></div></div>`;
  w.hidden = false;
  const close = () => { w.hidden = true; w.innerHTML = ""; S.seen = 1; save(); if (first) tally(0, "seen"); $("#main").focus(); };
  $("#swear").onclick = close;
  w.onclick = (e) => { if (e.target === w) close(); };
  w.onkeydown = (e) => { if (e.key === "Escape") close(); if (e.key === "Tab") { e.preventDefault(); $("#swear").focus(); } };
  setTimeout(() => $("#swear").focus({ preventScroll: true }), RM.matches ? 0 : 600);
}
$("#scroll-again").onclick = () => scrollNotice(false);

/* ---------- simulators: real text, flags are toggle buttons, always inside a PRACTICE frame ---------- */
const P = () => esc(T("practice", "Practice · not real"));
function segs(arr, mode, sid) {
  // mode: "flag" (toggle buttons), "show" (plain), "reveal" (marked after an answer)
  return (arr || []).map((s, i) => {
    if (typeof s === "string") return esc(s);
    const id = `${sid}-${i}`;
    if (mode === "flag") return `<button type="button" class="seg" data-seg="${id}" data-flag="${s.flag ? 1 : 0}" aria-pressed="false">${esc(s.t)}</button>`;
    if (mode === "reveal" && s.flag) return `<span class="seg ok-flag" data-seg="${id}">${esc(s.t)}</span>`;
    return `<span class="seg plain" data-seg="${id}"${s.flag ? ` data-flag="1" data-lab="${esc(s.label || "")}"` : ""}>${esc(s.t)}</span>`;
  }).join("");
}
let simN = 0;
function sim(x, mode = "show") {
  if (!x) return "";
  const id = "s" + (++simN);
  const fr = (inner, extra = "") => `<div class="practice" data-p="${P()}" data-p2="${esc(T("practice2", "Practice · buttons do nothing"))}" data-sim="${id}" ${extra}><div class="scr">${inner}<div class="wm" aria-hidden="true"><span>PRACTICE</span></div></div></div>`;
  const av = (n) => `<span class="av" aria-hidden="true" style="background:${["#7b6a9a", "#9a6a6a", "#5f8a7a", "#8a7a4f"][(n || "x").length % 4]}">${esc((n || "?").replace(/[^A-Za-z]/g, "").slice(0, 1) || "?")}</span>`;
  const vf = (b) => b === "fake_verified" || b === "verified" ? '<span class="vf" aria-label="check mark">✓</span>' : "";
  let k = 0; const sub = (a) => segs(a, mode, id + "-" + (k++));
  switch (x.kind) {
    case "dm": return fr(`<div class="chat"><div class="hd">${av(x.from.name)}<div><div class="nm">${esc(x.from.name)} ${vf(x.from.badge)}</div><div class="hn">@${esc(x.from.handle)}</div></div></div><div class="msgs">${x.messages.map((m) => `<div class="bub ${m.who === "me" ? "me" : ""}">${sub(m.seg)}</div>`).join("")}</div></div>`);
    case "browser": return fr(`<div class="urlbar">${ico.lock}<span class="u">${sub(x.url)}</span></div><div class="page"><h4>${esc(x.page.title)}</h4>${(x.page.lines || []).map((l) => `<p>${esc(l)}</p>`).join("")}${x.page.button ? `<span class="fakebtn" aria-hidden="true">${esc(x.page.button)}</span>` : ""}</div>`);
    case "seedpage": return fr(`<div class="urlbar">${ico.lock}<span class="u">${esc(x.site)}</span></div><div class="page"><h4>${esc(x.title)}</h4><div class="seeds" aria-label="${esc(T("seedBoxes", "Twelve empty word boxes"))}">${Array.from({ length: x.words || 12 }, (_, i) => `<span>${esc(T("word", "word"))} ${i + 1}</span>`).join("")}</div><span class="fakebtn" aria-hidden="true">${esc(T("continue", "Continue"))}</span></div>`);
    case "wallet": return `<div class="phone">${fr(`<div class="wal"><div class="hd"><span class="site">${esc(x.site)}</span><span class="ttl">${esc(x.title)}</span></div><dl>${x.rows.map((r) => `<div class="row"><dt>${esc(r.label)}</dt><dd>${sub(r.value)}</dd></div>`).join("")}</dl>${x.note ? `<p class="note">${esc(x.note)}</p>` : ""}<div class="bts" aria-hidden="true">${(x.buttons || ["Reject", "Sign"]).map((b) => `<span>${esc(b)}</span>`).join("")}</div></div>`)}</div>`;
    case "post": return fr(`<div class="post"><div class="hd2">${av(x.account.name)}<div><div class="nm">${esc(x.account.name)} ${vf(x.account.badge)}</div><div class="hn">@${esc(x.account.handle)}</div></div><span class="tm">${esc(x.time || "")}</span></div><div>${sub(x.seg)}</div></div>`);
    case "call": return fr(`<div class="call"><div class="tile"><span class="ppl" aria-hidden="true"></span><b>${esc(x.caller.name)}${x.caller.note ? " · " + esc(x.caller.note) : ""}</b></div><div class="cap">${sub(x.lines)}</div>${x.prompt ? `<div class="pop"><b>${esc(x.prompt.title)}</b><span>${esc(x.prompt.body)}</span><span class="fakebtn" aria-hidden="true">${esc(x.prompt.button)}</span></div>` : ""}</div>`);
    case "compare": return `<div class="cmp"><div class="stack"><span class="lab">A</span>${sim(x.left, mode)}</div><div class="stack"><span class="lab">B</span>${sim(x.right, mode)}</div></div>`;
  }
  return "";
}
function allSegs(x, out = []) {
  if (!x) return out;
  const push = (a) => (a || []).forEach((s) => { if (typeof s !== "string") out.push(s); });
  if (x.kind === "dm") x.messages.forEach((m) => push(m.seg));
  if (x.kind === "browser") push(x.url);
  if (x.kind === "wallet") x.rows.forEach((r) => push(r.value));
  if (x.kind === "post") push(x.seg);
  if (x.kind === "call") push(x.lines);
  if (x.kind === "compare") { allSegs(x.left, out); allSegs(x.right, out); }
  return out;
}
/* ---------- scam replays (8 Nov): the scene at the top of each lesson plays out like a screen recording. The practice
   screen builds itself (messages arrive, the address types in, the wallet popup rises), a cursor heads for the trap,
   everything freezes on STOP and each red flag lights up with its name. Every frame comes from seek(t), so the same
   replay can be filmed frame by frame for the daily video. Reduced motion shows the last frame straight away. ---------- */
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIO = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const spring = (x) => x >= 1 ? 1 : 1 - Math.exp(-6 * x) * Math.cos(9 * x);
function Replay(host, simData) {
  const frames = [...host.querySelectorAll(".practice")]; if (!frames.length) return null;
  const items = [], flags = [];
  let t0 = 0;
  const add = (el, kind, dur) => { if (!el) return; items.push({ el, kind, at: t0, dur }); t0 += kind === "type" ? dur : dur * 0.55; };
  frames.forEach((fr) => {
    const kind = fr.closest(".phone") ? "wallet" : fr.querySelector(".chat") ? "dm" : fr.querySelector(".seeds") ? "seedpage" : fr.querySelector(".post") ? "post" : fr.querySelector(".call") ? "call" : "browser";
    if (kind === "wallet") { add(fr.closest(".phone"), "rise", 0.7); fr.querySelectorAll(".wal .hd, .wal .row, .wal .note, .wal .bts").forEach((e) => add(e, "in", 0.42)); }
    else if (kind === "dm") { add(fr.querySelector(".chat .hd"), "in", 0.45); fr.querySelectorAll(".bub").forEach((e) => { t0 += e.classList.contains("me") ? 0.1 : 0.55; add(e, e.classList.contains("me") ? "pop" : "msg", 0.45); }); }
    else if (kind === "post") { add(fr.querySelector(".post"), "rise", 0.6); }
    else if (kind === "call") { add(fr.querySelector(".call .tile"), "ring", 0.9); add(fr.querySelector(".call .cap"), "in", 0.5); add(fr.querySelector(".call .pop"), "pop", 0.5); }
    else {
      const u = fr.querySelector(".urlbar .u"); if (u) add(u, "type", Math.min(1.4, 0.35 + (u.textContent.length * 0.035)));
      fr.querySelectorAll(".page > *").forEach((e) => add(e, "in", 0.4));
      fr.querySelectorAll(".seeds span").forEach((e) => { items.push({ el: e, kind: "pop", at: t0, dur: 0.3 }); t0 += 0.05; });
    }
    fr.querySelectorAll(".seg[data-flag='1']").forEach((e) => flags.push({ el: e, lab: e.dataset.lab || "", fr }));
    if (kind === "seedpage") { flags.push({ el: fr.querySelector(".urlbar .u"), lab: T("rpSite", "A site you never chose"), fr }); flags.push({ el: fr.querySelector(".seeds"), lab: T("rpSeed", "It asks for your seed phrase"), fr }); }
    if (kind === "wallet" && !fr.querySelector(".seg[data-flag='1']")) flags.push({ el: fr.querySelector(".wal .bts span:last-child"), lab: T("rpSign", "A signature you did not plan"), fr });
  });
  if (!flags.length) return null;
  // the trap the cursor heads for: the button that would do the harm, else the first red flag
  const link = flags.find((f) => f.el && /\.example|\.test/.test(f.el.textContent || ""));
  const trap = host.querySelector(".fakebtn") || host.querySelector(".wal .bts span:last-child") || (link && link.el) || flags[0].el;
  const T_CUR = t0 + 0.3, T_CLICK = T_CUR + 1.25, T_STOP = T_CLICK + 0.35, T_FLAG = T_STOP + 0.75, GAP = 0.85;
  const END = T_FLAG + flags.length * GAP + 0.6;
  // the layer drawn over the practice frames
  const wrap = host.querySelector(".cmp") || frames[0].closest(".phone") || frames[0];
  wrap.classList.add("rp-host");
  const layer = document.createElement("div"); layer.className = "rp-layer"; layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = `<svg class="rp-cur" viewBox="0 0 24 24" width="30" height="30"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg><i class="rp-ring"></i><b class="rp-stop">${esc(T("rpStop", "STOP"))}</b>`
    + flags.map((f, i) => `<b class="rp-num">${i + 1}</b>`).join("");
  wrap.appendChild(layer);
  const cur = layer.querySelector(".rp-cur"), ring = layer.querySelector(".rp-ring"), stop = layer.querySelector(".rp-stop"), nums = [...layer.querySelectorAll(".rp-num")];
  // the red flags, named in a numbered list under the screen as each one lights up
  const list = document.createElement("div"); list.className = "rp-list";
  list.innerHTML = `<p class="rp-count">${esc(flags.length === 1 ? T("rpCount1", "1 red flag") : T("rpCount", "{n} red flags", { n: flags.length }))}</p><ol>${flags.map((f, i) => `<li><b>${i + 1}</b><span>${esc(f.lab)}</span></li>`).join("")}</ol>`;
  wrap.insertAdjacentElement("afterend", list);
  const labs = [...list.querySelectorAll("li")], count = list.querySelector(".rp-count");
  const bar = document.createElement("div"); bar.className = "rp-bar";
  bar.innerHTML = `<button class="btn ghost" type="button">${ico.replay || "↻"} ${esc(T("rpAgain", "Watch it again"))}</button>`;
  list.insertAdjacentElement("afterend", bar);
  const rel = (el) => { const rs = el.getClientRects(), a = rs.length ? rs[0] : el.getBoundingClientRect(), b = wrap.getBoundingClientRect(); return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height, W: b.width, H: b.height }; };
  let geo = null;
  const measure = () => { const saved = items.map((it) => it.el.style.cssText); items.forEach((it) => { it.el.style.opacity = ""; it.el.style.transform = ""; it.el.style.clipPath = ""; });
    geo = { trap: rel(trap), flags: flags.map((f) => rel(f.el)) }; items.forEach((it, i) => { it.el.style.cssText = saved[i]; }); };
  let lastT = 0;
  function seek(t) {
    lastT = t;
    if (!geo) measure();
    for (const it of items) {
      const p = clamp01((t - it.at) / it.dur), s = it.el.style;
      if (it.kind === "type") { s.clipPath = p >= 1 ? "" : `inset(0 ${(100 - p * 100).toFixed(1)}% 0 0)`; s.opacity = t < it.at ? "0" : "1"; continue; }
      if (it.kind === "ring") { s.opacity = String(clamp01(p * 3)); s.transform = p >= 1 ? "" : `scale(${(1 + Math.sin(p * 18) * 0.02 * (1 - p)).toFixed(4)})`; continue; }
      const e = it.kind === "pop" ? spring(p) : easeOut(p);
      s.opacity = String(clamp01(p * 1.6));
      s.transform = p >= 1 ? "" : it.kind === "rise" ? `translateY(${((1 - e) * 60).toFixed(1)}px)` : it.kind === "pop" ? `scale(${(0.6 + 0.4 * e).toFixed(4)})` : it.kind === "msg" ? `translateY(${((1 - e) * 14).toFixed(1)}px) scale(${(0.94 + 0.06 * e).toFixed(4)})` : `translateY(${((1 - e) * 10).toFixed(1)}px)`;
      if (it.kind === "msg" || it.kind === "pop") s.transformOrigin = it.el.classList.contains("me") ? "right bottom" : "left bottom";
    }
    // the cursor glides in from the corner to the trap and presses it
    const g = geo.trap, tx = g.x + g.w * 0.62, ty = g.y + g.h * 0.55, sx = g.W * 0.82, sy = g.H * 0.94;
    const pc = easeIO(clamp01((t - T_CUR) / 1.15)), press = clamp01((t - T_CLICK) / 0.25);
    const cx = sx + (tx - sx) * pc + Math.sin(pc * Math.PI) * -24, cy = sy + (ty - sy) * pc - Math.sin(pc * Math.PI) * 30;
    cur.style.opacity = t < T_CUR ? "0" : String(clamp01((T_STOP + 0.6 - t) / 0.4) * clamp01((t - T_CUR) / 0.2));
    cur.style.transform = `translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px) scale(${(1 - 0.18 * Math.sin(press * Math.PI)).toFixed(3)})`;
    ring.style.opacity = press > 0 && press < 1 ? String(1 - press) : "0";
    ring.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${(0.3 + press * 1.6).toFixed(3)})`;
    // STOP slams in over the frame, then each red flag lights up with its name
    const ps = clamp01((t - T_STOP) / 0.45);
    wrap.classList.toggle("rp-frozen", t >= T_STOP);
    stop.style.opacity = t < T_STOP ? "0" : String(clamp01(ps * 2) * (1 - clamp01((t - T_FLAG + 0.1) / 0.4)));
    stop.style.transform = `translate(-50%,-50%) rotate(-8deg) scale(${(2.2 - 1.2 * spring(ps)).toFixed(3)})`;
    flags.forEach((f, i) => {
      const at = T_FLAG + i * GAP, p = clamp01((t - at) / 0.4), r = geo.flags[i], L = labs[i], N = nums[i];
      f.el && f.el.classList.toggle("rp-hit", t >= at);
      L.style.opacity = String(clamp01(p * 2)); L.style.transform = p >= 1 ? "" : `translateX(${((1 - easeOut(p)) * -16).toFixed(1)}px)`;
      N.style.opacity = String(clamp01(p * 2));
      N.style.transform = `translate(${(r.x - 10).toFixed(1)}px,${(r.y - 12).toFixed(1)}px) scale(${(0.4 + 0.6 * spring(p)).toFixed(3)})`;
    });
    const pk = clamp01((t - T_FLAG + 0.3) / 0.3); count.style.opacity = String(pk); list.classList.toggle("on", t >= T_FLAG - 0.3);
  }
  let raf = 0, start = 0, played = false;
  const run = () => { cancelAnimationFrame(raf); geo = null; measure(); start = performance.now(); played = true;
    const step = (now) => { if (!wrap.isConnected) return; const t = (now - start) / 1000; seek(Math.min(t, END)); if (t < END) raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); };
  bar.querySelector("button").onclick = run;
  if (RM.matches) { requestAnimationFrame(() => { measure(); seek(END); }); }
  else {
    seek(0);
    if (/[?&]rpstill/.test(location.search)) { window.GUARD_REPLAY = { seek, duration: END, run, measure: () => { geo = null; seek(lastT); }, beats: { stop: T_STOP, flags: flags.map((_, i) => T_FLAG + i * GAP) } }; return window.GUARD_REPLAY; }   // filming: frames come from seek(t) only
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !played) { io.disconnect(); setTimeout(run, 250); } }, { threshold: 0.35 });
    io.observe(wrap);
  }
  // anything that moves the layout (fonts arriving, a resize, the film stage) is measured again
  const again = () => { geo = null; seek(lastT); };
  if (window.ResizeObserver) new ResizeObserver(() => { geo = null; }).observe(wrap);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
  window.GUARD_REPLAY = { seek, duration: END, run, measure: again };
  return window.GUARD_REPLAY;
}
/* ---------- moving diagrams (8 Nov): the hardest ideas drawn as short animations on their lesson cards. Same rule as
   the replays: every frame from seek(t), autoplay once when seen, "Watch it again", reduced motion shows the end. ---------- */
const NS = "http://www.w3.org/2000/svg";
const lerp = (a, b, p) => a + (b - a) * p;
const ph = (t, a, d) => clamp01((t - a) / d);
function svgEl(tag, at, kids) { const e = document.createElementNS(NS, tag); for (const k in at || {}) e.setAttribute(k, at[k]); (kids || []).forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c)); return e; }
const C = { bg: "#241a15", stone: "#3a2e27", line: "#6a5442", cream: "#f7ecd5", soft: "#d9c7a6", bronze: "#c58c45", torch: "#ffb257", red: "#e0533c", green: "#58b28a", ink: "#2b1d12" };
const txt = (x, y, s, o = {}) => svgEl("text", Object.assign({ x, y, fill: C.cream, "font-size": 20, "font-weight": 800, "text-anchor": "middle", "font-family": "Nunito, system-ui, sans-serif" }, o), [s]);
const box = (x, y, w, h, o = {}) => svgEl("rect", Object.assign({ x, y, width: w, height: h, rx: 18, fill: C.stone, stroke: C.line, "stroke-width": 3 }, o));
const coin = (o = {}) => svgEl("g", o, [svgEl("circle", { r: 13, fill: C.torch, stroke: "#8a4a12", "stroke-width": 3 }), svgEl("text", { y: 5, "text-anchor": "middle", "font-size": 14, "font-weight": 900, fill: "#5a2a00", "font-family": "Nunito, sans-serif" }, ["◆"])]);
const egg = (o = {}) => svgEl("g", o, [svgEl("ellipse", { rx: 13, ry: 17, fill: "#7fd0a0", stroke: "#2f6b4c", "stroke-width": 3 }), svgEl("circle", { cx: 4, cy: -4, r: 3, fill: "#2f6b4c" })]);
const op = (e, v) => e.setAttribute("opacity", Math.max(0, Math.min(1, v)).toFixed(3));
const mv = (e, x, y, s = 1, r = 0) => e.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})${s !== 1 ? ` scale(${s.toFixed(3)})` : ""}${r ? ` rotate(${r.toFixed(1)})` : ""}`);
const DIAGRAMS = {
  // Lesson 3: the vault keeps the dragons and never connects; the mint wallet holds only what mint needs
  "3/1": { end: 9, build(g) {
    const vault = svgEl("g", {}, [box(40, 70, 220, 200, { stroke: C.green }), txt(150, 110, "Vault"), txt(150, 252, "never connects", { "font-size": 15, fill: C.soft, "font-weight": 700 })]);
    const mint = svgEl("g", {}, [box(380, 70, 220, 200, { stroke: C.torch }), txt(490, 110, "Mint wallet"), txt(490, 252, "only what you need", { "font-size": 15, fill: C.soft, "font-weight": 700 })]);
    const eggs = [0, 1, 2, 3].map((i) => egg({})), coins = [0, 1, 2, 3, 4].map(() => coin({}));
    const site = svgEl("g", {}, [box(-70, -24, 140, 48, { rx: 24, fill: "#5a2018", stroke: C.red }), txt(0, 7, "scam site", { "font-size": 17 })]);
    const shield = svgEl("circle", { cx: 150, cy: 170, r: 98, fill: "none", stroke: C.green, "stroke-width": 5 });
    const cut = txt(490, 320, "Only the small amount is at risk", { fill: C.torch, "font-size": 19 });
    const safe = txt(150, 320, "Your dragons stay safe", { fill: C.green, "font-size": 19 });
    [vault, mint, shield, ...eggs, ...coins, site, cut, safe].forEach((e) => g.appendChild(e));
    return (t) => {
      op(vault, ph(t, 0, .5)); op(mint, ph(t, .4, .5));
      eggs.forEach((e, i) => { op(e, ph(t, .8 + i * .15, .3)); mv(e, 75 + i * 50, 205, 0.6 + 0.4 * spring(ph(t, .8 + i * .15, .5))); });
      coins.forEach((c, i) => { const p = easeIO(ph(t, 2 + i * .12, 1)); const moving = i < 2; op(c, ph(t, 1.6, .3) * (moving || t < 2 ? 1 : 1)); const x0 = 80 + i * 35, y0 = 150; mv(c, moving ? lerp(x0, 450 + i * 50, p) : x0, moving ? lerp(y0, 180, p) - Math.sin(p * Math.PI) * 50 : y0); if (!moving) op(c, ph(t, 1.6, .3)); });
      const ps = easeOut(ph(t, 4, .8)); op(site, ph(t, 4, .3)); mv(site, lerp(700, 490, ps), 160);
      const dr = ph(t, 5.2, .9); coins.slice(0, 2).forEach((c, i) => { if (dr > 0) { mv(c, lerp(450 + i * 50, 490, dr), lerp(180, 160, dr), 1 - dr * 0.8); op(c, 1 - dr); } });
      op(shield, ph(t, 5.6, .4) * (0.6 + 0.4 * Math.sin(t * 4))); op(cut, ph(t, 6.2, .5)); op(safe, ph(t, 6.6, .5));
    }; } },
  // Lesson 4: one swapped letter in the address
  "4/1": { end: 8, build(g) {
    const real = "pocketdragons.example", fake = "pocketdragoms.example", k = real.split("").findIndex((c, i) => c !== fake[i]);
    const row = (y) => real.split("").map((c, i) => { const e = txt(80 + i * 23.5, y, c, { "font-family": "ui-monospace, Menlo, monospace", "font-size": 30, "font-weight": 700 }); g.appendChild(e); return e; });
    const top = row(120), bot = row(230);
    const l1 = txt(320, 70, "The real site", { fill: C.green, "font-size": 18 }), l2 = txt(320, 180, "The fake", { fill: C.red, "font-size": 18 });
    const ring = svgEl("circle", { r: 26, fill: "none", stroke: C.red, "stroke-width": 4 }), note = txt(320, 300, "One letter. That is all it takes.", { fill: C.torch, "font-size": 20 });
    [l1, l2, ring, note].forEach((e) => g.appendChild(e));
    return (t) => {
      op(l1, ph(t, 0, .4)); op(l2, ph(t, 1.6, .4));
      top.forEach((e, i) => { const p = ph(t, .2 + i * .04, .25); op(e, p); mv(e, 0, (1 - easeOut(p)) * 12); });
      bot.forEach((e, i) => { const p = ph(t, 1.8 + i * .04, .25); op(e, p); mv(e, 0, (1 - easeOut(p)) * 12); });
      const sw = ph(t, 3.4, .5); bot[k].textContent = sw > .5 ? fake[k] : real[k]; bot[k].setAttribute("fill", sw > .5 ? C.red : C.cream); mv(bot[k], 0, 0, 1 + 0.5 * Math.sin(sw * Math.PI));
      const pr = ph(t, 4.2, .5); op(ring, pr); mv(ring, 80 + k * 23.5, 220, 0.5 + 0.5 * spring(pr));
      op(note, ph(t, 5, .5));
    }; } },
  // Lesson 6: three steps, rising danger
  "6/1": { end: 8, build(g) {
    const steps = [["Connect", "sees your address", C.green], ["Sign", "words with power", C.torch], ["Send", "money moves", C.red]];
    const els = steps.map(([a, b, c], i) => { const e = svgEl("g", {}, [box(30 + i * 200, 90, 180, 150, { stroke: c }), txt(120 + i * 200, 155, a, { "font-size": 26 }), txt(120 + i * 200, 190, b, { "font-size": 15, fill: C.soft, "font-weight": 700 })]); g.appendChild(e); return e; });
    const meter = svgEl("rect", { x: 30, y: 280, height: 16, rx: 8, fill: C.red }), track = box(30, 280, 580, 16, { rx: 8, fill: "#1a1310", "stroke-width": 0 });
    const lab = txt(320, 330, "Read each step before you press", { fill: C.torch, "font-size": 19 });
    g.insertBefore(track, g.firstChild); [meter, lab].forEach((e) => g.appendChild(e));
    const grad = svgEl("linearGradient", { id: "dgm", x1: 0, x2: 1 }, [svgEl("stop", { offset: 0, "stop-color": C.green }), svgEl("stop", { offset: .5, "stop-color": C.torch }), svgEl("stop", { offset: 1, "stop-color": C.red })]);
    g.appendChild(svgEl("defs", {}, [grad])); meter.setAttribute("fill", "url(#dgm)");
    return (t) => { els.forEach((e, i) => { const p = ph(t, .3 + i * 1.3, .5); op(e, p); mv(e, 0, (1 - spring(p)) * 30); });
      meter.setAttribute("width", (580 * easeIO(ph(t, .5, 4))).toFixed(1)); op(lab, ph(t, 4.8, .5)); }; } },
  // Lesson 7: a Permit costs no gas, then the tokens walk out on their own
  "7/1": { end: 9, build(g) {
    const wal = svgEl("g", {}, [box(40, 80, 220, 190), txt(150, 118, "Your wallet")]);
    const spender = svgEl("g", {}, [box(400, 120, 200, 110, { stroke: C.red }), txt(500, 165, "Spender", { "font-size": 22 }), txt(500, 195, "0x7a3f…91c2", { "font-size": 15, fill: C.soft, "font-family": "ui-monospace, monospace" })]);
    const sig = svgEl("g", {}, [box(-95, -26, 190, 52, { rx: 26, fill: "#3b3a5c", stroke: "#8f8cd6" }), txt(0, 7, "Sign Permit", { "font-size": 18 })]);
    const free = txt(150, 300, "No gas. Felt like a login.", { fill: C.soft, "font-size": 17 });
    const pipe = svgEl("path", { d: "M260 175 C 320 175, 340 175, 400 175", stroke: C.red, "stroke-width": 6, fill: "none", "stroke-dasharray": "10 10" });
    const coins = [0, 1, 2, 3, 4, 5].map(() => coin()), note = txt(500, 300, "Later, without you", { fill: C.red, "font-size": 19 });
    [wal, spender, pipe, sig, free, ...coins, note].forEach((e) => g.appendChild(e));
    return (t) => { op(wal, ph(t, 0, .4)); op(sig, ph(t, .8, .3) * (1 - ph(t, 2.6, .4))); const pp = ph(t, 1.6, .35); mv(sig, 150, 244, 1 - 0.12 * Math.sin(pp * Math.PI)); op(free, ph(t, 1.9, .4));
      op(spender, ph(t, 2.8, .4)); op(pipe, ph(t, 3.2, .4)); pipe.setAttribute("stroke-dashoffset", (-t * 40).toFixed(1));
      coins.forEach((c, i) => { const x0 = 95 + (i % 3) * 55, y0 = 150 + Math.floor(i / 3) * 42, p = easeIO(ph(t, 4.4 + i * .35, .9)); op(c, ph(t, .3, .3) * (1 - ph(t, 4.4 + i * .35 + .8, .2))); mv(c, lerp(x0, 500, p), lerp(y0, 175, p) - Math.sin(p * Math.PI) * 40); });
      op(note, ph(t, 5, .5)); }; } },
  // Lesson 8: Disconnect leaves the approval in place; only revoke cuts it
  "8/1": { end: 9, build(g) {
    const site = svgEl("g", {}, [box(40, 100, 200, 120), txt(140, 168, "A site", { "font-size": 22 })]), you = svgEl("g", {}, [box(400, 100, 200, 120), txt(500, 168, "Your wallet", { "font-size": 22 })]);
    const conn = svgEl("path", { d: "M240 140 L400 140", stroke: C.soft, "stroke-width": 5 }), appr = svgEl("path", { d: "M240 185 L400 185", stroke: C.red, "stroke-width": 6, "stroke-dasharray": "10 8" });
    const lc = txt(320, 128, "connected", { "font-size": 14, fill: C.soft }), la = txt(320, 210, "approval", { "font-size": 14, fill: C.red });
    const b1 = svgEl("g", {}, [box(-80, -22, 160, 44, { rx: 22, fill: "#4b3c32" }), txt(0, 7, "Disconnect", { "font-size": 17 })]), b2 = svgEl("g", {}, [box(-70, -22, 140, 44, { rx: 22, fill: "#24533f", stroke: C.green }), txt(0, 7, "Revoke", { "font-size": 17 })]);
    const n1 = txt(320, 320, "Disconnect leaves the approval", { fill: C.red, "font-size": 18 }), n2 = txt(320, 320, "Revoke cuts it", { fill: C.green, "font-size": 20 });
    [site, you, conn, appr, lc, la, b1, b2, n1, n2].forEach((e) => g.appendChild(e));
    return (t) => { op(site, ph(t, 0, .4)); op(you, ph(t, .2, .4)); op(conn, ph(t, .6, .4) * (1 - ph(t, 2.4, .3))); op(lc, ph(t, .6, .4) * (1 - ph(t, 2.4, .3))); op(appr, ph(t, 1, .4) * (1 - ph(t, 5.6, .3))); op(la, ph(t, 1, .4) * (1 - ph(t, 5.6, .3)));
      appr.setAttribute("stroke-dashoffset", (-t * 30).toFixed(1));
      op(b1, ph(t, 1.6, .3) * (1 - ph(t, 3.4, .3))); mv(b1, 320, 270, 1 - .1 * Math.sin(ph(t, 2.2, .3) * Math.PI));
      op(n1, ph(t, 2.8, .4) * (1 - ph(t, 4.4, .3))); op(b2, ph(t, 4.4, .3)); mv(b2, 320, 270, 1 - .1 * Math.sin(ph(t, 5.2, .3) * Math.PI)); op(n2, ph(t, 6, .4)); }; } },
  // Lesson 10: one confirm fans out into several actions
  "10/1": { end: 8, build(g) {
    const btn = svgEl("g", {}, [box(-80, -28, 160, 56, { rx: 28, fill: "#3b3a5c", stroke: "#8f8cd6" }), txt(0, 8, "Confirm", { "font-size": 20 })]);
    const acts = [["Approve all NFTs", C.red], ["Send your dragons", C.red], ["Send your tokens", C.red]].map(([s, c], i) => { const e = svgEl("g", {}, [box(380, 50 + i * 90, 230, 64, { stroke: c }), txt(495, 90 + i * 90, s, { "font-size": 17 })]); return e; });
    const lines = [0, 1, 2].map((i) => svgEl("path", { d: `M220 180 C 300 180, 300 ${82 + i * 90}, 380 ${82 + i * 90}`, stroke: C.red, "stroke-width": 4, fill: "none", "stroke-dasharray": "300", "stroke-dashoffset": "300" }));
    const note = txt(320, 335, "One confirm, many actions", { fill: C.torch, "font-size": 20 });
    [...lines, btn, ...acts, note].forEach((e) => g.appendChild(e));
    return (t) => { op(btn, ph(t, 0, .4)); mv(btn, 140, 180, 1 - .12 * Math.sin(ph(t, 1.2, .3) * Math.PI));
      lines.forEach((l, i) => l.setAttribute("stroke-dashoffset", (300 * (1 - easeOut(ph(t, 1.6 + i * .3, .7)))).toFixed(1)));
      acts.forEach((a, i) => { const p = ph(t, 2.1 + i * .3, .4); op(a, p); mv(a, (1 - spring(p)) * 30, 0); }); op(note, ph(t, 3.8, .5)); }; } },
  // Lesson 13: a poisoned address starts and ends the same
  "13/1": { end: 9, build(g) {
    const A = "0x7a3f9c41d2e8b5a6f0c3e9d1b47c91c2", B = "0x7a3f02be77c1d90f3a5e8b2c6d1f91c2";
    const row = (y, s, lab, col) => { const items = s.split("").map((c, i) => { const e = txt(48 + i * 16.5, y, c, { "font-family": "ui-monospace, Menlo, monospace", "font-size": 21, "font-weight": 700 }); g.appendChild(e); return e; }); const l = txt(320, y - 34, lab, { fill: col, "font-size": 16 }); g.appendChild(l); return { items, l }; };
    const r1 = row(110, A, "The address you use", C.green), r2 = row(220, B, "Dropped in your history", C.red);
    const short1 = txt(320, 110, "0x7a3f…91c2", { "font-family": "ui-monospace, monospace", "font-size": 30 }), short2 = txt(320, 220, "0x7a3f…91c2", { "font-family": "ui-monospace, monospace", "font-size": 30 });
    const note = txt(320, 310, "Check the whole address, not the ends", { fill: C.torch, "font-size": 19 });
    [short1, short2, note].forEach((e) => g.appendChild(e));
    return (t) => { op(r1.l, ph(t, 0, .4)); op(r2.l, ph(t, 1, .4));
      const ex = ph(t, 3, .8); op(short1, ph(t, .2, .4) * (1 - ex)); op(short2, ph(t, 1.2, .4) * (1 - ex));
      [r1, r2].forEach((r, j) => r.items.forEach((e, i) => { const p = ph(t, 3 + i * .02, .5); op(e, p); const diff = A[i] !== B[i]; e.setAttribute("fill", diff && t > 4.4 ? (j ? C.red : C.green) : C.cream); mv(e, 0, diff && t > 4.4 ? -4 * Math.sin(ph(t, 4.4, .4) * Math.PI) : 0); }));
      op(note, ph(t, 5.2, .5)); }; } },
};
function Diagram(host, key) {
  const D = DIAGRAMS[key]; if (!D) return null;
  const fig = document.createElement("figure"); fig.className = "dg";
  const svg = svgEl("svg", { viewBox: "0 0 640 360", role: "img" }); svg.appendChild(svgEl("rect", { width: 640, height: 360, rx: 22, fill: C.bg }));
  const g = svgEl("g"); svg.appendChild(g); fig.appendChild(svg);
  const seek = D.build(g);
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn ghost dg-again"; btn.textContent = "↻ " + T("rpAgain", "Watch it again");
  fig.appendChild(btn);
  const body = host.querySelector(".body"); (body || host).insertAdjacentElement("afterend", fig);
  let raf = 0, played = false;
  const run = () => { cancelAnimationFrame(raf); played = true; const s0 = performance.now(); const step = (now) => { if (!fig.isConnected) return; const t = (now - s0) / 1000; seek(Math.min(t, D.end)); if (t < D.end) raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); };
  btn.onclick = run;
  window.GUARD_DIAGRAM = { seek, duration: D.end, run };
  if (RM.matches || /[?&]rpstill/.test(location.search)) { seek(D.end); return window.GUARD_DIAGRAM; }
  seek(0);
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !played) { io.disconnect(); setTimeout(run, 200); } }, { threshold: 0.4 });
  io.observe(fig);
  return window.GUARD_DIAGRAM;
}
// mark a flag simulator after "Done": right flags green, missed flags dashed, wrong taps crossed
function markFlags(root) {
  let ok = true; const notes = [];
  root.querySelectorAll("button.seg").forEach((b) => {
    const flag = b.dataset.flag === "1", on = b.getAttribute("aria-pressed") === "true";
    b.disabled = true;
    if (flag && on) b.classList.add("ok-flag");
    else if (flag) { b.classList.add("missed"); ok = false; }
    else if (on) { b.classList.add("wrong"); ok = false; }
  });
  return ok;
}
function flagWhy(x, root) {
  const all = allSegs(x), btns = root ? [...root.querySelectorAll(".seg")] : [];
  const rows = all.map((s, i) => {
    const b = btns[i], wrong = b && b.classList.contains("wrong"), missed = b && b.classList.contains("missed");
    if (!s.flag && !wrong) return "";
    const k = wrong ? "k-wrong" : missed ? "k-miss" : "k-ok", tag = wrong ? T("notFlag", "Not a red flag") : missed ? T("missedFlag", "Missed") : T("foundFlag", "Found");
    return `<li class="${k}"><i aria-hidden="true"></i><span><b>${esc(s.t.replace(/[.!?,:;]+$/, ""))}</b> <small>(${esc(tag)})</small>: ${esc(s.why)}</span></li>`;
  }).join("");
  return `<ul class="flagnote">${rows}</ul>`;
}
function wireFlags(root) {
  root.querySelectorAll("button.seg").forEach((b) => b.onclick = () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on); });
}

/* ---------- lesson ---------- */
async function lesson(m, c) {
  if (!isOpen(m)) { go("home"); return; }
  main.innerHTML = `<p class="muted">${esc(T("loading", "Loading…"))}</p>`;
  let d; try { d = await mod(m); } catch (e) { main.innerHTML = `<div class="panel">${esc(T("offline", "This lesson did not load. Check your connection and try again."))} <a href="#m${m}">${esc(T("retry", "Try again"))}</a></div>`; return; }
  const cards = d.cards, n = cards.length; c = Math.max(0, Math.min(n - 1, c || 0));
  const card = cards[c];
  if (c === 0 && !st(m).started) { st(m).started = 1; save(); tally(m, "start"); }
  let body = "";
  if (card.type === "scene" || card.type === "teach") {
    body = `${card.art ? `<div class="art" role="img" aria-label="${esc(T("illus", "Illustration"))}" style="background-image:url(${art(card.art)})"></div>` : ""}<h2>${esc(card.title)}</h2><p class="body">${esc(card.body)}</p>${card.points ? `<ul class="points">${card.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}${card.sim ? sim(card.sim, "show") : ""}`;
  } else if (card.type === "sim") {
    body = `<span class="eyebrow" style="color:#7a4a16">${esc(T("tryIt", "Try it"))}</span><h2>${esc(card.title)}</h2><p class="body">${esc(card.body)}</p><div id="lsim">${sim(card.sim, "flag")}</div><button class="btn ink" type="button" id="lcheck">${esc(T("doneFlag", "Done flagging"))}</button><div id="lfb"></div>`;
  } else {
    body = `<div class="rule-card stack">${seal()}<span class="eyebrow" style="color:#7a4a16">${esc(T("remember", "Remember this"))}</span><p class="takeaway">${esc(d.takeaway)}</p><div class="sources"><b>${esc(T("sources", "Sources"))}</b><ul>${d.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join("")}</ul></div></div>`;
  }
  const dots = cards.map((_, i) => `<i class="${i === c ? "on" : i < c ? "done" : ""}"></i>`).join("");
  const last = c === n - 1;
  main.innerHTML = `<div class="lesson-top"><a class="back" href="#home" aria-label="${esc(T("toHome", "Back to the hall"))}">${ico.back}</a><div><span class="eyebrow">${esc(T("lessonN", "Lesson {n} of 14", { n: m }))}</span><div style="font-weight:800">${esc(d.title)}</div></div><div class="dots" role="img" aria-label="${esc(T("cardOf", "Card {a} of {b}", { a: c + 1, b: n }))}">${dots}</div></div>
  <article class="parch card" aria-live="polite">${body}</article>
  <div class="nav">${c > 0 ? `<a class="btn ghost" href="#m${m}/${c - 1}">${esc(T("back", "Back"))}</a>` : ""}<a class="btn main" id="next" href="${last ? "#honour/" + m : "#m" + m + "/" + (c + 1)}">${esc(last ? T("toQuiz", "Go to the quiz") : T("next", "Next"))}</a></div>`;
  if (lang !== "en" && c === 0) main.querySelector(".card").insertAdjacentHTML("afterbegin", `<p class="small chip">${esc(T("enOnly", "Lessons are in English for now. Your browser's translator is fine to use."))}</p>`);
  if (last && !st(m).read) { st(m).read = 1; touchDay(); save(); }
  if (card.type === "scene" && card.sim) Replay(main.querySelector(".card"), card.sim);
  if (card.type === "teach") Diagram(main.querySelector(".card"), m + "/" + c);
  if (card.type === "sim") {
    const root = $("#lsim"); wireFlags(root);
    $("#lcheck").onclick = () => { const ok = markFlags(root); $("#lcheck").hidden = true; $("#lfb").innerHTML = `<div class="fb ${ok ? "ok" : "no"}"><h3>${esc(ok ? T("allFound", "You found every flag") : T("someMissed", "Here is what to look for"))}</h3>${flagWhy(card.sim, root)}</div>`; say(ok ? T("allFound", "You found every flag") : T("someMissed", "Here is what to look for")); };
  }
  // the next card's picture loads while this one is read
  const nx = cards[c + 1]; if (nx && nx.art) { const i = new Image(); i.src = art(nx.art); }
  window.scrollTo(0, 0);
}

/* ---------- honour card ---------- */
function honour(which) {
  const isDaily = which === "daily", isDrill = which === "drill" || isDaily, m = isDrill ? 0 : +which;
  if (!isDrill && !isOpen(m)) { go("home"); return; }
  const mode = S.timer || (lang !== "en" ? "relaxed" : "on");
  main.innerHTML = `<div class="lesson-top"><a class="back" href="${isDrill ? "#home" : "#m" + m}" aria-label="${esc(T("backLesson", "Back to the lesson"))}">${ico.back}</a></div>
  <section class="parch honour stack" aria-labelledby="hh">${seal()}<h2 id="hh">${esc(T("hTitle", "On your honour"))}</h2>
  <div class="lines"><p>${esc(T("h1", "This quiz is for you, not for a score."))}</p><p><b>${esc(T("h2", "Answer from what you just learned. No AI, no search, no friend helping."))}</b></p><p>${esc(T("h3", "Reading it in your own language with a translator is fine."))}</p><p>${esc(T("h4", "A wrong answer here costs nothing and teaches you something. A wrong click later can cost your dragons."))}</p></div>
  <div class="stack" style="justify-items:center"><span class="small" style="font-weight:800" id="tml">${esc(T("timer", "Timer"))}</span><div class="seg3" role="group" aria-labelledby="tml">${[["on", T("tOn", "On")], ["relaxed", T("tRelaxed", "Relaxed")], ["off", T("tOff", "Off")]].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${mode === k}">${esc(l)}</button>`).join("")}</div><p class="small muted">${esc(T("urgency", "In real life, take all the time you need. Urgency is the red flag."))}</p></div>
  <a class="btn main wide" href="#q" id="swear2">${esc(T("hBtn", "I answer on my own"))}</a>
  ${isDrill ? "" : `<a href="#m${m}">${esc(T("backLesson", "Back to the lesson"))}</a>`}</section>`;
  let chosen = mode;
  main.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { chosen = b.dataset.mode; main.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", x === b)); });
  $("#swear2").onclick = async (e) => {
    e.preventDefault(); S.timer = chosen; save();
    try { await startQuiz(isDrill ? "drill" : m, chosen, isDaily ? "daily" : ""); } catch (err) { return; }
    location.hash = "q";
  };
}

/* ---------- building a quiz: 4 new + 2 review, scenarios first, spaced repeats ---------- */
async function startQuiz(m, mode, kind) {
  const today = dayNo(localKey());
  const r = rng(S.id + ":" + m + ":" + (kind || "") + ":" + (m === "drill" ? localKey() : st(m).tries));
  let ids = [];
  if (m === "drill") {
    const pool = [];
    const oc = openCount();
    for (let k = 1; k <= oc; k++) { const d = await mod(k); d.questions.forEach((q) => pool.push(q.id)); }
    const due = Object.entries(S.items).filter(([, v]) => v.due && v.due.some((x) => x <= today)).map(([k]) => k);
    const size = kind === "daily" ? 3 : 5;     // the daily guard questions are three, the drill five
    ids = shuffle(due, r).slice(0, kind === "daily" ? 1 : 3);
    for (const q of shuffle(pool, r)) { if (ids.length >= size) break; if (!ids.includes(q)) ids.push(q); }
  } else {
    const d = await mod(m), s = st(m);
    const seenIds = s.seen || [];
    // fresh questions first, then ones seen before, so a retake is never short
    const pool = shuffle(d.questions.filter((q) => !seenIds.includes(q.id)), r).concat(shuffle(d.questions.filter((q) => seenIds.includes(q.id)), r));
    const reviews = [];
    const due = Object.entries(S.items).filter(([k, v]) => !k.startsWith("m" + m + "q") && v.due && v.due.some((x) => x <= today)).sort((a, b) => Math.min(...a[1].due) - Math.min(...b[1].due)).map(([k]) => k);
    reviews.push(...due.slice(0, 2));
    const doneMods = Object.keys(S.mods).map(Number).filter((k) => k !== m && S.mods[k].done);
    while (reviews.length < 2 && doneMods.length) {
      const k = doneMods[Math.floor(r() * doneMods.length)];
      const dd = await mod(k); const q = dd.questions[Math.floor(r() * dd.questions.length)];
      if (!reviews.includes(q.id)) reviews.push(q.id); else break;
    }
    const nNew = 6 - reviews.length;
    // scenarios first: flag and situation questions are the point
    const picked = pool.slice(0, nNew).map((q) => q.id);
    ids = shuffle(picked.concat(reviews), r);
  }
  S.quiz = { m, mode, ids, i: 0, ans: [], left: null, at: Date.now(), kind: kind || "" };
  save();
  if (m !== "drill") tally(m, "quiz");
}
async function qById(id) { const m = +id.match(/^m(\d+)q/)[1]; const d = await mod(m); return d.questions.find((q) => q.id === id); }

/* ---------- the quiz ---------- */
let tick = null, last = 0, paused = false, answered = false;
const baseTime = (q) => q.kind === "flag" ? 50 : 35;
function timeFor(q, mode) { const t = baseTime(q); return mode === "relaxed" ? t * 2 : t; }
async function quizView() {
  const Q = S.quiz;
  if (!Q) { go("home"); return; }
  if (Q.i >= Q.ids.length) { finishQuiz(); return; }
  const q = await qById(Q.ids[Q.i]);
  if (!q) { Q.i++; save(); quizView(); return; }
  answered = false; paused = false; plusUsed = false;
  const total = timeFor(q, Q.mode);
  if (Q.left == null || Q.left > total + 20) Q.left = total;
  const timed = Q.mode !== "off";
  simN = 0;
  main.innerHTML = `<div class="q-top"><span class="count">${esc(T("qOf", "Question {a} of {b}", { a: Q.i + 1, b: Q.ids.length }))}</span>${timed ? `<button class="plus" type="button" id="plus" hidden>${esc(T("plus20", "+20 s"))}</button><div class="ring" id="ring" role="timer" aria-label="${esc(T("timeLeft", "Time left"))}"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="28"/><circle class="fg" id="fg" cx="32" cy="32" r="28" stroke-dasharray="175.9" stroke-dashoffset="0"/></svg><b id="secs">${Math.ceil(Q.left)}</b></div>` : `<span class="chip" style="margin-left:auto">${esc(T("noTimer", "No timer"))}</span>`}</div>
  <section class="parch stack" id="qcard">${!q.sim ? `<div class="q-art" aria-hidden="true" style="background-image:url(${art(qArt(q.id))})"></div>` : ""}<p class="stem" id="stem">${esc(q.stem)}</p>${q.sim ? `<div id="qsim">${sim(q.sim, q.kind === "flag" ? "flag" : "show")}</div>` : ""}
  ${q.kind === "choice" ? `<div class="opts" role="group" aria-labelledby="stem">${optOrder(q).map(([o, i], k) => `<button type="button" class="opt" data-i="${i}"><span class="k" aria-hidden="true">${"ABCD"[k]}</span><span>${esc(o)}</span></button>`).join("")}</div>` : `<button class="btn ink" type="button" id="qdone">${esc(T("doneFlag", "Done flagging"))}</button>`}
  <div id="qfb" aria-live="polite"></div></section>`;
  if (q.kind === "flag") { wireFlags($("#qsim")); $("#qdone").onclick = () => answer(q, null); }
  else main.querySelectorAll(".opt").forEach((b) => b.onclick = () => answer(q, +b.dataset.i));
  window.scrollTo(0, 0);
  clearInterval(tick);
  const prev = Q.ans[Q.i];
  if (prev && prev.id === q.id) { const d = $("#qdone"); if (d) d.hidden = true; answer(q, prev.time ? "time" : prev.pick, prev); return; }
  if (timed) { last = performance.now(); paint(total); tick = setInterval(() => step(q, total), 250); $("#plus").onclick = () => { if (plusUsed) return; plusUsed = true; Q.left += 20; $("#plus").hidden = true; paint(total); save(); }; }
}
let plusUsed = false;
// each question without a scene gets one of its lesson's pictures, the same one every time
function qArt(id) { const [, m, k] = id.match(/^m(\d+)q(\d+)/); const mt = meta(+m), a = mt.arts && mt.arts.length ? mt.arts : [mt.art]; return a[(+k) % a.length]; }
function optOrder(q) { const r = rng(S.id + q.id); return shuffle(q.options.map((o, i) => [o, i]), r); }
function step(q, total) {
  const Q = S.quiz; const t = performance.now(), dt = (t - last) / 1000; last = t;
  if (paused || answered || document.hidden) return;
  Q.left = Math.max(0, Q.left - dt);
  paint(total);
  if (Math.floor(Q.left) !== Math.floor(Q.left + dt)) save();
  if (Q.left <= 0) answer(q, "time");
}
function paint(total) {
  const Q = S.quiz, fg = $("#fg"), ring = $("#ring"); if (!fg) return;
  fg.style.strokeDashoffset = String(175.9 * (1 - Math.min(1, Q.left / total)));
  $("#secs").textContent = Math.ceil(Q.left);
  const low = Q.left <= 10; ring.classList.toggle("low", low);
  const pl = $("#plus"); if (pl) pl.hidden = !low || plusUsed || answered;
  if (low && !ring.dataset.said) { ring.dataset.said = 1; say(T("tenLeft", "Ten seconds left")); }
}
async function answer(q, pick, replay) {
  if (answered) return; answered = true; clearInterval(tick);
  const Q = S.quiz; let ok;
  if (q.kind === "flag" && replay) main.querySelectorAll("#qsim button.seg").forEach((b, i) => b.setAttribute("aria-pressed", (replay.taps || []).includes(i)));
  const taps = q.kind === "flag" ? [...main.querySelectorAll("#qsim button.seg")].map((b, i) => b.getAttribute("aria-pressed") === "true" ? i : -1).filter((i) => i >= 0) : null;
  if (q.kind === "flag") ok = pick === "time" ? (markFlags($("#qsim")), false) : markFlags($("#qsim"));
  else {
    ok = pick === q.answer;
    main.querySelectorAll(".opt").forEach((b) => { const i = +b.dataset.i; b.disabled = true; if (i === q.answer) b.classList.add("right"); else if (i === pick) b.classList.add("wrongpick"); });
    if (q.sim) { const s = $("#qsim"); s.innerHTML = sim(q.sim, "reveal"); }
  }
  if (pick === "time" && q.kind === "flag") main.querySelectorAll("button.seg").forEach((b) => { b.disabled = true; });
  { const d = $("#qdone"); if (d) d.hidden = true; }
  if (!replay) {
    Q.ans[Q.i] = { id: q.id, ok, time: pick === "time", pick, taps };
    // spacing: a miss comes back after 1, 3 and 7 days (a right answer on a review keeps the later dates), a first pass once after 7
    const today = dayNo(localKey()), it = S.items[q.id] || {};
    if (ok) { it.due = (it.due || []).filter((x) => x > today); if (!it.due.length && !it.seenOk) it.due = [today + 7]; it.seenOk = 1; }
    else it.due = [today + 1, today + 3, today + 7];
    S.items[q.id] = it;
    if (Q.m !== "drill" && Q.kind !== "practice") { const s = st(Q.m); s.seen = Array.from(new Set((s.seen || []).concat(q.id))); }
    Q.left = null; save();
  }
  const title = ok ? T("right", "Right") : pick === "time" ? T("timeUp", "Time is up. Here is the answer.") : T("notQuite", "Not quite. Here is why.");
  const correct = q.kind === "choice" ? `<p><b>${esc(T("answerIs", "The answer"))}:</b> ${esc(q.options[q.answer])}</p>` : "";
  const flags = q.sim && allSegs(q.sim).some((s) => s.flag) ? flagWhy(q.sim, $("#qsim")) : "";
  $("#qfb").innerHTML = `<div class="fb ${ok ? "ok" : "no"}"><h3>${esc(title)}</h3>${correct}<p>${esc(q.why)}</p>${flags}</div><button class="btn main wide" type="button" id="qnext">${esc(Q.i + 1 >= Q.ids.length ? T("seeResult", "See how you did") : T("nextQ", "Next question"))}</button>`;
  say(title + ". " + q.why);
  const pl = $("#plus"); if (pl) pl.hidden = true;
  $("#qnext").onclick = () => { Q.i++; save(); quizView(); };
  if (!replay) { $("#qnext").focus({ preventScroll: true }); $("#qfb").scrollIntoView({ behavior: RM.matches ? "auto" : "smooth", block: "nearest" }); }
}
document.addEventListener("visibilitychange", () => {
  if (route !== "q" || !S.quiz || answered) return;
  if (document.hidden) { save(); return; }
  last = performance.now();
  if (!$("#cover")) { const c = document.createElement("div"); c.className = "cover"; c.id = "cover"; c.innerHTML = `<div class="panel"><h3>${esc(T("paused", "Paused"))}</h3><p>${esc(T("pausedWhy", "The timer stopped while you were away. The question is hidden so it stays fair."))}</p><button class="btn main" type="button">${esc(T("resume", "Carry on"))}</button></div>`; document.body.appendChild(c); paused = true; c.querySelector("button").onclick = () => { c.remove(); paused = false; last = performance.now(); }; c.querySelector("button").focus(); }
});
// the cover goes up the moment the tab hides, so nothing can be read from the app switcher
document.addEventListener("visibilitychange", () => { if (document.hidden && route === "q" && S.quiz && !answered) { const q = $("#qcard"); if (q) q.style.visibility = "hidden"; } else { const q = $("#qcard"); if (q) q.style.visibility = ""; } });
function leaveSheet() {
  const w = $("#sheet");
  paused = true;
  w.innerHTML = `<div class="panel dlg" role="dialog" aria-modal="true" aria-labelledby="lvh"><h3 id="lvh">${esc(T("leaveQ", "Leave the quiz?"))}</h3><p>${esc(T("leaveWhy", "Your progress is kept. You can carry on later from this question."))}</p><div class="btn-row"><button class="btn main" type="button" id="stay">${esc(T("stay", "Stay"))}</button><button class="btn ghost" type="button" id="leave">${esc(T("leave", "Leave"))}</button></div></div>`;
  w.hidden = false; $("#stay").focus({ preventScroll: true });
  $("#stay").onclick = () => { w.hidden = true; paused = false; last = performance.now(); };
  $("#leave").onclick = () => { w.hidden = true; paused = false; clearInterval(tick); leaving = true; quizActive = false; location.hash = "home"; };
}

/* ---------- result ---------- */
let lastResult = null;
function finishQuiz() {
  const Q = S.quiz, score = Q.ans.filter((a) => a && a.ok).length, n = Q.ids.length;
  const missed = Q.ans.filter((a) => a && !a.ok).map((a) => a.id);
  if (Q.m === "drill") { if (Q.kind !== "daily") S.drills[CFG.drills[utcKey()] ? utcKey() : "w" + isoWeek()] = 1; }
  else if (Q.kind === "practice") { const s = st(Q.m); if (score >= 5) { s.need = 0; s.pass = 1; } }
  else {
    const s = st(Q.m); s.tries++; s.best = Math.max(s.best, score); s.done = s.done || Date.now();
    const passed = score >= 5; if (passed) { s.pass = 1; s.need = 0; } else if (s.tries >= 2 && !s.pass) s.need = 1;
    if (passed && Q.mode !== "off" && Q.ans.every((a) => !a.time)) s.swift = 1;
    tally(Q.m, "done", score);
  }
  touchDay();
  S.qd = S.qd || {}; S.qd[localKey()] = 1;     // any guard quiz finished today fills the Dragon Guard step of the pdtools daily goal
  lastResult = { m: Q.m, score, n, missed, mode: Q.mode, kind: Q.kind };
  S.quiz = null; quizActive = false; save();
  leaving = true; location.replace("#done");
}
async function resultView() {
  const R = lastResult; if (!R) { go("home"); return; }
  const pass = R.m === "drill" ? R.score >= (R.kind === "daily" ? 2 : 4) : R.score >= 5, s = R.m === "drill" ? null : st(R.m);
  const stars = [R.score >= 3, pass, !!(s && s.swift)];
  const msgs = [];
  for (const id of R.missed) { const q = await qById(id); if (!q) continue;
    const ctx = q.sim ? (q.sim.kind === "dm" ? "@" + q.sim.from.handle : q.sim.kind === "post" ? "@" + q.sim.account.handle : q.sim.site || (q.sim.url ? q.sim.url.map((x) => typeof x === "string" ? x : x.t).join("") : "")) : "";
    const ans = q.kind === "choice" ? `<br><b>${esc(T("answerIs", "The answer"))}:</b> ${esc(q.options[q.answer])}` : `<br><b>${esc(T("theFlags", "The red flags"))}:</b> ${esc(allSegs(q.sim).filter((x) => x.flag).map((x) => x.label).join(", "))}`;
    msgs.push(`<li><b>${esc(q.stem)}</b>${ctx ? ` <small>(${esc(ctx)})</small>` : ""}${ans}<br>${esc(q.why)}</li>`); }
  let next = "";
  if (R.m === "drill") next = (R.kind === "daily" ? `<p class="chip good">${esc(T("dailyGoal", "Your Dragon Guard step on pdtools is done for today."))}</p><a class="btn main wide" href="/friends">${esc(T("toFeed", "Back to Blinky's Friends"))}</a>` : "") + `<a class="btn ${R.kind === "daily" ? "ghost" : "main"} wide" href="#home">${esc(T("toHall", "Back to the hall"))}</a>`;
  else if (pass) next = `<a class="btn main wide" href="#home">${esc(T("toHall", "Back to the hall"))}</a><button class="btn ghost wide" type="button" id="share">${esc(T("shareCard", "Make my guard card"))}</button>`;
  else if (s.tries < 2) next = `<a class="btn main wide" href="#m${R.m}/${(MODS[R.m] ? MODS[R.m].cards.length : 1) - 1}">${esc(T("reread", "Read the summary, then try again"))}</a><a class="btn ghost wide" href="#home">${esc(T("later", "Later"))}</a>`;
  else next = `<p>${esc(T("needsWhy", "This lesson is marked Needs review. Practise now without a timer, or again tomorrow. The next lesson still opens on its day."))}</p><a class="btn main wide" href="#m${R.m}">${esc(T("rereadL", "Read the lesson again"))}</a><button class="btn ghost wide" type="button" id="practise">${esc(T("practiseU", "Practise without a timer"))}</button><a class="btn ghost wide" href="#home">${esc(T("toHall", "Back to the hall"))}</a>`;
  main.innerHTML = `<section class="parch result stack"><div class="res-art" style="background-image:url(${art(pass ? "shield" : "owl")})" aria-hidden="true"></div><div class="stars" role="img" aria-label="${esc(T("starsLbl", "{n} of 3 stars", { n: stars.filter(Boolean).length }))}">${stars.map((x) => `<span class="${x ? "on" : "off"}">${ico.star}</span>`).join("")}</div>
  <p class="score"><span id="scn">${R.score}</span> / ${R.n}</p><h2>${esc(pass ? T("passed", "Well guarded") : R.score <= 2 ? T("almost0", "A new topic. Let us learn it together.") : T("almost", "Good effort. A few to go over."))}</h2>
  <p class="muted">${esc(pass ? T("passWhy", "Every right answer is a scam you will spot in real life.") : R.score <= 2 ? T("almostWhy0", "Every answer below explains one scam. They come back in later quizzes so they stick.") : T("almostWhy", "Missing a few here is how you learn. These come back in later quizzes so they stick."))}</p>
  ${msgs.length ? `<div style="text-align:left;width:100%"><h3>${esc(T("youMissed", "You missed these"))}</h3><ul class="stack" style="padding-left:18px">${msgs.join("")}</ul></div>` : ""}
  ${next}</section>`;
  const sh = $("#share"); if (sh) sh.onclick = shareCard;
  { const sec = main.querySelector(".result"); sec.classList.add(RM.matches ? "still" : "moving"); countUp($("#scn"), R.score); if (pass) embers(sec.querySelector(".res-art")); }
  const pr = $("#practise"); if (pr) pr.onclick = async () => { await startQuiz(R.m, "off", "practice"); location.hash = "q"; };
  if (pass && !RM.matches && R.m !== "drill") confetti();
}
function confetti() { /* a few embers rise, quietly */
  const c = document.createElement("canvas"); c.width = innerWidth; c.height = innerHeight; c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:30"; document.body.appendChild(c);
  const x = c.getContext("2d"), P2 = Array.from({ length: 46 }, () => ({ x: Math.random() * c.width, y: c.height + Math.random() * 80, v: 1 + Math.random() * 2.6, r: 1.5 + Math.random() * 3, a: 1 }));
  let f = 0; (function fr() { x.clearRect(0, 0, c.width, c.height); P2.forEach((p) => { p.y -= p.v; p.x += Math.sin((p.y + f) / 40); p.a -= .006; x.fillStyle = `rgba(255,${150 + Math.random() * 60 | 0},80,${Math.max(0, p.a)})`; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill(); }); if (++f < 170) requestAnimationFrame(fr); else c.remove(); })();
}

/* ---------- the guard card (no answers, no score, nothing to claim) ---------- */
async function shareCard() {
  const W = 1200, H = 675, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  try { await document.fonts.load("700 40px Fredoka"); await document.fonts.load("800 20px Nunito"); } catch (e) {}
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = art("hall", 1280); });
  if (img) { const s = Math.max(W / img.width, H / img.height); x.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s); }
  const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, "rgba(23,17,14,.94)"); g.addColorStop(.62, "rgba(23,17,14,.72)"); g.addColorStop(1, "rgba(23,17,14,.25)"); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const rk = rank();
  x.fillStyle = "#ffb257"; x.font = "800 24px Nunito, sans-serif"; x.fillText(T("cardEyebrow", "POCKET DRAGONS COMMUNITY").toUpperCase(), 72, 110, 1050);
  x.fillStyle = "#f7ecd5"; x.font = "700 86px Fredoka, sans-serif"; x.fillText(T("cardTitle", "I stand guard"), 72, 205, 1050);
  x.font = "700 46px Fredoka, sans-serif"; x.fillStyle = "#ffcf7f"; x.fillText(T("rankIs", "Rank: {r}", { r: rk.name }), 72, 290, 1050);
  x.font = "700 30px Nunito, sans-serif"; x.fillStyle = "#e9dcc2";
  x.fillText(T("cardLine", "{n} of 14 Dragon Guard lessons done", { n: modsDone() }), 72, 350, 1050);
  x.fillText(T("cardLine2", "I spot scams before they reach my dragons."), 72, 395, 1050);
  x.font = "800 24px Nunito, sans-serif"; x.fillStyle = "#f7ecd5"; x.fillText(T("cardSafe", "No badge to claim. No NFT. No wallet step."), 72, 520, 1050);
  x.fillStyle = "#ffb257"; x.font = "800 30px Nunito, sans-serif"; x.fillText("pdtools.xyz/guard", 72, 575);
  x.fillStyle = "#d9c7a6"; x.font = "600 22px Nunito, sans-serif"; const by = "Built by "; x.fillText(by, 72, 620); const w1 = x.measureText(by).width; x.font = "900 22px Nunito, sans-serif"; x.fillStyle = "#f7ecd5"; x.fillText("Jon Wynn", 72 + w1, 620);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const file = blob && new File([blob], "dragon-guard.png", { type: "image/png" });
  const text = T("shareText", "I am training with Dragon Guard on pdtools: one short safety lesson a day for the Pocket Dragons community. pdtools.xyz/guard");
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text }); tally(0, "share"); return; } catch (e) { if (e && e.name === "AbortError") return; } }
  const url = URL.createObjectURL(blob);
  const w = $("#sheet");
  w.innerHTML = `<div class="panel dlg" role="dialog" aria-modal="true" aria-labelledby="sch"><h3 id="sch">${esc(T("yourCard", "Your guard card"))}</h3><img class="share-img" src="${url}" alt="${esc(T("cardAlt", "Dragon Guard card with your rank"))}" width="1200" height="675"><p class="small">${esc(T("longPress", "Press and hold the picture to save it, or right click and save on a computer."))}</p><div class="codebox" id="stx">${esc(text)}</div><div class="btn-row"><button class="btn ghost" type="button" id="cpt">${esc(T("copyText", "Copy the post text"))}</button><button class="btn main" type="button" id="cls">${esc(T("close", "Close"))}</button></div></div>`;
  w.hidden = false; $("#cls").focus({ preventScroll: true });
  $("#cls").onclick = () => { w.hidden = true; URL.revokeObjectURL(url); };
  $("#cpt").onclick = () => copy(text, $("#cpt"));
  tally(0, "card");
}
function copy(t, btn) {
  const done = () => { const o = btn.textContent; btn.textContent = T("copied", "Copied"); setTimeout(() => { btn.textContent = o; }, 1400); };
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, () => sel()); else sel();
  function sel() { const r = document.createRange(); const box = btn.closest(".lk,.dlg,.parch"); const n = (box && box.querySelector(".lk-url,.codebox")) || btn; r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}

/* ---------- trusted links ---------- */
const LINKS = [
  ["revoke.cash", "https://revoke.cash/", "Check and revoke token approvals. Searching by address needs no wallet connection."],
  ["Etherscan token approval checker", "https://etherscan.io/tokenapprovalchecker", "Etherscan's own approval list for an address."],
  ["Chainabuse", "https://chainabuse.com/", "Report a scam, or check if an address was reported."],
  ["ethereum.org: avoid scams", "https://ethereum.org/en/community/support/scams/", "Plain guide to common crypto scams."],
  ["Flashbots Whitehat Hotline", "https://whitehat.flashbots.net/", "Help to rescue stuck assets from a leaked wallet."]
];
function linksHtml() {
  const off = (CFG.official || []).map(([n, u]) => `<div class="lk"><div><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a><small class="lk-url">${esc(u)}</small></div><button class="copy" type="button" data-copy="${esc(u)}">${esc(T("copy", "Copy"))}</button></div>`).join("");
  return `<p class="small muted">${esc(T("bookmark", "Bookmark these. Never reach them through a search ad or a link in a DM."))}</p><div class="links">${LINKS.map(([n, u, d]) => `<div class="lk"><div><a href="${u}" target="_blank" rel="noopener noreferrer">${esc(n)}</a><small class="lk-url">${esc(u)}</small><small>${esc(T("l_" + n, d))}</small></div><button class="copy" type="button" data-copy="${u}">${esc(T("copy", "Copy"))}</button></div>`).join("")}</div>
  <h3>${esc(T("officialPD", "Official Pocket Dragons"))}</h3>${off ? `<div class="links">${off}</div>` : `<p class="small">${esc(T("officialSoon", "The team will confirm the official links for this list. Until then: trust only links posted by the official Pocket Dragons accounts, and check them on two channels."))}</p>`}
  <p class="small muted">${esc(T("noMint", "pdtools will never post a mint link or a contract address."))}</p>`;
}
function lkRow(n, u) { return `<div class="lk"><div><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a><small class="lk-url">${esc(u)}</small></div><button class="copy" type="button" data-copy="${esc(u)}">${esc(T("copy", "Copy"))}</button></div>`; }
function wireCopy(root) { root.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => copy(b.dataset.copy, b)); }
function linksView() {
  main.innerHTML = `<div class="lesson-top"><a class="back" href="#home" aria-label="${esc(T("toHome", "Back to the hall"))}">${ico.back}</a><h2>${esc(T("links", "Trusted links"))}</h2></div><section class="parch stack"><div class="art tool-art" style="background-image:url(${art("shield")})" role="img" aria-label="${esc(T("illus", "Illustration"))}"></div>${linksHtml()}</section>`;
  wireCopy(main);
}
$("#links-btn").onclick = () => {
  const w = $("#sheet");
  w.innerHTML = `<div class="parch dlg" role="dialog" aria-modal="true" aria-labelledby="lh"><h3 id="lh">${esc(T("links", "Trusted links"))}</h3>${linksHtml()}<button class="btn ink" type="button" id="lclose">${esc(T("close", "Close"))}</button></div>`;
  w.hidden = false; wireCopy(w); $("#lclose").focus({ preventScroll: true });
  const close = () => { w.hidden = true; $("#links-btn").focus(); };
  $("#lclose").onclick = close; w.onclick = (e) => { if (e.target === w) close(); }; w.onkeydown = (e) => { if (e.key === "Escape") close(); };
};

/* ---------- the emergency page ---------- */
function helpView() {
  main.innerHTML = `<div class="lesson-top"><a class="back" href="#home" aria-label="${esc(T("toHome", "Back to the hall"))}">${ico.back}</a><h2>${esc(T("drained", "I think I got drained"))}</h2></div>
  <section class="parch stack"><p style="font-size:19px;font-weight:800">${esc(T("e0", "Scammers are professionals. Anyone can be fooled. Acting fast is what matters."))}</p>
  <ol class="steps">
   <li><div><b>${esc(T("e1", "Find out which case you are in, on a clean device."))}</b>${esc(T("e1b", "Many tokens or chains gone, including ETH: your seed phrase or key leaked. Tokens taken through one contract: an approval or a signature."))}</div></li>
   <li><div><b>${esc(T("e2", "If it was an approval or signature: revoke that spender now."))}</b>${lkRow("revoke.cash", "https://revoke.cash/")}</div></li>
   <li><div><b>${esc(T("e3", "If your seed phrase or key leaked: treat that wallet as lost."))}</b><ul><li>${esc(T("e3a", "Make a new wallet on a clean device. Do not reuse the same cloud login."))}</li><li>${esc(T("e3b", "Move what is left to it."))}</li><li><b>${esc(T("e3c", "Never send ETH to a wallet you think is swept. A bot takes it at once."))}</b></li><li>${esc(T("e3d", "For more than about $1,000 stuck, contact the Flashbots Whitehat Hotline."))} ${lkRow("Flashbots Whitehat Hotline", "https://whitehat.flashbots.net/")} <small>${esc(T("e3e", "(it opens a Flashbots page on notion.site, which is expected)"))}</small></li></ul></div></li>
   <li><div><b>${esc(T("e4", "Stop using the old wallet, and lock down your accounts."))}</b>${esc(T("e4b", "Protect your email, X and Discord with an authenticator app or a passkey, not text messages."))}</div></li>
   <li><div><b>${esc(T("e5", "Ignore every recovery helper."))}</b>${esc(T("e5b", "People who offer to get your funds back are running a second scam. Stolen funds cannot be pulled back on chain."))}</div></li>
   <li><div><b>${esc(T("e6", "Report it."))}</b><ul><li>${lkRow("Chainabuse", "https://chainabuse.com/")}</li><li>${esc(T("e6b", "Your local police cybercrime unit (in the US: IC3)."))}</li><li>${esc(T("e6c", "The exchange, if the funds went to one."))}</li><li>${esc(T("e6d", "The Pocket Dragons team, only through a ticket in the official Discord, never a DM."))}</li></ul></div></li>
  </ol><p class="warn">${esc(T("eWarn", "Nobody from pdtools or the team will DM you to help. Anyone who does is not helping."))}</p>
  <p class="small muted">${esc(T("eSrc", "Based on revoke.cash, MetaMask support and Flashbots guidance."))}</p></section>`;
  wireCopy(main);
}
function promiseView() {
  main.innerHTML = `<div class="lesson-top"><a class="back" href="#home" aria-label="${esc(T("toHome", "Back to the hall"))}">${ico.back}</a><h2>${esc(T("promise", "pdtools safety promise"))}</h2></div>
  <section class="parch stack"><div class="art tool-art" style="background-image:url(${art("seal")})" role="img" aria-label="${esc(T("illus", "Illustration"))}"></div><ul class="points"><li>${esc(T("p1", "pdtools will never ask you to connect a wallet."))}</li><li>${esc(T("p2", "pdtools will never ask for your seed phrase, a private key or a signature."))}</li><li>${esc(T("p3", "pdtools will never DM you first, and has no support desk in DMs."))}</li><li>${esc(T("p4", "pdtools will never post a mint link, a claim link or a contract address."))}</li><li>${esc(T("p5", "Dragon Guard has no badge to claim, no NFT and no wallet step."))}</li><li>${esc(T("p6", "pdtools lives only at pdtools.xyz. Type it yourself."))}</li></ul>
  <p class="small muted">${esc(T("p7", "pdtools is an unofficial community tool. It is not run by the Pocket Dragons team."))}</p></section>`;
}
function checkView() {
  main.innerHTML = `<div class="lesson-top"><a class="back" href="#home" aria-label="${esc(T("toHome", "Back to the hall"))}">${ico.back}</a><h2>${esc(T("checkDay", "Check Day"))}</h2></div>
  <section class="parch stack"><div class="art" style="aspect-ratio:16/9;border-radius:18px;background:#2a1d14 url(${art("eye")}) center/cover"></div><p>${esc(T("cIntro", "Every Monday and Thursday, take two minutes to see what your wallet allows other contracts to do."))}</p>
  <ol class="steps"><li><div><b>${esc(T("c1", "Open revoke.cash from your bookmark."))}</b>${esc(T("c1b", "Paste your wallet address into the search box. Looking needs no wallet connection."))}</div></li>
  <li><div><b>${esc(T("c2", "Read the list."))}</b>${esc(T("c2b", "Each line is a contract you allowed to move a token or your NFTs. Look for ones you do not use or do not recognise."))}</div></li>
  <li><div><b>${esc(T("c3", "Revoke only those."))}</b>${esc(T("c3b", "Connect your wallet on revoke.cash only to revoke. Each revoke is a small transaction with a gas fee, so there is no need to revoke everything."))}</div></li></ol>
  <p class="warn">${esc(T("cWarn", "Disconnecting a site in your wallet does not cancel its approvals. Only a revoke does."))}</p>
  <div class="links">${lkRow("revoke.cash", "https://revoke.cash/")}${lkRow(T("etherscan", "Etherscan checker"), "https://etherscan.io/tokenapprovalchecker")}</div>
  ${checkDue() ? `<button class="btn ink" type="button" id="checked2">${esc(T("iChecked", "I checked"))}</button>` : `<p class="small muted">${esc(T("nextCheck", "Next Check Day: {d}", { d: fmtDate(nextCheck()) }))}</p>`}</section>`;
  wireCopy(main);
  const b = $("#checked2"); if (b) b.onclick = () => { S.checks[localKey()] = 1; touchDay(); save(); tally(0, "check"); go("home"); };
}
function nextCheck() { let t = now() + 864e5; for (let i = 0; i < 8; i++, t += 864e5) if (isCheckDay(t)) return t; return t; }

/* ---------- move progress between browsers ---------- */
function code() { const o = Object.assign({}, S, { quiz: null }); const s = btoa(unescape(encodeURIComponent(JSON.stringify(o)))); let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return "DG1." + s + "." + h.toString(36); }
function progressView() {
  main.innerHTML = `<div class="lesson-top"><a class="back" href="#home" aria-label="${esc(T("toHome", "Back to the hall"))}">${ico.back}</a><h2>${esc(T("move", "Move my progress"))}</h2></div>
  <section class="parch stack"><div class="art tool-art" style="background-image:url(${art("scroll")})" role="img" aria-label="${esc(T("illus", "Illustration"))}"></div><p>${esc(T("mv1", "Your progress lives only in this browser. To keep it somewhere else, copy this code and paste it in Dragon Guard there."))}</p><div class="codebox" id="pc">${esc(code())}</div><button class="btn ink" type="button" id="cpc">${esc(T("copyCode", "Copy my code"))}</button>
  <h3>${esc(T("restore", "Bring progress here"))}</h3><p class="small">${esc(T("mv2", "Only paste a code you copied yourself from Dragon Guard. This replaces the progress in this browser."))}</p><label for="pin" class="small" style="font-weight:800">${esc(T("codeLbl", "Your Dragon Guard code"))}</label><textarea class="code" id="pin" autocomplete="off" spellcheck="false"></textarea><button class="btn ink" type="button" id="rst">${esc(T("restoreBtn", "Restore"))}</button><p id="rmsg" aria-live="polite"></p></section>`;
  $("#cpc").onclick = () => copy(code(), $("#cpc"));
  $("#rst").onclick = () => {
    const v = $("#pin").value.replace(/\s+/g, ""), m = v.match(/^DG1\.([A-Za-z0-9+/=]+)\.([0-9a-z]+)$/);
    let ok = false;
    if (m) { let h = 0; for (const c of m[1]) h = (h * 31 + c.charCodeAt(0)) >>> 0; if (h.toString(36) === m[2]) { try { const o = JSON.parse(decodeURIComponent(escape(atob(m[1])))); if (o && o.v === 1 && o.mods && o.ep === EP) { S = o; save(); ok = true; } } catch (e) {} } }
    $("#rmsg").textContent = ok ? T("restored", "Restored. Welcome back.") : T("badCode", "That code did not work. Copy it again from the other browser.");
    if (ok) setTimeout(() => go("home"), 900);
  };
}

/* ---------- language ---------- */
function langPick() {
  const sel = $("#lang"), L = [["en", "English"], ["es", "Español"], ["fr", "Français"], ["pt", "Português"], ["tr", "Türkçe"], ["ru", "Русский"], ["vi", "Tiếng Việt"], ["id", "Indonesia"], ["ko", "한국어"], ["zh", "中文"]];
  sel.innerHTML = L.map(([c, n]) => `<option value="${c}" ${c === lang ? "selected" : ""}>${n}</option>`).join("");
  sel.onchange = () => { try { localStorage.setItem("radar:lang", sel.value); } catch (e) {} location.reload(); };
}
function applyStatic() { document.querySelectorAll("[data-t]").forEach((el) => { const k = el.dataset.t; if (TX[k]) el.textContent = TX[k]; }); }

/* ---------- start ---------- */
async function boot() {
  document.documentElement.lang = lang;
  langPick();
  await loadIdx();
  if (lang !== "en") { try { const r = await fetch(`${CFG.base}i18n/${lang}.json?v=${CFG.ver}`); if (r.ok) TX = await r.json(); } catch (e) {} applyStatic(); }
  if (S.quiz && (location.hash === "#q")) { quizActive = true; }
  if (location.hash === "#q" && !S.quiz) history.replaceState(null, "", "#home");
  if (location.hash === "#done" && !lastResult) history.replaceState(null, "", "#home");
  render();
}
boot();
window.GUARD_DEBUG = { get S() { return S; }, reset() { S = fresh(); save(); render(); } };
})();
