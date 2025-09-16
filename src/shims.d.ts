// Minimal module declarations to satisfy TypeScript compilation in offline environments.
declare module 'homebridge' {
  export type Logger = {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
  };

  export type Characteristic = any;
  export type Service = {
    setCharacteristic(...args: any[]): Service;
    updateCharacteristic(...args: any[]): Service;
    getCharacteristic(...args: any[]): Characteristic;
    addCharacteristic(...args: any[]): Characteristic;
    testCharacteristic(...args: any[]): boolean;
  };

  export interface PlatformAccessory {
    UUID: string;
    displayName: string;
    context: Record<string, any>;
    getService(service: any): Service | undefined;
    addService(service: any, name?: string): Service;
  }

  export type PlatformConfig = Record<string, any>;

  export interface DynamicPlatformPlugin {
    configureAccessory(accessory: PlatformAccessory): void;
  }

  export interface API {
    hap: any;
    platformAccessory: new (name: string, uuid: string) => PlatformAccessory;
    registerPlatformAccessories(pluginName: string, platformName: string, accessories: PlatformAccessory[]): void;
    unregisterPlatformAccessories(pluginName: string, platformName: string, accessories: PlatformAccessory[]): void;
    registerPlatform(pluginName: string, platformName: string, constructor: any): void;
    on(event: string, callback: () => void): void;
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
    constructor(payload: any);
    setProtectedHeader(header: any): this;
    setIssuer(issuer: string): this;
    setIssuedAt(iat?: number): this;
    setExpirationTime(expiration: number | string): this;
    sign(key: any): Promise<string>;
  }

  export function importPKCS8(key: string, alg: string): Promise<any>;
}

declare module 'fs/promises' {
  export function readFile(path: string, options?: any): Promise<string>;
  export function writeFile(path: string, data: string, options?: any): Promise<void>;
}

declare module 'fs' {
  export function existsSync(path: string): boolean;
}

declare module 'os' {
  export function homedir(): string;
}

declare module 'path' {
  export function join(...segments: string[]): string;
  const path: { join: typeof join };
  export default path;
}
