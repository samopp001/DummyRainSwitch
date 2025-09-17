// Minimal module declarations to satisfy TypeScript compilation in offline environments.
declare module 'homebridge' {
  export type LogMethod = (...args: unknown[]) => void;

  export interface Logger {
    info: LogMethod;
    warn: LogMethod;
    error: LogMethod;
    debug: LogMethod;
  }

  export interface Characteristic {
    updateValue(value: unknown): Characteristic;
    onSet(handler: (value: unknown) => void | Promise<void>): Characteristic;
    onGet(handler: () => unknown): Characteristic;
  }

  export type CharacteristicConstructor = new (...args: unknown[]) => Characteristic;

  export interface CharacteristicStatic extends CharacteristicConstructor {
    readonly Name: Characteristic;
    readonly On: Characteristic;
    readonly StatusFault: Characteristic & {
      readonly NO_FAULT: number;
      readonly GENERAL_FAULT: number;
    };
  }

  export interface Service {
    setCharacteristic(characteristic: unknown, value: unknown): Service;
    updateCharacteristic(characteristic: unknown, value: unknown): Service;
    getCharacteristic(characteristic: CharacteristicConstructor | CharacteristicStatic): Characteristic;
    addCharacteristic(characteristic: CharacteristicConstructor | CharacteristicStatic): Characteristic;
    testCharacteristic(characteristic: CharacteristicConstructor | CharacteristicStatic): boolean;
  }

  export type ServiceConstructor = new (...args: unknown[]) => Service;

  export interface ServiceNamespace {
    readonly Switch: ServiceConstructor;
    [key: string]: ServiceConstructor;
  }

  export interface HapNamespace {
    readonly Characteristic: CharacteristicStatic;
    readonly Service: ServiceNamespace;
    readonly Formats: {
      readonly STRING: string;
      readonly FLOAT: string;
    };
    readonly Perms: {
      readonly READ: string;
      readonly NOTIFY: string;
    };
    readonly uuid: {
      generate(value: string): string;
    };
  }

  export interface PlatformAccessory {
    UUID: string;
    displayName: string;
    context: Record<string, unknown>;
    getService(service: ServiceConstructor): Service | undefined;
    addService(service: ServiceConstructor, name?: string): Service;
  }

  export type PlatformConfig = Record<string, unknown>;

  export interface DynamicPlatformPlugin {
    configureAccessory(accessory: PlatformAccessory): void;
  }

  export interface API {
    hap: HapNamespace;
    platformAccessory: new (name: string, uuid: string) => PlatformAccessory;
    registerPlatformAccessories(pluginName: string, platformName: string, accessories: PlatformAccessory[]): void;
    unregisterPlatformAccessories(pluginName: string, platformName: string, accessories: PlatformAccessory[]): void;
    registerPlatform(pluginName: string, platformName: string, constructor: new (...args: unknown[]) => DynamicPlatformPlugin): void;
    on(event: string, callback: () => void): void;
    user: {
      storagePath(): string;
    };
  }
}

declare module 'undici' {
  export interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    bodyTimeout?: number;
    headersTimeout?: number;
  }

  export interface RequestResult {
    statusCode: number;
    body: { text(): Promise<string> };
  }

  export function request(url: string, options?: RequestOptions): Promise<RequestResult>;
}

declare module 'jose' {
  export class SignJWT {
    constructor(payload: unknown);
    setProtectedHeader(header: Record<string, unknown>): this;
    setIssuer(issuer: string): this;
    setIssuedAt(iat?: number): this;
    setExpirationTime(expiration: number | string): this;
    sign(key: unknown): Promise<string>;
  }

  export function importPKCS8(key: string, alg: string): Promise<unknown>;
}

declare module 'fs/promises' {
  export function readFile(path: string, options?: { encoding?: string } | string): Promise<string>;
  export function writeFile(path: string, data: string, options?: { encoding?: string } | string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

declare module 'fs' {
  export function existsSync(path: string): boolean;
}

declare module 'os' {
  export function homedir(): string;
}

declare module 'path' {
  export function join(...segments: string[]): string;
  export function dirname(path: string): string;
  const path: { join: typeof join; dirname: typeof dirname };
  export default path;
}
