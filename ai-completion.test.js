"use strict";

// Full-board completion benchmarks, split from ai-quality.test.js: each seed
// plays tens of thousands of Autopilot moves, so the seeds run concurrently
// in worker threads.

const assert = require("node:assert/strict");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

if (!isMainThread) {
  const { simulateSolo } = require("./test-support/ai-simulation.cjs");
  parentPort.postMessage(simulateSolo(workerData.code, workerData.mode, 120_000));
} else {
  const simulate = (code, mode) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { code, mode } });
    worker.once("message", resolve);
    worker.once("error", reject);
  });

  (async () => {
    const classicSeeds = ["KXBP3F", "8RATCV", "F8ZUNJ"];
    const [portal, ...classic] = await Promise.all([
      // NEON22 used to settle into an exact 182-step tail loop at length 181:
      // the safety cycle was Classic-only and the stagnation window cannot see
      // loops that long. The serpentine cycle is equally valid when edges wrap.
      simulate("NEON22", "portal"),
      ...classicSeeds.map((code) => simulate(code, "classic")),
    ]);

    classic.forEach((run) => {
      assert.equal(run.outcome, "clear", JSON.stringify(run));
      assert.equal(run.length, 400, JSON.stringify(run));
      assert.equal(run.foods, 397, JSON.stringify(run));
      assert.ok(run.maxObjectiveGap <= 400, JSON.stringify(run));
      assert.ok(run.maxCaptureGap <= 500, JSON.stringify(run));
    });
    process.stdout.write(
      `Classic completion: objective age ${Math.max(...classic.map((run) => run.maxObjectiveGap))}, `
      + `capture gap ${Math.min(...classic.map((run) => run.maxCaptureGap))}-`
      + `${Math.max(...classic.map((run) => run.maxCaptureGap))}, `
      + `expired cores ${classic.map((run) => run.coresExpired).join("/")}\n`,
    );
    process.stdout.write("PASS Classic Autopilot completes the entire 20 by 20 board across seeded maps\n");

    assert.equal(portal.outcome, "clear", JSON.stringify(portal));
    assert.equal(portal.length, 400, JSON.stringify(portal));
    assert.ok(portal.maxCaptureGap <= 500, JSON.stringify(portal));
    process.stdout.write("PASS Portal Autopilot completes the board instead of circling its tail\n");

    process.stdout.write("\n2 Autopilot completion benchmarks passed.\n");
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
