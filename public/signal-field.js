(function exposeSignalField(root) {
  "use strict";

  const TAU = Math.PI * 2;
  const FRAME_INTERVAL = 1000 / 24;
  const COMPACT_FRAME_INTERVAL = 1000 / 15;
  const PALETTES = {
    classic: ["#aaff67", "#59f0bd", "#d8ff9d"],
    portal: ["#8d7bff", "#62e8ff", "#c7baff"],
    rush: ["#ffcf67", "#ff7657", "#b8ff6a"],
    canvas: ["#65ecff", "#a98bff", "#adff66"],
    ai: ["#77f7d0", "#8ca3ff", "#adff66"],
    live: ["#adff66", "#a98bff", "#ffd166"],
  };

  function hashSignal(value) {
    let hash = 2166136261;
    const input = String(value || "NEON-SNAKE");
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function normalizedMode(mode) {
    const value = String(mode || "classic").toLowerCase();
    if (value === "live") return "live";
    if (value === "ai") return "ai";
    return Object.hasOwn(PALETTES, value) ? value : "classic";
  }

  function createFieldSpec(signal, mode, width, height) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const identity = normalizedMode(mode);
    const seed = hashSignal(`${String(signal || "NEON-SNAKE")}:${identity}`);
    const random = randomGenerator(seed);
    const attractors = Array.from({ length: 3 }, (_, index) => ({
      x: safeWidth * (.12 + random() * .76),
      y: safeHeight * (.12 + random() * .76),
      radius: Math.min(safeWidth, safeHeight) * (.11 + random() * .14),
      phase: random() * TAU + index,
      stretch: .72 + random() * .8,
    }));
    return {
      seed,
      mode: identity,
      palette: PALETTES[identity],
      currents: 7 + Math.floor(random() * 6),
      nodes: 14 + Math.floor(random() * 9),
      attractors,
    };
  }

  function initialize() {
    if (!root.document) return null;
    const canvas = root.document.getElementById("signalField");
    if (!canvas || typeof canvas.getContext !== "function") return null;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return null;

    const motionQuery = root.matchMedia?.("(prefers-reduced-motion: reduce)");
    const activityQuery = new URL(root.location.href).searchParams;
    const activityMode = activityQuery.has("frame_id");
    let reduceMotion = Boolean(motionQuery?.matches) || activityMode;
    const signalElement = root.document.getElementById("signalCode");
    const roomElement = root.document.getElementById("roomCodeInput");
    let width = 1;
    let height = 1;
    let pixelRatio = 1;
    let field = createFieldSpec("NEON-SNAKE", "classic", width, height);
    let frame = 0;
    let lastFrame = -FRAME_INTERVAL;
    let pointerX = .5;
    let pointerY = .5;
    let compact = false;

    function currentSignal() {
      const fromControl = signalElement?.textContent || roomElement?.value;
      if (fromControl && !fromControl.includes("-")) return fromControl.trim();
      return new URL(root.location.href).searchParams.get("signal")
        || new URL(root.location.href).searchParams.get("room")
        || "NEON-SNAKE";
    }

    function currentMode() {
      return root.document.body.dataset.mode
        || root.document.body.dataset.duelType
        || "classic";
    }

    function refreshField() {
      field = createFieldSpec(currentSignal(), currentMode(), width, height);
      if (reduceMotion) draw(0);
    }

    function resize() {
      width = Math.max(1, root.innerWidth);
      height = Math.max(1, root.innerHeight);
      compact = width <= 820 || Boolean(root.matchMedia?.("(pointer: coarse)")?.matches);
      pixelRatio = compact ? 1 : Math.min(1.5, root.devicePixelRatio || 1);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      refreshField();
    }

    function drawContours(time) {
      field.attractors.forEach((attractor, attractorIndex) => {
        const ringCount = compact ? 3 : 5;
        const stepCount = compact ? 36 : 64;
        for (let ring = 0; ring < ringCount; ring += 1) {
          const radius = attractor.radius * (.55 + ring * .26);
          context.beginPath();
          for (let step = 0; step <= stepCount; step += 1) {
            const angle = step / stepCount * TAU;
            const ripple = Math.sin(angle * (3 + attractorIndex) + time * .17 + attractor.phase)
              * radius * .045;
            const driftX = (pointerX - .5) * (5 + attractorIndex * 2);
            const driftY = (pointerY - .5) * (5 + attractorIndex * 2);
            const x = attractor.x + driftX + Math.cos(angle) * (radius + ripple) * attractor.stretch;
            const y = attractor.y + driftY + Math.sin(angle) * (radius + ripple);
            if (step === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.closePath();
          context.strokeStyle = `${field.palette[(ring + attractorIndex) % 3]}${ring === 0 ? "24" : "13"}`;
          context.lineWidth = ring === 0 ? 1.1 : .65;
          context.stroke();
        }
      });
    }

    function drawCurrents(time) {
      const currentCount = compact ? Math.min(7, field.currents) : field.currents;
      const stepCount = compact ? 28 : 42;
      for (let line = 0; line < currentCount; line += 1) {
        const vertical = (line + 1) / (currentCount + 1);
        const phase = (field.seed % 997) * .001 + line * .83;
        context.beginPath();
        for (let step = 0; step <= stepCount; step += 1) {
          const progress = step / stepCount;
          const wave = Math.sin(progress * TAU * 1.25 + phase + time * .12)
            + Math.sin(progress * TAU * 2.7 - phase + time * .07) * .33;
          const x = progress * width + (pointerX - .5) * 12;
          const y = vertical * height + wave * (18 + line % 3 * 7) + (pointerY - .5) * 8;
          if (step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = `${field.palette[line % 3]}${line % 4 === 0 ? "20" : "0e"}`;
        context.lineWidth = line % 4 === 0 ? 1.05 : .6;
        context.stroke();
      }
    }

    function drawNodes(time) {
      const random = randomGenerator(field.seed ^ 0xa5a5a5a5);
      const nodeCount = compact ? Math.min(12, field.nodes) : field.nodes;
      for (let index = 0; index < nodeCount; index += 1) {
        const originX = random() * width;
        const originY = random() * height;
        const orbit = 5 + random() * 18;
        const speed = .06 + random() * .1;
        const phase = random() * TAU;
        const x = originX + Math.cos(time * speed + phase) * orbit;
        const y = originY + Math.sin(time * speed * 1.3 + phase) * orbit;
        const radius = index % 7 === 0 ? 1.8 : .75;
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fillStyle = `${field.palette[index % 3]}${index % 7 === 0 ? "8c" : "42"}`;
        context.fill();
        if (index % 7 === 0) {
          context.beginPath();
          context.arc(x, y, 7, 0, TAU);
          context.strokeStyle = `${field.palette[index % 3]}18`;
          context.stroke();
        }
      }
    }

    function draw(timestamp) {
      const time = reduceMotion ? 0 : timestamp / 1000;
      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = "lighter";
      drawCurrents(time);
      drawContours(time);
      drawNodes(time);
      context.restore();
    }

    function animate(timestamp) {
      if (root.document.hidden) {
        frame = 0;
        return;
      }
      const interval = compact ? COMPACT_FRAME_INTERVAL : FRAME_INTERVAL;
      if (timestamp - lastFrame >= interval) {
        lastFrame = timestamp;
        draw(timestamp);
      }
      frame = root.requestAnimationFrame(animate);
    }

    function handleVisibility() {
      if (root.document.hidden) {
        root.cancelAnimationFrame?.(frame);
        frame = 0;
        return;
      }
      if (!reduceMotion && !frame) {
        lastFrame = -(compact ? COMPACT_FRAME_INTERVAL : FRAME_INTERVAL);
        frame = root.requestAnimationFrame(animate);
      }
    }

    function handleMotionPreference(event) {
      reduceMotion = Boolean(event.matches) || activityMode;
      if (reduceMotion) {
        root.cancelAnimationFrame?.(frame);
        frame = 0;
        draw(0);
        return;
      }
      if (!frame) {
        lastFrame = -FRAME_INTERVAL;
        frame = root.requestAnimationFrame(animate);
      }
    }

    function handlePointerMove(event) {
      pointerX = event.clientX / Math.max(1, width);
      pointerY = event.clientY / Math.max(1, height);
    }

    const observer = new MutationObserver(refreshField);
    observer.observe(root.document.body, {
      attributes: true,
      attributeFilter: ["data-mode", "data-duel-type"],
    });
    if (signalElement) observer.observe(signalElement, { childList: true, characterData: true, subtree: true });
    roomElement?.addEventListener("input", refreshField);
    root.addEventListener("resize", resize, { passive: true });
    if (!activityMode) root.addEventListener("pointermove", handlePointerMove, { passive: true });
    root.document.addEventListener("visibilitychange", handleVisibility);
    motionQuery?.addEventListener("change", handleMotionPreference);

    resize();
    canvas.dataset.visualReady = "true";
    if (!reduceMotion && !root.document.hidden) frame = root.requestAnimationFrame(animate);

    return {
      destroy() {
        observer.disconnect();
        root.cancelAnimationFrame?.(frame);
        roomElement?.removeEventListener("input", refreshField);
        root.removeEventListener("resize", resize);
        if (!activityMode) root.removeEventListener("pointermove", handlePointerMove);
        root.document.removeEventListener("visibilitychange", handleVisibility);
        motionQuery?.removeEventListener("change", handleMotionPreference);
      },
      refresh: refreshField,
    };
  }

  const api = {
    createFieldSpec,
    hashSignal,
    initialize,
  };

  root.NeonSignalField = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
      initialize();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
