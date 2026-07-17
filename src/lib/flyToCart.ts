/**
 * Fly something from the configurator up to the cart button, then pop the cart.
 * Default: clones the document thumbnails in the file grid. For the mug/badge
 * configurators, pass an image URL + a source element to fly a round/rect
 * preview instead. Pure DOM + Web Animations API, no deps.
 */
export function flyToCart(source?: { el?: HTMLElement | null; imageUrl?: string; round?: boolean }): void {
  const cart = document.getElementById('cart-button');
  if (!cart) return;
  const target = cart.getBoundingClientRect();
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;

  // Build the flying elements (already positioned fixed at their start rect).
  const fliers: HTMLElement[] = [];

  if (source?.imageUrl && source.el) {
    const r = source.el.getBoundingClientRect();
    const size = Math.min(140, r.width, r.height) || 120;
    const img = document.createElement('img');
    img.src = source.imageUrl;
    Object.assign(img.style, {
      position: 'fixed',
      left: `${r.left + (r.width - size) / 2}px`,
      top: `${r.top + (r.height - size) / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      objectFit: 'cover',
      margin: '0',
      borderRadius: source.round ? '50%' : '8px',
      boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
      zIndex: '200',
      pointerEvents: 'none',
    });
    document.body.appendChild(img);
    fliers.push(img);
  } else {
    const sources = Array.from(document.querySelectorAll<HTMLElement>('.filegrid .doc-clip')).slice(0, 4);
    for (const src of sources) {
      const rect = src.getBoundingClientRect();
      const clone = src.cloneNode(true) as HTMLElement;
      Object.assign(clone.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: '0',
        borderRadius: '4px',
        boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
        zIndex: '200',
        pointerEvents: 'none',
        transition: 'none',
      });
      document.body.appendChild(clone);
      fliers.push(clone);
    }
  }

  if (fliers.length === 0) {
    popCart(cart);
    return;
  }

  fliers.forEach((flier, i) => {
    const rect = flier.getBoundingClientRect();
    const dx = tx - (rect.left + rect.width / 2);
    const dy = ty - (rect.top + rect.height / 2);

    const anim = flier.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.6)`, opacity: 0.95, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0.3 },
      ],
      { duration: 700 + i * 60, delay: i * 70, easing: 'cubic-bezier(0.55, 0, 0.85, 0.35)', fill: 'forwards' }
    );
    anim.onfinish = () => {
      flier.remove();
      if (i === fliers.length - 1) popCart(cart);
    };
  });
}

function popCart(cart: HTMLElement): void {
  cart.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
    { duration: 320, easing: 'ease-out' }
  );
}
