export const selectors = {
  signedIn: '[data-testid="account-menu-button"], button[aria-label*="Account" i]',
  signedOut: 'button[data-testid="sign-in-button"]',
  play: 'button[aria-label="Play"], button[data-testid="play-button"]',
  pause: 'button[aria-label="Pause"], button[data-testid="pause-button"]',
  next: 'button[aria-label="Next"], button[aria-label="Next Track"]',
};
export async function session(page) {
  if (await page.locator(selectors.signedIn).first().isVisible()) return 'signed_in';
  if (await page.locator(selectors.signedOut).first().isVisible()) return 'signed_out';
  return 'unknown';
}
export async function play(page, link) {
  const url = new URL(link);
  if (url.origin !== 'https://music.apple.com') throw new Error('MEDIA_UNAVAILABLE');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  if (await session(page) === 'signed_out') throw new Error('SIGNED_OUT(applemusic)');
  await page.evaluate(() => window.companionRoute.check());
  await page.locator(selectors.play).first().click({ timeout: 15000 });
}
