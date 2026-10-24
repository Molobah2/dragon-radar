"""The Blinky and Pinky sticker shelf (v2.1): new poses of the two kit characters, drawn with permission for
community use, each as a clean die-cut sticker and one with a short word. Free to use in Pocket Dragons posts,
never for sale (Pocket Dragons Community Noncommercial Asset Licence)."""

# key, who, mood shown on the shelf, the word on the second version
STICKERS = [
    ("b-thumbs", "blinky", "Thumbs up", "Nice one"),
    ("b-gm", "blinky", "Good morning", "GM"),
    ("b-thanks", "blinky", "Thank you", "Thank you"),
    ("b-party", "blinky", "Congrats", "Congrats"),
    ("b-think", "blinky", "Thinking", "Hmm"),
    ("b-sad", "blinky", "Oh no", "Oh no"),
    ("p-heart", "pinky", "Love", "Love it"),
    ("p-jump", "pinky", "Hype", "LFG"),
    ("p-wave", "pinky", "Welcome", "Welcome"),
    ("p-sleepy", "pinky", "Good night", "GN"),
    ("p-laugh", "pinky", "Laughing", "LOL"),
    ("p-shy", "pinky", "Shy", "Aww"),
]
KEYS = {k for k, *_ in STICKERS}


def shelf() -> list[dict]:
    return [{"key": k, "who": who, "mood": mood, "word": word} for k, who, mood, word in STICKERS]
