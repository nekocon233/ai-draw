export interface FrameSize { width: number; height: number }
export interface FrameRect extends FrameSize { x: number; y: number }
export interface CropPoint { x: number; y: number }
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export interface FrameCropOperation {
  type: 'crop';
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}
export type FrameGeometryOperation = { type: 'flip-horizontal' } | FrameCropOperation;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Round both edges, so a relative recipe selects the same pixels as its preview. */
export function frameCropBounds(size: FrameSize, crop: FrameCropOperation): FrameRect {
  const x = clamp(Math.round(crop.xRatio * size.width), 0, size.width - 1);
  const y = clamp(Math.round(crop.yRatio * size.height), 0, size.height - 1);
  const right = clamp(Math.round((crop.xRatio + crop.widthRatio) * size.width), x + 1, size.width);
  const bottom = clamp(Math.round((crop.yRatio + crop.heightRatio) * size.height), y + 1, size.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function frameCropOperation(rect: FrameRect, size: FrameSize): FrameCropOperation {
  return {
    type: 'crop', xRatio: rect.x / size.width, yRatio: rect.y / size.height,
    widthRatio: rect.width / size.width, heightRatio: rect.height / size.height,
  };
}

export function centeredFrameCrop(size: FrameSize, aspect: number | null): FrameRect {
  const width = aspect ? Math.min(size.width, size.height * aspect) : size.width;
  const height = aspect ? width / aspect : size.height;
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
}

export function moveFrameCrop(rect: FrameRect, dx: number, dy: number, size: FrameSize): FrameRect {
  return { ...rect, x: clamp(rect.x + dx, 0, size.width - rect.width), y: clamp(rect.y + dy, 0, size.height - rect.height) };
}

function anchoredCrop(anchor: CropPoint, point: CropPoint, size: FrameSize, aspect: number | null, sx: number, sy: number): FrameRect {
  const maxWidth = sx > 0 ? size.width - anchor.x : anchor.x;
  const maxHeight = sy > 0 ? size.height - anchor.y : anchor.y;
  let width = clamp((point.x - anchor.x) * sx, Math.min(1, maxWidth), maxWidth);
  let height = clamp((point.y - anchor.y) * sy, Math.min(1, maxHeight), maxHeight);
  if (aspect) {
    const limit = Math.min(maxWidth, maxHeight * aspect);
    width = clamp(Math.max(width, height * aspect), Math.min(Math.max(1, aspect), limit), limit);
    height = width / aspect;
  }
  return { x: sx > 0 ? anchor.x : anchor.x - width, y: sy > 0 ? anchor.y : anchor.y - height, width, height };
}

export function drawFrameCrop(start: CropPoint, end: CropPoint, size: FrameSize, aspect: number | null): FrameRect {
  const anchor = { x: clamp(start.x, 0, size.width), y: clamp(start.y, 0, size.height) };
  return anchoredCrop(anchor, end, size, aspect, end.x >= anchor.x ? 1 : -1, end.y >= anchor.y ? 1 : -1);
}

export function resizeFrameCrop(rect: FrameRect, handle: CropHandle, dx: number, dy: number, size: FrameSize, aspect: number | null): FrameRect {
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if ((west || east) && (north || south)) {
    if (aspect) {
      const direction = (west ? -1 : 1) * (north ? -1 : 1);
      if (Math.abs(dx) >= Math.abs(dy * aspect)) dy = dx / aspect * direction;
      else dx = dy * aspect * direction;
    }
    return anchoredCrop(
      { x: west ? rect.x + rect.width : rect.x, y: north ? rect.y + rect.height : rect.y },
      { x: (west ? rect.x : rect.x + rect.width) + dx, y: (north ? rect.y : rect.y + rect.height) + dy },
      size, aspect, west ? -1 : 1, north ? -1 : 1,
    );
  }
  if (west || east) {
    const anchor = west ? rect.x + rect.width : rect.x;
    const center = rect.y + rect.height / 2;
    const limit = Math.min(west ? anchor : size.width - anchor, aspect ? 2 * Math.min(center, size.height - center) * aspect : Infinity);
    const width = clamp(rect.width + (west ? -dx : dx), Math.min(aspect ? Math.max(1, aspect) : 1, limit), limit);
    const height = aspect ? width / aspect : rect.height;
    return { x: west ? anchor - width : anchor, y: center - height / 2, width, height };
  }
  const anchor = north ? rect.y + rect.height : rect.y;
  const center = rect.x + rect.width / 2;
  const limit = Math.min(north ? anchor : size.height - anchor, aspect ? 2 * Math.min(center, size.width - center) / aspect : Infinity);
  const height = clamp(rect.height + (north ? -dy : dy), Math.min(aspect ? Math.max(1, 1 / aspect) : 1, limit), limit);
  const width = aspect ? height * aspect : rect.width;
  return { x: center - width / 2, y: north ? anchor - height : anchor, width, height };
}
