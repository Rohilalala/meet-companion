// Use Meet's own native display stream. Never read or record its media.
export function presentationInit() {
  const nativeDisplay = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
  let armed = false, stream = null, error = null, errorName = null;
  const videoTracks = new Set();
  navigator.mediaDevices.getDisplayMedia = async options => {
    if (!armed || !nativeDisplay) throw new DOMException('PRESENTATION_NOT_ARMED', 'NotAllowedError');
    armed = false;
    try {
      stream = await nativeDisplay({
        ...options, video: { displaySurface: 'browser', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: { suppressLocalAudioPlayback: true },
        preferCurrentTab: false, selfBrowserSurface: 'exclude',
        systemAudio: 'exclude', monitorTypeSurfaces: 'exclude', surfaceSwitching: 'exclude',
      });
      if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== 'browser' || !stream.getAudioTracks().length) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('PRESENTATION_TAB_AUDIO_REQUIRED');
      }
      const configure = track => {
        videoTracks.add(track);
        const hint = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'contentHint');
        if (hint?.set) {
          hint.set.call(track, 'motion');
          Object.defineProperty(track, 'contentHint', { configurable: true, get: () => 'motion', set: () => hint.set.call(track, 'motion') });
        }
        const apply = track.applyConstraints.bind(track);
        track.applyConstraints = constraints => {
          const { advanced, ...rest } = constraints ?? {};
          return apply({ ...rest, width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 30, max: 30 } });
        };
        const clone = track.clone.bind(track);
        track.clone = () => { const copy = clone(); configure(copy); return copy; };
      };
      configure(stream.getVideoTracks()[0]);
      await stream.getVideoTracks()[0].applyConstraints();
      error = null; return stream;
    } catch (cause) {
      errorName = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'InvalidStateError', 'TypeError', 'Error'].includes(cause.name) ? cause.name : 'UnknownError';
      error = cause.message === 'PRESENTATION_TAB_AUDIO_REQUIRED' ? cause.message : 'PRESENTATION_FAILED';
      throw new Error(error);
    }
  };
  window.companionPresentation = {
    arm() { armed = true; error = null; errorName = null; },
    stop() { armed = false; stream?.getTracks().forEach(track => track.stop()); videoTracks.forEach(track => track.stop()); videoTracks.clear(); stream = null; },
    mute(value) { stream?.getAudioTracks().forEach(track => { track.enabled = !value; }); },
    status() {
      const video = [...videoTracks].find(track => track.readyState === 'live'), settings = video?.getSettings();
      return { active: video?.readyState === 'live', audio: !!stream?.getAudioTracks().some(track => track.readyState === 'live'), displaySurface: settings?.displaySurface, width: settings?.width, height: settings?.height, frameRate: settings?.frameRate, contentHint: video?.contentHint, error, errorName };
    },
  };
}
