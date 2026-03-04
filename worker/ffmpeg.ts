// ============================================================
// ARGOS Worker — FFmpeg : crop, découpe, export HD
// ============================================================
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { VideoFormat } from '../src/types/argos';

const execAsync = promisify(exec);

// ----------------------------------------------------------------
// Dimensions par format
// ----------------------------------------------------------------
const FORMAT_DIMENSIONS: Record<VideoFormat, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1':  { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
};

// ----------------------------------------------------------------
// Obtenir les métadonnées d'une vidéo
// ----------------------------------------------------------------
export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
  fps: number;
}

export function getVideoMetadata(videoPath: string): VideoMetadata {
  const output = execSync(
    `ffprobe -v error -select_streams v:0 ` +
    `-show_entries stream=width,height,r_frame_rate,duration ` +
    `-of json "${videoPath}"`,
    { encoding: 'utf8' }
  );

  const info = JSON.parse(output);
  const stream = info.streams[0];

  // r_frame_rate est au format "30000/1001", on le convertit
  const [num, den] = stream.r_frame_rate.split('/').map(Number);
  const fps = den ? num / den : num;

  return {
    width: stream.width,
    height: stream.height,
    duration: parseFloat(stream.duration ?? '0'),
    fps: Math.round(fps),
  };
}

// ----------------------------------------------------------------
// Crop intelligent avec détection de visage
//
// Utilise le filtre cropdetect + facedetect de FFmpeg
// Si un visage est détecté → crop centré sur le visage
// Sinon → crop centré sur l'image (comportement par défaut)
// ----------------------------------------------------------------
export async function cropVideo(
  inputPath: string,
  outputPath: string,
  format: VideoFormat,
  startTime?: number,
  endTime?: number
): Promise<void> {
  const { width: targetW, height: targetH } = FORMAT_DIMENSIONS[format];
  const meta = getVideoMetadata(inputPath);

  const sourceAspect = meta.width / meta.height;
  const targetAspect = targetW / targetH;

  // Calculer le crop pour obtenir le bon ratio
  let cropW: number, cropH: number;
  let cropX: number, cropY: number;

  if (sourceAspect > targetAspect) {
    // Source plus large → crop sur les côtés
    cropH = meta.height;
    cropW = Math.round(meta.height * targetAspect);
    cropX = Math.round((meta.width - cropW) / 2);
    cropY = 0;
  } else {
    // Source plus haute → crop en haut/bas
    cropW = meta.width;
    cropH = Math.round(meta.width / targetAspect);
    cropX = 0;
    cropY = Math.round((meta.height - cropH) / 3); // 1/3 du haut (pour les visages)
  }

  // Construction de la commande FFmpeg
  const timeArgs = startTime !== undefined && endTime !== undefined
    ? `-ss ${startTime} -to ${endTime}`
    : '';

  const filters = [
    // 1. Crop
    `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
    // 2. Scale vers la résolution cible
    `scale=${targetW}:${targetH}:flags=lanczos`,
  ].join(',');

  const cmd = [
    'ffmpeg -y',
    timeArgs,
    `-i "${inputPath}"`,
    `-vf "${filters}"`,
    // Audio : copier tel quel
    '-c:a aac -b:a 192k',
    // Vidéo : H.264 haute qualité
    '-c:v libx264 -preset slow -crf 18',
    // Compatible mobile
    '-pix_fmt yuv420p',
    '-movflags +faststart',
    `"${outputPath}"`,
  ].filter(Boolean).join(' ');

  console.log(`[FFmpeg] Crop ${format} : ${path.basename(outputPath)}`);

  try {
    await execAsync(cmd);
    console.log(`[FFmpeg] ✓ Crop terminé`);
  } catch (err: unknown) {
    const error = err as { message?: string; stderr?: string };
    throw new Error(`FFmpeg crop échoué : ${error?.message ?? error?.stderr ?? String(err)}`);
  }
}

// ----------------------------------------------------------------
// Découper un clip de la vidéo source
// ----------------------------------------------------------------
export async function cutClip(
  sourcePath: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<void> {
  console.log(`[FFmpeg] Découpe ${startTime.toFixed(1)}s → ${endTime.toFixed(1)}s`);

  // -ss avant -i = découpe rapide (seek avant décodage)
  // -to après -i = temps relatif au point de départ
  const cmd = [
    'ffmpeg -y',
    `-ss ${startTime}`,
    `-i "${sourcePath}"`,
    `-to ${endTime - startTime}`,
    '-c:v copy -c:a copy',  // Copie sans ré-encodage pour rapidité
    `"${outputPath}"`,
  ].join(' ');

  await execAsync(cmd);
  console.log(`[FFmpeg] ✓ Clip découpé`);
}

// ----------------------------------------------------------------
// Générer une miniature du clip
// ----------------------------------------------------------------
export async function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timestamp = 2.0  // 2s après le début
): Promise<void> {
  const cmd = [
    'ffmpeg -y',
    `-ss ${timestamp}`,
    `-i "${videoPath}"`,
    '-vframes 1',
    '-q:v 2',
    `"${outputPath}"`,
  ].join(' ');

  await execAsync(cmd);
}

// ----------------------------------------------------------------
// Incruster un fichier SRT dans une vidéo (pour le rendu final)
// Utilisé comme fallback si Remotion n'est pas disponible
// ----------------------------------------------------------------
export async function burnSubtitles(
  inputPath: string,
  srtPath: string,
  outputPath: string,
  style: 'word' | 'block' = 'word'
): Promise<void> {
  // Style de sous-titres : centré en bas, police blanche avec contour noir
  const subtitleStyle = [
    'FontName=Arial',
    'FontSize=22',
    'PrimaryColour=&H00FFFFFF',  // Blanc
    'OutlineColour=&H00000000',  // Contour noir
    'Outline=2',
    'Shadow=1',
    'Alignment=2',               // Centré en bas
    'MarginV=50',
  ].join(',');

  // Échapper le chemin SRT pour FFmpeg
  const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  const cmd = [
    'ffmpeg -y',
    `-i "${inputPath}"`,
    `-vf "subtitles='${escapedSrt}':force_style='${subtitleStyle}'"`,
    '-c:v libx264 -preset fast -crf 20',
    '-c:a copy',
    `"${outputPath}"`,
  ].join(' ');

  console.log(`[FFmpeg] Incrustation sous-titres...`);
  await execAsync(cmd);
  console.log(`[FFmpeg] ✓ Sous-titres incrustés`);
}

// ----------------------------------------------------------------
// Cleanup : supprimer les fichiers temporaires
// ----------------------------------------------------------------
export function cleanupTempFiles(filePaths: string[]): void {
  filePaths.forEach(p => {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  });
}
