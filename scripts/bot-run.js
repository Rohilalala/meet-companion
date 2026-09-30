import { setTimeout as delay } from 'node:timers/promises';
import { harness, live, emit, errorCode } from './experiment.js';
import { ChatBot } from '../controller/bot-command.js';
import { playback } from '../controller/playback.js';

let h, bot, interrupted = false, stage = 'launch';
if (!live) {
  console.log('Run npm run bot -- --live to join the configured meeting and listen for /bot <link>.');
} else {
  try {
    h = await harness({ presentation: true });
    process.once('SIGINT', () => { interrupted = true; });
    process.once('SIGTERM', () => { interrupted = true; });
    // `--meeting <link>` joins another meeting than the saved one (validated by meetingURL).
    const meeting = process.argv.indexOf('--meeting');
    stage = 'join'; await h.driver.join(meeting > 0 ? process.argv[meeting + 1] : h.config.meetingLink);
    bot = new ChatBot({ ...playback(h), report: observation => emit('BOT', observation) });
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
          // yt-dlp audio plays in /player; advance the queue when its track ends.
          if (bot.current?.mode === 'audio' && await h.player.evaluate(() => window.companionPlayer?.status().ended ?? false)) await bot.advance();
        } catch (error) {
          if (!/Execution context was destroyed|Cannot find context with specified id/i.test(error.message)) throw error;
        }
      }
    }
  } catch (error) {
    emit('BOT', { result: 'STOPPED', stage, error: errorCode(error), errorType: ['Error', 'TypeError', 'ReferenceError', 'TimeoutError'].includes(error.name) ? error.name : 'Other', sourceLocations: error.stack?.match(/\/(?:controller|scripts)\/[\w.-]+\.js:\d+:\d+/g) ?? [] });
    process.exitCode = 1;
  }
  // Leave explicitly: closing Chrome alone leaves a ghost participant that changes the next join screen.
  finally { await bot?.close().catch(() => {}); await h?.driver.leave().catch(() => {}); await h?.close(); }
}
