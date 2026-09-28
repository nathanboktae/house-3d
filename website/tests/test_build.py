import hashlib
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class StaticBuildTests(unittest.TestCase):
    def test_secret_files_and_original_archive_not_deployed(self):
        paths = [p.relative_to(ROOT/'dist') for p in (ROOT/'dist').rglob('*') if p.is_file()]
        self.assertTrue(paths)
        for p in paths:
            self.assertNotIn('.env', str(p))
            self.assertNotIn('source', p.parts)
            self.assertNotIn('.git', p.parts)
            self.assertNotIn(p.suffix, ('.py', '.log'))
        self.assertTrue((ROOT/'dist/.nojekyll').exists())

    def test_model_is_unchanged_and_paths_are_subdirectory_safe(self):
        a = (ROOT/'dist/model/house.glb').read_bytes()
        b = (ROOT.parent/'matterport-house/output/house.glb').read_bytes()
        self.assertEqual(hashlib.sha256(a).digest(), hashlib.sha256(b).digest())
        html = (ROOT/'dist/index.html').read_text()
        self.assertIn('Nathan’s Home', html)
        self.assertNotIn('src="/', html)
        self.assertNotIn('href="/', html)
        self.assertIn('"./vendor/three/', html)
        js = (ROOT/'dist/app.js').read_text()
        self.assertNotIn('EventSource', js)
        self.assertNotIn('/api/events', js)
        self.assertIn("load('./model/house.glb'", js)

if __name__ == '__main__': unittest.main()
