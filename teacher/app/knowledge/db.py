"""Engine + session, and the one place the schema is created.

ponytail: tables are created with `create_all` rather than Alembic. R1 has one
schema and no deployed data to preserve. Ceiling: the first backwards-
incompatible change to a live database. Upgrade path is `alembic init`, then
`alembic stamp head` against the existing DB and migrate from there.
"""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.knowledge.models import Base

_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def engine():
    global _engine
    if _engine is None:
        _engine = create_async_engine(settings().database_url, pool_pre_ping=True)
    return _engine


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(engine(), expire_on_commit=False)
    return _sessionmaker


async def create_schema() -> None:
    from sqlalchemy import text

    async with engine().begin() as conn:
        # The index in models.py needs these; init.sql installs them for a
        # fresh container, this covers a database created some other way.
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)


async def session() -> AsyncGenerator[AsyncSession, None]:
    async with sessionmaker()() as s:
        yield s
