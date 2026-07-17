#!/bin/bash
set -euo pipefail

MODEL_DIR="${JOI_WHISPER_MODEL_DIR:-$HOME/Library/Application Support/Joi/models/whisper}"
MODEL_PATH="$MODEL_DIR/ggml-small.bin"
DOWNLOAD_PATH="$MODEL_PATH.download"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/c521a4b02f422512d734391fdf08bb08c0862f68/ggml-small.bin?download=true"
MODEL_SHA256="1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
WHISPER_CPP="/opt/homebrew/bin/whisper-cli"

if [[ ! -x "$WHISPER_CPP" ]]; then
  if [[ ! -x /opt/homebrew/bin/brew ]]; then
    echo "Homebrew is required to install whisper.cpp." >&2
    exit 2
  fi
  /opt/homebrew/bin/brew install whisper-cpp
fi

mkdir -p "$MODEL_DIR"

if [[ -f "$MODEL_PATH" ]]; then
  INSTALLED_SHA="$(shasum -a 256 "$MODEL_PATH" | awk '{print $1}')"
  if [[ "$INSTALLED_SHA" == "$MODEL_SHA256" ]]; then
    echo "Whisper Small is already installed and verified: $MODEL_PATH"
    exit 0
  fi
  echo "Existing Whisper Small checksum does not match; refusing to overwrite it automatically." >&2
  exit 3
fi

curl -L --fail --retry 3 --progress-bar -o "$DOWNLOAD_PATH" "$MODEL_URL"
DOWNLOADED_SHA="$(shasum -a 256 "$DOWNLOAD_PATH" | awk '{print $1}')"
if [[ "$DOWNLOADED_SHA" != "$MODEL_SHA256" ]]; then
  rm -f "$DOWNLOAD_PATH"
  echo "Whisper Small checksum verification failed." >&2
  exit 4
fi

mv "$DOWNLOAD_PATH" "$MODEL_PATH"
echo "Installed verified Whisper Small model: $MODEL_PATH"
echo "Runtime: $WHISPER_CPP (Apple Metal backend)"
