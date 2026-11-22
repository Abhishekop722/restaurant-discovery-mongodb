import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'data'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX, unicorn },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mongodb',
              message: 'Only *.mongo-*.ts files and src/infra may import the mongodb driver.',
            },
          ],
        },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      complexity: ['warn', 12],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'import-x/no-cycle': 'error',
      'import-x/order': ['error', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
    },
  },
  {
    // layering: routes -> service -> repository (port); only the mongo adapter and infra touch the driver
    files: ['src/modules/*/*.routes.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'mongodb', message: 'Routes must not touch the database.' }],
          patterns: [
            {
              group: ['**/*.repository.js', '**/*.mongo-*.js', '**/infra/**'],
              message: 'Routes call services only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/*/*.service.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'mongodb', message: 'Services depend on the repository port, not the driver.' },
            { name: 'fastify', message: 'Services must stay HTTP-agnostic.' },
          ],
          patterns: [
            {
              group: ['**/*.routes.js', '**/*.mongo-*.js', '**/infra/**'],
              message: 'Services depend on the repository interface only.',
            },
          ],
        },
      ],
    },
  },
  {
    // the only places allowed to import the mongodb driver
    files: ['src/infra/**', 'src/**/*.mongo-*.ts', 'scripts/**', 'test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // process.env is read in exactly one place
    files: ['src/**/*.ts'],
    ignores: ['src/config/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Read configuration via src/config only.' },
      ],
    },
  },
  {
    files: ['scripts/**', 'src/server.ts', 'src/infra/seed/cli.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
