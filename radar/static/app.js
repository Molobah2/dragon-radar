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
  };
  const opened = (() => {
    const raw = store.get("radar:opened", {}), map = raw && typeof raw === "object" ? raw : {};
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    for (const id of Object.keys(map)) if (!(map[id] > cutoff)) delete map[id];
    return map;
  })();
  const save = () => store.set("radar:opened", opened);
  const lastVisit = store.get("radar:lastVisit", null);
  setTimeout(() => store.set("radar:lastVisit", Date.now()), 5000);

  let showOpened = !!store.get("radar:showOpened", false);
  $("showOpened").checked = showOpened;
  const unavailable = new Set();
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
  const arrow = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const pool = () => posts.filter((p) => !unavailable.has(p.id));
  let needsLove = !!store.get("radar:needsLove", false);
  $("needsLove").checked = needsLove;
  const visible = () => pool().filter((p) => (showOpened || !opened[p.id]) && (!needsLove || !p.opens));
  const HOT_MIN = 2, HOT_MAX = 4;
  const hotList = () => needsLove ? [] : visible().filter((p) => p.opens >= HOT_MIN && !pinnedIds.has(p.id))
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
  function markOpened(id, card) {
    if (opened[id]) return;
    opened[id] = Date.now();
    save();
    window.keeperBump && window.keeperBump();
    const post = posts.find((x) => x.id === id) || pinnedPosts.find((x) => x.id === id);
    if (post) { post.opens = (post.opens || 0) + 1; }
    try { fetch(`/api/open/${id}`, { method: "POST", keepalive: true }); } catch (e) {}
    window.meadow && window.meadow.cheer();
    counts(true);
    if (!card) return;
    if (showOpened || pinnedIds.has(id)) { card.classList.add("opened"); setFoot(card, id); return; }
    setTimeout(() => { card.classList.add("leaving"); setTimeout(render, 360); }, 120);
  }
  function undo(id) { delete opened[id]; save(); render(); }
  function setFoot(card, id) {
    card.querySelector(".foot").replaceChildren(el("div", { class: "actions" },
      el("a", { class: "btn btn-go", href: `https://x.com/i/status/${id}`, target: "_blank", rel: "noopener", html: `${arrow}Open on X`,
                onclick: () => markOpened(id, card), onauxclick: () => markOpened(id, card) }),
      opened[id]
        ? el("button", { class: "btn btn-soft", type: "button", onclick: () => undo(id) }, "Undo")
        : el("button", { class: "btn btn-soft", type: "button", onclick: () => markOpened(id, card) }, "Done")));
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
    if (p.quote) chips.push(el("span", { class: "tag" }, "Quote"));
    if (p.media) chips.push(el("span", { class: "tag media" }, "Media"));
    else if (links) chips.push(el("span", { class: "tag media" }, "Link"));
    // read the post in your own language (opens Google Translate, nothing is sent from here)
    if (window.radarLang && window.radarLang !== "en" && p.text)
      chips.push(el("a", { class: "tag tr-link", href: `https://translate.google.com/?sl=auto&tl=${window.radarTranslateCode}&text=${encodeURIComponent(p.text.slice(0, 1500))}&op=translate`,
        target: "_blank", rel: "noopener" }, "Translate"));
    const avatar = p.avatar
      ? el("img", { class: "avatar", src: p.avatar, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
      : el("span", { class: "avatar blank" }, (p.name || "?").slice(0, 1));
    // one line posts get a bigger, quote style text so the card never looks half empty
    const short = (text || "").length <= 60 && !(text || "").includes("\n");
    const card = el("article", { class: "post" + (p.team ? " team" : "") + (short ? " short" : ""), "data-id": p.id },
      el("header", { class: "card-head" }, avatar,
        el("a", { class: "who", href: `https://x.com/${p.user}`, target: "_blank", rel: "noopener" },
          el("b", { class: "name" }, p.name || p.user), el("span", { class: "handle" }, `@${p.user}`)),
        el("a", { class: "xmark", href: url, target: "_blank", rel: "noopener", title: "View on X", html: xLogo })),
      el("a", { class: "text", href: url, target: "_blank", rel: "noopener", onclick: () => markOpened(p.id, card) },
        text || "(no text)"),
      el("div", { class: "meta" }, ...chips, el("span", { class: "reach" + (p.opens ? "" : " none"), title: "Visitors who opened this post" },
        p.opens ? `${p.opens} Keeper${p.opens === 1 ? "" : "s"}` : "Needs love"), el("time", { datetime: p.t, title: new Date(p.t).toLocaleString() }, ago(p.t))),
      el("div", { class: "foot" }));
    card.style.setProperty("--i", i % BATCH);
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
    // a few different openers so nobody ends up posting identical replies (X dislikes copy paste)
    const greets = ["Welcome to the hatchery \u{1F409}", "Glad you found the dragons, welcome Keeper", "Welcome in! Which egg did you get?",
      "Good to see you in the hatchery \u{1F95A}", "Welcome Keeper, see you at the next AMA", "A new Keeper! Welcome \u{1F525}"];
    $("welcome-row").replaceChildren(...list.map((n, i) => {
      const avatar = n.avatar
        ? el("img", { class: "avatar", src: n.avatar, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
        : el("span", { class: "avatar blank" }, (n.name || "?").slice(0, 1));
      const card = el("div", { class: "newbie" },
        el("a", { class: "newbie-who", href: `https://x.com/${n.user}/status/${n.id}`, target: "_blank", rel: "noopener" },
          avatar, el("span", { class: "newbie-text" }, el("b", {}, n.name || n.user),
            el("small", {}, (n.hatchery ? "Ancient Hatchery \u00b7 " : "first post \u00b7 ") + ago(n.t)))),
        el("a", { class: "btn btn-go newbie-hi", href: `https://x.com/intent/post?in_reply_to=${n.id}&text=${encodeURIComponent(greets[(i + Math.floor(Math.random() * greets.length)) % greets.length])}`,
          target: "_blank", rel: "noopener" }, "Say hi"));
      card.style.setProperty("--i", i);
      return card;
    }));
  }

  function render() {
    const trail = $("trail");
    $("pinned").hidden = !pinnedPosts.length;
    $("pinned-trail").replaceChildren(...pinnedPosts.map((p, i) => placeCard(p, i)));
    const hot = hotList(), hotIds = new Set(hot.map((p) => p.id));
    $("hot").hidden = !hot.length;
    $("hot-trail").replaceChildren(...hot.map((p, i) => placeCard(p, i)));
    const rest = visible().filter((p) => !hotIds.has(p.id) && !pinnedIds.has(p.id));
    const list = rest.slice(0, shown);
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const p of list) {
      let card = cards.get(p.id);
      if (!card) { card = makeCard(p, i); cards.set(p.id, card); }
      card.classList.remove("leaving");
      card.classList.toggle("opened", !!opened[p.id]);
      setFoot(card, p.id);
      frag.append(card); i++;
    }
    trail.replaceChildren(frag);
    $("empty").hidden = list.length + hot.length + pinnedPosts.length > 0;
    $("more").hidden = rest.length <= shown;
    counts();
  }
  $("more").addEventListener("click", () => { shown += BATCH; render(); });
  new IntersectionObserver((e) => { if (e[0].isIntersecting && !$("more").hidden) { shown += BATCH; render(); } }, { rootMargin: "500px 0px" }).observe($("more"));
  $("needsLove").addEventListener("change", (e) => { needsLove = e.target.checked; store.set("radar:needsLove", needsLove); render(); });
  $("showOpened").addEventListener("change", (e) => { showOpened = e.target.checked; store.set("radar:showOpened", showOpened); render(); });

  // ---------- filters: keep the other choices when one changes ----------
  const params = new URLSearchParams(location.search);
  const current = { range: params.get("range") || "24h", who: params.get("who") || "all", quotes: $("quotes").checked ? "1" : "0" };
  function go(change) { const q = new URLSearchParams({ ...current, ...change }); location.search = q.toString(); }
  document.querySelectorAll('#filters button[name="range"]').forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go({ range: b.value }); }));
  document.querySelectorAll('#filters button[name="who"]').forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); go({ who: b.value }); }));
  $("quotes").addEventListener("change", (e) => go({ quotes: e.target.checked ? "1" : "0" }));
  document.querySelectorAll("time[data-rel]").forEach((t) => { t.textContent = ago(t.getAttribute("datetime")); });

  // ---------- the 5 second opening (skipped when changing filters) ----------
  let revealed = false, timer = null;
  function reveal() {
    if (revealed) return; revealed = true; clearTimeout(timer);
    document.body.classList.add("ready");
    setTimeout(() => window.meadow && window.meadow.setLowRes(true), 1700);
  }
  function playIntro() {
    revealed = false;
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

  render();
  renderWelcome();
  pulse();
  let seenIntro = false;
  try { seenIntro = sessionStorage.getItem("radar:intro") === "1"; sessionStorage.setItem("radar:intro", "1"); } catch (e) {}
  if (reduce || seenIntro) reveal(); else timer = setTimeout(reveal, INTRO_MS);
})();
