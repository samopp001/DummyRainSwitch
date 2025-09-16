import type { PlatformAccessory } from 'homebridge';
import type { RainAccessoryConfig, WeatherNowcast } from './types';
import type { RainSwitchPlatform } from './platform';
export declare class RainAccessory {
    private readonly platform;
    private readonly config;
    readonly accessory: PlatformAccessory;
    private readonly switchService;
    private readonly hysteresis;
    private readonly customCharacteristics;
    private readonly overrideMinutes?;
    private readonly metadataCharacteristics;
    private currentState;
    private overrideState;
    private overrideUntil;
    private faulted;
    private metadata;
    constructor(platform: RainSwitchPlatform, accessory: PlatformAccessory, config: RainAccessoryConfig);
    evaluate(weather: WeatherNowcast): Promise<void>;
    markFault(): void;
    private evaluateForecast;
    private updateState;
    private publishMetadata;
    private ensureOptionalCharacteristic;
    private clearFault;
    private handleSetOn;
}
