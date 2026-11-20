import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createCrumpleMaterial } from './crumpleMaterial';
import { NOTE_STYLES, makeCoinTexture, makeNoteTexture, makeRupeeTexture } from './moneyTextures';

type V3 = [number, number, number];

const setCursor = (value: string) => {
  document.body.style.cursor = value;
};

/** Gentle bobbing + sway shared by every floating object. */
function Float({
  position,
  rotation = [0, 0, 0],
  speed = 1,
  seed = 0,
  children
}: {
  position: V3;
  rotation?: V3;
  speed?: number;
  seed?: number;
  children: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((s) => {
    const g = ref.current;
    if (!g) return;
    const t = s.clock.elapsedTime * speed + seed;
    g.position.y = position[1] + Math.sin(t) * 0.13;
    g.rotation.x = rotation[0] + Math.sin(t * 0.6) * 0.05;
    g.rotation.y = rotation[1] + Math.sin(t * 0.5) * 0.1;
    g.rotation.z = rotation[2] + Math.sin(t * 0.7) * 0.04;
  });
  return (
    <group ref={ref} position={position} rotation={rotation}>
      {children}
    </group>
  );
}

/** A banknote that scrunches into a paper ball while hovered, and flattens back on leave. */
function Note({
  position,
  rotation,
  size = 1,
  texture,
  seed,
  speed
}: {
  position: V3;
  rotation: V3;
  size?: number;
  texture: THREE.Texture;
  seed: number;
  speed: number;
}) {
  const crumple = useMemo(() => createCrumpleMaterial(texture, seed), [texture, seed]);
  const state = useRef({ value: 0, target: 0 });

  useEffect(
    () => () => {
      crumple.material.dispose();
      setCursor('');
    },
    [crumple]
  );

  useFrame((_, dt) => {
    const s = state.current;
    // Slightly faster to crumple than to release, like real paper.
    s.value = THREE.MathUtils.damp(s.value, s.target, s.target > s.value ? 7 : 9, dt);
    crumple.uniforms.uCrumple.value = s.value;
  });

  return (
    <Float position={position} rotation={rotation} speed={speed} seed={seed}>
      <group scale={size}>
        <mesh
          onPointerOver={(e) => {
            e.stopPropagation();
            state.current.target = 0.92;
            setCursor('pointer');
          }}
          onPointerOut={() => {
            state.current.target = 0;
            setCursor('');
          }}
        >
          <planeGeometry args={[2.4, 1.05, 72, 32]} />
          <primitive object={crumple.material} attach="material" />
        </mesh>
      </group>
    </Float>
  );
}

/** A coin that flips quickly while hovered. */
function Coin({ position, size = 1, texture, seed }: { position: V3; size?: number; texture: THREE.Texture; seed: number }) {
  const spin = useRef<THREE.Group>(null);
  const state = useRef({ boost: 0, target: 0 });

  useFrame((_, dt) => {
    const s = state.current;
    s.boost = THREE.MathUtils.damp(s.boost, s.target, 5, dt);
    if (spin.current) spin.current.rotation.y += dt * (0.7 + s.boost * 9);
  });

  return (
    <Float position={position} rotation={[0.25, 0, 0.1]} speed={1.2} seed={seed}>
      <group scale={size}>
        <group
          ref={spin}
          onPointerOver={(e) => {
            e.stopPropagation();
            state.current.target = 1;
            setCursor('pointer');
          }}
          onPointerOut={() => {
            state.current.target = 0;
            setCursor('');
          }}
        >
          <mesh rotation={[Math.PI / 2, Math.PI, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 0.1, 48]} />
            <meshStandardMaterial attach="material-0" color="#d9a62e" metalness={0.35} roughness={0.4} />
            <meshStandardMaterial attach="material-1" map={texture} metalness={0.5} roughness={0.4} />
            <meshStandardMaterial attach="material-2" map={texture} metalness={0.5} roughness={0.4} />
          </mesh>
        </group>
      </group>
    </Float>
  );
}

function Scene() {
  const { viewport, pointer } = useThree();
  const root = useRef<THREE.Group>(null);

  const textures = useMemo(
    () => ({
      notes: NOTE_STYLES.map(makeNoteTexture),
      coin: makeCoinTexture(),
      rupee: makeRupeeTexture()
    }),
    []
  );
  useEffect(
    () => () => {
      textures.notes.forEach((t) => t.dispose());
      textures.coin.dispose();
      textures.rupee.dispose();
    },
    [textures]
  );

  const cube = useMemo(() => new THREE.BoxGeometry(1.1, 1.1, 1.1), []);
  const cubeEdges = useMemo(() => new THREE.EdgesGeometry(cube), [cube]);
  useEffect(
    () => () => {
      cube.dispose();
      cubeEdges.dispose();
    },
    [cube, cubeEdges]
  );

  // Layout is authored for a ~13.5 unit wide view and scaled to fit smaller windows.
  const fit = Math.min(1.1, viewport.width / 16.5, viewport.height / 7.6);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, pointer.x * 0.12, 0.05);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -pointer.y * 0.06, 0.05);
  });

  return (
    <group ref={root} scale={fit}>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 5, 6]} intensity={1.7} />
      <pointLight position={[4.5, -3, 3]} intensity={45} color="#ffb938" />
      <pointLight position={[-2, 3, 4]} intensity={18} color="#ffe7a8" />

      {/* Big floating rupee sign */}
      <Float position={[3.5, -0.2, 0]} rotation={[-0.1, -0.25, 0.05]} speed={0.6} seed={2}>
        <mesh>
          <planeGeometry args={[3.3, 3.3]} />
          <meshBasicMaterial map={textures.rupee} transparent toneMapped={false} />
        </mesh>
      </Float>

      {/* Glass cube */}
      <Float position={[1.7, 2.45, 0.2]} rotation={[0.5, 0.6, 0.2]} speed={0.9} seed={5}>
        <mesh geometry={cube}>
          <meshStandardMaterial color="#f0cf7a" emissive="#a8780f" emissiveIntensity={0.3} transparent opacity={0.38} roughness={0.08} metalness={0.2} />
        </mesh>
        <lineSegments geometry={cubeEdges}>
          <lineBasicMaterial color="#c0900f" transparent opacity={0.85} />
        </lineSegments>
      </Float>

      {/* Banknotes: hover to crumple */}
      <Note position={[5.2, 0.35, 0.9]} rotation={[0.1, -0.35, 0.18]} size={1.05} texture={textures.notes[0]} seed={1.3} speed={0.9} />
      <Note position={[2.5, -2.1, 1.1]} rotation={[-0.1, 0.3, -0.16]} size={0.95} texture={textures.notes[1]} seed={4.1} speed={1.1} />
      <Note position={[5.9, -2.35, 0.7]} rotation={[0.05, -0.25, 0.1]} size={0.9} texture={textures.notes[2]} seed={6.7} speed={0.8} />
      <Note position={[5.8, 2.35, 0.5]} rotation={[0.05, -0.3, 0.14]} size={0.8} texture={textures.notes[2]} seed={9.2} speed={1.0} />

      {/* Coins: hover to flip */}
      <Coin position={[3.4, 2.7, 0.9]} size={0.8} texture={textures.coin} seed={3} />
      <Coin position={[6.2, 0.6, 0.6]} size={0.7} texture={textures.coin} seed={7} />
      <Coin position={[1.6, -3.0, 0.8]} size={0.75} texture={textures.coin} seed={11} />

      {/* Glowing floor ring */}
      <mesh position={[3.6, -3.35, 0]} rotation={[Math.PI / 2 - 0.12, 0, 0]}>
        <torusGeometry args={[2.6, 0.04, 12, 120]} />
        <meshBasicMaterial color="#e0a82e" toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function HeroScene({ visible, onReady }: { visible: boolean; onReady: () => void }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 9], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      frameloop={visible ? 'always' : 'never'}
      onCreated={onReady}
    >
      <Scene />
    </Canvas>
  );
}
