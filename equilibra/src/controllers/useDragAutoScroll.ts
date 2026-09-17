import React, { useEffect, useRef } from 'react';

interface UseDragAutoScrollOptions {
  boardRef?: React.RefObject<HTMLElement | null>;
  edgeThresholdX?: number;
  edgeThresholdY?: number;
  maxSpeedX?: number;
  maxSpeedY?: number;
}

/**
 * Reusable hook providing fluid 60fps auto-scrolling during HTML5 drag-and-drop operations:
 * 1. Vertical auto-scroll: Scrolls <main> when dragging near top/bottom viewport edges (e.g. dragging up to short buckets from long task lists).
 * 2. Horizontal auto-scroll: Scrolls board container when dragging near left/right board boundaries (for distant buckets).
 * 3. Column auto-scroll: Automatically scrolls any column under the cursor with internal vertical overflow.
 */
export function useDragAutoScroll({
  boardRef,
  edgeThresholdX = 130,
  edgeThresholdY = 120,
  maxSpeedX = 22,
  maxSpeedY = 24,
}: UseDragAutoScrollOptions = {}) {
  const isDraggingRef = useRef(false);
  const coordsRef = useRef<{ x: number; y: number } | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const loop = () => {
      if (!isDraggingRef.current || !coordsRef.current) {
        animFrameRef.current = null;
        return;
      }

      const { x, y } = coordsRef.current;

      // 1. Vertical Auto-Scroll on <main> container
      const mainEl = document.querySelector('main');
      if (mainEl) {
        const rect = mainEl.getBoundingClientRect();
        if (y <= rect.top + edgeThresholdY) {
          const dist = (rect.top + edgeThresholdY) - y;
          const ratio = Math.min(1, Math.max(0.1, dist / edgeThresholdY));
          mainEl.scrollTop -= Math.round(ratio * maxSpeedY);
        } else if (y >= rect.bottom - edgeThresholdY) {
          const dist = y - (rect.bottom - edgeThresholdY);
          const ratio = Math.min(1, Math.max(0.1, dist / edgeThresholdY));
          mainEl.scrollTop += Math.round(ratio * maxSpeedY);
        }
      }

      // 2. Horizontal Auto-Scroll on Kanban board container
      const boardEl = boardRef?.current;
      if (boardEl) {
        const rect = boardEl.getBoundingClientRect();
        if (x <= rect.left + edgeThresholdX) {
          const dist = (rect.left + edgeThresholdX) - x;
          const ratio = Math.min(1, Math.max(0.1, dist / edgeThresholdX));
          boardEl.scrollLeft -= Math.round(ratio * maxSpeedX);
        } else if (x >= rect.right - edgeThresholdX) {
          const dist = x - (rect.right - edgeThresholdX);
          const ratio = Math.min(1, Math.max(0.1, dist / edgeThresholdX));
          boardEl.scrollLeft += Math.round(ratio * maxSpeedX);
        }
      }

      // 3. Column-internal scroll if hovered element has vertical overflow
      try {
        const el = document.elementFromPoint(x, y);
        let curr: HTMLElement | null = el as HTMLElement;
        while (curr && curr !== mainEl && curr !== boardEl && curr !== document.body) {
          if (curr.scrollHeight > curr.clientHeight && curr.clientHeight > 100) {
            const style = window.getComputedStyle(curr);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
              const cRect = curr.getBoundingClientRect();
              const cThreshold = 50;
              if (y <= cRect.top + cThreshold && curr.scrollTop > 0) {
                const ratio = Math.min(1, (cRect.top + cThreshold - y) / cThreshold);
                curr.scrollTop -= Math.round(ratio * 16);
              } else if (y >= cRect.bottom - cThreshold && curr.scrollTop < curr.scrollHeight - curr.clientHeight) {
                const ratio = Math.min(1, (y - (cRect.bottom - cThreshold)) / cThreshold);
                curr.scrollTop += Math.round(ratio * 16);
              }
              break;
            }
          }
          curr = curr.parentElement;
        }
      } catch {
        // Ignore any geometry lookup errors during drag
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    const startDrag = () => {
      isDraggingRef.current = true;
      if (!animFrameRef.current) {
        animFrameRef.current = requestAnimationFrame(loop);
      }
    };

    const stopDrag = () => {
      isDraggingRef.current = false;
      coordsRef.current = null;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };

    const handleDragStart = () => {
      startDrag();
    };

    const handleDragOver = (e: DragEvent) => {
      isDraggingRef.current = true;
      coordsRef.current = { x: e.clientX, y: e.clientY };
      if (!animFrameRef.current) {
        animFrameRef.current = requestAnimationFrame(loop);
      }
    };

    const handleDragEnd = () => {
      stopDrag();
    };

    const handleDrop = () => {
      stopDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopDrag();
      }
    };

    window.addEventListener('dragstart', handleDragStart, { capture: true, passive: true });
    window.addEventListener('dragover', handleDragOver, { capture: true, passive: true });
    window.addEventListener('dragend', handleDragEnd, { capture: true, passive: true });
    window.addEventListener('drop', handleDrop, { capture: true, passive: true });
    window.addEventListener('mouseup', stopDrag, { capture: true, passive: true });
    window.addEventListener('keydown', handleKeyDown, { capture: true, passive: true });

    return () => {
      stopDrag();
      window.removeEventListener('dragstart', handleDragStart, { capture: true });
      window.removeEventListener('dragover', handleDragOver, { capture: true });
      window.removeEventListener('dragend', handleDragEnd, { capture: true });
      window.removeEventListener('drop', handleDrop, { capture: true });
      window.removeEventListener('mouseup', stopDrag, { capture: true });
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [boardRef, edgeThresholdX, edgeThresholdY, maxSpeedX, maxSpeedY]);
}
