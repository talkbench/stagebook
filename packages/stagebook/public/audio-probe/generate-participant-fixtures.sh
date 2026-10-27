#!/usr/bin/env bash
# Real group-player fixtures: distinct tone AND amplitude per source channel.
# Amplitudes let the captured min/max waveforms identify the source, while
# tones let tests measure the audible mix before and after per-row mute.
set -euo pipefail
cd "$(dirname "$0")"
TONES=(311 523 743 977 1213 1453 1699 1951)
for C in 1 2 3 6 8; do
  inputs=(-f lavfi -i "color=c=black:s=64x64:r=10:d=3")
  split="" discrete="" mix=""
  for ((k=0;k<C;k++)); do
    inputs+=(-f lavfi -i "sine=f=${TONES[$k]}:sample_rate=48000:d=3,volume=$((k+1))/2")
    split+="[$((k+1)):a]asplit=2[d$k][m$k];"
    discrete+="[d$k]"; mix+="[m$k]"
  done
  if [ "$C" = 1 ]; then
    ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -map 0:v -map 1:a \
      -c:v libx264 -pix_fmt yuv420p -c:a aac -ac 1 -b:a 96k -map_metadata -1 "participants_${C}ch.mp4"
  else
    ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" \
      -filter_complex "${split}${discrete}amerge=inputs=${C}[d];${mix}amix=inputs=${C}:normalize=1,aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0[m]" \
      -map 0:v -map '[d]' -map '[m]' -c:v libx264 -pix_fmt yuv420p \
      -c:a:0 libopus -mapping_family:a:0 255 -ac:a:0 "$C" -b:a:0 96k \
      -c:a:1 aac -ac:a:1 2 -b:a:1 96k -disposition:a:0 default -disposition:a:1 default \
      -map_metadata -1 "participants_${C}ch.mp4"
  fi
done
