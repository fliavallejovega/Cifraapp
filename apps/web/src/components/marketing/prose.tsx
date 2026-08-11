/**
 * Rendering a body written in the CMS.
 *
 * A deliberately small subset — paragraphs, second-level headings, bullet lists
 * — parsed here rather than through a Markdown library. Two reasons, and the
 * second is the real one.
 *
 * A dependency that turns arbitrary text into HTML is an injection surface on a
 * page served to logged-out visitors, and defending it properly means a
 * sanitizer and a policy for what authors may embed. The subset below produces
 * React elements and never HTML strings, so there is nothing to sanitize: an
 * author who types a `<script>` tag gets a paragraph containing that text.
 *
 * And the constraint is honest about what these pages are. Marketing copy in
 * this product is prose and lists. When it needs a table or an embed, that is a
 * component with its own design, not a syntax an editor learns.
 */

export interface ProseProps {
  readonly body: string;
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

export function Prose({ body }: ProseProps) {
  const blocks = parseBlocks(body);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-6">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h2
              key={index}
              className="mt-12 text-lg font-medium first:mt-0"
              style={{ letterSpacing: 'var(--tracking-title)' }}
            >
              {block.text}
            </h2>
          );
        }

        if (block.kind === 'list') {
          return (
            <ul key={index} className="space-y-2">
              {block.items.map((item, itemIndex) => (
                <li
                  key={itemIndex}
                  className="max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p
            key={index}
            className="max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]"
          >
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];

  for (const chunk of body.split(/\n{2,}/)) {
    const trimmed = chunk.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith('## ')) {
      blocks.push({ kind: 'heading', text: trimmed.slice(3).trim() });
      continue;
    }

    const lines = trimmed.split('\n').map((line) => line.trim());
    if (lines.every((line) => line.startsWith('- '))) {
      blocks.push({ kind: 'list', items: lines.map((line) => line.slice(2).trim()) });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: lines.join(' ') });
  }

  return blocks;
}
