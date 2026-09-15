// Timeline écrite par recorder.ts et relue par mux.ts : horodatage des scènes
// (beats) et des attentes compressibles (idles, avec leur facteur de
// compression appliqué au montage). Module sans effet de bord : importé par le
// recorder comme par le mux.

// compression par défaut des attentes (réponses du LLM) ; les attentes
// purement techniques (analyse de fichier, finalisation) peuvent demander
// davantage via `idle.begin(factor)`
export const IDLE_FACTOR = 6

export interface TimelineBeat {
  id: string
  t0: number
  t1: number
  audioStart: number
  audioDur: number
}

export interface TimelineIdle {
  t0: number
  t1: number
  factor?: number
}

export interface Timeline {
  video: string
  width?: number
  height?: number
  originWall: number
  cardT0: number
  endWall: number
  beats: TimelineBeat[]
  idles: TimelineIdle[]
}
