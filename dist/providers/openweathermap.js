"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenWeatherMapProvider = void 0;
const undici_1 = require("undici");
class OpenWeatherMapProvider {
    constructor(log, cfg, location, timeoutMs) {
        this.log = log;
        this.cfg = cfg;
        this.location = location;
        this.timeoutMs = timeoutMs;
        this.name = 'OpenWeatherMap';
        this.weatherCache = null;
    }
    isSupported() {
        return Boolean(this.cfg?.apiKey && this.location);
    }
    async getNowcast() {
        const weather = await this.fetchWeather();
        const current = weather.current ?? {};
        const precipSnow = extractOneHour(current.snow);
        const precipRain = extractOneHour(current.rain);
        const precipMmHr = precipSnow ?? precipRain ?? 0;
        const type = resolveType(current.weather, precipRain, precipSnow);
        return {
            ts: (current.dt ?? Math.floor(Date.now() / 1000)) * 1000,
            providerName: this.name,
            precipMmHr,
            pop: undefined,
            type,
            temperatureC: typeof current.temp === 'number' ? current.temp : undefined,
        };
    }
    async getForecast(lookaheadMinutes) {
        const weather = await this.fetchWeather();
        const now = Date.now();
        const slices = [];
        for (const minute of weather.minutely ?? []) {
            const ts = (minute.dt ?? 0) * 1000;
            const minutesFromNow = Math.round((ts - now) / 60000);
            if (minutesFromNow < 0 || minutesFromNow > lookaheadMinutes) {
                continue;
            }
            const mmPerMinute = typeof minute.precipitation === 'number' ? minute.precipitation : 0;
            slices.push({
                ts,
                minutesFromNow,
                providerName: this.name,
                precipMmHr: mmPerMinute * 60,
                pop: undefined,
                type: mmPerMinute > 0 ? 'rain' : 'none',
            });
        }
        for (const hour of weather.hourly ?? []) {
            const ts = (hour.dt ?? 0) * 1000;
            const minutesFromNow = Math.round((ts - now) / 60000);
            if (minutesFromNow < 0 || minutesFromNow > lookaheadMinutes) {
                continue;
            }
            const rain = extractOneHour(hour.rain);
            const snow = extractOneHour(hour.snow);
            slices.push({
                ts,
                minutesFromNow,
                providerName: this.name,
                precipMmHr: rain ?? snow ?? 0,
                pop: hour.pop != null ? Math.round(Math.min(1, Math.max(0, hour.pop)) * 100) : undefined,
                type: resolveType(hour.weather, rain ?? 0, snow ?? 0),
            });
        }
        return slices.sort((a, b) => a.ts - b.ts);
    }
    async fetchWeather() {
        if (this.weatherCache && Date.now() - this.weatherCache.ts < 60000) {
            return this.weatherCache.data;
        }
        if (!this.location || !this.cfg?.apiKey) {
            throw new Error('OpenWeatherMap configuration incomplete');
        }
        this.log.debug('[OpenWeatherMap] Requesting weather data for %s,%s', this.location.lat.toFixed(3), this.location.lon.toFixed(3));
        const url = new URL('https://api.openweathermap.org/data/2.5/onecall');
        url.searchParams.set('lat', this.location.lat.toString());
        url.searchParams.set('lon', this.location.lon.toString());
        url.searchParams.set('appid', this.cfg.apiKey);
        url.searchParams.set('units', 'metric');
        url.searchParams.set('exclude', 'daily,alerts');
        const { body, statusCode } = await (0, undici_1.request)(url.toString(), {
            method: 'GET',
            bodyTimeout: this.timeoutMs,
            headersTimeout: this.timeoutMs,
        });
        if (statusCode < 200 || statusCode >= 300) {
            const text = await body.text();
            throw new Error(`OpenWeatherMap HTTP ${statusCode}: ${text}`);
        }
        const text = await body.text();
        const parsed = JSON.parse(text);
        this.weatherCache = { data: parsed, ts: Date.now() };
        return parsed;
    }
}
exports.OpenWeatherMapProvider = OpenWeatherMapProvider;
const extractOneHour = (bucket) => {
    if (!bucket) {
        return null;
    }
    const value = bucket['1h'] ?? bucket['1H'] ?? bucket['3h'];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    if (bucket['3h'] && !bucket['1h']) {
        return value / 3;
    }
    return value;
};
const resolveType = (weather, rain, snow) => {
    if ((snow ?? 0) > 0.01) {
        return 'snow';
    }
    if ((rain ?? 0) > 0.01) {
        return 'rain';
    }
    const entry = weather?.[0];
    const text = (entry?.main ?? entry?.description ?? '').toLowerCase();
    if (text.includes('snow')) {
        return 'snow';
    }
    if (text.includes('rain') || text.includes('drizzle') || text.includes('shower')) {
        return 'rain';
    }
    return 'none';
};
//# sourceMappingURL=openweathermap.js.map