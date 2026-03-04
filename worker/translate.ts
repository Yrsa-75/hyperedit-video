// ============================================================
// ARGOS Worker — Traduction GPT-4o-mini + Génération SRT
//
// Avantage vs DeepL : contexte global de la vidéo inclus
// → traduction cohérente sur toute la durée
// ============================================================
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import type {
  TranscriptionResult,
  ClaudeAnalysisResult,
  WordTimestamp,
  LanguageCode,
  WhisperWord,
} from '../src/types/argos';
import { SUPPORTED_LANGUAGES } from '../src/types/argos';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------------------------------------------
// Extraire les mots d'un clip à partir du transcript complet
// ----------------------------------------------------------------
function extractWordsForClip(
  allWords: WhisperWord[],
  startTime: number,
  endTime: number
): WhisperWord[] {
  return allWords.filter(w => w.start >= startTime - 0.1 && w.end <= endTime + 0.1);
}

// ----------------------------------------------------------------
// Traduire un lot de mots avec GPT-4o-mini
// On envoie le texte complet + contexte pour une traduction cohérente
// ----------------------------------------------------------------
async function translateWords(
  words: WhisperWord[],
  sourceLanguage: string,
  targetLanguage: LanguageCode,
  videoContext: string
): Promise<WordTimestamp[]> {
  if (words.length === 0) return [];

  // Construire le texte source complet pour le contexte
  const fullText = words.map(w => w.word).join(' ');
  const targetLanguageName = SUPPORTED_LANGUAGES[targetLanguage];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1, // Peu de créativité pour la traduction
    messages: [
      {
        role: 'system',
        content: `Tu es un traducteur professionnel de sous-titres vidéo.
        
Contexte de la vidéo : ${videoContext}
Langue source : ${sourceLanguage}
Langue cible : ${targetLanguageName}

RÈGLES :
- Traduis les sous-titres en gardant le sens et le ton naturel
- Adapte les expressions idiomatiques (ne traduis pas mot à mot)
- Garde les noms propres, marques, et termes techniques tels quels
- Pour l'arabe, le japonais, le chinois : utilise les caractères natifs
- Retourne UNIQUEMENT un tableau JSON, aucun autre texte

Format attendu : array de strings, une traduction par mot source`,
      },
      {
        role: 'user',
        content: `Texte complet : "${fullText}"

Traduis ce texte en ${targetLanguageName} et retourne un tableau JSON de ${words.length} éléments.
Chaque élément correspond à la traduction du mot source (peut être vide "" si le mot n'a pas d'équivalent direct).

Mots source : ${JSON.stringify(words.map(w => w.word))}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  try {
    const content = response.choices[0].message.content ?? '{"translations":[]}';
    const parsed = JSON.parse(content);

    // GPT peut retourner différents formats, on normalise
    let translations: string[] = [];
    if (Array.isArray(parsed)) {
      translations = parsed;
    } else if (Array.isArray(parsed.translations)) {
      translations = parsed.translations;
    } else {
      // Fallback : prendre la première valeur array trouvée
      const firstArray = Object.values(parsed).find(v => Array.isArray(v));
      translations = (firstArray as string[]) ?? words.map(w => w.word);
    }

    // Associer chaque traduction à son timestamp original
    return words.map((w, i) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      translated: translations[i] ?? w.word,
    }));
  } catch (err) {
    console.error(`[Traduction] Erreur parsing JSON pour ${targetLanguage}:`, err);
    // Fallback : retourner les mots originaux
    return words.map(w => ({ ...w, translated: w.word }));
  }
}

// ----------------------------------------------------------------
// Générer un fichier SRT à partir des mots traduits
// Format SRT standard compatible avec tous les lecteurs
// ----------------------------------------------------------------
export function generateSRT(
  words: WordTimestamp[],
  useTranslated = true
): string {
  if (words.length === 0) return '';

  const lines: string[] = [];
  let index = 1;

  // Regrouper les mots en sous-titres de ~5 mots (environ 3-4 secondes)
  const WORDS_PER_SUBTITLE = 5;
  const chunks: WordTimestamp[][] = [];

  for (let i = 0; i < words.length; i += WORDS_PER_SUBTITLE) {
    chunks.push(words.slice(i, i + WORDS_PER_SUBTITLE));
  }

  for (const chunk of chunks) {
    if (chunk.length === 0) continue;

    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;
    const text = chunk
      .map(w => useTranslated ? (w.translated ?? w.word) : w.word)
      .join(' ')
      .trim();

    if (!text) continue;

    lines.push(
      `${index}`,
      `${formatSRTTime(start)} --> ${formatSRTTime(end)}`,
      text,
      ''
    );

    index++;
  }

  return lines.join('\n');
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// ----------------------------------------------------------------
// Pipeline de traduction complet pour un clip
// Retourne les données + écrit les .srt sur disque
// ----------------------------------------------------------------
export interface TranslationResult {
  language: LanguageCode;
  words: WordTimestamp[];
  srtContent: string;
  srtPath: string;
}

export async function translateClip(
  clipId: string,
  allWords: WhisperWord[],
  startTime: number,
  endTime: number,
  sourceLanguage: string,
  targetLanguages: LanguageCode[],
  videoContext: string,
  outputDir: string
): Promise<TranslationResult[]> {
  // Extraire les mots du clip
  const clipWords = extractWordsForClip(allWords, startTime, endTime);

  if (clipWords.length === 0) {
    console.warn(`[Traduction] Aucun mot trouvé pour le clip ${clipId}`);
    return [];
  }

  console.log(`[Traduction] Clip ${clipId}: ${clipWords.length} mots → ${targetLanguages.length} langues`);

  // Traduire toutes les langues en parallèle (par batch de 5 pour éviter rate limits)
  const results: TranslationResult[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < targetLanguages.length; i += BATCH_SIZE) {
    const batch = targetLanguages.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (lang) => {
        try {
          // La langue source est déjà disponible via Whisper
          const translatedWords = sourceLanguage === lang
            ? clipWords.map(w => ({ ...w, translated: w.word }))
            : await translateWords(clipWords, sourceLanguage, lang, videoContext);

          const srtContent = generateSRT(translatedWords, true);
          const srtPath = path.join(outputDir, `clip_${clipId}_${lang}.srt`);

          fs.writeFileSync(srtPath, srtContent, 'utf8');

          return {
            language: lang,
            words: translatedWords,
            srtContent,
            srtPath,
          } as TranslationResult;
        } catch (err) {
          console.error(`[Traduction] Erreur pour ${lang}:`, err);
          return null;
        }
      })
    );

    results.push(...batchResults.filter((r): r is TranslationResult => r !== null));

    // Petite pause entre les batches pour éviter les rate limits
    if (i + BATCH_SIZE < targetLanguages.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`[Traduction] ✓ ${results.length}/${targetLanguages.length} langues traduites`);
  return results;
}
