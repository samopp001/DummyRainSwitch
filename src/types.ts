import type { PlatformConfig } from 'homebridge';

export type PrecipType = 'rain' | 'snow' | 'sleet' | 'none';

export interface LocationConfig {
  lat?: number;
  lon?: number;
  address?: string;
  mode?: 'explicit' | 'auto' | 'geocode';
}

export interface WeatherKitConfig {
  teamId?: string;
  keyId?: string;
  privateKey?: string;
  serviceId?: string;
}

export interface OpenWeatherMapConfig {
  apiKey?: string;
}

export interface TomorrowConfig {
  apiKey?: string;
}

export interface NwsConfig {
  enabled?: boolean;
}

export interface ProviderConfig {
  mode?: 'auto' | 'weatherkit' | 'openweathermap' | 'nws' | 'tomorrow';
  weatherkit?: WeatherKitConfig;
  openweathermap?: OpenWeatherMapConfig;
  tomorrow?: TomorrowConfig;
  nws?: NwsConfig;
}

export interface PollingConfig {
  intervalSeconds?: number;
  minOnDurationSeconds?: number;
  minOffDurationSeconds?: number;
  timeoutMs?: number;
}

export interface AdvancedConfig {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  cacheTtlSeconds?: number;
  retryBackoffSeconds?: number[];
  overrideMinutes?: number;
  quietHours?: {
    start?: string;
    end?: string;
  };
}

export type AccessoryType = 'rain-now' | 'rain-soon' | 'snow-mode';

export interface RainAccessoryConfig {
  type: AccessoryType;
  name: string;
  thresholdMmPerHr?: number;
  lookaheadMinutes?: number;
  popThreshold?: number;
  intensityThresholdMmPerHr?: number;
  enabled?: boolean;
}

export interface RainSwitchPlatformConfig extends PlatformConfig {
  name: string;
  location?: LocationConfig;
  provider?: ProviderConfig;
  polling?: PollingConfig;
  accessories?: RainAccessoryConfig[];
  advanced?: AdvancedConfig;
}

export interface WeatherNowcast {
  ts: number;
  providerName: string;
  precipMmHr: number;
  pop?: number;
  type: PrecipType;
  temperatureC?: number;
}

export interface WeatherForecastSlice {
  ts: number;
  minutesFromNow: number;
  providerName: string;
  precipMmHr: number;
  pop?: number;
  type: PrecipType;
}

export interface WeatherProvider {
  readonly name: string;
  isSupported(): boolean;
  getNowcast(): Promise<WeatherNowcast>;
  getForecast(lookaheadMinutes: number): Promise<WeatherForecastSlice[]>;
}
