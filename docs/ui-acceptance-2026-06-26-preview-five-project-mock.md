# Preview Five Project Mock UI Acceptance

## Scope

- Browser preview only: `apps/joi-desktop/frontend/src/api/desktop.ts` fallback data when `window.joi` is absent.
- Constrain the Messenger UI style and function with five project persona members.

## Done Means

- [x] 私人总群 shows the owner user plus five project persona members.
- [x] Sidebar shows one private hub and five project DM rooms with meaningful last messages.
- [x] Clicking a member in overview opens a temporary right-inspector member detail tab.
- [x] Runs tab shows non-empty model/tool/run spans across the five projects.
- [x] Threads tab shows project threads and recent thread events for the selected room.
- [x] Assets tab shows non-empty artifacts linked to mock runs/projects.
- [x] Memory tab shows confirmed memories used by the current run and at least one pending suggestion.
- [x] Frontend build passes.
- [x] Browser preview at the real bound port verifies the above without console errors.
