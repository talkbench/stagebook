#!/usr/bin/env bash
# Test fixtures for the channel-order probe (#663). Served by Vite to the
# component tests in src/audioProbe/; not shipped in the npm package.
#
#   tone_<C>ch.mp4       A group recording's layout: an H.264 video track, a
#                        C-channel family-255 Opus track, then a stereo AAC
#                        mix, both audio tracks `default`. Source channel k
#                        carries a continuous sine at TONES[k], so playing it
#                        shows which decoded channel carries which source
#                        channel, independently of the calibration markers.
#   sim_mixed_<C>ch.mp4  What a browser that mixes both enabled audio tracks
#                        would decode: the shipped calibration asset's Opus
#                        channels, with its own stereo AAC fallback added on
#                        channels 0 and 1. Built from the asset rather than
#                        from the spec, so the tone is at the level the
#                        pipeline encoded it (-30 dBFS, though the sidecar
#                        records 0.25). The probe must fail it.
#
# Audio encoder arguments match the pipeline's (compose_group 2.0.0,
# `build_audio_output_args`). Requires an ffmpeg with libopus and libx264.
# Run from anywhere: bash packages/stagebook/public/audio-probe/generate.sh
set -euo pipefail
cd "$(dirname "$0")"

TONES=(311 523 743 977 1213 1453 1699 1951)
DUR=0.7
BITEXACT=(-fflags +bitexact -flags:a +bitexact -flags:v +bitexact -map_metadata -1)

audio_args() { # $1 = channel count
  echo -c:a:0 libopus -mapping_family:a:0 255 -ac:a:0 "$1" -b:a:0 96k \
    -c:a:1 aac -ac:a:1 2 -b:a:1 96k \
    -disposition:a:0 default -disposition:a:1 default
}

for C in 2 3 4 5 6 7 8; do
  # ── tone_<C>ch.mp4 ──
  inputs=(-f lavfi -i "color=c=black:s=64x64:r=10:d=${DUR}")
  for ((k = 0; k < C; k++)); do
    inputs+=(-f lavfi -i "sine=f=${TONES[$k]}:sample_rate=48000:d=${DUR},volume=0.3")
  done
  # Split each mono tone so it feeds both the discrete track and the mix.
  split="" discrete="" mix=""
  for ((k = 0; k < C; k++)); do
    split+="[$((k + 1)):a]asplit=2[d$k][m$k];"
    discrete+="[d$k]"
    mix+="[m$k]"
  done
  ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" \
    -filter_complex "${split}${discrete}amerge=inputs=${C}[aout_discrete];${mix}amix=inputs=${C}:normalize=1,aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0[aout_mix]" \
    -map 0:v -map "[aout_discrete]" -map "[aout_mix]" \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p \
    $(audio_args "$C") "${BITEXACT[@]}" -t "$DUR" "tone_${C}ch.mp4"

  # ── sim_mixed_<C>ch.mp4 ──
  # amerge stacks the asset's C Opus channels, then the AAC's two; pan folds
  # AAC left into channel 0 and right into channel 1.
  pan="c0=c0+c${C}|c1=c1+c$((C + 1))"
  for ((k = 2; k < C; k++)); do pan+="|c$k=c$k"; done
  ffmpeg -hide_banner -loglevel error -y \
    -i "../../src/audioProbe/calibration/calib_${C}ch.mp4" \
    -filter_complex "[0:a:0][0:a:1]amerge=inputs=2,pan=${C}c|${pan}[a]" \
    -map "[a]" -c:a libopus -mapping_family 255 -ac "$C" -b:a 96k \
    "${BITEXACT[@]}" "sim_mixed_${C}ch.mp4"
done

ls -l tone_*.mp4 sim_mixed_*.mp4 | awk '{s += $5} END {print "fixtures total", s, "B"}'
