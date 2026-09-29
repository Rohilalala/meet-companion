import { setTimeout as delay } from 'node:timers/promises';

// English Chrome/Meet UI. All Meet selectors, including chat, live here.
export const selectors = {
  leave: /Leave call/i, join: /^(Join now|Ask to join)$/i,
  cameraOff: /Turn off camera/i, cameraOn: /Turn on camera/i,
  mute: /Turn off microphone/i, unmute: /Turn on microphone/i,
  leaveControl: 'button[aria-label^="Leave call"]',
  meetingDetails: 'button[aria-label="Meeting details"]',
  cameraOffControl: 'button[aria-label^="Turn off camera"]',
  cameraOnControl: 'button[aria-label^="Turn on camera"]',
  muteControl: 'button[aria-label^="Turn off microphone"]',
  unmuteControl: 'button[aria-label^="Turn on microphone"]',
  chat: /Chat with everyone|In-call messages|Chat with all/i,
  messageInput: 'textarea[aria-label*="message" i], [contenteditable="true"][role="textbox"]',
  send: /^Send( message)?$/i,
  messages: '[data-message-id], [data-message-text]',
  messageText: '[data-message-text]', sender: '[data-sender-name]',
  googleAccount: 'a[aria-label^="Google Account"], button[aria-label^="Google Account"]',
  googleSignIn: 'a[href*="accounts.google.com/ServiceLogin"], a[data-action="sign in"]',
  guestName: 'input[placeholder="Your name"], input[aria-label="Your name"]',
};
const denied = /You can't join this (video )?call|Your request to join was denied|Someone denied your request/i;
const removed = /You've been removed|You have been removed|removed you from/i;
const ended = /This meeting has ended|The meeting has ended|You left the meeting/i;

export function meetingURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('MEETING_LINK_REQUIRED'); }
  if (url.origin !== 'https://meet.google.com' || !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)) throw new Error('INVALID_MEETING_LINK');
  return url.origin + url.pathname;
}

