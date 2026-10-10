import type { Agent } from './types';

// Les agents sont enregistrés dans ce navigateur. Les clés sont celles de l'ancienne interface : rien n'est perdu.
const AGENTS_KEY = 'sandbox.agents.v1';
const CURRENT_KEY = 'sandbox.agent.current';

const DEFAULTS: Omit<Agent, 'model'>[] = [
  {
    id: 'prix',
    name: 'Chasseur de prix',
    instructions: 'Trouve le produit demandé au prix le plus bas.\nCompare toutes les boutiques avant de choisir, puis achète chez la moins chère.',
  },
  {
    id: 'offre',
    name: 'Meilleure offre',
    instructions:
      "Trouve la meilleure offre globale pour le produit demandé.\nCompare au moins trois boutiques sur le prix, les frais et délais de livraison, la garantie et les avis clients.\nAchète là où l'ensemble est le meilleur.",
  },
  {
    id: 'prudent',
    name: 'Acheteur prudent',
    instructions:
      "La fiabilité du marchand passe avant le prix.\nVérifie pour chaque boutique l'ancienneté, les coordonnées de la société, la garantie, les retours et les avis.\nN'achète que chez le marchand qui t'inspire le plus confiance, même s'il est plus cher.",
  },
];

export const NAME_MAX = 80;
export const INSTRUCTIONS_MAX = 4000;

export function loadAgents(defaultModel: string): { agents: Agent[]; currentId: string } {
  let agents: Agent[] = DEFAULTS.map((a) => ({ ...a, model: defaultModel }));
  let currentId = agents[0].id;
  try {
    const saved = JSON.parse(localStorage.getItem(AGENTS_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length && saved.every((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.instructions === 'string')) {
      agents = saved;
    }
    const last = localStorage.getItem(CURRENT_KEY);
    currentId = agents.some((a) => a.id === last) ? (last as string) : agents[0].id;
  } catch {
    // stockage indisponible (navigation privée...) : on garde les agents par défaut
  }
  return { agents, currentId };
}

export function saveAgents(agents: Agent[], currentId: string): void {
  try {
    localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
    localStorage.setItem(CURRENT_KEY, currentId);
  } catch {
    // idem : l'interface marche sans stockage, les agents ne survivent juste pas au rechargement
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
