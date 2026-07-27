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

assert.equal(DEFAULT_THRESHOLD, 5);
assert.equal(directionFromDelta(4, 0), "");
assert.equal(directionFromDelta(5, 1), "right");
assert.equal(directionFromDelta(-12, 2), "left");
assert.equal(directionFromDelta(1, -11), "up");
assert.equal(directionFromDelta(2, 13), "down");
process.stdout.write("PASS mobile swipes commit after five CSS pixels in every direction\n");

const surface = eventTarget();
const directions = [];
bindSwipe(surface, (direction) => directions.push(direction));
surface.emit("touchstart", { touches: [{ clientX: 100, clientY: 100 }] });
let prevented = 0;
surface.emit("touchmove", {
  touches: [{ clientX: 112, clientY: 101 }],
  preventDefault() { prevented += 1; },
});
surface.emit("touchmove", {
  touches: [{ clientX: 112, clientY: 88 }],
  preventDefault() { prevented += 1; },
});
assert.deepEqual(directions, ["right", "up"]);
assert.equal(prevented, 2);
assert.equal(surface.listener("touchmove").options.passive, false);
process.stdout.write("PASS board swipes react during movement and accept chained turns\n");

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
