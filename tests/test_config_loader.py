import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dotenv import dotenv_values
from pydantic import ValidationError

from utils.config_loader import (
    AIPromptConfig,
    AppConfig,
    AuthConfig,
    ComfyUICloudConfig,
    ComfyUILocalConfig,
    Config,
    DatabaseConfig,
    GptImageConfig,
    ImageUpscaleConfig,
    KlingConfig,
    NanoBananaConfig,
    PathsConfig,
    PixelLabConfig,
    RedisConfig,
    ServerConfig,
    SessionTitleConfig,
    VideoFramesConfig,
)


ENV_SETTINGS_CLASSES = (
    AIPromptConfig,
    AppConfig,
    AuthConfig,
    ComfyUICloudConfig,
    ComfyUILocalConfig,
    DatabaseConfig,
    GptImageConfig,
    ImageUpscaleConfig,
    KlingConfig,
    NanoBananaConfig,
    PathsConfig,
    PixelLabConfig,
    RedisConfig,
    ServerConfig,
    SessionTitleConfig,
    VideoFramesConfig,
)


class ConfigLoaderTests(unittest.TestCase):
    def test_all_environment_fields_are_required(self):
        for settings_class in ENV_SETTINGS_CLASSES:
            for field_name, field in settings_class.model_fields.items():
                with self.subTest(settings=settings_class.__name__, field=field_name):
                    self.assertTrue(field.is_required())

    def test_env_example_builds_complete_config(self):
        root = Path(__file__).resolve().parents[1]
        values = {
            key: value
            for key, value in dotenv_values(root / ".env.example").items()
            if value is not None
        }

        previous_cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as temporary_directory:
            try:
                os.chdir(temporary_directory)
                with patch.dict(os.environ, values, clear=True):
                    config = Config()
            finally:
                os.chdir(previous_cwd)

        self.assertEqual(config.nano_banana.analysis_model, values["NANO_BANANA_ANALYSIS_MODEL"])

    def test_missing_environment_field_fails_validation(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValidationError) as error:
                SessionTitleConfig(
                    _env_file=None,
                    SESSION_TITLE_API_KEY="",
                    SESSION_TITLE_BASE_URL="https://example.invalid/v1",
                )

        self.assertIn("SESSION_TITLE_MODEL", str(error.exception))

    def test_service_url_cannot_be_blank(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValidationError) as error:
                SessionTitleConfig(
                    _env_file=None,
                    SESSION_TITLE_API_KEY="",
                    SESSION_TITLE_BASE_URL="",
                    SESSION_TITLE_MODEL="test-model",
                )

        self.assertIn("SESSION_TITLE_BASE_URL", str(error.exception))


if __name__ == "__main__":
    unittest.main()
