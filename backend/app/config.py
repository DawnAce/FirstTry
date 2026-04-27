from pydantic_settings import BaseSettings
from functools import lru_cache
from urllib.parse import quote_plus
import os


class Settings(BaseSettings):
    MYSQL_HOST: str
    MYSQL_PORT: int = 24433
    MYSQL_USER: str
    MYSQL_PASSWORD: str
    MYSQL_DATABASE: str

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"mysql+pymysql://{self.MYSQL_USER}:{quote_plus(self.MYSQL_PASSWORD)}"
            f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"
            "?charset=utf8mb4"
        )

    model_config = {"env_file": os.path.join(os.path.dirname(__file__), "..", "..", ".env")}


@lru_cache
def get_settings() -> Settings:
    return Settings()
