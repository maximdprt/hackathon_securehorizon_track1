import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Frame, Step } from '../run';
import { easeMove, fillTime, ms, paced, sleep, T, tabTime, travelTime, typingTime } from '../timing';
import type { Site } from '../types';
import { Card, Globe, Lock, Pen, Pointer } from './Icons';

type Props = {
  /** L'image à montrer, ou null tant qu'aucun agent n'a navigué. */
  frame: Frame | null;
  /** Identifie l'image dans la conversation : elle n'est jouée qu'une fois. */
  frameKey: string;
  /** Vrai quand on suit l'agent : le geste est joué. Faux quand on revoit une étape passée : la page s'affiche telle quelle. */
  animate: boolean;
  agentName: string;
  sites: Site[];
  /** Ce que l'agent est en train de faire sur cette page, et pourquoi. */
  caption: string;
  why?: string;
  /** Le type du geste légendé : il donne sa couleur au bandeau. Sans lui, la couleur vient de l'image. */
  gesture?: Step['kind'];
  replaying: boolean;
  running: boolean;
  /** Mode finance : l'agent n'ouvre aucune page, tout se passe dans le chat. */
  finance?: boolean;
  onLive: () => void;
};

/** Les quatre familles de gestes, chacune avec sa couleur dans la palette (--k-search, --k-click, --k-type, --k-pay). */
type Gesture = 'search' | 'click' | 'type' | 'pay';
/** Où en est le navigateur : il tape une adresse, change de page, joue un geste du curseur, ou attend la suite. */
type Phase = 'idle' | 'typing' | 'loading' | 'acting';
/** La page : affichée, en train de s'effacer, ou cachée le temps de charger (prête à monter en place, ou sans mouvement). */
type Stage = 'in' | 'out' | 'below' | 'still';
/** Le halo posé sur l'élément visé : il se resserre en visant, s'efface au clic, et pulse quand le paiement part. */
type Halo = { n: number; x: number; y: number; w: number; h: number; state: 'aim' | 'hit' | 'pay' };

const TRAIL = 110; // la traînée du curseur : le chemin de ses dernières millisecondes
const shortUrl = (url: string) => url.replace(/^https:\/\//, '');
const byRef = <E extends HTMLElement>(doc: Document, ref?: string) => (ref ? doc.querySelector<E>(`[data-ref="${ref}"]`) : null);
const siteOf = (sites: Site[], url?: string) => (url ? sites.find((s) => url.includes(`//${s.domain}`)) : undefined);

function gestureOf(frame: Frame | null, kind?: Step['kind']): Gesture {
  const what = kind ?? frame?.kind;
  return what === 'pay' ? 'pay' : what === 'click' ? 'click' : what === 'fill' ? 'type' : 'search';
}

const Magnifier = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <circle cx="7" cy="7" r="4.4" />
    <path d="M10.4 10.4l3.4 3.4" />
  </svg>
);
const Arrow = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 22 22" aria-hidden="true">
    <path d="M4 2.5v15.2l4.2-3.7 2.8 6.3 2.5-1.1-2.8-6.2h5.6z" fill="currentColor" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
const Dots = () => (
  <span className="browser__dots" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);

