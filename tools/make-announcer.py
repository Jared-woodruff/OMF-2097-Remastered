"""
Makes the announcer's voice lines: public/audio/announcer/<voice>/<line>.mp3 for the two announcers, male and female
(OPTIONS > SOUND > ANNOUNCER). The lines are performed by ElevenLabs text to speech (https://elevenlabs.io) with the Eleven
v4 model, directed line by line with audio tags ([shouting, fierce] FIGHT!), CAPS for emphasis and ellipses for weight.
Every line is generated in a few takes and the most intense one is kept (loudness and brightness of the voice before
normalization; a take much longer than the others, which may carry a stray sound, is left out). Then ffmpeg finishes
it: silence trimmed, a touch of arena echo, compression and even loudness.

The lines are plain MP3 files: replace any of them with your own recording (same file name) to change a line.

Usage: python tools/make-announcer.py [--voice male|female] [--takes N] [--keep-raw DIR] [line ...]
  ELEVENLABS_API_KEY: an ElevenLabs API key with text to speech access (never stored in the repository).
  Needs ffmpeg on the PATH (and numpy).
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'audio', 'announcer')

MODEL = 'eleven_v4'
# Low stability: a freer, more expressive performance (v4 has no style or speed settings).
VOICE_SETTINGS = {'stability': 0.3, 'similarity_boost': 0.8}
SEEDS = [2097, 1994, 7, 42, 99]
# Takes picked by ear: the seed to use (the others carried something extra).
PICKS = {('female', 'win-thorn'): 42}

ROBOTS = ['jaguar', 'shadow', 'thorn', 'pyros', 'electra', 'katana', 'shredder', 'flail', 'gargoyle', 'chronos', 'nova',
          'glacier', 'tempest', 'helix', 'spectre']
NUMBERS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN']

# The two announcers (voices from the ElevenLabs voice library) and how each performs every line. Victor is deep,
# malevolent and ancient: an ominous, booming master of ceremonies. Kristen is a cold villain queen: icy, sharp and
# commanding. The tags describe the delivery (descriptive tags are less likely to be taken for sound effects).
VOICES = {
    'male': {
        'id': 'cPoqAvGWCPfCfyPMwe4z', 'name': 'Victor',
        'lines': {
            **{f'round{i + 1}': f'[booming, quick and punchy] ROUND {n}!' for i, n in enumerate(NUMBERS)},
            'final': '[booming, quick and punchy] FINAL ROUND!',
            'ready': '[low, menacing, quick] Ready?',
            'fight': '[shouting, fierce] FIGHT!',
            'ko': '[shouting, ecstatic] KNOCKOUT!',
            'perfect': '[amazed, booming] PERFECT!',
            'scrap': '[cruel, gleeful] SCRAP!',
            'destruction': '[savage, drawn-out shout] DESTRUCTION!',
            'youwin': '[triumphant, booming] YOU WIN!',
            'youlose': '[cold, mocking] You lose.',
            'draw': '[unimpressed, flat] Draw game.',
            'newrecord': '[impressed, booming] NEW RECORD!',
            'finalfight': '[booming, quick and ominous] FINAL FIGHT!',
            **{f'win-{r}': f'[triumphant, booming] {r.upper()}... WINS!' for r in ROBOTS},
        },
    },
    'female': {
        'id': 'Qbw4VpyUrHEG7NigKzty', 'name': 'Kristen',
        'lines': {
            **{f'round{i + 1}': f'[commanding, sharp and quick] ROUND {n}!' for i, n in enumerate(NUMBERS)},
            'final': '[intense, commanding, quick] FINAL ROUND!',
            'ready': '[cold, taunting, quick] Ready?',
            'fight': '[commanding shout] FIGHT!',
            'ko': '[cold delight, rising] KNOCKOUT!',
            'perfect': '[impressed, icy] PERFECT!',
            'scrap': '[cruel, amused] SCRAP!',
            'destruction': '[savoring it, menacing] DESTRUCTION!',
            'youwin': '[regal, approving] You WIN!',
            'youlose': '[cold, contemptuous] You lose.',
            'draw': '[bored, disdainful] Draw game.',
            'newrecord': '[pleased, commanding] NEW RECORD!',
            'finalfight': '[ominous, commanding, quick] FINAL FIGHT!',
            **{f'win-{r}': f'[regal, triumphant] {r.upper()} WINS!' for r in ROBOTS},
        },
    },
}
# Lines meant to be quiet or cold: their takes are chosen for a typical length, not intensity.
CALM = {'ready', 'youlose', 'draw'}
# The round calls come about 1.2 s before "Fight!" (at the default game speed): longer takes are tightened up.
MAX_SECONDS = {**{f'round{i}': 1.2 for i in range(1, 8)}, 'final': 1.2, 'finalfight': 1.2, 'ready': 1.2}

# Trim the silence at both ends, a little of the arena's echo, then compression.
FINISH = ','.join([
    'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02',
    'areverse', 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.06', 'areverse',
    'highpass=f=60',
    'aecho=0.9:0.5:85|170:0.1|0.04',
    'acompressor=threshold=-18dB:ratio=3:attack=4:release=90:makeup=2',
    'apad=pad_dur=0.12',
])
LOUDNESS = 'loudnorm=I=-15:TP=-1.2:LRA=7'


def speak(key, voice_id, text, seed):
    body = json.dumps({'text': text, 'model_id': MODEL, 'voice_settings': VOICE_SETTINGS, 'seed': seed}).encode()
    req = urllib.request.Request(
        f'https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128', data=body, method='POST',
        headers={'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f'ElevenLabs: {e.code} {e.read().decode(errors="replace")[:300]}')


def measure(path, sr=22050):
    """(speech length in s, speech loudness in dB, spectral centroid in Hz) of a take."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(sr), '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype='<f4')
    hop, n = sr // 100, 1024
    frames = [x[i:i + n] for i in range(0, max(1, len(x) - n), hop)]
    rms = np.array([np.sqrt((f ** 2).mean()) for f in frames])
    speech = rms > max(0.01, rms.max() * 0.05)
    if not speech.any():
        return 0.0, -60.0, 0.0
    idx = np.nonzero(speech)[0]
    length = (idx[-1] - idx[0] + 1) * hop / sr
    freqs = np.fft.rfftfreq(n, 1 / sr)
    cents = []
    for i in idx:
        mag = np.abs(np.fft.rfft(frames[i] * np.hanning(n)))
        cents.append(float((freqs * mag).sum() / (mag.sum() + 1e-9)))
    return length, float(20 * np.log10(np.sqrt((rms[idx] ** 2).mean()))), float(np.mean(cents))


