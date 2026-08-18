/**
 * Structural rules that complement the ESLint boundaries plugin.
 * ESLint enforces *who may import whom*; this enforces *shape* — no cycles, no orphans,
 * no reaching around a module's public API, and the service-role confinement.
 *
 * See docs/architecture/01-principles-and-layering.md §1.3 and
 *     docs/adr/0013-supabase-as-database-platform.md
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A dependency cycle means the module boundary is wrong. Break it with a domain event ' +
        'or by moving the shared concept to a lower tier.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unreachable module — dead code, or a missing wiring.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(babel|webpack)\\.config\\.(js|cjs|mjs|ts|json)$',
          '^src/app/',
          '^src/db/schema/',
        ],
      },
      to: {},
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'The domain layer must be pure TypeScript: no persistence, no framework, no infrastructure.',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: {
        path: '^(src/db|src/platform|src/server)/|^node_modules/(drizzle-orm|postgres|next|@supabase)',
      },
    },
    {
      name: 'interface-not-to-db',
      severity: 'error',
      comment: 'Actions and controllers delegate to a use case; they never query the database.',
      from: { path: '^src/modules/[^/]+/interface/' },
      to: { path: '^src/db/(client|transaction)' },
    },
    {
      name: 'core-depends-on-nothing',
      severity: 'error',
      comment: 'The kernel must not depend on anything else in src/.',
      from: { path: '^src/core/' },
      to: { path: '^src/(?!core/)' },
    },
    {
      name: 'no-deep-module-imports',
      severity: 'error',
      comment:
        'Import a module through its public API (src/modules/<name>/index.ts). Deep imports ' +
        'defeat encapsulation and make internal refactors breaking changes.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/(domain|application|infrastructure|interface)/',
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Production code must not import a devDependency.',
      from: { path: '^src/', pathNot: '\\.test\\.tsx?$' },
      to: { dependencyTypes: ['npm-dev'], pathNot: '^node_modules/@types/' },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys)$' },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.tsx?$|^src/app/.*\\.(css)$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
