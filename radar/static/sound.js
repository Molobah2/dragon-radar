/* Sound: a nature bed on every page, plus Blinky's song on Blinky's Friends.
   Browsers only allow sound after the visitor touches the page, so it starts on the first
   tap, click or key press (or right away when the browser allows it). The pill in the
   header turns it on and off, and the choice is remembered on this device.
   Nature plays clearly first; once the page settles the song fades in and nature sinks under it. */
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
    wire(nature);
    play(nature).then(() => {
      started = true;
      ui();
      fade(nature, NATURE_FULL, 2.5);
      if (cfg.song) {
        settled().then(() => {
          if (!on) return;
          const song = tracks.song || track("song", cfg.song);
          wire(song);
          play(song).then(() => { fade(nature, NATURE_UNDER, 4); fade(song, SONG, 4); }).catch(() => {});
        });
      }
    }).catch(() => { /* not allowed yet: wait for a gesture */ });
  }

  function resume() {
    if (ctx && ctx.state === "suspended") ctx.resume();
    Object.values(tracks).forEach((t) => play(t).catch(() => {}));
  }
  function pauseAll() { Object.values(tracks).forEach((t) => t.a.pause()); }

  function ui() {
    if (!btn) return;
    const live = on && started;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", live);
    const label = btn.querySelector(".snd-label");
    if (label) label.textContent = live ? "Sound on" : "Sound off";
  }

  if (btn) {
    btn.hidden = false;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (on && !started) { start(true); ui(); return; }   // first press just starts it
      on = !on;
      store.set(on ? "on" : "off");
      if (on) start(true); else pauseAll();
      ui();
    });
  }

  // first touch anywhere starts it (unless the visitor turned it off before)
  const gesture = (e) => { if (on && !(btn && btn.contains(e.target))) start(true); };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, gesture, { once: true, passive: true, capture: true }));
  // some browsers allow sound straight away for returning visitors
  if (on) start(false);
  ui();

  document.addEventListener("visibilitychange", () => {
    if (!started) return;
    if (document.hidden) pauseAll(); else if (on) resume();
  });
})();
