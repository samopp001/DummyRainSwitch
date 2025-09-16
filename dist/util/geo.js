"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLocation = resolveLocation;
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const undici_1 = require("undici");
const CACHE_FILE = path_1.default.join(os_1.default.homedir(), '.homebridge-rain-switch-cache.json');
async function loadCache() {
    try {
        if (!(0, fs_1.existsSync)(CACHE_FILE)) {
            return {};
        }
        const contents = await (0, promises_1.readFile)(CACHE_FILE, 'utf8');
        return JSON.parse(contents);
    }
    catch {
        return {};
    }
}
async function saveCache(cache) {
    try {
        await (0, promises_1.writeFile)(CACHE_FILE, JSON.stringify(cache, null, 2));
    }
    catch {
        // ignore
    }
}
async function fetchJson(url) {
    const { body, statusCode } = await (0, undici_1.request)(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'homebridge-rain-switch/0',
            'Accept': 'application/json',
        },
    });
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`HTTP ${statusCode}`);
    }
    const text = await body.text();
    return JSON.parse(text);
}
function isFiniteCoordinate(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
async function resolveLocation(log, cfg) {
    const cache = await loadCache();
    if (cfg && isFiniteCoordinate(cfg.lat) && isFiniteCoordinate(cfg.lon)) {
        const lat = cfg.lat;
        const lon = cfg.lon;
        const source = 'config';
        cache['explicit'] = { lat, lon, source, ts: Date.now() };
        await saveCache(cache);
        return { lat, lon, source };
    }
    if (cfg?.address) {
        const key = `addr:${cfg.address.toLowerCase()}`;
        const cached = cache[key];
        if (cached) {
            log.debug('Using cached geocode for %s', cfg.address);
            return { lat: cached.lat, lon: cached.lon, source: cached.source };
        }
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cfg.address)}&limit=1`;
            const result = await fetchJson(url);
            if (result.length) {
                const lat = parseFloat(result[0].lat);
                const lon = parseFloat(result[0].lon);
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    cache[key] = { lat, lon, source: 'geocode', ts: Date.now() };
                    await saveCache(cache);
                    log.info('Geocoded %s to %s,%s', cfg.address, lat.toFixed(4), lon.toFixed(4));
                    return { lat, lon, source: 'geocode' };
                }
            }
            log.warn('Failed to geocode address %s', cfg.address);
        }
        catch (error) {
            log.warn('Error geocoding %s: %s', cfg.address, error.message);
        }
    }
    if (cfg?.mode === 'auto' || !cfg) {
        const key = 'auto';
        const cached = cache[key];
        if (cached && Date.now() - cached.ts < 7 * 24 * 60 * 60 * 1000) {
            log.debug('Using cached auto location');
            return { lat: cached.lat, lon: cached.lon, source: cached.source };
        }
        try {
            const data = await fetchJson('https://ipapi.co/json/');
            const lat = data.latitude ?? data.lat;
            const lon = data.longitude ?? data.lon;
            if (isFiniteCoordinate(lat) && isFiniteCoordinate(lon)) {
                cache[key] = { lat, lon, source: 'ip', ts: Date.now() };
                await saveCache(cache);
                log.info('Resolved automatic location to %s,%s', lat.toFixed(4), lon.toFixed(4));
                return { lat, lon, source: 'ip' };
            }
        }
        catch (error) {
            log.warn('Automatic location lookup failed: %s', error.message);
        }
    }
    if (cache['explicit']) {
        const { lat, lon, source } = cache['explicit'];
        log.debug('Falling back to cached explicit coordinates');
        return { lat, lon, source };
    }
    return null;
}
//# sourceMappingURL=geo.js.map