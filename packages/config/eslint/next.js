import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';

/**
 * Flat config for the Next.js application. Extends the base config with
 * browser globals and the UI-layer guards.
 *
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function nextConfig({ tsconfigRootDir }) {
  return tseslint.config(
    ...baseConfig({ tsconfigRootDir }),
    {
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
      },
    },
    {
      files: ['**/*.tsx'],
      rules: {
        // Every user-visible string belongs in messages/{es,en}.json. The app is
        // bilingual from day one (ADR-003); a literal here is a string that will
        // never be translated. Warn rather than error so a work-in-progress
        // screen is not blocked, but the debt stays visible.
        'no-restricted-syntax': [
          'warn',
          {
            selector: 'JSXText[value=/[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}/]',
            message:
              'User-visible copy must come from the i18n catalog (useTranslations / getTranslations), not a JSX literal.',
          },
        ],
      },
    },
  );
}

export default nextConfig;
