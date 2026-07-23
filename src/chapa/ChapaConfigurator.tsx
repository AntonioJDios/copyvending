import { useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { cropToDataUrl } from '../lib/cropImage';
import { BadgeScene } from './BadgeScene';
import { useCart } from '../store/useCart';
import { useConfigurator } from '../store/useConfigurator';
import { flyToCart } from '../lib/flyToCart';
import { CartButton } from '../components/CartButton';
import { AccountButton } from '../components/AccountButton';
import { uploadService } from '../lib/uploads';
import { dataUrlToFile, downscaleDataUrl } from '../lib/imageDownscale';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

// Fixed size from chapita.php: image cropped to r=35 mm, visible area r=29.5 mm.
const SIZE_MM = 58;
const SAFE_RATIO = 29.5 / 35; // visible circle vs full print (bleed) circle

/** Badge back type. */
const BACKS = [
  { id: 'imperdible', label: 'Imperdible' },
  { id: 'iman', label: 'Imán' },
  { id: 'abrelatas', label: 'Abrelatas' },
  { id: 'espejo', label: 'Espejo' },
] as const;
type Back = (typeof BACKS)[number]['id'];

export function ChapaConfigurator() {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [back, setBack] = useState<Back>('imperdible');
  const [nombre, setNombre] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [adding, setAdding] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const backLabel = BACKS.find((b) => b.id === back)?.label ?? '';

  const price = useConfigurator((s) => s.catalog.badgePrice);
  const addToCart = useCart((s) => s.add);

  const onAddToCart = async () => {
    if (!imageUrl || adding) return;
    flyToCart({ el: previewRef.current, imageUrl, round: true });
    setAdding(true);
    try {
      const id = crypto.randomUUID();
      // Full-res round crop → storage (print artwork); order keeps just the key.
      const file = await dataUrlToFile(imageUrl, 'chapa.png');
      const { key } = await uploadService.upload(file, { projectId: id });
      const preview = await downscaleDataUrl(imageUrl, 480);
      addToCart({
        id,
        kind: 'chapa',
        nombre,
        preview,
        printImageKey: key,
        back: backLabel,
        sizeMm: SIZE_MM,
        cantidad,
        total: price * cantidad,
      });
      setOriginalUrl(null);
      setImageUrl(null);
      setNombre('');
      setCantidad(1);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo añadir la chapa. Inténtalo de nuevo.');
    } finally {
      setAdding(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(URL.createObjectURL(file));
    setImageUrl(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const onCropComplete = async (_: Area, areaPixels: Area) => {
    if (!originalUrl) return;
    setImageUrl(await cropToDataUrl(originalUrl, areaPixels));
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Chapa personalizada</h1>
        <nav className="topnav">
          <a className="btn" href="#">
            ← Volver
          </a>
          <AccountButton />
          <CartButton onClick={() => (window.location.hash = 'carrito')} />
        </nav>
      </header>

      <div className="mug-layout">
        <section className="mug-editor">
          {originalUrl ? (
            <>
              <div className="mug-crop chapa-crop">
                <Cropper
                  image={originalUrl}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
                {/* Visible-area guide: inside this circle is what's seen; the ring
                    outside wraps over the edge (bleed). */}
                <div className="chapa-safe" style={{ width: `${SAFE_RATIO * 100}%`, height: `${SAFE_RATIO * 100}%` }} />
              </div>
              <label className="slider">
                Zoom
                <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              </label>
              <p className="hint">
                Dentro del círculo punteado es lo que se ve; el borde exterior se curva sobre el canto de la chapa.
              </p>
              <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                Cambiar foto
              </button>
            </>
          ) : (
            <button type="button" className="dropzone" onClick={() => fileInput.current?.click()}>
              Sube una foto para tu chapa
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />

          <div className="opt-group">
            <span className="opt-label">Tamaño</span>
            <span className="opt-value">Ø {SIZE_MM} mm</span>
          </div>

          <div className="opt-group">
            <span className="opt-label">Trasera</span>
            <div className="seg">
              {BACKS.map((b) => (
                <button key={b.id} type="button" className={`seg-btn${b.id === back ? ' seg-on' : ''}`} onClick={() => setBack(b.id)}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="mug-preview" ref={previewRef}>
          <BadgeScene textureUrl={imageUrl} />
          <div className="mug-controls">
            <span className="hint">Chapa Ø {SIZE_MM} mm · {backLabel} · arrastra para girar</span>
          </div>
          <div className="product-order">
            <input
              type="text"
              className="product-name-input"
              placeholder="Nombre (opcional)"
              value={nombre}
              maxLength={60}
              onChange={(e) => setNombre(e.target.value)}
            />
            <label className="product-qty">
              Uds.
              <input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
            </label>
            <span className="product-price">{eur(price * cantidad)}</span>
            <button type="button" className="btn btn-primary" disabled={!imageUrl || adding} onClick={onAddToCart}>
              {adding ? 'Añadiendo…' : 'Añadir al carrito'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
