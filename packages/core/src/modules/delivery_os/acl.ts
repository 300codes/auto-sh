export const features = [
  { id: 'delivery_os.projects.view', title: 'View delivery projects', module: 'delivery_os' },
  {
    id: 'delivery_os.projects.manage',
    title: 'Manage delivery projects and tasks',
    module: 'delivery_os',
    dependsOn: ['delivery_os.projects.view'],
  },
  {
    id: 'delivery_os.baselines.approve',
    title: 'Approve delivery requirements and design',
    module: 'delivery_os',
    dependsOn: ['delivery_os.projects.view'],
  },
  {
    id: 'delivery_os.results.import',
    title: 'Import delivery results and evidence',
    module: 'delivery_os',
    dependsOn: ['delivery_os.projects.view'],
  },
  {
    id: 'delivery_os.attempts.manage',
    title: 'Reserve, cancel and export execution attempts',
    module: 'delivery_os',
    dependsOn: ['delivery_os.projects.view'],
  },
  {
    id: 'delivery_os.attempts.reconcile',
    title: 'Reconcile execution attempts',
    module: 'delivery_os',
    dependsOn: ['delivery_os.projects.view'],
  },
  {
    id: 'delivery_os.deploy.approve',
    title: 'Approve delivery publication',
    module: 'delivery_os',
    dependsOn: ['delivery_os.projects.view'],
  },
  {
    id: 'delivery_os.release.approve',
    title: 'Accept delivery releases',
    module: 'delivery_os',
    dependsOn: ['delivery_os.projects.view'],
  },
]

export default features
