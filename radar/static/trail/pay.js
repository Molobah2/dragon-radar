/* Keepers Trail: paying for a card on chain (26 Nov 2026, Jon: $0.50 a card, in USDC, USDT or the chain's own coin).
   Opens over the Hatchery when the card is not paid for yet. With a wallet in the browser it sends the payment itself;
   otherwise the Keeper sends it from any wallet and pastes the transaction. pdtools checks it on chain either way. */
(function () {
  if (window.KT_PAY) return;
  var L = function (k, d) { var v = window.KT_L ? window.KT_L(k) : d; return v && v !== k ? v : d; };
  var Q = null, chain = null, token = null, busy = false, box = null;
  var ART = '/static/v3/art/';
  var css = '#ktpay{position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(14,9,4,.58);font:15px/1.45 system-ui,sans-serif;color:#3b2a14;-webkit-tap-highlight-color:transparent}' +
    '#ktpay .sh{position:relative;width:100%;max-width:440px;max-height:94svh;overflow-x:hidden;overflow-y:auto;box-sizing:border-box;padding:12px 8px calc(8px + env(safe-area-inset-bottom));border:22px solid transparent;border-image:url(' + ART + 'card-l.webp) 90 fill / 22px stretch;filter:drop-shadow(0 -8px 28px rgba(0,0,0,.45));animation:ktpin .28s cubic-bezier(.2,.8,.2,1)}' +
    '@keyframes ktpin{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){#ktpay .sh{animation:none}}' +
    '@media (min-width:600px){#ktpay{align-items:center}}' +
    '#ktpay .hd{display:flex;gap:12px;align-items:center;padding-right:32px}#ktpay .coin{width:56px;height:56px;flex:none;filter:drop-shadow(0 3px 4px rgba(60,40,10,.35))}' +
    '#ktpay h2{margin:0;font:600 22px/1.2 Georgia,"Times New Roman",serif;color:#2e1f0c}#ktpay .sub{margin:2px 0 0;font-size:14px;color:#6b5636}' +
    '#ktpay .x{position:absolute;top:0;right:0;width:40px;height:40px;border:0;background:none;color:#6b5636;font-size:24px;line-height:40px;cursor:pointer;border-radius:8px}' +
    '#ktpay .lb{margin:20px 0 4px;font-size:13px;font-weight:600;color:#6b5636}' +
    '#ktpay .tabs{display:flex;flex-wrap:wrap;gap:0 4px;margin:0 -10px}' +
    '#ktpay .tab{flex:none;min-height:40px;padding:0 10px;border:0;border-bottom:2px solid transparent;background:none;color:#6b5636;font:500 15px system-ui;cursor:pointer;transition:color .15s,border-color .15s}' +
    '#ktpay .tab[aria-pressed=true]{color:#2e1f0c;border-bottom-color:#8a5a14;font-weight:600}#ktpay .tab:hover{color:#2e1f0c}' +
    '#ktpay .due{margin-top:16px;padding:12px 0 0;border-top:1px solid rgba(59,42,20,.16)}' +
    '#ktpay .amt{font:600 30px/1.1 Georgia,serif;color:#2e1f0c;font-variant-numeric:tabular-nums}#ktpay .amt small{margin-left:6px;font:500 14px system-ui;color:#6b5636}' +
    '#ktpay .to{display:flex;gap:8px;align-items:baseline;margin-top:8px;font-size:13px;color:#6b5636}#ktpay .to code{flex:1;min-width:0;overflow-wrap:anywhere;font:13px/1.4 ui-monospace,Menlo,monospace;color:#3b2a14}' +
    '#ktpay .link{flex:none;min-height:32px;padding:0 4px;border:0;background:none;color:#8a5a14;font:600 13px system-ui;text-decoration:underline;text-underline-offset:3px;cursor:pointer}' +
    '#ktpay .go{display:block;box-sizing:border-box;width:100%;min-height:52px;margin-top:16px;border:9px solid transparent;border-image:url(' + ART + 'tile-l.webp) 22 fill / 9px stretch;background:none;color:#2a1a06;font:600 16px/34px system-ui;text-align:center;text-decoration:none;cursor:pointer;transition:filter .15s,transform .1s}' +
    '#ktpay .go:hover{filter:brightness(1.06)}#ktpay .go:active{transform:scale(.98)}' +
    '#ktpay .tear{margin:24px -30px 0;border-top:2px dashed rgba(59,42,20,.28)}' +
    '#ktpay .chk{display:flex;gap:8px;margin-top:8px}#ktpay input{flex:1;min-width:0;min-height:44px;padding:0 4px;border:0;border-bottom:1px solid rgba(59,42,20,.4);border-radius:0;background:none;color:#2e1f0c;font:14px ui-monospace,Menlo,monospace}' +
    '#ktpay input::placeholder{color:#9a8462}#ktpay input:focus{outline:none;border-bottom-color:#8a5a14}' +
    '#ktpay .ink{flex:none;min-height:44px;padding:0 14px;border:1px solid rgba(59,42,20,.35);border-radius:8px;background:rgba(255,250,236,.5);color:#2e1f0c;font:600 14px system-ui;cursor:pointer;transition:background-color .15s}#ktpay .ink:hover{background:rgba(255,250,236,.9)}' +
    '#ktpay .msg{min-height:20px;margin-top:10px;font-size:14px;font-weight:600;color:#3b2a14}#ktpay .msg.bad{color:#9b2c1f}#ktpay .msg.ok{color:#3f6b3a}' +
    '#ktpay .note{margin-top:8px;font-size:12.5px;color:#7d6847}#ktpay button:disabled{opacity:.55;cursor:default}' +
    '#ktpay button:focus-visible,#ktpay a:focus-visible{outline:2px solid #2e1f0c;outline-offset:2px}';
  function el(t, a, kids) { var e = document.createElement(t); for (var k in a || {}) { if (k === 'text') e.textContent = a[k]; else if (k.slice(0, 2) === 'on') e[k] = a[k]; else e.setAttribute(k, a[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); }); return e; }
  function say(t, kind) { var m = box && box.querySelector('.msg'); if (m) { m.textContent = t || ''; m.className = 'msg' + (kind ? ' ' + kind : ''); if (t && m.scrollIntoView) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  function cur() { var c = Q.chains.filter(function (x) { return x.key === chain; })[0]; return c; }
  function choice() { var c = cur(); var t = c.tokens.filter(function (x) { return x.sym === token; })[0];
    return t ? { sym: t.sym, amount: Q.price, address: t.address, decimals: t.decimals } : { sym: c.coin, amount: c.coinAmount, native: true }; }
  function units(amount, dec) { var p = String(amount).split('.'), f = (p[1] || '').slice(0, dec); while (f.length < dec) f += '0';
    return BigInt(p[0] + f); }

  function draw() {
    var c = cur(), ch = choice();
    function pick() { return cur().tokens.some(function (t) { return t.sym === token; }) || token === cur().coin; }
    var chains = el('div', { class: 'tabs', role: 'group', 'aria-label': L('payChain', 'Chain') }, Q.chains.map(function (x) {
      return el('button', { class: 'tab', type: 'button', 'aria-pressed': String(x.key === chain), text: x.name, onclick: function () { chain = x.key; if (!pick()) token = 'USDC'; draw(); } }); }));
    var opts = c.tokens.map(function (t) { return t.sym; }); if (c.coinAmount) opts.push(c.coin);
    var coins = el('div', { class: 'tabs', role: 'group', 'aria-label': L('payCoin', 'Pay with') }, opts.map(function (s) {
      return el('button', { class: 'tab', type: 'button', 'aria-pressed': String(s === token), text: s, onclick: function () { token = s; draw(); } }); }));
    var copy = el('button', { class: 'link', type: 'button', text: L('payCopy', 'Copy'), onclick: function () {
      try { navigator.clipboard.writeText(Q.wallet).then(function () { copy.textContent = L('payCopied', 'Copied'); }); } catch (e) {} } });
    var main = null;
    if (window.ethereum) main = el('button', { class: 'go', type: 'button', text: L('payWallet', 'Pay with my wallet'), onclick: send });
    else if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {   // phones without a wallet browser: hand the payment to a wallet app
      var link = ch.native ? 'ethereum:' + Q.wallet + '@' + c.id + '?value=' + units(ch.amount, 18).toString()
        : 'ethereum:' + ch.address + '@' + c.id + '/transfer?address=' + Q.wallet + '&uint256=' + units(ch.amount, ch.decimals).toString();
      main = el('a', { class: 'go', href: link, text: L('payApp', 'Open my wallet app') });
    }
    var inp = el('input', { id: 'ktpay-tx', placeholder: L('payPaste', 'Transaction hash or link'), 'aria-label': L('payPaste', 'Transaction hash or link'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    var check = el('button', { class: 'ink', type: 'button', text: L('payCheck', 'Check'), onclick: function () { submit(inp.value); } });
    var sh = el('div', { class: 'sh', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ktpay-h' }, [
      el('button', { class: 'x', type: 'button', 'aria-label': L('payClose', 'Close'), text: '×', onclick: close }),
      el('div', { class: 'hd' }, [el('img', { class: 'coin', src: ART + 'coin-s.webp', alt: '', width: '56', height: '56' }),
        el('div', {}, [el('h2', { id: 'ktpay-h', text: L('payTitle', 'Your card is $' + Q.price) }),
          el('p', { class: 'sub', text: L('paySub', 'Pay once and your card is made from your posts straight after') })])]),
      el('div', { class: 'lb', text: L('payChain', 'Chain') }), chains,
      el('div', { class: 'lb', text: L('payCoin', 'Pay with') }), coins,
      el('div', { class: 'due' }, [
        el('div', { class: 'amt' }, [document.createTextNode(ch.amount + ' ' + ch.sym), el('small', { text: ch.native ? L('payAbout', 'about $' + Q.price) : L('payOn', 'on ') + c.name })]),
        el('div', { class: 'to' }, [document.createTextNode(L('payToShort', 'To')), el('code', { text: '0x' + Q.wallet.slice(2).match(/.{1,4}/g).join('\u2009') }), copy])]),
      main,
      el('div', { class: 'tear', 'aria-hidden': 'true' }),
      el('div', { class: 'lb', text: L('payDone', 'Already sent it?') }),
      el('div', { class: 'chk' }, [inp, check]),
      el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' }),
      chain === 'ethereum' ? el('div', { class: 'note', text: L('payGas', 'Fees on Ethereum can cost more than the card. Base, Abstract and Arbitrum cost a fraction of a cent.') }) : null,
      el('div', { class: 'note', text: L('payNote', 'One payment makes one card, for the X account signed in here.') })
    ]);
    if (box) box.remove();
    box = el('div', { id: 'ktpay' }, [sh]);
    box.addEventListener('click', function (e) { if (e.target === box && !busy) close(); });
    document.body.appendChild(box);
  }

  function submit(tx, tries) {
    tx = String(tx || '').trim(); if (!tx) { say(L('payNeed', 'Paste the transaction first.'), 'bad'); return; }
    busy = true; say(L('payChecking', 'Checking the payment on chain'));
    box.querySelectorAll('.go,.ink').forEach(function (b) { b.disabled = true; });
    fetch('/api/trail/pay', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chain: chain, tx: tx }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j.ok) { say(L('payOk', 'Paid. Making your card now.'), 'ok'); setTimeout(function () { close(true); if (window.KT_TRAIL_RECHECK) window.KT_TRAIL_RECHECK(); }, 900); return; }
        if ((j.why === 'pending' || j.why === 'node') && (tries || 0) < 20) { say(j.msg || L('payWait', 'Waiting for the chain')); setTimeout(function () { submit(tx, (tries || 0) + 1); }, 4000); return; }
        busy = false; say(j.msg || L('payFail', 'Could not check that payment. Try again.'), 'bad');
        box.querySelectorAll('.go,.ink').forEach(function (b) { b.disabled = false; });
      }).catch(function () { busy = false; say(L('payFail', 'Could not check that payment. Try again.'), 'bad'); box.querySelectorAll('.go,.ink').forEach(function (b) { b.disabled = false; }); });
  }

  function send() {
    var eth = window.ethereum, c = cur(), ch = choice(), from;
    if (!eth || busy) return;
    busy = true; say(L('payOpening', 'Opening your wallet'));
    eth.request({ method: 'eth_requestAccounts' }).then(function (a) { from = a[0];
      return eth.request({ method: 'eth_chainId' }); }).then(function (id) {
      if (parseInt(id, 16) === c.id) return null;
      return eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + c.id.toString(16) }] });
    }).then(function () {
      var tx = ch.native ? { from: from, to: Q.wallet, value: '0x' + units(ch.amount, 18).toString(16) }
        : { from: from, to: ch.address, data: '0xa9059cbb' + Q.wallet.slice(2).toLowerCase().padStart(64, '0') + units(ch.amount, ch.decimals).toString(16).padStart(64, '0') };
      say(L('payConfirm', 'Confirm the payment in your wallet'));
      return eth.request({ method: 'eth_sendTransaction', params: [tx] });
    }).then(function (hash) { var i = document.getElementById('ktpay-tx'); if (i) i.value = hash; busy = false; submit(hash); })
      .catch(function (e) { busy = false;
        say(e && e.code === 4001 ? L('payCancel', 'Payment cancelled. Nothing was sent.') : e && (e.code === 4902 || /chain/i.test(e.message || '')) ? L('paySwitch', 'Switch your wallet to ' + c.name + ' and try again.') : L('payWErr', 'Your wallet could not send it. You can send it yourself and paste the transaction.'), 'bad'); });
  }

  function close(done) { if (busy && !done) return; busy = false; if (box) box.remove(); box = null; document.removeEventListener('keydown', esc); }
  function esc(e) { if (e.key === 'Escape') close(); }

  window.KT_PAY = { open: function () {
    if (!document.getElementById('ktpay-css')) document.head.appendChild(el('style', { id: 'ktpay-css', text: css }));
    var go = function () { draw(); document.addEventListener('keydown', esc); var d = box.querySelector('.sh'); d.tabIndex = -1; d.style.outline = 'none'; d.focus(); };
    if (Q) return go();
    fetch('/api/trail/pay/quote', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      Q = j; chain = 'base'; token = 'USDC'; go(); }).catch(function () { alertLess(); });
  } };
  function alertLess() { var m = el('div', { id: 'ktpay' }, [el('div', { class: 'sh' }, [el('h2', { text: L('payTitle', 'Your card') }),
    el('p', { text: L('payDown', 'Payments could not load. Check your connection and try again.') }), el('button', { class: 'go', type: 'button', text: L('payClose', 'Close'), onclick: function () { m.remove(); } })])]);
    document.body.appendChild(m); }
})();
