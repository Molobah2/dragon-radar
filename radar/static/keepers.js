// Keeper directory: who to follow. Followed state lives only in this browser.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const followed = store.get("radar:followed", {}) || {};
  let show = "all", hide = !!store.get("radar:hideFollowed", false), query = "";
  $("k-hide").checked = hide;
  let team = [], keepers = [];
  const fans = store.get("pd:authors", {}) || {};          // whose posts you opened on the feed (this browser only)
  const fanOf = (k) => fans[k.username.toLowerCase()] || 0;
  let sort = store.get("radar:kSort", null) || (Object.keys(fans).length ? "foryou" : "suggested");
  $("k-sort").value = sort;

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  };
  const DAY = 864e5;
  const ago = (iso) => {
    const d = (Date.now() - Date.parse(iso)) / DAY;
    if (d < 1) return "today"; if (d < 2) return "yesterday"; return `${Math.floor(d)} days ago`;
  };
  // Daily shuffle so the same people are not always on top
  const seedOf = (str) => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const today = new Date().toISOString().slice(0, 10);
  const rank = (k) => seedOf(today + k.username);

  // Gentle pacing: X frowns on very fast following
  const recent = () => Object.values(followed).filter((t) => Date.now() - t < 15 * 60 * 1000).length;
  function pace() {
    const n = recent(), note = $("k-note");
    note.hidden = n < 10;
    note.textContent = "Nice run. Take a short breather before following more, X can limit accounts that follow very fast.";
  }

  function follow(k, card) {
    followed[k.username.toLowerCase()] = Date.now(); store.set("radar:followed", followed);
    window.meadow && window.meadow.cheer && window.meadow.cheer();
    pace(); setTimeout(render, 400);
  }
  function unfollow(k) { delete followed[k.username.toLowerCase()]; store.set("radar:followed", followed); render(); }

  function card(k, isTeam) {
    const done = !!followed[k.username.toLowerCase()];
    const url = `https://x.com/${k.username}`;
    const av = k.avatar ? el("img", { class: "avatar", src: k.avatar, alt: "", loading: "lazy" })
      : el("span", { class: "avatar blank" }, (k.name || "?").slice(0, 1));
    const n = fanOf(k);
    const meta = isTeam ? el("span", { class: "tag team" }, k.role)
      : n ? el("span", { class: "kp-when fan" }, n === 1 ? "You opened 1 of their posts" : `You opened ${n} of their posts`)
      : el("span", { class: "kp-when" + (k.last_post ? "" : " quiet") }, k.last_post ? `Posted about the dragons ${ago(k.last_post)}` : "Quiet lately");
    return el("article", { class: "post kp-card" + (done ? " opened" : "") + (isTeam ? " team" : "") },
      el("header", { class: "card-head" }, av,
        el("a", { class: "who", href: url, target: "_blank", rel: "noopener" },
          el("b", { class: "name" }, k.name || k.username), el("span", { class: "handle" }, `@${k.username}`))),
      el("div", { class: "meta" }, meta),
      el("div", { class: "actions" },
        done
          ? el("button", { class: "btn btn-soft", type: "button", onclick: () => unfollow(k) }, "Followed · undo")
          : el("a", { class: "btn btn-go", href: `https://x.com/intent/follow?screen_name=${encodeURIComponent(k.username)}`,
              target: "_blank", rel: "noopener", onclick: () => follow(k) }, "Follow on X"),
        el("a", { class: "btn btn-soft", href: url, target: "_blank", rel: "noopener" }, "Profile")));
  }

  function render() {
    $("k-team").replaceChildren(...team.map((t) => card(t, true)));
    const week = Date.now() - 7 * DAY;
    let list = keepers.slice();
    if (show === "active") list = list.filter((k) => k.last_post && Date.parse(k.last_post) >= week);
    if (show === "new") list = list.filter((k) => Date.parse(k.since) >= week);
    if (query) list = list.filter((k) => (k.name + " " + k.username).toLowerCase().includes(query));
    if (hide) list = list.filter((k) => !followed[k.username.toLowerCase()]);
    const recentFirst = (a, b) => (Date.parse(b.last_post || 0) || 0) - (Date.parse(a.last_post || 0) || 0);
    if (sort === "foryou") list.sort((a, b) => fanOf(b) - fanOf(a) || recentFirst(a, b));
    else if (sort === "active") list.sort(recentFirst);
    else if (sort === "newest") list.sort((a, b) => (Date.parse(b.since) || 0) - (Date.parse(a.since) || 0));
    else if (sort === "az") list.sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
    else {
      // Suggested: active this week first (shuffled daily so the same people are not always on top), then by latest post
      list.sort((a, b) => {
        const aa = a.last_post && Date.parse(a.last_post) >= week, bb = b.last_post && Date.parse(b.last_post) >= week;
        if (aa !== bb) return aa ? -1 : 1;
        if (aa) return rank(a) - rank(b);
        return recentFirst(a, b);
      });
    }
    $("k-list").replaceChildren(...list.map((k) => card(k, false)));
    $("k-empty").hidden = list.length > 0;
    $("k-count").textContent = keepers.length;
    $("k-left").textContent = keepers.filter((k) => !followed[k.username.toLowerCase()]).length;
  }

  document.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => {
    show = b.dataset.show;
    document.querySelectorAll("[data-show]").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    render();
  }));
  $("k-search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase().replace(/^@/, ""); render(); });
  $("k-sort").addEventListener("change", (e) => { sort = e.target.value; store.set("radar:kSort", sort); render(); });
  $("k-hide").addEventListener("change", (e) => { hide = e.target.checked; store.set("radar:hideFollowed", hide); render(); });

  async function add() {
    const handle = $("k-handle").value.trim(), msg = $("k-msg");
    if (!handle) return;
    $("k-add").disabled = true; msg.textContent = "Blinky is checking...";
    try {
      const r = await fetch("/api/keepers/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle }) });
      const j = await r.json();
      msg.textContent = j.message; msg.className = "kp-msg " + (j.ok ? "ok" : "no");
      if (j.ok) load();
    } catch (e) { msg.textContent = "Something went wrong. Try again."; }
    $("k-add").disabled = false;
  }
  $("k-add").addEventListener("click", add);
  $("k-handle").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });

  async function load() {
    try {
      const j = await (await fetch("/api/keepers")).json();
      team = j.team || []; keepers = j.keepers || [];
    } catch (e) {}
    render();
  }
  load(); pace();
})();
