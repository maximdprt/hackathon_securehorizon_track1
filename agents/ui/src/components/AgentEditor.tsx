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
    <form className="editor" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <h2 className="panel__title">{agent ? "Modifier l'agent" : 'Nouvel agent'}</h2>
      <label className="editor__field">
        Nom
        <input className="editor__input" ref={nameInput} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="editor__field">
        Consignes
        <textarea
          className="editor__input editor__input--area"
          value={instructions}
          maxLength={INSTRUCTIONS_MAX}
          onChange={(e) => setInstructions(e.target.value)}
          required
        />
      </label>
      <p className="editor__hint">
        <span>Ce que l'agent suit à chaque demande. Exemple : « Trouve le meilleur produit. Compare toutes les boutiques. »</span>
        <span className="editor__count">
          {instructions.length} / {INSTRUCTIONS_MAX}
        </span>
      </p>
      <label className="editor__field">
        Modèle
        <select className="editor__input" value={model} onChange={(e) => setModel(e.target.value)}>
          {Object.entries(models).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="panel__actions">
        <button type="submit" className="button button--primary" disabled={!valid}>
          Enregistrer
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Annuler
        </button>
        {agent && canDelete && (
          <button type="button" className="button" onClick={() => (confirming ? onDelete() : setConfirming(true))}>
            {confirming ? 'Confirmer la suppression' : 'Supprimer'}
          </button>
        )}
      </div>
    </form>
  );
}
