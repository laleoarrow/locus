import { createContext, useContext, useRef, type MouseEvent, type PointerEvent } from 'react';

export interface SelectionState {
  selectedIds: Set<string>;
  toggle(id: string): void;
  toggleMany(ids: string[]): void;
  enabled: boolean;
  busy: boolean;
}

const SelectionContext = createContext<SelectionState>({
  selectedIds: new Set(),
  toggle: () => undefined,
  toggleMany: () => undefined,
  enabled: false,
  busy: false,
});

export const SelectionProvider = SelectionContext.Provider;

export function useSelection(): SelectionState {
  return useContext(SelectionContext);
}

/** Only a plain click that starts and ends on a layout surface selects. */
export function useBlankSelection(select: () => void, surfaces: string, busy: boolean) {
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const isSurface = (target: EventTarget) => target instanceof Element && target.matches(surfaces);
  const hasTextSelection = () => window.getSelection()?.isCollapsed === false;
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      press.current = !busy && event.isPrimary && event.button === 0 &&
        !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        isSurface(event.target) && !hasTextSelection()
        ? { x: event.clientX, y: event.clientY, moved: false } : null;
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 5) {
        press.current.moved = true;
      }
    },
    onPointerCancelCapture() { press.current = null; },
    onClick(event: MouseEvent<HTMLElement>) {
      const start = press.current;
      press.current = null;
      if (busy || event.defaultPrevented || event.button !== 0 || event.detail !== 1 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !start || start.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 ||
        !isSurface(event.target) || hasTextSelection()) return;
      select();
    },
  };
}
