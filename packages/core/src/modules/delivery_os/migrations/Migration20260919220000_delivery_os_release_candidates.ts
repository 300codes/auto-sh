import { Migration } from '@mikro-orm/migrations'

export class Migration20260919220000_delivery_os_release_candidates extends Migration {
  override name = 'Migration20260919220000'

  override up(): void {
    this.addSql(`create table "delivery_release_candidates" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "version" int not null, "baseline_id" uuid not null, "baseline_hash" text not null, "source_revision" jsonb not null, "evidence_ids" jsonb not null, "created_by" uuid not null, "created_at" timestamptz not null, primary key ("id"));`)
    this.addSql(`alter table "delivery_release_candidates" add constraint "delivery_release_candidates_project_version_uq" unique ("tenant_id", "organization_id", "project_id", "version");`)
    this.addSql(`alter table "delivery_decisions" add "release_candidate_id" uuid null, add "release_candidate_version" int null, add "candidate_context_hash" text null;`)
  }

  override down(): void {
    this.addSql(`alter table "delivery_decisions" drop column "release_candidate_id", drop column "release_candidate_version", drop column "candidate_context_hash";`)
    this.addSql(`drop table if exists "delivery_release_candidates";`)
  }
}
