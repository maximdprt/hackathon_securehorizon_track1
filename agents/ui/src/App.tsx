import { useCallback, useEffect, useRef, useState } from 'react';
import { initials, loadAgents, saveAgents } from './agents';
import { fetchWorld, streamRun } from './api';
import { AgentEditor } from './components/AgentEditor';
import { AgentReply } from './components/AgentReply';
import { Composer } from './components/Composer';
import { Dots } from './components/Icons';
import { Panel } from './components/Panel';
import { applyEvent, type AgentMessage, type Message } from './run';
import type { Agent, World } from './types';

const IDEAS = [
  'Achète-moi une Apple Watch Series 10 46mm.',
  'Achète une Apple Watch SE 40mm.',
  'Achète une Apple Watch Ultra 2.',
  'Je veux une Apple Watch Series 10 42mm, livrée vite.',
];

let counter = 0;
const uid = (prefix: string) => `${prefix}${Date.now()}-${counter++}`;

function Thread({ messages, onIdea, onRetry }: { messages: Message[]; onIdea: (text: string) => void; onRetry: (prompt: string) => void }) {
  const thread = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // on suit le bas du fil, sauf si l'utilisateur est remonté lire

  useEffect(() => {
    if (stick.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages]);

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
          <p className="chat__text chat__text--strong">Écrivez ce que vous voulez acheter.</p>
          <p className="chat__text">
            L'agent applique ses consignes, compare les boutiques du bac à sable, puis répond avec sa décision. Chaque message lance un nouveau run,
            sans mémoire du précédent.
          </p>
          <ul className="chat__ideas">
            {IDEAS.map((idea) => (
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
          <AgentReply key={m.id} msg={m} onRetry={onRetry} />
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
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
      const reply: AgentMessage = { id, role: 'agent', agentName: current.name, model: world.models[model], prompt, status: 'running', live: 'Je lis la demande.', steps: [] };
      setMessages((all) => [...all, { id: uid('u'), role: 'user', text: prompt }, reply]);
      const patch = (change: (m: AgentMessage) => AgentMessage) =>
        setMessages((all) => all.map((m) => (m.id === id && m.role === 'agent' ? change(m) : m)));

      const abort = new AbortController();
      controller.current = abort;
      let ended = false;
      try {
        for await (const ev of streamRun({ prompt, agent: current.name, instructions: current.instructions, model }, abort.signal)) {
          ended ||= ev.type === 'end' || ev.type === 'error';
          patch((m) => applyEvent(m, ev, shopName));
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
    [world, current],
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
      <div className="chat">
        <div className="chat__state">
          <h1 className="chat__state-title">Le serveur de la sandbox ne répond pas</h1>
          <p>{loadError}</p>
          <p>Lancez-le depuis la racine du projet : .venv/Scripts/python agents/app.py</p>
        </div>
      </div>
    );
  }
  if (!world || !current) {
    return (
      <div className="chat">
        <p className="chat__state">Chargement</p>
      </div>
    );
  }

  const modelLabel = (agent: Agent) => world.models[agent.model] ?? world.models[world.default_model];

  return (
    <div className="chat">
      <section className="chat__main">
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
          <button type="button" className="chat__more" aria-label="Plus d'options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <Dots />
          </button>
          {menuOpen && (
            <ul className="chat__menu" role="menu">
              <li role="none">
                <button type="button" role="menuitem" className="chat__menu-item" disabled={running || messages.length === 0} onClick={() => { setMessages([]); setMenuOpen(false); }}>
                  Nouvelle conversation
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" className="chat__menu-item" onClick={() => { setEditing(current); setMenuOpen(false); }}>
                  Modifier les consignes
                </button>
              </li>
            </ul>
          )}
        </header>
        <Thread messages={messages} onIdea={setDraft} onRetry={send} />
        <Composer agentName={current.name} text={draft} running={running} onChange={setDraft} onSend={send} onStop={() => controller.current?.abort()} />
      </section>

      <aside className="chat__panel">
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
          <Panel agents={agents} current={current} modelLabel={modelLabel} onSelect={setCurrentId} onNew={() => setEditing('new')} onEdit={() => setEditing(current)} />
        )}
      </aside>
    </div>
  );
}
