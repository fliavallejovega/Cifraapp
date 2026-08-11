import { Page, PageHeader } from '@app/ui';

/**
 * The response an unauthorized caller gets.
 *
 * Deliberately identical to a genuine missing page, and deliberately incurious.
 * It does not say "sign in", it does not name the console, and it does not hint
 * that a correct address exists — everything on this page is what somebody
 * probing a hostname should learn, which is nothing.
 */
export default function NotFound() {
  return (
    <Page>
      <PageHeader title="Not found" detail="There is nothing at this address." />
    </Page>
  );
}
