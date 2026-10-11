import type { ReactNode } from 'react';

// Icônes au trait, décoratives : le libellé accessible est porté par le bouton ou le texte voisin.
function Icon({ size = 16, width = 1.5, children }: { size?: number; width?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Globe = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c2.2 1.9 2.2 10.5 0 12.4M8 1.8c-2.2 1.9-2.2 10.5 0 12.4" />
  </Icon>
);
export const Doc = () => (
  <Icon>
    <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
    <path d="M9 1.8V5h3.5M6 8.2h4.5M6 10.8h4.5" />
  </Icon>
);
export const Card = () => (
  <Icon>
    <rect x="1.8" y="3.5" width="12.4" height="9" rx="1.6" />
    <path d="M1.8 6.6h12.4M4.2 10h2.6" />
  </Icon>
);
export const Pointer = () => (
  <Icon>
    <path d="M3.5 2.5l9 4.2-3.9 1.5-1.5 3.9z" />
    <path d="M9.4 9.4l3.4 3.4" />
  </Icon>
);
export const Pen = () => (
  <Icon>
    <path d="M2.5 13.5l.6-2.9 7.6-7.6 2.3 2.3-7.6 7.6z" />
    <path d="M9.4 4.3l2.3 2.3" />
  </Icon>
);
export const Scale = () => (
  <Icon>
    <path d="M8 2.2v11.6M4.5 13.8h7M3 4.5h10M3 4.5L1.5 9h3zM13 4.5L11.5 9h3z" />
  </Icon>
);
export const Alert = () => (
  <Icon>
    <path d="M8 2L14.5 13.5h-13z" />
    <path d="M8 6.5v3.2M8 11.6v.2" />
  </Icon>
);
export const Lock = () => (
  <Icon size={14}>
    <rect x="3.2" y="7.2" width="9.6" height="6.6" rx="1.4" />
    <path d="M5.4 7.2V5.2a2.6 2.6 0 0 1 5.2 0v2" />
  </Icon>
);
export const ArrowUp = () => (
  <Icon size={18} width={1.8}>
    <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
  </Icon>
);
export const Stop = () => (
  <Icon size={18} width={1.8}>
    <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.4" />
  </Icon>
);
export const Check = () => (
  <Icon size={12} width={2}>
    <path d="M3.6 8.4l2.9 2.9 6-6.6" />
  </Icon>
);
