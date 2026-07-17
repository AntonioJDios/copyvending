import type { Configuracion } from './types';

export interface Preset {
  id: string;
  label: string;
  config: Partial<Configuracion>;
  /** Whether it is shown to the customer (admin toggle). Default true. */
  enabled?: boolean;
}

/** Default quick-start profiles (the shop can edit these in the admin). */
export const DEFAULT_PRESETS: Preset[] = [
  { id: 'tfm', label: 'TFM / Tesis', config: { size: 'A4', color: 'Color', grosor: 120, dobleCara: '0', acabadoFolios: 'normal' } },
  { id: 'apuntes', label: 'Apuntes', config: { size: 'A4', color: 'BN', grosor: 90, dobleCara: '1', acabadoFolios: 'normal' } },
  { id: 'diploma', label: 'Diploma', config: { size: 'A4', color: 'Color', grosor: 250, dobleCara: '0', acabado: 'sinencuadernacion', acabadoFolios: 'normal' } },
  { id: 'ficha', label: 'Ficha plastificada', config: { size: 'A4', color: 'Color', grosor: 90, dobleCara: '0', acabadoFolios: 'plastificar' } },
  { id: 'fullcolor', label: 'Full color', config: { size: 'A4', color: 'Color', grosor: 120, dobleCara: '0', acabadoFolios: 'normal' } },
  { id: 'didactica', label: 'Didáctica', config: { size: 'A4', color: 'Color', grosor: 100, dobleCara: '0', acabadoFolios: 'normal' } },
];
