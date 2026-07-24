# PR7.5 — Readability & Interaction Comfort UX Audit

## Executive Summary

This UX audit evaluates Asterim's rendered interface against commercial IDE standards (**Cursor, Linear, Raycast**).

While PR1–PR7 established layout tokenization, high-contrast surface layers, and collapsible accordions, **Asterim's typography and control hit targets remain compressed**. At `13px` body font, `24px–32px` button heights, and `36px` chat input, the UI requires excessive visual effort during 8+ hour engineering sessions.

This review itemizes 7 readability dimensions and defines exact pixel-target refinements required to transform Asterim into a spacious, premium engineering control plane.

---

## 1. Typography Scale & Line Height
* **Current State**: Body font is set to `13px`, section headers at `14px`, metadata at `11px`, and monospace code at `12px`.
* **Problems**:
  * Body text (`13px`) feels undersized when reading long agent responses or code explanations.
  * Line height (`1.45`) feels compressed on high-DPI laptop displays.
  * Section titles (`14px`) do not command sufficient visual authority compared to main thread titles.
* **Target Refinements**:
  * **Main Page / Thread Title**: **`20px–22px`** (`font-weight: 700`).
  * **Panel Titles & Headers**: **`14px–15px`** (`font-weight: 600`).
  * **Body Text**: **`15px`** (`line-height: 1.55`).
  * **Metadata & Timestamps**: **`12px`** (`color: #64748b`).
  * **Monospace & Code Blocks**: **`13px–14px`** (`line-height: 1.50`, `'JetBrains Mono'`).

---

## 2. Button Heights & Hit Target Ergonomics
* **Current State**: Buttons (`Send`, `New Agent`, `Projects`, `Clear Chat`) range between `28px` and `32px` with tight `4px 8px` padding.
* **Problems**:
  * Buttons feel undersized and hard to target quickly with a cursor.
  * `Send` button lacks visual presence relative to the chat input container.
* **Target Refinements**:
  * Primary Action Buttons (`Send`, `New Agent`, `Projects`, `Clear Chat`): **`40px–44px` height** with `0 16px` padding and `6px` border radius.

---

## 3. Chat Input Bar
* **Current State**: Textarea min-height is `36px` with a small `13px` placeholder.
* **Problems**:
  * Chat input feels cramped like a basic web chat box rather than a modern agent command input (Linear/Cursor style).
* **Target Refinements**:
  * Input Container Min-Height: **`48px`** (`padding: 10px 14px`).
  * Textarea Font & Placeholder: **`15px`** font size, **`1.45`** line height.

---

## 4. Navigation Tabs (`Chat`, `Terminal`, `Changes`, `Settings`)
* **Current State**: Views are rendered as flat text items (`💬 Chat`, `⌨️ Terminal`) with subtle bottom border indicators.
* **Problems**:
  * Tabs blend into panel headers without clear active tab weight.
* **Target Refinements**:
  * Increase tab height to **`38px`**, padding to **`8px 16px`**, font size to **`14px`** (`font-weight: 600`).
  * Active Tab Indicator: Elevated surface layer (`var(--color-surface-2)`), accent border, and high-contrast white text (`#ffffff`).

---

## 5. Chat Discussion Breathing Room
* **Current State**: Message bubbles use `8px` vertical margins with `8px` avatar gap.
* **Problems**:
  * Multi-paragraph agent responses look dense and difficult to scan.
* **Target Refinements**:
  * Message Bubble Vertical Margin: **`16px`**.
  * Avatar & Role Header Gap: **`10px`**.
  * Spacing between Text, Accordions, and Code Blocks: **`12px`**.

---

## 6. Sidebar Spacing & Structural Hierarchy
* **Current State**: Project list items and thread items are stacked with `2px` gaps.
* **Problems**:
  * Project names and thread names merge together visually.
* **Target Refinements**:
  * Spacing between Project Cards: **`12px`**.
  * Spacing between Thread Items: **`8px`**.
  * Section Headers: **`16px`** top margin, **`8px`** bottom margin, `12px` font size uppercase (`letter-spacing: 0.05em`).

---

## 7. Visual Focal Hierarchy
* **Current State**: Panel headers, thread titles, chat text, and inspector widgets share equal visual weight.
* **Target Focal Order**:
  1. **Main Thread Title** (`20px`, bold, primary focal anchor).
  2. **Active Navigation Tab** (`14px`, semibold, elevated surface).
  3. **Latest Message Content** (`15px` body, `1.55` line height).
  4. **Chat Input Field** (`48px` height, `15px` text).
  5. **Sidebar Navigation & Inspector** (`14px` titles, `12px` metadata).
