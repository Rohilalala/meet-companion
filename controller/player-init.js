// Only output-device selection: never capture service media into a Web Audio graph.
export function playerInit() {
  if (window.companionRoute) return;
  const nativePlay = HTMLMediaElement.prototype.play;
  const nativeSink = HTMLMediaElement.prototype.setSinkId;
  const nativeMuted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
  const media = new Set(), contexts = new Set();
  const routed = new WeakSet(), desiredMuted = new WeakMap();
  let error = null;
  async function device() {
    const outputs = await navigator.mediaDevices.enumerateDevices();
    const match = outputs.find(item => item.kind === 'audiooutput' && /^BlackHole 2ch(?: \(Virtual\))?$/i.test(item.label));
    if (!match) throw new Error('BLACKHOLE_2CH_MISSING');
    return match.deviceId;
  }
  function fail(reason) {
    error = reason === 'BLACKHOLE_2CH_MISSING' ? reason : 'AUDIO_ROUTE_LOST';
    media.forEach(element => { element.pause(); routed.delete(element); nativeMuted.set.call(element, true); });
    contexts.forEach(context => context.suspend().catch(() => {}));
    return new Error(error);
  }
  async function route(element) {
    if (!desiredMuted.has(element)) desiredMuted.set(element, nativeMuted.get.call(element));
    media.add(element);
    routed.delete(element); nativeMuted.set.call(element, true);
    try {
      if (!nativeSink) throw new Error('AUDIO_ROUTE_LOST');
      await nativeSink.call(element, await device());
      routed.add(element); nativeMuted.set.call(element, desiredMuted.get(element));
    } catch (cause) { throw fail(cause.message); }
  }
  HTMLMediaElement.prototype.setSinkId = function () { return route(this); };
  Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
    configurable: true, get() { return nativeMuted.get.call(this); },
    set(value) { desiredMuted.set(this, Boolean(value)); nativeMuted.set.call(this, routed.has(this) ? Boolean(value) : true); },
  });
  HTMLMediaElement.prototype.play = async function () { await route(this); return nativePlay.call(this); };
  const pending = new WeakSet();
  function enroll(element) {
    if (!(element instanceof HTMLMediaElement) || media.has(element)) return;
    media.add(element);
    const autoplay = element.autoplay;
    element.autoplay = false; element.pause();
    route(element).then(() => { if (autoplay) return element.play(); }).catch(() => {});
  }
  const scan = root => {
    enroll(root);
    root.querySelectorAll?.('audio,video').forEach(enroll);
  };
  const observe = root => {
    new MutationObserver(records => records.forEach(record => {
      if (record.type === 'attributes') enroll(record.target);
      record.addedNodes.forEach(scan);
    })).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['autoplay', 'src'] });
    scan(root);
  };
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) { const root = attachShadow.call(this, options); observe(root); return root; };
  const NativeAudio = window.Audio;
  window.Audio = new Proxy(NativeAudio, { construct(Target, args) { const element = Reflect.construct(Target, args); enroll(element); return element; } });
  const createElement = Document.prototype.createElement;
  Document.prototype.createElement = function (...args) { const element = createElement.apply(this, args); enroll(element); return element; };
  document.addEventListener('play', event => {
    const element = event.target;
    if (!(element instanceof HTMLMediaElement) || pending.has(element)) return;
    // Native autoplay also passes through this guard; never intentionally continue on the default sink.
    if (!routed.has(element)) {
      nativeMuted.set.call(element, true); element.pause(); pending.add(element);
      route(element).then(() => nativePlay.call(element)).catch(() => {}).finally(() => pending.delete(element));
    }
  }, true);
  const NativeContext = window.AudioContext;
  if (NativeContext) {
    const sink = NativeContext.prototype.setSinkId;
    const resume = NativeContext.prototype.resume;
    const readiness = new WeakMap();
    NativeContext.prototype.setSinkId = async function () {
      try { if (!sink) throw new Error('AUDIO_ROUTE_LOST'); await sink.call(this, await device()); }
      catch (cause) { throw fail(cause.message); }
    };
    NativeContext.prototype.resume = async function () { await readiness.get(this); await this.setSinkId(); return resume.call(this); };
    const Wrapped = new Proxy(NativeContext, { construct(Target, args) {
      // Chrome supports the silent sink: no audio reaches the default device during async lookup.
      const context = Reflect.construct(Target, [{ ...args[0], sinkId: { type: 'none' } }]);
      contexts.add(context);
      const ready = context.setSinkId(); readiness.set(context, ready); ready.catch(() => {});
      return context;
    } });
    window.AudioContext = Wrapped;
    if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
  }
  navigator.mediaDevices.addEventListener('devicechange', () => {
    media.forEach(element => { element.pause(); route(element).catch(() => {}); });
    contexts.forEach(context => { context.suspend().catch(() => {}); context.setSinkId().catch(() => {}); });
  });
  observe(document);
  window.companionRoute = {
    async check() { try { await device(); error = null; return { ok: true }; } catch (cause) { throw fail(cause.message); } },
    status() { return { error, elements: media.size, contexts: contexts.size, playingElements: [...media].filter(element => !element.paused && !element.ended && element.currentTime > 0).length, runningContexts: [...contexts].filter(context => context.state === 'running').length }; },
  };
}
