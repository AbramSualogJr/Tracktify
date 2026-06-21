# Deploying Tracktify to Render

Tracktify is a single Node service (`server.js`) that serves the app **and** the API.
No build step, no dependencies.

## 1. Put the code in a GitHub repo
From the `tracktify/` folder:

```bash
git init
git add .
git commit -m "Tracktify"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/tracktify.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes the data file and secrets — nothing sensitive is committed.

## 2. Deploy on Render
1. Go to **render.com** → sign up (free) → **New +** → **Blueprint**.
2. Connect your GitHub and pick the `tracktify` repo. Render reads `render.yaml`.
3. Click **Apply**. Render builds and starts `node server.js`.
4. `TT_JWT_SECRET` is generated automatically. When the deploy finishes you get a URL like `https://tracktify.onrender.com`.

Open the URL → **register an account** → you're live, with HTTPS, on any device. 🎉

## 3. (Optional) Turn on the AI summary
In the Render dashboard → your service → **Environment** → add:

- `ANTHROPIC_API_KEY` = your Anthropic key

Save (Render redeploys). The dashboard's "Refresh" now returns real AI summaries.
Without it, the dashboard shows the built-in deterministic summary — everything else works.

## 4. Important: data persistence (required for cross-device sync)
The **free** plan has an **ephemeral disk** — `tracktify-data.json` (all accounts/data)
is reset whenever the service **redeploys** or **cold-starts** (free instances sleep
after ~15 min idle). The visible symptom: you register on one device, then on a second
device the same email is treated as new and your data is missing — because the store was
wiped in between. So for any real use you **must** add a durable store.

### Recommended (free): Upstash Redis
Keeps the app dependency-free and survives restarts at $0.

1. Go to **upstash.com** → sign up (free) → **Create Database** (Redis). Pick a region
   near your Render region.
2. On the database page, open the **REST API** section. Copy the two values:
   - `UPSTASH_REDIS_REST_URL` (looks like `https://xxx.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN`
3. In **Render** → your service → **Environment** → add both as environment variables
   with those exact names, then **Save** (Render redeploys).
4. On boot the logs now say `store: Redis ✓ durable`. Register once — your account and
   data now persist and appear on **every device** you log in from.

> The whole data store is kept as one JSON value in Redis (key `tracktify:db`, override
> with `TT_REDIS_KEY`). Plenty for personal use; shard per-user later if it ever grows large.

### Alternative (paid): Persistent disk
Upgrade the service to a paid instance, add a Render **Disk** mounted at `/data`, and set
`TT_DATA_FILE=/data/tracktify-data.json` (uncomment the line in `render.yaml`). No external
account, but it costs ~$7/mo.

### Alternative (best at scale): Managed database
Swap the store in `server.js` for Postgres. The HTTP contract (`/api/<resource>` GET/PUT
per user) stays identical, so the frontend needs zero changes — only `loadDb`/`persist` change.

## Notes
- Free instances **sleep** after inactivity → the first request after idle is slow (cold start). Paid instances stay warm.
- Frontend and API are the **same origin** (one service), so there's no CORS to configure.
- Custom domain: add it under the service's **Settings → Custom Domains**.

## Run locally
```bash
node server.js                       # http://localhost:5173
# enable AI locally (PowerShell):
$env:ANTHROPIC_API_KEY="sk-ant-..."; node server.js
```
