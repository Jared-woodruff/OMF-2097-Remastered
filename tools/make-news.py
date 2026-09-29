"""
Makes the newsroom newsreader's recordings: public/audio/news/<voice>/<recording>.mp3 and index.json, for the two
announcer voices (the newsreader reads in the announcer's voice; see src/audio/newsVoice.ts). The reports are the
game's text templates with names filled in, so they are read stitched together: every text is recorded once per
pronoun version with stand-in names and cut where the names go, and every name is recorded in carrier sentences, one
per place a name takes (starting a sentence, inside one, ending one, possessive), and cut out. The plan of what to
record comes from src/gen/dev/newsPlan.test.ts (npm run news:voice writes it and runs this script).

The recordings are made by ElevenLabs text to speech (https://elevenlabs.io) with character timestamps, which say
where each character is spoken: the cuts fall between words, tight around the names (the pauses stay with the texts).
Each recording is brought to the same loudness before it is cut, and every piece gets short fades at its cuts.
Recordings already made are kept (--force to redo them), so an interrupted run resumes where it stopped.

Usage: python tools/make-news.py <plan.json> [--voice male|female] [--only <prefix,...>] [--force] [--model MODEL]
  ELEVENLABS_API_KEY: an ElevenLabs API key with text to speech access (never stored in the repository).
  Needs ffmpeg on the PATH and numpy.
  --engine sapi --out DIR: tries the whole chain without ElevenLabs, with Windows' speech synthesizer (word timings
  only) writing into DIR.
  --keep-raw DIR keeps every raw recording and its timestamps; --recut DIR cuts the recordings again from them (no
  requests), e.g. after changing how the cuts are made. --alt id,id records those names again from their alternative
  carriers (a pause before the name), for names that run into the word before them (flagged cuts).
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'audio', 'news')
RATE = 44100

MODEL = 'eleven_v4'
# A steadier read than the announcer's (a newscast), in the same voices.
VOICE_SETTINGS = {'stability': 0.5, 'similarity_boost': 0.8}
SEED = 2097
VOICES = {
    'male': {'id': 'cPoqAvGWCPfCfyPMwe4z', 'name': 'Victor', 'tag': '[deep, dramatic sports news anchor]'},
    'female': {'id': 'Qbw4VpyUrHEG7NigKzty', 'name': 'Kristen', 'tag': '[cool, crisp sports news anchor]'},
}
# The timestamps put word edges only approximately, and words run together in speech: a cut goes to the quietest
# moment between two words (the plan puts stops next to the names: their closures are short silences), searched
# from a little before the first word's end to a little after the second's start.
EARLY, LATE = 0.03, 0.05
FADE = 0.008
TARGET_DB = -18.0


def speak(key, voice, text, model):
    """(mono float PCM at RATE, alignment of `text`: list of (char, start, end)) of the text said in the voice."""
    v = VOICES[voice]
    said = f"{v['tag']} {text}" if model == 'eleven_v4' else text
    body = json.dumps({'text': said, 'model_id': model, 'voice_settings': VOICE_SETTINGS, 'seed': SEED}).encode()
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{v['id']}/with-timestamps?output_format=mp3_44100_128"
    for attempt in range(6):
        req = urllib.request.Request(url, data=body, method='POST',
                                     headers={'xi-api-key': key, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                answer = json.load(resp)
            break
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')[:300]
            if e.code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(2 + attempt * 3)
                continue
            sys.exit(f'ElevenLabs: {e.code} {detail}')
    mp3 = base64.b64decode(answer['audio_base64'])
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', str(RATE), 'pipe:1'],
                         input=mp3, capture_output=True, check=True).stdout
    x = np.frombuffer(pcm, dtype='<f4').copy()
    return x, align(text, answer)


def speak_sapi(text):
    """Test engine: Windows' speech synthesizer, with a character alignment from its word timings."""
    with tempfile.TemporaryDirectory() as tmp:
        txt, wav, js = (os.path.join(tmp, n) for n in ('text.txt', 'out.wav', 'words.json'))
        with open(txt, 'w', encoding='utf-8') as f:
            f.write(text)
        script = (
            "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$ev = New-Object System.Collections.ArrayList; "
            "$s.add_SpeakProgress({ param($a, $e) [void]$ev.Add(@($e.CharacterPosition, $e.CharacterCount, "
            "$e.AudioPosition.TotalSeconds)) }); "
            f"$s.SetOutputToWaveFile('{wav}'); $s.Speak([IO.File]::ReadAllText('{txt}')); $s.Dispose(); "
            f"ConvertTo-Json -Compress -InputObject @($ev) | Set-Content -Encoding utf8 '{js}'")
        subprocess.run(['powershell', '-NoProfile', '-Command', script], check=True, capture_output=True)
        pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', wav, '-f', 'f32le', '-ac', '1', '-ar', str(RATE), 'pipe:1'],
                             capture_output=True, check=True).stdout
        words = json.load(open(js, encoding='utf-8-sig'))
    x = np.frombuffer(pcm, dtype='<f4').copy()
    total = len(x) / RATE
    # (its word timings run slow against its own audio: stretched to fit)
    scale = min(1.0, (total - 0.25) / max(1e-3, max(w[2] for w in words)))
    words = [(pos, count, t * scale) for pos, count, t in words]
    al = [[c, 0.0, 0.0] for c in text]
    for k, (pos, count, t) in enumerate(words):
        end = words[k + 1][2] - 0.02 if k + 1 < len(words) else total - 0.05
        for i in range(pos, min(len(text), pos + count)):
            al[i][1], al[i][2] = t, end
    last = 0.0
    for a in al:
        if a[2] == 0.0:
            a[1] = a[2] = last
        last = a[2]
    return x, [tuple(a) for a in al]


