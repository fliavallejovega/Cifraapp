/**
 * Deterministic reference data (spec §70).
 *
 * No secrets, no production keys, no personal data. Running the seed twice must
 * leave the database in exactly the state one run leaves it in, so every insert
 * below is keyed and upserted rather than appended.
 */

export interface CurrencySeed {
  readonly code: string;
  readonly nameEn: string;
  readonly nameEs: string;
  readonly symbol: string;
  readonly minorUnits: number;
}

export const CURRENCY_SEED: readonly CurrencySeed[] = [
  { code: 'USD', nameEn: 'US Dollar', nameEs: 'Dólar estadounidense', symbol: '$', minorUnits: 2 },
  {
    code: 'PAB',
    nameEn: 'Panamanian Balboa',
    nameEs: 'Balboa panameño',
    symbol: 'B/.',
    minorUnits: 2,
  },
];

export interface JurisdictionSeed {
  readonly code: string;
  readonly nameEn: string;
  readonly nameEs: string;
  readonly authorityName: string;
  readonly authorityUrl: string;
  readonly defaultCurrency: string;
  /** False until versioned, reviewed rules exist. Phase 12 flips Panama to true. */
  readonly isSupported: boolean;
}

export const JURISDICTION_SEED: readonly JurisdictionSeed[] = [
  {
    code: 'PA',
    nameEn: 'Panama',
    nameEs: 'Panamá',
    authorityName: 'Dirección General de Ingresos (DGI)',
    authorityUrl: 'https://dgi.mef.gob.pa/',
    defaultCurrency: 'USD',
    isSupported: false,
  },
];

export type CategoryKindSeed = 'income' | 'expense' | 'transfer' | 'investment';

export interface CategorySeed {
  readonly slug: string;
  readonly parentSlug: string | null;
  readonly nameEn: string;
  readonly nameEs: string;
  readonly kind: CategoryKindSeed;
  readonly sortOrder: number;
}

/**
 * The default taxonomy from spec §15, in both interface languages.
 *
 * `transfers` and `income` are deliberately not expenses. A household that
 * moves $500 between its own accounts has spent nothing, and a credit card
 * payment is a transfer whose underlying purchases were already counted — a
 * taxonomy that cannot express that will overstate spending every month
 * (spec §11).
 */
