import type { RunEvent } from './types';

// Le rythme des gestes à l'écran, en millisecondes. Le serveur envoie les gestes aussi vite que l'agent les décide ;
// c'est l'interface qui les joue à vitesse humaine : le curseur se déplace, clique, tape, et l'agent écrit ce qu'il fait.
export const T = {
  hesitate: 140, // le temps de viser avant de bouger
  scroll: 420, // faire défiler jusqu'à l'élément
  move: 640, // traverser la page avec le curseur ; un trajet court prend moins (voir travelTime)
  aim: 110, // se poser sur la cible avant de cliquer : le temps de voir le halo
  press: 260, // le clic
  char: 36, // une touche du clavier dans un champ
  typeMax: 1000, // un champ ne prend jamais plus que ça, même long
  address: 420, // taper une adresse dans la barre
  fade: 160, // la page qui s'efface avant la suivante
  load: 420, // la page suivante qui apparaît
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
/** Le trajet du curseur : plus la cible est proche, plus il est court, sans jamais dépasser T.move. */
export const travelTime = (distance: number, speed = 1) => T.move * speed * Math.min(1, 0.5 + distance / 900);
/**
 * Le temps qu'une saisie occupe l'écran, du premier mouvement à la dernière lettre. Le navigateur s'y tient :
 * si la page a dû défiler longtemps, la frappe accélère pour finir à l'heure.
 */
export const fillTime = (chars: number) => T.hesitate + T.scroll * 0.4 + T.move * 0.7 + T.press + typingTime(chars);

/** La courbe --ease-move de la palette, cubic-bezier(.45, .05, .25, 1), pour les mouvements dessinés image par image. */
export function easeMove(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const curve = (u: number, a: number, b: number) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (curve(mid, 0.45, 0.25) < t) lo = mid;
    else hi = mid;
  }
  return curve((lo + hi) / 2, 0.05, 1);
}

/** Ce que l'agent dit de ce geste, quand le fil l'affiche : la raison d'une action, ou une réflexion. */
export function spoken(ev: RunEvent): string {
  if (ev.type === 'thought') return ev.text;
  if (ev.type === 'click' || ev.type === 'fill' || ev.type === 'choose' || ev.type === 'search' || ev.type === 'research') return ev.why;
  if (ev.type === 'pay') return ev.why ?? '';
  if (ev.type === 'nav' && ev.how !== 'click') return ev.why;
  return '';
}

function gesture(ev: RunEvent): number {
  switch (ev.type) {
    case 'click':
      return T.hesitate + T.scroll + T.move + T.aim + T.press + 120;
    case 'fill':
      return fillTime(ev.value.length) + 100;
    case 'nav':
      return (ev.how === 'goto' || ev.how === 'search' ? T.address : 0) + T.fade + T.load + 250;
    case 'choose':
    case 'search':
    case 'research':
      return 600;
    case 'pay':
      return 500;
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
