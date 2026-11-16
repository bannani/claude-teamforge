// The browser tools the team gets when it acts in the client's Chrome through the
// TeamForge extension. Same names as Playwright's, so the console tells both the same way.

const ref = { type: ['string', 'number'], description: 'The element\'s number in the last browser_snapshot, e.g. 12 for "[12] button …".' };
const element = { type: 'string', description: 'The element in plain words, as the client will read it in the console, e.g. "Sign in button".' };

export const TOOLS = [
  { name: 'browser_navigate', description: 'Open a page in the TeamForge tab of the client\'s Chrome. Only the sites the client allowed can be opened.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The full address to open.' } }, required: ['url'] } },
  { name: 'browser_navigate_back', description: 'Go back to the previous page.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_snapshot', description: 'Read the page: its title, address, headings, texts, and every element that can be acted on, each with a number to pass as `ref`. Take a new snapshot after anything that changes the page.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_click', description: 'Click an element of the last snapshot.',
    inputSchema: { type: 'object', properties: { element, ref, doubleClick: { type: 'boolean' } }, required: ['element', 'ref'] } },
  { name: 'browser_hover', description: 'Move the pointer over an element of the last snapshot, without clicking.',
    inputSchema: { type: 'object', properties: { element, ref }, required: ['element', 'ref'] } },
  { name: 'browser_type', description: 'Replace the content of a field of the last snapshot with a text.',
    inputSchema: { type: 'object', properties: { element, ref, text: { type: 'string' }, submit: { type: 'boolean', description: 'Press Enter afterwards.' } }, required: ['element', 'ref', 'text'] } },
  { name: 'browser_press_key', description: 'Press one key: Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home or End.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'browser_select_option', description: 'Choose an option in a list (a select element) of the last snapshot.',
    inputSchema: { type: 'object', properties: { element, ref, values: { type: 'array', items: { type: 'string' }, description: 'The option text or value.' } }, required: ['element', 'ref', 'values'] } },
  { name: 'browser_scroll', description: 'Scroll the page.',
    inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] } }, required: ['direction'] } },
  { name: 'browser_wait_for', description: 'Wait a number of seconds (15 at most), or until a text is on the page.',
    inputSchema: { type: 'object', properties: { time: { type: 'number' }, text: { type: 'string' } } } },
  { name: 'browser_take_screenshot', description: 'Take a screenshot of what is visible. The client sees it in the console.',
    inputSchema: { type: 'object', properties: {} } },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
