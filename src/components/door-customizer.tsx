"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  useGLTF,
  useTexture,
  ContactShadows,
  Environment,
  MeshReflectorMaterial,
} from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  N8AO,
} from "@react-three/postprocessing";
import { Check, DoorOpen, Rotate3d } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

interface DoorModel {
  id: string;
  name: string;
  doorType: string;
  url: string;
  description: string;
  widthIn: number;
  heightIn: number;
}

const MODELS: DoorModel[] = [
  {
    id: "eclipse",
    name: "Eclipse",
    doorType: "Double Door",
    url: "/3d/door-eclipse.glb",
    description: "Intersecting tall ovals per leaf",
    widthIn: 72,
    heightIn: 80,
  },
  {
    id: "orbit",
    name: "Orbit",
    doorType: "Double Door",
    url: "/3d/door-orbit.glb",
    description: "Center circle with sweeping corner arcs",
    widthIn: 72,
    heightIn: 80,
  },
  {
    id: "roma",
    name: "Roma",
    doorType: "Single Door",
    url: "/3d/door-roma.glb",
    description: "Classic rings over a center bar",
    widthIn: 36,
    heightIn: 80,
  },
];

interface Finish {
  id: string;
  label: string;
  hex: string;
  swatch: string;
  metalness: number;
  roughness: number;
  note?: string;
}

const FINISHES: Finish[] = [
  {
    id: "bronze",
    label: "Bronze",
    // Display tone slightly lifted from the true PMS 440C (#382E2C):
    // at real value the 3D render is indistinguishable from black.
    hex: "#5a463c",
    swatch: "#4a3c36",
    // Painted aluminum, not raw metal — keep metalness moderate so the
    // directional lights contribute diffuse warmth (full-metal renders
    // black without strong reflections).
    metalness: 0.45,
    roughness: 0.42,
    note: "PMS 440C",
  },
  {
    id: "white",
    label: "White",
    hex: "#F4F4F0",
    swatch: "#f4f4f0",
    metalness: 0.25,
    roughness: 0.5,
  },
  {
    id: "black",
    label: "Black",
    hex: "#222222",
    swatch: "#1a1a1a",
    metalness: 0.5,
    roughness: 0.45,
  },
];

MODELS.forEach((m) => useGLTF.preload(m.url));

/* ------------------------------------------------------------------ */
/* 3D scene                                                            */
/* ------------------------------------------------------------------ */

function Door({ url, finish }: { url: string; finish: Finish }) {
  const { scene } = useGLTF(url);
  const roughTex = useTexture("/3d/tex/rough.jpg");

  // True frosted glass: physical transmission blurs whatever is behind it
  // (the wall) — far more believable than a flat translucent plane.
  const frostedGlass = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      name: "Glass",
      color: "#eef1f0",
      transmission: 1,
      roughness: 0.55,
      thickness: 0.02,
      ior: 1.5,
      metalness: 0,
    });
    return m;
  }, []);

  useEffect(() => {
    roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
    roughTex.repeat.set(2, 2);
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mat = obj.material as THREE.MeshStandardMaterial;
      if (mat.name === "PatternMetal") {
        mat.color.set(finish.hex);
        mat.metalness = finish.metalness;
        mat.roughness = finish.roughness;
        // micro-variation in the highlights — flat roughness reads as CG
        mat.roughnessMap = roughTex;
        // Dark metals (bronze/black) read as flat black without strong
        // env reflections — crank the env contribution so they show sheen.
        mat.envMapIntensity = 1.8;
        mat.needsUpdate = true;
      } else if (mat.name === "Glass") {
        obj.material = frostedGlass;
      }
    });
  }, [scene, finish, roughTex, frostedGlass]);

  return <primitive object={scene} />;
}

/** Entryway context: textured stucco wall + baseboard + paver floor with
 * soft reflections — flat-color planes are the #1 "this is CG" giveaway. */
function Backdrop() {
  const [stucco, concrete] = useTexture([
    "/3d/tex/stucco.jpg",
    "/3d/tex/concrete.jpg",
  ]);

  useEffect(() => {
    stucco.wrapS = stucco.wrapT = THREE.RepeatWrapping;
    stucco.repeat.set(7, 3.5);
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;
    concrete.repeat.set(7, 3.5);
  }, [stucco, concrete]);

  return (
    <>
      <mesh position={[0, 1.8, -0.1]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial
          map={stucco}
          bumpMap={stucco}
          bumpScale={0.4}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      <mesh position={[0, 0.055, -0.085]} receiveShadow>
        <boxGeometry args={[14, 0.11, 0.025]} />
        <meshStandardMaterial color="#d8d2c8" roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 2.5]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <MeshReflectorMaterial
          map={concrete}
          blur={[280, 60]}
          resolution={1024}
          mixBlur={0.85}
          mixStrength={2.5}
          roughness={0.75}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#cfd1d3"
          metalness={0.05}
        />
      </mesh>
    </>
  );
}

/** Warm wall sconce (dark housing + glowing diffuser + real point light) —
 * mirrors the lanterns in the client's reference photos. */
function Sconce({ x }: { x: number }) {
  return (
    <group position={[x, 1.78, 0.09]}>
      <mesh castShadow>
        <boxGeometry args={[0.13, 0.36, 0.13]} />
        <meshStandardMaterial color="#23211f" metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.085, 0.27, 0.085]} />
        <meshStandardMaterial
          color="#ffd9a0"
          emissive="#ffae54"
          emissiveIntensity={2.4}
          toneMapped={false}
        />
      </mesh>
      <pointLight color="#ffb45e" intensity={1.6} distance={3.2} decay={2} />
    </group>
  );
}

