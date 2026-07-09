# Discussion Configuration

Discussions add synchronized text chat or video calls to a stage. Include a `discussion` block at the stage level:

```yaml
gameStages:
  - name: Topic Discussion
    duration: 600
    discussion:
      chatType: video
      showNickname: true
      showTitle: false
    elements:
      - type: prompt
        file: game/discussion_prompt.prompt.md
      - type: submitButton
        buttonText: End Discussion
```

Discussion stages display the chat interface on the left and elements on the right.

## Common Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `chatType` | `"text"`, `"audio"`, `"video"` | _required_ | Type of communication |
| `showNickname` | boolean | true | Display participant nicknames |
| `showTitle` | boolean | false | Display participant titles (from `groupComposition`) |
| `showToPositions` | int[] | _(all)_ | Restrict which positions see the discussion |
| `hideFromPositions` | int[] | _(none)_ | Hide discussion from these positions |
| `conditions` | array | _(none)_ | Conditional display rules |

## Text Chat

```yaml
discussion:
  chatType: text
  showNickname: true
  reactionEmojisAvailable: ["👍", "❤️", "😊", "🎉"]
  reactToSelf: true
  numReactionsPerMessage: 1
```

Text-only options:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reactionEmojisAvailable` | string[] | _(disabled)_ | Emoji reactions participants can use |
| `reactToSelf` | boolean | true | Allow reacting to own messages |
| `numReactionsPerMessage` | integer | 1 | Max distinct reactions per message per person |

## Video Chat

```yaml
discussion:
  chatType: video
  showNickname: true
  showSelfView: false
  showAudioMute: true
  showVideoMute: true
```

Video-only options:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `showSelfView` | boolean | true | Show participant's own video tile |
| `showReportMissing` | boolean | true | Show "Report Missing Participant" button |
| `showAudioMute` | boolean | true | Allow microphone muting |
| `showVideoMute` | boolean | true | Allow camera toggling |

## Breakout Rooms

Split participants into sub-groups for separate conversations:

```yaml
discussion:
  chatType: video
  showNickname: true
  rooms:
    - includePositions: [0, 1]
    - includePositions: [2, 3]
```

Every visible participant must appear in exactly one room. After applying `showToPositions`/`hideFromPositions`, all remaining positions must be assigned.

## Custom Video Layouts

For fine-grained control over what each participant sees, use `layout` instead of `rooms`. Each key is a position index, and the value defines a grid layout:

```yaml
discussion:
  chatType: video
  layout:
    0:
      grid:
        rows: 100
        cols: 100
      feeds:
        - source: { type: "participant", position: 1 }
          media: { audio: true, video: true }
          displayRegion:
            rows: { first: 0, last: 99 }
            cols: { first: 0, last: 99 }
          zOrder: 5
        - source: { type: "self" }
          media: { audio: false, video: true }
          displayRegion:
            rows: { first: 80, last: 99 }
            cols: { first: 80, last: 99 }
          zOrder: 10
    1:
      grid: { rows: 1, cols: 2 }
      feeds:
        - source: { type: "participant", position: 0 }
          media: { audio: true, video: true }
          displayRegion: { rows: 0, cols: 0 }
        - source: { type: "self" }
          media: { audio: false, video: true }
          displayRegion: { rows: 0, cols: 1 }
```

In this example the two positions see different things. The participant at position `0` sees their partner (position `1`) filling the whole video window on a fine 100×100 grid, with their own self-view as a small muted picture-in-picture tile in the bottom-right corner (a higher `zOrder` stacks it on top). The participant at position `1` sees a side-by-side split on a 1×2 grid: their partner (position `0`) in the left cell and their own muted self-view in the right cell. Because `layout` is keyed by position, each participant can be shown a different arrangement of the same call.

### Grid System

The grid defines rows and columns. Display regions specify which cells a feed occupies (zero-based, inclusive). Use a fine grid (e.g., 100x100) for precise percentage-based positioning.

### Feed Options

| Field | Type | Description |
|-------|------|-------------|
| `source` | object | `{ type: "participant", position: N }` or `{ type: "self" }` |
| `media` | object | `{ audio: bool, video: bool, screen: bool }` |
| `displayRegion` | object | `{ rows: int or {first, last}, cols: int or {first, last} }` |
| `zOrder` | integer | Stacking order (higher = on top) |
| `render` | string | `"auto"`, `"tile"`, `"audioOnlyBadge"`, `"hidden"` |
| `label` | string | Text label for the feed |

## Common Patterns

**Simple text chat:**
```yaml
discussion:
  chatType: text
  showNickname: true
```

**Video with hidden self-view:**
```yaml
discussion:
  chatType: video
  showSelfView: false
  showNickname: true
```

**Video with mute controls disabled:**
```yaml
discussion:
  chatType: video
  showAudioMute: false
  showVideoMute: false
```

**Chat visible to specific positions only:**
```yaml
discussion:
  chatType: text
  showToPositions: [0, 2]
  showNickname: true
```
