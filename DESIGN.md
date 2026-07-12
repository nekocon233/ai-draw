---
name: ai-draw
description: A calm, professional creator workspace for AI image and video production.
colors:
  ink: "#0d0d0d"
  canvas: "#ffffff"
  surface: "#f7f7f8"
  surface-muted: "#ececec"
  text-muted: "#5d5d5d"
  border: "#e5e5e5"
  signal-blue: "#2563eb"
  success: "#248a5a"
  warning: "#a85c24"
  error: "#c23b4d"
  night-canvas: "#000000"
  night-surface: "#212121"
  graphite: "#2f2f2f"
  night-ink: "#f4f4f4"
  night-muted: "#b4b4b4"
  night-border: "#303030"
  night-signal-blue: "#6ea8fe"
  night-success: "#6fcf97"
  night-warning: "#f0b36b"
  night-error: "#ff7185"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  field: "8px"
  navigation: "10px"
  surface: "12px"
  overlay: "16px"
  bubble: "24px"
  composer: "30px"
  pill: "999px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "20px"
  3xl: "24px"
  4xl: "32px"
  5xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.surface}"
    padding: "8px 16px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.surface}"
    padding: "8px 16px"
    height: "32px"
  field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "40px"
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.composer}"
    padding: "12px"
  media-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "0px"
  navigation-item:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
    height: "52px"
  status-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.signal-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
    height: "24px"
  frame-tile:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.surface}"
    padding: "0px"
    size: "144px"
---

# Design System: ai-draw

## 1. Overview

**Creative North Star: "The Creator's Workbench"**

ai-draw is a restrained, clear, professional workspace in which generated images and video remain the visual center of gravity. The shell should recede like a well-organized studio bench: familiar controls stay close at hand, advanced controls appear progressively, and each processing state remains legible without competing with the creative output.

The system favors earned familiarity over novelty. Neutral surfaces, one system sans family, compact hierarchy, and selective signal blue create a capable and calm product language. It explicitly rejects toy-like one-click converters, cramped parameter dumps, unclear export states, generic enterprise dashboard chrome, and media utilities that feel bolted onto the core workflow.

**Key Characteristics:**
- Restrained monochrome surfaces with signal blue reserved for control and state.
- Familiar, reliable components with complete hover, focus, active, disabled, loading, and error states.
- Progressive density: simple at first glance, precise when professional controls are needed.
- Creative output receives the strongest scale, contrast, and available space.
- Structural responsiveness at 768px and 1024px, with 44px touch targets where space permits.

## 2. Colors

Ink Black and Signal Blue define the palette: neutrals carry structure while blue identifies selection, preview, progress, and tool state rather than decoration.

### Primary
- **Ink Black** (`ink`): Primary light-theme text, primary actions, focus rings, and the strongest structural contrast.
- **Signal Blue** (`signal-blue`): Selected controls, previews, progress, links that behave as actions, and current workset indicators.
- **Night Ink** (`night-ink`): Primary dark-theme text and inverse primary actions.
- **Night Signal Blue** (`night-signal-blue`): Dark-theme selection, preview, progress, and tool state.

### Secondary
- **Success Green** (`success`, `night-success`): Completed processing and successful operations only.
- **Production Amber** (`warning`, `night-warning`): Warnings and attention states that do not block work.
- **Error Rose** (`error`, `night-error`): Destructive actions, failed processing, and validation errors.

### Neutral
- **Canvas** (`canvas`, `night-canvas`): The page and primary workspace background.
- **Workbench Surface** (`surface`, `night-surface`): Sidebars, composer shells, panels, and grouped controls.
- **Muted Surface** (`surface-muted`, `graphite`): Hover states, nested media wells, and secondary layers.
- **Muted Text** (`text-muted`, `night-muted`): Supporting copy, metadata, icons, and placeholders that still meet WCAG AA.
- **Hairline Border** (`border`, `night-border`): One-pixel grouping boundaries and field outlines.

**The Signal, Not Decoration Rule.** Blue is reserved for interaction state, preview state, and actionable emphasis; it must never become ambient decoration.

**The Output Wins Rule.** UI surfaces remain neutral so generated media always carries the broadest color range on screen.

## 3. Typography

**Display Font:** System UI sans-serif stack
**Body Font:** System UI sans-serif stack
**Label/Mono Font:** System UI sans-serif stack; no separate mono role is established

**Character:** One familiar sans family keeps labels, data, prompts, and controls coherent across platforms. Hierarchy comes from weight, size, spacing, and placement rather than decorative type changes.

### Hierarchy
- **Display** (600, `32px`, 1.25): Welcome and major empty-state headings; reduce to `24px` on mobile.
- **Headline** (700, `20px`, 1.25): Numeric summaries and major workbench landmarks.
- **Title** (700, `16px`, 1.25): Modal titles, editor titles, and strong section headers.
- **Body** (400, `15px`, 1.5): Prompts, generated text, instructions, and primary field content; prose should stay within 65-75 characters per line.
- **Label** (500, `13px`, 1.4): Controls, field labels, compact section headings, and action copy; metadata may step down to `11-12px` when secondary.

**The One Family Rule.** Never introduce a display face for product chrome; consistency and scan speed take priority over typographic novelty.

**The Compact Ladder Rule.** Keep adjacent text roles close in scale and use weight intentionally; oversized headings and aggressive tracking are prohibited in task surfaces.

## 4. Elevation

The system is layered but restrained. At rest, surfaces separate through neutral tone and one-pixel borders. Shadows are structural cues for floating controls, mobile drawers, elevated overlays, and interactive cards; they are not permanent decoration on every container.

