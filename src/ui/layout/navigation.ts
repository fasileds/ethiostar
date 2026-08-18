/**
 * Navigation definitions.
 *
 * Data, not markup, so the same structure drives the sidebar, the mobile drawer, the
 * command palette and the breadcrumb trail — and so a permission change is reflected
 * everywhere at once.
 *
 * `permission` is the gate. The nav is filtered by what the actor actually holds, which
 * means a Store Keeper never sees a Finance link to be refused at. That is a UI courtesy,
 * NOT a security control — the real check happens in the use case, next to the data.
 * docs/adr/0011-authorization-model.md
 */

export interface NavItem {
  readonly label: string
  readonly labelAm: string
  readonly href: string
  readonly icon: IconName
  /** Permission required to see this item. Omitted means "any authenticated actor". */
  readonly permission?: string
  /** Shown as a count chip — pending work waiting on this user. */
  readonly badgeKey?: 'applications' | 'deliveryRequests' | 'acceptances' | 'releases'
}

export interface NavSection {
  readonly title: string
  readonly titleAm: string
  readonly items: readonly NavItem[]
}

export type IconName =
  | 'dashboard'
  | 'applications'
  | 'customers'
  | 'delivery'
  | 'receiving'
  | 'consignments'
  | 'warehouse'
  | 'stock'
  | 'bags'
  | 'calendar'
  | 'processing'
  | 'acceptance'
  | 'dispatch'
  | 'gate'
  | 'labour'
  | 'printing'
  | 'audit'
  | 'admin'
  | 'documents'
  | 'profile'
  | 'tasks'

/** The staff back-office, grouped by where it sits in the operational chain. */
export const STAFF_NAV: readonly NavSection[] = [
  {
    title: 'Overview',
    titleAm: 'አጠቃላይ እይታ',
    items: [
      { label: 'Dashboard', labelAm: 'ዳሽቦርድ', href: '/dashboard', icon: 'dashboard' },
      {
        label: 'Tasks',
        labelAm: 'ተግባራት',
        href: '/tasks',
        icon: 'tasks',
        permission: 'workflow:decide_task',
      },
    ],
  },
  {
    title: 'Customers',
    titleAm: 'ደንበኞች',
    items: [
      {
        label: 'Applications',
        labelAm: 'ማመልከቻዎች',
        href: '/applications',
        icon: 'applications',
        permission: 'customer_application:view',
        badgeKey: 'applications',
      },
      {
        label: 'Customers',
        labelAm: 'ደንበኞች',
        href: '/customers',
        icon: 'customers',
        permission: 'customer:view',
      },
      {
        label: 'Contracts',
        labelAm: 'ውሎች',
        href: '/contracts',
        icon: 'documents',
        permission: 'contract:view',
      },
    ],
  },
  {
    title: 'Inbound',
    titleAm: 'ገቢ',
    items: [
      {
        label: 'Delivery requests',
        labelAm: 'የማድረስ ጥያቄዎች',
        href: '/delivery-requests',
        icon: 'delivery',
        permission: 'delivery_request:view',
        badgeKey: 'deliveryRequests',
      },
      {
        label: 'Receiving',
        labelAm: 'መረከብ',
        href: '/receiving',
        icon: 'receiving',
        permission: 'goods_receipt:view',
      },
    ],
  },
  {
    title: 'Store',
    titleAm: 'መጋዘን',
    items: [
      {
        label: 'Consignments',
        labelAm: 'ጭነቶች',
        href: '/consignments',
        icon: 'consignments',
        permission: 'stock:view',
      },
      {
        label: 'Stock',
        labelAm: 'ክምችት',
        href: '/stock',
        icon: 'stock',
        permission: 'stock:view',
      },
      {
        label: 'Warehouse',
        labelAm: 'መጋዘን',
        href: '/warehouse',
        icon: 'warehouse',
        permission: 'warehouse:view',
      },
      {
        label: 'Kesha',
        labelAm: 'ከረጢት',
        href: '/kesha',
        icon: 'bags',
        permission: 'kesha:view',
      },
    ],
  },
  {
    title: 'Production',
    titleAm: 'ምርት',
    items: [
      {
        label: 'Scheduling',
        labelAm: 'መርሃ ግብር',
        href: '/scheduling',
        icon: 'calendar',
        permission: 'appointment:view',
      },
      {
        label: 'Processing',
        labelAm: 'ማቀናበር',
        href: '/processing',
        icon: 'processing',
        permission: 'job_order:view',
      },
      {
        label: 'Acceptance',
        labelAm: 'ተቀባይነት',
        href: '/acceptance',
        icon: 'acceptance',
        permission: 'acceptance:view',
        badgeKey: 'acceptances',
      },
    ],
  },
  {
    title: 'Outbound',
    titleAm: 'ወጪ',
    items: [
      {
        label: 'Dispatch',
        labelAm: 'መላክ',
        href: '/dispatch',
        icon: 'dispatch',
        permission: 'dispatch:view',
        badgeKey: 'releases',
      },
      {
        label: 'Gate',
        labelAm: 'በር',
        href: '/gate',
        icon: 'gate',
        permission: 'dispatch:record_gate_out',
      },
    ],
  },
  {
    title: 'Support',
    titleAm: 'ድጋፍ',
    items: [
      {
        label: 'Labour',
        labelAm: 'ሠራተኛ',
        href: '/labour',
        icon: 'labour',
        permission: 'labour:view',
      },
      {
        label: 'Billing',
        labelAm: 'ክፍያ',
        href: '/billing',
        icon: 'documents',
        permission: 'billing:view',
      },
      {
        label: 'Printing',
        labelAm: 'ህትመት',
        href: '/printing',
        icon: 'printing',
        permission: 'document:print',
      },
      {
        label: 'Reports',
        labelAm: 'ሪፖርቶች',
        href: '/reports',
        icon: 'audit',
        permission: 'report:view_operational',
      },
      {
        label: 'Audit',
        labelAm: 'ኦዲት',
        href: '/audit',
        icon: 'audit',
        permission: 'audit:view',
      },
      {
        label: 'Administration',
        labelAm: 'አስተዳደር',
        href: '/admin',
        icon: 'admin',
        permission: 'admin:manage_settings',
      },
    ],
  },
]

