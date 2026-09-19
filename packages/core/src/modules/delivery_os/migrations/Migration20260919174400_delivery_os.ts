import { Migration } from '@mikro-orm/migrations';

export class Migration20260919174400_delivery_os extends Migration {

  override name = 'Migration20260919174400';

  override up(): void | Promise<void> {
    this.addSql(`create table "delivery_design_import_sessions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "manifest_hash" text not null, "manifest" jsonb not null, "progress" jsonb not null default '{}'::jsonb, "status" text not null default 'partial', "updated_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "delivery_design_import_sessions" add constraint "delivery_design_import_sessions_identity_uq" unique ("tenant_id", "organization_id", "project_id", "manifest_hash");`);

    this.addSql(`create table "delivery_flow_baseline_bindings" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "baseline_id" uuid not null, "template_hash" text not null, "refs_hash" text not null, "stage_refs" jsonb not null, "created_by" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "delivery_flow_baseline_bindings" add constraint "delivery_flow_baseline_bindings_identity_uq" unique ("tenant_id", "organization_id", "project_id", "baseline_id", "template_hash", "refs_hash");`);

  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "delivery_flow_baseline_bindings";`);
    this.addSql(`drop table if exists "delivery_design_import_sessions";`);
  }

}
