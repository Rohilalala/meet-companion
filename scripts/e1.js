import { live, run, emit, blocked, harness, answer } from './experiment.js';
await run('E1', async () => {
  if (!live) return blocked('E1', ['--live', 'BlackHole', 'manual bot login', 'configured meeting and cooperating host']);
  const h = await harness();
  try {
    const route = process.argv.find(arg => arg.startsWith('--route='))?.slice(8) ?? 'invitee';
    if (!['invitee', 'knock', 'external', 'member'].includes(route)) throw new Error('ADMISSION_ROUTE_INVALID');
    const link = route === 'external' ? h.config.externalMeetingLink : h.config.meetingLink;
    if (!link) return blocked('E1', [route === 'external' ? 'externalMeetingLink' : 'meetingLink']);
    const configured = await answer(`Host: ${route} test access/invitation settings prepared? [yes/no]`);
    if (configured !== 'yes') return blocked('E1', ['host-prepared route']);
    let botInCall = false;
    try {
      emit('E1', { route, bot: await h.driver.join(link) });
      botInCall = true;
    } catch (error) { emit('E1', { route, botResult: (await import('./experiment.js')).errorCode(error) }); }
    const host = await answer('Host observation: [admitted/request-seen/auto-denied/no-request/unobserved]');
    emit('E1', { route, admissionConfirmed: botInCall && host === 'admitted', hostObservation: ['admitted', 'request-seen', 'auto-denied', 'no-request'].includes(host) ? host : 'unobserved', exactUIWording: 'Transcribe sanitized host/bot system wording directly into FEASIBILITY.md; no chat or links.', gate: 'Evaluate invitee, knock and member outcomes together; all failing means STOP.' });
    if (botInCall) await h.driver.leave();
  } finally { await h.close(); }
});