def choose(takes, calm):
    """The take to keep: takes = [(path, (length, loudness, centroid))]."""
    lengths = sorted(t[1][0] for t in takes)
    median = lengths[len(lengths) // 2] if len(lengths) > 2 else lengths[0]
    ok = [t for t in takes if 0.5 * median <= t[1][0] <= 1.5 * median] or takes
    if calm:
        return min(ok, key=lambda t: abs(t[1][0] - median))[0]
    return max(ok, key=lambda t: t[1][1] + t[1][2] / 400)[0]


def finish(src, dst, max_seconds=None):
    """ffmpeg: FINISH (sped up to max_seconds if longer, keeping the pitch), then two-pass loudness normalization."""
    chain = FINISH
    if max_seconds:
        length = measure(src)[0] + 0.12
        if length > max_seconds:
            chain += f',atempo={min(1.3, length / max_seconds):.3f}'
    probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af', f'{chain},{LOUDNESS}:print_format=json', '-f', 'null', '-'],
                           capture_output=True, text=True, check=True).stderr
    m = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', probe, re.S).group(0))
    second = (f"{LOUDNESS}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
              f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', f'{chain},{second}', '-ar', '44100', '-ac', '1',
                    '-c:a', 'libmp3lame', '-b:a', '128k', dst], check=True)


def main():
    key = os.environ.get('ELEVENLABS_API_KEY')
    if not key:
        sys.exit('set ELEVENLABS_API_KEY to an ElevenLabs API key')
    args = sys.argv[1:]

    def option(name, default):
        if name in args:
            i = args.index(name)
            value = args[i + 1]
            del args[i:i + 2]
            return value
        return default
    voice = option('--voice', None)
    takes = int(option('--takes', 2))
    keep = option('--keep-raw', None)
    wanted = args
    with tempfile.TemporaryDirectory() as tmp:
        tmp = keep or tmp
        os.makedirs(tmp, exist_ok=True)
        for name in [voice] if voice else list(VOICES):
            v = VOICES[name]
            os.makedirs(os.path.join(OUT, name), exist_ok=True)
            for line in wanted or list(v['lines']):
                text = v['lines'][line]
                done = []
                for seed in [PICKS[(name, line)]] if (name, line) in PICKS else SEEDS[:takes]:
                    raw = os.path.join(tmp, f'{name}-{line}-{seed}.mp3')
                    with open(raw, 'wb') as f:
                        f.write(speak(key, v['id'], text, seed))
                    done.append((raw, measure(raw)))
                best = choose(done, line in CALM)
                finish(best, os.path.join(OUT, name, f'{line}.mp3'), MAX_SECONDS.get(line))
                print(f'{name}/{line}.mp3  {text}  ({v["name"]}, seed {os.path.basename(best)[:-4].rsplit("-", 1)[-1]})')


if __name__ == '__main__':
    main()
