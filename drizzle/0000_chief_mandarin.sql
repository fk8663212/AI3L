CREATE TABLE "access_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"code_hash" varchar(128) NOT NULL,
	"label" varchar(120),
	"expires_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stage_id" varchar(40) NOT NULL,
	"provider" varchar(24) NOT NULL,
	"model_id" varchar(120) NOT NULL,
	"prompt_version" varchar(32) NOT NULL,
	"prompt_hash" varchar(128) NOT NULL,
	"provider_response_id" varchar(180),
	"status" varchar(32) NOT NULL,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"error_code" varchar(80),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(32) NOT NULL,
	"encrypted_value" text NOT NULL,
	"encryption_iv" varchar(128) NOT NULL,
	"encryption_tag" varchar(128) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_connections_kind_unique" UNIQUE("kind")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stage_id" varchar(40) NOT NULL,
	"type" varchar(40) NOT NULL,
	"status" varchar(32) DEFAULT 'ready' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage_provider" varchar(32),
	"storage_locator" text,
	"mime_type" varchar(120),
	"size_bytes" integer,
	"sha256" varchar(128),
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" varchar(80) NOT NULL,
	"action" varchar(120) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_id" varchar(180),
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stage_id" varchar(40) NOT NULL,
	"role" varchar(24) NOT NULL,
	"kind" varchar(40) DEFAULT 'text' NOT NULL,
	"content" jsonb NOT NULL,
	"idempotency_key" varchar(128),
	"hidden_until_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(24) NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"encrypted_key" text NOT NULL,
	"encryption_iv" varchar(128) NOT NULL,
	"encryption_tag" varchar(128) NOT NULL,
	"key_last_four" varchar(8) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(24) NOT NULL,
	"model_id" varchar(120) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"capabilities" jsonb NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(180) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stage_id" varchar(40) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"override_reason" text
);
--> statement-breakpoint
CREATE TABLE "student_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"access_code_id" uuid NOT NULL,
	"current_stage" varchar(40) DEFAULT 'pretest' NOT NULL,
	"stage_status" varchar(32) DEFAULT 'active' NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"consent_version" varchar(32),
	"consented_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"slug" varchar(120) NOT NULL,
	"title" varchar(180) NOT NULL,
	"description" text NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"provider" varchar(24) NOT NULL,
	"model_id" varchar(120) NOT NULL,
	"config" jsonb NOT NULL,
	"prompt_version" varchar(32) DEFAULT '1.0.0' NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_session_id_student_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."student_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_session_id_student_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."student_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_student_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."student_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_attempts" ADD CONSTRAINT "stage_attempts_session_id_student_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."student_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_sessions" ADD CONSTRAINT "student_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_sessions" ADD CONSTRAINT "student_sessions_access_code_id_access_codes_id_fk" FOREIGN KEY ("access_code_id") REFERENCES "public"."access_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_codes_hash_unique" ON "access_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "access_codes_task_idx" ON "access_codes" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ai_runs_session_stage_idx" ON "ai_runs" USING btree ("session_id","stage_id");--> statement-breakpoint
CREATE INDEX "artifacts_session_stage_idx" ON "artifacts" USING btree ("session_id","stage_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_session_created_idx" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_session_idempotency_unique" ON "messages" USING btree ("session_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_provider_unique" ON "provider_credentials" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_models_provider_model_unique" ON "provider_models" USING btree ("provider","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_attempts_session_stage_attempt_unique" ON "stage_attempts" USING btree ("session_id","stage_id","attempt");--> statement-breakpoint
CREATE INDEX "stage_attempts_session_idx" ON "stage_attempts" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_sessions_access_code_unique" ON "student_sessions" USING btree ("access_code_id");--> statement-breakpoint
CREATE INDEX "student_sessions_task_idx" ON "student_sessions" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_slug_version_unique" ON "tasks" USING btree ("slug","version");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");