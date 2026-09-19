import { Migration } from '@mikro-orm/migrations';

export class Migration20260919003425_delivery_os extends Migration {

  override name = 'Migration20260919003425';

  override up(): void | Promise<void> {
    this.addSql(`create table "delivery_baselines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "version" int not null, "content_hash" text not null, "source" text not null, "parent_baseline_id" uuid null, "content" jsonb not null, "attachment_ids" jsonb not null default '[]', "created_by" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "delivery_baselines" add constraint "delivery_baselines_project_hash_uq" unique ("tenant_id", "organization_id", "project_id", "content_hash");`);
    this.addSql(`alter table "delivery_baselines" add constraint "delivery_baselines_project_version_uq" unique ("tenant_id", "organization_id", "project_id", "version");`);

    this.addSql(`create table "delivery_decisions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "kind" text not null, "subject_type" text not null, "subject_id" uuid not null, "subject_hash" text not null, "subject_version" int null, "source_revision" jsonb null, "verdict" text not null, "reason" text null, "actor_user_id" uuid not null, "decided_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "delivery_decisions_scope_project_kind_decided_idx" on "delivery_decisions" ("tenant_id", "organization_id", "project_id", "kind", "decided_at");`);

    this.addSql(`create table "delivery_evidence" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "baseline_id" uuid not null, "task_id" uuid null, "attempt_id" uuid null, "kind" text not null, "source" text not null, "source_revision" jsonb null, "payload" jsonb not null, "payload_hash" text not null, "raw_report_hash" text null, "attachment_ids" jsonb not null default '[]', "recorded_by" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "delivery_evidence_result_manifest_uq" on "delivery_evidence" ("tenant_id", "organization_id", "task_id", "attempt_id") where "kind" = 'result_manifest';`);
    this.addSql(`create index "delivery_evidence_scope_project_kind_hash_idx" on "delivery_evidence" ("tenant_id", "organization_id", "project_id", "kind", "payload_hash");`);
    this.addSql(`create index "delivery_evidence_scope_task_idx" on "delivery_evidence" ("tenant_id", "organization_id", "task_id");`);
    this.addSql(`create index "delivery_evidence_scope_project_kind_idx" on "delivery_evidence" ("tenant_id", "organization_id", "project_id", "kind");`);
    this.addSql(`alter table "delivery_evidence" add constraint "delivery_evidence_result_manifest_attempt_chk" check ("kind" <> 'result_manifest' or ("task_id" is not null and "attempt_id" is not null));`);

    this.addSql(`create table "delivery_projects" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "input_mode" text not null, "brief" text null, "target_profile_id" text not null, "target_profile_version" int not null, "repository_ref" text null, "draft_spec" jsonb not null default '{}', "active_baseline_id" uuid null, "limits" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "delivery_projects_scope_created_idx" on "delivery_projects" ("tenant_id", "organization_id", "created_at");`);
    this.addSql(`create index "delivery_projects_scope_deleted_idx" on "delivery_projects" ("tenant_id", "organization_id", "deleted_at");`);

    this.addSql(`create table "delivery_tasks" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "baseline_id" uuid not null, "title" text not null, "description" text null, "ac_ids" jsonb not null, "depends_on_task_ids" jsonb not null default '[]', "allowed_paths" jsonb not null default '[]', "target_profile_id" text not null, "target_profile_version" int not null, "status" text not null default 'draft', "status_reason" text null, "attempt_number" int not null default 0, "execution_attempts" jsonb not null default '[]', "proposal_task_key" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "delivery_tasks_proposal_key_uq" on "delivery_tasks" ("tenant_id", "organization_id", "project_id", "baseline_id", "proposal_task_key") where "proposal_task_key" is not null;`);
    this.addSql(`create index "delivery_tasks_scope_project_deleted_idx" on "delivery_tasks" ("tenant_id", "organization_id", "project_id", "deleted_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "delivery_tasks" cascade;`);
    this.addSql(`drop table if exists "delivery_projects" cascade;`);
    this.addSql(`drop table if exists "delivery_evidence" cascade;`);
    this.addSql(`drop table if exists "delivery_decisions" cascade;`);
    this.addSql(`drop table if exists "delivery_baselines" cascade;`);
  }

}
