import type { Characteristic, PlatformAccessory, Service } from 'homebridge';
import type { RainAccessoryConfig, WeatherNowcast, WeatherForecastSlice } from './types';
import { makeHysteresis, type HysteresisState } from './util/hysteresis';
import type { RainSwitchPlatform } from './platform';

interface AccessoryMetadata {
  lastUpdate: number;
  providerName: string;
  precipMmHr: number;
  probability?: number;
}

interface ForecastResult {
  triggeredSlice?: WeatherForecastSlice | null;
  shouldActivate: boolean;
}

export class RainAccessory {
  public readonly accessory: PlatformAccessory;
  private readonly switchService: Service;
  private readonly hysteresis: HysteresisState;
  private readonly customCharacteristics = ensureCustomCharacteristics(this.platform);
  private readonly overrideMinutes?: number;
  private readonly metadataCharacteristics: Partial<Record<keyof CustomCharacteristicSet, Characteristic>> = {};

  private currentState = false;
  private overrideState: boolean | null = null;
  private overrideUntil = 0;
  private faulted = false;
  private metadata: AccessoryMetadata = {
    lastUpdate: 0,
    providerName: '',
    precipMmHr: 0,
  };

  constructor(
    private readonly platform: RainSwitchPlatform,
    accessory: PlatformAccessory,
    private readonly config: RainAccessoryConfig,
  ) {
    this.accessory = accessory;
    this.overrideMinutes = platform.getOverrideMinutes();

    this.switchService = this.accessory.getService(this.platform.Service.Switch)
      ?? this.accessory.addService(this.platform.Service.Switch, config.name);

    this.switchService.setCharacteristic(this.platform.Characteristic.Name, config.name);
    this.switchService.updateCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

    this.switchService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.handleSetOn.bind(this))
      .onGet(() => this.currentState);

    this.hysteresis = makeHysteresis(this.platform.getHysteresisConfig());

