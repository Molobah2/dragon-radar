"""Dragondle: five questions a day about Pocket Dragons lore, badges and pdtools, the same five for everyone.

Every question comes from something said in public (the Hatchery site, the official Discord, AMA calls Jon reviewed)
or from how pdtools itself works. Mint is never a topic: nothing about mint, pre-sale, whitelist, prices, supply or
the economy. Each entry keeps a short note on where the answer comes from so Jon can check the bank in one place.
"""
import random
from datetime import date

START = date(2026, 10, 24)          # Dragondle #1
PER_DAY = 5

# q: question, a: right answer, w: three wrong answers, why: one line shown after answering, src: where it comes from
BANK = [
    # ---------- badges and quests ----------
    {"cat": "badge", "q": "Which badge do you earn by adopting the Pocket Dragons server tag on Discord?", "a": "Standard Bearer",
     "w": ["Chronicler", "Shellbreaker", "Atmokinetic"], "why": "Open the server menu, pick Server Tag, adopt it, then claim the badge on the website.", "src": "Keeper Quests wave one; Jon's own guide"},
    {"cat": "badge", "q": "Which badge is earned by creating original Pocket Dragons content?", "a": "Chronicler",
     "w": ["Standard Bearer", "Blinky Says", "Ember Chamber"], "why": "The team reviews content and awards Chronicler in batches.", "src": "Keeper Quests wave one"},
    {"cat": "badge", "q": "For Chronicler, where do you share the link to your content so the team sees it?", "a": "The share content channel on Discord",
     "w": ["A DM to the official X account", "Your X bio", "The Keeper Ledger page"], "why": "That channel is the one place the team goes through for Chronicler.", "src": "Jon, verified directly (knowledge base Part 4)"},
    {"cat": "badge", "q": "The Shellbreaker hint tells you to play with what?", "a": "The egg on the website",
     "w": ["The weather icon", "The console buttons", "The leaderboard"], "why": "Click it, turn it, mess with it until something happens.", "src": "Wave one announcement"},
    {"cat": "badge", "q": "How do you earn Atmokinetic in the Hatchery?", "a": "Cycle through the weather",
     "w": ["Spin the egg ten times", "Press all three buttons together", "Stay on the page for an hour"], "why": "Use the weather icon at the top right, just left of the sound button.", "src": "Jon, earned it himself"},
    {"cat": "badge", "q": "Where should you look to check that the Hatchery weather really changed?", "a": "The window behind the egg",
     "w": ["The sound button", "The Keeper card", "The badge shelf"], "why": "Take your time between clicks so every change registers.", "src": "Jon, earned Atmokinetic himself"},
    {"cat": "badge", "q": "What kind of challenge is Blinky Says?", "a": "A rhythm and button sequence",
     "w": ["A word puzzle", "A racing game", "A quiz about dragons"], "why": "Watch the buttons, remember the rhythm and play it back.", "src": "Wave two; AMA 3"},
    {"cat": "badge", "q": "How many sequences do you play in Blinky Says?", "a": "5",
     "w": ["3", "7", "10"], "why": "The game shows Sequence 1 of 5 with a five dot tracker.", "src": "Jon, played it directly"},
    {"cat": "badge", "q": "Which keyboard keys can you use to play Blinky Says?", "a": "1, 2 and 3",
     "w": ["A, S and D", "Arrow keys", "Q, W and E"], "why": "You can also click, or tap on a phone.", "src": "TJ on AMA 3"},
    {"cat": "badge", "q": "Blinky Says was built after the community asked about what?", "a": "What the buttons were for",
     "w": ["How to hatch the egg", "When the next AMA was", "Who Blinky's friends were"], "why": "TJ built it straight from a community post about the buttons.", "src": "TJ on AMA 3"},
    {"cat": "badge", "q": "In Blinky Says, what happens after one wrong press?", "a": "It tells you the right note and lets you listen again",
     "w": ["You lose the badge for a day", "The game restarts from sequence 1 with no hint", "Nothing, you keep going"], "why": "The marks show the pattern, so nobody stays stuck.", "src": "Jon, played it directly"},
    {"cat": "badge", "q": "What is the Referral quest called on the website?", "a": "Bring 3 Keepers",
     "w": ["Invite a Friend", "Grow the Hatchery", "Keeper Link"], "why": "Your personal Keeper link is on the quest card.", "src": "Site Quests panel"},
    {"cat": "badge", "q": "Which badge rewards genuinely supporting other Keepers on X and Discord?", "a": "Community Keeper",
     "w": ["Chronicler", "Standard Bearer", "Early Supporter"], "why": "The team checks it by hand. Be real, be human.", "src": "AMA 4"},
    {"cat": "badge", "q": "Where does the Ember Chamber game play out?", "a": "Inside the incubator display",
     "w": ["On the Keeper Ledger", "In a Discord channel", "On X Spaces"], "why": "TJ built it after the community talked about the incubator display.", "src": "AMA 4"},
    {"cat": "badge", "q": "Which two badges could Keepers earn when onboarding first opened?", "a": "Early Supporter and Onboarding Complete",
     "w": ["Chronicler and Shellbreaker", "Blinky Says and Ember Chamber", "Standard Bearer and Referral"], "why": "The two badge window was open for the first 48 hours.", "src": "Onboarding, September 8"},
    {"cat": "badge", "q": "How long was the first two badge window open?", "a": "48 hours",
     "w": ["One week", "12 hours", "30 days"], "why": "After that, new Keepers earned one badge for onboarding.", "src": "TJ, direct chat"},
    {"cat": "badge", "q": "Who designed the 3D badge seals for the first Keeper Quests?", "a": "Godwin",
     "w": ["Hearty", "TJ", "Sam"], "why": "Each seal can be grabbed, thrown, spun or flipped.", "src": "TJ's tech update, September 16"},
    {"cat": "badge", "q": "Which badge seal shows three dragons with heart, message and laugh bubbles?", "a": "Community Keeper",
     "w": ["Ember Chamber", "Chronicler", "AMA Attendee"], "why": "It celebrates Keepers who support each other.", "src": "Sam's seal reveal on Discord"},
    {"cat": "badge", "q": "Which badge seal shows a dragon surrounded by fire orbs?", "a": "Ember Chamber",
     "w": ["Community Keeper", "Shellbreaker", "Standard Bearer"], "why": "Ember Chamber is the game inside the incubator display.", "src": "Sam's seal reveal on Discord"},
    {"cat": "badge", "q": "The Dragon Space badge is linked to what?", "a": "X Spaces",
     "w": ["Discord voice AMAs", "The Hatchery weather", "Posting art"], "why": "It was announced as coming soon on AMA 6.", "src": "AMA 6"},
    {"cat": "badge", "q": "How does the Keeper Ledger rank Keepers first?", "a": "By badge count",
     "w": ["By followers on X", "By when they joined Discord", "By how many posts they shared"], "why": "Ties go to whoever reached that count first.", "src": "TJ's tech update, September 16"},
    {"cat": "badge", "q": "For the two secret rite quests, how does the Quests page show your progress?", "a": "As a percentage",
     "w": ["As a count out of 3", "As a timer", "It shows nothing"], "why": "Check it now and then to see how close you are.", "src": "Jon, verified directly"},
    {"cat": "badge", "q": "Where is the AMA Attendee quest tracked?", "a": "Live in the Discord voice stage",
     "w": ["On X Spaces", "On a YouTube stream", "In the Hatchery chat"], "why": "A short disconnect and rejoin does not break it.", "src": "AMA 3"},
    # ---------- the Hatchery, the team and the dragons ----------
    {"cat": "lore", "q": "What colour is Blinky's belly?", "a": "Green",
     "w": ["Pink", "Blue", "Purple"], "why": "Yellow Blinky with orange spots and a green belly.", "src": "Creator Kit art"},
    {"cat": "lore", "q": "What shape are Pinky's eyes?", "a": "Hearts",
     "w": ["Stars", "Moons", "Diamonds"], "why": "Heart eyes and a bow on her head.", "src": "Creator Kit art"},
    {"cat": "lore", "q": "What does Pinky wear on her head?", "a": "A bow",
     "w": ["A crown", "A hat", "Headphones"], "why": "Look closely and the bow has a little heart.", "src": "Creator Kit art"},
    {"cat": "lore", "q": "Who is the founder of Pocket Dragons?", "a": "Sam Withers",
     "w": ["TJ", "Hearty", "Godwin"], "why": "Sam hosts the weekly AMAs.", "src": "Team page"},
    {"cat": "lore", "q": "What does TJ look after on the team?", "a": "Engineering",
     "w": ["Community", "3D art", "Music"], "why": "TJ builds the Hatchery and posts the tech updates.", "src": "Team page"},
    {"cat": "lore", "q": "What does Hearty look after on the team?", "a": "Community",
     "w": ["Engineering", "3D art", "Legal"], "why": "Hearty runs the AMA chat and tracks community support.", "src": "Team page"},
    {"cat": "lore", "q": "Godwin is known for what?", "a": "3D art and animating Blinky",
     "w": ["Writing the tech updates", "Running the Discord bot", "Hosting X Spaces"], "why": "He joined AMA 5 on camera and shared new Blinky animations.", "src": "Team page; AMA 5"},
    {"cat": "lore", "q": "Where do the weekly AMAs happen?", "a": "On Discord voice",
     "w": ["On YouTube", "On Twitch", "In the Hatchery"], "why": "The recordings are shared on X afterwards.", "src": "Every AMA so far"},
    {"cat": "lore", "q": "Which day of the week are the AMAs held?", "a": "Friday",
     "w": ["Monday", "Wednesday", "Sunday"], "why": "They have run every week since September.", "src": "AMA schedule"},
    {"cat": "lore", "q": "What is the official Pocket Dragons website?", "a": "pocketdragons.io",
     "w": ["pocketdragons.com", "pdtools.xyz", "dragons.gg"], "why": "pdtools is a separate community tool.", "src": "Official X bio"},
    {"cat": "lore", "q": "Pocket Dragons calls itself a new category of collectibles. What is it called?", "a": "CollectFi",
     "w": ["GameFi", "DragonFi", "PlayFi"], "why": "Digital collecting, game mechanics, progression and community in one world.", "src": "Official X bio; Discord FAQ"},
    {"cat": "lore", "q": "Which two accounts do you connect during onboarding?", "a": "X and Discord",
     "w": ["Instagram and TikTok", "Telegram and X", "Email and Discord"], "why": "Each Discord account pairs with only one X account.", "src": "Onboarding; TJ"},
    {"cat": "lore", "q": "What is the Keeper Ledger?", "a": "The badge leaderboard on the website",
     "w": ["A Discord bot", "A list of AMA recordings", "A dragon name generator"], "why": "Your Keeper card shows every seal you hold.", "src": "Official site"},
    {"cat": "lore", "q": "What are people in the Pocket Dragons community called?", "a": "Keepers",
     "w": ["Riders", "Hatchers", "Tamers"], "why": "Every new Keeper gets a Keeper card.", "src": "Official site"},
    {"cat": "lore", "q": "Which of these was named as a Pocket Dragons species on an AMA?", "a": "Jelly",
     "w": ["Pizza", "Cactus", "Cloudy"], "why": "Jelly, Space, Ice and Pink were named on AMA 3.", "src": "AMA 3"},
    {"cat": "lore", "q": "Origins are described as what?", "a": "Full outfits",
     "w": ["Single traits", "Background colours", "Sound effects"], "why": "A dragon gets one complete origin, never mixed parts.", "src": "AMA 3"},
    {"cat": "lore", "q": "Which origin was named as an example on AMA 3?", "a": "Farmer",
     "w": ["Pirate", "Knight", "Chef"], "why": "A Jelly in a Farmer origin was the example.", "src": "AMA 3"},
    {"cat": "lore", "q": "TJ compared the collection book to what?", "a": "A Pokedex",
     "w": ["A photo album", "A recipe book", "A diary"], "why": "Sam compared it to a deck of cards.", "src": "AMA 4"},
    {"cat": "lore", "q": "Which button sits just to the right of the weather icon in the Hatchery?", "a": "The sound button",
     "w": ["The share button", "The menu", "The Keeper card"], "why": "The weather icon is at the top right.", "src": "Jon, verified directly"},
    {"cat": "lore", "q": "Which AMA was the first to pass 1,000 Keepers live?", "a": "AMA 5",
     "w": ["AMA 2", "AMA 3", "AMA 1"], "why": "The stage was boosted to fit more Keepers.", "src": "AMA Library"},
    {"cat": "lore", "q": "On which AMA were Ember Chamber and Community Keeper announced?", "a": "AMA 4",
     "w": ["AMA 1", "AMA 2", "AMA 6"], "why": "Both went live the week after.", "src": "AMA Library"},
    {"cat": "lore", "q": "Which prefix do the Pocket Dragons Discord bot commands use?", "a": "!",
     "w": ["/", "?", "#"], "why": "Try !commands in dragon-chat to see them all.", "src": "Discord, October 5"},
    {"cat": "lore", "q": "In which Discord channel do the bot commands work?", "a": "dragon-chat",
     "w": ["announcements", "share-content", "general"], "why": "Typing !quests lists every quest.", "src": "Discord, October 5"},
    # ---------- pdtools ----------
    {"cat": "pdtools", "q": "On pdtools, how many posts from fellow Keepers make your daily goal?", "a": "20",
     "w": ["5", "10", "50"], "why": "Finish it to hatch an egg that day.", "src": "pdtools"},
    {"cat": "pdtools", "q": "How long do you spend on X before an open counts on pdtools?", "a": "8 seconds",
     "w": ["1 second", "1 minute", "5 minutes"], "why": "Real time on the post is what counts as support.", "src": "pdtools"},
    {"cat": "pdtools", "q": "How many dragon stickers can you collect on pdtools?", "a": "35",
     "w": ["16", "20", "352"], "why": "15 commons, 15 rare holos and 5 golden legends.", "src": "pdtools dragons"},
    {"cat": "pdtools", "q": "How many golden legend dragons are there on pdtools?", "a": "5",
     "w": ["1", "3", "10"], "why": "Ruby, Sapphire, Emerald, Amethyst and Diamond.", "src": "pdtools dragons"},
    {"cat": "pdtools", "q": "Which of these is a golden legend on pdtools?", "a": "Diamond",
     "w": ["Gold", "Silver", "Pearl"], "why": "The five legends are named after gems.", "src": "pdtools dragons"},
    {"cat": "pdtools", "q": "What goal streak does a rare holo dragon need on pdtools?", "a": "3 days",
     "w": ["1 day", "10 days", "30 days"], "why": "Golden legends need a 7 day goal streak.", "src": "pdtools dragons"},
    {"cat": "pdtools", "q": "What goal streak does a golden legend need on pdtools?", "a": "7 days",
     "w": ["3 days", "14 days", "30 days"], "why": "Rare holos need 3 days.", "src": "pdtools dragons"},
    {"cat": "pdtools", "q": "What do you need to use pdtools?", "a": "Nothing, no login and no wallet",
     "w": ["A wallet", "An X login", "A paid pass"], "why": "pdtools only shows public posts and links you to X.", "src": "pdtools"},
    {"cat": "pdtools", "q": "How do you sign Blinky's Book of Friends?", "a": "Prove your X name with one post",
     "w": ["Connect a wallet", "Pay a small fee", "Send an email"], "why": "A short code in one post shows the name is yours.", "src": "pdtools"},
    {"cat": "pdtools", "q": "When does the My week card open on pdtools?", "a": "Every Friday from 00:00 UTC",
     "w": ["Every Monday", "On the first day of the month", "Only after an AMA"], "why": "It stays open for the whole day.", "src": "pdtools"},
    {"cat": "pdtools", "q": "How many opens a day count on one device on pdtools?", "a": "50",
     "w": ["10", "20", "100"], "why": "Your opens still show on each post, and they count again after midnight UTC.", "src": "pdtools"},
    {"cat": "pdtools", "q": "In the Dragon Circle, how do replies and quote posts count?", "a": "Twice",
     "w": ["Half", "The same as a tag", "Not at all"], "why": "They take more time than a tag.", "src": "pdtools Dragon Circle"},
    {"cat": "pdtools", "q": "Whose idea was the AMA Library on pdtools?", "a": "Ismail",
     "w": ["Sam", "Hearty", "Nacho"], "why": "Thank you Ismail for helping bring it to pdtools.", "src": "pdtools AMA Library"},
    {"cat": "pdtools", "q": "Who made the community song Pocket Full of Dragons?", "a": "Nacho",
     "w": ["Ismail HA", "Anastasiya", "The Panda"], "why": "It joined the pdtools playlist in October.", "src": "pdtools playlist"},
]