/** Joue `draw` à chaque image de l'écran, de 0 à 1 en `duration` ms, tant que `alive`. Il dessine seulement : l'attente reste un `sleep`. */
function tween(duration: number, draw: (t: number) => void, alive: () => boolean) {
  const start = performance.now();
  const step = (now: number) => {
    if (!alive()) return;
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    draw(t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** La fenêtre de navigation de l'agent : onglet, barre d'adresse, page réelle du site, et un curseur qui joue ses gestes. */
export function BrowserView({ frame, frameKey, animate, agentName, sites, caption, why, gesture, replaying, running, finance, onLive }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const pointer = useRef<HTMLDivElement>(null);
  const trail = useRef<SVGSVGElement>(null);
  const at = useRef({ x: 0, y: 0 }); // où est la pointe du curseur, dans le repère de la page
  const shown = useRef(''); // adresse de la page chargée dans le cadre
  const filled = useRef(''); // adresse de la page si le dernier geste y était une saisie : la suivante s'enchaîne avec Tab
  const turn = useRef(0); // un geste en cours est abandonné dès qu'un autre commence
  const arriving = useRef<{ frame: Frame; turn: number; play: boolean } | null>(null); // la page en cours de chargement
  const live = useRef(animate);
  live.current = animate;
  const [page, setPage] = useState('');
  const [address, setAddress] = useState('');
  const [tab, setTab] = useState<{ url: string; title: string } | null>(null); // la page que l'onglet annonce : celle qui est chargée
  const [stage, setStage] = useState<Stage>('in');
  const [phase, setPhase] = useState<Phase>('idle');
  const [loads, setLoads] = useState(0); // chaque changement de page relance la barre de chargement
  const [cursor, setCursor] = useState({ visible: false, pressed: false, flip: false });
  const [ripple, setRipple] = useState<{ n: number; gesture: Gesture }>({ n: 0, gesture: 'click' });
  const [halo, setHalo] = useState<Halo | null>(null);

  /** Pose le curseur. Sa position change à chaque image d'un déplacement : elle est écrite directement, sans passer par un rendu. */
  function place(x: number, y: number) {
    at.current = { x, y };
    if (pointer.current) pointer.current.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
  /** Dessine la traînée, du plus récent au plus ancien point, en trois traits de plus en plus fins. null l'efface. */
  function streak(points: number[][] | null) {
    const strokes = trail.current?.children ?? [];
    for (let i = 0; i < strokes.length; i++) {
      const part = points?.slice(i * 3, i * 3 + 4) ?? [];
      strokes[i].setAttribute('d', part.map(([x, y], j) => `${j ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(''));
    }
  }
  useLayoutEffect(() => place(at.current.x, at.current.y)); // le curseur garde sa place quand il est redessiné

  useEffect(
    () => () => {
      turn.current++; // la fenêtre se ferme : plus rien ne bouge
    },
    [],
  );

  useEffect(() => {
    const mine = ++turn.current;
    const current = () => turn.current === mine;
    streak(null);
    if (!frame) {
      shown.current = '';
      setPage('');
      setAddress('');
      setTab(null);
      setStage('in');
      setPhase('idle');
      setLoads(0);
      setHalo(null);
      setRipple({ n: 0, gesture: 'click' });
      setCursor((c) => ({ ...c, visible: false, pressed: false }));
      return;
    }
    const play = live.current && paced();
    const began = performance.now();

    /** Fait défiler la page jusqu'à centrer l'élément, à notre rythme : quand l'attente finit, la page est immobile. */
    async function scrollTo(view: Window, el: HTMLElement) {
      const root = (view.document.scrollingElement as HTMLElement | null) ?? view.document.documentElement;
      const box = el.getBoundingClientRect();
      const from = root.scrollTop;
      const to = Math.max(0, Math.min(root.scrollHeight - view.innerHeight, from + box.top + box.height / 2 - view.innerHeight / 2));
      if (Math.abs(to - from) < 1) return;
      root.style.scrollBehavior = 'auto';
      if (play) {
        tween(ms(T.scroll), (t) => (root.scrollTop = from + (to - from) * easeMove(t)), current);
        await sleep(ms(T.scroll));
      }
      if (current()) root.scrollTop = to;
    }

    /** Déplace le curseur le long d'une courbe légère : un poignet ne trace pas de ligne droite. */
    function glide(x1: number, y1: number, duration: number) {
      const { x: x0, y: y0 } = at.current;
      const far = Math.hypot(x1 - x0, y1 - y0);
      if (duration <= 0 || far < 1) return place(x1, y1);
      const bend = Math.min(56, far * 0.16) * (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
      const cx = (x0 + x1) / 2 - ((y1 - y0) / far) * bend;
      const cy = (y0 + y1) / 2 + ((x1 - x0) / far) * bend;
      const point = (t: number) => {
        const s = easeMove(t);
        const r = 1 - s;
        return [r * r * x0 + 2 * r * s * cx + s * s * x1, r * r * y0 + 2 * r * s * cy + s * s * y1];
      };
      tween(duration, (t) => {
        const [x, y] = point(t);
        place(x, y);
        streak(t < 1 ? Array.from({ length: 10 }, (_, i) => point(t - (i * TRAIL) / (9 * duration))) : null);
      }, current);
    }

    /** Amène le curseur sur l'élément, en faisant défiler la page s'il est hors de vue. */
    async function reach(el: HTMLElement, speed: number) {
      const view = iframe.current?.contentWindow;
      if (!view) return;
      let box = el.getBoundingClientRect();
      if (box.top < 24 || box.bottom > view.innerHeight - 24) {
        await scrollTo(view, el);
        if (!current()) return;
        box = el.getBoundingClientRect();
      }
      // un humain ne vise pas le centre exact
      const x = box.left + Math.max(8, Math.min(box.width - 8, box.width * (0.25 + Math.random() * 0.4)));
      const y = box.top + box.height * (0.45 + Math.random() * 0.2);
      const travel = play ? ms(travelTime(Math.hypot(x - at.current.x, y - at.current.y), speed)) : 0;
      // la cible s'annonce pendant que le curseur s'en approche
      if (play) setHalo((h) => ({ n: (h?.n ?? 0) + 1, x: box.left, y: box.top, w: box.width, h: box.height, state: 'aim' }));
      setCursor({ visible: true, pressed: false, flip: x > view.innerWidth - 190 });
      glide(x, y, travel);
      if (play) await sleep(travel);
      if (!current()) return;
      place(x, y);
      streak(null);
    }

    async function press(how: Gesture) {
      if (!play) return;
      setRipple((r) => ({ n: r.n + 1, gesture: how }));
      setHalo((h) => h && { ...h, state: 'hit' });
      setCursor((c) => ({ ...c, pressed: true }));
      await sleep(ms(T.press));
      if (current()) setCursor((c) => ({ ...c, pressed: false }));
    }

    void (async () => {
      const doc = iframe.current?.contentDocument;
      const target = doc && frame.kind !== 'nav' && shown.current === frame.url ? byRef(doc, frame.ref) : null;

      // une saisie qui suit une saisie sur la même page : comme au clavier, Tab passe au champ suivant, le curseur ne bouge pas
      const tabbed = play && !!target && frame.kind === 'fill' && filled.current === frame.url;
      filled.current = target && frame.kind === 'fill' ? frame.url : '';

      if (!doc || !target) {
        // une autre page : l'adresse se tape dans la barre, l'ancienne page s'efface, la nouvelle monte en place
        if (play && frame.kind === 'nav' && (frame.how === 'goto' || frame.how === 'search')) {
          setPhase('typing');
          const text = shortUrl(frame.url);
          for (let i = 2; i < text.length && current(); i += 2) {
            setAddress(text.slice(0, i));
            await sleep((ms(T.address) * 2) / text.length);
          }
        }
        if (!current()) return;
        setAddress(shortUrl(frame.url));
        setPhase(play ? 'loading' : 'idle');
        if (play) setLoads((n) => n + 1);
        if (play && shown.current) {
          setHalo(null);
          setStage('out');
          await sleep(ms(T.fade));
          if (!current()) return;
        }
        shown.current = frame.url;
        arriving.current = { frame, turn: mine, play };
        setHalo(null);
        setStage(play ? 'below' : 'still');
        setTab({ url: frame.url, title: frame.title });
        setPage(frame.html + `<!-- ${frameKey} -->`); // la clé force le rechargement, même si la page est identique
        return;
      }

      // même page : un clic ou une saisie, joués sur place
      setPhase(play ? 'acting' : 'idle');
      setHalo(null);
      const next = new DOMParser().parseFromString(frame.html, 'text/html');
      doc.querySelectorAll('[data-hl]').forEach((el) => el.removeAttribute('data-hl'));
      next.querySelectorAll<HTMLInputElement>('input[data-ref]').forEach((input) => {
        const field = byRef<HTMLInputElement>(doc, input.dataset.ref);
        if (field && input.dataset.ref !== frame.ref) field.value = input.value; // ce qui a déjà été saisi est en place
      });
      if (tabbed) {
        const view = iframe.current?.contentWindow;
        const box = target.getBoundingClientRect();
        if (view && (box.top < 24 || box.bottom > view.innerHeight - 24)) await scrollTo(view, target);
        if (!current()) return;
        await sleep(ms(T.tab));
        if (!current()) return;
        target.setAttribute('data-hl', '1'); // le champ suivant prend le focus
      } else {
        if (play) await sleep(ms(T.hesitate));
        if (!current()) return;
        await reach(target, frame.kind === 'fill' ? T.fillMove : 1);
        if (!current()) return;
        if (play && frame.kind === 'click') await sleep(ms(T.aim)); // le curseur se pose avant de cliquer
        if (!current()) return;
        target.setAttribute('data-hl', '1');
        await press(frame.kind === 'fill' ? 'type' : 'click');
        if (!current()) return;
      }

      if (frame.kind === 'fill') {
        const field = target as HTMLInputElement;
        const value = byRef<HTMLInputElement>(next, frame.ref)?.value ?? '';
        // la saisie finit à l'heure prévue (fillTime) : si la page a défilé longtemps, la frappe accélère
        const typing = play ? Math.min(ms(typingTime(value.length)), began + ms(tabbed ? tabTime(value.length) : fillTime(value.length)) - performance.now()) : 0;
        if (typing >= value.length * 6) {
          field.value = '';
          const start = performance.now();
          let due = 0;
          for (let i = 1; i <= value.length && current(); i++) {
            field.value = value.slice(0, i);
            due += (typing / value.length) * (i === value.length ? 1 : 0.6 + Math.random() * 0.8); // la frappe n'est pas régulière
            await sleep(Math.min(due, typing) - (performance.now() - start));
          }
        }
        if (!current()) return;
        field.value = value;
      }
      setPhase('idle');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une image est jouée une fois, quand sa clé change
  }, [frameKey]);

  useEffect(() => {
    // le paiement part de l'endroit où le curseur vient de cliquer : une onde et un halo à sa couleur
    if (gesture !== 'pay' || !live.current || !paced()) return;
    setRipple((r) => ({ n: r.n + 1, gesture: 'pay' }));
    setHalo((h) => h && { ...h, n: h.n + 1, state: 'pay' });
  }, [gesture]);

  /** La page vient d'arriver : elle apparaît, et le curseur se pose sur l'élément visé s'il y en a un. */
  function onLoad() {
    const arrived = arriving.current;
    arriving.current = null;
    void iframe.current?.offsetHeight; // la position de départ de la page est prise en compte avant qu'elle monte en place
    setStage('in');
    if (arrived?.play) void sleep(ms(T.load)).then(() => turn.current === arrived.turn && setPhase('idle'));
    const doc = iframe.current?.contentDocument;
    const el = doc && arrived ? byRef(doc, arrived.frame.ref) : null;
    if (!el) {
      // le curseur est là dès la première page, posé au milieu, prêt à bouger
      const box = iframe.current?.getBoundingClientRect();
      if (box && !cursor.visible) {
        place(box.width * 0.52, box.height * 0.4);
        setCursor({ visible: true, pressed: false, flip: false });
      }
      return;
    }
    el.scrollIntoView?.({ block: 'center' });
    const box = el.getBoundingClientRect();
    place(box.left + Math.min(box.width / 2, 60), box.top + box.height / 2);
    setCursor({ visible: true, pressed: false, flip: false });
  }

  const site = siteOf(sites, frame?.url);
  const tabSite = siteOf(sites, tab?.url);
  const loading = phase === 'loading';
  const kind = gestureOf(frame, gesture);
  // entre deux gestes, pendant que le run continue, l'agent réfléchit
  const thinking = running && !replaying && phase === 'idle';
  // Les durées des fondus viennent de timing.ts, et la couleur de la boutique du serveur : ce sont, avec la place du
  // curseur et du halo qui dépendent de la page, les seuls styles posés en ligne.
  const tempo = { '--t-out': `${ms(T.fade)}ms`, '--t-in': `${ms(T.load)}ms` } as CSSProperties;
  const tint = (color?: string) => (color ? ({ '--site': color } as CSSProperties) : undefined);

  return (
    <section className="browser" aria-label="Navigateur de l'agent" style={tempo}>
      <div className="browser__tabs">
        <div className="browser__tab">
          {loading ? (
            <span key="loading" className="browser__spinner" aria-hidden="true" />
          ) : tabSite ? (
            <span key={tabSite.key} className="browser__favicon browser__favicon--site" style={tint(tabSite.color)} aria-hidden="true">
              {tabSite.name.charAt(0).toUpperCase()}
            </span>
          ) : (
            <span key={tab ? 'page' : 'new'} className="browser__favicon" aria-hidden="true">
              {tab && /^https:\/\/recherche\./.test(tab.url) ? <Magnifier /> : <Globe />}
            </span>
          )}
          <span key={tab?.title ?? ''} className="browser__tab-title">
            {tab ? tab.title : 'Nouvel onglet'}
          </span>
        </div>
      </div>

      <div className="browser__bar">
        <div className={`browser__address${phase === 'typing' ? ' browser__address--typing' : ''}`}>
          <Lock />
          <span className={`browser__url${frame ? '' : ' browser__url--empty'}`}>{frame ? address : 'Aucune page ouverte'}</span>
        </div>
        {replaying ? (
          <button type="button" className="button" onClick={onLive}>
            Revenir au direct
          </button>
        ) : (
          <span className={`browser__state${running ? ' browser__state--live' : ''}`}>{running ? (finance ? "L'agent analyse" : "L'agent navigue") : frame ? 'Navigation terminée' : 'En attente'}</span>
        )}
        {site && (
          <a className="button" href={site.preview} target="_blank" rel="noopener">
            Visiter ce site
          </a>
        )}
        {loads > 0 && <span key={loads} className="browser__progress" style={tint(site?.color)} aria-hidden="true" />}
      </div>

      {frame ? (
        <>
          <div className="browser__viewport">
            {/* Écran de contrôle : la page ne peut ni exécuter de script, ni envoyer de formulaire, ni naviguer. */}
            {page && (
              <iframe
                className={`browser__page${stage === 'in' ? '' : ' browser__page--hidden'}${stage === 'out' ? ' browser__page--out' : stage === 'below' ? ' browser__page--below' : ''}`}
                ref={iframe} title={frame.title || 'Page ouverte par l’agent'} sandbox="allow-same-origin" srcDoc={page} onLoad={onLoad} />
            )}
            {halo && (
              <div key={halo.n} className={`browser__halo browser__halo--${halo.state}`} aria-hidden="true"
                style={{ left: halo.x, top: halo.y, width: halo.w, height: halo.h }} />
            )}
            <svg className="browser__trail" ref={trail} aria-hidden="true">
              <path />
              <path />
              <path />
            </svg>
            <div className={`browser__cursor${cursor.pressed ? ' browser__cursor--pressed' : ''}${cursor.flip ? ' browser__cursor--flip' : ''}`}
              ref={pointer} hidden={!cursor.visible} aria-hidden="true">
              {ripple.n > 0 && <span key={ripple.n} className={`browser__ripple browser__ripple--${ripple.gesture}`} />}
              <Arrow className="browser__pointer" />
              <span className="browser__cursor-tag">
                {agentName}
                {thinking && <Dots />}
              </span>
            </div>
          </div>
          <div className={`browser__caption browser__caption--${kind}`} aria-live="polite">
            <span key={kind} className="browser__chip" aria-hidden="true">
              {kind === 'pay' ? <Card /> : kind === 'click' ? <Pointer /> : kind === 'type' ? <Pen /> : gesture === 'search' ? <Magnifier /> : <Globe />}
            </span>
            <div key={`${caption}|${why ?? ''}`} className="browser__legend">
              <p className="browser__action">{caption}</p>
              {why && <p className="browser__why">{why}</p>}
            </div>
          </div>
        </>
      ) : (
        <div className="browser__start">
          <span className="browser__start-mark" aria-hidden="true">
            <Arrow className="browser__start-pointer" />
          </span>
          <h2 className="browser__start-title">Commencez une conversation avec un agent</h2>
          <p className="browser__start-text">
            {finance
              ? "En mode Finance, l'agent n'ouvre aucune page : il cherche des placements, lit leur fiche et prépare un ordre. Suivez son raisonnement dans le chat, à droite."
              : "Confiez-lui un achat dans le chat, à droite. Vous le verrez agir ici en direct, geste après geste, pendant qu'il explique ce qu'il fait."}
          </p>
          {running && (
            <p className="browser__start-wait">
              {agentName} {finance ? 'analyse les placements' : 'prépare sa navigation'}
              <Dots />
            </p>
          )}
        </div>
      )}
    </section>
  );
}
