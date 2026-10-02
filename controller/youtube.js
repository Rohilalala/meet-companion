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
  await page.bringToFront();
  // YouTube can start an ad after the video element appears. Pausing it here
  // freezes the ad and leaves the requested video in a non-fullscreen layout.
  await page.waitForFunction(() => {
    const player = document.querySelector('#movie_player');
    const video = document.querySelector('video.html5-main-video');
    if (!player || !video || video.readyState < 2 || player.classList.contains('ad-showing')) {
      window.companionNoAdSince = 0;
      return false;
    }
    window.companionNoAdSince ||= performance.now();
    return performance.now() - window.companionNoAdSince >= 2000;
  }, null, { timeout: 90000 }).catch(() => { throw new Error('YOUTUBE_CONTENT_NOT_READY'); });
  await page.evaluate(title => {
    // A unique title confines Chrome's presentation picker to this player tab.
    const set = () => { if (document.title !== title) document.title = title; };
    set(); new MutationObserver(set).observe(document.querySelector('title'), { childList: true });
    const style = document.createElement('style');
    style.textContent = `
      :fullscreen #movie_player, #movie_player:fullscreen {
        position: fixed !important; inset: 0 !important;
        width: 100vw !important; height: 100vh !important;
        max-width: none !important; max-height: none !important;
        margin: 0 !important; border-radius: 0 !important;
        z-index: 2147483647 !important;
      }
      :fullscreen video.html5-main-video {
        position: fixed !important; inset: 0 !important;
        width: 100vw !important; height: 100vh !important;
        object-fit: contain !important; object-position: center !important;
      }`;
    document.head.append(style);
  }, title);
  if (!(await page.evaluate(() => document.fullscreenElement?.contains(document.querySelector('video.html5-main-video'))))) {
    // YouTube may navigate as an ad finishes after the click. The geometry check
    // below decides whether fullscreen actually happened.
    await page.locator(selectors.fullscreen).click({ timeout: 5000, noWaitAfter: true }).catch(() => {});
  }
  await page.waitForFunction(() => {
    const video = document.querySelector('video.html5-main-video');
    const node = document.querySelector('#movie_player');
    const player = node?.getBoundingClientRect();
    const videoBox = video?.getBoundingClientRect();
    return !node?.classList.contains('ad-showing') && document.fullscreenElement?.contains(video) && player && videoBox &&
      Math.abs(player.x) < 2 && Math.abs(player.y) < 2 &&
      Math.abs(player.width - innerWidth) < 2 && Math.abs(player.height - innerHeight) < 2 &&
      Math.abs(videoBox.width - innerWidth) < 2 && Math.abs(videoBox.height - innerHeight) < 2;
  }, null, { timeout: 5000 }).catch(() => { throw new Error('YOUTUBE_FULLSCREEN_UNVERIFIED'); });
  await page.evaluate(() => {
    document.querySelectorAll('video,audio').forEach(media => media.pause());
    const video = document.querySelector('video.html5-main-video');
    if (video?.seekable.length) video.currentTime = 0;
  });
}
export async function play(page) {
  const button = page.locator(selectors.play).first();
  if (await button.isVisible()) await button.click();
  else await page.locator(selectors.video).first().evaluate(media => media.play());
}
