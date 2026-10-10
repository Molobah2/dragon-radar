# Dragon Radar

An unofficial community feed of every X post that tags @Pocket_Dragons_.
Tap a post, it opens on X and leaves your list. No sign in, no points, no tracking of what people do on X.

## How it works

- `radar/collector.py` runs every 20 minutes. It calls X's recent search for
  `((@Pocket_Dragons_ is:verified) OR from:Pocket_Dragons_) -is:reply -is:retweet`, so only original posts and quote posts from verified accounts (plus the team account) come in.
  It stores post IDs and light metadata, never post text.
- `radar/web.py` serves the feed. Each post is drawn with X's official embed, which keeps it current
  (live counts, deleted posts disappear), as X's developer policy requires.
- Opened posts are remembered in each visitor's browser (localStorage). Nothing about visitors is stored on the server.
- A spend guard stops the collector before the monthly limit in `MONTHLY_SPEND_LIMIT_USD`.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                    # then fill in X_BEARER_TOKEN, ADMIN_PASSWORD, SECRET_KEY
set -a; source .env; set +a                             # Windows PowerShell: set each variable with $env:NAME="value"
python -m radar.collect                                 # one collection run
flask --app "radar.web:create_app()" run                # http://127.0.0.1:5000
python -m pytest                                        # 19 tests
```

Preview without an X token (placeholder cards, labelled demo data, local SQLite only):

```bash
DEMO_MODE=1 DATABASE_URL=sqlite:///demo.db python -m radar.demo
DEMO_MODE=1 DATABASE_URL=sqlite:///demo.db flask --app "radar.web:create_app()" run
```

## Free deploy: GitHub + Render + Supabase

- **Supabase** holds the database. Tables are created by the first run.
- **GitHub Actions** (`.github/workflows/collect.yml`) collects posts every 20 minutes and pings the site every 10 minutes so Render's free plan does not put it to sleep. Keep the repo public: Actions minutes are unlimited for public repos. The code holds no secrets.
- **Render** runs the website from `render.yaml`.

1. Push this folder to a new public GitHub repo named `dragon-radar`.
2. Supabase: project `dragon-radar` > Connect > **Session pooler** connection string. Replace `[YOUR-PASSWORD]` with the database password (Project Settings > Database > Reset database password if you do not have it). This full string is your `DATABASE_URL`.
3. GitHub repo > Settings > Secrets and variables > Actions:
   - Secrets: `X_BEARER_TOKEN`, `DATABASE_URL`
   - Variables: `SITE_URL` (fill in after step 4)
4. Render > New > Blueprint > pick the repo. Fill in `DATABASE_URL`, `ADMIN_PASSWORD`, `X_BEARER_TOKEN` when asked. Copy the site address it gives you into `SITE_URL`.
5. GitHub repo > Actions > collect > **Run workflow** for the first collection. Then open the site.

## Admin

`/admin` (off until `ADMIN_PASSWORD` is set): hide a spam post by link, block its author,
edit the keyword blocklist, see estimated spend and every collector run.
A red banner shows if no run has finished in the last hour.

## Not yet verified against live X

- Real daily volume and cost: watch the admin run table during the first week.
- Embeds and the click detection inside them could not be tested from the build environment,
  which cannot reach X's embed servers. Test on a phone and a laptop after deploying.
- Whether excluding `-is:reply` misses anything you want: compare a day of results with X search.
