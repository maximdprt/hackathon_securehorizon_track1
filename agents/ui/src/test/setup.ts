import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { setPace } from '../timing';

setPace(0); // les tests ne jouent pas les gestes : chaque étape s'applique tout de suite

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
