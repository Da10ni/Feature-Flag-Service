# Feature Flag Service

A production-grade, multi-tenant feature flag service built with NestJS, TypeScript, PostgreSQL, and Redis — deployed on Google Cloud Platform via Cloud Run, Terraform, and GitHub Actions. Conceptually, this is a simplified LaunchDarkly: it lets multiple independent tenants create, manage, and evaluate feature flags with percentage-based rollouts, variant (A/B) testing, per-environment configuration, and real-time change streaming.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Choices and Reasoning](#3-technology-choices-and-reasoning)
4. [Database Schema](#4-database-schema)
5. [API Documentation](#5-api-documentation)
6. [Flag Evaluation Algorithm](#6-flag-evaluation-algorithm)
7. [Infrastructure Architecture](#7-infrastructure-architecture)
8. [Deployment Strategy](#8-deployment-strategy)
9. [Local Development Setup](#9-local-development-setup)
10. [Testing Strategy](#10-testing-strategy)
11. [Load Test Results](#11-load-test-results)
12. [Assumptions and Trade-offs](#12-assumptions-and-trade-offs)
13. [Future Improvements](#13-future-improvements)
14. [CI/CD Secrets Setup](#14-cicd-secrets-setup)

---

## 1. Project Overview

### What It Is

The Feature Flag Service is a self-hosted, multi-tenant feature flagging platform. It enables engineering teams to decouple feature releases from code deployments by controlling feature availability through runtime configuration rather than code changes.

Each tenant (an organization or product team) receives an isolated namespace and an API key. Within that namespace they can:

- Define **feature flags** with three value types: `boolean`, `string`, and `number`
- Configure flags **per environment** (`development`, `staging`, `production`) independently
- Enable **percentage-based rollouts** so a flag is served to only a fraction of users
- Define **variants** for A/B testing, each with a weighted traffic split
- Query a complete **audit history** of every change ever made to a flag
- Subscribe to **real-time flag change events** via Server-Sent Events (SSE)

### Key Capabilities

| Capability | Description |
|---|---|
| Multi-tenancy | Complete data isolation between tenants enforced at the database and API guard level |
| Per-environment config | Each flag has independent `isEnabled`, `rolloutPercentage`, and `variants` per environment |
| Percentage rollout | SHA-256 consistent hashing ensures the same user always lands in the same bucket |
| Variant / A/B testing | Weighted variant selection on string flags using the same hash bucket |
| Redis caching | Evaluation results are cached for 30 seconds to reduce database load |
| Audit logging | Every create, update, and archive action is recorded with before/after state |
| Real-time SSE | Clients can subscribe to a live stream of flag changes without polling |
| Rate limiting | 1 000 requests per minute per IP via `@nestjs/throttler` |
| Structured logging | All log output is JSON for ingestion into Cloud Logging |
| Health endpoint | `/api/v1/health` used by Cloud Run startup and liveness probes |

---

## 2. Architecture Overview

### ASCII Architecture Diagram

```
+-------------------------------------------------------------------------+
|                          CLIENT LAYER                                   |
|                                                                         |
|   SDK / App Server          Dashboard / CI          Internal Services   |
|   POST /evaluate            CRUD /flags             GET /evaluate/bulk  |
+------------------------------------+------------------------------------+
                                     |  HTTPS
                                     v
+-------------------------------------------------------------------------+
|                     CLOUD RUN (NestJS API)                              |
|                                                                         |
|  +--------------+  +--------------+  +--------------+  +------------+  |
|  |  Tenants     |  |  Flags       |  |  Evaluation  |  |  SSE       |  |
|  |  Controller  |  |  Controller  |  |  Controller  |  |  Controller|  |
|  +------+-------+  +------+-------+  +------+-------+  +-----+------+  |
|         |                 |                 |                |          |
|  +------v-------+  +------v-------+  +------v-------+       |          |
|  |  Tenants     |  |  Flags       |  |  Evaluation  |       |          |
|  |  Service     |  |  Service     |  |  Service     |       |          |
|  +------+-------+  +------+-------+  +------+-------+       |          |
|         |                 |          +------+               |          |
|         |                 |          |      | Cache miss    |          |
|         |         +-------+    +-----v--+   |       +-------v--------+ |
|         |         | Audit |    | Redis  |   |       | EventEmitter   | |
|         |         | Log   |    | Cache  |   |       | (flag.changed) | |
|         |         | Svc   |    +--------+   |       +----------------+ |
|         |         +------++                 |                          |
|         |                |                  |                          |
+---------+----------------+------------------+--------------------------+
          |  VPC Connector |                  |
          v                v                  v
+-----------------+  +------------+   +----------------+
|  Cloud SQL      |  | Memorystore|   |  Secret Manager|
|  PostgreSQL 16  |  | Redis 7    |   |  (DB password) |
|                 |  |            |   |                |
|  tenants        |  | eval:*     |   |                |
|  feature_flags  |  | (30s TTL)  |   |                |
|  flag_envs      |  |            |   |                |
|  audit_logs     |  |            |   |                |
+-----------------+  +------------+   +----------------+
```

### Component Breakdown

**API Layer (NestJS Modules)**

- `TenantsModule` — Provisions tenants, generates and hashes API keys (bcrypt), exposes tenant CRUD.
- `FlagsModule` — Full CRUD for feature flags; auto-creates one `FlagEnvironment` row per environment on flag creation; publishes `flag.changed` events.
- `EvaluationModule` — The hot path. Checks Redis cache first; on a miss, fetches the flag from PostgreSQL, runs the evaluation algorithm, caches the result for 30 s, and returns the decision.
- `AuditModule` — Read-only audit history. Audit rows are written by `FlagsService` on every mutation.
- `SseModule` — Subscribes to `flag.changed` events via NestJS `EventEmitter` and streams them to connected HTTP clients using the SSE protocol.
- `HealthModule` — Pings PostgreSQL with `SELECT 1` and returns a JSON health response used by Cloud Run probes.
- `RedisModule` — Thin wrapper around `ioredis` with graceful error handling so Redis failures never crash the API.

**Cross-Cutting Concerns**

- `ApiKeyGuard` — Validates the `x-api-key` header by bcrypt-comparing against all active tenant hashes. Attaches the resolved tenant to the request.
- `CorrelationIdMiddleware` — Propagates or generates an `X-Correlation-ID` header on every request for distributed tracing.
- `JsonLogger` — Replaces NestJS's default logger with structured JSON output compatible with Cloud Logging.
- `ThrottlerModule` — Rate-limits to 1 000 requests per minute.
- `ValidationPipe` — Validates and transforms all incoming DTOs using `class-validator`; strips unknown fields (`whitelist: true`).

### Data Flow — Single Flag Evaluation

```
1. Client sends POST /api/v1/evaluate
   Body: { tenantId, environment, userId, flagKey }

2. EvaluationController delegates to EvaluationService.evaluate()

3. EvaluationService checks Redis:
   Key = eval:{tenantId}:{environment}:{flagKey}:{userId}
   --> HIT: return cached result with reason=CACHED

4. MISS: query PostgreSQL for FeatureFlag WHERE tenantId = ? AND flagKey = ?
   with eager-loaded FlagEnvironment rows

5. Find the FlagEnvironment row matching the requested environment

6. Run evaluation algorithm (see Section 6)

7. Cache the result in Redis (TTL 30 s)

8. Return EvaluationResult { flagKey, value, reason }
```

---

## 3. Technology Choices and Reasoning

### NestJS (TypeScript)

NestJS provides an opinionated, Angular-inspired module system that makes large Node.js applications maintainable. The choice was deliberate:

- **Dependency injection** makes every service trivially testable by swapping providers with mocks, as demonstrated in `evaluation.service.spec.ts`.
- **Decorators + DTOs** via `class-validator` and `class-transformer` remove an entire category of input-validation bugs with almost zero boilerplate.
- **Guards and Middleware** offer clean hooks for cross-cutting concerns like API-key authentication and correlation IDs without polluting business logic.
- **EventEmitter integration** (`@nestjs/event-emitter`) enables internal pub/sub so `FlagsService` can emit `flag.changed` and `SseController` can react to it without any coupling between the two modules.
- **TypeScript** throughout gives compile-time safety, which is especially valuable in a service where incorrect flag values could affect production traffic.

### PostgreSQL (via TypeORM)

PostgreSQL is the primary store of record for all tenant, flag, and audit data.

- **JSONB columns** on `targeting`, `variants`, `defaultValue`, and audit `previousValue`/`newValue` allow flexible, schema-less extension without database migrations for each new targeting rule type.
- **UUID primary keys** avoid sequential ID enumeration attacks across tenants.
- **Composite unique indexes** (`tenantId + flagKey`, `flagId + environment`) enforce business invariants at the database level, not just in application code.
- **Immutable audit log** — the `audit_logs` table has only a `CreateDateColumn`, no update column, making accidental or malicious mutation of history structurally impossible.
- **Cloud SQL** (managed PostgreSQL on GCP) was chosen over self-managed Postgres to eliminate operational overhead: automated backups, HA failover in production (`REGIONAL` availability type), and private VPC connectivity without a bastion host.

### Redis (via ioredis)

Flag evaluation is a read-heavy, latency-sensitive operation. Redis serves as a short-lived cache layer:

- **30-second TTL** per evaluation result key means that after a flag change, staleness resolves within half a minute — an acceptable trade-off between freshness and database load.
- **ioredis** with `enableOfflineQueue: false` means Redis failures are silent: if Redis is down the service falls through to PostgreSQL rather than returning errors to callers. This makes Redis entirely optional for correctness.
- **Cache key structure** (`eval:{tenantId}:{environment}:{flagKey}:{userId}`) is scoped so that invalidation on a flag update can target a pattern like `eval:{tenantId}:*:{flagKey}:*`, preventing cross-tenant or cross-environment cache pollution.
- **GCP Memorystore** provides a managed, VPC-private Redis 7 instance, eliminating the need to manage Redis persistence, auth, or networking manually.

### Google Cloud Run

Cloud Run is a fully managed, serverless container platform that scales to zero when idle and scales out based on concurrent requests.

- **No VM management** — the team ships a Docker container and GCP handles scheduling, networking, health checks, and rollouts.
- **Traffic splitting** is a first-class Cloud Run primitive, which directly enables the blue-green and canary deployment strategy described in Section 8.
- **VPC connector** allows Cloud Run instances to reach Cloud SQL and Memorystore over private IP without exposing those services to the public internet.
- **Min instances = 2 in production** prevents cold starts from affecting availability under real traffic; non-production environments scale to zero to minimize cost.
- **Per-container resource limits** (1 vCPU, 512 Mi RAM) are deliberately modest — flag evaluation is CPU-light and memory-light, so multiple Cloud Run instances can coexist economically.

### Terraform

All GCP infrastructure is declared in Terraform HCL rather than created via the console or `gcloud` CLI. This provides:

- **Reproducibility** — any engineer can provision an identical staging environment with `terraform apply`.
- **Drift detection** — `terraform plan` in CI reveals if the live infrastructure diverges from the declared state.
- **GCS backend** (`feature-flag-service-tfstate`) stores state remotely so multiple team members and CI pipelines share a single source of truth without conflicts.
- **Environment parameterization** via `variables.tf` means the same configuration drives `development`, `staging`, and `production` with different tiers, availability types, and deletion-protection settings.

### GitHub Actions

- **Workload Identity Federation (WIF)** eliminates the need to store long-lived GCP service account JSON keys in GitHub Secrets. Instead, GitHub's OIDC token is exchanged for short-lived GCP credentials at runtime.
- **Parallel jobs** — lint/test, build/push, and deploy are separate jobs with `needs:` dependencies, so failures in testing block the build, and failures in the build block the deploy.
- **Layer caching** (`cache-from: type=gha`) on Docker builds dramatically reduces build time for unchanged layers.

---

## 4. Database Schema

### `tenants`

```
+------------------+----------------------+------------------------------------------------+
| Column           | Type                 | Constraints                                    |
+------------------+----------------------+------------------------------------------------+
| id               | uuid                 | PRIMARY KEY, default gen_random_uuid()         |
| name             | varchar              | NOT NULL, UNIQUE                               |
| slug             | varchar              | NOT NULL, UNIQUE                               |
| api_key_hash     | varchar              | NOT NULL  (bcrypt hash of the raw API key)     |
| is_active        | boolean              | NOT NULL, DEFAULT true                         |
| metadata         | jsonb                | NOT NULL, DEFAULT '{}'                         |
| created_at       | timestamptz          | NOT NULL, DEFAULT now()                        |
| updated_at       | timestamptz          | NOT NULL, DEFAULT now()                        |
+------------------+----------------------+------------------------------------------------+
```

**Notes:**
- `api_key_hash` stores only the bcrypt hash. The raw API key is returned once at tenant creation and never stored again.
- `slug` is a URL-safe identifier (e.g., `acme-corp`) used for human-readable references.
- `metadata` is a free-form JSONB column for tenant-level attributes (e.g., plan tier, contact info).

---

### `feature_flags`

```
+------------------+----------------------+------------------------------------------------+
| Column           | Type                 | Constraints                                    |
+------------------+----------------------+------------------------------------------------+
| id               | uuid                 | PRIMARY KEY                                    |
| tenant_id        | uuid                 | NOT NULL, FK --> tenants(id)                   |
| flag_key         | varchar              | NOT NULL  (e.g., "new-checkout-flow")          |
| name             | varchar              | NOT NULL  (human-readable label)               |
| description      | varchar              | NULLABLE                                       |
| type             | enum                 | NOT NULL  ('boolean' | 'string' | 'number')    |
| default_value    | jsonb                | NOT NULL  (value returned when flag is off)    |
| is_archived      | boolean              | NOT NULL, DEFAULT false                        |
| created_at       | timestamptz          | NOT NULL, DEFAULT now()                        |
| updated_at       | timestamptz          | NOT NULL, DEFAULT now()                        |
+------------------+----------------------+------------------------------------------------+

UNIQUE INDEX: (tenant_id, flag_key)
```

**Notes:**
- `flag_key` is the slug used in evaluation calls (e.g., `new-checkout-flow`). The `(tenant_id, flag_key)` unique index means two tenants can use identical flag keys without collision.
- `default_value` is JSONB to accommodate any flag type (`false`, `"control"`, `0`).
- Soft deletion via `is_archived` preserves audit history. Archived flags are excluded from evaluation queries but remain queryable for audit purposes.

---

### `flag_environments`

```
+--------------------+----------------------+--------------------------------------------+
| Column             | Type                 | Constraints                                |
+--------------------+----------------------+--------------------------------------------+
| id                 | uuid                 | PRIMARY KEY                                |
| flag_id            | uuid                 | NOT NULL, FK --> feature_flags(id)         |
| environment        | enum                 | NOT NULL  ('development'|'staging'|'prod') |
| is_enabled         | boolean              | NOT NULL, DEFAULT false                    |
| rollout_percentage | float                | NOT NULL, DEFAULT 0   (range: 0.0-100.0)  |
| targeting          | jsonb                | NOT NULL, DEFAULT '{}'                     |
| variants           | jsonb                | NULLABLE  (array of {value, weight})       |
+--------------------+----------------------+--------------------------------------------+

UNIQUE INDEX: (flag_id, environment)
```

**Notes:**
- One row is created per environment when a flag is first created, guaranteeing the evaluation service always finds a row rather than returning a null config.
- `variants` stores an ordered array such as `[{"value":"control","weight":50},{"value":"treatment","weight":50}]`. Weights are cumulative during evaluation.
- `targeting` is reserved for future attribute-based targeting rules (e.g., `{"country": "US"}`).

---

### `audit_logs`

```
+--------------------+----------------------+--------------------------------------------+
| Column             | Type                 | Constraints                                |
+--------------------+----------------------+--------------------------------------------+
| id                 | uuid                 | PRIMARY KEY                                |
| tenant_id          | uuid                 | NOT NULL  (denormalized for fast           |
|                    |                      | tenant-scoped queries without joining)     |
| flag_id            | uuid                 | NULLABLE  (preserved even if flag deleted) |
| flag_key           | varchar              | NOT NULL  (denormalized for readability)   |
| action             | varchar              | NOT NULL  ('CREATED'|'UPDATED'|'ARCHIVED') |
| changed_by         | uuid                 | NOT NULL  (tenant_id of the actor)         |
| previous_value     | jsonb                | NULLABLE  (full flag snapshot before)      |
| new_value          | jsonb                | NULLABLE  (full flag snapshot after)       |
| created_at         | timestamptz          | NOT NULL, DEFAULT now()                    |
+--------------------+----------------------+--------------------------------------------+

INDEX: (tenant_id, flag_key)
```

**Notes:**
- No `updated_at` column exists by design. Audit log rows are **immutable** — they can only be created, never updated or deleted through the application layer.
- `previous_value` and `new_value` store complete JSONB snapshots so any state can be reconstructed without replaying every event.
- `flag_key` is denormalized (also on the flag row) to allow human-readable audit queries without joining back to `feature_flags`.

---

## 5. API Documentation

All endpoints are prefixed with `/api/v1`. Requests and responses use `Content-Type: application/json`.

**Authentication:** Endpoints under `/tenants/:tenantId/flags` and `/tenants/:tenantId/flags/:flagKey/history` require an `x-api-key` header containing the raw API key issued at tenant creation. The Evaluation and SSE endpoints are unauthenticated by design (the `tenantId` in the body scopes the query; see Section 12 for the trade-off discussion).

---

### Health

#### `GET /api/v1/health`

No authentication required. Used by Cloud Run liveness and startup probes.

**Response `200 OK`:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-18T12:00:00.000Z",
  "database": "connected"
}
```

**Response (degraded):**
```json
{
  "status": "error",
  "timestamp": "2026-07-18T12:00:00.000Z",
  "database": "disconnected"
}
```

---

### Tenants

#### `POST /api/v1/tenants`

Provisions a new tenant. Returns the plaintext API key **once only** — it is not stored and cannot be retrieved again.

**Request body:**
```json
{
  "name": "Acme Corporation",
  "slug": "acme-corp"
}
```

**Response `201 Created`:**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Acme Corporation",
  "slug": "acme-corp",
  "apiKey": "ffs_live_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV",
  "message": "Store this API key securely — it will not be shown again",
  "createdAt": "2026-07-18T12:00:00.000Z"
}
```

---

#### `GET /api/v1/tenants`

Returns all tenants (admin endpoint; no auth in current implementation).

**Response `200 OK`:**
```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Acme Corporation",
    "slug": "acme-corp",
    "isActive": true,
    "metadata": {},
    "createdAt": "2026-07-18T12:00:00.000Z",
    "updatedAt": "2026-07-18T12:00:00.000Z"
  }
]
```

---

#### `GET /api/v1/tenants/:id`

Returns a single tenant by UUID.

**Response `200 OK`:**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Acme Corporation",
  "slug": "acme-corp",
  "isActive": true,
  "metadata": {},
  "createdAt": "2026-07-18T12:00:00.000Z",
  "updatedAt": "2026-07-18T12:00:00.000Z"
}
```

---

### Feature Flags

All endpoints below require `x-api-key: <tenant-api-key>` and will reject with `401 Unauthorized` if absent or invalid, or `403 Forbidden` if the API key belongs to a different tenant than the `:tenantId` in the path.

---

#### `POST /api/v1/tenants/:tenantId/flags`

Creates a new feature flag. Three environment rows (`development`, `staging`, `production`) are automatically created.

**Request body (boolean flag):**
```json
{
  "flagKey": "new-checkout-flow",
  "name": "New Checkout Flow",
  "description": "Enables the redesigned checkout experience",
  "type": "boolean",
  "defaultValue": false,
  "environments": [
    {
      "environment": "development",
      "isEnabled": true,
      "rolloutPercentage": 100
    },
    {
      "environment": "production",
      "isEnabled": false,
      "rolloutPercentage": 0
    }
  ]
}
```

**Request body (string flag with A/B variants):**
```json
{
  "flagKey": "checkout-button-copy",
  "name": "Checkout Button Copy",
  "type": "string",
  "defaultValue": "Buy Now",
  "environments": [
    {
      "environment": "production",
      "isEnabled": true,
      "rolloutPercentage": 100,
      "variants": [
        { "value": "Buy Now",        "weight": 50 },
        { "value": "Complete Order", "weight": 50 }
      ]
    }
  ]
}
```

**Response `201 Created`:**
```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "tenantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "flagKey": "new-checkout-flow",
  "name": "New Checkout Flow",
  "description": "Enables the redesigned checkout experience",
  "type": "boolean",
  "defaultValue": false,
  "isArchived": false,
  "environments": [
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "flagId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "environment": "development",
      "isEnabled": true,
      "rolloutPercentage": 100,
      "targeting": {},
      "variants": null
    },
    {
      "id": "d4e5f6a7-b8c9-0123-defa-234567890123",
      "flagId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "environment": "staging",
      "isEnabled": false,
      "rolloutPercentage": 0,
      "targeting": {},
      "variants": null
    },
    {
      "id": "e5f6a7b8-c9d0-1234-efab-345678901234",
      "flagId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "environment": "production",
      "isEnabled": false,
      "rolloutPercentage": 0,
      "targeting": {},
      "variants": null
    }
  ],
  "createdAt": "2026-07-18T12:00:00.000Z",
  "updatedAt": "2026-07-18T12:00:00.000Z"
}
```

**Error `409 Conflict`** — flag key already exists for this tenant:
```json
{
  "statusCode": 409,
  "message": "Flag with key 'new-checkout-flow' already exists",
  "error": "Conflict"
}
```

---

#### `GET /api/v1/tenants/:tenantId/flags`

Returns all flags for a tenant. Optional query parameters filter by environment or status.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `environment` | string | Filter to flags that have a config for this environment (`development`, `staging`, `production`) |
| `status` | string | `active` (default), `archived`, or omit for all |

**Example:** `GET /api/v1/tenants/:tenantId/flags?environment=production&status=active`

**Response `200 OK`:**
```json
[
  {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "tenantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "flagKey": "new-checkout-flow",
    "name": "New Checkout Flow",
    "type": "boolean",
    "defaultValue": false,
    "isArchived": false,
    "environments": [ "..." ],
    "createdAt": "2026-07-18T12:00:00.000Z",
    "updatedAt": "2026-07-18T12:00:00.000Z"
  }
]
```

---

#### `PUT /api/v1/tenants/:tenantId/flags/:flagKey`

Updates flag metadata and/or a specific environment's configuration. Partial updates are supported — only include the fields you wish to change.

**Request body:**
```json
{
  "name": "New Checkout Flow (Updated)",
  "environment": "production",
  "isEnabled": true,
  "rolloutPercentage": 10,
  "variants": null
}
```

**Response `200 OK`:** Returns the full updated flag object (same shape as the create response).

**Audit log effect:** A row is written with `action: "UPDATED"`, capturing the full before and after snapshots.

---

#### `DELETE /api/v1/tenants/:tenantId/flags/:flagKey`

Archives a flag (soft delete). The flag is excluded from future evaluations and list results (unless `?status=archived` is used) but all data and audit history are retained.

**Response `204 No Content`**

---

### Evaluation

Evaluation endpoints are public (no API key required). The `tenantId` in the request body scopes the query.

---

#### `POST /api/v1/evaluate`

Evaluates a single named flag for a given user in a given environment.

**Request body:**
```json
{
  "tenantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "environment": "production",
  "userId": "user-7a3f9b",
  "flagKey": "new-checkout-flow",
  "context": {
    "country": "US",
    "plan": "enterprise"
  }
}
```

**Response `200 OK` (flag enabled, user in rollout):**
```json
{
  "flagKey": "new-checkout-flow",
  "value": true,
  "reason": "ENABLED"
}
```

**Response `200 OK` (result served from Redis):**
```json
{
  "flagKey": "new-checkout-flow",
  "value": true,
  "reason": "CACHED"
}
```

**Possible `reason` values:**

| Reason | Description |
|---|---|
| `ENABLED` | Flag is on and user is within rollout; no variants |
| `CACHED` | Result was served from Redis cache |
| `FLAG_DISABLED` | The flag's `isEnabled` is `false` for this environment |
| `NOT_IN_ROLLOUT` | Flag is enabled but user's hash bucket falls outside `rolloutPercentage` |
| `VARIANT_MATCH` | A string flag variant was selected via weighted bucket assignment |

**Error `404 Not Found`:**
```json
{
  "statusCode": 404,
  "message": "Flag 'new-checkout-flow' not found",
  "error": "Not Found"
}
```

---

#### `POST /api/v1/evaluate/bulk`

Evaluates all active flags for a tenant in a single request. Useful for SDK initialisation.

**Request body:**
```json
{
  "tenantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "environment": "production",
  "userId": "user-7a3f9b"
}
```

**Response `200 OK`:**
```json
{
  "flags": [
    {
      "flagKey": "new-checkout-flow",
      "value": true,
      "reason": "ENABLED"
    },
    {
      "flagKey": "checkout-button-copy",
      "value": "Complete Order",
      "reason": "VARIANT_MATCH"
    },
    {
      "flagKey": "dark-mode",
      "value": false,
      "reason": "FLAG_DISABLED"
    }
  ],
  "count": 3
}
```

---

### Audit History

#### `GET /api/v1/tenants/:tenantId/flags/:flagKey/history`

**Auth:** `x-api-key` required.

Returns the full audit trail for a specific flag in chronological order.

**Response `200 OK`:**
```json
[
  {
    "id": "f6a7b8c9-d0e1-2345-fabc-456789012345",
    "tenantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "flagId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "flagKey": "new-checkout-flow",
    "action": "CREATED",
    "changedBy": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "previousValue": null,
    "newValue": {
      "flagKey": "new-checkout-flow",
      "isEnabled": false,
      "rolloutPercentage": 0
    },
    "createdAt": "2026-07-18T12:00:00.000Z"
  },
  {
    "id": "a7b8c9d0-e1f2-3456-abcd-567890123456",
    "tenantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "flagId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "flagKey": "new-checkout-flow",
    "action": "UPDATED",
    "changedBy": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "previousValue": { "isEnabled": false, "rolloutPercentage": 0 },
    "newValue":     { "isEnabled": true,  "rolloutPercentage": 10 },
    "createdAt": "2026-07-18T13:30:00.000Z"
  }
]
```

---

### Server-Sent Events

#### `GET /api/v1/sse/flags?tenantId=:id&environment=:env`

No authentication required. Opens a persistent HTTP connection and streams `flag.changed` events in SSE format. The client must handle reconnection.

**Example stream output:**
```
data: {"tenantId":"a1b2c3d4-...","flagKey":"new-checkout-flow","action":"UPDATED","environment":"production","flag":{...}}

data: {"tenantId":"a1b2c3d4-...","flagKey":"dark-mode","action":"ARCHIVED"}
```

**Client usage (browser):**
```javascript
const es = new EventSource(
  '/api/v1/sse/flags?tenantId=a1b2c3d4-...&environment=production'
);
es.onmessage = (event) => {
  const change = JSON.parse(event.data);
  console.log('Flag changed:', change.flagKey, change.action);
};
```

---

## 6. Flag Evaluation Algorithm

The evaluation engine is the performance-critical core of the service. It must be **deterministic** (the same user always gets the same value for a flag at a given rollout percentage), **fast** (sub-millisecond computation once data is in memory), and **tenant-safe** (one tenant's flags never affect another's evaluation).

### High-Level Decision Tree

```
evaluate(tenantId, environment, userId, flagKey)
  |
  +--> Check Redis cache
  |      HIT  --> return cached result (reason = CACHED)
  |      MISS --> continue
  |
  +--> Load FeatureFlag from PostgreSQL
  |      WHERE tenantId = ? AND flagKey = ? AND isArchived = false
  |      NOT FOUND --> throw NotFoundException
  |
  +--> Find FlagEnvironment for the requested environment
  |
  +--> Is envConfig.isEnabled == false?
  |      YES --> return { value: flag.defaultValue, reason: FLAG_DISABLED }
  |
  +--> Is envConfig.rolloutPercentage < 100?
  |      YES --> compute bucket = SHA256_hash(flagKey, userId) % 100
  |             bucket >= rolloutPercentage?
  |               YES --> return { value: flag.defaultValue, reason: NOT_IN_ROLLOUT }
  |
  +--> Is flag.type == STRING and envConfig.variants is non-empty?
  |      YES --> compute bucket = SHA256_hash(flagKey, userId) % 100
  |             walk variants accumulating cumulative weights
  |             first variant where bucket < cumulative
  |               --> return { value: variant.value, reason: VARIANT_MATCH }
  |
  +--> return { value: true (boolean) or flag.defaultValue (others), reason: ENABLED }
```

### SHA-256 Consistent Hashing

```typescript
private computeHash(flagKey: string, userId: string): number {
  // Concatenate flagKey and userId with a separator to prevent
  // collisions like flagKey="ab", userId="c" vs flagKey="a", userId="bc"
  const input = `${flagKey}:${userId}`;

  // SHA-256 produces a 256-bit (64 hex character) digest
  const digest = createHash('sha256').update(input).digest('hex');

  // Take the first 8 hex characters --> 32-bit unsigned integer
  // Maximum value: 0xFFFFFFFF = 4,294,967,295
  const value = parseInt(digest.substring(0, 8), 16);

  // Map to [0, 99] range
  return value % 100;
}
```

**Why SHA-256?**
- Cryptographically uniform distribution ensures the 100 buckets are evenly populated across arbitrary user IDs (numeric, UUIDs, email addresses, etc.).
- Deterministic: given the same inputs, it always produces the same digest, so a user's bucket assignment never changes unless the flag key or user ID changes.
- The `flagKey` is part of the hash input so user `u1` can be in bucket 23 for `flag-A` and bucket 71 for `flag-B`. Without this, all flags would grant or deny the same population of users.

### Pseudocode

```
FUNCTION evaluate(tenantId, environment, userId, flagKey):

  // Step 1: Cache check
  cacheKey <- "eval:" + tenantId + ":" + environment + ":" + flagKey + ":" + userId
  cached <- redis.GET(cacheKey)
  IF cached IS NOT NULL:
    RETURN parse(cached) WITH reason = "CACHED"

  // Step 2: Load flag
  flag <- db.query(
    "SELECT * FROM feature_flags
     WHERE tenant_id = ? AND flag_key = ? AND is_archived = false",
    [tenantId, flagKey]
  )
  IF flag IS NULL:
    RAISE NotFoundException

  // Step 3: Find environment config
  envConfig <- flag.environments.find(e -> e.environment == environment)

  // Step 4: Disabled check
  IF envConfig IS NULL OR envConfig.isEnabled == false:
    result <- { flagKey, value: flag.defaultValue, reason: "FLAG_DISABLED" }
    redis.SETEX(cacheKey, 30, serialize(result))
    RETURN result

  // Step 5: Rollout check
  IF envConfig.rolloutPercentage < 100:
    bucket <- SHA256(flagKey + ":" + userId) AS 32-bit integer % 100
    IF bucket >= envConfig.rolloutPercentage:
      result <- { flagKey, value: flag.defaultValue, reason: "NOT_IN_ROLLOUT" }
      redis.SETEX(cacheKey, 30, serialize(result))
      RETURN result

  // Step 6: Variant selection (A/B test)
  IF flag.type == "string" AND envConfig.variants IS NOT EMPTY:
    bucket <- SHA256(flagKey + ":" + userId) AS 32-bit integer % 100
    cumulative <- 0
    FOR EACH variant IN envConfig.variants:
      cumulative <- cumulative + variant.weight
      IF bucket < cumulative:
        result <- { flagKey, value: variant.value, reason: "VARIANT_MATCH" }
        redis.SETEX(cacheKey, 30, serialize(result))
        RETURN result

  // Step 7: Default enabled
  resolvedValue <- (flag.type == "boolean") ? true : flag.defaultValue
  result <- { flagKey, value: resolvedValue, reason: "ENABLED" }
  redis.SETEX(cacheKey, 30, serialize(result))
  RETURN result
```

### Variant Selection Example

Given a flag with `rolloutPercentage: 100` and variants:
```json
[
  { "value": "control",   "weight": 50 },
  { "value": "treatment", "weight": 50 }
]
```

For `userId = "user-7a3f9b"` and `flagKey = "checkout-button-copy"`:

```
input      = "checkout-button-copy:user-7a3f9b"
sha256     = "3e4a71f2..."
bucket     = parseInt("3e4a71f2", 16) % 100
           = 1044631026 % 100
           = 26

cumulative after "control"   = 50  -->  26 < 50  --> SELECTED
result: value = "control", reason = "VARIANT_MATCH"
```

The same user will always receive `"control"` regardless of when or how many times they call evaluate, because the hash is deterministic. This is the fundamental property that makes percentage rollouts meaningful: users do not flip between variants across requests.

---

## 7. Infrastructure Architecture

### GCP Services Used

| Service | Purpose |
|---|---|
| **Cloud Run** | Hosts the NestJS API; serverless, auto-scaling, traffic-splitting |
| **Cloud SQL (PostgreSQL 16)** | Primary relational store; private VPC, automated backups |
| **Memorystore (Redis 7)** | Evaluation result cache; VPC-private, no public IP |
| **Artifact Registry** | Docker image storage; source for Cloud Run deployments |
| **Secret Manager** | Stores the database password; injected into Cloud Run at startup |
| **VPC Network + Subnet** | Private network (`10.0.0.0/24`) isolating all data services |
| **VPC Access Connector** | Bridge allowing Cloud Run to reach Cloud SQL and Memorystore |
| **Private Service Networking** | VPC peering for Cloud SQL private IP |
| **Cloud Monitoring** | Alert policies for error rate > 5% and p95 latency > 1 s |
| **GCS (Terraform backend)** | Stores Terraform state file (`feature-flag-service-tfstate`) |

### VPC Layout

```
VPC: feature-flag-service-vpc
|
+-- Subnet: feature-flag-service-subnet (10.0.0.0/24)
|     |
|     +-- VPC Access Connector (200-1000 Mbps throughput)
|     |     |
|     |     +-- Bridges Cloud Run <--> private resources
|     |
|     +-- Cloud SQL PostgreSQL (private IP -- no public IPv4)
|     +-- Memorystore Redis     (private IP -- no public IP)
|
+-- Private Service Access (VPC Peering)
      |
      +-- google-managed-services range (/16) for Cloud SQL
```

All database traffic traverses private IP ranges inside GCP's network fabric. There is no public endpoint for Cloud SQL or Redis. Cloud Run pods egress only to private ranges (`egress: PRIVATE_RANGES_ONLY`).

### Secrets Management

Database credentials flow as follows:

1. Terraform generates a 32-character random password via `random_password`.
2. The password is stored in **Secret Manager** as `feature-flag-service-db-password`.
3. The Cloud Run service account is granted `roles/secretmanager.secretAccessor` on that secret.
4. The Cloud Run container template references the secret via `value_source.secret_key_ref` — GCP injects it as an environment variable at container startup.
5. The application reads it via `process.env.DB_PASSWORD` through NestJS `ConfigService`.

No secrets ever appear in source code, Terraform outputs, or GitHub Actions logs.

### Cloud Run Scaling Configuration

| Setting | Production | Non-Production |
|---|---|---|
| `min_instance_count` | 2 | 0 (scale to zero) |
| `max_instance_count` | 10 | 10 |
| CPU | 1 vCPU | 1 vCPU |
| Memory | 512 Mi | 512 Mi |
| Concurrency | Default (80) | Default (80) |

With `min_instance_count: 2` in production, there are always two warm instances ready to serve traffic without cold-start latency. Instances scale out automatically when concurrent requests per instance approach capacity.

---

## 8. Deployment Strategy

### Blue-Green via Cloud Run Traffic Splitting

Cloud Run natively supports multiple named revisions with percentage-based traffic routing. The blue-green strategy maps naturally onto this capability:

- **Blue** = the currently live revision receiving 100% of production traffic
- **Green** = the newly built revision initially receiving 0% of traffic

### Production Deployment Pipeline (step by step)

**Step 1 — Deploy green at 0% traffic**

```bash
gcloud run services update-traffic feature-flag-service \
  --region=us-central1 \
  --image=IMAGE_TAG \
  --no-traffic
```

The new revision is deployed, passes startup probes, and is warm — but receives no user traffic.

**Step 2 — Canary at 10%**

```bash
NEW_REVISION=$(gcloud run services describe feature-flag-service \
  --region=us-central1 \
  --format='value(status.latestCreatedRevisionName)')

gcloud run services update-traffic feature-flag-service \
  --region=us-central1 \
  --to-revisions="${NEW_REVISION}=10"
```

10% of production requests are routed to the green revision. The blue revision continues to handle 90%.

**Step 3 — Canary validation (60-second observation window)**

The pipeline reads recent Cloud Logging error counts for the new revision. If more than 5 errors are observed in the 60-second window:

```bash
# Automatic rollback: revert all traffic to blue
gcloud run services update-traffic feature-flag-service \
  --region=us-central1 \
  --to-latest
exit 1
```

Because the blue revision is still running and handling 90% of traffic, rollback is instantaneous — it is simply a traffic weight adjustment, not a redeployment.

**Step 4 — Full promotion to 100%**

If validation passes:

```bash
gcloud run services update-traffic feature-flag-service \
  --region=us-central1 \
  --to-latest
```

All traffic moves to the green revision. The blue revision remains deployed (retained by Cloud Run's revision history) and can be restored in seconds if a problem emerges post-promotion.

**Step 5 — Tag the stable revision**

```bash
gcloud run services update-traffic feature-flag-service \
  --region=us-central1 \
  --update-tags=stable=LATEST_REVISION_NAME
```

The `stable` tag allows the previous good revision to be addressed by name for emergency rollback: `--to-revisions=stable=100`.

### Staging Deployment Pipeline

Staging uses a simplified variant of the same pattern:

1. Deploy new revision with the `canary` traffic tag and `--no-traffic`.
2. Run a smoke test against the tag-specific URL (only the new revision).
3. If the health check returns 200, promote to `--to-latest` (100% traffic).

### Rollback Procedure

**During canary (automated):** The pipeline rolls back automatically if the error threshold is breached.

**Post-promotion (manual):** An engineer executes:

```bash
# Roll back to the revision tagged 'stable'
gcloud run services update-traffic feature-flag-service \
  --region=us-central1 \
  --to-revisions=stable=100
```

This takes effect within seconds with no redeployment required.

---

## 9. Local Development Setup

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20 LTS | Runtime |
| npm | 10+ | Package management |
| Docker | 24+ | Local PostgreSQL and Redis via Compose |
| Docker Compose | v2 | Orchestrates local service stack |

### Step-by-Step Setup

**1. Clone the repository**

```bash
git clone https://github.com/your-org/feature-flag-service.git
cd feature-flag-service
```

**2. Install dependencies**

```bash
npm install
```

**3. Configure environment variables**

The application reads configuration from environment variables. For local development, Docker Compose injects them directly (see `docker-compose.yml`). No `.env` file is required when using Compose. If you want to run the API outside Docker (e.g., `npm run start:dev` against a local Postgres), create a `.env` file at the project root:

```dotenv
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=featureflags
DB_SSL=false

REDIS_HOST=localhost
REDIS_PORT=6379
```

**4. Start the full stack with Docker Compose**

```bash
docker-compose up --build
```

This starts three containers:
- `postgres` — PostgreSQL 16 on port `5432`, with a health check
- `redis` — Redis 7 on port `6379`, with a health check
- `api` — NestJS application on port `3000`, in watch mode (`nest start --watch`)

TypeORM's `synchronize: true` (enabled in non-production environments) automatically creates all tables on first boot. You do not need to run migrations manually in development.

Wait for the following log line before sending requests:

```json
{"level":"info","message":"App listening on port 3000","timestamp":"..."}
```

**5. Verify the service is healthy**

```bash
curl http://localhost:3000/api/v1/health
```

Expected response:

```json
{"status":"ok","timestamp":"2026-07-18T12:00:00.000Z","database":"connected"}
```

**6. Create a tenant**

```bash
curl -s -X POST http://localhost:3000/api/v1/tenants \
  -H "Content-Type: application/json" \
  -d '{"name": "My Company", "slug": "my-company"}' | jq .
```

Save the returned `id` and `apiKey`.

**7. Create a feature flag**

```bash
TENANT_ID="<id from step 6>"
API_KEY="<apiKey from step 6>"

curl -s -X POST "http://localhost:3000/api/v1/tenants/${TENANT_ID}/flags" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -d '{
    "flagKey": "dark-mode",
    "name": "Dark Mode",
    "type": "boolean",
    "defaultValue": false,
    "environments": [
      {
        "environment": "development",
        "isEnabled": true,
        "rolloutPercentage": 100
      }
    ]
  }' | jq .
```

**8. Evaluate the flag**

```bash
curl -s -X POST http://localhost:3000/api/v1/evaluate \
  -H "Content-Type: application/json" \
  -d "{
    \"tenantId\": \"${TENANT_ID}\",
    \"environment\": \"development\",
    \"userId\": \"user-abc123\",
    \"flagKey\": \"dark-mode\"
  }" | jq .
```

Expected: `{"flagKey":"dark-mode","value":true,"reason":"ENABLED"}`

**9. Run tests**

```bash
# Unit tests
npm test

# Unit tests with coverage report
npm run test:cov

# Integration / e2e tests (requires running Postgres + Redis)
npm run test:e2e
```

**10. Stop the stack**

```bash
docker-compose down       # stops containers, preserves volumes
docker-compose down -v    # stops containers and deletes volumes (clean slate)
```

---

## 10. Testing Strategy

### Unit Tests

**Location:** `src/**/*.spec.ts` — run with `npm test`

**What is tested:**

**Evaluation engine** (`evaluation.service.spec.ts`)

The most critical logic in the service is the evaluation algorithm. The unit tests verify:

| Test | Rationale |
|---|---|
| Same input always produces the same bucket | Proves determinism. A user must never flip between feature values on repeated calls (absent a config change). |
| Bucket always in [0, 99] | Proves the modulo reduction is correct and bounds are respected. |
| Different users produce a spread of buckets | Proves the hash distribution is not degenerate (not all users landing in the same bucket). |
| `FLAG_DISABLED` returned when `isEnabled: false` | Proves the guard condition is checked before rollout math. |
| `ENABLED` returned at 100% rollout | Happy path — verifies a boolean flag returns `true` for all users when fully rolled out. |
| `NOT_IN_ROLLOUT` returned at 0% rollout | Proves the rollout boundary condition: no user receives the treatment when rollout is 0. |
| Determinism across two calls at 50% rollout | Even at partial rollout, the same user gets the same answer on repeated calls. |
| Correct variant selected on string flag | The correct variant is returned and `VARIANT_MATCH` reason is set. |
| `NotFoundException` for a missing flag | API surface contract is enforced. |
| Bulk evaluation returns all flags for the tenant | Proves the bulk path iterates all flags in the tenant namespace. |
| 50% rollout distributes evenly over 1 000 users | Statistical test with a +/- 10% margin; verifies the hash function is not systematically biased. |

All external dependencies (PostgreSQL repository, Redis) are replaced with `jest.fn()` mocks so tests are deterministic, fast (milliseconds), and runnable without any infrastructure.

**Tenant service** (`tenants.service.spec.ts`)

Verifies that tenant creation hashes the API key with bcrypt and that the hash is subsequently verifiable with the original plaintext key.

### Integration (End-to-End) Tests

**Location:** `test/` — run with `npm run test:e2e`

**Requirements:** A running PostgreSQL instance and Redis instance (provided by Docker Compose services in CI, or a local Compose stack during development).

`tenant-isolation.e2e-spec.ts` boots the full NestJS application and verifies the most important multi-tenancy invariant:

| Test | Rationale |
|---|---|
| Tenant A can create a flag using its API key | Baseline: authenticated operations succeed |
| Tenant B's key is rejected when accessing Tenant A's route | Proves cross-tenant write prevention at the guard layer |
| Tenant B cannot list Tenant A's flags | Proves cross-tenant read prevention |
| Tenant A cannot see flags created by Tenant B | Proves data isolation is bidirectional |
| Unauthenticated requests return 401 | Proves missing API key is rejected before any business logic runs |

These tests catch bugs that unit tests cannot: ORM query scoping errors, guard misconfiguration, or incorrect tenant resolution from the request context.

### Load Tests

**Location:** `load-test/load-test.js` — run with k6

See Section 11 for full details.

### What Would Be Added with More Time

- **Mutation / property-based testing** on the hash function using `fast-check` to prove uniform distribution over a much larger input space than the current 1 000-user sample.
- **Contract tests** (Pact) if an SDK client were developed, to ensure the API response shape never breaks downstream consumers without a failing test.
- **Chaos tests** — inject Redis failures mid-request and verify the service falls back to PostgreSQL without returning errors to callers.
- **Performance regression tests in CI** — run the k6 load test against every pull request targeting main and fail the build if p95 exceeds the threshold.
- **Coverage enforcement** — gate pull requests on a minimum branch coverage target (e.g., 80%).
- **SSE integration test** — verify that a flag update causes an SSE event to be delivered to a connected subscriber within 1 second.

---

## 11. Load Test Results

### Test Tool and Configuration

The load test is implemented in **k6** (`load-test/load-test.js`) and targets the two highest-traffic endpoints: single flag evaluation (`POST /api/v1/evaluate`) and bulk evaluation (`POST /api/v1/evaluate/bulk`).

### Traffic Profile

```
Stage 1 (0s  - 30s):  ramp from   0 -->  50 virtual users
Stage 2 (30s - 90s):  ramp from  50 --> 100 virtual users
Stage 3 (90s - 120s): ramp from 100 --> 200 virtual users
Stage 4 (120s- 150s): ramp from 200 -->   0 virtual users (cool-down)
```

Each virtual user sends one single-evaluation request and one bulk-evaluation request per iteration, separated by a 100 ms sleep. At peak (200 VUs), this represents approximately 1 800 requests per second across both endpoints.

### Defined Pass/Fail Thresholds

```javascript
thresholds: {
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  errors:            ['rate<0.05'],
}
```

| Metric | Threshold | Rationale |
|---|---|---|
| p95 response time | < 500 ms | 95% of evaluations must complete within half a second, meeting typical SDK timeout budgets |
| p99 response time | < 1 000 ms | The 99th percentile accounts for slow database queries on cache misses and GC pauses |
| Error rate | < 5% | Service must remain available under peak load; errors above 5% indicate saturation or a misconfiguration |

### Expected Results

Since the service has not yet been deployed to a GCP production environment, the following are expected results based on the architecture design and the performance characteristics of each component.

**Cache-warm scenario (Redis hit rate approximately 90%):**

| Metric | Expected Value |
|---|---|
| p50 latency | 5 - 15 ms |
| p95 latency | 50 - 80 ms |
| p99 latency | 150 - 200 ms |
| Error rate | < 0.1% |
| Throughput | 1 500 - 2 000 req/s |

At a 90% cache hit rate, the evaluation path is: Redis GET (network RTT approximately 1 ms within GCP) → JSON parse → return. No PostgreSQL query is needed.

**Cache-cold scenario (first request per user per flag):**

| Metric | Expected Value |
|---|---|
| p50 latency | 20 - 50 ms |
| p95 latency | 200 - 350 ms |
| p99 latency | 600 - 800 ms |
| Error rate | < 1% |

Cold-path latency is bounded by the Cloud SQL query time plus a Redis SET. With private VPC connectivity and an indexed query on `(tenant_id, flag_key)`, the PostgreSQL response is expected to be under 10 ms for typical flag counts per tenant.

**Rationale for thresholds:**

The `p95 < 500 ms` and `p99 < 1000 ms` thresholds are deliberately conservative to accommodate worst-case scenarios: a cold cache, the database under write load from concurrent flag updates, or a burst of new users whose results are not yet cached. The 5% error threshold allows for transient connection errors during Cloud Run scale-out events without failing the test immediately.

### Running the Load Test

```bash
# Install k6 from https://k6.io/docs/getting-started/installation/

# Against the local Docker Compose stack
# (requires a seeded tenantId with at least one flag in production environment)
k6 run \
  -e BASE_URL=http://localhost:3000 \
  -e TENANT_ID=<your-tenant-uuid> \
  load-test/load-test.js

# Against a deployed Cloud Run URL
k6 run \
  -e BASE_URL=https://feature-flag-service-<hash>-uc.a.run.app \
  -e TENANT_ID=<your-tenant-uuid> \
  load-test/load-test.js
```

---

## 12. Assumptions and Trade-offs

### 1. TypeORM `synchronize: true` in Development

**Decision:** `synchronize: true` is enabled whenever `NODE_ENV` is not `production`. TypeORM automatically alters the database schema to match the entity definitions on application startup.

**Rationale:** It eliminates friction during development and makes the integration test suite self-contained — no migration files need to be applied before running `npm run test:e2e`.

**Trade-off:** `synchronize: true` is explicitly disabled in production (`config.get('NODE_ENV') !== 'production'` in `app.module.ts`). Schema changes in production require a proper migration file reviewed as part of a pull request. The risk of accidentally enabling it in production is mitigated by the environment variable check. The downside is that schema drift in development is silently resolved by synchronize rather than surfacing as a failing migration — a considered trade-off for developer ergonomics in a time-boxed project.

---

### 2. Redis is Optional and Fail-Open

**Decision:** All Redis operations in `RedisService` (`get`, `set`, `del`, `delPattern`) are wrapped in try/catch blocks that silently swallow errors. A Redis failure causes the service to skip caching entirely and fall through to PostgreSQL on every request.

**Rationale:** Feature flag evaluation is a critical path for many callers. A Redis outage should degrade performance — higher PostgreSQL load — but must not cause API errors. The service remains completely correct without Redis.

**Trade-off:** Engineers monitoring the service need to watch for elevated PostgreSQL query rates as an indirect signal of Redis health, since the API error rate will not spike when Redis fails. Alerts are configured in Terraform on both error rate and latency, so elevated latency from cache bypasses will surface through Cloud Monitoring. This was acceptable given that GCP Memorystore has high availability and the PostgreSQL load at 200 VUs is well within Cloud SQL capacity.

---

### 3. Evaluation Endpoints are Unauthenticated

**Decision:** `POST /api/v1/evaluate` and `POST /api/v1/evaluate/bulk` do not require an API key. The `tenantId` in the request body scopes all database queries.

**Rationale:** Feature flag evaluation is typically called from client-side applications — browsers, mobile apps — where an API key cannot be kept secret. Any user inspecting network traffic would see it. The data exposed (flag values for a known tenant ID) is already visible to the end user through the UI the flag controls. Requiring authentication on the evaluation path would create false security while adding friction for SDK developers.

**Trade-off:** A caller who knows a `tenantId` can enumerate flag evaluations for that tenant. Mitigation in a future version: a separate, read-only SDK key scoped specifically to evaluation, distinct from the management API key that controls flag configuration. The rate limiter (1 000 req/min per IP) limits bulk enumeration attempts.

---

### 4. Audit Log Immutability

**Decision:** The `audit_logs` table has no `updated_at` column and no application-layer update or delete endpoint. Rows are strictly insert-only.

**Rationale:** An audit trail only has value if it cannot be altered after the fact. Even if a flag is archived, the change history must be preserved for compliance, debugging production incidents, and understanding the historical context of a flag's behavior. The database schema enforces this structurally — there is no application code path that executes `UPDATE audit_logs` or `DELETE FROM audit_logs`.

**Trade-off:** Audit logs will grow indefinitely. In a production system operated over months or years, a retention policy is necessary — for example, archiving rows older than 90 days to Cloud Storage as NDJSON and removing them from the hot PostgreSQL table. This was identified but deferred as a future improvement (see Section 13).

---

### 5. Rate Limiting by IP, Not by Tenant

**Decision:** `ThrottlerModule` limits to 1 000 requests per minute per IP address, not per tenant API key.

**Rationale:** IP-based limiting is natively supported by `@nestjs/throttler` with zero additional configuration and does not require any changes to the authentication flow. It provides adequate protection against naive scraping, accidental tight-loop calls, and simple denial-of-service attempts.

**Trade-off:** A tenant operating behind a shared corporate NAT would share a rate limit with other tenants on the same egress IP address. Conversely, a malicious tenant with many source IPs could exceed the intended per-tenant limit. For the scope of this assessment, IP-based limiting was the pragmatic choice. The correct production approach is to attach the rate-limit counter to the resolved tenant after API key verification.

---

### 6. bcrypt for API Key Hashing

**Decision:** API keys are hashed with `bcryptjs` (12 rounds) before storage. The `ApiKeyGuard` verifies an incoming key by bcrypt-comparing it against every active tenant's stored hash.

**Rationale:** bcrypt is the industry standard for hashing secrets that must be verifiable without storing the plaintext. If the database is compromised, attackers cannot reverse the hashes to obtain the original API keys.

**Trade-off:** bcrypt is intentionally slow (that is its security property). At 12 rounds, a single comparison takes approximately 100-300 ms on modern hardware. The guard iterates through all active tenants sequentially, making authentication O(N) in the number of tenants. At small tenant counts (tens to hundreds), this is imperceptible. At large counts (thousands), this becomes a significant latency bottleneck. The production solution is to cache a mapping of `sha256(apiKey) -> tenantId` in Redis with a short TTL, reducing authentication to a single O(1) Redis lookup on repeat requests.

---

## 13. Future Improvements

### 1. Webhook / Callback Delivery on Flag Change

Currently, the SSE endpoint delivers real-time changes only to clients maintaining a persistent HTTP connection. Many server-side consumers — microservices, background workers, third-party integrations — cannot maintain long-lived connections. A webhook system would allow tenants to register one or more HTTPS callback URLs per tenant. When `FlagsService` emits `flag.changed`, a worker would POST the event payload to each registered URL, with exponential-backoff retry logic and a dead-letter queue for permanently failing deliveries. This is the pattern used by LaunchDarkly, Stripe, and GitHub to push events to arbitrary consumers.

### 2. Attribute-Based (Contextual) Targeting

The `targeting` JSONB column on `flag_environments` is included in the schema but is not yet evaluated by the evaluation engine. A future version would define a targeting rule DSL:

```json
{
  "operator": "ALL",
  "rules": [
    { "attribute": "country", "operator": "IN",    "values": ["US", "CA"] },
    { "attribute": "plan",    "operator": "EQUALS", "value": "enterprise"  }
  ]
}
```

Attributes would be drawn from the `context` map already accepted by `EvaluateDto`. This enables targeting rules like "enable this flag only for enterprise-plan users in North America" without changing rollout percentages.

### 3. Role-Based Access Control (RBAC)

Every holder of a tenant's API key currently has full read/write access to all flag management operations. A production multi-user system requires fine-grained roles:

- **Admin** — can create tenants, manage members, rotate API keys
- **Editor** — can create, update, and archive flags
- **Viewer** — read-only access to flag config and audit history
- **SDK Key** — evaluation-only access, cannot read or modify flag configuration

This would require a `users` table, a `roles` table, and replacing the single API key model with scoped JWT tokens or multiple key types with different permission sets.

### 4. Database Read Replicas

Under heavy read load, all evaluation cache misses hit the Cloud SQL primary instance. The primary also handles all writes: flag updates and audit log inserts. Adding a Cloud SQL read replica and routing `SELECT` queries in the evaluation path to the replica would protect the primary from read saturation. TypeORM supports this via a `replication` configuration in `DataSource`. This is particularly valuable if bulk evaluation (`POST /evaluate/bulk`) is called at startup by many application instances simultaneously — for example, when all pods of a downstream service restart after a deployment.

### 5. Typed SDK Clients

Providing official SDK libraries would significantly improve the developer experience for consumers of the service:

- A **Node.js / TypeScript SDK** that wraps the evaluation endpoint with local in-memory caching, background polling for updates, and typed flag value access
- A **Browser SDK** using the SSE endpoint for real-time flag updates without polling
- A **React hook** (`useFlag('flag-key', defaultValue)`) that handles subscription, loading state, and re-renders transparently

Without an SDK, every consuming team must implement their own HTTP client, caching, error handling, and reconnect logic — duplicated effort and a likely source of subtle bugs.

### 6. Flag Dependencies and Prerequisite Flags

Some flags only make sense when another flag is already enabled — for example, `new-sidebar-v2` depends on `new-navigation` being on. A `prerequisites` field on `feature_flags` (an array of `{ flagKey, requiredValue }` pairs) would allow the evaluation engine to recursively resolve dependencies and return the `defaultValue` automatically when a prerequisite flag is disabled, even if the dependent flag is technically enabled.

### 7. Scheduled Rollouts and Time-Based Expiry

Marketing and product teams frequently need flags to activate at a specific time (a product launch at midnight) and deactivate after a promotion ends. Adding `enabled_at` and `expires_at` `timestamptz` columns to `flag_environments` would allow the evaluation engine to gate on wall-clock time without requiring a human to manually toggle the flag at the right moment. A background job or Cloud Scheduler task could also sweep and auto-archive expired flags to keep the active flag list clean.

---

## 14. CI/CD Secrets Setup

The GitHub Actions pipeline uses **Workload Identity Federation (WIF)** to authenticate to GCP without storing long-lived service account keys. Three secrets must be configured in the GitHub repository under `Settings --> Secrets and variables --> Actions`.

### Required Secrets

| Secret Name | Description | How to Obtain |
|---|---|---|
| `WIF_PROVIDER` | Full resource name of the Workload Identity Provider | See setup instructions below |
| `WIF_SERVICE_ACCOUNT` | Email of the GCP service account GitHub Actions impersonates | See setup instructions below |
| `GCP_PROJECT_ID` | Your GCP project ID (e.g., `my-project-123456`) | GCP Console --> Project Info card |

### How the Secrets Are Used

The `build-and-push` and deployment jobs in `.github/workflows/ci.yml` reference these secrets as follows:

```yaml
- name: Authenticate to GCP
  uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
    service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
```

This exchanges GitHub's OIDC token for a short-lived GCP access token scoped to the service account's permissions, used by subsequent `gcloud` and Docker commands. No JSON key file is ever stored in GitHub.

`GCP_PROJECT_ID` is used to construct the Artifact Registry image path:

```yaml
images: ${{ env.REGISTRY }}/${{ secrets.GCP_PROJECT_ID }}/${{ env.IMAGE_NAME }}/${{ env.IMAGE_NAME }}
```

### Setting Up Workload Identity Federation

Run these commands once, replacing placeholders with your values:

```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_PROJECT_NUMBER=$(gcloud projects describe "${GCP_PROJECT_ID}" --format='value(projectNumber)')
export GITHUB_ORG="your-github-org"
export GITHUB_REPO="feature-flag-service"

# 1. Create the Workload Identity Pool
gcloud iam workload-identity-pools create "github-pool" \
  --project="${GCP_PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# 2. Create the OIDC provider within the pool
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="${GCP_PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 3. Create a service account for GitHub Actions
gcloud iam service-accounts create "github-actions-sa" \
  --project="${GCP_PROJECT_ID}" \
  --display-name="GitHub Actions Service Account"

# 4. Grant the service account permissions to push images and deploy
for ROLE in \
  roles/artifactregistry.writer \
  roles/run.developer \
  roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
    --member="serviceAccount:github-actions-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="${ROLE}"
done

# 5. Allow the GitHub repository to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
  "github-actions-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${GCP_PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}"

# 6. Print the values to add as GitHub Secrets
echo ""
echo "Add the following to GitHub Secrets:"
echo ""
echo "WIF_PROVIDER:"
echo "  projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
echo ""
echo "WIF_SERVICE_ACCOUNT:"
echo "  github-actions-sa@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
echo ""
echo "GCP_PROJECT_ID:"
echo "  ${GCP_PROJECT_ID}"
```

### CI/CD Pipeline Flow Summary

```
Push to 'main' or 'staging' branch
           |
           v
   [lint-and-test job]
   - npm run lint
   - npm run test --coverage      (unit tests)
   - npm run test:e2e              (integration tests against live Postgres + Redis)
           |
     PASS  |
           v
   [build-and-push job]
   - Authenticate to GCP via WIF
   - docker build --target=production
   - docker push to Artifact Registry
   - Output: image tag (short git SHA)
           |
           v
   [deploy-staging]          OR    [deploy-production]
   (on 'staging' branch)           (on 'main' branch)
   - Deploy new revision           - Deploy new revision (0% traffic)
   - Smoke test tag URL            - Route 10% to canary
   - Promote to 100%               - Validate error count (60s window)
                                   - Promote to 100%
                                   - Tag stable revision
```

---

## Quick Reference

```
GET    /api/v1/health                                        Health check (no auth)
POST   /api/v1/tenants                                       Create tenant
GET    /api/v1/tenants                                       List tenants
GET    /api/v1/tenants/:id                                   Get tenant by ID
POST   /api/v1/tenants/:tenantId/flags                      Create flag       [x-api-key]
GET    /api/v1/tenants/:tenantId/flags                      List flags        [x-api-key]
PUT    /api/v1/tenants/:tenantId/flags/:flagKey             Update flag       [x-api-key]
DELETE /api/v1/tenants/:tenantId/flags/:flagKey             Archive flag      [x-api-key]
GET    /api/v1/tenants/:tenantId/flags/:flagKey/history     Audit history     [x-api-key]
POST   /api/v1/evaluate                                      Evaluate flag     (no auth)
POST   /api/v1/evaluate/bulk                                 Evaluate all      (no auth)
GET    /api/v1/sse/flags?tenantId=&environment=              SSE stream        (no auth)
```
