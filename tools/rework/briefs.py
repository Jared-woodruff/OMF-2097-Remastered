"""The consistency rework pack's texts (tools/rework/export.py): per robot the brief of its definitive design, the
prompts of the design sheet and of the frames, and the pack's documents.

The original robots' HD frames were painted one by one (the HD asset pack's "upscale" jobs, without a shared design
reference), and on some robots the paintings disagree from frame to frame: wing ribs, spikes and coil turns change in
number, plates and facets are re-cut (tools/rework/survey.py measures it). The rework, like the new-art pack
(tools/hd-pack/newart.ts), first fixes each robot's design on one design sheet (made from its best current painting
and its source), then redraws every frame from it.
"""

# The HD asset pack's look (tools/hd-pack/prompts.ts STYLE), tied to the design sheet: its wear, its lighting.
STYLE = (
    'Faithful high-resolution remaster of the original 1994 artwork: identical design, pose, proportions, camera angle '
    'and color scheme, re-rendered with modern high-end 3D CGI quality: crisp clean edges, the design sheet\'s '
    'hard-surface panels, plate lines and bolts, physically based metal and enamel materials, smooth gradients (no '
    'dithering or banding), soft realistic lighting and reflections like the design sheet\'s, sharp focus, 1990s '
    'sci-fi arcade aesthetic.'
)

# The HD asset pack's negative prompt for sprites (tools/hd-pack/prompts.ts NEGATIVE_SPRITE) and what went wrong.
NEGATIVE = (
    'pixel art, pixelated, dithering, color banding, jpeg artifacts, blurry, soft focus, lowres, noise, grain, text, '
    'letters, numbers, logo, watermark, signature, UI, frame, border, cropped subject, extra limbs, extra objects, '
    'changed pose, different design, redesigned character, different colors, cartoon, anime, cel shading, sketch, '
    'painterly brush strokes, photo of a toy, plastic toy look, deformed, distorted perspective, background, scenery, '
    'floor, ground shadow, backdrop, vignette, drop shadow, extra or missing ribs, spikes, fangs or plates, different '
    'number of parts, different panel lines, re-cut facets, random scratches, decals, texture noise'
)


class Robot:
    def __init__(self, name, file, description, design_frame, zones, parts, summary, varies, effects=()):
        self.name = name
        self.file = file
        self.description = description
        # The idle frame the design sheet is made from (its source and its current painting): the frame whose
        # painting agrees best with the robot's other paintings and with its own source (tools/rework/survey.py).
        self.design_frame = design_frame
        self.zones = zones
        # The definitive design, part by part: what the design sheet fixes and every frame copies.
        self.parts = parts
        # The same, short (for the frames' prompts).
        self.summary = summary
        # What the current paintings disagree about.
        self.varies = varies
        # Move folders that hold effects, not the robot (left out, like the projectiles).
        self.effects = set(effects)


