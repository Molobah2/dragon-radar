"""Language packs. All translations live in one source file (i18n_src.js) so adding a line stays simple.
The browser gets only what it needs: a tiny loader for everyone (static/i18n.js), and for a visitor
reading in another language, one pack with the English source, that language and the code that swaps
the text. English readers download no translations at all."""
from pathlib import Path

SRC = Path(__file__).with_name("i18n_src.js")
LANGS = ("es", "fr", "pt", "tr", "ru", "vi", "id", "ko", "zh")


def _between(text: str, start: str, end: str) -> str:
    i = text.index(start) + len(start)
    return text[i:text.index(end, i)]


def build() -> dict[str, str]:
    src = SRC.read_text(encoding="utf-8")
    en = _between(src, "  const EN = {\n", "\n  };\n")
    runtime = _between(src, "  const L = T[lang];\n", "\n})();")
    packs = {}
    for lang in LANGS:
        body = _between(src, f"\n    {lang}: {{\n", "\n    },")
        packs[lang] = ("/* pdtools language pack: " + lang + " */\n(() => {\n  \"use strict\";\n"
                       "  const EN = {\n" + en + "\n  };\n"
                       "  const L = {\n" + body + "\n  };\n" + runtime + "\n})();\n")
    return packs
