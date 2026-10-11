import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { drawFrameCrop, moveFrameCrop, resizeFrameCrop, type CropHandle, type CropPoint, type FrameRect, type FrameSize } from '../utils/frameGeometry';

const handles: Array<{ id: CropHandle; label: string }> = [
  { id: 'nw', label: '左上角' }, { id: 'n', label: '上边' }, { id: 'ne', label: '右上角' },
  { id: 'e', label: '右边' }, { id: 'se', label: '右下角' }, { id: 's', label: '下边' },
  { id: 'sw', label: '左下角' }, { id: 'w', label: '左边' },
];
type DragMode = CropHandle | 'move' | 'draw';

export default function FrameCropOverlay({ size, rect, aspect, onChange }: {
  size: FrameSize; rect: FrameRect; aspect: number | null; onChange: (rect: FrameRect) => void;
}) {
  const drag = useRef<{ pointerId: number; start: CropPoint; rect: FrameRect; mode: DragMode } | null>(null);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * size.width / bounds.width, y: (event.clientY - bounds.top) * size.height / bounds.height };
  };
  const modeFor = (target: EventTarget) => (target as HTMLElement).closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle as DragMode | undefined;
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = point(event);
    const dx = next.x - active.start.x;
    const dy = next.y - active.start.y;
    onChange(active.mode === 'draw' ? drawFrameCrop(active.start, next, size, aspect)
      : active.mode === 'move' ? moveFrameCrop(active.rect, dx, dy, size)
      : resizeFrameCrop(active.rect, active.mode, dx, dy, size, aspect));
  };
  const stop = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (cancel) onChange(active.rect);
    else move(event);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mode = modeFor(event.target);
    if (!mode || !event.key.startsWith('Arrow')) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    onChange(mode === 'move' ? moveFrameCrop(rect, dx, dy, size) : resizeFrameCrop(rect, mode as CropHandle, dx, dy, size, aspect));
  };
  return (
    <div className="frame-crop-overlay" onKeyDown={keyDown}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = { pointerId: event.pointerId, start: point(event), rect, mode: modeFor(event.target) ?? 'draw' };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move} onPointerUp={event => stop(event)} onPointerCancel={event => stop(event, true)}
      onLostPointerCapture={() => { drag.current = null; }}
    >
      <div className="frame-crop-selection" data-crop-handle="move" role="button" tabIndex={0} aria-label="移动裁剪框"
        style={{ left: `${rect.x / size.width * 100}%`, top: `${rect.y / size.height * 100}%`, width: `${rect.width / size.width * 100}%`, height: `${rect.height / size.height * 100}%` }}>
        <div className="frame-crop-grid" aria-hidden="true" />
        {handles.map(handle => <button key={handle.id} type="button" className={`frame-crop-handle ${handle.id}`} data-crop-handle={handle.id} aria-label={`调整裁剪${handle.label}`} />)}
      </div>
    </div>
  );
}
