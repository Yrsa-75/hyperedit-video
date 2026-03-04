# ClipWise – Deployment Guide

Two services to deploy:
- **Cloudflare Workers** → serves the React frontend + AI editing API
- **Railway** → runs the FFmpeg/video-processing server

---

## Prerequisites

1. Rotate all API keys (they were previously exposed):
   - [Google AI Studio](https://aistudio.google.com) → regenerate `GEMINI_API_KEY`
   - [fal.ai dashboard](https://fal.ai/dashboard) → regenerate `FAL_API_KEY`
   - [GIPHY developers](https://developers.giphy.com) → regenerate `GIPHY_API_KEY`
   - [OpenAI platform](https://platform.openai.com/api-keys) → regenerate `OPENAI_API_KEY`

2. Create accounts (both free to start):
   - [Cloudflare](https://cloudflare.com) – for frontend + AI worker
   - [Railway](https://railway.app) – for FFmpeg server

---

## Step 1 – Deploy the FFmpeg Server to Railway

> Do Railway FIRST because you need its public URL to configure Cloudflare.

1. Push this repo to GitHub (new repo)

2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
   - Select your repo
   - Railway auto-detects the `Dockerfile` and builds it
   - ⚠️ First build takes ~10–15 minutes (downloads Python, torch, Whisper, Chrome)

3. In Railway dashboard → your service → **Variables** tab, add:
   ```
   GEMINI_API_KEY     = your-new-key
   FAL_API_KEY        = your-new-key
   FAL_KEY            = your-new-key   ← same value as FAL_API_KEY
   GIPHY_API_KEY      = your-new-key
   OPENAI_API_KEY     = your-new-key
   SESSIONS_BASE_DIR  = /data/hyperedit-ffmpeg
   ```
   Railway sets `PORT` automatically — don't add it manually.

4. In Railway → your service → **Settings** → **Volumes**:
   - Add a volume mounted at `/data`
   - This keeps session files alive across deployments

5. In Railway → your service → **Settings** → **Networking**:
   - Click **Generate Domain** → copy the URL
   - It looks like: `https://clipwise-production.up.railway.app`

6. Test: visit `https://your-railway-url/health` — should return `{"status":"ok"}`

---

## Step 2 – Deploy Frontend to Cloudflare

### First time (manual)

1. Install wrangler globally:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Build with your Railway URL:
   ```bash
   VITE_FFMPEG_SERVER_URL=https://your-railway-url npm run build
   ```

4. Deploy:
   ```bash
   wrangler deploy
   ```

5. Set the Cloudflare Worker secret:
   ```bash
   wrangler secret put GEMINI_API_KEY
   # paste your key when prompted
   ```

6. Your app is live at the URL shown in the deploy output (e.g. `https://xxxx.workers.dev`)

---

## Step 3 – Set up GitHub Actions (auto-deploy on push)

After the first manual deploy is working:

1. Get your Cloudflare credentials:
   - **API Token**: Cloudflare dashboard → Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template
   - **Account ID**: Cloudflare dashboard → right sidebar

2. In GitHub → your repo → **Settings → Secrets and variables → Actions**, add:
   ```
   CLOUDFLARE_API_TOKEN   = your-cloudflare-api-token
   CLOUDFLARE_ACCOUNT_ID  = your-cloudflare-account-id
   VITE_FFMPEG_SERVER_URL = https://your-railway-url
   GEMINI_API_KEY         = your-gemini-key
   ```

3. Every push to `main` now automatically builds and deploys to Cloudflare.
   Railway redeploys automatically too when you push (it watches GitHub).

---

## Local development (unchanged)

Local dev still works exactly as before — no env vars needed:

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run ffmpeg-server
```

The app falls back to `http://localhost:3333` when `VITE_FFMPEG_SERVER_URL` is not set.

---

## Architecture

```
GitHub push to main
       │
       ├─→ Railway (auto)  ──────→ Docker build → FFmpeg server live
       │                           (FFmpeg, Python, Whisper, Remotion)
       │
       └─→ GitHub Actions ─────→ npm build (with VITE_FFMPEG_SERVER_URL baked in)
                                  └─→ wrangler deploy → Cloudflare Workers
                                       (React SPA + Hono AI worker)
```

---

## Estimated monthly costs

| Service    | Plan            | Cost      |
|------------|-----------------|-----------|
| Cloudflare | Workers Free    | $0        |
| Railway    | Hobby (1GB RAM) | ~$5/mo    |
| Railway    | Volume (10GB)   | ~$2.50/mo |
| **Total**  |                 | **~$7.50/mo** |

For more traffic/processing power, upgrade Railway to 2–4GB RAM ($10–20/mo).
