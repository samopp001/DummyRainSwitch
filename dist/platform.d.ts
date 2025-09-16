import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { WeatherNowcast } from './types';
export declare class RainSwitchPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly api: API;
    readonly Service: any;
    readonly Characteristic: any;
    private readonly config;
    private readonly accessories;
    private readonly cachedAccessories;
    private providerChain;
    private location;
    private pollingTimer;
    private readonly intervalMs;
    private readonly minOnMs;
    private readonly minOffMs;
    private readonly timeoutMs;
    private readonly cacheTtlSeconds;
    private readonly retryBackoffSeconds;
    private readonly overrideMinutes?;
    private readonly quietSchedule?;
    private readonly debugEnabled;
    private lastWeather;
    constructor(log: Logger, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    getForecast(lookaheadMinutes: number): Promise<import('./types').WeatherForecastSlice[]>;
    isWithinQuietHours(now: number): boolean;
    debug(message: string, ...params: unknown[]): void;
    getHysteresisConfig(): {
        minOnMs: number;
        minOffMs: number;
    };
    getOverrideMinutes(): number | undefined;
    getLastWeather(): WeatherNowcast | null;
    private handleDidFinishLaunching;
    private setupAccessories;
    private startPolling;
    private generateUuid;
}
