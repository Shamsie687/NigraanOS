> **Source-release status, 16 October 2026:** The owner reports the existing AWS update completed. Read-only inspection, local builds and rollback preservation were performed earlier; upload/change-set commands were run by the owner under separate approval. This guide is retained for future reviewed updates, not instructions to replay a completed deployment.

# Existing AWS MCP update — Windows CMD

Prepared locally 14 October 2026. **No AWS commands in this guide were executed.** User-reported hosted stack: `nigraan-mcp-staging`, `ap-south-1`. Repository template predicts Lambda `nigraan-mcp-staging-runtime`, logical ID `McpFunction`, Node.js 24/arm64, HTTP API Gateway, retained DynamoDB/KMS. Live resource names, template drift, profile/account and packaging bucket must be confirmed read-only; they have not been verified from AWS in this task. Older documentation/template “not deployed” labels are historical.

## 1. Read-only discovery — run before approving any write

Open **Command Prompt (CMD)**, not PowerShell. Replace `YOUR_EXISTING_AWS_PROFILE` with the owner profile previously used for this stack. Do not guess the account or create another profile/credentials. If it is unavailable, stop.

```cmd
cd /d C:\Users\User\Downloads\nigraanos-hackathon-release
set "NIGRAAN_AWS_PROFILE=YOUR_EXISTING_AWS_PROFILE"
aws cloudformation describe-stacks --stack-name nigraan-mcp-staging --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%" --query "Stacks[0].{Status:StackStatus,PublicEndpoints:Outputs[?OutputKey=='McpOrigin' || OutputKey=='McpResource']}" --output json
aws cloudformation list-stack-resources --stack-name nigraan-mcp-staging --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%" --query "StackResourceSummaries[?LogicalResourceId=='McpFunction'].{Function:PhysicalResourceId,Type:ResourceType}" --output json
```

Require the existing account/stack, stable CREATE_COMPLETE or UPDATE_COMPLETE state and the expected MCP function. Use the stack's actual **McpOrigin** output; `/mcp` is the tool endpoint. Do not invent an execute-api hostname. Privately inspect CloudFormation parameters: Supabase target must be `https://pmzbdrxedlthdqdpgigs.supabase.co`, consent frontend `https://nigraanos.netlify.app/`, callback `/agent-callback`, and simulator registration must match current frontend. Do not display or copy keys into command lines.

In CloudFormation → this stack → Template, inspect the **Original** deployed template and artifact CodeUri for `McpFunction` (or processed Lambda Code S3Bucket/S3Key). Confirm the existing artifact bucket and access; use it below. Review local versus deployed template for unexpected runtime/IAM/API/table/key/config changes before packaging. Do not use `--resolve-s3`, `--guided`, new defaults or a new stack to work around missing configuration.

## 2. Preserve rollback material privately

Use a new private directory outside Git, avoiding synced/shared folders. These are read-only AWS requests; do not run if account/profile is unconfirmed.

```cmd
set "NIGRAAN_ROLLBACK_DIR=%USERPROFILE%\Documents\NigraanOS_AWS_Rollback_20261014"
mkdir "%NIGRAAN_ROLLBACK_DIR%"
aws cloudformation get-template --stack-name nigraan-mcp-staging --template-stage Original --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%" --output json > "%NIGRAAN_ROLLBACK_DIR%\previous-template-response.json"
node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).TemplateBody;if(!x)throw new Error('Missing original template');fs.writeFileSync(process.argv[2],typeof x==='string'?x:JSON.stringify(x),{flag:'wx'});" "%NIGRAAN_ROLLBACK_DIR%\previous-template-response.json" "%NIGRAAN_ROLLBACK_DIR%\previous-template.json"
```

Do not rerun over existing backups; select a new private directory if needed. Stop on failed commands. Ensure the previous code's S3 object/version is retained and readable. Retain current parameter settings privately. Never post this template/configuration to chat or Git. No DynamoDB/KMS state backup reset or deletion is part of a code update.

## 3. Local checks and packaging preparation

```cmd
npm --prefix server/mcp test
npm --prefix server/mcp run typecheck
npm --prefix server/mcp run validate:infra
sam build --template-file infra\mcp\template.json
```

Stop on any failed command. Native SAM build/package success is a separate gate; local TypeScript tests alone do not establish it. Do not install global packages or change secrets to fix failures without review.

## 4. Future upload/change set — requires explicit AWS-write approval

