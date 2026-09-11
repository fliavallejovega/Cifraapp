import type { TemplateDefinition, VariableSpec } from './types.js';

/**
 * Todos los correos que Cifraapp manda, con su texto de fábrica.
 *
 * ## Dos canales
 *
 * Los **avisos** —lo que vence hoy, subir los estados de cuenta— salen por Brevo
 * desde la aplicación. Los de **cuenta** —confirmar el correo, restablecer la
 * contraseña, un cambio de seguridad— los manda Supabase, que es quien maneja el
 * inicio de sesión. Los dos comparten este diseño y este registro, porque para
 * quien los recibe son todos correos de Cifraapp.
 *
 * ## El registro
 *
 * El de DESIGN.md: un profesional de finanzas competente, no una máquina que se
 * describe. Voseo, como el resto del producto. Nada que asuste sin motivo —un
 * aviso de seguridad dice qué pasó y qué hacer, no «actividad sospechosa»— y
 * nada que prometa lo que no existe: los correos de cuenta salen de una
 * dirección que no recibe respuestas, así que ninguno pide «respondé este
 * correo».
 *
 * ## Por qué el texto vive aquí y no en `messages/*.json`
 *
 * Porque un correo es contenido editable, no la interfaz: la consola lo cambia
 * sin desplegar. Este catálogo es el valor de fábrica en los dos idiomas, lado a
 * lado; lo que se edita en la consola se guarda aparte y gana sobre esto.
 */

// ── Variables ─────────────────────────────────────────────────────────────────

const email: VariableSpec = {
  name: 'email',
  description: 'The account email address.',
  example: { es: 'sofia@correo.com', en: 'sofia@mail.com' },
  goExpression: '{{ .Email }}',
};

const newEmail: VariableSpec = {
  name: 'new_email',
  description: 'The address the account is changing to.',
  example: { es: 'sofia.nueva@correo.com', en: 'sofia.new@mail.com' },
  goExpression: '{{ .NewEmail }}',
};

const oldEmail: VariableSpec = {
  name: 'old_email',
  description: 'The address the account used to have.',
  example: { es: 'sofia.vieja@correo.com', en: 'sofia.old@mail.com' },
  goExpression: '{{ .OldEmail }}',
};

const phone: VariableSpec = {
  name: 'phone',
  description: 'The new phone number.',
  example: { es: '+507 6123-4567', en: '+507 6123-4567' },
  goExpression: '{{ .Phone }}',
};

const oldPhone: VariableSpec = {
  name: 'old_phone',
  description: 'The phone number the account used to have.',
  example: { es: '+507 6987-6543', en: '+507 6987-6543' },
  goExpression: '{{ .OldPhone }}',
};

const provider: VariableSpec = {
  name: 'provider',
  description: 'The sign-in provider that was linked or removed.',
  example: { es: 'Google', en: 'Google' },
  goExpression: '{{ .Provider }}',
};

const factorType: VariableSpec = {
  name: 'factor_type',
  description: 'The two-factor method, as Supabase names it.',
  example: { es: 'totp', en: 'totp' },
  goExpression: '{{ .FactorType }}',
};

/** El código de verificación: la plantilla lo muestra sola, grande y aparte. */
export const TOKEN_EXPRESSION = '{{ .Token }}';

const token: VariableSpec = {
  name: 'token',
  description: 'The verification code. The email also shows it on its own, large.',
  example: { es: '48291375', en: '48291375' },
  goExpression: TOKEN_EXPRESSION,
};

const due: VariableSpec = {
  name: 'due',
  description: 'What is due today: one payment by name, or the count with the total.',
  example: { es: '3 pagos · $1,245.00', en: '3 payments · $1,245.00' },
};

const total: VariableSpec = {
  name: 'total',
  description: 'The sum of everything due today, already formatted.',
  example: { es: '$1,245.00', en: '$1,245.00' },
};

const count: VariableSpec = {
  name: 'count',
  description: 'How many payments are due today.',
  example: { es: '3', en: '3' },
};

const CONFIRMATION = '{{ .ConfirmationURL }}';

// ── Avisos (Brevo) ────────────────────────────────────────────────────────────

