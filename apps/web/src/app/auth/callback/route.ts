import { NextResponse, type NextRequest } from 'next/server';

import { createRequestClient } from '@/server/supabase';

/**
 * Where Supabase sends a user after they confirm an email or follow a magic
 * link. Exchanges the one-time code for a session and forwards them on.
 *
 * The redirect target is validated as a same-origin path. Reflecting whatever
 * arrives in the query string would turn this route into an open redirect —
 * and an open redirect on an authentication callback is a phishing primitive,
 * because the link genuinely comes from this product's domain.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const requested = searchParams.get('next');

  const next =
    requested && requested.startsWith('/') && !requested.startsWith('//')
      ? requested
      : '/es/overview';

  if (!code) {
    return NextResponse.redirect(`${origin}/es/sign-in?error=missing_code`);
  }

  const supabase = await createRequestClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // The underlying message is not reflected: it distinguishes an expired link
    // from an invalid one, which is information an attacker probing links does
    // not need.
    return NextResponse.redirect(`${origin}/es/sign-in?error=link_expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
