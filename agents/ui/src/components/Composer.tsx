import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

const IDEAS = [
  'Achète-moi une Apple Watch Series 10 46mm.',
  'Achète une Apple Watch SE 40mm.',
  'Achète une Apple Watch Ultra 2.',
  'Je veux une Apple Watch Series 10 42mm, livrée vite.',
];

type Props = { agentName: string; running: boolean; onSend: (text: string) => void; onStop: () => void };

export function Composer({ agentName, running, onSend, onStop }: Props) {
  const [text, setText] = useState('');
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
  }, [running]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if (!value || running) return;
    setText('');
    onSend(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="ask" onSubmit={submit}>
      <div className="ideas">
        {IDEAS.map((idea) => (
          <button key={idea} type="button" className="idea" disabled={running} onClick={() => { setText(idea); input.current?.focus(); }}>
            {idea}
          </button>
        ))}
      </div>
      <div className="send">
        <textarea
          ref={input}
          rows={1}
          value={text}
          disabled={running}
          aria-label="Demande pour l'agent"
          placeholder={`Écris à ${agentName} : achète-moi une Apple Watch Series 10 46mm`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button type="button" className="btn ghost" onClick={onStop}>
            Arrêter
          </button>
        ) : (
          <button type="submit" className="btn" disabled={!text.trim()}>
            Envoyer
          </button>
        )}
      </div>
      <p className="keys">Entrée pour envoyer, Maj + Entrée pour aller à la ligne.</p>
    </form>
  );
}
