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
    stage = 'join'; await h.driver.join(h.config.meetingLink);
    bot = new ChatBot({ ...playback(h), report: observation => emit('BOT', observation) });
    stage = 'chat'; await h.driver.openChat(message => bot.receive(message));
    emit('BOT', { state: 'LISTENING', cameraOff: true, microphoneOff: true, command: '/bot <link>' });
    while (!interrupted) {
      await delay(1000);
      stage = 'meeting-state'; const state = await h.driver.state();
      if (state !== 'in_call') throw new Error(['REMOVED', 'MEETING_ENDED'].includes(state) ? state : 'MEETING_STATE_UNKNOWN');
      if (!bot.busy) {
        stage = 'route-check';
        try {
          const route = await h.player.evaluate(() => window.companionRoute?.status());
          if (route?.error) throw new Error('AUDIO_ROUTE_LOST');
        } catch (error) {
          if (!/Execution context was destroyed|Cannot find context with specified id/i.test(error.message)) throw error;
        }
      }
    }
  } catch (error) {
    emit('BOT', { result: 'STOPPED', stage, error: errorCode(error), errorType: ['Error', 'TypeError', 'ReferenceError', 'TimeoutError'].includes(error.name) ? error.name : 'Other', sourceLocations: error.stack?.match(/\/(?:controller|scripts)\/[\w.-]+\.js:\d+:\d+/g) ?? [] });
    process.exitCode = 1;
  }
  finally { await bot?.close().catch(() => {}); await h?.close(); }
}
