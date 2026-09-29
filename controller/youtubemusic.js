export const selectors = {
  signedIn: 'ytmusic-nav-bar tp-yt-paper-icon-button[aria-label="Account"], button#avatar-btn',
  signedOut: 'a[aria-label="Sign in"], ytmusic-nav-bar a[href*="accounts.google.com"]',
  play: '#play-pause-button[title="Play"], .ytp-play-button[title^="Play"]',
  pause: '#play-pause-button[title="Pause"], .ytp-play-button[title^="Pause"]',
  next: '.next-button, .ytp-next-button',
};
export async function session(page) {
  if (await page.locator(selectors.signedIn).first().isVisible()) return 'signed_in';
  if (await page.locator(selectors.signedOut).first().isVisible()) return 'signed_out';
  return 'unknown';
}
export async function play(page, link) {
  const url = new URL(link);
  if (!['https://music.youtube.com', 'https://www.youtube.com', 'https://youtube.com'].includes(url.origin)) throw new Error('MEDIA_UNAVAILABLE');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  if (await session(page) === 'signed_out') throw new Error('SIGNED_OUT(youtubemusic)');
  await page.evaluate(() => window.companionRoute.check());
  const button = page.locator(selectors.play).first();
  if (await button.isVisible()) await button.click();
}
