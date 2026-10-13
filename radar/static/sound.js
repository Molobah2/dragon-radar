/* Sound: a nature bed on every page, plus Blinky's song on Blinky's Friends.
   Browsers only allow sound after the visitor touches the page, so it starts on the first
   tap, click or key press (or right away when the browser allows it). The pill in the
   header turns it on and off, and the choice is remembered on this device.
   Nature plays clearly first; once the page settles the song fades in and nature sinks under it.
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

  // Moving between pages reloads the page, so we remember where the music was and carry on from there
  const POS_KEY = "pd:soundPos";
  const saved = (() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(POS_KEY) || "null");
      return v && Date.now() - v.at < 30 * 60 * 1000 ? v : null;
    } catch (e) { return null; }
  })();
  function savePos() {
    if (!started) return;
    const n = tracks.nature, g = tracks.song;
    try {
      sessionStorage.setItem(POS_KEY, JSON.stringify({ at: Date.now(), nature: n ? n.a.currentTime : 0,
        song: g ? g.a.currentTime : 0, songOn: !!(g && !g.a.paused) }));
    } catch (e) { /* private mode */ }
  }

  function track(name, url) {
    const a = new Audio();
    a.src = url; a.loop = true; a.preload = "auto"; a.crossOrigin = "anonymous";
    const t = { a, gain: null, level: 0 };
    tracks[name] = t;
    return t;
  }

  function wire(t) {
    // Web Audio gain so fades also work on iPhones, where element volume is fixed
    if (ctx && !t.gain) {
      try {
        const src = ctx.createMediaElementSource(t.a);
        t.gain = ctx.createGain(); t.gain.gain.value = t.level;
        src.connect(t.gain).connect(ctx.destination);
      } catch (e) { t.gain = null; }
    }
    if (!t.gain) t.a.volume = t.level;
  }

  function fade(t, to, secs) {
    t.level = to;
    if (t.gain && ctx) {
      const g = t.gain.gain, now = ctx.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(to, now + secs);
    } else {
      const from = t.a.volume, t0 = performance.now();
      const step = (n) => { const k = Math.min(1, (n - t0) / (secs * 1000)); t.a.volume = from + (to - from) * k; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  }

  const play = (t) => { const p = t.a.play(); return p && p.catch ? p : Promise.resolve(); };

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

  function start(fromGesture) {
    if (!on) return;
    if (started) { resume(); return; }
    if (fromGesture && !ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { ctx = new AC(); } catch (e) { ctx = null; } }
    }
    const nature = tracks.nature || track("nature", cfg.ambience);
    const carry = saved && !started;          // coming from another page: no intro, pick up where we left off
    if (carry && saved.nature) seek(nature, saved.nature);
    wire(nature);
    play(nature).then(() => {
      started = true;
      unarm(); ui(); media();
      if (carry && saved.songOn && cfg.song) {
        const song = tracks.song || track("song", cfg.song);
        seek(song, saved.song); wire(song);
        play(song).then(() => { fade(nature, NATURE_UNDER, 1.2); fade(song, SONG, 1.2); }).catch(() => fade(nature, NATURE_FULL, 1.2));
        return;
      }
      fade(nature, NATURE_FULL, carry ? 1.2 : 2.5);
      if (cfg.song) {
        settled().then(() => {
          if (!on) return;
          const song = tracks.song || track("song", cfg.song);
          wire(song);
          play(song).then(() => { fade(nature, NATURE_UNDER, 4); fade(song, SONG, 4); }).catch(() => {});
        });
      }
    }).catch(() => { arm(); ui(); });   // not allowed yet: the next tap starts it
  }
  function seek(t, secs) {
    const go = () => { try { if (t.a.duration) t.a.currentTime = secs % t.a.duration; else t.a.currentTime = secs; } catch (e) { /* not ready */ } };
    if (t.a.readyState >= 1) go(); else t.a.addEventListener("loadedmetadata", go, { once: true });
  }

  function resume() {
    if (ctx && ctx.state !== "running") { try { const r = ctx.resume(); if (r && r.catch) r.catch(() => arm()); } catch (e) { arm(); } }
    Object.values(tracks).forEach((t) => play(t).then(() => { unarm(); ui(); }).catch(() => { arm(); ui(); }));
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
  const gesture = (e) => { if (on && !(btn && btn.contains(e.target))) start(true); };
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
  const ducked = new Map();
  window.pdSound = {
    isOn: () => on,
    duck(secs = 0.6) {
      Object.values(tracks).forEach((t) => { if (!ducked.has(t)) { ducked.set(t, t.level); fade(t, t.level * 0.08, secs); } });
    },
    unduck(secs = 1.6) {
      ducked.forEach((level, t) => fade(t, level, secs)); ducked.clear();
    },
  };

  // lock screen and notification controls on phones
  function media() {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: cfg.song ? "Blinky's song" : "Meadow sounds", artist: "pdtools" });
      navigator.mediaSession.setActionHandler("play", () => { on = true; store.set("on"); resume(); ui(); });
      navigator.mediaSession.setActionHandler("pause", () => { on = false; store.set("off"); pauseAll(); ui(); });
    } catch (e) { /* older phones */ }
  }
})();
