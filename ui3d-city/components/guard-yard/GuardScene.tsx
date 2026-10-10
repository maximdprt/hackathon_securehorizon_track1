"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Material, Mesh, Object3D, PerspectiveCamera } from "three";
import type { Hud } from "./hud/controller";
import { buildBaler } from "./three/baler";
import { buildCar } from "./three/car";
import { CRUSH_FROM, CRUSH_LEN, DURATION, SCAN_END } from "./three/constants";
import { buildCrane } from "./three/crane";
import { buildEnvironment } from "./three/environment";
import { IMPACTS, frame, type Yard } from "./three/frame";
import { createKit } from "./three/materials";
import { buildPortal } from "./three/portal";
import { buildSkip } from "./three/skip";
import type { GuardMode, GuardVerdict } from "./types";

/* The yard, built once into the Canvas's scene (in an effect, not a memo: React's strict mode runs a memo twice and
   would leave the first build undisposed), played by frame(T) in useFrame: T advances while a run plays
   (dt capped at .05), the camera shakes at each stroke's end unless the reader asks for reduced motion, the run pauses
   while the tab is hidden. Everything built here is disposed on unmount (the modal opens and closes many times). */

export type Player = {
  /** start a run: the whole sequence, the scan only, or the crush only */
  play(mode: GuardMode): void;
  /** stop and stand at t (in the whole sequence's time) */
  seek(t: number): void;
  playing(): boolean;
};

export function GuardScene({ verdict, hud, player, onRunning }: { verdict: GuardVerdict; hud: MutableRefObject<Hud | null>; player: MutableRefObject<Player | null>; onRunning: (on: boolean) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);

  const [yard, setYard] = useState<{ y: Yard; dispose: () => void } | null>(null);
  useEffect(() => {
    const before = new Set(scene.children);
    const kit = createKit();
    const env = buildEnvironment(scene, kit, gl);
    const portal = buildPortal(scene, kit);
    const car = buildCar(scene, kit);
    const baler = buildBaler(scene, kit);
    const crane = buildCrane(scene, kit, baler.baler);
    const skip = buildSkip(scene, kit);
    const added = scene.children.filter((c) => !before.has(c));
    const y: Yard = { camera, portal, car, baler, crane, skip, hud: null, verdict };
    const dispose = () => {
      added.forEach((o) => {
        scene.remove(o);
        o.traverse((n: Object3D) => {
          const m = n as Mesh;
          m.geometry?.dispose();
          const mat = m.material as Material | Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        });
      });
      car.dispose();
      kit.materials.forEach((m) => m.dispose());
      kit.textures.forEach((t) => t.dispose());
      env.dispose();
      scene.environment = null;
      scene.background = null;
      scene.fog = null;
    };
    setYard({ y, dispose });
    return () => {
      dispose();
      setYard(null);
    };
    // the yard is built once; the verdict only feeds the HUD and the score (set below)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, gl, camera]);
  if (yard) yard.y.verdict = verdict;

  const run = useRef({ T: 3.4, mode: "all" as GuardMode, playing: false, shake: 0, hidden: false });
  const reduce = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // the player the buttons and the seek handle drive
  useEffect(() => {
    if (!yard) return;
    const r = run.current;
    const draw = () => {
      yard.y.hud = hud.current;
      frame(r.mode === "crush" ? r.T + CRUSH_FROM : r.T, yard.y, 0);
      invalidate();
    };
    player.current = {
      play(mode) {
        r.mode = mode;
        r.T = 0;
        r.shake = 0;
        r.playing = true;
        onRunning(true);
        draw();
      },
      seek(t) {
        r.mode = "all";
        r.T = t;
        r.playing = false;
        r.shake = 0;
        onRunning(false);
        draw();
      },
      playing: () => r.playing,
    };
    draw();
    const vis = () => {
      r.hidden = document.visibilityState === "hidden";
    };
    document.addEventListener("visibilitychange", vis);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __guardSeek?: (t: number) => void }).__guardSeek = (t) => player.current?.seek(t);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [yard, hud, player, invalidate, onRunning]);

  useFrame((_, delta) => {
    const r = run.current;
    if (!yard) return;
    yard.y.hud = hud.current;
    if (!r.playing || r.hidden) return;
    const dt = Math.min(delta, 0.05);
    const off = r.mode === "crush" ? CRUSH_FROM : 0;
    const before = r.T + off;
    r.T += dt;
    const now = r.T + off;
    // a stroke's end shakes the camera, once, as the run crosses it
    for (const [at, amount] of IMPACTS) if (before < at && now >= at && !reduce) r.shake = amount;
    frame(now, yard.y, r.shake);
    r.shake = Math.max(0, r.shake - dt * 1.0);
    const end = r.mode === "scan" ? SCAN_END : r.mode === "crush" ? CRUSH_LEN : DURATION;
    if (r.T >= end) {
      r.playing = false;
      onRunning(false);
    }
  });

  return null;
}
