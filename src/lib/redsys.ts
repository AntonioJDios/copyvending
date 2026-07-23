import { API_BASE } from './api';

/** Ask the server to sign the payment for an order, then auto-submit the form to
 *  Redsys (navigates away). `method` optional: 'card' | 'bizum' (omit = both). */
export async function payWithRedsys(orderId: string, method?: 'card' | 'bizum'): Promise<void> {
  const res = await fetch(`${API_BASE ?? ''}/pago-redsys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, method }),
  });
  const d = (await res.json().catch(() => ({}))) as {
    url?: string; Ds_SignatureVersion?: string; Ds_MerchantParameters?: string; Ds_Signature?: string; error?: string;
  };
  if (!res.ok || !d.url || !d.Ds_MerchantParameters || !d.Ds_Signature) {
    throw new Error(d.error || `Error ${res.status}`);
  }
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
