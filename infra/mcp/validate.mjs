import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const t = JSON.parse(
  await readFile(new URL("./template.json", import.meta.url), "utf8"),
);
const r = t.Resources;
assert.equal(t.Transform, "AWS::Serverless-2016-10-31");
assert.equal(
  r.StateTable.Properties.TimeToLiveSpecification.AttributeName,
  "ttl",
);
assert.equal(r.Integration.Properties.PayloadFormatVersion, "2.0");
assert.equal(r.McpFunction.Properties.Runtime, "nodejs24.x");
assert.equal(r.McpFunction.Metadata?.BuildMethod, undefined);
assert.equal(
  r.McpFunction.Properties.Handler,
  "dist/server/mcp/src/lambda.handler",
);
assert.deepEqual(r.McpFunction.Properties.ReservedConcurrentExecutions, {
  "Fn::If": ["ReserveRuntime", 2, { Ref: "AWS::NoValue" }],
});
assert.equal(r.RuntimeLogs.Properties.RetentionInDays, 7);
assert.ok(!r.Stage.Properties.AccessLogSettings);
const allowed = new Set([
  "AWS::DynamoDB::Table",
  "AWS::KMS::Key",
  "AWS::KMS::Alias",
  "AWS::Logs::LogGroup",
  "AWS::IAM::Role",
  "AWS::ApiGatewayV2::Api",
  "AWS::Serverless::Function",
  "AWS::ApiGatewayV2::Integration",
  "AWS::ApiGatewayV2::Route",
  "AWS::ApiGatewayV2::Stage",
  "AWS::Lambda::Permission",
  "AWS::CloudWatch::Alarm",
]);
for (const v of Object.values(r)) assert.ok(allowed.has(v.Type));
const statements =
  r.RuntimeRole.Properties.Policies[0].PolicyDocument.Statement;
assert.deepEqual(statements[0].Action, [
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "dynamodb:DeleteItem",
]);
for (const statement of statements) assert.notEqual(statement.Resource, "*");
assert.deepEqual(statements[1].Action, ["kms:Encrypt", "kms:Decrypt"]);
assert.equal(
  statements[1].Condition.StringEquals["kms:EncryptionContext:application"],
  "nigraan-mcp",
);
console.log(
  "MCP infrastructure local structural/security checks passed (not SAM service validation).",
);
