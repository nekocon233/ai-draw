import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/manage_dark_gothic_training.py'
spec = importlib.util.spec_from_file_location('dark_gothic_training', SCRIPT)
training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(training)


class TrainingRecoveryTests(unittest.TestCase):
    def test_resume_checks_checkpoint_optimizer_and_unchanged_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = training.JOB_NAME + '_000004000.safetensors'
            hashes = {}
            for name in (checkpoint, 'optimizer.pt'):
                content = name.encode()
                (root / name).write_bytes(content)
                hashes[name] = hashlib.sha256(content).hexdigest()
            (root / 'pause.json').write_text(json.dumps({'job_id': 'owned', 'resume_step': 4000, 'sha256': hashes}))
            config = {'config': {'process': [{'train': {'steps': 8000}}]}}
            job = {'id': 'owned', 'status': 'stopped', 'step': 4000, 'job_config': json.dumps(config)}
            with patch.object(training, 'ROOT', root), patch.object(training, 'OUTPUT', root):
                self.assertEqual(training.verify_resume(job, config), 4000)
                with self.assertRaisesRegex(ValueError, 'configuration changed'):
                    training.verify_resume(job, {'config': {'process': [{'train': {'steps': 9000}}]}})
                (root / 'optimizer.pt').write_bytes(b'wrong optimizer')
                with self.assertRaisesRegex(ValueError, 'optimizer changed'):
                    training.verify_resume(job, config)

    def test_restore_waits_for_other_jobs_and_for_actual_gpu_release(self):
        completed = {'job': {'status': 'completed', 'step': 8000}, 'active_jobs': 0}
        snapshots = [{**completed, 'active_jobs': 1}, completed, completed]
        restored = []
        def restore(state):
            restored.append(state['job']['step'])
            state['service_restored'] = True
        with patch.object(training, 'STATE') as state_path, \
             patch.object(training, 'status', side_effect=snapshots), \
             patch.object(training, 'run', side_effect=['12345', '']) as probe, \
             patch.object(training, 'record'), \
             patch.object(training, 'restore', side_effect=restore), \
             patch.object(training.time, 'sleep'), patch('builtins.print'):
            state_path.read_text.return_value = json.dumps({'job_id': 'owned', 'service_restored': False})
            training.watch()
        self.assertEqual(restored, [8000])
        self.assertEqual(probe.call_count, 2)
        self.assertEqual(probe.call_args.args[0][0], 'nvidia-smi')

    def test_unknown_gpu_state_is_retried_before_restoring_failed_job(self):
        failed = {'job': {'status': 'error', 'step': 37}, 'active_jobs': 0}
        restored = []
        def restore(state):
            restored.append(state['job']['status'])
            state['service_restored'] = True
        with patch.object(training, 'STATE') as state_path, \
             patch.object(training, 'status', return_value=failed), \
             patch.object(training, 'run', side_effect=[RuntimeError('NVML unavailable'), '']), \
             patch.object(training, 'record'), \
             patch.object(training, 'restore', side_effect=restore), \
             patch.object(training.time, 'sleep') as sleep, patch('builtins.print'):
            state_path.read_text.return_value = json.dumps({'job_id': 'owned', 'service_restored': False})
            training.watch()
        self.assertEqual(restored, ['error'])
        sleep.assert_called_once_with(30)


if __name__ == '__main__':
    unittest.main()
