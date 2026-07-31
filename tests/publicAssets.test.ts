import { describe, expect, it } from 'vitest';
import { isPublicKey } from '../api/presign';

/**
 * `GET /api/presign?img=<clave>` sirve archivos SIN pedir credenciales, porque la
 * foto de la portada tiene que verla cualquier visitante. Esta comprobación es lo
 * único que impide que esa misma ruta entregue los apuntes, los TFG y las
 * oposiciones que suben los clientes, que viven bajo `jobs/`.
 *
 * Es decir: si estos tests fallan, la fuga no es de datos de la tienda, es de los
 * documentos privados de sus clientes.
 */
describe('claves servidas sin autenticación', () => {
  const valida = 'publico/portada/0f9c1e2a-3b4d-4c5e-8f70-1a2b3c4d5e6f.jpg';

  it('acepta las que genera el servidor', () => {
    expect(isPublicKey(valida)).toBe(true);
    expect(isPublicKey('publico/portada/0f9c1e2a-3b4d-4c5e-8f70-1a2b3c4d5e6f.webp')).toBe(true);
  });

  it('NO sirve los archivos de los clientes', () => {
    expect(isPublicKey('jobs/2026-07/0f9c1e2a-3b4d-4c5e-8f70-1a2b3c4d5e6f/apuntes.pdf')).toBe(false);
    expect(isPublicKey('jobs/')).toBe(false);
  });

  it('no se puede salir de la carpeta', () => {
    expect(isPublicKey('publico/../jobs/2026-07/x/apuntes.pdf')).toBe(false);
    expect(isPublicKey('publico/portada/../../jobs/x.pdf')).toBe(false);
    expect(isPublicKey('publico//jobs/x.pdf')).toBe(false);
    // Escapado, por si algo lo decodifica más adelante en la cadena.
    expect(isPublicKey('publico/%2e%2e/jobs/x.pdf')).toBe(false);
  });

  it('no vale con empezar por el prefijo', () => {
    // El fallo clásico: comprobar solo el principio de la cadena.
    expect(isPublicKey('publico/portada/no-es-un-uuid.jpg')).toBe(false);
    expect(isPublicKey('publicoX/portada/0f9c1e2a-3b4d-4c5e-8f70-1a2b3c4d5e6f.jpg')).toBe(false);
    expect(isPublicKey(`${valida}/../../jobs/x.pdf`)).toBe(false);
  });

  it('rechaza lo vacío y lo raro', () => {
    expect(isPublicKey('')).toBe(false);
    expect(isPublicKey('publico/')).toBe(false);
    expect(isPublicKey('publico/portada/')).toBe(false);
  });
});
