import type { RunEvent } from './types';

// Le rythme des gestes à l'écran, en millisecondes. Le serveur envoie les gestes aussi vite que l'agent les décide ;
// c'est l'interface qui les joue à vitesse humaine : le curseur se déplace, clique, tape.
export const T = {
  hesitate: 140, // le temps de viser avant de bouger
  scroll: 420, // faire défiler jusqu'à l'élément
  move: 620, // traverser la page avec le curseur
  press: 260, // le clic
  char: 36, // une touche du clavier
  typeMax: 1000, // un champ ne prend jamais plus que ça, même long
  address: 420, // taper une adresse dans la barre
  fade: 160, // la page qui s'efface avant la suivante
  load: 360, // la page suivante qui apparaît
};

let pace = 1;
/** 1 = vitesse normale, 0 = aucun geste animé (tests, ou réglage "réduire les animations" du système). */
export const setPace = (value: number) => {
  pace = value;
};
export const paced = () => pace > 0;
export const ms = (n: number) => Math.round(n * pace);
export const typingTime = (chars: number) => Math.min(T.typeMax, chars * T.char);

/** Le temps que le navigateur met à jouer un geste : le geste suivant attend la fin de celui-ci. */
export function durationOf(ev: RunEvent): number {
  switch (ev.type) {
    case 'click':
      return ms(T.hesitate + T.scroll + T.move + T.press + 120);
    case 'fill':
      return ms(T.hesitate + T.move * 0.7 + T.press + typingTime(ev.value.length) + 160);
    case 'nav':
      return ms((ev.how === 'goto' || ev.how === 'search' ? T.address : 0) + T.fade + T.load + 250);
    case 'choose':
      return ms(900);
    case 'pay':
      return ms(500);
    case 'thought':
      return ms(350);
    default:
      return 0;
  }
}

export function sleep(n: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (n <= 0) return resolve();
    const timer = setTimeout(resolve, n);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}
