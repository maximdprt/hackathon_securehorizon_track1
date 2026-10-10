import { useCallback, useEffect, useRef, useState } from 'react';
import { loadAgents, saveAgents } from './agents';
import { fetchWorld, streamRun } from './api';
import { AgentBubble } from './components/AgentBubble';
import { AgentEditor } from './components/AgentEditor';
import { AgentRail } from './components/AgentRail';
import { Composer } from './components/Composer';
import { applyEvent, type AgentMessage, type Message } from './run';
import type { Agent, World } from './types';

let counter = 0;
const uid = (prefix: string) => `${prefix}${Date.now()}-${counter++}`;

function Chat({ messages, onRetry }: { messages: Message[]; onRetry: (prompt: string) => void }) {
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // on suit le bas du fil, sauf si l'utilisateur est remonté lire

  useEffect(() => {
    if (stick.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages]);

  return (
    <div
      className="log"
      ref={log}
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {messages.length === 0 && (
        <p className="empty">
          <b>Écris ce que tu veux acheter.</b> L'agent choisi applique ses consignes, compare les 5 boutiques d'Apple Watch du bac à sable, puis te
          répond avec sa décision. Il s'arrête juste avant le paiement : rien n'est envoyé ni payé. Chaque message lance un nouveau run, sans
          mémoire du précédent.
        </p>
      )}
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="me">
            {m.text}
          </div>
        ) : (
          <AgentBubble key={m.id} msg={m} onRetry={onRetry} />
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
      const reply: AgentMessage = { id, role: 'agent', agentName: current.name, model: world.models[model], prompt, status: 'running', live: 'Démarre', steps: [] };
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
      <div className="fatal">
        <h1>Le serveur de la sandbox ne répond pas</h1>
        <p>{loadError}</p>
        <p className="sub">Lance-le depuis la racine du projet : .venv/Scripts/python agents/app.py</p>
      </div>
    );
  }
  if (!world || !current) return <div className="fatal">Chargement…</div>;

  return (
    <div className="app">
      <header className="bar">
        <h1>
          Poste de contrôle <span>· atelier d'agents</span>
        </h1>
        <span className="sub">Tu règles les consignes d'un agent à gauche, tu lui parles à droite. Il s'arrête juste avant de payer.</span>
        {messages.length > 0 && (
          <button type="button" className="btn quiet small" disabled={running} onClick={() => setMessages([])}>
            Nouvelle conversation
          </button>
        )}
      </header>

      <aside className="rail">
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
          <AgentRail
            agents={agents}
            currentId={current.id}
            models={world.models}
            defaultModel={world.default_model}
            onSelect={setCurrentId}
            onNew={() => setEditing('new')}
            onEdit={() => setEditing(current)}
          />
        )}
      </aside>

      <main className="main">
        <Chat messages={messages} onRetry={send} />
        <Composer agentName={current.name} running={running} onSend={send} onStop={() => controller.current?.abort()} />
      </main>
    </div>
  );
}
