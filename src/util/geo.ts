import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { request } from 'undici';
import type { Logger } from 'homebridge';
import type { LocationConfig } from '../types';

const LEGACY_CACHE_FILE = path.join(os.homedir(), '.homebridge-rain-switch-cache.json');
const CACHE_DIR_NAME = 'rain-switch';
const CACHE_FILE_NAME = 'location-cache.json';

interface LocationCacheEntry {
  lat: number;
  lon: number;
  source: string;
  ts: number;
}

interface LocationCache {
  [key: string]: LocationCacheEntry;
}

const getCacheFile = (storagePath?: string): string => {
  if (storagePath) {
    return path.join(storagePath, CACHE_DIR_NAME, CACHE_FILE_NAME);
  }
  return LEGACY_CACHE_FILE;
};

export interface ResolvedLocation {
  lat: number;
  lon: number;
  source: string;
}

async function loadCache(storagePath?: string): Promise<LocationCache> {
  const cacheFile = getCacheFile(storagePath);
  try {
    if (existsSync(cacheFile)) {
      const contents = await readFile(cacheFile, 'utf8');
      return JSON.parse(contents) as LocationCache;
    }
    if (storagePath && existsSync(LEGACY_CACHE_FILE)) {
      const contents = await readFile(LEGACY_CACHE_FILE, 'utf8');
      const legacyCache = JSON.parse(contents) as LocationCache;
      await saveCache(storagePath, legacyCache);
      return legacyCache;
    }
    return {};
  } catch {
    return {};
  }
}

async function saveCache(storagePath: string | undefined, cache: LocationCache): Promise<void> {
  const cacheFile = getCacheFile(storagePath);
  try {
    if (storagePath) {
      await mkdir(path.dirname(cacheFile), { recursive: true });
    }
    await writeFile(cacheFile, JSON.stringify(cache, null, 2));
  } catch {
    // ignore
  }
}

async function fetchJson<T>(url: string, timeoutMs: number | undefined): Promise<T> {
  const options: Parameters<typeof request>[1] = {
    method: 'GET',
    headers: {
      'User-Agent': 'homebridge-rain-switch/0',
      'Accept': 'application/json',
    },
  };
  if (timeoutMs != null) {
    options.bodyTimeout = timeoutMs;
    options.headersTimeout = timeoutMs;
  }
  const { body, statusCode } = await request(url, options);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode}`);
  }
  const text = await body.text();
  return JSON.parse(text) as T;
}

function isFiniteCoordinate(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export async function resolveLocation(
  log: Logger,
  cfg?: LocationConfig,
  storagePath?: string,
  timeoutMs?: number,
): Promise<ResolvedLocation | null> {
  const cache = await loadCache(storagePath);

  if (cfg && isFiniteCoordinate(cfg.lat) && isFiniteCoordinate(cfg.lon)) {
    const lat = cfg.lat;
    const lon = cfg.lon;
    const source = 'config';
    cache['explicit'] = { lat, lon, source, ts: Date.now() };
    await saveCache(storagePath, cache);
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
      const result = await fetchJson<Array<{ lat: string; lon: string }>>(url, timeoutMs);
      if (result.length) {
        const lat = parseFloat(result[0].lat);
        const lon = parseFloat(result[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          cache[key] = { lat, lon, source: 'geocode', ts: Date.now() };
          await saveCache(storagePath, cache);
          log.info('Geocoded %s to %s,%s', cfg.address, lat.toFixed(4), lon.toFixed(4));
          return { lat, lon, source: 'geocode' };
        }
      }
      log.warn('Failed to geocode address %s', cfg.address);
    } catch (error) {
      log.warn('Error geocoding %s: %s', cfg.address, (error as Error).message);
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
      const data = await fetchJson<{ latitude: number; longitude: number; lat?: number; lon?: number }>('https://ipapi.co/json/', timeoutMs);
      const lat = data.latitude ?? data.lat;
      const lon = data.longitude ?? data.lon;
      if (isFiniteCoordinate(lat) && isFiniteCoordinate(lon)) {
        cache[key] = { lat, lon, source: 'ip', ts: Date.now() };
        await saveCache(storagePath, cache);
        log.info('Resolved automatic location to %s,%s', lat.toFixed(4), lon.toFixed(4));
        return { lat, lon, source: 'ip' };
      }
    } catch (error) {
      log.warn('Automatic location lookup failed: %s', (error as Error).message);
    }
  }

  if (cache['explicit']) {
    const { lat, lon, source } = cache['explicit'];
    log.debug('Falling back to cached explicit coordinates');
    return { lat, lon, source };
  }

  return null;
}