def align(text, answer):
    """The timestamps of the characters of `text` (the request may have had a tag before it)."""
    for name in ('alignment', 'normalized_alignment'):
        a = answer.get(name)
        if not a:
            continue
        chars = ''.join(a['characters'])
        at = chars.rfind(text)
        if at >= 0:
            return [(c, a['character_start_times_seconds'][at + i], a['character_end_times_seconds'][at + i])
                    for i, c in enumerate(text)]
    sys.exit(f'the timestamps do not match the text: {text!r}')


def gain_to_target(x):
    """The gain that brings the speech (the louder 10 ms frames) to TARGET_DB."""
    hop = RATE // 100
    frames = x[:len(x) // hop * hop].reshape(-1, hop)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    speech = rms[rms > max(1e-4, rms.max() * 0.1)]
    level = 20 * np.log10(np.sqrt((speech ** 2).mean()) + 1e-9)
    return 10 ** ((TARGET_DB - level) / 20)


def word_edges(al, i, j):
    """(start of the first, end of the last) spoken character of text[i:j], ignoring spaces."""
    idx = [k for k in range(i, j) if not al[k][0].isspace()]
    return al[idx[0]][1], max(al[k][2] for k in idx)


def spoken_before(al, i):
    """End time of the last spoken character before text position i (0 if none)."""
    for k in range(i - 1, -1, -1):
        if not al[k][0].isspace() and al[k][0] not in '.,!?':
            return al[k][2]
    return 0.0


def spoken_after(al, j, total):
    """Start time of the first spoken character from text position j (the end of the audio if none)."""
    for k in range(j, len(al)):
        if not al[k][0].isspace() and al[k][0] not in '.,!?':
            return al[k][1]
    return total


def quietest(x, a, b):
    """The quietest 5 ms moment between a and b (seconds): where to cut between two words."""
    step = int(0.0025 * RATE)
    best, where = None, (a + b) / 2
    k = a
    while k <= b:
        i = int(k * RATE)
        seg = x[max(0, i - step):i + step]
        e = float((seg ** 2).mean()) if len(seg) else 0.0
        if best is None or e < best:
            best, where = e, k
        k += 0.0025
    return where


def level(x, t):
    """The sound level at t (5 ms) against the recording's peak, in dB."""
    i, h = int(t * RATE), int(0.0025 * RATE)
    return 20 * np.log10(np.sqrt((x[max(0, i - h):i + h] ** 2).mean()) / (np.abs(x).max() + 1e-9) + 1e-9)


def edge(x, al, i, total):
    """Where to cut at text position i: between the last spoken character before it and the first from it."""
    before = spoken_before(al, i)
    after = spoken_after(al, i, total)
    t = quietest(x, max(0.0, before - EARLY), min(total, max(after, before) + LATE))
    # No quiet moment before a vowel: the word before runs into it ("Kate a run" is said "Kay-da run"), so the cut goes
    # to the vowel's onset (the timestamps are right at onsets), leaving the run-in with the word before.
    first = next((k for k in range(i, len(al)) if not al[k][0].isspace() and al[k][0] not in '.,!?'), None)
    if first is not None and al[first][0].lower() in 'aeiou' and level(x, t) > -30:
        t = max(t, al[first][1] - 0.015)
        ONSETS.add(round(t, 4))
    return t


LOUD_CUTS = []
# (cuts put at a vowel's onset on purpose: loud by nature, not flagged)
ONSETS = set()


def check_cut(x, t, rid):
    """Notes a cut in the middle of the sound (louder than -28 dB against the recording's peak) to listen to."""
    if t <= 0 or t >= len(x) / RATE or round(t, 4) in ONSETS:
        return
    db = level(x, t)
    if db > -28:
        LOUD_CUTS.append(f'{rid} at {t:.2f} s: {db:.0f} dB')


def cut(x, t0, t1):
    a, b = max(0, int(round(t0 * RATE))), min(len(x), int(round(t1 * RATE)))
    piece = x[a:b].copy()
    n = min(len(piece) // 2, int(FADE * RATE))
    if n > 0:
        ramp = np.linspace(0, 1, n, dtype=np.float32)
        piece[:n] *= ramp
        piece[-n:] *= ramp[::-1]
    return piece


def save(piece, path):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', 'pipe:0',
                    '-c:a', 'libmp3lame', '-b:a', '64k', path], input=piece.astype('<f4').tobytes(), check=True)


