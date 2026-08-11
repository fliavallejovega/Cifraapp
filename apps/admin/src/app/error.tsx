'use client';

import { Button, Page, PageHeader } from '@app/ui';

/**
 * The error boundary.
 *
 * It shows the digest and nothing else. A stack trace on an internal console
 * looks harmless right up to the day the console is reachable from somewhere it
 * should not be, and the digest is enough to find the real error in the server
 * log — which is where an error belongs.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Page>
      <PageHeader
        title="Something failed"
        detail={
          error.digest
            ? `The server logged this as ${error.digest}.`
            : 'The server logged the details.'
        }
      />

      <Button onClick={reset}>Try again</Button>
    </Page>
  );
}
