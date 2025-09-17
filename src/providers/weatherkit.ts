import { readFile } from 'fs/promises';
import { SignJWT, importPKCS8 } from 'jose';
import { request } from 'undici';
import type { Logger } from 'homebridge';
import type { WeatherKitConfig } from '../types';
import type { WeatherProvider, WeatherNowcast, WeatherForecastSlice, PrecipType } from '../types';
import type { ResolvedLocation } from '../util/geo';

interface WeatherKitResponse {
  currentWeather?: WeatherKitCurrentWeather;
  forecastNextHour?: { minutes?: WeatherKitMinuteEntry[] };
  forecastHourly?: { hours?: WeatherKitHourEntry[] };
}

interface WeatherKitCurrentWeather {
  asOf?: string;
  precipitationIntensity?: number | null;
  precipitationType?: string | null;
  conditionCode?: string;
  temperature?: number | null;
  precipitationChance?: number | null;
}

interface WeatherKitMinuteEntry {
  startTime?: string;
  precipitationIntensity?: number | null;
  precipitationChance?: number | null;
  precipitationType?: string | null;
}

interface WeatherKitHourEntry {
  forecastStart?: string;
  precipitationIntensity?: number | null;
  precipitationChance?: number | null;
  precipitationType?: string | null;
}

export class WeatherKitProvider implements WeatherProvider {
  public readonly name = 'Apple WeatherKit';
  private keyPromise: ReturnType<typeof importPKCS8> | null = null;
  private tokenCache: { token: string; exp: number } | null = null;
  private weatherCache: { data: WeatherKitResponse; ts: number } | null = null;

  constructor(
    private readonly log: Logger,
    private readonly cfg: WeatherKitConfig | undefined,
    private readonly location: ResolvedLocation | null,
    private readonly timeoutMs: number,
  ) {}

  isSupported(): boolean {
    return Boolean(this.cfg?.teamId && this.cfg?.keyId && this.cfg?.privateKey && this.location);
  }

  async getNowcast(): Promise<WeatherNowcast> {
    const weather = await this.fetchWeather();
    const current = weather.currentWeather ?? {};
    const now = Date.now();
    const intensity = normalizeNumber(current.precipitationIntensity) ?? 0;
    const minuteEntry = weather.forecastNextHour?.minutes?.[0];
    const pop = normalizeNumber(current.precipitationChance ?? minuteEntry?.precipitationChance);
    const type = resolvePrecipType(current.precipitationType ?? minuteEntry?.precipitationType ?? current.conditionCode);

    return {
      ts: now,
      providerName: this.name,
      precipMmHr: intensity,
      pop: pop != null ? normalizeProbability(pop) : undefined,
      type,
      temperatureC: normalizeNumber(current.temperature ?? undefined) ?? undefined,
    };
  }

  async getForecast(lookaheadMinutes: number): Promise<WeatherForecastSlice[]> {
    const weather = await this.fetchWeather();
    const now = Date.now();
    const slices: WeatherForecastSlice[] = [];

    for (const minute of weather.forecastNextHour?.minutes ?? []) {
      const start = parseTime(minute.startTime);
      if (!start) {
        continue;
      }
      const minutesFromNow = Math.round((start - now) / 60000);
      if (minutesFromNow < 0 || minutesFromNow > lookaheadMinutes) {
        continue;
      }
      slices.push({
        ts: start,
        minutesFromNow,
        providerName: this.name,
        precipMmHr: normalizeNumber(minute.precipitationIntensity) ?? 0,
        pop: minute.precipitationChance != null ? normalizeProbability(minute.precipitationChance) : undefined,
        type: resolvePrecipType(minute.precipitationType),
      });
    }

    for (const hour of weather.forecastHourly?.hours ?? []) {
      const start = parseTime(hour.forecastStart);
      if (!start) {
        continue;
      }
      const minutesFromNow = Math.round((start - now) / 60000);
      if (minutesFromNow < 0 || minutesFromNow > lookaheadMinutes) {
        continue;
      }
      slices.push({
        ts: start,
        minutesFromNow,
        providerName: this.name,
        precipMmHr: normalizeNumber(hour.precipitationIntensity) ?? 0,
        pop: hour.precipitationChance != null ? normalizeProbability(hour.precipitationChance) : undefined,
        type: resolvePrecipType(hour.precipitationType),
      });
    }

    return slices.sort((a, b) => a.ts - b.ts);
  }

  private async fetchWeather(): Promise<WeatherKitResponse> {
    if (this.weatherCache && Date.now() - this.weatherCache.ts < 60_000) {
      return this.weatherCache.data;
    }
    if (!this.location) {
      throw new Error('No location provided');
    }
    const token = await this.getToken();
    const url = `https://weatherkit.apple.com/api/v1/weather/en/${this.location.lat}/${this.location.lon}` +
      '?dataSets=weatherCurrent,weatherForecastHourly,weatherForecastNextHour';
    const { body, statusCode } = await request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      bodyTimeout: this.timeoutMs,
      headersTimeout: this.timeoutMs,
    });
    if (statusCode < 200 || statusCode >= 300) {
      const text = await body.text();
      throw new Error(`WeatherKit HTTP ${statusCode}: ${text}`);
    }
    const text = await body.text();
    const parsed = JSON.parse(text) as WeatherKitResponse;
    this.weatherCache = { data: parsed, ts: Date.now() };
    return parsed;
  }

  private async getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.tokenCache && this.tokenCache.exp - 60 > now) {
      return this.tokenCache.token;
    }
    if (!this.cfg?.privateKey || !this.cfg.keyId || !this.cfg.teamId) {
      throw new Error('WeatherKit credentials incomplete');
    }
    const key = await this.loadPrivateKey();
    const exp = now + 60 * 30;
    const jwt = await new SignJWT({
      sub: this.cfg.serviceId ?? 'homebridge-rain-switch',
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.cfg.keyId })
      .setIssuer(this.cfg.teamId)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(key);
    this.tokenCache = { token: jwt, exp };
    return jwt;
  }

  private async loadPrivateKey() {
    if (!this.keyPromise) {
      if (!this.cfg?.privateKey) {
        throw new Error('WeatherKit private key missing');
      }
      this.keyPromise = readFile(this.cfg.privateKey, 'utf8')
        .then((key) => importPKCS8(key, 'ES256'))
        .catch((error) => {
          this.keyPromise = null;
          throw error;
        });
    }
    return this.keyPromise;
  }
}

const normalizeNumber = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const normalizeProbability = (value: number): number => {
  if (value > 1) {
    return Math.min(100, Math.max(0, value));
  }
  return Math.min(100, Math.max(0, value * 100));
};

const parseTime = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
};

const resolvePrecipType = (value: string | null | undefined): PrecipType => {
  if (!value) {
    return 'none';
  }
  const normalized = value.toLowerCase();
  if (normalized.includes('snow')) {
    return 'snow';
  }
  if (normalized.includes('sleet') || normalized.includes('mix')) {
    return 'sleet';
  }
  if (normalized.includes('rain') || normalized.includes('drizzle') || normalized.includes('showers')) {
    return 'rain';
  }
  return normalized === 'clear' ? 'none' : 'none';
};
