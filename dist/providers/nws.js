"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NwsProvider = void 0;
const undici_1 = require("undici");
class NwsProvider {
    constructor(log, cfg, location, timeoutMs) {
        this.log = log;
        this.cfg = cfg;
        this.location = location;
        this.timeoutMs = timeoutMs;
        this.name = 'NOAA/NWS';
        this.gridPoint = null;
        this.gridCache = null;
    }
    isSupported() {
        return Boolean(this.location);
    }
    async getNowcast() {
        const grid = await this.fetchGrid();
        const now = Date.now();
        const precip = selectSeriesValue(grid.properties?.quantitativePrecipitation?.values ?? [], now);
        const pop = selectSeriesValue(grid.properties?.probabilityOfPrecipitation?.values ?? [], now);
        const weather = selectWeather(grid.properties?.weather?.values ?? [], now);
        const precipMmHr = precip ? convertToRate(precip.value, precip.durationMinutes) : 0;
        const popValue = pop?.value != null ? clampPercentage(pop.value) : undefined;
        const type = weather ?? (precipMmHr > 0.05 ? 'rain' : 'none');
        return {
            ts: now,
            providerName: this.name,
            precipMmHr,
            pop: popValue,
            type,
            temperatureC: undefined,
        };
    }
    async getForecast(lookaheadMinutes) {
        const grid = await this.fetchGrid();
        const now = Date.now();
        const combined = new Map();
        mergeSeries(combined, grid.properties?.quantitativePrecipitation?.values ?? [], (builder, entry) => {
            const rate = convertToRate(entry.value, entry.durationMinutes);
            builder.precipMmHr = rate;
        });
        mergeSeries(combined, grid.properties?.probabilityOfPrecipitation?.values ?? [], (builder, entry) => {
            builder.pop = entry.value != null ? clampPercentage(entry.value) : builder.pop;
        });
        mergeWeather(combined, grid.properties?.weather?.values ?? []);
        const slices = [];
        for (const [ts, builder] of combined) {
            const minutesFromNow = Math.round((ts - now) / 60000);
            if (minutesFromNow < 0 || minutesFromNow > lookaheadMinutes) {
                continue;
            }
            slices.push({
                ts,
                minutesFromNow,
                providerName: this.name,
                precipMmHr: builder.precipMmHr ?? 0,
                pop: builder.pop,
                type: builder.type ?? ((builder.precipMmHr ?? 0) > 0.05 ? 'rain' : 'none'),
            });
        }
        return slices.sort((a, b) => a.ts - b.ts);
    }
    async fetchGrid() {
        if (!this.gridPoint) {
            this.gridPoint = await this.resolveGridPoint();
        }
        if (!this.gridPoint) {
            throw new Error('Unable to resolve NWS grid point');
        }
        if (this.gridCache && Date.now() - this.gridCache.ts < 60000) {
            return this.gridCache.data;
        }
        const url = `https://api.weather.gov/gridpoints/${this.gridPoint.office}/${this.gridPoint.gridX},${this.gridPoint.gridY}`;
        const { body, statusCode } = await (0, undici_1.request)(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'homebridge-rain-switch (https://github.com/example)',
                Accept: 'application/geo+json',
            },
            bodyTimeout: this.timeoutMs,
            headersTimeout: this.timeoutMs,
        });
        if (statusCode < 200 || statusCode >= 300) {
            const text = await body.text();
            throw new Error(`NWS grid HTTP ${statusCode}: ${text}`);
        }
        const text = await body.text();
        const parsed = JSON.parse(text);
        this.gridCache = { data: parsed, ts: Date.now() };
        return parsed;
    }
    async resolveGridPoint() {
        if (!this.location) {
            return null;
        }
        const url = `https://api.weather.gov/points/${this.location.lat},${this.location.lon}`;
        const { body, statusCode } = await (0, undici_1.request)(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'homebridge-rain-switch (https://github.com/example)',
                Accept: 'application/geo+json',
            },
            bodyTimeout: this.timeoutMs,
            headersTimeout: this.timeoutMs,
        });
        if (statusCode < 200 || statusCode >= 300) {
            const text = await body.text();
            throw new Error(`NWS point HTTP ${statusCode}: ${text}`);
        }
        const text = await body.text();
        const parsed = JSON.parse(text);
        const office = parsed.properties?.gridId;
        const gridX = parsed.properties?.gridX;
        const gridY = parsed.properties?.gridY;
        if (!office || gridX == null || gridY == null) {
            throw new Error('NWS point response missing grid data');
        }
        this.log.info('Resolved NWS grid point %s %d,%d', office, gridX, gridY);
        return { office, gridX, gridY };
    }
}
exports.NwsProvider = NwsProvider;
const selectSeriesValue = (values, now) => {
    const entries = values.map(parseSeriesEntry).filter((entry) => entry !== null);
    return entries.find((entry) => now >= entry.startTime && now <= entry.endTime) ?? null;
};
const selectWeather = (values, now) => {
    const entries = values.map(parseWeatherEntry).filter((entry) => entry !== null);
    const match = entries.find((entry) => now >= entry.startTime && now <= entry.endTime);
    return match?.type ?? null;
};
const mergeSeries = (target, values, apply) => {
    for (const entry of values.map(parseSeriesEntry)) {
        if (!entry) {
            continue;
        }
        const builder = target.get(entry.startTime) ?? {};
        apply(builder, entry);
        target.set(entry.startTime, builder);
    }
};
const mergeWeather = (target, values) => {
    for (const entry of values.map(parseWeatherEntry)) {
        if (!entry) {
            continue;
        }
        const builder = target.get(entry.startTime) ?? {};
        builder.type = entry.type;
        target.set(entry.startTime, builder);
    }
};
const parseSeriesEntry = (value) => {
    if (!value?.validTime) {
        return null;
    }
    const parsedTime = parseValidTime(value.validTime);
    if (!parsedTime) {
        return null;
    }
    return {
        startTime: parsedTime.start,
        endTime: parsedTime.end,
        durationMinutes: parsedTime.durationMinutes,
        value: value.value ?? null,
    };
};
const parseWeatherEntry = (value) => {
    if (!value?.validTime) {
        return null;
    }
    const parsedTime = parseValidTime(value.validTime);
    if (!parsedTime) {
        return null;
    }
    const type = determineWeatherType(value.value);
    return {
        startTime: parsedTime.start,
        endTime: parsedTime.end,
        durationMinutes: parsedTime.durationMinutes,
        value: null,
        type,
    };
};
const determineWeatherType = (value) => {
    if (!value?.length) {
        return 'none';
    }
    for (const condition of value) {
        const weather = (condition.weather ?? condition.coverage ?? '').toLowerCase();
        if (weather.includes('snow')) {
            return 'snow';
        }
        if (weather.includes('rain') || weather.includes('showers') || weather.includes('rain showers')) {
            return 'rain';
        }
    }
    return 'none';
};
const parseValidTime = (value) => {
    const [startPart, durationPart] = value.split('/');
    if (!startPart || !durationPart) {
        return null;
    }
    const start = Date.parse(startPart);
    if (!Number.isFinite(start)) {
        return null;
    }
    const durationMinutes = parseDurationMinutes(durationPart);
    if (!durationMinutes) {
        return null;
    }
    const end = start + durationMinutes * 60000;
    return { start, end, durationMinutes };
};
const parseDurationMinutes = (value) => {
    const match = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(value);
    if (!match) {
        return 60; // default 1 hour
    }
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const total = hours * 60 + minutes;
    return total > 0 ? total : 60;
};
const convertToRate = (value, durationMinutes) => {
    if (value == null || !Number.isFinite(value)) {
        return 0;
    }
    const durationHours = Math.max(1 / 60, durationMinutes / 60);
    return value / durationHours;
};
const clampPercentage = (value) => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, value));
};
//# sourceMappingURL=nws.js.map