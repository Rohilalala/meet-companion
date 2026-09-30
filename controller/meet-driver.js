import { setTimeout as delay } from 'node:timers/promises';

// English Chrome/Meet UI. All Meet selectors, including chat, live here.
export const selectors = {
  leave: /Leave call/i, join: /^(Join now|Ask to join|Switch here|Join here too|Ask to join anyway|Join anyway)$/i,
  cameraOff: /Turn off camera/i, cameraOn: /Turn on camera/i,
  mute: /Turn off microphone/i, unmute: /Turn on microphone/i,
  leaveControl: 'button[aria-label^="Leave call"]',
  meetingDetails: 'button[aria-label="Meeting details"]',
  cameraOffControl: 'button[aria-label^="Turn off camera"]',
  cameraOnControl: 'button[aria-label^="Turn on camera"]',
  muteControl: 'button[aria-label^="Turn off microphone"]',
  unmuteControl: 'button[aria-label^="Turn on microphone"]',
  chat: /Chat with everyone|In-call messages|Chat with all/i,
  // Prefix match: with unread messages Meet labels it "Chat with everyone - New message".
  chatControl: 'button[aria-label^="Chat with everyone"], button[aria-label^="In-call messages"], button[aria-label^="Chat with all"]',
  moreOptions: 'button[aria-label="More options"]',
  chatMenu: /In-call messages/i,
  settingsMenu: /Settings/i,
  audioTab: 'Audio',
  audioFilters: ['Studio sound', 'Noise cancellation'],
  closeSettings: /^Close dialog$/i,
  present: 'button[aria-label*="Present now"], button[aria-label="Share screen"]',
  presenting: 'button[aria-label="You are presenting"]',
  stopPresenting: /Stop presenting/i,
  messageInput: 'textarea[aria-label*="message" i], [contenteditable="true"][role="textbox"]',
  messages: '[data-message-id], [data-message-text]',
  messageText: '[data-message-text], [data-message-id] [jsname="dTKtvb"]', sender: '[data-sender-name]',
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
  // Meet hides its toolbar after a few idle seconds; hidden controls fail visibility checks and clicks (Vexa does the same).
  // Meet popups such as "Others may see your video differently" also intercept toolbar clicks (meet-teams-bot dismisses them too).
  async reveal() {
    await this.page.mouse?.move(600, 400); await this.page.mouse?.move(640, 420);
    try {
      const popups = this.page.locator('[role="dialog"], [role="alertdialog"]').getByRole('button', { name: /^(Got it|Dismiss)$/i });
      for (let i = await popups.count(); i > 0; i--) await popups.first().click({ timeout: 2000 });
    } catch { /* no popup, or it closed itself */ }
  }
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
      await this.reveal();
      for (const [on, off] of [[selectors.muteControl, selectors.unmuteControl], [selectors.cameraOffControl, selectors.cameraOnControl]]) {
        await this.page.locator(`${on}, ${off}`).first().waitFor({ state: 'visible', timeout: 15000 });
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
    const asked = /^Ask to join/i.test(await button.innerText());
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
    await this.page.bringToFront(); await this.reveal();
    const button = this.page.locator(selectors.unmuteControl).first();
    if (await button.isVisible()) await button.click({ timeout: 5000 });
    await this.page.locator(selectors.muteControl).first().waitFor({ timeout: 10000 }).catch(() => { throw new Error('MIC_STATE_UNVERIFIED'); });
  }
  async configureMusicAudio() {
    // Filters stay off for the rest of the call; reopening settings each track was slow and closed the chat panel.
    if (this.audioConfigured) return;
    await this.reveal();
    await this.page.locator(selectors.moreOptions).click({ timeout: 10000 });
    await this.page.getByRole('menuitem', { name: selectors.settingsMenu }).click();
    await this.page.getByRole('tab', { name: selectors.audioTab, exact: true }).click();
    for (const name of selectors.audioFilters) {
      const control = this.page.getByRole('switch', { name, exact: true });
      if (await control.isVisible()) {
        if (await control.getAttribute('aria-checked') === 'true') await control.click();
        if (await control.getAttribute('aria-checked') !== 'false') throw new Error('MEET_AUDIO_FILTERS_UNVERIFIED');
      }
    }
    await this.page.getByRole('button', { name: selectors.closeSettings }).click();
    this.audioConfigured = true;
  }
  async present({ audio = true } = {}) {
    await this.disableMedia();
    await this.page.bringToFront();
    await this.page.evaluate(audio => window.companionPresentation.arm(audio), audio);
    await this.page.locator(selectors.present).first().click({ timeout: 10000 });
    await this.page.waitForFunction(() => window.companionPresentation.status().active || window.companionPresentation.status().error, null, { timeout: 20000 });
    const state = await this.page.evaluate(() => window.companionPresentation.status());
    if (!state.active || (audio && !state.audio) || state.error) throw new Error('PRESENTATION_FAILED');
  }
  async stopPresenting() {
    await this.reveal();
    const indicator = this.page.locator(selectors.presenting);
    if (await indicator.isVisible()) {
      const stop = this.page.getByRole('button', { name: selectors.stopPresenting });
      if (!(await stop.isVisible())) await indicator.click({ timeout: 5000 });
      await stop.click({ timeout: 5000 });
      await indicator.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { throw new Error('PRESENTATION_STOP_UNVERIFIED'); });
    }
    await this.page.evaluate(() => window.companionPresentation?.stop());
  }
  async muted() { await this.reveal(); return this.page.locator(selectors.unmuteControl).first().isVisible(); }
  async camera(on) {
    const button = this.page.getByRole('button', { name: on ? selectors.cameraOn : selectors.cameraOff }).first();
    if (await button.isVisible()) await button.click();
    await this.page.getByRole('button', { name: on ? selectors.cameraOff : selectors.cameraOn }).first().waitFor({ timeout: 5000 });
  }
  async leave() {
    await this.reveal();
    const button = this.page.locator(selectors.leaveControl).first();
    if (await button.isVisible()) await button.evaluate(button => button.click());
    await button.waitFor({ state: 'hidden', timeout: 5000 });
  }
  async openChat(onMessage = () => {}) {
    try {
      if (!(await this.page.locator(selectors.messageInput).first().isVisible())) {
        await this.reveal();
        const button = this.page.locator(selectors.chatControl).first();
        if (await button.isVisible()) await button.evaluate(button => button.click());
        else {
          await this.page.locator(selectors.moreOptions).click({ timeout: 10000 });
          await this.page.getByRole('menuitem', { name: selectors.chatMenu }).click({ timeout: 5000 });
        }
      }
      await this.page.locator(selectors.messageInput).first().waitFor({ timeout: 5000 });
      if (!this.chatReady) {
        await this.page.exposeBinding('companionChatMessage', (_source, message) => onMessage(message));
        await this.page.evaluate(observeMeetChat, selectors);
        this.chatReady = true;
      }
    } catch { throw new Error('CHAT_UNAVAILABLE'); }
  }
  async sendChat(text) {
    if (!this.chatReady || typeof text !== 'string' || text.length > 4096) throw new Error('CHAT_UNAVAILABLE');
    await this.openChat(); // Meet's audio settings dialog can close the side panel.
    // Enter instead of the Send button: its label changed to "Send a message" and silently broke the button match.
    const input = this.page.locator(selectors.messageInput).first();
    try {
      await input.fill(text, { timeout: 5000 }); await input.press('Enter');
      await this.page.waitForFunction(element => !(element.value ?? element.textContent), await input.elementHandle(), { timeout: 3000 });
    } catch { throw new Error('CHAT_UNAVAILABLE'); }
  }
}

