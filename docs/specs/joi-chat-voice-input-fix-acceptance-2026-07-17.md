# Joi Chat Voice Input Fix Acceptance Contract

## Scope

- Project: `/Users/hao/project/Joi`
- Target app: `/Applications/Joi.app`
- Target screen: chat composer microphone and Settings > Chat entry > Voice
- User job: speak a short Chinese sentence and receive editable Chinese text without seeing or retaining a recording attachment.

## Current Bugs

- Short Chinese recordings use `language=auto` and can be misdetected as English, producing text such as `you`.
- The microphone path saves the captured WebM as a normal composer attachment, exposing an implementation artifact to the user.

## Information Structure

- Keep the microphone button, recording/transcribing status, language selector, Small model selector, and review-before-send behavior.
- Keep `自动识别` and `English` as explicit optional settings.
- Make `中文` the default and the selected setting for the current installed app.
- Remove microphone-generated recording attachments from the composer.
- Do not add a voice-message feature, recording library, or file-management UI.

## Interaction Rules

- Chinese mode must call whisper.cpp with `--language zh` and a short Simplified Chinese/Joi vocabulary prompt.
- The renderer sends the recorded data directly to a dedicated transient transcription action.
- The main process may create a file only inside a unique OS temporary directory required by FFmpeg/whisper.cpp.
- The temporary directory must be removed in `finally`, on success and failure.
- No microphone recording is added to composer attachments or retained under Joi `media-workbench/recordings`.
- A successful transcript is appended to the composer for review and is never sent automatically.
- Empty or failed transcription shows a clear retry message without claiming a file was attached.

## Verification

- Source contract checks for Chinese defaults, the transient IPC action, no composer attachment call, and cleanup-on-failure.
- Frontend, Electron, store, and runtime tests/builds pass.
- Direct Chinese fixture is transcribed with `language=zh`.
- The installed app shows `中文` selected.
- A real installed-app microphone run places text in the composer, creates no attachment chip, sends no message, and leaves no new recording file behind.
- `/Applications/Joi.app` provenance matches clean pushed `main`; `~/Library/Application Support/Joi` is otherwise preserved.

## Done Means

- [ ] Short Chinese voice input no longer runs through auto language detection by default.
- [ ] The composer receives editable transcription text and no recording attachment.
- [ ] Transient audio is removed after both successful and failed transcription.
- [ ] The installed app is packaged, opened, and visibly verified through the real microphone path.
