import { type FormEvent, useEffect, useRef, useState } from 'react';
import { INSTRUCTIONS_MAX, NAME_MAX } from '../agents';
import type { Agent } from '../types';

type Props = {
  /** L'agent à modifier, ou null pour en créer un. */
  agent: Agent | null;
  models: Record<string, string>;
  defaultModel: string;
  canDelete: boolean;
  onSave: (data: Omit<Agent, 'id'>) => void;
  onCancel: () => void;
  onDelete: () => void;
};

export function AgentEditor({ agent, models, defaultModel, canDelete, onSave, onCancel, onDelete }: Props) {
  const [name, setName] = useState(agent?.name ?? '');
  const [instructions, setInstructions] = useState(agent?.instructions ?? '');
  const [model, setModel] = useState(agent && models[agent.model] ? agent.model : defaultModel);
  const [confirming, setConfirming] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const valid = name.trim().length > 0 && instructions.trim().length > 0;

  useEffect(() => nameInput.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) onSave({ name: name.trim(), instructions: instructions.trim(), model });
  }

  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <h2>{agent ? "Modifier l'agent" : 'Nouvel agent'}</h2>
      <p className="lede">Les consignes sont ce que l'agent suit à chaque demande, comme un prompt système.</p>
      <label className="field">
        <span className="k">Nom</span>
        <input ref={nameInput} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        <span className="k">Consignes</span>
        <textarea value={instructions} maxLength={INSTRUCTIONS_MAX} onChange={(e) => setInstructions(e.target.value)} required />
      </label>
      <p className="hint">
        <span>Exemple : « Trouve le meilleur produit. Compare toutes les boutiques sur le prix, la livraison et la garantie. »</span>
        <span className="count">
          {instructions.length} / {INSTRUCTIONS_MAX}
        </span>
      </p>
      <label className="field">
        <span className="k">Modèle</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {Object.entries(models).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button type="submit" className="btn" disabled={!valid}>
          Enregistrer
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Annuler
        </button>
        {agent && canDelete && (
          <button type="button" className="btn quiet" onClick={() => (confirming ? onDelete() : setConfirming(true))}>
            {confirming ? 'Confirmer la suppression' : 'Supprimer'}
          </button>
        )}
      </div>
    </form>
  );
}
