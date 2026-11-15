/* Blinky's Book of Friends: the signing book. Everyone who signs sees a real 3D leather book (book3d.js, built
   in three.js) open on a desk, with their own X name writing itself onto the page in gold ink. They can tilt it,
   save it as an image and post it on X. Everything is drawn here in the browser; nothing is sent anywhere. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const box = $("sc"), stage = $("sc-stage");
  if (!box || !stage) return;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const msg = (text) => { $("sc-msg").textContent = text; };
  const track = (kind) => { try { window.pdTrack && window.pdTrack(kind, "signcard"); } catch (e) { /* ignore */ } };
  // The words that go with the book on X. Each signer gets one of five at random (kept on their device, so
  // pressing Post again shows the same words), so the timeline sees fresh words instead of one copied line.
  const POSTS = [
    "Just signed Blinky's Book of Friends \u{1F409}\u{1F4D6} My name is in, and now the job is simple: carry Blinky and @Pocket_Dragons_ into every corner of CT. Come sign yours and let's do it together \u{1F447} pdtools.xyz/friends",
    "My name is officially in Blinky's Book of Friends \u{1F409}\u2728 This little yellow dragon deserves to be seen on every timeline in CT, and that starts with us showing up for each other. Your page is waiting \u{1F447} pdtools.xyz/friends @Pocket_Dragons_",
    "Signed, sealed and stamped with a paw \u{1F43E} I'm in Blinky's Book of Friends. Next stop, every corner of CT. Keepers, come sign with me \u{1F409} pdtools.xyz/friends @Pocket_Dragons_",
    "Blinky keeps a book of every Keeper who has his back, and today I signed it \u{1F409}\u{1F4D6} We're taking @Pocket_Dragons_ to every corner of CT, one friend at a time. Add your name \u{1F447} pdtools.xyz/friends",
    "New quest unlocked: put Blinky in front of every corner of CT \u{1F409}\u{1F30D} First step done, I signed Blinky's Book of Friends. Grab your quill and join me, Keeper \u{1F447} pdtools.xyz/friends @Pocket_Dragons_",
  ];
  let postPick = Number(store.get("pd:signPost"));
  if (!(postPick >= 0 && postPick < POSTS.length)) { postPick = Math.floor(Math.random() * POSTS.length); store.set("pd:signPost", String(postPick)); }
  const postText = () => POSTS[postPick];

  // ---------- the 3D book: three.js and the book load only once someone has signed ----------
  const add = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s); });
  let me = null, book = null, loading = null;
  function webgl() { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } }
  function load() {
    if (loading) return loading;
    loading = (window.THREE ? Promise.resolve() : add(stage.dataset.three)).then(() => (window.PDBook3D ? null : add(stage.dataset.book)));
    return loading;
  }
  async function build() {
    if (!webgl()) { stage.classList.add("sc-flat"); msg("This browser cannot show the 3D book. Your name is signed all the same."); return; }
    try {
      await load();
      if (book) { book.setHandle(me.handle); book.replay(); return; }
      book = window.PDBook3D.mount(stage, { handle: me.handle });
      stage.classList.add("sc-on");
      // play the reveal when the book comes into view, not while it is still below the fold
      if ("IntersectionObserver" in window) {
        let seen = false;
        const io = new IntersectionObserver((es) => { if (!seen && es.some((e) => e.isIntersecting)) { seen = true; book.ready.then(() => book.replay()); io.disconnect(); } }, { threshold: 0.4 });
        io.observe(stage);
      }
    } catch (e) { msg("The book did not load. Check your connection and try again."); }
  }
  $("sc-replay").addEventListener("click", () => { if (book) book.replay(); });

  // ---------- saving and sharing ----------
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  const fileName = () => `blinky-book-of-friends-${(me && me.handle) || "keeper"}.png`;
  async function stillBlob() { if (!book) return null; await book.ready; return book.blob(1600, 900); }
  $("sc-image").addEventListener("click", async () => {
    const b = await stillBlob();
    if (!b) { msg("The book is still loading. Try again in a moment."); return; }
    download(b, fileName()); track("save");
    msg("Saved. Attach it to your post on X.");
  });
  $("sc-post").addEventListener("click", () => track("share"));
  let busy = false;
  $("sc-share").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    try {
      const b = await stillBlob(), file = b && new File([b], fileName(), { type: "image/png" });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: postText() }); track("share"); }
      else if (b) { download(b, fileName()); msg("Saved. Attach it to your post on X."); }
    } catch (e) { /* cancelled */ }
    busy = false;
  });

  // ---------- show it once someone has signed ----------
  function show(m) {
    me = m;
    const ok = !!(m && m.status === "confirmed" && m.handle);
    box.hidden = !ok;
    if (!ok) return;
    $("sc-post").href = `https://x.com/intent/post?text=${encodeURIComponent(postText())}`;
    try { $("sc-share").hidden = !(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.png", { type: "image/png" })] })); } catch (e) { $("sc-share").hidden = true; }
    build();
  }
  addEventListener("pd:bookme", (e) => show(e.detail));
  if (window.pdBookMe) show(window.pdBookMe);
})();
