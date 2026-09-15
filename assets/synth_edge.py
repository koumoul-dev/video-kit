#!/usr/bin/env python3
# Synthèse edge-tts avec timings mot à mot — appelé par tts.ts.
#
#   synth_edge.py "<texte>" <sortie.mp3> <sortie.words.json> <voix>
#
# Le JSON contient [{ "text", "start", "end" }] en secondes, relatif au début
# de l'audio du beat.

import asyncio
import json
import sys

import edge_tts

TICKS_PER_SECOND = 10_000_000


async def main() -> None:
    text, out_mp3, out_words, voice = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    communicate = edge_tts.Communicate(text, voice, boundary='WordBoundary')
    words = []
    with open(out_mp3, 'wb') as media:
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                media.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                words.append({
                    'text': chunk['text'],
                    'start': chunk['offset'] / TICKS_PER_SECOND,
                    'end': (chunk['offset'] + chunk['duration']) / TICKS_PER_SECOND,
                })
    with open(out_words, 'w') as meta:
        json.dump(words, meta, ensure_ascii=False, indent=2)
        meta.write('\n')


if __name__ == '__main__':
    asyncio.run(main())
