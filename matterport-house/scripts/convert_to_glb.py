#!/usr/bin/env python3
"""Decode public highest-detail tiles; preserve UV seams; export with Blender."""
import argparse, json, struct, subprocess
from pathlib import Path
import numpy as np
import DracoPy
import bpy
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[1]

def read_glb(path):
    b = path.read_bytes()
    assert b[:4] == b'glTF' and struct.unpack_from('<I', b, 4)[0] == 2
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20+n]), b[28+n:]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ktx', default='ktx')
    args = parser.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    out = ROOT / 'output'; inter = ROOT / 'intermediate'; texdir = inter / 'textures'
    out.mkdir(exist_ok=True); texdir.mkdir(parents=True, exist_ok=True)
    selected = json.loads((ROOT/'source/selection.json').read_text())
    total_v = total_t = 0
    source_bounds = []
    with (inter/'house.obj').open('w') as obj, (inter/'house.mtl').open('w') as mtl:
        obj.write('# Z-up, metres; decoded from public glTF tiles\nmtllib house.mtl\n')
        offset = 1
        for tile in selected:
            path = ROOT/'source/tiles'/tile['content']['uri']
            j, binary = read_glb(path)
            assert not any('matrix' in n or 'translation' in n or 'rotation' in n or 'scale' in n for n in j['nodes']), 'Unexpected node transform'
            materials = []
            for im in j['images']:
                png = texdir / (Path(im['uri']).stem + '.png')
                subprocess.run([args.ktx, 'extract', '--transcode', 'rgba8', str(path.parent/im['uri']), str(png)], check=True)
                material = bpy.data.materials.new(png.stem)
                material.use_nodes = True
                material.use_backface_culling = True
                nodes = material.node_tree.nodes; nodes.clear()
                image = nodes.new('ShaderNodeTexImage'); image.image = bpy.data.images.load(str(png)); image.image.pack()
                # Baked photographic color should not acquire an artificial metallic response.
                emission = nodes.new('ShaderNodeEmission'); emission.inputs['Strength'].default_value = 1
                output = nodes.new('ShaderNodeOutputMaterial')
                material.node_tree.links.new(image.outputs['Color'], emission.inputs['Color'])
                material.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])
                materials.append(material)
                mtl.write(f'newmtl {material.name}\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\nd 1\nillum 1\nmap_Kd textures/{png.name}\n\n')
            for mesh in j['meshes']:
                for prim in mesh['primitives']:
                    ext = prim['extensions']['KHR_draco_mesh_compression']; view = j['bufferViews'][ext['bufferView']]
                    start = view.get('byteOffset', 0)
                    decoded = DracoPy.decode(binary[start:start+view['byteLength']])
                    attr = {a['unique_id']: a['data'] for a in decoded.attributes}
                    positions = attr[ext['attributes']['POSITION']]
                    uv = attr[ext['attributes']['TEXCOORD_0']].copy()
                    faces = decoded.faces
                    assert len(positions) == j['accessors'][prim['attributes']['POSITION']]['count']
                    assert faces.size == j['accessors'][prim['indices']]['count']
                    assert np.isfinite(positions).all() and np.isfinite(uv).all()
                    assert faces.min() >= 0 and faces.max() < len(positions)
                    source_bounds.append(positions)
                    # glTF Y-up -> Blender/OBJ Z-up, determinant +1. glTF UV origin is top-left.
                    points = positions[:, [0, 2, 1]].copy(); points[:, 1] *= -1; uv[:, 1] = 1-uv[:, 1]
                    data = bpy.data.meshes.new(mesh['name']); data.from_pydata(points.tolist(), [], faces.tolist()); data.update()
                    layer = data.uv_layers.new(name='UVMap')
                    for loop in data.loops:
                        layer.data[loop.index].uv = uv[loop.vertex_index]
                    item = bpy.data.objects.new(mesh['name'], data); bpy.context.collection.objects.link(item)
                    material_index = prim.get('material', 0)
                    texture_index = j['materials'][material_index]['pbrMetallicRoughness']['baseColorTexture']['index']
                    image_index = j['textures'][texture_index]['extensions']['KHR_texture_basisu']['source']
                    material = materials[image_index]; data.materials.append(material)
                    obj.write(f'o {item.name}\nusemtl {material.name}\n')
                    for x,y,z in points: obj.write(f'v {x:.9g} {y:.9g} {z:.9g}\n')
                    for u,v in uv: obj.write(f'vt {u:.9g} {v:.9g}\n')
                    for face in faces: obj.write('f '+' '.join(f'{int(i)+offset}/{int(i)+offset}' for i in face)+'\n')
                    offset += len(points); total_v += len(points); total_t += len(faces)
    bpy.ops.export_scene.gltf(filepath=str(out/'house.glb'), export_format='GLB', export_image_format='AUTO', export_yup=True, export_materials='EXPORT', export_normals=True)
    points = np.concatenate(source_bounds)
    report = {'source_tiles':len(selected), 'vertices_decoded':total_v, 'triangles':total_t, 'materials':len(bpy.data.materials), 'textures':len(bpy.data.images), 'bounds_gltf_y_up_m':{'min':points.min(0).tolist(),'max':points.max(0).tolist(),'size':np.ptp(points,axis=0).tolist()},'glb_bytes':(out/'house.glb').stat().st_size, 'blender_version':bpy.app.version_string}
    final, _ = read_glb(out/'house.glb')
    report['vertices_glb'] = sum(final['accessors'][p['attributes']['POSITION']]['count'] for m in final['meshes'] for p in m['primitives'])
    report['mesh_primitives'] = sum(len(m['primitives']) for m in final['meshes'])
    (out/'statistics.json').write_text(json.dumps(report,indent=2)); print(json.dumps(report,indent=2))

if __name__ == '__main__': main()
