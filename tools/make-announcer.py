"""
Makes the announcer's voice lines (public/audio/announcer/*.mp3): spoken by eSpeak NG (open source speech synthesis,
https://github.com/espeak-ng/espeak-ng) with its "announcer" voice, then made to sound like an arena's PA system with
ffmpeg: the thin band of a horn speaker, a little metallic ring, the echo of a big hall, and compression.

The lines are plain MP3 files: replace any of them with your own recording (same file name) to change the voice.

Usage: python tools/make-announcer.py [line ...]
  ESPEAK_NG: path of espeak-ng(.exe) when it is not on the PATH or in its usual install folder.
  Needs ffmpeg on the PATH.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'audio', 'announcer')

ROBOTS = ['jaguar', 'shadow', 'thorn', 'pyros', 'electra', 'katana', 'shredder', 'flail', 'gargoyle', 'chronos', 'nova',
          'glacier', 'tempest', 'helix', 'spectre']
NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven']

# File name -> what is said (SSML; prosody makes the calls sound called out).
LINES = {
    **{f'round{i + 1}': f'Round {n}.' for i, n in enumerate(NUMBERS)},
    'final': 'Final round.',
    'ready': 'Ready?',
    'fight': '<prosody pitch="+25%" rate="80%">Fight!</prosody>',
    'ko': '<prosody pitch="+15%" rate="85%">Knockout!</prosody>',
    'perfect': '<prosody pitch="+20%" rate="80%">Perfect!</prosody>',
    'scrap': '<prosody pitch="+10%">Scrap!</prosody>',
    'destruction': '<prosody pitch="+15%" rate="85%">Destruction!</prosody>',
    'youwin': 'You win.',
    'youlose': 'You lose.',
    'draw': 'Draw.',
    'newrecord': 'New record!',
    'finalfight': 'Final fight.',
    **{f'win-{r}': f'{r.capitalize()} wins.' for r in ROBOTS},
}

# The PA: horn speaker band, slight ring (a 38 Hz tremolo mixed in), a hall's slapback echo, then even loudness.
FILTER = ','.join([
    'highpass=f=170', 'lowpass=f=5200',
    "aeval='val(0)*(0.78+0.22*sin(2*PI*38*t))':c=same",
    'aecho=0.85:0.55:70|140|230:0.28|0.16|0.08',
    'acompressor=threshold=-20dB:ratio=4:attack=5:release=120',
    'loudnorm=I=-15:TP=-1.5:LRA=7',
])


def find_espeak():
    env = os.environ.get('ESPEAK_NG')
    if env:
        return env
    found = shutil.which('espeak-ng')
    if found:
        return found
    for p in [r'C:\Program Files\eSpeak NG\espeak-ng.exe', r'C:\Program Files (x86)\eSpeak NG\espeak-ng.exe']:
        if os.path.exists(p):
            return p
    sys.exit('espeak-ng not found: install it, or set ESPEAK_NG to its path')


def main():
    espeak = find_espeak()
    data = os.path.dirname(espeak)
    wanted = sys.argv[1:] or list(LINES)
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name in wanted:
            text = LINES[name]
            wav = os.path.join(tmp, f'{name}.wav')
            args = [espeak, '-m', '-v', 'en-us+announcer', '-s', '138', '-p', '38', '-w', wav, f'<speak>{text}</speak>']
            if os.path.exists(os.path.join(data, 'espeak-ng-data')):
                args[1:1] = [f'--path={data}']
            subprocess.run(args, check=True)
            mp3 = os.path.join(OUT, f'{name}.mp3')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-af', FILTER, '-ar', '44100', '-ac', '1', '-b:a', '96k', mp3],
                           check=True)
            print(name)


if __name__ == '__main__':
    main()
