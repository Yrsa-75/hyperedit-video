// ============================================================
// ARGOS Worker â Point d'entrÃ©e (Railway)
//
// Ce serveur :
// 1. Expose des endpoints HTTP (presigned URL, trigger manuel)
// 2. Ãcoute Supabase Realtime pour les nouveaux jobs
// 3. ExÃ©cute le pipeline sÃ©quentiellement
// ============================================================
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';
import { processJob } from './pipeline';
import type { Job } from '../src/types/argos';

// ----------------------------------------------------------------
// Validation des variables d'environnement au dÃ©marrage
// ----------------------------------------------------------------
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
    console.error(`â Variable manquante : ${key}`);
    process.exit(1);
  }
}

// ----------------------------------------------------------------
// Clients
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// Serveur Express
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// GET /health â Health check pour Railway
// ----------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    worker: 'argos',
    timestamp: new Date().toISOString(),
    queue: processingQueue.length,
    processing: isProcessing,
  });
});

// ----------------------------------------------------------------
// POST /api/upload/presign â GÃ©nÃ¨re une URL de prÃ©-signature R2
// ----------------------------------------------------------------
app.post('/api/upload/presign', async (req, res) => {
  const { filename, fileSize, mimeType } = req.body;

  if (!filename || !mimeType) {
    res.status(400).json({ error: 'filename et mimeType requis' });
    return;
  }

  // Limite de taille : 4 GB
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

  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 3600 }); // 1h

  res.json({
    uploadUrl,
    publicUrl: `${process.env.R2_PUBLIC_URL}/${key}`,
    key,
  });
});

// ----------------------------------------------------------------
// POST /api/jobs/trigger â DÃ©clencher le traitement d'un job
// ----------------------------------------------------------------
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

  if (job.status !== 'pending') {
    res.status(400).json({ error: `Job dÃ©jÃ  en statut: ${job.status}` });
    return;
  }

  enqueueJob(job as Job);
  res.json({ message: 'Job mis en queue', jobId });
});

// ----------------------------------------------------------------
// Queue de traitement sÃ©quentielle
// On traite un job Ã  la fois pour ne pas saturer Railway
// ----------------------------------------------------------------
const processingQueue: Job[] = [];
let isProcessing = false;

function enqueueJob(job: Job): void {
  if (processingQueue.some(j => j.id === job.id)) {
    console.log(`[Queue] Job ${job.id.slice(0, 8)} dÃ©jÃ  en queue`);
    return;
  }

  processingQueue.push(job);
  console.log(`[Queue] Job ajoutÃ©: ${job.id.slice(0, 8)} (queue: ${processingQueue.length})`);

  if (!isProcessing) {
    processNext();
  }
}

async function processNext(): Promise<void> {
  if (processingQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const job = processingQueue.shift()!;

  try {
    await processJob(job);
  } catch (err) {
    console.error(`[Queue] Erreur non gÃ©rÃ©e pour job ${job.id.slice(0, 8)}:`, err);
  }

  // Passer au job suivant
  setTimeout(processNext, 1000);
}

// ----------------------------------------------------------------
// Supabase Realtime â Ãcouter les nouveaux jobs "pending"
// ----------------------------------------------------------------
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
          console.log(`[Realtime] Nouveau job dÃ©tectÃ©: ${job.id.slice(0, 8)}`);
          enqueueJob(job);
        }
      }
    )
    .subscribe((status) => {
      console.log(`[Realtime] Status: ${status}`);
    });
}

// ----------------------------------------------------------------
// DÃ©marrage
// ----------------------------------------------------------------
const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`\nð Argos Worker dÃ©marrÃ© sur port ${PORT}`);
  console.log(`ð¡ Ãcoute des jobs Supabase...`);
  startRealtimeListener();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Worker] SIGTERM reÃ§u, arrÃªt gracieux...');
  process.exit(0);
});
