const TEXT = {
  connected: ['Connected', 'Your TeamForge company can act in this Chrome.'],
  offline: ['TeamForge is not running', 'Start it on this machine — run `teamforge` in your project folder — then click the extension again.'],
  unpaired: ['Not paired', 'Open the TeamForge page in this Chrome once: the extension pairs by itself.'],
};
chrome.storage.session.get({ status: 'unpaired' }).then(({ status }) => {
  const [label, help] = TEXT[status] || TEXT.unpaired;
  const el = document.getElementById('status');
  el.textContent = label;
  el.className = `status ${status === 'connected' ? 'connected' : 'other'}`;
  document.getElementById('help').textContent = help;
});
