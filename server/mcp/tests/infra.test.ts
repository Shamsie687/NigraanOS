import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
test("isolated IaC security/structure checks and source-only SAM packaging", () => {
  const result = execFileSync(
    process.execPath,
    [resolve("../../infra/mcp/validate.mjs")],
    { encoding: "utf8" },
  );
  assert.ok(result.includes("checks passed"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts.prepack, "npm run build");
  assert.deepEqual(pkg.files, ["dist/server/mcp/src/", "dist/src/"]);
  assert.equal(existsSync("Makefile"), false);
});
test("npm Lambda package contains handler/shared imports but no tests, TS source or local configuration", async () => {
  // npm's CLI JS entry works natively on Windows without spawning npm.cmd.
  const npmCli = process.env.npm_execpath!;
  const packed = JSON.parse(execFileSync(process.execPath,
    [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"], {encoding: "utf8"}))[0];
  const paths: string[] = packed.files.map((f: {path: string}) => f.path);
  assert.ok(paths.includes("dist/server/mcp/src/lambda.js"));
  for (const path of ["dist/src/utils/emergencyOperations.js", "dist/src/utils/operationsAnalytics.js", "dist/src/services/agentProjection.js"])
    assert.ok(paths.includes(path));
  for (const path of paths) {
    assert.ok(path === "package.json" || path.startsWith("dist/server/mcp/src/") || path.startsWith("dist/src/"));
    assert.ok(!path.includes("/tests/") && !path.endsWith(".ts") && !path.includes(".env"));
  }
  const {handler} = await import("../src/lambda.js");
  assert.equal(typeof handler, "function");
});