ROBOTS = {
    'GARGOYLE': Robot(
        name='Gargoyle', file='FIGHTR8.AF',
        description='a winged, demonic combat robot with large bat-like mechanical wings (gold membranes on blue ribs), '
                    'a long-necked horned head, red talons, spikes and bird-like legs',
        design_frame='m11_idle/f003',
        zones={
            'blue': 'the wing arms and the wing ribs, the neck and head, the dark navy chest cage, the arms and the legs',
            'red': 'the horns, the wing claws, the blade spines on the chest, the pincers, the talons and the ball joints',
            'gold': 'the wing membranes',
        },
        parts=[
            'Wings: each is a blue tubular wing arm, from the shoulder to a bolted elbow pivot, then a long forearm to '
            'the wing tip; a big curved red horn rises from the elbow and a smaller red hook sits at the front pivot.',
            'Wing ribs: blue round tubes with a bolt head where each meets the arm and a pointed tip, fanning from the '
            'forearm and the elbow down to the trailing edge. Count the ribs of each wing in `source.png` and paint '
            'exactly that many, spaced as there (the current paintings show 4 to 8 on the near wing).',
            'Membranes: smooth satin gold, stretched flat between neighbouring ribs; the trailing edge is cut into one '
            'concave scallop per bay with a point at every rib tip. No holes, no extra struts, no painted patterns.',
            'Neck and head: a long blue neck of overlapping hose-like segments curving forward into a hooked head; its '
            'red horns and fangs as in the source (a fixed number).',
            'Chest: a dark navy cage of vertical ribs (a fixed number) behind the arms, with a fan of red blade spines '
            'along its side (a fixed number). Always this cage: never red bands, plates or a smooth chest.',
            'Arms: thin blue tubes with red ball joints, each ending in a two-pronged red pincer.',
            'Legs: bird-like, long blue segments with red ball joints at the hip, knee and ankle; red talon feet (the '
            'claws as in the source).',
            'Surfaces: glossy blue enamel with a few fine panel lines and small bolts at the joints, the same lines and '
            'bolts in every frame; red parts polished like chrome; no scratches or decals that could change between '
            'frames.',
        ],
        summary='jointed wing arms with bolted elbows and red horns, the design sheet\'s number of bolted finger ribs '
                'per wing, smooth gold membranes with one scallop per bay, the segmented neck and hooked horned head, '
                'the dark navy ribbed chest cage with its fan of red blade spines, red ball joints, pincers and talons',
        varies='the number and spacing of the wing ribs (4 to 8 on the near wing), the shape of the membranes\' '
               'trailing edge, the chest (a dark ribbed cage in some frames, red bands or plates in others), the number '
               'of chest spines, horns and fangs, the plate lines of the neck and limbs',
    ),
    'FLAIL': Robot(
        name='Flail', file='FIGHTR7.AF',
        description='a top-heavy combat robot with a wide blue armored head-body with red eyes, riding on a gold coiled '
                    'spring column above a big spiked wheel, swinging chains with spiked balls and a hammer from its arms',
        design_frame='m11_idle/f000',
        zones={
            'blue': 'the head-body shell, the arm tubes, the chains, the balls on top of the masts, the wheel\'s tire and hub',
            'red': 'the visor slit, the half-dome ears, the joint caps, the bands of the fist, the claw\'s fingertips and '
                   'the cross on the wheel hub',
            'gold': 'the two masts, the fangs, the coil spring, the cone weights of the chains, the arm rods and the '
                    'spikes of the wheel',
        },
        parts=[
            'Head-body: one wide, angular blue armor shell (head and torso in one), with the plate layout of '
            '`guide.png`: the same seams, bevels and bolts in every frame; a narrow red visor slit across the front; '
            'a red half-dome ear on each side.',
            'Fangs: a row of curved gold fangs hanging from the front edge of the shell, and one upright gold fang in '
            'the middle; a fixed number (as in `guide.png`).',
            'Masts: two gold poles rising from the back of the shell, each topped by a blue ball; from each ball a blue '
            'chain with links of one size hangs down to a gold cone weight.',
            'Arms: blue tubes with red joint caps and gold rods; the left ends in a block fist wrapped in red bands '
            '(a fixed number), the right in an open claw with red fingertips.',
            'Spring column: a gold coil spring around a dark core under the shell, with exactly the number of turns of '
            '`guide.png` (the current paintings show 3 to 5); it compresses and stretches with the source, it does not '
            'gain or lose turns.',
            'Wheel: a thick blue tire ringed with gold cone spikes (a fixed number, evenly spaced: count them in the '
            'source) and a blue hub with a red four-spoke cross; the second wheel behind it is the same. When the '
            'source turns the wheel, the spikes turn with it.',
            'Surfaces: glossy blue enamel with crisp bevels, polished gold, red chrome caps; no scratches or decals that '
            'could change between frames.',
        ],
        summary='the angular blue head-body shell with the design sheet\'s plate lines, red visor and half-dome ears, '
                'its fixed row of gold fangs, two gold masts with blue balls and chains ending in gold cones, the gold '
                'coil spring with the design sheet\'s number of turns, the spiked wheel with its fixed number of gold '
                'spikes and red hub cross',
        varies='the number of turns of the coil spring (3 to 5), the number and layout of the wheel\'s spikes, the '
               'plate lines and bevels of the head-body shell, the number of fangs, the fist\'s bands',
    ),
    'ELECTRA': Robot(
        name='Electra', file='FIGHTR4.AF',
        description='a slender, spiky combat robot with a red pointed crown, a blue diamond-shaped crystalline torso, red '
                    'angular shoulder and hip plates, gold spiky legs with claw feet, and crackling light-blue lightning '
                    'in its hands',
        design_frame='m11_idle/f002',
        zones={
            'blue': 'the crystal torso, the face inside it and the crystal shards on the shoulders',
            'red': 'the horns of the crown and the shoulder, arm, hip and thigh plates',
            'gold': 'the crest between the horns, the forearms and fists, the shins and the claw feet',
        },
        parts=[
            'Crown: two tall red pyramid horns with a gold triangular crest between them.',
            'Face: a dark blue visor face with a grille mouth, set into the top of the crystal torso under the crown: '
            'the same face in every frame (the current paintings alternate between a grille, a skull and nothing).',
            'Crystal torso: an inverted kite of faceted blue crystal with a central vertical ridge and the facet layout '
            'of `guide.png`: the same facets, edges and highlights in every frame, turned with the body as the source '
            'turns (the current paintings re-cut the facets in every frame).',
            'Crystal shards: blue crystal spikes on the shoulders, a fixed number (as in the source).',
            'Limbs: red angular faceted plates on the shoulders, upper arms, hips and thighs; gold faceted forearms '
            'ending in cone-shaped fists; gold faceted shins with three-toed claw feet. Flat facets with crisp edges, '
            'the same facet layout in every frame.',
            'Lightning: the light blue electric arcs around the hands (and across the body where the source shows them) '
            'are effects: paint them where the source has them; they may change from frame to frame, the robot under '
            'them may not.',
        ],
        summary='the red two-horned crown with its gold crest, the grille face set into the crystal, the faceted blue '
                'crystal torso with the design sheet\'s facet layout, the crystal shoulder shards, red faceted limb '
                'plates, gold faceted forearms, cone fists, shins and claw feet',
        varies='the facets of the crystal torso (re-cut in every frame), the face inside the crystal (a grille, a skull '
               'or nothing), the number of shoulder shards, the facet layout of the limbs',
        effects=('m29_basic', 'm38_victory', 'm58_misc'),
    ),
}

