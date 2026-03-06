import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ZoomIn, ZoomOut, Play, Pause, SkipBack, Scissors, Trash2, Type, RectangleHorizontal, RectangleVertical, Link, Unlink } from 'lucide-react';
import TimelineClip from './TimelineClip';
import type { Track, TimelineClip as TimelineClipType, Asset, CaptionData } from '@/react-app/hooks/useProject';

interface TimelineProps {
  tracks: Track[];
  clips: TimelineClipType[];
  assets: Asset[];
  selectedClipId: string | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  aspectRatio: '16:9' | '9:16';
  onSelectClip: (id: string | null) => void;
  onTimeChange: (time: number) => void;
  onPlayPause: () => void;
  onStop: () => void;
  onMoveClip: (clipId: string, newStart: number, newTrackId?: string) => void;
  onResizeClip: (clipId: string, newInPoint: number, newOutPoint: number, newStart?: number) => void;
  onDeleteClip: (clipId: string) => void;
  onCutAtPlayhead: () => void;
  onAddText: () => void;
  onToggleAspectRatio: () => void;
  autoSnap?: boolean;
  onToggleAutoSnap?: () => void;
  onDropAsset: (asset: Asset, trackId: string, time: number) => void;
  onSave: () => void;
  getCaptionData?: (clipId: string) => CaptionData | null;
}

