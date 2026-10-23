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
  // début du contenu utile du beat (fin du chargement), marqué par le scénario
  // via `mark()` : le montage des panneaux coupe [t0, contentT0]
  contentT0?: number
}

export interface TimelineIdle {
  t0: number
  t1: number
  factor?: number
}

export interface Timeline {
  video: string
  // fenêtre en pixels CSS ; la vidéo brute fait `width × scale`
  width: number
  height: number
  scale?: number
  originWall: number
  // horodatage mural (ms) de la première image de la vidéo brute : calage
  // exact du montage, sans détection de scène
  videoStartWall: number
  cardT0: number
  beats: TimelineBeat[]
  idles: TimelineIdle[]
}
