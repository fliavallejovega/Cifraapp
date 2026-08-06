import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('errors');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="mb-3 text-2xl font-medium" style={{ letterSpacing: 'var(--tracking-title)' }}>
        {t('notFoundTitle')}
      </h1>
      <p className="mb-8 text-pretty text-[color:var(--color-ink-muted)]">{t('notFoundBody')}</p>
      <Link href="/" className="text-sm underline underline-offset-4">
        {t('backHome')}
      </Link>
    </main>
  );
}
