import type { Logger } from 'homebridge';
import type { OpenWeatherMapConfig, WeatherProvider, WeatherNowcast, WeatherForecastSlice } from '../types';
import type { ResolvedLocation } from '../util/geo';
export declare class OpenWeatherMapProvider implements WeatherProvider {
    private readonly log;
    private readonly cfg;
    private readonly location;
    private readonly timeoutMs;
    readonly name = "OpenWeatherMap";
    private weatherCache;
    constructor(log: Logger, cfg: OpenWeatherMapConfig | undefined, location: ResolvedLocation | null, timeoutMs: number);
    isSupported(): boolean;
    getNowcast(): Promise<WeatherNowcast>;
    getForecast(lookaheadMinutes: number): Promise<WeatherForecastSlice[]>;
    private fetchWeather;
}
