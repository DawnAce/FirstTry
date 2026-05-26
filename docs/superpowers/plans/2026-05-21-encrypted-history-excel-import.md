# Encrypted History Excel Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the historical print report import page preview password-protected Excel report workbooks by decrypting them in memory before the existing parser reads them.

**Architecture:** Add one focused backend workbook loader used by the history import service. The API accepts an optional report-file password in the existing multipart preview request, and the frontend adds an optional password field next to the report upload. Commit remains unchanged because preview data is cached by import session.

**Tech Stack:** FastAPI multipart `Form`, Python `msoffcrypto-tool`, `openpyxl`, unittest, React + TypeScript + Ant Design.

---

## File structure

- Create `backend/app/services/workbook_loader.py`: isolated workbook loading/decryption helper with no database or import-domain knowledge.
- Modify `backend/app/services/history_import_service.py`: use the helper and accept optional `report_password`.
- Modify `backend/app/api/history_import.py`: accept optional multipart form field `report_password` and pass it to the service.
- Modify `backend/tests/test_history_import.py`: add encrypted workbook fixtures and preview tests.
- Modify `backend/requirements.txt`: add pinned `msoffcrypto-tool==6.0.0`.
- Modify `frontend/src/api/historyImport.ts`: include optional report password in preview request.
- Modify `frontend/src/pages/HistoryImport.tsx`: add optional password input for the report workbook and reset preview when it changes.
- Modify `docs/technical.md` and `docs/user-guide.md`: document in-memory decryption and the user workflow.

---

### Task 1: Backend encrypted workbook loader

**Files:**
- Create: `backend/app/services/workbook_loader.py`
- Test: `backend/tests/test_history_import.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add the dependency**

Modify `backend/requirements.txt` by adding this line after `openpyxl==3.1.5`:

```text
msoffcrypto-tool==6.0.0
```

- [ ] **Step 2: Install backend dependencies**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
python -m pip install -r requirements.txt
```

Expected: command exits 0 and `msoffcrypto-tool==6.0.0` is installed.

- [ ] **Step 3: Write failing tests for workbook loading**

In `backend/tests/test_history_import.py`, update imports near the top:

```python
import io
import unittest
from datetime import date, datetime as _dt

import msoffcrypto
from fastapi import HTTPException
from msoffcrypto.format.ooxml import OOXMLFile
from openpyxl import load_workbook, Workbook
```

Add this helper after `_wb_to_bytes`:

```python
def _encrypt_workbook_bytes(workbook_bytes: bytes, password: str) -> bytes:
    encrypted = io.BytesIO()
    office_file = OOXMLFile(io.BytesIO(workbook_bytes))
    office_file.encrypt(password, encrypted)
    return encrypted.getvalue()
```

Add this test class before `HistoryImportTemplateTests`:

```python
class WorkbookLoaderTests(unittest.TestCase):
    def test_loads_unencrypted_workbook(self):
        from app.services.workbook_loader import load_uploaded_workbook

        workbook = load_uploaded_workbook(
            build_report_upload(),
            file_label="印数文件",
        )

        self.assertEqual(workbook.sheetnames, ["基本信息", "报数项", "临时加印明细"])
        self.assertEqual(workbook["基本信息"]["B2"].value, 2648)
        workbook.close()

    def test_loads_encrypted_workbook_with_password(self):
        from app.services.workbook_loader import load_uploaded_workbook

        encrypted = _encrypt_workbook_bytes(build_report_upload(), "0611")
        workbook = load_uploaded_workbook(
            encrypted,
            password="0611",
            file_label="印数文件",
        )

        self.assertEqual(workbook.sheetnames, ["基本信息", "报数项", "临时加印明细"])
        self.assertEqual(workbook["基本信息"]["B2"].value, 2648)
        workbook.close()

    def test_encrypted_workbook_without_password_returns_clear_error(self):
        from app.services.workbook_loader import load_uploaded_workbook

        encrypted = _encrypt_workbook_bytes(build_report_upload(), "0611")

        with self.assertRaises(HTTPException) as ctx:
            load_uploaded_workbook(encrypted, file_label="印数文件")

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.detail, "印数文件已加密，请输入文件密码后重试")

    def test_encrypted_workbook_with_wrong_password_returns_clear_error(self):
        from app.services.workbook_loader import load_uploaded_workbook

        encrypted = _encrypt_workbook_bytes(build_report_upload(), "0611")

        with self.assertRaises(HTTPException) as ctx:
            load_uploaded_workbook(
                encrypted,
                password="wrong-password",
                file_label="印数文件",
            )

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.detail, "印数文件密码不正确，无法解密")
```