// Serialized into the Meet page; message bodies stay in memory.
export function observeMeetChat(selectors) {
  window.companionStopChat?.();
  const seen = new WeakMap();
  const seenIds = new Map();
  const messageId = node => node.getAttribute('data-message-id') ?? node.closest('[data-message-id]')?.getAttribute('data-message-id');
  const remember = (node, text) => { seen.set(node, text); const id = messageId(node); if (id) seenIds.set(id, text); };
  const read = node => {
    const group = node.closest(selectors.sender) ?? node.parentElement?.closest('[data-message-id]') ?? node;
    const senderNode = group.matches(selectors.sender) ? group : group.querySelector(selectors.sender);
    const sender = senderNode?.getAttribute('data-sender-name');
    const textNode = node.matches(selectors.messageText) ? node : node.querySelector(selectors.messageText);
    const text = textNode?.textContent?.trim();
    return text ? { sender: sender?.slice(0, 128) ?? null, text: text.slice(0, 4096), receivedAt: Date.now() } : null;
  };
  document.querySelectorAll(selectors.messages).forEach(node => { const message = read(node); if (message) remember(node, message.text); });
  const observer = new MutationObserver(() => {
    document.querySelectorAll(selectors.messages).forEach(node => {
      if (!node.matches(selectors.messageText) && node.querySelector(selectors.messages)) return;
      const message = read(node);
      if (!message || seen.get(node) === message.text || (messageId(node) && seenIds.get(messageId(node)) === message.text)) return;
      remember(node, message.text);
      window.companionChatMessage(message).catch(() => {});
    });
  });
  observer.observe(document, { childList: true, subtree: true, characterData: true });
  window.companionStopChat = () => observer.disconnect();
}
