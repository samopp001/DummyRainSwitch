"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeatherKitProvider = void 0;
const promises_1 = require("fs/promises");
const jose_1 = require("jose");
const undici_1 = require("undici");
class WeatherKitProvider {
    constructor(log, cfg, location, timeoutMs) {
        this.log = log;
        this.cfg = cfg;
        this.location = location;
        this.timeoutMs = timeoutMs;
        this.name = 'Apple WeatherKit';
        this.keyPromise = null;
        this.tokenCache = null;
        this.weatherCache = null;
    }
    isSupported() {
        return Boolean(this.cfg?.teamId && this.cfg?.keyId && this.cfg?.privateKey && this.location);
    }
    async getNowcast() {
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
    async getForecast(lookaheadMinutes) {
        const weather = await this.fetchWeather();
        const now = Date.now();
        const slices = [];
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
    async fetchWeather() {
        if (this.weatherCache && Date.now() - this.weatherCache.ts < 60000) {
            return this.weatherCache.data;
        }
        if (!this.location) {
            throw new Error('No location provided');
        }
        const token = await this.getToken();
        const url = `https://weatherkit.apple.com/api/v1/weather/en/${this.location.lat}/${this.location.lon}` +
            '?dataSets=weatherCurrent,weatherForecastHourly,weatherForecastNextHour';
        const { body, statusCode } = await (0, undici_1.request)(url, {
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
        const parsed = JSON.parse(text);
        this.weatherCache = { data: parsed, ts: Date.now() };
        return parsed;
    }
    async getToken() {
        const now = Math.floor(Date.now() / 1000);
        if (this.tokenCache && this.tokenCache.exp - 60 > now) {
            return this.tokenCache.token;
        }
        if (!this.cfg?.privateKey || !this.cfg.keyId || !this.cfg.teamId) {
            throw new Error('WeatherKit credentials incomplete');
        }
        const key = await this.loadPrivateKey();
        const exp = now + 60 * 30;
        const jwt = await new jose_1.SignJWT({
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
    async loadPrivateKey() {
        if (!this.keyPromise) {
            if (!this.cfg?.privateKey) {
                throw new Error('WeatherKit private key missing');
            }
            this.keyPromise = (0, promises_1.readFile)(this.cfg.privateKey, 'utf8').then((key) => (0, jose_1.importPKCS8)(key, 'ES256'));
        }
        return this.keyPromise;
    }
}
exports.WeatherKitProvider = WeatherKitProvider;
const normalizeNumber = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
};
const normalizeProbability = (value) => {
    if (value > 1) {
        return Math.min(100, Math.max(0, value));
    }
    return Math.min(100, Math.max(0, value * 100));
};
const parseTime = (value) => {
    if (!value) {
        return null;
    }
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
};
const resolvePrecipType = (value) => {
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
//# sourceMappingURL=weatherkit.js.map