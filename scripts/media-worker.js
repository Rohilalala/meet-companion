import { startMediaWorker } from '../controller/media-relay.js';

if (process.versions.node.split('.')[0] !== '22') throw new Error('NODE_22_REQUIRED');
const port = Number(process.env.MEET_MEDIA_WORKER_PORT ?? 3212);
const worker = await startMediaWorker({ port, token: process.env.MEET_MEDIA_TOKEN });
console.log(JSON.stringify({ state: 'MEDIA_WORKER_READY', port, loopbackOnly: true }));
const close = async () => { await worker.close(); process.exit(0); };
process.once('SIGINT', close); process.once('SIGTERM', close);
