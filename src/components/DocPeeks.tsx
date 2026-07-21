/**
 * Decorative layers around a drawn document, shared by the configurator grid and
 * the cart preview.
 *
 * Physical stack (front → back): folios delante · portada · páginas · folios
 * detrás · contraportada. So the blank sheets added *in front* cover page 1 (and
 * get the punch holes / rings on top), while the back sheets and the coloured
 * back cover peek out behind the page block — offset *beyond* the page thickness
 * (`depth`) so the drawn "canto" doesn't hide them.
 */

/** Coloured back cover + blank sheets behind the page block (paint behind the
 *  document via z-index:-1). Render BEFORE the .doc-clip element. */
export function PeekBehind({
  acabado,
  coverHex,
  foliosDetras,
  depth,
}: {
  acabado: string;
  coverHex?: string;
  foliosDetras: number;
  depth: number;
}) {
  const d = Math.round(depth);
  return (
    <>
      {/* Back cover: furthest back, peeks a bit further and to the right so the
          page "canto" (which fans bottom-right) can't fully cover it. */}
      {acabado === 'AnillasColores' && coverHex && (
        <span className="peek-behind cover-peek" style={{ background: coverHex, transform: `translate(${d + 13}px, ${d + 8}px)` }} aria-hidden />
      )}
      {foliosDetras > 1 && <span className="peek-behind sheet" style={{ transform: `translate(${d + 9}px, ${d + 9}px)` }} aria-hidden />}
      {foliosDetras > 0 && <span className="peek-behind sheet" style={{ transform: `translate(${d + 5}px, ${d + 5}px)` }} aria-hidden />}
    </>
  );
}

/** Blank sheets added in FRONT of page 1: they sit on top of the document
 *  (covering the cover). Render AFTER .doc-clip but BEFORE the holes/binding so
 *  the punch holes and rings are drawn over them. */
export function PeekFront({ foliosDelante }: { foliosDelante: number }) {
  return (
    <>
      {foliosDelante > 1 && <span className="peek-front sheet" style={{ transform: 'translate(-9px, -10px)' }} aria-hidden />}
      {foliosDelante > 0 && <span className="peek-front sheet" style={{ transform: 'translate(-4px, -5px)' }} aria-hidden />}
    </>
  );
}
