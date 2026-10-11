import type { ImageUpscaleMethodId, VideoBackgroundOptions } from '../api/services.ts';
import { frameCropBounds, type FrameGeometryOperation } from './frameGeometry.ts';
import {
  applyConnectedColorReplacement,
  applyHardTransparentReplacement,
  type TransparentEdgeEnhancementMode,
  type TransparentReplaceMatchMode,
} from './frameColorReplacement.ts';

export interface FramePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface FrameEditPoint { x: number; y: number }

export type FrameStrokeOperation = {
  points: readonly FrameEditPoint[];
  sizeRatio: number;
  color: string;
  opacity: number;
  eraserMode: 'restore' | 'transparent';
} & ({ type: 'brush' } | { type: 'eraser' });

export interface FrameFillOperation {
  type: 'fill';
  xRatio: number;
  yRatio: number;
  color: string;
  opacity: number;
  tolerance: number;
}

export interface FrameReplaceOperation {
  type: 'replace';
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

export type FramePixelOperation = FrameFillOperation | FrameReplaceOperation | { type: 'soften'; radius: number };
export type FrameEditOperation = FrameStrokeOperation | FramePixelOperation | FrameGeometryOperation
  | { type: 'background'; options: VideoBackgroundOptions }
  | { type: 'upscale'; method: ImageUpscaleMethodId; scale: 2 | 4 };

/** Recipes outlive the bounded bitmap undo history, but never the editor session. */
export class FrameEditRecipe {
  operations: readonly FrameEditOperation[] = [];
  private saved: readonly FrameEditOperation[] = [];

  append(operation: FrameEditOperation) {
    this.operations = [...this.operations, operation];
  }

  replace(index: number, operation: FrameEditOperation) {
    if (index < 0 || index >= this.operations.length) return;
    this.operations = this.operations.map((previous, i) => i === index ? operation : previous);
  }

  restore(operations: readonly FrameEditOperation[]) { this.operations = operations; }
  markSaved() { this.saved = this.operations; }
  restoreSaved() { this.operations = this.saved; }
}

export function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function replacementPoint(source: FramePixels, operation: FrameReplaceOperation) {
  const { data, width, height } = source;
  const expectedX = Math.round(operation.targetXRatio * (width - 1));
  const expectedY = Math.round(operation.targetYRatio * (height - 1));
  const tolerance = operation.replaceWithTransparency ? operation.replaceTolerance * 255 / 50 : operation.colorReplaceTolerance;
  let closest: { x: number; y: number; distance: number } | null = null;
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    if (data[offset + 3] === 0) continue;
    const dr = Math.abs(data[offset] - operation.targetColor[0]);
    const dg = Math.abs(data[offset + 1] - operation.targetColor[1]);
    const db = Math.abs(data[offset + 2] - operation.targetColor[2]);
    if ((operation.replaceWithTransparency ? Math.hypot(dr, dg, db) : Math.max(dr, dg, db)) > tolerance) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    const distance = (x - expectedX) ** 2 + (y - expectedY) ** 2;
    if (!closest || distance < closest.distance) closest = { x, y, distance };
    if (distance === 0) break;
  }
  return closest;
}

