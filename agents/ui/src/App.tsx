import { useCallback, useEffect, useRef, useState } from 'react';
import { initials, loadAgents, saveAgents } from './agents';
import { fetchWorld, streamRun } from './api';
import { AgentEditor } from './components/AgentEditor';
import { AgentReply } from './components/AgentReply';
import { BrowserView } from './components/BrowserView';
import { Composer } from './components/Composer';
import { Panel } from './components/Panel';
import { applyEvent, type AgentMessage, type Message } from './run';
import { durationOf, sleep, spoken } from './timing';
import type { Agent, Mode, World } from './types';

const IDEAS: Record<Mode, string[]> = {
  shop: ['Achète-moi une Apple Watch Series 10 46 mm.', 'Achète une Apple Watch SE 40 mm.', 'Achète une Apple Watch Ultra 2.', 'Je veux une Apple Watch Series 10 42 mm, livrée vite.'],
  finance: ['Place 150 USDC sur le coffre de rendement le plus intéressant.', 'Trouve le meilleur rendement en USDC et investis 100 USDC.', 'Paie mon loyer de 200 USDC.'],
};
const EMPTY: Record<Mode, { title: string; text: string }> = {
  shop: {
    title: 'Écrivez ce que vous voulez acheter.',
    text: "L'agent applique ses consignes et fait l'achat de bout en bout. Chaque geste s'affiche ici, et un clic sur un geste montre la page à ce moment-là. Chaque message lance un nouveau run, sans mémoire du précédent.",
  },
  finance: {
    title: 'Écrivez ce que vous voulez placer ou payer.',
    text: "L'agent cherche des placements, lit leur fiche, choisit et prépare l'ordre. Chaque étape s'écrit ici. Chaque message lance un nouveau run, sans mémoire du précédent.",
  },
};

let counter = 0;
const uid = (prefix: string) => `${prefix}${Date.now()}-${counter++}`;

type ThreadProps = {
  messages: Message[];
  mode: Mode;
  shown: { id: string; frame: number } | null;
  onIdea: (text: string) => void;
  onSelect: (id: string, frame: number) => void;
  onRetry: (prompt: string) => void;
};

