// RangeContext — share the global time-range across deeply-nested widgets
// without prop-drilling. Provider at the root of main.tsx; consumers call
// useRangeContext() to read or change the range.

import { createContext, useContext, type ReactNode } from "react";

import {
  DEFAULT_RANGE,
  rangeDef,
  useRange,
  useRangeWindow,
  type RangeDef,
  type RangeKey,
  type RangeWindow,
  type UseRangeResult,
} from "./range.ts";

export interface RangeContextValue extends UseRangeResult {
  window: RangeWindow;
}

const DEFAULT_DEF: RangeDef = rangeDef(DEFAULT_RANGE);

const RangeContext = createContext<RangeContextValue>({
  range: DEFAULT_RANGE,
  setRange: () => {},
  def: DEFAULT_DEF,
  durationSec: DEFAULT_DEF.durationSec,
  defaultStepSec: DEFAULT_DEF.defaultStepSec,
  window: {
    startSec: 0,
    endSec: 0,
    start: new Date(0),
    end: new Date(0),
    stepSec: DEFAULT_DEF.defaultStepSec,
  },
});

export interface RangeProviderProps {
  children?: ReactNode;
}

export function RangeProvider({ children }: RangeProviderProps) {
  const state = useRange();
  const window = useRangeWindow(state.range);
  const value: RangeContextValue = { ...state, window };
  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useRangeContext(): RangeContextValue {
  return useContext(RangeContext);
}

export type { RangeKey };
