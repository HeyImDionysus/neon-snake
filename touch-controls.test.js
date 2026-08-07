"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULT_THRESHOLD,
  directionFromDelta,
  bindSwipe,
  bindDirectionButtons,
} = require("./public/touch-controls.js");

function eventTarget() {
  const listeners = new Map();
  return {
    dataset: {},
    addEventListener(type, listener, options) {
      listeners.set(type, { listener, options });
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    emit(type, event = {}) {
      listeners.get(type)?.listener(event);
    },
    listener(type) {
      return listeners.get(type);
    },
  };
}

assert.equal(DEFAULT_THRESHOLD, 20);
assert.equal(directionFromDelta(19, 0), "");
assert.equal(directionFromDelta(20, 1), "right");
assert.equal(directionFromDelta(-20, 2), "left");
assert.equal(directionFromDelta(1, -20), "up");
assert.equal(directionFromDelta(2, 20), "down");
process.stdout.write("PASS mobile swipes commit after twenty CSS pixels in every direction\n");

const surface = eventTarget();
const directions = [];
bindSwipe(surface, (direction) => directions.push(direction));
surface.emit("touchstart", { touches: [{ clientX: 100, clientY: 100 }] });
let prevented = 0;
surface.emit("touchmove", {
  touches: [{ clientX: 125, clientY: 101 }],
  preventDefault() { prevented += 1; },
});
surface.emit("touchmove", {
  touches: [{ clientX: 125, clientY: 125 }],
  preventDefault() { prevented += 1; },
});
assert.deepEqual(directions, ["right", "down"]);
assert.equal(prevented, 2);
assert.equal(surface.listener("touchmove").options.passive, false);
process.stdout.write("PASS board swipes accept chained turns during one continuous drag\n");

const button = eventTarget();
button.dataset.direction = "left";
const container = { querySelectorAll: () => [button] };
const buttonDirections = [];
bindDirectionButtons(container, "[data-direction]", (direction) => buttonDirections.push(direction));
let buttonPrevented = false;
button.emit("touchstart", { preventDefault() { buttonPrevented = true; } });
button.emit("click");
button.emit("click");
assert.equal(buttonPrevented, true);
assert.deepEqual(buttonDirections, ["left", "left"]);
assert.equal(button.listener("touchstart").options.passive, false);
process.stdout.write("PASS direction pads react on touch-down without duplicating the synthetic click\n");
