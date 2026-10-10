"""Minimal X API v2 client: recent search and one user lookup. Read only."""
import requests

API = "https://api.x.com/2"


class XApiError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"X API returned {status}: {body[:300]}")
        self.status = status


class RateLimited(XApiError):
    pass


class XClient:
    def __init__(self, bearer_token: str, session: requests.Session | None = None, timeout: int = 20):
        if not bearer_token:
            raise ValueError("X_BEARER_TOKEN is not set")
        self.http = session or requests.Session()
        self.http.headers.update({"Authorization": f"Bearer {bearer_token}", "User-Agent": "dragon-radar/1.0"})
        self.timeout = timeout

    def _get(self, path: str, params: dict) -> dict:
        r = self.http.get(f"{API}{path}", params=params, timeout=self.timeout)
        if r.status_code == 429:
            raise RateLimited(r.status_code, r.text)
        if r.status_code >= 400:
            raise XApiError(r.status_code, r.text)
        return r.json()

    def search_recent(self, query: str, since_id: str | None = None, start_time: str | None = None,
                      next_token: str | None = None, max_results: int = 100) -> dict:
        # Author name, handle and avatar come along so the site can draw its own cards.
        params = {
            "query": query,
            "max_results": max(10, min(100, max_results)),
            "tweet.fields": "created_at,author_id,referenced_tweets,attachments,public_metrics",
            "expansions": "author_id",
            "user.fields": "name,username,profile_image_url",
        }
        if since_id:
            params["since_id"] = since_id
        elif start_time:
            params["start_time"] = start_time
        if next_token:
            params["next_token"] = next_token
        return self._get("/tweets/search/recent", params)

    def existing_ids(self, ids: list[str]) -> set[str]:
        """Which of these post ids still exist and are visible on X (max 100 per call)."""
        data = self._get("/tweets", {"ids": ",".join(ids), "tweet.fields": "id"})
        return {p["id"] for p in data.get("data", []) or []}

    def user_profile(self, username: str) -> dict | None:
        """Name, handle and picture for one account, or None if it does not exist."""
        try:
            data = self._get(f"/users/by/username/{username}", {"user.fields": "name,username,profile_image_url"})
        except XApiError as e:
            if e.status in (400, 404):
                return None
            raise
        return data.get("data")

    def user_id_for(self, username: str) -> str:
        data = self._get(f"/users/by/username/{username}", {})
        return data["data"]["id"]
