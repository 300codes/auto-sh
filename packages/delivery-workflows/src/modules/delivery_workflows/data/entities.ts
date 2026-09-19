import { OptionalProps } from '@mikro-orm/core'
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'delivery_workflows_settings' })
@Unique({ properties: ['tenantId', 'organizationId'] })
export class DeliveryWorkflowSettings {
  [OptionalProps]?: 'createdAt' | 'updatedAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'workflow_id', type: 'text' }) workflowId!: string
  @Property({ type: 'integer' }) version!: number
  @Property({ name: 'definition_id', type: 'uuid' }) definitionId!: string
  @Property({ name: 'definition_hash', type: 'text' }) definitionHash!: string
  @Property({ name: 'template_hash', type: 'text' }) templateHash!: string
  @Property({ name: 'created_at', type: Date }) createdAt = new Date()
  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() }) updatedAt = new Date()
}

@Entity({ tableName: 'delivery_workflow_project_bindings' })
@Unique({ properties: ['tenantId', 'organizationId', 'projectId'] })
export class DeliveryWorkflowProjectBinding {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'workflowInstanceId'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string
  @Property({ name: 'tenant_id', type: 'uuid' }) tenantId!: string
  @Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string
  @Property({ name: 'project_id', type: 'uuid' }) projectId!: string
  @Property({ name: 'workflow_id', type: 'text' }) workflowId!: string
  @Property({ type: 'integer' }) version!: number
  @Property({ name: 'definition_id', type: 'uuid' }) definitionId!: string
  @Property({ name: 'definition_hash', type: 'text' }) definitionHash!: string
  @Property({ name: 'template_hash', type: 'text' }) templateHash!: string
  @Property({ name: 'workflow_instance_id', type: 'uuid', nullable: true }) workflowInstanceId: string | null = null
  @Property({ name: 'created_at', type: Date }) createdAt = new Date()
  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() }) updatedAt = new Date()
}
