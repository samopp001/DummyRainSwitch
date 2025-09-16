import type { Logger } from 'homebridge';
import type { ProviderConfig, WeatherProvider, WeatherNowcast, WeatherForecastSlice } from '../types';
import { WeatherKitProvider } from './weatherkit';
import { OpenWeatherMapProvider } from './openweathermap';
import { NwsProvider } from './nws';
import { TomorrowProvider } from './tomorrow';
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

const DEFAULT_OPTIONS: ProviderChainOptions = {
  timeoutMs: 5000,
  cacheTtlSeconds: 60,
  retryBackoffSeconds: [30, 60, 120, 300],
};

export const makeProviderChain = (
  log: Logger,
  cfg: ProviderConfig | undefined,
  location: ResolvedLocation | null,
  options?: Partial<ProviderChainOptions>,
): ProviderChain => {
  const opts: ProviderChainOptions = { ...DEFAULT_OPTIONS, ...options };
  const providers: WeatherProvider[] = [];
  const mode = cfg?.mode ?? 'auto';

  const addProvider = (factory: () => WeatherProvider): void => {
    try {
      const provider = factory();
      if (provider.isSupported()) {
        providers.push(provider);
      }
    } catch (error) {
      log.debug('Skipping provider: %s', (error as Error).message);
    }
  };

  if (mode === 'weatherkit' || mode === 'auto') {
    addProvider(() => new WeatherKitProvider(log, cfg?.weatherkit, location, opts.timeoutMs));
  }
  if (mode === 'openweathermap' || mode === 'auto') {
    addProvider(() => new OpenWeatherMapProvider(log, cfg?.openweathermap, location, opts.timeoutMs));
  }
  if ((mode === 'nws' || mode === 'auto') && (cfg?.nws?.enabled ?? true)) {
    addProvider(() => new NwsProvider(log, cfg?.nws, location, opts.timeoutMs));
  }
  if (mode === 'tomorrow' || mode === 'auto') {
    addProvider(() => new TomorrowProvider(log, cfg?.tomorrow, location, opts.timeoutMs));
  }

  if (!providers.length) {
    throw new Error('No weather providers enabled');
  }

  let nowcastCache: { data: WeatherNowcast; ts: number } | null = null;
  const forecastCache = new Map<number, { data: WeatherForecastSlice[]; ts: number }>();
  let backoffIndex = 0;
  let nextAllowedTs = 0;

  const pickProvider = async <T>(fn: (p: WeatherProvider) => Promise<T>): Promise<T> => {
    let lastError: Error | null = null;
    for (const provider of providers) {
      try {
        const result = await withTimeout(fn(provider), opts.timeoutMs);
        backoffIndex = 0;
        nextAllowedTs = 0;
        return result;
      } catch (error) {
        lastError = error as Error;
        log.warn('%s provider failed: %s', provider.name, lastError.message);
      }
    }
    backoffIndex = Math.min(backoffIndex + 1, opts.retryBackoffSeconds.length - 1);
    nextAllowedTs = Date.now() + opts.retryBackoffSeconds[backoffIndex] * 1000;
    throw lastError ?? new Error('All providers failed');
  };

  const isCacheValid = (entry: { ts: number } | undefined | null): entry is { ts: number } => {
    if (!entry) {
      return false;
    }
    return Date.now() - entry.ts < opts.cacheTtlSeconds * 1000;
  };

  return {
    async getNowcast(force = false): Promise<WeatherNowcast> {
      if (!force && isCacheValid(nowcastCache)) {
        return nowcastCache!.data;
      }
      if (nextAllowedTs && Date.now() < nextAllowedTs) {
        if (isCacheValid(nowcastCache)) {
          return nowcastCache!.data;
        }
        const wait = Math.max(0, nextAllowedTs - Date.now());
        throw new Error(`Providers backoff in effect for ${Math.round(wait / 1000)}s`);
      }
      const data = await pickProvider((p) => p.getNowcast());
      nowcastCache = { data, ts: Date.now() };
      return data;
    },
    async getForecast(lookaheadMinutes: number, force = false): Promise<WeatherForecastSlice[]> {
      const rounded = Math.max(5, Math.ceil(lookaheadMinutes / 5) * 5);
      const cacheEntry = forecastCache.get(rounded);
      if (!force && isCacheValid(cacheEntry)) {
        return cacheEntry!.data;
      }
      if (nextAllowedTs && Date.now() < nextAllowedTs) {
        if (isCacheValid(cacheEntry)) {
          return cacheEntry!.data;
        }
        const wait = Math.max(0, nextAllowedTs - Date.now());
        throw new Error(`Providers backoff in effect for ${Math.round(wait / 1000)}s`);
      }
      const data = await pickProvider((p) => p.getForecast(rounded));
      forecastCache.set(rounded, { data, ts: Date.now() });
      return data;
    },
    describe(): string {
      return providers.map((p) => p.name).join(' -> ');
    },
    markFailure(): void {
      backoffIndex = Math.min(backoffIndex + 1, opts.retryBackoffSeconds.length - 1);
      nextAllowedTs = Date.now() + opts.retryBackoffSeconds[backoffIndex] * 1000;
    },
  };
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return await Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
};
