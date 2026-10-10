"use client";

import dynamic from "next/dynamic";

/* the whole app is client-side: the City needs WebGL 2 and reads its feeds in the browser, as on builders-hub */
const CityShell = dynamic(() => import("@/app/avaguard/CityShell"), { ssr: false });

export default function Page() {
  return <CityShell />;
}
