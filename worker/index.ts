// ============================================================
// ARGOS Worker — Point d'entrée (Railway)
//
// Ce serveur :
// 1. Expose des endpoints HTTP (presigned URL, trigger manuel)
// 2. Écoute Supabase Realtime pour les nouveaux jobs
// 3. Exécute le pipeline séquentiellement
// ============================================================
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { processJob } from './pipeline';
import type { Job } from '../src/types/argos';

const execAsync = promisify(exec);

// ---------------------------------------------------------------
// Validation des variables d'environnement au démarrage
// ---------------------------------------------------------------
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`⚠️ Variable manquante : ${key}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------
// Clients
// ---------------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

// ---------------------------------------------------------------
// Serveur Express
// ---------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// Middleware d'authentification
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.WORKER_SECRET_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ---------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------
// POST /api/upload/presign → Génère une URL de pré-signature R2
// ---------------------------------------------------------------
app.post('/api/upload/presign', async (req, res) => {
  const { filename, fileSize, mimeType } = req.body;

  if (!filename || !mimeType) {
    res.status(400).json({ error: 'filename et mimeType requis' });
    return;
  }

  if (fileSize > 4 * 1024 * 1024 * 1024) {
    res.status(400).json({ error: 'Fichier trop volumineux (max 4 GB)' });
    return;
  }

  const ext = path.extname(filename);
  const key = `uploads/${randomUUID()}${ext}`;

  const command = new PutObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME!,
    Key: key,
    ContentType: mimeType,
    ContentLength: fileSize,
  });

  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });

  res.json({
    uploadUrl,
    publicUrl: `${process.env.R2_PUBLIC_URL}/${key}`,
    key,
  });
});

// ---------------------------------------------------------------
// POST /api/jobs/trigger → Déclencher le traitement d'un job
// ---------------------------------------------------------------
app.post('/api/jobs/trigger', async (req, res) => {
  const { jobId } = req.body;

  if (!jobId) {
    res.status(400).json({ error: 'jobId requis' });
    return;
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error || !job) {
    res.status(404).json({ error: 'Job introuvable' });
    return;
  }

  processJob(job as Job).catch(console.error);

  res.json({ status: 'processing', jobId });
});

// ---------------------------------------------------------------
// POST /session/:sessionId/face-crop → Smart crop MediaPipe
// ---------------------------------------------------------------
app.post('/session/:sessionId/face-crop', requireAuth, async (req: express.Request, res: express.Response) => {
  const { assetId, aspectRatio = '9:16' } = req.body;

  if (!assetId) {
    res.status(400).json({ error: 'assetId requis' });
    return;
  }

  const tmpDir = tmpdir();
  const inputPath = path.join(tmpDir, `fc_in_${randomUUID()}.mp4`);
  const outputPath = path.join(tmpDir, `fc_out_${randomUUID()}.mp4`);

  try {
    // 1. Télécharger la vidéo depuis R2
    const candidateUrls = [
      `${process.env.R2_PUBLIC_URL}/${assetId}`,
      `${process.env.R2_PUBLIC_URL}/uploads/${assetId}`,
      `${process.env.R2_PUBLIC_URL}/uploads/${assetId}.mp4`,
    ];

    let downloaded = false;
    for (const url of candidateUrls) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          writeFileSync(inputPath, buf);
          downloaded = true;
          console.log(`[FaceCrop] Vidéo téléchargée depuis ${url}`);
          break;
        }
      } catch {}
    }

    if (!downloaded) {
      throw new Error(`Impossible de télécharger la vidéo : ${assetId}`);
    }

    // 2. Lancer face-crop.py pour détecter les visages
    console.log(`[FaceCrop] Analyse MediaPipe (ratio: ${aspectRatio})...`);
    const cropJson = await new Promise<string>((resolve, reject) => {
      const py = spawn('python3', ['/app/scripts/face-crop.py', inputPath, aspectRatio, outputPath]);
      let stdout = '';
      let stderr = '';
      py.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      py.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      py.on('close', (code: number) => {
        console.log(`[FaceCrop] face-crop.py code=${code} stderr=${stderr.slice(-300)}`);
        if (code !== 0) reject(new Error(`face-crop.py failed (code ${code}): ${stderr.slice(-300)}`));
        else resolve(stdout.trim());
      });
    });

    const cropData = JSON.parse(cropJson);
    if (cropData.error) throw new Error(cropData.error);

    const { w, h, x, y } = cropData.crop;
    console.log(`[FaceCrop] Crop: ${w}x${h} @ (${x},${y})`);

    // 3. Appliquer le crop + scale FFmpeg
    const scaleTarget = aspectRatio === '9:16' ? '1080:1920'
      : aspectRatio === '1:1' ? '1080:1080'
      : '1920:1080';

    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "crop=${w}:${h}:${x}:${y},scale=${scaleTarget}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`
    );
    console.log('[FaceCrop] Encodage FFmpeg terminé');

    // 4. Upload vers R2
    const newKey = `uploads/${randomUUID()}.mp4`;
    const fileContent = readFileSync(outputPath);

    await r2.send(new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME!,
      Key: newKey,
      ContentType: 'video/mp4',
      Body: fileContent,
    }));
    console.log(`[FaceCrop] Uploadé: ${newKey}`);

    res.json({
      assetId: newKey,
      publicUrl: `${process.env.R2_PUBLIC_URL}/${newKey}`,
      key: newKey,
    });

  } catch (err) {
    console.error('[FaceCrop] Erreur:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Smart crop failed' });
  } finally {
    try { unlinkSync(inputPath); } catch {}
    try { unlinkSync(outputPath); } catch {}
  }
});

// ---------------------------------------------------------------
// File de traitement séquentielle
// ---------------------------------------------------------------
const jobQueue: Job[] = [];
let isProcessing = false;

function enqueueJob(job: Job) {
  jobQueue.push(job);
  if (!isProcessing) processNext();
}

async function processNext(): Promise<void> {
  if (jobQueue.length === 0) { isProcessing = false; return; }
  isProcessing = true;
  const job = jobQueue.shift()!;
  try {
    await processJob(job);
  } catch (err) {
    console.error(`[Queue] Erreur job ${job.id}:`, err);
  }
  setTimeout(processNext, 1000);
}

// ---------------------------------------------------------------
// Supabase Realtime → Écouter les nouveaux jobs "pending"
// ---------------------------------------------------------------
function startRealtimeListener(): void {
  console.log('[Realtime] Connexion Supabase Realtime...');

  supabase
    .channel('new-jobs')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'jobs',
        filter: "status=eq.pending",
      },
      (payload) => {
        const job = payload.new as Job;
        if (job.source_url && job.status === 'pending') {
          console.log(`[Realtime] Nouveau job: ${job.id.slice(0, 8)}`);
          enqueueJob(job);
        }
      }
    )
    .subscribe((status) => {
      console.log(`[Realtime] Status: ${status}`);
    });
}

// ---------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------
const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`\n🚀 Argos Worker démarré sur port ${PORT}`);
  console.log(`👂 Écoute des jobs Supabase...`);
  startRealtimeListener();
});

process.on('SIGTERM', () => {
  console.log('[Worker] SIGTERM reçu, arrêt gracieux...');
  process.exit(0);
});
