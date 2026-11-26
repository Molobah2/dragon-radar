"""Paying for a Keepers Trail card on chain (26 Nov 2026, Jon: $0.50 a card).

A Keeper sends the price to pdtools' wallet on one of the chains below, in USDC, USDT or the chain's own coin, then
gives pdtools the transaction. pdtools reads that transaction from the chain itself (public nodes, no keys, nothing paid)
and only makes the card when it really paid the wallet enough, recently, and has never been used for a card before.
Nothing about the Keeper's wallet is kept beyond the payment itself.
"""
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, utcnow

TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
ZK_COIN = "0x000000000000000000000000000000000000800a"    # Abstract (ZK stack): moving ETH also logs a Transfer here
BOOTLOADER = "0x0000000000000000000000000000000000008001"  # Abstract: gas refunds come from here, they are not payments

# Every token address below was checked on its own chain (symbol and decimals) on 26 Nov 2026.
CHAINS = {
    "base": {"name": "Base", "id": 8453, "rpc": ["https://mainnet.base.org", "https://base-rpc.publicnode.com"], "coin": "ETH", "confirm": 1,
             "scan": "https://basescan.org/tx/", "tokens": {"USDC": ("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6)}},
    "abstract": {"name": "Abstract", "id": 2741, "rpc": ["https://api.mainnet.abs.xyz"], "coin": "ETH", "confirm": 1, "scan": "https://abscan.org/tx/",
                 "tokens": {"USDC": ("0x84A71ccD554Cc1b02749b35d22F684CC8ec987e1", 6), "USDT": ("0x0709F39376dEEe2A2dfC94A58EdEb2Eb9DF012bD", 6)}},
    "arbitrum": {"name": "Arbitrum", "id": 42161, "rpc": ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"], "coin": "ETH",
                 "confirm": 1, "scan": "https://arbiscan.io/tx/",
                 "tokens": {"USDC": ("0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6), "USDT": ("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6)}},
    "optimism": {"name": "Optimism", "id": 10, "rpc": ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"], "coin": "ETH",
                 "confirm": 1, "scan": "https://optimistic.etherscan.io/tx/",
                 "tokens": {"USDC": ("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6), "USDT": ("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", 6)}},
    "polygon": {"name": "Polygon", "id": 137, "rpc": ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"], "coin": "POL",
                "confirm": 2, "scan": "https://polygonscan.com/tx/",
                "tokens": {"USDC": ("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6), "USDT": ("0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6)}},
    "bnb": {"name": "BNB Chain", "id": 56, "rpc": ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"], "coin": "BNB",
            "confirm": 2, "scan": "https://bscscan.com/tx/",
            "tokens": {"USDC": ("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18), "USDT": ("0x55d398326f99059fF775485246999027B3197955", 18)}},
    "ethereum": {"name": "Ethereum", "id": 1, "rpc": ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"], "coin": "ETH",
                 "confirm": 2, "scan": "https://etherscan.io/tx/",
                 "tokens": {"USDC": ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6), "USDT": ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6)}},
}
GECKO = {"ETH": "ethereum", "BNB": "binancecoin", "POL": "polygon-ecosystem-token"}
MAX_AGE = timedelta(days=3)       # a payment older than this does not count: send a new one
COIN_SLACK = 0.95                 # the coin's price can move between the quote and the payment
STABLE_SLACK = 0.99


class TrailPayment(Base):
    """One payment that made (or will make) one Trail card. The transaction is the key, so it can never pay twice."""
    __tablename__ = "trail_payments"
    tx: Mapped[str] = mapped_column(String(80), primary_key=True)            # "<chain>:<hash>"
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    username: Mapped[str] = mapped_column(String(32), default="")
    chain: Mapped[str] = mapped_column(String(16), default="")
    token: Mapped[str] = mapped_column(String(8), default="")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    usd: Mapped[float] = mapped_column(Float, default=0.0)
    payer: Mapped[str] = mapped_column(String(42), default="")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # the block's time
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PayError(Exception):
    """Something the Keeper can fix (wrong wallet, too little, not found yet). The message is shown to them."""
    def __init__(self, code: str, msg: str):
        super().__init__(msg)
        self.code = code


_prices: dict = {}
_plock = threading.Lock()


def prices(http: requests.Session) -> dict:
    """USD prices of ETH, BNB and POL, kept 5 minutes. CoinGecko first, Coinbase if it is down."""
    with _plock:
        if _prices.get("t", 0) > time.time() - 300 and _prices.get("p"):
            return dict(_prices["p"])
    out = {}
    try:
        r = http.get("https://api.coingecko.com/api/v3/simple/price", params={"ids": ",".join(GECKO.values()), "vs_currencies": "usd"}, timeout=8)
        j = r.json() if r.status_code == 200 else {}
        out = {c: float(j[g]["usd"]) for c, g in GECKO.items() if j.get(g, {}).get("usd")}
    except (requests.RequestException, ValueError, KeyError, TypeError):
        out = {}
    for c in GECKO:
        if c not in out:
            try:
                r = http.get(f"https://api.coinbase.com/v2/prices/{c}-USD/spot", timeout=8)
                out[c] = float(r.json()["data"]["amount"])
            except (requests.RequestException, ValueError, KeyError, TypeError):
                pass
    if out:
        with _plock:
            _prices.update(t=time.time(), p=out)
    return out or dict(_prices.get("p") or {})


def quote(http: requests.Session, price_usd: float) -> dict:
    """What to send on each chain: the stablecoin amount, and the coin amount at today's price (rounded up a little)."""
    p = prices(http)
    chains = []
    for key, c in CHAINS.items():
        coin_amt = None
        if p.get(c["coin"]):
            coin_amt = f"{(price_usd / p[c['coin']]) * 1.01:.6f}".rstrip("0").rstrip(".")
        chains.append({"key": key, "name": c["name"], "id": c["id"], "coin": c["coin"], "coinAmount": coin_amt,
                       "tokens": [{"sym": s, "address": a, "decimals": d} for s, (a, d) in c["tokens"].items()]})
    return {"price": f"{price_usd:.2f}", "chains": chains}


def _rpc(http, chain: str, method: str, params: list):
    last = None
    for url in CHAINS[chain]["rpc"]:
        try:
            r = http.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=12)
            j = r.json()
            if "error" in j:
                last = j["error"]
                continue
            return j.get("result")
        except (requests.RequestException, ValueError) as e:
            last = e
    raise PayError("node", "Could not reach that chain right now. Try again in a minute.") from (last if isinstance(last, Exception) else None)


def _addr(topic: str) -> str:
    return "0x" + topic[-40:].lower()


def verify(http: requests.Session, chain: str, tx_hash: str, wallet: str, price_usd: float, now: datetime | None = None) -> dict:
    """Reads one transaction from the chain and says what it paid the wallet. Raises PayError when it does not count."""
    if chain not in CHAINS:
        raise PayError("chain", "Pick the chain you paid on.")
    tx_hash = (tx_hash or "").strip()
    m = re.search(r"0x[0-9a-fA-F]{64}", tx_hash)
    if not m:
        raise PayError("hash", "That does not look like a transaction. Paste the transaction hash (it starts with 0x) or its explorer link.")
    tx_hash, wallet, c = m.group(0).lower(), wallet.lower(), CHAINS[chain]
    now = now or utcnow()
    rec = _rpc(http, chain, "eth_getTransactionReceipt", [tx_hash])
    if not rec:
        raise PayError("pending", f"That payment is not on {c['name']} yet. If you just sent it, wait a moment and try again. Check you picked the right chain.")
    if rec.get("status") != "0x1":
        raise PayError("failed", "That transaction failed on chain, so nothing was paid.")
    block = int(rec["blockNumber"], 16)
    head = int(_rpc(http, chain, "eth_blockNumber", []), 16)
    if head - block + 1 < c["confirm"]:
        raise PayError("pending", "Almost there. The payment needs one more block. Try again in a few seconds.")
    blk = _rpc(http, chain, "eth_getBlockByNumber", [hex(block), False]) or {}
    at = datetime.fromtimestamp(int(blk.get("timestamp", "0x0"), 16), tz=timezone.utc).replace(tzinfo=None)
    if now - at > MAX_AGE:
        raise PayError("old", "That payment is more than 3 days old. Send a new one for your card.")

    paid = {}            # token -> amount, to the wallet only
    payer = ""
    selfpay = False
    tokens = {a.lower(): (s, d) for s, (a, d) in c["tokens"].items()}
    for lg in rec.get("logs") or []:
        t = lg.get("topics") or []
        if len(t) < 3 or t[0].lower() != TRANSFER or _addr(t[2]) != wallet:
            continue
        if _addr(t[1]) in (wallet, BOOTLOADER):     # the wallet paying itself, or Abstract handing back unused gas: not a payment
            selfpay = selfpay or _addr(t[1]) == wallet
            continue
        a = (lg.get("address") or "").lower()
        if a in tokens:
            sym, dec = tokens[a]
        elif a == ZK_COIN and chain == "abstract":
            sym, dec = c["coin"], 18
        else:
            continue
        paid[sym] = paid.get(sym, 0.0) + int(lg.get("data") or "0x0", 16) / 10 ** dec
        payer = payer or _addr(t[1])
    if not paid:     # a plain coin payment from a normal wallet: the value rides on the transaction itself
        tx = _rpc(http, chain, "eth_getTransactionByHash", [tx_hash]) or {}
        if (tx.get("to") or "").lower() == wallet and (tx.get("from") or "").lower() != wallet and int(tx.get("value") or "0x0", 16) > 0:
            paid[c["coin"]] = int(tx["value"], 16) / 1e18
            payer = (tx.get("from") or "").lower()
    if not paid and (selfpay or (tx_from := (_rpc(http, chain, "eth_getTransactionByHash", [tx_hash]) or {}).get("from", "")).lower() == wallet):
        raise PayError("self", "That payment was sent from the pdtools wallet to itself, so it does not count. Pay from a different wallet.")
    if not paid:
        raise PayError("wallet", "That transaction did not pay the pdtools wallet. Check the address you sent to.")

    usd, best = 0.0, None
    p = None
    for sym, amt in paid.items():
        if sym in ("USDC", "USDT"):
            v = amt
            ok = amt >= price_usd * STABLE_SLACK
        else:
            p = p or prices(http)
            if not p.get(sym):
                raise PayError("price", f"Could not check the {sym} price right now. Try again in a minute.")
            v = amt * p[sym]
            ok = v >= price_usd * COIN_SLACK
        usd += v
        if ok and best is None:
            best = (sym, amt, v)
    if best is None:
        raise PayError("short", f"That payment was worth about ${usd:.2f}. A card is ${price_usd:.2f}.")
    sym, amt, v = best
    return {"tx": f"{chain}:{tx_hash}", "chain": chain, "token": sym, "amount": amt, "usd": round(v, 4), "payer": payer, "paid_at": at,
            "link": c["scan"] + tx_hash}
