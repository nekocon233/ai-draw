import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type React from 'react';
import {
  Button,
  Checkbox,
  Empty,
  Image as AntImage,
  Input,
  InputNumber,
  Modal,
  Progress,
  Segmented,
  Select,
  Slider,
  Spin,
  Tooltip,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  BgColorsOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
  FilterOutlined,
  LeftOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RetweetOutlined,
  RedoOutlined,
  RightOutlined,
  SearchOutlined,
  SelectOutlined,
  SwapOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import {
  apiService,
  type ImageUpscaleMethod,
  type ImageUpscaleMethodId,
  type VideoBackgroundOptions,
  type VideoFrameExportOutput,
  type VideoFrameExportProgress,
  type VideoFramePreviewItem,
  type VideoFramePreviewResponse,
} from '../api/services';
import { useBackgroundOptions } from '../hooks/useBackgroundOptions';
import {
  DEFAULT_COLOR_REPLACE_TOLERANCE,
  DEFAULT_FILL_TOLERANCE,
  DEFAULT_REPLACE_TOLERANCE,
  DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT,
  DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT_MODE,
  DEFAULT_TRANSPARENT_REPLACE_MATCH_MODE,
  applyHardTransparentReplacement,
  isHardTransparentReplacementTarget,
  type TransparentEdgeEnhancementMode,
  type TransparentReplaceMatchMode,
} from '../utils/frameColorReplacement';
import { getImageUpscaleTarget } from '../utils/imageUpscale';
import BackgroundOptionsFields from './BackgroundOptionsFields';

interface FrameExtractionModalProps {
  open: boolean;
  videoUrl: string | null;
  onClose: () => void;
  onFrameExportGenerated?: (url: string, meta: { output: VideoFrameExportOutput; frames: number; cols?: number; rows?: number }) => void;
}

type WorkbenchStep = 0 | 1 | 2;
type PreviewMode = 'raw' | 'final';
type VideoSpriteMarker = 'loop' | 'jump' | 'duplicate' | 'manual';
type SimilarityMarker = Exclude<VideoSpriteMarker, 'manual'>;
type ReduceKeepPosition = 'first' | 'last';
type CanvasTool = 'brush' | 'eraser' | 'fill' | 'replace' | 'background' | 'soften' | 'upscale';
type EraserMode = 'restore' | 'transparent';
const pendingUpscaleScales = ([2, 4] as const).map(scale => ({
  scale,
  available: false,
  unavailable_reason: '正在检测 ComfyUI 模型',
  model: null,
  native_scale: scale,
  processing_scale: scale,
}));
const defaultUpscaleMethods: ImageUpscaleMethod[] = [
  {
    id: 'lanczos',
    algorithm_id: 'lanczos',
    algorithm_name: 'Lanczos',
    label: 'Lanczos 快速放大',
    description: '高阶 sinc 重采样，速度快，只改变像素尺寸，不生成新细节。',
    architecture: 'Lanczos 重采样（非神经网络）',
    behavior: '非 AI 插值',
    kind: 'local',
    available: true,
    supported_scales: [2, 4],
    scale_availability: ([2, 4] as const).map(scale => ({
      scale,
      available: true,
      native_scale: scale,
      processing_scale: scale,
    })),
  },
  {
    id: 'apisr',
    algorithm_id: 'apisr',
    algorithm_name: 'APISR',
    label: 'APISR 动漫增强',
    description: '面向真实退化动漫素材，强化线条并修复压缩、模糊和缩放损伤。',
    architecture: '显式动漫退化建模 + GAN；2x RRDB / 4x DAT',
    behavior: '感知增强，可能重建纹理',
    license_notice: 'GPL-3.0 代码；官方项目与权重另有“仅限学术用途”声明',
    kind: 'ai',
    available: false,
    supported_scales: [],
    scale_availability: pendingUpscaleScales,
    unavailable_reason: '正在检测 ComfyUI 模型',
  },
  {
    id: 'real_cugan',
    algorithm_id: 'real_cugan',
    algorithm_name: 'Real-CUGAN',
    label: 'Real-CUGAN 动漫保真',
    description: '适合动漫、插画和线稿，增强线条并尽量保留平涂、虚化和原有画风。',
    architecture: 'Cascade U-Net / CUNet + SE 通道注意力',
    behavior: '保真修复',
    license_notice: 'MIT License',
    kind: 'ai',
    available: false,
    supported_scales: [],
    scale_availability: pendingUpscaleScales,
    unavailable_reason: '正在检测 ComfyUI 模型',
  },
  {
    id: 'realesrgan_general',
    algorithm_id: 'realesrgan',
    algorithm_name: 'Real-ESRGAN',
    label: 'Real-ESRGAN 通用',
    description: '适合照片、扫描图和混合内容，去模糊、锐化及纹理重建较强。',
    architecture: 'RRDBNet + 高阶真实退化建模 + GAN',
    behavior: '感知增强，可能改变细小纹理',
    license_notice: 'BSD 3-Clause',
    kind: 'ai',
    available: false,
    supported_scales: [],
    scale_availability: pendingUpscaleScales,
    unavailable_reason: '正在检测 ComfyUI 模型',
  },
  {
    id: 'realesrgan_anime',
    algorithm_id: 'realesrgan',
    algorithm_name: 'Real-ESRGAN',
    label: 'Real-ESRGAN 动漫',
    description: '适合需要明显锐化的动漫和插画；2x 由原生 4x 推理后精确缩小。',
    architecture: '精简 RRDBNet 6B + GAN',
    behavior: '感知增强，线条更强',
    license_notice: 'BSD 3-Clause',
    kind: 'ai',
    available: false,
    supported_scales: [],
    scale_availability: pendingUpscaleScales,
    unavailable_reason: '正在检测 ComfyUI 模型',
  },
  {
    id: 'invsr',
    algorithm_id: 'invsr',
    algorithm_name: 'InvSR',
    label: 'InvSR 生成式修复',
    description: '使用 SD-Turbo 扩散反演重建细节；可能改变文字、脸部、纹理和细小结构。',
    architecture: 'SD-Turbo Diffusion Inversion + Noise Predictor',
    behavior: '生成式修复',
    license_notice: 'NTU S-Lab 1.0，仅限非商业使用',
    kind: 'ai',
    available: false,
    supported_scales: [],
    scale_availability: pendingUpscaleScales,
    unavailable_reason: '正在检测 ComfyUI 模型',
  },
];
const transparentReplaceMatchModeOptions: Array<{ label: string; value: TransparentReplaceMatchMode }> = [
  { label: '全图基础色', value: 'global' },
  { label: '点击连通', value: 'connected' },
  { label: '连续色阶', value: 'continuous' },
];
const transparentReplaceMatchModeHelp: Record<TransparentReplaceMatchMode, string> = {
  global: '扫描整张图片，建立基础容差内的全部同色选区。',
  connected: '只建立与点击位置四向连通、且接近点击颜色的基础选区。',
  continuous: '按相邻像素逐步比较并建立基础选区，可沿渐变颜色累计扩散。',
};
const transparentEdgeEnhancementModeOptions: Array<{ label: string; value: TransparentEdgeEnhancementMode }> = [
  { label: '连通色阶', value: 'connected_color' },
  { label: '全图颜色', value: 'global_color' },
  { label: '硬边扩张', value: 'dilate' },
];
const transparentEdgeEnhancementModeHelp: Record<TransparentEdgeEnhancementMode, string> = {
  connected_color: 'FramePacker 默认增强：扩大颜色阈值，只沿基础选区四向生长。',
  global_color: '扩大后的颜色阈值直接应用整张图片，清理更彻底，也最容易误删主体同色区域。',
  dilate: '忽略颜色，按像素向八方向硬扩张；适合清除窄色边，高值会直接侵蚀主体轮廓。',
};
const MAX_CANVAS_HISTORY_ENTRIES = 30;
const MAX_CANVAS_HISTORY_BYTES = 96 * 1024 * 1024;

interface CanvasHistoryEntry {
  image: ImageData;
  contentDirty: boolean;
}

function trimCanvasHistory(entries: CanvasHistoryEntry[]) {
  let totalBytes = entries.reduce((total, entry) => total + entry.image.data.byteLength, 0);
  while (entries.length > 1 && (entries.length > MAX_CANVAS_HISTORY_ENTRIES || totalBytes > MAX_CANVAS_HISTORY_BYTES)) {
    totalBytes -= entries.shift()!.image.data.byteLength;
  }
}

interface VideoSpriteFrame {
  id: string;
  index: number;
  sourceUrl: string;
  backgroundRemovedUrl?: string;
  editedUrl?: string;
  included: boolean;
  time: number | null;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  markers: VideoSpriteMarker[];
}

interface WorksetColorReplacementOptions {
  targetColor: readonly [number, number, number];
  targetXRatio: number;
  targetYRatio: number;
  replaceWithTransparency: boolean;
  replacementColor: string;
  opacity: number;
  replaceTolerance: number;
  colorReplaceTolerance: number;
  replaceMatchMode: TransparentReplaceMatchMode;
  replaceEdgeCleanup: number;
  replaceEdgeEnhancementMode: TransparentEdgeEnhancementMode;
}

interface FrameDocument {
  frames: VideoSpriteFrame[];
  activeFrameId: string | null;
}

interface FrameHistoryEntry {
  document: FrameDocument;
  label: string;
}

interface FrameHistoryState {
  past: FrameHistoryEntry[];
  present: FrameDocument;
  future: FrameHistoryEntry[];
}

type FrameHistoryAction =
  | { type: 'reset'; document: FrameDocument }
  | { type: 'update'; label: string; recordHistory: boolean; updater: (document: FrameDocument) => FrameDocument }
  | { type: 'undo' }
  | { type: 'redo' };

const MAX_EXPORT_SIZE = 4096;
const MAX_FRAME_HISTORY = 50;
const WORKSET_MULTI_SELECT_HOLD_MS = 250;

const createFrameHistoryState = (): FrameHistoryState => ({
  past: [],
  present: { frames: [], activeFrameId: null },
  future: [],
});

const frameDocumentsEqual = (left: FrameDocument, right: FrameDocument) => {
  if (left === right) return true;
  if (left.activeFrameId !== right.activeFrameId || left.frames.length !== right.frames.length) return false;
  return left.frames.every((frame, index) => {
    const other = right.frames[index];
    return frame === other || (
      frame.id === other.id
      && frame.index === other.index
      && frame.sourceUrl === other.sourceUrl
      && frame.backgroundRemovedUrl === other.backgroundRemovedUrl
      && frame.editedUrl === other.editedUrl
      && frame.included === other.included
      && frame.time === other.time
      && frame.width === other.width
      && frame.height === other.height
      && frame.sourceWidth === other.sourceWidth
      && frame.sourceHeight === other.sourceHeight
      && frame.markers.length === other.markers.length
      && frame.markers.every((marker, markerIndex) => marker === other.markers[markerIndex])
    );
  });
};

const restoreFrameDocument = (snapshot: FrameDocument, current: FrameDocument): FrameDocument => {
  const frames = snapshot.frames;
  const frameIds = new Set(frames.map(frame => frame.id));
  const activeFrameId = current.activeFrameId && frameIds.has(current.activeFrameId)
    ? current.activeFrameId
    : snapshot.activeFrameId && frameIds.has(snapshot.activeFrameId)
      ? snapshot.activeFrameId
      : frames[0]?.id ?? null;
  return { frames, activeFrameId };
};

const frameHistoryReducer = (state: FrameHistoryState, action: FrameHistoryAction): FrameHistoryState => {
  if (action.type === 'reset') {
    return { past: [], present: action.document, future: [] };
  }
  if (action.type === 'update') {
    const next = action.updater(state.present);
    if (frameDocumentsEqual(state.present, next)) return state;
    if (!action.recordHistory) return { ...state, present: next };
    return {
      past: [...state.past, { document: state.present, label: action.label }].slice(-MAX_FRAME_HISTORY),
      present: next,
      future: [],
    };
  }
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return {
      past: state.past.slice(0, -1),
      present: restoreFrameDocument(previous.document, state.present),
      future: [{ document: state.present, label: previous.label }, ...state.future].slice(0, MAX_FRAME_HISTORY),
    };
  }
  const next = state.future[0];
  if (!next) return state;
  return {
    past: [...state.past, { document: state.present, label: next.label }].slice(-MAX_FRAME_HISTORY),
    present: restoreFrameDocument(next.document, state.present),
    future: state.future.slice(1),
  };
};

const formatTimestamp = (value: number | null | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--:--.--';
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
};

const makeFrameId = (prefix = 'frame') => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getFrameDisplayUrl = (frame: VideoSpriteFrame, mode: PreviewMode) => {
  if (mode === 'raw') return frame.sourceUrl;
  return frame.editedUrl || frame.backgroundRemovedUrl || frame.sourceUrl;
};

const getFrameExportUrl = (frame: VideoSpriteFrame) => frame.editedUrl || frame.backgroundRemovedUrl || frame.sourceUrl;

const findClosestReplacementPoint = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  targetColor: readonly [number, number, number],
  expectedX: number,
  expectedY: number,
  tolerance: number,
  euclidean: boolean,
) => {
  let closest: { x: number; y: number; distance: number } | null = null;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    if (source[offset + 3] === 0) continue;
    const redDistance = Math.abs(source[offset] - targetColor[0]);
    const greenDistance = Math.abs(source[offset + 1] - targetColor[1]);
    const blueDistance = Math.abs(source[offset + 2] - targetColor[2]);
    const colorDistance = euclidean
      ? Math.hypot(redDistance, greenDistance, blueDistance)
      : Math.max(redDistance, greenDistance, blueDistance);
    if (colorDistance > tolerance) continue;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const distance = (x - expectedX) ** 2 + (y - expectedY) ** 2;
    if (!closest || distance < closest.distance) closest = { x, y, distance };
  }
  return closest;
};

const applyEdgeConnectedColorReplacement = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  targetColor: readonly [number, number, number],
  replacementColor: string,
  tolerance: number,
  opacity: number,
) => {
  const result = new Uint8ClampedArray(source);
  const seen = new Uint8Array(width * height);
  const selected = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let stackSize = 0;
  let selectedCount = 0;
  const enqueue = (pixelIndex: number) => {
    if (seen[pixelIndex]) return;
    seen[pixelIndex] = 1;
    const offset = pixelIndex * 4;
    const distance = Math.max(
      Math.abs(source[offset] - targetColor[0]),
      Math.abs(source[offset + 1] - targetColor[1]),
      Math.abs(source[offset + 2] - targetColor[2]),
    );
    if (source[offset + 3] === 0 || distance > tolerance) return;
    selected[pixelIndex] = 1;
    selectedCount += 1;
    stack[stackSize++] = pixelIndex;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (stackSize) {
    const pixelIndex = stack[--stackSize];
    const x = pixelIndex % width;
    if (x < width - 1) enqueue(pixelIndex + 1);
    if (x > 0) enqueue(pixelIndex - 1);
    if (pixelIndex < width * height - width) enqueue(pixelIndex + width);
    if (pixelIndex >= width) enqueue(pixelIndex - width);
  }
  if (!selectedCount) return null;
  const rgb = hexToRgb(replacementColor);
  for (let pixelIndex = 0; pixelIndex < selected.length; pixelIndex += 1) {
    if (!selected[pixelIndex]) continue;
    const offset = pixelIndex * 4;
    result[offset] = rgb.r;
    result[offset + 1] = rgb.g;
    result[offset + 2] = rgb.b;
    result[offset + 3] = Math.round(opacity * 255);
  }
  return result;
};

const replaceImageColors = async (url: string, options: WorksetColorReplacementOptions) => {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new window.Image();
    nextImage.crossOrigin = 'anonymous';
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error('工作集图片加载失败'));
    nextImage.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建换色画布');
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const expectedX = Math.min(canvas.width - 1, Math.max(0, Math.round(options.targetXRatio * (canvas.width - 1))));
  const expectedY = Math.min(canvas.height - 1, Math.max(0, Math.round(options.targetYRatio * (canvas.height - 1))));
  const matchTolerance = options.replaceWithTransparency
    ? options.replaceTolerance * 255 / 50
    : options.colorReplaceTolerance;
  const targetPoint = findClosestReplacementPoint(
    imageData.data,
    canvas.width,
    canvas.height,
    options.targetColor,
    expectedX,
    expectedY,
    matchTolerance,
    options.replaceWithTransparency,
  );
  if (!targetPoint) return null;
  const result = options.replaceWithTransparency
    ? applyHardTransparentReplacement(
        imageData.data,
        canvas.width,
        canvas.height,
        targetPoint.x,
        targetPoint.y,
        options.replaceTolerance,
        options.replaceEdgeCleanup,
        options.replaceMatchMode,
        options.replaceEdgeEnhancementMode,
        options.targetColor,
      )
    : applyEdgeConnectedColorReplacement(
        imageData.data,
        canvas.width,
        canvas.height,
        options.targetColor,
        options.replacementColor,
        options.colorReplaceTolerance,
        options.opacity,
      );
  if (!result) return null;
  imageData.data.set(result);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

const mapPreviewFrame = (frame: VideoFramePreviewItem): VideoSpriteFrame => ({
  id: makeFrameId('video-frame'),
  index: frame.index,
  sourceUrl: frame.url,
  included: true,
  time: frame.time ?? null,
  width: frame.width,
  height: frame.height,
  sourceWidth: frame.width,
  sourceHeight: frame.height,
  markers: [],
});

const markerText: Record<VideoSpriteMarker, string> = {
  loop: '循环',
  jump: '跳变',
  duplicate: '重复',
  manual: '已编辑',
};

const getErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err && 'message' in err) {
    const messageValue = (err as { message?: unknown }).message;
    if (typeof messageValue === 'string' && messageValue) return messageValue;
  }
  return fallback;
};

const isVisiblePopupOpen = () => {
  const selectors = [
    '.ant-image-preview-wrap',
    '.ant-image-preview',
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  ];
  return selectors.some(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)).some(element => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }));
};

