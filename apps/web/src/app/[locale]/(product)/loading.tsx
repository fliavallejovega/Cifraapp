import { Card, Page, Skeleton } from '@app/ui';

/**
 * What every product screen shows while its figures are being fetched.
 *
 * The navigation column and the household stay put — they belong to the layout,
 * and re-drawing them on every click is what made moving between screens feel
 * like a page reload rather than a change of view.
 *
 * This is a shape, not a spinner. A person who clicks «Movimientos» sees the
 * shape of a statement appear immediately and then fill in, which reads as fast
 * even when the query behind it is not. A spinner communicates only that
 * something is happening, which they already knew because they clicked.
 *
 * No copy: the words differ per screen and a wrong title flashing before the
 * right one is worse than no title.
 */
export default function ProductLoading() {
  return (
    <Page>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-[min(22rem,70%)]" />
        <Skeleton className="h-4 w-[min(34rem,90%)]" />
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-32" numeric />
          </Card>
        ))}
      </div>

      <div className="mt-12">
        <Card>
          <ul className="flex flex-col">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-6 border-b border-[color:var(--color-rule)] py-5 last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-[min(18rem,60%)]" />
                  <Skeleton className="h-3 w-[min(12rem,40%)]" />
                </span>
                <Skeleton className="h-4 w-24 shrink-0" numeric />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
