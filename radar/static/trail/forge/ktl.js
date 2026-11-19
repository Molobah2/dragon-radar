/* the Trail card painter (KTL), copied from trail/index.html so the forge preview stands on its own */
const KTL = (() => {
  const DEMO = {
    name: 'Jon Wynn', handle: '@jonwynnx', avatar: '', posts: '148', views: '212.4K', replies: '2,406', reposts: '812', likes: '6,931',
    followers: '9,262', first: '8 Sep 2026', last: '30 Oct 2026', day: '54', bestViews: '10,163', bestViewsDate: 'Sep 15', bestLikes: '276',
    bestLikesDate: 'Sep 12', streak: '16', weeks: '8', weeksTotal: '8', ahead: '86', perPost: '1,435',
    rhythm: [0, 2, 1, 2, 0, 2, 2, 2, 2, 2, 3, 2, 2, 3, 2, 2, 1, 2, 2, 3, 2, 2, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2, 1, 2, 2, 1, 1, 2, 1, 2, 1, 1, 3, 2, 2, 2, 't', 0, 0],
    walks: [['moss_and_ember', '41'], ['sky_lantern', '27'], ['quill_keeper', '19']],
    markers: [['star', 'First Spark', 'Sep 8', 1], ['lantern', 'Lantern Lit', '10K view post', 1], ['flame', 'Seven Day Flame', '16 days running', 1], ['gate', 'Gate Watcher', 'Here since week one', 1]],
  };
  const WALKC = ['#6d5313', '#e0784f', '#7fa38f'];
  let card = null;
  const val = (k) => { const c = card || DEMO; if (k === 'badges') k = 'followers';
    if (k === 'initials') return (c.name || '').split(/\s+/).filter(Boolean).map(s => [...s][0]).join('').slice(0, 2).toUpperCase();
    if (k === 'views' && c.viewsN != null && c.viewsN !== '' && isFinite(+c.viewsN)) return views2(+c.viewsN);   // two decimal places (8 Nov, Jon and Shiv)
    const v = c[k]; return v == null ? '' : String(v); };
  const views2 = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(2) + 'K' : Math.round(n).toLocaleString('en-US');
  const img = (src) => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const canvasOf = (im) => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0); return c; };   // a CPU canvas: encoding it never waits on the graphics card
  const caseOf = (s, tt) => tt === 'uppercase' ? s.toUpperCase() : tt === 'lowercase' ? s.toLowerCase() : s;
  function width(x, s, g, k) { x.font = g.f.replace(/[\d.]+px/, (m) => (parseFloat(m) * k) + 'px'); return x.measureText(s).width + (g.ls * k) * [...s].length; }
  function put(x, s, g, k, px, py, ink) {
    x.font = g.f.replace(/[\d.]+px/, (m) => (parseFloat(m) * k) + 'px'); x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    const draw = (fn) => { if (!g.ls) { fn(s, px); return; } let cx = px; for (const ch of s) { fn(ch, cx); cx += x.measureText(ch).width + g.ls * k; } };
    const clear = (c) => !c || /rgba\([^)]*,\s*0\)$/.test(c) || c === 'transparent';
    const fill = ink || (g.grad ? cssGrad(x, g.grad) : null) || (!clear(g.fill) ? g.fill : g.col);
    if (!ink && !g.grad && clear(g.fill) && clear(g.col)) return;
    if (g.sw > 0 && !(g.grad && clear(g.sc))) { x.lineWidth = g.sw * 2 * k; x.lineJoin = 'round'; x.strokeStyle = ink || (clear(g.sc) ? fill : g.sc); draw((t, cx) => x.strokeText(t, cx, py)); }
    x.fillStyle = fill; draw((t, cx) => x.fillText(t, cx, py));
  }
  // a CSS linear-gradient (as the browser reports it) turned into a canvas gradient over the box it covered
  function cssGrad(x, gr) {
    const m = gr.img.match(/linear-gradient\((.*)\)\s*$/); if (!m) return null;
    const parts = []; let depth = 0, cur = ''; for (const ch of m[1]) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += ch; } parts.push(cur.trim());
    let ang = 180; if (/deg$/.test(parts[0])) ang = parseFloat(parts.shift()); else if (/^to /.test(parts[0])) { const t = parts.shift(); ang = /bottom/.test(t) ? 180 : /top/.test(t) ? 0 : /right/.test(t) ? 90 : 270; }
    const a = (ang - 90) * Math.PI / 180, cx = gr.x + gr.w / 2, cy = gr.y + gr.h / 2, half = Math.abs(gr.w / 2 * Math.cos(a)) + Math.abs(gr.h / 2 * Math.sin(a));
    const g = x.createLinearGradient(cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half);
    parts.forEach((p, i) => { const mm = p.match(/^(.*?\))\s*([\d.]+%)?$/) || p.match(/^(\S+)\s*([\d.]+%)?$/); if (!mm) return;
      const at = mm[2] ? parseFloat(mm[2]) / 100 : i / Math.max(1, parts.length - 1); try { g.addColorStop(Math.min(1, Math.max(0, at)), mm[1]); } catch (e) {} });
    return g;
  }
  function rrect(x, a, b, w, h, r) { r = Math.min(r, w / 2, h / 2); x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  // one line of words: values and the fixed words around them, measured again and set back on the same baseline
  function block(x, s, b, ink) {
    const parts = []; let prevEnd = null;
    for (const g of b.segs) {
      if (g.gap || g.svg) continue;
      let str = g.k ? val(g.k) : g.t;
      if (!g.k && /^\s*%/.test(str) && parts.length && parts[parts.length - 1].g.k === 'ahead' && parts[parts.length - 1].str === '—') str = str.replace('%', '');   // no percentage yet
      if (!parts.length) str = str.replace(/^\s+/, '');
      parts.push({ g, str: caseOf(str, g.tt), gap: prevEnd == null ? 0 : Math.max(0, g.x - prevEnd - 0.5) });
      prevEnd = g.x + g.w;
    }
    if (!parts.length) return;
    parts[parts.length - 1].str = parts[parts.length - 1].str.replace(/\s+$/, '');
    let W = 0; parts.forEach(p => { p.w = width(x, p.str, p.g, 1); W += p.w + p.gap; });
    const room = Math.max(10, b.hi - b.lo), k = W > room ? room / W : 1; W *= k;
    let px = b.anchor === 'r' ? b.x1 - W : b.anchor === 'c' ? (b.x0 + b.x1) / 2 - W / 2 : b.x0;
    px = Math.max(b.lo, Math.min(px, b.hi - W));
    if (b.box && !ink) {   // the bubble behind the words grows and shrinks with them
      const bw = W + b.box.pl + b.box.pr, by = b.box.rect[1], bh = b.box.rect[3];
      x.fillStyle = b.box.bg; rrect(x, px - b.box.pl, by, bw, bh, b.box.r); x.fill();
    }
    parts.forEach(p => { px += p.gap * k; put(x, p.str, p.g, k, px, p.g.y, ink); px += p.w * k; });
  }
  function heat(x, h) {
    const r = (card || DEMO).rhythm || [];
    h.cells.forEach((c, i) => { const v = r[i], key = v === 't' ? 't' : v ? 'l' + v : 'l0', L = h.look[key] || h.look.l0; if (!L) return;
      if (L.bg && !/rgba\(0, 0, 0, 0\)/.test(L.bg)) { x.fillStyle = L.bg; rrect(x, c[0], c[1], c[2], c[3], L.r); x.fill(); }
      const m = L.ring && L.ring.match(/^(rgba?\([^)]*\)).*?(\d+(?:\.\d+)?)px inset/); if (m) { const w = +m[2]; x.strokeStyle = m[1]; x.lineWidth = w; rrect(x, c[0] + w / 2, c[1] + w / 2, c[2] - w, c[3] - w, Math.max(0, L.r - w / 2)); x.stroke(); } });
  }
  function walks(x, w, ink) {
    const list = (card || DEMO).walks || [];
    w.rows.forEach((row, j) => { const it = list[j]; if (!it) return; const [handle, n] = it, name = it[3] || handle;   // it[3]: the X name (15 Nov), else the handle
      const a = row.a.rect; if (!ink) { x.fillStyle = it[2] || WALKC[j % 3]; x.beginPath(); x.arc(a[0] + a[2] / 2, a[1] + a[3] / 2, Math.min(a[2], a[3]) / 2, 0, 7); x.fill(); }
      const ch = (name[0] || '?').toUpperCase(), cw = width(x, ch, row.a, 1);   // the letter sits in the middle of its circle
      x.font = row.a.f; const mt = x.measureText(ch), mid = (mt.actualBoundingBoxAscent - mt.actualBoundingBoxDescent) / 2;
      put(x, ch, row.a, 1, a[0] + a[2] / 2 - cw / 2, a[1] + a[3] / 2 + mid, ink);
      const hs = it[3] ? name : '@' + handle, room = row.hi - row.h.x, hw = width(x, hs, row.h, 1); put(x, hs, row.h, hw > room ? room / hw : 1, row.h.x, row.h.y, ink);
      put(x, `${n} ${+n === 1 ? 'mention' : 'mentions'}`, row.r, 1, row.r.x, row.r.y, ink); });
  }
  function coinWords(x, coins, ink) {
    const list = (card || DEMO).markers || [];
    coins.forEach((c, j) => { const m = list[j]; if (!m) return;
      const lit = m[3] && j && coins[0] ? coins[0] : c;   // an earned marker (the Gate Watcher, 15 Nov) takes the earned colours, not the locked grey
      for (const [g, s] of [[Object.assign({}, c.t, { fill: lit.t.fill, col: lit.t.col, sc: lit.t.sc }), m[1]], [Object.assign({}, c.s, { fill: lit.s.fill, col: lit.s.col, sc: lit.s.sc }), m[2]]]) { const str = caseOf(String(s), g.tt), w0 = width(x, str, g, 1), k = w0 > c.room ? c.room / w0 : 1; put(x, str, g, k, g.cx - (w0 * k) / 2, g.y, ink); } });
  }
  async function blobURL(c) { return await new Promise(ok => c.toBlob(b => ok(URL.createObjectURL(b)), 'image/jpeg', 0.92)); }
  // paint one design's textures; A is the design's asset map (names to image URLs) and is updated in place
  async function paint(data) {
    const A = data.assets, SC = data.scene; if (!SC || !SC.front || !SC.front.live) return;
    if (document.fonts && document.fonts.load) { try { await Promise.all(['500 20px Pop', '700 20px Pop', '600 20px IDs', '800 20px IDs', '600 20px Jos', '700 20px Jos', '700 20px Bod', '800 20px Bod', '700 20px Cin', '800 20px Cin', '500 20px Mar'].map(f => document.fonts.load(f, 'A1'))); } catch (e) {} }
    const avatar = (card && card.avatar) ? await img(card.avatar).catch(() => null) : null;
    const jobs = [];
    for (const side of ['front', 'back']) {
      const S = SC[side], L = S.live; if (!L) continue;
      const groups = new Map();      // texture name -> what goes on it
      const at = (on, i) => on === 'tile' ? `${side}-tile${i}.jpg` : on === 'ava' ? `${side}-ava.jpg` : `${side}-frame.jpg`;
      const add = (name, f) => { if (!groups.has(name)) groups.set(name, []); groups.get(name).push(f); };
      L.blocks.forEach(b => add(at(b.on, b.i), (x, ink) => block(x, null, b, ink)));
      if (L.heat) add(at(L.heat.on, L.heat.i), (x, ink) => { if (!ink) heat(x, L.heat); });
      if (L.walk) add(at(L.walk.on, L.walk.i), (x, ink) => walks(x, L.walk, ink));
      if (L.coins && L.coins.length) add(at(L.coins[0].on, L.coins[0].i), (x, ink) => coinWords(x, L.coins, ink));
      // the coins themselves: lit when earned, stone when not
      (S.coins || []).forEach((c, j) => { const m = ((card || DEMO).markers || [])[j]; const on = m ? !!m[3] : !c.locked; c._tex = on ? c.tex : (c.off || c.tex); c._metal = on ? c.metal : (c.offMetal || c.metal); });
      const rectOf = (name) => { if (name.includes('-tile')) { const t = S.tiles.find(t => t.tex === name); return t && t.rect; } if (name.includes('-ava')) return S.ava && S.ava.rect; return S.frame.rect; };
      for (const [name, fns] of groups) {
        if (!A[name]) continue;
        jobs.push((async () => {
          const im = await img(A[name]), c = canvasOf(im), x = c.getContext('2d'), r = rectOf(name), k = r ? c.width / r[2] : 1;
          x.scale(k, k);
          const isAva = name.includes('-ava');
          if (isAva && avatar) {          // the Keeper's own X picture, inside the medallion's ring
            const R = r[2] / 2, inner = R * 0.86; x.save(); x.beginPath(); x.arc(R, r[3] / 2, inner, 0, 7); x.clip();
            const s = Math.max((inner * 2) / avatar.naturalWidth, (inner * 2) / avatar.naturalHeight); x.drawImage(avatar, R - avatar.naturalWidth * s / 2, r[3] / 2 - avatar.naturalHeight * s / 2, avatar.naturalWidth * s, avatar.naturalHeight * s); x.restore();
          } else fns.forEach(f => f(x));
          A[name] = await blobURL(c);
          const tile = S.tiles.find(t => t.tex === name), mname = tile ? tile.metal : isAva && S.ava ? S.ava.metal : null;
          if (mname && A[mname]) {        // the same marks, in black, on the metal map
            const mi = await img(A[mname]), mc = canvasOf(mi), mx = mc.getContext('2d'), mk = mc.width / r[2]; mx.scale(mk, mk);
            if (isAva && avatar) { mx.fillStyle = '#000'; mx.beginPath(); mx.arc(r[2] / 2, r[3] / 2, r[2] / 2 * 0.86, 0, 7); mx.fill(); }
            else fns.forEach(f => f(mx, '#000'));
            A[mname] = await blobURL(mc);
          }
        })());
      }
    }
    await Promise.all(jobs);
  }
  return {
    get card() { return card || DEMO; }, get live() { return !!card; },
    set(c) { card = c; },
    paint,
  };
})();
window.KTL = KTL;