const commitmentDue: TemplateDefinition = {
  key: 'commitment_due',
  channel: 'brevo',
  group: 'notices',
  name: 'Payments due today',
  purpose: 'Sent the morning a commitment is due. One email per day, however many payments.',
  variables: [due, total, count],
  feature: 'rows',
  button: { required: false },
  defaults: {
    es: {
      subject: 'Para hoy: {due}',
      preheader: 'En total {total}. Es un recordatorio, no un cobro.',
      heading: 'Lo que vence hoy',
      body: 'Estos pagos vencen hoy. Cuando salgan, marcalos como pagados y el plan del mes se ajusta solo.',
      ctaLabel: 'Ver mis compromisos',
      footnote: 'Te escribimos porque tenés activados los avisos de pagos. Se apagan desde Ajustes.',
    },
    en: {
      subject: 'Due today: {due}',
      preheader: '{total} in total. A reminder, not a charge.',
      heading: "What's due today",
      body: 'These payments are due today. When they go out, mark them paid and the month’s plan adjusts on its own.',
      ctaLabel: 'See my commitments',
      footnote: "You're getting this because payment reminders are on. Turn them off in Settings.",
    },
  },
};

const statementUpload: TemplateDefinition = {
  key: 'statement_upload',
  channel: 'brevo',
  group: 'notices',
  name: 'Time to upload statements',
  purpose: 'Sent on the 1st and the 16th, so the month is built on real movements.',
  variables: [],
  feature: 'none',
  button: { required: false },
  defaults: {
    es: {
      subject: 'Toca subir los estados de cuenta',
      preheader: 'Son dos minutos, y el mes queda completo.',
      heading: 'Toca subir los estados de cuenta',
      body: 'Con los movimientos al día te decimos en qué se fue el dinero de verdad, y no lo que calculamos.\n\nSon dos minutos: descargá el estado de cada cuenta y cada tarjeta, y subilo.',
      ctaLabel: 'Subir estados de cuenta',
      footnote: 'Te escribimos el 1 y el 16 de cada mes. Se apaga desde Ajustes.',
    },
    en: {
      subject: 'Time to upload your statements',
      preheader: 'Two minutes, and the month is complete.',
      heading: 'Time to upload your statements',
      body: 'With your movements up to date we can tell you where the money actually went, not what we estimated.\n\nIt takes two minutes: download each account’s and each card’s statement, and upload it.',
      ctaLabel: 'Upload statements',
      footnote: 'We write on the 1st and the 16th of each month. Turn it off in Settings.',
    },
  },
};

// ── Cuenta (Supabase) ─────────────────────────────────────────────────────────

const confirmation: TemplateDefinition = {
  key: 'auth_confirmation',
  channel: 'supabase',
  group: 'account',
  supabaseKind: 'confirmation',
  name: 'Confirm your email',
  purpose: 'Sent at sign-up. Without it the account cannot be used.',
  variables: [email],
  feature: 'none',
  button: { required: true, supabaseExpression: CONFIRMATION },
  defaults: {
    es: {
      subject: 'Confirmá tu correo para empezar',
      preheader: 'Un toque y tu cuenta de Cifraapp queda lista.',
      heading: 'Confirmá tu correo',
      body: 'Creaste una cuenta en Cifraapp con {email}. Tocá el botón para confirmar que es tuyo y entrar.\n\nEl enlace sirve una sola vez.',
      ctaLabel: 'Confirmar mi correo',
      footnote: 'Si no creaste esta cuenta, ignorá este correo: sin confirmarla, nadie puede usarla.',
    },
    en: {
      subject: 'Confirm your email to get started',
      preheader: 'One tap and your Cifraapp account is ready.',
      heading: 'Confirm your email',
      body: 'You created a Cifraapp account with {email}. Tap the button to confirm it’s yours and sign in.\n\nThe link works once.',
      ctaLabel: 'Confirm my email',
      footnote: "If you didn't create this account, ignore this email: without confirming it, nobody can use it.",
    },
  },
};