export default function FrameExtractionModal({
  open,
  videoUrl,
  onClose,
  onFrameExportGenerated,
}: FrameExtractionModalProps) {
  const [step, setStep] = useState<WorkbenchStep>(0);
  const [collapsedStep, setCollapsedStep] = useState<WorkbenchStep | null>(null);
  const [frameHistory, dispatchFrameHistory] = useReducer(frameHistoryReducer, undefined, createFrameHistoryState);
  const frames = frameHistory.present.frames;
  const activeFrameId = frameHistory.present.activeFrameId;
  const canUndo = frameHistory.past.length > 0;
  const canRedo = frameHistory.future.length > 0;
  const undoActionLabel = frameHistory.past[frameHistory.past.length - 1]?.label;
  const redoActionLabel = frameHistory.future[0]?.label;
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('final');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [worksetEditLoading, setWorksetEditLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fps, setFps] = useState<number>(12);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [sourceFps, setSourceFps] = useState<number | null>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [looping, setLooping] = useState(true);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [playbackFps, setPlaybackFps] = useState<number | null>(12);
  const [frameStep, setFrameStep] = useState<number | null>(2);
  const [reduceKeepPosition, setReduceKeepPosition] = useState<ReduceKeepPosition>('first');
  const [reduceModalOpen, setReduceModalOpen] = useState(false);
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(18);
  const [analyzingMarker, setAnalyzingMarker] = useState<SimilarityMarker | null>(null);
  const [similarityModalOpen, setSimilarityModalOpen] = useState(false);
  const [editorFrameId, setEditorFrameId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{ url: string; alt: string } | null>(null);
  const [workbenchCloseConfirmOpen, setWorkbenchCloseConfirmOpen] = useState(false);
  const [output, setOutput] = useState<VideoFrameExportOutput>('spritesheet');
  const [filename, setFilename] = useState('sprite');
  const [useVideoName, setUseVideoName] = useState(true);
  const [rows, setRows] = useState<number | null>(null);
  const [cellWidth, setCellWidth] = useState<number | null>(null);
  const [cellHeight, setCellHeight] = useState<number | null>(null);
  const [nameTemplate, setNameTemplate] = useState('{n:03}');
  const [exportProgress, setExportProgress] = useState<VideoFrameExportProgress | null>(null);
  const [exportPreviewViewport, setExportPreviewViewport] = useState({ width: 0, height: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const exportPreviewStageRef = useRef<HTMLDivElement>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewIndexRef = useRef(0);
  const exportProgressTimerRef = useRef<number | null>(null);
  const previousOpenStepRef = useRef<WorkbenchStep | null>(null);
  const workspaceEpochRef = useRef(0);
  const documentRevisionRef = useRef(0);
  const framesRef = useRef(frames);
  const worksetMultiSelectRef = useRef({
    pointerId: null as number | null,
    timer: null as number | null,
    active: false,
    historyRecorded: false,
    originFrameId: null as string | null,
    visitedFrameIds: new Set<string>(),
  });
  const suppressWorksetClickRef = useRef<string | null>(null);
  const [worksetMultiSelecting, setWorksetMultiSelecting] = useState(false);
  framesRef.current = frames;
  const bg = useBackgroundOptions();
  const resetBackgroundOptions = bg.reset;

  const openStep = useCallback((index: WorkbenchStep) => {
    setStep(current => {
      if (current !== index) previousOpenStepRef.current = current;
      return index;
    });
    setCollapsedStep(null);
  }, []);

  const worksetFrames = useMemo(() => frames.filter(frame => frame.included), [frames]);
  const activeFrame = useMemo(
    () => frames.find(frame => frame.id === activeFrameId) || worksetFrames[0] || frames[0] || null,
    [activeFrameId, frames, worksetFrames]
  );
  const editorFrame = editorFrameId ? frames.find(frame => frame.id === editorFrameId) || null : null;
  const effectivePlaybackFps = Math.min(Math.max(playbackFps || fps || 12, 0.1), 60);
  const playbackFrame = worksetFrames.length ? worksetFrames[previewIndex % worksetFrames.length] : null;
  const activeWorksetIndex = activeFrame ? worksetFrames.findIndex(frame => frame.id === activeFrame.id) : -1;
  const motionFrame = previewPlaying ? playbackFrame : (activeWorksetIndex >= 0 ? activeFrame : worksetFrames[0]) || playbackFrame;
  const normalizedFrameStep = Math.max(2, Math.round(frameStep || 2));

  const exportPlan = useMemo(() => {
    const count = worksetFrames.length;
    const naturalFrameWidth = Math.max(0, ...worksetFrames.map(frame => frame.width));
    const naturalFrameHeight = Math.max(0, ...worksetFrames.map(frame => frame.height));
    const hasMixedFrameSizes = new Set(worksetFrames.map(frame => `${frame.width}x${frame.height}`)).size > 1;
    const autoAdaptsFrameSizes = output !== 'zip' && hasMixedFrameSizes && !cellWidth && !cellHeight;
    let frameWidth = cellWidth || naturalFrameWidth;
    let frameHeight = cellHeight || naturalFrameHeight;
    if (naturalFrameWidth && naturalFrameHeight && cellWidth && !cellHeight) {
      frameHeight = Math.max(1, Math.round(cellWidth * naturalFrameHeight / naturalFrameWidth));
    }
    if (naturalFrameWidth && naturalFrameHeight && cellHeight && !cellWidth) {
      frameWidth = Math.max(1, Math.round(cellHeight * naturalFrameWidth / naturalFrameHeight));
    }
    const exportRows = output === 'spritesheet' && count
      ? Math.min(Math.max(1, rows ?? 1), count)
      : 0;
    const exportCols = exportRows ? Math.ceil(count / exportRows) : 0;
    return {
      count,
      edited: worksetFrames.filter(frame => frame.editedUrl).length,
      backgroundRemoved: worksetFrames.filter(frame => frame.backgroundRemovedUrl).length,
      raw: worksetFrames.filter(frame => !frame.editedUrl && !frame.backgroundRemovedUrl).length,
      frameSize: hasMixedFrameSizes && output === 'zip' && !cellWidth && !cellHeight
        ? '多种尺寸'
        : frameWidth && frameHeight
          ? `${frameWidth}×${frameHeight}${autoAdaptsFrameSizes ? '（自动适配）' : ''}`
        : '--',
      sheetSize: output === 'spritesheet' && frameWidth && frameHeight && exportCols && exportRows
        ? `${exportCols * frameWidth}×${exportRows * frameHeight}`
        : '--',
      grid: output === 'spritesheet' && exportCols && exportRows ? `${exportRows} 行 × ${exportCols} 列` : '--',
      columns: exportCols,
      rows: exportRows,
      frameWidth,
      frameHeight,
      sheetWidth: exportCols * frameWidth,
      sheetHeight: exportRows * frameHeight,
      hasMixedFrameSizes,
      autoAdaptsFrameSizes,
      naturalFrameWidth,
      naturalFrameHeight,
      duration: count && effectivePlaybackFps ? `${(count / effectivePlaybackFps).toFixed(2)} 秒` : '--',
    };
  }, [cellHeight, cellWidth, effectivePlaybackFps, output, rows, worksetFrames]);

  const currentFilename = useMemo(() => {
    if (!useVideoName || !videoUrl) return filename || 'sprite';
    const raw = decodeURIComponent(videoUrl.split('/').pop() || 'sprite').replace(/\.[a-z0-9]+$/i, '');
    return raw || filename || 'sprite';
  }, [filename, useVideoName, videoUrl]);

  const fittedSheetPreviewSize = useMemo(() => {
    if (
      output !== 'spritesheet'
      || !exportPlan.sheetWidth
      || !exportPlan.sheetHeight
      || !exportPreviewViewport.width
      || !exportPreviewViewport.height
    ) return null;
    const scale = Math.min(
      exportPreviewViewport.width / exportPlan.sheetWidth,
      exportPreviewViewport.height / exportPlan.sheetHeight,
    );
    return {
      width: Math.max(1, Math.floor(exportPlan.sheetWidth * scale)),
      height: Math.max(1, Math.floor(exportPlan.sheetHeight * scale)),
    };
  }, [exportPlan.sheetHeight, exportPlan.sheetWidth, exportPreviewViewport, output]);

  const sourceFilename = useMemo(() => {
    if (!videoUrl) return '--';
    return decodeURIComponent(videoUrl.split('/').pop() || '--');
  }, [videoUrl]);

  const estimatedFrames = useMemo(() => {
    const end = endTime ?? videoDuration;
    if (!fps || !end || end <= startTime) return null;
    return Math.max(1, Math.ceil((end - startTime) * fps));
  }, [endTime, fps, startTime, videoDuration]);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current !== null) {
      window.clearInterval(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const clearExportProgressTimer = useCallback(() => {
    if (exportProgressTimerRef.current !== null) {
      window.clearInterval(exportProgressTimerRef.current);
      exportProgressTimerRef.current = null;
    }
  }, []);

  const undoFrameChange = useCallback(() => {
    if (!canUndo) return;
    documentRevisionRef.current += 1;
    clearPreviewTimer();
    setPreviewPlaying(false);
    dispatchFrameHistory({ type: 'undo' });
  }, [canUndo, clearPreviewTimer]);

  const redoFrameChange = useCallback(() => {
    if (!canRedo) return;
    documentRevisionRef.current += 1;
    clearPreviewTimer();
    setPreviewPlaying(false);
    dispatchFrameHistory({ type: 'redo' });
  }, [canRedo, clearPreviewTimer]);

  const requestWorkbenchClose = useCallback(() => {
    setWorkbenchCloseConfirmOpen(true);
  }, []);

  const cancelWorkbenchClose = () => setWorkbenchCloseConfirmOpen(false);
  const confirmWorkbenchClose = () => {
    setWorkbenchCloseConfirmOpen(false);
    onClose();
  };

  useEffect(() => {
    if (!open || step !== 1 || collapsedStep === 1 || editorFrameId || imagePreview || reduceModalOpen || similarityModalOpen) return;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || target.matches('input, textarea, select')
        || !!target.closest('[contenteditable="true"]')
      )) return;
      if (isVisiblePopupOpen()) return;
      const key = event.key.toLowerCase();
      const shouldRedo = key === 'y' || (key === 'z' && event.shiftKey);
      const shouldUndo = key === 'z' && !event.shiftKey;
      if ((shouldUndo && canUndo) || (shouldRedo && canRedo)) event.preventDefault();
      if (shouldUndo) undoFrameChange();
      if (shouldRedo) redoFrameChange();
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [canRedo, canUndo, collapsedStep, editorFrameId, imagePreview, open, redoFrameChange, reduceModalOpen, similarityModalOpen, step, undoFrameChange]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (workbenchCloseConfirmOpen || editorFrameId || imagePreview || reduceModalOpen || similarityModalOpen || isVisiblePopupOpen()) return;
      event.preventDefault();
      requestWorkbenchClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editorFrameId, imagePreview, open, reduceModalOpen, requestWorkbenchClose, similarityModalOpen, workbenchCloseConfirmOpen]);

  const makeProgressId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `export-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const startExportProgressPolling = useCallback((progressId: string, workspaceEpoch: number) => {
    clearExportProgressTimer();
    exportProgressTimerRef.current = window.setInterval(async () => {
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      try {
        const progress = await apiService.getVideoFrameExportProgress(progressId);
        if (workspaceEpoch !== workspaceEpochRef.current) return;
        setExportProgress(progress);
        if (progress.done || progress.error) clearExportProgressTimer();
      } catch {
        // Export request error handling will surface the failure; polling can be best-effort.
      }
    }, 400);
  }, [clearExportProgressTimer]);

  useEffect(() => {
    clearPreviewTimer();
    if (!previewPlaying || worksetFrames.length < 2) return;
    previewTimerRef.current = window.setInterval(() => {
      const next = (previewIndexRef.current + 1) % worksetFrames.length;
      previewIndexRef.current = next;
      setPreviewIndex(next);
      dispatchFrameHistory({
        type: 'update',
        label: '',
        recordHistory: false,
        updater: document => ({ ...document, activeFrameId: worksetFrames[next]?.id ?? null }),
      });
    }, Math.max(50, 1000 / effectivePlaybackFps));
    return clearPreviewTimer;
  }, [clearPreviewTimer, effectivePlaybackFps, previewPlaying, worksetFrames]);

  useEffect(() => {
    previewIndexRef.current = previewIndex;
  }, [previewIndex]);

  useEffect(() => {
    if (output !== 'spritesheet' || step !== 2 || collapsedStep === 2) return;
    const stage = exportPreviewStageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setExportPreviewViewport(current => {
        const width = Math.max(0, Math.floor(rect.width));
        const height = Math.max(0, Math.floor(rect.height));
        return current.width === width && current.height === height ? current : { width, height };
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [collapsedStep, output, step]);

  useEffect(() => {
    if (!worksetFrames.length) {
      setPreviewIndex(0);
      return;
    }
    const currentIndex = worksetFrames.findIndex(frame => frame.id === activeFrameId);
    setPreviewIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [activeFrameId, worksetFrames]);

  useEffect(() => {
    workspaceEpochRef.current += 1;
    documentRevisionRef.current = 0;
    if (!open) {
      clearPreviewTimer();
      clearExportProgressTimer();
      return;
    }
    previousOpenStepRef.current = null;
    setStep(0);
    setCollapsedStep(null);
    dispatchFrameHistory({ type: 'reset', document: { frames: [], activeFrameId: null } });
    setPreviewId(null);
    setPreviewMode('final');
    setLoadingPreview(false);
    setBackgroundLoading(false);
    setWorksetEditLoading(false);
    setExporting(false);
    setFps(12);
    setStartTime(0);
    setEndTime(null);
    setVideoDuration(null);
    setSourceFps(null);
    setVideoSize(null);
    setLooping(true);
    setPreviewPlaying(false);
    setPreviewIndex(0);
    setPlaybackFps(12);
    setFrameStep(2);
    setReduceKeepPosition('first');
    setReduceModalOpen(false);
    setSimilarityThreshold(18);
    setAnalyzingMarker(null);
    setSimilarityModalOpen(false);
    setEditorFrameId(null);
    setImagePreview(null);
    setWorkbenchCloseConfirmOpen(false);
    setOutput('spritesheet');
    setFilename('sprite');
    setUseVideoName(true);
    setRows(null);
    setCellWidth(null);
    setCellHeight(null);
    setNameTemplate('{n:03}');
    setExportProgress(null);
    resetBackgroundOptions();
  }, [clearExportProgressTimer, clearPreviewTimer, open, resetBackgroundOptions, videoUrl]);

  // 打开弹窗时探测视频真实帧率/时长，作为帧率默认值
  useEffect(() => {
    if (!open || !videoUrl) return;
    let cancelled = false;
    setMetaLoading(true);
    apiService.getVideoMeta({ video_url: videoUrl })
      .then(res => {
        if (cancelled) return;
        const probedFps = res.source_fps ?? null;
        const probedDuration = res.source_duration ?? null;
        if (probedFps) {
          setSourceFps(probedFps);
          setFps(Math.max(8, Math.min(24, Math.round(probedFps))));
        }
        if (probedDuration) {
          const duration = Number(probedDuration.toFixed(3));
          setVideoDuration(duration);
          setEndTime(prev => prev ?? duration);
        }
      })
      .catch(() => {
        // best-effort：探测失败则保留回退默认值
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, videoUrl]);

  useEffect(() => clearPreviewTimer, [clearPreviewTimer]);
  useEffect(() => clearExportProgressTimer, [clearExportProgressTimer]);

  const onVideoLoaded = () => {
    const video = videoRef.current;
    const duration = video?.duration;
    if (duration && Number.isFinite(duration)) {
      const rounded = Number(duration.toFixed(3));
      setVideoDuration(rounded);
      setEndTime(prev => prev ?? rounded);
      if (video && video.currentTime < startTime) video.currentTime = startTime;
    }
    if (video && video.videoWidth && video.videoHeight) {
      setVideoSize({ width: video.videoWidth, height: video.videoHeight });
    }
    if (video) {
      video.playbackRate = fps ? Math.min(4, Math.max(0.25, fps / (sourceFps || 24))) : 1;
      void video.play().catch(() => {
        // Browsers may block autoplay with sound; muted autoplay should still work in normal cases.
      });
    }
  };

  const syncVideoPreview = (nextFps = fps, nextStart = startTime, nextEnd = endTime ?? videoDuration) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = nextFps ? Math.min(4, Math.max(0.25, nextFps / (sourceFps || 24))) : 1;
    if (video.currentTime < nextStart || (nextEnd && video.currentTime > nextEnd)) {
      video.currentTime = Math.max(0, nextStart);
    }
    void video.play().catch(() => {
      // Keep best-effort autoplay; native controls remain available if the browser blocks it.
    });
  };

  const updateExtractionFps = (value: number | null) => {
    if (value === null) return;
    const next = Math.max(1, Math.min(60, Math.round(value)));
    setFps(next);
    syncVideoPreview(next);
  };

  const updateExtractionRange = (value: number | number[]) => {
    if (!Array.isArray(value)) return;
    const nextStart = Number(value[0].toFixed(1));
    const nextEnd = Number(value[1].toFixed(1));
    setStartTime(nextStart);
    setEndTime(nextEnd);
    syncVideoPreview(fps, nextStart, nextEnd);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !open) return;
    const end = endTime ?? videoDuration;
    const targetStart = Math.max(0, startTime);
    if (Number.isFinite(targetStart) && (video.currentTime < targetStart || (end && video.currentTime > end))) {
      video.currentTime = targetStart;
    }
  }, [endTime, open, startTime, videoDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !open) return;
    const referenceFps = sourceFps || 24;
    video.playbackRate = fps ? Math.min(4, Math.max(0.25, fps / referenceFps)) : 1;
  }, [fps, open, sourceFps]);

  const keepVideoInRange = () => {
    const video = videoRef.current;
    const end = endTime ?? videoDuration;
    if (!video || !end) return;
    if (video.currentTime >= end || video.currentTime < startTime) {
      video.currentTime = Math.max(0, startTime);
      if (!video.paused) void video.play();
    }
  };

  const applyPreviewResponse = (res: VideoFramePreviewResponse) => {
    const nextFrames = res.frames.map(mapPreviewFrame);
    workspaceEpochRef.current += 1;
    documentRevisionRef.current = 0;
    dispatchFrameHistory({
      type: 'reset',
      document: { frames: nextFrames, activeFrameId: nextFrames[0]?.id ?? null },
    });
    setPreviewId(res.preview_id);
    setBackgroundLoading(false);
    setAnalyzingMarker(null);
    setReduceModalOpen(false);
    setSimilarityModalOpen(false);
    setEditorFrameId(null);
    setImagePreview(null);
    setSourceFps(res.source_fps ?? null);
    if (res.source_fps && !fps) setFps(Number(res.source_fps.toFixed(2)));
    if (res.source_duration) {
      const duration = Number(res.source_duration.toFixed(3));
      setVideoDuration(duration);
      setEndTime(prev => prev ?? duration);
    }
    setPreviewIndex(0);
    setPreviewPlaying(false);
    openStep(1);
  };

  const extractFrames = async () => {
    if (!videoUrl) return;
    const end = endTime ?? videoDuration ?? undefined;
    if (end !== undefined && end <= startTime) {
      message.warning('结束时间必须大于开始时间');
      return;
    }
    const requestEpoch = workspaceEpochRef.current;
    setLoadingPreview(true);
    try {
      const res = await apiService.videoFramePreview({
        video_url: videoUrl,
        start_time: startTime,
        end_time: end,
        fps: fps || undefined,
      });
      if (requestEpoch !== workspaceEpochRef.current) return;
      setLoadingPreview(false);
      applyPreviewResponse(res);
      message.success(`已提取 ${res.frames.length} 帧原始画面`);
    } catch (err: unknown) {
      if (requestEpoch === workspaceEpochRef.current) message.error(getErrorMessage(err, '抽帧失败'));
    } finally {
      if (requestEpoch === workspaceEpochRef.current) setLoadingPreview(false);
    }
  };

  const commitFrames = useCallback((label: string, updater: (frames: VideoSpriteFrame[]) => VideoSpriteFrame[]) => {
    documentRevisionRef.current += 1;
    dispatchFrameHistory({
      type: 'update',
      label,
      recordHistory: true,
      updater: document => ({ ...document, frames: updater(document.frames) }),
    });
  }, []);

  const setTransientActiveFrameId = useCallback((id: string | null) => {
    dispatchFrameHistory({
      type: 'update',
      label: '',
      recordHistory: false,
      updater: document => ({ ...document, activeFrameId: id }),
    });
  }, []);

  const setActiveFrame = (frame: VideoSpriteFrame) => {
    setPreviewPlaying(false);
    setTransientActiveFrameId(frame.id);
    const index = worksetFrames.findIndex(item => item.id === frame.id);
    if (index >= 0) setPreviewIndex(index);
  };

  const toggleWorksetFrame = (id: string) => {
    const target = frames.find(frame => frame.id === id);
    if (!target) return;
    commitFrames(target.included ? '移出工作集' : '加入工作集', prev => prev.map(frame => (
      frame.id === id ? { ...frame, included: !frame.included } : frame
    )));
  };

  const toggleWorksetFrameDuringMultiSelect = useCallback((id: string) => {
    const target = framesRef.current.find(frame => frame.id === id);
    const selection = worksetMultiSelectRef.current;
    if (!target || selection.visitedFrameIds.has(id)) return;
    selection.visitedFrameIds.add(id);
    const recordHistory = !selection.historyRecorded;
    selection.historyRecorded = true;
    documentRevisionRef.current += 1;
    dispatchFrameHistory({
      type: 'update',
      label: '连续反选工作集',
      recordHistory,
      updater: document => ({
        ...document,
        frames: document.frames.map(frame => frame.id === id
          ? { ...frame, included: !frame.included }
          : frame),
      }),
    });
  }, []);

  const finishWorksetMultiSelect = useCallback((suppressClick: boolean) => {
    const selection = worksetMultiSelectRef.current;
    if (selection.timer !== null) window.clearTimeout(selection.timer);
    if (suppressClick && selection.active && selection.originFrameId) {
      suppressWorksetClickRef.current = selection.originFrameId;
    }
    selection.pointerId = null;
    selection.timer = null;
    selection.active = false;
    selection.historyRecorded = false;
    selection.originFrameId = null;
    selection.visitedFrameIds.clear();
    setWorksetMultiSelecting(false);
  }, []);

  const startWorksetMultiSelect = useCallback((event: React.PointerEvent<HTMLSpanElement>, frameId: string) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    finishWorksetMultiSelect(false);
    suppressWorksetClickRef.current = null;
    const selection = worksetMultiSelectRef.current;
    selection.pointerId = event.pointerId;
    selection.originFrameId = frameId;
    selection.visitedFrameIds.clear();
    selection.timer = window.setTimeout(() => {
      selection.timer = null;
      selection.active = true;
      setWorksetMultiSelecting(true);
      toggleWorksetFrameDuringMultiSelect(frameId);
    }, WORKSET_MULTI_SELECT_HOLD_MS);
  }, [finishWorksetMultiSelect, toggleWorksetFrameDuringMultiSelect]);

  const enterFrameDuringWorksetMultiSelect = useCallback((event: React.PointerEvent<HTMLDivElement>, frameId: string) => {
    const selection = worksetMultiSelectRef.current;
    if (!selection.active || selection.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishWorksetMultiSelect(false);
      return;
    }
    toggleWorksetFrameDuringMultiSelect(frameId);
  }, [finishWorksetMultiSelect, toggleWorksetFrameDuringMultiSelect]);

  useEffect(() => {
    const selection = worksetMultiSelectRef.current;
    const handlePointerUp = (event: PointerEvent) => {
      const pointerId = selection.pointerId;
      if (pointerId === null || pointerId !== event.pointerId) return;
      finishWorksetMultiSelect(true);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const pointerId = selection.pointerId;
      if (pointerId === null || pointerId !== event.pointerId) return;
      finishWorksetMultiSelect(false);
    };
    const handleWindowBlur = () => finishWorksetMultiSelect(false);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      window.removeEventListener('blur', handleWindowBlur);
      const timer = selection.timer;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [finishWorksetMultiSelect]);

  const invertWorkset = () => commitFrames('反选工作集', prev => prev.map(frame => ({ ...frame, included: !frame.included })));
  const selectAllWorkset = () => commitFrames('全选工作集', prev => prev.map(frame => (
    frame.included ? frame : { ...frame, included: true }
  )));

  const executeDeleteFrameIds = (ids: string[]) => {
    const existingIds = new Set(frames.map(frame => frame.id));
    const targetIds = new Set(ids.filter(id => existingIds.has(id)));
    if (!targetIds.size) return;
    documentRevisionRef.current += 1;
    clearPreviewTimer();
    setPreviewPlaying(false);
    dispatchFrameHistory({
      type: 'update',
      label: targetIds.size === 1 ? '删除帧' : `删除 ${targetIds.size} 帧`,
      recordHistory: true,
      updater: document => {
        const nextFrames = document.frames.filter(frame => !targetIds.has(frame.id));
        if (!document.activeFrameId || !targetIds.has(document.activeFrameId)) {
          return { ...document, frames: nextFrames };
        }
        const activeIndex = document.frames.findIndex(frame => frame.id === document.activeFrameId);
        const replacement = document.frames.slice(activeIndex + 1).find(frame => !targetIds.has(frame.id))
          || document.frames.slice(0, activeIndex).reverse().find(frame => !targetIds.has(frame.id))
          || nextFrames[0]
          || null;
        return { frames: nextFrames, activeFrameId: replacement?.id ?? null };
      },
    });

    if (editorFrameId && targetIds.has(editorFrameId)) setEditorFrameId(null);
    message.success(`已删除 ${targetIds.size} 帧，可使用撤销恢复`);
  };

  const deleteFrame = (target: VideoSpriteFrame) => executeDeleteFrameIds([target.id]);

  const excludeAfterCurrent = () => {
    if (!activeFrame) return;
    commitFrames('后续帧移出工作集', prev => {
      const activeOrder = prev.findIndex(frame => frame.id === activeFrame.id);
      return prev.map((frame, index) => index > activeOrder ? { ...frame, included: false } : frame);
    });
  };

  const reduceFrames = () => {
    const stepValue = normalizedFrameStep;
    if (worksetFrames.length < 2) {
      message.warning('至少 2 帧才能减帧');
      return;
    }
    const keep = new Set<string>();
    for (let start = 0; start < worksetFrames.length; start += stepValue) {
      const keepIndex = reduceKeepPosition === 'first'
        ? start
        : Math.min(start + stepValue, worksetFrames.length) - 1;
      keep.add(worksetFrames[keepIndex].id);
    }
    commitFrames(`减帧（保留每组${reduceKeepPosition === 'first' ? '第一帧' : '最后一帧'}）`, prev => prev.map(frame => (
      frame.included ? { ...frame, included: keep.has(frame.id) } : frame
    )));
    setReduceModalOpen(false);
    message.success(`已从 ${worksetFrames.length} 帧减到 ${keep.size} 帧`);
  };

  const sortFrames = () => commitFrames('自动排序', prev => [...prev].sort((a, b) => (a.time ?? a.index) - (b.time ?? b.index)));
  const reverseWorkset = () => commitFrames('工作集反转', prev => {
    const included = prev.filter(frame => frame.included).reverse();
    const queue = [...included];
    return prev.map(frame => frame.included ? queue.shift()! : frame);
  });
  const deleteWorkset = () => executeDeleteFrameIds(worksetFrames.map(frame => frame.id));
  const deleteUnincluded = () => executeDeleteFrameIds(frames.filter(frame => !frame.included).map(frame => frame.id));

  const stepFrame = (direction: -1 | 1) => {
    if (!worksetFrames.length) return;
    setPreviewPlaying(false);
    const current = activeFrame ? worksetFrames.findIndex(frame => frame.id === activeFrame.id) : previewIndex;
    const start = current >= 0 ? current : direction === 1 ? -1 : 0;
    const next = (start + direction + worksetFrames.length) % worksetFrames.length;
    setPreviewIndex(next);
    setTransientActiveFrameId(worksetFrames[next].id);
  };

  const jumpToFrame = (value: number | null) => {
    if (!value || !worksetFrames.length) return;
    const next = Math.max(0, Math.min(worksetFrames.length - 1, value - 1));
    setPreviewPlaying(false);
    setPreviewIndex(next);
    setTransientActiveFrameId(worksetFrames[next].id);
  };

  const applyBackgroundToFrames = async (targets: VideoSpriteFrame[]) => {
    if (!targets.length) {
      message.warning('没有可处理的帧');
      return false;
    }
    const requestEpoch = workspaceEpochRef.current;
    const requestRevision = documentRevisionRef.current;
    const sourceUrlByFrameId = new Map(targets.map(frame => [frame.id, getFrameExportUrl(frame)]));
    const editedTargetIds = new Set(targets.filter(frame => frame.editedUrl).map(frame => frame.id));
    setBackgroundLoading(true);
    try {
      const res = await apiService.removeVideoFrameBackgrounds({
        frame_urls: targets.map(frame => sourceUrlByFrameId.get(frame.id)!),
        ...bg.toRequest(),
      });
      if (requestEpoch !== workspaceEpochRef.current || requestRevision !== documentRevisionRef.current) return false;
      const resultQueues = new Map<string, string[]>();
      res.frames.forEach(item => {
        const queue = resultQueues.get(item.source_url) || [];
        queue.push(item.image_url);
        resultQueues.set(item.source_url, queue);
      });
      const resultByFrameId = new Map<string, string>();
      targets.forEach(frame => {
        const nextUrl = resultQueues.get(sourceUrlByFrameId.get(frame.id)!)?.shift();
        if (nextUrl) resultByFrameId.set(frame.id, nextUrl);
      });
      commitFrames(`处理 ${resultByFrameId.size} 帧背景`, prev => prev.map(frame => {
        const nextUrl = resultByFrameId.get(frame.id);
        return nextUrl ? {
          ...frame,
          backgroundRemovedUrl: nextUrl,
          editedUrl: undefined,
          width: frame.width,
          height: frame.height,
          markers: frame.markers.filter(marker => marker !== 'manual'),
        } : frame;
      }));
      const replacedEdits = Array.from(resultByFrameId.keys()).filter(id => editedTargetIds.has(id)).length;
      message.success(replacedEdits
        ? `已基于当前画面处理 ${res.frames.length} 帧背景，并合并 ${replacedEdits} 个编辑结果（可撤销）`
        : `已处理 ${res.frames.length} 帧背景`);
      return true;
    } catch (err: unknown) {
      if (requestEpoch === workspaceEpochRef.current && requestRevision === documentRevisionRef.current) {
        message.error(getErrorMessage(err, '批量背景处理失败'));
      }
      return false;
    } finally {
      if (requestEpoch === workspaceEpochRef.current) setBackgroundLoading(false);
    }
  };

  const applyUpscaleToFrames = async (
    targets: VideoSpriteFrame[],
    method: ImageUpscaleMethodId,
    scale: 2 | 4,
    colorReplacement?: WorksetColorReplacementOptions,
  ) => {
    if (!targets.length) {
      message.warning('没有可处理的帧');
      return false;
    }
    const requestEpoch = workspaceEpochRef.current;
    const requestRevision = documentRevisionRef.current;
    const sourceUrlByFrameId = new Map(targets.map(frame => [frame.id, getFrameExportUrl(frame)]));
    setWorksetEditLoading(true);
    try {
      let colorReplacementCount = 0;
      if (colorReplacement) {
        for (const frame of targets) {
          if (requestEpoch !== workspaceEpochRef.current || requestRevision !== documentRevisionRef.current) return false;
          const sourceUrl = sourceUrlByFrameId.get(frame.id)!;
          const image = await replaceImageColors(sourceUrl, colorReplacement);
          if (!image) continue;
          const saved = await apiService.saveEditedVideoFrame({
            image,
            base_frame_url: sourceUrl,
            preview_id: previewId ?? undefined,
          });
          sourceUrlByFrameId.set(frame.id, saved.image_url);
          colorReplacementCount += 1;
        }
      }
      const res = await apiService.upscaleImageBatch({
        frame_urls: targets.map(frame => sourceUrlByFrameId.get(frame.id)!),
        method,
        scale,
      });
      if (requestEpoch !== workspaceEpochRef.current || requestRevision !== documentRevisionRef.current) return false;
      const resultQueues = new Map<string, typeof res.frames>();
      res.frames.forEach(item => {
        const queue = resultQueues.get(item.source_url) || [];
        queue.push(item);
        resultQueues.set(item.source_url, queue);
      });
      const resultByFrameId = new Map<string, (typeof res.frames)[number]>();
      targets.forEach(frame => {
        const result = resultQueues.get(sourceUrlByFrameId.get(frame.id)!)?.shift();
        if (result) resultByFrameId.set(frame.id, result);
      });
      commitFrames(`放大增强 ${resultByFrameId.size} 帧`, prev => prev.map(frame => {
        const result = resultByFrameId.get(frame.id);
        return result ? {
          ...frame,
          editedUrl: result.image_url,
          width: result.width,
          height: result.height,
          markers: frame.markers.includes('manual') ? frame.markers : [...frame.markers, 'manual'],
        } : frame;
      }));
      message.success(colorReplacementCount
        ? `已先对 ${colorReplacementCount} 帧应用换色，再将 ${scale}x 放大增强应用到 ${resultByFrameId.size} 帧`
        : `已将 ${scale}x 放大增强应用到 ${resultByFrameId.size} 帧`);
      return true;
    } catch (err: unknown) {
      if (requestEpoch === workspaceEpochRef.current && requestRevision === documentRevisionRef.current) {
        message.error(getErrorMessage(err, '批量放大增强失败'));
      }
      return false;
    } finally {
      if (requestEpoch === workspaceEpochRef.current) setWorksetEditLoading(false);
    }
  };

  const applyColorReplacementToFrames = async (
    targets: VideoSpriteFrame[],
    options: WorksetColorReplacementOptions,
  ) => {
    if (!targets.length) {
      message.warning('没有可处理的帧');
      return false;
    }
    const requestEpoch = workspaceEpochRef.current;
    const requestRevision = documentRevisionRef.current;
    setWorksetEditLoading(true);
    try {
      const results = new Map<string, { imageUrl: string; width: number; height: number }>();
      for (const frame of targets) {
        if (requestEpoch !== workspaceEpochRef.current || requestRevision !== documentRevisionRef.current) return false;
        const sourceUrl = getFrameExportUrl(frame);
        const image = await replaceImageColors(sourceUrl, options);
        if (!image) continue;
        const saved = await apiService.saveEditedVideoFrame({
          image,
          base_frame_url: sourceUrl,
          preview_id: previewId ?? undefined,
        });
        results.set(frame.id, {
          imageUrl: saved.image_url,
          width: saved.width,
          height: saved.height,
        });
      }
      if (requestEpoch !== workspaceEpochRef.current || requestRevision !== documentRevisionRef.current) return false;
      if (!results.size) {
        message.warning('工作集中未找到匹配的目标颜色');
        return false;
      }
      commitFrames(`换色 ${results.size} 帧`, prev => prev.map(frame => {
        const result = results.get(frame.id);
        return result ? {
          ...frame,
          editedUrl: result.imageUrl,
          width: result.width,
          height: result.height,
          markers: frame.markers.includes('manual') ? frame.markers : [...frame.markers, 'manual'],
        } : frame;
      }));
      message.success(`已将换色应用到 ${results.size} 帧`);
      return true;
    } catch (err: unknown) {
      if (requestEpoch === workspaceEpochRef.current && requestRevision === documentRevisionRef.current) {
        message.error(getErrorMessage(err, '批量换色失败'));
      }
      return false;
    } finally {
      if (requestEpoch === workspaceEpochRef.current) setWorksetEditLoading(false);
    }
  };

  const restoreFrames = (targets: VideoSpriteFrame[], includeEdited = false) => {
    const ids = new Set(targets.map(frame => frame.id));
    commitFrames(includeEdited ? '恢复原始帧' : '恢复帧背景', prev => prev.map(frame => {
      if (!ids.has(frame.id)) return frame;
      const keepsEditedResult = !includeEdited && Boolean(frame.editedUrl);
      return {
        ...frame,
        backgroundRemovedUrl: undefined,
        editedUrl: includeEdited ? undefined : frame.editedUrl,
        width: keepsEditedResult ? frame.width : frame.sourceWidth,
        height: keepsEditedResult ? frame.height : frame.sourceHeight,
        markers: includeEdited ? frame.markers.filter(marker => marker !== 'manual') : frame.markers,
      };
    }));
  };

  const saveEditedFrame = (frameId: string, imageUrl: string, width: number, height: number) => {
    commitFrames('保存图片编辑', prev => prev.map(frame => frame.id === frameId ? {
      ...frame,
      editedUrl: imageUrl,
      width,
      height,
      markers: frame.markers.includes('manual') ? frame.markers : [...frame.markers, 'manual'],
    } : frame));
  };

  const analyzeMarker = async (marker: SimilarityMarker) => {
    const targets = worksetFrames;
    if (targets.length < 2) {
      message.warning('至少需要 2 帧才能进行相似度查找');
      return;
    }
    const requestEpoch = workspaceEpochRef.current;
    const requestRevision = documentRevisionRef.current;
    const threshold = similarityThreshold;
    setAnalyzingMarker(marker);
    try {
      const vectors = await Promise.all(targets.map(frame => loadImageVector(getFrameExportUrl(frame))));
      if (requestEpoch !== workspaceEpochRef.current || requestRevision !== documentRevisionRef.current) return;
      const matches = new Set<string>();
      if (marker === 'loop') {
        if (vectorDistance(vectors[0], vectors[vectors.length - 1]) <= threshold) {
          matches.add(targets[0].id);
          matches.add(targets[targets.length - 1].id);
        }
      } else {
        for (let i = 1; i < targets.length; i += 1) {
          const distance = vectorDistance(vectors[i - 1], vectors[i]);
          if (marker === 'duplicate' && distance <= threshold) matches.add(targets[i].id);
          if (marker === 'jump' && distance >= Math.min(90, threshold * 3)) matches.add(targets[i].id);
        }
      }
      commitFrames(`寻找${markerText[marker]}帧`, prev => prev.map(frame => {
        const nextMarkers = frame.markers.filter(current => current !== marker);
        if (matches.has(frame.id)) nextMarkers.push(marker);
        return { ...frame, markers: nextMarkers, included: matches.has(frame.id) };
      }));
      setSimilarityModalOpen(false);
      if (matches.size) {
        message.success(`找到 ${matches.size} 个${markerText[marker]}帧，已设为工作集`);
      } else {
        message.info(`未找到${markerText[marker]}帧，工作集已清空（可撤销）`);
      }
    } catch (err: unknown) {
      if (requestEpoch === workspaceEpochRef.current && requestRevision === documentRevisionRef.current) {
        message.error(getErrorMessage(err, '相似度分析失败'));
      }
    } finally {
      if (requestEpoch === workspaceEpochRef.current) setAnalyzingMarker(null);
    }
  };

  const exportFrames = async () => {
    if (!worksetFrames.length) {
      message.warning('请至少保留一帧到工作集');
      return;
    }
    const requestEpoch = workspaceEpochRef.current;
    setExporting(true);
    const progressId = makeProgressId();
    setExportProgress({
      progress_id: progressId,
      stage: 'queued',
      percent: 0,
      message: '准备导出',
      done: false,
      error: null,
    });
    startExportProgressPolling(progressId, requestEpoch);
    try {
      const res = await apiService.exportVideoFrames({
        frame_urls: worksetFrames.map(getFrameExportUrl),
        output,
        rows: output === 'spritesheet' ? rows ?? 1 : undefined,
        cell_width: cellWidth || undefined,
        cell_height: cellHeight || undefined,
        gif_fps: output === 'gif' || output === 'apng' ? effectivePlaybackFps : undefined,
        filename: currentFilename,
        name_template: output === 'zip' ? nameTemplate : undefined,
        progress_id: progressId,
      });
      if (requestEpoch !== workspaceEpochRef.current) return;
      const url = res.zip_url || res.spritesheet_url || res.gif_url || res.apng_url;
      if (!url) throw new Error('导出完成但未返回文件 URL');
      if (output === 'zip') {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${currentFilename}.zip`;
        link.click();
        message.success(`ZIP 已生成（${res.frames} 帧），已开始下载`);
      } else {
        onFrameExportGenerated?.(url, {
          output,
          frames: res.frames,
          cols: res.cols,
          rows: res.rows,
        });
        message.success(`${output === 'gif' ? 'GIF' : output === 'apng' ? 'APNG' : '精灵图'}已生成（${res.frames} 帧），已追加到结果区`);
      }
      onClose();
    } catch (err: unknown) {
      if (requestEpoch !== workspaceEpochRef.current) return;
      const errorMessage = getErrorMessage(err, '导出失败');
      setExportProgress(prev => prev ? {
        ...prev,
        stage: 'error',
        percent: 100,
        message: errorMessage,
        done: true,
        error: errorMessage,
      } : prev);
      message.error(errorMessage);
    } finally {
      if (requestEpoch === workspaceEpochRef.current) {
        clearExportProgressTimer();
        setExporting(false);
      }
    }
  };

  const actionButtons = [
    step === 0 && (
      <Button key="extract" className="frame-workbench-primary-action" type="primary" icon={<ReloadOutlined />} loading={loadingPreview} disabled={!videoUrl} onClick={extractFrames}>
        开始提取
      </Button>
    ),
    step === 1 && (
      <Button key="next" className="frame-workbench-primary-action" type="primary" disabled={!worksetFrames.length} onClick={() => openStep(2)}>
        下一步：导出
      </Button>
    ),
    step === 2 && (
      <Button
        key="export"
        className="frame-workbench-primary-action"
        type="primary"
        icon={output === 'zip' ? <DownloadOutlined /> : output === 'gif' ? <PlayCircleOutlined /> : <AppstoreOutlined />}
        loading={exporting}
        disabled={!worksetFrames.length}
        onClick={exportFrames}
      >
        {output === 'zip' ? '导出 ZIP' : output === 'gif' ? '导出 GIF' : '导出精灵图'}
      </Button>
    ),
  ].filter(Boolean);

  const renderStepState = (index: WorkbenchStep) => {
    if (step === index && collapsedStep !== index) return '展开中';
    if (index === 0 && frames.length) return `已提取 ${frames.length} 帧`;
    if (index === 1 && frames.length && step > 1) return `工作集 ${worksetFrames.length} 帧`;
    if (index === 1 && !frames.length && canUndo) return '可撤销删除';
    if (index === 2 && exportProgress?.done && !exportProgress.error) return '已导出';
    return index > 0 && !frames.length ? '等待抽帧' : '可展开';
  };

  const isStepOpen = (index: WorkbenchStep) => step === index && collapsedStep !== index;
  const stepCardClass = (index: WorkbenchStep) => `frame-workbench-card ${isStepOpen(index) ? 'active' : ''} ${step > index || collapsedStep === index ? 'done' : ''}`;
  const toggleStepCard = (index: WorkbenchStep) => {
    if (index > 0 && !frames.length && !(index === 1 && canUndo)) return;
    if (step === index) {
      const previous = previousOpenStepRef.current;
      if (previous !== null && previous !== index && (previous === 0 || frames.length)) {
        openStep(previous);
      }
      return;
    }
    openStep(index);
  };

  return (
    <>
    <Modal
      title={(
        <div className="frame-editor-title">
          <span>视频转精灵图工作台</span>
          <small>帧提取 → 编辑与整理 → 导出</small>
        </div>
      )}
      open={open}
      keyboard={false}
      onCancel={requestWorkbenchClose}
      width="100%"
      rootClassName="frame-editor-modal-root"
      className="frame-editor-modal"
      style={{ top: 0, maxWidth: '100%', paddingBottom: 0 }}
      destroyOnHidden
      footer={null}
    >
      <div className="frame-workbench">
        <section className={stepCardClass(0)}>
          <button type="button" className="frame-workbench-card-head" onClick={() => toggleStepCard(0)}>
            <span>1. 帧提取</span>
            <small>{renderStepState(0)}</small>
          </button>
          {isStepOpen(0) && (
            <div className="frame-workbench-card-body">
          <div className="frame-workbench-extract">
            <div className="frame-workbench-video-panel">
              {videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  loop={looping}
                  controls
                  muted
                  autoPlay
                  playsInline
                  onLoadedMetadata={onVideoLoaded}
                  onTimeUpdate={keepVideoInRange}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无视频" />
              )}
            </div>
            <div className="frame-editor-controls">
              <div className="frame-workbench-video-info">
                <div className="frame-workbench-video-info-name" title={sourceFilename}>{sourceFilename}</div>
                <div className="frame-workbench-video-info-meta">
                  <span>分辨率 <b>{videoSize ? `${videoSize.width}×${videoSize.height}` : '--'}</b></span>
                  <span>时长 <b>{videoDuration != null ? formatTimestamp(videoDuration) : '--:--.--'}</b></span>
                  <span>源帧率 <b>{sourceFps ? `${sourceFps.toFixed(1)} fps` : '--'}</b></span>
                </div>
              </div>

              <div className="frame-workbench-params">
                <div className="frame-workbench-param">
                  <div className="frame-workbench-param-head">
                    <span className="frame-workbench-param-title">帧率</span>
                  </div>
                  <small className="frame-workbench-param-desc">{metaLoading ? '正在检测视频帧率…' : '每秒从视频中提取多少张画面'}</small>
                  <div className="frame-workbench-fps-control">
                    <Slider
                      className="frame-workbench-fps-slider"
                      min={1}
                      max={60}
                      step={1}
                      disabled={metaLoading}
                      value={fps}
                      tooltip={{ formatter: (value?: number) => (value ? `${value} 帧/秒` : '') }}
                      onChange={value => updateExtractionFps(value)}
                    />
                    <InputNumber
                      className="frame-workbench-fps-input"
                      min={1}
                      max={60}
                      step={1}
                      disabled={metaLoading}
                      value={fps}
                      onChange={value => updateExtractionFps(value)}
                    />
                    <span className="frame-workbench-fps-unit">帧/秒</span>
                  </div>
                </div>

                <div className="frame-workbench-param">
                  <div className="frame-workbench-param-head">
                    <span className="frame-workbench-param-title">片段范围</span>
                    <strong className="frame-workbench-param-value">{formatTimestamp(startTime)} - {formatTimestamp(endTime ?? videoDuration)}</strong>
                  </div>
                  <Slider
                    className="frame-workbench-range-slider"
                    range={{ draggableTrack: true }}
                    min={0}
                    max={videoDuration || 1}
                    step={0.1}
                    disabled={!videoDuration}
                    value={[startTime, endTime ?? videoDuration ?? 1]}
                    tooltip={{ formatter: (value?: number) => formatTimestamp(value) }}
                    onChange={updateExtractionRange}
                  />
                  <label className="frame-workbench-loop-toggle">
                    <Checkbox checked={looping} onChange={event => setLooping(event.target.checked)}>循环预览</Checkbox>
                  </label>
                </div>
              </div>

              <div className="frame-workbench-summary">
                <div className="frame-workbench-summary-main">
                  <span>预估帧数</span>
                  <strong>{metaLoading ? '--' : (estimatedFrames ?? '--')}<em>帧</em></strong>
                </div>
                <div className="frame-workbench-summary-meta">
                  <span>视频时长 <b>{formatTimestamp(videoDuration)}</b></span>
                  <span>源帧率 <b>{sourceFps ? `${sourceFps.toFixed(1)} fps` : '--'}</b></span>
                  <span>已提取 <b>{frames.length || '--'} 帧</b></span>
                </div>
                {estimatedFrames != null && estimatedFrames > 120 && (
                  <p className="frame-workbench-summary-warn">预计帧数较多，处理与导出会变慢，建议缩小范围或降低帧率。</p>
                )}
              </div>
            </div>
          </div>
              <div className="frame-workbench-card-actions">{actionButtons}</div>
            </div>
          )}
        </section>

        <section className={stepCardClass(1)}>
          <button type="button" className="frame-workbench-card-head" disabled={!frames.length && !canUndo} onClick={() => toggleStepCard(1)}>
            <span>2. 编辑与整理</span>
            <small>{renderStepState(1)}</small>
          </button>
          {isStepOpen(1) && (
            <div className="frame-workbench-card-body">
          <div className="frame-workbench-organize frame-organize-shell">
            <div className="frame-organize-topbar">
              <div className="frame-organize-mode-group">
                <span className="frame-organize-warning">刷新或关闭浏览器将丢失当前编辑</span>
              </div>
              <div className="frame-organize-stats">
                <span>总帧 <b>{frames.length}</b></span>
                <span>工作集 <b>{worksetFrames.length}</b></span>
                <span>已编辑 <b>{frames.filter(frame => frame.editedUrl).length}</b></span>
              </div>
            </div>

            <div className="frame-organize-commandbar" aria-label="编辑与整理操作">
              <span className="frame-organize-command-label">历史</span>
              <Button
                size="small"
                icon={<UndoOutlined />}
                disabled={!canUndo}
                title={undoActionLabel ? `撤销：${undoActionLabel}（Ctrl/Cmd+Z）` : '没有可撤销的操作'}
                aria-label={undoActionLabel ? `撤销：${undoActionLabel}` : '撤销'}
                onClick={undoFrameChange}
              >
                撤销
              </Button>
              <Button
                size="small"
                icon={<RedoOutlined />}
                disabled={!canRedo}
                title={redoActionLabel ? `重做：${redoActionLabel}（Ctrl/Cmd+Shift+Z 或 Ctrl+Y）` : '没有可重做的操作'}
                aria-label={redoActionLabel ? `重做：${redoActionLabel}` : '重做'}
                onClick={redoFrameChange}
              >
                重做
              </Button>
              <span className="frame-organize-command-divider" aria-hidden="true" />
              <Button size="small" icon={<SelectOutlined />} disabled={!frames.length || worksetFrames.length === frames.length} onClick={selectAllWorkset}>全选工作集</Button>
              <Button size="small" icon={<SelectOutlined />} onClick={invertWorkset}>反选工作集</Button>
              <Button size="small" icon={<RightOutlined />} disabled={!activeFrame} onClick={excludeAfterCurrent}>后续移出</Button>
              <Button size="small" icon={<SwapOutlined />} onClick={reverseWorkset}>工作集反转</Button>
              <Button size="small" icon={<RetweetOutlined />} onClick={sortFrames}>自动排序</Button>
              <Button size="small" icon={<FilterOutlined />} disabled={worksetFrames.length < 2} onClick={() => setReduceModalOpen(true)}>减帧</Button>
              <Button size="small" icon={<SearchOutlined />} disabled={worksetFrames.length < 2} onClick={() => setSimilarityModalOpen(true)}>相似度查找</Button>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={!worksetFrames.length} onClick={deleteWorkset}>删除工作集</Button>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={worksetFrames.length === frames.length} onClick={deleteUnincluded}>删除未入集</Button>
            </div>

            <div className="frame-organize-board">
              <section className="frame-organize-frames-panel" aria-label="帧缩略图">
                <div className="frame-organize-panel-head">
                  <div className="frame-editor-motion-title">
                    <span>帧缩略图</span>
                    <small aria-live="polite">
                      {worksetMultiSelecting
                        ? '连续反选中：经过的图片将切换选中状态，松开鼠标结束'
                        : `已加入工作集: ${worksetFrames.length} / ${frames.length} 帧 · 按住勾选框后拖动可连续反选`}
                    </small>
                  </div>
                  <Segmented size="small" value={previewMode} onChange={value => setPreviewMode(value as PreviewMode)} options={[{ label: '编辑画面', value: 'final' }, { label: '原始画面', value: 'raw' }]} />
                </div>

                <Spin spinning={loadingPreview || backgroundLoading}>
                  {frames.length ? (
                    <div className={`frame-editor-grid frame-organize-grid ${worksetMultiSelecting ? 'is-multi-selecting' : ''}`}>
                      {frames.map(frame => {
                        const isCurrent = activeFrame?.id === frame.id;
                        return (
                          <div
                            key={frame.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`第 ${frame.index + 1} 帧${frame.included ? '，已加入工作集' : '，未加入工作集'}`}
                            className={`frame-editor-tile ${frame.included ? 'workset' : ''} ${isCurrent ? 'preview-current' : ''} ${!frame.included ? 'excluded' : ''}`}
                            onClick={() => setActiveFrame(frame)}
                            onPointerEnter={event => enterFrameDuringWorksetMultiSelect(event, frame.id)}
                            onKeyDown={event => {
                              if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                                event.preventDefault();
                                setActiveFrame(frame);
                              }
                            }}
                          >
                            <AntImage src={getFrameDisplayUrl(frame, previewMode)} alt={`第 ${frame.index + 1} 帧`} preview={false} />
                            <span className="frame-editor-check" onPointerDown={event => startWorksetMultiSelect(event, frame.id)}>
                              <Checkbox
                                aria-label={frame.included ? '移出工作集' : '加入工作集'}
                                checked={frame.included}
                                onClick={event => {
                                  event.stopPropagation();
                                  if (suppressWorksetClickRef.current !== frame.id) return;
                                  event.preventDefault();
                                  window.setTimeout(() => {
                                    if (suppressWorksetClickRef.current === frame.id) suppressWorksetClickRef.current = null;
                                  }, 0);
                                }}
                                onChange={() => {
                                  if (suppressWorksetClickRef.current !== frame.id) toggleWorksetFrame(frame.id);
                                }}
                              />
                            </span>
                            <button type="button" className="frame-editor-delete-button" aria-label="删除此帧" onClick={event => { event.stopPropagation(); deleteFrame(frame); }}><DeleteOutlined /></button>
                            <button type="button" className="frame-editor-preview-button" aria-label="放大预览" onClick={event => { event.stopPropagation(); setImagePreview({ url: getFrameDisplayUrl(frame, previewMode), alt: `第 ${frame.index + 1} 帧预览` }); }}><EyeOutlined /></button>
                            <button type="button" className="frame-editor-edit-button" aria-label="编辑此图片" onClick={event => { event.stopPropagation(); setEditorFrameId(frame.id); }}><EditOutlined /></button>
                            {!!frame.markers.length && <span className="frame-editor-markers">{frame.markers.map(marker => <b key={marker}>{markerText[marker]}</b>)}</span>}
                            {frame.backgroundRemovedUrl && <span className="frame-editor-badge bg"><BgColorsOutlined /></span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : <div className="frame-editor-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先在第 1 步提取帧" /></div>}
                </Spin>
              </section>

              <aside className="frame-organize-preview-panel" aria-label="动画预览与属性">
                <div className="frame-organize-preview-card">
                  <div className="frame-editor-motion-head">
                    <div className="frame-editor-motion-title">
                      <span>动画预览</span>
                      <small>{motionFrame ? `#${String(motionFrame.index + 1).padStart(3, '0')} · ${effectivePlaybackFps.toFixed(effectivePlaybackFps % 1 ? 1 : 0)} fps` : '暂无帧'}</small>
                    </div>
                    <div className="frame-editor-motion-actions">
                      <Button size="small" icon={<LeftOutlined />} disabled={!worksetFrames.length} onClick={() => stepFrame(-1)} />
                      <Button size="small" type={previewPlaying ? 'primary' : 'default'} icon={previewPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />} disabled={worksetFrames.length < 2} onClick={() => setPreviewPlaying(prev => !prev)} />
                      <Button size="small" icon={<RightOutlined />} disabled={!worksetFrames.length} onClick={() => stepFrame(1)} />
                    </div>
                  </div>
                  <div className="frame-organize-preview-stage">
                    {motionFrame ? (
                      <AntImage src={getFrameDisplayUrl(motionFrame, previewMode)} alt="工作集预览" preview={{ mask: '预览' }} />
                    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可预览帧" />}
                  </div>
                  <div className="frame-organize-playback">
                    <div className="frame-organize-playback-row">
                      <span>第</span>
                      <InputNumber size="small" min={1} max={Math.max(1, worksetFrames.length)} value={activeWorksetIndex + 1 || 1} onChange={jumpToFrame} />
                      <span>/ {worksetFrames.length || 0} 帧</span>
                    </div>
                    <Slider
                      className="frame-organize-frame-slider"
                      min={1}
                      max={Math.max(1, worksetFrames.length)}
                      step={1}
                      disabled={!worksetFrames.length}
                      value={activeWorksetIndex + 1 || 1}
                      tooltip={{ formatter: value => (value ? `第 ${value} 帧` : '') }}
                      onChange={value => { if (typeof value === 'number') jumpToFrame(value); }}
                    />
                    <div className="frame-organize-speed-row">
                      <span>播放速度</span>
                      <Slider min={0.5} max={60} step={0.5} value={playbackFps ?? effectivePlaybackFps} onChange={value => { if (typeof value === 'number') setPlaybackFps(value); }} />
                      <b>{effectivePlaybackFps.toFixed(effectivePlaybackFps % 1 ? 1 : 0)} fps</b>
                    </div>
                  </div>
                </div>

                <div className="frame-organize-side-section">
                  <div className="frame-editor-section-title">当前帧</div>
                  <div className="frame-organize-frame-meta">
                    <span>编号 <b>{activeFrame ? `#${String(activeFrame.index + 1).padStart(3, '0')}` : '--'}</b></span>
                    <span>时间 <b>{formatTimestamp(activeFrame?.time)}</b></span>
                    <span>尺寸 <b>{activeFrame ? `${activeFrame.width}×${activeFrame.height}` : '--'}</b></span>
                    <span>状态 <b>{activeFrame?.editedUrl ? '已手动编辑' : activeFrame?.backgroundRemovedUrl ? '已处理背景' : '原始帧'}</b></span>
                  </div>
                </div>

                <div className="frame-organize-side-section">
                  <div className="frame-editor-section-title">工作集概览</div>
                  <div className="frame-organize-stat-grid">
                    <div><span>总帧</span><strong>{frames.length}</strong></div>
                    <div><span>工作集</span><strong>{worksetFrames.length}</strong></div>
                    <div><span>未入集</span><strong>{frames.length - worksetFrames.length}</strong></div>
                    <div><span>原始帧</span><strong>{frames.filter(frame => !frame.backgroundRemovedUrl && !frame.editedUrl).length}</strong></div>
                    <div><span>已抠图</span><strong>{frames.filter(frame => frame.backgroundRemovedUrl).length}</strong></div>
                    <div><span>已编辑</span><strong>{frames.filter(frame => frame.editedUrl).length}</strong></div>
                  </div>
                </div>

              </aside>
            </div>
          </div>
              <div className="frame-workbench-card-actions">{actionButtons}</div>
            </div>
          )}
        </section>

        <section className={stepCardClass(2)}>
          <button type="button" className="frame-workbench-card-head" disabled={!frames.length} onClick={() => toggleStepCard(2)}>
            <span>3. 导出</span>
            <small>{renderStepState(2)}</small>
          </button>
          {isStepOpen(2) && (
            <div className="frame-workbench-card-body">
          <div className="frame-editor-layout frame-workbench-export">
            <div className="frame-editor-controls">
              <div className="frame-editor-section">
                <div className="frame-editor-section-title">导出格式</div>
                <Segmented
                  block
                  value={output}
                  onChange={value => setOutput(value as VideoFrameExportOutput)}
                  options={[
                    { label: 'ZIP', value: 'zip', icon: <DownloadOutlined /> },
                    { label: 'Sprite Sheet', value: 'spritesheet', icon: <AppstoreOutlined /> },
                    { label: 'GIF', value: 'gif', icon: <PlayCircleOutlined /> },
                  ]}
                />
              </div>
              <div className="frame-editor-section">
                <div className="frame-editor-section-title">文件名</div>
                <Checkbox checked={useVideoName} onChange={event => setUseVideoName(event.target.checked)}>使用视频名</Checkbox>
                <Input value={filename} disabled={useVideoName} onChange={event => setFilename(event.target.value)} placeholder="sprite" />
                {output === 'zip' && <Input value={nameTemplate} onChange={event => setNameTemplate(event.target.value)} addonBefore="命名模板" placeholder="{n:03}" />}
              </div>
              {output === 'spritesheet' && (
                <div className="frame-editor-section">
                  <div className="frame-editor-section-title">布局</div>
                  <label className="frame-editor-field"><span>行数</span><InputNumber min={1} max={128} value={rows ?? undefined} placeholder="1" onChange={value => setRows(typeof value === 'number' ? value : null)} /></label>
                  <p className="frame-editor-help">留空时按 1 行排列，列数根据工作集帧数自动计算。</p>
                </div>
              )}
              <div className="frame-editor-section">
                <div className="frame-editor-section-title">尺寸</div>
                <div className="frame-editor-size-row">
                  <label className="frame-editor-field compact"><span>宽</span><InputNumber min={1} max={MAX_EXPORT_SIZE} value={cellWidth ?? undefined} placeholder={exportPlan.naturalFrameWidth ? `${exportPlan.naturalFrameWidth}` : '原宽'} onChange={value => setCellWidth(typeof value === 'number' ? value : null)} /></label>
                  <label className="frame-editor-field compact"><span>高</span><InputNumber min={1} max={MAX_EXPORT_SIZE} value={cellHeight ?? undefined} placeholder={exportPlan.naturalFrameHeight ? `${exportPlan.naturalFrameHeight}` : '原高'} onChange={value => setCellHeight(typeof value === 'number' ? value : null)} /></label>
                </div>
                {exportPlan.autoAdaptsFrameSizes && (
                  <p className="frame-editor-help">检测到不同单帧尺寸，导出时将按比例适配到 {exportPlan.naturalFrameWidth}×{exportPlan.naturalFrameHeight}。</p>
                )}
                {output === 'gif' && <p className="frame-editor-help">GIF 透明支持有限，透明素材推荐 ZIP 或 Sprite Sheet。</p>}
              </div>
              <div className="frame-editor-section">
                <div className="frame-editor-section-title">导出摘要</div>
                <div className="frame-editor-summary">
                  <div><span>工作集</span><strong>{exportPlan.count}</strong></div>
                  <div><span>已抠图</span><strong>{exportPlan.backgroundRemoved}</strong></div>
                  <div><span>已编辑</span><strong>{exportPlan.edited}</strong></div>
                  <div><span>原始帧</span><strong>{exportPlan.raw}</strong></div>
                  <div><span>单帧</span><strong>{exportPlan.frameSize}</strong></div>
                  <div><span>整图</span><strong>{exportPlan.sheetSize}</strong></div>
                  <div><span>布局</span><strong>{exportPlan.grid}</strong></div>
                  <div><span>时长</span><strong>{exportPlan.duration}</strong></div>
                </div>
              </div>
              {exportProgress && (
                <div className="frame-editor-section frame-editor-export-progress">
                  <div className="frame-editor-section-title">导出进度</div>
                  <Progress percent={exportProgress.percent} size="small" status={exportProgress.error ? 'exception' : exportProgress.done ? 'success' : 'active'} />
                  <p className="frame-editor-help">{exportProgress.message}</p>
                </div>
              )}
            </div>
            <div className="frame-editor-main">
              <div className="frame-workbench-export-preview">
                <div className="frame-editor-motion-head">
                  <div className="frame-editor-motion-title">
                    <span>导出预览</span>
                    <small>
                      {output === 'spritesheet'
                        ? `${currentFilename}.png · ${exportPlan.grid} · ${exportPlan.frameSize}`
                        : `${currentFilename} · ${output.toUpperCase()}`}
                    </small>
                  </div>
                </div>
                <div ref={exportPreviewStageRef} className={`frame-workbench-export-stage ${output === 'spritesheet' ? 'sheet' : ''}`}>
                  <div
                    className={`frame-workbench-export-grid ${output === 'spritesheet' ? `sheet ${cellWidth || cellHeight ? 'manual-size' : ''}` : ''}`}
                    style={output === 'spritesheet' && exportPlan.columns && exportPlan.rows && exportPlan.sheetWidth && exportPlan.sheetHeight
                      ? {
                          gridTemplateColumns: `repeat(${exportPlan.columns}, minmax(0, 1fr))`,
                          gridTemplateRows: `repeat(${exportPlan.rows}, minmax(0, 1fr))`,
                          aspectRatio: `${exportPlan.sheetWidth} / ${exportPlan.sheetHeight}`,
                          width: fittedSheetPreviewSize ? `${fittedSheetPreviewSize.width}px` : '100%',
                          height: fittedSheetPreviewSize ? `${fittedSheetPreviewSize.height}px` : undefined,
                        }
                      : undefined}
                  >
                    {(output === 'spritesheet' ? worksetFrames : worksetFrames.slice(0, 120)).map(frame => (
                      <img key={frame.id} src={getFrameExportUrl(frame)} alt={`export ${frame.index + 1}`} />
                    ))}
                  </div>
                </div>
                {output !== 'spritesheet' && worksetFrames.length > 120 && <p className="frame-editor-help">仅预览前 120 帧，导出仍包含全部工作集帧。</p>}
              </div>
            </div>
          </div>
              <div className="frame-workbench-card-actions">{actionButtons}</div>
            </div>
          )}
        </section>

        {imagePreview && (
          <AntImage
            src={imagePreview.url}
            alt={imagePreview.alt}
            wrapperStyle={{ display: 'none' }}
            preview={{ visible: true, src: imagePreview.url, onVisibleChange: visible => { if (!visible) setImagePreview(null); } }}
          />
        )}
        <Modal
          open={reduceModalOpen}
          title="减帧设置"
          centered
          okText="应用减帧"
          cancelText="取消"
          okButtonProps={{ disabled: worksetFrames.length < 2 }}
          onOk={reduceFrames}
          onCancel={() => setReduceModalOpen(false)}
          destroyOnHidden
        >
          <div className="frame-tool-dialog">
            <label className="frame-tool-dialog-field">
              <span>每组帧数</span>
              <InputNumber min={2} max={60} step={1} precision={0} value={frameStep ?? undefined} onChange={value => setFrameStep(typeof value === 'number' ? Math.round(value) : null)} />
            </label>
            <div className="frame-tool-dialog-field stacked">
              <span>保留位置</span>
              <Segmented
                block
                value={reduceKeepPosition}
                onChange={value => setReduceKeepPosition(value as ReduceKeepPosition)}
                options={[
                  { label: '每组第一帧', value: 'first' },
                  { label: '每组最后一帧', value: 'last' },
                ]}
              />
            </div>
            <p className="frame-editor-help">
              当前工作集 {worksetFrames.length} 帧，预计保留 {Math.ceil(worksetFrames.length / normalizedFrameStep)} 帧。未入集帧不受影响。
            </p>
          </div>
        </Modal>
        <Modal
          open={similarityModalOpen}
          title="相似度查找"
          centered
          footer={null}
          maskClosable={analyzingMarker === null}
          closable={analyzingMarker === null}
          onCancel={() => { if (analyzingMarker === null) setSimilarityModalOpen(false); }}
          destroyOnHidden
        >
          <div className="frame-tool-dialog">
            <label className="frame-tool-dialog-field">
              <span>相似度阈值</span>
              <InputNumber min={1} max={64} value={similarityThreshold} disabled={analyzingMarker !== null} onChange={value => setSimilarityThreshold(typeof value === 'number' ? value : 18)} />
            </label>
            <p className="frame-editor-help">基于当前工作集查找。命中结果会替换为新的工作集，操作可撤销。</p>
            <div className="frame-tool-dialog-actions">
              <Button icon={<SearchOutlined />} loading={analyzingMarker === 'loop'} disabled={analyzingMarker !== null} onClick={() => analyzeMarker('loop')}>寻找循环帧</Button>
              <Button icon={<SearchOutlined />} loading={analyzingMarker === 'jump'} disabled={analyzingMarker !== null} onClick={() => analyzeMarker('jump')}>寻找跳变帧</Button>
              <Button icon={<SearchOutlined />} loading={analyzingMarker === 'duplicate'} disabled={analyzingMarker !== null} onClick={() => analyzeMarker('duplicate')}>寻找重复帧</Button>
            </div>
          </div>
        </Modal>
        {editorFrame && (
          <FrameCanvasEditor
            frame={editorFrame}
            previewId={previewId}
            open={!!editorFrame}
            backgroundOptions={bg}
            backgroundLoading={backgroundLoading}
            worksetLoading={backgroundLoading || worksetEditLoading}
            worksetFrameCount={worksetFrames.length}
            onClose={() => setEditorFrameId(null)}
            onSaved={(url, width, height) => saveEditedFrame(editorFrame.id, url, width, height)}
            onApplyBackgroundWorkset={() => applyBackgroundToFrames(worksetFrames)}
            onApplyUpscaleWorkset={(method, scale, colorReplacement) => applyUpscaleToFrames(worksetFrames, method, scale, colorReplacement)}
            onApplyColorReplacementWorkset={options => applyColorReplacementToFrames(worksetFrames, options)}
            onRestoreBackgroundWorkset={() => restoreFrames(worksetFrames)}
          />
        )}
      </div>
    </Modal>
    <Modal
      open={workbenchCloseConfirmOpen}
      centered
      width={440}
      zIndex={1400}
      rootClassName="image-editor-close-confirm-root"
      className="image-editor-close-confirm"
      title={(
        <div className="image-editor-close-confirm-title">
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>关闭视频转精灵图工作台？</span>
        </div>
      )}
      okText="确认关闭"
      cancelText="继续编辑"
      okButtonProps={{ danger: true }}
      maskClosable={false}
      onOk={confirmWorkbenchClose}
      onCancel={cancelWorkbenchClose}
      destroyOnHidden
    >
      <p className="image-editor-close-confirm-copy">
        {frames.length
          ? `关闭后，已提取的 ${frames.length} 帧、工作集整理和未导出结果都将丢失。`
          : '关闭后，当前工作台设置将被清空。'}
      </p>
    </Modal>
    </>
  );
}

interface ImageEditorModalProps {
  open: boolean;
  imageUrl: string | null;
  onClose: () => void;
  onSaved?: (url: string) => void;
}

export function ImageEditorModal({ open, imageUrl, onClose, onSaved }: ImageEditorModalProps) {
  const backgroundOptions = useBackgroundOptions();

  const frame = useMemo<VideoSpriteFrame | null>(() => imageUrl ? {
    id: `image-editor-${imageUrl}`,
    index: 0,
    sourceUrl: imageUrl,
    included: true,
    time: null,
    width: 0,
    height: 0,
    sourceWidth: 0,
    sourceHeight: 0,
    markers: [],
  } : null, [imageUrl]);

  if (!frame) return null;

  return (
    <FrameCanvasEditor
      frame={frame}
      previewId={null}
      open={open}
      backgroundOptions={backgroundOptions}
      backgroundLoading={false}
      worksetLoading={false}
      worksetFrameCount={1}
      showBatchActions={false}
      contextLabel="聊天结果"
      onClose={onClose}
      onSaved={url => onSaved?.(url)}
      onApplyBackgroundWorkset={async () => false}
      onApplyUpscaleWorkset={async () => false}
      onApplyColorReplacementWorkset={async () => false}
      onRestoreBackgroundWorkset={() => undefined}
    />
  );
}

async function loadImageVector(url: string): Promise<number[]> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0, 16, 16);
  const data = ctx.getImageData(0, 0, 16, 16).data;
  const vector: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    vector.push((data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) * (data[i + 3] / 255));
  }
  return vector;
}

function vectorDistance(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  if (!length) return 255;
  let total = 0;
  for (let i = 0; i < length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / length;
}

interface FrameCanvasEditorProps {
  frame: VideoSpriteFrame;
  previewId: string | null;
  open: boolean;
  backgroundOptions: ReturnType<typeof useBackgroundOptions>;
  backgroundLoading: boolean;
  worksetLoading: boolean;
  worksetFrameCount: number;
  onClose: () => void;
  onSaved: (url: string, width: number, height: number) => void;
  onApplyBackgroundWorkset: () => Promise<boolean>;
  onApplyUpscaleWorkset: (
    method: ImageUpscaleMethodId,
    scale: 2 | 4,
    colorReplacement?: WorksetColorReplacementOptions,
  ) => Promise<boolean>;
  onApplyColorReplacementWorkset: (options: WorksetColorReplacementOptions) => Promise<boolean>;
  onRestoreBackgroundWorkset: () => void;
  showBatchActions?: boolean;
  contextLabel?: string;
}

function FrameCanvasEditor({
  frame,
  previewId,
  open,
  backgroundOptions,
  backgroundLoading,
  worksetLoading,
  worksetFrameCount,
  onClose,
  onSaved,
  onApplyBackgroundWorkset,
  onApplyUpscaleWorkset,
  onApplyColorReplacementWorkset,
  onRestoreBackgroundWorkset,
  showBatchActions = true,
  contextLabel,
}: FrameCanvasEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeCanvasRef = useRef<HTMLCanvasElement>(null);
  const initialCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const restoreStrokeSourceRef = useRef<ImageData | null>(null);
  const restoreStrokeMaskRef = useRef<HTMLCanvasElement | null>(null);
  const restoreStrokeLayerRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const panningRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const autoFitRef = useRef(true);
  const zoomRef = useRef(1);
  const canvasPanRef = useRef({ x: 0, y: 0 });
  const imageLoadIdRef = useRef(0);
  const backgroundPreviewRequestIdRef = useRef(0);
  const backgroundPreviewTimerRef = useRef<number | null>(null);
  const observedBackgroundOptionsKeyRef = useRef('');
  const skipReloadUrlRef = useRef<string | null>(null);
  const historyRef = useRef<CanvasHistoryEntry[]>([]);
  const redoRef = useRef<CanvasHistoryEntry[]>([]);
  const contentDirtyRef = useRef(false);
  const parameterDirtyRef = useRef(false);
  const dirtyRef = useRef(false);
  const closeConfirmOpenRef = useRef(false);
  const liveFloodRef = useRef<{ tool: 'fill' | 'replace'; x: number; y: number; source: ImageData } | null>(null);
  const floodOutputRef = useRef<ImageData | null>(null);
  const floodSeenRef = useRef<Uint8Array | null>(null);
  const floodStackRef = useRef<Int32Array | null>(null);
  const floodMaskRef = useRef<Uint8Array | null>(null);
  const worksetReplaceTargetRef = useRef<Pick<
    WorksetColorReplacementOptions,
    'targetColor' | 'targetXRatio' | 'targetYRatio'
  > | null>(null);
  const softenSourceRef = useRef<ImageData | null>(null);
  const floodRenderTimerRef = useRef<number | null>(null);
  const floodRenderFrameRef = useRef<number | null>(null);
  const softenRenderFrameRef = useRef<number | null>(null);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  const upscaleMethodRef = useRef<ImageUpscaleMethodId>('realesrgan_anime');
  const upscaleScaleRef = useRef<2 | 4>(2);
  const [tool, setTool] = useState<CanvasTool>('replace');
  const [color, setColor] = useState('#ffffff');
  const [replaceWithTransparency, setReplaceWithTransparency] = useState(true);
  const [eraserMode, setEraserMode] = useState<EraserMode>('restore');
  const [replaceMatchMode, setReplaceMatchMode] = useState<TransparentReplaceMatchMode>(DEFAULT_TRANSPARENT_REPLACE_MATCH_MODE);
  const [replaceEdgeEnhancementMode, setReplaceEdgeEnhancementMode] = useState<TransparentEdgeEnhancementMode>(DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT_MODE);
  const [replaceEdgeCleanup, setReplaceEdgeCleanup] = useState(DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT);
  const [brushSize, setBrushSize] = useState(16);
  const [opacity, setOpacity] = useState(1);
  const [fillTolerance, setFillTolerance] = useState(DEFAULT_FILL_TOLERANCE);
  const [colorReplaceTolerance, setColorReplaceTolerance] = useState(DEFAULT_COLOR_REPLACE_TOLERANCE);
  const [replaceTolerance, setReplaceTolerance] = useState(DEFAULT_REPLACE_TOLERANCE);
  const [softenRadius, setSoftenRadius] = useState(2);
  const [zoom, setZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: frame.width, height: frame.height });
  const [imageLoading, setImageLoading] = useState(true);
  const [imageReady, setImageReady] = useState(false);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [brushPreview, setBrushPreview] = useState<{ x: number; y: number } | null>(null);
  const [backgroundPreviewEnabled, setBackgroundPreviewEnabled] = useState(false);
  const [backgroundPreviewPending, setBackgroundPreviewPending] = useState(false);
  const [backgroundPreviewLoading, setBackgroundPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [replacePreviewActive, setReplacePreviewActive] = useState(false);
  const [upscaleMethods, setUpscaleMethods] = useState<ImageUpscaleMethod[]>(defaultUpscaleMethods);
  const [upscaleMethod, setUpscaleMethod] = useState<ImageUpscaleMethodId>('realesrgan_anime');
  const [upscaleScale, setUpscaleScale] = useState<2 | 4>(2);
  const [upscaleLimits, setUpscaleLimits] = useState({ maxEdge: 4096, maxPixels: 16_777_216 });
  const [upscaleMethodsLoading, setUpscaleMethodsLoading] = useState(false);
  const [upscaleLoading, setUpscaleLoading] = useState(false);
  const baseUrl = getFrameExportUrl(frame);
  const frameLabel = `#${String(frame.index + 1).padStart(3, '0')}`;
  const backgroundOptionsState = backgroundOptions.state;
  const backgroundOptionsToRequest = backgroundOptions.toRequest;
  const editorBusy = imageLoading || saving || backgroundLoading || backgroundPreviewPending || backgroundPreviewLoading || upscaleLoading || worksetLoading;
  const editorInteractive = imageReady && !editorBusy;
  const selectedUpscaleMethod = upscaleMethods.find(method => method.id === upscaleMethod) ?? upscaleMethods[0];
  const selectedUpscaleScale = selectedUpscaleMethod?.scale_availability.find(item => item.scale === upscaleScale);
  const upscaleMethodOptions = useMemo(() => {
    const groups = new Map<string, Array<{ value: ImageUpscaleMethodId; label: string; disabled: boolean; title: string }>>();
    for (const method of upscaleMethods) {
      const options = groups.get(method.algorithm_name) ?? [];
      options.push({
        value: method.id,
        label: method.label,
        disabled: !method.available,
        title: method.unavailable_reason || method.description,
      });
      groups.set(method.algorithm_name, options);
    }
    return Array.from(groups, ([label, options]) => ({ label, options }));
  }, [upscaleMethods]);
  const upscaleTarget = useMemo(
    () => getImageUpscaleTarget(
      canvasSize.width,
      canvasSize.height,
      upscaleScale,
      upscaleLimits,
      selectedUpscaleScale?.processing_scale ?? upscaleScale,
    ),
    [canvasSize.height, canvasSize.width, selectedUpscaleScale?.processing_scale, upscaleLimits, upscaleScale],
  );
  const upscaleMethodDisabledReason = !selectedUpscaleMethod?.available
    ? selectedUpscaleMethod?.unavailable_reason || '当前方法不可用'
    : !selectedUpscaleScale?.available
      ? selectedUpscaleScale?.unavailable_reason || '当前倍率不可用'
      : undefined;
  const upscaleDisabledReason = upscaleMethodDisabledReason || (!upscaleTarget.allowed
      ? upscaleTarget.reason
      : undefined);
  const changeUpscaleMethod = (value: ImageUpscaleMethodId) => {
    const method = upscaleMethods.find(item => item.id === value);
    upscaleMethodRef.current = value;
    setUpscaleMethod(value);
    if (method && !method.supported_scales.includes(upscaleScale) && method.supported_scales[0]) {
      upscaleScaleRef.current = method.supported_scales[0];
      setUpscaleScale(method.supported_scales[0]);
    }
  };
  let batchApplyDisabledReason: string | undefined;
  if (worksetLoading) batchApplyDisabledReason = '正在处理工作集';
  else if (tool !== 'background' && tool !== 'upscale' && tool !== 'replace') batchApplyDisabledReason = '当前工具不支持应用到工作集';
  else if (!imageReady) batchApplyDisabledReason = '当前图片尚未载入';
  else if (!worksetFrameCount) batchApplyDisabledReason = '工作集为空';
  else if (saving) batchApplyDisabledReason = '正在保存当前帧';
  else if (tool === 'replace' && (!replacePreviewActive || liveFloodRef.current?.tool !== 'replace')) batchApplyDisabledReason = '请先点击画布选择换色目标';
  else if (tool === 'upscale' && upscaleLoading) batchApplyDisabledReason = '正在放大当前帧';
  else if (tool === 'upscale' && upscaleMethodDisabledReason) batchApplyDisabledReason = upscaleMethodDisabledReason;
  else if (backgroundLoading) batchApplyDisabledReason = '正在批量处理背景';
  else if (backgroundPreviewLoading) batchApplyDisabledReason = '正在生成当前帧背景预览';
  else if (backgroundPreviewPending) batchApplyDisabledReason = '正在等待当前帧背景预览';

  const syncDirty = useCallback(() => {
    const dirty = contentDirtyRef.current || parameterDirtyRef.current;
    dirtyRef.current = dirty;
    setIsDirty(dirty);
  }, []);

  const updateContentDirty = useCallback((dirty: boolean) => {
    contentDirtyRef.current = dirty;
    syncDirty();
  }, [syncDirty]);

  const markParameterDirty = useCallback(() => {
    parameterDirtyRef.current = true;
    syncDirty();
  }, [syncDirty]);

  const clearDirty = useCallback(() => {
    contentDirtyRef.current = false;
    parameterDirtyRef.current = false;
    syncDirty();
  }, [syncDirty]);

  const requestClose = useCallback(() => {
    if (!dirtyRef.current) {
      onClose();
      return;
    }
    if (closeConfirmOpenRef.current) return;
    closeConfirmOpenRef.current = true;
    setCloseConfirmOpen(true);
  }, [onClose]);

  const cancelClose = () => {
    closeConfirmOpenRef.current = false;
    setCloseConfirmOpen(false);
  };

  const confirmClose = () => {
    closeConfirmOpenRef.current = false;
    setCloseConfirmOpen(false);
    onClose();
  };

  const cancelPendingPreviewRender = useCallback(() => {
    if (floodRenderTimerRef.current !== null) {
      window.clearTimeout(floodRenderTimerRef.current);
      floodRenderTimerRef.current = null;
    }
    if (floodRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(floodRenderFrameRef.current);
      floodRenderFrameRef.current = null;
    }
    if (softenRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(softenRenderFrameRef.current);
      softenRenderFrameRef.current = null;
    }
  }, []);

  const cancelScheduledBackgroundPreview = useCallback(() => {
    if (backgroundPreviewTimerRef.current !== null) {
      window.clearTimeout(backgroundPreviewTimerRef.current);
      backgroundPreviewTimerRef.current = null;
    }
    setBackgroundPreviewPending(false);
  }, []);

  const cancelBackgroundPreviewActivity = useCallback(() => {
    cancelScheduledBackgroundPreview();
    backgroundPreviewRequestIdRef.current += 1;
    setBackgroundPreviewLoading(false);
  }, [cancelScheduledBackgroundPreview]);

  const resetBackgroundPreview = useCallback(() => {
    cancelBackgroundPreviewActivity();
    observedBackgroundOptionsKeyRef.current = '';
    setBackgroundPreviewEnabled(false);
  }, [cancelBackgroundPreviewActivity]);

  useEffect(() => () => {
    backgroundPreviewRequestIdRef.current += 1;
    if (backgroundPreviewTimerRef.current !== null) window.clearTimeout(backgroundPreviewTimerRef.current);
  }, []);

  const pushHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current.push({
      image,
      contentDirty: contentDirtyRef.current,
    });
    trimCanvasHistory(historyRef.current);
    redoRef.current = [];
    return image;
  }, []);

  const fitCanvasToStage = useCallback(() => {
    const stage = wrapRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas || !canvas.width || !canvas.height) return;
    const style = window.getComputedStyle(stage);
    const availableWidth = stage.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    const availableHeight = stage.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0);
    if (availableWidth <= 0 || availableHeight <= 0) return;
    const fittedZoom = Math.min(2, availableWidth / canvas.width, availableHeight / canvas.height);
    const nextZoom = Math.max(0.01, Math.floor(fittedZoom * 100) / 100);
    autoFitRef.current = true;
    zoomRef.current = nextZoom;
    canvasPanRef.current = { x: 0, y: 0 };
    setZoom(nextZoom);
    setCanvasPan({ x: 0, y: 0 });
  }, []);

  const restoreCanvasHistoryEntry = useCallback((entry: CanvasHistoryEntry) => {
    const canvas = canvasRef.current;
    const strokeCanvas = strokeCanvasRef.current;
    if (!canvas) return;
    canvas.width = entry.image.width;
    canvas.height = entry.image.height;
    if (strokeCanvas) {
      strokeCanvas.width = entry.image.width;
      strokeCanvas.height = entry.image.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(entry.image, 0, 0);
    setCanvasSize({ width: entry.image.width, height: entry.image.height });
    updateContentDirty(entry.contentDirty);
    restoreStrokeSourceRef.current = null;
    restoreStrokeMaskRef.current = null;
    restoreStrokeLayerRef.current = null;
    liveFloodRef.current = null;
    setReplacePreviewActive(false);
    softenSourceRef.current = null;
    autoFitRef.current = true;
    window.requestAnimationFrame(fitCanvasToStage);
  }, [fitCanvasToStage, updateContentDirty]);

  const changeCanvasZoom = useCallback((value: number, anchorClientX?: number, anchorClientY?: number) => {
    const stage = wrapRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas || !canvas.width || !canvas.height) return;
    const currentZoom = zoomRef.current;
    const nextZoom = Math.min(4, Math.max(0.01, value));
    if (nextZoom === currentZoom) return;
    const stageRect = stage.getBoundingClientRect();
    const stageCenterX = stageRect.left + stageRect.width / 2;
    const stageCenterY = stageRect.top + stageRect.height / 2;
    const anchorOffsetX = (anchorClientX ?? stageCenterX) - stageCenterX;
    const anchorOffsetY = (anchorClientY ?? stageCenterY) - stageCenterY;
    const scale = nextZoom / currentZoom;
    const currentPan = canvasPanRef.current;
    const nextPan = {
      x: anchorOffsetX - (anchorOffsetX - currentPan.x) * scale,
      y: anchorOffsetY - (anchorOffsetY - currentPan.y) * scale,
    };
    autoFitRef.current = false;
    zoomRef.current = nextZoom;
    canvasPanRef.current = nextPan;
    setZoom(nextZoom);
    setCanvasPan(nextPan);
  }, []);

  const loadImage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cancelPendingPreviewRender();
    resetBackgroundPreview();
    const loadId = imageLoadIdRef.current + 1;
    imageLoadIdRef.current = loadId;
    setImageLoading(true);
    setImageReady(false);
    setImageLoadError(null);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new window.Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('图片加载失败'));
        image.src = baseUrl;
      });
      if (loadId !== imageLoadIdRef.current) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      if (!initialCanvasRef.current) {
        const initialCanvas = document.createElement('canvas');
        initialCanvas.width = canvas.width;
        initialCanvas.height = canvas.height;
        const initialCtx = initialCanvas.getContext('2d');
        if (initialCtx) {
          initialCtx.drawImage(canvas, 0, 0);
          initialCanvasRef.current = initialCanvas;
        }
      }
      setImageReady(true);
      historyRef.current = [];
      redoRef.current = [];
      worksetReplaceTargetRef.current = null;
      restoreStrokeSourceRef.current = null;
      restoreStrokeMaskRef.current = null;
      restoreStrokeLayerRef.current = null;
      updateContentDirty(false);
      liveFloodRef.current = null;
      setReplacePreviewActive(false);
      softenSourceRef.current = null;
      autoFitRef.current = true;
      window.requestAnimationFrame(fitCanvasToStage);
    } catch (err) {
      if (loadId === imageLoadIdRef.current) {
        setImageLoadError(getErrorMessage(err, '图片加载失败'));
        throw err;
      }
    } finally {
      if (loadId === imageLoadIdRef.current) setImageLoading(false);
    }
  }, [baseUrl, cancelPendingPreviewRender, fitCanvasToStage, resetBackgroundPreview, updateContentDirty]);

  const requestImageLoad = useCallback(() => {
    void loadImage().catch((err: unknown) => message.error(getErrorMessage(err, '编辑器载入图片失败')));
  }, [loadImage]);

  const runBackgroundPreview = useCallback(async (request: VideoBackgroundOptions) => {
    cancelBackgroundPreviewActivity();
    const requestId = backgroundPreviewRequestIdRef.current + 1;
    backgroundPreviewRequestIdRef.current = requestId;
    setBackgroundPreviewLoading(true);
    try {
      const res = await apiService.removeVideoFrameBackgrounds({
        frame_urls: [frame.sourceUrl],
        ...request,
      });
      const imageUrl = res.frames[0]?.image_url;
      if (requestId !== backgroundPreviewRequestIdRef.current || !imageUrl) return;
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new window.Image();
        nextImage.crossOrigin = 'anonymous';
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error('背景预览加载失败'));
        nextImage.src = imageUrl;
      });
      if (requestId !== backgroundPreviewRequestIdRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      cancelPendingPreviewRender();
      pushHistory();
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const strokeCanvas = strokeCanvasRef.current;
      if (strokeCanvas) {
        strokeCanvas.width = image.naturalWidth;
        strokeCanvas.height = image.naturalHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      updateContentDirty(true);
      setCanvasSize({ width: image.naturalWidth, height: image.naturalHeight });
      liveFloodRef.current = null;
      setReplacePreviewActive(false);
      softenSourceRef.current = null;
    } catch (err: unknown) {
      if (requestId === backgroundPreviewRequestIdRef.current) {
        message.error(getErrorMessage(err, '背景预览失败'));
      }
    } finally {
      if (requestId === backgroundPreviewRequestIdRef.current) {
        setBackgroundPreviewLoading(false);
      }
    }
  }, [cancelBackgroundPreviewActivity, cancelPendingPreviewRender, frame.sourceUrl, pushHistory, updateContentDirty]);

  const applyBackgroundPreview = () => {
    cancelBackgroundPreviewActivity();
    worksetReplaceTargetRef.current = null;
    observedBackgroundOptionsKeyRef.current = `${frame.sourceUrl}:${JSON.stringify(backgroundOptionsState)}`;
    setBackgroundPreviewEnabled(true);
    void runBackgroundPreview(backgroundOptionsToRequest());
  };

  useEffect(() => {
    if (!open) return;
    if (skipReloadUrlRef.current === baseUrl) {
      skipReloadUrlRef.current = null;
      return;
    }
    requestImageLoad();
  }, [baseUrl, open, requestImageLoad]);

  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const observer = new ResizeObserver(() => {
      if (autoFitRef.current) fitCanvasToStage();
    });
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [fitCanvasToStage, open]);

  useEffect(() => {
    const stage = wrapRef.current;
    if (!open || !stage) return;
    const handleWheel = (event: WheelEvent) => {
      if (!editorInteractive) return;
      event.preventDefault();
      setBrushPreview(null);
      changeCanvasZoom(zoomRef.current * (event.deltaY < 0 ? 1.1 : 0.9), event.clientX, event.clientY);
    };
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [changeCanvasZoom, editorInteractive, open]);

  useEffect(() => {
    cancelPendingPreviewRender();
    setBrushPreview(null);
  }, [cancelPendingPreviewRender, tool]);

  useEffect(() => {
    if (!open || tool !== 'upscale') return;
    let active = true;
    setUpscaleMethodsLoading(true);
    void apiService.getImageUpscaleMethods()
      .then(response => {
        if (!active) return;
        setUpscaleMethods(response.methods);
        setUpscaleLimits({ maxEdge: response.max_edge, maxPixels: response.max_pixels });
        const currentMethod = response.methods.find(method => method.id === upscaleMethodRef.current && method.available);
        const nextMethod = currentMethod ?? response.methods.find(method => method.id === 'lanczos') ?? response.methods[0];
        if (nextMethod) {
          upscaleMethodRef.current = nextMethod.id;
          setUpscaleMethod(nextMethod.id);
          const nextScale = nextMethod.supported_scales.includes(upscaleScaleRef.current)
            ? upscaleScaleRef.current
            : nextMethod.supported_scales[0];
          if (nextScale) {
            upscaleScaleRef.current = nextScale;
            setUpscaleScale(nextScale);
          }
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setUpscaleMethods(defaultUpscaleMethods.map(method => method.id === 'lanczos' ? method : {
          ...method,
          unavailable_reason: getErrorMessage(err, 'ComfyUI 方法检测失败'),
        }));
        upscaleMethodRef.current = 'lanczos';
        setUpscaleMethod('lanczos');
      })
      .finally(() => {
        if (active) setUpscaleMethodsLoading(false);
      });
    return () => { active = false; };
  }, [open, tool]);

  useEffect(() => {
    if (!backgroundPreviewEnabled || !open || !imageReady || saving || backgroundLoading) return;
    const key = `${frame.sourceUrl}:${JSON.stringify(backgroundOptionsState)}`;
    if (key === observedBackgroundOptionsKeyRef.current) return;
    observedBackgroundOptionsKeyRef.current = key;
    if (backgroundPreviewTimerRef.current !== null) window.clearTimeout(backgroundPreviewTimerRef.current);
    backgroundPreviewRequestIdRef.current += 1;
    setBackgroundPreviewLoading(false);
    setBackgroundPreviewPending(true);
    backgroundPreviewTimerRef.current = window.setTimeout(() => {
      backgroundPreviewTimerRef.current = null;
      setBackgroundPreviewPending(false);
      void runBackgroundPreview(backgroundOptionsToRequest());
    }, 350);
    return cancelBackgroundPreviewActivity;
  }, [backgroundLoading, backgroundOptionsState, backgroundOptionsToRequest, backgroundPreviewEnabled, cancelBackgroundPreviewActivity, frame.sourceUrl, imageReady, open, runBackgroundPreview, saving]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isVisiblePopupOpen()) return;
      if (closeConfirmOpenRef.current) return;
      if (editorBusy) return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editorBusy, open, requestClose]);

  useEffect(() => {
    if (!open || !isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, open]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const renderRestoreStroke = () => {
    const canvas = canvasRef.current;
    const initialCanvas = initialCanvasRef.current;
    const source = restoreStrokeSourceRef.current;
    const maskCanvas = restoreStrokeMaskRef.current;
    const restoreLayer = restoreStrokeLayerRef.current;
    const ctx = canvas?.getContext('2d');
    const layerCtx = restoreLayer?.getContext('2d');
    if (!canvas || !initialCanvas || !source || !maskCanvas || !restoreLayer || !ctx || !layerCtx) return;
    if (source.width !== canvas.width || source.height !== canvas.height) return;

    ctx.putImageData(source, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.restore();

    layerCtx.clearRect(0, 0, restoreLayer.width, restoreLayer.height);
    layerCtx.save();
    layerCtx.drawImage(initialCanvas, 0, 0, restoreLayer.width, restoreLayer.height);
    layerCtx.globalCompositeOperation = 'destination-in';
    layerCtx.drawImage(maskCanvas, 0, 0);
    layerCtx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(restoreLayer, 0, 0);
    ctx.restore();
  };

  const drawAt = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const strokeCanvas = strokeCanvasRef.current;
    if (!canvas || !strokeCanvas) return;
    if (tool === 'eraser') {
      if (eraserMode === 'restore') {
        const maskCtx = restoreStrokeMaskRef.current?.getContext('2d');
        if (!maskCtx) return;
        maskCtx.save();
        maskCtx.fillStyle = '#fff';
        maskCtx.beginPath();
        maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        maskCtx.fill();
        maskCtx.restore();
        renderRestoreStroke();
      } else {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      return;
    }
    const ctx = strokeCanvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const strokeCanvas = strokeCanvasRef.current;
    if (!canvas || !strokeCanvas) return;
    if (tool === 'eraser') {
      if (eraserMode === 'restore') {
        const maskCtx = restoreStrokeMaskRef.current?.getContext('2d');
        if (!maskCtx) return;
        maskCtx.save();
        maskCtx.strokeStyle = '#fff';
        maskCtx.lineWidth = brushSize;
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.beginPath();
        maskCtx.moveTo(from.x, from.y);
        maskCtx.lineTo(to.x, to.y);
        maskCtx.stroke();
        maskCtx.restore();
        renderRestoreStroke();
      } else {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    const targetCanvas = tool === 'brush' ? strokeCanvas : canvas;
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  const floodFill = useCallback((x: number, y: number, replaceOnly = false, source?: ImageData) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let imageData: ImageData;
    if (source) {
      if (!floodOutputRef.current || floodOutputRef.current.width !== source.width || floodOutputRef.current.height !== source.height) {
        floodOutputRef.current = new ImageData(source.width, source.height);
      }
      floodOutputRef.current.data.set(source.data);
      imageData = floodOutputRef.current;
    } else {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    const data = imageData.data;
    const startX = Math.floor(x);
    const startY = Math.floor(y);
    const idx = (startY * canvas.width + startX) * 4;
    const target = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    const rgb = hexToRgb(color);
    const pixelCount = canvas.width * canvas.height;
    if (replaceOnly) {
      if (replaceWithTransparency) {
        const result = applyHardTransparentReplacement(
          data,
          canvas.width,
          canvas.height,
          startX,
          startY,
          replaceTolerance,
          replaceEdgeCleanup,
          replaceMatchMode,
          replaceEdgeEnhancementMode,
        );
        if (!result) return;
        data.set(result);
        ctx.putImageData(imageData, 0, 0);
        return;
      }

      if (target[3] === 0) return;
      if (!floodMaskRef.current || floodMaskRef.current.length !== pixelCount) floodMaskRef.current = new Uint8Array(pixelCount);
      else floodMaskRef.current.fill(0);
      const selectionMask = floodMaskRef.current;
      const distanceToTarget = (pointIndex: number) => {
        const p = pointIndex * 4;
        return Math.max(
          Math.abs(data[p] - target[0]),
          Math.abs(data[p + 1] - target[1]),
          Math.abs(data[p + 2] - target[2]),
        );
      };
      if (!floodSeenRef.current || floodSeenRef.current.length !== pixelCount) floodSeenRef.current = new Uint8Array(pixelCount);
      else floodSeenRef.current.fill(0);
      if (!floodStackRef.current || floodStackRef.current.length !== pixelCount) floodStackRef.current = new Int32Array(pixelCount);
      const seen = floodSeenRef.current;
      const stack = floodStackRef.current;
      let stackSize = 0;
      const enqueue = (pointIndex: number) => {
        if (seen[pointIndex]) return;
        seen[pointIndex] = 1;
        const p = pointIndex * 4;
        if (data[p + 3] === 0 || distanceToTarget(pointIndex) > colorReplaceTolerance) return;
        selectionMask[pointIndex] = 255;
        stack[stackSize++] = pointIndex;
      };

      for (let edgeX = 0; edgeX < canvas.width; edgeX += 1) {
        enqueue(edgeX);
        enqueue((canvas.height - 1) * canvas.width + edgeX);
      }
      for (let edgeY = 1; edgeY < canvas.height - 1; edgeY += 1) {
        enqueue(edgeY * canvas.width);
        enqueue(edgeY * canvas.width + canvas.width - 1);
      }

      while (stackSize) {
        const pointIndex = stack[--stackSize];
        const cx = pointIndex % canvas.width;
        if (cx < canvas.width - 1) enqueue(pointIndex + 1);
        if (cx > 0) enqueue(pointIndex - 1);
        if (pointIndex < pixelCount - canvas.width) enqueue(pointIndex + canvas.width);
        if (pointIndex >= canvas.width) enqueue(pointIndex - canvas.width);
      }

      for (let pointIndex = 0; pointIndex < pixelCount; pointIndex += 1) {
        if (!selectionMask[pointIndex]) continue;
        const p = pointIndex * 4;
        data[p] = rgb.r;
        data[p + 1] = rgb.g;
        data[p + 2] = rgb.b;
        data[p + 3] = Math.round(opacity * 255);
      }
      ctx.putImageData(imageData, 0, 0);
      return;
    }

    if (!floodSeenRef.current || floodSeenRef.current.length !== pixelCount) floodSeenRef.current = new Uint8Array(pixelCount);
    else floodSeenRef.current.fill(0);
    if (!floodStackRef.current || floodStackRef.current.length !== pixelCount) floodStackRef.current = new Int32Array(pixelCount);
    const seen = floodSeenRef.current;
    const stack = floodStackRef.current;
    const startPoint = startY * canvas.width + startX;
    let stackSize = 1;
    stack[0] = startPoint;
    seen[startPoint] = 1;
    while (stackSize) {
      const pointIndex = stack[--stackSize];
      const p = pointIndex * 4;
      const distance = Math.max(
        Math.abs(data[p] - target[0]),
        Math.abs(data[p + 1] - target[1]),
        Math.abs(data[p + 2] - target[2]),
        Math.abs(data[p + 3] - target[3]),
      );
      if (distance > fillTolerance) continue;
      const sourceAlpha = opacity;
      const destinationAlpha = data[p + 3] / 255;
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      if (outputAlpha > 0) {
        data[p] = Math.round((rgb.r * sourceAlpha + data[p] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
        data[p + 1] = Math.round((rgb.g * sourceAlpha + data[p + 1] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
        data[p + 2] = Math.round((rgb.b * sourceAlpha + data[p + 2] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
      }
      data[p + 3] = Math.round(outputAlpha * 255);
      const cx = pointIndex % canvas.width;
      let next = cx < canvas.width - 1 ? pointIndex + 1 : -1;
      if (next >= 0 && !seen[next]) { seen[next] = 1; stack[stackSize++] = next; }
      next = cx > 0 ? pointIndex - 1 : -1;
      if (next >= 0 && !seen[next]) { seen[next] = 1; stack[stackSize++] = next; }
      next = pointIndex < pixelCount - canvas.width ? pointIndex + canvas.width : -1;
      if (next >= 0 && !seen[next]) { seen[next] = 1; stack[stackSize++] = next; }
      next = pointIndex >= canvas.width ? pointIndex - canvas.width : -1;
      if (next >= 0 && !seen[next]) { seen[next] = 1; stack[stackSize++] = next; }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [color, colorReplaceTolerance, fillTolerance, opacity, replaceEdgeCleanup, replaceEdgeEnhancementMode, replaceMatchMode, replaceTolerance, replaceWithTransparency]);

  useEffect(() => {
    const preview = liveFloodRef.current;
    if (!open || !preview || preview.tool !== tool) return;
    cancelPendingPreviewRender();
    floodRenderTimerRef.current = window.setTimeout(() => {
      floodRenderTimerRef.current = null;
      floodRenderFrameRef.current = window.requestAnimationFrame(() => {
        floodFill(preview.x, preview.y, preview.tool === 'replace', preview.source);
        floodRenderFrameRef.current = null;
      });
    }, 50);
    return cancelPendingPreviewRender;
  }, [cancelPendingPreviewRender, floodFill, open, tool]);

  const renderSoftenedEdges = useCallback((source: ImageData, radiusValue: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const radius = Math.max(1, Math.min(12, Math.round(radiusValue)));
    const imageData = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    const { data, width, height } = imageData;
    const sourceAlpha = new Uint8ClampedArray(width * height);
    for (let i = 0; i < sourceAlpha.length; i += 1) sourceAlpha[i] = data[i * 4 + 3];

    const horizontal = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) {
        const clamped = Math.max(0, Math.min(width - 1, x));
        sum += sourceAlpha[y * width + clamped];
      }
      for (let x = 0; x < width; x += 1) {
        horizontal[y * width + x] = sum / (radius * 2 + 1);
        const removeX = Math.max(0, x - radius);
        const addX = Math.min(width - 1, x + radius + 1);
        sum += sourceAlpha[y * width + addX] - sourceAlpha[y * width + removeX];
      }
    }

    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) {
        const clamped = Math.max(0, Math.min(height - 1, y));
        sum += horizontal[clamped * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        data[(y * width + x) * 4 + 3] = Math.round(sum / (radius * 2 + 1));
        const removeY = Math.max(0, y - radius);
        const addY = Math.min(height - 1, y + radius + 1);
        sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, []);

  const previewSoftenedEdges = useCallback((radiusValue: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!softenSourceRef.current) {
      liveFloodRef.current = null;
      setReplacePreviewActive(false);
      pushHistory();
      updateContentDirty(true);
      softenSourceRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    if (softenRenderFrameRef.current !== null) window.cancelAnimationFrame(softenRenderFrameRef.current);
    const source = softenSourceRef.current;
    softenRenderFrameRef.current = window.requestAnimationFrame(() => {
      renderSoftenedEdges(source, radiusValue);
      softenRenderFrameRef.current = null;
    });
  }, [pushHistory, renderSoftenedEdges, updateContentDirty]);

  const updateBrushPreview = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'brush' && tool !== 'eraser') return;
    const stage = wrapRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    setBrushPreview({
      x: event.clientX - stageRect.left,
      y: event.clientY - stageRect.top,
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || tool === 'background' || tool === 'soften' || tool === 'upscale') return;
    const { x, y } = getPoint(event);
    if (tool === 'fill' || tool === 'replace') {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (tool === 'replace' && !isHardTransparentReplacementTarget(
        source.data,
        canvas.width,
        canvas.height,
        Math.floor(x),
        Math.floor(y),
      )) return;
      if (tool === 'replace') {
        const targetX = Math.min(source.width - 1, Math.max(0, Math.floor(x)));
        const targetY = Math.min(source.height - 1, Math.max(0, Math.floor(y)));
        const targetOffset = (targetY * source.width + targetX) * 4;
        worksetReplaceTargetRef.current = {
          targetColor: [
            source.data[targetOffset],
            source.data[targetOffset + 1],
            source.data[targetOffset + 2],
          ],
          targetXRatio: source.width > 1 ? targetX / (source.width - 1) : 0,
          targetYRatio: source.height > 1 ? targetY / (source.height - 1) : 0,
        };
      } else {
        worksetReplaceTargetRef.current = null;
      }
      cancelPendingPreviewRender();
      cancelBackgroundPreviewActivity();
      pushHistory();
      updateContentDirty(true);
      softenSourceRef.current = null;
      liveFloodRef.current = { tool, x, y, source };
      setReplacePreviewActive(tool === 'replace');
      floodFill(x, y, tool === 'replace', source);
      return;
    }
    cancelPendingPreviewRender();
    cancelBackgroundPreviewActivity();
    worksetReplaceTargetRef.current = null;
    const strokeSource = pushHistory();
    updateContentDirty(true);
    liveFloodRef.current = null;
    setReplacePreviewActive(false);
    softenSourceRef.current = null;
    restoreStrokeSourceRef.current = null;
    restoreStrokeMaskRef.current = null;
    restoreStrokeLayerRef.current = null;
    if (tool === 'brush') {
      const canvas = canvasRef.current;
      const strokeCanvas = strokeCanvasRef.current;
      if (!canvas || !strokeCanvas) return;
      strokeCanvas.width = canvas.width;
      strokeCanvas.height = canvas.height;
    } else if (tool === 'eraser' && eraserMode === 'restore') {
      const canvas = canvasRef.current;
      if (!canvas || !strokeSource) return;
      const maskCanvas = document.createElement('canvas');
      const restoreLayer = document.createElement('canvas');
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      restoreLayer.width = canvas.width;
      restoreLayer.height = canvas.height;
      restoreStrokeSourceRef.current = strokeSource;
      restoreStrokeMaskRef.current = maskCanvas;
      restoreStrokeLayerRef.current = restoreLayer;
    }
    drawingRef.current = true;
    lastDrawPointRef.current = { x, y };
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
    drawAt(x, y);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    updateBrushPreview(event);
    if (!drawingRef.current) return;
    const { x, y } = getPoint(event);
    const previous = lastDrawPointRef.current;
    if (!previous) {
      drawAt(x, y);
    } else {
      drawSegment(previous, { x, y });
    }
    lastDrawPointRef.current = { x, y };
  };

  const stopDrawing = () => {
    if (drawingRef.current && tool === 'brush') {
      const canvas = canvasRef.current;
      const strokeCanvas = strokeCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && strokeCanvas && ctx) {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.drawImage(strokeCanvas, 0, 0);
        ctx.restore();
        strokeCanvas.getContext('2d')?.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
      }
    }
    drawingRef.current = false;
    lastDrawPointRef.current = null;
    restoreStrokeSourceRef.current = null;
    restoreStrokeMaskRef.current = null;
    restoreStrokeLayerRef.current = null;
  };

  const onStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editorInteractive || event.button !== 1) return;
    event.preventDefault();
    const stage = event.currentTarget;
    panningRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      panX: canvasPanRef.current.x,
      panY: canvasPanRef.current.y,
    };
    autoFitRef.current = false;
    setBrushPreview(null);
    setPanning(true);
    stage.setPointerCapture(event.pointerId);
  };

  const onStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panningRef.current;
    if (!pan.active) return;
    event.preventDefault();
    const nextPan = {
      x: pan.panX + event.clientX - pan.startX,
      y: pan.panY + event.clientY - pan.startY,
    };
    canvasPanRef.current = nextPan;
    setCanvasPan(nextPan);
  };

  const stopPanning = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panningRef.current.active) return;
    panningRef.current.active = false;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const applyUpscale = async () => {
    const canvas = canvasRef.current;
    if (!canvas || upscaleDisabledReason) return;
    cancelPendingPreviewRender();
    cancelBackgroundPreviewActivity();
    setUpscaleLoading(true);
    try {
      const response = await apiService.upscaleImage({
        image: canvas.toDataURL('image/png'),
        method: upscaleMethod,
        scale: upscaleScale,
      });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new window.Image();
        nextImage.crossOrigin = 'anonymous';
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error('放大结果加载失败'));
        nextImage.src = response.image_url;
      });
      const currentCanvas = canvasRef.current;
      if (!currentCanvas) return;
      pushHistory();
      currentCanvas.width = image.naturalWidth;
      currentCanvas.height = image.naturalHeight;
      const strokeCanvas = strokeCanvasRef.current;
      if (strokeCanvas) {
        strokeCanvas.width = image.naturalWidth;
        strokeCanvas.height = image.naturalHeight;
      }
      const ctx = currentCanvas.getContext('2d');
      if (!ctx) throw new Error('无法更新画布');
      ctx.clearRect(0, 0, currentCanvas.width, currentCanvas.height);
      ctx.drawImage(image, 0, 0);
      setCanvasSize({ width: image.naturalWidth, height: image.naturalHeight });
      updateContentDirty(true);
      restoreStrokeSourceRef.current = null;
      restoreStrokeMaskRef.current = null;
      restoreStrokeLayerRef.current = null;
      liveFloodRef.current = null;
      setReplacePreviewActive(false);
      softenSourceRef.current = null;
      autoFitRef.current = true;
      window.requestAnimationFrame(fitCanvasToStage);
      message.success(`已放大至 ${response.width}×${response.height}`);
    } catch (err: unknown) {
      message.error(getErrorMessage(err, '图片放大增强失败'));
    } finally {
      setUpscaleLoading(false);
    }
  };

  const undo = useCallback(() => {
    if (drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    cancelPendingPreviewRender();
    cancelBackgroundPreviewActivity();
    const previous = historyRef.current.pop();
    if (!previous) return;
    const current: CanvasHistoryEntry = {
      image: ctx.getImageData(0, 0, canvas.width, canvas.height),
      contentDirty: contentDirtyRef.current,
    };
    redoRef.current.push(current);
    restoreCanvasHistoryEntry(previous);
  }, [cancelBackgroundPreviewActivity, cancelPendingPreviewRender, restoreCanvasHistoryEntry]);

  const redo = useCallback(() => {
    if (drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    cancelPendingPreviewRender();
    cancelBackgroundPreviewActivity();
    const next = redoRef.current.pop();
    if (!canvas || !ctx || !next) return;
    historyRef.current.push({
      image: ctx.getImageData(0, 0, canvas.width, canvas.height),
      contentDirty: contentDirtyRef.current,
    });
    trimCanvasHistory(historyRef.current);
    restoreCanvasHistoryEntry(next);
  }, [cancelBackgroundPreviewActivity, cancelPendingPreviewRender, restoreCanvasHistoryEntry]);

  useEffect(() => {
    if (!open) return;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (editorBusy || event.altKey || (!event.ctrlKey && !event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      const shouldUndo = key === 'z' && !event.shiftKey;
      const shouldRedo = key === 'y' || (key === 'z' && event.shiftKey);
      if (!shouldUndo && !shouldRedo) return;
      event.preventDefault();
      if (shouldRedo) redo();
      else undo();
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [editorBusy, open, redo, undo]);

  const restoreBackgroundWorkset = () => {
    onRestoreBackgroundWorkset();
    if (frame.included && (!frame.backgroundRemovedUrl || frame.editedUrl)) requestImageLoad();
  };

  const getWorksetColorReplacementOptions = (): WorksetColorReplacementOptions | undefined => {
    const target = worksetReplaceTargetRef.current;
    if (!target) return undefined;
    return {
      ...target,
      replaceWithTransparency,
      replacementColor: color,
      opacity,
      replaceTolerance,
      colorReplaceTolerance,
      replaceMatchMode,
      replaceEdgeCleanup,
      replaceEdgeEnhancementMode,
    };
  };

  const applyToolToWorkset = async () => {
    let applied = false;
    if (tool === 'upscale') {
      applied = await onApplyUpscaleWorkset(upscaleMethod, upscaleScale, getWorksetColorReplacementOptions());
    } else if (tool === 'background') {
      applied = await onApplyBackgroundWorkset();
    } else if (tool === 'replace') {
      const options = getWorksetColorReplacementOptions();
      if (!options) return;
      applied = await onApplyColorReplacementWorkset(options);
    }
    if (applied) onClose();
  };

  const save = async (closeAfter = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cancelPendingPreviewRender();
    cancelBackgroundPreviewActivity();
    const floodPreview = liveFloodRef.current;
    if (floodPreview?.tool === tool) {
      floodFill(floodPreview.x, floodPreview.y, floodPreview.tool === 'replace', floodPreview.source);
    } else if (tool === 'soften' && softenSourceRef.current) {
      renderSoftenedEdges(softenSourceRef.current, softenRadius);
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setSaving(true);
    try {
      const image = canvas.toDataURL('image/png');
      const res = await apiService.saveEditedVideoFrame({ image, base_frame_url: baseUrl, preview_id: previewId ?? undefined });
      skipReloadUrlRef.current = res.image_url;
      onSaved(res.image_url, res.width, res.height);
      resetBackgroundPreview();
      liveFloodRef.current = null;
      setReplacePreviewActive(false);
      softenSourceRef.current = null;
      historyRef.current = [];
      redoRef.current = [];
      clearDirty();
      message.success('图片编辑已保存');
      if (closeAfter) onClose();
    } catch (err: unknown) {
      message.error(getErrorMessage(err, '保存图片编辑失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
      open={open}
      centered
      keyboard={false}
      closable={!editorBusy}
      maskClosable={!editorBusy}
      onCancel={() => { if (!editorBusy) requestClose(); }}
      title={(
        <div className="frame-canvas-editor-title">
          <span>图片编辑</span>
          <small>
            {[contextLabel ?? `帧 ${frameLabel}`, canvasSize.width && canvasSize.height ? `${canvasSize.width}×${canvasSize.height}` : null, frame.time == null ? null : formatTimestamp(frame.time)].filter(Boolean).join(' · ')}
          </small>
        </div>
      )}
      width={1180}
      className="frame-canvas-editor-modal"
      footer={(
        <div className="frame-canvas-footer">
          {showBatchActions ? (
            <div className="frame-canvas-footer-background-actions">
              <Tooltip title={batchApplyDisabledReason}>
                <span>
                  <Button loading={worksetLoading} disabled={Boolean(batchApplyDisabledReason)} onClick={() => void applyToolToWorkset()}>应用工作集 ({worksetFrameCount})</Button>
                </span>
              </Tooltip>
              <Button disabled={!editorInteractive || !worksetFrameCount} onClick={restoreBackgroundWorkset}>恢复工作集</Button>
            </div>
          ) : <div />}
          <div className="frame-canvas-footer-save-actions">
            <Button disabled={editorBusy} onClick={requestClose}>关闭</Button>
            <Button loading={saving} disabled={!imageReady || backgroundLoading || backgroundPreviewPending || backgroundPreviewLoading || upscaleLoading} onClick={() => save(false)}>保存</Button>
            <Button type="primary" loading={saving} disabled={!imageReady || backgroundLoading || backgroundPreviewPending || backgroundPreviewLoading || upscaleLoading} onClick={() => save(true)}>保存并关闭</Button>
          </div>
        </div>
      )}
    >
      <div className="frame-canvas-editor">
        <div className="frame-canvas-toolbar">
          <div className="frame-canvas-toolbar-row primary">
            <Segmented
              block
              className="frame-canvas-tool-switch"
              value={tool}
              onChange={value => setTool(value as CanvasTool)}
              options={[
                { label: '画笔', value: 'brush' },
                { label: '橡皮擦', value: 'eraser' },
                { label: '填充', value: 'fill' },
                { label: '换色', value: 'replace' },
                { label: '背景处理', value: 'background' },
                { label: '边缘柔化', value: 'soften' },
                { label: '放大增强', value: 'upscale' },
              ]}
            />
            <div className="frame-canvas-history-actions">
              <Button size="small" title="撤销 (Ctrl/Cmd+Z)" disabled={!editorInteractive} onClick={undo}>撤销</Button>
              <Button size="small" title="重做 (Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y)" disabled={!editorInteractive} onClick={redo}>重做</Button>
              <Button size="small" disabled={!editorInteractive} onClick={requestImageLoad}>还原</Button>
            </div>
          </div>
        </div>
        <div className="frame-canvas-editor-body with-side-panel">
          <div className="frame-canvas-workspace">
            <div
              ref={wrapRef}
              className={`frame-canvas-stage ${editorBusy || !imageReady ? 'processing' : ''} ${imageLoading ? 'loading' : ''} ${panning ? 'panning' : ''} ${tool === 'background' || tool === 'upscale' ? 'background-tool' : ''}`}
              aria-busy={editorBusy}
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={stopPanning}
              onPointerCancel={stopPanning}
              onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}
            >
              <div
                className="frame-canvas-layer"
                style={{
                  left: `calc(50% + ${canvasPan.x}px)`,
                  top: `calc(50% + ${canvasPan.y}px)`,
                  width: `${canvasSize.width * zoom}px`,
                  height: `${canvasSize.height * zoom}px`,
                }}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={onPointerDown}
                  onPointerEnter={updateBrushPreview}
                  onPointerMove={onPointerMove}
                  onPointerUp={stopDrawing}
                  onPointerLeave={() => { stopDrawing(); setBrushPreview(null); }}
                  onPointerCancel={stopDrawing}
                  onLostPointerCapture={stopDrawing}
                />
                <canvas
                  ref={strokeCanvasRef}
                  className="frame-canvas-stroke-layer"
                  style={{ opacity }}
                  aria-hidden="true"
                />
              </div>
              {brushPreview && (tool === 'brush' || tool === 'eraser') && (
                <div
                  className={`frame-canvas-brush-preview ${tool}`}
                  style={{
                    left: brushPreview.x,
                    top: brushPreview.y,
                    width: brushSize * zoom,
                    height: brushSize * zoom,
                    borderColor: tool === 'brush' ? color : undefined,
                    backgroundColor: tool === 'brush' ? color : undefined,
                    opacity: tool === 'brush' ? Math.max(0.2, opacity) : 1,
                  }}
                />
              )}
              {imageLoadError && (
                <div className="frame-canvas-load-error" role="alert">
                  <span>{imageLoadError}</span>
                  <Button size="small" onClick={requestImageLoad}>重新载入</Button>
                </div>
              )}
            </div>
            <div className="frame-canvas-view-reset">
              <Button size="small" icon={<ReloadOutlined />} disabled={!editorInteractive} onClick={fitCanvasToStage}>恢复默认视图</Button>
            </div>
            <div className="frame-canvas-statusbar">
              <span>滚轮缩放 · 中键拖动 · Ctrl/Cmd+Z 撤销 · Ctrl/Cmd+Shift+Z 重做</span>
            </div>
          </div>
          <aside className={`frame-canvas-background-panel ${saving || upscaleLoading ? 'locked' : ''}`} aria-label="工具参数" aria-busy={saving || backgroundPreviewPending || backgroundPreviewLoading || upscaleLoading}>
            {tool === 'brush' && (
              <div className="frame-canvas-replace-settings">
                <div className="frame-editor-section-title">画笔参数</div>
                <label className="frame-editor-field">
                  <span>颜色</span>
                  <Input type="color" value={color} onChange={event => { setColor(event.target.value); markParameterDirty(); }} />
                </label>
                <div className="frame-editor-slider">
                  <span>笔刷大小 {brushSize}</span>
                  <Slider min={1} max={200} value={brushSize} onChange={value => { setBrushSize(value); markParameterDirty(); }} />
                </div>
                <div className="frame-editor-slider">
                  <span>透明度 {Math.round(opacity * 100)}%</span>
                  <Slider min={0.05} max={1} step={0.05} value={opacity} onChange={value => { setOpacity(value); markParameterDirty(); }} />
                </div>
                <p className="frame-editor-help">参数变化会立即更新画布上的笔刷预览，新笔触使用当前参数。</p>
              </div>
            )}
            {tool === 'eraser' && (
              <div className="frame-canvas-replace-settings">
                <div className="frame-editor-section-title">橡皮擦参数</div>
                <label className="frame-editor-field">
                  <span>擦除方式</span>
                  <Select
                    value={eraserMode}
                    options={[
                      { label: '恢复初始图像', value: 'restore' },
                      { label: '擦除为透明', value: 'transparent' },
                    ]}
                    onChange={value => { setEraserMode(value); markParameterDirty(); }}
                  />
                </label>
                <div className="frame-editor-slider">
                  <span>笔刷大小 {brushSize}</span>
                  <Slider min={1} max={200} value={brushSize} onChange={value => { setBrushSize(value); markParameterDirty(); }} />
                </div>
                <p className="frame-editor-help">
                  {eraserMode === 'restore'
                    ? '擦除区域会恢复为本次打开编辑器时的图像。'
                    : '擦除区域会变为透明，适合直接移除当前图像内容。'}
                </p>
              </div>
            )}
            {tool === 'fill' && (
              <div className="frame-canvas-replace-settings">
                <div className="frame-editor-section-title">填充参数</div>
                <label className="frame-editor-field">
                  <span>颜色</span>
                  <Input type="color" value={color} onChange={event => { setColor(event.target.value); markParameterDirty(); }} />
                </label>
                <div className="frame-editor-slider">
                  <span>容差 {fillTolerance}</span>
                  <Slider min={0} max={255} value={fillTolerance} onChange={value => { setFillTolerance(value); markParameterDirty(); }} />
                </div>
                <div className="frame-editor-slider">
                  <span>透明度 {Math.round(opacity * 100)}%</span>
                  <Slider min={0.05} max={1} step={0.05} value={opacity} onChange={value => { setOpacity(value); markParameterDirty(); }} />
                </div>
                <p className="frame-editor-help">点击目标区域后，参数变化会实时重新计算填充结果。</p>
              </div>
            )}
            {tool === 'replace' && (
            <div className="frame-canvas-replace-settings">
              <div className="frame-editor-section-title">换色参数</div>
              <Checkbox checked={replaceWithTransparency} onChange={event => { setReplaceWithTransparency(event.target.checked); markParameterDirty(); }}>替换为透明</Checkbox>
              {!replaceWithTransparency && (
                <label className="frame-editor-field">
                  <span>目标颜色</span>
                  <Input type="color" value={color} onChange={event => { setColor(event.target.value); markParameterDirty(); }} />
                </label>
              )}
              {replaceWithTransparency && (
                <label className="frame-editor-field">
                  <span>匹配方案</span>
                  <Select
                    value={replaceMatchMode}
                    options={transparentReplaceMatchModeOptions}
                    onChange={value => { setReplaceMatchMode(value); markParameterDirty(); }}
                  />
                </label>
              )}
              {replaceWithTransparency ? (
                <div className="frame-editor-slider">
                  <span>颜色容差 {replaceTolerance}</span>
                  <Slider min={0} max={50} value={replaceTolerance} onChange={value => { setReplaceTolerance(value); markParameterDirty(); }} />
                </div>
              ) : (
                <div className="frame-editor-slider">
                  <span>颜色容差 {colorReplaceTolerance}</span>
                  <Slider min={0} max={255} value={colorReplaceTolerance} onChange={value => { setColorReplaceTolerance(value); markParameterDirty(); }} />
                </div>
              )}
              {replaceWithTransparency && (
                <>
                  <label className="frame-editor-field">
                    <span>增强方案</span>
                    <Select
                      value={replaceEdgeEnhancementMode}
                      options={transparentEdgeEnhancementModeOptions}
                      onChange={value => { setReplaceEdgeEnhancementMode(value); markParameterDirty(); }}
                    />
                  </label>
                  <div className="frame-editor-slider">
                    <span>
                      边缘清除增强 {replaceEdgeCleanup}{replaceEdgeEnhancementMode === 'dilate' ? 'px' : ''}
                    </span>
                    <Slider min={0} max={50} value={replaceEdgeCleanup} onChange={value => { setReplaceEdgeCleanup(value); markParameterDirty(); }} />
                  </div>
                </>
              )}
              {!replaceWithTransparency && (
                <div className="frame-editor-slider">
                  <span>目标透明度 {Math.round(opacity * 100)}%</span>
                  <Slider min={0.05} max={1} step={0.05} value={opacity} onChange={value => { setOpacity(value); markParameterDirty(); }} />
                </div>
              )}
              <p className="frame-editor-help">
                {!replacePreviewActive
                  ? '请先点击画布选择换色目标。使用其他工具修改画布后，需要重新点击目标区域；参数会用于下一次换色。'
                  : replaceWithTransparency
                    ? `正在实时预览。匹配：${transparentReplaceMatchModeHelp[replaceMatchMode]} 增强：${transparentEdgeEnhancementModeHelp[replaceEdgeEnhancementMode]}`
                    : '正在实时预览。只替换与画布边缘连通的相似颜色，主体内部不连通的同色区域会被保留。'}
              </p>
            </div>
            )}
            {tool === 'background' && (
              <>
                <BackgroundOptionsFields opts={backgroundOptions} title="背景处理" inline onChange={markParameterDirty} />
                <Button
                  block
                  type="primary"
                  className="frame-canvas-preview-action"
                  loading={backgroundPreviewLoading}
                  disabled={!imageReady || saving || backgroundLoading}
                  onClick={applyBackgroundPreview}
                >
                  {backgroundPreviewEnabled ? '重新应用预览' : '应用预览'}
                </Button>
                <p className="frame-editor-help">
                  {backgroundPreviewLoading
                    ? '正在处理当前帧预览…'
                    : backgroundPreviewPending
                      ? '参数已变化，等待自动刷新预览…'
                    : backgroundPreviewEnabled
                      ? '自动预览已启用，后续修改参数会自动重新处理当前帧。'
                      : '首次请点击“应用预览”；执行一次后，后续参数变化会自动预览。'}
                </p>
              </>
            )}
            {tool === 'soften' && (
              <div className="frame-canvas-replace-settings">
                <div className="frame-editor-section-title">边缘柔化参数</div>
                <div className="frame-editor-slider">
                  <span>柔化半径 {softenRadius}px</span>
                  <Slider
                    min={1}
                    max={12}
                    value={softenRadius}
                    onChange={value => {
                      setSoftenRadius(value);
                      markParameterDirty();
                      previewSoftenedEdges(value);
                    }}
                  />
                </div>
                <p className="frame-editor-help">调整柔化半径时会立即更新画布，可使用撤销恢复。</p>
              </div>
            )}
            {tool === 'upscale' && (
              <div className="frame-canvas-replace-settings frame-canvas-upscale-settings">
                <div className="frame-editor-section-title">
                  放大增强
                  {upscaleMethodsLoading && <Spin size="small" />}
                </div>
                <label className="frame-editor-field">
                  <span>处理方法</span>
                  <Select
                    value={upscaleMethod}
                    options={upscaleMethodOptions}
                    onChange={changeUpscaleMethod}
                  />
                </label>
                <label className="frame-editor-field">
                  <span>放大倍率</span>
                  <Segmented
                    block
                    value={upscaleScale}
                    options={[
                      { label: '2x', value: 2, disabled: !selectedUpscaleMethod?.supported_scales.includes(2) },
                      { label: '4x', value: 4, disabled: !selectedUpscaleMethod?.supported_scales.includes(4) },
                    ]}
                    onChange={value => {
                      upscaleScaleRef.current = value as 2 | 4;
                      setUpscaleScale(value as 2 | 4);
                    }}
                  />
                </label>
                <div className={`frame-canvas-upscale-size ${upscaleTarget.allowed ? '' : 'invalid'}`} role={upscaleTarget.allowed ? undefined : 'alert'}>
                  <span>当前 {canvasSize.width}×{canvasSize.height}</span>
                  <strong>{upscaleTarget.width}×{upscaleTarget.height}</strong>
                </div>
                <div className="frame-canvas-upscale-algorithm">
                  <div className="frame-canvas-upscale-algorithm-heading">
                    <strong>{selectedUpscaleMethod?.algorithm_name}</strong>
                    <span>{selectedUpscaleMethod?.behavior}</span>
                  </div>
                  <p>{selectedUpscaleMethod?.architecture}</p>
                  <p>{selectedUpscaleMethod?.description}</p>
                  {selectedUpscaleScale?.model && <small>当前模型：{selectedUpscaleScale.model}</small>}
                </div>
                {selectedUpscaleMethod?.license_notice && (
                  <p className="frame-editor-help frame-canvas-upscale-license">许可：{selectedUpscaleMethod.license_notice}</p>
                )}
                {upscaleMethods.filter(method => !method.available).map(method => (
                  <p className="frame-editor-help frame-canvas-upscale-unavailable" key={method.id}>
                    {method.label}：{method.unavailable_reason}
                  </p>
                ))}
                <Tooltip title={upscaleDisabledReason}>
                  <span>
                    <Button
                      block
                      type="primary"
                      className="frame-canvas-preview-action"
                      loading={upscaleLoading}
                      disabled={!imageReady || Boolean(upscaleDisabledReason)}
                      onClick={() => void applyUpscale()}
                    >
                      应用放大增强
                    </Button>
                  </span>
                </Tooltip>
                {!upscaleTarget.allowed && <p className="frame-editor-help frame-canvas-upscale-error">{upscaleTarget.reason}</p>}
                <p className="frame-editor-help">“应用放大增强”只处理当前画布，完成后需保存；底部“应用工作集”会批量保存并关闭窗口。</p>
              </div>
            )}
          </aside>
        </div>
      </div>
      </Modal>
      <Modal
        open={closeConfirmOpen}
        centered
        width={420}
        zIndex={1300}
        rootClassName="image-editor-close-confirm-root"
        className="image-editor-close-confirm"
        title={(
          <div className="image-editor-close-confirm-title">
            <ExclamationCircleOutlined aria-hidden="true" />
            <span>放弃未保存的更改？</span>
          </div>
        )}
        okText="放弃更改"
        cancelText="继续编辑"
        okButtonProps={{ danger: true }}
        maskClosable={false}
        onOk={confirmClose}
        onCancel={cancelClose}
        destroyOnHidden
      >
        <p className="image-editor-close-confirm-copy">当前图片的编辑内容尚未保存，关闭后将无法恢复。</p>
      </Modal>
    </>
  );
}

function hexToRgb(hex: string) {
  const value = hex.replace('#', '');
  const parsed = Number.parseInt(value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}