# a test checks that none of these words appear anywhere in the bank
MINT_WORDS = ("mint", "pre-sale", "presale", "whitelist", "price", "supply", "auction", "raffle", "burn", "reserve", "vault", "eth")


def number(day: date) -> int:
    return (day - START).days + 1


from functools import lru_cache


def _mix(order: list[int]) -> list[int]:
    """Interleave the kinds (badges, lore, pdtools) so a day is never five of the same."""
    kinds = {}
    for i in order:
        kinds.setdefault(BANK[i]["cat"], []).append(i)
    out = []
    while any(kinds.values()):
        for k in ("badge", "lore", "pdtools"):
            if kinds.get(k):
                out.append(kinds[k].pop())
    return out


@lru_cache(maxsize=64)
def _cycle(c: int) -> tuple:
    """One pass through the whole bank. A new pass never opens with the questions the last pass ended on,
    so nothing comes back within six days."""
    order = list(range(len(BANK)))
    random.Random(f"dragondle-{c}").shuffle(order)
    order = _mix(order)
    if c > 0:
        keep_apart = len(BANK) // 2        # half the bank: at least six days between repeats
        recent = set(_cycle(c - 1)[-keep_apart:])
        head = [i for i in order if i not in recent][:keep_apart]
        order = head + [i for i in order if i not in head]
    return tuple(order)