Replace `EXISTING_ARTIFACT_BUCKET` privately with the verified existing bucket. The following uploads artifacts and creates a CloudFormation change set even though it does **not** execute it. It is not read-only.

```cmd
set "NIGRAAN_ARTIFACT_BUCKET=EXISTING_ARTIFACT_BUCKET"
sam package --template-file .aws-sam\build\template.yaml --s3-bucket "%NIGRAAN_ARTIFACT_BUCKET%" --output-template-file .aws-sam\judge-activation-packaged.yaml --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%"
aws cloudformation create-change-set --stack-name nigraan-mcp-staging --change-set-name nigraan-judge-activation-20261014 --change-set-type UPDATE --template-body file://.aws-sam/judge-activation-packaged.yaml --parameters file://infra/mcp/use-existing-parameters.json --capabilities CAPABILITY_IAM --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%"
aws cloudformation wait change-set-create-complete --stack-name nigraan-mcp-staging --change-set-name nigraan-judge-activation-20261014 --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%"
aws cloudformation describe-change-set --stack-name nigraan-mcp-staging --change-set-name nigraan-judge-activation-20261014 --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%" --query "{Status:Status,Reason:StatusReason,Changes:Changes[*].ResourceChange.{Action:Action,LogicalId:LogicalResourceId,Type:ResourceType,Replacement:Replacement}}" --output json
```

The committed parameter file contains **UsePreviousValue=true** only, retaining all seven existing parameters, including the NoEcho key; no secret values are requested or supplied. Stop if deployed parameters differ from these seven: review a correctly targeted update instead of changing production defaults. Stop for resource additions/removals/replacements, IAM expansion, changed endpoint/table/key/environment, unknown drift or unexpected changes beyond the reviewed MCP code/template metadata. Use a new change-set name for any later attempt; do not delete an existing change set automatically.

## 5. Future execution — separate approval of that exact change set

```cmd
aws cloudformation execute-change-set --stack-name nigraan-mcp-staging --change-set-name nigraan-judge-activation-20261014 --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%"
aws cloudformation wait stack-update-complete --stack-name nigraan-mcp-staging --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%"
aws cloudformation describe-stacks --stack-name nigraan-mcp-staging --region ap-south-1 --profile "%NIGRAAN_AWS_PROFILE%" --query "Stacks[0].{Status:StackStatus,PublicEndpoints:Outputs[?OutputKey=='McpOrigin' || OutputKey=='McpResource']}" --output json
```

Require UPDATE_COMPLETE and unchanged public endpoints. Leave rollback enabled. Nothing in this guide changes Supabase, Netlify or the webhook. Save deployment events/results privately. If a wait fails, inspect stack events before any retry; do not disable rollback or delete the stack.

## Acceptance and rollback

The new adapter requires DB `allowed=true`, temporary `status=active`, valid `started_at`, and exactly 60 minutes between start/expiry. Permanent access uses Infinity for the judge deadline, retaining the existing ten-minute OAuth maximum and upstream JWT cap. Codes/tokens use the minimum of these bounds; references inherit the grant cap. Every tool rechecks live database authorization, including before returning results; an approved-but-unstarted or expired/revoked judge cannot authorize.

After deployment approval, validate public discovery and unauthorized MCP rejection without tokens. Controlled authenticated testing separately requires authorization: confirm permanent Operations and all five tools work, unstarted approval cannot obtain delegation, active tokens/reference expiry never exceeds DB expiry, revocation/expiry rejects existing delegation and replay cannot extend it. The current older frontend may not offer Start; do not modify database timestamps or fabricate credentials to bypass it. Complete end-to-end checks after compatible frontend deployment. No email/webhook activation is required to verify MCP.

On failed update, let CloudFormation restore the last stable deployment; require UPDATE_ROLLBACK_COMPLETE before reassessing. For a successful update with runtime regressions, stop judge admission and revoke/wait out active judge sessions through the existing protected workflow, then prepare a new UPDATE change set using the privately retained `previous-template.json`, **same UsePreviousValue parameter file**, IAM capability, account and region. Review/approve it separately before execution. Retain existing DynamoDB/KMS/API resources and old code artifacts. Do not use `sam delete`, reset state, restore old Supabase approval logic or independently overwrite Lambda environment settings. Old MCP code may not enforce new activation caps, so do not resume judges until repaired hosted acceptance passes.

References: [AWS SAM deployment/package options](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html), [CloudFormation change sets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html).
