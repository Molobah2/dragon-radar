(() => {
  "use strict";
  const data = JSON.parse(document.getElementById("radar-data").textContent);
  const posts = data.posts || [];
  const pinnedPosts = data.pinned || [];
  const pinnedIds = new Set(pinnedPosts.map((p) => p.id));
  const INTRO_MS = data.intro_ms || 5000;
  const BATCH = 12;
  const KEEP_DAYS = 30;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  // ---------- per-visitor memory, every access wrapped ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    // stored values can be old or damaged: only a plain object or an array of the right kind is ever used
    obj(k) { const v = this.get(k, null); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; },
    arr(k) { const v = this.get(k, null); return Array.isArray(v) ? v : []; },
  };
  const opened = (() => {
    const raw = store.get("radar:opened", {}), map = raw && typeof raw === "object" ? raw : {};
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    for (const id of Object.keys(map)) if (!(map[id] > cutoff)) delete map[id];
    return map;
  })();
  const save = () => store.set("radar:opened", opened);
  // ask the browser to keep this site's storage (no prompt in Chrome; Safari may still clear it after a long absence,
  // by which time those posts have left the 7 day feed anyway)
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) {}
  const lastVisit = store.get("radar:lastVisit", null);
  setTimeout(() => store.set("radar:lastVisit", Date.now()), 5000);

  let showOpened = !!store.get("radar:showOpened", false);
  $("showOpened").checked = showOpened;
  const unavailable = new Set();
  const myVid = () => { try { return localStorage.getItem("pd:vid") || ""; } catch (e) { return ""; } };
  // posts this visitor reported stay out of their feed
  const reported = store.arr("pd:reported");
  reported.forEach((id) => unavailable.add(id));
  let shown = BATCH;

  // ---------- helpers ----------
  const now = Date.now(), HOUR = 36e5;
  const ago = (iso) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const k of kids) n.append(k);
    return n;
  };
  const FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>';
  const arrow = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const pool = () => posts.filter((p) => !unavailable.has(p.id));
  let needsLove = !!store.get("radar:needsLove", false);
  $("needsLove").checked = needsLove;
  let query = "";
  const matches = (p) => !query || `${p.name} ${p.user} ${p.text}`.toLowerCase().includes(query);
  const visible = () => pool().filter((p) => (showOpened || !opened[p.id]) && (!needsLove || !p.opens) && matches(p));
  const HOT_MIN = 3, HOT_MAX = 4;
  const hotList = () => needsLove || query ? [] : visible().filter((p) => p.opens >= HOT_MIN && !pinnedIds.has(p.id))
    .sort((a, b) => b.opens - a.opens || Date.parse(b.t) - Date.parse(a.t)).slice(0, HOT_MAX);

  // ---------- counts ----------
  function counts(bump) {
    const all = pool(), done = all.filter((p) => opened[p.id]).length;
    $("left").textContent = all.length - done;
    $("fresh").textContent = lastVisit ? all.filter((p) => Date.parse(p.t) > lastVisit && !opened[p.id]).length : 0;
    if (bump) { const b = $("left"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
    $("meter").style.width = all.length ? `${(done / all.length) * 100}%` : "0%";
    $("m-done").textContent = `${done} opened`;
    $("m-total").textContent = `${all.length} posts`;
    $("progress-text").textContent = !all.length ? "No posts in this range yet." : done === all.length ? "All caught up. Nice." : done ? `${all.length - done} still waiting in this range.` : "Nothing opened yet in this range.";
    paintDays();
  }

  // ---------- community pulse (from the posts already on the page, costs nothing) ----------
  function pulse() {
    const list = posts, range = (new URLSearchParams(location.search).get("range")) || "24h";
    $("p-posts").textContent = list.length;
    $("p-people").textContent = new Set(list.map((p) => p.user)).size;
    $("p-team").textContent = list.filter((p) => p.team).length;
    $("p-quotes").textContent = list.length ? `${Math.round((list.filter((p) => p.quote).length / list.length) * 100)}%` : "0%";
    $("pulse-range").textContent = { "24h": "Last 24 hours", today: "Today", yesterday: "Yesterday", "7d": "Last 7 days" }[range] || "This range";
    const times = list.map((p) => Date.parse(p.t));
    const daily = range === "7d";
    const slot = daily ? 864e5 : 36e5, n = daily ? 7 : 24;
    let end;
    if (range === "24h" || !times.length) end = Date.now();
    else if (daily) { const d = new Date(); d.setHours(0, 0, 0, 0); end = d.getTime() + 864e5; }
    else { const d = new Date(Math.max(...times)); d.setHours(0, 0, 0, 0); end = d.getTime() + 864e5; }
    const start = end - n * slot, counts = new Array(n).fill(0);
    for (const t of times) { const i = Math.floor((t - start) / slot); if (i >= 0 && i < n) counts[i]++; }
    const max = Math.max(1, ...counts), peak = counts.indexOf(Math.max(...counts));
    const label = (ms) => daily ? new Date(ms).toLocaleDateString(undefined, { weekday: "short" })
      : new Date(ms).toLocaleTimeString(undefined, { hour: "numeric" });
    $("p-bars").replaceChildren(...counts.map((c, i) => {
      const bar = el("i", { class: c ? (i === peak ? "peak" : "") : "zero", title: `${label(start + i * slot)}: ${c} post${c === 1 ? "" : "s"}` });
      bar.style.height = `${Math.max(4, Math.round((c / max) * 70))}px`;
      return bar;
    }));
    $("p-start").textContent = label(start);
    $("p-end").textContent = range === "24h" ? "now" : label(end - slot);
    $("p-peak").textContent = counts[peak] ? `Busiest: ${label(start + peak * slot)} (${counts[peak]})` : "Quiet so far";
  }

  // ---------- opening ----------
  // posts that already moved the goal, streak and dragons today: Undo then Done again never counts twice
  function firstToday(id) {
    const c = store.obj("pd:counted"), ids = c.day === today() && Array.isArray(c.ids) ? c.ids : [];
    if (ids.includes(id)) return false;
    store.set("pd:counted", { day: today(), ids: ids.concat(id).slice(-500) });
    return true;
  }
  // Support needs real time on X. The site can not see likes or replies, so an open only counts (daily goal,
  // streak, dragons, Book of Friends) once the visitor has spent at least 8 seconds away on X and comes back.
  // The card leaves the list straight away as before; a quick bounce brings it back with a friendly note.
  // "Done" only tidies a post away, it never counts as support.
  const DWELL_MS = 8000, AWAY_KEY = "pd:away";
  let away = null;                                   // { id, at: when Open was pressed, gone: when the page lost sight }
  const keepAway = () => { try { away ? sessionStorage.setItem(AWAY_KEY, JSON.stringify(away)) : sessionStorage.removeItem(AWAY_KEY); } catch (e) { /* private mode */ } };
  function waitForReturn(id) {
    if (away && !away.gone && away.id !== id && opened[away.id]) undo(away.id);   // that one was never actually visited
    away = { id, at: Date.now(), gone: null }; keepAway();
  }
  function leftPage() { if (away && !away.gone) { away.gone = Date.now(); keepAway(); } }
  function backOnPage() {
    if (!away || !away.gone) return;
    const a = away; away = null; keepAway();
    if (Date.now() - a.gone >= DWELL_MS) { credit(a.id); return; }
    if (opened[a.id]) undo(a.id);
    toast("\u{1F409} Give the post a few seconds on X so your support counts. It is back in your list.");
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? leftPage() : backOnPage()));
  addEventListener("blur", leftPage);                // desktop: X opened in another window
  addEventListener("focus", backOnPage);
  addEventListener("pagehide", leftPage);
  // the browser may have reloaded this page while the visitor was on X (phones do that): count it on the way back
  addEventListener("pd:render", function resumeAway() {
    removeEventListener("pd:render", resumeAway);
    let a = null; try { a = JSON.parse(sessionStorage.getItem(AWAY_KEY) || "null"); } catch (e) { a = null; }
    try { sessionStorage.removeItem(AWAY_KEY); } catch (e) { /* fine */ }
    if (a && a.id && opened[a.id] && Date.now() - (a.gone || a.at) >= DWELL_MS && Date.now() - a.at < 6 * 3600e3) credit(a.id);
  });
  // hellos said on the welcome lane count here too: daily goal, streak and dragons, once per post per day
  addEventListener("pd:render", function creditQueue() {
    removeEventListener("pd:render", creditQueue);
    const q = store.obj("pd:creditq");
    store.set("pd:creditq", {});
    if (q.day !== today() || !Array.isArray(q.ids)) return;
    for (const id of q.ids.slice(-100)) {
      if (typeof id !== "string" || !/^\d{1,32}$/.test(id)) continue;
      if (!opened[id]) { opened[id] = Date.now(); save(); }
      credit(id, true);   // the welcome lane already told the server
    }
  });

  function markOpened(id, card, how = "open") {
    if (opened[id]) return;
    Object.assign(opened, store.obj("radar:opened"));   // keep what another tab opened
    opened[id] = Date.now();
    save();
    if (how === "open") waitForReturn(id);
    window.meadow && window.meadow.cheer();
    counts(true);
    if (!card) return;
    if (showOpened || pinnedIds.has(id)) { card.classList.add("opened"); setFoot(card, id); return; }
    setTimeout(() => { card.classList.add("leaving"); setTimeout(render, 360); }, 120);
  }
  // the support itself: goal, streak, dragons, Book of Friends and the server count, once per post per day
  function credit(id, told = false) {
    const fresh = firstToday(id);
    const post = posts.find((x) => x.id === id) || pinnedPosts.find((x) => x.id === id);
    if (fresh) {
      pace();
      bumpStreak();
      window.keeperBump && window.keeperBump();
      if (post && (KEEPER_GOAL ? !post.team : !post.opens)) bumpGoal();
      dispatchEvent(new Event("pd:opened"));
      if (post) {
        post.opens = (post.opens || 0) + 1;
        const fans = store.obj("pd:authors"), key = (post.user || "").toLowerCase();
        if (key) { fans[key] = (fans[key] | 0) + 1; store.set("pd:authors", fans); }
      }
    }
    if (fresh && !told) try {
      fetch(`/api/open/${id}`, { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ vid: (() => { try { return localStorage.getItem("pd:vid") || ""; } catch (e) { return ""; } })() }) })
        .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.full) dayFull(); }).catch(() => {});
    } catch (e) {}
    counts(true);
  }
  // each device counts 50 opens a day toward tiers and relics; past that, say so once a day instead of staying silent
  function dayFull() {
    const day = new Date().toISOString().slice(0, 10);
    if (store.get("pd:fullDay", "") === day) return;
    store.set("pd:fullDay", day);
    toast("\u{1F409} You reached today's 50 counted opens on this device. Your opens still show on each post, and they count toward your tiers again after midnight UTC.", 9000);
  }
  function undo(id) { delete opened[id]; save(); render(); }
  function setFoot(card, id) {
    card.querySelector(".foot").replaceChildren(el("div", { class: "actions" },
      el("a", { class: "btn btn-go", href: `https://x.com/i/status/${id}`, target: "_blank", rel: "noopener", html: `${arrow}Open on X`,
                onclick: () => markOpened(id, card), onauxclick: () => markOpened(id, card) }),
      opened[id]
        ? el("button", { class: "btn btn-soft", type: "button", onclick: () => undo(id) }, "Undo")
        : el("button", { class: "btn btn-soft", type: "button", onclick: () => markOpened(id, card, "done") }, "Done"),
      el("button", { class: "btn btn-soft btn-idea", type: "button", title: "Reply ideas", "aria-label": "Reply ideas",
        html: ICON_BULB ? `<img src="${ICON_BULB}" alt="" width="22" height="22">` : "\u{1F4A1}", onclick: () => openIdeas(id, card) })));
  }

  // ---------- reply ideas: prompts to think with, never text to paste ----------
  const ICON_BULB = (data.icons || {}).bulb || "";
  const IDEAS = ["Ask which egg they got", "Share your own latest pull", "Ask what they plan to name their dragon",
    "Tell them what you liked about the post", "Ask how long they have been a Keeper", "Share a tip that helped you",
    "Ask what they think comes next", "Congratulate them on their progress", "Share your favourite dragon so far",
    "Ask if they caught the last AMA", "React to their art or screenshot", "Tell them about a fun moment you had in the game",
    "Ask what got them into Pocket Dragons", "Share your score so you can compare", "Wish them luck on their next hatch",
    "Ask a question about something they mentioned", "Share how you would have done it", "Tell them which part made you smile"];
  let ideaFor = null;
  // Phones: X's app ignores reply links and opens a blank new post, so we open the post itself and people tap reply there
  const PHONE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
  const replyUrl = (id, user) => PHONE ? (user ? `https://x.com/${user}/status/${id}` : `https://x.com/i/status/${id}`)
    : `https://x.com/intent/post?in_reply_to=${id}`;
  function shuffleIdeas() {
    const pool = IDEAS.slice(), out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    $("idea-list").replaceChildren(...out.map((t) => el("li", {}, t)));
  }
  function openIdeas(id, card) {
    ideaFor = { id, card };
    shuffleIdeas();
    $("ideas-reply").href = replyUrl(id);
    $("ideas-hint").hidden = !PHONE;
    $("ideas").hidden = false;
    (void $("ideas").offsetWidth, $("ideas").classList.add("open"));
    document.body.classList.add("sheet-open");
  }
  function closeIdeas() {
    $("ideas").classList.remove("open");
    (document.querySelector(".sheet-wrap.open") || document.body.classList.remove("sheet-open"));
    setTimeout(() => { if (!$("ideas").classList.contains("open")) $("ideas").hidden = true; }, 250);
  }
  $("ideas-shuffle").addEventListener("click", shuffleIdeas);
  $("ideas-close").addEventListener("click", closeIdeas);
  $("ideas").addEventListener("click", (e) => { if (e.target === $("ideas")) closeIdeas(); });
  // Escape closes the sheet on top (every sheet closes when its backdrop is tapped), one at a time
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const top = [...document.querySelectorAll(".sheet-wrap.open")].pop();
    if (top) top.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  $("ideas-reply").addEventListener("click", () => { if (ideaFor) markOpened(ideaFor.id, ideaFor.card); closeIdeas(); });

  // ---------- daily streak: days in a row with at least one post opened (this browser only) ----------
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayGap = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const readStreak = () => { const v = store.obj("pd:streak"); return { last: typeof v.last === "string" ? v.last : null, count: v.count | 0, best: v.best | 0, ...(typeof v.fz === "string" ? { fz: v.fz } : {}) }; };
  let streak = readStreak();
  // v2 streak freeze: one missed day a week is forgiven, so a busy Keeper keeps a long streak
  const FREEZE = !!data.v2;
  const freezeReady = (s) => !s.fz || dayGap(s.fz, today()) >= 7;
  function bumpStreak() {
    streak = readStreak();                     // another tab may have moved it on
    const t = today();
    if (streak.last === t) return;
    const gap = streak.last ? dayGap(streak.last, t) : 0;
    if (FREEZE && gap === 2 && streak.count > 1 && freezeReady(streak)) {
      streak.fz = t; streak.count += 1;
      setTimeout(() => toast(`\u{1F9CA} Streak freeze used. Your ${streak.count} day streak is safe. Next freeze in 7 days.`), 1200);
    } else streak.count = gap === 1 ? streak.count + 1 : 1;
    streak.best = Math.max(streak.best || 0, streak.count);
    streak.last = t;
    store.set("pd:streak", streak);
    showStreak(true);
  }
  function liveStreak() {
    streak = readStreak();
    if (!streak.last) return 0;
    const gap = dayGap(streak.last, today());
    return gap <= 1 || (FREEZE && gap === 2 && streak.count > 1 && freezeReady(streak)) ? streak.count : 0;
  }
  function showStreak(bump) {
    const n = liveStreak(), b = $("streak");
    b.hidden = !n;
    if (n) b.textContent = `\u{1F525} ${n} day streak`;
    if (bump && n) { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
    $("progress-streak").textContent = n ? `\u{1F525} ${n} day streak \u00b7 best ${Math.max(n, streak.best || 0)}`
      : "Open a post today to start a streak.";
    if (FREEZE && $("progress-freeze")) $("progress-freeze").textContent = freezeReady(streak)
      ? "\u{1F9CA} Streak freeze ready: miss one day this week and your streak stays safe."
      : `\u{1F9CA} Streak freeze used. A new one is ready in ${7 - dayGap(streak.fz, today())} days.`;
  }

  // ---------- the tools menu: one button opens the list; choosing something, tapping outside or Escape closes it ----------
  const sideMenu = $("side-menu");
  if (sideMenu) {
    const smBtn = $("side-menu-btn");
    const setMenu = (open) => { sideMenu.classList.toggle("open", open); smBtn.setAttribute("aria-expanded", String(open)); };
    smBtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(!sideMenu.classList.contains("open")); });
    $("side-actions").addEventListener("click", (e) => { if (e.target.closest(".side-row, .keeper-btn")) setTimeout(() => setMenu(false), 0); });
    document.addEventListener("click", (e) => { if (sideMenu.classList.contains("open") && !sideMenu.contains(e.target)) setMenu(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sideMenu.classList.contains("open")) { setMenu(false); smBtn.focus(); } });
  }

  // ---------- my progress: save under a short code, restore on another device ----------
  // ---------- report a post: spam, off topic or harmful. Jon reviews every one ----------
  let reportId = null;
  function openReport(id) { reportId = id; openSheet("report"); }
  $("report-close").addEventListener("click", () => closeSheet("report"));
  $("report").addEventListener("click", (e) => { if (e.target === $("report")) closeSheet("report"); });
  document.querySelectorAll("#report [data-why]").forEach((b) => b.addEventListener("click", () => {
    const id = reportId; if (!id) return;
    let vid = ""; try { vid = localStorage.getItem("pd:vid") || ""; } catch (e) { /* private mode */ }
    fetch("/api/report", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ post: id, vid, reason: b.dataset.why }) }).catch(() => {});
    closeSheet("report");
    reported.push(id); store.set("pd:reported", reported.slice(-300));
    unavailable.add(id);
    const card = cards.get(id);
    if (card) { card.classList.add("leaving"); setTimeout(render, 360); } else render();
    toast("Thank you. The post is gone from your feed and Jon will take a look.");
  }));
  function openSheet(id) { $(id).hidden = false; (void $(id).offsetWidth, $(id).classList.add("open")); document.body.classList.add("sheet-open"); }
  // inside the X app's own browser, progress is kept apart from the phone browser: say so, and help move it in one tap
  (() => {
    const box = $("inapp"); if (!box) return;
    const track = (kind, ref) => { try { window.pdTrack && window.pdTrack(kind, ref); } catch (e) { /* ignore */ } };
    if (!/Twitter|TwitterAndroid/i.test(navigator.userAgent || "")) return;
    try { if (sessionStorage.getItem("pd:inappHide")) return; } catch (e) { /* private mode */ }
    box.hidden = false; track("inapp", "shown");
    $("ia-how").addEventListener("click", () => { $("ia-steps").hidden = !$("ia-steps").hidden; });
    $("ia-move").addEventListener("click", () => { track("inapp", "move"); $("ia-steps").hidden = false; showStreak(); pgMsg("", true); openSheet("progress"); $("pg-save").click(); });
    $("ia-close").addEventListener("click", () => { box.hidden = true; try { sessionStorage.setItem("pd:inappHide", "1"); } catch (e) { /* fine */ } });
  })();
  function closeSheet(id) { $(id).classList.remove("open"); (document.querySelector(".sheet-wrap.open") || document.body.classList.remove("sheet-open")); setTimeout(() => { if (!$(id).classList.contains("open")) $(id).hidden = true; }, 250); }
  const pgMsg = (t, ok) => { $("pg-msg").textContent = t; $("pg-msg").className = "kp-msg " + (ok ? "ok" : "no"); };
  $("progress-open").addEventListener("click", () => { showStreak(); pgMsg("", true); openSheet("progress"); });
  $("streak").addEventListener("click", () => { showStreak(); pgMsg("", true); openSheet("progress"); });
  $("progress-close").addEventListener("click", () => closeSheet("progress"));
  $("progress").addEventListener("click", (e) => { if (e.target === $("progress")) closeSheet("progress"); });
  $("pg-save").addEventListener("click", async () => {
    $("pg-save").disabled = true;
    try {
      const r = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opened, streak, goal: readGoal(), dex: store.get("pd:dex", null), vid: myVid() }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message);
      $("pg-code-text").textContent = j.code; $("pg-code").hidden = false;
      pgMsg("Saved. Enter this code on your other device within 30 days.", true);
    } catch (e) { pgMsg(e.message || "Could not save right now, please try again.", false); }
    $("pg-save").disabled = false;
  });
  $("pg-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("pg-code-text").textContent); pgMsg("Code copied.", true); } catch (e) { pgMsg("Long press the code to copy it.", true); }
  });
  $("pg-input").addEventListener("input", (e) => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    e.target.value = v.length > 4 ? v.slice(0, 4) + "-" + v.slice(4) : v;
  });
  $("pg-restore").addEventListener("click", async () => {
    const code = $("pg-input").value.trim();
    if (code.replace("-", "").length < 8) { pgMsg("Codes have 8 letters and numbers, like ABCD-1234.", false); return; }
    $("pg-restore").disabled = true;
    try {
      const r = await fetch(`/api/backup/${encodeURIComponent(code)}?vid=${encodeURIComponent(myVid())}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.message);
      const { added, dexIn } = applyProgress(j);
      const bits = [added ? `${added} opened posts` : "", dexIn ? `${dexIn} dragon${dexIn === 1 ? "" : "s"}` : ""].filter(Boolean);
      if (j.book) bits.push("your Book of Friends name");
      pgMsg(bits.length ? `Restored ${bits.join(" and ")}.` : "All set, nothing new to restore.", true);
      if (j.book) dispatchEvent(new Event("pd:bookchange"));
    } catch (e) { pgMsg(e.message || "Could not restore right now, please try again.", false); }
    $("pg-restore").disabled = false;
  });

  // progress from a backup code or from the Keeper's own safe copy: joined with what is here, never replacing it
  function applyProgress(j) {
    streak = readStreak();
    let added = 0;
    for (const [id, ts] of Object.entries(j.opened || {})) if (!opened[id]) { opened[id] = ts; added++; }
    save();
    const s2 = j.streak || {};
    if ((s2.best || 0) > (streak.best || 0)) streak.best = s2.best;
    // the day streak: keep the newer one, and if both devices were used on the same or the next day, keep the longer run
    if (s2.last && streak.last && s2.last === streak.last) streak.count = Math.max(streak.count | 0, s2.count | 0);
    else if (s2.last && streak.last && dayGap(s2.last, streak.last) === 1) streak.count = Math.max(streak.count | 0, (s2.count | 0) + 1);
    else if (s2.last && streak.last && dayGap(streak.last, s2.last) === 1) { streak.count = Math.max(s2.count | 0, (streak.count | 0) + 1); streak.last = s2.last; }
    else if (s2.last && (!streak.last || s2.last > streak.last)) { streak.last = s2.last; streak.count = s2.count || 0; }
    if (s2.fz && (!streak.fz || s2.fz > streak.fz)) streak.fz = s2.fz;
    store.set("pd:streak", streak);
    const dexIn = mergeDex(j.dex);
    // today's goal count: saved today on the other device, keep the higher number (yesterday's count never carries)
    const gIn = j.goal || {};
    if (gIn.day === today() && ((gIn.n | 0) > 0 || gIn.d === true || gIn.f === true)) {
      goal = readGoal();
      if (goal.day !== today()) goal = { day: today(), n: 0, d: false, f: false };
      if ((gIn.n | 0) > goal.n) { goal.n = Math.min(200, gIn.n | 0); store.set("pd:goal", goal); }
      if ((gIn.d === true && !goal.d) || (gIn.f === true && !goal.f)) { goal.d = goal.d || gIn.d === true; goal.f = goal.f || gIn.f === true; store.set("pd:goal", goal); }
      showGoal();
    }
    showStreak(); render();
    return { added, dexIn };
  }

  // ---------- signed Keepers: progress kept safe on pdtools ----------
  // A browser can lose its saved data (cleared site data, a phone tidying storage, a new phone). Devices signed into
  // Blinky's Book of Friends send their progress to pdtools about once a minute when it changes, and pull it back
  // when the page opens or the book is signed again, so nothing is lost. Merged both ways: nothing is ever replaced.
  const SYNC_URL = "/api/book/progress";
  let syncSent = "", syncOff = false, syncTimer = null;
  const progressBody = () => ({ opened, streak: readStreak(), goal: readGoal(), dex: store.get("pd:dex", null) });
  async function pullSafe(say) {
    const vid = myVid(); if (!vid || syncOff) return;
    try {
      const j = await (await fetch(`${SYNC_URL}?vid=${encodeURIComponent(vid)}`, { headers: { Accept: "application/json" }, cache: "no-store" })).json();
      if (!j.ok) { if (j.why === "unsigned") syncOff = true; return; }
      const { added, dexIn } = applyProgress(j);
      if (added || dexIn) {
        const bits = [added ? `${added} opened posts` : "", dexIn ? `${dexIn} dragon${dexIn === 1 ? "" : "s"}` : ""].filter(Boolean);
        toast(`Restored ${bits.join(" and ")}.`);
      }
      pushSafe(true);
    } catch (e) { /* offline: try again next time */ }
  }
  function pushSafe(now) {
    if (syncOff || !myVid()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const body = JSON.stringify({ ...progressBody(), vid: myVid() });
      if (body === syncSent) return;
      fetch(SYNC_URL, { method: "POST", keepalive: body.length < 60000, headers: { "Content-Type": "application/json" }, body })
        .then((r) => r.json()).then((j) => { if (j.ok && !j.later) syncSent = body; if (j.why === "unsigned") syncOff = true; }).catch(() => {});
    }, now ? 0 : 60000);
  }
  if (data.v2) {
    pullSafe(false);
    addEventListener("pd:opened", () => pushSafe(false));
    addEventListener("pd:dexsaved", () => pushSafe(true));
    addEventListener("pd:booksigned", () => { syncOff = false; pullSafe(true); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") pushSafe(true); });
  }

  // collectible dragons from a backup code: keep the higher count of each, never lose one
  function mergeDex(inc) {
    if (!inc || typeof inc !== "object" || !inc.have || typeof inc.have !== "object") return 0;
    const mine = store.obj("pd:dex");
    const have = mine.have && typeof mine.have === "object" ? mine.have : {};
    let gained = 0;
    for (const [id, h] of Object.entries(inc.have)) {
      if (!h || typeof h !== "object") continue;
      const cur = have[id] || {};
      const before = (cur.c || 0) + (cur.r || 0) + (cur.l || 0);
      for (const k of ["c", "r", "l"]) { const v = Math.max(cur[k] || 0, Math.min(999, h[k] | 0)); if (v) cur[k] = v; }
      if (!before && (cur.c || cur.r || cur.l)) gained++;
      have[id] = cur;
    }
    const last = [mine.last, inc.last].filter((d) => typeof d === "string").sort().pop() || null;
    // the hatch count sets the pace of new dragons; the goal streak keeps the later one
    const n = Math.max(mine.n | 0, inc.n | 0);
    const gs = [mine.g, inc.g].filter((g) => g && typeof g.last === "string").sort((a, b) => (a.last < b.last ? -1 : 1));
    let g = gs.length ? { ...gs[gs.length - 1], best: Math.max(...gs.map((x) => x.best | 0)) } : mine.g || null;
    // the goal streak on the same or the next day on two devices: keep the longer run
    if (gs.length === 2) {
      const [a, b] = gs, gap = dayGap(a.last, b.last);
      if (gap === 0) g.count = Math.max(a.count | 0, b.count | 0);
      else if (gap === 1) g.count = Math.max(b.count | 0, (a.count | 0) + 1);
      g.best = Math.max(g.best | 0, g.count | 0);
    }
    const e = Math.max(mine.e | 0, Math.min(1e6, inc.e | 0));
    const sIn = inc.s && typeof inc.s === "object" ? inc.s : {}, sMine = mine.s && typeof mine.s === "object" ? mine.s : {};
    const sOut = { ...sMine };
    for (const [k, v] of Object.entries(sIn)) if (typeof v === "string" && !sOut[k]) sOut[k] = v;
    // duplicate swaps: joined by their time, so a swap made on either device is kept once
    const swaps = new Map();
    for (const x of [...(Array.isArray(mine.sw) ? mine.sw : []), ...(Array.isArray(inc.sw) ? inc.sw : [])]) {
      if (x && Number.isFinite(x.t) && Array.isArray(x.give) && x.give.length === 3 && typeof x.got === "string" && !swaps.has(x.t)) swaps.set(x.t, { t: x.t, give: x.give.map(String), got: x.got });
    }
    const sw = [...swaps.values()].sort((a, b) => a.t - b.t).slice(-300);
    store.set("pd:dex", { ...mine, have, last, n, g, e, s: sOut, sw, log: Array.isArray(mine.log) ? mine.log : [] });
    dispatchEvent(new Event("pd:dexchange"));
    return gained;
  }

  // ---------- daily goal, an egg fills up as you go ----------
  // v1: give 5 quiet posts some love. v2: cheer on 20 fellow Keepers' posts (any post that is new to you, not the team's)
  // v2.1 ("mix"): one percentage from three parts. 10 Keeper posts are worth 50% (5% each), today's Dragon Quiz 25%,
  // following one new Keeper 25%. The egg hatches at 100%.
  const MIX = data.goal_rule === "mix";
  const GOAL = data.goal || 5, KEEPER_GOAL = data.goal_rule === "keeper" || MIX;
  const goalWord = KEEPER_GOAL ? "Keeper posts" : "quiet posts";
  const readGoal = () => { const v = store.obj("pd:goal"); return { day: typeof v.day === "string" ? v.day : null, n: v.n | 0, d: v.d === true, f: v.f === true }; };
  let goal = readGoal();
  if (goal.day !== today()) goal = { day: today(), n: 0, d: false, f: false };
  // v2: a Keeper who has never hatched an egg needs only half the goal for the first one, so the very first
  // visit can end with a dragon. From the next day on it is the usual goal for everyone.
  // v2.1: the first egg needs 5 posts and 1 follow; the Dragon Quiz is a bonus that day.
  const STARTER = Math.max(1, Math.round(GOAL / 2));
  function firstEgg() {
    const d = store.obj("pd:dex"), log = Array.isArray(d.log) ? d.log : [];
    const before = log.some((l) => l && l.day !== today()) || (d.n | 0) > 1
      || (!log.length && d.have && typeof d.have === "object" && Object.keys(d.have).length > 0);
    return !before;
  }
  function goalNow() {
    if (!KEEPER_GOAL) return GOAL;
    return firstEgg() ? STARTER : GOAL;
  }
  // today's Dragon Quiz: every answer saved on this device (the set changes at midnight UTC)
  function dleDone() {
    if (goal.d) return true;
    const st = String(data.dle_start || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(st)) return false;
    const now = new Date(), utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const n = Math.floor((utc - Date.parse(st + "T00:00:00Z")) / 864e5) + 1;
    const dle = store.obj("pd:dle"), plays = dle.plays && typeof dle.plays === "object" ? dle.plays : {};
    const full = (k) => { const p = plays[k]; return !!p && Array.isArray(p.marks) && p.marks.length >= 5; };
    const utcDay = new Date(utc).toISOString().slice(0, 10);
    return full(n) || (utcDay !== today() && full(n - 1));    // the local day may still be on yesterday's set
  }
  // one new Keeper followed today ("Yes, followed", or a "Follow on X" tap never answered: X opens in its own app
  // and many come back without seeing "Did you follow?"; "Not yet" clears it), or nobody left to follow
  function followDone() {
    if (goal.f) return true;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const today0 = (t) => typeof t === "number" && t >= t0.getTime() && t <= Date.now() + 6e4;
    if (Object.values(store.obj("radar:followed")).some(today0)) return true;
    const tapped = store.obj("radar:tapped");     // a tap counts on the day it was first made for that Keeper, once
    const pend = store.obj("radar:pending");        // (taps from before 30 Oct carry only their pending time)
    if (Object.keys(pend).some((u) => today0(u in tapped ? tapped[u] : pend[u]))) return true;
    return store.get("radar:kleft", -1) === 0;
  }
  function goalParts() {
    const first = firstEgg(), P = goalNow(), n = Math.min(goal.n, P);
    const d = first || dleDone(), f = followDone();
    if (!first && d && !goal.d) { goal.d = true; store.set("pd:goal", goal); }    // kept with the goal, so it syncs too
    if (f && !goal.f) { goal.f = true; store.set("pd:goal", goal); }
    // a brand new Keeper's first egg skips the Dragon Quiz, so posts and the follow share the whole 100%
    // (no free 25% on arrival, which looked like the goal had not loaded right)
    const pct = first ? Math.min(100, Math.round((n / P) * 70 + (f ? 30 : 0)))
      : Math.min(100, Math.round((n / P) * 50 + (d ? 25 : 0) + (f ? 25 : 0)));
    return { first, P, n, d, f, pct };
  }
  function goalDone() {
    if (MIX) return goalParts().pct >= 100;
    return goal.day === today() && goal.n >= goalNow();
  }
  window.pdGoalNow = goalNow;
  window.pdGoalDone = () => { goal = readGoal(); if (goal.day !== today()) goal = { day: today(), n: 0, d: false, f: false }; return goalDone(); };
  function showGoal() {
    if (MIX) {
      const g = goalParts(), done = g.pct >= 100;
      $("goal-text").textContent = done ? "Daily goal done" : `Daily goal ${g.pct}%`;
      $("goal").classList.toggle("done", done);
      $("goal-egg").style.setProperty("--fill", `${g.pct}%`);
      paintSteps(g);
      dispatchEvent(new Event("pd:goalshow"));
      mixMoments(g);
      return;
    }
    const G = goalNow(), n = Math.min(goal.n, G), done = n >= G;
    $("goal-text").textContent = done ? "Daily goal done" : `${n}/${G} ${goalWord} today`;
    $("goal").classList.toggle("done", done);
    $("goal-egg").style.setProperty("--fill", `${(n / G) * 100}%`);
    dispatchEvent(new Event("pd:goalshow"));   // v2 dragons turn a finished goal into "hatch your egg"
  }
  // the goal's moments, once a day each: a nudge with one step to go, and the cheer when it is done
  function mixMoments(g) {
    if (g.pct >= 100) {
      if (store.get("pd:goalFired", "") === today()) return;
      store.set("pd:goalFired", today());
      toast("\u{1F423} Daily goal done. Blinky is proud of you.");
      window.meadow && window.meadow.cheer && window.meadow.cheer();
      dispatchEvent(new Event("pd:goaldone"));
    } else if (g.pct >= 75 && store.get("pd:nudge", "") !== today()) {
      store.set("pd:nudge", today());
      toast("\u{1F95A} Just one more step and your egg hatches.");
    }
  }
  // the three steps, under the goal pill: tap the pill to open them
  let steps = null;
  function paintSteps(g) {
    if (!steps) return;
    const row = (k, ok, label, extra, href, act) => `<li class="gs-row${ok ? " ok" : ""}"><i class="gs-tick" aria-hidden="true">${ok ? "\u2713" : ""}</i>`
      + `<span class="gs-t"><b>${label}</b>${extra ? `<small>${extra}</small>` : ""}</span>`
      + (ok ? "" : `<a class="gs-go" href="${href}" data-gs="${k}">${act}</a>`) + "</li>";
    steps.querySelector(".gs-pct").textContent = `${g.pct}%`;
    steps.querySelector(".gs-bar i").style.width = `${g.pct}%`;
    steps.querySelector(".gs-list").innerHTML =
      row("posts", g.n >= g.P, `Open ${g.P} Keeper posts`, `${g.n}/${g.P}`, "#feed", "Go")
      + (g.first ? `<li class="gs-row skip"><i class="gs-tick" aria-hidden="true">\u2013</i><span class="gs-t"><b>Play today's Dragon Quiz</b><small>Not needed for your first egg</small></span></li>`
        : row("dle", g.d, "Play today's Dragon Quiz", "", "/quiz", "Play"))
      + row("follow", g.f, "Follow 1 new Keeper", "", "/friends/keepers", "Find one");
  }
  if (MIX) {
    steps = document.createElement("div");
    steps.className = "goal-steps"; steps.id = "goal-steps"; steps.hidden = true; steps.setAttribute("role", "dialog"); steps.setAttribute("aria-label", "Today's goal");
    steps.innerHTML = '<div class="gs-head"><b>Today\'s goal</b><span class="gs-pct">0%</span></div><div class="gs-bar"><i></i></div><ul class="gs-list"></ul>';
    $("goal").insertAdjacentElement("afterend", steps);
    $("goal").setAttribute("aria-controls", "goal-steps"); $("goal").setAttribute("aria-expanded", "false");
    steps.addEventListener("click", (e) => {
      const a = e.target.closest("[data-gs='posts']"); if (!a) return;
      e.preventDefault(); closeSteps(); $("feed").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
    });
    document.addEventListener("click", (e) => { if (!steps.hidden && !steps.contains(e.target) && !$("goal").contains(e.target)) closeSteps(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape") closeSteps(); });
    // finished on another page or tab (the Dragon Quiz, the Keepers directory): the goal catches up straight away
    addEventListener("storage", (e) => { if (["pd:dle", "radar:followed", "radar:pending", "radar:tapped", "pd:goal", "radar:kleft"].includes(e.key)) { goal = readGoal(); if (goal.day !== today()) goal = { day: today(), n: 0, d: false, f: false }; showGoal(); } });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { goal = readGoal(); if (goal.day !== today()) goal = { day: today(), n: 0, d: false, f: false }; showGoal(); } });
  }
  function closeSteps() { if (steps && !steps.hidden) { steps.hidden = true; $("goal").setAttribute("aria-expanded", "false"); steps.parentElement.classList.remove("gs-open"); } }
  function bumpGoal() {
    goal = readGoal();                         // another tab may have counted some already
    if (goal.day !== today()) goal = { day: today(), n: 0, d: false, f: false };
    goal.n++;
    store.set("pd:goal", goal);
    showGoal();
    if (MIX) return;
    const G = goalNow(), left = G - goal.n;
    // a friendly heads up near the end, once a day, so nobody stops just short of their egg
    if (KEEPER_GOAL && left === 5 && G > 5 && store.get("pd:nudge", "") !== today()) {
      store.set("pd:nudge", today());
      toast(`\u{1F95A} Just ${left} more Keepers and your egg hatches.`);
    }
    if (goal.n === G) {
      toast(KEEPER_GOAL ? `\u{1F423} You cheered on ${G} fellow Keepers today. Blinky is proud of you.`
        : "\u{1F423} You gave 5 quiet posts some love today. Blinky is proud of you.");
      window.meadow && window.meadow.cheer && window.meadow.cheer();
      dispatchEvent(new Event("pd:goaldone"));
    }
  }
  // A new day while the page stays open (a phone keeps the tab for hours, or brings it back from memory the next
  // morning): the goal, streak, dragons and today's posts all belong to the new day, so the page starts fresh.
  // It never interrupts: it waits while a sheet is open or the visitor is typing.
  const loadDay = today();
  function newDayCheck() {
    if (today() === loadDay || document.hidden) return;
    if (document.querySelector(".sheet-wrap.open") || (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) return;
    location.reload();
  }
  document.addEventListener("visibilitychange", newDayCheck);
  addEventListener("pageshow", newDayCheck);
  addEventListener("focus", newDayCheck);
  setInterval(newDayCheck, 60 * 1000);
  $("goal").addEventListener("click", () => {
    if (MIX) { const open = steps.hidden; steps.hidden = !open; steps.parentElement.classList.toggle("gs-open", open); $("goal").setAttribute("aria-expanded", open ? "true" : "false"); if (open) paintSteps(goalParts()); return; }
    if (KEEPER_GOAL) { $("feed").scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); return; } $("needsLove").checked = true; $("needsLove").dispatchEvent(new Event("change")); $("feed").scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); });

  // ---------- team alerts: a browser notification when a new team post arrives (while a tab is open) ----------
  const canNotify = "Notification" in window;
  let alerts = !!store.get("pd:teamAlerts", false) && canNotify && Notification.permission === "granted";
  $("team-alerts").checked = alerts;
  $("team-alerts").disabled = !canNotify;
  $("team-alerts").addEventListener("change", async (e) => {
    if (!e.target.checked) { alerts = false; store.set("pd:teamAlerts", false); return; }
    let perm = Notification.permission;
    if (perm === "default") { try { perm = await Notification.requestPermission(); } catch (err) { perm = "denied"; } }
    alerts = perm === "granted";
    e.target.checked = alerts;
    store.set("pd:teamAlerts", alerts);
    pgMsg(alerts ? "Done. You will get a ping when the team posts." : "Notifications are blocked in your browser settings.", alerts);
  });
  function teamAlert(p) {
    if (!alerts || !p) return;
    try {
      const n = new Notification("New post from the Pocket Dragons team", { body: (p.text || "").slice(0, 140), icon: p.avatar || undefined, tag: `team-${p.id}` });
      n.onclick = () => { window.focus(); window.open(`https://x.com/i/status/${p.id}`, "_blank", "noopener"); n.close(); };
    } catch (e) { /* some phones only allow notifications from installed apps */ }
  }

  // ---------- pacing: a gentle nudge when someone is going very fast (protects their X account) ----------
  const PACE_N = 15, PACE_MS = 5 * 60e3, NUDGE_GAP = 10 * 60e3;
  const taps = (() => { try { return JSON.parse(sessionStorage.getItem("pd:taps") || "[]"); } catch (e) { return []; } })();
  let lastNudge = 0;
  function toast(msg, ms = 6500) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.classList.remove("show"); setTimeout(() => { t.hidden = true; }, 300); }, ms);
  }
  function copyHi(text) {
    try { navigator.clipboard.writeText(text).then(() => toast("Greeting copied. Paste it in your reply."), () => {}); } catch (e) { /* no clipboard: they can still reply */ }
  }
  function pace() {
    const nowMs = Date.now();
    taps.push(nowMs);
    while (taps.length && nowMs - taps[0] > PACE_MS) taps.shift();
    try { sessionStorage.setItem("pd:taps", JSON.stringify(taps)); } catch (e) { /* ignore */ }
    if (taps.length >= PACE_N && nowMs - lastNudge > NUDGE_GAP) {
      lastNudge = nowMs;
      toast("Take a little breather \u{1F409} X likes a human pace, and a few real replies beat lots of quick ones.");
    }
  }

  // ---------- post text ----------
  const decoder = document.createElement("textarea");
  function cleanText(raw) {
    decoder.innerHTML = raw || "";                 // X sends &amp; style entities
    let text = decoder.value, links = 0;
    text = text.replace(/https:\/\/t\.co\/\S+/g, () => { links++; return ""; }).replace(/[ \t]+\n/g, "\n").trim();
    return { text, links };
  }
  const xLogo = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.9 2.3h7l4.8 6.4 5.5-6.4Zm-1.2 17.9h1.9L7.1 4.2H5.1l11.9 16Z"/></svg>';

  // ---------- card tilt ----------
  function tilt(card) {
    if (reduce || matchMedia("(hover: none)").matches) return;
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.classList.add("tilting");
      card.style.setProperty("--ry", `${(x - 0.5) * 5}deg`); card.style.setProperty("--rx", `${(0.5 - y) * 4}deg`);
      card.style.setProperty("--mx", `${x * 100}%`); card.style.setProperty("--my", `${y * 100}%`);
    });
    card.addEventListener("pointerleave", () => { card.classList.remove("tilting"); card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); });
  }

  // ---------- render (keeps already-loaded embeds in place) ----------
  const cards = new Map();
  function makeCard(p, i) {
    const url = `https://x.com/${p.user}/status/${p.id}`;
    const { text, links } = cleanText(p.text);
    const chips = [];
    if (p.team) chips.push(el("span", { class: "tag team" }, "Team"));
    if (p.crew) chips.push(el("span", { class: "tag crew" }, p.crew));
    if (p.quote) chips.push(el("span", { class: "tag" }, "Quote"));
    if (p.media) chips.push(el("span", { class: "tag media" }, "Media"));
    else if (links) chips.push(el("span", { class: "tag media" }, "Link"));
    // read the post in your own language (opens Google Translate, nothing is sent from here)
    if (window.radarLang && window.radarLang !== "en" && p.text)
      chips.push(el("a", { class: "tag tr-link", href: `https://translate.google.com/?sl=auto&tl=${window.radarTranslateCode}&text=${encodeURIComponent(p.text.slice(0, 1500))}&op=translate`,
        target: "_blank", rel: "noopener" }, "Translate"));
    if (p.tier) chips.unshift(el("span", { class: `tag tier tier-${p.tier}`, title: "Signed Blinky's Book of Friends" },
      p.tier === "gold" ? "Gold friend" : p.tier === "silver" ? "Silver friend" : "Bronze friend"));
    const avatar = p.avatar
      ? el("img", { class: "avatar", src: p.avatar, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
      : el("span", { class: "avatar blank" }, (p.name || "?").slice(0, 1));
    // one line posts get a bigger, quote style text so the card never looks half empty
    const short = (text || "").length <= 60 && !(text || "").includes("\n");
    const card = el("article", { class: "post" + (p.team ? " team" : "") + (short ? " short" : ""), "data-id": p.id },
      el("header", { class: "card-head" }, avatar,
        el("a", { class: "who", href: `https://x.com/${p.user}`, target: "_blank", rel: "noopener" },
          el("b", { class: "name" }, p.name || p.user), el("span", { class: "handle" }, `@${p.user}`)),
        el("a", { class: "xmark", href: url, target: "_blank", rel: "noopener", title: "View on X", html: xLogo }),
        p.team ? "" : el("button", { class: "flag", type: "button", title: "Report this post", "aria-label": "Report this post", html: FLAG,
          onclick: () => openReport(p.id) })),
      el("a", { class: "text", href: url, target: "_blank", rel: "noopener", onclick: () => markOpened(p.id, card) },
        text || "(no text)"),
      el("div", { class: "meta" }, ...chips, el("span", { class: "reach" + (p.opens ? "" : " none"), title: p.opens ? `${p.opens} Keeper${p.opens === 1 ? "" : "s"} opened this post` : "Nobody has opened this yet. Be the first!" },
        p.opens ? `${p.opens} Keeper${p.opens === 1 ? "" : "s"}` : "Needs love"), el("time", { datetime: p.t, title: new Date(p.t).toLocaleString() }, ago(p.t))),
      el("div", { class: "foot" }));
    card.style.setProperty("--i", i % BATCH);
    // play the entrance once; moving the card later (filters, load more) must not replay it
    card.addEventListener("animationend", () => card.classList.add("shown"), { once: true });
    return card;
  }
  function placeCard(p, i) {
    let card = cards.get(p.id);
    if (!card) { card = makeCard(p, i); cards.set(p.id, card); }
    card.classList.remove("leaving");
    card.classList.toggle("opened", !!opened[p.id]);
    setFoot(card, p.id);
    return card;
  }
  // ---------- welcome row: first time posters, one tap to greet them ----------
  function renderWelcome() {
    const list = data.newcomers || [];
    $("welcome").hidden = !list.length;
    if (!list.length) return;
    // Say hi: a starting line built from three small pools, so visitors almost never share the same reply
    // (identical replies from many accounts look like spam to X). 22 x 20 x 9 = 3,960 combinations, edit before sending.
    const HI = ["welcome to the hatchery", "welcome in", "glad you found the dragons", "good to see you here", "hey welcome",
      "welcome welcome", "nice to have you here", "a new Keeper, love to see it", "welcome to the fam", "happy you made it",
      "welcome aboard", "glad you joined us", "yo welcome", "hey hey, welcome", "welcome to the nest", "great to see a new face",
      "welcome friend", "nice one, welcome", "welcome to pocket dragons", "big welcome", "so glad you are here", "hello and welcome"];
    const MID = ["which egg did you get?", "what made you jump in?", "hope you enjoy it here", "the community here is great",
      "you picked a good time to join", "have fun hatching", "let me know if you need anything", "the AMAs are worth catching",
      "say hi in the discord too", "cannot wait to see your dragon", "enjoy the ride", "you will like it here",
      "good luck with your first hatch", "this place is a lot of fun", "plenty of friendly Keepers around", "what got you curious?",
      "happy hatching", "first of many posts I hope", "keep the posts coming", "nice first post"];
    const END = ["", "", "", " \u{1F409}", " \u{1F95A}", " \u{1F525}", " \u{1F44B}", " \u{2728}", " \u{1F64C}"];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const greet = () => { const a = pick(HI), b = pick(MID), bang = Math.random() < 0.6;
      return `${cap(a)}${bang ? "!" : ","} ${bang ? cap(b) : b}${pick(END)}`; };
    $("welcome-row").replaceChildren(...list.map((n, i) => {
      const avatar = n.avatar
        ? el("img", { class: "avatar", src: n.avatar, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
        : el("span", { class: "avatar blank" }, (n.name || "?").slice(0, 1));
      const hi = greet();
      const card = el("div", { class: "newbie" },
        el("a", { class: "newbie-who", href: `https://x.com/${n.user}/status/${n.id}`, target: "_blank", rel: "noopener" },
          avatar, el("span", { class: "newbie-text" }, el("b", {}, n.name || n.user),
            el("small", {}, (n.hatchery ? "Ancient Hatchery \u00b7 " : "first post \u00b7 ") + ago(n.t)))),
        el("a", { class: "btn btn-go newbie-hi", href: PHONE ? replyUrl(n.id, n.user) : `https://x.com/intent/post?in_reply_to=${n.id}&text=${encodeURIComponent(hi)}`,
          onclick: () => { pace(); if (PHONE) copyHi(hi); },
          target: "_blank", rel: "noopener" }, "Say hi"));
      card.style.setProperty("--i", i);
      return card;
    }));
  }

  // keep the reader's place: render() notes the first cards on screen and puts them back where they were
  const FEED_LISTS = "#pinned-trail .post, #crew-trail .post, #hot-trail .post, #trail .post";
  function placeNow() {
    if (scrollY < 120) return null;
    const out = [];
    for (const c of document.querySelectorAll(FEED_LISTS)) {
      if (!c.dataset.id || c.classList.contains("leaving")) continue;
      const r = c.getBoundingClientRect();
      if (r.bottom > 90) { out.push({ id: c.dataset.id, top: r.top }); if (out.length >= 4) break; }
    }
    return out.length ? out : null;
  }
  function keepPlace(place) {
    if (!place) return;
    for (const a of place) {
      const c = cards.get(a.id);
      if (!c || !c.isConnected || c.classList.contains("leaving")) continue;
      const d = c.getBoundingClientRect().top - a.top;
      if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: "instant" });
      return;
    }
  }
  function render() {
    const place = placeNow();
    const trail = $("trail");
    const official = pinnedPosts.filter((p) => !p.crew), crew = pinnedPosts.filter((p) => p.crew);
    $("pinned").hidden = !official.length;
    $("pinned-trail").replaceChildren(...official.map((p, i) => placeCard(p, i)));
    $("crew").hidden = !crew.length;
    $("crew-trail").replaceChildren(...crew.map((p, i) => placeCard(p, i)));
    const hot = hotList(), hotIds = new Set(hot.map((p) => p.id));
    $("hot").hidden = !hot.length;
    $("hot-trail").replaceChildren(...hot.map((p, i) => placeCard(p, i)));
    const rest = visible().filter((p) => !hotIds.has(p.id) && !pinnedIds.has(p.id));
    const list = rest.slice(0, shown);
    for (const p of list) placeCard(p, 0);
    // only add what is new when the list just grew (smooth infinite scroll), rebuild otherwise
    const have = [...trail.children].map((c) => c.dataset.id), want = list.map((p) => p.id);
    const grew = have.length <= want.length && have.every((id, k) => id === want[k]);
    if (grew) {
      const frag = document.createDocumentFragment();
      list.slice(have.length).forEach((p, k) => { const c = cards.get(p.id); c.style.setProperty("--i", k % BATCH); frag.append(c); });
      trail.append(frag);
    } else {
      // move cards in place, never empty the list
      const keep = new Set(want);
      [...trail.children].forEach((c) => { if (!keep.has(c.dataset.id)) c.remove(); });
      let prev = null;
      list.forEach((p, k) => {
        const c = cards.get(p.id), next = prev ? prev.nextSibling : trail.firstChild;
        if (!c.isConnected) c.style.setProperty("--i", k % BATCH);
        if (c !== next) trail.insertBefore(c, next);
        prev = c;
      });
    }
    keepPlace(place);
    $("empty").hidden = query ? list.length > 0 : list.length + hot.length + pinnedPosts.length > 0;
    $("empty-title").textContent = query ? "Nothing found" : "All caught up";
    $("empty-text").textContent = query ? "No posts match your search." : "No unopened posts here. Fresh ones land every 20 minutes.";
    $("more").hidden = rest.length <= shown;
    counts();
    dispatchEvent(new Event("pd:render"));
  }
  window.pdFeed = { streak: () => liveStreak(), pinned: () => pinnedPosts.slice(), opened: (id) => !!opened[id], open: (id) => markOpened(id, cards.get(id)),
                    first: () => $("trail").querySelector(".post:not(.skel)"), toast: (m) => toast(m) };
  $("more").addEventListener("click", () => { shown += BATCH; render(); });
  // keep filling while the end of the list is near the screen (the observer only fires on changes)
  let filling = false;
  function maybeMore() {
    if (filling) return;
    filling = true;
    requestAnimationFrame(() => {
      filling = false;
      const more = $("more");
      if (!more.hidden && more.getBoundingClientRect().top < innerHeight + 1400) { shown += BATCH; render(); maybeMore(); }
    });
  }
  new IntersectionObserver((e) => { if (e[0].isIntersecting) maybeMore(); }, { rootMargin: "1400px 0px" }).observe($("more"));
  addEventListener("scroll", maybeMore, { passive: true });
  $("needsLove").addEventListener("change", (e) => { needsLove = e.target.checked; store.set("radar:needsLove", needsLove); render(); });
  $("showOpened").addEventListener("change", (e) => { showOpened = e.target.checked; store.set("radar:showOpened", showOpened); render(); });

  // ---------- status line: when posts were last collected and when the next check runs (every 20 minutes) ----------
  let updatedAt = data.updated ? Date.parse(data.updated) : null;
  function statusLine() {
    const el2 = $("status-line"); if (!el2) return;
    if (!updatedAt) { el2.textContent = ""; return; }
    const mins = Math.max(0, Math.round((Date.now() - updatedAt) / 6e4));
    const next = 20 - (new Date().getUTCMinutes() % 20);
    const ago2 = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)}h ago`;
    el2.textContent = mins >= 60 ? `Updated ${ago2}` : `Updated ${ago2} \u00b7 next check in ${next} min`;
    el2.classList.toggle("stale", mins >= 60);
  }
  setInterval(statusLine, 30000);

  // ---------- placeholders while posts load (no empty flash, no layout jump) ----------
  function skeletons(n = 6) {
    const f = document.createDocumentFragment();
    for (let k = 0; k < n; k++) { const d = el("div", { class: "post skel", "aria-hidden": "true" }); d.innerHTML = "<i></i><i></i><i></i><i></i>"; f.append(d); }
    $("trail").replaceChildren(f);
    $("more").hidden = true; $("empty").hidden = true;
  }

  // ---------- "new posts" pill: checks quietly every 2 minutes, adds them only when tapped ----------
  const pending = [];
  const pill = $("new-pill"), pillText = $("new-pill-text");
  function hidePill() { pill.classList.remove("show"); setTimeout(() => { if (!pill.classList.contains("show")) pill.hidden = true; }, 300); }
  function showPill() {
    const n = pending.length;
    pillText.textContent = n === 1 ? "1 new post" : `${n} new posts`;
    pill.hidden = false; requestAnimationFrame(() => pill.classList.add("show"));
  }
  let newPinned = null;
  async function poll() {
    if ((document.hidden && !alerts) || current.range === "yesterday") return;
    const newest = posts.concat(pending).reduce((m, p) => (p.t > m ? p.t : m), "");
    const asked = JSON.stringify(current);              // a filter change while waiting throws this answer away
    const q = new URLSearchParams({ ...current, after: newest || "" });
    try {
      const r = await fetch(`/api/posts?${q}`, { headers: { Accept: "application/json" } });
      if (!r.ok) return;
      const j = await r.json();
      if (asked !== JSON.stringify(current)) return;
      if (j.updated) { updatedAt = Date.parse(j.updated); statusLine(); }
      const have = new Set(posts.concat(pending).map((p) => p.id));
      const fresh = (j.posts || []).filter((p) => !have.has(p.id));
      const pinChanged = (j.pinned || []).map((p) => p.id).join() !== pinnedPosts.map((p) => p.id).join();
      if (pinChanged) {
        newPinned = j.pinned;
        const known = new Set(pinnedPosts.map((p) => p.id));
        (j.pinned || []).filter((p) => !known.has(p.id) && !p.crew).slice(0, 1).forEach(teamAlert);
      }
      if (fresh.length) { pending.unshift(...fresh); showPill(); }
      else if (pinChanged) { pinnedPosts.splice(0, pinnedPosts.length, ...newPinned); pinnedIds.clear(); pinnedPosts.forEach((p) => pinnedIds.add(p.id)); newPinned = null; render(); }
    } catch (e) { /* offline for a moment: try next time */ }
  }
  pill.addEventListener("click", () => {
    const ids = new Set(posts.map((p) => p.id));
    posts.unshift(...pending.filter((p) => !ids.has(p.id)));
    posts.sort((a, b) => (a.t < b.t ? 1 : -1));
    pending.length = 0;
    if (newPinned) { pinnedPosts.splice(0, pinnedPosts.length, ...newPinned); pinnedIds.clear(); pinnedPosts.forEach((p) => pinnedIds.add(p.id)); newPinned = null; }
    hidePill();
    render(); pulse(); loadDays();
    const top = $("feed").getBoundingClientRect().top + scrollY - 90;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  });
  setInterval(poll, 120000);
  // Refresh button: checks right away and adds any new posts on the spot, or says the feed is up to date
  const rbtn = $("refresh");
  if (rbtn) rbtn.addEventListener("click", async () => {
    if (rbtn.disabled) return;
    if (!navigator.onLine) { toast("You are offline. Your feed is still here, try again when you are back online."); return; }
    rbtn.disabled = true; rbtn.classList.add("spin");
    const t0 = Date.now();
    await poll();
    await new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - t0))));   // a short spin so the tap feels heard
    rbtn.disabled = false; rbtn.classList.remove("spin");
    if (pending.length) pill.click();
    else toast("You are all caught up. New posts arrive every 20 minutes.", 4000);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

  // ---------- filters: keep the other choices when one changes ----------
  const params = new URLSearchParams(location.search);
  const current = { range: params.get("range") || "24h", who: params.get("who") || "all", quotes: $("quotes").checked ? "1" : "0" };
  // a shared custom range link keeps its dates while the other filters change
  if (current.range === "custom") { if (params.get("from")) current.from = params.get("from"); if (params.get("to")) current.to = params.get("to"); }
  // switching range or who swaps just the posts, no page reload
  let busy = null;
  function pressed() {
    document.querySelectorAll('#filters button[name="range"]').forEach((b) => b.setAttribute("aria-pressed", String(b.value === current.range)));
    document.querySelectorAll('#filters button[name="who"]').forEach((b) => b.setAttribute("aria-pressed", String(b.value === current.who)));
    $("quotes").checked = current.quotes === "1";
  }
  async function go(change, push = true) {
    if (!navigator.onLine) { toast("You are offline. Your feed is still here, try again when you are back online."); pressed(); return; }
    const before = { ...current };
    Object.assign(current, change);
    if (current.range !== "custom") { delete current.from; delete current.to; }
    pressed();
    const q = new URLSearchParams(current).toString();
    if (push) history.pushState(current, "", `?${q}`);
    const ticket = busy = {};
    skeletons();
    hidePill(); pending.length = 0;
    try {
      const r = await fetch(`/api/posts?${q}`, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (ticket !== busy) return;                        // a newer click won
      posts.splice(0, posts.length, ...(j.posts || []));
      pinnedPosts.splice(0, pinnedPosts.length, ...(j.pinned || []));
      pinnedIds.clear(); pinnedPosts.forEach((p) => pinnedIds.add(p.id));
      data.newcomers = j.newcomers || [];
      shown = BATCH;
      render(); renderWelcome(); pulse();
      if ("who" in change || "quotes" in change) loadDays(); else paintDays(true);
    } catch (e) {
      if (ticket !== busy) return;                        // an older request failing must not undo a newer filter
      if (!navigator.onLine || e instanceof TypeError) { // no connection: keep the posts on screen and the old choice
        Object.keys(current).forEach((k) => delete current[k]); Object.assign(current, before);
        pressed(); render();
        toast("You are offline. Your feed is still here, try again when you are back online.");
        return;
      }
      location.search = q;                                // a server hiccup: fall back to a normal page load
    } finally { /* render() replaced the placeholders */ }
  }
  document.querySelectorAll('#filters button[name="range"]').forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go({ range: b.value }); }));
  document.querySelectorAll('#filters button[name="who"]').forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go({ who: b.value }); }));
  $("quotes").addEventListener("change", (e) => go({ quotes: e.target.checked ? "1" : "0" }));
  addEventListener("popstate", () => {
    const p2 = new URLSearchParams(location.search);
    go({ range: p2.get("range") || "24h", who: p2.get("who") || "all", quotes: p2.get("quotes") === "0" ? "0" : "1" }, false);
  });
  document.querySelectorAll("time[data-rel]").forEach((t) => { t.textContent = ago(t.getAttribute("datetime")); });

  // ---------- catch up by day: the last 7 days, each keeping the posts this browser has not opened yet ----------
  // The server only sends each day's post ids; which ones are opened stays in this browser, like the rest of the feed.
  let dayList = null, skipped = null;              // skipped: { day, ids } after "Mark ... as done", so Undo can bring them back
  const dayName = (iso) => {
    const gap = dayList ? dayGap(iso, dayList.today) : 9;
    if (gap === 0) return "Today";
    if (gap === 1) return "Yesterday";
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  };
  const leftIn = (d) => d.ids.filter((id) => !opened[id] && !unavailable.has(id));
  function pickedDay() {
    if (!dayList) return null;
    if (current.range === "custom" && current.from && (!current.to || current.to === current.from)) return current.from;
    if (current.range === "today") return dayList.today;
    if (current.range === "yesterday" && dayList.days[1]) return dayList.days[1].day;
    return null;
  }
  async function loadDays() {
    try {
      const r = await fetch(`/api/days?${new URLSearchParams({ who: current.who, quotes: current.quotes })}`, { headers: { Accept: "application/json" } });
      if (!r.ok) return;
      const j = await r.json();
      if (!j || !Array.isArray(j.days)) return;
      dayList = j; paintDays(true);
    } catch (e) { /* offline for a moment: the strip waits for the next load */ }
  }
  function paintDays(scroll) {
    const box = $("days");
    if (!box || !dayList) return;
    const pick = pickedDay();
    const rows = dayList.days.map((d) => ({ day: d.day, ids: d.ids, left: leftIn(d).length }));
    box.hidden = !rows.some((d) => d.ids.length);
    $("days-row").replaceChildren(...rows.map((d) => {
      const state = !d.ids.length ? "none" : d.left ? "left" : "done", on = d.day === pick;
      const long = new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
      return el("button", { class: `day-chip ${state}${on ? " on" : ""}`, type: "button", "aria-pressed": String(on), title: long,
        onclick: () => openDay(d.day) },
        el("b", {}, dayName(d.day)), el("span", {}, state === "none" ? "no posts" : d.left ? `${d.left} left` : "all done ✓"));
    }));
    if (scroll) { const on = $("days-row").querySelector(".on"); on && on.scrollIntoView({ block: "nearest", inline: "center" }); }
    // the note is about earlier days only, today is the main feed already
    const earlier = rows.slice(1).filter((d) => d.left), total = earlier.reduce((n, d) => n + d.left, 0);
    const oldest = earlier[earlier.length - 1];
    $("days-note").textContent = total
      ? `${total} ${total === 1 ? "post" : "posts"} from earlier days ${total === 1 ? "is" : "are"} still waiting for you`
      : rows.slice(1).some((d) => d.ids.length) ? "You are all caught up on earlier days \u{1F409}" : "";
    const start = $("days-go");
    start.hidden = !oldest || oldest.day === pick;
    if (oldest) { start.textContent = `Start with ${dayName(oldest.day)}`; start.onclick = () => openDay(oldest.day); }
    // a past day is open: offer to mark the rest of it done, or undo that
    const cur = rows.find((d) => d.day === pick), bar = $("days-bar"), btn = $("days-skip");
    if (skipped && skipped.day === pick) {
      bar.hidden = false;
      $("days-bar-text").textContent = `${dayName(pick)} is marked done.`;
      btn.textContent = "Undo"; btn.onclick = undoSkip;
    } else if (cur && cur.day !== dayList.today && cur.left) {
      bar.hidden = false;
      $("days-bar-text").textContent = `${cur.left} left from ${dayName(pick)}. Too many to get through?`;
      btn.textContent = `Mark ${dayName(pick)} as done`; btn.onclick = () => skipDay(cur);
      btn.title = "Hides the rest of this day. It does not count as support, and you can undo it.";
    } else bar.hidden = true;
  }
  function openDay(day) {
    if (skipped && skipped.day !== day) skipped = null;
    if (dayList && day === dayList.today) go({ range: "today" });
    else go({ range: "custom", from: day, to: day });
  }
  // "Done" for a whole day: it only tidies the posts away, it never counts as support (same as the Done button)
  function skipDay(d) {
    Object.assign(opened, store.obj("radar:opened"));   // keep what another tab opened
    const ids = leftIn(d);
    if (!ids.length) return;
    const t = Date.now();
    ids.forEach((id) => { opened[id] = t; });
    save(); skipped = { day: d.day, ids }; render();
  }
  function undoSkip() {
    if (!skipped) return;
    skipped.ids.forEach((id) => { delete opened[id]; });
    save(); skipped = null; render();
  }
  addEventListener("storage", (e) => { if (e.key === "radar:opened" && dayList) { Object.assign(opened, store.obj("radar:opened")); paintDays(); } });

  // ---------- the 5 second opening (skipped when changing filters) ----------
  let revealed = false, timer = null;
  function reveal() {
    if (revealed) return; revealed = true; clearTimeout(timer);
    document.body.classList.add("ready");
    setTimeout(() => window.meadow && window.meadow.setLowRes(true), 1700);
  }
  function playIntro() {
    revealed = false; document.body.classList.remove("quick");
    window.scrollTo({ top: 0, behavior: "auto" });
    window.meadow && window.meadow.setLowRes(false);
    document.body.classList.remove("ready");
    const bar = document.querySelector(".skip circle.bar");
    bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
    timer = setTimeout(reveal, INTRO_MS);
  }
  $("skip").addEventListener("click", reveal);
  $("replay").addEventListener("click", playIntro);
  document.addEventListener("keydown", (e) => { if (!revealed && (e.key === "Escape" || e.key === "Enter")) reveal(); });

  let searchTimer = null;
  $("f-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value.trim().toLowerCase().replace(/^@/, ""); shown = BATCH; render(); }, 160);
  });
  $("f-search").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  function fromHash() {
    if (location.hash === "#progress") { showStreak(); pgMsg("", true); openSheet("progress"); history.replaceState(null, "", location.pathname + location.search); }
  }
  addEventListener("hashchange", fromHash);
  document.querySelectorAll("#tab-progress, [data-pd-progress]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showStreak(); pgMsg("", true); openSheet("progress"); }));

  // a reload while on X, or the back button: come back to the same cards, not the very bottom
  const PLACE_KEY = "pd:place";
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  function savePlace() {
    const pl = placeNow();
    try { pl ? sessionStorage.setItem(PLACE_KEY, JSON.stringify({ q: location.search, at: Date.now(), shown, ids: pl })) : sessionStorage.removeItem(PLACE_KEY); } catch (e) { /* private mode */ }
  }
  addEventListener("pagehide", savePlace);
  document.addEventListener("visibilitychange", () => { if (document.hidden) savePlace(); });
  function restorePlace() {
    let pl = null; try { pl = JSON.parse(sessionStorage.getItem(PLACE_KEY) || "null"); } catch (e) { pl = null; }
    const nav = ((performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || {}).type;
    if (!pl || !Array.isArray(pl.ids) || pl.q !== location.search || location.hash || Date.now() - (pl.at || 0) > 6 * 3600e3
      || !(nav === "reload" || nav === "back_forward")) return;
    shown = Math.max(shown, Math.min(pl.shown | 0, 600));
    render();
    let moved = false;
    ["wheel", "touchstart", "keydown"].forEach((k) => addEventListener(k, () => { moved = true; }, { once: true, passive: true }));
    const back = () => {
      if (moved) return;
      for (const a of pl.ids) {
        const c = cards.get(a.id);
        if (c && c.isConnected) { window.scrollTo({ top: c.getBoundingClientRect().top + scrollY - a.top, behavior: "instant" }); return; }
      }
    };
    back(); requestAnimationFrame(back); setTimeout(back, 400);
  }

  render();
  restorePlace();
  renderWelcome();
  pulse();
  loadDays();
  showStreak();
  showGoal();
  statusLine();
  fromHash();
  let seenIntro = false;
  try { seenIntro = sessionStorage.getItem("radar:intro") === "1"; sessionStorage.setItem("radar:intro", "1"); } catch (e) {}
  // already watched the opening this visit: the page simply appears, no long fade
  if (seenIntro) document.body.classList.add("quick");
  if (reduce || seenIntro) reveal(); else timer = setTimeout(reveal, INTRO_MS);
})();
