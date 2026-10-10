"""Free text lookup for posts saved without text, using X's public oEmbed endpoint.

publish.twitter.com/oembed needs no API key and is not billed. It gives the author's
name, handle and the post text, but no profile picture.
"""
import html as htmlmod
import re

import requests

URL = "https://publish.twitter.com/oembed"


def fetch(post_id: str, session: requests.Session | None = None, timeout: int = 10) -> dict | None:
    """Returns {"name", "username", "text", "media"}; {} when the post is gone; None on a temporary error."""
    http = session or requests
    try:
        r = http.get(URL, params={"url": f"https://x.com/i/status/{post_id}", "omit_script": "true",
                                  "hide_thread": "true", "dnt": "true"}, timeout=timeout)
    except requests.RequestException:
        return None
    if r.status_code in (403, 404):
        return {}
    if r.status_code != 200:
        return None
    try:
        data = r.json()
    except ValueError:
        return None
    return parse(data)


def parse(data: dict) -> dict:
    raw = data.get("html", "")
    m = re.search(r"<p[^>]*>(.*?)</p>", raw, re.S)
    body = m.group(1) if m else ""
    media = "pic.twitter.com" in body or "pic.x.com" in body
    body = re.sub(r"<a[^>]*>(pic\.(twitter|x)\.com/\S*?)</a>", "", body)
    body = re.sub(r"<br\s*/?>", "\n", body)
    body = re.sub(r"<a[^>]*>(.*?)</a>", r"\1", body)
    body = re.sub(r"<[^>]+>", "", body)
    text = htmlmod.unescape(body).strip()
    username = (data.get("author_url") or "").rstrip("/").rsplit("/", 1)[-1] or None
    return {"name": data.get("author_name") or username, "username": username, "text": text, "media": media}
