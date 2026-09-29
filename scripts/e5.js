import { setTimeout as delay } from 'node:timers/promises';
import { live, run, emit, blocked, harness, answer } from './experiment.js';
await run('E5', async () => {
  if (!live) return blocked('E5', ['--live', 'meetingLink', 'chatParticipants: two exact display names', '50 synthetic messages including bursts']);
  const h = await harness();
  try {
    const names = h.config.chatParticipants;
    if (!h.config.meetingLink || !Array.isArray(names) || names.length !== 2 || names.some(name => typeof name !== 'string' || !name.trim()) || names[0] === names[1]) return blocked('E5', ['meetingLink and two distinct chatParticipants']);
    emit('E5', { admission: await h.driver.join(h.config.meetingLink) });
    const seen = new Set(), senders = [0, 0], latencies = [];
    let duplicates = 0, wrongSender = 0;
    await h.driver.openChat(message => {
      const match = /^E5 ([AB]) (\d{1,2})(?: (\d{13}))?$/.exec(message.text);
      if (!match) return;
      const participant = match[1] === 'A' ? 0 : 1, sequence = Number(match[2]);
      if (sequence < 1 || sequence > 25) return;
      if (message.sender !== names[participant]) { wrongSender++; return; }
      const key = `${participant}:${sequence}`;
      if (seen.has(key)) { duplicates++; return; }
      seen.add(key); senders[participant]++;
      const offset = h.config.chatClockOffsetsMs?.[participant];
      if (match[3] && Number.isFinite(offset)) {
        const latency = message.receivedAt - (Number(match[3]) + offset);
        if (latency >= 0) latencies.push(latency);
      }
    });
    console.log('Each participant sends 25 messages: E5 A 1 through E5 A 25; participant B uses B. Optionally append the 13-digit send-time milliseconds for latency measurement. Include interleaved bursts. No received message bodies or names are logged.');
    const started = Date.now();
    while (seen.size < 50 && Date.now() - started < 180000) {
      await delay(1000);
      if (Math.floor((Date.now() - started) / 1000) % 15 === 0) emit('E5', { received: seen.size, expected: 50, running: true });
    }
    await delay(2000);
    await h.driver.sendChat('Meet Companion E5 diagnostic: message receipt complete.');
    const reply = await answer('Participants saw the bot diagnostic reply? [yes/no/unobserved]');
    latencies.sort((a, b) => a - b);
    const percentile = p => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;
    const passed = seen.size === 50 && wrongSender === 0 && reply === 'yes';
    emit('E5', { received: seen.size, expected: 50, captureRate: seen.size / 50, perParticipant: senders, duplicates, wrongSender, latencySamples: latencies.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1), replyObserved: reply === 'yes' ? true : reply === 'no' ? false : null, gate: passed ? 'CHAT_CANDIDATE_REVIEW_LATENCIES' : 'CHAT_UNAVAILABLE' });
    await h.driver.leave();
  } finally { await h.close(); }
});
