import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathFromLegacyHash } from '../src/lib/router';
import { sitemapPaths, sitemapXml } from '../api/catalog';

/**
 * Hay correos ENVIADOS a clientes con enlaces del tipo `…/#acceder/<token>` y
 * `…/#recoger/<pedido>?e=<email>`. Están en bandejas de entrada ajenas y no se
 * pueden cambiar: si esta traducción se rompe, un cliente que pincha en «acceder a
 * mi cuenta» aterriza en una página en blanco y nadie se entera.
 *
 * Por eso esto no se borra nunca, aunque un día ya no queden enlaces viejos.
 */
describe('enlaces antiguos con #', () => {
  it('traduce el acceso a la cuenta', () => {
    expect(pathFromLegacyHash('#acceder/AbC123')).toBe('/acceder/AbC123');
  });

  it('traduce el seguimiento del pedido conservando el email', () => {
    expect(pathFromLegacyHash('#recoger/PS-123?e=cliente%40correo.es')).toBe('/recoger/PS-123?e=cliente%40correo.es');
  });

  it('la portada vieja va a la raíz', () => {
    expect(pathFromLegacyHash('#inicio')).toBe('/');
  });

  it('sin hash no hay nada que traducir', () => {
    expect(pathFromLegacyHash('')).toBeNull();
    expect(pathFromLegacyHash('#')).toBeNull();
  });

  it('no se traga un hash que no sea una ruta nuestra', () => {
    // El `#` también lo usan las anclas y algunas pasarelas: traducir cualquier
    // cosa a una ruta mandaría al cliente a una página que no existe.
    expect(pathFromLegacyHash('#/../otro')).toBeNull();
    expect(pathFromLegacyHash('#<script>')).toBeNull();
  });
});

/**
 * El sitemap es lo que se le entrega a Google. Un error aquí no rompe la web pero
 * sí lo que se indexa, y no se nota hasta semanas después.
 */
describe('sitemap', () => {
  it('lista las páginas públicas y ninguna privada', () => {
    const p = sitemapPaths(null);
    expect(p).toContain('/');
    expect(p).toContain('/imprimir');
    // Ni carrito, ni cuenta, ni backoffice, ni la tablet.
    for (const privada of ['/carrito', '/cuenta', '/admin', '/pedidos', '/papeleria.html']) {
      expect(p).not.toContain(privada);
    }
  });

  it('no anuncia secciones que la tienda ha apagado', () => {
    const p = sitemapPaths({ landing: { showMugs: false, showBadges: false } });
    expect(p).not.toContain('/tazas');
    expect(p).not.toContain('/chapas');
    expect(p).toContain('/imprimir');
  });

  it('las direcciones son absolutas', () => {
    // Un sitemap con rutas relativas lo rechaza Google entero.
    const xml = sitemapXml('https://fotocopiator.es', ['/', '/imprimir'], '2026-07-31');
    expect(xml).toContain('<loc>https://fotocopiator.es/</loc>');
    expect(xml).toContain('<loc>https://fotocopiator.es/imprimir</loc>');
    expect(xml).not.toMatch(/<loc>\/[^<]*<\/loc>/);
  });

  it('es un XML con la cabecera y el espacio de nombres', () => {
    const xml = sitemapXml('https://x.es', ['/'], '2026-07-31');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});

/**
 * Ningún enlace de navegación debe volver al `#`.
 *
 * Al pasar a rutas reales se me escapó AdminNav, que guardaba las direcciones en
 * un campo `hash` y las pintaba con `href={a.hash}`: la conversión buscaba
 * `href="#` y no lo vio, así que los cuatro botones de arriba del backoffice
 * dejaron de funcionar y lo encontró el usuario, no los tests.
 *
 * Esto lee los fuentes y falla si reaparece un enlace con `#`. Los colores
 * (`#cccccc`) no cuentan: se distinguen porque llevan seis dígitos.
 */
describe('no quedan enlaces con #', () => {
  const SRC = join(import.meta.dirname, '..', 'src');

  function tsxFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return tsxFiles(p);
      return e.isFile() && e.name.endsWith('.tsx') ? [p] : [];
    });
  }

  it('ni escritos a mano ni guardados en una constante', () => {
    const malos: string[] = [];
    for (const f of tsxFiles(SRC)) {
      const src = readFileSync(f, 'utf8');
      src.split('\n').forEach((line, i) => {
        // href="#algo" — la forma clásica.
        if (/href="#[a-zA-Z]/.test(line)) malos.push(`${f}:${i + 1}`);
        // hash: '#algo' — la que se me escapó.
        if (/hash:\s*'#[a-zA-Z]/.test(line)) malos.push(`${f}:${i + 1}`);
      });
    }
    expect(malos, `Enlaces con # (deberían ser rutas):\n${malos.join('\n')}`).toEqual([]);
  });
});
