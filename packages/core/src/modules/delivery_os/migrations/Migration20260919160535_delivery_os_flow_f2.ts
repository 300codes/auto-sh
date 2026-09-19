import { Migration } from '@mikro-orm/migrations';

export class Migration20260919160535_delivery_os_flow_f2 extends Migration {

  override name = 'Migration20260919160535';

  override up(): void | Promise<void> {
    this.addSql(`create table "delivery_comment_replies" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "thread_id" uuid not null, "comment_key" text not null, "revision" int not null, "author" jsonb not null, "body" text not null, "source_created_at" timestamptz not null, "edited_at" timestamptz null, "deleted" boolean not null default false, "staff_comment_id" uuid null, "fetched_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "delivery_comment_replies_scope_thread_idx" on "delivery_comment_replies" ("tenant_id", "organization_id", "thread_id");`);
    this.addSql(`alter table "delivery_comment_replies" add constraint "delivery_comment_replies_scope_thread_comment_revision_uq" unique ("tenant_id", "organization_id", "thread_id", "comment_key", "revision");`);

    this.addSql(`create table "delivery_comment_threads" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "source" text not null, "file_key" text not null, "thread_key" text not null, "stage_id" text not null, "artifact_id" uuid null, "node_id" text null, "source_url" text not null, "author" jsonb not null, "body" text not null, "source_created_at" timestamptz not null, "source_updated_at" timestamptz null, "source_status" text not null, "figma_version" text null, "version_confirmed" boolean not null default false, "fetched_at" timestamptz not null, "staff_task_id" uuid null, "triage_status" text not null default 'new', "deferral" jsonb null, "linked_delivery_task_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "delivery_comment_threads_scope_project_stage_idx" on "delivery_comment_threads" ("tenant_id", "organization_id", "project_id", "stage_id");`);
    this.addSql(`create index "delivery_comment_threads_scope_staff_task_idx" on "delivery_comment_threads" ("tenant_id", "organization_id", "staff_task_id");`);
    this.addSql(`alter table "delivery_comment_threads" add constraint "delivery_comment_threads_scope_file_thread_uq" unique ("tenant_id", "organization_id", "project_id", "source", "file_key", "thread_key");`);

    this.addSql(`create table "delivery_staff_links" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "staff_project_id" uuid not null, "linked_by" uuid not null, "linked_at" timestamptz not null, "sync_cursors" jsonb not null default '{}', "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "delivery_staff_links" add constraint "delivery_staff_links_scope_staff_project_uq" unique ("tenant_id", "organization_id", "staff_project_id");`);
    this.addSql(`alter table "delivery_staff_links" add constraint "delivery_staff_links_scope_project_uq" unique ("tenant_id", "organization_id", "project_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "delivery_staff_links" cascade;`);
    this.addSql(`drop table if exists "delivery_comment_threads" cascade;`);
    this.addSql(`drop table if exists "delivery_comment_replies" cascade;`);
  }

}
