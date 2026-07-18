import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';

const METAL = { color: '#cfd3d8', metalness: 0.85, roughness: 0.35 };

function BadgeBody({ children }: { children?: React.ReactNode }) {
  return (
    // Printed face toward the camera (top cap → +Z); kept axis-aligned so
    // orbiting feels natural (spin like a coin).
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 0.16, 120]} />
        {/* material-0 = crimped metal rim, 1 = printed face, 2 = metal back */}
        <meshStandardMaterial attach="material-0" {...METAL} />
        {children}
        <meshStandardMaterial attach="material-2" color="#c4c8cc" metalness={0.8} roughness={0.5} />
      </mesh>
      {/* Glossy convex lens over the print (button-badge dome). */}
      <mesh position={[0, 0.085, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[2.35, 48, 48, 0, Math.PI * 2, 0, 0.44]} />
        <meshPhysicalMaterial transparent opacity={0.14} roughness={0.03} clearcoat={1} transmission={0} color="#ffffff" />
      </mesh>
    </group>
  );
}

function TexturedBadge({ url }: { url: string }) {
  const texture = useTexture(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // The cylinder cap maps the image turned 90°; rotate it back around its center.
  texture.center.set(0.5, 0.5);
  texture.rotation = Math.PI / 2;
  texture.needsUpdate = true;
  return (
    <BadgeBody>
      <meshPhysicalMaterial attach="material-1" map={texture} roughness={0.5} clearcoat={1} clearcoatRoughness={0.06} />
    </BadgeBody>
  );
}

function PlainBadge() {
  return (
    <BadgeBody>
      <meshStandardMaterial attach="material-1" color="#e9eaec" roughness={0.5} />
    </BadgeBody>
  );
}

export function BadgeScene({ textureUrl }: { textureUrl: string | null }) {
  return (
    <Canvas
      className="scene3d"
      style={{ width: '100%', height: 'min(60vh, 520px)' }}
      shadows
      dpr={[1, 2]}
      gl={{ alpha: true }}
      camera={{ position: [0, 0.7, 6.2], fov: 30 }}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 6, 5]} intensity={1.2} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 3, 2]} intensity={0.5} />
      <directionalLight position={[0, 2, -5]} intensity={0.6} />
      <Suspense fallback={null}>
        {textureUrl ? <TexturedBadge url={textureUrl} /> : <PlainBadge />}
        <ContactShadows position={[0, -1.05, 0]} opacity={0.3} scale={5} blur={2.4} far={2} />
      </Suspense>
      <OrbitControls enablePan={false} minDistance={3.5} maxDistance={9} rotateSpeed={0.9} enableDamping dampingFactor={0.12} />
    </Canvas>
  );
}