KEEP_RAW = None
RECUT = None


def say(key, voice, model, text, rid=None):
    if RECUT:
        # (cut again from a kept raw recording: no request)
        x = np.load(os.path.join(RECUT, f'{voice}-{rid}.npy'))
        with open(os.path.join(RECUT, f'{voice}-{rid}.json'), encoding='utf-8') as f:
            return x, [tuple(a) for a in json.load(f)['alignment']]
    x, al = speak_sapi(text) if model == 'sapi' else speak(key, voice, text, model)
    if KEEP_RAW and rid:
        # (the raw recording and its timestamps, to look into the cuts)
        os.makedirs(KEEP_RAW, exist_ok=True)
        np.save(os.path.join(KEEP_RAW, f'{voice}-{rid}.npy'), x)
        with open(os.path.join(KEEP_RAW, f'{voice}-{rid}.json'), 'w', encoding='utf-8') as f:
            json.dump({'text': text, 'alignment': al}, f)
    return x, al


def record_text(key, voice, model, item, folder):
    """A news text: its fixed pieces, cut between the names (each name's range dropped with its margins)."""
    x, al = say(key, voice, model, item['text'], item['id'])
    x *= gain_to_target(x)
    total = len(x) / RATE
    segs = item['segments']
    for n, s in enumerate(segs):
        if 'id' not in s:
            continue
        # From the cut after the name before to the cut before the name after.
        t0 = edge(x, al, s['from'], total) if n > 0 else 0.0
        t1 = edge(x, al, s['to'], total) if n + 1 < len(segs) else total
        text = item['text'][s['from']:s['to']]
        if not any(not c.isspace() and c not in '.,!?' for c in text):
            # Only a pause (a sentence's end, a comma): at the text's end or start, silence (the name's recording
            # has its own ending); between two names, the pause as said, from the quiet after the one to the quiet
            # before the other; at least a natural one.
            least = 0.32 if any(c in '.!?' for c in text) else 0.16 if ',' in text else 0.06
            a, b = spoken_before(al, s['from']), spoken_after(al, s['to'], total)
            if 0 < n < len(segs) - 1:
                t0 = quietest(x, a, min(b, a + 0.25))
                t1 = quietest(x, max(t0, b - 0.25), b)
            if n == 0 or n == len(segs) - 1 or t1 - t0 < least:
                save(np.zeros(int(least * RATE), dtype=np.float32), os.path.join(folder, s['id'] + '.mp3'))
                continue
        if t1 - t0 < 0.08:
            # (the names' margins overlap it: at least its own words)
            print(f"  {s['id']}: {t1 - t0:.3f} s between the names around it, kept its own words")
            t0, t1 = word_edges(al, s['from'], s['to'])
            t0, t1 = t0 - 0.01, t1 + 0.02
        check_cut(x, t0, s['id'])
        check_cut(x, t1, s['id'])
        save(cut(x, t0, t1), os.path.join(folder, s['id'] + '.mp3'))