- [ ] **Step 4: Run the failing loader tests**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
$env:PYTHONPATH = (Get-Location).Path
python -m unittest tests.test_history_import.WorkbookLoaderTests -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.workbook_loader'`.

- [ ] **Step 5: Implement the workbook loader**

Create `backend/app/services/workbook_loader.py`:

```python
"""Load uploaded Excel workbooks, including password-protected OOXML files."""

import io
from zipfile import BadZipFile

import msoffcrypto
from fastapi import HTTPException
from msoffcrypto.exceptions import DecryptionError, FileFormatError, InvalidKeyError
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException


def _invalid_excel_error(file_label: str) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail=f"无法解析{file_label}，请确保上传的是 .xlsx 格式",
    )


def load_uploaded_workbook(
    workbook_bytes: bytes,
    *,
    password: str | None = None,
    file_label: str = "上传文件",
):
    """Return an openpyxl workbook from plain or encrypted OOXML bytes.

    Passwords are used only for this in-memory load and are not persisted.
    """
    try:
        return load_workbook(io.BytesIO(workbook_bytes), data_only=True)
    except (BadZipFile, InvalidFileException, OSError) as plain_exc:
        try:
            office_file = msoffcrypto.OfficeFile(io.BytesIO(workbook_bytes))
        except (FileFormatError, OSError) as encrypted_exc:
            raise _invalid_excel_error(file_label) from encrypted_exc

        if not office_file.is_encrypted():
            raise _invalid_excel_error(file_label) from plain_exc

        normalized_password = (password or "").strip()
        if not normalized_password:
            raise HTTPException(
                status_code=422,
                detail=f"{file_label}已加密，请输入文件密码后重试",
            ) from plain_exc

        decrypted = io.BytesIO()
        try:
            office_file.load_key(password=normalized_password, verify_password=True)
            office_file.decrypt(decrypted)
        except InvalidKeyError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"{file_label}密码不正确，无法解密",
            ) from exc
        except DecryptionError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"{file_label}无法解密，请确认密码和文件格式",
            ) from exc

        decrypted.seek(0)
        try:
            return load_workbook(decrypted, data_only=True)
        except (BadZipFile, InvalidFileException, OSError) as exc:
            raise _invalid_excel_error(file_label) from exc
```

- [ ] **Step 6: Run loader tests again**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
$env:PYTHONPATH = (Get-Location).Path
python -m unittest tests.test_history_import.WorkbookLoaderTests -v
```

Expected: PASS for all 4 tests.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add backend\requirements.txt backend\app\services\workbook_loader.py backend\tests\test_history_import.py
git commit -m "feat: load encrypted history workbooks" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Wire encrypted report loading into history import preview

**Files:**
- Modify: `backend/app/services/history_import_service.py`
- Modify: `backend/app/api/history_import.py`
- Test: `backend/tests/test_history_import.py`

- [ ] **Step 1: Write failing preview tests**

In `HistoryImportPreviewTests`, add these tests after `test_preview_returns_counts_and_session_id`:

```python
    def test_preview_accepts_encrypted_report_workbook_with_password(self):
        db = self.SessionLocal()
        self._seed_upload_templates(db)
        encrypted_report = _encrypt_workbook_bytes(build_report_upload(), "0611")

        result = preview_history_import(
            db,
            encrypted_report,
            build_shipping_upload(),
            report_password="0611",
        )

        self.assertTrue(result.can_commit)
        self.assertEqual(result.issue_number, 2648)
        self.assertEqual(result.report_entry_count, 2)
        db.close()

    def test_preview_rejects_encrypted_report_workbook_without_password(self):
        db = self.SessionLocal()
        encrypted_report = _encrypt_workbook_bytes(build_report_upload(), "0611")

        with self.assertRaises(HTTPException) as ctx:
            preview_history_import(db, encrypted_report, build_shipping_upload())

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.detail, "印数文件已加密，请输入文件密码后重试")
        db.close()

    def test_preview_rejects_encrypted_report_workbook_with_wrong_password(self):
        db = self.SessionLocal()
        encrypted_report = _encrypt_workbook_bytes(build_report_upload(), "0611")

        with self.assertRaises(HTTPException) as ctx:
            preview_history_import(
                db,
                encrypted_report,
                build_shipping_upload(),
                report_password="bad-password",
            )

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.detail, "印数文件密码不正确，无法解密")
        db.close()