@lru_cache(maxsize=1)
def _translations() -> dict:
    """The bank in the other 9 site languages, item for item in BANK order (radar/dragondle_tr.json)."""
    import json
    from pathlib import Path
    try:
        data = json.loads((Path(__file__).parent / "dragondle_tr.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {lang: rows for lang, rows in data.items() if isinstance(rows, list) and len(rows) == len(BANK)}


def today_set(day: date) -> dict:
    """The five questions for a day, the same for everyone. The bank is a multiple of five, so every pass
    through it lines up with whole days and no question comes back until the whole bank has been asked."""
    n = number(day)
    out = []
    for j in range(PER_DAY):
        pos = max(0, n - 1) * PER_DAY + j
        k = _cycle(pos // len(BANK))[pos % len(BANK)]
        e = BANK[k]
        order = list(range(4))                       # 0 is the answer, 1 to 3 the wrong choices
        random.Random(f"dragondle-{n}-{j}").shuffle(order)
        en = [e["a"]] + list(e["w"])
        tr = {}
        for lang, rows in _translations().items():
            t = rows[k]
            words = [t["a"]] + list(t["w"])
            tr[lang] = {"q": t["q"], "opts": [words[i] for i in order], "why": t["why"]}
        out.append({"q": e["q"], "opts": [en[i] for i in order], "a": order.index(0), "why": e["why"], "cat": e["cat"], "tr": tr})
    return {"n": n, "day": day.isoformat(), "qs": out}


def day_of(n: int) -> date:
    from datetime import timedelta
    return START + timedelta(days=n - 1)
