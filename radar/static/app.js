(() => {
  "use strict";
  const data = JSON.parse(document.getElementById("radar-data").textContent);
  const posts = data.posts || [];
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
  const visible = () => pool().filter((p) => showOpened || !opened[p.id]);

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

  // ---------- opening ----------
  function markOpened(id, card) {
    if (opened[id]) return;
    opened[id] = Date.now();
    save();
    window.meadow && window.meadow.cheer();
    counts(true);
    if (!card) return;
    if (showOpened) { card.classList.add("opened"); setFoot(card, id); return; }
    setTimeout(() => { card.classList.add("leaving"); setTimeout(render, 700); }, 200);
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
    if (p.media) chips.push(el("span", { class: "tag media" }, "Photo or video"));
    else if (links) chips.push(el("span", { class: "tag media" }, "Link"));
    const avatar = p.avatar
      ? el("img", { class: "avatar", src: p.avatar, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
      : el("span", { class: "avatar blank" }, (p.name || "?").slice(0, 1));
    const card = el("article", { class: "post" + (p.team ? " team" : ""), "data-id": p.id },
      el("header", { class: "card-head" }, avatar,
        el("a", { class: "who", href: `https://x.com/${p.user}`, target: "_blank", rel: "noopener" },
          el("b", { class: "name" }, p.name || p.user), el("span", { class: "handle" }, `@${p.user}`)),
        el("a", { class: "xmark", href: url, target: "_blank", rel: "noopener", title: "View on X", html: xLogo })),
      el("a", { class: "text", href: url, target: "_blank", rel: "noopener", onclick: () => markOpened(p.id, card) },
        text || "(no text)"),
      el("div", { class: "meta" }, ...chips, el("time", { datetime: p.t, title: new Date(p.t).toLocaleString() }, ago(p.t))),
      el("div", { class: "foot" }));
    card.style.setProperty("--i", i % BATCH);
    tilt(card);
    return card;
  }
  function render() {
    const trail = $("trail");
    const list = visible().slice(0, shown);
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
    $("empty").hidden = list.length > 0;
    $("more").hidden = visible().length <= shown;
    counts();
  }
  $("more").addEventListener("click", () => { shown += BATCH; render(); });
  new IntersectionObserver((e) => { if (e[0].isIntersecting && !$("more").hidden) { shown += BATCH; render(); } }, { rootMargin: "500px 0px" }).observe($("more"));
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
  let seenIntro = false;
  try { seenIntro = sessionStorage.getItem("radar:intro") === "1"; sessionStorage.setItem("radar:intro", "1"); } catch (e) {}
  if (reduce || seenIntro) reveal(); else timer = setTimeout(reveal, INTRO_MS);
})();
