// eslint-config-next 16 ships native flat config — FlatCompat is neither needed nor
// compatible here (it throws "Converting circular structure to JSON" on these presets).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'
import boundaries from 'eslint-plugin-boundaries'

/**
 * Module tiers — see docs/architecture/01-principles-and-layering.md §1.3.
 * A module may import from core/db/platform and from modules in a STRICTLY LOWER tier.
 * Same-tier imports are forbidden: if two same-tier modules need each other, either the
 * dependency belongs lower or the two modules are one module.
 */
const TIER = {
  1: ['identity', 'master-data', 'audit'],
  2: ['notification', 'printing', 'files', 'warehouse', 'customers', 'workflow'],
  3: ['onboarding', 'stock', 'kesha', 'labour', 'contracts'],
  4: ['consignment'],
  5: ['inbound', 'scheduling', 'processing', 'acceptance', 'dispatch'],
  // Phase 2 commercial layer: billing needs pricing (contracts, tier 3) and operational
  // events from every tier-5 module, and the portal must show a customer their own invoices
  // and balance — so billing sits BELOW portal/administration, not beside it.
  6: ['billing'],
  // Reporting reads across everything including billing, so it sits one tier above billing
  // — and one tier BELOW portal/administration (same-tier siblings would forbid a portal
  // dashboard from importing reporting's read models, which is exactly what it needs to do).
  7: ['reporting'],
  8: ['portal', 'administration'],
}

