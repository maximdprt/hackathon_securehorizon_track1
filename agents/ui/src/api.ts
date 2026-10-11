import type { Mode, RunEvent, World } from './types';

export async function fetchWorld(): Promise<World> {
  const res = await fetch('/api/world');
  if (!res.ok) throw new Error(`Le serveur a répondu ${res.status}`);
  return res.json();
}

export type RunRequest = { prompt: string; agent: string; instructions: string; model: string; mode?: Mode; /** false : le paiement part sans vérification. */ guard?: boolean };

/** Un humain tranche une décision en attente du garde. */
export async function decide(instruction_id: string, decision: 'allow' | 'decline' | 'block'): Promise<{ verdict: string }> {
  const res = await fetch('/api/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction_id, decision }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Le serveur a répondu ${res.status}`);
  return data;
}

/** Lance un run et rend ses étapes au fil de l'eau. `signal` permet de l'interrompre. */
export async function* streamRun(body: RunRequest, signal: AbortSignal): AsyncGenerator<RunEvent> {
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Requête refusée par le serveur (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as RunEvent;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as RunEvent;
}