const TRACK_HEIGHTS: Record<string, number> = {
  video: 56,
  audio: 44,
  text: 48,
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function Timeline({
  tracks,
  clips,
  assets,
  selectedClipId,
  currentTime,
  duration,
  isPlaying,
  aspectRatio,
  onSelectClip,
  onTimeChange,
  onPlayPause,
  onStop,
  onMoveClip,
  onResizeClip,
  onDeleteClip,
  onCutAtPlayhead,
  onAddText,
  onToggleAspectRatio,
  autoSnap = true,
  onToggleAutoSnap,
  onDropAsset,
  onSave,
  getCaptionData,
}: TimelineProps) {
  const [zoom, setZoom] = useState(1);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [dragOverTrack, setDragOverTrack] = useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isDrawingSelection, setIsDrawingSelection] = useState(false);

  const timelineRef = useRef<HTMLDivElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);

  // Refs for stale-closure–safe access inside document event handlers
  const clipsRef = useRef(clips);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  const multiSelectedIdsRef = useRef(multiSelectedIds);
  useEffect(() => { multiSelectedIdsRef.current = multiSelectedIds; }, [multiSelectedIds]);
  const selectionBoxRef = useRef(selectionBox);
  useEffect(() => { selectionBoxRef.current = selectionBox; }, [selectionBox]);
  const multiDragInitialStarts = useRef<Map<string, number> | null>(null);

  // Sync vertical scroll between track headers and tracks content
  useEffect(() => {
    const tracksContainer = tracksContainerRef.current;
    const trackHeaders = trackHeadersRef.current;
    if (!tracksContainer || !trackHeaders) return;

    const handleScroll = () => {
      trackHeaders.scrollTop = tracksContainer.scrollTop;
    };

    tracksContainer.addEventListener('scroll', handleScroll);
    return () => tracksContainer.removeEventListener('scroll', handleScroll);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (multiSelectedIdsRef.current.size > 1) {
        multiSelectedIdsRef.current.forEach(id => onDeleteClip(id));
        setMultiSelectedIds(new Set());
      } else if (selectedClipId) {
        onDeleteClip(selectedClipId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, onDeleteClip]);

  // Calculate display properties
  const totalDuration = Math.max(duration, 10);
  const basePixelsPerSecond = Math.min(100, 2000 / totalDuration);
  const pixelsPerSecond = basePixelsPerSecond * zoom;
  const timelineWidth = Math.max(totalDuration * pixelsPerSecond, 800);

  // Track header width
  const headerWidth = 48;

  // Time ruler intervals
  const getTimeInterval = useCallback(() => {
    const effectiveZoom = pixelsPerSecond / 50;
    if (effectiveZoom > 2) return 1;
    if (effectiveZoom > 1) return 5;
    if (effectiveZoom > 0.5) return 10;
    if (effectiveZoom > 0.2) return 30;
    return 60;
  }, [pixelsPerSecond]);

  const timeInterval = getTimeInterval();
  const tickCount = Math.ceil(totalDuration / timeInterval) + 1;

  // Sort tracks by order
  const sortedTracks = useMemo(() =>
    [...tracks].sort((a, b) => a.order - b.order),
    [tracks]
  );

  // Get clips for a specific track
  const getTrackClips = useCallback((trackId: string) =>
    clips.filter(c => c.trackId === trackId),
    [clips]
  );

  // Y pixel bounds of each track in the scrollable content area (ruler = 24px, then tracks stacked)
  const trackYOffsets = useMemo(() => {
    const offsets: Record<string, { top: number; bottom: number }> = {};
    let y = 24; // ruler height (h-6)
    sortedTracks.forEach(track => {
      offsets[track.id] = { top: y, bottom: y + TRACK_HEIGHTS[track.type] };
      y += TRACK_HEIGHTS[track.type];
    });
    return offsets;
  }, [sortedTracks]);

  // Handle clicking on timeline to seek
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!tracksContainerRef.current) return;

    const rect = tracksContainerRef.current.getBoundingClientRect();
    const scrollLeft = tracksContainerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const newTime = Math.max(0, Math.min(clickX / pixelsPerSecond, duration));

    onTimeChange(newTime);
    onSelectClip(null);
  }, [pixelsPerSecond, duration, onTimeChange, onSelectClip]);

  // Handle playhead dragging
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingPlayhead || !tracksContainerRef.current) return;

    const rect = tracksContainerRef.current.getBoundingClientRect();
    const scrollLeft = tracksContainerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const newTime = Math.max(0, Math.min(clickX / pixelsPerSecond, duration));

    onTimeChange(newTime);
  }, [isDraggingPlayhead, pixelsPerSecond, duration, onTimeChange]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingPlayhead(false);
  }, []);

  // Handle drop from asset library
  const handleDragOver = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTrack(trackId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverTrack(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTrack(null);

    const assetData = e.dataTransfer.getData('application/x-hyperedit-asset');
    if (!assetData) return;

    try {
      const asset = JSON.parse(assetData) as Asset;

      // Calculate drop time position
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const scrollLeft = tracksContainerRef.current?.scrollLeft || 0;
      const dropX = e.clientX - rect.left + scrollLeft;
      const dropTime = Math.max(0, dropX / pixelsPerSecond);

      onDropAsset(asset, trackId, dropTime);
    } catch (err) {
      console.error('Failed to parse dropped asset:', err);
    }
  }, [pixelsPerSecond, onDropAsset]);

  // Ctrl+click: toggle clip in multi-selection
  const handleClipCtrlClick = useCallback((clipId: string) => {
    setMultiSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
    onSelectClip(clipId);
  }, [onSelectClip]);

  // Multi-drag: record initial positions of all selected clips at drag start
  const handleMultiDragStart = useCallback(() => {
    const map = new Map<string, number>();
    multiSelectedIdsRef.current.forEach(id => {
      const clip = clipsRef.current.find(c => c.id === id);
      if (clip) map.set(id, clip.start);
    });
    multiDragInitialStarts.current = map;
  }, []);

  // Multi-drag: apply delta to all selected clips from their initial positions
  const handleMultiDragDelta = useCallback((delta: number) => {
    multiDragInitialStarts.current?.forEach((initialStart, clipId) => {
      onMoveClip(clipId, Math.max(0, initialStart + delta));
    });
  }, [onMoveClip]);

  // Rubber band: start selection box on mousedown over empty track area
  const handleTracksMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !tracksContainerRef.current) return;
    const rect = tracksContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + tracksContainerRef.current.scrollLeft;
    const y = e.clientY - rect.top + tracksContainerRef.current.scrollTop;
    setMultiSelectedIds(new Set());
    onSelectClip(null);
    setSelectionBox({ startX: x, startY: y, endX: x, endY: y });
    setIsDrawingSelection(true);
  }, [onSelectClip]);

  // Rubber band: document-level move/up handlers while drawing selection
  useEffect(() => {
    if (!isDrawingSelection) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!tracksContainerRef.current) return;
      const rect = tracksContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + tracksContainerRef.current.scrollLeft;
      const y = e.clientY - rect.top + tracksContainerRef.current.scrollTop;
      setSelectionBox(prev => prev ? { ...prev, endX: x, endY: y } : null);
    };

    const handleMouseUp = () => {
      const box = selectionBoxRef.current;
      if (box) {
        const boxLeft = Math.min(box.startX, box.endX);
        const boxRight = Math.max(box.startX, box.endX);
        const boxTop = Math.min(box.startY, box.endY);
        const boxBottom = Math.max(box.startY, box.endY);
        if (boxRight - boxLeft > 5 || boxBottom - boxTop > 5) {
          const selected = new Set<string>();
          clipsRef.current.forEach(clip => {
            const tb = trackYOffsets[clip.trackId];
            if (!tb) return;
            const clipLeft = clip.start * pixelsPerSecond;
            const clipRight = (clip.start + clip.duration) * pixelsPerSecond;
            if (clipLeft < boxRight && clipRight > boxLeft && tb.top < boxBottom && tb.bottom > boxTop) {
              selected.add(clip.id);
            }
          });
          if (selected.size > 0) {
            setMultiSelectedIds(selected);
            onSelectClip(selected.values().next().value ?? null);
          }
        }
      }
      setIsDrawingSelection(false);
      setSelectionBox(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDrawingSelection, trackYOffsets, pixelsPerSecond, onSelectClip]);

  // Get asset for a clip
  const getAssetForClip = useCallback((clip: TimelineClipType) =>
    assets.find(a => a.id === clip.assetId),
    [assets]
  );

  return (
    <div
      ref={timelineRef}
      className="flex flex-col h-full select-none"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Timeline header */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 border-b border-zinc-700/50">
        <div className="flex items-center gap-3">
          {/* Playback controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={onStop}
              className="p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
              title="Stop (go to start)"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onPlayPause}
              className={`p-1.5 rounded transition-colors ${
                isPlaying
                  ? 'bg-orange-500 hover:bg-orange-600 text-white'
                  : 'bg-zinc-700 hover:bg-zinc-600'
              }`}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Editing tools */}
          <div className="flex items-center gap-1 border-l border-zinc-700 pl-3 ml-1">
            <button
              onClick={onCutAtPlayhead}
              className="p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
              title="Cut at playhead (split clip)"
            >
              <Scissors className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (multiSelectedIds.size > 1) {
                  multiSelectedIds.forEach(id => onDeleteClip(id));
                  setMultiSelectedIds(new Set());
                } else if (selectedClipId) {
                  onDeleteClip(selectedClipId);
                }
              }}
              disabled={!selectedClipId && multiSelectedIds.size === 0}
              className="p-1.5 bg-zinc-700 hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-zinc-700 rounded transition-colors"
              title={multiSelectedIds.size > 1 ? `Delete ${multiSelectedIds.size} selected clips` : 'Delete selected clip (Delete key)'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onAddText}
              className="p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
              title="Add text overlay"
            >
              <Type className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onToggleAspectRatio}
              className="p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
              title={`Currently ${aspectRatio === '16:9' ? '16:9 (horizontal)' : '9:16 (vertical)'} - click to switch`}
            >
              {aspectRatio === '16:9' ? (
                <RectangleHorizontal className="w-3.5 h-3.5" />
              ) : (
                <RectangleVertical className="w-3.5 h-3.5" />
              )}
            </button>
            <div className="w-px h-4 bg-zinc-600" />
            <button
              onClick={onToggleAutoSnap}
              className={`p-1.5 rounded transition-colors ${
                autoSnap
                  ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-400'
              }`}
              title={autoSnap ? 'Auto-snap ON: Clips shift when deleting' : 'Auto-snap OFF: Gaps remain when deleting'}
            >
              {autoSnap ? (
                <Link className="w-3.5 h-3.5" />
              ) : (
                <Unlink className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Time display */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-orange-400">{formatTime(currentTime)}</span>
            <span className="text-zinc-600">/</span>
            <span className="font-mono text-zinc-400">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
            className="p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-zinc-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(Math.min(4, zoom + 0.25))}
            className="p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Timeline content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Track headers (fixed horizontally, syncs vertically) */}
        <div
          className="flex-shrink-0 bg-zinc-900/80 border-r border-zinc-700/50 flex flex-col"
          style={{ width: headerWidth }}
        >
          {/* Spacer for time ruler (sticky) */}
          <div className="h-6 border-b border-zinc-800 flex-shrink-0" />

          {/* Track labels (scrolls vertically with tracks) */}
          <div
            ref={trackHeadersRef}
            className="flex-1 overflow-hidden"
          >
            {sortedTracks.map(track => {
              const trackClipCount = clips.filter(c => c.trackId === track.id).length;

              return (
                <div
                  key={track.id}
                  className="flex items-center justify-center gap-1 text-xs font-medium text-zinc-400 border-b border-zinc-800/50 px-1"
                  style={{ height: TRACK_HEIGHTS[track.type] }}
                >
                  <span className="truncate">{track.name}</span>
                  {trackClipCount > 0 && (
                    <button
                      title={`Delete all ${trackClipCount} clip${trackClipCount > 1 ? 's' : ''} on ${track.name}`}
                      className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-colors flex-shrink-0"
                      onClick={() => {
                        if (confirm(`Delete all ${trackClipCount} clip${trackClipCount > 1 ? 's' : ''} on ${track.name}?`)) {
                          clips
                            .filter(c => c.trackId === track.id)
                            .forEach(c => onDeleteClip(c.id));
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable tracks area */}
        <div
          ref={tracksContainerRef}
          className="flex-1 overflow-auto"
          onMouseMove={handleMouseMove}
        >
          <div
            className="relative"
            style={{ width: timelineWidth, minHeight: '100%' }}
          >
            {/* Time ruler */}
            <div
              className="sticky top-0 h-6 bg-zinc-900/95 border-b border-zinc-800 z-30"
              onClick={handleTimelineClick}
            >
              {Array.from({ length: tickCount }).map((_, i) => {
                const time = i * timeInterval;
                if (time > totalDuration) return null;
                return (
                  <div
                    key={i}
                    className="absolute flex flex-col items-start"
                    style={{ left: `${time * pixelsPerSecond}px` }}
                  >
                    <span className="text-[10px] text-zinc-500 pl-1">{formatTime(time)}</span>
                    <div className="w-px h-2 bg-zinc-700" />
                  </div>
                );
              })}
            </div>

            {/* Tracks */}
            <div onClick={handleTimelineClick} onMouseDown={handleTracksMouseDown}>
              {sortedTracks.map(track => {
                const trackClips = getTrackClips(track.id);
                const isDragOver = dragOverTrack === track.id;

                return (
                  <div
                    key={track.id}
                    className={`relative border-b border-zinc-800/50 ${
                      isDragOver ? 'bg-orange-500/10' : 'bg-zinc-900/30'
                    }`}
                    style={{ height: TRACK_HEIGHTS[track.type] }}
                    onDragOver={(e) => handleDragOver(e, track.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, track.id)}
                  >
                    {/* Track background grid lines */}
                    {Array.from({ length: tickCount }).map((_, i) => {
                      const time = i * timeInterval;
                      if (time > totalDuration) return null;
                      return (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 w-px bg-zinc-800/50"
                          style={{ left: `${time * pixelsPerSecond}px` }}
                        />
                      );
                    })}

                    {/* Empty track placeholder */}
                    {trackClips.length === 0 && !isDragOver && (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600 pointer-events-none">
                        Drop clips here
                      </div>
                    )}

                    {/* Drop indicator */}
                    {isDragOver && (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-orange-400 pointer-events-none border-2 border-dashed border-orange-500/50 rounded">
                        Drop to add clip
                      </div>
                    )}

                    {/* Clips */}
                    {trackClips.map(clip => {
                      const captionData = getCaptionData?.(clip.id);
                      const isCaption = track.type === 'text';
                      const captionWords = captionData?.words ?? [];
                      const captionPreview = captionWords
                        .slice(0, 5)
                        .map(w => w.text)
                        .join(' ') + (captionWords.length > 5 ? '...' : '');

                      return (
                        <TimelineClip
                          key={clip.id}
                          clip={clip}
                          asset={getAssetForClip(clip)}
                          pixelsPerSecond={pixelsPerSecond}
                          isSelected={selectedClipId === clip.id}
                          isMultiSelected={multiSelectedIds.has(clip.id)}
                          trackHeight={TRACK_HEIGHTS[track.type]}
                          onClick={() => {
                            setMultiSelectedIds(new Set());
                            onSelectClip(clip.id);
                          }}
                          onCtrlClick={() => handleClipCtrlClick(clip.id)}
                          onMove={(newStart) => onMoveClip(clip.id, newStart)}
                          onResize={(inPoint, outPoint, newStart) =>
                            onResizeClip(clip.id, inPoint, outPoint, newStart)
                          }
                          onDelete={() => onDeleteClip(clip.id)}
                          onDragEnd={onSave}
                          onMultiDragStart={handleMultiDragStart}
                          onMultiDragDelta={handleMultiDragDelta}
                          isCaption={isCaption}
                          captionPreview={captionPreview}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Rubber band selection box */}
            {selectionBox && (
              <div
                className="absolute pointer-events-none border border-blue-400/80 bg-blue-400/10 z-40 rounded-sm"
                style={{
                  left: Math.min(selectionBox.startX, selectionBox.endX),
                  top: Math.min(selectionBox.startY, selectionBox.endY),
                  width: Math.abs(selectionBox.endX - selectionBox.startX),
                  height: Math.abs(selectionBox.endY - selectionBox.startY),
                }}
              />
            )}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-orange-500 z-50 pointer-events-none"
              style={{ left: `${currentTime * pixelsPerSecond}px` }}
            >
              {/* Playhead handle */}
              <div
                className="absolute -top-0 -left-2.5 w-5 h-5 cursor-ew-resize pointer-events-auto"
                onMouseDown={handlePlayheadMouseDown}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-orange-500" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
