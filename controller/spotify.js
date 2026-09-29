import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const selectors = {
  signedIn: '[data-testid="user-widget-link"], button[data-testid="user-widget-link"]',
  signedOut: '[data-testid="login-button"]',
};
export async function session(page) {
  if (await page.locator(selectors.signedIn).first().isVisible()) return 'signed_in';
  if (await page.locator(selectors.signedOut).first().isVisible()) return 'signed_out';
  return 'unknown';
}
export function playbackBody(link) {
  let url;
  try { url = new URL(link); } catch { throw new Error('MEDIA_UNAVAILABLE'); }
  const match = /^\/(?:intl-[a-z]+\/)?(track|playlist|album)\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname);
  if (url.origin !== 'https://open.spotify.com' || !match) throw new Error('MEDIA_UNAVAILABLE');
  const uri = `spotify:${match[1]}:${match[2]}`;
  return match[1] === 'track' ? { uris: [uri] } : { context_uri: uri };
}

export class Spotify {
  #tokens; #pending; #fetch; #selected = false;
  constructor({ clientId, port = 3210, deviceId, fetchImpl = fetch } = {}) {
    this.clientId = clientId; this.redirect = `http://127.0.0.1:${port}/callback`; this.deviceId = deviceId; this.#fetch = fetchImpl;
  }
  beginAuthorization() {
    if (!this.clientId) throw new Error('SPOTIFY_CLIENT_ID_REQUIRED');
    if (this.#pending) throw new Error('SPOTIFY_AUTH_ALREADY_PENDING');
    const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ client_id: this.clientId, response_type: 'code', redirect_uri: this.redirect, scope: 'user-read-playback-state user-modify-playback-state', state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    const completion = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending = undefined; reject(new Error('SPOTIFY_AUTH_TIMEOUT')); }, 300000);
      timer.unref(); this.#pending = { verifier, state, resolve, reject, timer };
    });
    completion.catch(() => {});
    return { url: url.href, completion };
  }
  async callback(url) {
    const pending = this.#pending;
    const received = Buffer.from(url.searchParams.get('state') ?? '');
    const expected = Buffer.from(pending?.state ?? '');
    if (!pending || received.length !== expected.length || !timingSafeEqual(received, expected)) return { status: 400, text: 'AUTH_STATE_INVALID' };
    clearTimeout(pending.timer); this.#pending = undefined;
    try {
      if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('SPOTIFY_AUTH_DENIED');
      await this.#token({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: this.redirect, code_verifier: pending.verifier });
      pending.resolve(); return { status: 200, text: 'Authorized. Close this tab and return to the diagnostic terminal.' };
    } catch { pending.reject(new Error('SPOTIFY_AUTH_FAILED')); return { status: 400, text: 'SPOTIFY_AUTH_FAILED' }; }
  }
  async #token(body) {
    const response = await this.#fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, client_id: this.clientId }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('SIGNED_OUT(spotify)');
    const value = await response.json();
    if (typeof value.access_token !== 'string' || !Number.isFinite(value.expires_in)) throw new Error('SPOTIFY_AUTH_FAILED');
    this.#tokens = { access: value.access_token, refresh: value.refresh_token ?? this.#tokens?.refresh, expires: Date.now() + value.expires_in * 1000 };
  }
  async #request(path, method = 'GET', body) {
    if (!this.#tokens) throw new Error('SIGNED_OUT(spotify)');
    if (this.#tokens.expires < Date.now() + 30000) {
      if (!this.#tokens.refresh) throw new Error('SIGNED_OUT(spotify)');
      await this.#token({ grant_type: 'refresh_token', refresh_token: this.#tokens.refresh });
    }
    const response = await this.#fetch('https://api.spotify.com/v1/me/player' + path, { method, headers: { Authorization: `Bearer ${this.#tokens.access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (method !== 'GET') this.lastMutationStatus = response.status;
    if (response.status === 401) throw new Error('SIGNED_OUT(spotify)');
    if (!response.ok) throw new Error(`SPOTIFY_HTTP_${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  async selectDevice() {
    const result = await this.#request('/devices');
    const players = result.devices.filter(device => !device.is_restricted && /web player/i.test(device.name));
    const match = this.deviceId ? players.find(device => device.id === this.deviceId) : players.length === 1 ? players[0] : null;
    if (!match) throw new Error('SPOTIFY_WEB_PLAYER_DEVICE_REQUIRED');
    this.deviceId = match.id;
    this.#selected = true;
    return { webPlayerSelected: true, active: match.is_active, supportsVolume: match.supports_volume };
  }
  #target(path, extra = {}) {
    if (!this.deviceId || !this.#selected) throw new Error('SPOTIFY_WEB_PLAYER_DEVICE_REQUIRED');
    return path + '?' + new URLSearchParams({ ...extra, device_id: this.deviceId });
  }
  play(link) { return this.#request(this.#target('/play'), 'PUT', link ? playbackBody(link) : {}); }
  pause() { return this.#request(this.#target('/pause'), 'PUT'); }
  next() { return this.#request(this.#target('/next'), 'POST'); }
  setVolume(volume) {
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error('VOLUME_INVALID');
    return this.#request(this.#target('/volume', { volume_percent: String(volume) }), 'PUT');
  }
  queue(link) {
    const body = playbackBody(link);
    if (!body.uris) throw new Error('SPOTIFY_QUEUE_REQUIRES_TRACK');
    return this.#request(this.#target('/queue', { uri: body.uris[0] }), 'POST');
  }
  queueState() { return this.#request('/queue'); }
  async nowPlaying() {
    const state = await this.#request('');
    if (state?.device?.id && state.device.id !== this.deviceId) throw new Error('STREAM_TAKEN_OVER');
    return state;
  }
  close() {
    if (this.#pending) { clearTimeout(this.#pending.timer); this.#pending.reject(new Error('SPOTIFY_AUTH_CANCELLED')); }
    this.#pending = undefined; this.#tokens = undefined; this.#selected = false;
  }
}
