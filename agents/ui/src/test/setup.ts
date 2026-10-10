import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
