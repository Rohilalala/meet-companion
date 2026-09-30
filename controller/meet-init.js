// Serialized by Playwright; keep this function self-contained.
export function meetInit() {
  if (window.meetCompanion) return;
  const devices = navigator.mediaDevices;
  const enumerate = devices.enumerateDevices.bind(devices);
  const gum = devices.getUserMedia.bind(devices);
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  let frame = 0, epoch = null, error = null;
  const inputs = new Set();
  const peers = new Set(), NativePeer = window.RTCPeerConnection;
  if (NativePeer) window.RTCPeerConnection = new Proxy(NativePeer, { construct(Target, args) {
    const peer = Reflect.construct(Target, args); peers.add(peer);
    peer.addEventListener('connectionstatechange', () => { if (peer.connectionState === 'closed') peers.delete(peer); });
    return peer;
  } });
  function draw() {
    const elapsed = Date.now() - (epoch ?? Date.now());
    const flash = epoch !== null && elapsed >= 0 && elapsed % 2000 < 100;
    ctx.fillStyle = flash ? '#ffffff' : '#131821'; ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = flash ? '#131821' : '#ffffff';
    ctx.font = '48px sans-serif'; ctx.fillText('Meet Companion', 64, 92);
    if (epoch !== null) {
      ctx.font = '28px monospace'; ctx.fillText(`Frame ${frame++}`, 64, 150);
      [12, 16, 20, 24, 32, 48].forEach((size, index) => {
        ctx.font = `${size}px sans-serif`; ctx.fillText(`${size}px — ABC abc 0123456789`, 64, 220 + index * 70);
      });
    }
  }
  draw();
  setInterval(draw, 1000 / 30);
  const camera = () => {
    const track = canvas.captureStream(30).getVideoTracks()[0];
    Object.defineProperty(track, 'label', { value: 'Meet Companion Cam' });
    return track;
  };
  devices.enumerateDevices = async () => [
    ...(await enumerate()).filter(device => device.kind !== 'videoinput'),
    { kind: 'videoinput', deviceId: 'meet-companion-canvas', groupId: 'meet-companion', label: 'Meet Companion Cam', toJSON() { return { kind: this.kind, deviceId: this.deviceId, groupId: this.groupId, label: this.label }; } },
  ];
  devices.getUserMedia = async (constraints = {}) => {
    if (!constraints.audio && !constraints.video) throw new TypeError('MEDIA_CONSTRAINTS_REQUIRED');
    let stream = new MediaStream();
    if (constraints.audio) {
      const input = (await enumerate()).find(device => device.kind === 'audioinput' && /^BlackHole 2ch(?: \(Virtual\))?$/i.test(device.label));
      if (!input) { error = 'BLACKHOLE_2CH_MISSING'; throw new DOMException(error, 'NotFoundError'); }
      stream = await gum({ audio: { deviceId: { exact: input.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      for (const track of stream.getAudioTracks()) {
        const apply = track.applyConstraints.bind(track);
        track.applyConstraints = constraints => apply({
          ...constraints, deviceId: { exact: input.deviceId },
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          ...(constraints?.advanced ? { advanced: constraints.advanced.map(item => ({ ...item, echoCancellation: false, noiseSuppression: false, autoGainControl: false })) } : {}),
        });
        inputs.add(track);
        track.addEventListener('ended', () => inputs.delete(track), { once: true });
      }
    }
    if (constraints.video) stream.addTrack(camera());
    return stream;
  };
  // The Meet tab never renders meeting audio, including detached elements and later unmute attempts.
  const muted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
  Object.defineProperty(HTMLMediaElement.prototype, 'muted', { configurable: true, get() { return true; }, set() { muted.set.call(this, true); } });
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { muted.set.call(this, true); return play.call(this); };
  const silence = root => {
    if (root instanceof HTMLMediaElement) muted.set.call(root, true);
    root.querySelectorAll?.('audio,video').forEach(element => muted.set.call(element, true));
  };
  const observe = root => {
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(silence))).observe(root, { subtree: true, childList: true });
    silence(root);
  };
  const NativeAudio = window.Audio;
  window.Audio = new Proxy(NativeAudio, { construct(Target, args) { const element = Reflect.construct(Target, args); silence(element); return element; } });
  const createElement = Document.prototype.createElement;
  Document.prototype.createElement = function (...args) { const element = createElement.apply(this, args); silence(element); return element; };
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) { const root = attachShadow.call(this, options); observe(root); return root; };
  observe(document);
  document.addEventListener('play', event => silence(event.target), true);
  document.addEventListener('volumechange', event => { if (event.target instanceof HTMLMediaElement && !muted.get.call(event.target)) muted.set.call(event.target, true); }, true);
  silence(document);
  // Web Audio bypasses HTMLMediaElement.muted. Meet must never render it to
  // speakers or BlackHole; only the separate player tab may output audio.
  const NativeContext = window.AudioContext;
  if (NativeContext) {
    const setSink = NativeContext.prototype.setSinkId;
    NativeContext.prototype.setSinkId = async function () {
      if (!setSink) throw new Error('MEET_SILENT_OUTPUT_UNAVAILABLE');
      return setSink.call(this, { type: 'none' });
    };
    const SilentContext = new Proxy(NativeContext, { construct(Target, args) {
      if (!setSink) throw new Error('MEET_SILENT_OUTPUT_UNAVAILABLE');
      const context = Reflect.construct(Target, [{ ...args[0], sinkId: { type: 'none' } }]);
      if (context.sinkId?.type !== 'none') {
        context.close().catch(() => {});
        throw new Error('MEET_SILENT_OUTPUT_UNAVAILABLE');
      }
      return context;
    } });
    window.AudioContext = SilentContext;
    if (window.webkitAudioContext) window.webkitAudioContext = SilentContext;
  }
  window.meetCompanion = {
    senderParameters() {
      return [...peers].flatMap(peer => peer.getSenders().filter(sender => sender.track?.kind === 'video').map(sender => {
        const parameters = sender.getParameters();
        return { contentHint: sender.track.contentHint, degradationPreference: parameters.degradationPreference, encodings: parameters.encodings?.map(value => ({ active: value.active, maxFramerate: value.maxFramerate, maxBitrate: value.maxBitrate, scaleResolutionDownBy: value.scaleResolutionDownBy })) };
      }));
    },
    async sendStats() {
      const observations = [];
      for (const peer of peers) {
        if (peer.signalingState === 'closed') continue;
        const stats = await peer.getStats();
        stats.forEach(value => {
          if (value.type !== 'outbound-rtp' || value.kind !== 'video') return;
          observations.push({ framesPerSecond: value.framesPerSecond, width: value.frameWidth, height: value.frameHeight, framesEncoded: value.framesEncoded, totalEncodeTime: value.totalEncodeTime, bytesSent: value.bytesSent, qualityLimitationReason: ['none', 'cpu', 'bandwidth', 'other'].includes(value.qualityLimitationReason) ? value.qualityLimitationReason : null });
        });
      }
      return observations;
    },
    // Numbers only: what Meet actually encodes for the mic (bitrate, channels, Opus fmtp such as stereo/maxaveragebitrate).
    async audioStats() {
      const observations = [];
      for (const peer of peers) {
        if (peer.signalingState === 'closed') continue;
        const stats = await peer.getStats();
        stats.forEach(value => {
          if (value.type !== 'outbound-rtp' || value.kind !== 'audio') return;
          const codec = stats.get(value.codecId);
          observations.push({ bytesSent: value.bytesSent, packetsSent: value.packetsSent, targetBitrate: value.targetBitrate, timestamp: value.timestamp, mimeType: codec?.mimeType, channels: codec?.channels, fmtp: codec?.sdpFmtpLine });
        });
      }
      return observations;
    },
    camtest(startAt = Date.now() + 1000) { epoch = startAt; return { width: canvas.width, height: canvas.height, requestedFps: 30, epoch }; },
    stopCamtest() { epoch = null; },
    inputSettings() { return [...inputs].filter(track => track.readyState === 'live').map(track => { const settings = track.getSettings(); return { echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl, sampleRate: settings.sampleRate, channelCount: settings.channelCount }; }); },
    status() { return { canvasWidth: canvas.width, canvasHeight: canvas.height, diagnostic: epoch !== null, framesDrawn: frame, error }; },
  };
}
