# Blender sprites: HD robot frames rendered from the 3D models (proposal)

The HD frames of the new robots (and of the originals in the rework pack) are painted one by one by an image model,
so the same part is painted differently from frame to frame and the armor flickers in the game (`npm run
rework:survey` measures it; `npm run rework:export` asks for three robots again). The new robots are 3D models already
(`src/gen`): this note proposes rendering their frames in Blender instead of painting over them, and reports a proof
on HELIX.

<p align="center"><img src="media/blender-sprites.jpg" alt="HELIX: the sprite, the current painting, the Blender rendering and its zone mask, four frames" width="70%"></p>

## The proof (HELIX)

```sh
npm run blender:export                        # .captures/blender/helix.glb (+ helix/sprites/*.png)
npm run blender:render -- HELIX --moves 11    # .captures/blender/helix/hd: HD pictures and zone masks
python tools/blender/score.py --robot HELIX --renders <folder rendered with --pack newart-pack>
```

- **Export** (`tools/blender/`, run through Vitest like the HD packs' exporters; nothing of it is in the game's
  bundle). `tessellate.ts` builds a mesh for each of the generator's shape kinds from its definition (the game draws
  them from distance functions): prisms keep their flat faces, rounded boxes and blades their exact rounded edges.
  `robotGltf.ts` writes a glTF binary: the parts as one mesh skinned to the 16-joint skeleton (plus a root carrying
  the robot's height and turn), materials per color zone and shade, and every sprite pose of the fighter file as a
  keyframe of one animation (STEP, pose *i* at Blender frame *i* + 1), with each sprite's rectangle in the scene's
  extras. The game's axes and units are kept (x forward, y up, z toward the viewer; 1 native pixel = 1 cm).
  `export.test.ts` checks it against the game itself: every vertex lies on its shape's surface, meshes are closed and
  face outward, the skeleton reproduces `jointTransforms` for arbitrary poses and every skinned vertex lands on the
  pose's shapes. All 126 of the exported sprites that the new-art pack has are pixel-identical to its sources.
- **Render** (`render_frames.py`, Blender 5.2, headless): per pose, an orthographic camera on the sprite's rectangle
  plus the packs' 4-pixel margin at 5 × 6 pixels per native pixel (`--scale 3` for the 15 × 18 delivery size), so
  every picture lies exactly over its sprite. Lights come from the game's directions (key upper left front, fill
  right) with a rim and a studio for the metal to reflect; colors are the reference palette the mod's HD pictures are
  painted in (`hd.json` colors 0, 1, 13), so the live recoloring works unchanged. Surface detail is fixed to the
  parts (rounded and worn edges, grime in rest-pose coordinates) or follows from the pose (occlusion between parts),
  so nothing swims between frames.
- **Zone masks** (second pass): every material becomes a flat emission, R = secondary (red zone), G = tertiary
  (gold), B = primary (blue), linear, so the channels are each zone's coverage (they add up to alpha, also where
  zones meet); effect colors have alpha only. `zone_masks.py` does the same pass over a saved scene, such as the
  render kit's (`render_asset.py --save-blend`).
- **Score** (`score.py`): the renderings and the current paintings of the same 126 jobs go through
  `tools/rework/survey.py` and `tools/hd-pack/validate.py`, and the masks are compared with the sprites' zones.

| HELIX, 126 frames | Blender | Current paintings |
| --- | ---: | ---: |
| Inconsistency (survey, 0 = the same detail; the best original robot: 0.039) | **−0.071** | 0.173 |
| … fine detail / structure bands | −0.095 / −0.047 | 0.225 / 0.121 |
| Silhouette IoU with the sprite (median) | **0.992** | 0.976 |
| Drawn outside the sprite / holes | 0 / 0 | 0 / 0.001 |
| Brightness (the sprites: 101) | 79.8 | 80.7 |
| Color difference from the sprite (0–255, median) | 45.4 | **35.9** |
| Color zones kept (median; none below 0.8 in either) | 0.963 | **0.994** |
| Zone masks agreeing with the sprites' zones | 99.2 % of 189,676 pixels | – |

Export: 1 s (148 poses, 15,204 triangles, 0.7 MB). Rendering all 126 frames and their masks: 31 s on an RTX 4080
(OptiX), after a one-time kernel compile of about 80 s.

<p align="center"><img src="media/blender-loops.gif" alt="HELIX's idle and walk loops: the current paintings beside the Blender renderings" width="50%"></p>

What it shows:

- **Consistency is solved by construction.** The renderings score below zero: they differ less from frame to frame
  than the dithered sources do. The current paintings of the same frames score 0.173 (the robots in the rework pack:
  0.23 to 0.27).
- **Placement and zones are exact.** The poses, rectangles and silhouettes are the game's own; the masks agree with
  the sprites on 99.2 % of the zone pixels (the rest are dithered and edge pixels).
- **The gap is detail.** A rendering shows the generator's model as it is (prisms, boxes, blades), where the
  paintings invent panel lines, bolts, cables, a spiral drill, tread boots and wear. The color difference from the
  sprite is higher because the frames are lit again rather than traced from the sprite's own shading (brightness
  and zone colors are calibrated to the paintings: `--light`, `--exposure`, `--saturation` change the look).

## Proposed pipeline

1. **Poses from the game data** (done): `fighterOf(robot)` gives every sprite's pose and `traceShapes` its
   rectangle; `npm run blender:export` writes them with the model. Re-export whenever `src/gen` changes.
2. **Detail once per robot, in 3D.** The design sheet becomes a Blender file: bevels, panel seams (normal maps or
   trim sheets), bolts, pistons, cables, the spiral drill and treads, modeled per part and parented to its bone
   (bone names are the joint names), with materials in part space; the render script would append it on top of the
   export, so every frame shows the same detail. (Painting over the renderings with low-strength image-to-image would
   bring the detail back sooner, but anything invented per frame flickers again: only detail fixed to the model stays
   put.)
3. **Render at the HD spec** (done) with `render_frames.py --pack <pack> --scale 3`: the pack's job names, the
   reference palette, the game's light directions.
4. **Zone masks per frame** (done), checked against the sprites' zones (and usable later as an exact recolor
   channel, finer than the native pixel the renderer maps each HD pixel to).
5. **Score as a gate** with `score.py` (done; thresholds to agree on), for example inconsistency below 0.05,
   silhouette IoU above 0.97, zones kept above 0.9 and mask agreement above 0.98.
6. **Import** like a delivery of the new-art pack (`npm run newart:import`): the frames go into the mod's HD pictures
   by their sprites' fingerprints, so the game needs no change. (Its spine-core patch was made for the paintings,
   which widened the gaps at the waist; a rendering shows the waist as its sprite does, so it can skip the patch.)

Still open: the effects (projectile moves and parts attached in some poses, like GLACIER's crystal and SPECTRE's
charge, are not exported yet), the menu pictures (other turns and scales), and the original robots, which have no 3D
models: Gargoyle, Flail and Electra would need modeling from their design sheets first, after which the same
pipeline applies.

Note: Blender's glTF importer adds a hidden "Icosphere" object as the armature's bone shape. Tools that frame the
camera on every imported mesh must import with `disable_bone_shape=True`, as `render_frames.py` does, or leave that
object out.
