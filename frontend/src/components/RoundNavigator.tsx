import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';
import { CaretRightFilled, DownOutlined, LoadingOutlined, UpOutlined } from '@ant-design/icons';
import { formatTimestamp } from '../utils/helpers';
import type { NavigatorRound } from '../utils/roundNavigator';
import './RoundNavigator.css';

const BAND_WIDTH = 14;
const RAIL_INSET = 12;
// 导轨在结果区里垂直居中：每轮占 8px，最长不超过结果区的 40% 与 320px，轮次多时压缩间距
const TICK_SPACING = 8;
const MAX_RAIL_RATIO = 0.4;
const MAX_RAIL_HEIGHT = 320;
// 上下多留一点命中范围，方便点到第一轮和最后一轮
const HIT_SLOP_Y = 8;
const PREVIEW_GAP = 8;
const TAP_SLOP = 8;
const MEDIA_DWELL_MS = 150;
const MEDIA_TILES = 4; // 含「+N」格
const PAGE_STEP = 5;
// 只露出一小截（例如跳转落点上方前一轮的结尾）不算在视口里
const VISIBLE_MIN_OVERLAP = 64;

// 结果区里可以放导轨和预览卡片的范围（视口坐标）
interface AreaGeometry {
  left: number; // 导轨左缘
  top: number;
  bottom: number;
  previewRight: number; // 预览卡片右缘到视口右缘的距离
  scrollable: boolean;
}

interface RailBox {
  left: number;
  top: number;
  height: number;
}

interface VisibleRange {
  from: string;
  to: string;
}

interface RoundNavigatorProps {
  rounds: NavigatorRound[];
  getContainer: () => HTMLElement | null;
  onJump: (roundId: string) => Promise<void>;
  workflowLabels: Record<string, string>;
}

function measureArea(container: HTMLElement): AreaGeometry {
  const rect = container.getBoundingClientRect();
  const scrollbar = container.offsetWidth - container.clientWidth;
  // overlay 滚动条宽度为 0 但仍可拖动，精确指针下给它让出位置
  const reserve = scrollbar > 0 ? 2 : window.matchMedia('(pointer: fine)').matches ? 8 : 0;
  const left = rect.right - scrollbar - reserve - BAND_WIDTH;
  return {
    left,
    top: rect.top + RAIL_INSET,
    bottom: rect.bottom - RAIL_INSET,
    previewRight: document.documentElement.clientWidth - left + PREVIEW_GAP,
    scrollable: container.scrollHeight > container.clientHeight + 1,
  };
}

function railBox(area: AreaGeometry, count: number): RailBox {
  const available = Math.max(0, area.bottom - area.top);
  const height = Math.min(count * TICK_SPACING, available * MAX_RAIL_RATIO, MAX_RAIL_HEIGHT);
  return { left: area.left, top: area.top + (available - height) / 2, height };
}

// 与视口相交的已加载轮次（一轮从它的用户消息延伸到下一轮的用户消息）
function measureVisible(container: HTMLElement): VisibleRange | null {
  const view = container.getBoundingClientRect();
  const users = container.querySelectorAll<HTMLElement>('.chat-message-user[data-message-id]');
  let from: string | undefined;
  let to: string | undefined;
  let top = users.length > 0 ? users[0].getBoundingClientRect().top : 0;
  for (let index = 0; index < users.length && top < view.bottom; index += 1) {
    const next = users[index + 1];
    const nextTop = next ? next.getBoundingClientRect().top : Infinity;
    const overlap = Math.min(nextTop, view.bottom) - Math.max(top, view.top);
    if (overlap >= Math.min(VISIBLE_MIN_OVERLAP, nextTop - top)) {
      from ??= users[index].dataset.messageId;
      to = users[index].dataset.messageId;
    }
    top = nextTop;
  }
  return from && to ? { from, to } : null;
}

// 按坐标换算轮次：整条导轨都是命中区，不需要逐条横条的元素
function railIndexAt(rail: RailBox, count: number, x: number, y: number): number | null {
  if (x < rail.left || x > rail.left + BAND_WIDTH) return null;
  if (y < rail.top - HIT_SLOP_Y || y > rail.top + rail.height + HIT_SLOP_Y) return null;
  return Math.min(count - 1, Math.max(0, Math.floor(((y - rail.top) / rail.height) * count)));
}

