import { aiModels, aiSettings } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, asc, eq } from 'drizzle-orm';

import { AISettingForm } from '@/components/ai-setting-form';
import { ConsolePage } from '@/components/figures';
import { Console } from '@/components/shell';
import { adminDb } from '@/server/admin-session';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * Which model reads documents and which one talks.
 *
 * Reading a bank statement or a hotel confirmation asks for precision; the
 * assistant's conversation asks for speed and a lower price. Both default to
 * the model set in the environment until a row here says otherwise.
 */
export default async function AIModelsPage() {
  const session = await requireAdmin();
  const db = adminDb();
  const env = getServerEnv();

  const [settings, models] = await Promise.all([
    db.select({ purpose: aiSettings.purpose, model: aiSettings.modelKey }).from(aiSettings),
    db
      .select({ key: aiModels.modelKey, name: aiModels.displayName })
      .from(aiModels)
      .where(and(eq(aiModels.provider, env.AI_PROVIDER), eq(aiModels.isActive, true)))
      .orderBy(asc(aiModels.displayName)),
  ]);
  const current = (purpose: string) => settings.find((s) => s.purpose === purpose)?.model ?? null;
  const fallback = env.AI_MODEL ?? (env.AI_PROVIDER === 'openai' ? 'gpt-4.1' : 'provider default');

  const jobs = [
    {
      purpose: 'reading' as const,
      title: 'Reading documents',
      detail:
        'Scanned or photographed bank statements, banking-app screenshots and travel documents.',
    },
    {
      purpose: 'chat' as const,
      title: 'Assistant conversation',
      detail: 'The in-app assistant, questions about the plan and trip quick-create.',
    },
  ];

  return (
    <Console current="ai" email={session.email} role={session.role}>
      <ConsolePage
        title="AI models"
        detail={`Provider: ${env.AI_PROVIDER}. Each job uses the environment model until one is chosen here.`}
      >
        <div className="flex flex-col gap-10">
          {jobs.map((job) => (
            <section key={job.purpose} className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-medium">{job.title}</h2>
                <p className="text-sm text-[color:var(--color-ink-secondary)]">{job.detail}</p>
              </div>
              <AISettingForm
                purpose={job.purpose}
                current={current(job.purpose)}
                fallback={fallback}
                models={models}
              />
            </section>
          ))}
        </div>
        {models.length === 0 && (
          <p className="mt-8 text-sm text-[color:var(--color-ink-secondary)]">
            No active models are listed for this provider in platform.ai_models.
          </p>
        )}
      </ConsolePage>
    </Console>
  );
}
