import type { Logger } from 'homebridge';
import type { TomorrowConfig, WeatherProvider, WeatherNowcast, WeatherForecastSlice } from '../types';
import type { ResolvedLocation } from '../util/geo';
export declare class TomorrowProvider implements WeatherProvider {
    private readonly log;
    private readonly cfg;
    private readonly location;
    private readonly timeoutMs;
    readonly name = "Tomorrow.io";
    private forecastCache;
    constructor(log: Logger, cfg: TomorrowConfig | undefined, location: ResolvedLocation | null, timeoutMs: number);
    isSupported(): boolean;
    getNowcast(): Promise<WeatherNowcast>;
    getForecast(lookaheadMinutes: number): Promise<WeatherForecastSlice[]>;
    private fetchForecast;
}