const recovery: TemplateDefinition = {
  key: 'auth_recovery',
  channel: 'supabase',
  group: 'account',
  supabaseKind: 'recovery',
  name: 'Reset your password',
  purpose: 'Sent when someone asks to reset the password.',
  variables: [email],
  feature: 'none',
  button: { required: true, supabaseExpression: CONFIRMATION },
  defaults: {
    es: {
      subject: 'Elegí una contraseña nueva',
      preheader: 'Pediste restablecer tu contraseña de Cifraapp.',
      heading: 'Elegí una contraseña nueva',
      body: 'Recibimos un pedido para restablecer la contraseña de {email}. Tocá el botón y elegí una nueva.\n\nEl enlace sirve una sola vez y vence en una hora.',
      ctaLabel: 'Elegir contraseña nueva',
      footnote: 'Si no lo pediste, ignorá este correo: tu contraseña actual sigue funcionando.',
    },
    en: {
      subject: 'Choose a new password',
      preheader: 'You asked to reset your Cifraapp password.',
      heading: 'Choose a new password',
      body: 'We got a request to reset the password for {email}. Tap the button and choose a new one.\n\nThe link works once and expires in an hour.',
      ctaLabel: 'Choose a new password',
      footnote: "If you didn't ask for this, ignore this email: your current password still works.",
    },
  },
};

const invite: TemplateDefinition = {
  key: 'auth_invite',
  channel: 'supabase',
  group: 'account',
  supabaseKind: 'invite',
  name: 'Invitation to create an account',
  purpose: 'Sent when an account is created on someone’s behalf.',
  variables: [email],
  feature: 'none',
  button: { required: true, supabaseExpression: CONFIRMATION },
  defaults: {
    es: {
      subject: 'Te invitaron a Cifraapp',
      preheader: 'Aceptá la invitación y elegí tu contraseña.',
      heading: 'Te invitaron a Cifraapp',
      body: 'Te invitaron a crear una cuenta en Cifraapp con {email}. Tocá el botón para aceptar y elegir tu contraseña.',
      ctaLabel: 'Aceptar la invitación',
      footnote: 'Si no esperabas esta invitación, ignorá este correo.',
    },
    en: {
      subject: "You've been invited to Cifraapp",
      preheader: 'Accept the invitation and choose your password.',
      heading: "You've been invited to Cifraapp",
      body: 'You were invited to create a Cifraapp account with {email}. Tap the button to accept and choose your password.',
      ctaLabel: 'Accept the invitation',
      footnote: "If you weren't expecting this invitation, ignore this email.",
    },
  },
};

const magicLink: TemplateDefinition = {
  key: 'auth_magic_link',
  channel: 'supabase',
  group: 'account',
  supabaseKind: 'magic_link',
  name: 'Sign-in link',
  purpose: 'Sent when someone signs in with a one-time link instead of a password.',
  variables: [email],
  feature: 'none',
  button: { required: true, supabaseExpression: CONFIRMATION },
  defaults: {
    es: {
      subject: 'Tu enlace para entrar a Cifraapp',
      preheader: 'Sirve una sola vez y vence en una hora.',
      heading: 'Tu enlace para entrar',
      body: 'Tocá el botón para entrar a Cifraapp con {email}.\n\nEl enlace sirve una sola vez y vence en una hora.',
      ctaLabel: 'Entrar a Cifraapp',
      footnote: 'Si no pediste entrar, ignorá este correo: el enlace sólo funciona desde tu bandeja.',
    },
    en: {
      subject: 'Your link to sign in to Cifraapp',
      preheader: 'It works once and expires in an hour.',
      heading: 'Your sign-in link',
      body: 'Tap the button to sign in to Cifraapp as {email}.\n\nThe link works once and expires in an hour.',
      ctaLabel: 'Sign in to Cifraapp',
      footnote: "If you didn't ask to sign in, ignore this email: the link only works from your inbox.",
    },
  },
};

