# Homebridge Rain Switch

Homebridge platform plugin that exposes virtual switches representing real-time and imminent precipitation so you can orchestrate automations for sprinklers, windows, fans, and more.

## Features

- **Rain Now switch** – turns ON when measured precipitation intensity meets the configured threshold.
- **Rain Soon switch** – watches short-term forecast probability and intensity to flip ON before it starts raining.
- **Snow Mode** – optional switch that mirrors the logic for snow events.
- **Provider chaining with automatic fallback** – query Apple WeatherKit, OpenWeatherMap, NOAA/NWS, and Tomorrow.io in priority order until one succeeds.
- **Hysteresis & debounce** – configurable minimum ON/OFF durations prevent rapid flapping.
- **Manual overrides** – optionally hold a manual switch toggle for a configurable number of minutes.
- **Quiet hours** – pause automatic state changes during specific times of day.
- **Diagnostic characteristics** – extra metadata such as last update time, provider name, precipitation intensity, and probability (visible in apps like Eve).

## Installation

```bash
npm install -g homebridge-rain-switch
```

Or clone this repository and build locally:

```bash
git clone https://example.com/DummyRainSwitch.git
cd DummyRainSwitch
npm install
npm run build
npm pack
sudo npm install -g ./homebridge-rain-switch-*.tgz
```

> **Note:** In restricted environments without npm registry access, the included TypeScript stubs (`src/shims.d.ts`) allow the code to compile, but installing the real dependencies (`homebridge`, `undici`, `jose`, and `@types/node`) is still required when deploying the plugin.

## Configuration

Add the platform block to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "RainSwitchPlatform",
      "name": "Rain Switch",
      "location": { "lat": 40.786, "lon": -73.976 },
      "provider": {
        "mode": "auto",
        "weatherkit": {
          "teamId": "ABCD1234",
          "keyId": "XYZ12345",
          "privateKey": "/var/homebridge/AuthKey_XYZ12345.p8"
        },
        "openweathermap": { "apiKey": "YOUR_OWM_KEY" },
        "tomorrow": { "apiKey": "YOUR_TOMORROW_KEY" },
        "nws": { "enabled": true }
      },
      "polling": {
        "intervalSeconds": 180,
        "minOnDurationSeconds": 300,
        "minOffDurationSeconds": 300,
        "timeoutMs": 5000
      },
      "accessories": [
        {
          "type": "rain-now",
          "name": "Rain Now",
          "thresholdMmPerHr": 0.05
        },
        {
          "type": "rain-soon",
          "name": "Rain In 60m",
          "lookaheadMinutes": 60,
          "popThreshold": 40,
          "intensityThresholdMmPerHr": 0.2
        }
      ],
      "advanced": {
        "logLevel": "info",
        "cacheTtlSeconds": 60,
        "retryBackoffSeconds": [30, 60, 120, 300],
        "overrideMinutes": 30,
        "quietHours": { "start": "23:00", "end": "07:00" }
      }
    }
  ]
}
```

### Key options

- `provider.mode`: `auto` (default) tries WeatherKit → OpenWeatherMap → NWS → Tomorrow.io. Set to a specific provider to pin behaviour.
- `polling.intervalSeconds`: clamped between 60 and 900 seconds. Defaults to 180 seconds.
- `thresholdMmPerHr`: precipitation intensity threshold for the switch.
- `popThreshold` / `intensityThresholdMmPerHr`: forecast trigger thresholds for the “soon” switches.
- `overrideMinutes`: when set, a manual toggle locks the state for the specified duration.
- `quietHours`: prevent automatic changes between the defined start and end times (local clock).

## Development

- Build the TypeScript sources: `tsc -p tsconfig.json`
- Lint the project (optional): `npm run lint`
- The compiled JavaScript lands in `dist/` and is what Homebridge loads.

A lightweight location resolver caches results in the user’s home directory to avoid repeated geocoding lookups. Provider failures trigger exponential backoff (default 30 → 60 → 120 → 300 seconds) while keeping the last known switch state and raising the HomeKit `StatusFault` characteristic.

## License

MIT © 2024 DummyRainSwitch Maintainers