export class MeetDriver {
  constructor(page) { this.page = page; this.chatReady = false; }
  async googleSession() {
    if (new URL(this.page.url()).hostname === 'accounts.google.com') return 'signed_out';
    if (await this.page.locator(selectors.googleAccount).first().isVisible()) return 'signed_in';
    if (await this.page.locator(selectors.googleSignIn).first().isVisible()) return 'signed_out';
    return 'unknown';
  }
  async state() {
    if (new URL(this.page.url()).hostname === 'accounts.google.com') return 'SIGNED_OUT(google)';
    const text = await this.page.locator('body').innerText().catch(() => '');
    if (/Sign in to join/i.test(text) || await this.page.locator(selectors.guestName).first().isVisible()) return 'SIGNED_OUT(google)';
    if (denied.test(text)) return 'ADMISSION_DENIED';
    if (removed.test(text)) return 'REMOVED';
    if (ended.test(text)) return 'MEETING_ENDED';
    if (/Asking to be let in|You'll join when someone lets you in|Wait for the host/i.test(text)) return 'awaiting_admission';
    // A hang-up control alone is not evidence of admission. CSS locators also
    // see rendered controls when a Meet modal hides them from accessibility.
    if (await this.page.locator(selectors.leaveControl).first().isVisible() &&
        await this.page.locator(selectors.meetingDetails).first().isVisible()) return 'in_call';
    return 'joining';
  }
  async disableMedia() {
    try {
      for (const [on, off] of [[selectors.muteControl, selectors.unmuteControl], [selectors.cameraOffControl, selectors.cameraOnControl]]) {
        const button = this.page.locator(on).first();
        // Only dispatch an OFF action; a modal must not silently skip it.
        if (await button.isVisible()) await button.evaluate(button => button.click());
        await this.page.locator(off).first().waitFor({ state: 'visible', timeout: 5000 });
      }
    } catch { throw new Error('MEDIA_OFF_UNVERIFIED'); }
  }
  async join(link, { timeout = 180000 } = {}) {
    await this.page.goto(meetingURL(link), { waitUntil: 'domcontentloaded' });
    if (await this.state() === 'SIGNED_OUT(google)') throw new Error('SIGNED_OUT(google)');
    const start = Date.now();
    await this.page.getByRole('button', { name: selectors.join }).first().waitFor({ timeout: 30000 }).catch(() => { throw new Error('PREJOIN_UI_UNAVAILABLE'); });
    await this.page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(track => track.stop());
    }).catch(() => { throw new Error('BLACKHOLE_INPUT_UNAVAILABLE'); });
    await this.disableMedia();
    const button = this.page.getByRole('button', { name: selectors.join }).first();
    const asked = /Ask to join/i.test(await button.innerText());
    await button.click();
    const requestedAt = Date.now();
    while (Date.now() - requestedAt < timeout) {
      const state = await this.state();
      if (state === 'in_call') {
        await this.disableMedia();
        return { state, evidence: 'bot-ui-only', askedToJoin: asked, prejoinMs: requestedAt - start, admissionMs: Date.now() - requestedAt };
      }
      if (['ADMISSION_DENIED', 'REMOVED', 'MEETING_ENDED', 'SIGNED_OUT(google)'].includes(state)) throw new Error(state);
      await delay(300);
    }
    throw new Error('ADMISSION_TIMEOUT');
  }
  async unmute() {
    const button = this.page.getByRole('button', { name: selectors.unmute }).first();
    if (await button.isVisible()) await button.click();
    await this.page.getByRole('button', { name: selectors.mute }).first().waitFor({ timeout: 5000 }).catch(() => { throw new Error('MUTED_BY_HOST'); });
  }
  async muted() { return this.page.locator(selectors.unmuteControl).first().isVisible(); }
  async camera(on) {
    const button = this.page.getByRole('button', { name: on ? selectors.cameraOn : selectors.cameraOff }).first();
    if (await button.isVisible()) await button.click();
    await this.page.getByRole('button', { name: on ? selectors.cameraOff : selectors.cameraOn }).first().waitFor({ timeout: 5000 });
  }
  async leave() {
    const button = this.page.locator(selectors.leaveControl).first();
    if (await button.isVisible()) await button.evaluate(button => button.click());
    await button.waitFor({ state: 'hidden', timeout: 5000 });
  }
  async openChat(onMessage = () => {}) {
    try {
      if (!(await this.page.locator(selectors.messageInput).first().isVisible())) await this.page.getByRole('button', { name: selectors.chat }).first().click({ timeout: 5000 });
      await this.page.locator(selectors.messageInput).first().waitFor({ timeout: 5000 });
      if (!this.chatReady) {
        await this.page.exposeBinding('companionChatMessage', (_source, message) => onMessage(message));
        await this.page.evaluate(selectors => {
          const seen = new WeakMap();
          const read = node => {
            const group = node.closest(selectors.sender) ?? node.parentElement?.closest('[data-message-id]') ?? node;
            const senderNode = group.matches(selectors.sender) ? group : group.querySelector(selectors.sender);
            const sender = senderNode?.getAttribute('data-sender-name');
            const textNode = node.matches(selectors.messageText) ? node : node.querySelector(selectors.messageText);
            const text = textNode?.textContent?.trim();
            return sender && text ? { sender: sender.slice(0, 128), text: text.slice(0, 4096), receivedAt: Date.now() } : null;
          };
          document.querySelectorAll(selectors.messages).forEach(node => { const message = read(node); if (message) seen.set(node, message.text); });
          const observer = new MutationObserver(() => {
            document.querySelectorAll(selectors.messages).forEach(node => {
              const message = read(node);
              if (!message || seen.get(node) === message.text) return;
              seen.set(node, message.text);
              // Only leaf text nodes emit, avoiding container/child duplicate delivery.
              if (node.matches(selectors.messageText) || !node.querySelector(selectors.messages)) window.companionChatMessage(message).catch(() => {});
            });
          });
          observer.observe(document, { childList: true, subtree: true, characterData: true });
          window.companionStopChat = () => observer.disconnect();
        }, selectors);
        this.chatReady = true;
      }
    } catch { throw new Error('CHAT_UNAVAILABLE'); }
  }
  async sendChat(text) {
    if (!this.chatReady || typeof text !== 'string' || text.length > 4096) throw new Error('CHAT_UNAVAILABLE');
    try { await this.page.locator(selectors.messageInput).first().fill(text); await this.page.getByRole('button', { name: selectors.send }).first().click({ timeout: 5000 }); }
    catch { throw new Error('CHAT_UNAVAILABLE'); }
  }
}
