#!/usr/bin/env python3
# Synthèse Kokoro (local, GPU si disponible) — appelé par tts.ts.
#
#   kokoro.py "<texte>" <sortie.wav> <voix>   # voix : ff_siwis, fm_… (préfixe = langue)

import sys
import warnings

warnings.filterwarnings('ignore')

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from kokoro import KPipeline  # noqa: E402


def main() -> None:
    text, out, voice = sys.argv[1], sys.argv[2], sys.argv[3]
    lang = voice[0]
    pipe = KPipeline(lang_code=lang)
    chunks = [audio for _, _, audio in pipe(text, voice=voice)]
    audio = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    sf.write(out, audio, 24000)


if __name__ == '__main__':
    main()
