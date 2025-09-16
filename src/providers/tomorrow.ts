import { request } from 'undici';
import type { Logger } from 'homebridge';
import type { TomorrowConfig, WeatherProvider, WeatherNowcast, WeatherForecastSlice, PrecipType } from '../types';
import type { ResolvedLocation } from '../util/geo';

interface TomorrowResponse {
  timelines?: Array<{
    timestep?: string;
    intervals?: Array<{
      startTime?: string;
      values?: {
        precipitationIntensity?: number | null;
        precipitationProbability?: number | null;
        precipitationType?: number | null;
      };
    }>;
  }>;
}

interface IntervalEntry {
  ts: number;
  precipMmHr: number;
  pop?: number;
  type: PrecipType;
}

export class TomorrowProvider implements WeatherProvider {
  public readonly name = 'Tomorrow.io';
  private forecastCache: { data: TomorrowResponse; ts: number } | null = null;

  constructor(
    private readonly log: Logger,
    private readonly cfg: TomorrowConfig | undefined,
    private readonly location: ResolvedLocation | null,
    private readonly timeoutMs: number,
  ) {}

  isSupported(): boolean {
    return Boolean(this.cfg?.apiKey && this.location);
  }

  async getNowcast(): Promise<WeatherNowcast> {
    const data = await this.fetchForecast();
    const interval = selectBestInterval(data, Date.now());
    return {
      ts: interval?.ts ?? Date.now(),
      providerName: this.name,
      precipMmHr: interval?.precipMmHr ?? 0,
      pop: interval?.pop,
      type: interval?.type ?? 'none',
      temperatureC: undefined,
    };
  }

  async getForecast(lookaheadMinutes: number): Promise<WeatherForecastSlice[]> {
    const data = await this.fetchForecast();
    const now = Date.now();
    const intervals = collectIntervals(data);
    const slices: WeatherForecastSlice[] = [];
    for (const entry of intervals) {
      const minutesFromNow = Math.round((entry.ts - now) / 60000);
      if (minutesFromNow < 0 || minutesFromNow > lookaheadMinutes) {
        continue;
      }
      slices.push({
        ts: entry.ts,
        minutesFromNow,
        providerName: this.name,
        precipMmHr: entry.precipMmHr,
        pop: entry.pop,
        type: entry.type,
      });
    }
    return slices.sort((a, b) => a.ts - b.ts);
  }

  private async fetchForecast(): Promise<TomorrowResponse> {
    if (this.forecastCache && Date.now() - this.forecastCache.ts < 60_000) {
      return this.forecastCache.data;
    }
    if (!this.location || !this.cfg?.apiKey) {
      throw new Error('Tomorrow.io configuration incomplete');
    }
    this.log.debug('[Tomorrow.io] Requesting forecast for %s,%s', this.location.lat.toFixed(3), this.location.lon.toFixed(3));
    const url = new URL('https://api.tomorrow.io/v4/weather/forecast');
    url.searchParams.set('location', `${this.location.lat},${this.location.lon}`);
    url.searchParams.set('timesteps', '1m,1h');
    url.searchParams.set('fields', 'precipitationIntensity,precipitationProbability,precipitationType');
    url.searchParams.set('units', 'metric');
    url.searchParams.set('apikey', this.cfg.apiKey);
    const { body, statusCode } = await request(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      bodyTimeout: this.timeoutMs,
      headersTimeout: this.timeoutMs,
    });
    if (statusCode < 200 || statusCode >= 300) {
      const text = await body.text();
      throw new Error(`Tomorrow.io HTTP ${statusCode}: ${text}`);
    }
    const text = await body.text();
    const parsed = JSON.parse(text) as TomorrowResponse;
    this.forecastCache = { data: parsed, ts: Date.now() };
    return parsed;
  }
}

const selectBestInterval = (data: TomorrowResponse, now: number): IntervalEntry | null => {
  const intervals = collectIntervals(data);
  if (!intervals.length) {
    return null;
  }
  const future = intervals.filter((entry) => entry.ts >= now);
  return (future[0] ?? intervals[intervals.length - 1]) ?? null;
};

const collectIntervals = (data: TomorrowResponse): IntervalEntry[] => {
  const intervals: IntervalEntry[] = [];
  for (const timeline of data.timelines ?? []) {
    const timestep = timeline.timestep ?? '';
    for (const interval of timeline.intervals ?? []) {
      const ts = Date.parse(interval.startTime ?? '');
      if (!Number.isFinite(ts)) {
        continue;
      }
      const values = interval.values ?? {};
      const precip = typeof values.precipitationIntensity === 'number' ? Math.max(0, values.precipitationIntensity) : 0;
      const popRaw = typeof values.precipitationProbability === 'number' ? values.precipitationProbability : undefined;
      const type = mapPrecipitationType(values.precipitationType);
      intervals.push({
        ts,
        precipMmHr: precip,
        pop: popRaw != null ? clampPercentage(popRaw) : undefined,
        type,
      });
    }
    if (timestep === '1m') {
      intervals.sort((a, b) => a.ts - b.ts);
    }
  }
  return intervals.sort((a, b) => a.ts - b.ts);
};

const mapPrecipitationType = (value: number | null | undefined): PrecipType => {
  switch (value) {
    case 1:
      return 'rain';
    case 2:
      return 'snow';
    case 3:
    case 4:
      return 'sleet';
    default:
      return 'none';
  }
};

const clampPercentage = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
};
