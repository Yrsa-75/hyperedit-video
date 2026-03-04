// ============================================================
// ARGOS Worker — Transcription avec OpenAI Whisper
// ============================================================
import OpenAI from 'openai';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { TranscriptionResult, WhisperWord, WhisperSegment } from '../src/types/argos';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------------------------------------------
// Extraire l'audio d'une vidéo avec FFmpeg
// Réduit le fichier envoyé à Whisper (audio seulement, mono 16kHz)
// Whisper supporte max 25MB — on compresse en MP3
// ----------------------------------------------------------------
export async function extractAudio(videoPath: string): Promise<string> {
  const audioPath = videoPath.replace(/\.[^.]+$/, '_audio.mp3');

  console.log(`[Whisper] Extraction audio : ${path.basename(videoPath)}`);

  execSync(
    `ffmpeg -y -i "${videoPath}" ` +
    `-vn -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k ` +
    `"${audioPath}"`,
    { stdio: 'pipe' }
  );

  const audioSize = fs.statSync(audioPath).size;
  console.log(`[Whisper] Audio extrait : ${(audioSize / 1024 / 1024).toFixed(1)} MB`);

  return audioPath;
}

// ----------------------------------------------------------------
// Découper l'audio en chunks si > 25MB (vidéos longues)
// Whisper API limite à 25MB par appel
// ----------------------------------------------------------------
async function splitAudioIfNeeded(audioPath: string): Promise<string[]> {
  const MAX_SIZE = 24 * 1024 * 1024; // 24MB de marge
  const stats = fs.statSync(audioPath);

  if (stats.size <= MAX_SIZE) {
    return [audioPath];
  }

  // Calculer la durée totale
  const durationOutput = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
    { encoding: 'utf8' }
  );
  const totalDuration = parseFloat(durationOutput.trim());

  // Estimer le nombre de chunks nécessaires
  const numChunks = Math.ceil(stats.size / MAX_SIZE);
  const chunkDuration = totalDuration / numChunks;

  console.log(`[Whisper] Vidéo longue, découpe en ${numChunks} chunks de ${chunkDuration.toFixed(0)}s`);

  const chunks: string[] = [];
  const dir = path.dirname(audioPath);
  const base = path.basename(audioPath, '.mp3');

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const chunkPath = path.join(dir, `${base}_chunk_${i}.mp3`);

    execSync(
      `ffmpeg -y -i "${audioPath}" ` +
      `-ss ${startTime} -t ${chunkDuration} ` +
      `-acodec libmp3lame "${chunkPath}"`,
      { stdio: 'pipe' }
    );

    chunks.push(chunkPath);
  }

  return chunks;
}

// ----------------------------------------------------------------
// Transcription principale
// ----------------------------------------------------------------
export async function transcribeVideo(videoPath: string): Promise<TranscriptionResult> {
  // 1. Extraire l'audio
  const audioPath = await extractAudio(videoPath);

  // 2. Découper si nécessaire
  const chunks = await splitAudioIfNeeded(audioPath);
  console.log(`[Whisper] Transcription de ${chunks.length} chunk(s)...`);

  // 3. Transcrire chaque chunk
  const allWords: WhisperWord[] = [];
  const allSegments: WhisperSegment[] = [];
  let fullText = '';
  let detectedLanguage = 'fr';
  let timeOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = chunks[i];
    console.log(`[Whisper] Chunk ${i + 1}/${chunks.length}...`);

    const audioStream = fs.createReadStream(chunkPath) as unknown as File;

    const response = await openai.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });

    if (i === 0) {
      detectedLanguage = response.language ?? 'fr';
      fullText = response.text;
    } else {
      fullText += ' ' + response.text;
    }

    // Ajuster les timestamps avec l'offset du chunk
    const chunkDuration = i > 0
      ? parseFloat(execSync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 "${chunks[i-1]}"`,
          { encoding: 'utf8' }
        ).trim())
      : 0;

    if (i > 0) timeOffset += chunkDuration;

    // Mots avec offset
    const words = (response.words ?? []) as WhisperWord[];
    words.forEach(w => {
      allWords.push({
        word: w.word,
        start: w.start + timeOffset,
        end: w.end + timeOffset,
      });
    });

    // Segments avec offset
    const segments = (response.segments ?? []) as WhisperSegment[];
    segments.forEach((s, idx) => {
      allSegments.push({
        ...s,
        id: allSegments.length + idx,
        start: s.start + timeOffset,
        end: s.end + timeOffset,
      });
    });
  }

  // 4. Calculer la durée totale
  const duration = allWords.length > 0
    ? allWords[allWords.length - 1].end
    : 0;

  console.log(`[Whisper] ✓ Transcription terminée : ${allWords.length} mots, ${duration.toFixed(0)}s, langue: ${detectedLanguage}`);

  // 5. Nettoyage des fichiers temporaires
  chunks.forEach(c => { try { fs.unlinkSync(c); } catch {} });
  if (chunks.length > 1) {
    try { fs.unlinkSync(audioPath); } catch {}
  }

  return {
    text: fullText.trim(),
    language: detectedLanguage,
    duration,
    words: allWords,
    segments: allSegments,
  };
}
