/* v1 tester rating: tap 1 to 5 stars, optionally add a note, send. Asked once per browser. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const box = $("rate");
  if (!box) return;
  let done = false;
  try { done = localStorage.getItem("pd:rated") === "1"; } catch (e) { /* private mode */ }
  if (done) { box.hidden = true; return; }
  let rating = 0;
  const stars = [...box.querySelectorAll(".star")];
  const paint = (n) => stars.forEach((s) => { const on = +s.dataset.n <= n; s.classList.toggle("on", on); s.setAttribute("aria-checked", String(+s.dataset.n === rating)); });
  stars.forEach((s) => {
    s.addEventListener("click", () => { rating = +s.dataset.n; paint(rating); $("rate-more").hidden = false; });
    s.addEventListener("mouseenter", () => paint(+s.dataset.n));
    s.addEventListener("mouseleave", () => paint(rating));
  });
  const msg = (t, ok) => { $("rate-msg").textContent = t; $("rate-msg").className = "kp-msg " + (ok ? "ok" : "no"); };
  $("rate-send").addEventListener("click", async () => {
    if (!rating) { msg("Pick from 1 to 5 stars first.", false); return; }
    $("rate-send").disabled = true;
    try {
      const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: $("rate-text").value, page: location.pathname,
          device: matchMedia("(max-width: 760px)").matches ? "phone" : "computer" }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message);
      try { localStorage.setItem("pd:rated", "1"); } catch (e) { /* ignore */ }
      $("rate-more").hidden = true; stars.forEach((s) => { s.disabled = true; });
      msg("Thank you! Every rating helps make pdtools better \u{1F409}", true);
    } catch (e) { msg(e.message || "Could not send right now, please try again.", false); $("rate-send").disabled = false; }
  });
})();
