/* Keepers Trail: paying for a card on chain (26 Nov 2026, Jon: $0.50 a card, in USDC, USDT or the chain's own coin).
   Opens over the Hatchery when the card is not paid for yet. With a wallet in the browser it sends the payment itself;
   otherwise the Keeper sends it from any wallet and pastes the transaction. pdtools checks it on chain either way. */
(function () {
  if (window.KT_PAY) return;
  var L = function (k, d) { var v = window.KT_L ? window.KT_L(k) : d; return v && v !== k ? v : d; };
  var Q = null, chain = null, token = null, busy = false, box = null;
  var css = '#ktpay{position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(6,4,2,.62);font:15px/1.4 system-ui,sans-serif;color:#f6ead0}' +
    '#ktpay .sh{width:100%;max-width:460px;max-height:92svh;overflow:auto;box-sizing:border-box;padding:22px max(16px,env(safe-area-inset-left)) calc(20px + env(safe-area-inset-bottom));background:linear-gradient(#2a1d0e,#170f07);border:1px solid #6d5313;border-bottom:0;border-radius:18px 18px 0 0;box-shadow:0 -12px 40px rgba(0,0,0,.5)}' +
    '@media (min-width:600px){#ktpay{align-items:center}#ktpay .sh{border-radius:18px;border-bottom:1px solid #6d5313}}' +
    '#ktpay h2{margin:0 0 4px;font:800 22px/1.2 Georgia,serif;color:#ffd98a}#ktpay p{margin:0 0 14px;color:#d9c7a3}' +
    '#ktpay .lb{margin:14px 0 6px;font-weight:700;font-size:13px;color:#c9b27f}' +
    '#ktpay .row{display:flex;flex-wrap:wrap;gap:8px}#ktpay .ch{min-height:40px;padding:0 14px;border-radius:20px;border:1px solid #6d5313;background:#21170b;color:#f6ead0;font:600 14px system-ui;cursor:pointer}' +
    '#ktpay .ch[aria-pressed=true]{background:#ffd98a;color:#241604;border-color:#ffd98a}' +
    '#ktpay .amt{margin:16px 0 4px;font:800 28px/1.1 system-ui;color:#fff3d6}#ktpay .usd{color:#c9b27f;font-size:13px}' +
    '#ktpay .addr{display:flex;gap:8px;align-items:center;margin-top:6px}#ktpay code{flex:1;min-width:0;overflow-wrap:anywhere;padding:10px;border-radius:10px;background:#0f0a04;border:1px solid #3d2e12;font:13px ui-monospace,monospace;color:#f6ead0}' +
    '#ktpay button.go,#ktpay a.go{display:block;width:100%;min-height:48px;margin-top:14px;border:0;border-radius:12px;background:#ffd98a;color:#241604;font:800 16px system-ui;cursor:pointer;text-align:center;line-height:48px;text-decoration:none}' +
    '#ktpay button.alt{min-height:40px;padding:0 14px;border-radius:10px;border:1px solid #6d5313;background:transparent;color:#ffd98a;font:700 14px system-ui;cursor:pointer}' +
    '#ktpay input{width:100%;box-sizing:border-box;min-height:46px;padding:0 12px;border-radius:10px;border:1px solid #6d5313;background:#0f0a04;color:#f6ead0;font:14px ui-monospace,monospace}' +
    '#ktpay .msg{min-height:20px;margin-top:12px;font-weight:600}#ktpay .msg.bad{color:#ff9b7a}#ktpay .msg.ok{color:#a8e6a1}' +
    '#ktpay .x{float:right;width:40px;height:40px;margin:-8px -6px 0 0;border:0;background:none;color:#c9b27f;font-size:26px;cursor:pointer}' +
    '#ktpay .note{margin-top:10px;font-size:12.5px;color:#a9966f}#ktpay button:disabled{opacity:.55;cursor:default}';
  function el(t, a, kids) { var e = document.createElement(t); for (var k in a || {}) { if (k === 'text') e.textContent = a[k]; else if (k.slice(0, 2) === 'on') e[k] = a[k]; else e.setAttribute(k, a[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); }); return e; }
  function say(t, kind) { var m = box && box.querySelector('.msg'); if (m) { m.textContent = t || ''; m.className = 'msg' + (kind ? ' ' + kind : ''); } }
  function cur() { var c = Q.chains.filter(function (x) { return x.key === chain; })[0]; return c; }
  function choice() { var c = cur(); var t = c.tokens.filter(function (x) { return x.sym === token; })[0];
    return t ? { sym: t.sym, amount: Q.price, address: t.address, decimals: t.decimals } : { sym: c.coin, amount: c.coinAmount, native: true }; }
  function units(amount, dec) { var p = String(amount).split('.'), f = (p[1] || '').slice(0, dec); while (f.length < dec) f += '0';
    return BigInt(p[0] + f); }

  function draw() {
    var c = cur(), ch = choice();
    var chains = el('div', { class: 'row', role: 'group', 'aria-label': 'Chain' }, Q.chains.map(function (x) {
      return el('button', { class: 'ch', type: 'button', 'aria-pressed': String(x.key === chain), text: x.name, onclick: function () { chain = x.key; if (!pick()) token = 'USDC'; draw(); } }); }));
    function pick() { return cur().tokens.some(function (t) { return t.sym === token; }) || token === cur().coin; }
    var opts = c.tokens.map(function (t) { return t.sym; }); if (c.coinAmount) opts.push(c.coin);
    var coins = el('div', { class: 'row', role: 'group', 'aria-label': 'Coin' }, opts.map(function (s) {
      return el('button', { class: 'ch', type: 'button', 'aria-pressed': String(s === token), text: s, onclick: function () { token = s; draw(); } }); }));
    var copy = el('button', { class: 'alt', type: 'button', text: L('payCopy', 'Copy'), onclick: function () {
      try { navigator.clipboard.writeText(Q.wallet).then(function () { copy.textContent = L('payCopied', 'Copied'); }); } catch (e) {} } });
    var wallet = window.ethereum ? el('button', { class: 'go', type: 'button', text: L('payWallet', 'Pay with my wallet'), onclick: send }) : null;
    var deep = null;
    if (!window.ethereum && /Android|iPhone|iPad/i.test(navigator.userAgent)) {   // phones without a wallet browser: hand the payment to a wallet app
      var link = ch.native ? 'ethereum:' + Q.wallet + '@' + c.id + '?value=' + units(ch.amount, 18).toString()
        : 'ethereum:' + ch.address + '@' + c.id + '/transfer?address=' + Q.wallet + '&uint256=' + units(ch.amount, ch.decimals).toString();
      deep = el('a', { class: 'go', href: link, text: L('payApp', 'Open my wallet app') });
    }
    var inp = el('input', { id: 'ktpay-tx', placeholder: L('payPaste', 'Transaction hash or explorer link'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'text' });
    var check = el('button', { class: 'go', type: 'button', text: L('payCheck', 'Check my payment'), onclick: function () { submit(inp.value); } });
    var sh = el('div', { class: 'sh', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ktpay-h' }, [
      el('button', { class: 'x', type: 'button', 'aria-label': L('payClose', 'Close'), text: '×', onclick: close }),
      el('h2', { id: 'ktpay-h', text: L('payTitle', 'Your card is $' + Q.price) }),
      el('p', { text: L('paySub', 'Pay once on chain and your card is made from your posts right away.') }),
      el('div', { class: 'lb', text: L('payChain', 'Chain') }), chains,
      el('div', { class: 'lb', text: L('payCoin', 'Pay with') }), coins,
      el('div', { class: 'amt', text: ch.amount + ' ' + ch.sym }),
      el('div', { class: 'usd', text: ch.native ? L('payAbout', 'About $' + Q.price + ' at today’s price') : '$' + Q.price }),
      el('div', { class: 'lb', text: L('payTo', 'Send to the pdtools wallet on ') + c.name }),
      el('div', { class: 'addr' }, [el('code', { text: Q.wallet }), copy]),
      wallet, deep,
      el('div', { class: 'lb', text: L('payDone', 'Already sent it?') }), inp, check,
      el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' }),
      chain === 'ethereum' ? el('div', { class: 'note', text: L('payGas', 'Fees on Ethereum can cost more than the card. Base, Abstract or Arbitrum cost a fraction of a cent.') }) : null,
      el('div', { class: 'note', text: L('payNote', 'Send from a wallet you control. Each payment makes one card, for the X account signed in here.') })
    ]);
    if (box) box.remove();
    box = el('div', { id: 'ktpay' }, [sh]);
    box.addEventListener('click', function (e) { if (e.target === box && !busy) close(); });
    document.body.appendChild(box);
  }

  function submit(tx, tries) {
    tx = String(tx || '').trim(); if (!tx) { say(L('payNeed', 'Paste the transaction first.'), 'bad'); return; }
    busy = true; say(L('payChecking', 'Checking the payment on chain'));
    box.querySelectorAll('button.go').forEach(function (b) { b.disabled = true; });
    fetch('/api/trail/pay', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chain: chain, tx: tx }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j.ok) { say(L('payOk', 'Paid. Making your card now.'), 'ok'); setTimeout(function () { close(true); if (window.KT_TRAIL_RECHECK) window.KT_TRAIL_RECHECK(); }, 900); return; }
        if ((j.why === 'pending' || j.why === 'node') && (tries || 0) < 20) { say(j.msg || L('payWait', 'Waiting for the chain')); setTimeout(function () { submit(tx, (tries || 0) + 1); }, 4000); return; }
        busy = false; say(j.msg || L('payFail', 'Could not check that payment. Try again.'), 'bad');
        box.querySelectorAll('button.go').forEach(function (b) { b.disabled = false; });
      }).catch(function () { busy = false; say(L('payFail', 'Could not check that payment. Try again.'), 'bad'); box.querySelectorAll('button.go').forEach(function (b) { b.disabled = false; }); });
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
    var go = function () { draw(); document.addEventListener('keydown', esc); var f = box.querySelector('button.ch[aria-pressed=true]'); if (f) f.focus(); };
    if (Q) return go();
    fetch('/api/trail/pay/quote', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      Q = j; chain = 'base'; token = 'USDC'; go(); }).catch(function () { alertLess(); });
  } };
  function alertLess() { var m = el('div', { id: 'ktpay' }, [el('div', { class: 'sh' }, [el('h2', { text: L('payTitle', 'Your card') }),
    el('p', { text: L('payDown', 'Payments could not load. Check your connection and try again.') }), el('button', { class: 'go', type: 'button', text: L('payClose', 'Close'), onclick: function () { m.remove(); } })])]);
    document.body.appendChild(m); }
})();