### Shadow Vocabulary
- **Low Rest Light** (`0 1px 2px rgba(13, 13, 13, 0.08)`): Gives cards and small floating elements a barely raised resting edge in light mode.
- **Interactive Lift Light** (`0 4px 12px rgba(13, 13, 13, 0.1)`): Appears on hover, menus, and controls that have moved above the light canvas.
- **Overlay Lift Light** (`0 12px 32px rgba(13, 13, 13, 0.14)`): Reserved for drawers and substantial overlays in light mode.
- **Low Rest Dark** (`0 1px 2px rgba(0, 0, 0, 0.3)`): Gives actionable cards a restrained resting edge in dark mode.
- **Interactive Lift Dark** (`0 4px 12px rgba(0, 0, 0, 0.38)`): Appears on hover and floating controls in dark mode.
- **Overlay Lift Dark** (`0 12px 32px rgba(0, 0, 0, 0.48)`): Reserved for drawers and substantial overlays in dark mode.

**The Flat-at-Rest Rule.** A surface must earn a shadow by floating, overlapping, or responding to interaction; ordinary grouping uses tone and border first.

**The One Level Rule.** Never stack shadowed cards inside shadowed cards. Nested hierarchy must use spacing, dividers, or tonal surfaces.

## 5. Components

Components feel familiar, restrained, and reliable. Standard Ant Design behavior is preserved unless the creative workflow requires a stronger media-specific affordance.

### Buttons
- **Shape:** Gently curved controls (`12px`); icon-only actions are circular and at least `40px`, rising to `44px` on mobile where practical.
- **Primary:** Inverse monochrome fill with compact `8px 16px` padding; use for the single dominant action in a local region.
- **Hover / Focus:** Shift one neutral step, show the global `2px` focus-visible ring, and keep transitions between `150-200ms`.
- **Secondary / Ghost:** Transparent or surface-colored at rest, gaining a muted surface on hover; destructive actions use Error Rose rather than decorative red fills.

### Chips
- **Style:** Compact labels use pill or small `4-8px` corners, semantic text, and a subtle neutral or semantic tint.
- **State:** Signal Blue marks selected worksets and active processing context; unselected chips remain neutral.

### Cards / Containers
- **Corner Style:** Gently curved media and panel surfaces (`12px`); prominent workbenches and custom overlays may use `16px`.
- **Background:** Workbench Surface for grouping and Muted Surface for nested media wells.
- **Shadow Strategy:** Low Rest at rest and Interactive Lift only when hover or focus communicates actionability.
- **Border:** One-pixel Hairline Border; never use thick decorative outlines.
- **Internal Padding:** Prefer `12-24px` based on density; media itself may run edge-to-edge.

### Inputs / Fields
- **Style:** Standard fields use a one-pixel Hairline Border, Canvas background, `8px` corners, and `15px` body text. The generation composer is a distinct `30px` rounded Workbench Surface.
- **Focus:** Every field must expose a visible `2px` focus ring or an equivalent parent `focus-within` treatment; removing the browser outline without replacement is prohibited.
- **Error / Disabled:** Errors use Error Rose with plain-language recovery copy. Disabled controls reduce emphasis but retain readable contrast and a clearly unavailable cursor/state.

### Navigation
- **Style:** Session rows are `52px` high with `10px` corners, `14px` titles, `11px` metadata, neutral hover, and a subtle active surface. Desktop actions reveal on hover or focus; touch actions remain visible.
- **Mobile Treatment:** The sidebar becomes a modal drawer with focus trapping, Escape dismissal, safe-area spacing, and a maximum width near `292px`.

### Conversational Generation Composer

The composer is the product's signature control: a maximum `900px` workbench surface that combines prompt entry, references, workflow selection, settings, and one circular generate/stop action. It contracts structurally on mobile, keeps controls at touch size, and uses drag feedback only while media is being added.

### Generated Media Tile

Generated media uses a neutral `12px` container and gives the asset maximum uninterrupted area. Actions sit in a dark gradient overlay that appears on hover or `focus-within`; coarse pointers keep these controls visible and at least `44px`.

**The Complete State Rule.** Every interactive component must define default, hover, focus, active, disabled, loading, error, and selected states where applicable.

## 6. Do's and Don'ts

### Do:
- **Do** keep generated images and video central by using neutral Canvas and Workbench Surface backgrounds around them.
- **Do** reserve Signal Blue for selection, preview, progress, and tool state; keep primary actions monochrome.
- **Do** expose advanced generation and media-processing controls progressively instead of presenting a parameter wall.
- **Do** make processing, cancellation, failure, undo, and export states visible and reversible where the workflow supports it.
- **Do** preserve keyboard focus, WCAG AA contrast, reduced-motion behavior, and `44px` coarse-pointer targets.
- **Do** preserve the existing chat shell, session navigation, and integrated media-workbench interaction model.

### Don't:
- **Don't** make ai-draw look like a toy-like one-click converter with oversized novelty actions or empty decorative promises.
- **Don't** create cramped parameter dumps; group controls by task and reveal professional depth progressively.
- **Don't** allow unclear export states; show format, progress, completion, failure, and the next available action.
- **Don't** turn the product into a generic enterprise dashboard with heavy chrome, ornamental cards, or data-table-first hierarchy.
- **Don't** make video-to-frame and asset tools feel like unrelated utilities bolted onto the app; they must share the same shell, tokens, and state vocabulary.
- **Don't** use blue, shadows, gradients, or motion decoratively when they communicate no state or workflow change.
- **Don't** remove a native focus outline unless an equally visible `focus-visible` or `focus-within` replacement is present.
