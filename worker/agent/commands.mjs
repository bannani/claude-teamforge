// Console commands: lines starting with "/" are for TeamForge, not for the agent.

export const COMMANDS = [
  { name: 'help', usage: '/help', about: 'List the commands' },
  { name: 'status', usage: '/status', about: 'Phase, tasks, pending gate, model' },
  { name: 'stop', usage: '/stop', about: 'Stop the running turn' },
  { name: 'clear', usage: '/clear', about: 'Clear the conversation and the agent\'s memory of it (mission, tasks and documents stay)' },
  { name: 'new', usage: '/new', about: 'Close the current mission; your next message starts a new one' },
  { name: 'spike', usage: '/spike', about: 'Spike mode: ask how the product behaves today — read-only, a functional answer with the technical detail on demand' },
  { name: 'export', usage: '/export', about: 'Spike mode: save the questions and answers to a document under docs/spikes/' },
  { name: 'build', usage: '/build', about: 'Back to build mode: the company works on your mission' },
  { name: 'permissions', usage: '/permissions', about: 'Show what the agent may run in this project' },
  { name: 'allow', usage: '/allow <program>', about: 'Let the agent run a program (from the implementation phase)' },
  { name: 'deny', usage: '/deny <program>', about: 'Take a program back' },
  { name: 'allow-all', usage: '/allow-all [off]', about: 'Let the agent run any shell command (from the implementation phase); "off" turns it back off' },
  { name: 'browser', usage: '/browser [url|off|own|separate|model <name>]', about: 'Let the team act in your Chrome on a site (e.g. /browser localhost:4200) to look at and test the running product; "off" takes it back, "separate" uses a window of its own' },
  { name: 'model', usage: '/model [employee] [name|default]', about: 'Show the models, or choose one for the company or for one employee (e.g. /model backend gpt-5.6-sol)' },
];

// Commands that make sense while the agent is working.
export const ANYTIME = new Set(['help', 'status', 'stop', 'permissions']);

export const isCommand = (text) => typeof text === 'string' && /^\/[a-z]/i.test(text.trim());

export function parseCommand(text) {
  const [head, ...args] = text.trim().split(/\s+/);
  const name = head.slice(1).toLowerCase();
  return { name, args, known: COMMANDS.some((c) => c.name === name) };
}

export const helpText = () => COMMANDS.map((c) => `\`${c.usage}\` — ${c.about}`).join('\n');