export const CATEGORY_SEED: readonly CategorySeed[] = [
  // --- Income --------------------------------------------------------------
  {
    slug: 'income',
    parentSlug: null,
    nameEn: 'Income',
    nameEs: 'Ingresos',
    kind: 'income',
    sortOrder: 10,
  },
  {
    slug: 'income-salary',
    parentSlug: 'income',
    nameEn: 'Salary',
    nameEs: 'Salario',
    kind: 'income',
    sortOrder: 11,
  },
  {
    slug: 'income-freelance',
    parentSlug: 'income',
    nameEn: 'Freelance',
    nameEs: 'Trabajo independiente',
    kind: 'income',
    sortOrder: 12,
  },
  {
    slug: 'income-business',
    parentSlug: 'income',
    nameEn: 'Business Income',
    nameEs: 'Ingresos del negocio',
    kind: 'income',
    sortOrder: 13,
  },
  {
    slug: 'income-other',
    parentSlug: 'income',
    nameEn: 'Other Income',
    nameEs: 'Otros ingresos',
    kind: 'income',
    sortOrder: 19,
  },

  // --- Housing and utilities ----------------------------------------------
  {
    slug: 'housing',
    parentSlug: null,
    nameEn: 'Housing',
    nameEs: 'Vivienda',
    kind: 'expense',
    sortOrder: 20,
  },
  {
    slug: 'housing-rent',
    parentSlug: 'housing',
    nameEn: 'Rent',
    nameEs: 'Alquiler',
    kind: 'expense',
    sortOrder: 21,
  },
  {
    slug: 'housing-mortgage',
    parentSlug: 'housing',
    nameEn: 'Mortgage',
    nameEs: 'Hipoteca',
    kind: 'expense',
    sortOrder: 22,
  },
  {
    slug: 'housing-utilities',
    parentSlug: 'housing',
    nameEn: 'Utilities',
    nameEs: 'Servicios básicos',
    kind: 'expense',
    sortOrder: 23,
  },
  {
    slug: 'housing-maintenance',
    parentSlug: 'housing',
    nameEn: 'Maintenance',
    nameEs: 'Mantenimiento',
    kind: 'expense',
    sortOrder: 24,
  },

  // --- Everyday spending ---------------------------------------------------
  {
    slug: 'groceries',
    parentSlug: null,
    nameEn: 'Groceries',
    nameEs: 'Supermercado',
    kind: 'expense',
    sortOrder: 30,
  },
  {
    slug: 'dining',
    parentSlug: null,
    nameEn: 'Dining',
    nameEs: 'Restaurantes',
    kind: 'expense',
    sortOrder: 31,
  },
  {
    slug: 'transportation',
    parentSlug: null,
    nameEn: 'Transportation',
    nameEs: 'Transporte',
    kind: 'expense',
    sortOrder: 32,
  },
  {
    slug: 'transportation-fuel',
    parentSlug: 'transportation',
    nameEn: 'Fuel',
    nameEs: 'Combustible',
    kind: 'expense',
    sortOrder: 33,
  },
  {
    slug: 'transportation-transit',
    parentSlug: 'transportation',
    nameEn: 'Transit & Rides',
    nameEs: 'Transporte público y viajes',
    kind: 'expense',
    sortOrder: 34,
  },
  {
    slug: 'shopping',
    parentSlug: null,
    nameEn: 'Shopping',
    nameEs: 'Compras',
    kind: 'expense',
    sortOrder: 35,
  },
  {
    slug: 'entertainment',
    parentSlug: null,
    nameEn: 'Entertainment',
    nameEs: 'Entretenimiento',
    kind: 'expense',
    sortOrder: 36,
  },
  {
    slug: 'subscriptions',
    parentSlug: null,
    nameEn: 'Subscriptions',
    nameEs: 'Suscripciones',
    kind: 'expense',
    sortOrder: 37,
  },
  {
    slug: 'travel',
    parentSlug: null,
    nameEn: 'Travel',
    nameEs: 'Viajes',
    kind: 'expense',
    sortOrder: 38,
  },

  // --- Health, protection, people -----------------------------------------
  {
    slug: 'healthcare',
    parentSlug: null,
    nameEn: 'Healthcare',
    nameEs: 'Salud',
    kind: 'expense',
    sortOrder: 40,
  },
  {
    slug: 'insurance',
    parentSlug: null,
    nameEn: 'Insurance',
    nameEs: 'Seguros',
    kind: 'expense',
    sortOrder: 41,
  },
  {
    slug: 'education',
    parentSlug: null,
    nameEn: 'Education',
    nameEs: 'Educación',
    kind: 'expense',
    sortOrder: 42,
  },
  {
    slug: 'family',
    parentSlug: null,
    nameEn: 'Family',
    nameEs: 'Familia',
    kind: 'expense',
    sortOrder: 43,
  },
  {
    slug: 'personal',
    parentSlug: null,
    nameEn: 'Personal',
    nameEs: 'Personal',
    kind: 'expense',
    sortOrder: 44,
  },

  // --- Obligations ---------------------------------------------------------
  {
    slug: 'debt',
    parentSlug: null,
    nameEn: 'Debt',
    nameEs: 'Deudas',
    kind: 'expense',
    sortOrder: 50,
  },
  {
    slug: 'debt-interest',
    parentSlug: 'debt',
    nameEn: 'Interest',
    nameEs: 'Intereses',
    kind: 'expense',
    sortOrder: 51,
  },
  {
    slug: 'taxes',
    parentSlug: null,
    nameEn: 'Taxes',
    nameEs: 'Impuestos',
    kind: 'expense',
    sortOrder: 52,
  },
  {
    slug: 'fees',
    parentSlug: null,
    nameEn: 'Fees',
    nameEs: 'Comisiones',
    kind: 'expense',
    sortOrder: 53,
  },

  // --- Business ------------------------------------------------------------
  {
    slug: 'business',
    parentSlug: null,
    nameEn: 'Business',
    nameEs: 'Negocio',
    kind: 'expense',
    sortOrder: 60,
  },
  {
    slug: 'business-software',
    parentSlug: 'business',
    nameEn: 'Software',
    nameEs: 'Software',
    kind: 'expense',
    sortOrder: 61,
  },
  {
    slug: 'business-services',
    parentSlug: 'business',
    nameEn: 'Professional Services',
    nameEs: 'Servicios profesionales',
    kind: 'expense',
    sortOrder: 62,
  },
  {
    slug: 'business-supplies',
    parentSlug: 'business',
    nameEn: 'Supplies',
    nameEs: 'Insumos',
    kind: 'expense',
    sortOrder: 63,
  },

  // --- Not spending --------------------------------------------------------
  // These exist so the engine can classify movements that must never reach a
  // spending total.
  {
    slug: 'transfers',
    parentSlug: null,
    nameEn: 'Transfers',
    nameEs: 'Transferencias',
    kind: 'transfer',
    sortOrder: 70,
  },
  {
    slug: 'transfers-card-payment',
    parentSlug: 'transfers',
    nameEn: 'Credit Card Payment',
    nameEs: 'Pago de tarjeta',
    kind: 'transfer',
    sortOrder: 71,
  },
  {
    slug: 'transfers-internal',
    parentSlug: 'transfers',
    nameEn: 'Between Own Accounts',
    nameEs: 'Entre cuentas propias',
    kind: 'transfer',
    sortOrder: 72,
  },
  {
    slug: 'investments',
    parentSlug: null,
    nameEn: 'Investments',
    nameEs: 'Inversiones',
    kind: 'investment',
    sortOrder: 80,
  },
  {
    slug: 'savings',
    parentSlug: null,
    nameEn: 'Savings',
    nameEs: 'Ahorros',
    kind: 'transfer',
    sortOrder: 81,
  },

  {
    slug: 'other',
    parentSlug: null,
    nameEn: 'Other',
    nameEs: 'Otros',
    kind: 'expense',
    sortOrder: 99,
  },
];
