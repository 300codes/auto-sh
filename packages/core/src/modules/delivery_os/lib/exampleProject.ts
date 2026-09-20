import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DeliveryProject } from '../data/entities'
import { DEFAULT_DELIVERY_LIMITS } from './contracts'

const logger = createLogger('delivery_os').child({ component: 'example-project' })

export const EXAMPLE_PROJECT_NAME = 'Aster Works — strona firmowa (przykład)'
export const EXAMPLE_TARGET_PROFILE_ID = 'wordpress-theme'

/**
 * The brief this example was really built from: the one the walkthrough's scope, stages and plan were produced from.
 * It is long and specific on purpose — an agent asked to structure two vague sentences returns a scope nobody can
 * review, which teaches an operator nothing about the product.
 */
export const EXAMPLE_BRIEF = "1. O firmie\nAster Works to firma usługowa pomagająca przedsiębiorstwom projektować i wdrażać rozwiązania wykorzystujące AI. Wspieramy klientów przede wszystkim w trzech obszarach: tworzeniu asystentów wiedzy, automatyzacji powtarzalnej pracy, ocenie jakości rozwiązań AI przed ich wdrożeniem. Potrzebujemy nowej strony internetowej, która w prosty sposób pokaże, jakie problemy biznesowe rozwiązujemy, jak wygląda współpraca z nami oraz w jakich sytuacjach warto się z nami skontaktować. Nie chcemy budować komunikacji wokół modeli AI, frameworków czy konkretnych technologii. Punktem wyjścia powinien być problem klienta i wartość, którą możemy dostarczyć.\n\n2. Cel strony\nGłównym celem strony jest pozyskiwanie zapytań od potencjalnych klientów zainteresowanych wdrożeniem rozwiązania AI. Strona powinna prowadzić użytkownika ścieżką: problem → rozwiązanie → przykład zastosowania → sposób współpracy → kontakt. Główne CTA: „Porozmawiajmy o projekcie”. Drugie CTA: „Zobacz przykład zastosowania”.\n\n3. Grupy odbiorców\nDyrektor operacyjny / COO — szukający sposobu na usprawnienie istniejącego procesu, ograniczenie powtarzalnej pracy lub poprawę dostępu zespołu do informacji. Product Lead / Head of Product — szukający możliwości wykorzystania AI jako nowej funkcji produktu lub elementu istniejącej usługi. CTO / osoba odpowiedzialna za technologię — szukająca partnera, który zaprojektuje, wdroży i zweryfikuje rozwiązanie AI oraz jasno określi wymagania dotyczące danych i infrastruktury.\n\n4. Zakres strony\nCztery główne widoki. 4.1 Strona główna: jasna obietnica wartości, główne i dodatkowe CTA, trzy typowe problemy klientów, odpowiadające im rozwiązania, wyróżniony przykład zastosowania, opis procesu współpracy, sekcja kontaktowa. Proponowany H1: AI, które znajduje miejsce w codziennej pracy. Trzy problemy i usługi: Asystenci wiedzy — zespół szuka odpowiedzi w rozproszonych dokumentach; Automatyzacja pracy — praca wymaga powtarzania tych samych kroków w kilku narzędziach; Ocena jakości AI — prototyp działa, ale brakuje kryteriów oceny i odbioru. 4.2 Usługa „Asystenci wiedzy”: dedykowana podstrona (dla kogo, jaki problem, co dostarczamy, jak wygląda współpraca, jakich danych potrzebujemy, zaangażowanie klienta, przykładowe zastosowanie, kolejny krok). 4.3 Przykład zastosowania „Wiedza dla zespołu obsługi”: kontekst biznesowy, problem, rozwiązanie, zakres, wymagane dane, wdrożenie, pomiar skuteczności; oznaczony jako scenariusz demonstracyjny, materiały syntetyczne. 4.4 Kontakt: z czym można się zgłosić, jak przygotować się do rozmowy, czego będziemy chcieli się dowiedzieć, kolejny krok. Bez formularza wysyłającego dane i bez rezerwacji spotkań. Kontakt demonstracyjny: kontakt@aster-works.example\n\n5. Nawigacja\nMenu: Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt. Linki do sekcji muszą działać także z podstron. Bez mega menu.\n\n6. Proces współpracy\nCztery etapy: Rozpoznanie zadania → Projekt rozwiązania → Wdrożenie → Odbiór i przekazanie, opisane z perspektywy klienta.\n\n7. Ścieżki użytkowników\nCOO: problem → rozwiązanie → współpraca → kontakt. CTO: usługa → zakres i wymagania danych → przykład → kontakt. Powracający: menu → przykład → CTA.\n\n8. Kierunek wizualny\nDopracowany serwis technologicznej firmy B2B: wyraźna hierarchia, duża typografia, konsekwentna siatka, dużo przestrzeni, autorski motyw graficzny. Kolory: granat bazowy #082C55, niebieski #0757B8 i cyjan #12B8DB jako akcenty, jasne tło sekcji z granatowym tekstem, możliwy ciemny hero. Paletę wdrożyć przez tokeny design systemu. Logotyp: sześć połączonych węzłów wokół znaku A, wersja wektorowa bez poświaty. Bez stockowych robotów, ścian logotypów i wideo w tle. Responsywność zmienia hierarchię treści, nie skaluje desktopu.\n\n9. Materiały graficzne\nAutorska ilustracja hero, diagram przykładu zastosowania, proste elementy UI. SVG lub zoptymalizowane rastry. Fonty z licencją na hosting lokalny.\n\n10. CMS i technologia\nWordPress, projekt UX/UI w Figmie. Redaktor zmienia bez kodu: teksty, ilustracje, CTA, sekcje, menu, nagłówek, stopkę. Metadane przykładu zastosowania przez ACF (Etap, Typ użytkownika, Zakres rozwiązania). Tytuł i opis SEO edytowalne narzędziem SEO. Treści nie mogą zostać utracone przy aktualizacji motywu.\n\n11. SEO i środowisko demonstracyjne\nTylko język polski. Preview wyłączone z indeksowania. Publikacja produkcyjna to osobny etap z akceptacją.\n\n12. Poza zakresem\nBlog, panel klienta, logowanie, płatności, wersje językowe, CRM, kalendarz rezerwacji, działający formularz kontaktowy, rozbudowany katalog usług.\n\n13. Treści i wiarygodność\nTreści konkretne i biznesowe, najpierw wartość, potem technologia. Bez gwarantowanych oszczędności i wyników. Bez fikcyjnych klientów, logotypów, partnerstw, certyfikatów, opinii i statystyk. Przykłady oznaczone jako demonstracyjne.\n\n14. Oczekiwany proces realizacji\nOsobna akceptacja: zakres projektu, UX i struktura informacji, kierunek wizualny, UI i design system, implementacja, Preview, publikacja. Zależy nam na akceptacji UX i kierunku wizualnego przed implementacją.\n\n15. Kryteria odbioru\nCztery widoki, poprawne działanie na desktopie i mobile, działająca nawigacja i CTA, brak pustych linków, zgodność z zaakceptowanym UI, czytelna hierarchia, obsługa klawiaturą z widocznym focusem, brak poziomego scrollowania, edycja treści bez kodu, edycja pól ACF, edycja metadanych SEO, zachowanie treści przy aktualizacji kodu, nieindeksowana wersja Preview przed publikacją."

/**
 * Creates the example delivery project, once. The project stops at the brief on purpose: the wizard, the stage drafts
 * and the plan are what the operator then runs against their own connected agent, and seeding their output would
 * fake evidence the system is built to refuse.
 */
export async function seedExampleDeliveryProject(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  options: { walkthrough?: { actorUserId: string } } = {},
): Promise<DeliveryProject | null> {
  const existing = await em.findOne(DeliveryProject, {
    name: EXAMPLE_PROJECT_NAME,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (existing) return null

  const project = em.create(DeliveryProject, {
    // The walkthrough attaches renders to this project, so the id has to exist before the first flush.
    id: randomUUID(),
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
  if (options.walkthrough) {
    const { seedExampleWalkthrough } = await import('./exampleWalkthrough')
    await seedExampleWalkthrough(em, project, options.walkthrough.actorUserId, scope)
  }
  logger.info('seeded the example delivery project', { projectId: project.id, tenantId: scope.tenantId, walkthrough: Boolean(options.walkthrough) })
  return project
}