/**
 * The customer portal. Deliberately short — a customer has five things to do.
 *
 * Every href is under /portal. Staff and customers see different pages for the same concept
 * (a delivery request means something different to each), and a route group alone would not
 * separate them — two groups resolving to the same path is a build error, and worse, an
 * invitation to serve one audience the other's screen.
 */
export const PORTAL_NAV: readonly NavSection[] = [
  {
    title: 'My coffee',
    titleAm: 'የእኔ ቡና',
    items: [
      { label: 'Dashboard', labelAm: 'ዳሽቦርድ', href: '/portal/dashboard', icon: 'dashboard' },
      { label: 'My stock', labelAm: 'ክምችቴ', href: '/portal/my-stock', icon: 'stock' },
      {
        label: 'Delivery requests',
        labelAm: 'የማድረስ ጥያቄዎች',
        href: '/portal/delivery-requests',
        icon: 'delivery',
      },
      {
        label: 'Processing requests',
        labelAm: 'የማቀናበር ጥያቄዎች',
        href: '/portal/processing-requests',
        icon: 'processing',
      },
      {
        label: 'Appointments',
        labelAm: 'ቀጠሮዎች',
        href: '/portal/appointments',
        icon: 'calendar',
      },
      {
        label: 'Acceptances',
        labelAm: 'ተቀባይነቶች',
        href: '/portal/acceptances',
        icon: 'acceptance',
      },
      {
        label: 'Release requests',
        labelAm: 'የመልቀቅ ጥያቄዎች',
        href: '/portal/release-requests',
        icon: 'dispatch',
      },
    ],
  },
  {
    title: 'Account',
    titleAm: 'መለያ',
    items: [
      { label: 'Billing', labelAm: 'ክፍያ', href: '/portal/billing', icon: 'documents' },
      { label: 'Documents', labelAm: 'ሰነዶች', href: '/portal/documents', icon: 'documents' },
      { label: 'My contract', labelAm: 'የእኔ ውል', href: '/portal/contract', icon: 'documents' },
      { label: 'Profile', labelAm: 'መገለጫ', href: '/portal/profile', icon: 'profile' },
    ],
  },
]

/** Filter a nav tree by the permissions an actor actually holds. */
export function visibleSections(
  sections: readonly NavSection[],
  permissions: ReadonlySet<string>,
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => item.permission === undefined || permissions.has(item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0)
}
