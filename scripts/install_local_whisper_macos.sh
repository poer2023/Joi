#!/bin/bash
set -euo pipefail

MODEL_DIR="${JOI_WHISPER_MODEL_DIR:-$HOME/Library/Application Support/Joi/models/whisper}"
MODEL_PATH="$MODEL_DIR/ggml-small.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/c521a4b02f422512d734391fdf08bb08c0862f68/ggml-small.bin?download=true"
MODEL_SHA256="1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
VAD_MODEL_PATH="$MODEL_DIR/ggml-silero-v6.2.0.bin"
VAD_MODEL_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin?download=true"
VAD_MODEL_SHA256="2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"
WHISPER_CPP="/opt/homebrew/bin/whisper-cli"

if [[ ! -x "$WHISPER_CPP" ]]; then
  if [[ ! -x /opt/homebrew/bin/brew ]]; then
    echo "Homebrew is required to install whisper.cpp." >&2
    exit 2
  fi
  /opt/homebrew/bin/brew install whisper-cpp
fi

mkdir -p "$MODEL_DIR"

install_verified_model() {
  local label="$1"
  local target_path="$2"
  local source_url="$3"
  local expected_sha="$4"
  local download_path="$target_path.download"

  if [[ -f "$target_path" ]]; then
    local installed_sha
    installed_sha="$(shasum -a 256 "$target_path" | awk '{print $1}')"
    if [[ "$installed_sha" == "$expected_sha" ]]; then
      echo "$label is already installed and verified: $target_path"
      return
    fi
    echo "Existing $label checksum does not match; refusing to overwrite it automatically." >&2
    exit 3
  fi

  curl -L --fail --retry 3 --progress-bar -o "$download_path" "$source_url"
  local downloaded_sha
  downloaded_sha="$(shasum -a 256 "$download_path" | awk '{print $1}')"
  if [[ "$downloaded_sha" != "$expected_sha" ]]; then
    rm -f "$download_path"
    echo "$label checksum verification failed." >&2
    exit 4
  fi

  mv "$download_path" "$target_path"
  echo "Installed verified $label: $target_path"
}

install_verified_model "Whisper Small model" "$MODEL_PATH" "$MODEL_URL" "$MODEL_SHA256"
install_verified_model "Silero VAD model" "$VAD_MODEL_PATH" "$VAD_MODEL_URL" "$VAD_MODEL_SHA256"
echo "Runtime: $WHISPER_CPP (Apple Metal backend)"
