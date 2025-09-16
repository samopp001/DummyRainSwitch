export interface HysteresisOptions {
    minOnMs: number;
    minOffMs: number;
}
export interface HysteresisState {
    next(desired: boolean, now: number): boolean;
    reset(initial?: boolean): void;
    getState(): boolean;
}
export declare const makeHysteresis: ({ minOnMs, minOffMs }: HysteresisOptions) => HysteresisState;
