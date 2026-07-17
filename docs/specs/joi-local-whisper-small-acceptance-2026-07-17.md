# Joi Local Whisper Small Acceptance Contract

## Scope

- Project: `/Users/hao/project/Joi`
- Target app: `/Applications/Joi.app`
- Target screens: Settings > Chat entry > Voice, and the chat composer microphone action
- User job: use a fast, accurate, fully local multilingual speech-to-text model from Joi without guessing whether the runtime is installed.

## Runtime Contract

- Primary backend is Homebrew `whisper.cpp` (`whisper-cli`) with Apple Metal enabled by its native build.
- Balanced model is the full multilingual `ggml-small.bin`, stored outside the app bundle under `~/Library/Application Support/Joi/models/whisper`.
- The model download is checksum-verified against the upstream artifact.
- Joi prefers the mounted `whisper.cpp` Small model and keeps the existing OpenAI Whisper CLI only as an explicit compatibility fallback for other configured models.
- Transcription results report backend, model, model path, language, duration, and elapsed time.
- A missing binary or model returns a clear local readiness error; it must not silently download during recording or claim success.

## Information Structure

- Keep voice, rate, Whisper model, language, and the note that recording/transcription happens in chat.
- Add one compact runtime status block showing engine, model file, acceleration, and ready/error state.
- Small is the default and recommended multilingual choice.
- Do not add recording, TTS, video, sample prompts, or a second execution entry to Settings.

## Interaction Rules

- Chat microphone uses a short-lived OS-temporary recording, runs local transcription, deletes the recording, and places only the text into the composer for review.
- Recording never sends a message automatically.
- The status block refreshes when the Voice settings screen opens.
- Permission, recording, model, and transcription failures remain visible.

## Verification

- `bash -n scripts/install_local_whisper_macos.sh`
- Runtime unit/contract tests for status, whisper.cpp arguments, JSON parsing, and OpenAI fallback.
- Real Chinese TTS fixture transcribed through installed `whisper-cli` + `ggml-small.bin`.
- Frontend build and settings completion test.
- Package and install `/Applications/Joi.app`; verify signature, provenance, source-to-ASAR markers, and unique running bundle.
- Installed UI must show the ready Small/Metal runtime and retain the chat microphone action.
- Preserve `~/Library/Application Support/Joi`, including the mounted model and existing conversations.

## Done Means

- [ ] `whisper-cli` and checksum-verified multilingual Small model are installed locally.
- [ ] Joi reports the runtime as ready in installed Settings.
- [ ] A real Chinese audio fixture transcribes successfully with `whisper.cpp` Small.
- [ ] Chat microphone uses the configured Small model and remains review-before-send.
- [ ] Installed app is signed, sourced from clean pushed `main`, and visibly verified.
