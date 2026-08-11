import { nextConfig } from '@app/config/eslint/next';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...nextConfig({ tsconfigRootDir: import.meta.dirname }),

  {
    files: ['src/**/*.tsx'],
    rules: {
      // The i18n rule exists so that customer-facing copy stays bilingual and
      // editable. This application is internal, English-only and read by people
      // who work on the product; routing its labels through a two-language
      // catalogue would double the maintenance of copy no customer ever sees.
      //
      // Deliberate deviation, recorded as ADR-014. It is scoped to this app and
      // to nothing else — the customer-facing applications keep the rule.
      'no-restricted-syntax': 'off',
    },
  },
];
