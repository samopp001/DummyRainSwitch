"use strict";
const platform_1 = require("./platform");
const version_1 = require("./version");
module.exports = (api) => {
    api.registerPlatform(version_1.PLUGIN_NAME, version_1.PLATFORM_NAME, platform_1.RainSwitchPlatform);
};
//# sourceMappingURL=index.js.map