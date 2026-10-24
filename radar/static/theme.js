/* v2: the dark mode button. The choice is kept on this device; with no choice, the phone's own setting decides. */
(() => {
  "use strict";
  const root = document.documentElement, btn = document.getElementById("theme-btn");
  if (!btn) return;
  const get = () => { try { return localStorage.getItem("pd:theme"); } catch (e) { return null; } };
  const set = (v) => { try { localStorage.setItem("pd:theme", v); } catch (e) { /* private mode */ } };
  const meta = document.querySelector('meta[name="theme-color"]');
  const light = meta && meta.getAttribute("content");
  function paint() {
    const dark = root.classList.contains("theme-dark");
    btn.setAttribute("aria-pressed", String(dark));
    const label = btn.querySelector(".t-label");
    if (label) label.textContent = dark ? "Light" : "Dark";
    btn.title = dark ? "Light mode" : "Dark mode";
    if (meta) meta.setAttribute("content", dark ? "#0b0f1c" : light);
  }
  btn.addEventListener("click", () => {
    const dark = !root.classList.contains("theme-dark");
    root.classList.toggle("theme-dark", dark);
    set(dark ? "dark" : "light");
    paint();
  });
  // follow the phone when it switches by itself, unless the visitor picked a side here
  const mq = window.matchMedia && matchMedia("(prefers-color-scheme: dark)");
  if (mq && mq.addEventListener) mq.addEventListener("change", (e) => { if (!get()) { root.classList.toggle("theme-dark", e.matches); paint(); } });
  paint();
})();
