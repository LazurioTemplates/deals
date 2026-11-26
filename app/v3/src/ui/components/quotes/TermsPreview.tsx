import { termsBlocks } from "../../../domain/quote.ts";

/**
 * A terms text as it prints: `## heading` lines as headings, `- item` lines
 * as a list, other lines as paragraphs split by an empty line.
 */
export function TermsPreview({
  source,
  className,
}: {
  source: string | undefined;
  className?: string;
}) {
  const blocks = termsBlocks(source);
  if (blocks.length === 0) return null;
  return (
    <div className={className ?? "terms-preview"}>
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "heading") return <h4 key={key}>{block.text}</h4>;
        if (block.kind === "list") {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the items of a text have no id; the same text may repeat
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{block.text}</p>;
      })}
    </div>
  );
}
