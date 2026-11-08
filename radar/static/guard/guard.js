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
const EP = 1;
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
    const status = !open ? T("opensOn", "Opens {d}", { d: fmtDate(opensAt(m)) }) : s.done && !s.need ? T("doneLbl", "Done") : s.need ? T("needs", "Needs review") : s.read ? T("quizNext", "Quiz next") : "";
    const mt = meta(m);
    const inner = `<span class="n">${s.done && !s.need ? "✓" : m}</span><span class="t"><b>${esc(mt.title)}</b><small>${esc(mt.tag)} · ${esc(T("min", "{n} min", { n: mt.minutes }))}</small></span><span class="s">${esc(status)}</span>`;
    path += open ? `<li><a class="stone ${cls}" href="#m${m}">${inner}</a></li>` : `<li><div class="stone ${cls}" aria-disabled="true">${inner}</div></li>`;
  }
  main.innerHTML = `
  <section class="hero"><span class="eyebrow">pdtools · ${esc(T("course", "Safety course"))}</span><h1>${esc(T("title", "Dragon Guard"))}</h1><p>${esc(T("tag", "One short lesson a day. Spot the scams before they reach your dragons."))}</p></section>
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
    return `<span class="seg plain" data-seg="${id}">${esc(s.t)}</span>`;
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
  <p class="score">${R.score} / ${R.n}</p><h2>${esc(pass ? T("passed", "Well guarded") : R.score <= 2 ? T("almost0", "A new topic. Let us learn it together.") : T("almost", "Good effort. A few to go over."))}</h2>
  <p class="muted">${esc(pass ? T("passWhy", "Every right answer is a scam you will spot in real life.") : R.score <= 2 ? T("almostWhy0", "Every answer below explains one scam. They come back in later quizzes so they stick.") : T("almostWhy", "Missing a few here is how you learn. These come back in later quizzes so they stick."))}</p>
  ${msgs.length ? `<div style="text-align:left;width:100%"><h3>${esc(T("youMissed", "You missed these"))}</h3><ul class="stack" style="padding-left:18px">${msgs.join("")}</ul></div>` : ""}
  ${next}</section>`;
  const sh = $("#share"); if (sh) sh.onclick = shareCard;
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
