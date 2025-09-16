import type { Logger } from 'homebridge';
import type { LocationConfig } from '../types';
export interface ResolvedLocation {
    lat: number;
    lon: number;
    source: string;
}
export declare function resolveLocation(log: Logger, cfg?: LocationConfig): Promise<ResolvedLocation | null>;