const sameArea = (a: AreaGeometry | null, b: AreaGeometry) => a !== null
  && a.left === b.left && a.top === b.top && a.bottom === b.bottom
  && a.previewRight === b.previewRight && a.scrollable === b.scrollable;

const sameRange = (a: VisibleRange | null, b: VisibleRange | null) =>
  a === b || Boolean(a && b && a.from === b.from && a.to === b.to);

function describe(round: NavigatorRound, workflowLabels: Record<string, string>) {
  return round.text.trim() || round.presetTitle || (round.workflow && workflowLabels[round.workflow]) || '没有文字描述';
}

interface RoundPreviewProps {
  ref: Ref<HTMLDivElement>;
  round: NavigatorRound;
  index: number;
  count: number;
  right: number;
  pinned: boolean;
  showMedia: boolean;
  locating: boolean;
  workflowLabel?: string;
  onJump: () => void;
  onStep: (delta: number) => void;
}

function RoundPreview({ ref, round, index, count, right, pinned, showMedia, locating, workflowLabel, onJump, onStep }: RoundPreviewProps) {
  const description = round.text.trim();
  const tiles = round.media.slice(0, round.mediaCount > MEDIA_TILES ? MEDIA_TILES - 1 : MEDIA_TILES);
  const hiddenMedia = round.mediaCount - tiles.length;
  const content = (
    <>
      <span className="round-nav-preview-head">
        <span className="round-nav-preview-index">第 {index + 1} / {count} 轮</span>
        {locating ? (
          <span className="round-nav-preview-status"><LoadingOutlined /> 正在定位</span>
        ) : (
          <span>{formatTimestamp(round.timestamp)}{pinned && ' · 点按跳转'}</span>
        )}
      </span>
      {(round.presetTitle || workflowLabel || round.generating) && (
        <span className="round-nav-preview-tags">
          {round.generating && <span className="round-nav-preview-tag is-generating">生成中</span>}
          {round.presetTitle && <span className="round-nav-preview-tag">{round.presetTitle}</span>}
          {workflowLabel && <span className="round-nav-preview-tag is-muted">{workflowLabel}</span>}
        </span>
      )}
      <span className={`round-nav-preview-text ${description ? '' : 'is-empty'}`}>
        {description || '没有文字描述'}
      </span>
      {tiles.length > 0 ? (
        <span className="round-nav-preview-media">
          {tiles.map((item, mediaIndex) => (
            <span key={`${mediaIndex}:${item.url}`} className={`round-nav-thumb ${item.video ? 'is-video' : ''}`}>
              {showMedia && (item.video ? (
                <video
                  src={item.url.startsWith('data:') ? item.url : `${item.url}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  tabIndex={-1}
                />
              ) : (
                <img src={item.url} alt="" decoding="async" draggable={false} />
              ))}
              {item.video && <CaretRightFilled className="round-nav-thumb-play" />}
            </span>
          ))}
          {hiddenMedia > 0 && <span className="round-nav-thumb is-more">+{hiddenMedia}</span>}
        </span>
      ) : (
        <span className="round-nav-preview-empty">{round.generating ? '结果生成后显示在这里' : '本轮没有返回媒体'}</span>
      )}
    </>
  );

  return (
    <div
      ref={ref}
      className={`round-nav-preview ${pinned ? 'is-pinned' : ''}`}
      style={{ right }}
      aria-hidden={!pinned}
    >
      {pinned ? (
        <button type="button" className="round-nav-preview-body" onClick={onJump} aria-label={`跳到第 ${index + 1} 轮`}>
          {content}
        </button>
      ) : (
        <span className="round-nav-preview-body">{content}</span>
      )}
      {pinned && (
        <span className="round-nav-preview-actions">
          <button type="button" onClick={() => onStep(-1)} disabled={index === 0}>
            <UpOutlined /> 上一轮
          </button>
          <button type="button" onClick={() => onStep(1)} disabled={index === count - 1}>
            <DownOutlined /> 下一轮
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * 结果区滚动条旁的对话轮次导航：每轮一条横条，悬停预览，点击跳转。
 * 横条只负责显示，不接收指针事件；交互挂在滚动容器上按坐标命中，滚轮和触摸滚动照常交给结果区。
 */
function RoundNavigator({ rounds, getContainer, onJump, workflowLabels }: RoundNavigatorProps) {
  const [area, setArea] = useState<AreaGeometry | null>(null);
  const [visible, setVisible] = useState<VisibleRange | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [keyboardId, setKeyboardId] = useState<string | null>(null);
  const [dwellId, setDwellId] = useState<string | null>(null);
  const [locatingId, setLocatingId] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ pointerId: number; pointerType: string; x: number; y: number } | null>(null);

  const count = rounds.length;
  const rail = useMemo(() => (area ? railBox(area, count) : null), [area, count]);
  const shown = Boolean(area && rail && rail.height > 0 && count > 1 && (area.scrollable || !rounds[0].loaded));
  const pinnedIndex = pinnedId === null ? -1 : rounds.findIndex(round => round.id === pinnedId);
  const keyboardIndex = keyboardId === null ? -1 : rounds.findIndex(round => round.id === keyboardId);
  const previewIndex = !shown ? null
    : pinnedIndex >= 0 ? pinnedIndex
      : hoverIndex !== null && hoverIndex < count ? hoverIndex
        : keyboardIndex >= 0 ? keyboardIndex : null;
  const previewRound = previewIndex === null ? null : rounds[previewIndex];
  const previewId = previewRound?.id ?? null;

  useEffect(() => {
    const container = getContainer();
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = measureArea(container);
      setArea(previous => (sameArea(previous, next) ? previous : next));
      const range = measureVisible(container);
      setVisible(previous => (sameRange(previous, range) ? previous : range));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    const content = container.querySelector('.chat-messages');
    if (content) observer.observe(content);
    container.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [getContainer]);

  const jumpTo = useCallback((index: number) => {
    const round = rounds[index];
    if (!round) return;
    setPinnedId(null);
    setLocatingId(round.id);
    void onJump(round.id).finally(() => setLocatingId(current => (current === round.id ? null : current)));
  }, [onJump, rounds]);

  // 导轨隐藏时不响应指针
  const activeRail = shown ? rail : null;

  // 交互挂在滚动容器上按坐标命中；依赖变化时重新挂载监听，开销很小
  useEffect(() => {
    const container = getContainer();
    if (!container) return;
    const setCursor = (pointer: boolean) => {
      const cursor = pointer ? 'pointer' : '';
      if (container.style.cursor !== cursor) container.style.cursor = cursor;
    };
    if (!activeRail) {
      setCursor(false);
      return;
    }
    const indexAt = (event: PointerEvent) => railIndexAt(activeRail, count, event.clientX, event.clientY);
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const index = event.buttons === 0 ? indexAt(event) : null;
      setHoverIndex(index);
      setCursor(index !== null);
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      setHoverIndex(null);
      setCursor(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const index = indexAt(event);
      if (index === null || (event.pointerType === 'mouse' && event.button !== 0)) {
        pressRef.current = null;
        return;
      }
      pressRef.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY };
      // 点横条不抢输入框焦点，也不开始选中文字
      if (event.pointerType === 'mouse') event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (!press || press.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP) return;
      const index = indexAt(event);
      if (index === null) return;
      if (press.pointerType === 'mouse' || rounds[index].id === pinnedId) {
        jumpTo(index);
      } else {
        // 触屏没有悬停：第一次点先固定预览，再点同一轮或点卡片才跳转
        setPinnedId(rounds[index].id);
      }
    };
    // 浏览器接管为滚动手势时会发 pointercancel，这次按下不算点击
    const onPointerCancel = () => {
      pressRef.current = null;
    };
    // 轻点导轨后不再合成 click，免得触屏的点击校正把它交给旁边的图片或按钮
    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (event.cancelable && touch && railIndexAt(activeRail, count, touch.clientX, touch.clientY) !== null) event.preventDefault();
    };
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerleave', onPointerLeave);
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerCancel);
    container.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [activeRail, count, getContainer, jumpTo, pinnedId, rounds]);

  useEffect(() => {
    const container = getContainer();
    return () => {
      if (container) container.style.cursor = '';
    };
  }, [getContainer]);

  // 固定的预览（触屏）在点别处、滑动页面或按 Esc 时收起
  useEffect(() => {
    if (pinnedId === null) return;
    const container = getContainer();
    const dismiss = () => setPinnedId(null);
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      if (activeRail && railIndexAt(activeRail, count, event.clientX, event.clientY) !== null) return;
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    container?.addEventListener('wheel', dismiss, { passive: true });
    container?.addEventListener('touchmove', dismiss, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      container?.removeEventListener('wheel', dismiss);
      container?.removeEventListener('touchmove', dismiss);
    };
  }, [activeRail, count, getContainer, pinnedId]);

  // 快速扫过时只更新文字，停留片刻才加载缩略图
  useEffect(() => {
    if (!previewId) return;
    const timer = window.setTimeout(() => setDwellId(previewId), MEDIA_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [previewId]);

  // 卡片垂直对准当前横条，并夹在结果区范围内（导轨可能比卡片还短）
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !area || !rail || previewIndex === null) return;
    const center = rail.top + ((previewIndex + 0.5) / count) * rail.height;
    const top = Math.max(area.top, Math.min(center - card.offsetHeight / 2, area.bottom - card.offsetHeight));
    card.style.top = `${Math.round(top)}px`;
  });

  if (!shown || !area || !rail) return null;

  const fromIndex = visible ? rounds.findIndex(round => round.id === visible.from) : -1;
  const toIndex = visible ? rounds.findIndex(round => round.id === visible.to) : -1;
  const sliderIndex = keyboardIndex >= 0 ? keyboardIndex : fromIndex >= 0 ? fromIndex : count - 1;
  const sliderSummary = describe(rounds[sliderIndex], workflowLabels).slice(0, 60);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        next = sliderIndex - 1;
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        next = sliderIndex + 1;
        break;
      case 'PageUp':
        next = sliderIndex - PAGE_STEP;
        break;
      case 'PageDown':
        next = sliderIndex + PAGE_STEP;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        jumpTo(sliderIndex);
        return;
      case 'Escape':
        event.currentTarget.blur();
        return;
      default:
        return;
    }
    event.preventDefault();
    setKeyboardId(rounds[Math.min(count - 1, Math.max(0, next))].id);
  };

  return (
    <>
      <div
        className={`round-nav ${previewIndex !== null ? 'is-engaged' : ''} ${rail.height / count < 4 ? 'is-dense' : ''}`}
        style={{ left: rail.left, top: rail.top, width: BAND_WIDTH, height: rail.height }}
        role="slider"
        tabIndex={0}
        aria-label="对话轮次导航"
        aria-orientation="vertical"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={sliderIndex + 1}
        aria-valuetext={`第 ${sliderIndex + 1}/${count} 轮：${sliderSummary}`}
        onFocus={() => setKeyboardId(rounds[sliderIndex].id)}
        onBlur={() => setKeyboardId(null)}
        onKeyDown={handleKeyDown}
      >
        {rounds.map((round, index) => {
          const classes = ['round-nav-tick'];
          if (fromIndex >= 0 && index >= fromIndex && index <= toIndex) classes.push('is-visible');
          if (round.generating) classes.push('is-generating');
          if (round.id === locatingId) classes.push('is-locating');
          if (index === previewIndex) classes.push('is-active');
          return (
            <span
              key={round.id}
              className={classes.join(' ')}
              style={{ top: `${((index + 0.5) / count) * 100}%` }}
              aria-hidden="true"
            />
          );
        })}
      </div>
      {previewRound && previewIndex !== null && (
        <RoundPreview
          ref={cardRef}
          round={previewRound}
          index={previewIndex}
          count={count}
          right={area.previewRight}
          pinned={pinnedIndex >= 0}
          showMedia={dwellId === previewRound.id}
          locating={locatingId === previewRound.id}
          workflowLabel={previewRound.workflow ? workflowLabels[previewRound.workflow] : undefined}
          onJump={() => jumpTo(previewIndex)}
          onStep={delta => setPinnedId(rounds[Math.min(count - 1, Math.max(0, previewIndex + delta))].id)}
        />
      )}
    </>
  );
}

export default memo(RoundNavigator);
