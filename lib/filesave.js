/*
 * Writes the database straight into <repo>/data/players.json using Chrome's File System Access API.
 * The user picks the folder once (the repo's `data` folder, or the repo root); the handle is remembered in
 * IndexedDB. Chrome asks to re-allow writing after a browser restart, which needs one click.
 * Extension pages only (showDirectoryPicker is not available in content scripts).
 */
(function (root) {
  'use strict';
  const IDB = 'rdt-fs', STORE = 'h', KEY = 'dir';
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  async function getHandle() {
    const db = await open();
    return new Promise((res) => { const q = db.transaction(STORE).objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
  }
  async function setHandle(h) {
    const db = await open();
    return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(h, KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  const supported = () => typeof root.showDirectoryPicker === 'function';

  /** true if we may write now; with ask=true (needs a click) Chrome shows its permission prompt if needed. */
  async function permitted(h, ask) {
    const o = { mode: 'readwrite' };
    if ((await h.queryPermission(o)) === 'granted') return true;
    return ask ? (await h.requestPermission(o)) === 'granted' : false;
  }
  async function link() {
    // `id` makes Chrome reopen the last folder you picked; the first time it starts in Downloads (where a ZIP usually lands).
    const h = await root.showDirectoryPicker({ id: 'rematch-data', mode: 'readwrite', startIn: 'downloads' });
    await setHandle(h); return h;
  }
  // Picked the `data` folder itself -> write there; picked the repo root (or anything else) -> use/create ./data
  const dataDir = (h) => (h.name === 'data' ? h : h.getDirectoryHandle('data', { create: true }));
  async function write(h, text) {
    const dir = await dataDir(h);
    const f = await dir.getFileHandle('players.json', { create: true });
    const w = await f.createWritable(); await w.write(text); await w.close();
    return (h.name === 'data' ? 'data' : h.name + '/data') + '/players.json';
  }
  root.RDT = Object.assign(root.RDT || {}, { fs: { supported, getHandle, link, permitted, write } });
})(typeof globalThis !== 'undefined' ? globalThis : this);