function Thread({ messages, mode, shown, onIdea, onSelect, onRetry }: ThreadProps) {
  const thread = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // on suit le bas du fil, sauf si l'utilisateur est remonté lire

  useEffect(() => {
    if (stick.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    // le texte qui s'écrit allonge le fil sans changer les messages : on suit aussi ces changements
    const el = thread.current;
    if (!el) return;
    const follow = new MutationObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    follow.observe(el, { childList: true, subtree: true, characterData: true });
    return () => follow.disconnect();
  }, []);

  return (
    <div
      className="chat__thread"
      ref={thread}
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {messages.length === 0 && (
        <div className="chat__empty">
          <p className="chat__text chat__text--strong">{EMPTY[mode].title}</p>
          <p className="chat__text">{EMPTY[mode].text}</p>
          <ul className="chat__ideas">
            {IDEAS[mode].map((idea) => (
              <li key={idea}>
                <button type="button" className="chat__idea" onClick={() => onIdea(idea)}>
                  {idea}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="chat__msg--user">
            {m.text}
          </div>
        ) : (
          <AgentReply key={m.id} msg={m} shownFrame={shown?.id === m.id ? shown.frame : null} onSelect={(frame) => onSelect(m.id, frame)} onRetry={onRetry} />
        ),
      )}
    </div>
  );
}

export default function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [loadError, setLoadError] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  const [tab, setTab] = useState<'chat' | 'agents'>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  // lien direct : /?mode=finance ouvre l'interface sur l'agent finance
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(window.location.search).get('mode') === 'finance' ? 'finance' : 'shop'));
  /** L'étape passée que l'on revoit dans le navigateur. null : on suit l'agent en direct. */
  const [pin, setPin] = useState<{ id: string; frame: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchWorld()
      .then((w) => {
        if (!alive) return;
        const saved = loadAgents(w.default_model);
        setWorld(w);
        setAgents(saved.agents);
        setCurrentId(saved.currentId);
      })
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (agents.length) saveAgents(agents, currentId);
  }, [agents, currentId]);

  const current = agents.find((a) => a.id === currentId) ?? agents[0];
  const running = messages.some((m) => m.role === 'agent' && m.status === 'running');

  const send = useCallback(
    async (prompt: string) => {
      if (!world || !current || controller.current) return;
      const model = world.models[current.model] ? current.model : world.default_model;
      const shopName = (key: string | null) => world.sites.find((s) => s.key === key)?.name;
      const id = uid('a');
      const reply: AgentMessage = { id, role: 'agent', agentName: current.name, model: world.models[model], mode, prompt, status: 'running', steps: [], frames: [] };
      setTab('chat');
      setPin(null);
      setMessages((all) => [...all, { id: uid('u'), role: 'user', text: prompt }, reply]);
      const patch = (change: (m: AgentMessage) => AgentMessage) =>
        setMessages((all) => all.map((m) => (m.id === id && m.role === 'agent' ? change(m) : m)));

      const abort = new AbortController();
      controller.current = abort;
      let ended = false;
      let said = ''; // la dernière explication écrite dans le fil
      try {
        for await (const ev of streamRun({ prompt, agent: current.name, instructions: current.instructions, model, mode }, abort.signal)) {
          ended ||= ev.type === 'end' || ev.type === 'error';
          patch((m) => applyEvent(m, ev, shopName));
          const narrated = spoken(ev) !== '' && spoken(ev) !== said;
          if (narrated) said = spoken(ev);
          await sleep(durationOf(ev, narrated), abort.signal); // le geste se joue et son explication s'écrit, avant le suivant
        }
        if (!ended) patch((m) => ({ ...m, status: 'error', error: 'Le serveur a coupé la réponse avant la fin du run.' }));
      } catch (err) {
        patch((m) => {
          if (m.status !== 'running') return m;
          if (abort.signal.aborted) return { ...m, status: 'stopped' };
          return { ...m, status: 'error', error: err instanceof Error ? err.message : String(err) };
        });
      } finally {
        controller.current = null;
      }
    },
    [world, current, mode],
  );

  useEffect(() => {
    // lien direct : /?ask=... lance la demande à l'ouverture
    if (!world || !current || asked.current) return;
    asked.current = true;
    const ask = new URLSearchParams(window.location.search).get('ask');
    if (ask) void send(ask);
  }, [world, current, send]);

  function saveAgent(data: Omit<Agent, 'id'>) {
    if (editing === 'new') {
      const created = { id: uid('agent'), ...data };
      setAgents((all) => [...all, created]);
      setCurrentId(created.id);
    } else if (editing) {
      setAgents((all) => all.map((a) => (a.id === editing.id ? { ...a, ...data } : a)));
    }
    setEditing(null);
  }

  function deleteAgent() {
    if (editing === 'new' || !editing) return;
    const rest = agents.filter((a) => a.id !== editing.id);
    setAgents(rest);
    if (currentId === editing.id) setCurrentId(rest[0].id);
    setEditing(null);
  }

  if (loadError) {
    return (
      <div className="agentic">
        <div className="agentic__state">
          <h1 className="agentic__state-title">Le serveur de la sandbox ne répond pas</h1>
          <p>{loadError}</p>
          <p>Lancez-le depuis la racine du projet : .venv/Scripts/python agents/app.py</p>
        </div>
      </div>
    );
  }
  if (!world || !current) {
    return (
      <div className="agentic">
        <p className="agentic__state">Chargement</p>
      </div>
    );
  }

  const modelLabel = (agent: Agent) => world.models[agent.model] ?? world.models[world.default_model];
  // Ce que montre le navigateur : l'étape que l'on revoit, sinon la dernière page du run le plus récent.
  const runs = messages.filter((m): m is AgentMessage => m.role === 'agent');
  const latest = runs[runs.length - 1];
  const source = pin ? runs.find((m) => m.id === pin.id) : latest;
  const frame = source ? (pin ? source.frames[pin.frame] : source.frames[source.frames.length - 1]) ?? null : null;
  const step = source && frame ? [...source.steps].reverse().find((s) => s.frame === frame.id) : undefined;
  const shown = source && frame ? { id: source.id, frame: frame.id } : null;

  return (
    <div className="agentic">
      <BrowserView
        frame={frame}
        frameKey={shown ? `${shown.id}:${shown.frame}:${pin ? 'replay' : 'live'}` : ''}
        animate={pin === null}
        agentName={source?.agentName ?? current.name}
        sites={world.sites}
        caption={step?.label ?? (frame ? frame.title : '')}
        why={step?.why}
        gesture={!pin && source?.steps[source.steps.length - 1]?.kind === 'pay' ? 'pay' : step?.kind}
        replaying={pin !== null}
        running={running && pin === null}
        finance={(source?.mode ?? mode) === 'finance'}
        onLive={() => setPin(null)}
      />

      <aside className="agentic__side">
        <header className="chat__header">
          <span className="chat__avatar" aria-hidden="true">
            {initials(current.name).slice(0, 1)}
          </span>
          <div className="chat__identity">
            <h1 className="chat__name">{current.name}</h1>
            <p className="chat__presence">
              <span className="chat__presence-dot" aria-hidden="true" />
              {running ? 'Au travail' : 'Disponible'} · {modelLabel(current)}
            </p>
          </div>
          {messages.length > 0 && (
            <button type="button" className="chat__clear" disabled={running} onClick={() => { setMessages([]); setPin(null); }}>
              Nouvelle conversation
            </button>
          )}
        </header>
        <div className="chat__tabs" role="tablist" aria-label="Panneau de l'assistant">
          <button type="button" role="tab" className="chat__tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
            Conversation
          </button>
          <button type="button" role="tab" className="chat__tab" aria-selected={tab === 'agents'} onClick={() => setTab('agents')}>
            Agents et consignes
          </button>
        </div>

        {tab === 'chat' ? (
          <>
            <div className="chat__mode" role="group" aria-label="Type de tâche">
              {(['shop', 'finance'] as const).map((m) => (
                <button key={m} type="button" className="chat__mode-btn" aria-pressed={mode === m} disabled={running} onClick={() => setMode(m)}>
                  {m === 'shop' ? 'Boutiques' : 'Finance'}
                </button>
              ))}
            </div>
            <Thread messages={messages} mode={mode} shown={shown} onIdea={setDraft} onSelect={(id, f) => setPin({ id, frame: f })} onRetry={send} />
            <Composer agentName={current.name} text={draft} running={running} onChange={setDraft} onSend={send} onStop={() => controller.current?.abort()} />
          </>
        ) : (
          <div className="chat__panel">
            {editing ? (
              <AgentEditor
                key={editing === 'new' ? 'new' : editing.id}
                agent={editing === 'new' ? null : editing}
                models={world.models}
                defaultModel={world.default_model}
                canDelete={agents.length > 1}
                onSave={saveAgent}
                onCancel={() => setEditing(null)}
                onDelete={deleteAgent}
              />
            ) : (
              <Panel agents={agents} current={current} profile={world.profile} modelLabel={modelLabel} onSelect={setCurrentId}
                onNew={() => setEditing('new')} onEdit={() => setEditing(current)} />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
