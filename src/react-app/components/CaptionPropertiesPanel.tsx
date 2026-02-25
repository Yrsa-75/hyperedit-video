import { useCallback, useState, useEffect } from 'react';
import { Type, X, Palette, AlignCenter, Check } from 'lucide-react';
import type { CaptionStyle, CaptionData } from '@/react-app/hooks/useProject';

interface CaptionPropertiesPanelProps {
  captionData: CaptionData;
  onUpdateStyle: (styleUpdates: Partial<CaptionStyle>) => void;
  onUpdateWords: (newText: string) => void;
  onClose: () => void;
}

const FONT_OPTIONS = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Poppins', label: 'Poppins' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Oswald', label: 'Oswald' },
  { value: 'Bebas Neue', label: 'Bebas Neue' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
];

const ANIMATION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'karaoke', label: 'Karaoke' },
  { value: 'fade', label: 'Fade In' },
  { value: 'pop', label: 'Pop' },
  { value: 'bounce', label: 'Bounce' },
];

const POSITION_OPTIONS = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
];

export default function CaptionPropertiesPanel({
  captionData,
  onUpdateStyle,
  onUpdateWords,
  onClose,
}: CaptionPropertiesPanelProps) {
  const style = captionData.style;

  // Smart join: no space after apostrophe/hyphen endings or before apostrophe/punctuation starts
  const joinWords = (words: CaptionData['words']) =>
    words.reduce((acc, w, i) => {
      if (i === 0) return w.text;
      const prev = words[i - 1].text;
      const needsSpace = !prev.endsWith("'") && !prev.endsWith("-")
        && !w.text.startsWith("'") && !w.text.startsWith("-")
        && !/^[.,!?;:)]/.test(w.text);
      return acc + (needsSpace ? ' ' : '') + w.text;
    }, '');

  // Local text state — synced from captionData, committed on blur
  const fullText = joinWords(captionData.words);
  const [editedText, setEditedText] = useState(fullText);

  // Local style state — buffered until "Apply Changes"
  const [localFontFamily, setLocalFontFamily] = useState(style.fontFamily);
  const [localFontSize, setLocalFontSize] = useState(style.fontSize);
  const [localFontWeight, setLocalFontWeight] = useState(style.fontWeight);
  const [localColor, setLocalColor] = useState(style.color);
  const [localStrokeColor, setLocalStrokeColor] = useState(style.strokeColor || '#000000');
  const [localStrokeWidth, setLocalStrokeWidth] = useState(style.strokeWidth || 0);
  const [localPosition, setLocalPosition] = useState(style.position);
  const [localAnimation, setLocalAnimation] = useState(style.animation);
  const [localHighlightColor, setLocalHighlightColor] = useState(style.highlightColor || '#FFD700');
  const [localTimeOffset, setLocalTimeOffset] = useState(style.timeOffset || 0);

  // Keep in sync when a different clip is selected
  useEffect(() => {
    setEditedText(joinWords(captionData.words));
    setLocalFontFamily(style.fontFamily);
    setLocalFontSize(style.fontSize);
    setLocalFontWeight(style.fontWeight);
    setLocalColor(style.color);
    setLocalStrokeColor(style.strokeColor || '#000000');
    setLocalStrokeWidth(style.strokeWidth || 0);
    setLocalPosition(style.position);
    setLocalAnimation(style.animation);
    setLocalHighlightColor(style.highlightColor || '#FFD700');
    setLocalTimeOffset(style.timeOffset || 0);
  }, [captionData]);

  const handleTextBlur = useCallback(() => {
    if (editedText.trim() !== fullText.trim()) {
      onUpdateWords(editedText);
    }
  }, [editedText, fullText, onUpdateWords]);

  const handleApply = useCallback(() => {
    onUpdateStyle({
      fontFamily: localFontFamily,
      fontSize: localFontSize,
      fontWeight: localFontWeight,
      color: localColor,
      strokeColor: localStrokeColor,
      strokeWidth: localStrokeWidth,
      position: localPosition,
      animation: localAnimation,
      highlightColor: localHighlightColor,
      timeOffset: localTimeOffset,
    });
  }, [
    onUpdateStyle,
    localFontFamily, localFontSize, localFontWeight,
    localColor, localStrokeColor, localStrokeWidth,
    localPosition, localAnimation, localHighlightColor, localTimeOffset,
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50">
        <span className="text-xs font-medium text-zinc-400">Caption Properties</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-zinc-700 rounded transition-colors"
          title="Deselect caption"
        >
          <X className="w-3.5 h-3.5 text-zinc-500" />
        </button>
      </div>

      {/* Caption text editor */}
      <div className="px-3 py-2 border-b border-zinc-800/50">
        <div className="flex items-center gap-2 mb-1.5">
          <Type className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-medium text-zinc-300">Caption Text</span>
          <span className="text-[10px] text-zinc-500 ml-auto">{captionData.words.length} words</span>
        </div>
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          onBlur={handleTextBlur}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } }}
          rows={2}
          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white resize-none focus:outline-none focus:border-purple-500 leading-relaxed"
          placeholder="Caption text..."
        />
        <div className="text-[10px] text-zinc-500 mt-0.5">Press Enter or click away to apply</div>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Font Family */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Type className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Font</span>
          </div>
          <select
            value={localFontFamily}
            onChange={(e) => setLocalFontFamily(e.target.value)}
            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
          >
            {FONT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-300">Size</span>
            <span className="text-xs text-zinc-400">{localFontSize}px</span>
          </div>
          <input
            type="range"
            min="24"
            max="96"
            step="2"
            value={localFontSize}
            onChange={(e) => setLocalFontSize(parseInt(e.target.value))}
            className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
        </div>

        {/* Font Weight */}
        <div>
          <span className="text-xs font-medium text-zinc-300 block mb-2">Weight</span>
          <div className="flex gap-1">
            {(['normal', 'bold', 'black'] as const).map(weight => (
              <button
                key={weight}
                onClick={() => setLocalFontWeight(weight)}
                className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                  localFontWeight === weight
                    ? 'bg-purple-500 text-white'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                {weight.charAt(0).toUpperCase() + weight.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Colors */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Palette className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Colors</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Text</label>
              <input
                type="color"
                value={localColor}
                onChange={(e) => setLocalColor(e.target.value)}
                className="w-full h-8 rounded cursor-pointer bg-zinc-800 border border-zinc-700"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Stroke</label>
              <input
                type="color"
                value={localStrokeColor}
                onChange={(e) => setLocalStrokeColor(e.target.value)}
                className="w-full h-8 rounded cursor-pointer bg-zinc-800 border border-zinc-700"
              />
            </div>
          </div>
        </div>

        {/* Stroke Width */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-300">Stroke Width</span>
            <span className="text-xs text-zinc-400">{localStrokeWidth}px</span>
          </div>
          <input
            type="range"
            min="0"
            max="6"
            step="1"
            value={localStrokeWidth}
            onChange={(e) => setLocalStrokeWidth(parseInt(e.target.value))}
            className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
        </div>

        {/* Position */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlignCenter className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Position</span>
          </div>
          <div className="flex gap-1">
            {POSITION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setLocalPosition(opt.value as 'top' | 'center' | 'bottom')}
                className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                  localPosition === opt.value
                    ? 'bg-purple-500 text-white'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Animation */}
        <div>
          <span className="text-xs font-medium text-zinc-300 block mb-2">Animation</span>
          <select
            value={localAnimation}
            onChange={(e) => setLocalAnimation(e.target.value as CaptionStyle['animation'])}
            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
          >
            {ANIMATION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Highlight Color (for karaoke) */}
        {localAnimation === 'karaoke' && (
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-2">Highlight Color</label>
            <input
              type="color"
              value={localHighlightColor}
              onChange={(e) => setLocalHighlightColor(e.target.value)}
              className="w-full h-8 rounded cursor-pointer bg-zinc-800 border border-zinc-700"
            />
          </div>
        )}

        {/* Time Offset */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-300">Time Offset</span>
            <span className="text-xs text-zinc-400">{localTimeOffset.toFixed(1)}s</span>
          </div>
          <input
            type="range"
            min="-5"
            max="5"
            step="0.1"
            value={localTimeOffset}
            onChange={(e) => setLocalTimeOffset(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
            <span>Earlier</span>
            <span>Later</span>
          </div>
        </div>
      </div>

      {/* Apply Changes button */}
      <div className="px-3 py-2 border-t border-zinc-800/50">
        <button
          onClick={handleApply}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          Apply Changes
        </button>
      </div>
    </div>
  );
}
