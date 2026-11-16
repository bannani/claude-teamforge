// Conversation manager: one running turn per project. Saves the transcript,
// streams chat events to the dashboard, and restarts the agent when the client
// answers a gate or allows a program.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, delimiter, dirname, join, relative, sep } from 'node:path';
import { ISOLATED_ENV, buildArgs, isProgramName, runCopilot } from '../providers/copilot.mjs';
import { isWriteOpen } from '../state-machine.mjs';
import { SPIKE_REMINDER, coordinatorPrompt, spikePrompt } from './prompt.mjs';
import { ANYTIME, helpText, isCommand, parseCommand } from './commands.mjs';
import { requireProjectDir } from '../docs.mjs';
import { decodeImages, storeImages } from '../attachments.mjs';
import { ROLE_CATALOG } from '../roles.mjs';
import { agentName, isModelName, syncAgentFiles } from './team.mjs';
import { saveSpikeReport } from './spike-report.mjs';
import { BROWSER_AGENT, BROWSER_MODEL, needsHeadless, newScreenshots, parseSite, writeBrowserAgent, writeBrowserConfig } from './browser.mjs';

export class ChatError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const WRITE_TOOLS = /^(create|edit|write|str_replace|apply_patch)/;

const ROLE = Object.fromEntries(ROLE_CATALOG.map((r) => [r.id, r]));

