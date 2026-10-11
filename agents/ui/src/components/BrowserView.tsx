import { useEffect, useRef, useState } from 'react';
import type { Frame } from '../run';
import { ms, paced, sleep, T, typingTime } from '../timing';
import type { Site } from '../types';
import { Lock } from './Icons';

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
  replaying: boolean;
  running: boolean;
  onLive: () => void;
};

const shortUrl = (url: string) => url.replace(/^https:\/\//, '');
const byRef = <E extends HTMLElement>(doc: Document, ref?: string) => (ref ? doc.querySelector<E>(`[data-ref="${ref}"]`) : null);

/** La fenêtre de navigation de l'agent : barre d'adresse, page réelle du site, et un curseur qui joue ses gestes. */
export function BrowserView({ frame, frameKey, animate, agentName, sites, caption, why, replaying, running, onLive }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const shown = useRef(''); // adresse de la page chargée dans le cadre
  const turn = useRef(0); // un geste en cours est abandonné dès qu'un autre commence
  const arriving = useRef<Frame | null>(null); // la page en cours de chargement
  const live = useRef(animate);
  live.current = animate;
  const [page, setPage] = useState('');
  const [address, setAddress] = useState('');
  const [hidden, setHidden] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false, travel: 0, pressed: false });

  useEffect(() => {
    const mine = ++turn.current;
    const current = () => turn.current === mine;
    if (!frame) {
      shown.current = '';
      setPage('');
      setAddress('');
      setCursor((c) => ({ ...c, visible: false }));
      return;
    }
    const play = live.current && paced();

    /** Amène le curseur sur l'élément, en faisant défiler la page s'il est hors de vue. */
    async function reach(el: HTMLElement, speed: number) {
      const view = iframe.current?.contentWindow;
      if (!view) return;
      let box = el.getBoundingClientRect();
      if (box.top < 24 || box.bottom > view.innerHeight - 24) {
        el.scrollIntoView({ block: 'center', behavior: play ? 'smooth' : 'auto' });
        if (play) await sleep(ms(T.scroll));
        if (!current()) return;
        box = el.getBoundingClientRect();
      }
      // un humain ne vise pas le centre exact
      const x = box.left + Math.max(8, Math.min(box.width - 8, box.width * (0.25 + Math.random() * 0.4)));
      const y = box.top + box.height * (0.45 + Math.random() * 0.2);
      const travel = play ? ms(T.move * speed) : 0;
      setCursor({ x, y, visible: true, travel, pressed: false });
      if (play) await sleep(travel);
    }

    async function press() {
      if (!play) return;
      setCursor((c) => ({ ...c, pressed: true }));
      await sleep(ms(T.press));
      if (current()) setCursor((c) => ({ ...c, pressed: false }));
    }

    void (async () => {
      const doc = iframe.current?.contentDocument;
      const target = doc && frame.kind !== 'nav' && shown.current === frame.url ? byRef(doc, frame.ref) : null;

      if (!doc || !target) {
        // une autre page : l'adresse se tape dans la barre, l'ancienne page s'efface, la nouvelle apparaît
        if (play && frame.kind === 'nav' && (frame.how === 'goto' || frame.how === 'search')) {
          const text = shortUrl(frame.url);
          for (let i = 2; i < text.length && current(); i += 2) {
            setAddress(text.slice(0, i));
            await sleep((ms(T.address) * 2) / text.length);
          }
        }
        if (!current()) return;
        setAddress(shortUrl(frame.url));
        if (play && shown.current) {
          setHidden(true);
          await sleep(ms(T.fade));
          if (!current()) return;
        }
        shown.current = frame.url;
        arriving.current = frame;
        setHidden(true);
        setPage(frame.html + `<!-- ${frameKey} -->`); // la clé force le rechargement, même si la page est identique
        return;
      }

      // même page : un clic ou une saisie, joués sur place
      const next = new DOMParser().parseFromString(frame.html, 'text/html');
      doc.querySelectorAll('[data-hl]').forEach((el) => el.removeAttribute('data-hl'));
      next.querySelectorAll<HTMLInputElement>('input[data-ref]').forEach((input) => {
        const field = byRef<HTMLInputElement>(doc, input.dataset.ref);
        if (field && input.dataset.ref !== frame.ref) field.value = input.value; // ce qui a déjà été saisi est en place
      });
      if (play) await sleep(ms(T.hesitate));
      if (!current()) return;
      await reach(target, frame.kind === 'fill' ? 0.7 : 1);
      if (!current()) return;
      target.setAttribute('data-hl', '1');
      await press();
      if (frame.kind !== 'fill' || !current()) return;

      const field = target as HTMLInputElement;
      const value = byRef<HTMLInputElement>(next, frame.ref)?.value ?? '';
      if (!play) {
        field.value = value;
        return;
      }
      field.value = '';
      const perKey = value.length ? ms(typingTime(value.length)) / value.length : 0;
      for (let i = 1; i <= value.length && current(); i++) {
        field.value = value.slice(0, i);
        await sleep(perKey * (0.6 + Math.random() * 0.8)); // la frappe n'est pas régulière
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une image est jouée une fois, quand sa clé change
  }, [frameKey]);

  /** La page vient d'arriver : elle apparaît, et le curseur se pose sur l'élément visé s'il y en a un. */
  function onLoad() {
    setHidden(false);
    const arrived = arriving.current;
    arriving.current = null;
    const doc = iframe.current?.contentDocument;
    const el = doc && arrived ? byRef(doc, arrived.ref) : null;
    if (!el) {
      // le curseur est là dès la première page, posé au milieu, prêt à bouger
      const box = iframe.current?.getBoundingClientRect();
      if (box) setCursor((c) => (c.visible ? c : { x: box.width * 0.52, y: box.height * 0.4, visible: true, travel: 0, pressed: false }));
      return;
    }
    el.scrollIntoView({ block: 'center' });
    const box = el.getBoundingClientRect();
    setCursor({ x: box.left + Math.min(box.width / 2, 60), y: box.top + box.height / 2, visible: true, travel: 0, pressed: false });
  }

  const site = frame ? sites.find((s) => frame.url.includes(`//${s.domain}`)) : undefined;

  return (
    <section className="browser" aria-label="Navigateur de l'agent">
      <div className="browser__bar">
        <div className="browser__address">
          <Lock />
          <span className="browser__url">{frame ? address : 'Nouvel onglet'}</span>
        </div>
        {replaying ? (
          <button type="button" className="button" onClick={onLive}>
            Revenir au direct
          </button>
        ) : (
          <span className={`browser__state${running ? ' browser__state--live' : ''}`}>{running ? "L'agent navigue" : frame ? 'Navigation terminée' : 'En attente'}</span>
        )}
        {site && (
          <a className="button" href={site.preview} target="_blank" rel="noopener">
            Visiter ce site
          </a>
        )}
      </div>

      {frame ? (
        <>
          <div className="browser__viewport">
            {/* Écran de contrôle : la page ne peut ni exécuter de script, ni envoyer de formulaire, ni naviguer. */}
            <iframe className={`browser__page${hidden ? ' browser__page--hidden' : ''}`} ref={iframe} title={frame.title || 'Page ouverte par l’agent'}
              sandbox="allow-same-origin" srcDoc={page} onLoad={onLoad} />
            {/* La position du curseur dépend de la page : seul cas où le style est posé en ligne. */}
            <div className={`browser__cursor${cursor.pressed ? ' browser__cursor--pressed' : ''}`} hidden={!cursor.visible} aria-hidden="true"
              style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, transitionDuration: `${cursor.travel}ms` }}>
              <svg className="browser__pointer" viewBox="0 0 22 22">
                <path d="M4 2.5v15.2l4.2-3.7 2.8 6.3 2.5-1.1-2.8-6.2h5.6z" fill="currentColor" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              <span className="browser__cursor-tag">{agentName}</span>
              {cursor.pressed && <span className="browser__ripple" />}
            </div>
          </div>
          <div className="browser__caption" aria-live="polite">
            <p className="browser__action">{caption}</p>
            {why && <p className="browser__why">{why}</p>}
          </div>
        </>
      ) : (
        <div className="browser__start">
          <h2 className="browser__start-title">Commencez une conversation avec un agent</h2>
          <p className="browser__start-text">
            Confiez-lui un achat dans le chat, à droite. Vous le verrez agir ici en direct, geste après geste, pendant qu'il explique ce qu'il fait.
          </p>
        </div>
      )}
    </section>
  );
}
