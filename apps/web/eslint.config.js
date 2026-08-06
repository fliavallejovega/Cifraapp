import { nextConfig } from '@app/config/eslint/next';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...nextConfig({ tsconfigRootDir: import.meta.dirname }),
];