DEFAULT_ROBOTS = ['GARGOYLE', 'FLAIL', 'ELECTRA']


def describe_move(name: str) -> str:
    """Readable description of a fighter animation folder name (tools/hd-pack/prompts.ts describeMove)."""
    base = name.split('_', 1)[1] if '_' in name else name
    known = {
        'idle': 'idle fighting stance (breathing loop)', 'walk': 'walking cycle', 'jump': 'jumping',
        'crouch': 'crouching', 'block': 'standing block (guard)', 'crouch_block': 'crouching block',
        'hit_reaction': 'getting hit (damage reaction)', 'stand_up': 'getting up from the floor',
        'stunned': 'stunned and dizzy', 'victory': 'victory pose', 'defeat': 'defeated, collapsing',
    }
    if base in known:
        return known[base]
    if base.startswith('scrap_finisher'):
        return 'scrap finishing move (after winning the fight)'
    if base.startswith('destruction_finisher'):
        return 'destruction finishing move (after winning the fight)'
    for kind in ('close', 'low', 'medium', 'high', 'jump'):
        if base.startswith(f'{kind}_attack'):
            return f"{'jumping' if kind == 'jump' else kind} attack"
    return base.replace('_', ' ')


def zones_text(r: Robot) -> str:
    return f"steel blue for {r.zones['blue']}; red for {r.zones['red']}; gold for {r.zones['gold']}"


def design_prompt(r: Robot) -> str:
    return (f'{r.name}, {r.description}, from the robot fighting game One Must Fall 2097. Design sheet: the definitive, '
            'detailed full-body render of the robot in exactly the pose, silhouette and facing direction of the source '
            'frame (its fighting stance), isolated on a transparent background. Every animation frame of the robot will '
            'be redrawn from it, so every part is fixed and every repeated part countable and regular: '
            + ' '.join(r.parts) + f' Color zones exactly as in the source: {zones_text(r)}; white, grey, black and effect '
            f'colors fixed. {STYLE}')


def frame_prompt(r: Robot, move: str) -> str:
    return (f'{r.name}, {r.description}, from the robot fighting game One Must Fall 2097. Animation: {describe_move(move)}. '
            'Redraw the source frame as the robot of the design sheet `../design/design.hd.png`, copying its design '
            f'exactly: {r.summary}; the same parts, counts, plate lines, panel shapes, joints, bolts, materials, colors '
            'and lighting. The pose, the silhouette, the facing direction and the color zones come from the source frame. '
            f'Isolated on a transparent background. Color zones exactly as in the source: {zones_text(r)}; white, grey, '
            f'black and effect colors fixed. {STYLE}')


# ---- Documents ---------------------------------------------------------------------------------------------------

