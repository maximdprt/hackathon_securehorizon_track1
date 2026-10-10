import { useEffect, useState } from 'react';
import { ms, paced, sayTime } from '../timing';

const TICK = 30;

type Props = {
  text: string;
  /** Vrai pour le geste en cours : le texte s'écrit lettre par lettre. Faux : il est affiché en entier. */
  live: boolean;
  onDone?: () => void;
};

/** Un texte qui s'écrit au fur et à mesure, comme si l'agent le tapait pendant qu'il agit. */
export function Typed({ text, live, onDone }: Props) {
  const [shown, setShown] = useState(() => (live && paced() ? 0 : text.length));
  const writing = live && shown < text.length;

  useEffect(() => {
    if (!writing) {
      onDone?.();
      return;
    }
    const perTick = Math.max(1, Math.ceil((text.length * TICK) / Math.max(TICK, ms(sayTime(text.length)))));
    const timer = setTimeout(() => setShown((n) => Math.min(text.length, n + perTick)), TICK);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone est rappelé à la fin de l'écriture, pas à chaque rendu
  }, [writing, shown, text]);

  if (!writing) return <>{text}</>;
  return (
    <>
      {/* Un lecteur d'écran reçoit la phrase entière, pas ses fragments. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, shown)}
        <span className="caret" />
      </span>
    </>
  );
}