/** Simple stylized boxwood in a planter, flanking the entry. */
function Planter({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0.45]}>
      <mesh castShadow position={[0, 0.21, 0]}>
        <cylinderGeometry args={[0.16, 0.13, 0.42, 24]} />
        <meshStandardMaterial color="#55575a" roughness={0.85} />
      </mesh>
      <mesh castShadow position={[0, 0.62, 0]} scale={[1, 1.35, 1]}>
        <icosahedronGeometry args={[0.24, 1]} />
        <meshStandardMaterial color="#2e4d2a" roughness={0.95} flatShading />
      </mesh>
      <mesh castShadow position={[0.07, 0.86, 0.04]} scale={[0.6, 0.8, 0.6]}>
        <icosahedronGeometry args={[0.18, 1]} />
        <meshStandardMaterial color="#37592f" roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}

function Scene({ model, finish }: { model: DoorModel; finish: Finish }) {
  // Side dressing (sconces/planters) tracks the door width so the SD
  // model doesn't end up with lights floating a meter away.
  const half = (model.widthIn * 0.0254) / 2;
  const sconceX = half + 0.55;
  const planterX = half + 0.95;

  return (
    <Canvas
      shadows
      camera={{ position: [0.4, 1.5, 3.4], fov: 42 }}
      style={{ touchAction: "none" }}
    >
      <color attach="background" args={["#eef1f5"]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[3, 5, 4]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-4, 3, -3]} intensity={0.6} />
      {/* Real outdoor HDR (local file, no CDN) — rich reflections on the
          metal are most of what separates "CG" from "photo". */}
      <Environment files="/3d/env.hdr" environmentIntensity={0.75} />
      <Door url={model.url} finish={finish} />
      <Backdrop />
      <Sconce x={-sconceX} />
      <Sconce x={sconceX} />
      <Planter x={-planterX} />
      <Planter x={planterX} />
      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.35}
        scale={6}
        blur={2.2}
        far={3}
      />
      <EffectComposer>
        <N8AO aoRadius={0.35} intensity={2} distanceFalloff={1} />
        <Bloom luminanceThreshold={1.05} intensity={0.45} mipmapBlur />
        <Vignette eskil={false} offset={0.12} darkness={0.55} />
      </EffectComposer>
      <OrbitControls
        target={[0, 1.05, 0]}
        minDistance={1.6}
        maxDistance={5.5}
        // Keep the camera in front of the facade — behind the wall there
        // is nothing to see.
        minAzimuthAngle={-1.0}
        maxAzimuthAngle={1.0}
        minPolarAngle={0.7}
        maxPolarAngle={Math.PI / 2.02}
        enablePan={false}
      />
    </Canvas>
  );
}

/* ------------------------------------------------------------------ */
/* Page UI                                                             */
/* ------------------------------------------------------------------ */

export default function DoorCustomizer() {
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [finishId, setFinishId] = useState(FINISHES[0].id);

  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  const finish = FINISHES.find((f) => f.id === finishId) ?? FINISHES[0];

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Rotate3d className="h-5 w-5 text-indigo-600" />
            3D Door Customizer
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
              Demo
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag to rotate · scroll to zoom · pick a design and finish.
            Models generated procedurally with Blender.
          </p>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Viewport */}
        <div className="relative min-h-[420px] overflow-hidden rounded-xl border bg-slate-100 lg:min-h-[560px]">
          <Scene model={model} finish={finish} />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/85 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <span className="font-semibold">{model.name}</span>
            {" · "}
            {model.doorType}
            {" · "}
            {finish.label}
            {finish.note ? ` (${finish.note})` : ""}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <DoorOpen className="h-4 w-4" /> Design
            </h2>
            <div className="flex flex-col gap-2">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModelId(m.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition",
                    m.id === modelId
                      ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600"
                      : "hover:border-slate-400"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.doorType}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {m.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <h2 className="mb-3 text-sm font-semibold">Finish</h2>
            <div className="flex gap-3">
              {FINISHES.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFinishId(f.id)}
                  title={f.note ? `${f.label} — ${f.note}` : f.label}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-inner transition",
                      f.id === finishId
                        ? "border-indigo-600 ring-2 ring-indigo-600 ring-offset-2"
                        : "border-slate-300"
                    )}
                    style={{ backgroundColor: f.swatch }}
                  >
                    {f.id === finishId && (
                      <Check
                        className="h-5 w-5"
                        style={{
                          color: f.id === "white" ? "#1a1a1a" : "#fff",
                        }}
                      />
                    )}
                  </span>
                  <span className="text-xs font-medium">{f.label}</span>
                  {f.note && (
                    <span className="text-[10px] text-muted-foreground">
                      {f.note}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold">Specs</h2>
            <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Configuration</dt>
              <dd className="font-medium">{model.doorType}</dd>
              <dt className="text-muted-foreground">Nominal size</dt>
              <dd className="font-medium">
                {model.widthIn}&quot; × {model.heightIn}&quot;
              </dd>
              <dt className="text-muted-foreground">Finish</dt>
              <dd className="font-medium">
                {finish.label}
                {finish.note ? ` · ${finish.note}` : ""}
              </dd>
              <dt className="text-muted-foreground">Glass</dt>
              <dd className="font-medium">Frosted impact glass</dd>
            </dl>
            <p className="mt-3 rounded-md bg-slate-50 p-2 text-[11px] leading-relaxed text-muted-foreground">
              Demo preview — production version would cover the full catalog
              with exact pattern geometry per design code.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
