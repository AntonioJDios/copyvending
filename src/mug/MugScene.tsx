import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';

const CERAMIC = { color: '#f5f5f6', roughness: 0.28, metalness: 0.03 };

function MugBody({ children }: { children?: React.ReactNode }) {
  // Realistic mug proportions: taller than wide (~10 cm high × ~7.6 cm ø).
  const R = 0.78;
  const H = 2.1;
  const innerR = R * 0.9;
  return (
    <group>
      {/* Outer wall (open top): side (material-0) carries the artwork. */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[R, R * 0.96, H, 96, 1, true]} />
        {children}
      </mesh>

      {/* Base disc closing the bottom. */}
      <mesh position={[0, -H / 2 + 0.02, 0]} receiveShadow>
        <cylinderGeometry args={[R * 0.96, R * 0.96, 0.04, 64]} />
        <meshStandardMaterial {...CERAMIC} />
      </mesh>

      {/* Inner wall, visible from the opening. */}
      <mesh>
        <cylinderGeometry args={[innerR, innerR, H - 0.1, 64, 1, true]} />
        <meshStandardMaterial color="#e7e7ea" roughness={0.5} side={THREE.BackSide} />
      </mesh>

      {/* Cavity floor. */}
      <mesh position={[0, -H / 2 + 0.18, 0]}>
        <cylinderGeometry args={[innerR, innerR, 0.04, 64]} />
        <meshStandardMaterial color="#dededf" roughness={0.6} />
      </mesh>

      {/* Rounded rim (lip) between outer and inner walls. */}
      <mesh position={[0, H / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[(R + innerR) / 2, (R - innerR) / 2 + 0.012, 16, 96]} />
        <meshStandardMaterial {...CERAMIC} />
      </mesh>

      {/* Handle on the right; arc centered on +X so its open ends face the mug. */}
      <mesh position={[R + 0.12, 0, 0]} rotation={[0, 0, (-Math.PI * 1.15) / 2]} castShadow>
        <torusGeometry args={[0.5, 0.11, 24, 60, Math.PI * 1.15]} />
        <meshStandardMaterial {...CERAMIC} />
      </mesh>
    </group>
  );
}

function TexturedMug({ url }: { url: string }) {
  const texture = useTexture(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  // Photo centered opposite the handle; the texture seam (ceramic gap) lands on
  // the handle (+X), so the print leaves ceramic around the handle.
  texture.offset.x = 0.75;
  texture.needsUpdate = true;
  return (
    <MugBody>
      <meshStandardMaterial attach="material-0" map={texture} roughness={0.22} metalness={0.03} />
    </MugBody>
  );
}

function PlainMug() {
  return (
    <MugBody>
      <meshStandardMaterial attach="material-0" {...CERAMIC} />
    </MugBody>
  );
}

interface Props {
  textureUrl: string | null;
  autoRotate: boolean;
}

export function MugScene({ textureUrl, autoRotate }: Props) {
  return (
    <Canvas
      className="scene3d"
      style={{ width: '100%', height: 'min(60vh, 520px)' }}
      shadows
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, alpha: true }}
      camera={{ position: [0, 0.2, 5.4], fov: 30 }}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 6, 5]} intensity={1.15} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-5, 2, -4]} intensity={0.4} />
      <directionalLight position={[0, 3, -6]} intensity={0.5} />

      <Suspense fallback={null}>
        <group position={[0, 0, 0]} rotation={[0, -0.5, 0]}>
          {textureUrl ? <TexturedMug url={textureUrl} /> : <PlainMug />}
        </group>
        <ContactShadows position={[0, -1.1, 0]} opacity={0.35} scale={6} blur={2.6} far={2.5} />
      </Suspense>

      <OrbitControls
        enablePan={false}
        autoRotate={autoRotate}
        autoRotateSpeed={1.6}
        minDistance={2.8}
        maxDistance={7}
        minPolarAngle={Math.PI / 3.2}
        maxPolarAngle={Math.PI / 1.7}
        enableDamping
      />
    </Canvas>
  );
}
