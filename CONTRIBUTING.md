# Đóng góp cho MMC studio

Cảm ơn bạn muốn cùng làm app! Tài liệu này giúp bạn chạy dự án, thêm tính năng và gửi PR.

## Chuẩn bị

1. Node.js 24 trở lên, Git, Windows 10/11.
2. Claude Code CLI đã đăng nhập bằng **tài khoản của chính bạn** (`irm https://claude.ai/install.ps1 | iex`, rồi chạy `claude` để đăng nhập). App không bao giờ đóng gói hay chia sẻ thông tin đăng nhập Claude — xem `docs/claude-usage-policy.md`.
3. Clone repo, rồi:

   ```powershell
   npm install
   copy .env.example .env   # điền URL + anon key của project Supabase dev (hỏi người quản lý)
   npm run dev
   ```

   Không có `.env` app vẫn chạy được phần offline (chat, trí nhớ, thời gian); các trang team sẽ báo chưa cấu hình. Chi tiết Supabase: `docs/supabase-setup.md`.

## Quy trình làm việc

- Nhánh `main` được bảo vệ: mọi thay đổi đi qua Pull Request, CI xanh và ít nhất 1 người duyệt.
- Tạo nhánh từ `main`: `feat/<tên-ngắn>`, `fix/<tên-ngắn>`, `docs/<tên-ngắn>`.
- Commit theo [Conventional Commits](https://www.conventionalcommits.org/): `feat(learning): thêm flashcard`, `fix(chat): …`, `docs: …`, `chore: …`. Viết tiếng Việt hoặc tiếng Anh đều được.
- Trước khi đẩy code:

  ```powershell
  npm run lint
  npm run typecheck
  npm test          # gồm cả test RLS Supabase (PGlite, không cần Docker)
  npm run test:e2e  # build + Playwright cho Electron
  ```

- Mở PR và điền checklist trong mẫu. Liên kết issue bằng `Closes #số`.

## Làm việc song song (3 dev)

Từ 2026-11 team chia app thành 3 mảng, mỗi người giữ một mảng. Xung đột khi merge gần như luôn đến từ vài "file nóng" mà tính năng nào cũng sửa, nên mỗi file nóng có một người giữ.

| Mảng                            | Người giữ                   | Vùng code chính                                                                                                               |
| ------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A — Trợ lý & Agent              | @phanduongthien (chủ dự án) | `src/main/` (trừ `src/main/team/`), IPC gốc, migration Drizzle                                                                |
| B — Team & Quản lý              | @matchasoda2201             | `features/work`, `dashboard`, `feedback`, `today`, `team`; `src/main/team/`; `supabase/migrations/` (chủ repo duyệt)          |
| C — Trải nghiệm & Kết nối ngoài | @duonghoan285205-lgtm       | `components/ui/`, `styles.css`, `features/settings`, `features/plugins`, `features/registry.ts`, artifact, Telegram, lịch hẹn |

Review xoay vòng: A duyệt PR của B, B duyệt PR của C, C duyệt PR của A. Chủ dự án bấm merge. Tài liệu giao việc của từng PR nằm ở `docs/tasks/`.

### Tên nhánh

Giữ tiền tố ở trên và thêm mã việc trong kế hoạch: `refactor/a0.1-split-main`, `feat/b0.1-team-data-bridge`, `feat/c0.1-ui-kit`. Nhánh luôn tạo từ `main` mới nhất.

### File nóng

Sửa file nóng của mảng khác: nhắn người giữ trước, hoặc mở PR nhỏ riêng để họ duyệt. Ghi trong mô tả PR là bạn đã đụng file nóng nào.

| File                                                                                           | Người giữ         | Cách người khác thay đổi                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts` (khởi tạo dịch vụ)                                                         | A                 | Sau A0.1: sửa file khởi tạo của mảng mình trong `src/main/boot/`                                                                        |
| `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc/register.ts` | A                 | Sau A0.1: thêm vào file của mảng mình (kiểu API, kênh IPC, preload tách theo nhóm)                                                      |
| `src/main/services/chatService.ts`, `src/main/ai/`                                             | A                 | Tool mới đăng ký qua `AppToolRegistry` (`src/main/tools/registry.ts`), không sửa thẳng chatService                                      |
| `src/main/db/schema.ts`, `src/main/db/migrations/` (Drizzle, đánh số)                          | A cấp số          | Xem mục Migration bên dưới                                                                                                              |
| `src/shared/schemas.ts`                                                                        | Ai cũng thêm      | Schema zod mới đặt trong file của mảng (`src/shared/<mảng>.ts`), không chèn vào `schemas.ts`                                            |
| `src/shared/sync.ts`                                                                           | Ai cũng thêm      | Mỗi PR thêm đúng một dòng, tên theo mảng                                                                                                |
| `supabase/migrations/`                                                                         | Chủ repo duyệt    | Skill `supabase-migration`; mỗi migration một PR riêng, có test RLS                                                                     |
| `src/renderer/src/features/registry.ts`                                                        | C                 | Mỗi tính năng thêm một dòng (skill `add-feature-module`)                                                                                |
| `features/settings/catalog.ts`, `SettingsTabs.tsx`                                             | C                 | Dòng cài đặt nằm trong component của mảng, catalog chỉ thêm một mục                                                                     |
| `src/renderer/src/styles.css`, `components/ui/`                                                | C                 | Chỉ dùng thành phần trong `components/ui/`; cần kiểu hoặc màu mới thì PR riêng vào bộ chung trước (màu ngoài theme sẽ thành trong suốt) |
| `docs/PROGRESS.md`                                                                             | Mỗi người một mục | Chỉ sửa mục "Đang làm — Dev X" của mình; "Quyết định đã duyệt" chỉ chủ dự án sửa                                                        |
| `package.json`, `package-lock.json`, `CHANGELOG.md`, `CLAUDE.md`                               | Chủ dự án         | Thư viện mới: hỏi chủ dự án trước, PR riêng, merge ngay. CHANGELOG chỉ cập nhật lúc phát hành                                           |

### Migration Drizzle (SQLite trên máy)

Migration đánh số liên tục (`0017_…`, `0018_…`) và cùng sửa `meta/_journal.json`, nên hai nhánh cùng sinh một số là chắc chắn xung đột. Trước khi tạo nhánh có migration, ghi số sẽ dùng vào mục "Đang làm" của mình trong `docs/PROGRESS.md`. Nếu vẫn đụng số, PR merge sau rebase lên `main` rồi chạy lại `npm run db:generate`.

### Mỗi ngày

- Mỗi sáng: `git fetch` rồi `git rebase origin/main`. Nhánh sống quá 3 ngày là dấu hiệu nên cắt nhỏ.
- Mỗi PR một việc, khoảng dưới 400 dòng thay đổi. Việc lớn cắt thành chuỗi PR (phần main trước, giao diện sau).
- Tính năng dở dang được merge sau cờ tắt, không giữ nhánh dài.
- Thứ tự merge khi nhiều PR cùng xanh: nền chung → thư viện → backend → giao diện.

## Thêm tính năng mới

Mỗi tính năng là một module trong `src/renderer/src/features/<tên>/` (giao diện, store, i18n, test) và được đăng ký ở **một chỗ duy nhất**: `features/registry.ts`. Nếu cần quyền theo vai trò, khai báo `roles` trong `FeatureDefinition` (rỗng = ai cũng thấy).

Dùng Claude Code trong repo để làm nhanh — các skill dự án nằm ở `.claude/skills/`:

| Việc | Skill |
| --- | --- |
| Thêm tính năng (UI, IPC, migration, test, đăng ký) | `add-feature-module` |
| Code gọi AI (Claude CLI / API) | `claude-bridge` |
| Đổi schema dữ liệu team trên Supabase | `supabase-migration` |
| Phát hành phiên bản | `release-update` |

Quy tắc bắt buộc (xem thêm `CLAUDE.md`):

- Mọi IPC input validate bằng zod; renderer không truy cập Node trực tiếp (`nodeIntegration` luôn tắt).
- Chuỗi giao diện đi qua i18next, có đủ `vi.json` và `en.json` (test sẽ báo nếu thiếu khóa).
- Bảng Supabase mới **phải bật RLS** và có test quyền cho Owner / Manager / Member. App không bao giờ dùng service-role key.
- Trợ lý chỉ **đề xuất**; memory mới, task do AI tạo, thay đổi file code luôn qua bước người dùng duyệt.
- Không commit secret, API key, `.env`. Thêm biến mới vào `.env.example`.

## Thêm skill cho trợ lý

Skill lúc chạy nằm ở `assistant-skills/<tên>/SKILL.md` và được chèn vào system prompt theo chế độ hội thoại. Viết ngắn gọn, nói rõ định dạng đầu ra (thường là một khối JSON) và viết test cho phần parse ở `src/main/assistant/__tests__/`.

## Báo lỗi & đề xuất

Trong app: **Góp ý & báo lỗi** (thanh bên) hoặc **Cài đặt → Gửi báo lỗi**. Trợ lý giúp chuẩn hóa nội dung, bạn duyệt rồi mở trang tạo issue trên GitHub. Hoặc tạo issue trực tiếp bằng các mẫu có sẵn.
