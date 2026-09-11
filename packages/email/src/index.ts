export { CATALOGUE, definitionFor, TOKEN_EXPRESSION } from './catalogue.js';
export { sendWithBrevo, type BrevoConfig, type OutgoingMail, type SendOutcome } from './brevo.js';
export {
  escapeHtml,
  LOCALE_CONDITION,
  renderEmail,
  renderForSupabase,
  SITE_URL_EXPRESSION,
  supabaseFieldsFor,
  supabaseSwitchFor,
} from './render.js';
export { CONTENT_WIDTH, DARK, FONT_MONO, FONT_SANS, LIGHT, type EmailPalette } from './tokens.js';
export {
  COPY_FIELDS,
  EMAIL_LOCALES,
  type ButtonSpec,
  type CopyField,
  type EmailChannel,
  type EmailCopy,
  type EmailFeature,
  type EmailGroup,
  type EmailLocale,
  type EmailRow,
  type RenderedEmail,
  type RenderInput,
  type TemplateDefinition,
  type VariableSpec,
} from './types.js';
export { COPY_LIMITS, validateCopy, type CopyProblem, type CopyProblemKind } from './validate.js';
