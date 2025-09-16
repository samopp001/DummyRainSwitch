import type { Logger } from 'homebridge';
import type { NwsConfig, WeatherProvider, WeatherNowcast, WeatherForecastSlice } from '../types';
import type { ResolvedLocation } from '../util/geo';
export declare class NwsProvider implements WeatherProvider {
    private readonly log;
    private readonly cfg;
    private readonly location;
    private readonly timeoutMs;
    readonly name = "NOAA/NWS";
    private gridPoint;
    private gridCache;
    constructor(log: Logger, cfg: NwsConfig | undefined, location: ResolvedLocation | null, timeoutMs: number);
    isSupported(): boolean;
    getNowcast(): Promise<WeatherNowcast>;
    getForecast(lookaheadMinutes: number): Promise<WeatherForecastSlice[]>;
    private fetchGrid;
    private resolveGridPoint;
}
