/*
 * Sync data/players.json with a GitHub repo through the REST "contents" API, using a fine-grained token.
 *   1. fetch the file in the repo (if any) and MERGE it into the local database, so two machines never overwrite each other
 *   2. if the merged local state differs from what is in the repo, push it (one commit)
 * The token is only ever used as an Authorization header: it is never logged, stored in the data, or put in a message.
 */
(function (root) {
  'use strict';
  const FILE = 'data/players.json';
  const API = 'https://api.github.com/repos/';

  class GhError extends Error {}
  const fail = (msg) => { throw new GhError(msg); };

  function parseRepo(s) {
    const m = /^\s*([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\s*$/.exec(String(s || ''));
    return m ? { owner: m[1], name: m[2], full: m[1] + '/' + m[2] } : null;
  }

  const utf8ToB64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64ToUtf8 = (b64) => {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };

  /** Comparable form of a data file: everything except `exportedAt` (which changes on every export). */
  function sigOf(text) {
    try {
      const d = JSON.parse(text);
      const sorted = (o) => Object.keys(o || {}).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {});
      return JSON.stringify({ players: d.players, games: d.games || [], stats: d.stats || {}, settings: d.settings || {},
        deleted: { players: sorted(d.deleted && d.deleted.players), games: sorted(d.deleted && d.deleted.games) } });
    } catch (_) { return null; }
  }

  function explain(res, repo, branch) {
    const s = res.status;
    if (s === 401) return 'GitHub rejected the token (wrong, expired or revoked). Create a new one and paste it again.';
    if (s === 403) {
      if (res.headers.get('x-ratelimit-remaining') === '0') return 'GitHub rate limit reached. Try again in a few minutes.';
      return 'The token is not allowed to do that. It needs “Contents: Read and write” on ' + repo + '.';
    }
    if (s === 404) return 'GitHub says ' + repo + ' (branch ' + branch + ') was not found. Check the name, and that the token has access to that repository.';
    if (s === 409 || s === 422) return 'GitHub reported a conflict while saving. Try again.';
    return 'GitHub returned an error (HTTP ' + s + ').';
  }

  async function call(url, opt, repo, branch) {
    try { return await fetch(url, opt); }
    catch (_) { return fail('Could not reach GitHub (offline, or blocked on this network).'); }
  }

  /**
   * cfg: {repo:"owner/name", branch, token}. store: RDT.store. Returns
   *   {action:'created'|'updated'|'unchanged', pulled:<new players merged in>, players, commit}
   */
  async function sync(cfg, store) {
    const repo = parseRepo(cfg.repo);
    if (!repo) fail('Enter the repository as owner/name, for example DleanJeans/rivals-rematch.');
    if (!cfg.token) fail('Paste a GitHub token first.');
    const branch = (cfg.branch || 'main').trim();
    const url = API + repo.full + '/contents/' + FILE;
    const head = (accept) => ({ Authorization: 'Bearer ' + cfg.token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
    let pulled = 0;

    for (let attempt = 0; attempt < 2; attempt++) {
      // 1. what is in the repo right now?
      let sha = null, remoteText = null;
      const r = await call(url + '?ref=' + encodeURIComponent(branch), { headers: head(), cache: 'no-store' });
      if (r.status !== 404) {
        if (!r.ok) fail(explain(r, repo.full, branch));
        const meta = await r.json();
        sha = meta.sha;
        if (meta.encoding === 'base64' && meta.content) remoteText = b64ToUtf8(meta.content);
        else {                                                         // larger than 1 MB: the JSON form carries no content
          const raw = await call(url + '?ref=' + encodeURIComponent(branch), { headers: head('application/vnd.github.raw+json'), cache: 'no-store' });
          if (!raw.ok) fail(explain(raw, repo.full, branch));
          remoteText = await raw.text();
        }
      }

      // 2. merge it into the local database (the most recently seen record of each player wins)
      if (remoteText) {
        let data = null;
        try { data = JSON.parse(remoteText); } catch (_) { fail('The file in the repo is not valid JSON, so it was not touched.'); }
        if (data && Array.isArray(data.players)) {
          const before = (await store.loadPlayers()).length;
          await store.importAll(data);
          pulled = Math.max(pulled, (await store.loadPlayers()).length - before);
        }
      }

      // 3. nothing new to push?
      const snap = await store.snapshot();
      if (remoteText && sigOf(remoteText) === snap.sig) return { action: 'unchanged', pulled, players: snap.count };

      // 4. push one commit
      const body = { message: 'Update players.json (' + snap.count + ' players) via Rivals Rematch', content: utf8ToB64(snap.text), branch };
      if (sha) body.sha = sha;
      const put = await call(url, { method: 'PUT', headers: Object.assign(head(), { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      if ((put.status === 409 || put.status === 422) && attempt === 0) continue;     // the file changed under us: re-read, re-merge, retry once
      if (!put.ok) fail(explain(put, repo.full, branch));
      const out = await put.json().catch(() => ({}));
      return { action: sha ? 'updated' : 'created', pulled, players: snap.count, commit: out.commit && out.commit.sha ? out.commit.sha.slice(0, 7) : null, sig: snap.sig };
    }
    return fail('GitHub reported a conflict while saving. Try again.');
  }

  root.RDT = Object.assign(root.RDT || {}, { github: { sync, parseRepo, sigOf, utf8ToB64, b64ToUtf8, GhError } });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RDT.github;
})(typeof globalThis !== 'undefined' ? globalThis : this);
