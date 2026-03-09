import { useState, useCallback, useRef, useEffect } from 'react';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const WORKER_TOKEN = import.meta.env.VITE_WORKER_SECRET_TOKEN || '';
// R2_PUBLIC_URL disponible via VITE_R2_PUBLIC_URL (utilisÃ© dans les presigned URLs cÃ´tÃ© worker)
const PROJECT_STORAGE_KEY = 'argos-project';
const SESSION_STORAGE_KEY = 'argos-session';

// Asset - source file in library
export interface Asset {
  id: string;
  type: 'video' | 'image' | 'audio';
  filename: string;
  duration: number;
  size: number;
  width?: number;
  height?: number;
  thumbnailUrl: string | null;
  streamUrl?: string; // URL with cache-busting timestamp
  aiGenerated?: boolean; // True if this is a Remotion-generated animation
  sourceAssetId?: string; // Set on face-cropped assets ÃÂ¢ÃÂÃÂ points to the original
  cropAspectRatio?: string; // Aspect ratio used when face-cropping ('9:16' | '1:1' | '16:9')
  bannerSegments?: { lines: string[]; startTime: number; endTime: number }[]; // Detected lower-thirds
}

// TimelineClip - instance on timeline
export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  start: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  transform?: {
    x?: number;
    y?: number;
    scale?: number;
    rotation?: number;
    opacity?: number;
    cropTop?: number;
    cropBottom?: number;
    cropLeft?: number;
    cropRight?: number;
  };
  // Lower-third banner overlay (no asset file ÃÂ¢ÃÂÃÂ rendered as HTML in preview)
  bannerData?: {
    lines: string[];
    bgcolor: string;
    textcolor: string;
    fontFamily?: string;   // e.g. 'Inter' | 'Roboto' | 'Poppins' | 'Montserrat' | 'Oswald' | 'Bebas Neue'
    sourceAssetId: string; // Root original asset ID (for re-crop cleanup)
    cropAspectRatio: string; // Aspect ratio of the cropped video ('9:16' | '1:1' | '16:9')
  };
}

// Track
export interface Track {
  id: string;
  type: 'video' | 'audio' | 'text';
  name: string;
  order: number;
}

// Caption word with timing
export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

// Caption styling options
export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold' | 'black';
  color: string;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  position: 'bottom' | 'center' | 'top';
  animation: 'none' | 'karaoke' | 'fade' | 'pop' | 'bounce' | 'typewriter';
  highlightColor?: string;
  timeOffset?: number; // Offset in seconds to adjust sync (negative = earlier, positive = later)
  constrainTo916?: boolean; // Constrain caption width to the 9:16 safe zone (for vertical crop)
}

// Caption clip data (stored alongside TimelineClip)
export interface CaptionData {
  words: CaptionWord[];
  style: CaptionStyle;
}

// Project settings
export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
}

// Project state
export interface ProjectState {
  tracks: Track[];
  clips: TimelineClip[];
  settings: ProjectSettings;
}

// Timeline tab for editing clips in isolation
export interface TimelineTab {
  id: string;
  name: string;
  type: 'main' | 'clip';
  assetId?: string; // For clip tabs, the asset being edited
  clips: TimelineClip[];
}

// Session info
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
}

// Helper to load session from localStorage
function loadSessionFromStorage(): SessionInfo | null {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load session from storage:', e);
  }
  return null;
}

