import type { Logger } from 'homebridge';
import type { WeatherKitConfig } from '../types';
import type { WeatherProvider, WeatherNowcast, WeatherForecastSlice } from '../types';
import type { ResolvedLocation } from '../util/geo';
export declare class WeatherKitProvider implements WeatherProvider {
    private readonly log;
    private readonly cfg;
    private readonly location;
    private readonly timeoutMs;
    readonly name = "Apple WeatherKit";
    private keyPromise;
    private tokenCache;
    private weatherCache;
    constructor(log: Logger, cfg: WeatherKitConfig | undefined, location: ResolvedLocation | null, timeoutMs: number);
    isSupported(): boolean;
    getNowcast(): Promise<WeatherNowcast>;
    getForecast(lookaheadMinutes: number): Promise<WeatherForecastSlice[]>;
    private fetchWeather;
    private getToken;
    private loadPrivateKey;
}
