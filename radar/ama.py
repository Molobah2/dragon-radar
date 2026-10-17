"""The AMA Library: every Pocket Dragons AMA in one place, newest first.

Ismail HA (@IsmailHA279) brought the idea to pdtools. Each entry links to the recording Sam Withers shared
on X, so the credit and the views stay with the team. The points come only from Jon's own reviewed recaps
of each call; everything said on a call is team stated and plans can change. Adding a new AMA is one entry.
"""
from datetime import date

AMAS = [
    {"n": 6, "day": date(2026, 10, 16), "post": "2111347128580653444", "live": 900,
     "title": "Badges, burning and honor",
     "points": [
         "900+ joined live, after the team cleared bots from Discord and X.",
         "The AMA badge now runs to five AMAs, with a new badge waiting at five out of five.",
         "A new Dragon Space badge for X Spaces is coming soon.",
         "Burning needs at least two dragons: you keep one, and the burn button will not burn a single dragon.",
         "Honor score is the dragons you own plus the badges you earn. Owned dragons give a higher quality badge than ones you held before.",
         "TJ said another speed update for the 3D Hatchery is coming soon.",
     ]},
    {"n": 5, "day": date(2026, 10, 9), "post": "2108889370434633957", "live": 1020,
     "title": "Burn odds, Godwin and pre-sale",
     "points": [
         "The room passed 1,000 live for the first time, and the stage was boosted to fit more Keepers.",
         "First look at burn odds with placeholder numbers: two greens give a guaranteed blue, and the odds always show before you burn.",
         "Godwin, the 3D animator behind Blinky, joined on camera and shared new Blinky animations.",
         "Pre-sale costs the same as mint with no discount, and the top spots on the Keeper Ledger get a guaranteed pre-sale spot.",
         "No wallet connection on the site yet, on purpose. The team will announce it before any wallet signing.",
     ]},
    {"n": 4, "day": date(2026, 10, 2), "post": "2106300916324573501", "live": 970,
     "title": "New badges and the pre-sale leak",
     "points": [
         "Two new badges announced: Ember Chamber and Community Keeper.",
         "The collection book explained: discovered badges stay with you, owned badges need the dragon in your wallet.",
         "Revenue split shared: 30% company, 30% NFT inventory, 20% rewards pool and 20% vault.",
         "The closing leak: the top spots on the Keeper Ledger earn pre-sale spots.",
     ]},
    {"n": 3, "day": date(2026, 9, 25), "post": "2103793637347717464", "live": 690,
     "title": "352 dragons and the collection",
     "points": [
         "16 species and 22 origins make 352 distinct dragons.",
         "Burning lifts a kept dragon's background from green up through blue, purple, gold and red, with a few one of ones at the top.",
         "A collection book awards badges for completing sets.",
         "Blinky Says, Referral and the AMA Attendee quest were explained in detail.",
     ]},
    {"n": 2, "day": date(2026, 9, 18), "post": "2101134496649404730", "live": 100,
     "title": "The economy",
     "points": [
         "Collectibles, badges and your onboarding card all feed one stat called Power.",
         "Five rarity tiers: green, blue, purple, gold and red.",
         "Burning lowers the supply, earns rewards and raises your Power.",
         "Revenue comes from mint funds, a 5% marketplace fee, animations and cosmetics, feeding a rewards pool and a vault.",
     ]},
    {"n": 1, "day": None, "post": "2099437949746360720", "live": 216,
     "title": "The first AMA",
     "points": [
         "Collectibles and badges carry a weight that matters before, during and after mint.",
         "The collection can be burned, so the supply only goes down.",
         "Collectify is a card pack idea planned for phase two.",
         "Weekly AMAs were confirmed as a regular thing.",
     ]},
]

def crowd(n):
    """Live counts are shown rounded down to the hundred with a plus, never as exact numbers: 216 shows as 200+."""
    return f"{n // 100 * 100:,}+" if n else ""


for a in AMAS:
    a["crowd"] = crowd(a["live"])
    a["url"] = f"https://x.com/djsamwithers/status/{a['post']}"
    a["label"] = a["day"].strftime("Friday, %B %-d") if a["day"] else "Recording shared September 14"

PEAK = max(a["live"] or 0 for a in AMAS)
PEAK_SHOWN = PEAK // 100 * 100
