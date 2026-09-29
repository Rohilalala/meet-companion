import { live, run, emit, blocked, harness, answer } from './experiment.js';
import { camtest } from '../controller/camtest.js';
await run('E4', async () => {
  if (!live) return blocked('E4', ['--live', 'BlackHole', 'meetingLink', 'consenting test participants', 'receiver laptop/phone']);
  const confirmed = await answer('Camtest only: participants agreed, cameras off and silent; frame only bot tile; no protected music; bot Video framing off and Show my full video on? [yes/no]');
  if (confirmed !== 'yes') return blocked('E4', ['camtest conditions']);
  const h = await harness();
  try {
    if (!h.config.meetingLink) return blocked('E4', ['meetingLink']);
    emit('E4', { admission: await h.driver.join(h.config.meetingLink) });
    await h.driver.unmute(); await h.driver.camera(true);
    emit('E4', { source: await camtest(h.meet, h.player), filming: 'Human only; bot tile only; ignored .local/evidence/; delete footage after extracting offsets.' });
    for (const receiver of ['laptop-pinned', 'laptop-unpinned', 'phone-pinned', 'phone-unpinned']) {
      const values = {};
      for (const field of ['frameWidth', 'frameHeight', 'framesPerSecond', 'framesDroppedDelta', 'intervalSeconds', 'smallestReadablePx', 'flashToBeepOffsetMs']) {
        const raw = await answer(`${receiver} ${field} (positive offset = beep after flash; blank = unmeasured):`);
        const number = raw && raw !== 'unobserved' ? Number(raw) : NaN;
        values[field] = Number.isFinite(number) && (field === 'flashToBeepOffsetMs' || number >= 0) ? number : null;
      }
      emit('E4', { receiver, measurements: values, provenance: 'human receiver observation' });
    }
    emit('E4', { playerTiming: await h.player.evaluate(() => window.companionPlayer.status()), sender: await h.meet.evaluate(() => window.meetCompanion.status()) });
    await h.player.evaluate(() => window.companionPlayer.stop());
    await h.driver.camera(false); await h.driver.leave();
    const deleted = await answer('After extracting offsets, delete the human footage from .local/evidence/. Done? [yes/no]');
    emit('E4', { humanFootageDeleted: deleted === 'yes' ? true : null, gate: 'E4 is nonfatal; retain only numeric observations in FEASIBILITY.md.' });
  } finally { await h.close(); }
});
