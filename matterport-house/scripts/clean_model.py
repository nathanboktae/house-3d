#!/usr/bin/env python3
"""Create a textured dollhouse cleanup without changing the archived house.glb.

Run with the pinned Blender Python environment. All distances are in metres.
UVs remain on face corners, including seams when geometric vertices are welded.
"""
import argparse
import hashlib
import json
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]


def cleanup(bm, wall_height):
    counts = {'input_triangles': len(bm.faces)}
    # Join flat-normal vertex splits and tile seams, retaining per-loop UVs.
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.00001)
    counts['welded_vertex_records'] = before - len(bm.verts)
    degenerate = [f for f in bm.faces if f.calc_area() < 1e-10]
    counts['degenerate_faces_removed'] = len(degenerate)
    bmesh.ops.delete(bm, geom=degenerate, context='FACES')

    # An open, level cutaway eliminates skylight shafts and ragged ceiling/roof
    # remnants. Bisect interpolates UVs at intersections instead of dropping
    # whole crossing triangles, so the wall tops are straight, not sawtoothed.
    counts['faces_above_cut_before_bisect'] = sum(
        all(v.co.z > wall_height for v in f.verts) for f in bm.faces)
    bmesh.ops.bisect_plane(
        bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        dist=1e-6, plane_co=(0, 0, wall_height), plane_no=(0, 0, 1),
        clear_outer=True, clear_inner=False)

    # Remove only long, hair-thin triangles exposed at a scan boundary.
    slivers = []
    for f in bm.faces:
        longest = max(e.calc_length() for e in f.edges)
        if (len(f.verts) == 3 and any(e.is_boundary for e in f.edges)
                and longest > 0.25 and 2 * f.calc_area() / longest < 0.008):
            slivers.append(f)
    counts['boundary_slivers_removed'] = len(slivers)
    bmesh.ops.delete(bm, geom=slivers, context='FACES')

    # Connectivity is computed after welding, across material and tile seams.
    # Both area and extent must be small: long thin fixtures are retained.
    unseen = set(bm.faces)
    debris = []
    components = 0
    while unseen:
        seed = unseen.pop()
        stack, faces, verts = [seed], [seed], set(seed.verts)
        while stack:
            f = stack.pop()
            for e in f.edges:
                for neighbor in e.link_faces:
                    if neighbor in unseen:
                        unseen.remove(neighbor)
                        stack.append(neighbor)
                        faces.append(neighbor)
                        verts.update(neighbor.verts)
        area = sum(f.calc_area() for f in faces)
        points = np.array([v.co[:] for v in verts])
        if area < 0.02 and np.linalg.norm(np.ptp(points, axis=0)) < 0.45:
            debris.extend(faces)
            components += 1
    counts['small_islands_removed'] = components
    counts['island_faces_removed'] = len(debris)
    bmesh.ops.delete(bm, geom=debris, context='FACES')

    # Lightly relax short noisy boundary chains, with a 15 mm total displacement
    # cap. Preserve corners, long edges, and the new horizontal cut plane.
    bm.normal_update()
    origins = {v: v.co.copy() for v in bm.verts}
    moved = set()
    for _ in range(3):
        updates = {}
        for v in bm.verts:
            edges = [e for e in v.link_edges if e.is_boundary]
            if len(edges) != 2 or abs(v.co.z - wall_height) < 1e-5:
                continue
            a, b = [e.other_vert(v) for e in edges]
            da, db = a.co - v.co, b.co - v.co
            if min(da.length, db.length) < 1e-5 or max(da.length, db.length) > 0.18:
                continue
            # Only nearly straight chains, never architectural corners.
            if da.normalized().dot(db.normalized()) > -0.7:
                continue
            delta = (a.co + b.co) / 2 - v.co
            delta -= v.normal * delta.dot(v.normal)
            candidate = v.co + delta * 0.35
            offset = candidate - origins[v]
            if offset.length > 0.015:
                candidate = origins[v] + offset.normalized() * 0.015
            if (candidate - v.co).length > 1e-6:
                updates[v] = candidate
        for v, co in updates.items():
            v.co = co
            moved.add(v)
        bm.normal_update()
    counts['boundary_vertices_relaxed'] = len(moved)
    counts['maximum_boundary_displacement_m'] = max(
        ((v.co - origins[v]).length for v in moved), default=0)
    # Remove loose remnants of deleted faces, then triangulate bisected polygons.
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.normal_update()
    counts['output_triangles'] = len(bm.faces)
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wall-height', type=float, default=2.4,
                        help='Upper-storey cutaway height in source coordinates (default: 2.4 m)')
    args = parser.parse_args()
    source = ROOT / 'output/house.glb'
    destination = ROOT / 'output/house-clean.glb'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = 'House_Clean'
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    report = cleanup(bm, args.wall_height)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    assert obj.data.uv_layers
    points = np.array([v.co[:] for v in obj.data.vertices])
    assert np.isfinite(points).all()
    gltf_points = points[:, [0, 2, 1]].copy()
    gltf_points[:, 2] *= -1
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB',
                             export_yup=True, export_materials='EXPORT',
                             export_normals=True)
    report.update({
        'source': source.name,
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'output': destination.name,
        'output_sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        'wall_height_m': args.wall_height,
        'bounds_gltf_y_up_m': {'min': gltf_points.min(0).tolist(),
                               'max': gltf_points.max(0).tolist()},
        'glb_bytes': destination.stat().st_size,
        'blender_version': bpy.app.version_string,
    })
    (destination.parent / 'cleanup-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
