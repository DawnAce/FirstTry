from pydantic import Field
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
    JWT_SECRET: str = Field(min_length=32)
    ACCESS_TOKEN_EXPIRE_HOURS: int = Field(default=12, ge=1, le=24)
    DB_POOL_SIZE: int = Field(default=10, ge=1, le=50)
    DB_POOL_MAX_OVERFLOW: int = Field(default=20, ge=0, le=100)
    DB_POOL_WARM_SIZE: int = Field(default=6, ge=1, le=20)

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
