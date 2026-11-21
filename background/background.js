// The only job of this worker: close a rivalsdata tab when that tab's own page asks for it
// ("Open all profiles" found that the player is not in a Competitive game). Content scripts cannot close tabs themselves.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'rdt-close-me' || sender.id !== chrome.runtime.id || !sender.tab) return;
  const url = sender.url || sender.tab.url || '';
  if (/^https:\/\/(www\.)?rivalsdata\.com\//.test(url)) chrome.tabs.remove(sender.tab.id);
});
