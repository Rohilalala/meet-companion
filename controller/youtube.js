export const selectors = {
  video: 'video.html5-main-video',
  play: '.ytp-play-button[title^="Play"]',
  pause: '.ytp-play-button[title^="Pause"]',
  fullscreen: '.ytp-fullscreen-button',
};
export async function prepare(page, link, title) {
  if (new URL(link).origin !== 'https://www.youtube.com') throw new Error('MEDIA_UNAVAILABLE');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.locator(selectors.video).first().waitFor({ timeout: 15000 });
  await page.evaluate(title => {
    document.querySelectorAll('video,audio').forEach(media => media.pause());
    // A unique title confines Chrome's presentation picker to this player tab.
    const set = () => { if (document.title !== title) document.title = title; };
    set(); new MutationObserver(set).observe(document.querySelector('title'), { childList: true });
    const style = document.createElement('style');
    style.textContent = 'video.html5-main-video { object-fit: contain !important; object-position: center !important; }';
    document.head.append(style);
  }, title);
  await page.bringToFront();
  if (!(await page.evaluate(() => document.fullscreenElement?.contains(document.querySelector('video.html5-main-video'))))) {
    await page.locator(selectors.fullscreen).click({ timeout: 5000 });
  }
  await page.waitForFunction(() => {
    const video = document.querySelector('video.html5-main-video');
    const player = document.querySelector('#movie_player')?.getBoundingClientRect();
    return document.fullscreenElement?.contains(video) && player &&
      Math.abs(player.x) < 2 && Math.abs(player.y) < 2 &&
      Math.abs(player.width - innerWidth) < 2 && Math.abs(player.height - innerHeight) < 2;
  }, null, { timeout: 5000 }).catch(() => { throw new Error('YOUTUBE_FULLSCREEN_UNVERIFIED'); });
}
export async function play(page) {
  const button = page.locator(selectors.play).first();
  if (await button.isVisible()) await button.click();
  else await page.locator(selectors.video).first().evaluate(media => media.play());
}
