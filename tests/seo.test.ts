import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT_OSCURA, DEFAULT_LANDING, EMPTY_CATALOG, SEO_DESC_MAX, SEO_TITLE_MAX, seoOf } from '../src/domain/catalog';
import { seoTags } from '../src/lib/seo';

/**
 * El título y la descripción son lo que aparece en Google y en la tarjeta de
 * WhatsApp. Una tienda que no toque nada tiene que salir decente igualmente, así
 * que se componen solos; y una que los escriba manda sobre lo derivado.
 */
describe('título y descripción para buscadores', () => {
  it('sin configurar, se componen con el nombre y la frase principal', () => {
    const r = seoOf({
      business: { name: 'Fotocopiator', nif: '', address: '', email: '' },
      landing: DEFAULT_LANDING,
      seo: undefined,
    });
    expect(r.title).toBe('Fotocopiator · Tu copistería online');
    expect(r.description).toBe(DEFAULT_LANDING.clara.subclaim);
  });

  it('lo que escribe la tienda manda', () => {
    const r = seoOf({
      business: { name: 'Fotocopiator', nif: '', address: '', email: '' },
      landing: DEFAULT_LANDING,
      seo: { title: 'Fotocopias baratas en Málaga', description: 'Imprime tus apuntes desde 0,02 €.' },
    });
    expect(r.title).toBe('Fotocopias baratas en Málaga');
    expect(r.description).toBe('Imprime tus apuntes desde 0,02 €.');
  });

  it('sigue a la plantilla puesta', () => {
    // Con la oscura, la frase principal es otra: la descripción derivada también.
    const r = seoOf({
      business: { name: 'Fotocopiator', nif: '', address: '', email: '' },
      landing: { ...DEFAULT_LANDING, template: 'oscura' },
      seo: undefined,
    });
    expect(r.title).toContain(DEFAULT_CONTENT_OSCURA.claim);
    expect(r.description).toBe(DEFAULT_CONTENT_OSCURA.subclaim);
  });

  it('una tienda sin nombre no deja el título vacío', () => {
    // Un <title> vacío es de las pocas cosas que Google penaliza sin matices.
    const r = seoOf(undefined);
    expect(r.title.trim().length).toBeGreaterThan(0);
    expect(r.description.trim().length).toBeGreaterThan(0);
  });

  it('los textos por defecto caben en un resultado de búsqueda', () => {
    // Si los valores de fábrica ya salieran cortados, ninguna tienda que no los
    // toque se veria bien — y la mayoría no los va a tocar.
    const r = seoOf({
      business: { name: 'Copistería', nif: '', address: '', email: '' },
      landing: DEFAULT_LANDING,
      seo: undefined,
    });
    expect(r.title.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    expect(r.description.length).toBeLessThanOrEqual(SEO_DESC_MAX);
  });
});

/**
 * La ficha del negocio en JSON-LD es lo que Google usa para la tarjeta del mapa y
 * para el botón de llamar. Declarar ahí un campo vacío o inventado es peor que no
 * declararlo: sale publicado tal cual.
 */
describe('ficha del negocio para Google', () => {
  const base = { ...EMPTY_CATALOG, landing: DEFAULT_LANDING };
  const tags = (c: Partial<typeof base>) => seoTags({ ...base, ...c }, 'https://fotocopiator.es', '/');

  it('sin nombre de tienda no se declara ficha', () => {
    // Media ficha, con la dirección pero sin nombre, no sirve para nada.
    expect(tags({ business: { name: '', nif: '', address: 'Calle 1', email: '' } }).jsonLd).toBeNull();
  });

  it('solo incluye lo que está relleno', () => {
    const ld = tags({ business: { name: 'Fotocopiator', nif: '', address: '', email: '' } }).jsonLd!;
    expect(ld.name).toBe('Fotocopiator');
    expect(ld['@type']).toBe('PrintShop');
    expect(ld).not.toHaveProperty('address');
    expect(ld).not.toHaveProperty('telephone');
    expect(ld).not.toHaveProperty('email');
  });

  it('con los datos puestos, los declara', () => {
    const ld = tags({
      business: { name: 'Fotocopiator', nif: 'B123', address: 'Calle Ejemplo 1, Málaga', email: 'info@fotocopiator.es' },
      legal: { ...base.legal!, phone: '+34 679 38 68 51' },
    }).jsonLd!;
    expect((ld.address as Record<string, string>).streetAddress).toBe('Calle Ejemplo 1, Málaga');
    expect(ld.telephone).toBe('+34 679 38 68 51');
    expect(ld.email).toBe('info@fotocopiator.es');
  });

  it('la dirección canónica no arrastra el #', () => {
    // `#carrito` no es otra página para un buscador: si fuera canónica, Google
    // vería la misma web repetida decenas de veces.
    expect(tags({}).canonical).toBe('https://fotocopiator.es/');
  });

  it('la imagen para compartir se hace absoluta', () => {
    const t = seoTags(
      { ...base, landing: { ...DEFAULT_LANDING, clara: { ...DEFAULT_LANDING.clara, heroImage: '/api/presign?img=publico/portada/x.jpg' } } },
      'https://fotocopiator.es',
      '/'
    );
    // WhatsApp y Google no siguen rutas relativas.
    expect(t.image).toBe('https://fotocopiator.es/api/presign?img=publico/portada/x.jpg');
  });
});
