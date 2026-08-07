import { signOut } from '@/server/auth-actions';

export function SignOutButton({ locale, label }: { locale: string; label: string }) {
  return (
    <form action={signOut}>
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        className="text-xs text-[color:var(--color-ink-secondary)] underline underline-offset-4 transition-opacity duration-(--duration-quick) hover:opacity-60"
      >
        {label}
      </button>
    </form>
  );
}
