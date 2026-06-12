"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  useGLTF,
  ContactShadows,
  Environment,
  Lightformer,
} from "@react-three/drei";
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
    id: "milano",
    name: "Milano",
    doorType: "Double Door",
    url: "/3d/door-milano.glb",
    description: "Modern horizontal bars with vertical accent",
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
  {
    id: "geo",
    name: "Geo",
    doorType: "Double Door",
    url: "/3d/door-geo.glb",
    description: "Stacked diamond outlines",
    widthIn: 72,
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

  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material as THREE.MeshStandardMaterial;
      if (mat.name === "PatternMetal") {
        mat.color.set(finish.hex);
        mat.metalness = finish.metalness;
        mat.roughness = finish.roughness;
        // Dark metals (bronze/black) read as flat black without strong
        // env reflections — crank the env contribution so they show sheen.
        mat.envMapIntensity = 1.8;
      } else if (mat.name === "Glass") {
        // Frosted glass: keep it translucent and stop it from occluding
        // the pattern bars behind/in front of it.
        mat.transparent = true;
        mat.opacity = 0.32;
        mat.roughness = 0.65;
        mat.depthWrite = false;
      }
    });
  }, [scene, finish]);

  return <primitive object={scene} />;
}

function Scene({ model, finish }: { model: DoorModel; finish: Finish }) {
  return (
    <Canvas
      shadows
      camera={{ position: [0.4, 1.5, 3.4], fov: 42 }}
      style={{ touchAction: "none" }}
    >
      <color attach="background" args={["#eef1f5"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} castShadow />
      <directionalLight position={[-4, 3, -3]} intensity={0.6} />
      {/* Procedural environment (no network fetch) so metallic finishes
          have something to reflect — without it bronze renders black. */}
      <Environment resolution={256}>
        <Lightformer
          intensity={3}
          position={[0, 4, 6]}
          scale={[10, 4, 1]}
          color="#ffffff"
        />
        <Lightformer
          intensity={2}
          position={[-6, 2, -2]}
          rotation-y={Math.PI / 2}
          scale={[8, 3, 1]}
          color="#dfe8f5"
        />
        <Lightformer
          intensity={1.5}
          position={[6, 1, 2]}
          rotation-y={-Math.PI / 2}
          scale={[8, 3, 1]}
          color="#fff5e8"
        />
      </Environment>
      <Door url={model.url} finish={finish} />
      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={0.45}
        scale={6}
        blur={2.2}
        far={3}
      />
      <OrbitControls
        target={[0, 1.05, 0]}
        minDistance={1.5}
        maxDistance={6}
        maxPolarAngle={Math.PI / 1.9}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.6}
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
