"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PCFSoftShadowMap } from "three";
import { GuardCard } from "./hud/GuardCard";
import { HackerTag } from "./hud/HackerTag";
import { PhaseLabel } from "./hud/PhaseLabel";
import { createHud, type Hud } from "./hud/controller";
import "./hud/guard-yard.css";
import { GuardScene, type Player } from "./GuardScene";
import type { GuardVerdict } from "./types";

/* The Guard Yard: its own Canvas (not the City's: its own cinematic cameras, local clipping planes and an additive
   hologram, no post-processing), the HUD over it, the four buttons under it. A refused transaction drives through the
   X-ray gantry, is crushed in the baler and laid in the hackers' registry skip. Reference: docs/reference/avaguard-fx.html. */

export function GuardYard({ verdict, autoPlay = true }: { verdict: GuardVerdict; autoPlay?: boolean }) {
  const hudRoot = useRef<HTMLDivElement>(null);
  const hud = useRef<Hud | null>(null);
  const player = useRef<Player | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (hudRoot.current) hud.current = createHud(hudRoot.current, verdict);
    return () => {
      hud.current = null;
    };
  }, [verdict]);

  // as the reference: the sequence starts by itself shortly after opening, unless the reader asks for reduced motion
  useEffect(() => {
    if (!autoPlay || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => {
      if (!player.current?.playing()) player.current?.play("all");
    }, 900);
    return () => window.clearTimeout(id);
  }, [autoPlay]);

  const onRunning = useCallback((on: boolean) => setRunning(on), []);

  return (
    <div className="gy flex flex-col gap-3">
      <div className="gy-stage">
        <Canvas
          shadows={{ enabled: true, type: PCFSoftShadowMap }}
          dpr={[1, 2]}
          frameloop={running ? "always" : "demand"}
          gl={{ antialias: true }}
          camera={{ fov: 30, near: 0.1, far: 300, position: [-18.5, 9.4, 8.2] }}
          onCreated={({ gl }) => {
            gl.localClippingEnabled = true;
            gl.toneMappingExposure = 1.0;
          }}
        >
          <GuardScene verdict={verdict} hud={hud} player={player} onRunning={onRunning} />
        </Canvas>
        <div className="gy-hud" ref={hudRoot}>
          <PhaseLabel txId={verdict.txId} />
          <GuardCard v={verdict} />
          <HackerTag v={verdict} />
        </div>
      </div>
      <div className="gy-controls">
        <button type="button" className="primary" onClick={() => player.current?.play("all")}>
          Lancer la séquence
        </button>
        <button type="button" onClick={() => player.current?.play("scan")}>
          Scanner seulement
        </button>
        <button type="button" onClick={() => player.current?.play("crush")}>
          Broyer seulement
        </button>
        <button type="button" onClick={() => player.current?.seek(3.4)}>
          Réinitialiser
        </button>
        <span className="gy-note ml-auto">Concept · simulation · données fictives</span>
      </div>
    </div>
  );
}
