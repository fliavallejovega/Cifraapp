import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware replacements for Next's navigation primitives. Importing the
 * originals inside the app would drop the locale prefix and bounce the user
 * back through the middleware on every link.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