    this.ensureOptionalCharacteristic('lastUpdate');
    this.ensureOptionalCharacteristic('providerName');
    this.ensureOptionalCharacteristic('precipIntensity');
    this.ensureOptionalCharacteristic('probability');
  }

  async evaluate(weather: WeatherNowcast): Promise<void> {
    const now = Date.now();
    const quiet = this.platform.isWithinQuietHours(now);

    this.metadata = {
      lastUpdate: now,
      providerName: weather.providerName,
      precipMmHr: weather.precipMmHr,
      probability: weather.pop,
    };

    if (this.overrideUntil && now < this.overrideUntil && this.overrideState !== null) {
      this.platform.debug('%s is in manual override until %s', this.config.name, new Date(this.overrideUntil).toISOString());
      this.updateState(this.overrideState, false);
      this.publishMetadata(weather, null);
      this.clearFault();
      return;
    }

    if (this.overrideUntil && now >= this.overrideUntil) {
      this.platform.log.info('%s manual override expired', this.config.name);
      this.overrideUntil = 0;
      this.overrideState = null;
      this.hysteresis.reset(this.currentState);
    }

    let forecastOutcome: ForecastResult | null = null;
    let desired = false;

    if (this.config.type === 'rain-now') {
      desired = isRain(weather) && weather.precipMmHr >= (this.config.thresholdMmPerHr ?? DEFAULT_RAIN_THRESHOLD);
    } else if (this.config.type === 'rain-soon') {
      forecastOutcome = await this.evaluateForecast('rain');
      desired = forecastOutcome.shouldActivate;
    } else if (this.config.type === 'snow-mode') {
      const threshold = this.config.thresholdMmPerHr ?? DEFAULT_SNOW_THRESHOLD;
      const nowActive = weather.type === 'snow' && weather.precipMmHr >= threshold;
      forecastOutcome = await this.evaluateForecast('snow');
      desired = nowActive || forecastOutcome.shouldActivate;
    }

    if (quiet) {
      this.platform.debug('Quiet hours active for %s; keeping state %s', this.config.name, this.currentState ? 'ON' : 'OFF');
      this.publishMetadata(weather, forecastOutcome?.triggeredSlice ?? null);
      this.clearFault();
      return;
    }

    const nextState = this.hysteresis.next(desired, now);
    this.updateState(nextState, desired !== this.currentState);
    this.publishMetadata(weather, forecastOutcome?.triggeredSlice ?? null);
    this.clearFault();
  }

  markFault(): void {
    if (!this.faulted) {
      this.platform.log.warn('%s marking fault state', this.config.name);
      this.faulted = true;
    }
    this.switchService.updateCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.GENERAL_FAULT);
  }

  private async evaluateForecast(target: 'rain' | 'snow'): Promise<ForecastResult> {
    const lookahead = this.config.lookaheadMinutes ?? DEFAULT_LOOKAHEAD_MINUTES;
    const popThreshold = this.config.popThreshold ?? DEFAULT_POP_THRESHOLD;
    const intensityThreshold = this.config.intensityThresholdMmPerHr ?? DEFAULT_INTENSITY_THRESHOLD;
    const slices = await this.platform.getForecast(lookahead);
    let triggeredSlice: WeatherForecastSlice | null = null;
    let shouldActivate = false;
    for (const slice of slices) {
      if (slice.minutesFromNow < 0 || slice.minutesFromNow > lookahead) {
        continue;
      }
      const isMatch = target === 'rain'
        ? slice.type === 'rain'
        : slice.type === 'snow';
      if (!isMatch) {
        continue;
      }
      const pop = slice.pop ?? 0;
      if (pop < popThreshold) {
        continue;
      }
      if (slice.precipMmHr < intensityThreshold) {
        continue;
      }
      shouldActivate = true;
      triggeredSlice = slice;
      break;
    }
    return { shouldActivate, triggeredSlice };
  }

  private updateState(state: boolean, logChange: boolean): void {
    if (this.currentState === state) {
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, state);
      return;
    }
    this.currentState = state;
    if (logChange) {
      this.platform.log.info('%s -> %s', this.config.name, state ? 'ON' : 'OFF');
    }
    this.switchService.updateCharacteristic(this.platform.Characteristic.On, state);
  }

  private publishMetadata(weather: WeatherNowcast, slice: WeatherForecastSlice | null): void {
    const lastUpdate = this.metadataCharacteristics.lastUpdate;
    if (lastUpdate) {
      lastUpdate.updateValue(new Date(this.metadata.lastUpdate).toISOString());
    }
    const providerName = this.metadataCharacteristics.providerName;
    if (providerName) {
      providerName.updateValue(this.metadata.providerName || weather.providerName);
    }
    const precipIntensity = this.metadataCharacteristics.precipIntensity;
    if (precipIntensity) {
      precipIntensity.updateValue(Number((slice?.precipMmHr ?? weather.precipMmHr).toFixed(3)));
    }
    const probability = this.metadataCharacteristics.probability;
    if (probability) {
      const pop = slice?.pop ?? this.metadata.probability ?? null;
      probability.updateValue(pop ?? 0);
    }
  }

  private ensureOptionalCharacteristic(kind: keyof CustomCharacteristicSet): void {
    const char = this.customCharacteristics[kind];
    if (!char) {
      return;
    }
    const CharacteristicClass = char.CharacteristicClass;
    if (!this.switchService.testCharacteristic(CharacteristicClass as unknown as typeof this.platform.Characteristic)) {
      this.switchService.addCharacteristic(CharacteristicClass as unknown as typeof this.platform.Characteristic);
    }
    this.metadataCharacteristics[kind] = this.switchService.getCharacteristic(CharacteristicClass as unknown as typeof this.platform.Characteristic);
  }

  private clearFault(): void {
    if (this.faulted) {
      this.faulted = false;
      this.switchService.updateCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);
    } else {
      this.switchService.updateCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);
    }
  }

  private async handleSetOn(value: unknown): Promise<void> {
    const desired = value === true || value === 1;
    this.currentState = desired;
    this.switchService.updateCharacteristic(this.platform.Characteristic.On, desired);
    if (this.overrideMinutes && this.overrideMinutes > 0) {
      this.overrideState = desired;
      this.overrideUntil = Date.now() + this.overrideMinutes * 60_000;
      this.platform.log.info('%s manually set to %s for %d minutes', this.config.name, desired ? 'ON' : 'OFF', this.overrideMinutes);
      this.hysteresis.reset(desired);
    } else {
      this.hysteresis.reset(desired);
    }
  }
}