/** Modules at tier N may be imported by modules at tiers > N. */
const allowedModuleDeps = Object.keys(TIER).map((tier) => {
  const t = Number(tier)
  const lower = Object.entries(TIER)
    .filter(([lt]) => Number(lt) < t)
    .flatMap(([, names]) => names)
  return { tier: t, lower }
})

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'supabase/.temp/**',
      'supabase/.branches/**',
      'coverage/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },

  // ── Architectural boundaries ────────────────────────────────────────────────
  {
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core/*', mode: 'folder', capture: ['area'] },
        { type: 'config', pattern: 'src/config/*', mode: 'file' },
        { type: 'db', pattern: 'src/db/*', mode: 'file' },
        { type: 'platform', pattern: 'src/platform/*', mode: 'folder', capture: ['adapter'] },
        {
          type: 'module',
          pattern: 'src/modules/*',
          mode: 'folder',
          capture: ['moduleName'],
        },
        { type: 'server', pattern: 'src/server/*', mode: 'file' },
        { type: 'ui', pattern: 'src/ui/*', mode: 'folder' },
        { type: 'app', pattern: 'src/app/*', mode: 'file' },
        { type: 'worker', pattern: 'src/worker/*', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/no-private': 'off',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // The kernel depends on nothing inside src/.
            { from: ['core'], allow: ['core'] },

            { from: ['config'], allow: ['core', 'config'] },
            { from: ['db'], allow: ['core', 'config', 'db'] },
            { from: ['platform'], allow: ['core', 'config', 'db', 'platform'] },

            // Modules: core/config/db/platform always; other modules only from a lower tier.
            ...allowedModuleDeps.map(({ tier, lower }) => ({
              from: [['module', { moduleName: `(${TIER[tier].join('|')})` }]],
              allow: [
                'core',
                'config',
                'db',
                'platform',
                'ui',
                ...(lower.length ? [['module', { moduleName: `(${lower.join('|')})` }]] : []),
                // A module may always import itself.
                ...TIER[tier].map((m) => ['module', { moduleName: m }]),
              ],
            })),

            { from: ['ui'], allow: ['core', 'ui'] },
            {
              from: ['server'],
              allow: ['core', 'config', 'db', 'platform', 'server', 'module'],
            },
            {
              from: ['worker'],
              allow: ['core', 'config', 'db', 'platform', 'server', 'module', 'worker'],
            },
            // Routing may reach anything — it is the composition surface.
            {
              from: ['app'],
              allow: ['core', 'config', 'platform', 'module', 'server', 'ui', 'app'],
            },
          ],
        },
      ],
    },
  },

  // ── Encapsulation: no deep imports into another module's internals ──────────
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@modules/*/domain/*',
                '@modules/*/application/*',
                '@modules/*/infrastructure/*',
                '@modules/*/interface/*',
                '@/modules/*/domain/*',
                '@/modules/*/application/*',
                '@/modules/*/infrastructure/*',
                '@/modules/*/interface/*',
              ],
              message:
                'Import a module through its public API (@modules/<name>) — deep imports break encapsulation. See docs/architecture/02-project-structure.md §2.9.',
            },
          ],
        },
      ],
    },
  },

  // A module may of course import its own internals.
  {
    files: ['src/modules/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // ── process.env is read in exactly one place ────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    // instrumentation.ts is the boot entry point: it reads NEXT_RUNTIME and TIME_ZONE before
    // the config module is loadable, which is the one legitimate exception.
    ignores: ['src/config/env.ts', 'src/config/env.client.ts', 'src/instrumentation.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read configuration from @config/env, never process.env directly. See docs/architecture/06-cross-cutting.md §6.1.',
        },
      ],
    },
  },

  // ── Determinism: no ambient time outside the clock ──────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    // Time primitives. `Clock` is the injected boundary; these modules implement it, and
    // uuidv7 needs a time source to embed. Everything else must inject Clock.
    ignores: [
      'src/core/clock/**',
      'src/core/ids/**',
      'src/core/utils/date.ts',
      'src/core/i18n/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'Inject Clock instead of new Date() — untestable scheduling/dwell-time logic otherwise. See docs/architecture/02-project-structure.md §2.5.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Inject Clock instead of Date.now().',
        },
      ],
    },
  },

  // ── Domain purity: no I/O, no framework, no SQL in the domain layer ─────────
  {
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/*', 'postgres', '@db/*', '@/db/*'],
              message: 'The domain layer must not know about persistence.',
            },
            {
              group: ['next', 'next/*', 'react', 'react-dom', '@supabase/*'],
              message: 'The domain layer must not know about the framework.',
            },
            {
              group: ['@platform/*', '@/platform/*', '@server/*', '@/server/*'],
              message: 'The domain layer must not depend on infrastructure.',
            },
          ],
        },
      ],
    },
  },

  // ── Interface layer must not reach the database directly ────────────────────
  {
    files: ['src/modules/*/interface/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@db/*', '@/db/*', 'drizzle-orm', 'drizzle-orm/*'],
              message:
                'Actions and controllers delegate to a use case; they never query the database. See docs/architecture/01-principles-and-layering.md §1.2.',
            },
          ],
        },
      ],
    },
  },

  // ── File-size ceiling: prevents the monolithic-file failure mode ────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  /**
   * React components keep the FILE ceiling but are exempt from the FUNCTION ceiling.
   *
   * The function rule exists to stop complex branching logic accumulating in one place. A
   * component body is mostly a JSX return — markup, not logic — and chopping a 70-line
   * table into three helpers that each render a fragment makes it harder to read, not
   * easier.
   *
   * The 300-line FILE cap still applies, and that is the limit that actually prevents a
   * monolith. A component that genuinely accumulates branching logic will breach it.
   */
  {
    files: ['src/**/*.tsx'],
    rules: { 'max-lines-per-function': 'off' },
  },

  // Declarative files: table definitions, catalogues and SQL. The line ceilings exist to
  // stop complex LOGIC accumulating in one place; a long SQL statement or a permission
  // catalogue is not that, and splitting either would make it harder to read, not easier.
  {
    files: [
      'src/db/schema/**/*.ts',
      'db/seeds/**/*.ts',
      'src/core/errors/error-codes.ts',
      'src/config/settings.schema.ts',
      'src/core/i18n/messages/**',
      'src/modules/*/domain/permissions.ts',
      'src/modules/*/domain/roles.ts',
      // *.query.ts files are SQL, not branching logic.
      'src/modules/*/application/*.query.ts',
    ],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },

  // Tests may be long and may construct dates freely.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-imports': 'off',
      'boundaries/element-types': 'off',
    },
  },
]

export default eslintConfig
