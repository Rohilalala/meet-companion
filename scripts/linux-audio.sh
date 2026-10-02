#!/usr/bin/env bash
# Creates the bot's dedicated audio route on Linux (PulseAudio, or PipeWire through its pulse server).
#   meet_companion          sink the player tab outputs to           (Chrome label: MeetCompanionSink)
#   meet_companion_mic      source fed by that sink, the Meet mic     (Chrome label: MeetCompanionMic)
#   MEET_BOT_SLOT=2..15 creates a separate sink and source per Meet.
#   meet_companion_discard  silent default, so nothing else can reach the meeting by accident
# Idempotent: safe to run again. Nothing here records or stores audio.
set -euo pipefail
slot=${MEET_BOT_SLOT:-1}
case "$slot" in ''|*[!0-9]*) echo 'BOT_SLOT_INVALID' >&2; exit 2 ;; esac
if (( slot < 1 || slot > 15 )); then echo 'BOT_SLOT_INVALID' >&2; exit 2; fi
if (( slot == 1 )); then suffix=; label_suffix=; else suffix="_$slot"; label_suffix=$slot; fi
sink="meet_companion${suffix}"
source="meet_companion_mic${suffix}"

if ! pactl info >/dev/null 2>&1; then
  # Headless server without a session daemon.
  pulseaudio --start --exit-idle-time=-1
  for _ in $(seq 1 20); do pactl info >/dev/null 2>&1 && break; sleep 0.25; done
fi
pactl info >/dev/null

have() { pactl list short "$1" | cut -f2 | grep -qx "$2"; }
have sinks meet_companion_discard || pactl load-module module-null-sink sink_name=meet_companion_discard sink_properties=device.description=MeetCompanionDiscard >/dev/null
have sinks "$sink" || pactl load-module module-null-sink sink_name="$sink" sink_properties="device.description=MeetCompanionSink${label_suffix}" >/dev/null
have sources "$source" || pactl load-module module-remap-source master="${sink}.monitor" source_name="$source" source_properties="device.description=MeetCompanionMic${label_suffix}" >/dev/null

# Fail closed: the route is never the default device. Chrome must pick it by exact name.
pactl set-default-sink meet_companion_discard
pactl set-default-source meet_companion_discard.monitor
echo "Audio route ready: $sink -> $source (default sink: $(pactl get-default-sink))"
