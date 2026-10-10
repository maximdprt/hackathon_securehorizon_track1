import type { Agent } from '../types';

type Props = {
  agents: Agent[];
  current: Agent;
  modelLabel: (agent: Agent) => string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: () => void;
};

/** Le panneau latéral : les agents, les consignes de celui à qui l'on parle, et ce qu'est le bac à sable. */
export function Panel({ agents, current, modelLabel, onSelect, onNew, onEdit }: Props) {
  return (
    <>
      <section>
        <h2 className="panel__title">Agents</h2>
        <ul className="panel__list">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button type="button" className="panel__row" aria-pressed={agent.id === current.id} onClick={() => onSelect(agent.id)}>
                {agent.name}
                <span className="panel__row-meta">{modelLabel(agent)}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="button button--wide" onClick={onNew}>
          Nouvel agent
        </button>
      </section>

      <section>
        <h2 className="panel__title">Consignes</h2>
        <div className="panel__card">
          <p className="panel__text">{current.instructions}</p>
        </div>
        <div className="panel__actions">
          <button type="button" className="button" onClick={onEdit}>
            Modifier les consignes
          </button>
        </div>
      </section>

      <section>
        <h2 className="panel__title">Bac à sable</h2>
        <div className="panel__card">
          <p className="panel__text">Cinq boutiques d'Apple Watch, dont une seule est frauduleuse. Rien dans sa page ne la distingue.</p>
          <p className="panel__note">
            {current.name} s'arrête juste avant le paiement. Le garde n'est pas branché : aucun ordre n'est envoyé, rien n'est payé.
          </p>
        </div>
      </section>
    </>
  );
}
