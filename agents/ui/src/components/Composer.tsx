import { type FormEvent, type KeyboardEvent, useEffect, useRef } from 'react';
import { ArrowUp, Stop } from './Icons';

type Props = {
  agentName: string;
  text: string;
  running: boolean;
  onChange: (text: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function Composer({ agentName, text, running, onChange, onSend, onStop }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // le champ grandit avec le texte, jusqu'à sa hauteur maximale
    const area = input.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (!running) input.current?.focus();
  }, [running, text]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (!value || running) return;
    onChange('');
    onSend(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="chat__composer" onSubmit={submit}>
      <textarea
        className="chat__input"
        ref={input}
        rows={1}
        value={text}
        disabled={running}
        aria-label="Demande pour l'agent"
        placeholder={`Donnez une consigne à ${agentName}`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {running ? (
        <button type="button" className="chat__send chat__send--stop" aria-label="Arrêter" onClick={onStop}>
          <Stop />
        </button>
      ) : (
        <button type="submit" className="chat__send" aria-label="Envoyer" disabled={!text.trim()}>
          <ArrowUp />
        </button>
      )}
    </form>
  );
}
