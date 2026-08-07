/* eslint-disable no-console -- A CLI script's output is its interface. */
import { execFileSync } from 'node:child_process';

import './load-env.js';

import { getServerEnv } from '@app/validation/env';

/**
 * Drops and rebuilds the database from migrations.
 *
 * Destructive, and therefore refused outright when the target is production
 * (spec §124). The check is on APP_ENV rather than a prompt because a prompt is
 * something a CI runner answers by accident.
 */
function reset(): void {
  const env = getServerEnv();

  if (env.APP_ENV === 'production') {
    console.error('Refusing to reset a production database. This command is for development only.');
    process.exit(1);
  }

  if (env.DIRECT_URL.includes('supabase.co') && process.env['CONFIRM_RESET'] !== 'yes') {
    console.error(
      'DIRECT_URL points at a hosted Supabase project.\n' +
        'This will destroy every table and all data in it.\n' +
        'Re-run with CONFIRM_RESET=yes if that is genuinely what you want.',
    );
    process.exit(1);
  }

  console.log('Resetting database…');
  execFileSync('supabase', ['db', 'reset', '--db-url', env.DIRECT_URL], { stdio: 'inherit' });
  console.log('Reset complete. Run `pnpm db:seed` to repopulate reference data.');
}

reset();
