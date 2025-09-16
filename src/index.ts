import { API } from 'homebridge';
import { RainSwitchPlatform } from './platform';
import { PLUGIN_NAME, PLATFORM_NAME } from './version';

export = (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, RainSwitchPlatform);
};
