"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeProviderChain = void 0;
const weatherkit_1 = require("./weatherkit");
const openweathermap_1 = require("./openweathermap");
const nws_1 = require("./nws");
const tomorrow_1 = require("./tomorrow");
const DEFAULT_OPTIONS = {
    timeoutMs: 5000,
    cacheTtlSeconds: 60,
    retryBackoffSeconds: [30, 60, 120, 300],
};
const makeProviderChain = (log, cfg, location, options) => {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const providers = [];
    const mode = cfg?.mode ?? 'auto';
    const addProvider = (factory) => {
        try {
            const provider = factory();
            if (provider.isSupported()) {
                providers.push(provider);
            }
        }
        catch (error) {
            log.debug('Skipping provider: %s', error.message);
        }
    };
    if (mode === 'weatherkit' || mode === 'auto') {
        addProvider(() => new weatherkit_1.WeatherKitProvider(log, cfg?.weatherkit, location, opts.timeoutMs));
    }
    if (mode === 'openweathermap' || mode === 'auto') {
        addProvider(() => new openweathermap_1.OpenWeatherMapProvider(log, cfg?.openweathermap, location, opts.timeoutMs));
    }
    if ((mode === 'nws' || mode === 'auto') && (cfg?.nws?.enabled ?? true)) {
        addProvider(() => new nws_1.NwsProvider(log, cfg?.nws, location, opts.timeoutMs));
    }
    if (mode === 'tomorrow' || mode === 'auto') {
        addProvider(() => new tomorrow_1.TomorrowProvider(log, cfg?.tomorrow, location, opts.timeoutMs));
    }
    if (!providers.length) {
        throw new Error('No weather providers enabled');
    }
    let nowcastCache = null;
    const forecastCache = new Map();
    let backoffIndex = 0;
    let nextAllowedTs = 0;
    const pickProvider = async (fn) => {
        let lastError = null;
        for (const provider of providers) {
            try {
                const result = await withTimeout(fn(provider), opts.timeoutMs);
                backoffIndex = 0;
                nextAllowedTs = 0;
                return result;
            }
            catch (error) {
                lastError = error;
                log.warn('%s provider failed: %s', provider.name, lastError.message);
            }
        }
        backoffIndex = Math.min(backoffIndex + 1, opts.retryBackoffSeconds.length - 1);
        nextAllowedTs = Date.now() + opts.retryBackoffSeconds[backoffIndex] * 1000;
        throw lastError ?? new Error('All providers failed');
    };
    const isCacheValid = (entry) => {
        if (!entry) {
            return false;
        }
        return Date.now() - entry.ts < opts.cacheTtlSeconds * 1000;
    };
    return {
        async getNowcast(force = false) {
            if (!force && isCacheValid(nowcastCache)) {
                return nowcastCache.data;
            }
            if (nextAllowedTs && Date.now() < nextAllowedTs) {
                if (isCacheValid(nowcastCache)) {
                    return nowcastCache.data;
                }
                const wait = Math.max(0, nextAllowedTs - Date.now());
                throw new Error(`Providers backoff in effect for ${Math.round(wait / 1000)}s`);
            }
            const data = await pickProvider((p) => p.getNowcast());
            nowcastCache = { data, ts: Date.now() };
            return data;
        },
        async getForecast(lookaheadMinutes, force = false) {
            const rounded = Math.max(5, Math.ceil(lookaheadMinutes / 5) * 5);
            const cacheEntry = forecastCache.get(rounded);
            if (!force && isCacheValid(cacheEntry)) {
                return cacheEntry.data;
            }
            if (nextAllowedTs && Date.now() < nextAllowedTs) {
                if (isCacheValid(cacheEntry)) {
                    return cacheEntry.data;
                }
                const wait = Math.max(0, nextAllowedTs - Date.now());
                throw new Error(`Providers backoff in effect for ${Math.round(wait / 1000)}s`);
            }
            const data = await pickProvider((p) => p.getForecast(rounded));
            forecastCache.set(rounded, { data, ts: Date.now() });
            return data;
        },
        describe() {
            return providers.map((p) => p.name).join(' -> ');
        },
        markFailure() {
            backoffIndex = Math.min(backoffIndex + 1, opts.retryBackoffSeconds.length - 1);
            nextAllowedTs = Date.now() + opts.retryBackoffSeconds[backoffIndex] * 1000;
        },
    };
};
exports.makeProviderChain = makeProviderChain;
const withTimeout = async (promise, timeoutMs) => {
    let timer;
    return await Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
};
//# sourceMappingURL=provider.js.map