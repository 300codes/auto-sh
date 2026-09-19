import { Migration } from '@mikro-orm/migrations';

export class Migration20260919174401_staff extends Migration {

  override name = 'Migration20260919174401';

  override up(): void | Promise<void> {
    this.addSql(`create table "staff_command_idempotency" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "operation" text not null, "idempotency_key" text not null, "payload_hash" text not null, "resource_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "staff_command_idempotency" add constraint "staff_command_idempotency_scope_key_unique" unique ("tenant_id", "organization_id", "operation", "idempotency_key");`);
  }

}
