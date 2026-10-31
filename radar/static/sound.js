/* Sound: a nature bed on every page, plus Blinky's song on Blinky's Friends.
   Browsers only allow sound after the visitor touches the page, so it starts on the first
   tap, click or key press (or right away when the browser allows it). The pill in the
   header turns it on and off, and the choice is remembered on this device.
   Nature plays clearly first; once the page settles the community songs start and nature sinks under them.
   The songs play one after another, mixed into each other, so the music never stops between songs.
   Going to another page carries on from the same spot, and the music keeps playing while people visit X. */
(() => {
  "use strict";
  const cfg = window.PD_SOUND;
  const btn = document.getElementById("sound-btn");
  if (!cfg || !cfg.ambience) return;

  const store = {
    get() { try { return localStorage.getItem("pd:sound"); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem("pd:sound", v); } catch (e) { /* private mode */ } },
  };
  // Never louder than half of the visitor's own volume, so it stays gentle even at full volume
  const MASTER = 0.5;
  const NATURE_FULL = MASTER * 0.9;    // what you hear first
  const NATURE_UNDER = MASTER * 0.3;   // under the song
  const SONG = MASTER;

  let ctx = null, started = false, on = store.get() !== "off";
  const tracks = {};
  let duckK = 1;                       // turned down for big moments (relic film)

  // ---------- the playlist: community songs one after another, mixed like a DJ ----------
  // Two decks take turns. When a song reaches its mix point (where its ending begins, worked out once by
  // audio_prep.py) the next song starts on the other deck and the two cross over with an equal power curve,
  // so there is never a silent gap and never a jump in loudness (every song is evened out to the same level).
  const SONGS = (cfg.songs || (cfg.song ? [{ src: cfg.song, title: "Blinky's song", by: "" }] : [])).filter((x) => x && x.src);
  const XF_MIN = 4, XF_MAX = 12;
  let cur = null;                       // { t: deck, i: song index }
  let mixing = false;
  // A Keeper can pick a song, or play only one maker's songs. After a song ends the next one in that list plays.
  let only = null;                      // the X handle of the maker whose songs are playing, or null for everyone
  let pickNext = null;                  // a song picked before the sound engine was allowed to start
  let repeat = (() => { try { return localStorage.getItem("pd:repeat") === "1"; } catch (e) { return false; } })();   // replay one song
  const inList = (i) => !only || (SONGS[i] && (SONGS[i].x || "").toLowerCase() === only);
  function nextIdx(from) {
    for (let k = 1; k <= SONGS.length; k++) { const j = wrap(from + k); if (inList(j)) return j; }
    return wrap(from + 1);
  }

  // Moving between pages reloads the page, so we remember where the music was and carry on from there
  const POS_KEY = "pd:soundPos";
  const saved = (() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(POS_KEY) || "null");
      return v && Date.now() - v.at < 30 * 60 * 1000 ? v : null;
    } catch (e) { return null; }
  })();
  if (saved && typeof saved.only === "string") only = saved.only || null;
  // Where the playlist is, kept even while no song plays (the home page, or sound turned off), so coming back to
  // the feed carries on with the same song instead of starting the playlist over.
  let lastIdx = saved ? saved.idx | 0 : 0, lastPos = saved ? +saved.song || 0 : 0;
  function savePos() {
    if (!started) return;
    const n = tracks.nature;
    if (cur) { lastIdx = cur.i; lastPos = cur.t.a.currentTime || 0; }
    try {
      sessionStorage.setItem(POS_KEY, JSON.stringify({ at: Date.now(), nature: n ? n.a.currentTime : 0,
        idx: lastIdx, song: lastPos, songOn: !!(cur && !cur.t.a.paused), only: only || "" }));
    } catch (e) { /* private mode */ }
  }

  function track(name, url, loop = true) {
    const a = new Audio();
    if (url) a.src = url;
    a.loop = loop; a.preload = url ? "auto" : "none"; a.crossOrigin = "anonymous";
    const t = { a, gain: null, level: 0, live: false, name, src: url || "" };
    tracks[name] = t;
    return t;
  }

  function wire(t) {
    // Web Audio gain so fades also work on iPhones, where element volume is fixed
    if (ctx && !t.gain) {
      try {
        const src = ctx.createMediaElementSource(t.a);
        t.gain = ctx.createGain(); t.gain.gain.value = t.level * duckK;
        src.connect(t.gain).connect(ctx.destination);
      } catch (e) { t.gain = null; }
    }
    if (!t.gain) t.a.volume = Math.min(1, t.level * duckK);
  }

  // a timer, not animation frames: animation frames stop in a background tab, timers keep going
  function stepVolume(t, curve, secs) {
    clearInterval(t.timer);
    const t0 = performance.now();
    t.timer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (secs * 1000));
      t.a.volume = Math.max(0, Math.min(1, curve(k)));
      if (k >= 1) clearInterval(t.timer);
    }, 50);
  }

  function fade(t, to, secs) {
    t.level = to;
    const target = to * duckK;
    if (t.gain && ctx) {
      const g = t.gain.gain, now = ctx.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(target, now + secs);
    } else {
      const from = t.a.volume;
      stepVolume(t, (k) => from + (target - from) * k, secs);
    }
  }

  // equal power curves: the two songs together stay at the same loudness through the whole mix
  function curveTo(t, to, secs, rising) {
    t.level = to;
    const target = to * duckK;
    const shape = (k) => (rising ? Math.sin(k * Math.PI / 2) : Math.cos(k * Math.PI / 2));
    if (t.gain && ctx) {
      const g = t.gain.gain, now = ctx.currentTime, from = g.value, n = 64, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const k = i / (n - 1); c[i] = rising ? target * shape(k) : from * shape(k); }
      g.cancelScheduledValues(now);
      try { g.setValueCurveAtTime(c, now, secs); } catch (e) { g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(target, now + secs); }
    } else {
      const from = t.a.volume;
      stepVolume(t, (k) => (rising ? target * shape(k) : from * shape(k)), secs);
    }
  }

  const play = (t) => { const p = t.a.play(); return p && p.catch ? p : Promise.resolve(); };
  const deck = (name) => tracks[name] || track(name, "", false);
  const other = () => (cur && cur.t.name === "deckA" ? deck("deckB") : deck("deckA"));
  const wrap = (i) => ((i % SONGS.length) + SONGS.length) % SONGS.length;
  const song = (i) => SONGS[wrap(i)];
  const mixAt = (s, a) => {
    const d = a.duration || s.dur || 0;
    const m = typeof s.mix === "number" ? s.mix : d - 8;
    return Math.max(0, Math.min(m, d - XF_MIN));
  };

  function load(t, i) {
    const s = song(i);
    if (t.src !== s.src) { t.src = s.src; t.a.src = s.src; t.a.preload = "auto"; try { t.a.load(); } catch (e) { /* fine */ } }
  }

  // start song i on the free deck, from `at` seconds, rising over `secs`
  function startSong(i, at, secs, curved) {
    const t = cur ? other() : deck("deckA");
    load(t, i);
    t.level = 0; wire(t);
    if (t.gain && ctx) { t.gain.gain.cancelScheduledValues(ctx.currentTime); t.gain.gain.value = 0; } else { clearInterval(t.timer); t.a.volume = 0; }
    if (at) seek(t, at); else { try { t.a.currentTime = 0; } catch (e) { /* not ready */ } }
    t.live = true;
    if (cur) cur.t.a.loop = false;
    t.a.loop = repeat;
    cur = { t, i: wrap(i) };
    media();
    return play(t).then(() => { if (curved) curveTo(t, SONG, secs, true); else fade(t, SONG, secs); });
  }
  // The next song is fetched only when its turn is near (see tick), never as soon as a song starts, so a page
  // view does not pull a whole second song over a phone connection that may never play it.
  // `to` is a song the Keeper picked: it comes in with a short, quick mix instead of waiting for the ending
  function mixNext(secs, to) {
    if (!cur || mixing || !SONGS.length) return;
    mixing = true;
    const out = cur.t;
    const left = Math.max(0, (out.a.duration || 0) - out.a.currentTime);
    const xf = to != null ? secs : Math.max(XF_MIN, Math.min(XF_MAX, secs || left || XF_MIN));
    const was = cur;
    startSong(to != null ? to : nextIdx(cur.i), 0, xf, true).then(() => {
      curveTo(out, 0, xf, false);
      setTimeout(() => { if (cur.t !== out) { out.a.pause(); out.live = false; } mixing = false; }, xf * 1000 + 300);
    }).catch(() => {
      // the next song would not start: keep the current one as the playing song so the DJ tries again
      const failed = cur.t;
      if (failed !== out) { failed.a.pause(); failed.live = false; }
      cur = was; mixing = false; media();
      if (out.a.ended || out.a.paused) setTimeout(() => mixNext(XF_MIN), 1500);
    });
  }

  // the DJ: watches the playing song and brings in the next one at its mix point
  function tick() {
    if (!cur || !on || !started || mixing || repeat) return;
    const a = cur.t.a, s = song(cur.i);
    if (!a.duration || a.paused) return;
    const m = mixAt(s, a);
    if (a.currentTime >= m - 90) load(other(), nextIdx(cur.i));   // get the next song ready 90 seconds ahead, enough for a slow phone
    if (a.currentTime >= m) mixNext(a.duration - m);
  }
  setInterval(tick, 250);
  ["deckA", "deckB"].forEach((n) => {
    const t = deck(n);
    t.a.addEventListener("timeupdate", tick);
    // safety net: if a song ever ends before the mix began (a frozen background tab), go straight on
    t.a.addEventListener("ended", () => { if (cur && cur.t === t && !mixing) mixNext(XF_MIN); });
  });

  function settled() {
    // Blinky's Friends: after the opening scene, and never sooner than 6 seconds of nature
    return new Promise((res) => {
      const t0 = performance.now();
      const check = () => {
        const ready = !cfg.waitReady || document.body.classList.contains("ready");
        if (ready && performance.now() - t0 > 6000) res(); else setTimeout(check, 400);
      };
      check();
    });
  }

  let starting = false;   // one tap fires pointerup, touchend and click: only the first one may start the music
  function start(fromGesture) {
    if (!on) return;
    if (started) { resume(); return; }
    if (fromGesture && !ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { ctx = new AC(); } catch (e) { ctx = null; } }
    }
    if (ctx && ctx.state !== "running") { try { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* next tap */ } }
    if (starting) return;
    starting = true;
    setTimeout(() => { starting = false; }, 8000);   // a stalled download never blocks the next tap for good
    const nature = tracks.nature || track("nature", cfg.ambience);
    nature.live = true;
    const carry = saved && !started;          // coming from another page: no intro, pick up where we left off
    if (carry && saved.nature) seek(nature, saved.nature);
    wire(nature);
    // coming from another page with a song playing: start the song together with nature, not after it,
    // so the gap between pages is as short as the browser allows
    // (if the phone blocked sound until a tap, the song already set up on the first try simply plays on the tap)
    const carrySong = carry && saved.songOn && SONGS.length && !cur;
    const chosen = pickNext != null && !cur;
    const songP = chosen ? startSong(pickNext, 0, 1, false).finally(() => { pickNext = null; })
      : carrySong ? startSong(saved.idx | 0, saved.song || 0, 0.8, false)
      : (cur && cur.t.a.paused ? play(cur.t).then(() => fade(cur.t, SONG, 0.8)) : null);
    if (songP) songP.catch(() => {});
    play(nature).then(() => {
      started = true; starting = false;
      // iPhones can leave the sound engine asleep even after play(): keep listening for a tap until it runs
      if (!ctx || ctx.state === "running") unarm(); else setTimeout(() => { if (ctx.state === "running") { unarm(); ui(); } }, 600);
      ui(); media();
      if (songP) {
        songP.then(() => fade(nature, NATURE_UNDER, 0.8)).catch(() => fade(nature, NATURE_FULL, 1.2));
        return;
      }
      if (pickNext != null && !cur) {          // a song was picked while the sound was still waking up
        const k = pickNext; pickNext = null;
        startSong(k, 0, 1, false).then(() => fade(nature, NATURE_UNDER, 1.2)).catch(() => fade(nature, NATURE_FULL, 1.2));
        return;
      }
      fade(nature, NATURE_FULL, carry ? 1.2 : 2.5);
      if (SONGS.length && !cfg.carryOnly) settled().then(ensureSong);
    }).catch(() => { starting = false; arm(); ui(); });   // not allowed yet: the next tap starts it
  }
  // The playlist must never be skipped for good: whenever sound is on and no song is playing (sound was turned
  // off before the first song, or the page settled while it was off), the next song starts where the playlist was.
  // The home page only carries a song that was already playing; it never starts one by itself.
  function ensureSong() {
    if (!on || !started || cur || !SONGS.length || cfg.carryOnly) return;
    const nature = tracks.nature;
    startSong(lastIdx, lastPos, 4, false).then(() => nature && fade(nature, NATURE_UNDER, 4)).catch(() => {});
  }
  function seek(t, secs) {
    const go = () => {
      try {
        const d = t.a.duration;
        if (d) t.a.currentTime = t.a.loop ? secs % d : Math.min(secs, Math.max(0, d - 1)); else t.a.currentTime = secs;
      } catch (e) { /* not ready */ }
    };
    if (t.a.readyState >= 1) go(); else t.a.addEventListener("loadedmetadata", go, { once: true });
  }

  function resume() {
    if (ctx && ctx.state !== "running") { try { const r = ctx.resume(); if (r && r.catch) r.catch(() => arm()); } catch (e) { arm(); } }
    Object.values(tracks).filter((t) => t.live).forEach((t) => play(t).then(() => { unarm(); ui(); }).catch(() => { arm(); ui(); }));
    if (SONGS.length && !cur && !cfg.carryOnly) setTimeout(ensureSong, 1500);   // nature first, then the song comes back
    // iPhones can report "playing" while the sound engine is still asleep: if so, wait for the next tap
    setTimeout(() => { if (ctx && ctx.state !== "running" && on) { arm(); ui(); } }, 700);
  }
  function pauseAll() { Object.values(tracks).forEach((t) => t.a.pause()); }

  function ui() {
    if (!btn) return;
    const live = on && started && !armed;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", live);
    btn.classList.toggle("wait", on && !live);   // sound is on but the browser wants a tap first
    const label = btn.querySelector(".snd-label");
    if (label) label.textContent = live ? "Sound on" : on ? "Tap for sound" : "Sound off";
  }

  if (btn) {
    btn.hidden = false;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (on && !started) { start(true); ui(); return; }   // first press just starts it
      on = !on;
      store.set(on ? "on" : "off");
      if (on) start(true); else { pauseAll(); savePos(); }
      ui();
    });
  }

  // The first tap anywhere starts it (unless the visitor turned it off before).
  // Phones only count a finished tap (touchend, pointerup, click) as permission for sound, not the start of a touch,
  // so we listen to those, and keep listening until the sound is really playing.
  let armed = false;
  const GESTURES = ["touchend", "pointerup", "click", "keydown"];
  // taps on the sound pill and the music picker start the sound their own way (a picked song first)
  const gesture = (e) => { if (on && !(btn && btn.contains(e.target)) && !(e.target.closest && e.target.closest("[data-music],[data-song],.mp-wrap"))) start(true); };
  function arm() { if (armed) return; armed = true; GESTURES.forEach((ev) => addEventListener(ev, gesture, { passive: true, capture: true })); }
  function unarm() { if (!armed) return; armed = false; GESTURES.forEach((ev) => removeEventListener(ev, gesture, { capture: true })); }
  arm();
  // some browsers allow sound straight away for returning visitors
  if (on) start(false);
  ui();

  // Music keeps going while people pop over to X and back. If the phone paused it, it picks up again on return,
  // or on the next tap when the phone asks for one.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { savePos(); return; }
    if (started && on) resume();
  });
  addEventListener("pagehide", savePos);
  addEventListener("pageshow", (e) => { if (e.persisted && started && on) resume(); });   // back button from cache
  setInterval(savePos, 3000);

  // Big moments (a relic film) turn the background music down, then bring it back where it was
  function reapply(secs) {
    Object.values(tracks).filter((t) => t.live).forEach((t) => {
      const target = t.level * duckK;
      if (t.gain && ctx) { const g = t.gain.gain, now = ctx.currentTime; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(target, now + secs); }
      else { const from = t.a.volume; stepVolume(t, (k) => from + (target - from) * k, secs); }
    });
  }
  window.pdSound = {
    isOn: () => on,
    duck(secs = 0.6) { if (duckK !== 1) return; duckK = 0.08; reapply(secs); },
    unduck(secs = 1.6) { if (duckK === 1) return; duckK = 1; reapply(secs); },
    now: () => (cur ? { ...song(cur.i), at: cur.t.a.currentTime } : null),
    next: () => mixNext(3),
    pick: (i, by) => pick(i, by),
    open: (by) => openPanel(by),
    only: () => only,
    songs: () => SONGS,
    playing: () => (cur && !cur.t.a.paused ? cur.i : -1),
    after: (i) => nextIdx(i),
    last: () => lastIdx,
    seekNow: (secs) => { if (cur) seek(cur.t, secs); },
    repeat: () => repeat,
    setRepeat(v) { repeat = !!v; try { localStorage.setItem("pd:repeat", repeat ? "1" : "0"); } catch (e) { /* private */ } if (cur) cur.t.a.loop = repeat; media(); },
    skip: () => { if (cur && !cur.t.a.paused) mixNext(2.5, nextIdx(cur.i)); else pick(nextIdx(lastIdx)); },
    state: () => ["deckA", "deckB"].map((n) => tracks[n]).filter(Boolean).map((t) => ({ deck: t.name, src: t.src, at: t.a.currentTime,
      playing: !t.a.paused, level: t.gain ? t.gain.gain.value : t.a.volume })),
  };

  // ---------- the music picker: pick any song, or play one maker's songs ----------
  // Any button with data-music opens it (data-music-by="handle" opens that maker's songs),
  // and any button with data-song="Title" plays that song straight away.
  function pick(i, by) {
    if (!SONGS[i]) return;
    if (by !== undefined) only = by ? String(by).toLowerCase() : null;
    if (!inList(i)) only = null;
    if (!on) { on = true; store.set("on"); }
    lastIdx = i; lastPos = 0;
    if (!started) { pickNext = i; start(true); ui(); return; }
    if (ctx && ctx.state !== "running") { try { ctx.resume(); } catch (e) { /* next tap */ } }
    const nature = tracks.nature;
    if (nature && nature.a.paused) play(nature).then(() => fade(nature, NATURE_UNDER, 1.2)).catch(() => {});
    if (cur && cur.i === i && !cur.t.a.paused) return;   // already playing it
    const go = (tries) => {
      if (mixing) { if (tries < 20) setTimeout(() => go(tries + 1), 300); return; }
      if (cur && !cur.t.a.paused) { mixNext(2.5, i); return; }
      if (cur) { cur.t.a.pause(); cur.t.live = false; cur = null; }
      startSong(i, 0, 1.2, false).then(() => nature && fade(nature, NATURE_UNDER, 1.5)).catch(() => {});
    };
    go(0);
    ui(); savePos();
  }
  // The picker's look and list live in music.js, loaded only the first time someone opens it,
  // so the feed stays light for everyone who never does.
  let pickerP = null;
  function openPanel(by) {
    if (!SONGS.length) return;
    if (!pickerP) {
      pickerP = new Promise((res, rej) => {
        const js = document.createElement("script"); js.src = cfg.picker || "/static/music.js"; js.async = true;
        js.onload = () => res(window.pdMusicPicker); js.onerror = () => { pickerP = null; rej(); };
        document.head.append(js);
      });
    }
    pickerP.then((m) => m && m.open(by)).catch(() => {});
  }
  const pillCss = () => {
    if (document.getElementById("sp-css")) return;
    const st = document.createElement("style"); st.id = "sp-css";
    st.textContent = `.song-pill{border:0;cursor:pointer;display:inline-flex;align-items:center;gap:7px;padding:7px 13px 7px 11px;border-radius:999px;font-family:inherit;font-weight:800;font-size:13px;line-height:1;color:#1d2433;background:rgba(255,255,255,.72);box-shadow:inset 0 0 0 1px rgba(29,36,51,.1);transition:transform .2s}
.song-pill:hover{transform:translateY(-1px)}.song-pill .sp-note{font-size:15px;line-height:1}
html.theme-dark .song-pill,body.dark-sky .song-pill{background:rgba(20,26,69,.72);color:#f2f4ff}
@media (max-width:560px){.song-pill .sp-label{display:none}.song-pill{padding:8px 10px}}`;
    document.head.append(st);
  };

  // buttons anywhere on the page: the header pill, the credits and the music makers
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("[data-music],[data-song]");
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    if (el.hasAttribute("data-song")) {
      const i = SONGS.findIndex((x) => x.title === el.getAttribute("data-song"));
      if (i >= 0) { pick(i, null); openPanel(null); }
      return;
    }
    openPanel(el.getAttribute("data-music-by") || null);
  }, true);
  if (SONGS.length) { pillCss(); document.querySelectorAll("[data-music-pill]").forEach((b) => { b.hidden = false; }); }

  // lock screen and notification controls on phones, showing the song and its maker
  function media() {
    dispatchEvent(new CustomEvent("pd:song", { detail: cur ? song(cur.i) : null }));
    if (!("mediaSession" in navigator)) return;
    try {
      const s = cur ? song(cur.i) : null;
      navigator.mediaSession.metadata = new MediaMetadata({ title: s ? s.title : "Meadow sounds", artist: s && s.by ? s.by : "pdtools" });
      navigator.mediaSession.setActionHandler("play", () => { on = true; store.set("on"); resume(); ui(); });
      navigator.mediaSession.setActionHandler("pause", () => { on = false; store.set("off"); pauseAll(); ui(); });
      if (SONGS.length > 1) navigator.mediaSession.setActionHandler("nexttrack", () => mixNext(3));
    } catch (e) { /* older phones */ }
  }
})();
