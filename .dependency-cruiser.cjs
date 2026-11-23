/**
 * Architecture rules, enforced in CI (`pnpm deps:check`). They back up the per-file ESLint
 * `no-restricted-imports` rules with a whole-graph check, so a layering violation cannot
 * sneak in through an indirect import.
 *
 * Layers inside a module: routes -> service -> repository (port); the mongo adapter and
 * infra/ are the only code that touches the database driver.
 */
const ROUTES = '^src/modules/[^/]+/[^/]+\\.routes\\.ts$';
const SERVICE = '^src/modules/[^/]+/[^/]+\\.service\\.ts$';
const PORT = '^src/modules/[^/]+/[^/]+\\.repository\\.ts$';
const ADAPTER = '^src/modules/[^/]+/[^/]+\\.mongo-[^/]+\\.ts$';
const SCHEMA = '^src/modules/[^/]+/[^/]+\\.schema\\.ts$';
const PURE = '^src/modules/[^/]+/search/';
const INFRA = '^src/infra/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports hide layering mistakes.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'routes-use-services-only',
      severity: 'error',
      comment: 'HTTP handlers must not reach the repository, the database adapter or infra.',
      from: { path: ROUTES },
      to: { path: [PORT, ADAPTER, INFRA] },
    },
    {
      name: 'service-is-http-and-driver-free',
      severity: 'error',
      comment: 'Business rules depend on the repository port, never on HTTP or the driver.',
      from: { path: SERVICE },
      to: { path: [ROUTES, ADAPTER, INFRA], pathNot: '^src/infra/.*\\.d\\.ts$' },
    },
    {
      name: 'service-not-fastify-or-mongodb',
      severity: 'error',
      from: { path: SERVICE },
      to: { path: 'node_modules/(fastify|mongodb)/' },
    },
    {
      name: 'port-is-pure',
      severity: 'error',
      comment: 'The repository interface is a contract, not an implementation.',
      from: { path: PORT },
      to: { path: [ROUTES, SERVICE, ADAPTER, INFRA, 'node_modules/mongodb/'] },
    },
    {
      name: 'schema-is-pure',
      severity: 'error',
      from: { path: SCHEMA },
      to: { path: [ROUTES, SERVICE, PORT, ADAPTER, INFRA] },
    },
    {
      name: 'search-parser-is-pure',
      severity: 'error',
      comment: 'The query parser does no I/O, which keeps it unit-testable and swappable.',
      from: { path: PURE },
      to: { path: [ROUTES, ADAPTER, INFRA, '^node_modules/(mongodb|fastify)/'] },
    },
    {
      name: 'only-adapters-use-the-driver',
      severity: 'error',
      from: { path: '^src/', pathNot: [INFRA, ADAPTER] },
      to: { path: 'node_modules/mongodb/' },
    },
    {
      name: 'src-not-to-tests-or-scripts',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^(test|scripts)/' },
    },
    {
      name: 'no-dev-dependencies-in-src',
      severity: 'error',
      from: { path: '^src/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
