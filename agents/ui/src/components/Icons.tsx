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
export const Dots = () => (
  <Icon size={18} width={2.4}>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />
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
