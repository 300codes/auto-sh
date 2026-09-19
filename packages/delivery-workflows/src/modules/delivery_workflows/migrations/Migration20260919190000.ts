import { Migration } from '@mikro-orm/migrations';

export class Migration20260919190000 extends Migration {
  override async up(): Promise<void> {
    this.addSql("create table \"delivery_workflow_project_bindings\" (\"id\" uuid not null default gen_random_uuid(), \"tenant_id\" uuid not null, \"organization_id\" uuid not null, \"project_id\" uuid not null, \"workflow_id\" text not null, \"version\" int not null, \"definition_id\" uuid not null, \"definition_hash\" text not null, \"template_hash\" text not null, \"workflow_instance_id\" uuid null, \"created_at\" timestamptz not null, \"updated_at\" timestamptz not null, primary key (\"id\"));");
    this.addSql("alter table \"delivery_workflow_project_bindings\" add constraint \"delivery_workflow_project_bindings_tenant_id_orga_9cc15_unique\" unique (\"tenant_id\", \"organization_id\", \"project_id\");");
    this.addSql("create table \"delivery_workflows_settings\" (\"id\" uuid not null default gen_random_uuid(), \"tenant_id\" uuid not null, \"organization_id\" uuid not null, \"workflow_id\" text not null, \"version\" int not null, \"definition_id\" uuid not null, \"definition_hash\" text not null, \"template_hash\" text not null, \"created_at\" timestamptz not null, \"updated_at\" timestamptz not null, primary key (\"id\"));");
    this.addSql("alter table \"delivery_workflows_settings\" add constraint \"delivery_workflows_settings_tenant_id_organization_id_unique\" unique (\"tenant_id\", \"organization_id\");");
  }
}
