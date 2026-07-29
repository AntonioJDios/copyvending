/**
 * Renders a legal document that the shop typed in the admin panel, replacing the
 * drafted template.
 *
 * Deliberately PLAIN TEXT (`white-space: pre-wrap`), never HTML: this content comes
 * from a form field, and rendering it as markup would be a stored-XSS hole on the
 * shop's own storefront. Line breaks and blank lines are honoured, which is enough
 * for a legal text.
 */
export function LegalOverride({ text }: { text: string }) {
  return <div className="legal-page legal-raw">{text}</div>;
}
