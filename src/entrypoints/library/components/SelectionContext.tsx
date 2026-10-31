import { createContext, useContext } from 'react';

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
