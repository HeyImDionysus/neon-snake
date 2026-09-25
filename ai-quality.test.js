"use strict";

const assert = require("node:assert/strict");
const { CANVAS_BRUSH_LENGTH, DIRECTIONS, PACES, codeFromIndex, rules, simulateDuel, simulateSolo } = require("./test-support/ai-simulation.cjs");

const { rushDuration: RUSH_DURATION } = rules.soloTiming();

const tests = [
  ["the safety cycle covers every cell exactly once with legal joins", () => {
    const cycle = rules.hamiltonianCycle(20);
    assert.equal(cycle.length, 400);
    assert.equal(new Set(cycle.map((point) => `${point.x},${point.y}`)).size, 400);
    cycle.forEach((point, index) => {
      const next = cycle[(index + 1) % cycle.length];
      assert.equal(rules.gridDistance(point, next, "classic", 20), 1);
    });
    assert.deepEqual(rules.hamiltonianCycle(19), []);
  }],
  ["solo Autopilot takes a cycle-safe shortcut without surrendering the completion invariant", () => {
    const evaluations = rules.evaluateMoves({
      snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
      direction: { x: 1, y: 0 },
      food: { x: 10, y: 11 },
      mode: "classic",
      gridSize: 20,
      candidates: DIRECTIONS,
    });
    const selected = rules.chooseBestMove(evaluations);
    assert.equal(selected.name, "down");
    assert.equal(selected.strategy, "SAFE SHORTCUT");
    assert.equal(selected.cycleSafe, true);
    assert.deepEqual(rules.decisionInsight(evaluations, selected), {
      confidence: "ROUTE",
      reason: "SIGNAL CAPTURE · TAIL SAFE",
      margin: selected.score - evaluations.find((move) => move.name === "right").score,
      runnerUp: "right",
    });
  }],
  ["duel Autopilot rejects a food line the player can contest next tick", () => {
    const evaluations = rules.evaluateDuelMoves({
      snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }],
      direction: { x: 0, y: -1 },
      opponentSnake: [{ x: 5, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 3 }],
      opponentDirection: { x: 1, y: 0 },
      food: { x: 5, y: 0 },
      mode: "classic",
      gridSize: 12,
      candidates: DIRECTIONS,
    });
    const contested = evaluations.find((move) => move.name === "up");
    const selected = rules.chooseBestMove(evaluations);
    assert.equal(contested.strategy, "CONTESTED");
    assert.equal(contested.drawingReplies, 1);
    assert.notEqual(selected.name, "up");
    assert.equal(selected.drawingReplies, 0);
    assert.equal(selected.searchDepth, 2);
    assert.ok(selected.searchNodes > 0);
  }],
  ["duel Autopilot does not treat an optional opponent mistake as a forced win", () => {
    const evaluations = rules.evaluateDuelMoves({
      snake: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: { x: 0, y: -1 },
      opponentSnake: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      opponentDirection: { x: 1, y: 0 },
      food: { x: 5, y: 1 },
      mode: "classic",
      gridSize: 8,
      candidates: DIRECTIONS,
    });
    const withMistakeAvailable = evaluations.find((move) =>
      move.legal && move.winningReplies > 0 && move.openReplies > 0);
    assert.ok(withMistakeAvailable);
    assert.equal(withMistakeAvailable.forcedWin, false);
    assert.notEqual(withMistakeAvailable.strategy, "TACTICAL WIN");
  }],
  ["duel search keeps the visible food target throughout its forecast", () => {
    const spawns = rules.duelSpawns(12);
    const first = rules.evaluateDuelMoves({
      snake: spawns.opponent.snake,
      direction: spawns.opponent.direction,
      opponentSnake: spawns.player.snake,
      opponentDirection: spawns.player.direction,
      food: { x: 6, y: 0 },
      mode: "classic",
      gridSize: 12,
      candidates: DIRECTIONS,
    }).find((move) => move.name === "left");
    const second = rules.evaluateDuelMoves({
      snake: spawns.opponent.snake,
      direction: spawns.opponent.direction,
      opponentSnake: spawns.player.snake,
      opponentDirection: spawns.player.direction,
      food: { x: 8, y: 0 },
      mode: "classic",
      gridSize: 12,
      candidates: DIRECTIONS,
    }).find((move) => move.name === "left");
    assert.equal(first.distance, second.distance);
    assert.notEqual(first.searchValue, second.searchValue);
  }],
  ["duel Autopilot adapts to seeded maps against a direct human food racer", () => {
    const runs = ["KXBP3F", "8RATCV", "F8ZUNJ"].map((code) =>
      simulateDuel(code, "greedy", 240));
    assert.equal(
      runs.filter((run) => run.winner === "player").length,
      0,
      JSON.stringify(runs),
    );
    assert.ok(
      runs.filter((run) => run.winner === "opponent").length >= 2,
      JSON.stringify(runs),
    );
    assert.equal(
      new Set(runs.map((run) => run.routeSignature)).size,
      runs.length,
      JSON.stringify(runs),
    );
  }],
  ["duel loop recovery breaks short pursuit cycles", () => {
    const run = simulateDuel("KXBP3F", "hunter", 300);
    assert.notEqual(run.winner, "player", JSON.stringify(run));
    assert.ok(run.distinctHeads >= 100, JSON.stringify(run));
  }],
  ["seeded solo benchmark stays alive and collects purposefully", () => {
    const runs = Array.from({ length: 16 }, (_, index) =>
      simulateSolo(codeFromIndex(index), "classic", 600));
    const totalFoods = runs.reduce((total, run) => total + run.foods, 0);
    runs.forEach((run) => assert.equal(run.outcome, "timeout", JSON.stringify(run)));
    assert.equal(
      new Set(runs.map((run) => run.code)).size,
      runs.length,
      JSON.stringify(runs),
    );
    assert.equal(
      new Set(runs.map((run) => run.routeSignature)).size,
      runs.length,
      JSON.stringify(runs),
    );
    runs.forEach((run) => assert.ok(run.foods >= 15, JSON.stringify(run)));
    assert.ok(totalFoods >= 280, JSON.stringify(runs));
  }],
  ["planner remains purposeful across Portal, Rush, and Canvas boundaries", () => {
    const runs = ["portal", "rush", "canvas"].map((mode) =>
      simulateSolo("KXBP3F", mode, mode === "rush" ? 2000 : 600));
    runs.forEach((run) => assert.equal(
      run.outcome,
      run.mode === "rush" ? "deadline" : "timeout",
      JSON.stringify(run),
    ));
    assert.ok(runs.find((run) => run.mode === "portal").foods >= 30, JSON.stringify(runs));
    assert.ok(runs.find((run) => run.mode === "rush").foods >= 40, JSON.stringify(runs));
    assert.ok(runs.find((run) => run.mode === "canvas").foods >= 18, JSON.stringify(runs));
  }],
  ["Canvas simulation follows seeded core and mutation transitions", () => {
    const first = simulateSolo("KXBP3F", "canvas", 600);
    const repeat = simulateSolo("KXBP3F", "canvas", 600);
    assert.equal(first.foods, 21, JSON.stringify(first));
    assert.equal(first.coresCollected, 4, JSON.stringify(first));
    assert.equal(first.coresExpired, 0, JSON.stringify(first));
    assert.equal(first.mutationSignature, "afaa");
    assert.equal(first.mutationSignature, repeat.mutationSignature);
    assert.equal(first.routeSignature, repeat.routeSignature);
    assert.equal(first.foodCount, first.foods + first.coresExpired, JSON.stringify(first));
  }],
  ["the former deterministic trap seed survives beyond its old failure", () => {
    const run = simulateSolo("8RATCV", "classic", 1800);
    assert.equal(run.outcome, "timeout", JSON.stringify(run));
    assert.ok(run.foods >= 60, JSON.stringify(run));
  }],
  ["Signal Codes produce distinct adaptive route signatures", () => {
    const first = simulateSolo("KXBP3F", "classic", 300);
    const second = simulateSolo("8RATCV", "classic", 300);
    assert.notEqual(first.routeSignature, second.routeSignature);
  }],
  ["unique Signal Codes stay purposeful and non-repeating across solo modes", () => {
    const codes = Array.from({ length: 8 }, (_, index) => codeFromIndex(index + 32));
    assert.equal(new Set(codes).size, codes.length);
    const expectations = {
      classic: { foods: 45, maxCaptureGap: 140 },
      // Portal follows the same completion-safe cycle as Classic, trading some
      // early speed for a guarantee that it never circles its tail forever.
      portal: { foods: 70, maxCaptureGap: 180 },
    };
    for (const [mode, expectation] of Object.entries(expectations)) {
      const runs = codes.map((code) => simulateSolo(code, mode, 2000));
      runs.forEach((run) => {
        assert.equal(
          run.outcome,
          "timeout",
          JSON.stringify(run),
        );
        assert.ok(run.foods >= expectation.foods, JSON.stringify(run));
        assert.ok(run.maxCaptureGap <= expectation.maxCaptureGap, JSON.stringify(run));
      });
      assert.equal(
        new Set(runs.map((run) => run.routeSignature)).size,
        runs.length,
        JSON.stringify(runs),
      );
    }
  }],
  ["timed Rush and Canvas diagnostics cover every selectable pace", () => {
    const codes = Array.from({ length: 8 }, (_, index) => codeFromIndex(index + 32));
    const expectations = {
      steady: { rushFoods: 20, rushGap: 60, canvasFoods: 55, canvasGap: 100 },
      arcade: { rushFoods: 30, rushGap: 60, canvasFoods: 55, canvasGap: 100 },
      overdrive: { rushFoods: 45, rushGap: 60, canvasFoods: 55, canvasGap: 100 },
    };
    for (const [paceName, expectation] of Object.entries(expectations)) {
      const rushRuns = codes.map((code) => simulateSolo(code, "rush", 2000, paceName));
      const canvasRuns = codes.map((code) => simulateSolo(code, "canvas", 2000, paceName));
      rushRuns.forEach((run) => {
        assert.equal(run.pace, paceName);
        assert.equal(run.outcome, "deadline", JSON.stringify(run));
        assert.equal(run.elapsedMs, RUSH_DURATION, JSON.stringify(run));
        assert.ok(run.foods >= expectation.rushFoods, JSON.stringify(run));
        assert.ok(run.maxCaptureGap <= expectation.rushGap, JSON.stringify(run));
      });
      canvasRuns.forEach((run) => {
        assert.equal(run.pace, paceName);
        assert.equal(run.outcome, "timeout", JSON.stringify(run));
        assert.ok(run.foods >= expectation.canvasFoods, JSON.stringify(run));
        assert.ok(run.maxCaptureGap <= expectation.canvasGap, JSON.stringify(run));
        assert.equal(run.length, CANVAS_BRUSH_LENGTH, JSON.stringify(run));
        assert.ok(run.canvasCompositionSteps >= 800, JSON.stringify(run));
      });
      [rushRuns, canvasRuns].forEach((runs) => assert.equal(
        new Set(runs.map((run) => run.routeSignature)).size,
        runs.length,
        JSON.stringify(runs),
      ));
      const rushFoods = rushRuns.map((run) => run.foods);
      const rushSteps = rushRuns.map((run) => run.steps);
      const canvasFoods = canvasRuns.map((run) => run.foods);
      const canvasExpiries = canvasRuns.map((run) => run.coresExpired);
      process.stdout.write(
        `${paceName} timing matrix: Rush foods ${Math.min(...rushFoods)}-${Math.max(...rushFoods)}, `
        + `steps ${Math.min(...rushSteps)}-${Math.max(...rushSteps)}, `
        + `capture gap ${Math.max(...rushRuns.map((run) => run.maxCaptureGap))}; `
        + `Canvas foods ${Math.min(...canvasFoods)}-${Math.max(...canvasFoods)}, `
        + `capture gap ${Math.max(...canvasRuns.map((run) => run.maxCaptureGap))}, `
        + `core expiries ${Math.min(...canvasExpiries)}-${Math.max(...canvasExpiries)}\n`,
      );
      if (paceName === "steady") {
        const expirySeed = canvasRuns.find((run) => run.code === "PN7B2H");
        assert.equal(expirySeed.coresExpired, 1, JSON.stringify(expirySeed));
      }
    }
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic AI quality tests passed.\n`);
