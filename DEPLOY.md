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

## 4. Important: data persistence
The **free** plan has an **ephemeral disk** — `tracktify-data.json` (all accounts/data)
can reset when the service redeploys or sleeps. Fine for trying it out; **not** for real use.

For durable data, pick one:

- **Persistent disk (simplest):** upgrade the service to a paid instance, add a Render
  **Disk** mounted at `/data`, and set `TT_DATA_FILE=/data/tracktify-data.json`
  (uncomment the lines in `render.yaml`). Data now survives restarts.
- **Managed database (best at scale):** swap the JSON-file store in `server.js` for
  Postgres. The HTTP contract (`/api/<resource>` GET/PUT per user) stays identical, so
  the frontend needs zero changes — only the `db`/`persist` helpers change.

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
