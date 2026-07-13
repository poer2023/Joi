# Joi overview model and assets scope acceptance

Source: browser comments on `http://127.0.0.1:5173/`.

Scope:
- Right inspector overview model rows.
- Right inspector overview actions.
- Right inspector assets tab.

Acceptance:
- Overview model row shows persona identity plus a single compact model control. The visible row text shows only the model name, not provider suffixes or a separate always-visible reasoning selector.
- The model control opens a menu that can choose models and, for reasoning-capable models, choose reasoning effort from a nested/secondary menu area. The menu must not be clipped by the right inspector boundary.
- Remove the overview `导出数据` action.
- Assets tab includes only files/images uploaded in the current conversation or generated file/image assets tied to the current conversation. Run reports, checklists, trace summaries, and generic text artifacts must not appear.

Verification:
- Load `http://127.0.0.1:5173/` with the real bridge on `127.0.0.1:18083`.
- Check model rows in the overview tab.
- Open the model menu near the right edge and verify it is not clipped.
- Confirm the overview export button is gone.
- Confirm the current visible assets tab contains no report/checklist/text run artifacts.
