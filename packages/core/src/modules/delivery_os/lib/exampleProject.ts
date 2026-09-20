import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DeliveryProject } from '../data/entities'
import { DEFAULT_DELIVERY_LIMITS } from './contracts'

const logger = createLogger('delivery_os').child({ component: 'example-project' })

export const EXAMPLE_PROJECT_NAME = 'Aster Works — company website'
export const EXAMPLE_TARGET_PROFILE_ID = 'wordpress-theme'

/**
 * The brief a reviewer can walk the whole flow with. It is deliberately a real one — audiences, views, navigation,
 * visual direction, out-of-scope list and acceptance criteria — because an agent asked to structure two vague
 * sentences produces a scope nobody can review, which teaches an operator nothing about the product.
 */
export const EXAMPLE_BRIEF = `1. About the company
Aster Works helps companies design and ship AI solutions. We work in three areas: knowledge assistants, automating
repetitive work, and judging the quality of an AI solution before it ships. We need a website that shows which
business problems we solve, what working with us looks like, and when it is worth getting in touch. The starting
point is the client's problem and the value we deliver, not models or frameworks.

2. Goal of the site
Collect enquiries from companies considering an AI project. The site should lead a visitor along: problem →
solution → worked example → how we collaborate → contact. Primary call to action: "Let's talk about your project".
Secondary: "See a worked example".

3. Audiences
COO looking to improve an existing process or cut repetitive work. Product Lead looking at AI as a product feature.
CTO looking for a partner who will design, ship and verify the solution and state the data and infrastructure needs.

4. Scope
Four views. Home: a clear promise, both calls to action, three typical client problems with the matching services, a
highlighted worked example, the collaboration process, a contact section. Proposed H1: "AI that finds its place in
everyday work". Service page "Knowledge assistants": who it is for, the problem, what we deliver, what the
collaboration looks like, the data we need, the client's involvement, the next step. Worked example "Knowledge for a
support team": business context, problem, solution, scope, required data, rollout, how success is measured, marked as
a demonstration scenario built on synthetic material. Contact: what to bring, how to prepare, what we will ask, the
next step — no working form, no booking.

5. Navigation
Menu: Solutions, Worked example, How we work, Contact. Section links must work from subpages too. No mega menu.

6. Collaboration process
Four stages described from the client's side: Understand the task → Design the solution → Ship it → Hand over.

7. Visual direction
A considered B2B technology site: clear hierarchy, large type, a consistent grid, generous space, an original visual
theme. Colours: navy #082C55 as the base, blue #0757B8 and cyan #12B8DB as accents, light section backgrounds with
navy text, a dark hero is allowed. Apply the palette through design tokens. Logo: six connected nodes around an "A",
vector, no glow. No stock robots, no logo walls, no background video. Responsiveness changes the hierarchy of the
content rather than scaling the desktop layout.

8. CMS and technology
WordPress, UX and UI designed in Figma. An editor changes copy, illustrations, calls to action, sections, menu,
header and footer without touching code. Worked-example metadata through ACF. Title and SEO description editable.
Content must survive a theme update. Fonts hosted locally under a licence that allows it.

9. Out of scope
Blog, client portal, sign-in, payments, language versions, CRM, booking calendar, a contact form that actually sends,
an extensive service catalogue.

10. Content and credibility
Concrete, business-first copy: value before technology. No guaranteed savings or results. No invented clients, logos,
partnerships, certificates, testimonials or statistics. Examples marked as demonstrations.

11. Acceptance
Four views working on desktop and mobile, working navigation and calls to action, no empty links, consistent with the
approved UI, readable hierarchy, keyboard operation with a visible focus ring, no horizontal scrolling, content and
ACF fields and SEO metadata editable without code, content preserved across a theme update, the preview kept out of
search engines before publication.`

/**
 * Creates the example delivery project, once. The project stops at the brief on purpose: the wizard, the stage drafts
 * and the plan are what the operator then runs against their own connected agent, and seeding their output would
 * fake evidence the system is built to refuse.
 */
export async function seedExampleDeliveryProject(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<DeliveryProject | null> {
  const existing = await em.findOne(DeliveryProject, {
    name: EXAMPLE_PROJECT_NAME,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (existing) return null

  const project = em.create(DeliveryProject, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    name: EXAMPLE_PROJECT_NAME,
    inputMode: 'from_brief',
    brief: EXAMPLE_BRIEF,
    targetProfileId: EXAMPLE_TARGET_PROFILE_ID,
    targetProfileVersion: 1,
    limits: DEFAULT_DELIVERY_LIMITS,
    draftSpec: {},
  })
  em.persist(project)
  logger.info('seeded the example delivery project', { projectId: project.id, tenantId: scope.tenantId })
  return project
}