export function createChat({
  db, broadcast, emit, provider, run = runCopilot, binDir, baseUrl, token = '', attachDir,
  extensionConnected = () => true, // is the TeamForge Chrome extension polling the worker?
  otherMcp = async () => [],       // the user's own MCP servers, switched off for the team's turns
}) {
  const turns = new Map(); // project path → { abort, queue }

  const edited = new Map(); // project path → documents the client edited since the agent's last turn
  const requireProject = (project) => requireProjectDir(project, ChatError);
  const allowAll = (project) => db.getSetting(project, 'allow_all') === '1';
  // build: the company works on a mission. spike: read-only questions about the code.
  // Each TeamForge tab in the browser has its own session and its own mode. A console
  // command runs synchronously, so the tab it came from is kept here while it runs;
  // a turn lasts, so it carries its tab along explicitly.
  let cmdTab = '';
  const active = (project, tab = cmdTab) => db.getActiveSession(project, tab);
  const modeOf = (project, tab = cmdTab) => db.modeOf(project, tab);
  // The sites the client opened to the team's browser with /browser; none = no browser.
  const sitesOf = (project) => (db.getSetting(project, 'browser') || '').split(' ').filter(Boolean);
  // own: the client's own Chrome, through the TeamForge extension. separate: a window of TeamForge's own.
  const browserKind = (project) => (db.getSetting(project, 'browser_kind') === 'separate' ? 'separate' : 'own');
  // the model that reads the screen: the browser operator's
  const browserModel = (project) => db.getSetting(project, 'browser_model') || BROWSER_MODEL;
  const modelFor = (project) => db.getSetting(project, 'model') || provider().model || null;
  // The company's model, and the employees who have one of their own.
  const modelsOf = (project) => ({ default: modelFor(project), roles: db.listSettings(project, 'model:') });
  function setModel(project, role, model) {
    requireProject(project);
    if (role !== null && role !== 'ceo' && !ROLE[role]) throw new ChatError(400, `unknown employee: ${role}`);
    if (model !== null && !isModelName(model)) throw new ChatError(400, 'that does not look like a model name');
    // the CEO is the main agent: their model is the company's
    db.setSetting(project, role && role !== 'ceo' ? `model:${role}` : 'model', model);
    emit(project, { type: 'models', models: modelsOf(project) });
    return modelsOf(project);
  }

  // A line from TeamForge itself (command replies, notices): shown in the
  // console, kept in the transcript when a mission is open, never sent to the agent.
  function say(project, text, command = null, tab = cmdTab) {
    const session = active(project, tab);
    if (session) db.addMessage(session.id, 'system', { text, command });
    emit(project, { type: 'system', text, command }, tab);
  }
  const sendPermissions = (project) => emit(project, {
    type: 'permissions', grants: db.listGrants(project), allowAll: allowAll(project), browser: sitesOf(project), browserKind: browserKind(project),
  });

  function sessionFor(project, text, tab) {
    const open = active(project, tab);
    if (open) return open;
    const title = text.replace(/\s+/g, ' ').trim().slice(0, 80);
    const session = db.createSession({
      project_path: project, project_name: basename(project), title, tab, kind: modeOf(project, tab) === 'spike' ? 'spike' : 'mission',
    });
    db.addEvent(session.id, 'phase', { phase: 'idea', title, kind: session.kind });
    return session;
  }

  async function runTurn(project, text, decoded = [], tab = '') {
    const tell = (event) => emit(project, event, tab); // to the tab this turn belongs to
    const { provider: name } = provider();
    const model = modelFor(project);
    let session = sessionFor(project, text, tab);
    const images = storeImages(attachDir, session.id, decoded);
    const shown = images.map(({ file, name: label }) => ({ file, name: label }));
    db.addMessage(session.id, 'user', shown.length ? { text, images: shown } : { text });
    db.addEvent(session.id, 'prompt', { text: text.slice(0, 300) });
    tell({ type: 'user', text, images: shown });

    // A spike touches nothing in the project: no agent files, no docs/ folder.
    const spike = session.kind === 'spike';

    // Employees with their own model become real sub-agents for this turn.
    let staffed = [];
    if (!spike) {
      try { staffed = syncAgentFiles(project, modelsOf(project).roles); } catch { /* read-only project: everyone shares the company's model */ }
    }
    const team = staffed.length
      ? `\n\n[These employees run on their own model. Hand their work to their agent with the task tool (agent_type), one task at a time, then report what they answered: ${staffed.map((id) => `${ROLE[id].title} = ${agentName(id)}`).join(', ')}. Do everything else yourself in the right role.]`
      : '';

    const first = !session.agent_session;
    if (first) session = db.setAgentSession(session.id, randomUUID());
    // After /clear the agent starts from a blank memory in the middle of a mission.
    const standing = session.phase === 'idea' ? '' : `# Where the mission stands
This mission is already under way (phase: ${session.phase}). Before acting, run \`teamforge state\` and read the documents under docs/ that exist. Do not start again from brainstorm.

`;
    const docs = [...(edited.get(project) || [])];
    edited.delete(project);
    const notice = docs.length
      ? `\n\n[The client edited ${docs.join(', ')} in the browser. Re-read ${docs.length > 1 ? 'them' : 'it'} before continuing: the client's version is the reference.]`
      : '';
    const seen = images.length ? `\n\n[The client attached ${images.length} image${images.length > 1 ? 's' : ''} to this message.]` : '';
    const sites = sitesOf(project);
    const own = browserKind(project) === 'own';
    const dataDir = join(dirname(attachDir), 'browser', createHash('sha1').update(project).digest('hex').slice(0, 12));
    const browser = sites.length ? {
      kind: own ? 'own' : 'separate',
      origins: sites,
      profileDir: join(dataDir, 'profile'), // separate browser: one profile per project, so a sign-in survives
      outputDir: join(attachDir, String(session.id)), // where the console fetches screenshots from
      headless: needsHeadless(),
      url: baseUrl(), token, project, // the TeamForge extension is reached through the worker
    } : null;
    const operator = `Do not call the browser tools yourself: hand each browser task to the \`${BROWSER_AGENT}\` agent with the task tool (agent_type ${BROWSER_AGENT}), saying exactly what to open, what to do and what to report. It reads the screen on a lighter model and tells you what it saw; ask it again if you need more.`;
    const where = own ? 'the client\'s own Chrome — a TeamForge tab among theirs, with their sign-ins' : 'a browser window of your own';
    const browsing = !browser ? '' : spike
      ? `\n\n[You can use ${where}, on ${sites.join(', ')} (the \`browser\` tools). Look at the running product to confirm what the code says. Observe only — never submit, save or delete anything in it. ${operator} Stay on these sites: opening another one ends your turn.]`
      : `\n\n[You can use ${where}, on ${sites.join(', ')} (the \`browser\` tools: navigate, snapshot, click, type, screenshot). Use it to see and test the running product: QA checks the acceptance criteria in it, the Designer checks the screens. Say in one line what you are about to do before acting in it. ${operator} The client sees its screenshots in the console. Stay on these sites: opening another one ends your turn.]`;
    const prompt = spike
      ? (first ? `${spikePrompt({ project })}\n# The client's question\n\n${text}${seen}${browsing}` : `${text}${seen}${browsing}\n\n${SPIKE_REMINDER}`)
      : first
      ? `${coordinatorPrompt({ project, decisions: db.approvedDecisions(project, 15) })}\n${standing}# The client's request\n\n${text}${seen}${notice}${team}${browsing}`
      : `${text}${seen}${notice}${team}${browsing}\n\n(Current workflow phase: ${session.phase}.)`;

    // Permissions are fixed for the whole turn. Once the client has approved the
    // plan, this turn is the one that enters implementation, so writes open now.
    const writeOpen = !spike && (isWriteOpen(session.phase)
      || (session.phase === 'plan_gate' && db.hasApprovedValidation(session.id, 'plan_gate')));

    // In a spike the agent has no reporting command: the worker seats the two
    // employees who answer, and sends them back when the turn ends.
    const desk = spike ? [['architect', 'reading the code'], ['analyst', 'explaining it in business terms']] : [];
    const seat = (status) => {
      for (const [role, note] of desk) {
        db.upsertAgent(session.id, role, status, status === 'working' ? note : '');
        db.addEvent(session.id, 'agent', { role, status, note: status === 'working' ? note : '' });
      }
    };
    seat('working');
    let strayed = null; // a site the team tried to open without the client's leave
    const started = new Map(); // tool call → when it started, to find the screenshot it produced
    const shots = new Set();

    const turn = turns.get(project);
    tell({ type: 'turn_start', provider: name });
    broadcast();
    let status = 'end';
    const fail = (message) => {
      status = 'error';
      db.addMessage(session.id, 'error', { text: message });
      tell({ type: 'error', text: message });
    };
    try {
      if (!spike) mkdirSync(join(project, 'docs'), { recursive: true }); // in a mission the agent may always write docs/
      let browserArg = null;
      const agentDirs = [];
      if (browser) {
        mkdirSync(browser.profileDir, { recursive: true });
        mkdirSync(browser.outputDir, { recursive: true });
        browserArg = writeBrowserConfig(join(dataDir, 'mcp.json'), browser);
        agentDirs.push(writeBrowserAgent(join(dataDir, 'agents-home'), { model: browserModel(project), sites, observeOnly: spike }));
      }
      const { exitCode, stderr } = await run({
        args: buildArgs({
          prompt, sessionId: session.agent_session, model, readOnly: spike,
          writeOpen, grants: db.listGrants(project), allowAll: allowAll(project),
          attachments: images.map((i) => i.path), browser: browserArg, agentDirs,
          otherMcp: await otherMcp().catch(() => []),
        }),
        cwd: project,
        env: {
          ...process.env,
          ...ISOLATED_ENV,
          PATH: `${binDir}${delimiter}${process.env.PATH || ''}`,
          TEAMFORGE_URL: baseUrl(), TEAMFORGE_TOKEN: token, TEAMFORGE_PROJECT: project, TEAMFORGE_TAB: tab,
        },
        signal: turn.abort.signal,
        onEvent(raw) {
          // Show paths the way the client thinks of them: relative to the project.
          let event = raw.summary ? { ...raw, summary: raw.summary.replaceAll(`${project}${sep}`, '') } : raw;
          // On messages and tools, the provider's `role` is the employee speaking. Stored
          // and sent as `agent`: `role` already means user / assistant / tool in the transcript.
          if (['message', 'tool_start', 'tool_end'].includes(event.type)) {
            const { role: who, ...rest } = event;
            event = who ? { ...rest, agent: who } : rest;
          }
          if (event.type === 'agent_error') {
            db.addMessage(session.id, 'error', { text: event.text });
            tell({ type: 'error', text: event.text });
            return;
          }
          if (event.type === 'tool_start') started.set(event.id, Date.now());
          // The team is held to the sites the client allowed: sending the browser
          // anywhere else ends the turn. (The request may already have left: this
          // stops what would follow, it does not un-send it.)
          if (event.type === 'tool_start' && browser && event.url) {
            const { url, ...shown } = event;
            event = shown;
            const target = parseSite(url)?.origin;
            if (!target || !sites.includes(target)) {
              strayed = target || url.slice(0, 80);
              turn.queue.length = 0;
              turn.abort.abort();
            }
          }
          // a screenshot the browser saved is shown under its tool line
          if (event.type === 'tool_end' && browser && event.ok && /screenshot/i.test(event.name)) {
            const files = newScreenshots(browser.outputDir, started.get(event.id) ?? 0, shots);
            if (files.length) event = { ...event, images: files.map((f) => ({ file: `${session.id}/${f}`, name: f })) };
          }
          if (event.type === 'message') db.addMessage(session.id, 'assistant', event.agent ? { text: event.text, agent: event.agent } : { text: event.text });
          // a sub-agent starting or finishing is that employee sitting down or getting up
          if (event.type === 'agent_start') {
            db.upsertAgent(session.id, event.role, 'working', event.task);
            db.addEvent(session.id, 'agent', { role: event.role, status: 'working', note: event.model ? `${event.task} (${event.model})` : event.task });
            broadcast();
          }
          if (event.type === 'agent_end') {
            const why = event.ok ? '' : `could not run${event.model ? ` on ${event.model}` : ''}`;
            db.upsertAgent(session.id, event.role, event.ok ? 'idle' : 'blocked', why);
            db.addEvent(session.id, 'agent', { role: event.role, status: event.ok ? 'idle' : 'blocked', note: why });
            if (!event.ok) {
              const line = `${ROLE[event.role].title} ${why}: ${event.error}`;
              db.addMessage(session.id, 'error', { text: line });
              tell({ type: 'error', text: line });
            }
            broadcast();
          }
          if (event.type === 'tool_end') {
            const { type, id, ...tool } = event;
            db.addMessage(session.id, 'tool', tool);
            const inside = event.path && !relative(project, event.path).startsWith('..');
            const file = inside ? relative(project, event.path) : event.path || undefined;
            if (event.ok && file && WRITE_TOOLS.test(event.name)) {
              db.addEvent(session.id, 'file', { file, tool: event.name });
            } else if (!/^teamforge\s/.test(event.summary)) {
              // the agent's own status reports already create their timeline entries
              db.addEvent(session.id, 'tool', { tool: event.action ? `browser: ${event.action.verb} ${event.action.target}`.trim() : event.name, file });
            }
            broadcast();
          }
          tell(event);
        },
      });
      if (turn.abort.signal.aborted) status = 'stopped';
      else if (exitCode !== 0) fail(`The agent stopped with an error (exit ${exitCode}). ${stderr.trim().split('\n').slice(-3).join(' ')}`.trim());
    } catch (err) {
      fail(err?.code === 'ENOENT' ? 'The `copilot` command was not found.' : `Could not run the agent: ${err?.message || err}`);
    } finally {
      seat('idle');
    }
    if (strayed) {
      say(project, `The team tried to open \`${strayed}\` in the browser, which you have not allowed: the turn was stopped. \`/browser ${strayed}\` allows that site.`, null, tab);
    }
    return status;
  }

  // Runs queued turns one after the other; a stop or an error drops the queue.
  async function drain(project, text, images = [], tab = '') {
    const turn = { abort: new AbortController(), queue: [], tab }; // queue: { text, tab }
    turns.set(project, turn);
    let next = { text, tab };
    let attached = images; // only the client's own message carries images
    let status = 'end';
    while (next !== undefined) {
      try {
        turn.tab = next.tab;
        status = await runTurn(project, next.text, attached, next.tab);
        attached = [];
      } catch (err) {
        status = 'error';
        emit(project, { type: 'error', text: `Internal error: ${err?.message || err}` }, turn.tab);
      }
      next = status === 'end' ? turn.queue.shift() : undefined;
    }
    turns.delete(project);
    emit(project, { type: 'turn_end', status }, turn.tab);
    broadcast();
  }

  // Start a turn now, or line the message up behind the running one.
  function enqueue(project, text, tab = '') {
    const running = turns.get(project);
    if (running) { running.queue.push({ text, tab }); return; }
    drain(project, text, [], tab);
  }

  function runCommand(project, raw, tab = '') {
    cmdTab = tab;
    try { return commandIn(project, raw); } finally { cmdTab = ''; }
  }

  function commandIn(project, raw) {
    const line = raw.trim();
    const { name, args, known } = parseCommand(line);
    if (!known) return say(project, `Unknown command \`/${name}\`.\n${helpText()}`, line);
    if (turns.has(project) && !ANYTIME.has(name)) {
      throw new ChatError(409, `/${name} is not available while the team is working — /stop first`);
    }
    const session = active(project);
    const reply = (text) => say(project, text, line);
    switch (name) {
      case 'help':
        return reply(helpText());
      case 'status': {
        const p = provider();
        const model = modelFor(project);
        const who = p.provider ? `${p.label}${model ? ` · ${model}` : ' · default model'}` : 'no model provider';
        if (modeOf(project) === 'spike') {
          const asked = session ? db.listMessages(session.id).filter((m) => m.role === 'user').length : 0;
          return reply(`**Spike mode** — read-only${turns.has(project) ? ' — the team is reading the code' : ''}\n${asked ? `Questions asked: ${asked}` : 'No question yet'}\n${who}`);
        }
        if (!session) return reply(`No active mission. ${who}.`);
        const snap = db.snapshot(session.id);
        const done = snap.tasks.filter((t) => t.status === 'done').length;
        const gate = snap.validations.find((v) => v.status === 'pending');
        return reply([
          `**${session.project_name || 'Mission'}** — phase \`${session.phase}\`${turns.has(project) ? ' — the team is working' : ''}`,
          snap.tasks.length ? `Tasks: ${done}/${snap.tasks.length} done` : 'Tasks: none yet',
          gate ? `Waiting for you: \`${gate.gate}\` — ${gate.question}` : 'No gate is waiting for you',
          who,
        ].join('\n'));
      }
      case 'stop': {
        const turn = turns.get(project);
        if (!turn) return reply('Nothing is running.');
        turn.queue.length = 0;
        turn.abort.abort();
        return reply('Stopping the team…');
      }
      case 'clear': {
        if (!session) return reply('Nothing to clear.');
        db.clearMessages(session.id);
        db.setAgentSession(session.id, null);
        edited.delete(project);
        emit(project, { type: 'cleared' }, cmdTab);
        return reply(`Conversation cleared. The mission continues at phase \`${session.phase}\`; the team is briefed again on your next message.`);
      }
      case 'new': {
        if (!session) return reply(modeOf(project) === 'spike' ? 'No spike is open. Your next question starts one.' : 'No mission is open. Your next message starts one.');
        db.addEvent(session.id, 'note', { text: `${session.kind === 'spike' ? 'spike' : 'mission'} closed by the client` });
        db.closeSession(session.id);
        edited.delete(project);
        emit(project, { type: 'cleared' }, cmdTab);
        broadcast();
        return reply(session.kind === 'spike' ? 'Spike closed. Your next question starts a new one.' : 'Mission closed. Your next message starts a new one.');
      }
      case 'spike':
      case 'build': {
        if (modeOf(project) === name) return reply(`Already in ${name} mode.`);
        db.setMode(project, cmdTab, name);
        edited.delete(project);
        // the other kind of session, with its own conversation, is now the one on screen
        const now = active(project);
        emit(project, { type: 'mode', mode: name, messages: now ? db.listMessages(now.id) : [] }, cmdTab);
        broadcast();
        return reply(name === 'spike'
          ? 'Spike mode. Ask how the product behaves today: the team reads the code — it cannot change anything — and answers in business terms. Open **Technical details** under an answer for the developer\'s view. `/build` goes back to your mission.'
          : `Build mode. ${now ? `Your mission continues at phase \`${now.phase}\`.` : 'Your next message starts a mission.'} \`/spike\` goes back to your questions.`);
      }
      case 'export': {
        if (session?.kind !== 'spike') return reply('`/export` saves a spike as a document: switch to spike mode with `/spike` and ask a question first.');
        let saved;
        try { saved = saveSpikeReport(project, session, db.listMessages(session.id)); } catch (err) { return reply(`Could not save the spike: ${err?.message || err}`); }
        if (!saved.count) return reply('Nothing to save yet: no question has an answer.');
        db.addEvent(session.id, 'file', { file: saved.path, tool: 'spike export' });
        broadcast();
        return reply(`Saved ${saved.count} answer${saved.count > 1 ? 's' : ''} to \`${saved.path}\` — the functional answer, then the technical details, for each question.`);
      }
      case 'permissions': {
        const grants = db.listGrants(project);
        const web = sitesOf(project).length ? `\nBrowser: ${sitesOf(project).map((s) => `\`${s}\``).join(', ')} (\`/browser off\` to take it back).` : '';
        if (modeOf(project) === 'spike') return reply(`Spike mode is read-only: the team reads the project and runs \`ls\`, \`cat\`, \`git status\`, \`git log\` and \`git diff\`. It cannot write a file or run a program, whatever is allowed in build mode.${web}`);
        return reply([
          'Before the plan is approved: the four documents under `docs/` and read-only commands, whatever is allowed below.',
          allowAll(project)
            ? 'From implementation: **every shell command** (`/allow-all off` to turn this off).'
            : `From implementation: ${grants.length ? grants.map((g) => `\`${g}\``).join(', ') : 'no program yet'} (\`/allow <program>\`, \`/deny <program>\`).`,
        ].join('\n') + web);
      }
      case 'allow':
      case 'deny': {
        const program = args[0];
        if (!isProgramName(program)) return reply(`Usage: \`/${name} <program>\`, for example \`/${name} npm\`.`);
        if (name === 'allow') db.grantCommand(project, program); else db.revokeCommand(project, program);
        sendPermissions(project);
        return reply(name === 'allow'
          ? `\`${program}\` is allowed in this project, with any arguments, from the implementation phase.`
          : `\`${program}\` is no longer allowed.`);
      }
      case 'allow-all': {
        const off = args[0]?.toLowerCase() === 'off';
        db.setSetting(project, 'allow_all', off ? null : '1');
        sendPermissions(project);
        return reply(off
          ? 'Back to asking: the team can only run the programs you allowed.'
          : 'From the implementation phase the team can now run **any shell command** in this project without asking — including deleting files or installing packages. The lock before plan approval is unchanged. `/allow-all off` turns this off.');
      }
      case 'browser': {
        const sites = sitesOf(project);
        const what = args[0]?.toLowerCase();
        const kind = browserKind(project);
        const which = (k) => (k === 'own' ? 'your own Chrome' : 'a separate browser window');
        if (!what) {
          return reply(sites.length
            ? `The team can use ${which(kind)} on ${sites.map((s) => `\`${s}\``).join(', ')}. \`/browser <url>\` adds a site, \`/browser off\` takes the browser back, \`/browser ${kind === 'own' ? 'separate' : 'own'}\` switches to ${which(kind === 'own' ? 'separate' : 'own')}. The screen is read on \`${browserModel(project)}\` (\`/browser model <name>\`).`
            : `The team has no browser. \`/browser <url>\` lets it act in ${which(kind)} on that site, for example \`/browser localhost:4200\`.`);
        }
        if (what === 'off') {
          db.setSetting(project, 'browser', null);
          sendPermissions(project);
          return reply(sites.length ? 'The browser is taken back.' : 'The team had no browser.');
        }
        if (what === 'model') {
          const choice = args[1];
          if (!choice || args.length > 2) return reply(`The screen is read on \`${browserModel(project)}\`. \`/browser model <name>\` chooses another model, \`/browser model default\` goes back to \`${BROWSER_MODEL}\`.`);
          if (choice !== 'default' && !isModelName(choice)) return reply('That does not look like a model name.');
          db.setSetting(project, 'browser_model', choice === 'default' ? null : choice);
          return reply(`From the next turn the browser is driven, and the screen read, on \`${browserModel(project)}\`.`);
        }
        if (what === 'own' || what === 'separate') {
          db.setSetting(project, 'browser_kind', what === 'separate' ? 'separate' : null);
          sendPermissions(project);
          return reply(what === 'own'
            ? 'The team will act in **your own Chrome**, in a TeamForge tab, with your sign-ins. It needs the TeamForge extension (the `extension/` folder, loaded once in Chrome — see the README).'
            : 'The team will use **a separate browser window**, with its own profile: nothing of your own Chrome is touched, and you sign in there once per project.');
        }
        const site = parseSite(args[0]);
        if (!site || args.length > 1) return reply('Usage: `/browser <url>` with one site or page, for example `/browser localhost:4200` or `/browser https://test.example.com/orders/12`; `/browser off` to take it back; `/browser own` or `/browser separate` to choose which browser.');
        const { origin } = site;
        if (!sites.includes(origin)) db.setSetting(project, 'browser', [...sites, origin].join(' '));
        sendPermissions(project);
        if (kind === 'own' && !extensionConnected()) {
          return reply(`\`${origin}\` is allowed, but the **TeamForge extension is not connected** to this Chrome. Load it once: open \`chrome://extensions\`, turn on Developer mode, choose “Load unpacked” and pick the \`extension\` folder of TeamForge; then reload this page and ask again. (\`/browser separate\` uses a browser window of TeamForge's own instead, without an extension.)`);
        }
        // a page, not just a site: the client wants it opened, now
        const open = site.page && provider().provider;
        reply(`The team can act in ${which(kind)} on \`${origin}\`: open pages, click, type, take screenshots — in build mode and in spike mode.${kind === 'own' ? ' It works in its own TeamForge tab, through the TeamForge extension.' : ''} It acts there as whoever is signed in, and what it clicks is real. If it tries to open another site, the turn is stopped and you are asked.${open ? '\nOpening the page now.' : site.page ? '' : '\nNow tell the team what to do there, for example “open the home page and show me a screenshot”.'}`);
        if (open) drain(project, `Open ${site.url} in the browser, wait until the page has finished loading, take a screenshot, and tell me what is on the page.`, [], cmdTab);
        return undefined;
      }
      case 'model': {
        if (!args.length) {
          const { default: base, roles } = modelsOf(project);
          const own = Object.entries(roles).map(([id, m]) => `${ROLE[id]?.title || id}: \`${m}\``);
          return reply([
            `Company model: ${base ? `\`${base}\`` : 'the provider\'s default'}`,
            own.length ? `Own model — ${own.join(', ')}` : 'No employee has a model of their own.',
            '`/model <name>` for the company, `/model <employee> <name>` for one employee (e.g. `/model backend gpt-5.6-sol`), `default` to reset.',
          ].join('\n'));
        }
        const who = args.length > 1 || ROLE[args[0]] ? args[0].toLowerCase() : null;
        if (who && !ROLE[who]) return reply(`Unknown employee \`${who}\`. Employees: ${ROLE_CATALOG.map((r) => r.id).join(', ')}.`);
        const choice = (who ? args.slice(1) : args).join(' '); // a name with spaces is a typo, not a model
        if (!choice) return reply(`Usage: \`/model ${who} <name|default>\`.`);
        if (choice !== 'default' && !isModelName(choice)) return reply('That does not look like a model name.');
        setModel(project, who, choice === 'default' ? null : choice);
        const subject = who && who !== 'ceo' ? ROLE[who].title : 'The company';
        return reply(choice === 'default'
          ? `${subject} uses ${who && who !== 'ceo' ? 'the company\'s model' : 'the provider\'s default model'} again.`
          : `${subject} uses \`${choice}\` from the next turn.${who && who !== 'ceo' ? ' They now work as their own agent.' : ''}`);
      }
      default:
        return undefined;
    }
  }

  return {
    send(project, text, images, tab = '') {
      const decoded = decodeImages(images);
      if (typeof text !== 'string' || (!text.trim() && !decoded.length)) throw new ChatError(400, 'text required');
      requireProject(project);
      if (isCommand(text)) { runCommand(project, text, tab); return; }
      const p = provider();
      if (!p.provider) throw new ChatError(400, p.reason);
      if (turns.has(project)) {
        throw new ChatError(409, turns.get(project).tab === tab ? 'a turn is already running — stop it or wait' : 'the team is already working for another TeamForge tab on this project — wait for it, or stop it there');
      }
      drain(project, text.trim() || 'See the attached image.', decoded, tab);
    },

    stop(project) {
      const turn = turns.get(project);
      if (!turn) return false;
      turn.queue.length = 0;
      turn.abort.abort();
      return true;
    },

    // The client clicked Approve / Request changes: that answer is the agent's next message.
    validationAnswered(validation) {
      const session = db.getSession(validation.session_id);
      if (!session || !session.agent_session || !provider().provider) return;
      // the mission is parked while the client is in spike mode: the answer must not land in the spike
      if (db.getActiveSession(session.project_path, session.tab)?.id !== session.id) return;
      const comment = validation.answer ? ` ${validation.answer}` : '';
      enqueue(session.project_path, `[${validation.gate} ${validation.status}]${comment}`, session.tab);
    },

    // The client allowed a shell program for this project: remember it and carry on.
    grant(project, program, tab = '') {
      if (!isProgramName(program)) throw new ChatError(400, 'invalid program name');
      requireProject(project);
      db.grantCommand(project, program);
      const session = db.getActiveSession(project, tab);
      if (session?.agent_session && session.kind !== 'spike' && provider().provider) {
        enqueue(project, `[permission granted: ${program}] You may now run \`${program}\`. Continue where you stopped.`, tab);
      }
    },

    // The client saved a document in the browser: tell them, and tell the agent on its next turn.
    docEdited(project, path, tab = '') {
      if (!edited.has(project)) edited.set(project, new Set());
      edited.get(project).add(path);
      const session = db.getActiveSession(project, tab);
      if (session) db.addEvent(session.id, 'file', { file: path, tool: 'client edit' });
      say(project, `You edited \`${path}\`. The team re-reads it on your next message.`, null, tab);
      broadcast();
    },

    // The open sessions of the project, for a tab that wants one back.
    sessions(project, tab = '') {
      requireProject(project);
      const running = turns.get(project)?.tab;
      return db.listSessions(project).filter((s) => s.questions > 0).map(({ tab: owner, ...s }) => ({
        ...s, here: owner === tab, working: running !== undefined && owner === running,
      }));
    },

    // A tab takes a session over: it leaves whatever tab had it, and the session this
    // tab was showing is set aside (still in the list).
    adopt(project, sessionId, tab = '') {
      requireProject(project);
      const session = db.getSession(Number(sessionId));
      if (!session || session.project_path !== project || session.phase === 'done') throw new ChatError(404, 'no such open session in this project');
      const turn = turns.get(project);
      if (turn && (turn.tab === session.tab || turn.tab === tab)) throw new ChatError(409, 'the team is working in that session — wait for it or stop it first');
      const mode = session.kind === 'spike' ? 'spike' : 'build';
      const from = session.tab;
      if (from !== tab) {
        db.setMode(project, tab, mode);
        const shown = db.getActiveSession(project, tab);
        if (shown) db.setSessionTab(shown.id, `aside-${shown.id}`);
        db.setSessionTab(session.id, tab);
        emit(project, { type: 'cleared' }, from); // the tab that had it now starts fresh
      }
      edited.delete(project);
      emit(project, { type: 'mode', mode, messages: db.listMessages(session.id) }, tab);
      broadcast();
      return { id: session.id, mode };
    },

    model: modelFor,
    models: modelsOf,
    setModel,

    history(project, tab = '') {
      // an open mission, or nothing: a closed mission's conversation is over
      const session = db.getActiveSession(project, tab);
      return {
        messages: session ? db.listMessages(session.id) : [],
        running: turns.get(project)?.tab === tab,
        grants: db.listGrants(project),
        allowAll: allowAll(project),
        browser: sitesOf(project),
        browserKind: browserKind(project),
        mode: modeOf(project, tab),
        model: modelFor(project),
        models: modelsOf(project),
      };
    },

    stopAll() { for (const project of [...turns.keys()]) this.stop(project); },
  };
}
