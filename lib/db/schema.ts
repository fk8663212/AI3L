import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { TaskConfig } from "@/lib/domain/default-task";
import type { StageId, StageStatus } from "@/lib/domain/stages";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 24 }).notNull(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    encryptionIv: varchar("encryption_iv", { length: 128 }).notNull(),
    encryptionTag: varchar("encryption_tag", { length: 128 }).notNull(),
    keyLastFour: varchar("key_last_four", { length: 8 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("provider_credentials_provider_unique").on(table.provider),
  ],
);

export const providerModels = pgTable(
  "provider_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 24 }).notNull(),
    modelId: varchar("model_id", { length: 120 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    capabilities: jsonb("capabilities")
      .$type<{
        text: boolean;
        image: boolean;
        audio: boolean;
        structuredOutput: boolean;
      }>()
      .notNull(),
    isPreset: boolean("is_preset").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("provider_models_provider_model_unique").on(
      table.provider,
      table.modelId,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull().defaultRandom(),
    version: integer("version").notNull().default(1),
    slug: varchar("slug", { length: 120 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    provider: varchar("provider", { length: 24 }).notNull(),
    modelId: varchar("model_id", { length: 120 }).notNull(),
    config: jsonb("config").$type<TaskConfig>().notNull(),
    promptVersion: varchar("prompt_version", { length: 32 })
      .notNull()
      .default("1.0.0"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("tasks_slug_version_unique").on(table.slug, table.version),
    index("tasks_status_idx").on(table.status),
  ],
);

export const accessCodes = pgTable(
  "access_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    codeHash: varchar("code_hash", { length: 128 }).notNull(),
    label: varchar("label", { length: 120 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("access_codes_hash_unique").on(table.codeHash),
    index("access_codes_task_idx").on(table.taskId),
  ],
);

export const studentSessions = pgTable(
  "student_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    accessCodeId: uuid("access_code_id")
      .notNull()
      .references(() => accessCodes.id, { onDelete: "restrict" }),
    currentStage: varchar("current_stage", { length: 40 })
      .$type<StageId>()
      .notNull()
      .default("pretest"),
    stageStatus: varchar("stage_status", { length: 32 })
      .$type<StageStatus>()
      .notNull()
      .default("active"),
    stateVersion: integer("state_version").notNull().default(1),
    consentVersion: varchar("consent_version", { length: 32 }),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("student_sessions_access_code_unique").on(table.accessCodeId),
    index("student_sessions_task_idx").on(table.taskId),
  ],
);

export const stageAttempts = pgTable(
  "stage_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studentSessions.id, { onDelete: "cascade" }),
    stageId: varchar("stage_id", { length: 40 }).$type<StageId>().notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: varchar("status", { length: 32 })
      .$type<StageStatus>()
      .notNull()
      .default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    overrideReason: text("override_reason"),
  },
  (table) => [
    uniqueIndex("stage_attempts_session_stage_attempt_unique").on(
      table.sessionId,
      table.stageId,
      table.attempt,
    ),
    index("stage_attempts_session_idx").on(table.sessionId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studentSessions.id, { onDelete: "cascade" }),
    stageId: varchar("stage_id", { length: 40 }).$type<StageId>().notNull(),
    role: varchar("role", { length: 24 }).notNull(),
    kind: varchar("kind", { length: 40 }).notNull().default("text"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    hiddenUntilComplete: boolean("hidden_until_complete")
      .notNull()
      .default(false),
    createdAt,
  },
  (table) => [
    index("messages_session_created_idx").on(table.sessionId, table.createdAt),
    uniqueIndex("messages_session_idempotency_unique").on(
      table.sessionId,
      table.idempotencyKey,
    ),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studentSessions.id, { onDelete: "cascade" }),
    stageId: varchar("stage_id", { length: 40 }).$type<StageId>().notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ready"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    storageProvider: varchar("storage_provider", { length: 32 }),
    storageLocator: text("storage_locator"),
    mimeType: varchar("mime_type", { length: 120 }),
    sizeBytes: integer("size_bytes"),
    sha256: varchar("sha256", { length: 128 }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("artifacts_session_stage_idx").on(table.sessionId, table.stageId),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studentSessions.id, { onDelete: "cascade" }),
    stageId: varchar("stage_id", { length: 40 }).$type<StageId>().notNull(),
    provider: varchar("provider", { length: 24 }).notNull(),
    modelId: varchar("model_id", { length: 120 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 32 }).notNull(),
    promptHash: varchar("prompt_hash", { length: 128 }).notNull(),
    providerResponseId: varchar("provider_response_id", { length: 180 }),
    status: varchar("status", { length: 32 }).notNull(),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: text("error_message"),
    createdAt,
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("ai_runs_session_stage_idx").on(table.sessionId, table.stageId),
  ],
);

export const appConnections = pgTable("app_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: varchar("kind", { length: 32 }).notNull().unique(),
  encryptedValue: text("encrypted_value").notNull(),
  encryptionIv: varchar("encryption_iv", { length: 128 }).notNull(),
  encryptionTag: varchar("encryption_tag", { length: 128 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: varchar("actor", { length: 80 }).notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    targetType: varchar("target_type", { length: 80 }).notNull(),
    targetId: varchar("target_id", { length: 180 }),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [index("audit_logs_created_idx").on(table.createdAt)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: varchar("key", { length: 180 }).primaryKey(),
    count: integer("count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt,
  },
);

export type TaskRow = typeof tasks.$inferSelect;
export type StudentSessionRow = typeof studentSessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
