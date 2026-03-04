# ============================================================
# ClipWise – FFmpeg Server (Railway deployment)
# This runs scripts/local-ffmpeg-server.js in production.
# ============================================================

FROM node:20-bookworm-slim

# ── System packages ───────────────────────────────────────────
# ffmpeg         : video processing
# python3/pip    : required for Whisper transcription
# chromium deps  : required for Remotion's headless renderer
# git            : required by some npm packages at install time
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    git \
    ca-certificates \
    wget \
    gnupg \
    # Chromium shared library dependencies (for Remotion's bundled Chrome)
    libglib2.0-0 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcb-dri3-0 \
    && rm -rf /var/lib/apt/lists/*

# ── Python: Whisper (CPU-only torch to keep image size manageable) ────
# CPU-only torch is ~700MB vs ~2.5GB for CUDA
RUN python3 -m venv /opt/whisper-venv \
    && /opt/whisper-venv/bin/pip install --upgrade pip \
    && /opt/whisper-venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu \
    && /opt/whisper-venv/bin/pip install openai-whisper

# Make the venv's Python/whisper available on PATH
ENV PATH="/opt/whisper-venv/bin:$PATH"

# ── Node.js app ───────────────────────────────────────────────
WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies – needed for npx remotion render)
RUN npm install --legacy-peer-deps

# Copy the rest of the project
# (node_modules already installed above; .dockerignore excludes heavy dirs)
COPY . .

# ── Remotion: pre-download its bundled Chrome ────────────────
# This runs once at build time so startup is fast
RUN npx remotion browser ensure || true

# ── Runtime config ────────────────────────────────────────────
# Railway provides PORT automatically; default to 3333
ENV PORT=3333

# Sessions/assets are stored here – mount a Railway Volume at this path
# to persist data across deployments
ENV SESSIONS_BASE_DIR=/data/hyperedit-ffmpeg

# Expose the port
EXPOSE 3333

# Health check – Railway uses this to know when the container is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -qO- http://localhost:3333/health || exit 1

# Start the FFmpeg server
CMD ["node", "scripts/local-ffmpeg-server.js"]
