import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { RainAccessory } from './rainAccessory';
import type { RainSwitchPlatformConfig, RainAccessoryConfig, WeatherNowcast } from './types';
import { resolveLocation, type ResolvedLocation } from './util/geo';
import { makeProviderChain, type ProviderChain } from './providers/provider';
import { PLUGIN_NAME, PLATFORM_NAME } from './version';

const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 15 * 60;

export class RainSwitchPlatform implements DynamicPlatformPlugin {
  public readonly Service = this.api.hap.Service;
  public readonly Characteristic = this.api.hap.Characteristic;

  private readonly config: RainSwitchPlatformConfig;
  private readonly accessories = new Map<string, RainAccessory>();
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();

  private providerChain: ProviderChain | null = null;
  private location: ResolvedLocation | null = null;
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;
  private readonly minOnMs: number;
  private readonly minOffMs: number;
  private readonly timeoutMs: number;
  private readonly cacheTtlSeconds: number;
  private readonly retryBackoffSeconds: number[];
  private readonly overrideMinutes?: number;
  private readonly quietSchedule?: { start: number; end: number };
  private readonly debugEnabled: boolean;
  private lastWeather: WeatherNowcast | null = null;

  constructor(public readonly log: Logger, config: PlatformConfig, public readonly api: API) {
    this.config = (config ?? {}) as RainSwitchPlatformConfig;
    const intervalSeconds = clamp(
      this.config.polling?.intervalSeconds ?? 180,
      MIN_INTERVAL_SECONDS,
      MAX_INTERVAL_SECONDS,
    );
    this.intervalMs = intervalSeconds * 1000;
    this.minOnMs = (this.config.polling?.minOnDurationSeconds ?? 300) * 1000;
    this.minOffMs = (this.config.polling?.minOffDurationSeconds ?? 300) * 1000;
    this.timeoutMs = this.config.polling?.timeoutMs ?? 5000;
    this.cacheTtlSeconds = this.config.advanced?.cacheTtlSeconds ?? 60;
    this.retryBackoffSeconds = (this.config.advanced?.retryBackoffSeconds?.length ? this.config.advanced.retryBackoffSeconds : [30, 60, 120, 300]);
    this.overrideMinutes = this.config.advanced?.overrideMinutes;
    this.quietSchedule = parseQuietHours(this.config.advanced?.quietHours);
    this.debugEnabled = this.config.advanced?.logLevel === 'debug';

    this.api.on('didFinishLaunching', () => {
      void this.handleDidFinishLaunching();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading cached accessory %s', accessory.displayName);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  async getForecast(lookaheadMinutes: number): Promise<import('./types').WeatherForecastSlice[]> {
    if (!this.providerChain) {
      throw new Error('Provider chain not ready');
    }
    return this.providerChain.getForecast(lookaheadMinutes);
  }

  isWithinQuietHours(now: number): boolean {
    if (!this.quietSchedule) {
      return false;
    }
    const date = new Date(now);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const { start, end } = this.quietSchedule;
    if (start <= end) {
      return minutes >= start && minutes < end;
    }
    return minutes >= start || minutes < end;
  }

  debug(message: string, ...params: unknown[]): void {
    if (this.debugEnabled) {
      this.log.debug(message, ...params);
    }
  }

  getHysteresisConfig(): { minOnMs: number; minOffMs: number } {
    return { minOnMs: this.minOnMs, minOffMs: this.minOffMs };
  }

  getOverrideMinutes(): number | undefined {
    return this.overrideMinutes;
  }

  getLastWeather(): WeatherNowcast | null {
    return this.lastWeather;
  }

  private async handleDidFinishLaunching(): Promise<void> {
    if (!this.hasEnabledAccessories()) {
      this.setupAccessories();
      this.log.info('No accessories enabled; skipping provider initialisation');
      return;
    }

    try {
      this.location = await resolveLocation(
        this.log,
        this.config.location,
        this.api.user.storagePath(),
        this.timeoutMs,
      );
      if (!this.location) {
        this.log.warn('Unable to determine location; provider selection may fail');
      }
      this.providerChain = makeProviderChain(this.log, this.config.provider, this.location, {
        timeoutMs: this.timeoutMs,
        cacheTtlSeconds: this.cacheTtlSeconds,
        retryBackoffSeconds: this.retryBackoffSeconds,
      });
      this.log.info('Using providers: %s', this.providerChain.describe());
    } catch (error) {
      this.log.error('Failed to initialise providers: %s', (error as Error).message);
      return;
    }

    this.setupAccessories();
    this.startPolling();
  }

  private setupAccessories(): void {
    const configured = new Map<string, RainAccessoryConfig>();
    for (const acc of this.config.accessories ?? []) {
      if (acc.enabled === false) {
        continue;
      }
      configured.set(this.generateUuid(acc), acc);
    }

    for (const [uuid, accessory] of this.cachedAccessories.entries()) {
      if (!configured.has(uuid)) {
        this.log.info('Removing stale accessory %s', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.delete(uuid);
      }
    }

    for (const [uuid, accConfig] of configured.entries()) {
      let accessory = this.cachedAccessories.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(accConfig.name, uuid);
        accessory.context.type = accConfig.type;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.info('Registered new accessory %s', accConfig.name);
      }
      accessory.displayName = accConfig.name;
      accessory.context.config = accConfig;
      const rainAccessory = new RainAccessory(this, accessory, accConfig);
      this.accessories.set(uuid, rainAccessory);
    }
  }

  private startPolling(): void {
    if (!this.providerChain) {
      return;
    }
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.debug('Starting polling loop every %d seconds', this.intervalMs / 1000);

    const tick = async (): Promise<void> => {
      try {
        const weather = await this.providerChain!.getNowcast();
        this.lastWeather = weather;
        for (const accessory of this.accessories.values()) {
          await accessory.evaluate(weather);
        }
      } catch (error) {
        this.log.warn('Weather polling failed: %s', (error as Error).message);
        this.providerChain?.markFailure();
        for (const accessory of this.accessories.values()) {
          accessory.markFault();
        }
      } finally {
        if (this.providerChain) {
          this.pollingTimer = setTimeout(() => {
            this.pollingTimer = null;
            void tick();
          }, this.intervalMs);
        } else {
          this.pollingTimer = null;
        }
      }
    };

    void tick();
  }

  private hasEnabledAccessories(): boolean {
    return (this.config.accessories ?? []).some((accessory) => accessory.enabled !== false);
  }

  private generateUuid(config: RainAccessoryConfig): string {
    return String(this.api.hap.uuid.generate(`${this.config.name}:${config.type}:${config.name}`));
  }
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

type QuietHoursConfig = { start?: string; end?: string } | undefined;

const parseQuietHours = (
  quietHours: QuietHoursConfig,
): { start: number; end: number } | undefined => {
  if (!quietHours?.start || !quietHours?.end) {
    return undefined;
  }
  const start = parseTimeString(quietHours.start);
  const end = parseTimeString(quietHours.end);
  if (start == null || end == null) {
    return undefined;
  }
  return { start, end };
};

const parseTimeString = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours >= 24 || minutes < 0 || minutes >= 60) {
    return null;
  }
  return hours * 60 + minutes;
};
