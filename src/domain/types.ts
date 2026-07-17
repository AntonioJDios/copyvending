export type Size = 'A4' | 'A3' | 'A5';
export type ColorMode = 'BN' | 'Color';
export type Grosor = 80 | 90 | 100 | 120 | 160 | 250;
/** '0' = una cara, '1' = doble cara (as in the legacy keys). */
export type DobleCara = '0' | '1';
export type Orientacion = 'vertical' | 'horizontal';
export type PaginasPorHoja = 1 | 2 | 4;

export type Acabado =
  | 'sinencuadernacion'
  | 'grapado'
  | 'AnillasColores'
  | 'dos_agujeros'
  | 'cuatro_agujeros'
  | 'perforado';

export type AcabadoFolios = 'normal' | 'plastificar' | 'pegatinas';

/** How multi-document jobs are bound: agrupados = one binding, individual = one per file. */
export type Juntos = 'agrupados' | 'individual';

/** Which edge the binding runs along. */
export type LadoEncuadernacion = 'largo' | 'corto';

export interface Configuracion {
  size: Size;
  color: ColorMode;
  grosor: Grosor;
  dobleCara: DobleCara;
  orientacion: Orientacion;
  paginasPorHoja: PaginasPorHoja;
  acabado: Acabado;
  acabadoFolios: AcabadoFolios;
  juntos: Juntos;
  sinMargenes: boolean;
  /** Edge the binding runs along (rings/holes). */
  ladoEncuadernacion: LadoEncuadernacion;
  /** Blank sheets added in front of the binding (only with a binding). */
  foliosDelante: number;
  /** Blank sheets added behind the binding (only with a binding). */
  foliosDetras: number;
}

/** An uploaded document with its page count. */
export interface DocFile {
  id: string;
  name: string;
  pages: number;
  /** Thumbnail data URL (page 1). */
  thumb?: string;
  /** Source file, kept in memory so other pages can be rendered on demand. */
  source?: File;
  /** 'no' = B/N, 'cover' = only cover in color, 'all' = whole doc in color. */
  color: 'no' | 'cover' | 'all';
  /** Upload lifecycle to storage (local adapter now, Vercel Blob later). */
  uploadStatus?: 'uploading' | 'done' | 'error';
  /** 0..1 while uploading. */
  uploadProgress?: number;
  /** Storage key/URL once uploaded. */
  storageKey?: string;
  uploadError?: string;
}
