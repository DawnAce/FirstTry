# Copilot Instructions

## Project Overview

This is the **每周印数报数系统** (Weekly Print Report System) for 《中国经营报》(China Business Journal).

- **Backend**: FastAPI (Python) — `backend/`
- **Frontend**: React + TypeScript + Vite + Ant Design + TanStack Query — `frontend/`
- **Database**: MySQL (remote Tencent Cloud)
- **Excel Export**: openpyxl (template-driven)

## Development Commands

```bash
# Backend
cd backend && source venv/Scripts/activate && uvicorn app.main:app --reload

# Frontend
cd frontend && npm run dev

# Type check frontend
cd frontend && npx tsc --noEmit

# One-click dev start (Windows)
.\dev.ps1   # PowerShell
dev.bat     # CMD
```

## Code Conventions

- **Python**: Use type hints. Follow existing SQLAlchemy model patterns in `backend/app/models/`.
- **TypeScript**: Use `import type` for type-only imports (`verbatimModuleSyntax` is enabled).
- **Ant Design**: `Form.Item` uses `name` (not `field`), `Modal`/`Drawer` use `open` (not `visible`), `Table` uses `dataSource` (not `data`), `Popconfirm` uses `onConfirm` (not `onOk`). Use `Menu` with `items` prop instead of `Menu.Item` children.
- **Data fetching**: Use TanStack Query (`useQuery`) with appropriate query keys. Mutations must call `queryClient.invalidateQueries()` to update related caches.
- **Styling**: Apple-like minimalist theme defined in `frontend/src/index.css` with CSS variables. Use existing variables (`--color-accent`, `--color-bg`, `--radius-card`, etc.) instead of hardcoded values.
- **Git commits**: Always include `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.

## Mandatory: Testing & Documentation Updates

**Every code change must include:**

1. **Testing** — Verify the change works:
   - Run `cd frontend && npx tsc --noEmit` for any frontend changes
   - Test affected API endpoints for any backend changes
   - Verify the change doesn't break existing functionality

2. **Documentation updates** — Keep docs in sync with code:
   - `README.md` — Update if project setup, commands, or architecture changes
   - `docs/technical.md` — Update if backend APIs, database schema, or architecture changes
   - `docs/requirements.md` — Update if features or requirements change
   - `docs/user-guide.md` — Update if user-facing workflows or UI changes
   - API docstrings — Update if endpoint behavior changes

3. **Cache invalidation** — For any frontend mutation (create/update/delete), ensure the relevant TanStack Query caches are invalidated.

## Key Files

| Area | Files |
|------|-------|
| Backend entry | `backend/app/main.py` |
| Models | `backend/app/models/__init__.py` |
| Business logic | `backend/app/services/` |
| Frontend routes | `frontend/src/App.tsx` |
| Layout | `frontend/src/components/AppLayout.tsx` |
| Global styles | `frontend/src/index.css` |
| API clients | `frontend/src/api/` |
| Pages | `frontend/src/pages/` |

## Database

- Password contains special characters (`&`, `^`) — `urllib.parse.quote_plus` is used in `backend/app/config.py`
- Connection pool is configured with `pool_size=10`, `pool_recycle=300`
- Credentials are in `.env` (gitignored, never commit)
