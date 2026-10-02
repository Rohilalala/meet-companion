import { setTimeout as delay } from 'node:timers/promises';
import { harness, live, emit, errorCode } from './experiment.js';
import { ChatBot } from '../controller/bot-command.js';
import { playback } from '../controller/playback.js';

let h, bot, interrupted = false, stage = 'launch';
if (!live) {
  console.log('Run npm run bot -- --live to join the configured meeting and listen for /bot <link>.');
} else {
  try {
    // One shutdown path: a signal only sets the flag; the loop exits, the bot clicks Leave, then Chrome closes.
    // `on`, not `once`: a repeated signal must not fall back to Node's default kill mid-cleanup.
    process.on('SIGINT', () => { interrupted = true; });
    process.on('SIGTERM', () => { interrupted = true; });
    h = await harness({ presentation: true, signals: false, headless: !process.argv.includes('--windowed') });
    // `--meeting <link>` joins another meeting than the saved one (validated by meetingURL).
    const meeting = process.argv.indexOf('--meeting');
    stage = 'join'; await h.driver.join(meeting > 0 ? process.argv[meeting + 1] : h.config.meetingLink, { cancelled: () => interrupted });
    bot = new ChatBot({ ...playback(h), leave: async () => { interrupted = true; }, report: observation => emit('BOT', observation) });
    bot.announcePin();
    // Right after joining, Meet popups can cover the chat controls: dismiss and retry.
    stage = 'chat';
    for (let attempt = 1; ; attempt++) {
      try { await h.driver.openChat(message => bot.receive(message)); break; }
      catch (error) { if (attempt === 3) throw error; await h.meet.keyboard.press('Escape'); await delay(2000); }
    }
    emit('BOT', { state: 'LISTENING', cameraOff: true, microphoneOff: true, command: '/bot <link>' });
    while (!interrupted) {
      await delay(1000);
      stage = 'meeting-state'; const state = await h.driver.state();
      if (state !== 'in_call') throw new Error(['REMOVED', 'MEETING_ENDED'].includes(state) ? state : 'MEETING_STATE_UNKNOWN');
      if (!bot.busy) {
        // Keep the chat panel open: commands sent while it is closed may never render.
        stage = 'chat'; await h.driver.openChat().catch(() => {});
        stage = 'route-check';
        try {
          const route = await h.player.evaluate(() => window.companionRoute?.status());
          if (route?.error) throw new Error('AUDIO_ROUTE_LOST');
          // yt-dlp audio and video play in /player; advance the queue when the track ends.
          if ((bot.current?.mode === 'audio' || bot.current?.dlp) && await h.player.evaluate(() => window.companionPlayer?.status().ended ?? false)) await bot.advance(bot.current);
        } catch (error) {
          if (!/Execution context was destroyed|Cannot find context with specified id/i.test(error.message)) throw error;
        }
      }
    }
  } catch (error) {
    emit('BOT', { result: 'STOPPED', stage, error: errorCode(error), errorType: ['Error', 'TypeError', 'ReferenceError', 'TimeoutError'].includes(error.name) ? error.name : 'Other', sourceLocations: error.stack?.match(/\/(?:controller|scripts)\/[\w.-]+\.js:\d+:\d+/g) ?? [], chromeExit: h?.chromeExit?.() });
    process.exitCode = 1;
  }
  // Leave explicitly: closing Chrome alone leaves a ghost participant that changes the next join screen.
  finally { await bot?.close().catch(() => {}); await h?.driver.leave().catch(() => {}); await h?.close(); }
}
