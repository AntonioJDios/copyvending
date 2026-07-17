import { useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { MUG_ASPECT, buildMugTexture } from '../lib/cropImage';
import { MugScene } from './MugScene';
import { useCart } from '../store/useCart';
import { useConfigurator } from '../store/useConfigurator';
import { flyToCart } from '../lib/flyToCart';
import { CartButton } from '../components/CartButton';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export function MugConfigurator() {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [textureUrl, setTextureUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  const [nombre, setNombre] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const price = useConfigurator((s) => s.catalog.mugPrice);
  const addToCart = useCart((s) => s.add);

  const onAddToCart = () => {
    if (!textureUrl) return;
    // Snapshot the rendered 3D mug so the cart shows the actual mug, not the
    // flat print strip. Falls back to the texture if the capture fails.
    const canvas = previewRef.current?.querySelector('canvas');
    let snapshot = textureUrl;
    try {
      const shot = canvas?.toDataURL('image/png');
      if (shot && shot.length > 128) snapshot = shot;
    } catch {
      /* tainted/unsupported → keep the texture */
    }
    flyToCart({ el: previewRef.current, imageUrl: snapshot });
    addToCart({
      id: crypto.randomUUID(),
      kind: 'taza',
      nombre,
      preview: snapshot,
      printImage: textureUrl, // flat edited artwork for sublimation
      cantidad,
      total: price * cantidad,
    });
    setOriginalUrl(null);
    setTextureUrl(null);
    setNombre('');
    setCantidad(1);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(URL.createObjectURL(file));
    setTextureUrl(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const onCropComplete = async (_: Area, areaPixels: Area) => {
    if (!originalUrl) return;
    setTextureUrl(await buildMugTexture(originalUrl, areaPixels));
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Taza personalizada</h1>
        <nav className="topnav">
          <a className="btn" href="#">
            ← Volver
          </a>
          <CartButton onClick={() => (window.location.hash = 'carrito')} />
        </nav>
      </header>

      <div className="mug-layout">
        <section className="mug-editor">
          {originalUrl ? (
            <>
              <div className="mug-crop">
                <Cropper
                  image={originalUrl}
                  crop={crop}
                  zoom={zoom}
                  aspect={MUG_ASPECT}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              </div>
              <label className="slider">
                Zoom
                <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              </label>
              <p className="hint">Encuadra la foto en la franja imprimible de la taza (24 × 9,5 cm).</p>
              <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                Cambiar foto
              </button>
            </>
          ) : (
            <button type="button" className="dropzone" onClick={() => fileInput.current?.click()}>
              Sube una foto para tu taza
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </section>

        <section className="mug-preview" ref={previewRef}>
          <MugScene textureUrl={textureUrl} autoRotate={autoRotate} />
          <div className="mug-controls">
            <label className="chk">
              <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
              Girar automáticamente
            </label>
            <span className="hint">Arrastra para girar · rueda para acercar</span>
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
            <button type="button" className="btn btn-primary" disabled={!textureUrl} onClick={onAddToCart}>
              Añadir al carrito
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