```

- [ ] **Step 2: Run the failing preview tests**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
$env:PYTHONPATH = (Get-Location).Path
python -m unittest tests.test_history_import.HistoryImportPreviewTests.test_preview_accepts_encrypted_report_workbook_with_password tests.test_history_import.HistoryImportPreviewTests.test_preview_rejects_encrypted_report_workbook_without_password tests.test_history_import.HistoryImportPreviewTests.test_preview_rejects_encrypted_report_workbook_with_wrong_password -v
```

Expected: FAIL with `TypeError: preview_history_import() got an unexpected keyword argument 'report_password'`.

- [ ] **Step 3: Update the service signature and workbook loading**

In `backend/app/services/history_import_service.py`, remove these imports:

```python
import io
from zipfile import BadZipFile
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
```

Add this import:

```python
from app.services.workbook_loader import load_uploaded_workbook
```

Replace `preview_history_import` signature and workbook loading block with:

```python
def preview_history_import(
    db: Session,
    report_bytes: bytes,
    shipping_bytes: bytes,
    report_password: str | None = None,
) -> HistoryImportPreviewOut:
    report_wb = load_uploaded_workbook(
        report_bytes,
        password=report_password,
        file_label="印数文件",
    )
    shipping_wb = load_uploaded_workbook(
        shipping_bytes,
        file_label="中通发货文件",
    )
```

Keep the rest of `preview_history_import` unchanged.

- [ ] **Step 4: Update the API endpoint**

In `backend/app/api/history_import.py`, change the import:

```python
from fastapi import APIRouter, Depends, File, Form, UploadFile
```

Update the endpoint signature and call:

```python
@router.post("/preview", response_model=HistoryImportPreviewOut)
async def preview_import(
    report_file: UploadFile = File(...),
    shipping_file: UploadFile = File(...),
    report_password: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Parse and validate both Excel files; return a preview without persisting anything."""
    report_bytes = await report_file.read()
    shipping_bytes = await shipping_file.read()
    return preview_history_import(
        db,
        report_bytes,
        shipping_bytes,
        report_password=report_password,
    )
```

- [ ] **Step 5: Run preview tests**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
$env:PYTHONPATH = (Get-Location).Path
python -m unittest tests.test_history_import.HistoryImportPreviewTests -v
```

Expected: PASS for all preview tests.

- [ ] **Step 6: Run all history import tests**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
$env:PYTHONPATH = (Get-Location).Path
python -m unittest tests.test_history_import -v
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add backend\app\api\history_import.py backend\app\services\history_import_service.py backend\tests\test_history_import.py
git commit -m "feat: preview encrypted history reports" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Frontend password input for history import

**Files:**
- Modify: `frontend/src/api/historyImport.ts`
- Modify: `frontend/src/pages/HistoryImport.tsx`

- [ ] **Step 1: Update API client**

In `frontend/src/api/historyImport.ts`, replace `previewHistoryImport` with:

```typescript
export const previewHistoryImport = (
  reportFile: File,
  shippingFile: File,
  reportPassword?: string,
): Promise<AxiosResponse<HistoryImportPreview>> => {
  const form = new FormData();
  form.append('report_file', reportFile);
  form.append('shipping_file', shippingFile);
  const normalizedPassword = reportPassword?.trim();
  if (normalizedPassword) {
    form.append('report_password', normalizedPassword);
  }
  return api.post<HistoryImportPreview>('/history-import/preview', form);
};
```

- [ ] **Step 2: Add frontend state and import**

In `frontend/src/pages/HistoryImport.tsx`, update the Ant Design import list:

```typescript
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  Space,
  Typography,
  Upload,
  message,
} from 'antd';
```

Add state after `shippingFile`:

```typescript
  const [reportPassword, setReportPassword] = useState('');
