import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRemoteJWKSet, jwtVerify, lockfile } from './dependencies.mjs';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks = createRemoteJWKSet(new URL(ISSUER + '/.well-known/jwks.json'));
const random = () => randomBytes(32).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const DEFAULT_MODEL = 'gpt-6-luna';
// Plans expose different Luna versions; fall back to any Luna before the first listed model.
export const preferredModel = models => models.find(m => m.id === DEFAULT_MODEL) || models.find(m => /luna/i.test(m.id)) || models[0];
const sharing = p => !!p?.accessToken && p.scopes?.includes('chatgpt.tokens.use.direct') && p.scopes?.includes('resource.invoke');

export async function verifyIdentity(token, clientId, nonce, keySet = jwks) {
  const { payload } = await jwtVerify(token, keySet, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
  if (!payload.sub || !same(payload.nonce, nonce)) throw new Error('Sign-in identity could not be verified.');
  return payload;
}

// Dependencies are injectable only in-process for deterministic protocol tests.
// Production callers cannot override endpoints or storage through native messages.
export function createAccountClient({ directory = join(homedir(), 'Library/Application Support/Lunori/ChatGPT'), fetchImpl = fetch, verify = verifyIdentity, loginTimeout = 300000 } = {}) {
  const file = join(directory, 'connections.json');
  let login = null;
  let cache = null;
  let starting = false;
  let localQueue = Promise.resolve();

  async function transaction(fn) {
    const run = localQueue.then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const release = await lockfile.lock(directory, { realpath: false, stale: 60000, retries: { retries: 100, minTimeout: 50, maxTimeout: 500 } });
      try {
        let state;
        try { state = JSON.parse(await readFile(file, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw new Error('Lunori account storage could not be read.'); }
        state ||= { hostId: 'urn:uuid:' + randomUUID(), active: null, profiles: {} };
        const result = await fn(state);
        const temp = file + '.' + randomUUID() + '.tmp';
        await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
        await rename(temp, file);
        return result;
      } finally { await release(); }
    });
    localQueue = run.catch(() => {});
    return run;
  }

  async function tokenRequest(params, signal) {
    const response = await fetchImpl(ISSUER + '/api/accounts/oauth/token', {
      method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ ...params, resource: RESOURCE }),
    });
    if (!response.ok) {
      const error = new Error(response.status === 400 || response.status === 401 ? 'ChatGPT sign-in expired. Continue with ChatGPT again.' : 'ChatGPT sign-in is temporarily unavailable. Try again.');
      error.reauthorize = response.status === 400 || response.status === 401;
      throw error;
    }
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !data.access_token || data.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('ChatGPT returned an invalid token response.');
    return data;
  }

  function tokens(data, previous = {}) {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || previous.refreshToken,
      idToken: data.id_token || previous.idToken,
      scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/) : (previous.scopes || []),
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async function access(profileId) {
    const result = await transaction(async state => {
      const p = state.profiles[profileId || state.active];
      if (!p?.accessToken) return { error: 'Continue with ChatGPT to connect Lunori.' };
      if (!sharing(p)) return { error: 'Enable ChatGPT plan usage by connecting again.' };
      if (p.expiresAt < Date.now() + 60000) {
        if (!p.refreshToken) return { error: 'Continue with ChatGPT to renew your connection.' };
        try { Object.assign(p, tokens(await tokenRequest({ grant_type: 'refresh_token', client_id: p.clientId, refresh_token: p.refreshToken }), p)); }
        catch (error) {
          if (!error.reauthorize) throw error;
          delete p.accessToken; delete p.refreshToken;
          return { error: error.message };
        }
      }
      if (!sharing(p)) return { error: 'Enable ChatGPT plan usage by connecting again.' };
      return { token: p.accessToken, profileId: p.clientId };
    });
    if (result.error) throw new Error(result.error);
    return result;
  }

  async function catalog({ refresh = false } = {}) {
    const state = await transaction(s => ({ active: s.active, profile: s.profiles[s.active] }));
    const p = state.profile;
    const account = p ? { connected: !!p.accessToken, sharing: !!sharing(p), email: p.email || '', source: 'siwc', profileId: p.clientId } : { connected: false, sharing: false };
    let models = [], modelError;
    if (account.sharing) {
      try {
        if (!refresh && cache?.profileId === state.active && cache.time > Date.now() - 60000) models = cache.models;
        else {
          const { token } = await access(state.active);
          const response = await fetchImpl(RESOURCE + '/models', { redirect: 'error', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error(response.status === 401 ? 'Continue with ChatGPT to renew your connection.' : 'Could not load ChatGPT models. Try refreshing.');
          const data = await response.json();
          if (!Array.isArray(data.models)) throw new Error('ChatGPT returned an invalid model catalog.');
          models = data.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string' && (!m.input_modalities || m.input_modalities.includes('text'))).map(m => ({ id: m.slug, name: m.display_name || m.slug, fast: false }));
          cache = { profileId: state.active, time: Date.now(), models };
        }
      } catch (error) { modelError = error.message; }
    }
    return { account, models, login: login ? { pending: login.pending, error: login.error, ...(login.pending ? {authUrl: login.authUrl} : {}) } : null, ...(modelError ? { modelError } : {}) };
  }

  async function resolveModel(model = DEFAULT_MODEL, speed = 'standard') {
    if (speed !== 'standard') throw new Error('ChatGPT plan translation currently supports Standard speed.');
    const state = await catalog();
    if (!state.account.sharing) throw new Error('Continue with ChatGPT and enable plan usage.');
    if (state.modelError) throw new Error(state.modelError);
    const selected = state.models.find(m => m.id === model) || (!model || model === DEFAULT_MODEL ? preferredModel(state.models) : null);
    if (!selected) throw new Error('This model is unavailable for your account. Select an available model.');
    return { model: selected.id, speed, profileId: state.account.profileId };
  }

  function finish(attempt, error = null) {
    attempt.pending = false;
    attempt.error = error;
    clearTimeout(attempt.timer);
    attempt.server.close();
    cache = null;
  }

  async function startLogin({ newProfile = false } = {}) {
    if (starting || login?.pending) throw new Error('Sign-in is already open. Complete it or cancel first.');
    starting = true;
    try {
      const saved = await transaction(s => ({ hostId: s.hostId, profile: newProfile ? null : s.profiles[s.pendingRegistration || s.active] }));
      const attempt = { pending: true, error: null, state: random(), nonce: random(), verifier: random(), controller: new AbortController(), consumed: false };
      const p = saved.profile;
      attempt.server = createServer((req, res) => { void callback(req, res, attempt, p).catch(() => { finish(attempt, 'Sign-in could not be completed. Please try again.'); if (!res.writableEnded) res.end('Sign-in failed. Return to Lunori and try again.'); }); });
      await new Promise((resolve, reject) => { attempt.server.once('error', reject); attempt.server.listen(0, '127.0.0.1', resolve); });
      attempt.redirectUri = `http://127.0.0.1:${attempt.server.address().port}/auth/callback`;
      attempt.timer = setTimeout(() => { attempt.controller.abort(); finish(attempt, 'Sign-in timed out. Please try again.'); }, loginTimeout);
      const url = new URL(ISSUER + '/api/accounts/authorize');
      url.search = new URLSearchParams({ client_id: p?.clientId || 'dynamic_agent_client', ...(!p ? { agent_name_hint: 'Lunori' } : {}), ext_agent_host_id: saved.hostId, response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') }).toString();
      // Do not expose retained ID tokens to the extension, page, or assistant via a URL.
      attempt.authUrl = url.href;
      login = attempt;
      return { authUrl: url.href };
    } finally { starting = false; }
  }

  async function callback(req, res, attempt, previous) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const url = new URL(req.url, attempt.redirectUri);
    if (req.method !== 'GET' || req.headers.host !== new URL(attempt.redirectUri).host || url.pathname !== '/auth/callback') { res.writeHead(404); res.end('Not found'); return; }
    if (attempt !== login || !attempt.pending || attempt.consumed || !same(url.searchParams.get('state'), attempt.state)) { res.writeHead(400); res.end('Invalid or expired sign-in.'); return; }
    attempt.consumed = true;
    try {
      if (url.searchParams.has('error')) throw new Error('Sign-in was declined. Continue with ChatGPT to try again.');
      const code = url.searchParams.get('code');
      const clientId = url.searchParams.get('client_id') || previous?.clientId;
      if (!code || !clientId || clientId === 'dynamic_agent_client' || (previous && previous.clientId !== clientId)) throw new Error('ChatGPT registration could not be verified.');
      // Retain an issued registration even if the one-time code expires.
      await transaction(s => { s.profiles[clientId] ||= { clientId }; if (!previous?.subject) s.pendingRegistration = clientId; });
      const data = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri }, attempt.controller.signal);
      const identity = await verify(data.id_token, clientId, attempt.nonce);
      if (previous?.subject && identity.sub !== previous.subject) throw new Error('The account did not match this saved connection.');
      if (attempt.controller.signal.aborted) throw new Error('Sign-in was cancelled.');
      await transaction(s => {
        if (attempt.controller.signal.aborted) throw new Error('Sign-in was cancelled.');
        s.profiles[clientId] = { clientId, subject: identity.sub, email: identity.email || '', ...tokens(data) };
        s.active = clientId; if (s.pendingRegistration === clientId) delete s.pendingRegistration;
      });
      finish(attempt, sharing(tokens(data)) ? null : 'Connected, but ChatGPT plan usage was not granted. Connect again to enable it.');
      res.end(attempt.error || 'Lunori is connected to your ChatGPT plan. You can close this tab.');
    } catch (error) {
      finish(attempt, error.message?.startsWith('Sign-in') || error.message?.startsWith('ChatGPT') || error.message?.startsWith('The account') ? error.message : 'Sign-in identity could not be verified. Please try again.');
      res.writeHead(400); res.end(attempt.error);
    }
  }

  function cancelLogin() {
    if (login?.pending) { login.controller.abort(); finish(login, 'Sign-in was cancelled.'); }
    return { ok: true };
  }
  return { catalog, startLogin, cancelLogin, closeAccount: cancelLogin, resolveModel, access };
}

const client = createAccountClient();
export const { catalog, startLogin, cancelLogin, closeAccount, resolveModel, access } = client;
