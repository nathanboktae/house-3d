#!/usr/bin/env python3
"""Reopen final GLB in a fresh Blender scene, verify structure, render views."""
import json
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'output'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'house.glb'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert meshes
triangles = sum(len(o.data.polygons) for o in meshes)
expected = json.loads((OUT/'statistics.json').read_text())
assert triangles == expected['triangles']
assert all(o.data.uv_layers for o in meshes)
textures = [n.image for m in bpy.data.materials if m.use_nodes for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']
assert len(textures) == 8 and all(i.size[0] > 0 and i.packed_file for i in textures)
points = np.array([o.matrix_world @ v.co for o in meshes for v in o.data.vertices])
lo, hi = points.min(0), points.max(0)
center = Vector((lo+hi)/2)
# Verify exported coordinates, allowing only the documented Y-up/Z-up basis change.
gltf_points = points[:, [0,2,1]].copy(); gltf_points[:,2] *= -1
assert np.allclose(gltf_points.min(0), expected['bounds_gltf_y_up_m']['min'], atol=1e-4)
assert np.allclose(gltf_points.max(0), expected['bounds_gltf_y_up_m']['max'], atol=1e-4)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = 1500; scene.render.resolution_y = 1100; scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('Background'); scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.035,0.045,0.06,1)
scene.view_settings.view_transform = 'Standard'
camera = bpy.data.cameras.new('ValidationCamera'); obj = bpy.data.objects.new('ValidationCamera',camera); scene.collection.objects.link(obj); scene.camera=obj
camera.type='ORTHO'; camera.ortho_scale = 24
for name, direction in [('front',(1,-1,0.9)), ('back',(-1,1,0.9)), ('top',(0.01,0,1))]:
    obj.location = center + Vector(direction).normalized()*30
    obj.rotation_euler = (center-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = str(OUT/f'preview-{name}.png'); bpy.ops.render.render(write_still=True)
report={'blender_import':'passed', 'mesh_objects':len(meshes), 'triangles':triangles,'embedded_textures':len(textures),'texture_sizes':[list(i.size) for i in textures], 'uv_layers_present':True,'bounds_match_source':True,'renders':['preview-front.png','preview-back.png','preview-top.png']}
(OUT/'blender-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
