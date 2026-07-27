(function exposeTouchControls(root) {
  "use strict";

  const DEFAULT_THRESHOLD = 10;

  function directionFromDelta(dx, dy, threshold = DEFAULT_THRESHOLD) {
    const horizontal = Math.abs(Number(dx) || 0);
    const vertical = Math.abs(Number(dy) || 0);
    const minimum = Math.max(4, Number(threshold) || DEFAULT_THRESHOLD);
    if (Math.max(horizontal, vertical) < minimum) return "";
    if (horizontal > vertical) return dx > 0 ? "right" : "left";
    return dy > 0 ? "down" : "up";
  }

  function bindSwipe(element, onDirection, {
    threshold = DEFAULT_THRESHOLD,
  } = {}) {
    if (!element || typeof element.addEventListener !== "function") {
      throw new TypeError("A swipe surface is required.");
    }
    if (typeof onDirection !== "function") {
      throw new TypeError("A direction callback is required.");
    }

    let anchor = null;
    let committed = false;

    function point(touch) {
      return touch ? { x: Number(touch.clientX), y: Number(touch.clientY) } : null;
    }

    function start(event) {
      anchor = point(event.touches?.[0] || event.changedTouches?.[0]);
      committed = false;
    }

    function move(event) {
      const current = point(event.touches?.[0] || event.changedTouches?.[0]);
      if (!anchor || !current) return;
      const direction = directionFromDelta(
        current.x - anchor.x,
        current.y - anchor.y,
        threshold,
      );
      if (!direction) return;
      event.preventDefault();
      onDirection(direction);
      anchor = current;
      committed = true;
    }

    function end(event) {
      const current = point(event.changedTouches?.[0]);
      if (!committed && anchor && current) {
        const direction = directionFromDelta(
          current.x - anchor.x,
          current.y - anchor.y,
          threshold,
        );
        if (direction) onDirection(direction);
      }
      anchor = null;
      committed = false;
    }

    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: true });
    element.addEventListener("touchcancel", end, { passive: true });

    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
    };
  }

  function bindDirectionButtons(container, selector, onDirection) {
    if (!container || typeof container.querySelectorAll !== "function") {
      throw new TypeError("A direction-button container is required.");
    }
    if (typeof onDirection !== "function") {
      throw new TypeError("A direction callback is required.");
    }

    const bindings = [];
    container.querySelectorAll(selector).forEach((button) => {
      let touchHandled = false;
      const direction = button.dataset.direction || button.dataset.duelDirection;
      const handleTouch = (event) => {
        event.preventDefault();
        touchHandled = true;
        onDirection(direction);
      };
      const handleClick = () => {
        if (touchHandled) {
          touchHandled = false;
          return;
        }
        onDirection(direction);
      };
      button.addEventListener("touchstart", handleTouch, { passive: false });
      button.addEventListener("click", handleClick);
      bindings.push([button, handleTouch, handleClick]);
    });

    return () => bindings.forEach(([button, handleTouch, handleClick]) => {
      button.removeEventListener("touchstart", handleTouch);
      button.removeEventListener("click", handleClick);
    });
  }

  const api = {
    DEFAULT_THRESHOLD,
    directionFromDelta,
    bindSwipe,
    bindDirectionButtons,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  root.NeonSnakeTouchControls = api;
})(typeof globalThis === "object" ? globalThis : this);
