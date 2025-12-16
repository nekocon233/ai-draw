import { useState, useRef, useEffect, useCallback } from 'react';

interface UseResizableOptions {
  minLeftWidthPercent?: number;
  maxLeftWidthPercent?: number;
  defaultLeftWidth?: number;
}

export function useResizable({
  minLeftWidthPercent = 20, // 最小20%
  maxLeftWidthPercent = 80, // 最大80%
  defaultLeftWidth = 50, // 默认50%
}: UseResizableOptions = {}) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = e.clientX - containerRect.left;
      const containerWidth = containerRect.width;
      
      // 转换为百分比
      const leftWidthPercent = (newLeftWidth / containerWidth) * 100;
      
      // 限制在最小最大值之间
      const clampedWidth = Math.min(
        Math.max(leftWidthPercent, minLeftWidthPercent),
        maxLeftWidthPercent
      );
      
      setLeftWidth(clampedWidth);
    },
    [isDragging, minLeftWidthPercent, maxLeftWidthPercent]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return {
    leftWidth,
    rightWidth: 100 - leftWidth,
    isDragging,
    handleMouseDown,
    containerRef,
  };
}
