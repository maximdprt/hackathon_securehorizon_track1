import type { Agent, Profile } from '../types';

type Props = {
  agents: Agent[];
  current: Agent;
  profile: Profile;
  modelLabel: (agent: Agent) => string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: () => void;
};

/** L'onglet "Agents" : la liste des agents, les consignes de celui à qui l'on parle, et l'acheteur fictif. */
export function Panel({ agents, current, profile, modelLabel, onSelect, onNew, onEdit }: Props) {
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
        <h2 className="panel__title">Acheteur fictif</h2>
        <div className="panel__card">
          <p className="panel__text">
            {profile.name}, {profile.city}. Carte de test {profile.card}.
          </p>
          <p className="panel__note">
            L'agent remplit les formulaires avec ce profil inventé. Les boutiques sont locales et le paiement est simulé : rien n'est débité.
          </p>
        </div>
      </section>
    </>
  );
}
