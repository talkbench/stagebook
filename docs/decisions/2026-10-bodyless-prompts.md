# Prompts can declare that they have no body

Status: accepted in [#718](https://github.com/talkbench/stagebook/issues/718).

A prompt file's frontmatter can say `body: none`. The body section then stays
in the file but is empty, and nothing renders above the response control. Two
studies needed this: an annotation task with a single checkbox under a
recording, and a negotiation call with a row of show/hide toggles. In both,
the option labels are the whole prompt.

**Why an explicit flag.** An empty body is still an error without the flag.
Before this, an empty body meant an unfinished question, and that check still
has value. The flag lets an author mark the omission as deliberate without
weakening the check. `body: none` with text in the body section is an error
too. That catches a flag left behind after someone adds a question, and stops
the body from becoming a place for author comments, which belong in `notes:`.

**Why the empty section stays.** Every response type keeps its usual sections,
so tools that read a prompt file by section position need no special case.
Turning the prompt back into a normal question means typing into the section,
not restructuring the file.

**Naming the control.** A response control still needs an accessible name.
Each checkbox is named by its own label, so a checkbox group needs nothing
more. Every other control is named by the body, so without one it needs
`ariaLabel`: a single line of plain text that names the control for assistive
technology and is never displayed. This covers radio buttons (a radio group is
one question and must have a name), dropdowns, open responses and numeric
responses, shared or not. `ariaLabel` is only accepted with `body: none`,
because two sources for one name could disagree.

**What the flag doesn't establish.** WCAG also asks for a visible label. With
no body, that label has to come from elsewhere on the stage, such as a heading
element or the recording being annotated, and the validator can't see it.
`ariaLabel` must restate visible content rather than add to it. Only assistive
technology announces it, so wording that isn't on screen would give
screen-reader participants a different instrument from everyone else, which
breaks the rule that every participant gets the same experience. The
researcher docs state both rules.

**Excluded for now.**

- `slider` gets no name today, and an untouched slider has no focusable control
  ([#689](https://github.com/talkbench/stagebook/issues/689)). `body: none`
  follows that fix, as `required` does.
- `listSorter` has no way to carry a name yet.
- `noResponse` would render nothing.
- `required: true` would leave the Required marker with no question to sit
  under. Allowing it later won't break anyone; banning it later would.

## Rejected

- **Allowing an empty body without a flag.** It can't tell a deliberate
  omission from an unfinished question.
- **A dedicated `checkbox` type with a boolean value.** `equals: true` is
  simpler to write for one checkbox, but the type can't express a row of
  toggles, and `multipleChoice` already models both cases. The value stays the
  list of checked labels, so existing `includes` / `doesNotInclude` conditions
  work unchanged.
- **Signalling with zero lines versus a blank line between delimiters.**
  Whitespace would carry meaning, and an editor could flip it.
- **Marker text or a Markdown comment in the body.** That obscurity is what
  made the earlier workaround fragile: an author tidying the file could delete
  it as a stray line.
- **`body: hidden`, with the Markdown body as the accessible name.** Hidden
  Markdown can contain links, which would be focus stops nobody can see.
  Restricted to one line of plain text, it is a frontmatter string anyway.
