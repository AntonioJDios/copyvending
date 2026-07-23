import { useEffect } from 'react';
import type { RedsysConfig } from '../lib/redsys';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Redsys InSite card form: loads redsysV3.js, renders the card fields (in
 * Redsys iframes → the card never touches our page/servers) and reports the
 * tokenised card (idOper) via `onToken`. The `order` must match the one used to
 * authorise the payment afterwards.
 */
export function InSiteForm({ config, order, onToken, onError }: {
  config: RedsysConfig;
  order: string;
  onToken: (idOper: string) => void;
  onError: (code: string) => void;
}) {
  useEffect(() => {
    let active = true;
    const w = window as any;

    // storeIdOper (from redsysV3.js) writes the token/error into these inputs and
    // then calls our validation callback.
    w.__redsysValidate = () => {
      const idOper = (document.getElementById('token') as HTMLInputElement | null)?.value ?? '';
      const err = (document.getElementById('errorCode') as HTMLInputElement | null)?.value ?? '';
      if (err && err !== '0') {
        onError(err);
        return false;
      }
      if (!idOper || idOper === '-1') {
        onError(idOper === '-1' ? 'Número de pedido duplicado' : 'No se pudo validar la tarjeta');
        return false;
      }
      onToken(idOper);
      return true;
    };
    const onMessage = (event: MessageEvent) => {
      if (typeof w.storeIdOper === 'function') w.storeIdOper(event, 'token', 'errorCode', w.__redsysValidate);
    };
    window.addEventListener('message', onMessage);

    const render = () => {
      if (!active || typeof w.getInSiteFormJSON !== 'function') return;
      try {
        w.getInSiteFormJSON({ id: 'card-form', fuc: config.merchantCode, terminal: config.terminal, order, estiloInsite: 'twoRows' });
      } catch (e) {
        onError(e instanceof Error ? e.message : 'No se pudo cargar el formulario de pago');
      }
    };

    const ID = 'redsys-insite-js';
    const existing = document.getElementById(ID) as HTMLScriptElement | null;
    if (typeof w.getInSiteFormJSON === 'function') {
      render();
    } else if (existing) {
      existing.addEventListener('load', render);
    } else {
      const s = document.createElement('script');
      s.id = ID;
      s.src = config.jsUrl;
      s.onload = render;
      s.onerror = () => onError('No se pudo cargar la pasarela de pago');
      document.body.appendChild(s);
    }

    return () => {
      active = false;
      window.removeEventListener('message', onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, order]);

  return (
    <div className="insite">
      <div id="card-form" />
      <input type="hidden" id="token" />
      <input type="hidden" id="errorCode" />
    </div>
  );
}
