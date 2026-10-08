# Deploy the SSO Backend via AWS CloudShell (ap-southeast-1)

Step-by-step guide to deploy the Network Resilience Agent **SSO backend** from
AWS CloudShell and obtain the backend `ApiUrl`. No SAM CLI required — CloudShell
already has the AWS CLI and is authenticated as your console user.

The SSO backend is **optional**. It is only needed for the **Connect AWS → SSO**
(IAM Identity Center) login flow. Pasting temporary credentials into the app
works without it.

---

## Which account to deploy into

Deploy this into a **sandbox / non-production account**, not the networking
(production) account. The backend stands up a public, internet-facing endpoint
that issues short-lived IAM credentials, so keeping it out of production reduces
blast radius. It does **not** need to live in the networking account:

- The stack is fully self-contained (Lambda + HTTP API + IAM role + log groups +
  S3 bucket) and does not read, modify, or delete any existing resource. It never
  touches Direct Connect, VIFs, DX gateways, Transit Gateways, VPCs, or routing.
- SSO sign-in still authenticates users **into the networking account** — the
  credentials come from the IAM Identity Center permission set assigned to the
  user for that account, not from this backend. Deploying in sandbox does not
  change what the app can discover.

**Before running any command below, confirm CloudShell is signed into the
sandbox account** (check the account ID in the console's top-right menu, or run
`aws sts get-caller-identity` and verify the `Account` field). The
`aws sts get-caller-identity` call in Step 2 will pick up the sandbox account ID
automatically, so the bucket name self-adjusts.

---

## Why an S3 bucket is required

CloudFormation cannot read a Lambda zip from CloudShell's local disk. The
`AWS::Lambda::Function` code must live in S3 (`CodeUri: { Bucket, Key }` in
`template-console.yaml`). CloudShell is only where you *run the commands*; the
zip must be uploaded to S3 for CloudFormation to deploy from. The bucket must be
in the **same region** as the stack.

## Region note

The region does **not** affect `lambda.zip` — the artifact has nothing
region-specific baked in and deploys to any region unchanged. Region only
matters for the S3 bucket (must match the stack) and shows up in the resulting
`ApiUrl`. This guide uses `ap-southeast-1` throughout. Make sure CloudShell is
launched in `ap-southeast-1` (it runs in whatever region is selected in the
console's top-right region picker).

---

## Prerequisites

Two files from this repo, uploaded into CloudShell:

- `backend/console-deployment/lambda.zip` — the prebuilt Lambda artifact
- `backend/console-deployment/template-console.yaml` — the CloudFormation template

---

## Step 1 — Upload the two files into CloudShell

In the CloudShell window: **Actions → Upload file**. Upload `lambda.zip`, then
repeat for `template-console.yaml`. They land in your home directory
(`~`, i.e. `/home/cloudshell-user`).

Verify:

```bash
ls -lh lambda.zip template-console.yaml
```

## Step 2 — Set reusable variables

First confirm you are in the **sandbox** account:

```bash
aws sts get-caller-identity --query Account --output text
```

If that account ID is the sandbox account, continue:

```bash
REGION=ap-southeast-1
BUCKET=my-nwra-sso-$(aws sts get-caller-identity --query Account --output text)
echo "$BUCKET"
```

This resolves to `my-nwra-sso-<Account>` (the current — sandbox — account ID
appended). The account ID keeps the name globally unique, which S3 requires.
Pick any valid, globally-unique bucket name you like; this is just an example.

> **If shell variables don't persist in your CloudShell session** (e.g.
> `echo "$BUCKET"` prints blank), skip the variables entirely and use the
> hardcoded commands in the section below. Substitute your own account ID and
> bucket name if different.

## Step 3 — Create the S3 bucket (in ap-southeast-1)

```bash
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"
```

The `--create-bucket-configuration LocationConstraint=<region>` flag is required
for every region except `us-east-1`.

## Step 4 — Upload the zip to S3

```bash
aws s3 cp lambda.zip "s3://$BUCKET/lambda.zip" --region "$REGION"
```

## Step 5 — Deploy the CloudFormation stack

```bash
aws cloudformation create-stack \
  --stack-name resilience-agent-sso \
  --template-body file://template-console.yaml \
  --parameters \
      ParameterKey=ArtifactBucket,ParameterValue="$BUCKET" \
      ParameterKey=ArtifactKey,ParameterValue=lambda.zip \
      ParameterKey=AllowedOrigins,ParameterValue=http://localhost:4173 \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --region "$REGION"
```

Notes:

- `AllowedOrigins=http://localhost:4173` matches the `npm run preview` origin —
  **no trailing slash**. Use `http://localhost:5173` if you run `npm run dev`
  instead; comma-separate to allow both (e.g.
  `http://localhost:4173,http://localhost:5173`). Wildcards are rejected by design.
- `CAPABILITY_IAM` — the stack creates the Lambda execution role.
- `CAPABILITY_AUTO_EXPAND` — the template uses the SAM transform.

