import { nextConfig } from '@app/config/eslint/next';

export default [
  { ignores: ['.next/**', 'next-env.d.ts', 'public/sw.js'] },
  ...nextConfig({ tsconfigRootDir: import.meta.dirname }),
];