```

- [ ] **Step 3: Send password during preview**

In `handlePreview`, replace:

```typescript
      const res = await previewHistoryImport(reportFile, shippingFile);
```

with:

```typescript
      const res = await previewHistoryImport(reportFile, shippingFile, reportPassword);
```

- [ ] **Step 4: Reset preview when upload/password changes**

Replace the report-file `onChange` handler:

```typescript
              onChange={({ fileList }) => setReportFile(fileList[0]?.originFileObj ?? null)}
```

with:

```typescript
              onChange={({ fileList }) => {
                setReportFile(fileList[0]?.originFileObj ?? null);
                setPreview(null);
              }}
```

Replace the shipping-file `onChange` handler:

```typescript
              onChange={({ fileList }) => setShippingFile(fileList[0]?.originFileObj ?? null)}
```

with:

```typescript
              onChange={({ fileList }) => {
                setShippingFile(fileList[0]?.originFileObj ?? null);
                setPreview(null);
              }}
```

- [ ] **Step 5: Add the password field**

Add this block immediately after the report-file `</Dragger>` closing tag:

```tsx
            <Input.Password
              allowClear
              placeholder="如印数文件有密码，请在这里输入"
              value={reportPassword}
              onChange={(event) => {
                setReportPassword(event.target.value);
                setPreview(null);
              }}
              style={{ marginTop: 12 }}
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
              密码只用于本次上传解密，不会保存。
            </Text>
```

- [ ] **Step 6: Run frontend type check**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\frontend
npx tsc --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add frontend\src\api\historyImport.ts frontend\src\pages\HistoryImport.tsx
git commit -m "feat: add history import password field" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Documentation updates

**Files:**
- Modify: `docs/technical.md`
- Modify: `docs/user-guide.md`

- [ ] **Step 1: Update technical documentation**

In `docs/technical.md`, replace the bullet at line 1359:

```markdown
- Excel 密码保护（openpyxl）
```

with:

```markdown
- 往期印数表导入支持 Office 加密 OOXML：后端使用 `msoffcrypto-tool` 在内存中解密，再交给 `openpyxl` 解析；上传密码只随本次请求使用，不落库、不写日志、不写入代码或配置。
```

- [ ] **Step 2: Update user guide troubleshooting**

In `docs/user-guide.md`, after line 819, add:

```markdown

### 7.4 往期导入提示文件有密码

**症状**：在"往期印数导入"页面预览时提示“印数文件已加密，请输入文件密码后重试”。

**解决方案**：
1. 在印数文件上传框下方的密码输入框中填写该 Excel 文件的打开密码。
2. 重新点击“预览导入”。
3. 如果提示密码不正确，请确认使用的是 Excel 打开密码，而不是工作表保护密码。

系统只会在本次上传请求中使用该密码进行内存解密，不会保存密码。
```

If this insertion shifts the existing `### 7.4 发货明细为空` heading, rename it to:

```markdown
### 7.5 发货明细为空
```

- [ ] **Step 3: Commit Task 4**

Run:

```powershell
git add docs\technical.md docs\user-guide.md
git commit -m "docs: document encrypted history import" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: End-to-end verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run backend history import tests**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
$env:PYTHONPATH = (Get-Location).Path
python -m unittest tests.test_history_import -v
```

Expected: PASS.

- [ ] **Step 2: Run frontend type check**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\frontend
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Verify with the real encrypted sample file**

Run:

```powershell
Set-Location C:\Users\luyal\Repos\FirstTry\backend
$env:PYTHONPATH = (Get-Location).Path
@'
from pathlib import Path
from app.services.workbook_loader import load_uploaded_workbook

path = Path.home() / "Desktop" / "2026年《中国经营报》第十三期（总第2647期）报数.xlsx"
workbook = load_uploaded_workbook(
    path.read_bytes(),
    password="0611",
    file_label="印数文件",
)
print(workbook.sheetnames)
workbook.close()
'@ | python -
```

Expected: command prints the decrypted workbook sheet names, including `北京印厂`, `人民日报印厂\``, `零售渠道\``, `订阅渠道\``, `社用报\``, and `收发室自留分发（需打印）`.

- [ ] **Step 4: Review git history and status**

Run:

```powershell
git --no-pager log --oneline -5
git --no-pager status --short
```

Expected: latest commits include Task 1-4 commits and working tree is clean.

