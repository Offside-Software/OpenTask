---
name: backend-uv
description: >-
  Use this skill when developing, running, testing, or modifying backend Python code in api/.
  Enforces UV commands, database connection pooling, and BigInt Snowflake SafeId serialization.
---

# OpenTask Backend Development Skill (UV)

This skill provides step-by-step procedures for safely managing dependencies, running services, and database querying in `api/`.

---

## 1. Toolchain Execution Procedures

Always use **UV** (`uv`) for all backend operations:

### Synchronize Environment
```bash
cd api
uv sync
```

### Install New Dependencies
```bash
cd api
uv pip install <package_name>
```

### Run Local Development Server
```bash
cd api
uv run uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload
```

### Run Python Scripts or Verifications
```bash
cd api
uv run python src/scripts/init_db.py
uv run python -c "import main; print('OK')"
```

> [!WARNING]
> Never use bare `pip install` or run unmanaged system Python directly. UV ensures strict virtual environment isolation and lockfile consistency with `uv.lock`.

---

## 2. Database Connection Pool Pattern

When interacting with PostgreSQL, always follow the lease-and-return pattern:

```python
import psycopg2.extras
from fastapi import HTTPException
from services.database.database import _get_conn, _put_conn

def query_database():
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM opentask.tasks LIMIT 10;")
        results = cur.fetchall()
        conn.commit()
        return results
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)
```

> [!CAUTION]
> Failing to call `_put_conn(conn)` in a `finally` block exhausts the connection pool and will cause server hangs under load.

---

## 3. Snowflake SafeId Handling

1. All primary key IDs are 64-bit BigInts generated via `_generator.generate()`.
2. To prevent floating-point precision loss in JavaScript clients, never serialize raw BigInts as bare numbers in JSON.
3. Use `SafeId` in Pydantic models:
   ```python
   from services.database.database import SafeId

   class ItemResponse(BaseModel):
       id: SafeId
       project_id: SafeId
   ```
4. When querying via SQL parameters, cast string IDs to integer: `(int(task_id),)`.

---

## 4. Verification Workflow

Before completing any backend task:
1. Run syntax verification:
   ```bash
   uv run python -m py_compile src/main.py
   ```
2. Verify API module imports:
   ```bash
   uv run python -c "import sys; sys.path.insert(0, 'src'); import main; print('API imports successful')"
   ```
3. Verify connection pool checkout and cleanup in all newly added database routines.
