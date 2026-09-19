import { Migration } from '@mikro-orm/migrations';

export class Migration20260919152308_delivery_os_flow_f4 extends Migration {

  override name = 'Migration20260919152308';

  override up(): void | Promise<void> {
    this.addSql(`create table "delivery_publications" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "baseline_id" uuid not null, "source_revision" jsonb not null, "snapshot_ref" jsonb null, "target" jsonb not null, "url" text not null, "deploy_decision_id" uuid not null, "deployment_evidence_id" uuid not null, "verification" jsonb not null, "published_at" timestamptz not null, "published_by" uuid null, "payload_hash" text not null, "recorded_by" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "delivery_publications_scope_project_created_idx" on "delivery_publications" ("tenant_id", "organization_id", "project_id", "created_at");`);
    this.addSql(`alter table "delivery_publications" add constraint "delivery_publications_scope_project_payload_hash_uq" unique ("tenant_id", "organization_id", "project_id", "payload_hash");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "delivery_publications" cascade;`);
  }

}