ALT = set()


def record_name(key, voice, model, item, folder):
    """A name: its range of the carrier sentence, with margins, not into the words around it."""
    rid = item['id']
    alt_raw = RECUT and os.path.exists(os.path.join(RECUT, f'{voice}-{rid}.alt.npy'))
    if item.get('alt') and (rid in ALT or alt_raw):
        # (the alternative carrier, with a pause before the name: for names that run into the word before; a name
        # recorded so once is cut again from that recording)
        item = {**item, **item['alt']}
        rid += '.alt'
    x, al = say(key, voice, model, item['text'], rid)
    x *= gain_to_target(x)
    total = len(x) / RATE
    if item['from'] > 0:
        t0 = edge(x, al, item['from'], total)
    else:
        # (opening the carrier: from the quiet before it; a fricative like Steffan's S starts before its timestamp)
        onset = word_edges(al, 0, item['to'])[0]
        t0 = quietest(x, max(0.0, onset - 0.2), max(0.0, onset - 0.01))
    t1 = edge(x, al, item['to'], total)
    check_cut(x, t0, item['id'])
    check_cut(x, t1, item['id'])
    save(cut(x, t0, t1), os.path.join(folder, item['id'] + '.mp3'))


def main():
    args = sys.argv[1:]

    def option(name, default=None, flag=False):
        if name in args:
            i = args.index(name)
            if flag:
                del args[i]
                return True
            value = args[i + 1]
            del args[i:i + 2]
            return value
        return default
    voice = option('--voice')
    only = option('--only', '')
    force = option('--force', False, True)
    model = option('--model', MODEL)
    if option('--engine') == 'sapi':
        model = 'sapi'
    out = option('--out', OUT)
    global KEEP_RAW, RECUT
    KEEP_RAW = option('--keep-raw')
    RECUT = option('--recut')
    alt = option('--alt')
    if alt:
        # (these names again, from their alternative carriers)
        ALT.update(alt.split(','))
        only = alt
        force = True
    if len(args) != 1:
        sys.exit(__doc__)
    key = os.environ.get('ELEVENLABS_API_KEY')
    if not key and model != 'sapi' and not RECUT:
        sys.exit('set ELEVENLABS_API_KEY to an ElevenLabs API key')
    plan = json.load(open(args[0], encoding='utf-8'))
    for name in [voice] if voice else list(VOICES):
        folder = os.path.join(out, name)
        os.makedirs(folder, exist_ok=True)
        have = lambda rid: os.path.exists(os.path.join(folder, rid + '.mp3'))
        jobs = [('text', t, [s['id'] for s in t['segments'] if 'id' in s]) for t in plan['texts']]
        jobs += [('name', n, [n['id']]) for n in plan['names']]
        prefixes = tuple(only.split(','))
        todo = [(kind, item) for kind, item, ids in jobs
                if item['id'].startswith(prefixes) and (force or not all(have(i) for i in ids))]
        if RECUT:
            todo = [(kind, item) for kind, item, _ in jobs if item['id'].startswith(prefixes)
                    and os.path.exists(os.path.join(RECUT, f"{name}-{item['id']}.npy"))]
        chars = sum(len(item['text']) for _, item in todo)
        print(f'{name} ({VOICES[name]["name"]}): {len(todo)} recordings to make, {chars} characters')
        for n, (kind, item) in enumerate(todo, 1):
            (record_text if kind == 'text' else record_name)(key, name, model, item, folder)
            if n % 20 == 0 or n == len(todo):
                print(f'  {n} / {len(todo)}', flush=True)
        recordings = sorted(f[:-4] for f in os.listdir(folder) if f.endswith('.mp3'))
        with open(os.path.join(folder, 'index.json'), 'w', encoding='utf-8') as f:
            json.dump({'voice': VOICES[name]['name'], 'recordings': recordings}, f, separators=(',', ':'))
        print(f'{name}: {len(recordings)} recordings in index.json')
        if LOUD_CUTS:
            print(f'{len(LOUD_CUTS)} cut(s) in the middle of the sound (listen to them):')
            for c in LOUD_CUTS:
                print('  ' + c)
            LOUD_CUTS.clear()


if __name__ == '__main__':
    main()
