"""API tests must never connect to the shared customer database."""
import os
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["GAMEACCESS_DATABASE_URL"] = "sqlite://"
os.environ["GAMEACCESS_ALLOW_SQLITE_FOR_TESTS"] = "1"
os.environ["GAMEACCESS_DISCOVERY_SYNC"] = "0"
