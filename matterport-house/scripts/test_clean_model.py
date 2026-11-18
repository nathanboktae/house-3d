"""Regression checks for cleanup decisions and preservation of cut-edge UVs."""
import unittest

import bpy  # Initializes Blender's bundled bmesh/mathutils modules.
import bmesh
from clean_model import cleanup


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.bm = bmesh.new()

    def tearDown(self):
        self.bm.free()

    def face(self, coordinates):
        return self.bm.faces.new([self.bm.verts.new(p) for p in coordinates])

    def test_cut_is_level_and_interpolates_uvs(self):
        face = self.face([(0, 0, 0), (2, 0, 0), (2, 0, 3), (0, 0, 3)])
        uv = self.bm.loops.layers.uv.new()
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x / 2, loop.vert.co.z / 3)
        cleanup(self.bm, 2.4)
        self.assertAlmostEqual(max(v.co.z for v in self.bm.verts), 2.4, places=5)
        self.assertAlmostEqual(sum(f.calc_area() for f in self.bm.faces), 4.8, places=5)
        for f in self.bm.faces:
            for loop in f.loops:
                self.assertAlmostEqual(loop[uv].uv.x, loop.vert.co.x / 2, places=5)
                self.assertAlmostEqual(loop[uv].uv.y, loop.vert.co.z / 3, places=5)

    def test_noise_removed_but_long_thin_detail_retained(self):
        self.face([(0, 0, 0), (.05, 0, 0), (0, .05, 0)])  # Detached speck.
        self.face([(2, 0, 0), (3, 0, 0), (2, .03, 0)])  # Long fixture.
        self.face([(4, 0, 0), (5, 0, 0), (4, .001, 0)])  # Hairline sliver.
        report = cleanup(self.bm, 2.4)
        self.assertEqual(report['small_islands_removed'], 1)
        self.assertEqual(report['boundary_slivers_removed'], 1)
        self.assertEqual(len(self.bm.faces), 1)
        self.assertAlmostEqual(sum(f.calc_area() for f in self.bm.faces), .015, places=6)

    def test_welding_preserves_texture_seams_and_corners(self):
        a = self.face([(0, 0, 0), (1, 0, 0), (1, 1, 0)])
        b = self.face([(0, 0, 0), (1, 1, 0), (0, 1, 0)])
        uv = self.bm.loops.layers.uv.new()
        for loop in a.loops:
            loop[uv].uv = (0, 0)
        for loop in b.loops:
            loop[uv].uv = (1, 1)
        report = cleanup(self.bm, 2.4)
        self.assertEqual(len(self.bm.verts), 4)
        self.assertEqual(report['boundary_vertices_relaxed'], 0)
        self.assertEqual({tuple(loop[uv].uv) for f in self.bm.faces for loop in f.loops},
                         {(0.0, 0.0), (1.0, 1.0)})


if __name__ == '__main__':
    unittest.main()