def readme(robots: list, counts: dict, survey: dict) -> str:
    total = sum(counts[h]['frames'] for h in robots)
    rows = [f"| {ROBOTS[h].name} | `tier2_fighters/{h}/` | 1 | {counts[h]['frames']} | "
            f"{counts[h]['design_size']} | {survey.get(h, '-')} |" for h in robots]
    names = ', '.join(ROBOTS[h].name for h in robots)
    return '\n'.join([
        '# One Must Fall 2097 Remastered — consistency rework',
        '',
        f'The HD paintings of some of the original robots ({names}) change from frame to frame: the same wing, chest',
        'or wheel is painted with a different number of ribs, spikes or coil turns, and plates and facets are re-cut in',
        'every frame, although the robots\' pixel sources are the same (the frames were painted one by one, without a',
        'shared design). In the game the armor flickers. This pack asks for these robots again, the way the remaster\'s',
        'new robots were painted: **one design sheet per robot first**, then **every frame redrawn from it**.',
        '',
        '## How to process it',
        '',
        '1. Read [OUTPUT_SPEC.md](OUTPUT_SPEC.md) (hard rules) and [STYLE_GUIDE.md](STYLE_GUIDE.md) (the look, each',
        '   robot\'s definitive design and what went wrong). `reference/consistency/` shows where the current paintings',
        '   disagree.',
        '2. **Design sheets first** (one per robot, `tier2_fighters/<ROBOT>/design/` → `design.hd.png`): the robot in its',
        '   fighting stance at twice the frame scale, made from `guide.png` (its best current painting, enlarged) and',
        '   `source.png`. It settles every detail once: how many ribs, spikes, fangs and coil turns, where the plate',
        '   lines and bolts go, how the facets are cut. Write what you settled into `design/design_notes.md`.',
        '3. Show the design sheets to the game\'s author before painting the frames: a change afterwards means redoing',
        '   all of a robot\'s frames.',
        '4. **Then every frame** (`mNN_<move>/fNNN.png` → `fNNN.hd.png`): the robot of the design sheet in the pose of',
        '   the source frame. Same model, settings and seed for all of a robot\'s frames, the design sheet as the',
        '   reference image.',
        '5. Take the jobs from `jobs.jsonl` or `jobs.csv` (same data, design sheets first). Return the folder with the',
        '   new `*.hd.png` files (and the `design_notes.md` files). Partial deliveries work: whatever is missing keeps',
        '   its current painting.',
        '',
        '| Robot | Folder | Design sheet | Frames | Design sheet size | Inconsistency now |',
        '| --- | --- | ---: | ---: | --- | ---: |',
        *rows,
        f'| **Total** | | **{len(robots)}** | **{total}** | | |',
        '',
        '(Inconsistency: how differently the current paintings show the same source detail, 0 = the same; the most',
        'consistent original robot scores about 0.04. `reference/consistency/survey_ranking.txt` has the full survey.)',
        '',
        'A robot folder is laid out like the HD asset pack\'s: `README.md`, `reference_sheet.png` (key poses) and per',
        'move `fNNN.png` (the source frames, 4 transparent pixels around the sprite), `sheet.png` / `sheet_preview.png`',
        '(the whole animation, native and at the right proportions), `frames.csv` (outputs and sizes), `prompt.md`, and',
        '`current.png`: the move\'s current paintings, for the level of finish only (their details are the problem).',
        'For image-to-image tools that need inputs at the output size, `make_inputs.py` (Python + Pillow) makes',
        '`*.input.png` files next to the sources.',
        '',
        '## Keeping ~150 frames identical',
        '',
        '- Every frame copies the design sheet: count the ribs, spikes, fangs, turns and bolts against it, frame by frame.',
        '- Parts that keep their shape from pose to pose (a wing panel, the head, the chest, a wheel) can be carried over',
        '  from the design sheet with rigid (affine or projective) transforms and blended in, instead of being',
        '  re-imagined: that keeps them identical.',
        '- Check each move\'s frames side by side (`sheet_preview.png` shows the pose sequence) and against the design',
        '  sheet before moving on; the same lighting in every frame.',
        '',
    ])


