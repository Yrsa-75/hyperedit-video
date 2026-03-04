// ============================================================
// ARGOS Worker — Analyse viralité & chapitres avec Claude
//
// C'est ici qu'on bat OpusClip :
// Claude reçoit le transcript COMPLET avec timestamps
// Il comprend le contexte global AVANT de découper
// → Jamais de coupe mid-phrase, score de viralité justifié
// ============================================================
import Anthropic from '@anthropic-ai/sdk';
import type { TranscriptionResult, ClaudeAnalysisResult, WhisperWord } from '../src/types/argos';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ----------------------------------------------------------------
// Formater le transcript pour Claude (lisible + timestamps clés)
// ----------------------------------------------------------------
function formatTranscriptForClaude(result: TranscriptionResult): string {
  // On envoie les segments (plus lisibles que mot par mot)
  // Avec les timestamps début/fin de chaque phrase
  const lines = result.segments.map(seg => {
    const start = formatTime(seg.start);
    const end = formatTime(seg.end);
    return `[${start} → ${end}] ${seg.text.trim()}`;
  });

  return lines.join('\n');
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
}

// ----------------------------------------------------------------
// Trouver le timestamp exact d'une coupure propre
// On s'assure que start_time et end_time tombent sur des fins de mots
// ----------------------------------------------------------------
function snapToWordBoundary(
  time: number,
  words: WhisperWord[],
  mode: 'start' | 'end'
): number {
  if (words.length === 0) return time;

  if (mode === 'start') {
    // Trouver le premier mot qui commence après ce timestamp
    const word = words.find(w => w.start >= time - 0.5);
    return word ? word.start : time;
  } else {
    // Trouver le dernier mot qui se termine avant ce timestamp
    const reversed = [...words].reverse();
    const word = reversed.find(w => w.end <= time + 0.5);
    return word ? word.end + 0.1 : time; // +0.1s de marge
  }
}

// ----------------------------------------------------------------
// Analyse principale
// ----------------------------------------------------------------
export async function analyzeVirality(
  transcript: TranscriptionResult,
  videoTitle: string
): Promise<ClaudeAnalysisResult> {
  console.log(`[Claude] Analyse viralité de "${videoTitle}"...`);
  console.log(`[Claude] Transcript : ${transcript.words.length} mots, ${transcript.duration.toFixed(0)}s`);

  const formattedTranscript = formatTranscriptForClaude(transcript);
  const videoDuration = transcript.duration;
  const isLongVideo = videoDuration > 600; // > 10 minutes

  // Adapter le nombre de clips selon la durée
  const minClips = 3;
  const maxClips = Math.min(10, Math.max(3, Math.floor(videoDuration / 120))); // ~1 clip par 2 minutes

  const prompt = `Tu es un expert éditeur vidéo spécialisé dans la création de contenus viraux pour les réseaux sociaux (TikTok, Instagram Reels, YouTube Shorts).

Titre de la vidéo : "${videoTitle}"
Durée totale : ${videoDuration.toFixed(0)} secondes (${Math.floor(videoDuration / 60)} min ${Math.floor(videoDuration % 60)}s)
Langue détectée : ${transcript.language}

TRANSCRIPT COMPLET AVEC TIMESTAMPS :
${formattedTranscript}

---

MISSION :
1. Comprendre le sujet global et le contexte de cette vidéo
2. Identifier ${minClips} à ${maxClips} séquences avec le plus fort potentiel viral
3. Créer un chapitrage logique pour la vidéo complète

RÈGLES ABSOLUES POUR LES CLIPS VIRAUX :
• Durée : entre 30 et 90 secondes (idéal 45-60s)
• JAMAIS couper au milieu d'une phrase ou d'une idée
• Le clip doit commencer sur une accroche forte (pas "donc comme je disais...")
• Le clip doit se terminer sur une conclusion naturelle ou un suspense
• Les timestamps doivent correspondre exactement aux pauses naturelles du discours

CRITÈRES DE VIRALITÉ (par ordre d'importance) :
1. Révélation surprenante ou contre-intuitive
2. Conseil actionnable immédiatement utile
3. Moment émotionnel fort (humour, émotion, tension)
4. Déclaration forte ou controversée
5. Storytelling avec début/milieu/fin clair

RETOURNE UNIQUEMENT UN JSON VALIDE, sans texte avant ou après :
{
  "video_summary": "Résumé en 2-3 phrases du sujet et contexte global de la vidéo",
  "detected_topics": ["topic1", "topic2", "topic3"],
  "clips": [
    {
      "title": "Titre accrocheur du clip (max 60 caractères)",
      "start_time": 45.2,
      "end_time": 98.7,
      "viral_score": 9,
      "viral_reason": "Explication précise pourquoi ce moment est viral (1-2 phrases)"
    }
  ],
  "chapters": [
    {
      "title": "Titre du chapitre",
      "start_time": 0.0,
      "end_time": 120.5
    }
  ]
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Réponse Claude inattendue');
    }

    // Parser le JSON (Claude peut parfois mettre des ```json)
    let jsonText = content.text.trim();
    jsonText = jsonText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');

    const result = JSON.parse(jsonText) as ClaudeAnalysisResult;

    // Corriger les timestamps pour qu'ils tombent sur des limites de mots propres
    result.clips = result.clips.map(clip => ({
      ...clip,
      start_time: snapToWordBoundary(clip.start_time, transcript.words, 'start'),
      end_time: snapToWordBoundary(clip.end_time, transcript.words, 'end'),
    }));

    // Trier par score décroissant
    result.clips.sort((a, b) => b.viral_score - a.viral_score);

    console.log(`[Claude] ✓ ${result.clips.length} clips identifiés, ${result.chapters.length} chapitres`);
    result.clips.forEach(c => {
      console.log(`  → "${c.title}" (${c.start_time.toFixed(1)}s–${c.end_time.toFixed(1)}s, score: ${c.viral_score}/10)`);
    });

    return result;

  } catch (err) {
    console.error('[Claude] Erreur analyse:', err);
    throw new Error(`Analyse Claude échouée : ${err instanceof Error ? err.message : String(err)}`);
  }
}
