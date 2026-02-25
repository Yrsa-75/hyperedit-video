import { useCallback, useState } from 'react';
import { Move, RotateCw, Crop, X, Loader2, Type, Palette, CaseSensitive } from 'lucide-react';

const BANNER_FONTS = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Oswald', 'Bebas Neue'] as const;
import type { TimelineClip, Asset } from '@/react-app/hooks/useProject';

interface BannerData {
  lines: string[];
  bgcolor: string;
  textcolor: string;
  fontFamily?: string;
  sourceAssetId: string;
  cropAspectRatio: string;
}

interface ClipTransform {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  cropTop?: number;
  cropBottom?: number;
  cropLeft?: number;
  cropRight?: number;
}

interface ClipPropertiesPanelProps {
  clip: TimelineClip | null;
  asset: Asset | null;
  onUpdateTransform: (clipId: string, transform: ClipTransform) => void;
  onClose: () => void;
  onFaceCrop?: (assetId: string, aspectRatio: string) => Promise<{ assetId: string; facesDetected: number; bannerDetected: boolean; bannerCount: number }>;
  onUpdateBanner?: (clipId: string, bannerData: BannerData) => void;
  onUpdateDuration?: (clipId: string, duration: number) => void;
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const handleHexChange = (raw: string) => {
    // Allow typing partial hex; only sync color picker when valid 7-char hex
    if (/^#[0-9a-fA-F]{0,6}$/.test(raw)) onChange(raw);
  };
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  return (
    <div>
      <label className="text-[10px] text-zinc-500 mb-1 block">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={pickerValue}
          onChange={e => onChange(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 p-0 flex-shrink-0"
          title="Pick color"
        />
        <input
          type="text"
          value={value}
          onChange={e => handleHexChange(e.target.value)}
          className="flex-1 min-w-0 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white font-mono focus:outline-none focus:border-orange-500"
          maxLength={7}
          placeholder="#000000"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function BannerPropertiesEditor({
  clip,
  onUpdateBanner,
  onUpdateDuration,
  onClose,
}: {
  clip: TimelineClip;
  onUpdateBanner?: (clipId: string, bannerData: BannerData) => void;
  onUpdateDuration?: (clipId: string, duration: number) => void;
  onClose: () => void;
}) {
  const banner = clip.bannerData!;
  const [line1, setLine1] = useState(banner.lines[0] || '');
  const [line2, setLine2] = useState(banner.lines[1] || '');
  const [bgcolor, setBgcolor] = useState(banner.bgcolor || '#1a2a4a');
  const [textcolor, setTextcolor] = useState(banner.textcolor || '#ffffff');
  const [fontFamily, setFontFamily] = useState(banner.fontFamily || 'Inter');
  const [durationSec, setDurationSec] = useState(clip.duration ?? 8);

  const handleSave = useCallback(() => {
    if (onUpdateBanner) {
      const lines = [line1, line2].filter(l => l.trim() !== '');
      onUpdateBanner(clip.id, {
        ...banner,
        lines,
        bgcolor,
        textcolor,
        fontFamily,
      });
    }
    if (onUpdateDuration) {
      const d = Math.max(0.1, durationSec);
      onUpdateDuration(clip.id, d);
    }
  }, [clip.id, banner, line1, line2, bgcolor, textcolor, fontFamily, durationSec, onUpdateBanner, onUpdateDuration]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50">
        <span className="text-xs font-medium text-zinc-400">Lower Third</span>
        <button onClick={onClose} className="p-1 hover:bg-zinc-700 rounded transition-colors" title="Deselect clip">
          <X className="w-3.5 h-3.5 text-zinc-500" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Text lines */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Type className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Text</span>
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Name / Line 1</label>
              <input
                type="text"
                value={line1}
                onChange={e => setLine1(e.target.value)}
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none focus:border-orange-500"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Title / Line 2 (optional)</label>
              <input
                type="text"
                value={line2}
                onChange={e => setLine2(e.target.value)}
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none focus:border-orange-500"
                placeholder="CEO & Founder"
              />
            </div>
          </div>
        </div>

        {/* Font */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CaseSensitive className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Font</span>
          </div>
          <select
            value={fontFamily}
            onChange={e => setFontFamily(e.target.value)}
            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none focus:border-orange-500"
            style={{ fontFamily }}
          >
            {BANNER_FONTS.map(f => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>
        </div>

        {/* Duration */}
        <div>
          <label className="text-[10px] text-zinc-500 mb-1 block">Duration (seconds)</label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={durationSec}
            onChange={e => setDurationSec(parseFloat(e.target.value) || 8)}
            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Colors */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Palette className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Colors</span>
          </div>
          <div className="space-y-2">
            <ColorInput label="Background" value={bgcolor} onChange={setBgcolor} />
            <ColorInput label="Text" value={textcolor} onChange={setTextcolor} />
          </div>
        </div>

        {/* Live preview */}
        <div>
          <label className="text-[10px] text-zinc-500 mb-1.5 block">Preview</label>
          <div
            className="rounded px-3 py-2"
            style={{ backgroundColor: bgcolor, opacity: 0.92 }}
          >
            {(line1 || line2) ? (
              <>
                {line1 && <div className="text-sm font-bold" style={{ color: textcolor, fontFamily }}>{line1}</div>}
                {line2 && <div className="text-xs font-semibold mt-0.5" style={{ color: textcolor, fontFamily }}>{line2}</div>}
              </>
            ) : (
              <div className="text-xs text-zinc-500 italic">Enter text above</div>
            )}
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-zinc-800/50">
        <button
          onClick={handleSave}
          disabled={!onUpdateBanner}
          className="w-full px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-xs font-medium transition-colors text-white"
        >
          Apply Changes
        </button>
      </div>
    </div>
  );
}

export default function ClipPropertiesPanel({
  clip,
  asset,
  onUpdateTransform,
  onClose,
  onFaceCrop,
  onUpdateBanner,
  onUpdateDuration,
}: ClipPropertiesPanelProps) {
  const [cropAspect, setCropAspect] = useState('9:16');
  const [isCropping, setIsCropping] = useState(false);
  const [cropResult, setCropResult] = useState<string | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);

  const handleSmartCrop = useCallback(async () => {
    if (!onFaceCrop || !clip || !asset) return;
    setIsCropping(true);
    setCropResult(null);
    setCropError(null);
    try {
      const result = await onFaceCrop(asset.id, cropAspect);
      const faceMsg = `${result.facesDetected} face${result.facesDetected !== 1 ? 's' : ''} detected`;
      const bannerMsg = result.bannerDetected
        ? ` • ${result.bannerCount} lower-third${result.bannerCount !== 1 ? 's' : ''} added to V2`
        : '';
      setCropResult(`Cropped to ${cropAspect} – ${faceMsg}${bannerMsg}`);
    } catch (err) {
      setCropError(err instanceof Error ? err.message : 'Smart crop failed');
    } finally {
      setIsCropping(false);
    }
  }, [onFaceCrop, clip, asset, cropAspect]);

  // Banner clip — show lower-third editor instead of transform panel
  if (clip?.bannerData) {
    return (
      <BannerPropertiesEditor
        clip={clip}
        onUpdateBanner={onUpdateBanner}
        onUpdateDuration={onUpdateDuration}
        onClose={onClose}
      />
    );
  }

  if (!clip || !asset) {
    return (
      <div className="p-3 text-center text-zinc-500 text-xs">
        Select a clip to edit its properties
      </div>
    );
  }

  const transform = clip.transform || {};

  const handleScaleChange = useCallback((value: number) => {
    onUpdateTransform(clip.id, { ...transform, scale: value });
  }, [clip.id, transform, onUpdateTransform]);

  const handleRotationChange = useCallback((value: number) => {
    onUpdateTransform(clip.id, { ...transform, rotation: value });
  }, [clip.id, transform, onUpdateTransform]);

  const handlePositionChange = useCallback((axis: 'x' | 'y', value: number) => {
    onUpdateTransform(clip.id, { ...transform, [axis]: value });
  }, [clip.id, transform, onUpdateTransform]);

  const handleCropChange = useCallback((side: 'cropTop' | 'cropBottom' | 'cropLeft' | 'cropRight', value: number) => {
    onUpdateTransform(clip.id, { ...transform, [side]: value });
  }, [clip.id, transform, onUpdateTransform]);

  const handleReset = useCallback(() => {
    onUpdateTransform(clip.id, {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
      cropTop: 0,
      cropBottom: 0,
      cropLeft: 0,
      cropRight: 0,
    });
  }, [clip.id, onUpdateTransform]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50">
        <span className="text-xs font-medium text-zinc-400">Clip Properties</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-zinc-700 rounded transition-colors"
          title="Deselect clip"
        >
          <X className="w-3.5 h-3.5 text-zinc-500" />
        </button>
      </div>

      {/* Clip info */}
      <div className="px-3 py-2 border-b border-zinc-800/50">
        <div className="text-xs text-white font-medium truncate">{asset.filename}</div>
        <div className="text-[10px] text-zinc-500 mt-0.5">
          {asset.type} • {asset.width && asset.height ? `${asset.width}x${asset.height}` : 'N/A'}
        </div>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Scale */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Move className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Scale</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.05"
              value={transform.scale ?? 1}
              onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
              className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
            <span className="text-xs text-zinc-400 w-12 text-right">
              {((transform.scale ?? 1) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Rotation */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <RotateCw className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Rotation</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={transform.rotation ?? 0}
              onChange={(e) => handleRotationChange(parseFloat(e.target.value))}
              className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
            <span className="text-xs text-zinc-400 w-12 text-right">
              {(transform.rotation ?? 0).toFixed(0)}°
            </span>
          </div>
        </div>

        {/* Position */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Move className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Position</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">X</label>
              <input
                type="number"
                value={transform.x ?? 0}
                onChange={(e) => handlePositionChange('x', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Y</label>
              <input
                type="number"
                value={transform.y ?? 0}
                onChange={(e) => handlePositionChange('y', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
              />
            </div>
          </div>
        </div>

        {/* Crop */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Crop className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-300">Crop</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Top %</label>
              <input
                type="number"
                min="0"
                max="50"
                value={transform.cropTop ?? 0}
                onChange={(e) => handleCropChange('cropTop', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Bottom %</label>
              <input
                type="number"
                min="0"
                max="50"
                value={transform.cropBottom ?? 0}
                onChange={(e) => handleCropChange('cropBottom', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Left %</label>
              <input
                type="number"
                min="0"
                max="50"
                value={transform.cropLeft ?? 0}
                onChange={(e) => handleCropChange('cropLeft', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 mb-1 block">Right %</label>
              <input
                type="number"
                min="0"
                max="50"
                value={transform.cropRight ?? 0}
                onChange={(e) => handleCropChange('cropRight', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white"
              />
            </div>
          </div>
        </div>

        {/* Smart Crop */}
        {asset.type === 'video' && onFaceCrop && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crop className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-xs font-medium text-zinc-300">Smart Crop</span>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2">Keep faces in frame when reformatting</p>
            <div className="flex gap-1 mb-2">
              {(['9:16', '1:1', '16:9'] as const).map(ar => (
                <button
                  key={ar}
                  onClick={() => { setCropAspect(ar); setCropResult(null); setCropError(null); }}
                  className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    cropAspect === ar
                      ? 'bg-orange-500 text-white'
                      : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  {ar}
                </button>
              ))}
            </div>
            <button
              onClick={handleSmartCrop}
              disabled={isCropping}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-xs font-medium transition-colors text-white"
            >
              {isCropping ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Cropping...
                </>
              ) : (
                `Crop to ${cropAspect}`
              )}
            </button>
            {cropResult && (
              <p className="text-[10px] text-green-400 mt-1.5">{cropResult}</p>
            )}
            {cropError && (
              <p className="text-[10px] text-red-400 mt-1.5">{cropError}</p>
            )}
          </div>
        )}

      </div>

      {/* Reset button */}
      <div className="p-3 border-t border-zinc-800/50">
        <button
          onClick={handleReset}
          className="w-full px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs font-medium transition-colors"
        >
          Reset All
        </button>
      </div>
    </div>
  );
}
