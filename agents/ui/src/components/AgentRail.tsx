import { initials } from '../agents';
import type { Agent } from '../types';

type Props = {
  agents: Agent[];
  currentId: string;
  models: Record<string, string>;
  defaultModel: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: () => void;
};

/** La liste des agents : chacun a ses consignes, on choisit celui à qui l'on parle. */
export function AgentRail({ agents, currentId, models, defaultModel, onSelect, onNew, onEdit }: Props) {
  return (
    <div>
      <h2>Agents</h2>
      <p className="lede">Chacun a ses propres consignes. Choisis celui à qui tu parles.</p>
      {agents.map((agent) => (
        <button key={agent.id} type="button" className="agent" aria-pressed={agent.id === currentId} onClick={() => onSelect(agent.id)}>
          <span className="avatar" aria-hidden="true">
            {initials(agent.name)}
          </span>
          <b>{agent.name}</b>
          <span className="brief">{agent.instructions}</span>
          <span className="k">{models[agent.model] ?? models[defaultModel]}</span>
        </button>
      ))}
      <div className="row">
        <button type="button" className="btn ghost" onClick={onNew}>
          Nouvel agent
        </button>
        <button type="button" className="btn ghost" onClick={onEdit}>
          Modifier les consignes
        </button>
      </div>
    </div>
  );
}
