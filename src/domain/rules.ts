import type { Catalog } from './catalog';
import { DEFAULT_CATALOG } from './catalog';
import { sheets } from './pricing';
import type { Configuracion, DobleCara, DocFile, Grosor, Size } from './types';

/**
 * Paper/finishing constraints, driven by the Catalog (from the legacy
 * configurador.tpl disable rules). Pure functions so the UI can grey out
 * invalid options and warn on limits.
 */

export function allowedGrosores(catalog: Catalog, size: Size): Grosor[] {
  return catalog.grosoresBySize[size] ?? [];
}

export function defaultGrosor(catalog: Catalog, size: Size): Grosor {
  const list = allowedGrosores(catalog, size);
  return list.includes(90) ? 90 : (list[0] ?? 90);
}

/** 250 gr is single-sided only. */
export function doubleSidedAllowed(config: Pick<Configuracion, 'grosor'>): boolean {
  return config.grosor !== 250;
}

export interface Warning {
  code: string;
  message: string;
}

export function validate(config: Configuracion, files: DocFile[], catalog: Catalog = DEFAULT_CATALOG): Warning[] {
  const warnings: Warning[] = [];
  const totalSheets = files.reduce((s, f) => s + sheets(f.pages, config.paginasPorHoja, config.dobleCara), 0);

  const max = catalog.bindingMaxSheets[config.acabado];
  if (max && totalSheets > max) {
    warnings.push({ code: 'binding-max', message: `Este acabado admite como máximo ${max} folios (tienes ${totalSheets}).` });
  }

  if (config.acabadoFolios === 'pegatinas') {
    if (config.size !== 'A4') warnings.push({ code: 'sticker-size', message: 'Las pegatinas solo están disponibles en A4.' });
    if (config.acabado !== 'sinencuadernacion') warnings.push({ code: 'sticker-binding', message: 'Las pegatinas no admiten encuadernación.' });
    if (config.dobleCara !== '0') warnings.push({ code: 'sticker-side', message: 'Las pegatinas se imprimen a una cara.' });
    if (config.grosor !== 80 && config.grosor !== 90) warnings.push({ code: 'sticker-gsm', message: 'Las pegatinas usan papel de 80 o 90 gr.' });
  }

  return warnings;
}

/** Coerce a configuration to a valid state after a change (new object). */
export function normalize(config: Configuracion, catalog: Catalog = DEFAULT_CATALOG): Configuracion {
  let next = { ...config };
  if (!allowedGrosores(catalog, next.size).includes(next.grosor)) {
    next = { ...next, grosor: defaultGrosor(catalog, next.size) };
  }
  if (!doubleSidedAllowed(next) && next.dobleCara !== '0') {
    next = { ...next, dobleCara: '0' as DobleCara };
  }
  if (next.acabado === 'perforado' || next.acabado === 'dos_agujeros' || next.acabado === 'cuatro_agujeros') {
    next = { ...next, juntos: 'individual' };
  }
  if (next.acabado === 'sinencuadernacion' && (next.foliosDelante !== 0 || next.foliosDetras !== 0)) {
    next = { ...next, foliosDelante: 0, foliosDetras: 0 };
  }
  return next;
}
