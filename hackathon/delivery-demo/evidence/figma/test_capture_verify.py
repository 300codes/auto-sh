import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
import zlib


class FigmaEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.evidence = self.root / 'hackathon/delivery-demo/evidence/figma'
        self.evidence.mkdir(parents=True)
        for name in ('capture.sh', 'verify.sh'):
            shutil.copy(Path(__file__).parent / name, self.evidence / name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        binary = self.root / 'bin'
        binary.mkdir()
        curl = binary / 'curl'
        curl.write_text('''#!/usr/bin/env bash
while [[ $# -gt 0 ]]; do
  if [[ $1 == --output ]]; then output=$2; shift 2; else shift; fi
done
cp "$MOCK_SOURCE" "$output"
exit "${MOCK_EXIT:-0}"
''')
        curl.chmod(0o755)
        self.environment = dict(os.environ, PATH=f'{binary}:{os.environ["PATH"]}')
        self.create = self.root / 'create.png'
        self.update = self.root / 'update.png'
        for path, color in ((self.create, b'\xff\x00\x00'), (self.update, b'\x00\xff\x00')):
            def chunk(kind, data):
                return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
            path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00' + color)) + chunk(b'IEND', b''))

    def capture(self, operation, source, exit_code=0):
        return subprocess.run(
            ['bash', str(self.evidence / 'capture.sh'), operation, '1:2', 'https://example.invalid/render'],
            env=dict(self.environment, MOCK_SOURCE=str(source), MOCK_EXIT=str(exit_code)),
            capture_output=True, text=True,
        )

    def verify(self):
        return subprocess.run(['bash', str(self.evidence / 'verify.sh')], capture_output=True, text=True)

    def test_failed_download_and_validation_preserve_existing_evidence(self):
        self.assertEqual(self.capture('create', self.create).returncode, 0)
        originals = {name: (self.evidence / name).read_bytes() for name in ('create-1-2.png', 'manifest.json', 'SHA256SUMS')}
        invalid = self.root / 'invalid'
        invalid.write_text('not a PNG')
        oversized = self.root / 'oversized.png'
        oversized.write_bytes(self.update.read_bytes() + bytes(1024 * 1024))
        for source, exit_code in ((self.update, 22), (invalid, 0), (oversized, 0)):
            with self.subTest(source=source.name, exit_code=exit_code):
                self.assertNotEqual(self.capture('create', source, exit_code).returncode, 0)
                for name, expected in originals.items():
                    self.assertEqual((self.evidence / name).read_bytes(), expected)
                self.assertFalse(list(self.evidence.glob('.capture-render.*')))

    def test_verifier_scans_untracked_and_ignored_evidence_without_printing_secrets(self):
        self.assertEqual(self.capture('create', self.create).returncode, 0)
        self.assertEqual(self.capture('update', self.update).returncode, 0)
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        secret = 'fig' + 'd_' + 'synthetic-test-only'
        artifact = self.evidence / 'untracked.txt'
        artifact.write_text(secret)
        for ignored in (False, True):
            with self.subTest(ignored=ignored):
                if ignored:
                    (self.root / '.gitignore').write_text('untracked.txt\n')
                result = self.verify()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('untracked.txt', result.stdout)
                self.assertNotIn(secret, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
