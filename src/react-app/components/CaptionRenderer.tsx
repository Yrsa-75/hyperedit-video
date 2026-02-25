import { useMemo } from 'react';
import type { CaptionWord, CaptionStyle } from '@/react-app/hooks/useProject';

interface CaptionRendererProps {
  words: CaptionWord[];
  style: CaptionStyle;
  currentTime: number;  // Time within the caption clip
  aspectRatio?: '16:9' | '9:16';
}

export default function CaptionRenderer({ words, style, currentTime, aspectRatio = '16:9' }: CaptionRendererProps) {
  // Apply time offset (negative = captions appear earlier, positive = later)
  const adjustedTime = currentTime - (style.timeOffset || 0);

  // Find which words are visible and which is currently active
  const { visibleWords, activeWordIndex } = useMemo(() => {
    const visible: { word: CaptionWord; index: number }[] = [];
    let activeIndex = -1;

    words.forEach((word, index) => {
      // For most animations, show all words
      // For typewriter, only show words that have started
      if (style.animation === 'typewriter') {
        if (adjustedTime >= word.start) {
          visible.push({ word, index });
        }
      } else {
        visible.push({ word, index });
      }

      // Track the currently active word
      if (adjustedTime >= word.start && adjustedTime < word.end) {
        activeIndex = index;
      }
    });

    return { visibleWords: visible, activeWordIndex: activeIndex };
  }, [words, adjustedTime, style.animation]);

  // Get position styles
  const positionStyles = useMemo((): React.CSSProperties => {
    const isActual916 = aspectRatio === '9:16';

    // In an actual 9:16 container the frame is already 9:16, so use simple left/right padding.
    // In a 16:9 container with constrainTo916, constrain to the center 9:16 safe column
    // (9/16)² × 100% ≈ 31.64% of frame width.
    const use916SafeZone = !isActual916 && style.constrainTo916;
    const captionWidth = use916SafeZone ? '31.64%' : '90%';

    const base: React.CSSProperties = {
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      textAlign: 'center',
      width: captionWidth,
      maxWidth: captionWidth,
    };

    // Simple left/right padding style (used for actual 9:16 frames and normal 16:9)
    const paddedBase: React.CSSProperties = {
      position: 'absolute',
      left: '5%',
      right: '5%',
      textAlign: 'center',
    };

    switch (style.position) {
      case 'top':
        return use916SafeZone
          ? { ...base, top: '8%' }
          : { ...paddedBase, top: '8%' };
      case 'center':
        return use916SafeZone
          ? { ...base, top: '50%', transform: 'translate(-50%, -50%)' }
          : { ...paddedBase, top: '50%', transform: 'translateY(-50%)' };
      case 'bottom':
      default:
        return use916SafeZone
          ? { ...base, bottom: '25%' }
          : { ...paddedBase, bottom: '25%' };
    }
  }, [style.position, style.constrainTo916, aspectRatio]);

  // Get text styles
  const textStyles = useMemo((): React.CSSProperties => {
    return {
      fontFamily: style.fontFamily,
      fontSize: `${style.fontSize}px`,
      fontWeight: style.fontWeight === 'black' ? 900 : style.fontWeight === 'bold' ? 700 : 400,
      color: style.color,
      textShadow: style.strokeWidth
        ? `
          -${style.strokeWidth}px -${style.strokeWidth}px 0 ${style.strokeColor},
          ${style.strokeWidth}px -${style.strokeWidth}px 0 ${style.strokeColor},
          -${style.strokeWidth}px ${style.strokeWidth}px 0 ${style.strokeColor},
          ${style.strokeWidth}px ${style.strokeWidth}px 0 ${style.strokeColor}
        `
        : undefined,
      backgroundColor: style.backgroundColor,
      padding: style.backgroundColor ? '4px 12px' : undefined,
      borderRadius: style.backgroundColor ? '4px' : undefined,
      lineHeight: 1.4,
    };
  }, [style]);

  // Get animation class/style for a word
  const getWordStyle = (wordIndex: number, word: CaptionWord): React.CSSProperties => {
    const isActive = wordIndex === activeWordIndex;
    const hasStarted = adjustedTime >= word.start;

    switch (style.animation) {
      case 'karaoke':
        return {
          color: isActive ? style.highlightColor || '#FFD700' : style.color,
          transition: 'color 0.1s ease',
        };

      case 'fade':
        return {
          opacity: hasStarted ? 1 : 0.3,
          transition: 'opacity 0.3s ease',
        };

      case 'pop':
        return {
          transform: isActive ? 'scale(1.2)' : 'scale(1)',
          display: 'inline-block',
          transition: 'transform 0.15s ease',
        };

      case 'bounce':
        return {
          transform: isActive ? 'translateY(-4px)' : 'translateY(0)',
          display: 'inline-block',
          transition: 'transform 0.15s ease',
        };

      case 'typewriter':
      case 'none':
      default:
        return {};
    }
  };

  if (visibleWords.length === 0) {
    return null;
  }

  return (
    <div style={positionStyles} className="pointer-events-none z-40">
      <div style={textStyles}>
        {visibleWords.map(({ word, index }, i) => {
          const nextText = i < visibleWords.length - 1 ? visibleWords[i + 1].word.text : null;
          // No space when current word ends with apostrophe (e.g. "c'" + "est" → "c'est")
          // or next word starts with apostrophe or punctuation
          const addSpace = nextText !== null
            && !word.text.endsWith("'")
            && !word.text.endsWith("-")
            && !nextText.startsWith("'")
            && !nextText.startsWith("-")
            && !/^[.,!?;:)]/.test(nextText);
          return (
            <span
              key={`${index}-${word.text}`}
              style={getWordStyle(index, word)}
            >
              {word.text}
              {addSpace ? ' ' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
