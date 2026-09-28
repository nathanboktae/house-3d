#!/usr/bin/env python3
"""Render faithful orthographic floor references from the GLB, with editable numbered markers."""
import argparse
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'website/private/room-labeling'
SPLIT = -0.15  # GLB Y-up = Blender Z-up, between scan levels
CENTER = (4.42,2.38)
WIDTH = 19.5
HEIGHT = WIDTH*1400/1800

def emission(name, color):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes; nodes.clear()
    shader = nodes.new('ShaderNodeEmission'); shader.inputs['Color'].default_value = (*color,1)
    output = nodes.new('ShaderNodeOutputMaterial'); material.node_tree.links.new(shader.outputs[0],output.inputs['Surface'])
    return material

def text(body, x, y, z, size, material, align='CENTER'):
    curve=bpy.data.curves.new('Label','FONT');curve.body=body;curve.size=size;curve.align_x=align;curve.align_y='CENTER'
    obj=bpy.data.objects.new('Label',curve);bpy.context.collection.objects.link(obj);obj.location=(x,y,z);obj.data.materials.append(material)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--markers',type=Path);args=parser.parse_args()
    markers=json.loads(args.markers.read_text()) if args.markers else {}
    OUT.mkdir(parents=True,exist_ok=True)
    for floor in ('main','basement'):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(ROOT/'matterport-house/output/house.glb'))
        for obj in list(bpy.context.scene.objects):
            if obj.type!='MESH':continue
            bpy.context.view_layer.objects.active=obj;obj.select_set(True)
            bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);obj.select_set(False)
            bm=bmesh.new();bm.from_mesh(obj.data)
            bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,SPLIT),plane_no=(0,0,1),clear_inner=floor=='main',clear_outer=floor=='basement')
            bm.to_mesh(obj.data);bm.free();obj.data.update()
        scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT'
        scene.render.resolution_x=1800;scene.render.resolution_y=1400;scene.render.resolution_percentage=100
        scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard'
        scene.world=bpy.data.worlds.new('Background');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.025,.035,.045,1)
        camera=bpy.data.cameras.new('Top view');camera.type='ORTHO';camera.ortho_scale=WIDTH
        obj=bpy.data.objects.new('Top view',camera);scene.collection.objects.link(obj);scene.camera=obj
        obj.location=(*CENTER,25);obj.rotation_euler=(0,0,0)
        ivory=emission('Ivory',(.91,.94,.96));muted=emission('Muted',(.42,.54,.61));gold=emission('Number backing',(.9,.62,.25));ink=emission('Number ink',(.025,.035,.045))
        title='MAIN FLOOR' if floor=='main' else 'BASEMENT'
        text("NATHAN'S HOME  /  "+title,CENTER[0]-WIDTH/2+.55,CENTER[1]+HEIGHT/2-.7,9,.36,ivory,'LEFT')
        text('Name the numbered spaces. Both floors use the same orientation.',CENTER[0]-WIDTH/2+.55,CENTER[1]+HEIGHT/2-1.24,9,.2,muted,'LEFT')
        text('Original scan furniture  |  Numbers are prompts; use your current room names.',CENTER[0]-WIDTH/2+.55,CENTER[1]-HEIGHT/2+.65,9,.19,muted,'LEFT')
        for marker in markers.get(floor,[]):
            x,y=marker['xy'];radius=.30
            bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=radius,depth=.02,location=(x,y,9))
            bpy.context.object.data.materials.append(gold)
            text(marker['id'],x,y,9.03,.265,ink)
        scene.render.filepath=str(OUT/f'{floor}-numbered.png' if markers else OUT/f'{floor}-base.png')
        bpy.ops.render.render(write_still=True)
    (OUT/'projection.json').write_text(json.dumps({'center_blender_xy':CENTER,'orthographic_width':WIDTH,'image_size':[1800,1400],'floor_split_glb_y':SPLIT,'coordinate_note':'Blender (x,y,z) = glTF (x,-z,y); image right = +X, image up = +Blender Y = -glTF Z'},indent=2))

if __name__=='__main__':main()
