/* Site language loader. The pages are written in English. For another language this adds that one
   language pack (/i18n/<code>.js, built from i18n_src.js) before the page first shows, so nobody sees
   a flash of English and English readers download no translations at all. Choice is remembered here. */
(() => {
  "use strict";
  const LANGS = [
    ["en", "English"], ["es", "Español"], ["fr", "Français"], ["pt", "Português"], ["tr", "Türkçe"],
    ["ru", "Русский"], ["vi", "Tiếng Việt"], ["id", "Indonesia"], ["ko", "한국어"], ["zh", "中文"],
  ];
  const GT = { zh: "zh-CN" };  // Google Translate codes where they differ
  const codes = LANGS.map((l) => l[0]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  function detect() {
    const saved = store.get("radar:lang");
    if (saved && codes.includes(saved)) return saved;
    for (const l of navigator.languages || [navigator.language || "en"]) {
      const base = String(l).toLowerCase().split("-")[0];
      if (codes.includes(base)) return base;
    }
    return "en";
  }
  const lang = detect();
  window.radarLang = lang;
  window.radarTranslateCode = GT[lang] || lang;
  document.documentElement.lang = lang;

  const pick = document.getElementById("lang-select");
  if (pick) {
    for (const [c, name] of LANGS) { const o = document.createElement("option"); o.value = c; o.textContent = name; pick.append(o); }
    pick.value = lang;
    pick.addEventListener("change", () => { store.set("radar:lang", pick.value); location.reload(); });
  }
  if (lang === "en") return;
  let v = "";
  try { v = new URL(document.currentScript.src).searchParams.get("v") || ""; } catch (e) { /* old browser */ }
  // parser blocking on purpose: the pack runs before the first paint, exactly like the old single file
  document.write(`<script src="/i18n/${lang}.js${v ? "?v=" + encodeURIComponent(v) : ""}"><\/script>`);
})();
