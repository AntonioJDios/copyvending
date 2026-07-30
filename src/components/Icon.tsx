/**
 * Iconos de la tienda.
 *
 * Dibujados aquí, no emojis. Los emojis los pinta el sistema operativo: cambian
 * de estilo en cada dispositivo, no se pueden colorear con la marca y en una
 * portada quedan como un apaño. Estos son de trazo, heredan el color del texto
 * (`currentColor`) y pesan unos bytes cada uno.
 *
 * `public/icons.svg` son los iconos de ejemplo de la plantilla de Vite (GitHub,
 * Discord…) y no tienen nada que ver con esto.
 */

export type IconName =
  | 'upload'
  | 'sliders'
  | 'truck'
  | 'printer'
  | 'mug'
  | 'badge'
  | 'pin'
  | 'phone'
  | 'whatsapp'
  | 'mail'
  | 'clock'
  | 'package'
  | 'lock'
  | 'megaphone';

/** Trazo de cada icono, sobre una caja de 24×24. */
const PATHS: Record<IconName, React.ReactNode> = {
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h4" />
      <path d="M12 17h8" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  truck: (
    <>
      <path d="M2 7h11v9H2z" />
      <path d="M13 10h4l3 3v3h-7z" />
      <circle cx="6" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V4h10v4" />
      <path d="M5 8h14a1 1 0 011 1v6h-4v-3H8v3H4V9a1 1 0 011-1z" />
      <path d="M8 15h8v5H8z" />
    </>
  ),
  mug: (
    <>
      <path d="M4 6h10v8a4 4 0 01-4 4H8a4 4 0 01-4-4z" />
      <path d="M14 9h2a3 3 0 010 6h-2" />
    </>
  ),
  badge: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6-5.2 6-10a6 6 0 10-12 0c0 4.8 6 10 6 10z" />
      <circle cx="12" cy="11" r="2.4" />
    </>
  ),
  phone: <path d="M6 3h3l2 5-2.2 1.4a11 11 0 005.8 5.8L16 13l5 2v3a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z" />,
  // Burbuja con auricular: la marca real de WhatsApp no es nuestra para redibujarla,
  // y junto a la palabra "WhatsApp" esto se entiende igual.
  whatsapp: (
    <>
      <path d="M20 11.5a7.5 7.5 0 01-11 6.7L4.5 19.5l1.3-4.2A7.5 7.5 0 1120 11.5z" />
      <path d="M9.3 9c.4 2.3 2.2 4.1 4.5 4.5l.8-1.3 2 .8v1.2c-3.4.4-6.7-2.9-7.1-6.3h1.2z" />
    </>
  ),
  mail: (
    <>
      <path d="M3 6h18v12H3z" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.5 2" />
    </>
  ),
  package: (
    <>
      <path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2z" />
      <path d="M4 7.2l8 4.3 8-4.3" />
      <path d="M12 11.5V21" />
    </>
  ),
  lock: (
    <>
      <path d="M5 11h14v9H5z" />
      <path d="M8.5 11V8a3.5 3.5 0 017 0v3" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10v4l12 5V5z" />
      <path d="M16 8h2a3 3 0 010 8h-2" />
      <path d="M7 15v4h3" />
    </>
  ),
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorativos: el significado ya está en el texto que acompaña a cada icono,
      // así que un lector de pantalla no debe leerlos dos veces.
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
