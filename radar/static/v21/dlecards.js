/* Dragondle share cards, four extra looks drawn in the browser (the animated one is painted on the server).
   Every card is 1200 x 675 (16:9, shown whole on X), drawn at 2x. No spoilers: only right or wrong per question.
   ctx = { n, marks: [1, 0, ...], total, streak, T, art: { name: url } } */
(() => {
  "use strict";
  const W = 1200, H = 675;
  const imgs = {};
  function img(src) {
    if (!imgs[src]) imgs[src] = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    return imgs[src];
  }
  function canvas(scale) {
    const c = document.createElement("canvas"); c.width = W * scale; c.height = H * scale;
    const x = c.getContext("2d"); x.setTransform(scale, 0, 0, scale, 0, 0); x.imageSmoothingQuality = "high";
    return { c, x };
  }
  function cover(x, im, ox = 0.5, oy = 0.5) {
    if (!im) return;
    const k = Math.max(W / im.width, H / im.height), w = im.width * k, h = im.height * k;
    x.drawImage(im, (W - w) * ox, (H - h) * oy, w, h);
  }
  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  function pill(x, text, X, Y, bg, ink, align = "left") {
    x.font = '800 19px "Nunito", sans-serif'; const w = x.measureText(text).width + 40;
    const L = align === "center" ? X - w / 2 : align === "right" ? X - w : X;
    rr(x, L, Y, w, 40, 20); x.fillStyle = bg; x.fill();
    x.fillStyle = ink; x.textBaseline = "middle"; x.textAlign = "left"; x.fillText(text, L + 20, Y + 21); x.textBaseline = "alphabetic";
  }
  function fit(x, text, size, floor, width, weight = 700, fam = "Fredoka") {
    let s = size; x.font = `${weight} ${s}px "${fam}", sans-serif`;
    while (x.measureText(text).width > width && s > floor) { s -= 2; x.font = `${weight} ${s}px "${fam}", sans-serif`; }
    return s;
  }
  function glowText(x, text, X, Y, fill, glow, blur) {
    x.save(); x.shadowColor = glow; x.shadowBlur = blur; x.fillStyle = fill; x.fillText(text, X, Y); x.restore(); x.fillStyle = fill; x.fillText(text, X, Y);
  }
  function seeded(n) { let s = (n * 9301 + 49297) % 233280; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
  function grain(x, amount) {
    const t = document.createElement("canvas"); t.width = t.height = 128; const g = t.getContext("2d"), d = g.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255 * amount; }
    g.putImageData(d, 0, 0); x.save(); x.globalCompositeOperation = "overlay"; x.fillStyle = x.createPattern(t, "repeat"); x.fillRect(0, 0, W, H); x.restore();
  }
  const right = (c) => c.marks.filter((m) => m === 1).length;
  function mood(c) {
    const s = right(c), T = c.T;
    return T(s === 5 ? "A perfect hatch!" : s === 4 ? "So close to perfect!" : s === 3 ? "Well read, Keeper!" : s >= 1 ? "Every egg hatches in time." : "Tomorrow's eggs are waiting.");
  }
  const streakLine = (c) => c.T(c.streak === 1 ? "1 day streak" : `${c.streak} day streak`);
  function star(x, X, Y, r, fill) {
    x.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rad = i % 2 ? r * 0.32 : r; x.lineTo(X + Math.cos(a) * rad, Y + Math.sin(a) * rad); }
    x.closePath(); x.fillStyle = fill; x.fill();
  }

  /* 1. Hatch day: the answers as a row of eggs on a straw ledge at sunrise; every right answer has hatched */
  async function hatch(c, x) {
    const [bg, egg, eb, ep] = await Promise.all([img(c.art.nest), img(c.art.egg), img(c.art.eggB), img(c.art.eggP)]);
    cover(x, bg, 0.5, 0.6);
    let g = x.createLinearGradient(0, 0, 0, 330); g.addColorStop(0, "rgba(255, 236, 214, .55)"); g.addColorStop(1, "rgba(255, 236, 214, 0)");
    x.fillStyle = g; x.fillRect(0, 0, W, 330);
    pill(x, `DRAGONDLE #${c.n}`, W / 2, 34, "#ffffff", "#6a2f5c", "center");
    x.textAlign = "center";
    const s = right(c);
    x.font = '700 124px "Fredoka", sans-serif';
    const main = String(s), tail = ` / ${c.total}`, mw = x.measureText(main).width; x.font = '700 60px "Fredoka", sans-serif'; const tw = x.measureText(tail).width;
    const X0 = W / 2 - (mw + tw) / 2;
    x.textAlign = "left"; x.font = '700 124px "Fredoka", sans-serif'; glowText(x, main, X0, 196, "#5b2350", "rgba(255, 255, 255, .95)", 26);
    x.font = '700 60px "Fredoka", sans-serif'; glowText(x, tail, X0 + mw + 6, 196, "#c0517f", "rgba(255, 255, 255, .9)", 18);
    x.textAlign = "center"; x.font = '800 30px "Nunito", sans-serif'; glowText(x, mood(c), W / 2, 250, "#6a2f5c", "rgba(255, 255, 255, .95)", 16);
    x.font = '800 22px "Nunito", sans-serif'; glowText(x, `${streakLine(c)} · pdtools.xyz/dragondle`, W / 2, 284, "#9a4f7a", "rgba(255, 255, 255, .9)", 12);
    // the eggs, sitting on the straw
    let hatched = 0;
    c.marks.forEach((m, i) => {
      const cx = 160 + i * 220, base = 628;
      const im = m === 1 ? (hatched++ % 2 ? ep : eb) : egg;
      if (!im) return;
      const h = m === 1 ? 262 : 196, w = im.width * h / im.height;
      x.save(); x.globalAlpha = .35; x.fillStyle = "#5a3a1a"; x.beginPath(); x.ellipse(cx, base - 4, w * .38, 12, 0, 0, 7); x.fill(); x.restore();
      if (m === 1) {   // a warm halo behind every hatchling
        const r = x.createRadialGradient(cx, base - h * .6, 10, cx, base - h * .6, h * .75);
        r.addColorStop(0, "rgba(255, 240, 190, .85)"); r.addColorStop(1, "rgba(255, 240, 190, 0)"); x.fillStyle = r; x.fillRect(cx - h, base - h * 1.4, h * 2, h * 1.6);
      }
      x.save(); x.translate(cx, base); if (m !== 1) x.rotate((i % 2 ? 1 : -1) * 0.05);
      x.drawImage(im, -w / 2, -h, w, h); x.restore();
      if (m !== 1) { x.fillStyle = "rgba(90, 60, 110, .75)"; x.font = '700 22px "Fredoka", sans-serif'; x.textAlign = "left"; x.fillText("z", cx + w * .32, base - h * .95); x.font = '700 16px "Fredoka", sans-serif'; x.fillText("z", cx + w * .48, base - h * 1.08); }
    });
    // little sparkles drifting up from the hatched ones
    const r = seeded(c.n * 7 + s);
    for (let k = 0; k < 26 * (s / 5 + .2); k++) { star(x, 60 + r() * 1080, 300 + r() * 220, 3 + r() * 6, `rgba(255, ${200 + r() * 55 | 0}, ${120 + r() * 100 | 0}, ${.5 + r() * .5})`); }
    grain(x, .04);
  }

  /* 2. Pinky's report card: a parchment report with a gold star for every right answer, and her grade stamp */
  async function report(c, x) {
    const [bg, pk] = await Promise.all([img(c.art.library), img(c.art.pinkyQuill)]);
    // the library, softly out of focus behind the desk
    if (bg) {
      const t = document.createElement("canvas"); t.width = 120; t.height = 68; const tx = t.getContext("2d"); tx.drawImage(bg, 0, 0, 120, 68);
      x.save(); x.imageSmoothingQuality = "high"; x.drawImage(t, -20, -12, W + 40, H + 24); x.restore();
    } else { x.fillStyle = "#5a3418"; x.fillRect(0, 0, W, H); }
    x.fillStyle = "rgba(40, 18, 6, .38)"; x.fillRect(0, 0, W, H);
    // the parchment
    x.save(); x.translate(430, 338); x.rotate(-0.025);
    x.shadowColor = "rgba(0, 0, 0, .45)"; x.shadowBlur = 40; x.shadowOffsetY = 18;
    rr(x, -360, -290, 720, 580, 18); const pg = x.createLinearGradient(0, -290, 0, 290); pg.addColorStop(0, "#fff8e6"); pg.addColorStop(1, "#f5e3bd"); x.fillStyle = pg; x.fill();
    x.shadowColor = "transparent";
    x.strokeStyle = "rgba(170, 120, 60, .55)"; x.lineWidth = 3; rr(x, -340, -270, 680, 540, 12); x.stroke();
    x.strokeStyle = "rgba(170, 120, 60, .3)"; x.lineWidth = 1.5; rr(x, -330, -260, 660, 520, 9); x.stroke();
    x.textAlign = "left"; x.fillStyle = "#6b3a12"; fit(x, c.T("Dragondle Report Card"), 42, 26, 420); x.fillText(c.T("Dragondle Report Card"), -300, -196);
    x.font = '800 20px "Nunito", sans-serif'; x.fillStyle = "#a0703a"; x.fillText(`#${c.n} · ${c.T("The daily Pocket Dragons puzzle")}`, -298, -162);
    // five rows
    c.marks.forEach((m, i) => {
      const y = -112 + i * 56;
      x.strokeStyle = "rgba(160, 110, 50, .25)"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(-290, y + 20); x.lineTo(290, y + 20); x.stroke();
      x.textAlign = "left"; x.fillStyle = "#6b3a12"; x.font = '800 24px "Nunito", sans-serif'; x.fillText(c.T(`Question ${i + 1}`), -280, y + 8);
      if (m === 1) {
        x.save(); x.shadowColor = "rgba(255, 190, 40, .9)"; x.shadowBlur = 14; star(x, 250, y - 2, 22, "#f5b416"); x.restore(); star(x, 250, y - 2, 13, "#ffe17a");
        x.textAlign = "right"; x.fillStyle = "#3f8a2c"; x.font = '800 20px "Nunito", sans-serif'; x.fillText(c.T("Gold star"), 214, y + 7);
      } else {
        x.beginPath(); x.arc(250, y - 2, 13, 0, 7); x.strokeStyle = "rgba(160, 110, 50, .5)"; x.lineWidth = 2.5; x.stroke();
        x.textAlign = "right"; x.fillStyle = "#a0703a"; x.font = '800 20px "Nunito", sans-serif'; x.fillText(c.T("Next time"), 214, y + 7);
      }
    });
    x.textAlign = "left"; x.fillStyle = "#6b3a12"; x.font = '700 32px "Fredoka", sans-serif'; x.fillText(`${right(c)} / ${c.total}`, -280, 228);
    x.font = '800 20px "Nunito", sans-serif'; x.fillStyle = "#a0703a"; x.fillText(streakLine(c), -280, 256);
    x.textAlign = "right"; x.font = 'italic 800 26px "Nunito", sans-serif'; x.fillStyle = "#b0457a"; x.fillText(c.T("Signed, Pinky"), 290, 248);
    x.restore();
    // the grade stamp
    const s = right(c), grade = ["C", "C+", "B", "B+", "A", "A+"][s] || "A";
    const note = c.T(s === 5 ? "Dragon scholar" : s >= 3 ? "Bright Keeper" : s >= 1 ? "Brave guesser" : "Fresh start");
    x.save(); x.translate(660, 134); x.rotate(0.2);
    x.globalAlpha = .92; x.fillStyle = "rgba(255, 248, 230, .6)"; x.beginPath(); x.arc(0, 0, 64, 0, 7); x.fill();
    x.strokeStyle = "#d1384f"; x.lineWidth = 5; x.beginPath(); x.arc(0, 0, 64, 0, 7); x.stroke(); x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 54, 0, 7); x.stroke();
    x.fillStyle = "#d1384f"; x.textAlign = "center"; x.font = '700 50px "Fredoka", sans-serif'; x.fillText(grade, 0, 14);
    fit(x, note.toUpperCase(), 12, 9, 84, 800, "Nunito"); x.fillText(note.toUpperCase(), 0, 36);
    x.restore();
    // Pinky with her quill
    if (pk) { const h = 500, w = pk.width * h / pk.height; x.save(); x.shadowColor = "rgba(0, 0, 0, .5)"; x.shadowBlur = 36; x.shadowOffsetY = 16; x.drawImage(pk, W - w - 14, H - h - 10, w, h); x.restore(); }
    x.textAlign = "right"; x.font = '800 22px "Nunito", sans-serif'; x.fillStyle = "#ffe2b0"; x.fillText("pdtools.xyz/dragondle", W - 40, 50);
    grain(x, .05);
  }

  /* 3. Stargazing: Blinky in a night meadow, and every right answer lights a star of a little dragon constellation */
  async function stars(c, x) {
    const bg = await img(c.art.stars);
    cover(x, bg, 0.5, 0.5);
    const pts = [[150, 300], [270, 190], [420, 230], [540, 130], [690, 175]];   // a small dragon in flight, nose to tail
    // the faint outline first, then the lit links
    x.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const lit = c.marks[i] === 1 && c.marks[i + 1] === 1;
      x.save(); x.strokeStyle = lit ? "rgba(255, 226, 150, .9)" : "rgba(200, 200, 255, .22)"; x.lineWidth = lit ? 3 : 2; if (lit) { x.shadowColor = "rgba(255, 210, 120, .9)"; x.shadowBlur = 12; }
      x.setLineDash(lit ? [] : [4, 8]); x.beginPath(); x.moveTo(...pts[i]); x.lineTo(...pts[i + 1]); x.stroke(); x.restore();
    }
    c.marks.forEach((m, i) => {
      const [X, Y] = pts[i];
      if (m === 1) {
        const r = x.createRadialGradient(X, Y, 2, X, Y, 70); r.addColorStop(0, "rgba(255, 236, 180, .9)"); r.addColorStop(1, "rgba(255, 236, 180, 0)");
        x.fillStyle = r; x.fillRect(X - 70, Y - 70, 140, 140);
        star(x, X, Y, 30, "#fff4cf"); star(x, X, Y, 16, "#ffffff");
      } else { x.beginPath(); x.arc(X, Y, 4, 0, 7); x.fillStyle = "rgba(220, 220, 255, .45)"; x.fill(); }
    });
    // the words, low on the left over the dark grass
    x.save(); x.translate(240, 640); x.scale(1.7, 1);
    const sh = x.createRadialGradient(0, 0, 20, 0, 0, 330); sh.addColorStop(0, "rgba(8, 6, 26, .82)"); sh.addColorStop(.6, "rgba(8, 6, 26, .5)"); sh.addColorStop(1, "rgba(8, 6, 26, 0)");
    x.fillStyle = sh; x.fillRect(-330, -330, 660, 660); x.restore();
    pill(x, `DRAGONDLE #${c.n}`, 70, 418, "rgba(255, 236, 190, .95)", "#2c1a4a");
    const s = right(c); x.textAlign = "left";
    x.font = '700 104px "Fredoka", sans-serif'; const mw = x.measureText(String(s)).width; glowText(x, String(s), 66, 560, "#fff6dc", "rgba(255, 210, 120, .8)", 24);
    x.font = '700 50px "Fredoka", sans-serif'; glowText(x, `/ ${c.total}`, 66 + mw + 12, 560, "#ffd98a", "rgba(255, 210, 120, .6)", 14);
    x.font = '800 26px "Nunito", sans-serif'; x.fillStyle = "#e8e1ff"; x.fillText(c.T(s === 1 ? "star found tonight" : "stars found tonight"), 70, 598);
    x.font = '800 22px "Nunito", sans-serif'; x.fillStyle = "#ffd98a"; x.fillText(`${streakLine(c)} · pdtools.xyz/dragondle`, 70, 634);
    grain(x, .04);
  }

  /* 4. Polaroid: a snapshot of Blinky and Pinky celebrating, taped to a corkboard, the score written on the tape */
  async function polaroid(c, x) {
    const [ph, st1, st2] = await Promise.all([img(c.art.photo), img(c.art.stickerA), img(c.art.stickerB)]);
    // cork
    const cg = x.createLinearGradient(0, 0, W, H); cg.addColorStop(0, "#c9945e"); cg.addColorStop(1, "#a8723f"); x.fillStyle = cg; x.fillRect(0, 0, W, H);
    const r = seeded(c.n + 11);
    for (let k = 0; k < 2600; k++) { x.fillStyle = `rgba(${r() < .5 ? "80, 45, 15" : "255, 225, 180"}, ${.08 + r() * .18})`; x.fillRect(r() * W, r() * H, 1 + r() * 2.4, 1 + r() * 2.4); }
    const vg = x.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 800); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(40, 20, 5, .45)"); x.fillStyle = vg; x.fillRect(0, 0, W, H);
    // confetti pinned around
    const cols = ["#ff7eb6", "#ffd36a", "#7ee0c3", "#9fb3ff", "#ffa36c"];
    for (let k = 0; k < 40; k++) { x.save(); x.translate(r() * W, r() * H); x.rotate(r() * 6); x.fillStyle = cols[k % 5]; x.fillRect(-7, -3, 14, 6); x.restore(); }
    // the photo
    x.save(); x.translate(820, 330); x.rotate(0.06);
    x.shadowColor = "rgba(0, 0, 0, .45)"; x.shadowBlur = 30; x.shadowOffsetY = 16; x.fillStyle = "#fffdf8"; x.fillRect(-235, -270, 470, 560); x.shadowColor = "transparent";
    if (ph) x.drawImage(ph, -210, -245, 420, 420); else { x.fillStyle = "#ddd"; x.fillRect(-210, -245, 420, 420); }
    x.textAlign = "center"; x.fillStyle = "#4a3a6a"; x.font = '700 38px "Fredoka", sans-serif'; x.fillText(`#${c.n} · ${right(c)}/${c.total}`, 0, 232);
    x.restore();
    // tape
    const tape = (X, Y, a) => { x.save(); x.translate(X, Y); x.rotate(a); x.fillStyle = "rgba(255, 246, 214, .78)"; x.fillRect(-60, -16, 120, 32); x.restore(); };
    tape(640, 70, -0.5); tape(1010, 95, 0.55);
    // stickers on the board
    if (st1) { const h = 150, w = st1.width * h / st1.height; x.save(); x.translate(600, 560); x.rotate(-0.2); x.drawImage(st1, -w / 2, -h / 2, w, h); x.restore(); }
    if (st2) { const h = 120, w = st2.width * h / st2.height; x.save(); x.translate(1110, 600); x.rotate(0.18); x.drawImage(st2, -w / 2, -h / 2, w, h); x.restore(); }
    // a paper note with the words
    x.save(); x.translate(270, 330); x.rotate(-0.04);
    x.shadowColor = "rgba(0, 0, 0, .35)"; x.shadowBlur = 24; x.shadowOffsetY = 10; x.fillStyle = "#fff4c9"; x.fillRect(-210, -230, 420, 450); x.shadowColor = "transparent";
    x.fillStyle = "#e74c6f"; x.beginPath(); x.arc(0, -212, 12, 0, 7); x.fill(); x.fillStyle = "rgba(255,255,255,.6)"; x.beginPath(); x.arc(-4, -216, 4, 0, 7); x.fill();
    x.textAlign = "center"; x.fillStyle = "#7a4a8a"; x.font = '800 20px "Nunito", sans-serif'; x.fillText(`DRAGONDLE #${c.n}`, 0, -160);
    const s = right(c); x.fillStyle = "#3b2552"; x.font = '700 120px "Fredoka", sans-serif'; x.fillText(`${s}/${c.total}`, 0, -40);
    // the five answers as little hearts
    c.marks.forEach((m, i) => { const X = -120 + i * 60, Y = 20; x.save(); x.translate(X, Y); x.fillStyle = m === 1 ? "#ff5f8f" : "rgba(120, 90, 140, .25)";
      x.beginPath(); x.moveTo(0, 10); x.bezierCurveTo(-26, -8, -12, -26, 0, -12); x.bezierCurveTo(12, -26, 26, -8, 0, 10); x.fill(); x.restore(); });
    fit(x, mood(c), 30, 18, 370, 700); x.fillStyle = "#3b2552"; x.fillText(mood(c), 0, 92);
    x.font = '800 20px "Nunito", sans-serif'; x.fillStyle = "#7a4a8a"; x.fillText(streakLine(c), 0, 130);
    x.font = '800 20px "Nunito", sans-serif'; x.fillStyle = "#b0457a"; x.fillText("pdtools.xyz/dragondle", 0, 192);
    x.restore();
    grain(x, .04);
  }

  const STYLES = { hatch, report, stars, polaroid };
  window.pdDleCards = {
    styles: Object.keys(STYLES),
    async draw(style, ctx, scale = 2) {
      const { c, x } = canvas(scale);
      await STYLES[style](ctx, x);
      return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
    },
  };
})();
