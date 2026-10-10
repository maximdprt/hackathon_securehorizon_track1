import { useEffect, useRef, useState } from 'react';
import type { Frame } from '../run';
import type { Site } from '../types';
import { Lock } from './Icons';

type Props = {
  /** L'image à montrer, ou null tant qu'aucun agent n'a navigué. */
  frame: Frame | null;
  sites: Site[];
  /** Ce que l'agent est en train de faire sur cette page, et pourquoi. */
  caption: string;
  why?: string;
  /** Vrai quand on revoit une étape passée au lieu de suivre l'agent. */
  replaying: boolean;
  running: boolean;
  onLive: () => void;
};

const centre = (doc: Document) => doc.querySelector('[data-hl]')?.scrollIntoView({ block: 'center' });

/** La fenêtre de navigation de l'agent : barre d'adresse, page réelle du site, et le geste en cours. */
export function BrowserView({ frame, sites, caption, why, replaying, running, onLive }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const shown = useRef(''); // adresse de la page chargée dans le cadre
  const [page, setPage] = useState('');

  useEffect(() => {
    if (!frame) return;
    const live = iframe.current?.contentDocument;
    if (frame.patch && shown.current === frame.url && live?.querySelector('[data-ref]')) {
      // même page, un champ de plus : on met à jour les champs sur place plutôt que de recharger la page
      const next = new DOMParser().parseFromString(frame.html, 'text/html');
      live.querySelectorAll('[data-hl]').forEach((el) => el.removeAttribute('data-hl'));
      next.querySelectorAll<HTMLInputElement>('input[data-ref]').forEach((input) => {
        const field = live.querySelector<HTMLInputElement>(`input[data-ref="${input.dataset.ref}"]`);
        if (!field) return;
        field.value = input.value;
        if (input.hasAttribute('data-hl')) field.setAttribute('data-hl', '1');
      });
      centre(live);
    } else {
      shown.current = frame.url;
      setPage(frame.html);
    }
  }, [frame]);

  const site = frame ? sites.find((s) => frame.url.includes(`//${s.domain}`)) : undefined;

  return (
    <section className="browser" aria-label="Navigateur de l'agent">
      <div className="browser__bar">
        <div className="browser__address">
          <Lock />
          <span className="browser__url">{frame ? frame.url.replace(/^https:\/\//, '') : 'Nouvel onglet'}</span>
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
          {/* Écran de contrôle : la page ne peut ni exécuter de script, ni envoyer de formulaire, ni naviguer. */}
          <iframe className="browser__page" ref={iframe} title={frame.title || 'Page ouverte par l’agent'} sandbox="allow-same-origin" srcDoc={page}
            onLoad={() => iframe.current?.contentDocument && centre(iframe.current.contentDocument)} />
          <div className="browser__caption" aria-live="polite">
            <p className="browser__action">{caption}</p>
            {why && <p className="browser__why">{why}</p>}
          </div>
        </>
      ) : (
        <div className="browser__start">
          <h2 className="browser__start-title">Le navigateur de l'agent</h2>
          <p className="browser__start-text">
            Donnez une consigne à l'agent : il cherche, ouvre les boutiques, choisit un article, remplit le formulaire et paie. Chaque page qu'il voit
            s'affiche ici, avec l'élément sur lequel il agit.
          </p>
          <p className="browser__start-text">Les cinq boutiques du bac à sable, que vous pouvez aussi visiter vous-même :</p>
          <ul className="browser__tiles">
            {sites.map((s) => (
              <li key={s.key}>
                <a className="browser__tile" href={s.preview} target="_blank" rel="noopener">
                  <span className="browser__tile-name">{s.name}</span>
                  <span className="browser__tile-domain">{s.domain}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