const emailChange: TemplateDefinition = {
  key: 'auth_email_change',
  channel: 'supabase',
  group: 'account',
  supabaseKind: 'email_change',
  name: 'Confirm your new email',
  purpose: 'Sent to the new address when someone changes the account email.',
  variables: [email, newEmail],
  feature: 'none',
  button: { required: true, supabaseExpression: CONFIRMATION },
  defaults: {
    es: {
      subject: 'Confirmá tu correo nuevo',
      preheader: 'Para que Cifraapp empiece a escribirte a {new_email}.',
      heading: 'Confirmá tu correo nuevo',
      body: 'Pediste cambiar el correo de tu cuenta de {email} a {new_email}. Tocá el botón para confirmarlo.',
      ctaLabel: 'Confirmar el correo nuevo',
      footnote: 'Si no pediste este cambio, ignorá este correo y tu cuenta queda como está.',
    },
    en: {
      subject: 'Confirm your new email',
      preheader: 'So Cifraapp starts writing to {new_email}.',
      heading: 'Confirm your new email',
      body: 'You asked to change your account email from {email} to {new_email}. Tap the button to confirm it.',
      ctaLabel: 'Confirm the new email',
      footnote: "If you didn't ask for this change, ignore this email and your account stays as it is.",
    },
  },
};

const reauthentication: TemplateDefinition = {
  key: 'auth_reauthentication',
  channel: 'supabase',
  group: 'account',
  supabaseKind: 'reauthentication',
  name: 'Verification code',
  purpose: 'Sent when a signed-in person has to prove it is them, before a sensitive change.',
  variables: [token],
  feature: 'code',
  button: null,
  defaults: {
    es: {
      subject: 'Tu código de Cifraapp: {token}',
      preheader: 'Vence pronto y sirve una sola vez.',
      heading: 'Tu código de verificación',
      body: 'Escribí este código para confirmar que sos vos. Vence pronto y sirve una sola vez.',
      ctaLabel: '',
      footnote: 'Si no pediste un código, cambiá tu contraseña: alguien pudo haber entrado a tu cuenta.',
    },
    en: {
      subject: 'Your Cifraapp code: {token}',
      preheader: 'It expires soon and works once.',
      heading: 'Your verification code',
      body: 'Enter this code to confirm it’s you. It expires soon and works once.',
      ctaLabel: '',
      footnote: "If you didn't ask for a code, change your password: someone may have signed in to your account.",
    },
  },
};

/** Un aviso de seguridad: dice qué cambió y qué hacer si no fue quien lo lee. */
function securityNotice(input: {
  key: string;
  kind: string;
  name: string;
  purpose: string;
  variables: readonly VariableSpec[];
  es: { subject: string; body: string; footnote: string };
  en: { subject: string; body: string; footnote: string };
}): TemplateDefinition {
  return {
    key: input.key,
    channel: 'supabase',
    group: 'account',
    supabaseKind: input.kind,
    name: input.name,
    purpose: input.purpose,
    variables: input.variables,
    feature: 'none',
    button: null,
    defaults: {
      es: {
        subject: input.es.subject,
        preheader: 'Un aviso de seguridad de tu cuenta de Cifraapp.',
        heading: input.es.subject,
        body: input.es.body,
        ctaLabel: '',
        footnote: input.es.footnote,
      },
      en: {
        subject: input.en.subject,
        preheader: 'A security notice about your Cifraapp account.',
        heading: input.en.subject,
        body: input.en.body,
        ctaLabel: '',
        footnote: input.en.footnote,
      },
    },
  };
}

const IF_NOT_YOU_ES = 'Si no fuiste vos, cambiá tu contraseña cuanto antes desde la pantalla de entrada.';
const IF_NOT_YOU_EN = "If this wasn't you, change your password right away from the sign-in screen.";

const emailChanged = securityNotice({
  key: 'auth_email_changed',
  kind: 'email_changed_notification',
  name: 'Email address changed',
  purpose: 'Sent to the old address after the account email changes.',
  variables: [oldEmail, email],
  es: {
    subject: 'Cambió el correo de tu cuenta',
    body: 'El correo de tu cuenta de Cifraapp pasó de {old_email} a {email}.',
    footnote: IF_NOT_YOU_ES,
  },
  en: {
    subject: 'Your account email changed',
    body: 'Your Cifraapp account email changed from {old_email} to {email}.',
    footnote: IF_NOT_YOU_EN,
  },
});

const passwordChanged = securityNotice({
  key: 'auth_password_changed',
  kind: 'password_changed_notification',
  name: 'Password changed',
  purpose: 'Sent after the password changes.',
  variables: [email],
  es: {
    subject: 'Cambió tu contraseña',
    body: 'La contraseña de tu cuenta de Cifraapp ({email}) cambió recién.',
    footnote: 'Si no fuiste vos, restablecela cuanto antes desde la pantalla de entrada.',
  },
  en: {
    subject: 'Your password changed',
    body: 'The password for your Cifraapp account ({email}) just changed.',
    footnote: "If this wasn't you, reset it right away from the sign-in screen.",
  },
});

