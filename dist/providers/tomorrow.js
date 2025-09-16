"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TomorrowProvider = void 0;
const undici_1 = require("undici");
class TomorrowProvider {
    constructor(log, cfg, location, timeoutMs) {
        this.log = log;
        this.cfg = cfg;
        this.location = location;
        this.timeoutMs = timeoutMs;
        this.name = 'Tomorrow.io';
        this.forecastCache = null;
    }
    isSupported() {
        return Boolean(this.cfg?.apiKey && this.location);
    }
    async getNowcast() {
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
    async getForecast(lookaheadMinutes) {
        const data = await this.fetchForecast();
        const now = Date.now();
        const intervals = collectIntervals(data);
        const slices = [];
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
    async fetchForecast() {
        if (this.forecastCache && Date.now() - this.forecastCache.ts < 60000) {
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
        const { body, statusCode } = await (0, undici_1.request)(url.toString(), {
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
        const parsed = JSON.parse(text);
        this.forecastCache = { data: parsed, ts: Date.now() };
        return parsed;
    }
}
exports.TomorrowProvider = TomorrowProvider;
const selectBestInterval = (data, now) => {
    const intervals = collectIntervals(data);
    if (!intervals.length) {
        return null;
    }
    const future = intervals.filter((entry) => entry.ts >= now);
    return (future[0] ?? intervals[intervals.length - 1]) ?? null;
};
const collectIntervals = (data) => {
    const intervals = [];
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
const mapPrecipitationType = (value) => {
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
const clampPercentage = (value) => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, value));
};
//# sourceMappingURL=tomorrow.js.map