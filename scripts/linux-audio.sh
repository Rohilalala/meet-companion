#!/usr/bin/env bash
# Creates the bot's dedicated audio route on Linux (PulseAudio, or PipeWire through its pulse server).
#   meet_companion          sink the player tab outputs to           (Chrome label: MeetCompanionSink)
#   meet_companion_mic      source fed by that sink, the Meet mic     (Chrome label: MeetCompanionMic)
#   meet_companion_discard  silent default, so nothing else can reach the meeting by accident
# Idempotent: safe to run again. Nothing here records or stores audio.
set -euo pipefail

if ! pactl info >/dev/null 2>&1; then
  # Headless server without a session daemon.
  pulseaudio --start --exit-idle-time=-1
  for _ in $(seq 1 20); do pactl info >/dev/null 2>&1 && break; sleep 0.25; done
fi
pactl info >/dev/null

have() { pactl list short "$1" | cut -f2 | grep -qx "$2"; }
have sinks meet_companion_discard || pactl load-module module-null-sink sink_name=meet_companion_discard sink_properties=device.description=MeetCompanionDiscard >/dev/null
have sinks meet_companion || pactl load-module module-null-sink sink_name=meet_companion sink_properties=device.description=MeetCompanionSink >/dev/null
have sources meet_companion_mic || pactl load-module module-remap-source master=meet_companion.monitor source_name=meet_companion_mic source_properties=device.description=MeetCompanionMic >/dev/null

# Fail closed: the route is never the default device. Chrome must pick it by exact name.
pactl set-default-sink meet_companion_discard
pactl set-default-source meet_companion_discard.monitor
echo "Audio route ready: meet_companion -> meet_companion_mic (default sink: $(pactl get-default-sink))"