export function useProject() {
  // Initialize session from localStorage if available
  const [session, setSessionInternal] = useState<SessionInfo | null>(loadSessionFromStorage);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tracks, setTracks] = useState<Track[]>([
    { id: 'T1', type: 'text', name: 'T1', order: 0 },   // Captions/text track (top)
    { id: 'V3', type: 'video', name: 'V3', order: 1 },  // Top overlay
    { id: 'V2', type: 'video', name: 'V2', order: 2 },  // Overlay
    { id: 'V1', type: 'video', name: 'V1', order: 3 },  // Base video track
    { id: 'A1', type: 'audio', name: 'A1', order: 4 },  // Audio track 1
    { id: 'A2', type: 'audio', name: 'A2', order: 5 },  // Audio track 2
  ]);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [captionData, setCaptionData] = useState<Record<string, CaptionData>>({});
  const [projectFilename, setProjectFilename] = useState('My Project');

  // Timeline tabs for editing clips in isolation
  const [timelineTabs, setTimelineTabs] = useState<TimelineTab[]>([
    { id: 'main', name: 'Main', type: 'main', clips: [] }
  ]);
  const [activeTabId, setActiveTabId] = useState('main');

  // DEBUG: Track when activeTabId changes
  const prevActiveTabIdRef = useRef(activeTabId);
  useEffect(() => {
    if (prevActiveTabIdRef.current !== activeTabId) {
      console.log('=================================================');
      console.log('[useProject] ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ activeTabId CHANGED!');
      console.log(`  FROM: "${prevActiveTabIdRef.current}" TO: "${activeTabId}"`);
      console.log('=================================================');
      console.trace('[useProject] Stack trace for activeTabId change:');
      prevActiveTabIdRef.current = activeTabId;
    }
  }, [activeTabId]);

  const [settings, setSettings] = useState<ProjectSettings>({
    width: 1920,
    height: 1080,
    fps: 30,
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [renderProgress, setRenderProgress] = useState<number | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs to track latest state values for saveProject (avoids stale closure issues)
  const tracksRef = useRef(tracks);
  const clipsRef = useRef(clips);
  const settingsRef = useRef(settings);
  const captionDataRef = useRef(captionData);
  const projectFilenameRef = useRef(projectFilename);

  // Keep refs in sync with state
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { captionDataRef.current = captionData; }, [captionData]);
  useEffect(() => { projectFilenameRef.current = projectFilename; }, [projectFilename]);

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Undo / Redo (two separate stacks, max 10 undo steps) ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  // undoStack: states to restore when undoing (LIFO ÃÂ¢ÃÂÃÂ last pushed = next undo target)
  // redoStack: states saved during undo, restored by redo
  type HistorySnapshot = { clips: TimelineClip[]; captionData: Record<string, CaptionData> };
  const undoStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const snapshot = (): HistorySnapshot => ({
    clips: JSON.parse(JSON.stringify(clipsRef.current)) as TimelineClip[],
    captionData: JSON.parse(JSON.stringify(captionDataRef.current)) as Record<string, CaptionData>,
  });

  // Call BEFORE any mutating operation to save a restore point.
  const pushHistory = useCallback(() => {
    const stack = [...undoStackRef.current, snapshot()].slice(-10); // cap at 10
    undoStackRef.current = stack;
    redoStackRef.current = [];   // branching off clears redo history
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    // Save current state so redo can come back
    redoStackRef.current = [...redoStackRef.current, snapshot()];
    // Restore last saved state
    const target = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setClips(JSON.parse(JSON.stringify(target.clips)));
    setCaptionData(JSON.parse(JSON.stringify(target.captionData)));
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    // Save current state so undo can come back
    undoStackRef.current = [...undoStackRef.current, snapshot()];
    // Restore last undone state
    const target = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    setClips(JSON.parse(JSON.stringify(target.clips)));
    setCaptionData(JSON.parse(JSON.stringify(target.captionData)));
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  // Wrapper to persist session to localStorage
  const setSession = useCallback((sessionOrUpdater: SessionInfo | null | ((prev: SessionInfo | null) => SessionInfo | null)) => {
    setSessionInternal(prev => {
      const newSession = typeof sessionOrUpdater === 'function' ? sessionOrUpdater(prev) : sessionOrUpdater;
      if (newSession) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
      return newSession;
    });
  }, []);

  // Check if local server is available
  const checkServer = useCallback(async (): Promise<boolean> => {
    if (serverAvailable !== null) return serverAvailable;

    try {
      const response = await fetch(`${WORKER_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      const data = await response.json();
      const available = data.status === 'ok';
      setServerAvailable(available);
      return available;
    } catch {
      setServerAvailable(false);
      return false;
    }
  }, [serverAvailable]);

  // Session is client-side only — assets stored in R2, no server session validation needed
  // (validateSession removed: Railway does not maintain server sessions)


  // Create a new session
  const createSession = useCallback(async (): Promise<SessionInfo> => {
    // We'll create a session by uploading the first asset
    // For now, just generate a client-side session ID that will be
    // confirmed when we upload the first file
    const tempId = crypto.randomUUID();
    const sessionInfo: SessionInfo = {
      sessionId: tempId,
      createdAt: Date.now(),
    };
    return sessionInfo;
  }, []);

  // Upload asset
  const uploadAsset = useCallback(async (file: File): Promise<Asset> => {
    setLoading(true);
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    setStatus(`Uploading ${file.name} (${fileSizeMB} MB)...`);

    try {
      let currentSession = session;
      if (!currentSession) {
        const sessionInfo: SessionInfo = { sessionId: crypto.randomUUID(), createdAt: Date.now() };
        currentSession = sessionInfo;
        setSession(currentSession);
      }

      // 1. Presigned URL via Railway
      const presignResponse = await fetch(`${WORKER_URL}/api/upload/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WORKER_TOKEN}` },
        body: JSON.stringify({ filename: file.name, fileSize: file.size, mimeType: file.type || 'application/octet-stream' }),
      });
      if (!presignResponse.ok) {
        const err = await presignResponse.json().catch(() => ({}));
        throw new Error(err.error || `Presign failed: ${presignResponse.status}`);
      }
      const { uploadUrl, publicUrl } = await presignResponse.json();

      // 2. Upload direct Ã¢ÂÂ R2
      setStatus(`Uploading ${file.name} to storage...`);
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);

      // 3. MÃÂ©tadonnÃÂ©es locales
      const isVideo = file.type.startsWith('video/');
      const isAudio = file.type.startsWith('audio/');
      const fileType: 'video' | 'image' | 'audio' = isVideo ? 'video' : isAudio ? 'audio' : 'image';
      let duration = 0; let width: number | undefined; let height: number | undefined; let thumbnailUrl: string | null = null;

      if (isVideo) {
        setStatus('Reading video metadata...');
        await new Promise<void>((resolve) => {
          const video = document.createElement('video'); video.preload = 'metadata';
          const url = URL.createObjectURL(file);
          video.onloadedmetadata = () => {
            duration = video.duration || 0; width = video.videoWidth || 1920; height = video.videoHeight || 1080;
            // Generate thumbnail
            video.currentTime = Math.min(1, video.duration * 0.1);
          };
          video.onseeked = () => {
            try {
              const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
              const ctx = canvas.getContext('2d');
              if (ctx) { ctx.drawImage(video, 0, 0, 320, 180); thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7); }
            } catch {}
            URL.revokeObjectURL(url); resolve();
          };
          video.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          video.src = url;
        });
      } else if (isAudio) {
        duration = await new Promise<number>((resolve) => {
          const audio = document.createElement('audio'); audio.preload = 'metadata';
          const url = URL.createObjectURL(file);
          audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(audio.duration || 0); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
          audio.src = url;
        });
      } else { thumbnailUrl = publicUrl; }

      const asset: Asset = { id: crypto.randomUUID(), type: fileType, filename: file.name, duration, size: file.size, width, height, thumbnailUrl, streamUrl: publicUrl };
      setAssets(prev => [...prev, asset]);
      setStatus('');
      return asset;
    } finally { setLoading(false); }
  }, [session, setSession]);

  // Delete asset
  const deleteAsset = useCallback(async (assetId: string): Promise<void> => {
    setAssets(prev => prev.filter(a => a.id !== assetId));
    setClips(prev => prev.filter(c => c.assetId !== assetId));
  }, []);

  // Get asset stream URL — R2 public URL stored in asset.streamUrl
  const getAssetStreamUrl = useCallback((assetId: string): string | null => {
    const asset = assets.find(a => a.id === assetId);
    return asset?.streamUrl ?? null;
  }, [assets]);

  // Refresh assets — assets in R2, in-memory state is source of truth
  const refreshAssets = useCallback(async (): Promise<Asset[]> => {
    return assets;
  }, [assets]);

  // Add clip to timeline
  const addClip = useCallback((
    assetId: string,
    trackId: string,
    start: number,
    duration?: number,
    inPoint?: number,
    outPoint?: number
  ): TimelineClip => {
    const asset = assets.find(a => a.id === assetId);

    // For images, use provided duration or default to 5 seconds
    // For video/audio, use asset duration
    // If asset not found (race condition with refreshAssets), use provided duration or default
    let clipDuration: number;
    if (duration !== undefined) {
      clipDuration = duration;
    } else if (asset) {
      clipDuration = asset.type === 'image' ? 5 : asset.duration;
    } else {
      clipDuration = 5; // Default fallback
      console.warn(`Asset ${assetId} not found in state, using default duration`);
    }

    const clip: TimelineClip = {
      id: crypto.randomUUID(),
      assetId,
      trackId,
      start,
      duration: clipDuration,
      inPoint: inPoint ?? 0,
      outPoint: outPoint ?? clipDuration,
    };

    pushHistory();
    setClips(prev => [...prev, clip]);
    return clip;
  }, [assets, pushHistory]);

  // Update clip
  const updateClip = useCallback((clipId: string, updates: Partial<TimelineClip>): void => {
    setClips(prev => prev.map(c =>
      c.id === clipId ? { ...c, ...updates } : c
    ));
  }, []);

  // Delete clip (with optional ripple/autosnap to shift subsequent clips)
  const deleteClip = useCallback((clipId: string, ripple: boolean = false): void => {
    pushHistory();
    setClips(prev => {
      const clipToDelete = prev.find(c => c.id === clipId);
      if (!clipToDelete) return prev.filter(c => c.id !== clipId);

      // Remove the clip
      const filtered = prev.filter(c => c.id !== clipId);

      // Never ripple caption tracks ÃÂ¢ÃÂÃÂ captions have absolute time positions tied to speech
      if (!ripple || clipToDelete.trackId === 'T1') return filtered;

      // Ripple mode: shift subsequent clips on the same track backward
      const deletedEnd = clipToDelete.start + clipToDelete.duration;
      const gapDuration = clipToDelete.duration;

      return filtered.map(c => {
        // Only shift clips on the same track that start at or after the deleted clip's end
        if (c.trackId === clipToDelete.trackId && c.start >= deletedEnd) {
          return {
            ...c,
            start: Math.max(0, c.start - gapDuration),
          };
        }
        return c;
      });
    });
  }, [pushHistory]);

  // Move clip
  const moveClip = useCallback((clipId: string, newStart: number, newTrackId?: string): void => {
    setClips(prev => prev.map(c => {
      if (c.id !== clipId) return c;
      return {
        ...c,
        start: Math.max(0, newStart),
        trackId: newTrackId ?? c.trackId,
      };
    }));
  }, []);

  // Resize clip (change in/out points or duration)
  const resizeClip = useCallback((clipId: string, newInPoint: number, newOutPoint: number): void => {
    setClips(prev => prev.map(c => {
      if (c.id !== clipId) return c;
      const newDuration = newOutPoint - newInPoint;
      return {
        ...c,
        inPoint: newInPoint,
        outPoint: newOutPoint,
        duration: newDuration,
      };
    }));
  }, []);

  // Split clip at a specific time, creating two clips
  const splitClip = useCallback((clipId: string, splitTime: number): string | null => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return null;

    // Calculate the time within the clip where the split occurs
    const timeInClip = splitTime - clip.start;

    // Validate: split must be within the clip's duration (with small buffer)
    if (timeInClip <= 0.05 || timeInClip >= clip.duration - 0.05) {
      return null; // Split too close to edge
    }

    pushHistory();

    // Calculate the in-point offset for the split
    const splitInPoint = clip.inPoint + timeInClip;

    // Create the second clip (after the split)
    const secondClip: TimelineClip = {
      id: crypto.randomUUID(),
      assetId: clip.assetId,
      trackId: clip.trackId,
      start: splitTime,
      duration: clip.duration - timeInClip,
      inPoint: splitInPoint,
      outPoint: clip.outPoint,
      transform: clip.transform ? { ...clip.transform } : undefined,
    };

    // Update the first clip (before the split) and add the second clip
    setClips(prev => [
      ...prev.map(c => {
        if (c.id !== clipId) return c;
        return {
          ...c,
          duration: timeInClip,
          outPoint: splitInPoint,
        };
      }),
      secondClip,
    ]);

    return secondClip.id;
  }, [clips, pushHistory]);

  // Create a new timeline tab for editing a clip/animation in isolation
  const createTimelineTab = useCallback((name: string, assetId: string, initialClips?: TimelineClip[]): string => {
    const tabId = crypto.randomUUID();
    const newTab: TimelineTab = {
      id: tabId,
      name,
      type: 'clip',
      assetId,
      clips: initialClips || [],
    };

    setTimelineTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);

    return tabId;
  }, []);

  // Switch to a different timeline tab
  const switchTimelineTab = useCallback((tabId: string): void => {
    console.log('[switchTimelineTab] Switching to tab:', tabId);
    console.trace('[switchTimelineTab] Call stack:');
    setActiveTabId(tabId);
  }, []);

  // Close a timeline tab (cannot close main)
  const closeTimelineTab = useCallback((tabId: string): void => {
    console.log('[closeTimelineTab] Attempting to close tab:', tabId);
    console.trace('[closeTimelineTab] Call stack:');
    if (tabId === 'main') return; // Cannot close main tab

    setTimelineTabs(prev => prev.filter(tab => tab.id !== tabId));

    // If closing the active tab, switch to main
    setActiveTabId(currentId => {
      if (currentId === tabId) {
        console.log('[closeTimelineTab] Active tab is being closed, switching to main');
        return 'main';
      }
      return currentId;
    });
  }, []);

  // Update clips in a specific tab
  const updateTabClips = useCallback((tabId: string, clips: TimelineClip[]): void => {
    setTimelineTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, clips } : tab
    ));
  }, []);

  // Update a tab's animation asset (used when editing an animation - now in-place)
  // This updates the V1 clip duration (asset ID stays the same for in-place edits)
  const updateTabAsset = useCallback((tabId: string, newAssetId: string, newDuration: number): void => {
    console.log('[updateTabAsset] Called with:', { tabId, newAssetId, newDuration });

    setTimelineTabs(prev => {
      const updatedTabs = prev.map(tab => {
        if (tab.id !== tabId) return tab;

        console.log('[updateTabAsset] Found tab to update:', {
          tabId: tab.id,
          currentAssetId: tab.assetId,
          newAssetId,
          isSameAsset: tab.assetId === newAssetId,
        });

        // Update the V1 clip to point to the new asset
        const updatedClips = tab.clips.map(clip => {
          if (clip.trackId === 'V1') {
            console.log('[updateTabAsset] Updating V1 clip:', {
              oldAssetId: clip.assetId,
              newAssetId,
              oldDuration: clip.duration,
              newDuration,
            });
            return {
              ...clip,
              assetId: newAssetId,
              duration: newDuration,
              outPoint: newDuration,
            };
          }
          return clip;
        });

        return {
          ...tab,
          assetId: newAssetId,
          clips: updatedClips,
        };
      });

      console.log('[updateTabAsset] Updated tabs:', updatedTabs.map(t => ({
        id: t.id,
        assetId: t.assetId,
        clipCount: t.clips.length,
      })));

      return updatedTabs;
    });
  }, []);

  // Get the active timeline tab
  const getActiveTab = useCallback((): TimelineTab | undefined => {
    return timelineTabs.find(tab => tab.id === activeTabId);
  }, [timelineTabs, activeTabId]);

  // Default caption style
  const defaultCaptionStyle: CaptionStyle = {
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    strokeColor: '#000000',
    strokeWidth: 2,
    position: 'bottom',
    animation: 'karaoke',
    highlightColor: '#FFD700',
  };

  // Add caption clip to timeline
  const addCaptionClip = useCallback((
    words: CaptionWord[],
    start: number,
    duration: number,
    style?: Partial<CaptionStyle>
  ): TimelineClip => {
    const clipId = crypto.randomUUID();

    // Create the timeline clip
    const clip: TimelineClip = {
      id: clipId,
      assetId: '', // No asset for captions
      trackId: 'T1',
      start,
      duration,
      inPoint: 0,
      outPoint: duration,
    };

    // Store caption data separately
    const captionInfo: CaptionData = {
      words,
      style: { ...defaultCaptionStyle, ...style },
    };

    pushHistory();
    setClips(prev => [...prev, clip]);
    setCaptionData(prev => ({ ...prev, [clipId]: captionInfo }));

    return clip;
  }, [pushHistory]);

  // Add multiple caption clips at once (batched for performance)
  const addCaptionClipsBatch = useCallback((
    captions: Array<{
      words: CaptionWord[];
      start: number;
      duration: number;
      style?: Partial<CaptionStyle>;
    }>
  ): TimelineClip[] => {
    const newClips: TimelineClip[] = [];
    const newCaptionData: Record<string, CaptionData> = {};

    for (const caption of captions) {
      const clipId = crypto.randomUUID();

      newClips.push({
        id: clipId,
        assetId: '',
        trackId: 'T1',
        start: caption.start,
        duration: caption.duration,
        inPoint: 0,
        outPoint: caption.duration,
      });

      newCaptionData[clipId] = {
        words: caption.words,
        style: { ...defaultCaptionStyle, ...caption.style },
      };
    }

    // Single state update for all clips
    pushHistory();
    setClips(prev => [...prev, ...newClips]);
    setCaptionData(prev => ({ ...prev, ...newCaptionData }));

    return newClips;
  }, [pushHistory]);

  // Update caption style
  const updateCaptionStyle = useCallback((clipId: string, styleUpdates: Partial<CaptionStyle>): void => {
    pushHistory();
    setCaptionData(prev => {
      const existing = prev[clipId];
      if (!existing) return prev;
      return {
        ...prev,
        [clipId]: {
          ...existing,
          style: { ...existing.style, ...styleUpdates },
        },
      };
    });
  }, [pushHistory]);

  // Update caption words (text editing), remapping timestamps to fit new word count
  const updateCaptionWords = useCallback((clipId: string, newText: string): void => {
    setCaptionData(prev => {
      const existing = prev[clipId];
      if (!existing) return prev;
      const newWordTokens = newText.trim().split(/\s+/).filter(w => w.length > 0);
      const oldWords = existing.words;
      const totalStart = oldWords[0]?.start ?? 0;
      const totalEnd = oldWords[oldWords.length - 1]?.end ?? totalStart + 1;
      const avgDuration = oldWords.length > 0 ? (totalEnd - totalStart) / oldWords.length : 0.3;
      const updatedWords: CaptionWord[] = newWordTokens.map((text, i) => {
        if (i < oldWords.length) {
          return { text, start: oldWords[i].start, end: oldWords[i].end };
        }
        // Extra words appended: extend from the last known timestamp
        const prev2 = i > 0 ? updatedWords[i - 1] : oldWords[oldWords.length - 1];
        const start = prev2 ? prev2.end : totalEnd;
        return { text, start, end: start + avgDuration };
      });
      return { ...prev, [clipId]: { ...existing, words: updatedWords } };
    });
  }, []);

  // Get caption data for a clip
  const getCaptionData = useCallback((clipId: string): CaptionData | null => {
    return captionData[clipId] || null;
  }, [captionData]);

  // Save project to server (debounced)
  // Uses refs to always get latest state, avoiding stale closure issues
  const saveProject = useCallback(async (): Promise<void> => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ clips: clipsRef.current, settings: settingsRef.current, captionData: captionDataRef.current, projectFilename: projectFilenameRef.current }));
      } catch (e) { console.error('[Project] Save failed:', e); }
    }, 500);
  }, []);

  // Load project from localStorage (assets in R2, project state persisted locally)
  const loadProject = useCallback(async (): Promise<void> => {
    try {
      const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.clips) setClips(data.clips);
        if (data.settings) setSettings(data.settings);
        if (data.captionData) setCaptionData(data.captionData);
        if (data.projectFilename) setProjectFilename(data.projectFilename);
      }
    } catch (error) {
      console.error('[Project] Load failed:', error);
    }
  }, []);

  // Render project
  // Uses refs to always get latest state
  const renderProject = useCallback(async (preview = false, exportWidth?: number, exportHeight?: number): Promise<string> => {
    if (!session) throw new Error('No session');

    setLoading(true);
    setRenderProgress(0);
    setStatus(preview ? 'Rendering preview...' : 'Rendering export...');

    // Start polling progress every second
    progressIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${WORKER_URL}/session/${session.sessionId}/progress`);
        if (res.ok) {
          const prog = await res.json();
          setRenderProgress(prog.progress ?? 0);
        }
      } catch {
        // ignore polling errors
      }
    }, 1000);

    try {
      // Save project first - use refs to get latest state (include captionData for burn-in)
      await fetch(`${WORKER_URL}/session/${session.sessionId}/project`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracks: tracksRef.current,
          clips: clipsRef.current,
          settings: settingsRef.current,
          captionData: captionDataRef.current,
          projectFilename: projectFilenameRef.current,
        }),
      });

      const renderBody: Record<string, unknown> = { preview };
      if (exportWidth) renderBody.width = exportWidth;
      if (exportHeight) renderBody.height = exportHeight;

      const response = await fetch(`${WORKER_URL}/session/${session.sessionId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renderBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Render failed');
      }

      const result = await response.json();
      setRenderProgress(100);
      setStatus('Render complete!');

      // Return download URL ÃÂ¢ÃÂÃÂ include dimensions so server can compute the format label
      let downloadUrl = `${WORKER_URL}${result.downloadUrl}`;
      if (!preview && exportWidth && exportHeight) {
        downloadUrl += `?w=${exportWidth}&h=${exportHeight}`;
      }
      return downloadUrl;
    } finally {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setLoading(false);
      setTimeout(() => {
        setStatus('');
        setRenderProgress(null);
      }, 2000);
    }
  }, [session]);

  // Get total project duration
  const getDuration = useCallback((): number => {
    if (clips.length === 0) return 0;
    return Math.max(...clips.map(c => c.start + c.duration));
  }, [clips]);

  // Create animated GIF from an image asset
  const createGif = useCallback(async (
    sourceAssetId: string,
    options: {
      effect?: 'pulse' | 'zoom' | 'rotate' | 'bounce' | 'fade' | 'shake';
      duration?: number;
      fps?: number;
      width?: number;
      height?: number;
    } = {}
  ): Promise<Asset> => {
    if (!session) throw new Error('No session');

    setLoading(true);
    setStatus('Creating animated GIF...');

    try {
      const response = await fetch(`${WORKER_URL}/session/${session.sessionId}/create-gif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceAssetId,
          ...options,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'GIF creation failed');
      }

      const result = await response.json();
      const asset: Asset = {
        id: result.asset.id,
        type: result.asset.type,
        filename: result.asset.filename,
        duration: result.asset.duration,
        size: result.asset.size,
        width: result.asset.width,
        height: result.asset.height,
        thumbnailUrl: result.asset.thumbnailUrl
          ? `${WORKER_URL}${result.asset.thumbnailUrl}`
          : null,
      };

      setAssets(prev => [...prev, asset]);
      setStatus('GIF created!');
      return asset;
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(''), 2000);
    }
  }, [session]);

  // Close session
  const closeSession = useCallback(async (): Promise<void> => {
    if (session) {
      try {
        await fetch(`${WORKER_URL}/session/${session.sessionId}`, {
          method: 'DELETE',
        });
      } catch {}
    }
    setSession(null);
    setAssets([]);
    setClips([]);
  }, [session]);

  // Auto-save when clips change
  // Note: This is commented out to prevent excessive saves during drag operations
  // useEffect(() => {
  //   if (session && clips.length > 0) {
  //     saveProject();
  //   }
  // }, [clips, session, saveProject]);

  return {
    // State
    session,
    assets,
    tracks,
    clips,
    settings,
    loading,
    status,
    serverAvailable,
    renderProgress,

    // Session
    checkServer,
    createSession,
    closeSession,

    // Assets
    uploadAsset,
    deleteAsset,
    getAssetStreamUrl,
    refreshAssets,
    createGif,

    // Undo / Redo
    undo,
    redo,
    canUndo,
    canRedo,
    pushHistory,

    // Clips
    addClip,
    updateClip,
    deleteClip,
    moveClip,
    resizeClip,
    splitClip,

    // Captions
    captionData,
    addCaptionClip,
    addCaptionClipsBatch,
    updateCaptionStyle,
    updateCaptionWords,
    getCaptionData,

    // Project
    saveProject,
    loadProject,
    renderProject,
    getDuration,

    // Project name
    projectFilename,
    setProjectFilename,

    // Setters for direct state manipulation
    setTracks,
    setClips,
    setSettings,

    // Timeline tabs
    timelineTabs,
    activeTabId,
    createTimelineTab,
    switchTimelineTab,
    closeTimelineTab,
    updateTabClips,
    updateTabAsset,
    getActiveTab,
  };
}
