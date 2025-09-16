import type { Logger } from 'homebridge';
import type { ProviderConfig, WeatherNowcast, WeatherForecastSlice } from '../types';
import type { ResolvedLocation } from '../util/geo';
export interface ProviderChainOptions {
    timeoutMs: number;
    cacheTtlSeconds: number;
    retryBackoffSeconds: number[];
}
export interface ProviderChain {
    getNowcast(force?: boolean): Promise<WeatherNowcast>;
    getForecast(lookaheadMinutes: number, force?: boolean): Promise<WeatherForecastSlice[]>;
    describe(): string;
    markFailure(): void;
}
export declare const makeProviderChain: (log: Logger, cfg: ProviderConfig | undefined, location: ResolvedLocation | null, options?: Partial<ProviderChainOptions>) => ProviderChain;