const DEFAULT_RAIN_THRESHOLD = 0.05;
const DEFAULT_SNOW_THRESHOLD = 0.05;
const DEFAULT_LOOKAHEAD_MINUTES = 60;
const DEFAULT_POP_THRESHOLD = 40;
const DEFAULT_INTENSITY_THRESHOLD = 0.2;

const isRain = (weather: WeatherNowcast): boolean => {
  return weather.type === 'rain' || weather.type === 'sleet';
};

type CharacteristicConstructor = new (...args: unknown[]) => Characteristic;

interface CustomCharacteristic {
  CharacteristicClass: CharacteristicConstructor;
}

interface CustomCharacteristicSet {
  lastUpdate?: CustomCharacteristic;
  providerName?: CustomCharacteristic;
  precipIntensity?: CustomCharacteristic;
  probability?: CustomCharacteristic;
}

const ensureCustomCharacteristics = (platform: RainSwitchPlatform): CustomCharacteristicSet => {
  const { api } = platform;
  if (!customCharacteristicRegistry) {
    const hap = api.hap;
    const uuid = api.hap.uuid;
    const LastUpdateUUID = uuid.generate('RainSwitch:lastUpdate');
    const ProviderUUID = uuid.generate('RainSwitch:provider');
    const IntensityUUID = uuid.generate('RainSwitch:precipIntensity');
    const ProbabilityUUID = uuid.generate('RainSwitch:probability');

    class LastUpdateCharacteristic extends hap.Characteristic {
      constructor() {
        super('Last Update', LastUpdateUUID, {
          format: hap.Formats.STRING,
          perms: [hap.Perms.READ, hap.Perms.NOTIFY],
          maxLen: 32,
        });
      }
    }

    class ProviderCharacteristic extends hap.Characteristic {
      constructor() {
        super('Weather Provider', ProviderUUID, {
          format: hap.Formats.STRING,
          perms: [hap.Perms.READ, hap.Perms.NOTIFY],
          maxLen: 64,
        });
      }
    }

    class IntensityCharacteristic extends hap.Characteristic {
      constructor() {
        super('Precip Intensity', IntensityUUID, {
          format: hap.Formats.FLOAT,
          perms: [hap.Perms.READ, hap.Perms.NOTIFY],
          minValue: 0,
          maxValue: 500,
          minStep: 0.01,
          unit: 'mm/h',
        });
      }
    }

    class ProbabilityCharacteristic extends hap.Characteristic {
      constructor() {
        super('Precip Probability', ProbabilityUUID, {
          format: hap.Formats.FLOAT,
          perms: [hap.Perms.READ, hap.Perms.NOTIFY],
          minValue: 0,
          maxValue: 100,
          minStep: 1,
          unit: 'percentage',
        });
      }
    }

    customCharacteristicRegistry = {
      lastUpdate: { CharacteristicClass: LastUpdateCharacteristic },
      providerName: { CharacteristicClass: ProviderCharacteristic },
      precipIntensity: { CharacteristicClass: IntensityCharacteristic },
      probability: { CharacteristicClass: ProbabilityCharacteristic },
    };
  }
  return customCharacteristicRegistry;
};

let customCharacteristicRegistry: CustomCharacteristicSet | null = null;
