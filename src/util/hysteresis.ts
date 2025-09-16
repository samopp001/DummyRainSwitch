export interface HysteresisOptions {
  minOnMs: number;
  minOffMs: number;
}

export interface HysteresisState {
  next(desired: boolean, now: number): boolean;
  reset(initial?: boolean): void;
  getState(): boolean;
}

export const makeHysteresis = ({ minOnMs, minOffMs }: HysteresisOptions): HysteresisState => {
  let state = false;
  let lastFlip = 0;

  const clamp = (value: number): number => {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, value);
  };

  const minOn = clamp(minOnMs);
  const minOff = clamp(minOffMs);

  return {
    next(desired: boolean, now: number): boolean {
      if (!lastFlip) {
        lastFlip = now;
        state = desired;
        return state;
      }

      if (desired === state) {
        return state;
      }

      const elapsed = now - lastFlip;
      const gate = state ? minOn : minOff;
      if (elapsed >= gate) {
        state = desired;
        lastFlip = now;
      }
      return state;
    },
    reset(initial = false): void {
      state = initial;
      lastFlip = 0;
    },
    getState(): boolean {
      return state;
    },
  };
};
