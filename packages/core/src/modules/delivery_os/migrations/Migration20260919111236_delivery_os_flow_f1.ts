import { Migration } from '@mikro-orm/migrations';

export class Migration20260919111236_delivery_os_flow_f1 extends Migration {

  override name = 'Migration20260919111236';

  override up(): void | Promise<void> {
    this.addSql(`create table "delivery_flow_stage_artifacts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "stage_id" text not null, "version" int not null, "content_hash" text not null, "source" text not null, "content" jsonb not null, "depends_on" jsonb not null default '[]', "attachment_ids" jsonb not null default '[]', "template_hash" text not null, "created_by" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "delivery_flow_stage_artifacts" add constraint "delivery_flow_stage_artifacts_project_stage_hash_uq" unique ("tenant_id", "organization_id", "project_id", "stage_id", "content_hash");`);
    this.addSql(`alter table "delivery_flow_stage_artifacts" add constraint "delivery_flow_stage_artifacts_project_stage_version_uq" unique ("tenant_id", "organization_id", "project_id", "stage_id", "version");`);

    this.addSql(`create table "delivery_flow_stage_decisions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "stage_id" text not null, "artifact_id" uuid not null, "subject_hash" text not null, "subject_version" int not null, "verdict" text not null, "reason" text null, "actor_user_id" uuid not null, "decided_at" timestamptz not null, "client_approver_name" text null, "client_approver_role" text null, "client_approval_evidence" jsonb null, "deferred_thread_keys" jsonb not null default '[]', "template_hash" text not null, "idempotency_key" text not null, "request_hash" text not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "delivery_flow_stage_decisions_scope_project_stage_decided_idx" on "delivery_flow_stage_decisions" ("tenant_id", "organization_id", "project_id", "stage_id", "decided_at");`);
    this.addSql(`alter table "delivery_flow_stage_decisions" add constraint "delivery_flow_stage_decisions_project_idempotency_uq" unique ("tenant_id", "organization_id", "project_id", "idempotency_key");`);

    this.addSql(`create table "delivery_intakes" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "schema_version" text not null, "step" text not null default 'brief', "brief" jsonb not null, "questions" jsonb not null default '[]', "proposals" jsonb not null default '[]', "platform" jsonb not null, "tools" jsonb not null default '[]', "imported_manifests" jsonb not null default '[]', "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "delivery_intakes" add constraint "delivery_intakes_scope_project_uq" unique ("tenant_id", "organization_id", "project_id");`);

    this.addSql(`alter table "delivery_projects" add "flow_template_id" text null, add "flow_template_version" int null, add "flow_template_hash" text null, add "flow_template_snapshot" jsonb null, add "flow_pinned_at" timestamptz null, add "flow_workflow_instance_id" uuid null, add "flow_workflow_definition_id" uuid null;`);
    this.addSql(`create index "delivery_projects_scope_flow_template_idx" on "delivery_projects" ("tenant_id", "organization_id", "flow_template_id", "flow_template_version");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "delivery_intakes" cascade;`);
    this.addSql(`drop table if exists "delivery_flow_stage_decisions" cascade;`);
    this.addSql(`drop table if exists "delivery_flow_stage_artifacts" cascade;`);
    this.addSql(`drop index "delivery_projects_scope_flow_template_idx";`);
    this.addSql(`alter table "delivery_projects" drop column "flow_template_id", drop column "flow_template_version", drop column "flow_template_hash", drop column "flow_template_snapshot", drop column "flow_pinned_at", drop column "flow_workflow_instance_id", drop column "flow_workflow_definition_id";`);
  }

}
