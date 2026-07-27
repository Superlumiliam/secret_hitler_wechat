#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const testFiles = [
  "tests/backend/gameService/startGameInit.test.js",
  "tests/backend/gameService/ruleScenarios.test.js",
  "tests/backend/gameService/resultSnapshot.integration.test.js",
  "tests/backend/gameService/privateSnapshotOptimization.test.js",
  "tests/backend/spectatorMode.test.js",
  "tests/backend/roomService/isolation.test.js",
  "tests/backend/roomService/claimLobbySeat.test.js",
  "tests/backend/roomService/joinRoomConcurrency.test.js",
  "tests/backend/roomService/roomLifecycleConcurrency.test.js",
  "tests/backend/commandRecords.performance.test.js",
  "tests/backend/bootstrapService/recovery.test.js",
  "tests/backend/maintenanceService/concurrency.test.js",
  "tests/backend/syncOptimization.test.js",
];

let failed = 0;

for (const relativeFile of testFiles) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  const startedAt = Date.now();
  process.stdout.write(`\n[backend-test] ${relativeFile}\n`);

  const result = spawnSync(process.execPath, [absoluteFile], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const elapsedMs = Date.now() - startedAt;
  if (result.status === 0) {
    process.stdout.write(`[backend-test] PASS ${relativeFile} (${elapsedMs}ms)\n`);
  } else {
    failed += 1;
    process.stderr.write(`[backend-test] FAIL ${relativeFile} (${elapsedMs}ms)\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`\n[backend-test] ${failed} test file(s) failed\n`);
  process.exit(1);
}

process.stdout.write("\n[backend-test] all backend tests passed\n");
