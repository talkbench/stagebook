# Task parameters

A small annotation workflow whose clips, playback boundaries, and transcript
come from a task file — the JSON file you give Annotator — and how to preview
it one task at a time.

## What's here

```
task-parameters/
├── clip-review.stagebook.yaml   ← the workflow, with ${field} placeholders
├── prompts/
│   └── rate_response.prompt.md
├── tasks.json                   ← three tasks, in Annotator's task-file format
└── README.md (this file)
```

`clip-review.stagebook.yaml` defines two treatments. `clip_review` plays a short
clip between `${clipStartAt}` and `${clipStopAt}` and shows its `${transcript}`;
`context_review` plays a longer stretch of the conversation around it. Each
entry in `tasks.json` names one of them and supplies its fields:

```json
{
  "callerTaskId": "clip-01",
  "treatment": "clip_review",
  "fields": {
    "clipUrl": "asset://solo_recordings/session_01_listener.mp4",
    "clipStartAt": 15.82,
    "clipStopAt": 16.436,
    "transcript": "Mhm"
  },
  "targetReplications": 1,
  "metadata": { "session": "session_01" }
}
```

The playback boundaries are JSON numbers, so they bind as numbers. `clip-02`'s
transcript `"100"` is a JSON string, so it stays text. `targetReplications` and
`metadata` are for deployment; the preview ignores them.

## Previewing a task

1. Open `clip-review.stagebook.yaml` in VS Code and run **Stagebook: Preview
   Treatment**.
2. Choose **Load parameters…** and pick `tasks.json`.
3. Choose a task, such as `clip-01`.

The clips are `asset://` references to recordings that aren't in this
repository, so the media shows a placeholder until you mount a folder for
`solo_recordings` and `group_recordings` from the banner above the preview.

Try editing a value in `tasks.json`, such as changing `"clipStartAt": 15.82` to
`"clipStartAt": "15.82"`, then refresh: the preview reports that `startAt` needs
a number and names the `${clipStartAt}` field it came from.
