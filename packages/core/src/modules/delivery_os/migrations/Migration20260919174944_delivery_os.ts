import { Migration } from '@mikro-orm/migrations';

export class Migration20260919174944_delivery_os extends Migration {

  override name = 'Migration20260919174944';

  override up(): void | Promise<void> {
    this.addSql(`create table "delivery_staff_import_intents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "project_id" uuid not null, "key" text not null, "payload_hash" text not null, "payload" jsonb not null, "resource_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "delivery_staff_import_intents" add constraint "delivery_staff_import_intents_identity_uq" unique ("tenant_id", "organization_id", "project_id", "key");`);

  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "delivery_staff_import_intents";`);
  }

}
