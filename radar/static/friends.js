/* v2: "Start here" for newcomers, the official post rally, and Blinky's Book of Friends
   (sign with your X name, prove it with one post, tiers, who supported you, top supporters, bring a friend).
   Everything about support is counted on the server from anonymous opens; this file only shows it. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const vid = () => store.get("pd:vid") || "";
  const toast = (m) => window.pdFeed && window.pdFeed.toast(m);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const TIER = { gold: "Gold friend", silver: "Silver friend", bronze: "Bronze friend" };


  // ---------- Start here: one welcome card for someone who has never opened a post ----------
  const sh = $("start-here");
  const isNew = () => { let o = {}; try { o = JSON.parse(localStorage.getItem("radar:opened") || "{}") || {}; } catch (e) { o = {}; } return !Object.keys(o).length; };
  const hideStart = () => { store.set("pd:startSeen", "1"); if (sh) sh.hidden = true; };
  if (sh && !store.get("pd:startSeen") && isNew()) sh.hidden = false;
  if (sh) {
    $("sh-go").addEventListener("click", () => {
      hideStart();
      const first = window.pdFeed && window.pdFeed.first();
      if (!first) return;
      first.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      first.classList.add("spotlight");
      setTimeout(() => first.classList.remove("spotlight"), 4200);
    });
    $("sh-skip").addEventListener("click", hideStart);
    addEventListener("pd:opened", () => { if (!sh.hidden) hideStart(); });
  }

  // ---------- official post rally: while a new official post is under 6 hours old ----------
  const RALLY_HOURS = 6;
  function rally() {
    const box = $("rally");
    if (!box || !window.pdFeed) return;
    const off = window.pdFeed.pinned().filter((p) => !p.crew).sort((a, b) => (a.t < b.t ? 1 : -1))[0];
    const age = off ? (Date.now() - Date.parse(off.t)) / 36e5 : 99;
    if (!off || age > RALLY_HOURS) { box.hidden = true; return; }
    const n = off.opens || 0, mine = window.pdFeed.opened(off.id);
    $("rally-text").textContent = mine
      ? (n > 2 ? `You joined the rally with ${n - 1} other Keepers` : n === 2 ? "You joined the rally with 1 other Keeper" : "You started the rally. Others will follow")
      : n === 1 ? "1 Keeper has opened the new official post"
      : n > 1 ? `${n} Keepers have opened the new official post` : "The team just posted. Be the first to rally behind it";
    $("rally-go").hidden = mine;
    box.dataset.id = off.id;
    box.classList.toggle("joined", mine);
    box.hidden = false;
  }
  if ($("rally")) {
    $("rally-go").addEventListener("click", () => {
      const id = $("rally").dataset.id; if (!id) return;
      window.open(`https://x.com/i/status/${id}`, "_blank", "noopener");
      window.pdFeed.open(id);
      setTimeout(rally, 60);
    });
    addEventListener("pd:render", rally);
    addEventListener("pd:opened", () => setTimeout(rally, 60));
    setInterval(rally, 60000);
    rally();
  }

  // ---------- Blinky's Book of Friends ----------
  const wrap = $("book");
  if (!wrap) return;
  let me = null, book = null;
  const msg = (t, ok) => { $("bm-msg").textContent = t || ""; $("bm-msg").className = "kp-msg " + (ok ? "ok" : "no"); };
  async function getJSON(url, body) {
    const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) } : { headers: { Accept: "application/json" } });
    return r.json();
  }
  async function loadMe() { try { me = await getJSON(`/api/book/me?vid=${encodeURIComponent(vid())}`); } catch (e) { me = me || { status: "none" }; } showMe(); return me; }
  async function loadBook() { try { book = await getJSON("/api/book"); } catch (e) { return; } showBook(); }

  function showMe() {
    const st = (me && me.status) || "none";
    $("bm-none").hidden = st !== "none";
    $("bm-pending").hidden = st !== "pending";
    $("bm-done").hidden = st !== "confirmed";
    if (st === "pending") {
      $("bm-proof").textContent = me.text;
      $("bm-post").href = `https://x.com/intent/post?text=${encodeURIComponent(me.text)}`;
    }
    if (st !== "confirmed") return;
    $("bm-name").textContent = `@${me.handle}`;
    $("bm-tier").hidden = !me.tier;
    if (me.tier) { $("bm-tier").textContent = TIER[me.tier]; $("bm-tier").className = `tag tier tier-${me.tier}`; }
    const nx = me.next;
    $("bm-week").replaceChildren(el("span", "", me.week === 1 ? "This week you supported 1 Keeper." : `This week you supported ${me.week} different Keepers.`),
      ...(nx ? [document.createTextNode(" "), el("span", "", `${nx.need - me.week} more for ${TIER[nx.tier]}.`)] : []));
    $("bm-meter").style.width = `${Math.min(100, Math.round(100 * me.week / (nx ? nx.need : Math.max(1, me.week))))}%`;
    const list = $("bm-supporters");
    list.replaceChildren(...(me.supporters || []).map((s) => {
      const li = el("li"); const a = el("a", "", `@${s.handle}`); a.href = `https://x.com/${s.handle}`; a.target = "_blank"; a.rel = "noopener";
      li.append(a, el("span", "bm-n", s.posts === 1 ? "opened 1 post" : `opened ${s.posts} posts`)); return li;
    }));
    if (!list.children.length) list.append(el("li", "bm-empty", "No signed Keepers yet. Keep posting about the dragons and they will find you."));
    const sup = (me.supporters || []).slice(0, 5).map((x) => `@${x.handle}`);
    $("bm-thank").hidden = !sup.length;
    if (sup.length) $("bm-thank").href = `https://x.com/intent/post?text=${encodeURIComponent(`Thank you to the Keepers who supported my posts this week on Blinky's Friends \u{1F409} ${sup.join(" ")} pdtools.xyz/friends`)}`;
    tierCardFor(me);
  }

  function showBook() {
    if (!book) return;
    $("book-count").textContent = book.count === 1 ? "1 Keeper has signed so far." : `${book.count} Keepers have signed so far.`;
    $("book-top").replaceChildren(...book.top.map((f) => {
      const li = el("li"); const a = el("a", "", `@${f.handle}`); a.href = `https://x.com/${f.handle}`; a.target = "_blank"; a.rel = "noopener";
      li.append(a, el("span", "bm-n", f.week === 1 ? "supported 1 Keeper" : `supported ${f.week} Keepers`)); return li;
    }));
    if (!book.top.length) $("book-top").append(el("li", "bm-empty", "The week has just begun. Open posts from fellow Keepers to appear here."));
    const top3 = book.top.slice(0, 3);
    $("book-top-post").hidden = top3.length < 3;
    if (top3.length === 3) $("book-top-post").href = `https://x.com/intent/post?text=${encodeURIComponent(
      `This week's top supporters in Blinky's Book of Friends \u{1F409}\n${top3.map((f, i) => `${i + 1}. @${f.handle}`).join("\n")}\nThank you for lifting the meadow. pdtools.xyz/friends`)}`;
    $("book-names").replaceChildren(...book.friends.map((f) => {
      const li = el("li", f.tier ? `tier-${f.tier}` : ""); const a = el("a", "", `@${f.handle}`); a.href = `https://x.com/${f.handle}`; a.target = "_blank"; a.rel = "noopener";
      li.append(a); return li;
    }));
    if (!book.friends.length) $("book-names").append(el("li", "bm-empty", "Be the first name in the book."));
  }

  function open() {
    wrap.hidden = false; (void wrap.offsetWidth, wrap.classList.add("open")); document.body.classList.add("sheet-open");
    msg(""); loadMe(); loadBook();
  }
  function close() { wrap.classList.remove("open"); (document.querySelector(".sheet-wrap.open") || document.body.classList.remove("sheet-open")); setTimeout(() => { if (!wrap.classList.contains("open")) wrap.hidden = true; }, 250); }
  document.querySelectorAll("[data-book]").forEach((b) => b.addEventListener("click", open));
  $("book-close").addEventListener("click", close);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });

  $("bm-sign").addEventListener("click", async () => {
    const h = $("bm-handle").value.trim();
    if (!h) { msg("Type your X name first."); return; }
    $("bm-sign").disabled = true;
    try {
      const j = await getJSON("/api/book/sign", { vid: vid(), handle: h });
      if (!j.ok) msg(j.why === "limit" ? "Too many tries. Please wait a little and try again."
        : j.why === "blocked" ? "This name cannot sign the book. Message Jon on X if you think that is a mistake."
        : "That does not look like an X name. Use letters, numbers or _ only.");
      else { me = j; showMe(); msg(""); }
    } catch (e) { msg("Could not reach the book right now. Please try again."); }
    $("bm-sign").disabled = false;
  });
  $("bm-handle").addEventListener("keydown", (e) => { if (e.key === "Enter") $("bm-sign").click(); });
  $("bm-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(me.text); msg("Copied. Paste it into a new post on X.", true); } catch (e) { msg("Long press the words to copy them."); }
  });
  $("bm-restart").addEventListener("click", () => { me = { status: "none" }; showMe(); msg(""); $("bm-handle").focus(); });
  const WHY = {
    link: "That does not look like a link to a post on X.",
    nocode: "The code is not in that post. Copy the words exactly and try again.",
    old: "That post is older than your code. Post the words again now, then paste the new link.",
    gone: "We could not find that post. Make sure it is public.",
    busy: "X did not answer just now. Please try again in a minute.",
    nosign: "Sign with your X name first.",
    limit: "Too many tries. Please wait a little and try again.",
  };
  $("bm-check").addEventListener("click", async () => {
    const link = $("bm-link").value.trim();
    if (!link) { msg("Paste the link to your post first."); return; }
    $("bm-check").disabled = true; msg("Checking your post...", true);
    try {
      const j = await getJSON("/api/book/check", { vid: vid(), link });
      if (j.ok) { msg(`Welcome to the book, @${j.handle}.`, true); await loadMe(); loadBook(); }
      else if (j.why === "other") msg(j.found ? `That post is by @${j.found}. Post from the X name you signed with.` : "That post is from a different X name.");
      else msg(WHY[j.why] || "Something went wrong. Please try again.");
    } catch (e) { msg("Could not reach the book right now. Please try again."); }
    $("bm-check").disabled = false;
  });

  addEventListener("pd:bookchange", () => { me = null; loadMe(); });

  // ---------- tier cards: a share card in the same family as the dragon and relic cards ----------
  const RANK = { "": 0, bronze: 1, silver: 2, gold: 3 };
  const TITLE = { gold: "Gold Friend", silver: "Silver Friend", bronze: "Bronze Friend" };
  const BG = { bronze: ["#3a1d08", "#9a5a24", "#e8a86a"], silver: ["#1c2232", "#5d6781", "#d3dae9"], gold: ["#3a2400", "#a8740f", "#ffd66b"] };
  const GLOW = { bronze: "240, 170, 110", silver: "225, 232, 248", gold: "255, 214, 107" };
  let cardFor = "", cardBlob = null;
  const img = (src) => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = no; i.src = src; });
  async function drawTier(tier, handle, week) {
    const K = window.pdCard; if (!K) return null;
    await K.fonts();
    const { c, x } = K.canvas(2), P = K.P;
    const g = x.createLinearGradient(0, 0, K.W, K.H); BG[tier].forEach((col, i) => g.addColorStop(i / 2, col));
    x.fillStyle = g; x.fillRect(0, 0, K.W, K.H);
    for (let i = 0; i < 9; i++) {           // soft rays behind Blinky
      x.save(); x.translate(360, 330); x.rotate((i / 9) * Math.PI * 2); x.fillStyle = "rgba(255, 255, 255, .05)";
      x.beginPath(); x.moveTo(0, 0); x.lineTo(900, -70); x.lineTo(900, 70); x.closePath(); x.fill(); x.restore();
    }
    const base = (window.RADAR_SCENE && window.RADAR_SCENE.base) || "";
    const art = base ? await img(`${base}/image/upload/e_background_removal/c_scale,w_900/f_png/dragon-radar/blinky/trophy`).catch(() => null) : null;
    K.hero(x, art, { cx: 360, cy: 330, maxW: 540, maxH: 540, glow: GLOW[tier] });
    K.vignette(x, .32); K.panel(x);
    let y = P.y + 44;
    K.pill(x, "BOOK OF FRIENDS", P.x + 40, y, { bg: "rgba(255, 255, 255, .2)" }); y += 108;
    x.fillStyle = K.INK; x.textAlign = "left"; x.textBaseline = "alphabetic";
    K.fit(x, TITLE[tier], P.x + 40, y, P.w - 80, 60, 34); y += 44;
    x.fillStyle = K.SOFT; x.font = '800 22px "Nunito", sans-serif'; x.fillText(`@${handle}`, P.x + 40, y); y += 40;
    K.divider(x, y); y += 52;
    K.label(x, "KEEPERS SUPPORTED THIS WEEK", P.x + 40, y); y += 70;
    x.fillStyle = K.INK; x.font = '700 76px "Fredoka", sans-serif'; x.fillText(String(week), P.x + 40, y); y += 50;
    K.label(x, tier === "gold" ? "THREE WEEKS AT THE TOP" : "STEADY SUPPORT FOR THE MEADOW", P.x + 40, y);
    K.footer(x);
    if (tier === "gold") K.foil(x);
    K.grain(x, .05);
    return c;
  }
  async function tierCardFor(m) {
    const box = $("bm-card");
    if (!m || !m.tier) { box.hidden = true; return; }
    const seen = store.get("pd:tierSeen") || "";
    $("bm-up").textContent = RANK[m.tier] > RANK[seen] ? `\u{1F389} You reached ${TIER[m.tier]}!` : `Your ${TIER[m.tier]} card`;
    box.hidden = false;
    const key = `${m.tier}:${m.handle}:${m.week}`;
    if (key !== cardFor) {
      cardFor = key; cardBlob = null;
      const c = await drawTier(m.tier, m.handle, m.week);
      if (!c || cardFor !== key) return;
      cardBlob = await new Promise((r) => { try { c.toBlob(r, "image/png"); } catch (e) { r(null); } });
      if (cardBlob) $("bm-card-img").src = URL.createObjectURL(cardBlob);
      const file = cardBlob && new File([cardBlob], `pdtools-${m.tier}-friend.png`, { type: "image/png" });
      $("bm-card-share").hidden = !(file && navigator.canShare && navigator.canShare({ files: [file] }));
      $("bm-card-share").onclick = async () => { try { await navigator.share({ files: [file], text: postLine(m) }); track("share", "tier"); } catch (e) { /* cancelled */ } };
    }
    $("bm-card-post").href = `https://x.com/intent/post?text=${encodeURIComponent(postLine(m))}`;
    if (RANK[m.tier] > RANK[seen]) store.set("pd:tierSeen", m.tier);
  }
  const postLine = (m) => `I reached ${TIER[m.tier]} in Blinky's Book of Friends \u{1F409} I supported ${m.week} Keepers this week. Come support the community at pdtools.xyz/friends`;
  const track = (kind, ref) => { try { window.pdTrack && window.pdTrack(kind, ref); } catch (e) { /* ignore */ } };
  $("bm-card-post").addEventListener("click", () => track("share", "tier"));
  $("bm-card-save").addEventListener("click", () => {
    if (!cardBlob) { msg("Long press the card to save it."); return; }
    track("save", "tier");
    const a = document.createElement("a"); a.href = URL.createObjectURL(cardBlob); a.download = "pdtools-friend-card.png";
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    msg("Saved. Attach it to your post on X.", true);
  });

  // a gentle ask after the first post opened, never a wall: once, then again after 3 days
  const ask = $("book-ask");
  let asking = false;
  addEventListener("pd:opened", async () => {
    if (asking || !ask.hidden) return;
    const last = Number(store.get("pd:bookAsk") || 0);
    if (Date.now() - last < 3 * 864e5) return;
    asking = true;
    const m = me || await loadMe();
    asking = false;
    if (!m || m.status !== "none") return;
    store.set("pd:bookAsk", String(Date.now()));
    setTimeout(() => {
      const nudge = document.getElementById("install-nudge");
      if (nudge && !nudge.hidden) return;              // one invite at a time
      ask.hidden = false; requestAnimationFrame(() => ask.classList.add("show"));
    }, 1500);
  });
  const hideAsk = () => { ask.classList.remove("show"); setTimeout(() => { ask.hidden = true; }, 300); };
  $("book-ask-x").addEventListener("click", hideAsk);
  $("book-ask-go").addEventListener("click", () => { hideAsk(); open(); setTimeout(() => $("bm-handle").focus(), 350); });
})();
