import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Property accesses that are unsafe on monetary values. Kept in a constant
 * because flat config replaces (rather than merges) a rule's options when a
 * later block redeclares it — every block that sets `no-restricted-properties`
 * must therefore carry these forward.
 */
const MONEY_UNSAFE_PROPERTIES = [
  {
    object: 'Number',
    property: 'parseFloat',
    message:
      'Floating point cannot represent money. Parse through Money.fromDecimalString() in @app/domain.',
  },
];

/**
 * Identifiers that name a monetary value. Arithmetic and rounding on these must
 * go through Money. Kept narrow on purpose: banning `Math.round` outright would
 * also block legitimate non-monetary rounding, like counting days across a DST
 * boundary, and a rule that fires on correct code gets disabled rather than
 * obeyed.
 */
const MONEY_IDENTIFIER = '/^(amount|balance|total|subtotal|price|cost|payment|principal)$/i';

/**
 * Shared flat config for every TypeScript package in the monorepo.
 *
 * Beyond the usual correctness rules, this config encodes the domain's
 * non-negotiables as lint errors. They exist because each one, left unenforced,
 * eventually produces wrong money on a user's screen:
 *
 *   - No floating-point arithmetic on monetary identifiers (spec §7, §95).
 *   - No raw `process.env` outside the validated env module (spec §121).
 *   - No swallowed promises in code paths that write financial state (spec §96).
 *
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function baseConfig({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/.next/**',
        '**/node_modules/**',
        '**/coverage/**',
        '**/.turbo/**',
        '**/*.config.js',
        '**/*.config.mjs',
      ],
    },

    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
    },

    {
      rules: {
        // --- Correctness -------------------------------------------------
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        // `any` is how type safety quietly dies in a large codebase. Escape
        // hatches must be explicit and reviewable.
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unnecessary-condition': 'off',
        // Branded-identifier factories (`newId<AccountId>()`) intentionally use a
        // type parameter only in the return position — that is what selects the
        // brand at the call site, not a redundancy.
        '@typescript-eslint/no-unnecessary-type-parameters': 'off',

        // --- Money safety (spec §7, §72, §95) ----------------------------
        'no-restricted-globals': [
          'error',
          {
            name: 'parseFloat',
            message:
              'Floating point cannot represent money. Parse through Money.fromDecimalString() in @app/domain.',
          },
        ],
        'no-restricted-properties': ['error', ...MONEY_UNSAFE_PROPERTIES],
        'no-restricted-syntax': [
          'error',
          {
            selector: `BinaryExpression[operator=/^[+\\-*\\/%]$/] > Identifier[name=${MONEY_IDENTIFIER}]`,
            message:
              'Arithmetic on a monetary value must go through Money (add/sub/mul/allocate) in @app/domain, never a JS number operator.',
          },
          {
            selector: `CallExpression[callee.object.name='Math'][callee.property.name=/^(round|floor|ceil|trunc)$/] > Identifier[name=${MONEY_IDENTIFIER}]`,
            message:
              'Rounding a monetary value with Math silently loses cents. Use Money.roundToCurrencyPrecision(), which rounds with an explicit mode.',
          },
          {
            selector: 'TSEnumDeclaration',
            message:
              'Use a union type or a const object instead of an enum — enums do not erase cleanly under isolatedModules.',
          },
        ],

        // --- Style -------------------------------------------------------
        '@typescript-eslint/restrict-template-expressions': [
          'error',
          { allowNumber: true, allowBoolean: true },
        ],
        'no-console': ['error', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always', { null: 'ignore' }],
      },
    },

    // Environment access is validated in exactly one place, so a missing
    // variable fails at boot instead of at 3am in production (spec §121).
    {
      files: ['**/*.ts', '**/*.tsx'],
      ignores: [
        '**/packages/validation/src/env/**',
        '**/*.config.ts',
        '**/*.config.mts',
        '**/scripts/**',
        '**/drizzle.config.ts',
      ],
      rules: {
        'no-restricted-properties': [
          'error',
          ...MONEY_UNSAFE_PROPERTIES,
          {
            object: 'process',
            property: 'env',
            message:
              'Read configuration from @app/validation/env, which validates it with Zod at startup.',
          },
        ],
      },
    },

    // Tests are allowed the escape hatches that production code is not.
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**', '**/e2e/**'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        'no-restricted-properties': 'off',
        'no-console': 'off',
      },
    },

    prettier,
  );
}

export default baseConfig;
