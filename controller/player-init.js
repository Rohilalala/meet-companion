// Only output-device selection: never capture service media into a Web Audio graph.
export function playerInit() {
  if (window.companionRoute) return;
  const nativePlay = HTMLMediaElement.prototype.play;
  const nativeSink = HTMLMediaElement.prototype.setSinkId;
  const nativeMuted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
  const media = new Set(), contexts = new Set();
  const routed = new WeakSet(), desiredMuted = new WeakMap();
  const routing = new WeakMap();
  let pausedMedia = null, pausedContexts = [];
  let error = null, errorName = null, level = 1;
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
  function route(element) {
    if (routing.has(element)) return routing.get(element);
    if (!desiredMuted.has(element)) desiredMuted.set(element, nativeMuted.get.call(element));
    media.add(element);
    routed.delete(element); nativeMuted.set.call(element, true);
    const operation = (async () => {
      try {
        if (!nativeSink) throw new Error('AUDIO_ROUTE_LOST');
        const id = await device();
        if (element.sinkId !== id) await nativeSink.call(element, id);
        routed.add(element); nativeMuted.set.call(element, desiredMuted.get(element)); element.volume = level;
      } catch (cause) { errorName = cause.name; throw fail(cause.message); }
    })().finally(() => routing.delete(element));
    routing.set(element, operation);
    return operation;
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
    const close = NativeContext.prototype.close;
    const readiness = new WeakMap();
    NativeContext.prototype.setSinkId = async function () {
      try { if (!sink) throw new Error('AUDIO_ROUTE_LOST'); await sink.call(this, await device()); }
      catch (cause) {
        if (this.state === 'closed') throw cause;
        errorName = cause.name; throw fail(cause.message);
      }
    };
    NativeContext.prototype.close = function () { contexts.delete(this); return close.call(this); };
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
    // Revalidate the exact sink without leaving healthy playback paused.
    // route() mutes HTML output until validation finishes and fails closed.
    media.forEach(element => { route(element).catch(() => {}); });
    contexts.forEach(context => { if (context.state !== 'closed') context.setSinkId().catch(() => {}); });
  });
  observe(document);
  window.companionRoute = {
    // ponytail: HTML media only; a player that mixes through Web Audio would need a gain node.
    volume(value) { level = Math.min(1, Math.max(0, Number(value) || 0)); media.forEach(element => { element.volume = level; }); },
    pause({ detachedOnly = false } = {}) {
      if (pausedMedia) return;
      pausedMedia = [...media].filter(element => !element.paused && !element.ended && (!detachedOnly || !element.isConnected));
      pausedContexts = [...contexts].filter(context => context.state === 'running');
      media.forEach(element => element.pause());
      return Promise.all(pausedContexts.map(context => context.suspend()));
    },
    async resume() {
      if (!pausedMedia) return;
      await device();
      for (const element of pausedMedia) await element.play();
      for (const context of pausedContexts) await context.resume();
      pausedMedia = null; pausedContexts = [];
    },
    positions({ detachedOnly = false } = {}) {
      return [...media].filter(element => (!detachedOnly || !element.isConnected) && !element.paused && !element.ended && element.readyState >= 2)
        .map(element => element.currentTime);
    },
    async check() { try { await device(); error = null; return { ok: true }; } catch (cause) { throw fail(cause.message); } },
    status() { return { error, errorName: ['NotAllowedError', 'NotFoundError', 'NotSupportedError', 'AbortError', 'InvalidStateError', 'TypeError', 'Error'].includes(errorName) ? errorName : null, elements: media.size, contexts: contexts.size, playingElements: [...media].filter(element => !element.paused && !element.ended && element.currentTime > 0).length, runningContexts: [...contexts].filter(context => context.state === 'running').length }; },
  };
}
