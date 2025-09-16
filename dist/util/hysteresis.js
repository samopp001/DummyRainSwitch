"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeHysteresis = void 0;
const makeHysteresis = ({ minOnMs, minOffMs }) => {
    let state = false;
    let lastFlip = 0;
    const clamp = (value) => {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, value);
    };
    const minOn = clamp(minOnMs);
    const minOff = clamp(minOffMs);
    return {
        next(desired, now) {
            if (!lastFlip) {
                lastFlip = now;
                state = desired;
                return state;
            }
            if (desired === state) {
                return state;
            }
            const elapsed = now - lastFlip;
            const gate = state ? minOn : minOff;
            if (elapsed >= gate) {
                state = desired;
                lastFlip = now;
            }
            return state;
        },
        reset(initial = false) {
            state = initial;
            lastFlip = 0;
        },
        getState() {
            return state;
        },
    };
};
exports.makeHysteresis = makeHysteresis;
//# sourceMappingURL=hysteresis.js.map