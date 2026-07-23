import { API_BASE } from './api';

export interface RedsysConfig {
  merchantCode: string;
  terminal: string;
  env: string;
  jsUrl: string;
}

interface SignedForm {
  url?: string;
  Ds_SignatureVersion?: string;
  Ds_MerchantParameters?: string;
  Ds_Signature?: string;
  error?: string;
}

/** Ask the server to sign the payment and auto-submit the form to Redsys. */
async function requestAndSubmit(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE ?? ''}/pago-redsys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = (await res.json().catch(() => ({}))) as SignedForm;
  if (!res.ok || !d.url || !d.Ds_MerchantParameters || !d.Ds_Signature) throw new Error(d.error || `Error ${res.status}`);
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = d.url;
  const add = (name: string, value: string) => {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = name;
    i.value = value;
    form.appendChild(i);
  };
  add('Ds_SignatureVersion', d.Ds_SignatureVersion ?? 'HMAC_SHA256_V1');
  add('Ds_MerchantParameters', d.Ds_MerchantParameters);
  add('Ds_Signature', d.Ds_Signature);
  document.body.appendChild(form);
  form.submit();
}

/** Redirection flow (card + Bizum): the whole payment happens on Redsys. */
export const payWithRedsys = (orderId: string, method?: 'card' | 'bizum') => requestAndSubmit({ orderId, method });

/** InSite: card entered on our page (idOper), then submit to Redsys (handles 3DS). */
export const authorizeInsite = (orderId: string, idOper: string, order: string) => requestAndSubmit({ orderId, idOper, order });

/** Public config for the InSite card form (no secret). */
export async function getRedsysConfig(): Promise<RedsysConfig> {
  const res = await fetch(`${API_BASE ?? ''}/pago-redsys`);
  if (!res.ok) throw new Error('No se pudo cargar la configuración de pago');
  return (await res.json()) as RedsysConfig;
}
