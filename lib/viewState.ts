"use client";

/**
 * A tiny module-level store for "what is the user currently looking at".
 *
 * WHY NOT REACT CONTEXT
 * There is no context provider anywhere in this codebase — components pass
 * props and hold local state. Introducing a provider tree just so a feedback
 * button can read a chart's filters would be a large change for a small need,
 * and would touch every page. A module singleton matches the existing style,
 * costs nothing, and the widget is the only reader.
 *
 * WHY IT MATTERS
 * "The graph looks wrong" is nearly useless. "The graph looks wrong, on חיפה,
 * second-hand, 4 rooms, 2015–2025, median ₪/m²" is a bug report. The chart
 * state lives in local useState inside MultiChartStudio and never reaches the
 * URL, so without this the visitor would have to describe it in prose — which
 * is exactly the friction that stops people reporting anything at all.
 *
 * Deliberately not reactive: nothing re-renders on change. The widget reads it
 * once, at the moment the user opens the form.
 */

export interface ViewState {
  city?: string;
  /** free-form, human-readable summary of the active selection */
  summary?: string;
}

let current: ViewState = {};

/** Publish the current view. Safe to call from a render or an effect. */
export function setViewState(next: ViewState): void {
  current = next;
}

export function clearViewState(): void {
  current = {};
}

/** Snapshot for the feedback widget. */
export function getViewState(): ViewState {
  return current;
}
