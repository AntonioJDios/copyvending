import type { Address } from '../store/useAuth';

/** Simple address form (shipping / billing). NIF shown only for billing. */
export function AddressForm({ value, onChange, showNif }: { value: Address; onChange: (a: Address) => void; showNif?: boolean }) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="addr-form">
      <label className="field-block addr-wide">
        Nombre y apellidos {showNif ? '/ empresa' : '(destinatario)'}
        <input type="text" value={value.nombre ?? ''} maxLength={120} onChange={(e) => set('nombre', e.target.value)} />
      </label>
      {showNif && (
        <label className="field-block">
          NIF / DNI
          <input type="text" value={value.nif ?? ''} maxLength={20} onChange={(e) => set('nif', e.target.value)} />
        </label>
      )}
      <label className="field-block addr-wide">
        Dirección (calle y número)
        <input type="text" value={value.linea1 ?? ''} maxLength={120} onChange={(e) => set('linea1', e.target.value)} />
      </label>
      <label className="field-block">
        Piso / puerta (opcional)
        <input type="text" value={value.linea2 ?? ''} maxLength={60} onChange={(e) => set('linea2', e.target.value)} />
      </label>
      <label className="field-block">
        Código postal
        <input type="text" inputMode="numeric" value={value.cp ?? ''} maxLength={10} onChange={(e) => set('cp', e.target.value)} />
      </label>
      <label className="field-block">
        Ciudad
        <input type="text" value={value.ciudad ?? ''} maxLength={80} onChange={(e) => set('ciudad', e.target.value)} />
      </label>
      <label className="field-block">
        Provincia
        <input type="text" value={value.provincia ?? ''} maxLength={80} onChange={(e) => set('provincia', e.target.value)} />
      </label>
      <label className="field-block">
        Teléfono (opcional)
        <input type="tel" inputMode="tel" value={value.telefono ?? ''} maxLength={20} onChange={(e) => set('telefono', e.target.value)} />
      </label>
    </div>
  );
}
