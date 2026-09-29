export async function camtest(meet, player) {
  const epoch = Date.now() + 1500;
  await player.evaluate(epoch => window.companionPlayer.camtest(epoch), epoch);
  const canvas = await meet.evaluate(epoch => window.meetCompanion.camtest(epoch), epoch);
  return { ...canvas, receiverStats: null, flashToBeepOffsetMs: null };
}