def output_spec(robots: list) -> str:
    return '\n'.join([
        '# Output specification (hard requirements)',
        '',
        '## Names',
        '',
        'Save each result under the job\'s `output` path (next to its source): `fNNN.png` → `fNNN.hd.png`,',
        '`design/source.png` → `design/design.hd.png`. Do not rename, move or edit other files.',
        '',
        '## Frames',
        '',
        '- The job\'s `width` × `height` (`frames.csv`: 5× the source\'s width, 6× its height, the game\'s pixels are',
        '  taller than wide), or exactly 2× or 3× that (like the current paintings): larger is kept for the future.',
        '- PNG, RGBA, 8 bits per channel, sRGB, **real transparency** (straight alpha), soft anti-aliased edges, no',
        '  halos, no background, no ground shadow. (Only if a tool cannot output transparency: a flat pure magenta',
        '  #FF00FF background, with no magenta in the robot.)',
        '- **Pose, silhouette and facing locked:** the robot stays inside the outline of its source frame (enlarged) and',
        '  keeps its pose and facing direction exactly. The game draws each frame at the source\'s position and maps',
        '  every HD pixel onto the source\'s pixels to recolor it: anything outside the outline is cut off on import.',
        '- The sources have a transparent margin (4 source pixels): keep it transparent.',
        '- **Color zones locked:** steel blue, red and gold are the three colors players choose for their robot (see',
        '  `reference/robot_color_zones.png`). Keep each zone exactly where the source has it and in its own hue',
        '  family, shaded with lighter and darker tones of the same hue; do not mix them. White, grey, black and effect',
        '  colors (lightning, sparks) are fixed.',
        '- **Design locked:** every frame is the machine of its robot\'s design sheet: the same parts, the same number',
        '  of ribs, spikes, fangs, coil turns and bolts, the same plate lines, panel shapes, facets, joints, materials,',
        '  colors and lighting. Where the source frame and the design sheet disagree about a detail too small for the',
        '  source to show, the design sheet wins; the pose, the outline and the color zones always come from the source.',
        '',
        '## Design sheets',
        '',
        '- `design/design.hd.png`: the job\'s `width` × `height` (twice the frame scale of its source frame), PNG RGBA',
        '  with real transparency, the same rules as a frame (pose, silhouette, facing and color zones of',
        '  `design/source.png`).',
        '- Not used in the game: the reference for the frames (and for the game\'s author to approve).',
        '- Recommended: `design/design_notes.md`, the settled details in words (counts, plate lines, facets).',
        '',
        '## Delivery',
        '',
        '- Return this folder with the `*.hd.png` files added (`*.input.png` files can stay or be deleted).',
        '- Optional: `NOTES.md` at the root listing skipped or problematic jobs.',
        '',
    ])


def style_guide(robots: list) -> str:
    out = [
        '# Style guide',
        '',
        '## The look',
        '',
        STYLE,
        '',
        'The robots\' current HD paintings already have the right finish (see `current.png` in every move folder and',
        '`reference/original_robots.png`): keep it. What changes is consistency: one design, painted the same way in',
        'every frame, like a 3D model rendered from a new pose.',
        '',
        'Negative prompt:',
        '',
        f'> {NEGATIVE}',
        '',
        '## The robots',
        '',
    ]
    for h in robots:
        r = ROBOTS[h]
        out += [
            f'### {r.name} (`tier2_fighters/{h}/`, {r.file})',
            '',
            f'{r.name} is {r.description}.',
            '',
            f'**What the current paintings disagree about:** {r.varies}.',
            '',
            '**The definitive design** (the design sheet settles it, every frame copies it):',
            '',
            *[f'- {p}' for p in r.parts],
            '',
            f'Color zones: steel blue = {r.zones["blue"]}; red = {r.zones["red"]}; gold = {r.zones["gold"]}.',
            '',
        ]
    return '\n'.join(out)


def robot_readme(h: str, moves: int, frames: int, design_frame: str, score) -> str:
    r = ROBOTS[h]
    return '\n'.join([
        f'# {r.name} ({r.file})',
        '',
        f'{r.name} is {r.description}.',
        '',
        f'The current paintings disagree about {r.varies}'
        + (f' (inconsistency {score}).' if score is not None else '.'),
        '',
        f'1. `design/`: the design sheet (`design.hd.png`), first. Made from the current painting of `{design_frame}`',
        '   (`guide.png`, the one that agrees best with the others and with its source) and its source.',
        f'2. {moves} animations, {frames} frames: each move folder has its `prompt.md`, `sheet.png`, `sheet_preview.png`,',
        '   `frames.csv` and `current.png`. Redraw every frame as the robot of the design sheet.',
        '',
        f'- Steel blue: {r.zones["blue"]}. Red: {r.zones["red"]}. Gold: {r.zones["gold"]}. White, grey, black and '
        'effect colors are fixed.',
        '- `reference_sheet.png`: key poses at the correct proportions (idle, walk, jump, crouch, victory).',
        '- The same model, settings and seed for the whole robot, the design sheet as the reference image.',
        '',
    ])