/** Shared by live previews and replay; the input snapshot is never modified. */
export function applyFramePixelOperation(source: FramePixels, operation: FramePixelOperation): Uint8ClampedArray | null {
  const { width, height } = source;
  if (operation.type === 'replace') {
    const point = replacementPoint(source, operation);
    if (!point) return null;
    if (operation.replaceWithTransparency) {
      return applyHardTransparentReplacement(source.data, width, height, point.x, point.y,
        operation.replaceTolerance, operation.replaceEdgeCleanup, operation.replaceMatchMode,
        operation.replaceEdgeEnhancementMode, operation.targetColor);
    }
    const rgb = hexToRgb(operation.replacementColor);
    return applyConnectedColorReplacement(source.data, width, height, point.x, point.y,
      operation.targetColor, [rgb.r, rgb.g, rgb.b], operation.colorReplaceTolerance, operation.opacity);
  }

  const data = new Uint8ClampedArray(source.data);
  if (operation.type === 'soften') {
    const radius = Math.max(1, Math.min(12, Math.round(operation.radius)));
    const horizontal = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) {
        sum += source.data[(y * width + Math.max(0, Math.min(width - 1, x))) * 4 + 3];
      }
      for (let x = 0; x < width; x += 1) {
        horizontal[y * width + x] = sum / (radius * 2 + 1);
        sum += source.data[(y * width + Math.min(width - 1, x + radius + 1)) * 4 + 3]
          - source.data[(y * width + Math.max(0, x - radius)) * 4 + 3];
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x];
      for (let y = 0; y < height; y += 1) {
        data[(y * width + x) * 4 + 3] = Math.round(sum / (radius * 2 + 1));
        sum += horizontal[Math.min(height - 1, y + radius + 1) * width + x]
          - horizontal[Math.max(0, y - radius) * width + x];
      }
    }
    return data;
  }

  const x = Math.min(width - 1, Math.max(0, Math.round(operation.xRatio * (width - 1))));
  const y = Math.min(height - 1, Math.max(0, Math.round(operation.yRatio * (height - 1))));
  const start = y * width + x;
  const target = data.slice(start * 4, start * 4 + 4);
  const rgb = hexToRgb(operation.color);
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let stackSize = 1;
  stack[0] = start;
  seen[start] = 1;
  while (stackSize) {
    const index = stack[--stackSize];
    const p = index * 4;
    if (Math.max(
      Math.abs(data[p] - target[0]), Math.abs(data[p + 1] - target[1]),
      Math.abs(data[p + 2] - target[2]), Math.abs(data[p + 3] - target[3]),
    ) > operation.tolerance) continue;
    const sourceAlpha = operation.opacity;
    const destinationAlpha = data[p + 3] / 255;
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    if (outputAlpha > 0) {
      data[p] = Math.round((rgb.r * sourceAlpha + data[p] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
      data[p + 1] = Math.round((rgb.g * sourceAlpha + data[p + 1] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
      data[p + 2] = Math.round((rgb.b * sourceAlpha + data[p + 2] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
    }
    data[p + 3] = Math.round(outputAlpha * 255);
    const cx = index % width;
    const neighbors = [cx < width - 1 ? index + 1 : -1, cx > 0 ? index - 1 : -1,
      index < width * height - width ? index + width : -1, index >= width ? index - width : -1];
    for (const next of neighbors) {
      if (next >= 0 && !seen[next]) { seen[next] = 1; stack[stackSize++] = next; }
    }
  }
  return data;
}

export function paintFrameStrokeSegment(
  ctx: CanvasRenderingContext2D, from: FrameEditPoint | null, to: FrameEditPoint, size: number, color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (from) {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  } else {
    ctx.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function restoreFrameStroke(
  canvas: HTMLCanvasElement, initial: HTMLCanvasElement, source: ImageData,
  mask: HTMLCanvasElement, layer: HTMLCanvasElement,
) {
  const ctx = canvas.getContext('2d')!;
  const layerCtx = layer.getContext('2d')!;
  ctx.putImageData(source, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
  layerCtx.clearRect(0, 0, layer.width, layer.height);
  layerCtx.save();
  layerCtx.drawImage(initial, 0, 0, layer.width, layer.height);
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.drawImage(mask, 0, 0);
  layerCtx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Copy whole RGBA pixels without interpolation, including transparent pixels. */
export function transformFramePixels(source: FramePixels, operation: FrameGeometryOperation): FramePixels {
  const rect = operation.type === 'crop' ? frameCropBounds(source, operation)
    : { x: 0, y: 0, width: source.width, height: source.height };
  const data = new Uint8ClampedArray(rect.width * rect.height * 4);
  if (operation.type === 'crop') {
    for (let y = 0; y < rect.height; y += 1) {
      const start = ((rect.y + y) * source.width + rect.x) * 4;
      data.set(source.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
    }
  } else {
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const from = (y * source.width + source.width - 1 - x) * 4;
        const to = (y * rect.width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) data[to + channel] = source.data[from + channel];
      }
    }
  }
  return { width: rect.width, height: rect.height, data };
}

export function transformFrameCanvas(canvas: HTMLCanvasElement, operation: FrameGeometryOperation) {
  const ctx = canvas.getContext('2d')!;
  const result = transformFramePixels(ctx.getImageData(0, 0, canvas.width, canvas.height), operation);
  canvas.width = result.width;
  canvas.height = result.height;
  const image = ctx.createImageData(result.width, result.height);
  image.data.set(result.data);
  ctx.putImageData(image, 0, 0);
}

/** Restore erasers follow the geometry of the opened image, never its paint edits. */
export function createFrameRestoreCanvas(initial: HTMLCanvasElement, operations: readonly FrameEditOperation[]) {
  const canvas = createCanvas(initial.width, initial.height);
  canvas.getContext('2d')!.drawImage(initial, 0, 0);
  for (const operation of operations) {
    if (operation.type === 'crop' || operation.type === 'flip-horizontal') {
      transformFrameCanvas(canvas, operation);
    } else if (operation.type === 'upscale') {
      const scaled = createCanvas(canvas.width * operation.scale, canvas.height * operation.scale);
      scaled.getContext('2d')!.drawImage(canvas, 0, 0, scaled.width, scaled.height);
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      canvas.getContext('2d')!.drawImage(scaled, 0, 0);
    }
  }
  return canvas;
}

export async function loadFrameEditImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = url;
  });
}

export function applyFrameStroke(canvas: HTMLCanvasElement, initial: HTMLCanvasElement, operation: FrameStrokeOperation) {
  const ctx = canvas.getContext('2d')!;
  const layer = createCanvas(canvas.width, canvas.height);
  const layerCtx = layer.getContext('2d')!;
  const transparent = operation.type === 'eraser' && operation.eraserMode === 'transparent';
  const target = transparent ? ctx : layerCtx;
  const size = operation.sizeRatio * Math.min(canvas.width, canvas.height);
  target.save();
  if (transparent) target.globalCompositeOperation = 'destination-out';
  let previous: FrameEditPoint | null = null;
  for (const point of operation.points) {
    const next = { x: point.x * canvas.width, y: point.y * canvas.height };
    paintFrameStrokeSegment(target, previous, next, size, operation.type === 'brush' ? operation.color : '#ffffff');
    previous = next;
  }
  target.restore();
  if (transparent) return;
  if (operation.type === 'eraser') {
    restoreFrameStroke(canvas, initial, ctx.getImageData(0, 0, canvas.width, canvas.height), layer, createCanvas(canvas.width, canvas.height));
  } else {
    ctx.save();
    ctx.globalAlpha = operation.opacity;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }
}

export interface RenderedFrameEdit { image: string; width: number; height: number }
export interface WorksetFrameEdits {
  operations: readonly FrameEditOperation[];
  current: RenderedFrameEdit & { id: string };
}

export interface FrameEditServices {
  removeBackground: (request: { image: string } & VideoBackgroundOptions) => Promise<{ image_url: string }>;
  upscaleImage: (request: { image: string; method: ImageUpscaleMethodId; scale: 2 | 4 }) => Promise<{ image_url: string }>;
}

export async function renderFrameEdits(
  url: string, operations: readonly FrameEditOperation[], services: FrameEditServices,
  isCurrent: () => boolean, onProgress: (step: number) => void,
): Promise<RenderedFrameEdit | null> {
  const image = await loadFrameEditImage(url);
  if (!isCurrent()) return null;
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
  const initial = createCanvas(canvas.width, canvas.height);
  initial.getContext('2d')!.drawImage(image, 0, 0);
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  for (let i = 0; i < operations.length; i += 1) {
    if (!isCurrent()) return null;
    onProgress(i + 1);
    const operation = operations[i];
    if (operation.type === 'background' || operation.type === 'upscale') {
      const png = canvas.toDataURL('image/png');
      const result = operation.type === 'background'
        ? await services.removeBackground({ image: png, ...operation.options })
        : await services.upscaleImage({ image: png, method: operation.method, scale: operation.scale });
      if (!isCurrent()) return null;
      const nextImage = await loadFrameEditImage(result.image_url);
      if (!isCurrent()) return null;
      canvas.width = nextImage.naturalWidth;
      canvas.height = nextImage.naturalHeight;
      canvas.getContext('2d')!.drawImage(nextImage, 0, 0);
    } else if (operation.type === 'crop' || operation.type === 'flip-horizontal') {
      transformFrameCanvas(canvas, operation);
    } else if (operation.type === 'brush' || operation.type === 'eraser') {
      const restoreSource = operation.type === 'eraser' && operation.eraserMode === 'restore'
        ? createFrameRestoreCanvas(initial, operations.slice(0, i)) : initial;
      applyFrameStroke(canvas, restoreSource, operation);
    } else {
      const ctx = canvas.getContext('2d')!;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = applyFramePixelOperation(pixels, operation);
      if (data) { pixels.data.set(data); ctx.putImageData(pixels, 0, 0); }
    }
    // Let progress paint between CPU-bound operations without retaining every frame bitmap.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return isCurrent() ? { image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height } : null;
}

/** Accumulate results only; the caller commits them to the document once all frames succeed. */
export async function runFrameEditBatch<T extends { id: string }, Result>(
  targets: readonly T[], edits: WorksetFrameEdits,
  callbacks: {
    isCurrent: () => boolean;
    render: (target: T, operations: readonly FrameEditOperation[], index: number) => Promise<RenderedFrameEdit | null>;
    save: (target: T, rendered: RenderedFrameEdit) => Promise<Result>;
  },
): Promise<Map<string, Result> | null> {
  const results = new Map<string, Result>();
  for (let i = 0; i < targets.length; i += 1) {
    if (!callbacks.isCurrent()) return null;
    const target = targets[i];
    const rendered = target.id === edits.current.id ? edits.current : await callbacks.render(target, edits.operations, i);
    if (!rendered || !callbacks.isCurrent()) return null;
    const result = await callbacks.save(target, rendered);
    if (!callbacks.isCurrent()) return null;
    results.set(target.id, result);
  }
  return results;
}
