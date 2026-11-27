/* Keepers Trail: captions to post with the card (27 Nov 2026, Jon: ten of them, each under 100 words, about the road to the
   mint, naming pdtools.xyz and @Pocket_Dragons_). Opens when a Keeper taps Share on X: they pick one, it is filled with
   their own numbers, then the card is shared with it. English for now. */
(function () {
  if (window.KT_CAPTIONS) return;
  var CAPS = [{"t": "The first post", "x": "My first Pocket Dragons post went up on {first}. One egg, no idea what the badges meant, not sure anyone would read it.\n\n{days} days later: {posts} posts, {views} views, {replies} replies. Every reply was someone who stopped to talk about a cartoon egg.\n\nQuests, Ember Chamber nights, Friday AMAs, the week the auction got dropped. Then 30 November, two hours, and it was done.\n\nNot the floor, not the hype. Just someone who showed up and met good people on the way to the Hatchery door.\n\nCard made on pdtools.xyz. See you on 4 December, @Pocket_Dragons_ 🐉", "need": []}, {"t": "What the numbers miss", "x": "{posts} posts. {views} views. True, and I am a bit proud.\n\nBut the card misses the stranger who replied and became a friend. The Ember Chamber nights. The Friday AMAs where I learned how this team thinks. {friend}, the Keeper I walked with most.\n\nThe mint on 30 November was the line we all pointed at for weeks. Two hours, 0.029 ETH, no auction. When it closed I felt less relief and more gratitude.\n\nThe numbers are real. The people are the story.\n\nCard from pdtools.xyz. On to the reveal, @Pocket_Dragons_ 🐉", "need": ["friend"]}, {"t": "Night shifts in the Ember Chamber", "x": "Most of my Pocket Dragons story happened late at night.\n\nOne more round in the Ember Chamber before sleep. Some eggs only show up every second night, so you learn to come back. That habit became a {streak} day streak, then {posts} posts since {first}.\n\nI never planned it. I kept showing up, and the quiet nights filled with people.\n\nThen 30 November, two hours in bright daylight, and the road was behind us.\n\nSmall things done every day add up. pdtools.xyz turned mine into this card.\n\nReveal on 4 December, @Pocket_Dragons_ 🐉", "need": ["streak"]}, {"t": "A letter to my egg", "x": "Dear egg,\n\nOn {first} I had no idea what you would become. I still do not. You reveal on 4 December at 13:00 UTC.\n\nHere is what it took to find you. {posts} posts. {views} views. Quests, badges, Friday AMAs, Ember Chamber nights. A week when the plan changed and everyone got the same price.\n\nThen mint day, two hours, and my heart going faster than it should for a cartoon egg.\n\nWhatever you hatch into, you already mean something.\n\npdtools.xyz made the card. @Pocket_Dragons_ makes the rest. See you on the 4th. Be cute. 🐉", "need": []}, {"t": "For the people who walked with me", "x": "My name is on this card but it was never a solo thing.\n\nOn {first} I was posting into the void. By mint day I had Keepers I talked to daily. {friend} walked with me most, and if you know, you know.\n\n{replies} replies. {likes} likes. Most of those came from friends showing up for each other.\n\nThe auction got dropped, the presale sold out, 30 November came and went in two hours. The chat never stopped.\n\nThank you for turning a project into a place.\n\nCard from pdtools.xyz. Reveal is 4 December, @Pocket_Dragons_ 🐉", "need": ["friend"]}, {"t": "I came in late", "x": "I was not here on day one and thought I had missed it.\n\nMy first dragon post was on {first}. People already had badges I could not get and jokes I did not understand. I almost closed the tab.\n\nThis community does not care when you arrived. It cares whether you show up. So I did. {posts} posts, {days} days on the trail, {views} views I never expected.\n\nThen 30 November, two hours, done.\n\nIf you think you are too late for something, you probably are not.\n\nCard made on pdtools.xyz. See you at the reveal, @Pocket_Dragons_ 🐉", "need": []}, {"t": "The week they listened", "x": "One week changed how I felt about this whole project.\n\nThe plan was a public auction and a bigger supply. A lot of us worried and said so. On 20 November the team answered. No auction. Supply down to 4,000. One price for everyone. No team allocation.\n\nTeams do not always listen. @Pocket_Dragons_ did, in public.\n\nThat week sits in the middle of my card. {posts} posts since {first}. {days} days on the trail. I kept going.\n\nThe mint on 30 November felt calmer because of it.\n\nCard from pdtools.xyz. Reveal is 4 December. Glad I stayed. 🐉", "need": []}, {"t": "Two hours on a Monday", "x": "30 November, 16:00 UTC. Mint page open ten minutes early, which was pointless.\n\nTwo hours. 2,000 eggs. 0.029 ETH. After everything, it came down to one afternoon and a page I kept refreshing.\n\nThe road was so much longer than that window. {posts} posts since {first}. {days} days. Ember Chamber nights and a group chat full of friends.\n\nWhen it closed I sat there a minute. The moment we all talked about just happened, quietly.\n\nMy road, on one card from pdtools.xyz. Now we wait for 4 December, 13:00 UTC, @Pocket_Dragons_ 🐉", "need": []}, {"t": "What I would tell day one me", "x": "To the person who made my first Pocket Dragons post on {first}:\n\nYou will post {posts} times. Some posts will reach {bestViews} views, some nobody. Keep going. The quiet ones are where you find your people.\n\nPlay the Ember Chamber at night. Go to the Friday AMAs and listen.\n\nThe auction you worry about will disappear and everyone will pay the same price. You will feel heard.\n\nThe mint will be two hours on 30 November and over before your tea gets cold.\n\nThis card from pdtools.xyz says it all. Worth it, @Pocket_Dragons_ 🐉", "need": ["bestViews"]}, {"t": "Still here", "x": "People ask what all the posting was for. This card is my answer.\n\n{posts} posts since {first}. {replies} replies, {likes} likes. {days} days of showing up.\n\nThe point was being part of something while it was built. I watched the Hatchery open, the Ember Chamber become a ritual, the team change course when we asked.\n\nI watched 30 November come and go in two hours.\n\nSome days I posted a thread. Some days just a dragon in someone's replies. Both counted.\n\nMy card is on pdtools.xyz. Reveal is 4 December, @Pocket_Dragons_. I am still here. 🐉", "need": []}];
  var ART = '/static/v3/art/';
  function fill(t, c) {
    var w = (c.walks || [])[0], v = { posts: c.posts, views: c.views, likes: c.likes, replies: c.replies, reposts: c.reposts,
      first: c.first, days: c.day, streak: c.streak, bestViews: c.bestViews, friend: w && w[0] ? '@' + w[0] : '' };
    return t.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null && v[k] !== '' ? String(v[k]) : m; });
  }
  function usable(cap, c) {
    var w = (c.walks || [])[0];
    return cap.need.every(function (k) {
      if (k === 'friend') return !!(w && w[0]);
      if (k === 'streak') return parseInt(String(c.streak || '0').replace(/,/g, ''), 10) >= 2;
      return !!c[k] && c[k] !== '0';
    });
  }
  var css = '#ktcap{position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(14,9,4,.58);font:15px/1.45 system-ui,sans-serif;color:#3b2a14}' +
    '#ktcap .sh{position:relative;width:100%;max-width:480px;max-height:94svh;overflow-x:hidden;overflow-y:auto;box-sizing:border-box;padding:12px 8px calc(8px + env(safe-area-inset-bottom));border:22px solid transparent;border-image:url(' + ART + 'card-l.webp) 90 fill / 22px stretch;filter:drop-shadow(0 -8px 28px rgba(0,0,0,.45))}' +
    '@media (min-width:600px){#ktcap{align-items:center}}' +
    '#ktcap h2{margin:0 40px 2px 0;font:600 22px/1.2 Georgia,serif;color:#2e1f0c}#ktcap .sub{margin:0 0 12px;font-size:14px;color:#6b5636}' +
    '#ktcap .x{position:absolute;top:0;right:0;width:40px;height:40px;border:0;background:none;color:#6b5636;font-size:24px;cursor:pointer;border-radius:8px}' +
    '#ktcap .pick{display:block;width:100%;margin:0;padding:12px 4px;border:0;border-top:1px solid rgba(59,42,20,.16);background:none;text-align:left;color:inherit;font:inherit;cursor:pointer;transition:background-color .15s}' +
    '#ktcap .pick:hover{background:rgba(255,250,236,.45)}#ktcap .pick b{display:block;font:600 16px/1.3 Georgia,serif;color:#2e1f0c}' +
    '#ktcap .pick span{display:block;margin-top:2px;font-size:13.5px;color:#6b5636;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#ktcap .full{margin:4px 0 0;padding:12px;border:1px solid rgba(59,42,20,.18);border-radius:10px;background:rgba(255,250,236,.55);white-space:pre-wrap;font-size:14.5px;color:#2e1f0c}' +
    '#ktcap .meta{margin-top:6px;font-size:12.5px;color:#7d6847}' +
    '#ktcap .go{display:block;box-sizing:border-box;width:100%;min-height:52px;margin-top:14px;border:9px solid transparent;border-image:url(' + ART + 'tile-l.webp) 22 fill / 9px stretch;background:none;color:#2a1a06;font:600 16px/34px system-ui;cursor:pointer}' +
    '#ktcap .row{display:flex;gap:8px;margin-top:8px}#ktcap .ink{flex:1;min-height:44px;border:1px solid rgba(59,42,20,.35);border-radius:8px;background:rgba(255,250,236,.5);color:#2e1f0c;font:600 14px system-ui;cursor:pointer}' +
    '#ktcap button:focus-visible{outline:2px solid #2e1f0c;outline-offset:2px}';
  function el(t, a, kids) { var e = document.createElement(t); for (var k in a || {}) { if (k === 'text') e.textContent = a[k]; else if (k.slice(0, 2) === 'on') e[k] = a[k]; else e.setAttribute(k, a[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); }); return e; }

  // pick(card) -> Promise of the chosen text, or null if they closed it
  window.KT_CAPTIONS = { list: CAPS, fill: fill, pick: function (card) {
    if (!document.getElementById('ktcap-css')) document.head.appendChild(el('style', { id: 'ktcap-css', text: css }));
    return new Promise(function (done) {
      var box, list = CAPS.filter(function (c) { return usable(c, card); });
      function close(v) { if (box) box.remove(); document.removeEventListener('keydown', esc); done(v); }
      function esc(e) { if (e.key === 'Escape') close(null); }
      function show(kids) {
        var sh = el('div', { class: 'sh', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ktcap-h', tabindex: '-1' },
          [el('button', { class: 'x', type: 'button', 'aria-label': 'Close', text: '×', onclick: function () { close(null); } })].concat(kids));
        if (box) box.remove();
        box = el('div', { id: 'ktcap' }, [sh]);
        box.addEventListener('click', function (e) { if (e.target === box) close(null); });
        document.body.appendChild(box); sh.style.outline = 'none'; sh.focus();
      }
      function home() {
        show([el('h2', { id: 'ktcap-h', text: 'Pick a caption' }), el('p', { class: 'sub', text: 'Your road to the mint, in your own numbers. You can edit it on X before posting.' })]
          .concat(list.map(function (c) { var t = fill(c.x, card);
            return el('button', { class: 'pick', type: 'button', onclick: function () { one(c); } }, [el('b', { text: c.t }), el('span', { text: t.replace(/\s*\n+\s*/g, ' ') })]); })));
      }
      function one(c) {
        var t = fill(c.x, card), copied = el('button', { class: 'ink', type: 'button', text: 'Copy text', onclick: function () {
          try { navigator.clipboard.writeText(t).then(function () { copied.textContent = 'Copied'; }); } catch (e) {} } });
        show([el('h2', { id: 'ktcap-h', text: c.t }), el('div', { class: 'full', text: t }),
          el('div', { class: 'meta', text: t.length + ' characters. Over 280 needs X Premium, or post it as two.' }),
          el('button', { class: 'go', type: 'button', text: 'Share with this caption', onclick: function () { close(t); } }),
          el('div', { class: 'row' }, [el('button', { class: 'ink', type: 'button', text: 'Back to all', onclick: home }), copied])]);
      }
      document.addEventListener('keydown', esc);
      home();
    });
  } };
})();