const phoneChanged = securityNotice({
  key: 'auth_phone_changed',
  kind: 'phone_changed_notification',
  name: 'Phone number changed',
  purpose: 'Sent after the account phone number changes.',
  variables: [oldPhone, phone],
  es: {
    subject: 'Cambió el teléfono de tu cuenta',
    body: 'El teléfono de tu cuenta de Cifraapp pasó de {old_phone} a {phone}.',
    footnote: IF_NOT_YOU_ES,
  },
  en: {
    subject: 'Your account phone changed',
    body: 'Your Cifraapp account phone changed from {old_phone} to {phone}.',
    footnote: IF_NOT_YOU_EN,
  },
});

const identityLinked = securityNotice({
  key: 'auth_identity_linked',
  kind: 'identity_linked_notification',
  name: 'Sign-in method added',
  purpose: 'Sent after another sign-in provider is linked.',
  variables: [provider, email],
  es: {
    subject: 'Agregaste una forma de entrar',
    body: 'Tu cuenta de {provider} ahora sirve para entrar a Cifraapp como {email}.',
    footnote: IF_NOT_YOU_ES,
  },
  en: {
    subject: 'You added a way to sign in',
    body: 'Your {provider} account can now be used to sign in to Cifraapp as {email}.',
    footnote: IF_NOT_YOU_EN,
  },
});

const identityUnlinked = securityNotice({
  key: 'auth_identity_unlinked',
  kind: 'identity_unlinked_notification',
  name: 'Sign-in method removed',
  purpose: 'Sent after a sign-in provider is removed.',
  variables: [provider, email],
  es: {
    subject: 'Quitaste una forma de entrar',
    body: 'Tu cuenta de {provider} ya no sirve para entrar a Cifraapp como {email}.',
    footnote: IF_NOT_YOU_ES,
  },
  en: {
    subject: 'You removed a way to sign in',
    body: 'Your {provider} account can no longer be used to sign in to Cifraapp as {email}.',
    footnote: IF_NOT_YOU_EN,
  },
});

const mfaEnrolled = securityNotice({
  key: 'auth_mfa_enrolled',
  kind: 'mfa_factor_enrolled_notification',
  name: 'Two-factor method added',
  purpose: 'Sent after a two-factor method is added.',
  variables: [factorType],
  es: {
    subject: 'Agregaste un método de verificación',
    body: 'Tu cuenta de Cifraapp ahora pide un segundo paso al entrar ({factor_type}).',
    footnote: IF_NOT_YOU_ES,
  },
  en: {
    subject: 'You added a verification method',
    body: 'Your Cifraapp account now asks for a second step at sign-in ({factor_type}).',
    footnote: IF_NOT_YOU_EN,
  },
});

const mfaUnenrolled = securityNotice({
  key: 'auth_mfa_unenrolled',
  kind: 'mfa_factor_unenrolled_notification',
  name: 'Two-factor method removed',
  purpose: 'Sent after a two-factor method is removed.',
  variables: [factorType],
  es: {
    subject: 'Quitaste un método de verificación',
    body: 'Tu cuenta de Cifraapp ya no pide el segundo paso {factor_type} al entrar.',
    footnote: IF_NOT_YOU_ES,
  },
  en: {
    subject: 'You removed a verification method',
    body: 'Your Cifraapp account no longer asks for the {factor_type} second step at sign-in.',
    footnote: IF_NOT_YOU_EN,
  },
});

/** Todos los correos, en el orden en que la consola los muestra. */
export const CATALOGUE: readonly TemplateDefinition[] = [
  commitmentDue,
  statementUpload,
  confirmation,
  recovery,
  magicLink,
  invite,
  emailChange,
  reauthentication,
  passwordChanged,
  emailChanged,
  phoneChanged,
  identityLinked,
  identityUnlinked,
  mfaEnrolled,
  mfaUnenrolled,
];

export function definitionFor(key: string): TemplateDefinition | null {
  return CATALOGUE.find((one) => one.key === key) ?? null;
}
