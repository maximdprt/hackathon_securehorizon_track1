import type { RunEvent } from './types';

// Le rythme des gestes à l'écran, en millisecondes. Le serveur envoie les gestes aussi vite que l'agent les décide ;
// c'est l'interface qui les joue à vitesse humaine : le curseur se déplace, clique, tape, et l'agent écrit ce qu'il fait.
export const T = {
  hesitate: 140, // le temps de viser avant de bouger
  scroll: 420, // faire défiler jusqu'à l'élément
  move: 620, // traverser la page avec le curseur
  press: 260, // le clic
  char: 36, // une touche du clavier dans un champ
  typeMax: 1000, // un champ ne prend jamais plus que ça, même long
  address: 420, // taper une adresse dans la barre
  fade: 160, // la page qui s'efface avant la suivante
  load: 360, // la page suivante qui apparaît
  say: 17, // une lettre du raisonnement qui s'écrit dans le fil
  sayMax: 2600, // une explication ne prend jamais plus que ça, même longue
};

let pace = 1;
/** 1 = vitesse normale, 0 = aucun geste animé (tests, ou réglage "réduire les animations" du système). */
export const setPace = (value: number) => {
  pace = value;
};
export const paced = () => pace > 0;
export const ms = (n: number) => Math.round(n * pace);
export const typingTime = (chars: number) => Math.min(T.typeMax, chars * T.char);
export const sayTime = (chars: number) => Math.min(T.sayMax, chars * T.say);

/** Ce que l'agent dit de ce geste, quand le fil l'affiche : la raison d'une action, ou une réflexion. */
export function spoken(ev: RunEvent): string {
  if (ev.type === 'thought') return ev.text;
  if (ev.type === 'click' || ev.type === 'fill' || ev.type === 'choose') return ev.why;
  if (ev.type === 'nav' && ev.how !== 'click') return ev.why;
  return '';
}

function gesture(ev: RunEvent): number {
  switch (ev.type) {
    case 'click':
      return T.hesitate + T.scroll + T.move + T.press + 120;
    case 'fill':
      return T.hesitate + T.move * 0.7 + T.press + typingTime(ev.value.length) + 160;
    case 'nav':
      return (ev.how === 'goto' || ev.how === 'search' ? T.address : 0) + T.fade + T.load + 250;
    case 'choose':
      return 600;
    case 'pay':
      return 500;
    case 'submit':
      return 1300; // la voiture roule jusqu'au péage avant que le verdict se révèle
    default:
      return 0;
  }
}

/**
 * Le temps qu'un geste occupe l'écran : le suivant attend que le curseur ait fini et, si l'agent explique ce geste
 * (`narrated`), que son explication soit écrite en entier.
 */
export function durationOf(ev: RunEvent, narrated: boolean): number {
  return ms(Math.max(gesture(ev), narrated ? sayTime(spoken(ev).length) + 200 : 0));
}

export function sleep(n: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (n <= 0) return resolve();
    const timer = setTimeout(resolve, n);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}
