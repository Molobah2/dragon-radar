/* Card kit (v2): the shared look of every pdtools share card, so dragon cards, daily cards and later cards
   read as one premium family. 1200 by 675 layout (16:9, shown whole on X), drawn at 2x for sharp phones.
   Hero art on the left, a dark glass panel on the right, the same pills, chips, progress bar and footer. */
(() => {
  "use strict";
  const W = 1200, H = 675, P = { x: 700, y: 64, w: 444, h: 547, r: 34 };

  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

  async function fonts() { try { await document.fonts.load('700 60px "Fredoka"'); await document.fonts.load('800 20px "Nunito"'); } catch (e) {} }

  function canvas(scale = 2) {
    const c = document.createElement("canvas"); c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    const x = c.getContext("2d"); x.setTransform(scale, 0, 0, scale, 0, 0);
    return { c, x };
  }

  // fine film grain: colours feel rich instead of flat and digital
  let grainTile = null;
  function grain(x, amount = 0.06) {
    if (!grainTile) {
      grainTile = document.createElement("canvas"); grainTile.width = grainTile.height = 160;
      const g = grainTile.getContext("2d"), d = g.createImageData(160, 160);
      for (let i = 0; i < d.data.length; i += 4) { const v = 110 + Math.random() * 145; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0);
    }
    x.save(); x.globalAlpha = amount; x.globalCompositeOperation = "overlay";
    x.fillStyle = x.createPattern(grainTile, "repeat"); x.fillRect(0, 0, W, H); x.restore();
  }

  function vignette(x, k = 0.42) {
    const v = x.createRadialGradient(W * 0.4, H * 0.5, W * 0.25, W * 0.5, H * 0.5, W * 0.8);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, `rgba(5, 3, 20, ${k})`);
    x.fillStyle = v; x.fillRect(0, 0, W, H);
  }

  // the hero: soft glow behind, a pedestal shadow, a light rim around the character, then the art
  function hero(x, img, { cx = 360, cy = 330, maxW = 560, maxH = 540, glow = "255, 255, 255" } = {}) {
    const g = x.createRadialGradient(cx, cy, 20, cx, cy, 340); g.addColorStop(0, `rgba(${glow}, .38)`); g.addColorStop(1, `rgba(${glow}, 0)`);
    x.fillStyle = g; x.fillRect(0, 0, 760, H);
    x.save(); x.translate(cx, cy + maxH / 2 + 18); x.scale(1, 0.18);
    const ped = x.createRadialGradient(0, 0, 10, 0, 0, 250); ped.addColorStop(0, "rgba(0, 0, 0, .45)"); ped.addColorStop(1, "rgba(0, 0, 0, 0)");
    x.fillStyle = ped; x.beginPath(); x.arc(0, 0, 250, 0, 7); x.fill(); x.restore();
    if (!img) return;
    const k = Math.min(maxW / img.width, maxH / img.height), w = img.width * k, h = img.height * k, X = cx - w / 2, Y = cy - h / 2;
    x.save(); x.shadowColor = `rgba(${glow}, .55)`; x.shadowBlur = 28; x.drawImage(img, X, Y, w, h); x.restore();
    x.save(); x.shadowColor = "rgba(0, 0, 0, .38)"; x.shadowBlur = 30; x.shadowOffsetY = 16; x.drawImage(img, X, Y, w, h); x.restore();
  }

  function panel(x, edge = "rgba(255, 255, 255, .32)") {
    x.save(); x.shadowColor = "rgba(0, 0, 0, .35)"; x.shadowBlur = 44; x.shadowOffsetY = 18;
    rr(x, P.x, P.y, P.w, P.h, P.r); x.fillStyle = "rgba(14, 10, 34, .42)"; x.fill(); x.restore();
    x.save(); rr(x, P.x, P.y, P.w, P.h, P.r); x.clip();
    const sheen = x.createLinearGradient(P.x, P.y, P.x + P.w, P.y + P.h);
    sheen.addColorStop(0, "rgba(255, 255, 255, .14)"); sheen.addColorStop(0.45, "rgba(255, 255, 255, .03)"); sheen.addColorStop(1, "rgba(255, 255, 255, .08)");
    x.fillStyle = sheen; x.fillRect(P.x, P.y, P.w, P.h); x.restore();
    rr(x, P.x, P.y, P.w, P.h, P.r); x.strokeStyle = edge; x.lineWidth = 2; x.stroke();
  }

  const INK = "#ffffff", SOFT = "rgba(255, 255, 255, .72)", FAINT = "rgba(255, 255, 255, .18)";

  function pill(x, text, X, Y, { bg = "rgba(255, 255, 255, .16)", ink = INK } = {}) {
    x.font = '800 19px "Nunito", system-ui, sans-serif'; const w = x.measureText(text).width + 40;
    rr(x, X, Y, w, 40, 20); x.fillStyle = bg; x.fill();
    x.fillStyle = ink; x.textBaseline = "middle"; x.textAlign = "left"; x.fillText(text, X + 20, Y + 21); x.textBaseline = "alphabetic";
    return w;
  }
  function chip(x, text, X, Y) {
    x.font = '800 19px "Nunito", system-ui, sans-serif'; const w = x.measureText(text).width + 34;
    rr(x, X, Y, w, 40, 20); x.fillStyle = "rgba(255, 255, 255, .12)"; x.fill();
    x.fillStyle = INK; x.textBaseline = "middle"; x.fillText(text, X + 17, Y + 21); x.textBaseline = "alphabetic";
    return w;
  }
  // fit a line of text into a width, shrinking the font down to a floor
  function fit(x, text, X, Y, width, size, floor, weight = 700, family = "Fredoka") {
    let s = size; x.font = `${weight} ${s}px "${family}", sans-serif`;
    while (x.measureText(text).width > width && s > floor) { s -= 2; x.font = `${weight} ${s}px "${family}", sans-serif`; }
    x.fillText(text, X, Y); return s;
  }
  function label(x, text, X, Y) { x.fillStyle = SOFT; x.font = '800 16px "Nunito", sans-serif'; x.textAlign = "left"; x.fillText(text, X, Y); }
  function divider(x, Y) { x.fillStyle = FAINT; x.fillRect(P.x + 40, Y, P.w - 80, 2); }
  function bar(x, text, n, total, Y, colors = ["#ffe08a", "#ff9f5a"]) {
    const X = P.x + 40, w = P.w - 80;
    label(x, text, X, Y);
    rr(x, X, Y + 14, w, 12, 6); x.fillStyle = "rgba(255, 255, 255, .14)"; x.fill();
    const k = Math.max(0.04, Math.min(1, n / total)), g = x.createLinearGradient(X, 0, X + w, 0); g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
    rr(x, X, Y + 14, w * k, 12, 6); x.fillStyle = g; x.fill();
  }
  function footer(x) { x.textAlign = "right"; x.fillStyle = SOFT; x.font = '800 20px "Nunito", sans-serif'; x.fillText("pdtools.xyz", P.x + P.w - 36, P.y + P.h - 30); x.textAlign = "left"; }
  // a thin gold foil frame for golden legends
  function foil(x) {
    const g = x.createLinearGradient(0, 0, W, H);
    ["#fff3b8", "#d99a1e", "#ffe89a", "#9a6410", "#ffd76a"].forEach((c, i) => g.addColorStop(i / 4, c));
    rr(x, 14, 14, W - 28, H - 28, 26); x.strokeStyle = g; x.lineWidth = 5; x.stroke();
  }

  window.pdCard = { W, H, P, rr, fonts, canvas, grain, vignette, hero, panel, pill, chip, fit, label, divider, bar, footer, foil, INK, SOFT };
})();
