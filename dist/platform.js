"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RainSwitchPlatform = void 0;
const rainAccessory_1 = require("./rainAccessory");
const geo_1 = require("./util/geo");
const provider_1 = require("./providers/provider");
const version_1 = require("./version");
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 15 * 60;
class RainSwitchPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.accessories = new Map();
        this.cachedAccessories = new Map();
        this.providerChain = null;
        this.location = null;
        this.pollingTimer = null;
        this.lastWeather = null;
        this.config = (config ?? {});
        const intervalSeconds = clamp(this.config.polling?.intervalSeconds ?? 180, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS);
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
    configureAccessory(accessory) {
        this.log.info('Loading cached accessory %s', accessory.displayName);
        this.cachedAccessories.set(accessory.UUID, accessory);
    }
    async getForecast(lookaheadMinutes) {
        if (!this.providerChain) {
            throw new Error('Provider chain not ready');
        }
        return this.providerChain.getForecast(lookaheadMinutes);
    }
    isWithinQuietHours(now) {
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
    debug(message, ...params) {
        if (this.debugEnabled) {
            this.log.debug(message, ...params);
        }
    }
    getHysteresisConfig() {
        return { minOnMs: this.minOnMs, minOffMs: this.minOffMs };
    }
    getOverrideMinutes() {
        return this.overrideMinutes;
    }
    getLastWeather() {
        return this.lastWeather;
    }
    async handleDidFinishLaunching() {
        try {
            this.location = await (0, geo_1.resolveLocation)(this.log, this.config.location);
            if (!this.location) {
                this.log.warn('Unable to determine location; provider selection may fail');
            }
            this.providerChain = (0, provider_1.makeProviderChain)(this.log, this.config.provider, this.location, {
                timeoutMs: this.timeoutMs,
                cacheTtlSeconds: this.cacheTtlSeconds,
                retryBackoffSeconds: this.retryBackoffSeconds,
            });
            this.log.info('Using providers: %s', this.providerChain.describe());
        }
        catch (error) {
            this.log.error('Failed to initialise providers: %s', error.message);
            return;
        }
        await this.setupAccessories();
        this.startPolling();
    }
    async setupAccessories() {
        const configured = new Map();
        for (const acc of this.config.accessories ?? []) {
            if (acc.enabled === false) {
                continue;
            }
            configured.set(this.generateUuid(acc), acc);
        }
        for (const [uuid, accessory] of this.cachedAccessories.entries()) {
            if (!configured.has(uuid)) {
                this.log.info('Removing stale accessory %s', accessory.displayName);
                this.api.unregisterPlatformAccessories(version_1.PLUGIN_NAME, version_1.PLATFORM_NAME, [accessory]);
                this.cachedAccessories.delete(uuid);
            }
        }
        for (const [uuid, accConfig] of configured.entries()) {
            let accessory = this.cachedAccessories.get(uuid);
            if (!accessory) {
                accessory = new this.api.platformAccessory(accConfig.name, uuid);
                accessory.context.type = accConfig.type;
                this.api.registerPlatformAccessories(version_1.PLUGIN_NAME, version_1.PLATFORM_NAME, [accessory]);
                this.log.info('Registered new accessory %s', accConfig.name);
            }
            accessory.displayName = accConfig.name;
            accessory.context.config = accConfig;
            const rainAccessory = new rainAccessory_1.RainAccessory(this, accessory, accConfig);
            this.accessories.set(uuid, rainAccessory);
        }
    }
    startPolling() {
        if (!this.providerChain) {
            return;
        }
        this.debug('Starting polling loop every %d seconds', this.intervalMs / 1000);
        const tick = async () => {
            try {
                const weather = await this.providerChain.getNowcast();
                this.lastWeather = weather;
                for (const accessory of this.accessories.values()) {
                    await accessory.evaluate(weather);
                }
            }
            catch (error) {
                this.log.warn('Weather polling failed: %s', error.message);
                this.providerChain?.markFailure();
                for (const accessory of this.accessories.values()) {
                    accessory.markFault();
                }
            }
        };
        void tick();
        this.pollingTimer = setInterval(() => {
            void tick();
        }, this.intervalMs);
    }
    generateUuid(config) {
        return this.api.hap.uuid.generate(`${this.config.name}:${config.type}:${config.name}`);
    }
}
exports.RainSwitchPlatform = RainSwitchPlatform;
const clamp = (value, min, max) => {
    return Math.min(max, Math.max(min, value));
};
const parseQuietHours = (quietHours) => {
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
const parseTimeString = (value) => {
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
//# sourceMappingURL=platform.js.map