## Step 6 — Wait for completion

```bash
aws cloudformation wait stack-create-complete \
  --stack-name resilience-agent-sso --region "$REGION"
```

Blocks until the stack reaches `CREATE_COMPLETE` (usually 1–2 min).

## Step 7 — Get your backend URL

```bash
aws cloudformation describe-stacks \
  --stack-name resilience-agent-sso --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text
```

Output looks like:

```
https://abc123xyz.execute-api.ap-southeast-1.amazonaws.com
```

**That is your backend URL.**

## Step 8 — Smoke test (optional)

```bash
curl https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/health
# expected: {"status":"ok"}
```

A `200` on `/health` confirms the deployment is healthy. `GET /` and unknown
paths return HTTP 500 **by design** (there is no root route), so only test
`/health`.

## Step 9 — Wire the URL into the SPA

Two options:

- **Runtime (easiest):** in the app, open **Settings → SSO Backend URL** and
  paste the URL. Stored in your browser's localStorage.
- **Build-time:** add to `dx-visualizer/.env`:

  ```
  VITE_SSO_BACKEND_URL=https://<api-id>.execute-api.ap-southeast-1.amazonaws.com
  ```

  then rebuild: `npm run build` (Vite env vars are baked in at build time).

---

## Teardown

```bash
aws cloudformation delete-stack --stack-name resilience-agent-sso --region ap-southeast-1
aws cloudformation wait stack-delete-complete --stack-name resilience-agent-sso --region ap-southeast-1
aws s3 rm "s3://$BUCKET/lambda.zip" --region ap-southeast-1
aws s3api delete-bucket --bucket "$BUCKET" --region ap-southeast-1
```

---

## Troubleshooting

- **Step 5 fails with an invalid/corrupt zip error** — the browser upload in
  Step 1 can occasionally corrupt a binary. Re-upload `lambda.zip`, or rebuild
  it directly in CloudShell (it has Node ≥ 22): upload the `backend/` source and
  run `node console-deployment/build-lambda-zip.mjs`, then re-upload to S3.
- **CORS errors in the browser after wiring the URL** — `AllowedOrigins` must
  match the SPA origin exactly (scheme + host + port, no trailing slash). Update
  the stack with the correct origin if it differs.
- **`create-bucket` says the bucket already exists** — the name is taken
  (globally unique). Adjust `BUCKET` and re-run from Step 2.

---

## Appendix — Hardcoded commands (no shell variables)

Use these if shell variables don't persist in your CloudShell session. Run one
at a time, in order. Paste **only the command line** — never the ```` ``` ````
fences. Values below are **placeholders** — account `123456789012`, bucket
`my-nwra-sso-123456789012`, region `ap-southeast-1`. Substitute your own account
ID and bucket name, and keep the bucket name identical across all three commands
that reference it.

**1. Create the S3 bucket**

```bash
aws s3api create-bucket --bucket my-nwra-sso-123456789012 --region ap-southeast-1 --create-bucket-configuration LocationConstraint=ap-southeast-1
```

**2. Upload the zip to S3**

```bash
aws s3 cp lambda.zip s3://my-nwra-sso-123456789012/lambda.zip --region ap-southeast-1
```

**3. Deploy the CloudFormation stack**

```bash
aws cloudformation create-stack --stack-name resilience-agent-sso --template-body file://template-console.yaml --parameters ParameterKey=ArtifactBucket,ParameterValue=my-nwra-sso-123456789012 ParameterKey=ArtifactKey,ParameterValue=lambda.zip ParameterKey=AllowedOrigins,ParameterValue=http://localhost:4173 --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --region ap-southeast-1
```

**4. Wait for completion (blocks ~1–2 min)**

```bash
aws cloudformation wait stack-create-complete --stack-name resilience-agent-sso --region ap-southeast-1
```

**5. Get your backend URL**

```bash
aws cloudformation describe-stacks --stack-name resilience-agent-sso --region ap-southeast-1 --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text
```

**6. (Optional) Smoke test** — replace `<api-id>` with the value from step 5

```bash
curl https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/health
```

Expect `{"status":"ok"}`.

**If step 3 fails**, inspect the reason:

```bash
aws cloudformation describe-stack-events --stack-name resilience-agent-sso --region ap-southeast-1 --query "StackEvents[?ResourceStatus=='CREATE_FAILED'].[LogicalResourceId,ResourceStatusReason]" --output table
```

**Teardown (hardcoded)**

```bash
aws cloudformation delete-stack --stack-name resilience-agent-sso --region ap-southeast-1
```
```bash
aws cloudformation wait stack-delete-complete --stack-name resilience-agent-sso --region ap-southeast-1
```
```bash
aws s3 rm s3://my-nwra-sso-123456789012/lambda.zip --region ap-southeast-1
```
```bash
aws s3api delete-bucket --bucket my-nwra-sso-123456789012 --region ap-southeast-1
```
