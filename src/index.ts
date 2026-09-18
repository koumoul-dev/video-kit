// API publique du kit : helpers de scénario (curseur, cartons, sous-titres) et
// types. Le CLI `koumoul-video` (binary) porte tournage, montage, synthèse et
// nettoyage.

export { parseScript, parsePronunciations, tokenize, wordCore, speakText, spokenText } from './script.ts'
export type { Beat, Script, PronunciationRule, SpokenText } from './script.ts'
export * from './human.ts'
export { installOverlay, loadOverlayAssets, habillageCss, showIntro, hideIntro, setCaption, showOutro } from './overlay.ts'
export type { OverlayCard, OverlayAssets, OverlayOptions } from './overlay.ts'
export { panelDuration, PANEL_MIN_DUR } from './panels.ts'
export type { PanelSpec } from './panels.ts'
export { IDLE_FACTOR } from './timeline.ts'
export type { Timeline, TimelineBeat, TimelineIdle } from './timeline.ts'
export type { ScenarioContext, BeatRunner, IdleMarker, RecordOptions } from './recorder.ts'
export { silentDuration, MUET_WORDS_PER_SECOND } from './tts.ts'
export type { Voice, NarratedBeat, WordTiming } from './tts.ts'
