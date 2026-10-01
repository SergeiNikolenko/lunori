import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { createAccountClient, verifyIdentity } from '../host/account.mjs';

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lunori-siwc-'));
  const calls = []; let expectedNonce, expiresIn = 3600, scopes = 'resource.invoke chatgpt.tokens.use.direct', failRefresh = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'test-model', display_name: 'Test', visibility: 'list' }, { slug: 'hidden', visibility: 'hidden' }] });
    assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token');
    assert.equal(options.body.get('resource'), 'https://api.openai.com/v1');
    if (options.body.get('grant_type') === 'refresh_token' && failRefresh) return Response.json({}, { status: 400 });
    return Response.json({ token_type: 'Bearer', access_token: 'test-access', refresh_token: 'test-refresh', id_token: 'test-id', scope: scopes, expires_in: expiresIn });
  };
  const client = createAccountClient({ directory, fetchImpl, verify: async (token, id, nonce) => { assert.equal(token, 'test-id'); assert.equal(nonce, expectedNonce); return { sub: 'subject-one', email: 'reader@example.test' }; }, ...overrides });
  t.after(async () => { client.closeAccount(); await rm(directory, { recursive: true, force: true }); });
  async function begin(options) {
    const url = new URL((await client.startLogin(options)).authUrl); expectedNonce = url.searchParams.get('nonce'); return url;
  }
  function callback(url, params = {}) {
    const cb = new URL(url.searchParams.get('redirect_uri'));
    cb.search = new URLSearchParams({ state: url.searchParams.get('state'), code: 'test-code', client_id: 'oaiapp_test', ...params });
    return fetch(cb);
  }
  return { client, calls, begin, callback, directory, fetchImpl, setExpiry: n => { expiresIn = n; }, setScopes: v => { scopes = v; }, failRefresh: () => { failRefresh = true; } };
}

test('SIWC uses PKCE, loopback, verified identity, granted scopes and private storage', async t => {
  const f = await fixture(t);
  assert.equal((await f.client.catalog()).account.connected, false);
  const url = await f.begin();
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('agent_name_hint'), 'Lunori');
  assert.match(url.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
  assert.equal(new URL(url.searchParams.get('redirect_uri')).hostname, '127.0.0.1');
  const bad = await f.callback(url, { state: 'wrong' }); assert.equal(bad.status, 400); assert.equal(f.calls.length, 0);
  assert.equal((await f.client.catalog()).login.pending, true);
  assert.equal((await f.callback(url)).status, 200);
  const exchange = f.calls[0].options.body;
  assert.equal(exchange.get('client_id'), 'oaiapp_test');
  assert.equal(exchange.get('redirect_uri'), url.searchParams.get('redirect_uri'));
  assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
  const state = await f.client.catalog();
  assert.equal(state.account.sharing, true); assert.equal(state.models.length, 1);
  assert.ok(!JSON.stringify(state).includes('test-access'));
  assert.equal((await stat(join(f.directory, 'connections.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  const again = await f.begin();
  assert.equal(again.searchParams.get('client_id'), 'oaiapp_test');
  assert.equal(again.searchParams.get('ext_agent_host_id'), url.searchParams.get('ext_agent_host_id'));
  assert.equal(again.searchParams.has('agent_name_hint'), false);
  assert.equal(again.searchParams.has('id_token_hint'), false);
  assert.equal((await f.callback(again, { client_id: 'different' })).status, 400);
  assert.equal((await f.client.catalog()).account.sharing, true);
});

test('decline, cancellation, timeout and identity-only sign-in do not enable inference', async t => {
  const f = await fixture(t, { loginTimeout: 80 });
  let url = await f.begin(); assert.equal((await f.callback(url, { error: 'access_denied' })).status, 400);
  assert.equal(f.calls.length, 0);
  await f.begin(); f.client.cancelLogin(); assert.equal((await f.client.catalog()).login.pending, false);
  await f.begin(); await new Promise(r => setTimeout(r, 100)); assert.match((await f.client.catalog()).login.error, /timed out/);
  f.setScopes('openid email'); url = await f.begin(); assert.equal((await f.callback(url)).status, 200);
  const state = await f.client.catalog(); assert.equal(state.account.connected, true); assert.equal(state.account.sharing, false); assert.deepEqual(state.models, []);
  await assert.rejects(f.client.access(), /Enable/);
});

test('two runtimes serialize rotating refreshes and preserve registration on revoked refresh', async t => {
  const f = await fixture(t); f.setExpiry(1); await f.callback(await f.begin()); f.setExpiry(3600);
  const second = createAccountClient({ directory: f.directory, fetchImpl: f.fetchImpl });
  await Promise.all([f.client.access(), second.access()]);
  assert.equal(f.calls.filter(c => c.options.body?.get('grant_type') === 'refresh_token').length, 1);
  const state = JSON.parse(await readFile(join(f.directory, 'connections.json'))); assert.equal(state.profiles.oaiapp_test.refreshToken, 'test-refresh');
  await assert.rejects(f.client.resolveModel('missing'), /unavailable/);
  await assert.rejects(f.client.resolveModel('test-model', 'fast'), /Standard/);
});

test('invalid_grant clears unusable credentials and leaves the client registration for reauthorization', async t => {
  const f = await fixture(t); f.setExpiry(1); await f.callback(await f.begin()); f.failRefresh();
  await assert.rejects(f.client.access(), /expired/);
  assert.equal((await f.client.catalog()).account.connected, false);
  const url = await f.begin(); assert.equal(url.searchParams.get('client_id'), 'oaiapp_test');
});

test('JWT verification rejects wrong signature, issuer, audience, nonce and expiry', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const key = await exportJWK(publicKey); key.kid = 'test';
  const keySet = createLocalJWKSet({ keys: [key] });
  const sign = (fields = {}, signingKey = privateKey) => new SignJWT({ sub: 'subject', nonce: 'nonce', ...fields }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(fields.iss || 'https://auth.openai.com').setAudience(fields.aud || 'oaiapp_test').setIssuedAt().setExpirationTime(fields.exp || '1h').sign(signingKey);
  assert.equal((await verifyIdentity(await sign(), 'oaiapp_test', 'nonce', keySet)).sub, 'subject');
  for (const fields of [{ iss: 'https://wrong.test' }, { aud: 'wrong' }, { nonce: 'wrong' }, { exp: 1 }]) await assert.rejects(verifyIdentity(await sign(fields), 'oaiapp_test', 'nonce', keySet));
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyIdentity(await sign({}, other.privateKey), 'oaiapp_test', 'nonce', keySet));
});
